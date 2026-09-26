import { expect, test, type Page } from "@playwright/test";
import { createGame } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import { fitsWidth, installFixture } from "./fixtures/crokinole";

interface AudioAudit {
  contexts: number;
  starts: number;
  closes: number;
  resumeAttempts: number;
  blockedAttempts: number;
  maxActiveLoops: number;
  activeLoops: number[];
  decoded: { duration: number; channels: number; signature: string }[];
}

async function auditRealAudio(page: Page, blockUntilGesture = false) {
  // Decode, schedule and stop real Web Audio. A final zero-gain node keeps CI silent.
  await page.addInitScript(
    ({ blockUntilGesture }) => {
      const NativeContext = window.AudioContext;
      const audit: AudioAudit = {
        contexts: 0,
        starts: 0,
        closes: 0,
        resumeAttempts: 0,
        blockedAttempts: 0,
        maxActiveLoops: 0,
        activeLoops: [],
        decoded: [],
      };
      const live = new Set<number>();
      let serial = 0;
      let trustedGesture = false;
      for (const type of ["click", "keydown"])
        window.addEventListener(
          type,
          (event) => {
            if (event.isTrusted) trustedGesture = true;
          },
          { capture: true },
        );
      class AuditedContext extends NativeContext {
        private silent: GainNode;
        private permissionGranted = false;
        constructor() {
          super();
          audit.contexts++;
          this.silent = NativeContext.prototype.createGain.call(this);
          this.silent.gain.value = 0;
          this.silent.connect(this.destination);
        }
        get state(): AudioContextState {
          const nativeState = super.state;
          // Headless engines may start running before resume is called. Keep the
          // permission boundary suspended until a trusted resume actually occurs.
          return blockUntilGesture &&
            !this.permissionGranted &&
            nativeState !== "closed"
            ? "suspended"
            : nativeState;
        }
        async resume() {
          audit.resumeAttempts++;
          // Only the autoplay permission boundary is simulated; all audio stays real.
          if (blockUntilGesture && !trustedGesture) {
            audit.blockedAttempts++;
            throw new DOMException(
              "A user gesture is required",
              "NotAllowedError",
            );
          }
          this.permissionGranted = true;
          await super.resume();
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
            audit.maxActiveLoops = Math.max(audit.maxActiveLoops, live.size);
          };
          const retired = () => {
            live.delete(id);
            audit.activeLoops = [...live];
          };
          source.addEventListener("ended", retired);
          const disconnect = source.disconnect.bind(source);
          source.disconnect = (() => {
            disconnect();
            retired();
          }) as typeof source.disconnect;
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
    },
    { blockUntilGesture },
  );
}
const audio = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { lobbyAudioAudit: AudioAudit }).lobbyAudioAudit,
  );

