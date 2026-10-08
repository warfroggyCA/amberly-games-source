import type { GameState } from "../domain/game";
import {
  competitiveResultEligible,
  buildPlayerRecords,
} from "../domain/records";
import type { CrokinoleGame } from "../domain/crokinole";
import type { GameAccess } from "./shared-contract";
import type { CrokinoleAccess } from "./crokinole-contract";

export type BookGame = {
  id: string;
  kind: "scrabble" | "crokinole";
  createdAt: string;
  players: { id: string; name: string; score: number; winner: boolean }[];
  eligible: boolean;
  group: string;
  context: string;
  source?: GameState;
};
const clear = (concerns: GameAccess["protests"]) =>
  !concerns.some((p) => !p.resolution || p.resolution.outcome === "upheld");

/** The existing domain owns eligibility. Never infer records from a winner badge. */
export function recordBookGames(
  games: readonly GameState[],
  access: Record<string, GameAccess> = {},
  crokinole: readonly CrokinoleGame[] = [],
  crokinoleAccess: Record<string, CrokinoleAccess> = {},
): BookGame[] {
  const scrabble = new Map<string, GameState>();
  games.forEach((g) => {
    if (!scrabble.has(g.id) || scrabble.get(g.id)!.revision < g.revision)
      scrabble.set(g.id, g);
  });
  const discs = new Map<string, CrokinoleGame>();
  crokinole.forEach((g) => {
    if (
      !discs.has(g.definition.id) ||
      discs.get(g.definition.id)!.revision < g.revision
    )
      discs.set(g.definition.id, g);
  });
  return [
    ...[...scrabble.values()]
      .filter(
        (g) =>
          access[g.id]?.mode === "confirmed" &&
          clear(access[g.id].protests) &&
          g.status === "finalized" &&
          g.result,
      )
      .map((g): BookGame => ({
        id: g.id,
        kind: "scrabble",
        createdAt: g.definition.createdAt,
        players: g.players.map((p) => ({
          id: p.id,
          name: p.name,
          score: g.result!.scores[p.id],
          winner: g.result!.winnerIds.includes(p.id),
        })),
        eligible: competitiveResultEligible(g),
        group: JSON.stringify([
          "scrabble",
          g.version,
          g.lexicon.id,
          g.lexicon.edition,
          g.players.length,
        ]),
        context: `${g.players.length} players · ${g.lexicon.id === "amberly-family-v1-2121ea84c411" ? "Amberly reference v1" : g.lexicon.edition} · ${g.version.replace("family-v", "Family rules ")}`,
        source: g,
      })),
    ...[...discs.values()]
      .filter(
        (g) =>
          crokinoleAccess[g.definition.id]?.mode === "confirmed" &&
          clear(crokinoleAccess[g.definition.id].concerns) &&
          g.status !== "active" &&
          g.result,
      )
      .map((g): BookGame => ({
        id: g.definition.id,
        kind: "crokinole",
        createdAt: g.definition.createdAt,
        players: g.definition.participants.map((p) => ({
          id:
            p.playerIds.length === 1
              ? p.playerIds[0]
              : JSON.stringify([...p.playerIds].sort()),
          name: p.name,
          score: g.totals[p.id],
          winner: g.result!.winnerIds.includes(p.id),
        })),
        eligible: g.status === "completed" && g.definition.mode === "confirmed",
        group: JSON.stringify([
          "crokinole",
          g.definition.rulesVersion,
          g.definition.format,
          g.definition.scoringMode,
          g.definition.endCondition,
          g.definition.participants.length,
        ]),
        context: `${g.definition.format.replaceAll("_", " ")} · ${g.definition.scoringMode.replaceAll("_", " ")} · ${g.definition.endCondition.type === "target" ? `first to ${g.definition.endCondition.target}` : `${g.definition.endCondition.rounds} rounds`}`,
      })),
  ].sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

export function bookHighlights(games: BookGame[]) {
  const competitive = games.filter((g) => g.eligible);
  const scores = competitive.flatMap((g) =>
    g.players.map((p) => ({ ...p, game: g })),
  );
  const highestScore = scores.length
    ? Math.max(...scores.map((p) => p.score))
    : null;
  const best = scores.filter((p) => p.score === highestScore);
  const scrabble = games.flatMap((g) => (g.source ? [g.source] : []));
  const ids = [...new Set(scrabble.flatMap((g) => g.order))];
  const personal = ids.map((id) => ({
    id,
    ...buildPlayerRecords(scrabble, id),
  }));
  const words = personal.flatMap((p) => p.highestWords);
  const highWord = words.length ? Math.max(...words.map((w) => w.score)) : null;
  return {
    best,
    personal,
    words: words.filter((w) => w.score === highWord),
    competitive,
  };
}

/** Rivalries compare two sides within one compatible rules group, preserving ties. */
export function bookRivalry(games: BookGame[], first: string, second: string) {
  const matches = games.filter(
    (g) =>
      g.eligible &&
      g.players.length === 2 &&
      g.players.some((p) => p.id === first) &&
      g.players.some((p) => p.id === second),
  );
  const wins = (id: string) =>
    matches.filter(
      (g) =>
        g.players.filter((p) => p.winner).length === 1 &&
        g.players.some((p) => p.id === id && p.winner),
    ).length;
  const ties = matches.filter(
    (g) => g.players.filter((p) => p.winner).length > 1,
  ).length;
  const margins = matches
    .map((g) => ({
      game: g,
      margin: Math.abs(g.players[0].score - g.players[1].score),
    }))
    .sort((a, b) => a.margin - b.margin);
  return {
    matches,
    firstWins: wins(first),
    secondWins: wins(second),
    ties,
    closest: margins[0],
  };
}
