export type ScrabbleMode = "all" | "classic" | "word-buddy";
export function matchesScrabbleMode(
  wordBuddy: boolean | undefined,
  mode: ScrabbleMode,
) {
  return mode === "all" || (wordBuddy === true) === (mode === "word-buddy");
}
