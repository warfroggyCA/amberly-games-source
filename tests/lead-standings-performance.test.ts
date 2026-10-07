import { writeFileSync } from "node:fs";
import { createLeadAssessor } from "../src/server/lead-standings";
import { expect, it } from "vitest";
import { applyCommand, createGame, type GameCommand } from "../src/domain/game";
import { deriveLeadCounts } from "../src/domain/lead-counts";
import { releasedFamilyLexicon } from "../src/lib/lexicons";

it.skipIf(process.env.AMBERLY_BENCHMARK !== "1")(
  "measures a canonical maximum-size 5000-event history",
  () => {
    const created = createGame({
      id: "lead-benchmark",
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
    const setup = performance.now();
    for (let i = 0; i < 4994; i++)
      command({ type: i % 2 ? "resume" : "pause" });
    command({
      type: "play",
      placements: [..."CAT"].map((letter, i) => ({
        row: 7,
        col: 7 + i,
        tile: { letter, blank: false },
      })),
    });
    for (let i = 0; i < 4; i++) command({ type: "pass" });
    command({
      type: "finalize",
      reason: "blocked",
      racks: { a: [..."READING"], b: [..."CATDOG?"] },
    });
    const begin = performance.now();
    const assess = createLeadAssessor();
    const head = {
      game_id: game.id,
      revision: game.revision,
      definition: game.definition,
      state: game,
      disputed: false,
    };
    const restored = assess("benchmark-family", head, game.events);
    const hydrated = performance.now();
    expect(restored.outcome).toBe("eligible");
    const counts = deriveLeadCounts(game);
    const ended = performance.now();
    expect(counts).toMatchObject({ available: true, completedTurns: 5 });
    expect(game.events).toHaveLength(5000);
    const warmStart = performance.now();
    expect(assess("benchmark-family", head, game.events)).toEqual(restored);
    const result = {
      events: game.events.length,
      bytes: JSON.stringify(game).length,
      setupMs: Math.round(begin - setup),
      coldAssessMs: Math.round(hydrated - begin),
      deriveMs: Math.round(ended - hydrated),
      warmAssessMs: Math.round(performance.now() - warmStart),
    };
    if (process.env.AMBERLY_BENCHMARK_OUTPUT)
      writeFileSync(
        process.env.AMBERLY_BENCHMARK_OUTPUT,
        JSON.stringify(result, null, 2) + "\n",
      );
    console.log(JSON.stringify(result));
  },
  180000,
);
