import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { installFixture } from "./fixtures/crokinole";
import type { SharedMutation } from "../../src/lib/shared-contract";

test("shared profiles crop photos, preserve cancelled adjustments and save nicknames", async ({
  page,
}, testInfo) => {
  const { family } = await installFixture(page);
  family.playerAccess.doug = { revision: 0, userId: family.member.userId };
  let writes = 0;
  await page.route(/\/api\/family(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: family });
    const mutation = route.request().postDataJSON() as SharedMutation;
    const op = mutation.operation;
    if (op.type !== "update-player")
      throw new Error("Unexpected profile operation");
    writes++;
    const player = { id: op.id, ...op.profile };
    family.players = family.players.map((p) => (p.id === op.id ? player : p));
    family.playerAccess[op.id].revision++;
    return route.fulfill({
      json: {
        player,
        playerAccess: family.playerAccess[op.id],
      },
    });
  });
  await page.goto("/family/players");
  await page
    .getByRole("article", { name: "Doug", exact: true })
    .getByRole("button", { name: "Edit profile" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit player profile" });
  await dialog.getByLabel("Nickname (optional)").fill("Warfroggy");
  const image = await sharp({
    create: { width: 800, height: 400, channels: 3, background: "#228844" },
  })
    .png()
    .toBuffer();
  await dialog.getByLabel("Profile photo", { exact: true }).setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(
    dialog.getByRole("button", { name: "Use photo", exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "Save profile" }),
  ).toHaveCount(0);
  const crownToggle = dialog.getByRole("switch", { name: "Show crown" });
  const crown = dialog.locator(".winner-portrait-crown");
  await expect(crownToggle).toBeChecked();
  await expect(crown).toBeVisible();
  await dialog.getByRole("slider", { name: "Photo zoom" }).fill("2");
  const cropWindow = dialog.locator(".profile-crop-window");
  await cropWindow.scrollIntoViewIfNeeded();
  const box = (await cropWindow.boundingBox())!;
  const cropStyle = await cropWindow.locator("img").getAttribute("style");
  await crownToggle.focus();
  await page.keyboard.press("Space");
  await expect(crownToggle).not.toBeChecked();
  await expect(crown).toHaveCount(0);
  await expect(cropWindow.locator("img")).toHaveAttribute("style", cropStyle!);
  await page.keyboard.press("Space");
  await expect(crownToggle).toBeChecked();
  await expect(crown).toBeVisible();
  await cropWindow.scrollIntoViewIfNeeded();
  const dragBox = (await cropWindow.boundingBox())!;
  expect(dragBox.width).toEqual(box.width);
  expect(dragBox.height).toEqual(box.height);
  // Start beneath the visible crown: its overlay must not intercept dragging.
  await page.mouse.move(
    dragBox.x + dragBox.width / 2,
    dragBox.y + dragBox.height / 4,
  );
  await page.mouse.down();
  await page.mouse.move(
    dragBox.x + dragBox.width / 2 + 20,
    dragBox.y + dragBox.height / 4 + 10,
    { steps: 3 },
  );
  await page.mouse.up();
  await dialog.getByText("Fine-tune position", { exact: true }).click();
  expect(
    Number(
      await dialog
        .getByRole("slider", { name: "Horizontal position" })
        .inputValue(),
    ),
  ).toBeLessThan(0.5);
  await dialog.getByRole("slider", { name: "Horizontal position" }).fill("0.8");
  await dialog.getByRole("slider", { name: "Vertical position" }).fill("0.2");
  await dialog.getByText("Fine-tune position", { exact: true }).click();
  await dialog
    .getByText("Frame your photo", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("profile-framing.png") });
  await dialog.getByRole("button", { name: "Use photo", exact: true }).click();
  const original = await dialog
    .getByAltText("Selected profile photo")
    .getAttribute("src");
  expect(original).toMatch(/^data:image\/(jpeg|png);base64,/);
  const dimensions = await sharp(
    Buffer.from(original!.split(",")[1], "base64"),
  ).metadata();
  expect(dimensions.width).toBe(256);
  expect(dimensions.height).toBe(256);
  const topPixel = await sharp(Buffer.from(original!.split(",")[1], "base64"))
    .extract({ left: 128, top: 40, width: 1, height: 1 })
    .raw()
    .toBuffer();
  // The source is green; a baked-in gold crown would change this upper-face pixel.
  expect(topPixel[0]).toBeLessThan(80);
  expect(topPixel[1]).toBeGreaterThan(100);
  expect(topPixel[2]).toBeLessThan(110);
  await dialog
    .getByRole("button", { name: "Adjust photo", exact: true })
    .click();
  await dialog.getByRole("slider", { name: "Photo zoom" }).fill("3");
  await dialog.getByRole("button", { name: "Cancel adjustment" }).click();
  await expect(dialog.getByAltText("Selected profile photo")).toHaveAttribute(
    "src",
    original!,
  );
  await dialog.getByRole("button", { name: "Save profile" }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toBe(1);
  expect(family.players.find((p) => p.id === "doug")).toMatchObject({
    name: "Doug",
    nickname: "Warfroggy",
    photoDataUrl: original,
  });
  await expect(
    page.locator(".players-list h3").getByText("Warfroggy"),
  ).toHaveAttribute("title", "Doug");
  await page.reload();
  await expect(
    page.locator(".players-list h3").getByText("Warfroggy"),
  ).toBeVisible();
  await page.goto("/family/crokinole/new");
  await expect(page.getByRole("option", { name: "Warfroggy" })).toHaveCount(2);
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(
    page.locator(".crokinole-standing").getByText("Warfroggy", { exact: true }),
  ).toHaveAttribute("title", "Doug");
});

