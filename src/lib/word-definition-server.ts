import "server-only";
import { normalizeOfficialWord } from "./official-word";
import { definitionFromEntries } from "./word-definition";

export async function lookupLocalDefinition(query: string) {
  const word = normalizeOfficialWord(query);
  // Next keeps this asset in a server chunk; it is loaded only for word details.
  const entries = (await import("./generated/ospd5-definitions.json")).default;
  return definitionFromEntries(word, entries);
}
