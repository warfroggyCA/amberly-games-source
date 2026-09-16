import { hasCustomTileSupply, hasVerifiedWords } from "./game";
import type { GameState, GameTurn, GameWord } from "./game";

export const RECORD_DEFINITION_VERSION = "family-records-v1";
export type RecordScope = "family" | "practice" | "test";
export type RecordEvidence = {
  gameId: string;
  turnId: string;
  playerId: string;
  round: number;
  score: number;
};
export type WordEvidence = RecordEvidence & {
  word: string;
  row: number;
  col: number;
  direction: "across" | "down";
};
export type ClutchAward = RecordEvidence & { deficitOvercome: number };
export type ComebackAward = {
  gameId: string;
  playerId: string;
  deficit: number;
  round: number;
};
export type RecordFilters = {
  scope?: RecordScope;
  participantCount?: number;
  lexiconId?: string;
  lexiconEdition?: string;
};

export function recordScope(game: GameState): RecordScope {
  if (game.lexicon.status !== "ready") return "test";
  return game.mode === "solo" ? "practice" : "family";
}
export function competitiveResultEligible(game: GameState): boolean {
  // Recompute from source facts; never trust a saved or client-supplied eligibility flag.
  return (
    !hasCustomTileSupply(game) &&
    !hasVerifiedWords(game) &&
    game.status === "finalized" &&
    !!game.result &&
    game.mode === "multiplayer" &&
    game.lexicon.status === "ready" &&
    !game.assistance &&
    !game.result.assisted &&
    ["natural", "blocked"].includes(game.result.reason)
  );
}
export function humanTurnEligible(
  game: GameState,
  turn: GameTurn,
  scope: RecordScope = "family",
): boolean {
  if (
    hasCustomTileSupply(game) ||
    game.status !== "finalized" ||
    !game.result ||
    recordScope(game) !== scope ||
    turn.source !== "human"
  )
    return false;
  if (!game.turns.some((effective) => effective.id === turn.id)) return false;
  // The immutable cutoff is decisive even if a caller tampers with the visible turn label.
  if (game.assistance && !game.assistance.humanTurnIds.includes(turn.id))
    return false;
  return true;
}
function soleLeader(scores: Record<string, number>, playerId: string): boolean {
  return Object.entries(scores).every(
    ([id, score]) => id === playerId || scores[playerId] > score,
  );
}
function evidence(game: GameState, turn: GameTurn): RecordEvidence {
  return {
    gameId: game.id,
    turnId: turn.id,
    playerId: turn.playerId,
    round: turn.round,
    score: turn.score,
  };
}
function wordEvidence(
  game: GameState,
  turn: GameTurn,
  word: GameWord,
): WordEvidence {
  return { ...evidence(game, turn), ...word };
}
/** Awards use recorded score changes, not guessed racks, strategic equity, or win probabilities. */
export function deriveGameAwards(game: GameState): {
  clutch: ClutchAward[];
  comeback: ComebackAward | null;
} {
  if (!competitiveResultEligible(game) || game.result!.winnerIds.length !== 1)
    return { clutch: [], comeback: null };
  const winner = game.result!.winnerIds[0];
  const latePlayedRounds = new Set(
    [
      ...new Set(
        game.turns
          .filter((turn) => turn.type === "play")
          .map((turn) => turn.round),
      ),
    ].slice(-2),
  );
  const clutch: ClutchAward[] = [];
  let comeback: ComebackAward | null = null;
  const initial = Object.fromEntries(game.order.map((id) => [id, 0]));
  for (let index = 0; index < game.turns.length; index += 1) {
    const turn = game.turns[index];
    const before = index === 0 ? initial : game.turns[index - 1].runningScores;
    if (
      turn.playerId === winner &&
      turn.type === "play" &&
      turn.source === "human" &&
      latePlayedRounds.has(turn.round) &&
      !soleLeader(before, winner) &&
      soleLeader(turn.runningScores, winner) &&
      game.turns
        .slice(index + 1)
        .every((later) => soleLeader(later.runningScores, winner)) &&
      soleLeader(game.result!.scores, winner)
    ) {
      clutch.push({
        ...evidence(game, turn),
        deficitOvercome: Math.max(...Object.values(before)) - before[winner],
      });
    }
    if ((index + 1) % game.order.length === 0) {
      const deficit =
        Math.max(...Object.values(turn.runningScores)) -
        turn.runningScores[winner];
      if (deficit > 0 && (!comeback || deficit > comeback.deficit))
        comeback = {
          gameId: game.id,
          playerId: winner,
          deficit,
          round: turn.round,
        };
    }
  }
  clutch.sort(
    (a, b) => b.deficitOvercome - a.deficitOvercome || b.score - a.score,
  );
  return { clutch, comeback };
}
function highest<T extends { score: number }>(items: T[]): T[] {
  if (!items.length) return [];
  const max = Math.max(...items.map((item) => item.score));
  return items.filter((item) => item.score === max);
}
/** Inputs may contain old snapshots of a game. Only its newest revision contributes once. */
function latestGames(games: readonly GameState[]): GameState[] {
  const latest = new Map<string, GameState>();
  for (const game of games) {
    const prior = latest.get(game.id);
    if (!prior || game.revision > prior.revision) latest.set(game.id, game);
  }
  return [...latest.values()].sort(
    (a, b) =>
      Date.parse(a.definition.createdAt) - Date.parse(b.definition.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
export function buildPlayerRecords(
  games: readonly GameState[],
  playerId: string,
  filters: RecordFilters = {},
) {
  const scope = filters.scope ?? "family";
  const selected = latestGames(games).filter(
    (game) =>
      game.order.includes(playerId) &&
      recordScope(game) === scope &&
      (filters.participantCount === undefined ||
        game.players.length === filters.participantCount) &&
      (filters.lexiconId === undefined ||
        game.lexicon.id === filters.lexiconId) &&
      (filters.lexiconEdition === undefined ||
        game.lexicon.edition === filters.lexiconEdition),
  );
  const humanTurns = selected.flatMap((game) =>
    game.turns
      .filter(
        (turn) =>
          turn.playerId === playerId && humanTurnEligible(game, turn, scope),
      )
      .map((turn) => ({ game, turn })),
  );
  const words = humanTurns.flatMap(({ game, turn }) =>
    turn.words.map((word) => wordEvidence(game, turn, word)),
  );
  const placements = humanTurns.filter(({ turn }) => turn.type === "play");
  // Do not silently pool different rules/lexicons/player counts into a competitive average.
  const competitiveGroups: Record<
    string,
    {
      rulesVersion: string;
      lexiconId: string;
      lexiconEdition: string;
      participantCount: number;
      games: number;
      wins: number;
      ties: number;
      totalFinalScore: number;
      averageFinalScore: number;
      winRate: number;
      highestGame: { gameId: string; score: number }[];
      currentWinStreak: number;
      longestWinStreak: number;
    }
  > = {};
  const headToHead: Record<
    string,
    { games: number; wins: number; ties: number }
  > = Object.create(null);
  const allClutch: ClutchAward[] = [];
  const allComebacks: ComebackAward[] = [];
  for (const game of selected.filter(competitiveResultEligible)) {
    const key = JSON.stringify([
      game.version,
      game.lexicon.id,
      game.lexicon.edition,
      game.players.length,
    ]);
    const group = (competitiveGroups[key] ??= {
      rulesVersion: game.version,
      lexiconId: game.lexicon.id,
      lexiconEdition: game.lexicon.edition,
      participantCount: game.players.length,
      games: 0,
      wins: 0,
      ties: 0,
      totalFinalScore: 0,
      averageFinalScore: 0,
      winRate: 0,
      highestGame: [],
      currentWinStreak: 0,
      longestWinStreak: 0,
    });
    const result = game.result!;
    const won =
      result.winnerIds.length === 1 && result.winnerIds[0] === playerId;
    const tied =
      result.winnerIds.length > 1 && result.winnerIds.includes(playerId);
    group.games += 1;
    group.wins += Number(won);
    group.ties += Number(tied);
    group.totalFinalScore += result.scores[playerId];
    group.averageFinalScore = group.totalFinalScore / group.games;
    group.winRate = group.wins / group.games;
    group.highestGame = highest([
      ...group.highestGame,
      { gameId: game.id, score: result.scores[playerId] },
    ]);
    group.currentWinStreak = won ? group.currentWinStreak + 1 : 0;
    group.longestWinStreak = Math.max(
      group.longestWinStreak,
      group.currentWinStreak,
    );
    if (game.players.length === 2) {
      const opponent = game.order.find((id) => id !== playerId)!;
      const record = (headToHead[opponent] ??= { games: 0, wins: 0, ties: 0 });
      record.games += 1;
      record.wins += Number(won);
      record.ties += Number(tied);
    }
    const awards = deriveGameAwards(game);
    allClutch.push(
      ...awards.clutch.filter((award) => award.playerId === playerId),
    );
    if (awards.comeback?.playerId === playerId)
      allComebacks.push(awards.comeback);
  }
  const maxDeficit = allClutch.length
    ? Math.max(...allClutch.map((award) => award.deficitOvercome))
    : null;
  const bestClutch = highest(
    allClutch.filter((award) => award.deficitOvercome === maxDeficit),
  );
  const maxComeback = allComebacks.length
    ? Math.max(...allComebacks.map((award) => award.deficit))
    : null;
  return {
    definitionVersion: RECORD_DEFINITION_VERSION,
    scope,
    playerId,
    highestWords: highest(words),
    highestTurns: highest(
      placements.map(({ game, turn }) => evidence(game, turn)),
    ),
    wordsFormed: words.length,
    uniqueWords: [...new Set(words.map((word) => word.word))].sort(),
    bingoCount: placements.filter(({ turn }) => turn.bingo).length,
    humanTurns: humanTurns.length,
    humanPoints: humanTurns.reduce((sum, { turn }) => sum + turn.score, 0),
    pointsPerTurn: humanTurns.length
      ? humanTurns.reduce((sum, { turn }) => sum + turn.score, 0) /
        humanTurns.length
      : null,
    pointsPerTurnContext:
      "Finalized human turns in the selected scope, including early and pre-assistance turns; passes and exchanges count.",
    competitiveGroups: Object.values(competitiveGroups),
    headToHead,
    bestClutch,
    biggestComebacks: allComebacks.filter(
      (award) => award.deficit === maxComeback,
    ),
  };
}
