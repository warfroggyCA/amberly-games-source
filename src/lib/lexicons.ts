import type { EnumerableLexicon } from "../domain/solver";
import type { Lexicon } from "../domain/types";
import websiteWords from "./generated/merriam-2026-09-14.json";
import familyAdditions from "./generated/family-additions-2026-09-14.json";
import { testLexicon } from "./test-lexicon";

export type LexiconReference = Pick<Lexicon, "id" | "edition" | "status">;
const words = Object.freeze(websiteWords);
const membership = new Set(words);
if (words.length !== 176844 || membership.size !== words.length)
  throw new Error(
    "The bundled Merriam-Webster snapshot is incomplete. Restore the pinned word asset.",
  );

export const websiteLexicon: EnumerableLexicon = Object.freeze({
  id: "mw-scrabble-web-20260914-446ea664837d",
  edition: "Website snapshot 2026-09-14 (edition unconfirmed)",
  // The local app remains a preview. A larger source must not promote results
  // into competitive records merely because the asset has changed.
  status: "test",
  words,
  has: (word: string) => membership.has(word),
});
export const familyWordAdditions = Object.freeze(familyAdditions);
const familyWords = Object.freeze(
  [...new Set([...words, ...familyWordAdditions])].sort(),
);
const familyMembership = new Set(familyWords);
if (familyWords.length !== 176974 || familyWordAdditions.length !== 130)
  throw new Error("The approved family word-list version is incomplete.");
export const familyLexicon: EnumerableLexicon = Object.freeze({
  id: "family-union-20260914-2121ea84c411",
  edition: "Family union 2026-09-14 (website + OSPD5)",
  status: "test",
  words: familyWords,
  has: (word: string) => familyMembership.has(word),
});
// New identity for record-eligible games. Never mutate a historical reference.
export const releasedFamilyLexicon: EnumerableLexicon = Object.freeze({
  ...familyLexicon,
  id: "amberly-family-v1-2121ea84c411",
  edition: "Amberly family reference v1 (website 2026-09-14 + OSPD5)",
  status: "ready",
});
export const defaultLexicon = releasedFamilyLexicon;

export function resolveLexicon(reference: unknown): EnumerableLexicon {
  if (reference && typeof reference === "object" && !Array.isArray(reference)) {
    const candidate = reference as Partial<LexiconReference>;
    for (const lexicon of [
      testLexicon,
      websiteLexicon,
      familyLexicon,
      releasedFamilyLexicon,
    ]) {
      if (
        candidate.id === lexicon.id &&
        candidate.edition === lexicon.edition &&
        candidate.status === lexicon.status
      )
        return lexicon;
    }
  }
  throw new Error(
    "This game's exact word-list version is unavailable. Its history has been retained; no different dictionary was substituted.",
  );
}

export function lexiconDetails(reference: unknown) {
  const lexicon = resolveLexicon(reference);
  const legacy = lexicon === testLexicon;
  const family = lexicon === familyLexicon || lexicon === releasedFamilyLexicon;
  return {
    label: legacy
      ? "Development example words"
      : family
        ? "Family word list · Merriam-Webster + OSPD5"
        : "Merriam-Webster Scrabble website word list",
    shortLabel: legacy
      ? "500 example words"
      : family
        ? "Family word list"
        : "Merriam-Webster website snapshot",
    historyLabel: legacy
      ? "Test words"
      : family
        ? lexicon === releasedFamilyLexicon
          ? "Amberly reference v1"
          : "Family list · Sep 14, 2026"
        : "MW website · Sep 14, 2026",
    count: lexicon.words.length,
    legacy,
    family,
    description: legacy
      ? "This saved game keeps the original 500 handwritten examples as its base. Live verified additions are recorded separately; earlier scores and history stay unchanged."
      : family
        ? "Combines all 176,844 words collected from the Merriam-Webster Scrabble website on September 14, 2026 with all 130 additional OSPD5 entries. All 500 original example words are included. This is your custom family reference; the website's exact publisher edition is unconfirmed."
        : "Collected September 14, 2026. The exact publisher edition is unconfirmed. This is the website's word list, without additions from the older OSPD5 download.",
    sha256: legacy
      ? null
      : family
        ? "2121ea84c411851c7f3239c27b0832a50c69ad483de83bca386beb973eeaee58"
        : "446ea664837d752bba96d451b526d2fafc7050b63775e5ad17f6eaebdcce2c5b",
  };
}
