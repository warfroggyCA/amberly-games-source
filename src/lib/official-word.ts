/** Word queries are physical English Scrabble letters, never URLs or arbitrary text. */
export function normalizeOfficialWord(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value.length > 15 ||
    /[^a-zA-Z]/.test(value)
  )
    throw new Error("Enter a word of 2 to 15 English letters.");
  return value.toUpperCase();
}
export const officialWordUrl = (word: string) =>
  `https://scrabble.merriam.com/finder/${word.toLowerCase()}`;
export interface OfficialWordResult {
  word: string;
  playable: boolean;
  source: "merriam-webster";
  sourceUrl: string;
  verifiedAt: string;
}
export function isOfficialWordResult(
  value: unknown,
  word: string,
): value is OfficialWordResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<OfficialWordResult>;
  return (
    candidate.word === word &&
    typeof candidate.playable === "boolean" &&
    candidate.source === "merriam-webster" &&
    candidate.sourceUrl === officialWordUrl(word) &&
    typeof candidate.verifiedAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
      candidate.verifiedAt,
    ) &&
    Number.isFinite(Date.parse(candidate.verifiedAt)) &&
    new Date(candidate.verifiedAt).toISOString() === candidate.verifiedAt
  );
}
