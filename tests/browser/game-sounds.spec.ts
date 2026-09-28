import { test, expect, type Page } from "@playwright/test";
import {
  applyCommand,
  createGame,
  type GameState,
} from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import { installFixture } from "./fixtures/crokinole";
import type { Letter } from "../../src/domain/types";

async function instrumentAudio(page: Page) {
  // Fetch real assets and identify game cues by size, without making CI audible.
  await page.addInitScript(() => {
    const log: number[] = [];
    Object.assign(window, { soundStarts: log });
    class Context {
      state = "running";
      currentTime = 0;
      destination = {};
      async resume() {
        this.state = "running";
      }
      async close() {
        this.state = "closed";
      }
      async decodeAudioData(bytes: ArrayBuffer) {
        return { duration: 1, size: bytes.byteLength };
      }
      createGain() {
        return {
          connect() {},
          disconnect() {},
          gain: {
            value: 1,
            cancelScheduledValues() {},
            setValueAtTime(value: number) {
              this.value = value;
            },
            linearRampToValueAtTime(value: number) {
              this.value = value;
            },
          },
        };
      }
      createBufferSource() {
        return {
          buffer: null as { size: number } | null,
          loop: false,
          onended: null as (() => void) | null,
          connect() {},
          disconnect() {},
          start() {
            if (!this.loop) log.push(this.buffer!.size);
          },
          stop() {
            this.onended?.();
          },
        };
      }
    }
    Object.assign(window, { AudioContext: Context });
  });
}
const starts = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { soundStarts: number[] }).soundStarts,
  );
function initialGame() {
  const r = createGame({
    id: "sound-test",
    players: [
      { id: "ada", name: "Ada", seat: 0 },
      { id: "ben", name: "Ben", seat: 2 },
    ],
    firstPlayerId: "ada",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!r.ok) throw Error(r.error.message);
  return r.game;
}
function bingo(game: GameState) {
  const r = applyCommand(
    game,
    {
      type: "play",
      id: "reading",
      expectedRevision: game.revision,
      placements: [..."READING"].map((letter, i) => ({
        row: 7,
        col: 7 + i,
        tile: { letter: letter as Letter, blank: false },
      })),
    },
    testLexicon,
  );
  if (!r.ok) throw Error(r.error.message);
  return r.game;
}

test("viewer sounds unlock on tap, play committed cues, suppress refresh and reconnect", async ({
  page,
}) => {
  await instrumentAudio(page);
  let game = initialGame();
  let failed = false;
  await page.route("**/api/watch", (route) =>
    failed ? route.abort() : route.fulfill({ json: { game } }),
  );
  await page.route("**/api/watch/draft", (route) =>
    route.fulfill({ json: { revision: game.revision, draft: null } }),
  );
  await page.goto(`/watch#${"a".repeat(64)}`);
  await page
    .getByRole("button", { name: "Enable game sounds", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mute game sounds", exact: true }),
  ).toBeVisible();
  expect(await starts(page)).toEqual([]);
  game = bingo(game);
  await expect.poll(() => starts(page), { timeout: 12000 }).toEqual([709696]);
  await page.reload();
  await page
    .getByRole("button", { name: "Enable game sounds", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mute game sounds", exact: true }),
  ).toBeVisible();
  expect(await starts(page)).toEqual([]);
  failed = true;
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Reconnecting",
    {
      timeout: 12000,
    },
  );
  const end = {
    ...game,
    status: "finalized" as const,
    revision: game.revision + 1,
    result: {
      winnerIds: ["ada"],
      scores: game.scores,
      reason: "early",
      assisted: false,
      unequalTurns: false,
      scoresBeforeAdjustments: game.scores,
      adjustments: {},
    },
  };
  game = end as GameState;
  failed = false;
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0, {
    timeout: 12000,
  });
  expect(await starts(page)).toEqual([]);
});

test("scorer keeps drafts silent, retries unavailable audio, then sounds a saved bingo", async ({
  page,
}, info) => {
  await instrumentAudio(page);
  let failAudio = true;
  await page.route("**/sounds/*.wav", (route) =>
    failAudio
      ? route.fulfill({ status: 503, body: "unavailable" })
      : route.continue(),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /New preview game/ }).click();
  for (const name of ["Ada", "Ben"]) {
    await page.getByRole("textbox", { name: "Player name" }).fill(name);
    await page.getByRole("button", { name: "Add player", exact: true }).click();
  }
  await page.getByLabel("Who plays first?").selectOption({ label: "Ada" });
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable game sounds", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry game sounds", exact: true }),
  ).toBeVisible();
  failAudio = false;
  await page
    .getByRole("button", { name: "Retry game sounds", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mute game sounds", exact: true }),
  ).toBeVisible();
  await page.getByTestId("cell-H8").click();
  await page
    .getByRole("textbox", { name: "Type letters on the board" })
    .pressSequentially("READING");
  expect(await starts(page)).toEqual([]);
  await page.getByRole("button", { name: "Review turn", exact: true }).click();
  expect(await starts(page)).toEqual([]);
  await page
    .getByRole("button", { name: "Record 70 points", exact: true })
    .click();
  await expect.poll(() => starts(page)).toEqual([709696]);
  await page
    .getByRole("button", { name: "Mute game sounds", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Enable game sounds", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("scorer-sound-control.png") });
});

test("real browser audio unlocks and decodes all six packaged recordings", async ({
  page,
}, info) => {
  const game = initialGame();
  await page.route("**/api/watch", (route) =>
    route.fulfill({ json: { game } }),
  );
  await page.route("**/api/watch/draft", (route) =>
    route.fulfill({ json: { revision: 0, draft: null } }),
  );
  await page.goto(`/watch#${"a".repeat(64)}`);
  await page
    .getByRole("button", { name: "Enable game sounds", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mute game sounds", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("viewer-sound-control.png") });
  await page
    .getByRole("button", { name: "Mute game sounds", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Enable game sounds", exact: true }),
  ).toBeVisible();
});

for (const listener of ["ada", "ben"]) {
  test(`signed-in ${listener} hears shared bingo and only their own turn bell`, async ({
    page,
  }) => {
    await instrumentAudio(page);
    const f = await installFixture(page);
    f.family.member.playerId = listener;
    f.family.players = [
      { id: "ada", name: "Ada" },
      { id: "ben", name: "Ben" },
    ];
    const game = initialGame();
    f.family.games.push(game);
    f.family.gameAccess[game.id] = {
      scorerUserId: "another-scorer",
      deviceId: "another-device",
      generation: 1,
      mode: "confirmed",
      recordsEligible: true,
      protests: [],
      canScore: false,
      approvals: [],
    };
    await page.route("**/api/family/draft*", (route) =>
      route.fulfill({ json: { draft: null } }),
    );
    await page.goto("/family");
    await page
      .getByRole("button", { name: "View current game", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Enable game sounds", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Mute game sounds", exact: true }),
    ).toBeVisible();
    expect(await starts(page)).toEqual([]);
    f.family.games[0] = bingo(game);
    await expect
      .poll(() => starts(page), { timeout: 12000 })
      .toEqual(listener === "ben" ? [709696, 424934] : [709696]);
  });
}
