import { describe, expect, it } from "vitest";
import {
  extendLexicon,
  isVerifiedWord,
  MAX_VERIFIED_WORDS,
  type VerifiedWord,
} from "../src/domain/verified-words";

const entry: VerifiedWord = {
  word: "DOG",
  source: "merriam-webster",
  sourceUrl: "https://scrabble.merriam.com/finder/dog",
  verifiedAt: "2026-09-14T17:00:00.000Z",
};
const base = Object.freeze({
  id: "base",
  edition: "1",
  status: "test" as const,
  words: Object.freeze(["CAT"]),
  has: (word: string) => word === "CAT",
});
describe("publisher word evidence", () => {
  it("accepts exact sourced objects and real ISO instants", () => {
    expect(isVerifiedWord(entry)).toBe(true);
    expect(
      isVerifiedWord({ ...entry, verifiedAt: "2024-02-29T10:11:12+14:00" }),
    ).toBe(true);
  });
  it.each([
    { word: "dog" },
    { word: "D" },
    { word: "ABCDEFGHIJKLMNOP" },
    { word: "DÖG" },
    { word: "DOG\n" },
    { source: "manual" },
    { sourceUrl: "https://scrabble.merriam.com/finder/cat" },
    { sourceUrl: "https://scrabble.merriam.com/finder/dog?yes=1" },
    { sourceUrl: "https://example.org/finder/dog" },
    { verifiedAt: "2026-02-29T10:00:00Z" },
    { verifiedAt: "2026-09-14" },
    { verifiedAt: "2026-09-14T24:00:00Z" },
    { verifiedAt: "2026-09-14T10:00:00+14:01" },
    { verifiedAt: "2026-09-14T10:00:61Z" },
    { playable: true },
  ])("rejects malformed or mismatched evidence %j", (change) =>
    expect(isVerifiedWord({ ...entry, ...change })).toBe(false),
  );
  it("rejects terminal newlines even when the URL repeats that malformed word", () => {
    expect(
      isVerifiedWord({
        ...entry,
        word: "ONYX\n",
        sourceUrl: "https://scrabble.merriam.com/finder/onyx\n",
      }),
    ).toBe(false);
    expect(
      isVerifiedWord({ ...entry, verifiedAt: "2026-09-14T17:00:00Z\n" }),
    ).toBe(false);
  });
  it("rejects prototypes, getters and hidden unexpected keys without invoking accessors", () => {
    expect(isVerifiedWord(Object.create(entry))).toBe(false);
    expect(
      isVerifiedWord(
        Object.defineProperty({ ...entry }, "hidden", { value: 1 }),
      ),
    ).toBe(false);
    expect(
      isVerifiedWord(
        Object.defineProperty({ ...entry }, "word", {
          get: () => {
            throw Error("must not read");
          },
        }),
      ),
    ).toBe(false);
    expect(isVerifiedWord(null)).toBe(false);
  });
  it("extends membership and enumerable words without rewriting the base or metadata", () => {
    const extended = extendLexicon(base, [entry]);
    expect(extended.has("DOG")).toBe(true);
    expect(extended.has("CAT")).toBe(true);
    expect(extended.has("QXZ")).toBe(false);
    expect(extended.words).toEqual(["CAT", "DOG"]);
    expect(extended.id).toBe(base.id);
    expect(extended.edition).toBe(base.edition);
    expect(extended.status).toBe("test");
    expect(base.has("DOG")).toBe(false);
    expect(base.words).toEqual(["CAT"]);
    expect(Object.isFrozen(extended)).toBe(true);
    expect(Object.isFrozen(extended.words)).toBe(true);
    expect(extendLexicon(base, [{ ...entry }])).toBe(extended);
    expect(extendLexicon(base, [])).toBe(base);
  });
  it("snapshots added membership and does not promote an unavailable reference", () => {
    const mutable = { ...entry };
    const extended = extendLexicon(
      { ...base, status: "unavailable" as const },
      [mutable],
    );
    mutable.word = "RAT";
    expect(extended.has("DOG")).toBe(true);
    expect(extended.has("RAT")).toBe(false);
    expect(extended.status).toBe("unavailable");
  });
  it("rejects duplicate, sparse, oversized and non-JSON entry arrays", () => {
    expect(() => extendLexicon(base, [entry, entry])).toThrow(/unique/);
    expect(() => extendLexicon(base, new Array(1))).toThrow();
    expect(() =>
      extendLexicon(base, new Array(MAX_VERIFIED_WORDS + 1)),
    ).toThrow();
    const attached = Object.assign([entry], { hidden: "bad" });
    expect(() => extendLexicon(base, attached)).toThrow();
    expect(() => extendLexicon(base, [{ ...entry, word: "no" }])).toThrow();
  });
});
