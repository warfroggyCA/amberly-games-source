import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBoard } from "../src/domain/board";

const repository = vi.hoisted(() => ({
  readWatch: vi.fn(),
  get: vi.fn(),
}));
vi.mock("../src/server/database", () => ({
  getSharedRepository: repository.get,
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

import { GET } from "../src/app/api/watch/route";
import { SharedRepositoryError } from "../src/server/shared-repository";

const token = "a".repeat(64);
const endpoint = "https://scrabble.example/api/watch";
const request = (authorization?: string, url = endpoint) =>
  new Request(url, {
    headers: authorization ? { Authorization: authorization } : {},
  });
const game = () => ({
  id: "game-1",
  players: [{ id: "player-1", name: "Ada", seat: 0 }],
  board: createBoard(),
  scores: { "player-1": 12 },
  turns: [],
  order: ["player-1"],
  status: "active",
  currentPlayerId: "player-1",
});
function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("expires")).toBe("0");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  repository.get.mockImplementation(() => ({
    readWatch: repository.readWatch,
  }));
  repository.readWatch.mockResolvedValue(game());
});

describe("private guest scoreboard HTTP boundary", () => {
  it("rejects a missing viewing token before opening the repository", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "This viewing link is incomplete. Ask the scorer for a new link.",
    });
    expect(repository.get).not.toHaveBeenCalled();
    expectPrivate(response);
  });

  it.each([
    "Bearer short",
    `Bearer ${"a".repeat(63)}`,
    `Bearer ${"a".repeat(65)}`,
    `Bearer ${"g".repeat(64)}`,
    `Bearer ${"A".repeat(64)}`,
    `Basic ${token}`,
    `Bearer ${token} another-token`,
  ])(
    "rejects malformed authorization without echoing its value",
    async (authorization) => {
      const response = await GET(request(authorization));
      expect(response.status).toBe(401);
      expect(repository.get).not.toHaveBeenCalled();
      expect(await response.text()).not.toContain(authorization);
      expectPrivate(response);
    },
  );

  it("does not accept a query-string token in place of the authorization header", async () => {
    const response = await GET(
      request(undefined, `${endpoint}?token=${token}`),
    );
    expect(response.status).toBe(401);
    expect(repository.get).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(token);
  });

  it("does not treat account cookies as a private viewing link", async () => {
    const response = await GET(
      new Request(endpoint, {
        headers: {
          Cookie: "some-session=present",
          "X-Scrabble-User": "user-1",
        },
      }),
    );
    expect(response.status).toBe(401);
    expect(repository.readWatch).not.toHaveBeenCalled();
  });

  it("returns the narrow scoreboard without requiring a family sign-in", async () => {
    const response = await GET(request(`Bearer ${token}`));
    expect(response.status).toBe(200);
    expect(repository.readWatch).toHaveBeenCalledExactlyOnceWith(token);
    const body = await response.json();
    expect(body).toEqual({ game: game() });
    expect(Object.keys(body)).toEqual(["game"]);
    expect(body.game).not.toHaveProperty("members");
    expect(body.game).not.toHaveProperty("events");
    expect(body.game).not.toHaveProperty("gameAccess");
    expect(JSON.stringify(body)).not.toContain(token);
    expectPrivate(response);
  });

  it.each([
    ["WATCH_NOT_FOUND", 404],
    ["WATCH_EXPIRED", 410],
    ["WATCH_REVOKED", 403],
    ["WATCH_DENIED", 401],
  ])(
    "uses the same safe response for denied link reason %s",
    async (code, status) => {
      repository.readWatch.mockRejectedValue(
        new SharedRepositoryError(
          code as string,
          `Private lookup detail for token ${token}; secret family metadata`,
          status as number,
        ),
      );
      const response = await GET(request(`Bearer ${token}`));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error:
          "This viewing link has expired or was closed. Ask the scorer for a new link.",
      });
      expectPrivate(response);
    },
  );

  it.each([500, 502, 503, 504])(
    "returns 503 for repository backend failure %s without leaking details",
    async (status) => {
      repository.readWatch.mockRejectedValue(
        new SharedRepositoryError(
          "DATABASE_FAILURE",
          `SQL connection secret for ${token}`,
          status,
        ),
      );
      const response = await GET(request(`Bearer ${token}`));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "The live scoreboard is temporarily unavailable. Reconnecting…",
      });
      expectPrivate(response);
    },
  );

  it("sanitizes unknown provider exceptions", async () => {
    repository.readWatch.mockRejectedValue(
      new Error(`postgres password=private; token=${token}`),
    );
    const response = await GET(request(`Bearer ${token}`));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(
      /postgres|password|private|token=/,
    );
    expectPrivate(response);
  });

  it("handles unavailable database configuration without exposing configuration values", async () => {
    repository.get.mockImplementation(() => {
      throw new Error("SCRABBLE_DATABASE_URL=postgres://secret");
    });
    const response = await GET(request(`Bearer ${token}`));
    expect(response.status).toBe(503);
    expect(repository.readWatch).not.toHaveBeenCalled();
    expect(await response.text()).not.toMatch(
      /SCRABBLE_DATABASE_URL|postgres|secret/,
    );
    expectPrivate(response);
  });
});
