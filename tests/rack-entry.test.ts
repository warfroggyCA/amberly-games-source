import { describe, expect, it } from "vitest";
import { parseRackEntry } from "../src/lib/rack-entry";

describe("physical rack entry", () => {
  it("normalizes ASCII letters, ignores separators, and preserves physical blanks", () => {
    expect(parseRackEntry(" a t ? \n E\tr ")).toEqual({
      ok: true,
      value: "AT?ER",
    });
    expect(parseRackEntry("READING")).toEqual({ ok: true, value: "READING" });
  });
  it("allows an empty rack and deleting down to empty", () => {
    expect(parseRackEntry("")).toEqual({ ok: true, value: "" });
    expect(parseRackEntry("   ")).toEqual({ ok: true, value: "" });
    expect(parseRackEntry("", 0)).toEqual({ ok: true, value: "" });
  });
  it("rejects an entire over-capacity paste instead of silently truncating it", () => {
    expect(parseRackEntry("ABCDEFGH")).toMatchObject({ ok: false });
    expect(parseRackEntry("A B C D E F G H")).toMatchObject({ ok: false });
    expect(parseRackEntry("AB", 1)).toMatchObject({ ok: false });
    expect(parseRackEntry("A", 0)).toMatchObject({ ok: false });
  });
  it("rejects Unicode before case conversion can expand or substitute tile letters", () => {
    for (const input of [
      "ß",
      "ﬀ",
      "ſ",
      "ı",
      "é",
      "Ａ",
      "Α",
      "А",
      "🙂",
      "A\u200bT",
    ]) {
      expect(parseRackEntry(input)).toMatchObject({ ok: false });
    }
  });
  it("rejects digits, punctuation, and control characters instead of stripping them", () => {
    for (const input of ["AT1", "A-T", "A.T", "*", "A\0T", "A\bT"]) {
      expect(parseRackEntry(input)).toMatchObject({ ok: false });
    }
  });
  it("validates custom rack limits and never mutates the original input", () => {
    for (const max of [-1, 8, 1.5, NaN, Infinity])
      expect(parseRackEntry("AT", max)).toMatchObject({ ok: false });
    const original = "a ? t";
    parseRackEntry(original);
    expect(original).toBe("a ? t");
  });
});
