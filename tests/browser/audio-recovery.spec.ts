import { test, expect, type Page } from "@playwright/test";
import { createGame, applyCommand } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import { installFixture } from "./fixtures/crokinole";

declare global {
  interface Window {
    diagnosticAudio: {
      contexts: AudioContext[];
      starts: number;
      resumes: number;
    };
  }
}

async function observe(page: Page) {
  await page.addInitScript(() => {
    const contexts: AudioContext[] = [];
    Object.assign(window, {
      diagnosticAudio: { contexts, starts: 0, resumes: 0 },
    });
    const Base = window.AudioContext;
    class Observed extends Base {
      constructor(...args: ConstructorParameters<typeof Base>) {
        super(...args);
        contexts.push(this);
      }
      resume() {
        window.diagnosticAudio.resumes++;
        return super.resume();
      }
    }
    Object.assign(window, { AudioContext: Observed });
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (
      ...args: Parameters<typeof start>
    ) {
      window.diagnosticAudio.starts++;
      return start.apply(this, args);
    };
  });
}
const counts = (page: Page) =>
  page.evaluate(() => {
    const d = window.diagnosticAudio;
    return {
      starts: d.starts,
      resumes: d.resumes,
      states: d.contexts.map((c: AudioContext) => c.state),
    };
  });

