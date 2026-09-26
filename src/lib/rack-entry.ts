export type RackEntryResult =
  { ok: true; value: string } | { ok: false; error: string };

/** Validate the original characters before case conversion; ß must never become two S tiles. */
export function parseRackEntry(input: string, maxTiles = 7): RackEntryResult {
  if (!Number.isInteger(maxTiles) || maxTiles < 0 || maxTiles > 7)
    return {
      ok: false,
      error: "The rack limit must be between zero and seven tiles.",
    };
  if (typeof input !== "string" || !/^[A-Za-z? \t\r\n]*$/.test(input)) {
    return {
      ok: false,
      error:
        "Use A–Z for letters and ? for a blank. Spaces between tiles are fine.",
    };
  }
  const value = input.replace(/[ \t\r\n]/g, "").toUpperCase();
  if (value.length > maxTiles)
    return {
      ok: false,
      error: `A rack can hold at most ${maxTiles} ${maxTiles === 1 ? "tile" : "tiles"}. Nothing was added.`,
    };
  return { ok: true, value };
}

/** Capacity for one rack after subtracting the board and every other rack. */
export function availableRackTiles(
  board: import("../domain/types").Board,
  supply: Readonly<Record<string, number>>,
  otherRacks: readonly string[],
): Record<string, number> {
  const available = { ...supply };
  for (const tile of board.flat()) {
    if (!tile) continue;
    const letter = tile.blank ? "?" : tile.letter;
    available[letter] = Math.max(0, (available[letter] ?? 0) - 1);
  }
  for (const rack of otherRacks)
    for (const letter of rack.toUpperCase().replace(/\s/g, ""))
      available[letter] = Math.max(0, (available[letter] ?? 0) - 1);
  return available;
}
export function rackAvailabilityError(
  value: string,
  available: Readonly<Record<string, number>>,
): string | null {
  const used: Record<string, number> = {};
  for (const letter of value) {
    used[letter] = (used[letter] ?? 0) + 1;
    const count = available[letter] ?? 0;
    if (used[letter] > count)
      return `Only ${count} ${letter === "?" ? "blank" : letter} ${count === 1 ? "tile is" : "tiles are"} available for this rack after accounting for the board and other racks. Nothing was added.`;
  }
  return null;
}
