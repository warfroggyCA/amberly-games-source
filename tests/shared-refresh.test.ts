import { describe, expect, it } from "vitest";
import {
  REFRESH_HEADER_LIMIT,
  materializeRefresh,
  parseRefreshVersions,
  refreshHeader,
  type SharedRefresh,
} from "../src/lib/shared-refresh";
const wire = (): SharedRefresh => ({
  kind: "family-refresh-v1",
  userId: "user",
  familyId: "family",
  scope: "",
  versions: { catalog: "a".repeat(32), "p:ada": "b".repeat(32) },
  values: {
    catalog: { family: { id: "family" }, member: { userId: "user" } },
    "p:ada": { id: "ada", name: "Ada" },
  },
  playerIds: ["ada"],
  gameIds: [],
  nextCursor: null,
});
describe("private resource refresh protocol", () => {
  it("accepts complete large rosters while retaining resource validation", () => {
    const input = wire();
    for (let i = 0; i < 1000; i++) {
      const id = "extra-" + i;
      input.playerIds.push(id);
      input.versions["p:" + id] = "c".repeat(32);
      input.values["p:" + id] = { id, name: "Extra" };
    }
    expect(
      materializeRefresh(input, undefined, "user", "family", "").state.players,
    ).toHaveLength(1001);
    expect(() =>
      materializeRefresh(
        { ...input, playerIds: [...input.playerIds, "ada"] },
        undefined,
        "user",
        "family",
        "",
      ),
    ).toThrow();
    expect(() =>
      materializeRefresh(
        { ...input, values: { ...input.values, "p:unexpected": {} } },
        undefined,
        "user",
        "family",
        "",
      ),
    ).toThrow();
    expect(() =>
      materializeRefresh(
        {
          ...input,
          gameIds: Array.from({ length: 501 }, (_, i) => "game-" + i),
        },
        undefined,
        "user",
        "family",
        "",
      ),
    ).toThrow();
  });
  it("materializes full/unchanged snapshots without mutating cached values", () => {
    const initial = wire();
    const cold = materializeRefresh(initial, undefined, "user", "family", "");
    const cached = materializeRefresh(
      { ...initial, values: {}, nextCursor: "new-cursor" },
      cold.cache,
      "user",
      "family",
      "",
    );
    expect(cached.state.players).toEqual([{ id: "ada", name: "Ada" }]);
    expect(cached.state.nextCursor).toBe("new-cursor");
    expect(cold.state.nextCursor).toBeNull();
  });
  it.each(["user", "family", "scope"])("rejects a different %s", (key) => {
    const input = wire();
    if (key === "user") input.userId = "other";
    if (key === "family") input.familyId = "other";
    if (key === "scope") input.scope = "other";
    expect(() =>
      materializeRefresh(input, undefined, "user", "family", ""),
    ).toThrow();
  });
  it("rejects missing, duplicate, unexpected and mismatched resources", () => {
    const input = wire();
    expect(() =>
      materializeRefresh(
        { ...input, values: {} },
        undefined,
        "user",
        "family",
        "",
      ),
    ).toThrow();
    expect(() =>
      materializeRefresh(
        { ...input, playerIds: ["ada", "ada"] },
        undefined,
        "user",
        "family",
        "",
      ),
    ).toThrow();
    expect(() =>
      materializeRefresh(
        {
          ...input,
          versions: { ...input.versions, "p:extra": "a".repeat(32) },
        },
        undefined,
        "user",
        "family",
        "",
      ),
    ).toThrow();
    expect(() =>
      materializeRefresh(
        { ...input, values: { ...input.values, "p:ada": { id: "other" } } },
        undefined,
        "user",
        "family",
        "",
      ),
    ).toThrow();
  });
  it("bounds request headers and rejects invalid caller versions", () => {
    const many = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => ["p:" + i, "a".repeat(32)]),
    );
    const header = refreshHeader(many);
    expect(header.length).toBeLessThanOrEqual(REFRESH_HEADER_LIMIT);
    expect(Object.keys(parseRefreshVersions(header)).length).toBeGreaterThan(0);
    for (const raw of [
      "[]",
      '{"__proto__":"' + "a".repeat(32) + '"}',
      '{"catalog":3}',
      '{"catalog":"bad"}',
      " ".repeat(6001),
    ])
      expect(() => parseRefreshVersions(raw)).toThrow();
  });
});
