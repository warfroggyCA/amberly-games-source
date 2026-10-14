import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { startScarlettJourneyFixture } from "./fixtures/scarlett-journey";

// The suite default is reduced motion. This acceptance check must exercise the
// real animation in both the family entry card and the larger Gym welcome.
test.use({ reducedMotion: "no-preference" });

async function ready(image: Locator, source: string) {
  await expect(image).toHaveAttribute("src", source);
  await expect
    .poll(() =>
      image.evaluate((node) => {
        const img = node as HTMLImageElement;
        return img.complete && img.naturalWidth > 0;
      }),
    )
    .toBe(true);
}

async function runJourney(page: Page, testInfo: TestInfo, upstream: string) {
  const baseline = process.env.AMBERLY_SCARLETT_BASELINE === "1";
  const variant = baseline ? "before" : "after";
  const entryAsset = baseline
    ? "/gym/scarlett-lift.webp"
    : "/gym/scarlett-entry.webp";
  const fixture = await startScarlettJourneyFixture(upstream);
  let dpr = 0;
  let label = "";
  const directory = process.env.AMBERLY_SCARLETT_JOURNEY_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  const images: { name: string; sha256: string }[] = [];
  async function capture(image: Locator, phase: string) {
    const frames: Buffer[] = [];
    for (const frame of ["a", "b"]) {
      if (frame === "b") await page.waitForTimeout(700);
      const name = `${label}-${phase}-${frame}.png`;
      const bytes = await image.screenshot({
        animations: "allow",
        scale: "device",
      });
      frames.push(bytes);
      images.push({
        name,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      await testInfo.attach(name, { body: bytes, contentType: "image/png" });
      if (directory) await writeFile(join(directory, name), bytes);
    }
    expect(frames[0].equals(frames[1])).toBe(false);
    return image.evaluate((node) => {
      const img = node as HTMLImageElement;
      const rect = img.getBoundingClientRect();
      return {
        source: new URL(img.currentSrc).pathname,
        naturalWidth: img.naturalWidth,
        cssWidth: rect.width,
        cssHeight: rect.height,
        devicePixelRatio,
        physicalWidth: rect.width * devicePixelRatio,
      };
    });
  }
  async function resourceTimings() {
    return page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.includes("scarlett"))
        .map((entry) => {
          const r = entry as PerformanceResourceTiming;
          return {
            path: new URL(r.name).pathname,
            transferSize: r.transferSize,
            encodedBodySize: r.encodedBodySize,
            decodedBodySize: r.decodedBodySize,
            durationMs: r.duration,
          };
        }),
    );
  }
  try {
    await page.goto(`${fixture.origin}/family`);
    // iOS WebKit's blank document has a different viewport scale. Measure DPR
    // after the application's viewport metadata has loaded.
    dpr = await page.evaluate(() => devicePixelRatio);
    label = `${variant}-${testInfo.project.name}-${dpr}x`;
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(false);
    expect(
      await page.evaluate(() => localStorage.getItem("amberly-gym-motion-v1")),
    ).toBeNull();
    const card = page.locator(".hub-game").filter({
      has: page.getByRole("heading", { name: "Scrabble Gym", exact: true }),
    });
    const entry = card.getByRole("img", {
      name: "Scarlett lifting Scrabble weights",
      exact: true,
    });
    await ready(entry, entryAsset);
    const entryGeometry = await capture(entry, "family-cold");
    const entryTransfers = structuredClone(fixture.transfers);
    const entryTimings = await resourceTimings();
    expect(
      entryTransfers.filter((r) => r.path.endsWith(".webp")).map((r) => r.path),
    ).toEqual([entryAsset]);

    fixture.setPhase("gym-first");
    const open = card.getByRole("button", { name: "Open Gym", exact: true });
    await open.focus();
    await expect(open).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/gym-lab\?from=family$/);
    const welcome = page.locator(".gym-welcome .gym-mascot");
    await ready(welcome, "/gym/scarlett-lift.webp");
    await expect(page.locator(".gym-lab")).not.toHaveClass(
      /gym-reduced-motion/,
    );
    const welcomeGeometry = await capture(welcome, "gym-first");
    expect(welcomeGeometry.naturalWidth).toBe(640);
    const coldTransfers = structuredClone(fixture.transfers);
    const coldTimings = await resourceTimings();
    const animationBytes = coldTransfers
      .filter((r) => r.path.endsWith(".webp"))
      .reduce((sum, r) => sum + r.bodyBytes, 0);
    // Count actual response bodies at the server, including 304 revalidations
    // (zero body) and excluding memory-cache hits (no server request).
    expect(animationBytes).toBe(baseline ? 7270588 : 10115256);

    fixture.setPhase("family-return");
    await page
      .getByRole("link", { name: "Back to Games", exact: true })
      .click();
    await expect(page).toHaveURL(/\/family$/);
    await ready(entry, entryAsset);
    fixture.setPhase("gym-reopen");
    await open.click();
    await ready(welcome, "/gym/scarlett-lift.webp");
    // A reload permits normal max-age=0 revalidation, without disabling cache.
    fixture.setPhase("gym-reload");
    await page.reload();
    await ready(welcome, "/gym/scarlett-lift.webp");
    const reloadGeometry = await capture(welcome, "gym-reload");
    const revisitTransfers = fixture.transfers.slice(coldTransfers.length);
    const revisitAnimationBytes = revisitTransfers
      .filter((r) => r.path.endsWith(".webp"))
      .reduce((sum, r) => sum + r.bodyBytes, 0);
    // Record return/reload behavior instead of assuming identical browser
    // cache policies. The cold journey assertion above still
    // verifies initial reuse of the baseline asset across the client navigation.
    expect(fixture.unexpectedApiRequests).toEqual([]);
    const metrics = {
      variant,
      project: testInfo.project.name,
      buildId: (await readFile(".next/BUILD_ID", "utf8")).trim(),
      viewport: page.viewportSize(),
      devicePixelRatio: dpr,
      normalMotion: true,
      browserRouting: false,
      entryGeometry,
      welcomeGeometry,
      reloadGeometry,
      entryAnimationBytes: entryTransfers.reduce(
        (sum, r) => sum + r.bodyBytes,
        0,
      ),
      coldJourneyAnimationBytes: animationBytes,
      coldJourneyScarlettBytes: coldTransfers.reduce(
        (sum, r) => sum + r.bodyBytes,
        0,
      ),
      revisitAnimationBytes,
      revisitScarlettBytes: revisitTransfers.reduce(
        (sum, r) => sum + r.bodyBytes,
        0,
      ),
      totalScarlettBytes: fixture.transfers.reduce(
        (sum, r) => sum + r.bodyBytes,
        0,
      ),
      transfers: fixture.transfers,
      timings: {
        entry: entryTimings,
        coldJourney: coldTimings,
        reload: await resourceTimings(),
      },
      images,
    };
    const receipt = JSON.stringify(metrics, null, 2) + "\n";
    await testInfo.attach(`${label}.json`, {
      body: receipt,
      contentType: "application/json",
    });
    if (directory) await writeFile(join(directory, `${label}.json`), receipt);
  } finally {
    await fixture.close();
  }
}

test("normal-motion family to Gym journey counts all Scarlett transfers and cache reuse", async ({
  page,
  baseURL,
}, testInfo) => {
  await runJourney(page, testInfo, baseURL!);
});

test.describe("desktop high-DPR", () => {
  test.use({ deviceScaleFactor: 2 });
  test("normal-motion family to Gym at 2x retains the original welcome animation", async ({
    page,
    baseURL,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "Mobile profiles already cover native 2x/3x DPR",
    );
    await runJourney(page, testInfo, baseURL!);
  });
});
