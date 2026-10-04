import type { GameState } from "../domain/game";
import { getTileSupply } from "../domain/game";
import { parseRackEntry } from "./rack-entry";

/** Physical blanks consume '?' even when their board face represents a letter. */
export function unassignedRackTiles(
  game: GameState,
  input: Record<string, string>,
) {
  const supply = getTileSupply(game);
  const remaining = { ...supply } as Record<string, number>;
  const unknown = () => ({
    ok: false as const,
    reason:
      "The recorded tile inventory needs checking before remaining letters can be shown.",
  });
  if (
    !Number.isSafeInteger(game.expectedBagCount) ||
    game.expectedBagCount < 0 ||
    Object.values(remaining).some((n) => !Number.isSafeInteger(n) || n < 0)
  )
    return unknown();
  for (const tile of game.board.flat())
    if (tile) {
      const key = tile.blank ? "?" : tile.letter;
      if (!(key in remaining) || --remaining[key] < 0) return unknown();
    }
  const total = Object.values(remaining).reduce((a, b) => a + b, 0);
  const expected = game.order.map((id) => game.expectedRackCounts[id]);
  if (
    expected.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    total !== game.expectedBagCount + expected.reduce((a, b) => a + b, 0)
  )
    return unknown();
  let allocated = 0;
  for (const id of game.order) {
    const parsed = parseRackEntry(input[id] ?? "");
    if (!parsed.ok)
      return {
        ok: false as const,
        reason:
          "Correct the rack entry to show unassigned tiles. Use A–Z and ? for a blank.",
      };
    if (parsed.value.length > game.expectedRackCounts[id])
      return {
        ok: false as const,
        reason:
          "A rack has more tiles than its recorded count. Correct the letters or check counts.",
      };
    for (const key of parsed.value) {
      if (!(key in remaining) || --remaining[key] < 0)
        return {
          ok: false as const,
          reason:
            "The rack entries use more of a tile than remains. Correct the letters or check counts.",
        };
      allocated++;
    }
  }
  return {
    ok: true as const,
    remaining,
    total,
    allocated,
    unassigned: total - allocated,
    allRacks:
      game.expectedBagCount === 0 && !!game.pendingEnd && !game.assistance,
  };
}
