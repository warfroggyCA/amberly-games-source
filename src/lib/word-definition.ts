import { normalizeOfficialWord } from "./official-word";

export const DEFINITION_SOURCE = "ospd5-2014-local" as const;
export const DEFINITION_SOURCE_LABEL = "OSPD5 (2014) · local reference";
export interface WordDefinitionResult {
  word: string;
  definition: string | null;
  related: Array<{ word: string; definition: string }>;
  source: typeof DEFINITION_SOURCE;
}
const parts: Record<string, string> = {
  n: "noun",
  v: "verb",
  adj: "adjective",
  adv: "adverb",
  interj: "interjection",
  prep: "preposition",
  pron: "pronoun",
  conj: "conjunction",
  indefinite_article: "indefinite article",
  definite_article: "definite article",
};

/** Decode this source's reference notation as text, never as HTML. */
export function formatOspdDefinition(raw: string): string {
  return raw
    .replace(
      /<([a-z]+)=([a-z_]+)>/gi,
      (_, word: string, part: string) =>
        `See ${word.toUpperCase()} (${parts[part] ?? part})`,
    )
    .replace(/\{([a-z]+)=([a-z_]+)\}/gi, (_, word: string) => word)
    .replace(
      /\[([a-z_]+)[^\]]*\]/g,
      (_, part: string) => `(${parts[part] ?? part})`,
    )
    .replace(/\(([^()]+)\)(?:\s+\(\1\))+/g, "($1)")
    .replace(/\s+/g, " ")
    .trim();
}

export function definitionFromEntries(
  query: string,
  entries: Readonly<Record<string, string>>,
): WordDefinitionResult {
  const word = normalizeOfficialWord(query);
  const entry = Object.hasOwn(entries, word) ? entries[word] : undefined;
  const result: WordDefinitionResult = {
    word,
    definition: entry ? formatOspdDefinition(entry) : null,
    related: [],
    source: DEFINITION_SOURCE,
  };
  if (!entry) return result;
  const seen = new Set([word]);
  // References explain inflections and synonyms without inventing their meaning.
  // Bound traversal and skip cycles even if a future source contains bad links.
  function references(raw: string, depth: number) {
    if (depth >= 3 || result.related.length >= 4) return;
    for (const match of raw.matchAll(/[<{]([a-z]+)=[a-z_]+[>}]/gi)) {
      const target = match[1].toUpperCase();
      if (seen.has(target) || result.related.length >= 4) continue;
      seen.add(target);
      const related = Object.hasOwn(entries, target)
        ? entries[target]
        : undefined;
      if (!related) continue;
      result.related.push({
        word: target,
        definition: formatOspdDefinition(related),
      });
      references(related, depth + 1);
    }
  }
  references(entry, 0);
  return result;
}

export function isWordDefinitionResult(
  value: unknown,
  word: string,
): value is WordDefinitionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<WordDefinitionResult>;
  const text = (entry: unknown) =>
    typeof entry === "string" && entry.length > 0 && entry.length <= 2000;
  return (
    candidate.word === word &&
    candidate.source === DEFINITION_SOURCE &&
    (candidate.definition === null || text(candidate.definition)) &&
    Array.isArray(candidate.related) &&
    candidate.related.length <= 4 &&
    (candidate.definition !== null || candidate.related.length === 0) &&
    candidate.related.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.word === "string" &&
        /^[A-Z]{2,15}$/.test(entry.word) &&
        text(entry.definition),
    )
  );
}
