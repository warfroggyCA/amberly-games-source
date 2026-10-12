import { expect, test, type Page } from "@playwright/test";
import { createGame, type GameState } from "../../src/domain/game";
import {
  coachingPosition,
  rackContinuity,
} from "../../src/domain/turn-coaching";
import { testLexicon } from "../../src/lib/test-lexicon";
import { replayAction, replayCat } from "../fixtures/replay";
import { fitsWidth } from "./fixtures/crokinole";

async function setup(page: Page, afterPlay = true) {
  const created = createGame({
    id: "private-coaching",
    coaching: true,
    players: [
      { id: "a", name: "Ada", seat: 0 },
      { id: "b", name: "Ben", seat: 2 },
    ],
    firstPlayerId: "a",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!created.ok) throw Error(created.error.message);
  let game = afterPlay
    ? replayAction(created.game, { type: "play", placements: replayCat })
    : created.game;
  const traffic: string[] = [];
  page.on("request", (r) =>
    traffic.push(r.method() + " " + r.url() + " " + (r.postData() ?? "")),
  );
  await page.addInitScript(() => {
    const w = window as typeof window & { rackWrites: string[] };
    w.rackWrites = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      w.rackWrites.push(k + v);
      return original.call(this, k, v);
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      w.rackWrites.push(JSON.stringify(args));
      return put.apply(this, args);
    };
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      w.rackWrites.push(JSON.stringify(args));
      return add.apply(this, args);
    };
  });
  await page.route("**/api/watch**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/watch/coaching")
      return route.fulfill({
        json: {
          position: coachingPosition(game, url.searchParams.get("turnId")!),
        },
      });
    if (url.pathname === "/api/watch/draft")
      return route.fulfill({
        json: { draft: null, revision: game.revision, generation: 1 },
      });
    const {
      id,
      players,
      board,
      scores,
      turns,
      order,
      status,
      pendingEnd,
      currentPlayerId,
      expectedBagCount,
      expectedRackCounts,
      revision,
    } = game;
    return route.fulfill({
      json: {
        game: {
          id,
          players,
          board,
          scores,
          turns,
          order,
          status,
          pendingEnd,
          currentPlayerId,
          expectedBagCount,
          expectedRackCounts,
          revision,
          coaching: true,
          coachingEpoch: rackContinuity(game),
          scorerGeneration: 1,
          result: null,
        },
      },
    });
  });
  await page.goto(`/watch#${"a".repeat(64)}`);
  await page
    .getByRole("button", { name: "Post-turn coaching", exact: true })
    .click();
  await page.getByLabel("Your seat").selectOption("a");
  return {
    traffic,
    get game() {
      return game;
    },
    set game(value: GameState) {
      game = value;
    },
  };
}
test("guest privately compares the original turn with distinct medals; reload loses the rack", async ({
  page,
}, info) => {
  const f = await setup(page);
  await page.getByLabel("Registered turn").selectOption(f.game.turns[0].id);
  const rack = page.getByLabel(/^Full rack before/);
  await rack.fill("CATEIRS");
  await page
    .getByRole("button", { name: "Review this turn", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /^gold ·/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^silver ·/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^bronze ·/ })).toBeVisible();
  await expect(page.locator(".coaching-board .fresh")).toHaveCount(3);
  await page.getByRole("button", { name: /^gold ·/ }).click();
  await expect(page.locator(".coaching-board")).toBeVisible();
  await fitsWidth(page);
  await page.screenshot({
    path: info.outputPath("private-turn-coaching.png"),
    fullPage: true,
  });
  expect(f.traffic.some((t) => t.includes("CATEIRS"))).toBe(false);
  expect(f.traffic.some((t) => t.startsWith("POST"))).toBe(false);
  const stored = await page.evaluate(
    () => (window as typeof window & { rackWrites: string[] }).rackWrites,
  );
  expect(stored.some((t) => t.includes("CATEIRS"))).toBe(false);
  await page.reload();
  await page
    .getByRole("button", { name: "Post-turn coaching", exact: true })
    .click();
  await page.getByLabel("Your seat").selectOption("a");
  await page.getByLabel("Registered turn").selectOption(f.game.turns[0].id);
  await expect(rack).toHaveValue("");
});
test("automatic rack snapshot excludes refills and unknown revisions require confirmation", async ({
  page,
}) => {
  const f = await setup(page, false);
  await page
    .getByText("Optional private rack tracking", { exact: true })
    .click();
  await page.getByLabel("Starting or current full rack").fill("CATEIRS");
  await page
    .getByRole("button", { name: "Confirm current rack", exact: true })
    .click();
  f.game = replayAction(f.game, { type: "play", placements: replayCat });
  await expect(
    page.getByText("Enter the tiles you drew to complete your current rack.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 12000 });
  await page.getByLabel("Newly drawn tiles").fill("DOG");
  await page
    .getByRole("button", { name: "Save drawn tiles", exact: true })
    .click();
  await page.getByLabel("Registered turn").selectOption(f.game.turns[0].id);
  await expect(page.getByLabel(/^Full rack before/)).toHaveValue("CATEIRS");
  expect(
    f.traffic.some((t) => t.includes("CATEIRS") || t.includes("EIRSDOG")),
  ).toBe(false);
  f.game = replayAction(f.game, {
    type: "edit-turn",
    turnId: f.game.turns[0].id,
    placements: replayCat.map((p, i) =>
      i === 0 ? { ...p, tile: { ...p.tile, blank: true } } : p,
    ),
    reason: "Blank correction",
  });
  await expect(page.getByText(/Game history or inventory changed/)).toBeVisible(
    {
      timeout: 12000,
    },
  );
  await page.getByRole("button", { name: "Refresh turn review" }).click();
  await expect(page.getByLabel(/^Full rack before/)).toHaveValue("");
  await expect(
    page.getByText(/This shows the original move and original board/),
  ).toBeVisible();
});
test("changing seats and closing cancel private analysis without stale errors", async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel("Registered turn").selectOption(f.game.turns[0].id);
  await page.getByLabel(/^Full rack before/).fill("CATEIRS");
  await page
    .getByRole("button", { name: "Review this turn", exact: true })
    .click();
  await page.getByLabel("Your seat").selectOption("b");
  await expect(
    page.getByText(
      "Review becomes available after your first registered turn.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^gold ·/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
