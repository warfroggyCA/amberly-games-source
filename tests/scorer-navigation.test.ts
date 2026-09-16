import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ScorerApp } from "../src/components/ScorerApp";
import { applyCommand, createGame } from "../src/domain/game";
import { testLexicon } from "../src/lib/test-lexicon";
import type { ScorerSnapshot, ScorerStore } from "../src/lib/scorer-store";

it.each(["active", "finalized"] as const)(
  "opens Home on a new device with a selected %s game without changing its history",
  (status) => {
    const created = createGame({
      id: "another-device-game",
      players: [{ id: "doug", name: "Doug", seat: 2 }],
      firstPlayerId: "doug",
      direction: "clockwise",
      lexicon: testLexicon,
      createdAt: "2026-09-14T20:00:00.000Z",
    });
    if (!created.ok) throw new Error(created.error.message);
    const ended = applyCommand(
      created.game,
      {
        type: "finalize",
        id: "finish",
        expectedRevision: 0,
        reason: "early",
        racks: { doug: ["A", "A", "A", "A", "A", "A", "A"] },
      },
      testLexicon,
    );
    if (!ended.ok) throw new Error(ended.error.message);
    const game = status === "active" ? created.game : ended.game;
    const snapshot: ScorerSnapshot = {
      status: "ready",
      error: null,
      pending: 0,
      data: {
        version: 1,
        revision: 0,
        players: [{ id: "doug", name: "Doug" }],
        games: [game],
        activeGameId: game.id,
        drafts: {},
      },
    };
    const original = JSON.stringify(snapshot);
    const update = vi.fn();
    const store: ScorerStore = {
      mode: "shared",
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
      getServerSnapshot: () => snapshot,
      load: async () => {},
      update,
      downloadBackup: async () => {},
      canScore: () => false,
    };
    const html = renderToStaticMarkup(
      createElement<{ store: ScorerStore }>(ScorerApp, { store }),
    );
    expect(html).toContain("Game night");
    expect(html).toContain("at Amberly.");
    expect(html).toContain(
      status === "finalized" ? "View last game" : "Return to game",
    );
    expect(html).not.toContain("Live observer view");
    expect(update).not.toHaveBeenCalled();
    expect(JSON.stringify(snapshot)).toBe(original);
  },
);
