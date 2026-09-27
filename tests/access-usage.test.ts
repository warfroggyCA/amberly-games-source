import { describe, it, expect } from "vitest";
import {
  activeSample,
  isUsagePulse,
  usageArea,
  usageCsv,
  isUsageReport,
  type UsageRow,
} from "../src/lib/access-usage";
describe("usage measurements and export", () => {
  it("counts only recent visible interaction and excludes sleep and clock reversal", () => {
    expect(activeSample(1000, 6000, 0, true)).toBe(5000);
    expect(activeSample(59000, 64000, 0, true)).toBe(1000);
    expect(activeSample(65000, 70000, 0, true)).toBe(0);
    expect(activeSample(1000, 6000, 0, false)).toBe(0);
    expect(activeSample(1000, 20000, 19000, true)).toBe(0);
    expect(activeSample(6000, 1000, 0, true)).toBe(0);
  });
  it("rejects arbitrary paths, actors, durations and malformed receipts", () => {
    const p = {
      id: "11111111-1111-4111-8111-111111111111",
      area: "scrabble",
      activeMs: 15000,
    };
    expect(isUsagePulse(p)).toBe(true);
    for (const change of [
      { id: "bad" },
      { area: "/private?token=secret" },
      { activeMs: 15001 },
      { activeMs: -1 },
      { activeMs: NaN },
      { activeMs: 1.2 },
    ])
      expect(isUsagePulse({ ...p, ...change })).toBe(false);
    expect(usageArea("/gym-lab?from=family")).toBe("gym");
    expect(usageArea("/family/crokinole/abc")).toBe("crokinole");
  });
  it("rejects incomplete report responses", () => {
    expect(isUsageReport({ rows: [] })).toBe(false);
    expect(isUsageReport(null)).toBe(false);
    expect(isUsageReport({ summary: { users: NaN } })).toBe(false);
  });
  it("escapes CSV formulas, quotes and multiline values without inventing duration", () => {
    const row: UsageRow = {
      id: "id",
      at: "2026-09-26T12:00:00Z",
      lastAt: "2026-09-26T12:00:00Z",
      actorId: "actor",
      name: ' =HYPERLINK("bad")',
      email: "x@example.test",
      area: "gym",
      kind: "saved",
      action: "gym:hint",
      subject: "test\nline",
      activeMs: null,
    };
    const csv = usageCsv([row]);
    expect(csv).toContain('"\' =HYPERLINK(""bad"")"');
    expect(csv).toContain('"test\nline"');
    expect(csv).toContain("Used Gym hint");
    expect(csv).toMatch(/,""\r\n$/);
  });
});
