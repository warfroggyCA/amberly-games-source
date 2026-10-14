import { expect, test } from "@playwright/test";
import {
  applyCommand,
  createGame,
  type GameCommand,
} from "../../src/domain/game";
import { competitiveResultEligible } from "../../src/domain/records";
import type { Letter } from "../../src/domain/types";
import { testLexicon } from "../../src/lib/test-lexicon";
import { installFixture } from "./fixtures/crokinole";

// These fixture words are in the released reference. The browser hydrates the
// journal against its real bundled lexicon; Node only needs this small subset.
const releasedFamilyLexicon = {
  ...testLexicon,
  id: "amberly-family-v1-2121ea84c411",
  edition: "Amberly family reference v1 (website 2026-09-14 + OSPD5)",
  status: "ready" as const,
};

function finished(
  id: string,
  word: string,
  wordBuddy?: boolean,
  threePlayers = false,
) {
  const made = createGame({
    id,
    ...(wordBuddy === undefined ? {} : { wordBuddy }),
    players: [
      { id: "doug", name: "Doug", seat: 0 },
      { id: "erin", name: "Erin", seat: 2 },
      ...(threePlayers ? [{ id: "nate", name: "Nate", seat: 3 as const }] : []),
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: releasedFamilyLexicon,
    createdAt: "2026-10-12T18:00:00Z",
  });
  if (!made.ok) throw Error(made.error.message);
  let game = made.game;
  function run(action: Record<string, unknown>) {
    const next = applyCommand(
      game,
      {
        ...action,
        id: `${id}-${game.revision}`,
        expectedRevision: game.revision,
      } as GameCommand,
      releasedFamilyLexicon,
    );
    if (!next.ok) throw Error(next.error.message);
    game = next.game;
  }
  run({
    type: "play",
    placements: [...word].map((letter, index) => ({
      row: 7,
      col: 7 + index,
      tile: { letter: letter as Letter, blank: false },
    })),
  });
  for (let i = 0; i < (threePlayers ? 6 : 4); i++) run({ type: "pass" });
  run({
    type: "finalize",
    reason: "blocked",
    racks: {
      doug: ["E", "E", "E", "E", "I", "I", "I"],
      erin: ["A", "A", "A", "A", "D", "O", "O"],
      ...(threePlayers ? { nate: ["N", "N", "N", "N", "R", "R", "R"] } : {}),
    },
  });
  expect(competitiveResultEligible(game)).toBe(true);
  return game;
}

test("detailed Scrabble records follow All, Classic, Word Buddy and compatible group selections", async ({
  page,
}) => {
  const f = await installFixture(page);
  f.family.games = [
    finished("classic-cat", "CAT"), // Missing legacy mode flag means Classic.
    finished("classic-dog", "DOG", false), // Equal highest word score is retained.
    finished("buddy-quiz", "QUIZ", true),
    finished("private-axe", "AXE", false),
    finished("open-jar", "JAR", false),
    finished("upheld-jet", "JET", true),
    finished("z-three-player", "ZAP", false, true),
  ];
  expect(f.family.games[0].definition).not.toHaveProperty("wordBuddy");
  for (const game of f.family.games)
    f.family.gameAccess[game.id] = {
      scorerUserId: f.family.member.userId,
      deviceId: "fixture",
      generation: 1,
      mode: game.id === "private-axe" ? "practice" : "confirmed",
      recordsEligible: true,
      protests:
        game.id === "open-jar" || game.id === "upheld-jet"
          ? [
              {
                id: `concern-${game.id}`,
                reason: "Check the physical scores",
                reportedFor: null,
                reportedBy: "Erin",
                reportedAt: "2026-10-12T19:00:00Z",
                gameRevision: game.revision,
                resolution:
                  game.id === "upheld-jet"
                    ? {
                        outcome: "upheld",
                        reason: "Confirmed after review",
                        resolvedBy: "Doug",
                        resolvedAt: "2026-10-12T19:01:00Z",
                      }
                    : null,
              },
            ]
          : [],
      canScore: true,
      approvals: [],
    };
  await page.goto("/family/records");
  await page
    .getByText("Explore every player’s Scrabble records", { exact: true })
    .click();
  const details = page.locator(".book-details");
  const doug = details.getByRole("region", {
    name: "Doug records",
    exact: true,
  });
  const mode = page.getByRole("combobox", {
    name: "Scrabble mode",
    exact: true,
  });
  await expect(doug).toContainText("3 completed");
  await expect(
    doug.getByRole("button", { name: "QUIZ · 44 points", exact: true }),
  ).toBeVisible();

  await mode.selectOption("classic");
  await expect(doug).toContainText("2 completed");
  await expect(
    doug.getByRole("button", { name: "CAT · 10 points", exact: true }),
  ).toBeVisible();
  await expect(
    doug.getByRole("button", { name: "DOG · 10 points", exact: true }),
  ).toBeVisible();
  await expect(doug).not.toContainText("QUIZ");
  await expect(details).not.toContainText("AXE");
  await expect(details).not.toContainText("JAR");

  await mode.selectOption("word-buddy");
  await expect(doug).toContainText("1 completed");
  await expect(
    doug.getByRole("button", { name: "QUIZ · 44 points", exact: true }),
  ).toBeVisible();
  await expect(doug).not.toContainText("CAT");
  await expect(doug).not.toContainText("DOG");
  await expect(details).not.toContainText("JET");

  await mode.selectOption("all");
  await expect(doug).toContainText("3 completed");
  const group = page.getByRole("combobox", {
    name: "Compare like games",
    exact: true,
  });
  const threePlayerLabel = (
    await group.locator("option").allTextContents()
  ).find((label) => label.startsWith("3 players"))!;
  await group.selectOption({ label: threePlayerLabel });
  await expect(doug).toContainText("1 completed");
  await expect(
    doug.getByRole("button", { name: "ZAP · 28 points", exact: true }),
  ).toBeVisible();
  await expect(doug).not.toContainText("QUIZ");
  await expect(doug).not.toContainText("CAT");
  // Changing mode can remove the selected group; both sections use its valid fallback.
  await mode.selectOption("word-buddy");
  await expect(doug).toContainText("1 completed");
  await expect(
    doug.getByRole("button", { name: "QUIZ · 44 points", exact: true }),
  ).toBeVisible();
  await expect(doug).not.toContainText("ZAP");
});
