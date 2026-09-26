import { expect, test, type Page } from "@playwright/test";
import { createGame } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import { fitsWidth, installFixture } from "./fixtures/crokinole";

interface AudioAudit {
  contexts: number;
  starts: number;
  closes: number;
  activeLoops: number[];
  decoded: { duration: number; channels: number; signature: string }[];
}

async function auditRealAudio(page: Page) {
  // Decode, schedule and stop real Web Audio. A final zero-gain node keeps CI silent.
  await page.addInitScript(() => {
    const NativeContext = window.AudioContext;
    const audit: AudioAudit = {
      contexts: 0,
      starts: 0,
      closes: 0,
      activeLoops: [],
      decoded: [],
    };
    const live = new Set<number>();
    let serial = 0;
    class AuditedContext extends NativeContext {
      private silent: GainNode;
      constructor() {
        super();
        audit.contexts++;
        this.silent = NativeContext.prototype.createGain.call(this);
        this.silent.gain.value = 0;
        this.silent.connect(this.destination);
      }
      createGain() {
        const gain = super.createGain();
        const connect = gain.connect.bind(gain);
        gain.connect = ((destination: AudioNode) =>
          connect(
            destination === this.destination ? this.silent : destination,
          )) as typeof gain.connect;
        return gain;
      }
      async decodeAudioData(bytes: ArrayBuffer) {
        const signature = String.fromCharCode(
          ...new Uint8Array(bytes.slice(0, 4)),
        );
        const buffer = await super.decodeAudioData(bytes);
        audit.decoded.push({
          duration: buffer.duration,
          channels: buffer.numberOfChannels,
          signature,
        });
        return buffer;
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        const id = ++serial;
        source.start = (...args: Parameters<typeof source.start>) => {
          start(...args);
          audit.starts++;
          if (source.loop) live.add(id);
          audit.activeLoops = [...live];
        };
        source.addEventListener("ended", () => {
          live.delete(id);
          audit.activeLoops = [...live];
        });
        return source;
      }
      async close() {
        audit.closes++;
        await super.close();
      }
    }
    Object.assign(window, {
      AudioContext: AuditedContext,
      lobbyAudioAudit: audit,
    });
  });
}
const audio = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { lobbyAudioAudit: AudioAudit }).lobbyAudioAudit,
  );

