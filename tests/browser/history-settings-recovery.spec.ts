import { expect, test } from "@playwright/test";
import { installFixture } from "./fixtures/crokinole";
import { DEFAULT_CROKINOLE_SETTINGS } from "../../src/domain/crokinole-defaults";
import type { CrokinoleMutation } from "../../src/lib/crokinole-contract";
import type { GameSummary } from "../../src/lib/game-summary";
import { replayFixture } from "../fixtures/replay";

test("independent settings editors retain drafts and cannot overwrite newer defaults or colours", async ({
  page,
  browser,
}) => {
  const fixture = await installFixture(page, DEFAULT_CROKINOLE_SETTINGS);
  fixture.shared.palette.colours.push({
    id: "ocean",
    name: "Ocean",
    value: "#356a4e",
    isDefault: false,
    isActive: true,
    sortOrder: 10,
  });
  const peerContext = await browser.newContext();
  try {
    const peer = await peerContext.newPage();
    await installFixture(peer, DEFAULT_CROKINOLE_SETTINGS);
    let accepted = 0;
    for (const client of [page, peer]) {
      await client.route("**/api/family/crokinole*", async (route) => {
        if (route.request().method() === "GET")
          return route.fulfill({ json: fixture.shared });
        const { operation } = route
          .request()
          .postDataJSON() as CrokinoleMutation;
        if (
          operation.type !== "save-defaults" &&
          operation.type !== "save-palette"
        )
          throw Error("Unexpected test operation");
        if (operation.expectedRevision !== fixture.shared.palette.revision)
          return route.fulfill({
            status: 409,
            json: {
              error: "Settings changed. Review the saved values.",
              code: "STALE_PALETTE",
            },
          });
        fixture.shared.palette = {
          ...fixture.shared.palette,
          revision: fixture.shared.palette.revision + 1,
          ...(operation.type === "save-defaults"
            ? { defaults: operation.defaults }
            : { colours: operation.colours }),
        };
        accepted++;
        return route.fulfill({ json: { palette: fixture.shared.palette } });
      });
    }
    await page.goto("/family/settings");
    await peer.goto(page.url());
    for (const client of [page, peer])
      await client
        .getByRole("button", {
          name: "Crokinole rules & family defaults",
          exact: true,
        })
        .click();
    await page.getByLabel("Default target", { exact: true }).fill("350");
    await peer.getByLabel("Default target", { exact: true }).fill("500");
    await peer
      .getByRole("button", { name: "Save family defaults", exact: true })
      .click();
    await expect(peer.getByRole("dialog")).toHaveCount(0);
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(
      page.getByText(/Family defaults changed while this form was open/),
    ).toBeVisible();
    await expect(
      page.getByLabel("Default target", { exact: true }),
    ).toHaveValue("350");
    await expect(
      page.getByRole("button", { name: "Save family defaults", exact: true }),
    ).toBeDisabled();
    expect(accepted).toBe(1);
    await page
      .getByRole("button", {
        name: "Discard my changes and load saved defaults",
      })
      .click();
    await expect(
      page.getByLabel("Default target", { exact: true }),
    ).toHaveValue("500");
    await page.getByLabel("Default target", { exact: true }).fill("550");
    await page
      .getByRole("button", { name: "Save family defaults", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(fixture.shared.palette.defaults?.endCondition).toEqual({
      type: "target",
      target: 550,
    });
    for (const client of [page, peer]) {
      await client.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      await client
        .getByRole("button", { name: "Crokinole piece colours", exact: true })
        .click();
      await client
        .getByRole("button", { name: "Edit Ocean", exact: true })
        .click();
    }
    await page
      .getByLabel("Colour name", { exact: true })
      .fill("My unsaved colour");
    await peer.getByLabel("Colour name", { exact: true }).fill("Pacific");
    await peer
      .getByRole("button", { name: "Save colour", exact: true })
      .click();
    await expect(
      peer.getByRole("button", { name: "Edit Pacific", exact: true }),
    ).toBeVisible();
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(
      page.getByText(/Piece colours changed while you were editing/),
    ).toBeVisible();
    await expect(page.getByLabel("Colour name", { exact: true })).toHaveValue(
      "My unsaved colour",
    );
    await expect(
      page.getByRole("button", { name: "Save colour", exact: true }),
    ).toBeDisabled();
    expect(accepted).toBe(3);
    expect(
      fixture.shared.palette.colours.find((c) => c.id === "ocean")?.name,
    ).toBe("Pacific");
    await page
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit Pacific", exact: true })
      .click();
    await expect(page.getByLabel("Colour name", { exact: true })).toHaveValue(
      "Pacific",
    );
  } finally {
    await peerContext.close();
  }
});

test("history and standings recheck on explicit refresh and returning focus without changing filters", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  let score = 10;
  let denied = false;
  const queries: string[] = [];
  await page.route("**/api/family/games?*", (route) => {
    queries.push(route.request().url());
    if (denied)
      return route.fulfill({
        status: 403,
        json: { error: "Family access ended." },
      });
    const game: GameSummary = {
      gameType: "crokinole",
      id: "saved-disc",
      createdAt: "2026-10-01T12:00:00Z",
      status: "completed",
      participants: [
        { id: "doug", name: "Doug" },
        { id: "erin", name: "Erin" },
      ],
      totals: { doug: score, erin: 0 },
      winnerIds: ["doug"],
      mode: "confirmed",
      scorerUserId: fixture.family.member.userId,
      revision: 1,
    };
    return route.fulfill({
      json: { games: [game], nextCursor: null, standings: [] },
    });
  });
  await page.goto("/family/history");
  await page
    .getByRole("combobox", { name: "Game", exact: true })
    .selectOption("crokinole");
  await expect(page.locator(".history-participant-score").first()).toHaveText(
    "10 points",
  );
  score = 25;
  await page
    .getByRole("button", { name: "Refresh history & standings", exact: true })
    .click();
  await expect(page.locator(".history-participant-score").first()).toHaveText(
    "25 points",
  );
  await expect(page.getByText(/Checked at/)).toBeVisible();
  score = 40;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".history-participant-score").first()).toHaveText(
    "40 points",
  );
  await expect(
    page.getByRole("combobox", { name: "Game", exact: true }),
  ).toHaveValue("crokinole");
  expect(new URL(queries.at(-1)!).searchParams.get("gameType")).toBe(
    "crokinole",
  );
  denied = true;
  await page
    .getByRole("button", { name: "Refresh history & standings", exact: true })
    .click();
  await expect(
    page.getByText("Family access ended.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".hub-history-row")).toHaveCount(0);
});

test("background changes preserve loaded history pages and defer summary reads during replay", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await installFixture(page);
  const recorded = replayFixture().game;
  fixture.family.games = [recorded];
  fixture.family.gameAccess[recorded.id] = {
    scorerUserId: fixture.family.member.userId,
    deviceId: "fixture",
    generation: 1,
    mode: "confirmed",
    recordsEligible: false,
    protests: [],
    canScore: false,
    approvals: [],
  };
  const summary = (id: string): GameSummary => ({
    gameType: "scrabble",
    id,
    createdAt: recorded.definition.createdAt,
    status: "finalized",
    participants: recorded.players.map(({ id, name }) => ({ id, name })),
    totals: recorded.result!.scores,
    winnerIds: recorded.result!.winnerIds,
    mode: "confirmed",
    scorerUserId: fixture.family.member.userId,
    revision: recorded.revision,
  });
  const queries: string[] = [];
  await page.route("**/api/family/games?*", (route) => {
    queries.push(route.request().url());
    const older = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill({
      json: {
        games: [summary(older ? "older-summary" : recorded.id)],
        nextCursor: older ? null : "older-page",
        ...(older ? {} : { standings: [] }),
      },
    });
  });
  await page.goto("/family/history");
  const gameFilter = page.getByRole("combobox", { name: "Game", exact: true });
  const playerFilter = page.getByRole("combobox", {
    name: "Player",
    exact: true,
  });
  const refresh = page.getByRole("button", {
    name: "Refresh history & standings",
    exact: true,
  });
  const notice = page.getByText(
    "History may have changed. Your loaded games are kept here until you refresh.",
    { exact: true },
  );
  await gameFilter.selectOption("scrabble");
  await playerFilter.selectOption("doug");
  await page.getByRole("button", { name: "More games", exact: true }).click();
  await expect(page.locator(".hub-history-row")).toHaveCount(2);
  const beforeFocus = queries.length;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(notice).toBeVisible();
  await expect(page.locator(".hub-history-row")).toHaveCount(2);
  expect(queries).toHaveLength(beforeFocus);
  await expect(
    page.getByText(
      /It starts again at the newest games and keeps your filters/,
    ),
  ).toBeVisible();
  await refresh.click();
  await expect(page.locator(".hub-history-row")).toHaveCount(1);
  await expect(notice).toHaveCount(0);
  await expect(gameFilter).toHaveValue("scrabble");
  await expect(playerFilter).toHaveValue("doug");

  await page.getByRole("button", { name: "More games", exact: true }).click();
  await expect(page.locator(".hub-history-row")).toHaveCount(2);
  const beforeEpoch = queries.length;
  fixture.family.gameAccess[recorded.id].generation++;
  await page.clock.runFor(5001); // The shared-store poll changes HubHistory's epoch.
  await expect(notice).toBeVisible();
  await expect(page.locator(".hub-history-row")).toHaveCount(2);
  expect(queries).toHaveLength(beforeEpoch);

  // Changing filters is a new scope and must read even after deeper pages loaded.
  await playerFilter.selectOption("erin");
  await expect(page.locator(".hub-history-row")).toHaveCount(1);
  await expect(notice).toHaveCount(0);
  expect(new URL(queries.at(-1)!).searchParams.get("playerId")).toBe("erin");
  await page
    .getByRole("button", { name: /^Replay / })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "Recorded game replay" }),
  ).toBeVisible();
  const duringReplay = queries.length;
  fixture.family.gameAccess[recorded.id].generation++;
  await page.clock.runFor(5001);
  await expect(notice).toHaveCount(1);
  await expect(notice).toBeHidden();
  expect(queries).toHaveLength(duringReplay);
  await page
    .getByRole("button", { name: "Close replay", exact: true })
    .last()
    .click();
  await expect(notice).toBeVisible();
  await expect(playerFilter).toHaveValue("erin");
  await refresh.click();
  await expect(notice).toHaveCount(0);
});
