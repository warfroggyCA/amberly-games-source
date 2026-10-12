import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ get: vi.fn(), read: vi.fn(), enabled: true }));
vi.mock("../src/lib/coaching-availability", () => ({
  get coachingAvailable() {
    return mock.enabled;
  },
}));
vi.mock("../src/server/database", () => ({ getSharedRepository: mock.get }));
import { GET } from "../src/app/api/watch/coaching/route";
import { SharedRepositoryError } from "../src/server/shared-repository";
const token = "a".repeat(64);
function request(id = "registered:turn.1", auth = `Bearer ${token}`) {
  return new Request(
    `http://localhost/api/watch/coaching?turnId=${encodeURIComponent(id)}`,
    { headers: { Authorization: auth } },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.enabled = true;
  mock.get.mockReturnValue({ readWatchCoaching: mock.read });
});
it.each(["", "Bearer short", `Bearer ${"A".repeat(64)}`, "Basic private"])(
  "rejects malformed credentials before repository access (%s)",
  async (auth) => {
    const response = await GET(request("turn", auth));
    expect(response.status).toBe(401);
    expect(mock.get).not.toHaveBeenCalled();
  },
);
it("supports established IDs and returns private no-store data without account cookies", async () => {
  const position = { gameId: "one", turn: { id: "registered:turn.1" } };
  mock.read.mockResolvedValue(position);
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ position });
  expect(mock.read).toHaveBeenCalledWith(token, "registered:turn.1");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
});
it.each([401, 403, 404, 410, 500])(
  "sanitizes denied and failed reads (%s)",
  async (status) => {
    mock.read.mockRejectedValue(
      new SharedRepositoryError("PRIVATE", "secret raw journal", status),
    );
    const response = await GET(request());
    expect(response.status).toBe(status < 500 ? 404 : 503);
    expect(await response.text()).not.toMatch(/secret|journal/);
  },
);

it("disabled build rejects cached guest requests without opening the database", async () => {
  mock.enabled = false;
  const response = await GET(request());
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(mock.get).not.toHaveBeenCalled();
  expect(await response.json()).not.toHaveProperty("position");
});
