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
    .locator(".players-list > div")
    .filter({ hasText: "Doug" })
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
  await dialog.getByRole("slider", { name: "Photo zoom" }).fill("2");
  const cropWindow = dialog.locator(".profile-crop-window");
  await cropWindow.scrollIntoViewIfNeeded();
  const box = (await cropWindow.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 20,
    box.y + box.height / 2 + 10,
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
  expect(original).toMatch(/^data:image\/jpeg;base64,/);
  const dimensions = await sharp(
    Buffer.from(original!.split(",")[1], "base64"),
  ).metadata();
  expect(dimensions.width).toBe(256);
  expect(dimensions.height).toBe(256);
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