async function setup(page: Page) {
  await auditRealAudio(page);
  const fixture = await installFixture(page);
  const created = createGame({
    id: "lobby-music-game",
    players: [
      { id: "doug", name: "Doug", seat: 0 },
      { id: "erin", name: "Erin", seat: 2 },
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!created.ok) throw new Error(created.error.message);
  fixture.family.games.push(created.game);
  fixture.family.gameAccess[created.game.id] = {
    scorerUserId: fixture.family.member.userId,
    deviceId: "music-test-device",
    generation: 1,
    mode: "confirmed",
    recordsEligible: true,
    protests: [],
    approvals: [],
    canScore: true,
  };
  await page.route("**/api/family/games?*", (route) =>
    route.fulfill({ json: { games: [], nextCursor: null, standings: [] } }),
  );
  await page.route("**/api/family/draft*", (route) =>
    route.fulfill({ json: { draft: null } }),
  );
  await page.route("**/api/family/gym*", (route) =>
    route.fulfill({
      json: {
        identity: {
          familyId: fixture.family.family.id,
          userId: fixture.family.member.userId,
          playerId: "doug",
        },
        sessions: [],
        nextCursor: null,
      },
    }),
  );
  await page.route("**/api/family/words", (route) =>
    route.fulfill({ json: { words: [] } }),
  );
  await page.goto("/family");
  await expect(
    page.getByRole("heading", { name: "What are we playing?", exact: true }),
  ).toBeVisible();
}

async function musicMenu(page: Page) {
  const menu = page.locator(".lobby-music");
  await expect(menu).toBeVisible();
  if ((await menu.getAttribute("open")) === null)
    await menu.locator("summary").click();
  return menu;
}
async function playMusic(page: Page, resume = false) {
  const menu = await musicMenu(page);
  await menu
    .getByRole("button", {
      name: resume ? "Resume lobby music" : "Enable lobby music",
      exact: true,
    })
    .click();
  await expect(
    menu.getByRole("button", { name: "Turn off lobby music", exact: true }),
  ).toBeVisible();
  await menu.locator("summary").click();
}

test("chosen lobby FLAC decodes and loops after a tap, with remembered volume and a fitting phone menu", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  expect(await audio(page)).toMatchObject({
    contexts: 0,
    starts: 0,
    activeLoops: [],
  });
  const menu = await musicMenu(page);
  await expect(
    menu.getByText("Somewhere in the Elevator", { exact: true }),
  ).toBeVisible();
  await expect(
    menu.getByRole("link", { name: "Licence", exact: true }),
  ).toHaveAttribute("href", /creativecommons\.org\/licenses\/by\/4\.0/);
  const panel = (await menu.locator(".lobby-music-panel").boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(391);
  const summary = (await menu.locator("summary").boundingBox())!;
  const brand = (await page.locator("header .brand").boundingBox())!;
  expect(summary.x).toBeGreaterThanOrEqual(brand.x + brand.width - 1);
  expect(
    Math.abs(summary.y + summary.height / 2 - brand.y - brand.height / 2),
  ).toBeLessThan(24);
  const slider = menu.getByRole("slider", {
    name: "Music volume",
    exact: true,
  });
  await expect(slider).toHaveValue("20");
  await slider.focus();
  for (let step = 0; step < 3; step++) await slider.press("ArrowRight");
  await expect(slider).toHaveValue("35");
  await menu
    .getByRole("button", { name: "Enable lobby music", exact: true })
    .click();
  await expect(
    menu.getByRole("button", { name: "Turn off lobby music", exact: true }),
  ).toBeVisible();
  const playing = await audio(page);
  expect(playing.contexts).toBe(1);
  expect(playing.starts).toBe(1);
  expect(playing.activeLoops).toHaveLength(1);
  expect(playing.decoded).toHaveLength(1);
  expect(playing.decoded[0].signature).toBe("fLaC");
  expect(playing.decoded[0].duration).toBeGreaterThan(10);
  await fitsWidth(page);
  await page.screenshot({
    path: info.outputPath("lobby-music-phone-menu.png"),
  });
  await menu
    .getByRole("button", { name: "Turn off lobby music", exact: true })
    .click();
  await expect.poll(async () => (await audio(page)).activeLoops).toEqual([]);
  await page.reload();
  const restored = await musicMenu(page);
  await expect(
    restored.getByRole("slider", { name: "Music volume", exact: true }),
  ).toHaveValue("35");
  await expect(
    restored.getByRole("button", { name: "Enable lobby music", exact: true }),
  ).toBeVisible();
  expect(await audio(page)).toMatchObject({
    contexts: 0,
    starts: 0,
    activeLoops: [],
  });
});

test("lobby navigation keeps one loop, while internal and routed Scrabble play both silence it", async ({
  page,
}) => {
  await setup(page);
  await playMusic(page);
  for (const name of ["History", "Players", "Settings"]) {
    await page
      .getByRole("navigation", { name: "Amberly Games", exact: true })
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/family/${name.toLowerCase()}$`));
    await expect(page.locator(".lobby-music > summary")).toHaveAttribute(
      "data-playing",
      "true",
    );
    expect(await audio(page)).toMatchObject({
      contexts: 1,
      starts: 1,
      activeLoops: [1],
    });
  }
  await page
    .getByRole("button", { name: "Scrabble records", exact: true })
    .click();
  await expect(page).toHaveURL(/\/family\/scrabble\?view=records$/);
  await expect(page.locator(".lobby-music > summary")).toHaveAttribute(
    "data-playing",
    "true",
  );
  await page
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Game navigation", exact: true })
    .getByRole("button", { name: "Play", exact: true })
    .click();
  // Play changed inside ScorerApp; pathname/query still describe the earlier Records view.
  await expect(page).toHaveURL(/\/family\/scrabble\?view=records$/);
  await expect(
    page.getByRole("button", { name: "Enable game sounds", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".lobby-music")).toHaveCount(0);
  await expect.poll(async () => (await audio(page)).activeLoops).toEqual([]);
  await page
    .getByRole("link", { name: "Amberly Games — Home", exact: true })
    .click();
  await expect(page).toHaveURL(/\/family$/);
  const paused = await musicMenu(page);
  await expect(
    paused.getByRole("button", { name: "Resume lobby music", exact: true }),
  ).toBeVisible();
  expect((await audio(page)).starts).toBe(1);
  await playMusic(page, true);
  await page.getByRole("button", { name: "Resume game", exact: true }).click();
  await expect(page).toHaveURL(/\/family\/scrabble\?view=play$/);
  await expect(
    page.getByRole("button", { name: "Enable game sounds", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".lobby-music")).toHaveCount(0);
  await expect.poll(async () => (await audio(page)).activeLoops).toEqual([]);
  expect(await audio(page)).toMatchObject({ contexts: 1, starts: 2 });
});

test("background restore and Gym navigation cannot restart or duplicate lobby music", async ({
  page,
}) => {
  await setup(page);
  await playMusic(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => (await audio(page)).activeLoops).toEqual([]);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: false }),
    );
  });
  // A real bfcache restoration reloads FamilyWorkspace; default-off reload is covered above.
  await expect(page.locator(".lobby-music > summary")).toBeVisible();
  let menu = await musicMenu(page);
  const resume = menu.getByRole("button", {
    name: "Resume lobby music",
    exact: true,
  });
  await expect(resume).toBeVisible();
  expect((await audio(page)).activeLoops).toEqual([]);
  expect((await audio(page)).starts).toBe(1);
  await playMusic(page, true);
  const beforeGym = await audio(page);
  await page.getByRole("button", { name: "Open Gym", exact: true }).click();
  await expect(page).toHaveURL(/\/gym-lab\?from=family$/);
  await expect(
    page.getByRole("heading", { name: "Scrabble Gym", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".lobby-music")).toHaveCount(0);
  await expect.poll(async () => (await audio(page)).activeLoops).toEqual([]);
  await expect
    .poll(async () => (await audio(page)).closes)
    .toBe(beforeGym.closes + 1);
  await page.getByRole("link", { name: "Back to Games", exact: true }).click();
  await expect(page).toHaveURL(/\/family$/);
  menu = await musicMenu(page);
  await expect(
    menu.getByRole("button", { name: "Enable lobby music", exact: true }),
  ).toBeVisible();
  expect((await audio(page)).activeLoops).toEqual([]);
  expect((await audio(page)).starts).toBe(beforeGym.starts);
  await playMusic(page);
  expect((await audio(page)).activeLoops).toHaveLength(1);
  expect((await audio(page)).starts).toBe(beforeGym.starts + 1);
});