test("native participant audio survives three rounds, interruption, closure and foreground return while respecting mute", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const otherContext = await browser.newContext({
    viewport: page.viewportSize()!,
    isMobile: true,
    hasTouch: true,
    baseURL: "http://127.0.0.1:4319",
  });
  const other = await otherContext.newPage();
  const made = createGame({
    id: "sound-diagnostic",
    players: [
      { id: "ada", name: "Ada", seat: 0 },
      { id: "ben", name: "Ben", seat: 2 },
    ],
    firstPlayerId: "ada",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!made.ok) throw Error(made.error.message);
  let game = made.game;
  const states: Awaited<ReturnType<typeof installFixture>>["family"][] = [];
  const writes: string[] = [];
  for (const [view, listener] of [
    [page, "ada"],
    [other, "ben"],
  ] as const) {
    await observe(view);
    const fixture = await installFixture(view);
    fixture.family.member.playerId = listener;
    fixture.family.players = [
      { id: "ada", name: "Ada" },
      { id: "ben", name: "Ben" },
    ];
    fixture.family.games = [game];
    fixture.family.gameAccess[game.id] = {
      scorerUserId: "other-scorer",
      deviceId: "other-device",
      generation: 1,
      mode: "confirmed",
      recordsEligible: true,
      protests: [],
      canScore: false,
      approvals: [],
    };
    states.push(fixture.family);
    view.on("request", (request) => {
      if (
        /\/api\/family(?:\/draft)?(?:\?|$)/.test(request.url()) &&
        request.method() !== "GET"
      )
        writes.push(request.method());
    });
    await view.goto("/family");
    await view
      .getByRole("button", { name: "View current game", exact: true })
      .click();
    await view.getByRole("gridcell").nth(0).click();
    await expect
      .poll(async () => (await counts(view)).states)
      .toEqual(["running"]);
    await expect(
      view.getByRole("button", { name: "Mute game sounds", exact: true }),
    ).toHaveCount(1);
  }
  const plays = [
    [
      [7, 7, "A"],
      [7, 8, "T"],
    ],
    [[7, 9, "E"]],
    [[7, 6, "L"]],
    [[7, 10, "R"]],
    [
      [7, 11, "A"],
      [7, 12, "L"],
    ],
    [[7, 13, "S"]],
    [
      [6, 7, "C"],
      [8, 7, "T"],
    ],
    [[9, 7, "S"]],
  ] as const;
  const act = (index: number) => {
    const result = applyCommand(
      game,
      {
        type: "play",
        id: `sound-play-${index}`,
        expectedRevision: game.revision,
        placements: plays[index].map(([row, col, letter]) => ({
          row,
          col,
          tile: { letter, blank: false },
        })),
      },
      testLexicon,
    );
    if (!result.ok) throw Error(result.error.message);
    game = result.game;
    for (const shared of states) shared.games = [game];
  };
  for (let i = 0; i < 6; i++) {
    act(i);
    await expect
      .poll(async () => (await counts(page)).starts, { timeout: 12000 })
      .toBe(i + 1 + Math.floor((i + 1) / 2));
    await expect
      .poll(async () => (await counts(other)).starts, { timeout: 12000 })
      .toBe(i + 1 + Math.ceil((i + 1) / 2));
  }
  expect((await counts(page)).resumes).toBe(1);
  expect((await counts(other)).resumes).toBe(1);
  await other
    .getByRole("button", { name: "Mute game sounds", exact: true })
    .click();
  await other.getByRole("gridcell").nth(0).click();
  await expect(
    other.getByRole("button", { name: "Enable game sounds", exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await window.diagnosticAudio.contexts[0].suspend();
  });
  await expect(
    page.getByRole("button", { name: "Retry game sounds", exact: true }),
  ).toBeVisible();
  // Synthetic events must not unlock a device; an ordinary trusted tap must.
  await page
    .getByRole("gridcell")
    .nth(0)
    .dispatchEvent("pointerup", { bubbles: true });
  expect((await counts(page)).resumes).toBe(1);
  await page.getByRole("gridcell").nth(0).click();
  await expect
    .poll(async () => (await counts(page)).states)
    .toEqual(["running"]);
  expect((await counts(page)).starts).toBe(9);
  act(6);
  await expect
    .poll(async () => (await counts(page)).starts, { timeout: 12000 })
    .toBe(10);
  await page.evaluate(async () => {
    await window.diagnosticAudio.contexts[0].close();
  });
  await expect(
    page.getByRole("button", { name: "Retry game sounds", exact: true }),
  ).toBeVisible();
  await page.getByRole("gridcell").nth(0).click();
  await expect
    .poll(async () => (await counts(page)).states)
    .toEqual(["closed", "running"]);
  expect((await counts(page)).starts).toBe(10);
  act(7);
  await expect
    .poll(async () => (await counts(page)).starts, { timeout: 12000 })
    .toBe(12);
  expect((await counts(other)).starts).toBe(9);
  expect((await counts(other)).resumes).toBe(1);
  await page.evaluate(async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await window.diagnosticAudio.contexts.at(-1)!.suspend();
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("button", { name: "Retry game sounds", exact: true }),
  ).toBeVisible();
  await page.getByRole("gridcell").nth(0).click();
  await expect
    .poll(async () => (await counts(page)).states.at(-1))
    .toBe("running");
  // Let a normal snapshot poll pass: recovery must not replay historical cues.
  await page.waitForTimeout(5500);
  expect((await counts(page)).starts).toBe(12);
  expect(writes).toEqual([]);
  await otherContext.close();
});

test("scorer sound survives three rounds with gesture recovery and respects mute after reopening", async ({
  page,
}) => {
  test.setTimeout(120000);
  await observe(page);
  await page.goto("/");
  await page.getByRole("button", { name: /New preview game/ }).click();
  for (const name of ["Ada", "Ben"]) {
    await page.getByRole("textbox", { name: "Player name" }).fill(name);
    await page.getByRole("button", { name: "Add player", exact: true }).click();
  }
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.getByRole("button", { name: "Begin play", exact: true }).click();
  await expect
    .poll(async () => (await counts(page)).states)
    .toEqual(["running"]);
  const plays = [
    ["H8", "AT"],
    ["J8", "E"],
    ["G8", "L"],
    ["K8", "R"],
    ["L8", "AL"],
    ["N8", "S"],
  ];
  for (let i = 0; i < plays.length; i++) {
    if (i === 3) {
      await page.evaluate(async () => {
        await window.diagnosticAudio.contexts[0].suspend();
      });
      await expect(
        page.getByRole("button", { name: "Retry game sounds", exact: true }),
      ).toBeVisible();
    }
    await page.getByTestId(`cell-${plays[i][0]}`).click();
    await expect
      .poll(async () => (await counts(page)).states)
      .toEqual(["running"]);
    await page
      .getByRole("textbox", { name: "Type letters on the board" })
      .pressSequentially(plays[i][1]);
    await page
      .getByRole("button", { name: "Review turn", exact: true })
      .click();
    await page.getByRole("button", { name: /^Record \d+ points?$/ }).click();
    await expect.poll(async () => (await counts(page)).starts).toBe(i + 1);
  }
  expect((await counts(page)).resumes).toBe(2);
  await page
    .getByRole("button", { name: "Mute game sounds", exact: true })
    .click();
  await page.evaluate(async () => {
    await window.diagnosticAudio.contexts[0].suspend();
  });
  await page.getByTestId("cell-A1").click();
  await expect(
    page.getByRole("button", { name: "Enable game sounds", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  expect((await counts(page)).resumes).toBe(2);
  await page.reload();
  await page
    .getByRole("button", { name: "Return to game", exact: true })
    .click();
  await page.getByTestId("cell-A1").click();
  await expect(
    page.getByRole("button", { name: "Enable game sounds", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(await counts(page)).toEqual({ starts: 0, resumes: 0, states: [] });
});
