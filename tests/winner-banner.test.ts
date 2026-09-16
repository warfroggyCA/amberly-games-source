import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WinnerBanner } from "../src/components/WinnerBanner";
import { applyCommand, createGame } from "../src/domain/game";
import type { Letter, Lexicon } from "../src/domain/types";

it("shows a solo player's adjusted result without inventing a competitive winner", () => {
  const lexicon: Lexicon = {
    id: "fixture",
    edition: "1",
    status: "test",
    has: (word) => word === "CAT",
  };
  const created = createGame({
    id: "solo-banner",
    players: [{ id: "doug", name: "Doug", seat: 2 }],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: {
      id: lexicon.id,
      edition: lexicon.edition,
      status: lexicon.status,
    },
    createdAt: "2026-09-14T20:00:00.000Z",
  });
  if (!created.ok) throw new Error(created.error.message);
  const played = applyCommand(
    created.game,
    {
      id: "play",
      expectedRevision: created.game.revision,
      type: "play",
      placements: [..."CAT"].map((letter, index) => ({
        row: 7,
        col: 7 + index,
        tile: { letter: letter as Letter, blank: false },
      })),
    },
    lexicon,
  );
  if (!played.ok) throw new Error(played.error.message);
  const ended = applyCommand(
    played.game,
    {
      id: "end",
      expectedRevision: played.game.revision,
      type: "finalize",
      reason: "early",
      racks: { doug: ["A", "A", "A", "A", "A", "A", "A"] },
    },
    lexicon,
  );
  if (!ended.ok) throw new Error(ended.error.message);
  expect(ended.game.result?.scores.doug).toBe(3);
  expect(ended.game.result?.winnerIds).toEqual([]);
  const markup = renderToStaticMarkup(
    createElement(WinnerBanner, { game: ended.game }),
  );
  expect(markup).toContain("Doug, nicely played!");
  expect(markup).toContain("3 points");
  expect(markup).not.toContain("wins!");
  expect(ended.game.result?.winnerIds).toEqual([]);
});
