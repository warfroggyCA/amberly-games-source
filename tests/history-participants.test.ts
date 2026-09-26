import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  historyLabel,
  historyParticipants,
} from "../src/lib/history-participants";
import { HistoryParticipants } from "../src/components/HistoryParticipants";

describe("history participant portraits", () => {
  const profiles = [
    {
      id: "doug",
      name: "Doug",
      nickname: "Froggy",
      photoDataUrl: "saved-photo",
    },
    { id: "erin", name: "Erin", nickname: "Cici" },
  ];
  it("uses current profiles without changing recorded players or scores", () => {
    const saved = [
      { id: "doug", name: "Old name" },
      { id: "erin", name: "Erin" },
    ];
    const snapshot = structuredClone(saved);
    const sides = historyParticipants(saved, ["doug"], profiles);
    expect(sides.map((side) => side.name)).toEqual(["Froggy", "Cici"]);
    expect(sides[0].members[0].photoDataUrl).toBe("saved-photo");
    expect(sides[0].winner).toBe(true);
    expect(sides[0].tied).toBe(false);
    expect(sides[1].winner).toBe(false);
    expect(saved).toEqual(snapshot);
  });
  it("resolves Crokinole partners by player ID and recognizes a tied winning side", () => {
    const sides = historyParticipants(
      [
        { id: "side-a", name: "Old team", playerIds: ["erin", "doug"] },
        {
          id: "side-b",
          name: "Another team",
          playerIds: ["other-a", "other-b"],
        },
      ],
      ["side-a", "side-b"],
      profiles,
    );
    expect(sides[0].name).toBe("Cici & Froggy");
    expect(sides[0].members.map((member) => member.id)).toEqual([
      "erin",
      "doug",
    ]);
    expect(sides.every((side) => side.winner && side.tied)).toBe(true);
    expect(sides[1].name).toBe("Another team");
    expect(sides[1].members).toHaveLength(2);
  });
  it("retains recorded names when profiles are missing and never guesses photos by name", () => {
    const [side] = historyParticipants(
      [{ id: "removed", name: "Doug" }],
      ["removed"],
      profiles,
    );
    expect(side.name).toBe("Doug");
    expect(side.members).toEqual([{ id: "removed", name: "Doug" }]);
  });
  it("can be placed inside a history button without nested controls", () => {
    const markup = renderToStaticMarkup(
      createElement(HistoryParticipants, {
        participants: [
          { id: "doug", name: "Doug" },
          { id: "erin", name: "Erin" },
        ],
        profiles,
        winnerIds: ["doug"],
        totals: { doug: 197, erin: 126 },
      }),
    );
    expect(markup).toContain("Froggy");
    expect(markup).toContain("197 points");
    expect(markup).toContain("Winner");
    expect(markup).not.toMatch(/<(?:button|input|a)(?:\s|>)/);
    expect(markup).not.toContain("saved-photo");
  });
  it("keeps winner and scores in the accessible row label, including zero and ties", () => {
    const participants = [
      { id: "doug", name: "Doug" },
      { id: "erin", name: "Erin" },
    ];
    expect(
      historyLabel(participants, ["doug"], profiles, { doug: 197, erin: 0 }),
    ).toBe(
      "Froggy vs Cici. Winner: Froggy. Froggy: 197 points; Cici: 0 points",
    );
    expect(
      historyLabel(participants, ["doug", "erin"], profiles, {
        doug: 197,
        erin: 197,
      }),
    ).toBe(
      "Froggy vs Cici. Tied winners: Froggy & Cici. Froggy: 197 points; Cici: 197 points",
    );
    expect(historyLabel(participants, [], profiles, { doug: -3 }, " / ")).toBe(
      "Froggy / Cici. Froggy: -3 points",
    );
  });
});
