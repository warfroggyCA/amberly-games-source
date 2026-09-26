import { expect, test, type Page, type Route } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";
import type {
  SharedMutation,
  SharedMutationResult,
} from "../../src/lib/shared-contract";

async function setup(
  page: Page,
  options: { member?: boolean; failFirst?: boolean } = {},
) {
  const { family } = await installFixture(page);
  family.players = [
    { id: "doug", name: "Doug", nickname: "Froggy" },
    { id: "unused", name: "Unused test", nickname: "Testy" },
  ];
  family.playerAccess = {
    doug: { revision: 0, userId: family.member.userId, archived: false },
    unused: { revision: 0, userId: null, archived: false },
  };
  if (options.member) family.member.role = "member";
  const writes: SharedMutation[] = [];
  const receipts = new Map<string, SharedMutationResult>();
  let fail = !!options.failFirst;
  await page.route(/\/api\/family(?:\?.*)?$/, async (route: Route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: family });
    const input = route.request().postDataJSON() as SharedMutation;
    writes.push(input);
    const op = input.operation;
    let result = receipts.get(input.requestId);
    if (!result) {
      if (op.type === "archive-player") {
        const access = family.playerAccess[op.id];
        expect(op.expectedRevision).toBe(access.revision);
        access.revision++;
        access.archived = op.archived;
        access.deletionBlock =
          op.id === "doug"
            ? "This player has a linked account. Keep them archived; sign-in access is managed separately."
            : null;
        result = {
          player: family.players.find((p) => p.id === op.id),
          playerAccess: { ...access },
        };
      } else if (op.type === "delete-player") {
        expect(family.playerAccess[op.id]).toMatchObject({
          archived: true,
          deletionBlock: null,
        });
        family.players = family.players.filter((p) => p.id !== op.id);
        delete family.playerAccess[op.id];
        result = { removedPlayerId: op.id };
      } else throw new Error(`Unexpected ${op.type}`);
      receipts.set(input.requestId, result);
    } else result = { ...result, replayed: true };
    if (fail) {
      fail = false;
      return route.fulfill({
        status: 503,
        json: { error: "Connection interrupted after saving. Retry safely." },
      });
    }
    return route.fulfill({ json: result });
  });
  await page.goto("/family/players");
  await expect(
    page.getByRole("heading", { name: "The players" }),
  ).toBeVisible();
  return { family, writes };
}

test("player actions archive immediately, undo, restore and confirm unused deletion", async ({
  page,
}, testInfo) => {
  const { writes } = await setup(page);
  let row = page.getByRole("article", { name: "Testy", exact: true });
  await row.getByRole("button", { name: "Actions for Testy" }).click();
  await row
    .getByRole("button", { name: "Archive player", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Testy archived" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row).toBeVisible();
  expect(
    writes.map(
      (w) => w.operation.type === "archive-player" && w.operation.archived,
    ),
  ).toEqual([true, false]);
  await row.getByRole("button", { name: "Actions for Testy" }).click();
  await row
    .getByRole("button", { name: "Archive player", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Archived players (1)" }).click();
  row = page.getByRole("article", { name: "Testy", exact: true });
  await row.getByRole("button", { name: "Restore player" }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Actions for Testy" }).click();
  await row.getByRole("button", { name: "Permanently delete…" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Permanently delete player?",
  });
  await expect(
    dialog.getByRole("button", {
      name: "Permanently delete player",
      exact: true,
    }),
  ).toBeDisabled();
  await dialog.getByLabel("Type the player’s name to confirm").fill("Testy");
  await fitsWidth(page);
  await page.screenshot({
    path: testInfo.outputPath("player-archive-delete.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Permanently delete player", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);
  expect(writes.at(-1)?.operation.type).toBe("delete-player");
});

test("player swipe reveals Archive without archiving on a gesture or vertical scroll", async ({
  page,
}) => {
  const { writes } = await setup(page);
  const row = page.getByRole("article", { name: "Testy", exact: true });
  const front = row.locator(".swipe-game-front");
  const start = {
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: 220,
    clientY: 200,
  };
  // Synthetic events exercise cancel/scroll arbitration consistently across WebKit and Chromium.
  await front.dispatchEvent("pointerdown", start);
  await front.dispatchEvent("pointermove", {
    ...start,
    clientX: 217,
    clientY: 250,
  });
  await front.dispatchEvent("pointerup", {
    ...start,
    clientX: 217,
    clientY: 250,
  });
  await expect(
    row.getByRole("button", { name: "Archive player", exact: true }),
  ).toBeHidden();
  // Use a real pointer for horizontal capture and the touch-sized target.
  await front.scrollIntoViewIfNeeded();
  const box = (await front.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.65, box.y + 25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65 - 100, box.y + 25, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(
    row.getByRole("button", { name: "Archive player", exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
  await row
    .getByRole("button", { name: "Archive player", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(writes).toHaveLength(1);
});

test("uncertain archive retries the original request and linked profiles remain protected", async ({
  page,
}) => {
  const { writes } = await setup(page, { failFirst: true });
  let row = page.getByRole("article", { name: "Froggy", exact: true });
  await row.getByRole("button", { name: "Actions for Froggy" }).click();
  await row
    .getByRole("button", { name: "Archive player", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Connection interrupted" })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("region", { name: "Player management" })
    .getByRole("button", { name: "Retry saved action", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1].requestId).toBe(writes[0].requestId);
  await page.getByRole("button", { name: "Archived players (1)" }).click();
  row = page.getByRole("article", { name: "Froggy", exact: true });
  await expect(row.getByText(/linked account/)).toBeVisible();
  await row.getByRole("button", { name: "Actions for Froggy" }).click();
  await expect(
    row.getByRole("button", { name: "Permanently delete…" }),
  ).toBeDisabled();
  await expect(
    row.getByRole("button", { name: "Restore player" }),
  ).toBeEnabled();
});

test("members cannot reveal archive or permanent deletion controls", async ({
  page,
}) => {
  await setup(page, { member: true });
  await expect(
    page.getByRole("button", { name: /Archived players/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Actions for/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: /Archive player|Permanently delete/ }),
  ).toHaveCount(0);
});
