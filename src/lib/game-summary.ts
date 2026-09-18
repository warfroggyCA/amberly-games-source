export type GameSummary = {
  gameType: "scrabble" | "crokinole";
  id: string;
  createdAt: string;
  status: string;
  participants: { id: string; name: string; playerIds?: string[] }[];
  totals: Record<string, number>;
  winnerIds: string[];
  mode: "confirmed" | "practice";
  scorerUserId: string;
  revision: number;
};
export type GameSummaryPage = {
  games: GameSummary[];
  nextCursor: string | null;
};

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const safeId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value);
export function isGameSummaryPage(value: unknown): value is GameSummaryPage {
  if (
    !record(value) ||
    !Array.isArray(value.games) ||
    value.games.length > 30 ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === "string" && value.nextCursor.length <= 600)
    )
  )
    return false;
  const seen = new Set<string>();
  return value.games.every((g) => {
    if (
      !record(g) ||
      !["scrabble", "crokinole"].includes(String(g.gameType)) ||
      !safeId(g.id) ||
      !safeId(g.scorerUserId) ||
      !Number.isSafeInteger(g.revision) ||
      Number(g.revision) < 0 ||
      !["confirmed", "practice"].includes(String(g.mode)) ||
      typeof g.createdAt !== "string" ||
      g.createdAt.length > 80 ||
      !Number.isFinite(Date.parse(g.createdAt)) ||
      typeof g.status !== "string" ||
      !(
        g.gameType === "scrabble"
          ? ["active", "paused", "finalized"]
          : ["active", "completed", "ended_early"]
      ).includes(g.status) ||
      !Array.isArray(g.participants) ||
      g.participants.length < (g.gameType === "scrabble" ? 1 : 2) ||
      g.participants.length > 4 ||
      !record(g.totals) ||
      !Array.isArray(g.winnerIds)
    )
      return false;
    const key = g.gameType + ":" + g.id;
    if (seen.has(key)) return false;
    seen.add(key);
    const ids = new Set<string>();
    for (const p of g.participants) {
      if (
        !record(p) ||
        !safeId(p.id) ||
        ids.has(p.id) ||
        typeof p.name !== "string" ||
        !p.name.trim() ||
        p.name.length > 325 ||
        !(
          p.playerIds === undefined ||
          (Array.isArray(p.playerIds) &&
            p.playerIds.length >= 1 &&
            p.playerIds.length <= 2 &&
            p.playerIds.every(safeId) &&
            new Set(p.playerIds).size === p.playerIds.length)
        )
      )
        return false;
      ids.add(p.id);
    }
    const totals = g.totals;
    return (
      Object.keys(totals).length === ids.size &&
      Object.keys(totals).every(
        (id) =>
          ids.has(id) &&
          Number.isSafeInteger(totals[id]) &&
          (g.gameType === "scrabble" || Number(totals[id]) >= 0),
      ) &&
      g.winnerIds.every((id) => typeof id === "string" && ids.has(id)) &&
      new Set(g.winnerIds).size === g.winnerIds.length
    );
  });
}
