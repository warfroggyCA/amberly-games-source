import { browserId } from "./browser-id";
import { applyCommand, MAX_GAME_EVENTS, type GameState } from "../domain/game";
import {
  isVerifiedWord,
  MAX_VERIFICATIONS_PER_COMMAND,
  MAX_VERIFIED_WORDS,
  type VerifiedWord,
} from "../domain/verified-words";
import { resolveLexicon } from "./lexicons";
import type { PreviewData } from "./preview-store";

/** Append additions as journal events; earlier turns keep their original evidence. */
export function syncVerifiedWords(
  game: GameState,
  words: readonly VerifiedWord[],
  required = false,
): GameState {
  if (game.status !== "active" || game.assistance || game.pendingEnd)
    return game;
  const base = resolveLexicon(game.lexicon);
  const additions = words.filter(
    (entry) =>
      !base.has(entry.word) &&
      !game.verifiedWords?.some((saved) => saved.word === entry.word),
  );
  if (!additions.length) return game;
  if (
    game.revision +
      Math.ceil(additions.length / MAX_VERIFICATIONS_PER_COMMAND) >=
      MAX_GAME_EVENTS ||
    additions.length + (game.verifiedWords?.length ?? 0) > MAX_VERIFIED_WORDS
  ) {
    if (required)
      throw new Error(
        "This game has reached its word-history limit. Finalize it before adding words to a new game.",
      );
    return game;
  }
  let next = game;
  for (
    let index = 0;
    index < additions.length;
    index += MAX_VERIFICATIONS_PER_COMMAND
  ) {
    const result = applyCommand(
      next,
      {
        type: "verify-words",
        words: additions.slice(index, index + MAX_VERIFICATIONS_PER_COMMAND),
        id: browserId(),
        expectedRevision: next.revision,
      },
      base,
    );
    if (!result.ok) throw new Error(result.error.message);
    next = result.game;
  }
  return next;
}

export function saveVerifiedWords(
  data: PreviewData,
  entries: readonly VerifiedWord[],
  gameId: string,
): PreviewData {
  if (!entries.every(isVerifiedWord))
    throw new Error(
      "The website verification could not be validated. Nothing was added.",
    );
  const original = data.games.find((game) => game.id === gameId);
  if (!original)
    throw new Error("The game is no longer available. Nothing was added.");
  const merged = new Map(
    (data.verifiedWords ?? []).map((entry) => [entry.word, entry]),
  );
  for (const entry of entries)
    if (!merged.has(entry.word)) merged.set(entry.word, entry);
  const verifiedWords = [...merged.values()];
  const game = syncVerifiedWords(original, verifiedWords, entries.length > 0);
  const drafts = { ...data.drafts };
  if (drafts[gameId])
    drafts[gameId] = { ...drafts[gameId], revision: game.revision };
  return {
    ...data,
    verifiedWords,
    games: data.games.map((saved) => (saved.id === gameId ? game : saved)),
    drafts,
  };
}
