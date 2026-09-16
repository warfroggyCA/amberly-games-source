import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createGame,
  hydrateGame,
  MAX_GAME_EVENTS,
  type GameState,
  type GameResult,
} from "../src/domain/game";
import {
  MAX_VERIFICATIONS_PER_COMMAND,
  MAX_VERIFIED_WORDS,
  type VerifiedWord,
} from "../src/domain/verified-words";
import { testLexicon } from "../src/lib/test-lexicon";
import {
  saveVerifiedWords,
  syncVerifiedWords,
} from "../src/lib/verified-word-store";
import type { PreviewData, Draft } from "../src/lib/preview-store";
function success(result: GameResult) {
  if (!result.ok) throw Error(result.error.message);
  return result.game;
}
function game() {
  return success(
    createGame({
      id: "sync-game",
      players: [
        { id: "a", name: "Ada", seat: 0 },
        { id: "b", name: "Ben", seat: 1 },
      ],
      firstPlayerId: "a",
      direction: "clockwise",
      lexicon: {
        id: testLexicon.id,
        edition: testLexicon.edition,
        status: testLexicon.status,
      },
      createdAt: "2026-09-14T00:00:00.000Z",
    }),
  );
}
function entries(count: number): VerifiedWord[] {
  return Array.from({ length: count }, (_, i) => {
    const word =
      "ZZ" +
      [
        Math.floor(i / 26 ** 3) % 26,
        Math.floor(i / 26 ** 2) % 26,
        Math.floor(i / 26) % 26,
        i % 26,
      ]
        .map((v) => String.fromCharCode(65 + v))
        .join("");
    return {
      word,
      source: "merriam-webster",
      sourceUrl: `https://scrabble.merriam.com/finder/${word.toLowerCase()}`,
      verifiedAt: "2026-09-14T15:00:00.000Z",
    };
  });
}
// Equivalent valid pause/resume journal avoids constructing thousands of intermediate snapshots.
function atRevision(revision: number): GameState {
  const state = structuredClone(game());
  state.events = Array.from({ length: revision }, (_, i) => {
    const type = i % 2 === 0 ? ("pause" as const) : ("resume" as const);
    const id = `capacity-${i}`;
    const expectedRevision = i;
    return {
      sequence: i + 1,
      command: { id, expectedRevision, type },
      fingerprint: JSON.stringify({ expectedRevision, id, type }),
    };
  });
  state.revision = revision;
  state.status = revision % 2 ? "paused" : "active";
  return state;
}
const draft: Draft = {
  revision: 0,
  placements: [{ row: 7, col: 7, tile: { letter: "Q", blank: false } }],
  row: 7,
  col: 8,
  direction: "across",
};
function data(
  state: GameState,
  verifiedWords: VerifiedWord[] = [],
): PreviewData {
  return {
    version: 1,
    revision: 0,
    players: [
      { id: "a", name: "Ada" },
      { id: "b", name: "Ben" },
    ],
    games: [state],
    activeGameId: state.id,
    drafts: { [state.id]: { ...draft, revision: state.revision } },
    verifiedWords,
  };
}

describe("verified-word synchronization capacity and resume", () => {
  it("splits confirmations at the command boundary and restores the resulting history", () => {
    const words = entries(MAX_VERIFICATIONS_PER_COMMAND + 1);
    const before = game();
    const result = syncVerifiedWords(before, words);
    expect(
      result.events.map((e) =>
        e.command.type === "verify-words" ? e.command.words.length : 0,
      ),
    ).toEqual([MAX_VERIFICATIONS_PER_COMMAND, 1]);
    expect(result.verifiedWords).toEqual(words);
    expect(result.turns).toEqual([]);
    expect(before.events).toEqual([]);
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(result)), testLexicon)),
    ).toEqual(result);
  });
  it("skips the entire automatic batch when it cannot fit and explicit verification fails without partial changes", () => {
    const near = atRevision(MAX_GAME_EVENTS - 2);
    const before = JSON.stringify(near);
    const words = entries(MAX_VERIFICATIONS_PER_COMMAND + 1);
    expect(syncVerifiedWords(near, words)).toBe(near);
    expect(() => syncVerifiedWords(near, words, true)).toThrow(
      /word-history limit/,
    );
    expect(JSON.stringify(near)).toBe(before);
  });
  it("permits exactly one last addition while reserving the finalization event", () => {
    const near = atRevision(MAX_GAME_EVENTS - 2);
    const added = syncVerifiedWords(near, entries(1));
    expect(added.revision).toBe(MAX_GAME_EVENTS - 1);
    expect(added.verifiedWords).toHaveLength(1);
    const finalized = success(
      applyCommand(
        added,
        {
          id: "final",
          expectedRevision: added.revision,
          type: "finalize",
          reason: "early",
          racks: {
            a: ["A", "A", "A", "A", "A", "A", "A"],
            b: ["E", "E", "E", "E", "E", "E", "E"],
          },
        },
        testLexicon,
      ),
    );
    expect(finalized.revision).toBe(MAX_GAME_EVENTS);
    expect(finalized.status).toBe("finalized");
  });
  it("opening a game with no event capacity retains access, global additions and its draft", () => {
    const near = syncVerifiedWords(atRevision(MAX_GAME_EVENTS - 2), entries(1));
    const original = data(near, entries(2));
    const opened = saveVerifiedWords(original, [], near.id);
    expect(opened.games[0]).toBe(near);
    expect(opened.verifiedWords).toEqual(entries(2));
    expect(opened.drafts).toEqual(original.drafts);
    expect(() => saveVerifiedWords(original, [entries(2)[1]], near.id)).toThrow(
      /word-history limit/,
    );
    expect(original.games[0]).toBe(near);
  });
  it("keeps additions while paused then applies them after resume without losing draft letters", () => {
    const paused = success(
      applyCommand(
        game(),
        { type: "pause", id: "pause", expectedRevision: 0 },
        testLexicon,
      ),
    );
    const saved = saveVerifiedWords(data(paused), entries(1), paused.id);
    expect(saved.games[0]).toBe(paused);
    expect(paused.verifiedWords).toBeUndefined();
    const resumed = success(
      applyCommand(
        paused,
        { type: "resume", id: "resume", expectedRevision: paused.revision },
        testLexicon,
      ),
    );
    const synced = saveVerifiedWords(
      { ...saved, games: [resumed] },
      [],
      resumed.id,
    );
    expect(synced.games[0].verifiedWords).toEqual(entries(1));
    expect(synced.games[0].revision).toBe(3);
    expect(synced.drafts[resumed.id]).toEqual({ ...draft, revision: 3 });
    expect(synced.games[0].events.slice(0, 2)).toEqual(resumed.events);
  });
  it("rejects oversized automatic addition sets before appending any journal events", () => {
    const original = game();
    const words = entries(MAX_VERIFIED_WORDS + 1);
    expect(syncVerifiedWords(original, words)).toBe(original);
    expect(() => syncVerifiedWords(original, words, true)).toThrow(
      /word-history limit/,
    );
    expect(original.events).toEqual([]);
  });
});
