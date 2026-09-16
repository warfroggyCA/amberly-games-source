import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  read: vi.fn(),
  watch: vi.fn(),
  authError: null as Error | null,
}));
vi.mock("../src/server/auth", () => ({
  createAuthContext: () => ({
    requireUser: async () => {
      if (mocks.authError) throw mocks.authError;
      return { id: "owner", email: "owner@example.test" };
    },
    json: (data: unknown, status = 200) => NextResponse.json(data, { status }),
  }),
}));
vi.mock("../src/server/database", () => ({
  getSharedRepository: () => ({
    writeLiveDraft: mocks.write,
    readLiveDraft: mocks.read,
    readWatchDraft: mocks.watch,
  }),
}));
import { GET, POST } from "../src/app/api/family/draft/route";
import { GET as watch } from "../src/app/api/watch/draft/route";
import { HttpError } from "../src/server/shared-http";
const origin = "http://127.0.0.1:3001";
const request = (headers: Record<string, string> = {}) =>
  new Request(origin + "/api/family/draft", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-scrabble-user": "owner",
      ...headers,
    },
    body: JSON.stringify({ gameId: "game" }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authError = null;
  process.env.SCRABBLE_APP_ORIGIN = origin;
  process.env.SCRABBLE_FAMILY_ID = "11111111-1111-4111-8111-111111111111";
  mocks.write.mockResolvedValue({ accepted: true });
  mocks.read.mockResolvedValue(null);
  mocks.watch.mockResolvedValue({ revision: 0, draft: null });
});
describe("live draft API boundaries", () => {
  it("forwards only verified identity and never accepts guest writes", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.write.mock.calls[0][0]).toEqual({
      userId: "owner",
      email: "owner@example.test",
      emailVerified: true,
    });
    expect((await POST(request({ "x-scrabble-user": "other" }))).status).toBe(
      401,
    );
    expect(mocks.write).toHaveBeenCalledTimes(1);
    mocks.authError = new HttpError(401, "Sign in");
    expect((await POST(request())).status).toBe(401);
    expect(
      (await GET(new Request(origin + "/api/family/draft?gameId=game"))).status,
    ).toBe(401);
  });
  it("rejects cross-origin and oversized writes before accessing the database", async () => {
    expect(
      (await POST(request({ origin: "https://elsewhere.test" }))).status,
    ).toBe(403);
    expect((await POST(request({ "content-length": "4097" }))).status).toBe(
      413,
    );
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("requires the full private viewing token and returns a cache-disabled bounded projection", async () => {
    expect((await watch(new Request(origin + "/api/watch/draft"))).status).toBe(
      401,
    );
    const token = "a".repeat(64);
    const response = await watch(
      new Request(origin + "/api/watch/draft", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ revision: 0, draft: null });
    expect(mocks.watch).toHaveBeenCalledWith(token);
  });
  it("keeps infrastructure details out of failed preview responses", async () => {
    mocks.write.mockRejectedValue(new Error("SQL password connection"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/SQL|password/);
  });
});