test("photo touch gestures pinch in and out and continue dragging after a finger lifts", async ({
  page,
}) => {
  const { family } = await installFixture(page);
  family.playerAccess.doug = { revision: 0, userId: family.member.userId };
  await page.goto("/family/players");
  await page
    .getByRole("article", { name: "Doug", exact: true })
    .getByRole("button", { name: "Edit profile" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit player profile" });
  const image = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#228844" },
  })
    .png()
    .toBuffer();
  await dialog.getByLabel("Profile photo", { exact: true }).setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(
    dialog.getByRole("button", { name: "Use photo", exact: true }),
  ).toBeEnabled();
  const crop = dialog.locator(".profile-crop-window");
  await crop.scrollIntoViewIfNeeded();
  // Synthetic multi-touch exercises the same handlers in Chromium and WebKit.
  // Capture requires hardware-generated active pointers; real mouse capture is
  // exercised in the save/cancel regression above.
  await crop.evaluate((element) => {
    element.setPointerCapture = () => {};
  });
  const box = (await crop.boundingBox())!;
  const pointer = async (type: string, id: number, x: number, y: number) => {
    await crop.dispatchEvent(type, {
      pointerId: id,
      pointerType: "touch",
      clientX: box.x + x,
      clientY: box.y + y,
      bubbles: true,
    });
  };
  const zoom = dialog.getByRole("slider", { name: "Photo zoom" });
  await pointer("pointerdown", 11, 60, 90);
  await pointer("pointerdown", 22, 120, 90);
  await pointer("pointermove", 22, 180, 90);
  await expect(zoom).toHaveValue("2");
  await pointer("pointermove", 22, 150, 90);
  await expect(zoom).toHaveValue("1.5");
  const beforeLift = await crop.locator("img").getAttribute("style");
  await pointer("pointerup", 22, 150, 90);
  await expect(crop.locator("img")).toHaveAttribute("style", beforeLift!);
  await pointer("pointermove", 11, 70, 100);
  await expect(zoom).toHaveValue("1.5");
  // A pan keeps zoom unchanged. Wait for its rendered position, rather than
  // treating the already-matching zoom value as evidence that it committed.
  await expect(crop.locator("img")).not.toHaveAttribute("style", beforeLift!);
  await pointer("pointercancel", 11, 70, 100);
  const afterCancel = await crop.locator("img").getAttribute("style");
  await pointer("pointermove", 11, 90, 120);
  await expect(crop.locator("img")).toHaveAttribute("style", afterCancel!);
  await pointer("pointerdown", 33, 60, 90);
  await pointer("lostpointercapture", 33, 60, 90);
  await pointer("pointermove", 33, 10, 10);
  await expect(crop.locator("img")).toHaveAttribute("style", afterCancel!);
  await dialog.getByRole("button", { name: "Reset framing" }).click();
  await expect(zoom).toHaveValue("1");
});

test("transparent photos can move below the frame edge and retain alpha when saved and reopened", async ({
  page,
}) => {
  const { family } = await installFixture(page);
  family.playerAccess.doug = { revision: 0, userId: family.member.userId };
  let savedPhoto = "";
  await page.route(/\/api\/family(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: family });
    const { operation: op } = route.request().postDataJSON() as SharedMutation;
    if (op.type !== "update-player") throw Error("Unexpected operation");
    savedPhoto = op.profile.photoDataUrl!;
    const player = { id: op.id, ...op.profile };
    family.players = family.players.map((p) => (p.id === op.id ? player : p));
    family.playerAccess[op.id].revision++;
    return route.fulfill({
      json: { player, playerAccess: family.playerAccess[op.id] },
    });
  });
  await page.goto("/family/players");
  await page
    .getByRole("article", { name: "Doug", exact: true })
    .getByRole("button", { name: "Edit profile" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit player profile" });
  const image = await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 20, g: 150, b: 50, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  await dialog.getByLabel("Profile photo", { exact: true }).setInputFiles({
    name: "transparent.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(
    dialog.getByRole("button", { name: "Use photo", exact: true }),
  ).toBeEnabled();
  const crop = dialog.locator(".profile-crop-window");
  await crop.scrollIntoViewIfNeeded();
  const box = (await crop.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75, {
    steps: 4,
  });
  await page.mouse.up();
  // The image's top now sits inside the frame, instead of being clamped at zero.
  expect(
    await crop
      .locator("img")
      .evaluate((el) => parseFloat((el as HTMLElement).style.top)),
  ).toBeCloseTo(25, 0);
  await dialog.getByRole("button", { name: "Use photo", exact: true }).click();
  const src = (await dialog
    .getByAltText("Selected profile photo")
    .getAttribute("src"))!;
  expect(src).toMatch(/^data:image\/png;base64,/);
  const { data, info } = await sharp(Buffer.from(src.split(",")[1], "base64"))
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(4);
  expect(data[(20 * 256 + 128) * 4 + 3]).toBe(0);
  expect(data[(128 * 256 + 128) * 4 + 3]).toBeGreaterThan(120);
  expect(data[(128 * 256 + 128) * 4 + 3]).toBeLessThan(135);
  await dialog.getByRole("button", { name: "Save profile" }).click();
  await expect(dialog).toBeHidden();
  expect(savedPhoto).toBe(src);
  await page.reload();
  await page
    .getByRole("article", { name: "Doug", exact: true })
    .getByRole("button", { name: "Edit profile" })
    .click();
  await dialog
    .getByRole("button", { name: "Adjust photo", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Use photo", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("slider", { name: "Photo zoom" }).fill("0.5");
  await dialog.getByRole("button", { name: "Use photo", exact: true }).click();
  await expect(dialog.getByAltText("Selected profile photo")).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
  );
});
