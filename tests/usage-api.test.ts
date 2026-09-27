import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { SharedRepositoryError } from "../src/server/shared-repository";
const mock = vi.hoisted(() => ({
  report: vi.fn(),
  record: vi.fn(),
  user: vi.fn(),
}));
vi.mock("../src/server/database", () => ({
  getUsageRepository: () => ({ report: mock.report, record: mock.record }),
}));
vi.mock("../src/server/auth", async () => {
  const { privateJson } = await import("../src/server/shared-http");
  return {
    createAuthContext: () => ({ requireUser: mock.user, json: privateJson }),
  };
});
import { GET, POST } from "../src/app/api/family/usage/route";
const origin = "https://usage.example",
  user = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "ada@example.test",
  };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SCRABBLE_APP_ORIGIN", origin);
  vi.stubEnv("SCRABBLE_FAMILY_ID", "22222222-2222-4222-8222-222222222222");
  mock.user.mockResolvedValue(user);
  mock.report.mockResolvedValue({ rows: [] });
  mock.record.mockResolvedValue({ accepted: true });
});
afterEach(() => vi.unstubAllEnvs());
it("requires matching authenticated identity on reports, CSVs and writes", async () => {
  for (const suffix of ["", "?format=csv"])
    expect(
      (await GET(new Request(origin + "/api/family/usage" + suffix))).status,
    ).toBe(401);
  expect(mock.report).not.toHaveBeenCalled();
});
it("denies a member or revoked admin equally for JSON and CSV", async () => {
  mock.report.mockRejectedValue(
    new SharedRepositoryError(
      "FORBIDDEN",
      "Only superadmins can view access and usage.",
      403,
    ),
  );
  for (const suffix of ["", "?format=csv"]) {
    const r = await GET(
      new Request(origin + "/api/family/usage" + suffix, {
        headers: { "x-scrabble-user": user.id },
      }),
    );
    expect(r.status).toBe(403);
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(await r.text()).not.toContain("Recorded at");
  }
});
it("exports only after the same protected report query and prevents caching", async () => {
  const r = await GET(
    new Request(origin + "/api/family/usage?format=csv", {
      headers: { "x-scrabble-user": user.id },
    }),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("text/csv");
  expect(r.headers.get("cache-control")).toContain("no-store");
  expect(mock.report.mock.calls[0][3]).toBe(true);
});
it("rejects cross-site, oversized and non-JSON pings before database work", async () => {
  for (const [requestOrigin, body, type, status] of [
    ["https://bad.example", "{}", "application/json", 403],
    [origin, "a".repeat(1100), "application/json", 413],
    [origin, "{}", "text/plain", 415],
  ] as const) {
    const r = await POST(
      new Request(origin + "/api/family/usage", {
        method: "POST",
        headers: {
          origin: requestOrigin,
          "content-type": type,
          "x-scrabble-user": user.id,
        },
        body,
      }),
    );
    expect(r.status).toBe(status);
  }
  expect(mock.record).not.toHaveBeenCalled();
});
