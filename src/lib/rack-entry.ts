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
