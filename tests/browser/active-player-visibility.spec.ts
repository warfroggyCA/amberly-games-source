import { expect, test } from "@playwright/test";
import { installFixture } from "./fixtures/crokinole";

test("archived players stay out of the Scrabble home roster and new-game picker", async ({
  page,
}, testInfo) => {
  const { family } = await installFixture(page);
  family.playerAccess.erin = { revision: 1, userId: null, archived: true };
  await page.goto("/family/scrabble");
  await expect(page.getByText("Erin", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("active-player-roster.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: /^New game/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Erin", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Doug", { exact: true }).first()).toBeVisible();
  await dialog.locator(".roster-player").filter({ hasText: "Doug" }).click();
  await dialog
    .getByRole("button", { name: "Top seat: empty", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Top seat: Doug", exact: true }),
  ).toBeVisible();
  family.playerAccess.doug = {
    revision: 1,
    userId: family.member.userId,
    archived: true,
  };
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    dialog.getByRole("button", { name: "Top seat: empty", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("Doug", { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Start game", exact: true }),
  ).toBeDisabled();
  family.playerAccess.doug.archived = false;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(dialog.getByText("Doug", { exact: true }).first()).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Top seat: empty", exact: true }),
  ).toBeVisible();
});

test("Crokinole discards archived selections during refresh and preserves running participants", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  await page.goto("/family/crokinole/new");
  const names = page.locator(".crokinole-roster select");
  await expect(names.nth(1)).toHaveValue("erin");
  await page.getByText(/^Game options ·/).click();
  await page.getByLabel("Who starts?").selectOption("erin");
  fixture.family.playerAccess.erin = {
    revision: 1,
    userId: null,
    archived: true,
  };
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(names.nth(1)).toHaveValue("");
  await expect(page.getByLabel("Who starts?")).toHaveValue("random");
  await expect(names.nth(1).locator('option[value="erin"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start game", exact: true }),
  ).toBeDisabled();
  await names.nth(1).selectOption("nate");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Round 1", exact: true }),
  ).toBeVisible();
  fixture.family.playerAccess.nate = {
    revision: 1,
    userId: null,
    archived: true,
  };
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByText("Nate", { exact: true }).first()).toBeVisible();
  expect(["doug", "nate"]).toContain(
    fixture.game().definition.initialStartingPlayerId,
  );
  expect(fixture.game().definition.players.map((player) => player.id)).toEqual([
    "doug",
    "nate",
  ]);
});
