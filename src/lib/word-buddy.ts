import type { GameState } from "../domain/game";
import { getTileSupply } from "../domain/game";
import { scoreMove } from "../domain/scoring";
import { extendLexicon } from "../domain/verified-words";
import { resolveLexicon } from "./lexicons";
import type { Draft } from "./preview-store";

/** Promotion is only a normal, validated draft for the authorized scorer. */
export function canPromoteWordBuddy(
  game: GameState,
  original: GameState,
  draft: Draft,
  existing: Draft | undefined,
  authorized: boolean,
): boolean {
  if (
    !authorized ||
    !game.definition.wordBuddy ||
    game.id !== original.id ||
    game.revision !== original.revision ||
    game.currentPlayerId !== original.currentPlayerId ||
    game.status !== "active" ||
    game.pendingEnd ||
    game.assistance ||
    draft.revision !== game.revision ||
    existing?.placements.length
  )
    return false;
  return scoreMove(
    game.board,
    draft.placements,
    extendLexicon(resolveLexicon(game.lexicon), game.verifiedWords ?? []),
    game.expectedRackCounts[game.currentPlayerId],
    getTileSupply(game),
  ).ok;
}
