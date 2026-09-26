export type Standing = {
  playerId: string;
  gameType: "scrabble" | "crokinole";
  played: number;
  wins: number;
  ties: number;
};
export function isStandings(value: unknown): value is Standing[] {
  return (
    Array.isArray(value) &&
    value.every(
      (r) =>
        r &&
        typeof r === "object" &&
        typeof r.playerId === "string" &&
        ["scrabble", "crokinole"].includes(r.gameType) &&
        [r.played, r.wins, r.ties].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ) &&
        r.wins + r.ties <= r.played,
    )
  );
}

export type StandingsView = "overall" | Standing["gameType"];
export type RankedStanding = Omit<Standing, "gameType"> & {
  rank: number;
  winRate: number;
  byGame: Partial<
    Record<Standing["gameType"], Omit<Standing, "playerId" | "gameType">>
  >;
};

/** Full-history results, with shared competition ranks determined by wins. */
export function rankStandings(
  rows: Standing[],
  view: StandingsView,
): RankedStanding[] {
  const totals = new Map<string, RankedStanding>();
  for (const row of rows) {
    if (view !== "overall" && row.gameType !== view) continue;
    const entry = totals.get(row.playerId) ?? {
      playerId: row.playerId,
      played: 0,
      wins: 0,
      ties: 0,
      rank: 0,
      winRate: 0,
      byGame: {},
    };
    entry.played += row.played;
    entry.wins += row.wins;
    entry.ties += row.ties;
    const game = entry.byGame[row.gameType] ?? { played: 0, wins: 0, ties: 0 };
    game.played += row.played;
    game.wins += row.wins;
    game.ties += row.ties;
    entry.byGame[row.gameType] = game;
    totals.set(row.playerId, entry);
  }
  const ranked = [...totals.values()].sort(
    (a, b) => b.wins - a.wins || a.playerId.localeCompare(b.playerId),
  );
  for (let index = 0; index < ranked.length; index++) {
    const entry = ranked[index];
    entry.rank =
      index && entry.wins === ranked[index - 1].wins
        ? ranked[index - 1].rank
        : index + 1;
    entry.winRate = entry.played ? entry.wins / entry.played : 0;
  }
  return ranked;
}
