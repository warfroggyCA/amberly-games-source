import type { LeadCounts } from "../domain/lead-counts";

export type LeadStanding = {
  playerId: string;
  completedGames: number;
  eligibleGames: number;
  eligibleTurns: number;
  leads: number;
  regains: number;
  turnsLed: number;
  tiedTurns: number;
  longest: number | null;
  average: number | null;
  turnShare: number | null;
};
export type LeadStandings = {
  completedGames: number;
  eligibleGames: number;
  unavailableGames: number;
  excludedGames: number;
  pendingGames: number;
  rows: LeadStanding[];
};
export type LeadAssessment = {
  gameId: string;
  revision: number;
  playerIds: string[];
  outcome: "eligible" | "unavailable" | "excluded" | "pending";
  counts?: Extract<LeadCounts, { available: true }>;
};

/** Complete authorized snapshot, not incremental additions to cached totals. */
export function aggregateLeadStandings(input: LeadAssessment[]): LeadStandings {
  const games = new Map<string, LeadAssessment>();
  for (const item of input) {
    const old = games.get(item.gameId);
    if (!old || item.revision > old.revision) games.set(item.gameId, item);
    else if (
      item.revision === old.revision &&
      JSON.stringify(item) !== JSON.stringify(old)
    )
      games.set(item.gameId, {
        ...old,
        outcome: "unavailable",
        counts: undefined,
      });
  }
  const result: LeadStandings = {
    completedGames: games.size,
    eligibleGames: 0,
    unavailableGames: 0,
    excludedGames: 0,
    pendingGames: 0,
    rows: [],
  };
  const players = new Map<string, LeadStanding>();
  for (const item of games.values()) {
    const counts = item.outcome === "eligible" ? item.counts : undefined;
    if (counts) result.eligibleGames++;
    else if (item.outcome === "pending") result.pendingGames++;
    else if (item.outcome === "excluded") result.excludedGames++;
    else result.unavailableGames++;
    for (const playerId of new Set(item.playerIds)) {
      const row = players.get(playerId) ?? {
        playerId,
        completedGames: 0,
        eligibleGames: 0,
        eligibleTurns: 0,
        leads: 0,
        regains: 0,
        turnsLed: 0,
        tiedTurns: 0,
        longest: null,
        average: null,
        turnShare: null,
      };
      row.completedGames++;
      const player = counts?.players.find((p) => p.playerId === playerId);
      if (counts && player) {
        row.eligibleGames++;
        // Every participant was present for all checkpoints, not just their own turns.
        row.eligibleTurns += counts.completedTurns;
        row.leads += player.entries;
        row.regains += player.regains;
        row.turnsLed += player.turnsLed;
        row.tiedTurns += player.coLeadingTurns;
        if (player.longest !== null)
          row.longest = Math.max(row.longest ?? 0, player.longest);
      }
      players.set(playerId, row);
    }
  }
  result.rows = [...players.values()]
    .sort((a, b) => a.playerId.localeCompare(b.playerId))
    .map((row) => ({
      ...row,
      average: row.leads ? row.turnsLed / row.leads : null,
      turnShare: row.eligibleTurns ? row.turnsLed / row.eligibleTurns : null,
    }));
  return result;
}

export function isLeadStandings(value: unknown): value is LeadStandings {
  if (!value || typeof value !== "object") return false;
  const v = value as LeadStandings;
  const count = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0;
  return (
    [
      v.completedGames,
      v.eligibleGames,
      v.unavailableGames,
      v.excludedGames,
      v.pendingGames,
    ].every(count) &&
    v.completedGames ===
      v.eligibleGames + v.unavailableGames + v.excludedGames + v.pendingGames &&
    Array.isArray(v.rows) &&
    new Set(v.rows.map((r) => r?.playerId)).size === v.rows.length &&
    v.rows.every(
      (r) =>
        r &&
        typeof r.playerId === "string" &&
        [
          r.completedGames,
          r.eligibleGames,
          r.eligibleTurns,
          r.leads,
          r.regains,
          r.turnsLed,
          r.tiedTurns,
        ].every(count) &&
        r.eligibleGames <= r.completedGames &&
        r.turnsLed + r.tiedTurns <= r.eligibleTurns &&
        r.regains <= r.leads &&
        (r.longest === null || (count(r.longest) && r.longest <= r.turnsLed)) &&
        r.average === (r.leads ? r.turnsLed / r.leads : null) &&
        r.turnShare === (r.eligibleTurns ? r.turnsLed / r.eligibleTurns : null),
    )
  );
}
