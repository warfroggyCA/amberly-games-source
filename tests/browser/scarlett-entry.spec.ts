import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { installFixture } from "./fixtures/crokinole";

test.use({ reducedMotion: "no-preference" });

test("Scarlett's entry card loads its animated asset and preserves the card interaction", async ({
  page,
}, testInfo) => {
  await installFixture(page);
  const baseline = process.env.AMBERLY_SCARLETT_BASELINE === "1";
  const asset = baseline
    ? "/gym/scarlett-lift.webp"
    : "/gym/scarlett-entry.webp";
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("scarlett")) requests.push(new URL(r.url()).pathname);
  });
  const responsePromise = page.waitForResponse(
    (r) => new URL(r.url()).pathname === asset,
  );
  await page.goto("/family");
  const card = page.locator(".hub-game").filter({
    has: page.getByRole("heading", { name: "Scrabble Gym", exact: true }),
  });
  const art = card.getByRole("img", {
    name: "Scarlett lifting Scrabble weights",
    exact: true,
  });
  await expect(art).toHaveAttribute("src", asset);
  await expect
    .poll(() =>
      art.evaluate((image) => {
        const img = image as HTMLImageElement;
        return img.complete && img.naturalWidth > 0;
      }),
    )
    .toBe(true);
  const response = await responsePromise;
  const bodyBytes = (await response.body()).length;
  const first = await art.screenshot({
    path: testInfo.outputPath("scarlett-frame-a.png"),
  });
  await page.waitForTimeout(700);
  const second = await art.screenshot({
    path: testInfo.outputPath("scarlett-frame-b.png"),
  });
  expect(createHash("sha256").update(first).digest("hex")).not.toBe(
    createHash("sha256").update(second).digest("hex"),
  );
  expect(requests).toEqual([asset]);
  const box = await art.boundingBox();
  const timings = await page.evaluate((path) => {
    const entry = performance
      .getEntriesByType("resource")
      .find((e) => new URL(e.name).pathname === path) as
      PerformanceResourceTiming | undefined;
    return entry
      ? {
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
          transferSize: entry.transferSize,
          durationMs: entry.duration,
        }
      : null;
  }, asset);
  const metrics = {
    stage: "family-entry-before-navigation",
    normalMotion: true,
    variant: baseline ? "before" : "after",
    project: testInfo.project.name,
    buildId: (await readFile(".next/BUILD_ID", "utf8")).trim(),
    viewport: page.viewportSize(),
    devicePixelRatio: await page.evaluate(() => devicePixelRatio),
    asset,
    bodyBytes,
    box,
    timings,
    animated: true,
    requests,
  };
  if (process.env.AMBERLY_SCARLETT_RECEIPT_DIR) {
    await mkdir(process.env.AMBERLY_SCARLETT_RECEIPT_DIR, { recursive: true });
    await writeFile(
      join(
        process.env.AMBERLY_SCARLETT_RECEIPT_DIR,
        `${metrics.variant}-${testInfo.project.name}.json`,
      ),
      JSON.stringify(metrics, null, 2) + "\n",
    );
  }
  const open = card.getByRole("button", { name: "Open Gym", exact: true });
  await open.focus();
  await expect(open).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/gym-lab(?:\?from=family)?$/);
  await expect(page.locator(".gym-welcome .gym-mascot")).toHaveAttribute(
    "src",
    "/gym/scarlett-lift.webp",
  );
});
