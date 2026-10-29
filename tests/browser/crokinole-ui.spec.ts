import { expect, test } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";
import { applyCrokinoleCommand } from "../../src/domain/crokinole";

test("Crokinole default zero scores, round review and undo preserve the entry", async ({
  page,
}, testInfo) => {
  const fixture = await installFixture(page);
  await page.goto("/family/crokinole/new");
  await expect(
    page.getByRole("heading", { name: "New Crokinole game" }),
  ).toBeVisible();
  await page.locator("summary").filter({ hasText: "Game options" }).click();
  await page
    .getByRole("combobox", { name: "Who starts?", exact: true })
    .selectOption("doug");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const order = page.getByRole("region", { name: "Round shooting order" });
  await expect(order.locator(".crokinole-next-starter")).toContainText(
    "Erin · Round 2",
  );
  await expect(
    page.getByRole("button", { name: "Add Round 1", exact: true }),
  ).toBeVisible();
  await fitsWidth(page);
  await page.getByRole("button", { name: "Add Round 1", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Round 1", exact: true }),
  });
  await expect(
    dialog.getByRole("button", { name: "Save round", exact: true }),
  ).toBeEnabled();
  await dialog.getByLabel("Doug round total", { exact: true }).fill("65");
  await expect(
    dialog.getByRole("button", { name: "Save round", exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByLabel("Erin round total", { exact: true }),
  ).toHaveValue("0");
  await expect(
    dialog.getByRole("button", { name: "Save round", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("crokinole-round-entry.png"),
    fullPage: false,
  });
  await dialog.getByRole("button", { name: "Save round", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Round 2", exact: true }),
  ).toBeVisible();
  expect(fixture.game().totals).toEqual({ doug: 65, erin: 0 });
  await expect(order.locator(".crokinole-next-starter")).toContainText(
    "Doug · Round 3",
  );
  await page.getByRole("button", { name: "Undo last round" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Undo round", exact: true })
    .click();
  await expect(
    page.getByLabel("Doug round total", { exact: true }),
  ).toHaveValue("65");
  expect(fixture.game().rounds).toHaveLength(0);
  await page
    .getByRole("button", { name: "Keep draft & close", exact: true })
    .click();
  await expect(order.locator(".crokinole-next-starter")).toContainText(
    "Erin · Round 2",
  );
  await page.reload();
  await expect(order.locator(".crokinole-next-starter")).toContainText(
    "Erin · Round 2",
  );
  await page
    .getByRole("button", { name: "Continue entry", exact: true })
    .click();
  await expect(
    page.getByLabel("Doug round total", { exact: true }),
  ).toHaveValue("65");
  await expect(
    page.getByLabel("Erin round total", { exact: true }),
  ).toHaveValue("0");
});

for (const [count, format] of [
  [2, "singles"],
  [3, "free_for_all"],
  [4, "free_for_all"],
  [4, "doubles"],
] as const) {
  test(`next-round first shooter follows seats in ${count}-player ${format}`, async ({
    page,
  }, info) => {
    const fixture = await installFixture(page, {
      playerCount: count,
      format,
      scoringMode: "cumulative_round_totals",
      endCondition: { type: "fixed_rounds", rounds: 3 },
    });
    const names = ["Doug", "Erin", "Nate", "Cristine"].slice(0, count);
    await page.goto("/family/crokinole/new");
    await page.locator("summary").filter({ hasText: "Game options" }).click();
    await page
      .getByRole("combobox", { name: "Who starts?", exact: true })
      .selectOption(fixture.family.players[count - 1].id);
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const order = page.getByRole("region", { name: "Round shooting order" });
    await expect(order.locator("strong").first()).toHaveText(names.at(-1)!);
    const next = order.locator(".crokinole-next-starter");
    await expect(next).toHaveText("First to shoot next roundDoug · Round 2");
    await fitsWidth(page);
    await page.screenshot({
      path: info.outputPath("crokinole-next-first-shooter.png"),
      fullPage: false,
    });
    for (let round = 1; round <= 3; round++) {
      if (round === 2) {
        await page
          .getByRole("button", { name: `Add Round ${round}`, exact: true })
          .click();
        // Opening a score entry does not advance the shooting order.
        await expect(order.locator("strong").first()).toHaveText("Doug");
        await page
          .getByRole("button", { name: "Save round", exact: true })
          .click();
      } else {
        await page
          .getByRole("button", { name: "No Score", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: `No score for Round ${round}?` })
          .getByRole("button", { name: "No Score", exact: true })
          .click();
      }
      if (round === 1) {
        await expect(next).toContainText("Erin · Round 3");
        await page.reload();
        await expect(next).toContainText("Erin · Round 3");
      } else if (round === 2) {
        await expect(next).toHaveCount(0);
        await expect(order).toContainText("Round 3 · First to shootErin");
      }
    }
    await page
      .getByRole("dialog", { name: "Well played!" })
      .getByRole("button", { name: "Close dialog" })
      .click();
    await expect(order).toHaveCount(0);
    expect(fixture.game().status).toBe("completed");
    expect(fixture.game().rounds.map((r) => r.startingPlayerId)).toEqual([
      fixture.family.players[count - 1].id,
      "doug",
      "erin",
    ]);
  });
}

for (const scoringMode of [
  "net_winner_only",
  "cumulative_round_totals",
  "traditional_differential",
  "nca_match_points",
] as const) {
  test(`No Score records one zero-total round under ${scoringMode} rules`, async ({
    page,
  }) => {
    const fixture = await installFixture(page, {
      playerCount: 2,
      format: "singles",
      scoringMode,
      endCondition: {
        type: "target",
        target: scoringMode === "nca_match_points" ? 5 : 100,
      },
    });
    await page.goto("/family/crokinole/new");
    await page.locator("summary").filter({ hasText: "Game options" }).click();
    await page
      .getByRole("combobox", { name: "Who starts?", exact: true })
      .selectOption("doug");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await page
      .getByRole("button", { name: "Add Round 1", exact: true })
      .click();
    await page.getByLabel("Doug round total", { exact: true }).fill("20");
    await page.getByRole("button", { name: "Save round", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Add Round 2", exact: true }),
    ).toBeVisible();
    const before = { ...fixture.game().totals };
    await page
      .getByRole("button", { name: "Add Round 2", exact: true })
      .click();
    await page.getByLabel("Doug round total", { exact: true }).fill("25");
    await page
      .getByRole("button", { name: "Keep draft & close", exact: true })
      .click();
    await page.getByRole("button", { name: "No Score", exact: true }).click();
    const confirmation = page.getByRole("dialog", {
      name: "No score for Round 2?",
    });
    await expect(confirmation).toContainText("discards your unfinished entry");
    await confirmation
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect(fixture.game().rounds).toHaveLength(1);
    await page
      .getByRole("button", { name: "Continue entry", exact: true })
      .click();
    await expect(
      page.getByLabel("Doug round total", { exact: true }),
    ).toHaveValue("25");
    await page
      .getByRole("button", { name: "Keep draft & close", exact: true })
      .click();

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    await page.route("**/api/family/crokinole*", async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postDataJSON().operation.type === "command"
      ) {
        writes++;
        await held;
      }
      await route.fallback();
    });
    await page.getByRole("button", { name: "No Score", exact: true }).click();
    if (scoringMode === "nca_match_points")
      await expect(confirmation).toContainText("one match point to each side");
    const submit = confirmation.getByRole("button", {
      name: "No Score",
      exact: true,
    });
    // Dispatch both taps in the same frame, before React can disable the button.
    await submit.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => writes).toBe(1);
    await expect(
      confirmation.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    release();
    await expect(confirmation).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add Round 3", exact: true }),
    ).toBeVisible();
    expect(writes).toBe(1);
    expect(fixture.game().events).toHaveLength(2);
    expect(fixture.game().rounds[1].entries).toEqual([
      { participantId: "doug", rawScore: 0 },
      { participantId: "erin", rawScore: 0 },
    ]);
    expect(fixture.game().totals).toEqual(
      scoringMode === "nca_match_points"
        ? { doug: before.doug + 1, erin: before.erin + 1 }
        : before,
    );
    expect(fixture.game().rounds[1].startingPlayerId).toBe("erin");
    await page.reload();
    await expect(
      page
        .getByRole("region", { name: "Round shooting order" })
        .locator("strong")
        .first(),
    ).toHaveText("Doug");
    await page.getByRole("button", { name: "Undo last round" }).click();
    await page
      .getByRole("dialog", { name: "Undo round 2?" })
      .getByRole("button", { name: "Undo round", exact: true })
      .click();
    await expect(
      page.getByLabel("Doug round total", { exact: true }),
    ).toHaveValue("0");
    expect(fixture.game().totals).toEqual(before);
    expect(fixture.game().rounds).toHaveLength(1);
  });
}

test("target first-shooter hints follow corrections and a viewer's shared refresh", async ({
  page,
}) => {
  const fixture = await installFixture(page, {
    playerCount: 2,
    format: "singles",
    scoringMode: "cumulative_round_totals",
    endCondition: { type: "target", target: 100 },
  });
  await page.goto("/family/crokinole/new");
  await page.locator("summary").filter({ hasText: "Game options" }).click();
  await page
    .getByRole("combobox", { name: "Who starts?", exact: true })
    .selectOption("erin");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const order = page.getByRole("region", { name: "Round shooting order" });
  const next = order.locator(".crokinole-next-starter");
  await expect(next).toHaveText(
    "First to shoot next round (if needed)Doug · Round 2",
  );
  await page.getByRole("button", { name: "No Score", exact: true }).click();
  await page
    .getByRole("dialog", { name: "No score for Round 1?" })
    .getByRole("button", { name: "No Score", exact: true })
    .click();
  await expect(next).toContainText("Erin · Round 3");

  async function editFirstRound() {
    const review = page.getByRole("button", {
      name: "Review round 1",
      exact: true,
    });
    if (await review.isVisible()) await review.click();
    else
      await page
        .locator(".crokinole-round")
        .filter({ hasText: "Round 1" })
        .click();
    await page.getByRole("button", { name: "Edit round", exact: true }).click();
  }
  await editFirstRound();
  await page.getByLabel("Doug round total", { exact: true }).fill("100");
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Well played!" })
    .getByRole("button", { name: "Close dialog" })
    .click();
  await expect(order).toHaveCount(0);
  await editFirstRound();
  await page.getByLabel("Doug round total", { exact: true }).fill("20");
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", { name: "Amend this result?" });
  await confirmation
    .getByLabel("Reason", { exact: true })
    .fill("Missed score correction");
  await confirmation
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await expect(next).toContainText("Erin · Round 3");

  fixture.shared.access[fixture.game().definition.id].canScore = false;
  await page.reload();
  await expect(next).toContainText("Erin · Round 3");
  await expect(
    page.getByRole("button", { name: "Add Round 2", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "No Score", exact: true }),
  ).toHaveCount(0);
  fixture.shared.games[0] = applyCrokinoleCommand(fixture.game(), {
    id: "another-scorer-round",
    type: "record_round",
    expectedRevision: fixture.game().revision,
    roundId: "shared-round-2",
    entries: [
      { participantId: "doug", rawScore: 0 },
      { participantId: "erin", rawScore: 0 },
    ],
  });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(next).toContainText("Doug · Round 4");
  await expect(order.locator("strong").first()).toHaveText("Erin");
  expect(fixture.game().events).toHaveLength(4);
});

test("Crokinole doubles and individual setup keep teams and colours valid", async ({
  page,
}, testInfo) => {
  const fixture = await installFixture(page);
  await page.goto("/family/crokinole/new");
  await page.getByRole("button", { name: "4 players", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Doubles", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Individual", exact: true }).click();
  await expect(
    page.getByText("Family Free-for-All · each player keeps their own total."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Doubles", exact: true }).click();
  await fitsWidth(page);
  await page.screenshot({
    path: testInfo.outputPath("crokinole-doubles-setup.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.getByRole("button", { name: "Add Round 1", exact: true }).click();
  await page.getByLabel("Doug & Nate round total", { exact: true }).fill("50");
  await page
    .getByLabel("Erin & Cristine round total", { exact: true })
    .fill("70");
  await page.getByRole("button", { name: "Save round", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Round 2", exact: true }),
  ).toBeVisible();
  expect(fixture.game().definition.format).toBe("doubles");
  expect(Object.values(fixture.game().totals)).toEqual([50, 70]);
  await fitsWidth(page);
  await page.screenshot({
    path: testInfo.outputPath("crokinole-standings.png"),
    fullPage: false,
  });
});

test("Crokinole unusual totals require confirmation and palette edits persist", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  await page.goto("/family/crokinole/new");
  await page
    .getByRole("button", { name: "Manage piece colours", exact: true })
    .click();
  await page.getByRole("button", { name: "Add colour", exact: true }).click();
  await page.getByLabel("Colour name", { exact: true }).fill("Ocean");
  await page.getByRole("button", { name: "Save colour", exact: true }).click();
  await expect(page.getByText("Ocean", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Ocean", exact: true }).click();
  await page.getByLabel("Colour name", { exact: true }).fill("Azure");
  await page.getByRole("button", { name: "Save colour", exact: true }).click();
  await page.getByRole("button", { name: "Hide Azure", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Show Azure", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restore defaults", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Show Azure", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show Azure", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Hide Azure", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  expect(fixture.shared.palette.colours.some((c) => c.name === "Azure")).toBe(
    true,
  );
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.getByRole("button", { name: "Add Round 1", exact: true }).click();
  await page.getByLabel("Doug round total", { exact: true }).fill("300");
  await page.getByLabel("Erin round total", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Save round", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Check the round total" }),
  ).toBeVisible();
  expect(fixture.game().rounds).toHaveLength(0);
  await page
    .getByRole("button", { name: "Keep and save", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add Round 2", exact: true }),
  ).toBeVisible();
  expect(fixture.game().totals.doug).toBe(300);
});

test("Crokinole three-player tied finish and completed correction recalculate the result", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  await page.goto("/family/crokinole/new");
  await page.getByRole("button", { name: "3 players", exact: true }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  for (let round = 1; round <= 4; round++) {
    await page
      .getByRole("button", { name: `Add Round ${round}`, exact: true })
      .click();
    for (const name of ["Doug", "Erin", "Nate"])
      await page.getByLabel(`${name} round total`, { exact: true }).fill("25");
    await page.getByRole("button", { name: "Save round", exact: true }).click();
  }
  await page
    .getByRole("dialog", { name: "Well played!" })
    .getByRole("button", { name: "Close dialog" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Doug & Erin & Nate tied", exact: true }),
  ).toBeVisible();
  expect(fixture.game().result?.tied).toBe(true);
  const review = page.getByRole("button", {
    name: "Review round 1",
    exact: true,
  });
  if (await review.isVisible()) await review.click();
  else
    await page
      .locator(".crokinole-round")
      .filter({ hasText: "Round 1" })
      .click();
  await page.getByRole("button", { name: "Edit round", exact: true }).click();
  await page.getByLabel("Doug round total", { exact: true }).fill("30");
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Amend this result?", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Corrected five missed points");
  await page
    .getByRole("dialog")
    .filter({
      has: page.getByRole("heading", {
        name: "Amend this result?",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Doug wins", exact: true }),
  ).toBeVisible();
  expect(fixture.game().totals.doug).toBe(105);
  const previous = fixture.game().definition;
  await page.getByRole("button", { name: "Rematch", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Round 1", exact: true }),
  ).toBeVisible();
  expect(fixture.game().rounds).toHaveLength(0);
  expect(fixture.shared.games).toHaveLength(2);
  expect(fixture.game().definition.players).toEqual(previous.players);
  expect(fixture.game().definition.initialStartingPlayerId).not.toBe(
    previous.initialStartingPlayerId,
  );
});

test("Crokinole earlier winning correction confirms excluded rounds before changing history", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  await page.goto("/family/crokinole/new");
  await page.locator("summary").filter({ hasText: "Game options" }).click();
  await page
    .getByRole("combobox", { name: "Scoring", exact: true })
    .selectOption("traditional_differential");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  for (const [index, scores] of [
    [65, 40],
    [30, 55],
    [80, 5],
  ].entries()) {
    await page
      .getByRole("button", { name: `Add Round ${index + 1}`, exact: true })
      .click();
    await page
      .getByLabel("Doug round total", { exact: true })
      .fill(String(scores[0]));
    await page
      .getByLabel("Erin round total", { exact: true })
      .fill(String(scores[1]));
    await page.getByRole("button", { name: "Save round", exact: true }).click();
  }
  await page
    .getByRole("dialog", { name: "Well played!" })
    .getByRole("button", { name: "Close dialog" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Doug wins", exact: true }),
  ).toBeVisible();
  const review = page.getByRole("button", {
    name: "Review round 1",
    exact: true,
  });
  if (await review.isVisible()) await review.click();
  else
    await page
      .locator(".crokinole-round")
      .filter({ hasText: "Round 1" })
      .click();
  await page.getByRole("button", { name: "Edit round", exact: true }).click();
  await page.getByLabel("Doug round total", { exact: true }).fill("145");
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  const confirmation = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Amend this result?",
      exact: true,
    }),
  });
  await expect(confirmation).toContainText("2 later rounds");
  expect(fixture.game().rounds).toHaveLength(3);
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  expect(fixture.game().rounds).toHaveLength(3);
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Round one had a missed hundred");
  await confirmation
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Doug wins", exact: true }),
  ).toBeVisible();
  await expect.poll(() => fixture.game().rounds.length).toBe(1);
  expect(fixture.game().events).toHaveLength(4);
  expect(fixture.game().totals.doug).toBe(105);
});

test("family net defaults, rules guide and zero opponents survive a reload", async ({
  page,
}) => {
  const { DEFAULT_CROKINOLE_SETTINGS } =
    await import("../../src/domain/crokinole-defaults");
  const fixture = await installFixture(page, DEFAULT_CROKINOLE_SETTINGS);
  await page.goto("/family/settings");
  await page
    .getByRole("button", {
      name: "Crokinole rules & family defaults",
      exact: true,
    })
    .click();
  await page.getByText("Rules & scoring explained", { exact: true }).click();
  await expect(page.getByText(/it does not subtract again/)).toBeVisible();
  await page.getByLabel("Default target", { exact: true }).fill("350");
  await page
    .getByRole("button", { name: "Save family defaults", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/family/crokinole/new");
  await expect(page.getByText(/Game options.*first to 350/)).toBeVisible();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.getByRole("button", { name: "Add Round 1", exact: true }).click();
  await expect(
    page.getByLabel("Doug round total", { exact: true }),
  ).toHaveValue("0");
  await page.getByLabel("Doug round total", { exact: true }).fill("25");
  await page.getByLabel("Erin round total", { exact: true }).fill("5");
  await expect(
    page.getByRole("button", { name: "Save round", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Erin round total", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Save round", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Round 2", exact: true }),
  ).toBeVisible();
  expect(fixture.game().totals).toEqual({
    doug: 25,
    erin: 0,
    nate: 0,
    cristine: 0,
  });
  await page.reload();
  await page.getByRole("button", { name: "Add Round 2", exact: true }).click();
  for (const name of ["Doug", "Erin", "Nate", "Cristine"])
    await expect(
      page.getByLabel(`${name} round total`, { exact: true }),
    ).toHaveValue("0");
});

test("superadmin removes a regular Crokinole game without becoming scorer", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  await page.goto("/family/crokinole/new");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Round 1", exact: true }),
  ).toBeVisible();
  const id = fixture.game().definition.id;
  fixture.shared.access[id].canScore = false;
  fixture.shared.access[id].scorerUserId = "another-scorer";
  await page.reload();
  await page.getByText("Game administration", { exact: true }).click();
  await page
    .getByRole("button", { name: "End and remove game", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "End and remove game?" });
  await expect(
    dialog.getByRole("button", { name: "Confirm", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Reason", { exact: true }).fill("Abandoned game");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page).toHaveURL(/\/family$/);
  expect(fixture.shared.games).toHaveLength(0);
});

test("Home PLAY tiles repeat, pause and respect reduced motion", async ({
  page,
}, testInfo) => {
  await installFixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/family");
  const toggle = page.getByRole("button", { name: "Pause PLAY animation" });
  const tile = toggle.locator(".family-welcome-tile").first();
  await expect(toggle).toBeVisible();
  await expect(tile).toHaveCSS("animation-name", "family-tile-wait");
  await expect(tile).toHaveCSS("animation-duration", "4.8s");
  await toggle.click();
  await expect(
    page.getByRole("button", { name: "Resume PLAY animation" }),
  ).toBeVisible();
  await expect(
    page.locator(".hub-play-toggle .family-welcome-tile").first(),
  ).toHaveCSS("animation-name", "none");
  await page.getByRole("button", { name: "Resume PLAY animation" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(tile).toHaveCSS("animation-name", "none");
  await fitsWidth(page);
  await page.screenshot({
    path: testInfo.outputPath("home-play.png"),
    fullPage: true,
  });
});
