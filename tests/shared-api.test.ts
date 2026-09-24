import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  actor: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
  },
  read: vi.fn(),
  mutate: vi.fn(),
  archive: vi.fn(),
  admit: vi.fn(),
  authError: null as Error | null,
}));
vi.mock("../src/server/scoring-device", () => ({
  bindScoringDevice: (_request: Request, context: unknown) => ({
    context,
    deviceHash: "a".repeat(64),
  }),
}));
vi.mock("../src/server/auth", () => ({
  createAuthContext: () => ({
    requireUser: async () => {
      if (mock.authError) throw mock.authError;
      return mock.actor;
    },
    json: (data: unknown, status = 200) =>
      NextResponse.json(data, {
        status,
        headers: { "Cache-Control": "private, no-store" },
      }),
  }),
}));
vi.mock("../src/server/database", () => ({
  getCrokinoleRepository: () => ({ readState: mock.read, mutate: mock.mutate }),
  getGameSummaryRepository: () => ({
    read: mock.read,
    exportHistory: mock.archive,
  }),
  getSharedRepository: () => ({
    readState: mock.read,
    mutate: mock.mutate,
    exportHistory: mock.archive,
    admit: mock.admit,
  }),
}));
vi.mock("../src/server/shared-repository", () => ({
  SharedRepositoryError: class extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));
import { GET, POST } from "../src/app/api/family/route";
import { POST as join } from "../src/app/api/family/join/route";
import {
  GET as crokinoleGet,
  POST as crokinolePost,
} from "../src/app/api/family/crokinole/route";
import { GET as gamesGet } from "../src/app/api/family/games/route";
import { SharedRepositoryError } from "../src/server/shared-repository";
import { HttpError } from "../src/server/shared-http";
const origin = "http://127.0.0.1:3001";
const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(origin + path, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-scrabble-user": mock.actor.id,
      ...headers,
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mock.authError = null;
  process.env.SCRABBLE_APP_ORIGIN = origin;
  process.env.SCRABBLE_FAMILY_ID = "22222222-2222-4222-8222-222222222222";
  mock.read.mockResolvedValue({ games: [] });
  mock.mutate.mockResolvedValue({});
  mock.admit.mockResolvedValue({});
});
describe("family HTTP boundary", () => {
  it("passes only the provider-verified identity to a read", async () => {
    const response = await GET(
      new Request(origin + "/api/family", {
        headers: { "x-scrabble-user": mock.actor.id },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mock.read).toHaveBeenCalledWith(
      {
        userId: mock.actor.id,
        email: mock.actor.email,
        emailVerified: true,
        deviceHash: "a".repeat(64),
      },
      process.env.SCRABBLE_FAMILY_ID,
      { cursor: undefined, gameId: undefined },
    );
  });
  it("rejects a queued write from a different account before mutation", async () => {
    expect(
      (
        await POST(
          post("/api/family", {}, { "x-scrabble-user": "other-account" }),
        )
      ).status,
    ).toBe(401);
    expect(mock.mutate).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes and unsupported content types", async () => {
    expect(
      (
        await POST(
          post("/api/family", {}, { origin: "https://unrelated.example" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await POST(post("/api/family", {}, { "content-type": "text/plain" })))
        .status,
    ).toBe(415);
    expect(mock.mutate).not.toHaveBeenCalled();
  });
  it("never reaches shared storage when authentication has expired", async () => {
    mock.authError = new HttpError(401, "Sign in again.");
    expect(
      (
        await GET(
          new Request(origin + "/api/family", {
            headers: { "x-scrabble-user": mock.actor.id },
          }),
        )
      ).status,
    ).toBe(401);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it("does not accept identity fields in an invitation acceptance", async () => {
    expect(
      (
        await join(
          post("/api/family/join", {
            requestId: "request",
            email: "someone@example.com",
          }),
        )
      ).status,
    ).toBe(400);
    expect(mock.admit).not.toHaveBeenCalled();
  });
  it("keeps database details out of unknown error responses", async () => {
    mock.read.mockRejectedValue(new Error("password or SQL private details"));
    const response = await GET(
      new Request(origin + "/api/family", {
        headers: { "x-scrabble-user": mock.actor.id },
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/password|SQL/);
  });
});

describe("consistent family route safety", () => {
  it.each([
    ["family", GET],
    ["crokinole", crokinoleGet],
    ["games", gamesGet],
  ] as const)(
    "%s requires the expected account and logs integrity failures",
    async (path, handler) => {
      for (const headers of [
        {},
        { "x-scrabble-user": "someone-else" },
      ] as Record<string, string>[]) {
        const response = await handler(
          new Request(origin + "/api/family/" + path, { headers }),
        );
        expect(response.status).toBe(401);
      }
      expect(mock.read).not.toHaveBeenCalled();
      mock.read.mockRejectedValueOnce(
        new SharedRepositoryError(
          "HISTORY_INTEGRITY",
          "History needs recovery.",
          500,
        ),
      );
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const response = await handler(
          new Request(origin + "/api/family/" + path, {
            headers: { "x-scrabble-user": mock.actor.id },
          }),
        );
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({
          code: "HISTORY_INTEGRITY",
        });
        expect(response.headers.get("x-incident-id")).toBeTruthy();
        expect(log).toHaveBeenCalledTimes(1);
        const entry = JSON.parse(log.mock.calls[0][0]);
        expect(entry.incidentId).toBe(response.headers.get("x-incident-id"));
        expect(JSON.stringify(entry)).not.toMatch(/History|owner@example/);
      } finally {
        log.mockRestore();
      }
    },
  );
  it.each([POST, crokinolePost])(
    "rejects a write without its expected account",
    async (handler) => {
      const request = post("/api/family", {});
      request.headers.delete("x-scrabble-user");
      expect((await handler(request)).status).toBe(401);
      expect(mock.mutate).not.toHaveBeenCalled();
    },
  );
});
