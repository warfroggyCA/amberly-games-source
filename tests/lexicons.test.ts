import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  defaultLexicon,
  familyLexicon,
  releasedFamilyLexicon,
  familyWordAdditions,
  lexiconDetails,
  resolveLexicon,
  websiteLexicon,
} from "../src/lib/lexicons";
import { testLexicon } from "../src/lib/test-lexicon";
import { createBoard } from "../src/domain/board";
import { scoreMove } from "../src/domain/scoring";
import { getFormedWords } from "../src/lib/formed-words";
import type { Placement } from "../src/domain/types";

describe("versioned word references", () => {
  it("uses the approved complete union as a separately pinned family reference", () => {
    expect(defaultLexicon).toBe(releasedFamilyLexicon);
    expect(defaultLexicon.words).toBe(familyLexicon.words);
    expect(familyLexicon.words).toHaveLength(176974);
    expect(familyWordAdditions).toHaveLength(130);
    expect(websiteLexicon.words.every((word) => familyLexicon.has(word))).toBe(
      true,
    );
    expect(testLexicon.words.every((word) => familyLexicon.has(word))).toBe(
      true,
    );
    expect(
      familyWordAdditions.every(
        (word) => familyLexicon.has(word) && !websiteLexicon.has(word),
      ),
    ).toBe(true);
    expect(familyLexicon.has("UNSETTLING")).toBe(true);
    expect(familyLexicon.has("NOTELETS")).toBe(true);
    expect(
      createHash("sha256")
        .update(`${familyLexicon.words.join("\n")}\n`)
        .digest("hex"),
    ).toBe("2121ea84c411851c7f3239c27b0832a50c69ad483de83bca386beb973eeaee58");
    expect(resolveLexicon(familyLexicon)).toBe(familyLexicon);
    expect(lexiconDetails(familyLexicon)).toMatchObject({
      family: true,
      count: 176974,
    });
  });
  it("uses the complete pinned website snapshot without silently unioning OSPD5", () => {
    expect(websiteLexicon.words).toHaveLength(176844);
    expect(new Set(websiteLexicon.words).size).toBe(176844);
    expect(
      websiteLexicon.words.every((word) => /^[A-Z]{2,15}$/.test(word)),
    ).toBe(true);
    expect(
      createHash("sha256")
        .update(`${websiteLexicon.words.join("\n")}\n`)
        .digest("hex"),
    ).toBe("446ea664837d752bba96d451b526d2fafc7050b63775e5ad17f6eaebdcce2c5b");
    expect(websiteLexicon.has("UNSETTLING")).toBe(false);
    expect(websiteLexicon.has("NOTELETS")).toBe(false);
    expect(Object.isFrozen(websiteLexicon)).toBe(true);
    expect(Object.isFrozen(websiteLexicon.words)).toBe(true);
  });

  it("retains the unchanged legacy registry entry and exact reference identity", () => {
    expect(
      resolveLexicon({
        id: "development-examples",
        edition: "1",
        status: "test",
      }),
    ).toBe(testLexicon);
    expect(testLexicon.words).toHaveLength(500);
    expect(resolveLexicon(websiteLexicon)).toBe(websiteLexicon);
    expect(defaultLexicon.status).toBe("ready");
    expect(familyLexicon.status).toBe("test");
    expect(resolveLexicon(familyLexicon)).toBe(familyLexicon);
    expect(resolveLexicon(releasedFamilyLexicon)).toBe(releasedFamilyLexicon);
    expect(() =>
      resolveLexicon({ ...familyLexicon, status: "ready" }),
    ).toThrow();
    expect(lexiconDetails(testLexicon).legacy).toBe(true);
    expect(lexiconDetails(websiteLexicon)).toMatchObject({
      legacy: false,
      count: 176844,
    });
  });

  it.each([
    null,
    undefined,
    {},
    [],
    { id: "unknown", edition: websiteLexicon.edition, status: "test" },
    { id: websiteLexicon.id, edition: "OSPD7", status: "test" },
    { id: websiteLexicon.id, edition: websiteLexicon.edition, status: "ready" },
    { id: websiteLexicon.id },
  ])(
    "rejects unavailable or altered references without fallback: %j",
    (reference) => {
      expect(() => resolveLexicon(reference)).toThrow(
        /exact word-list version is unavailable/,
      );
    },
  );

  it("uses the same new vocabulary for scoring and live cross-word feedback", () => {
    const placements: Placement[] = [
      { row: 7, col: 7, tile: { letter: "E", blank: false } },
      { row: 7, col: 8, tile: { letter: "W", blank: false } },
    ];
    expect(websiteLexicon.has("EW")).toBe(true);
    expect(testLexicon.has("EW")).toBe(false);
    expect(scoreMove(createBoard(), placements, websiteLexicon)).toMatchObject({
      ok: true,
      score: 10,
    });
    expect(scoreMove(createBoard(), placements, testLexicon).ok).toBe(false);
    expect(
      getFormedWords(createBoard(), placements, websiteLexicon),
    ).toMatchObject([{ word: "EW", valid: true }]);
    expect(
      getFormedWords(createBoard(), placements, testLexicon),
    ).toMatchObject([{ word: "EW", valid: false }]);
  });
});
