import { writeFileSync } from "node:fs";
import { createLeadAssessor } from "../src/server/lead-standings";
import { expect, it } from "vitest";
import { applyCommand, createGame, type GameCommand } from "../src/domain/game";
import { deriveLeadCounts } from "../src/domain/lead-counts";
import { releasedFamilyLexicon } from "../src/lib/lexicons";

it.skipIf(process.env.AMBERLY_BENCHMARK !== "1")(
  "measures exact cold/cooperative/warm results, event-loop service and cancellation for long and corrected histories",
  async () => {
    const results = [];
    for (const mixed of [false, true]) {
      const created = createGame({
        id: mixed ? "lead-mixed-benchmark" : "lead-maximum-benchmark",
        players: [
          { id: "a", name: "A", seat: 0 },
          { id: "b", name: "B", seat: 2 },
        ],
        firstPlayerId: "a",
        direction: "clockwise",
        lexicon: releasedFamilyLexicon,
      });
      if (!created.ok) throw Error(created.error.message);
      let game = created.game;
      const command = (payload: Record<string, unknown>) => {
        const next = applyCommand(
          game,
          {
            ...payload,
            id: `c${game.revision}`,
            expectedRevision: game.revision,
          } as GameCommand,
          releasedFamilyLexicon,
        );
        if (!next.ok) throw Error(next.error.message);
        game = next.game;
      };
      const cat = [..."CAT"].map((letter, i) => ({
        row: 7,
        col: 7 + i,
        tile: { letter, blank: false },
      }));
      const setup = performance.now();
      if (mixed) command({ type: "play", placements: cat });
      for (let i = 0; i < (mixed ? 490 : 4994); i++)
        command({ type: i % 2 ? "resume" : "pause" });
      if (mixed) {
        command({
          type: "play",
          placements: [
            { row: 7, col: 10, tile: { letter: "S", blank: false } },
          ],
        });
        command({
          type: "edit-turn",
          turnId: "c0",
          placements: cat.map((p, i) =>
            i === 0 ? { ...p, tile: { ...p.tile, blank: true } } : p,
          ),
          reason: "Physical blank correction",
        });
        command({ type: "undo", reason: "Withdraw the last play" });
        command({ type: "exchange", count: 3 });
      } else command({ type: "play", placements: cat });
      for (let i = 0; i < 4; i++) command({ type: "pass" });
      command({
        type: "finalize",
        reason: "blocked",
        racks: { a: [..."READING"], b: [..."CATDOG?"] },
      });
      const begin = performance.now();
      const head = {
        game_id: game.id,
        revision: game.revision,
        definition: game.definition,
        state: game,
        disputed: false,
      };
      const sync = createLeadAssessor()("benchmark-family", head, game.events);
      const hydrated = performance.now();
      expect(sync.outcome).toBe("eligible");
      const counts = deriveLeadCounts(game);
      const ended = performance.now();
      expect(counts).toMatchObject({
        available: true,
        completedTurns: mixed ? 6 : 5,
      });
      expect(game.events).toHaveLength(mixed ? 500 : 5000);
      let ticks = 0,
        maxGapMs = 0,
        last = performance.now();
      const heartbeat = setInterval(() => {
        const now = performance.now();
        maxGapMs = Math.max(maxGapMs, now - last);
        last = now;
        ticks++;
      }, 5);
      const assess = createLeadAssessor();
      const cooperativeStart = performance.now();
      let cooperative;
      try {
        cooperative = await assess.cooperatively(
          "benchmark-family",
          head,
          game.events,
        );
      } finally {
        clearInterval(heartbeat);
      }
      const cooperativeMs = performance.now() - cooperativeStart;
      expect(cooperative).toEqual(sync);
      expect(ticks).toBeGreaterThan(3);
      // Regression guard, not a real-time scheduling guarantee on shared/hosted CPUs.
      expect(maxGapMs).toBeLessThan(1000);
      const warmStart = performance.now();
      expect(
        await assess.cooperatively("benchmark-family", head, game.events),
      ).toEqual(sync);
      const warmMs = performance.now() - warmStart;
      const cold = createLeadAssessor(),
        controller = new AbortController();
      const abortStart = performance.now();
      const timer = setTimeout(() => controller.abort(), 25);
      try {
        await expect(
          cold.cooperatively(
            "benchmark-family",
            head,
            game.events,
            controller.signal,
          ),
        ).rejects.toMatchObject({ name: "AbortError" });
      } finally {
        clearTimeout(timer);
      }
      const cancelMs = performance.now() - abortStart;
      expect(cancelMs).toBeLessThan(1500);
      expect(cold("benchmark-family", head, game.events, true)).toBeNull();
      results.push({
        fixture: mixed
          ? "500 events with correction/undo/exchange"
          : "5000 events, 4994 pause/resume",
        events: game.events.length,
        bytes: JSON.stringify(game).length,
        setupMs: Math.round(begin - setup),
        coldSyncMs: Math.round(hydrated - begin),
        deriveMs: Math.round(ended - hydrated),
        cooperativeMs: Math.round(cooperativeMs),
        heartbeatTicks: ticks,
        maxHeartbeatGapMs: Math.round(maxGapMs),
        warmMs: Math.round(warmMs),
        cancelMs: Math.round(cancelMs),
      });
    }
    if (process.env.AMBERLY_BENCHMARK_OUTPUT)
      writeFileSync(
        process.env.AMBERLY_BENCHMARK_OUTPUT,
        JSON.stringify(results, null, 2) + "\n",
      );
    console.log(JSON.stringify(results));
  },
  180000,
);
