import type { Lexicon } from "./types";

/** Source evidence supplied by the verified lookup workflow; structure alone does not authenticate a local journal. */
export type VerifiedWord = {
  word: string;
  source: "merriam-webster";
  sourceUrl: string;
  verifiedAt: string;
};
export const MAX_VERIFIED_WORDS = 10000;
/** Keep each append-only command within the journal's existing payload bound. */
export const MAX_VERIFICATIONS_PER_COMMAND = 32;

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(
      value,
    );
  if (!parts || parts[0] !== value) return false;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    zone,
  ] = parts;
  const [year, month, day, hour, minute, second] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
  ].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    (!/^[+-]14:/.test(zone) || zone.endsWith(":00")) &&
    Number.isFinite(Date.parse(value))
  );
}
export function isVerifiedWord(value: unknown): value is VerifiedWord {
  try {
    if (value === null || typeof value !== "object") return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const expected = ["word", "source", "sourceUrl", "verifiedAt"];
    if (
      Reflect.ownKeys(value).length !== expected.length ||
      expected.some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return (
          !descriptor ||
          !descriptor.enumerable ||
          !Object.hasOwn(descriptor, "value")
        );
      })
    )
      return false;
    const entry = value as VerifiedWord;
    return (
      typeof entry.word === "string" &&
      entry.word.length >= 2 &&
      entry.word.length <= 15 &&
      !/[^A-Z]/.test(entry.word) &&
      entry.source === "merriam-webster" &&
      entry.sourceUrl ===
        `https://scrabble.merriam.com/finder/${entry.word.toLowerCase()}` &&
      isTimestamp(entry.verifiedAt)
    );
  } catch {
    return false;
  }
}

// Retain only the most recent expansion per frozen base. Replaying many turns with
// the same additions reuses the large enumerable word array and solver trie.
const latest = new WeakMap<Lexicon, { key: string; lexicon: Lexicon }>();
/** Preserve the pinned base metadata and, when supplied, its enumerable word list. */
export function extendLexicon<T extends Lexicon>(
  base: T,
  entries: readonly VerifiedWord[],
): T {
  if (
    !Array.isArray(entries) ||
    Object.getPrototypeOf(entries) !== Array.prototype ||
    entries.length > MAX_VERIFIED_WORDS ||
    Reflect.ownKeys(entries).length !== entries.length + 1
  )
    throw new Error(
      "Publisher confirmations must be a bounded, dense JSON array.",
    );
  for (let index = 0; index < entries.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(entries, index);
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      !isVerifiedWord(descriptor.value)
    )
      throw new Error("A publisher confirmation is malformed.");
  }
  if (!entries.length) return base;
  const added = new Set(entries.map((entry) => entry.word));
  if (added.size !== entries.length)
    throw new Error("Publisher confirmations must contain unique words.");
  const key = [...added].sort().join(",");
  const words = (base as Lexicon & { words?: readonly string[] }).words;
  const cacheable = Object.isFrozen(base) && (!words || Object.isFrozen(words));
  const cached = cacheable ? latest.get(base) : undefined;
  if (cached?.key === key) return cached.lexicon as T;
  const extended = Object.freeze({
    ...base,
    ...(Array.isArray(words)
      ? { words: Object.freeze([...new Set([...words, ...added])]) }
      : {}),
    has: (word: string) => added.has(word) || base.has(word),
  }) as T;
  if (cacheable) latest.set(base, { key, lexicon: extended });
  return extended;
}
