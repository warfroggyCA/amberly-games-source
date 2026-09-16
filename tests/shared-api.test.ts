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
import { HttpError } from "../src/server/shared-http";
const origin = "http://127.0.0.1:3001";
const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(origin + path, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
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
    const response = await GET(new Request(origin + "/api/family"));
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
    expect((await GET(new Request(origin + "/api/family"))).status).toBe(401);
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
    const response = await GET(new Request(origin + "/api/family"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/password|SQL/);
  });
});