async function setup(page: Page, blockUntilGesture = false) {
  await auditRealAudio(page, blockUntilGesture);
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

const toggle = (page: Page) => page.locator("button[data-lobby-music-toggle]");
async function expectPlaying(page: Page) {
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(async () => (await audio(page)).resumeAttempts)
    .toBeGreaterThan(0);
  // Native browser policies differ. A neutral real gesture may unlock a blocked
  // automatic attempt, but must not be needed as an explicit Play control.
  if ((await toggle(page).getAttribute("data-playing")) !== "true")
    await page.getByRole("heading").first().click();
  await expect(toggle(page)).toHaveAttribute("data-playing", "true");
  await expect.poll(async () => (await audio(page)).activeLoops.length).toBe(1);
}
async function navigateLobby(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Amberly Games", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/family/${name.toLowerCase()}$`));
}

test("background music automatically attempts the real FLAC and remembers mute and Settings volume", async ({
  page,
}, info) => {
  await setup(page);
  await expect(toggle(page)).toHaveAccessibleName("Mute background music");
  await expectPlaying(page);
  await expect(
    page.locator(".lobby-music-panel, details.lobby-music"),
  ).toHaveCount(0);
  const control = (await toggle(page).boundingBox())!;
  const brand = (await page.locator("header .brand").boundingBox())!;
  expect(control.x).toBeGreaterThanOrEqual(brand.x + brand.width - 1);
  expect(control.x + control.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  expect(
    Math.abs(control.y + control.height / 2 - brand.y - brand.height / 2),
  ).toBeLessThan(24);
  const playing = await audio(page);
  expect(playing.contexts).toBe(1);
  expect(playing.starts).toBe(1);
  expect(playing.maxActiveLoops).toBe(1);
  expect(playing.decoded.length).toBeGreaterThan(0);
  expect(playing.decoded[0].signature).toBe("fLaC");
  expect(playing.decoded[0].duration).toBeGreaterThan(10);
  await navigateLobby(page, "Settings");
  const settings = page.getByRole("region", {
    name: "Background music settings",
  });
  await expect(
    settings.getByRole("heading", { name: "Background music", exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole("link", { name: "Music credits", exact: true }),
  ).toHaveAttribute("href", "/music/README.md");
  const slider = settings.getByRole("slider", {
    name: "Background music volume",
    exact: true,
  });
  await expect(slider).toHaveValue("20");
  await slider.focus();
  for (let step = 0; step < 3; step++) await slider.press("ArrowRight");
  await expect(slider).toHaveValue("35");
  await fitsWidth(page);
  await page.screenshot({
    path: info.outputPath("background-music-settings.png"),
  });
  await toggle(page).click();
  await expect(toggle(page)).toHaveAccessibleName("Unmute background music");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await audio(page)).activeLoops).toEqual([]);
  await page.reload();
  await expect(toggle(page)).toHaveAccessibleName("Unmute background music");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("slider", { name: "Background music volume", exact: true }),
  ).toHaveValue("35");
  expect(await audio(page)).toMatchObject({
    contexts: 0,
    starts: 0,
    activeLoops: [],
  });
  await toggle(page).click();
  await expectPlaying(page);
  await expect(toggle(page)).toHaveAccessibleName("Mute background music");
});

test("lobby navigation keeps one loop, while internal and routed Scrabble play both silence it", async ({
  page,
}) => {
  await setup(page);
  await expectPlaying(page);
  // A rapid off/on must retire the previous loop before scheduling another.
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await toggle(page).click();
  await expectPlaying(page);
  const baseline = await audio(page);
  expect(baseline.maxActiveLoops).toBe(1);
  for (const name of ["History", "Players", "Settings"]) {
    await navigateLobby(page, name);
    await expect(toggle(page)).toHaveAttribute("data-playing", "true");
    expect(await audio(page)).toMatchObject({
      contexts: 1,
      starts: baseline.starts,
      activeLoops: baseline.activeLoops,
      maxActiveLoops: 1,
    });
  }
  await page
    .getByRole("button", { name: "Scrabble records", exact: true })
    .click();
  await expect(page).toHaveURL(/\/family\/scrabble\?view=records$/);
  await expect(toggle(page)).toHaveAttribute("data-playing", "true");
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
  await expect(toggle(page)).toHaveCount(0);
  await expect.poll(async () => (await audio(page)).activeLoops).toEqual([]);
  await page
    .getByRole("link", { name: "Amberly Games — Home", exact: true })
    .click();
  await expect(page).toHaveURL(/\/family$/);
  await expectPlaying(page);
  expect((await audio(page)).starts).toBe(baseline.starts + 1);
  await page.getByRole("button", { name: "Resume game", exact: true }).click();
  await expect(page).toHaveURL(/\/family\/scrabble\?view=play$/);
  await expect(
    page.getByRole("button", { name: "Enable game sounds", exact: true }),
  ).toBeVisible();
  await expect(toggle(page)).toHaveCount(0);
  await expect.poll(async () => (await audio(page)).activeLoops).toEqual([]);
  expect(await audio(page)).toMatchObject({
    contexts: 1,
    starts: baseline.starts + 1,
    maxActiveLoops: 1,
  });
});

test("foreground and lobby return resume one loop while Gym stays silent", async ({
  page,
}) => {
  await setup(page);
  await expectPlaying(page);
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
  await expectPlaying(page);
  expect((await audio(page)).starts).toBe(2);
  expect((await audio(page)).maxActiveLoops).toBe(1);
  const beforeGym = await audio(page);
  await page.getByRole("button", { name: "Open Gym", exact: true }).click();
  await expect(page).toHaveURL(/\/gym-lab\?from=family$/);
  await expect(
    page.getByRole("heading", { name: "Scrabble Gym", exact: true }),
  ).toBeVisible();
  await expect(toggle(page)).toHaveCount(0);
  await expect.poll(async () => (await audio(page)).activeLoops).toEqual([]);
  await expect
    .poll(async () => (await audio(page)).closes)
    .toBe(beforeGym.closes + 1);
  await page.getByRole("link", { name: "Back to Games", exact: true }).click();
  await expect(page).toHaveURL(/\/family$/);
  await expectPlaying(page);
  expect((await audio(page)).activeLoops).toHaveLength(1);
  expect((await audio(page)).starts).toBe(beforeGym.starts + 1);
  expect((await audio(page)).maxActiveLoops).toBe(1);
});

test("blocked autoplay retries on the first trusted gesture without replacing the audio pipeline", async ({
  page,
}) => {
  await setup(page, true);
  await expect(toggle(page)).toHaveAccessibleName("Mute background music");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(async () => (await audio(page)).blockedAttempts)
    .toBeGreaterThan(0);
  const blocked = await audio(page);
  expect(blocked.starts).toBe(0);
  expect(blocked.activeLoops).toEqual([]);
  // Synthetic events must not grant autoplay permission or produce retry churn.
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect((await audio(page)).resumeAttempts).toBe(blocked.resumeAttempts);
  await page
    .getByRole("heading", { name: "What are we playing?", exact: true })
    .click();
  await expect(toggle(page)).toHaveAttribute("data-playing", "true");
  const unlocked = await audio(page);
  expect(unlocked.resumeAttempts).toBeGreaterThan(blocked.resumeAttempts);
  expect(unlocked.starts).toBe(1);
  expect(unlocked.activeLoops).toHaveLength(1);
  expect(unlocked.maxActiveLoops).toBe(1);
  expect(unlocked.decoded[0].signature).toBe("fLaC");
});
