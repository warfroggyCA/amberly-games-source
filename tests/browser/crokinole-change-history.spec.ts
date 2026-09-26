import { test, expect } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";
import {
  applyCrokinoleCommand,
  createCrokinoleGame,
} from "../../src/domain/crokinole";

test("viewers can inspect original Crokinole results and excluded entries after reopening History", async ({
  page,
}, info) => {
  const f = await installFixture(page);
  const userId = f.family.member.userId;
  f.family.member.role = "member";
  f.family.playerAccess.doug = { revision: 0, userId };
  let game = createCrokinoleGame({
    schemaVersion: 1,
    rulesVersion: 1,
    id: "amended-game",
    familyId: f.family.family.id,
    createdAt: "2026-09-18T10:00:00Z",
    mode: "confirmed",
    format: "singles",
    scoringMode: "cumulative_round_totals",
    endCondition: { type: "target", target: 100 },
    initialStartingPlayerId: "doug",
    players: f.family.players
      .slice(0, 2)
      .map((p, seatOrder) => ({ id: p.id, name: p.name, seatOrder })),
    participants: f.family.players.slice(0, 2).map((p, i) => ({
      id: p.id,
      name: p.name,
      playerIds: [p.id],
      colour: {
        id: f.shared.palette.colours[i].id,
        name: f.shared.palette.colours[i].name,
        value: f.shared.palette.colours[i].value,
      },
    })),
  });
  const entries = (doug: number, erin: number) => [
    { participantId: "doug", rawScore: doug },
    { participantId: "erin", rawScore: erin },
  ];
  for (const [i, scores] of [
    [40, 30],
    [30, 80],
  ].entries())
    game = applyCrokinoleCommand(
      game,
      {
        type: "record_round",
        id: `record-${i}`,
        expectedRevision: game.revision,
        roundId: `round-${i + 1}`,
        entries: entries(...(scores as [number, number])),
      },
      { actorId: userId, createdAt: "2026-09-18T11:00:00Z" },
    );
  game = applyCrokinoleCommand(
    game,
    {
      type: "correct_round",
      id: "correction",
      expectedRevision: game.revision,
      roundId: "round-1",
      entries: entries(100, 20),
      excludedRoundIds: ["round-2"],
      reason: "Missed pocketed twenties",
    },
    { actorId: userId, createdAt: "2026-09-18T11:05:00Z" },
  );
  f.shared.games.push(game);
  f.shared.access[game.definition.id] = {
    scorerUserId: "another-account",
    generation: 2,
    canScore: false,
    mode: "confirmed",
    concerns: [],
  };
  await page.route("**/api/family/games*", (route) =>
    route.fulfill({
      json: {
        games: [
          {
            gameType: "crokinole",
            id: game.definition.id,
            createdAt: game.definition.createdAt,
            status: game.status,
            participants: game.definition.participants,
            totals: game.totals,
            winnerIds: game.result!.winnerIds,
            mode: "confirmed",
            scorerUserId: "another-account",
            revision: game.revision,
          },
        ],
        nextCursor: null,
        standings: [
          {
            gameType: "crokinole",
            playerId: "doug",
            played: 12,
            wins: 7,
            ties: 1,
          },
          {
            gameType: "crokinole",
            playerId: "erin",
            played: 12,
            wins: 4,
            ties: 1,
          },
        ],
      },
    }),
  );
  await page.goto("/family/history");
  await expect(page.locator(".history-winner")).toContainText("Doug");
  await page
    .getByText("Family standings · wins & ranks", { exact: true })
    .click();
  await expect(
    page.locator(".family-standings tbody tr").first(),
  ).toContainText("Doug");
  await page
    .locator(".family-standings")
    .getByRole("button", { name: /^Player / })
    .click();
  await page
    .locator(".family-standings")
    .getByRole("button", { name: /^Player / })
    .click();
  await expect(
    page.locator(".family-standings tbody tr").first(),
  ).toContainText("Erin");
  await page.screenshot({
    path: info.outputPath("history-winner-standings.png"),
  });
  await page.getByRole("button").filter({ hasText: "Doug vs Erin" }).click();
  const badge = page.getByRole("dialog", { name: "Well played!" });
  if (await badge.count())
    await badge.getByRole("button", { name: "Close dialog" }).click();
  await page.locator("summary").filter({ hasText: "Changes (1)" }).click();
  const changes = page.locator(".crokinole-changes");
  await expect(changes).toContainText("Recorded by Doug");
  await expect(changes).toContainText("Missed pocketed twenties");
  await expect(changes).toContainText("Result before: Erin won");
  await expect(changes).toContainText("Result after: Doug won");
  await expect(changes.getByRole("row", { name: "Doug 70 100" })).toBeVisible();
  await expect(changes.getByRole("row", { name: "Erin 110 20" })).toBeVisible();
  await changes
    .locator("summary")
    .filter({ hasText: "Original round entries" })
    .click();
  await expect(changes).toContainText("Doug: 40 → 100");
  await expect(changes).toContainText(
    "Round 2 excluded from the result: Doug 30 · Erin 80",
  );
  await expect(
    page.getByRole("button", { name: "Edit round", exact: true }),
  ).toHaveCount(0);
  await fitsWidth(page);
  await page.screenshot({
    path: info.outputPath("crokinole-changes.png"),
    fullPage: true,
  });
  expect(f.game()).toEqual(game);
});

test("short landscape keeps four long-name scores, starter and next-round control in view", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "iphone-landscape",
    "Short viewport layout regression",
  );
  const f = await installFixture(page, {
    playerCount: 4,
    format: "free_for_all",
    scoringMode: "cumulative_round_totals",
    endCondition: { type: "fixed_rounds", rounds: 4 },
  });
  [
    "Alexandria Catherine Findlay",
    "Christopher Jonathan Findlay",
    "Nathaniel Alexander Findlay",
    "Cristine Elizabeth Findlay",
  ].forEach((name, i) => {
    f.family.players[i].name = name;
  });
  await page.goto("/family/crokinole/new");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".crokinole-match-heading")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(
    page.getByRole("button", { name: "Add Round 1", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".crokinole-start")).toBeInViewport({ ratio: 1 });
  const actionBox = await page
    .locator(".crokinole-sticky-actions")
    .boundingBox();
  for (const total of await page.locator(".crokinole-total").all()) {
    await expect(total).toBeInViewport({ ratio: 1 });
    const box = await total.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(actionBox!.y);
  }
  await fitsWidth(page);
  await page.screenshot({
    path: info.outputPath("crokinole-landscape-scores.png"),
  });
});
