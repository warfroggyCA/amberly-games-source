import { beforeEach, afterEach, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({
  read: vi.fn(),
  append: vi.fn(),
  user: vi.fn(),
}));
vi.mock("../src/server/database", () => ({
  getSharedRepository: () => ({
    readWords: mock.read,
    confirmWords: mock.append,
  }),
}));
vi.mock("../src/server/auth", async () => {
  const { privateJson } = await import("../src/server/shared-http");
  return {
    createAuthContext: () => ({ requireUser: mock.user, json: privateJson }),
  };
});
import { GET, POST } from "../src/app/api/family/words/route";
const origin = "https://gym.example",
  user = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "ada@example.test",
  };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SCRABBLE_APP_ORIGIN", origin);
  vi.stubEnv("SCRABBLE_FAMILY_ID", "22222222-2222-4222-8222-222222222222");
  mock.user.mockResolvedValue(user);
  mock.read.mockResolvedValue([]);
  mock.append.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());
it("requires the matching signed-in identity and returns private uncached data", async () => {
  const bad = await GET(new Request(origin + "/api/family/words"));
  expect(bad.status).toBe(401);
  expect(mock.read).not.toHaveBeenCalled();
  const good = await GET(
    new Request(origin + "/api/family/words", {
      headers: { "x-scrabble-user": user.id },
    }),
  );
  expect(good.status).toBe(200);
  expect(good.headers.get("cache-control")).toContain("no-store");
  expect(mock.read.mock.calls[0][0]).toEqual({
    userId: user.id,
    email: user.email,
    emailVerified: true,
  });
});
it("rejects cross-origin and oversized writes before repository work", async () => {
  for (const [body, requestOrigin, status] of [
    ["{}", "https://other.example", 403],
    [JSON.stringify({ large: "a".repeat(3000) }), origin, 413],
  ] as const) {
    const response = await POST(
      new Request(origin + "/api/family/words", {
        method: "POST",
        headers: {
          origin: requestOrigin,
          "content-type": "application/json",
          "x-scrabble-user": user.id,
        },
        body,
      }),
    );
    expect(response.status).toBe(status);
  }
  expect(mock.append).not.toHaveBeenCalled();
});
