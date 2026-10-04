import { expect, test, type Page, type Route } from "@playwright/test";
import { applyCommand, createGame } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import type {
  SharedMutation,
  SharedState,
} from "../../src/lib/shared-contract";

const adminId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
function fixture(asMember = false): SharedState {
  const made = createGame({
    id: "private-test",
    players: [{ id: "ada", name: "Ada", seat: 0 }],
    firstPlayerId: "ada",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!made.ok) throw new Error(made.error.message);
  const admin = {
    userId: adminId,
    email: "ada@example.test",
    role: "superadmin" as const,
    active: true,
    playerId: "ada",
    revision: 0,
    permissions: {},
  };
  const member = {
    userId: memberId,
    email: "nate.long-email-address@example.test",
    role: "member" as const,
    active: true,
    playerId: "nate",
    revision: 0,
    permissions: {},
  };
  return {
    family: {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Amberly Games",
    },
    member: asMember ? member : admin,
    members: asMember ? [member] : [admin, member],
    invitations: [],
    players: [
      { id: "ada", name: "Ada" },
      { id: "nate", name: "Nate" },
    ],
    playerAccess: {
      ada: { userId: adminId, revision: 0 },
      nate: { userId: memberId, revision: 0 },
    },
    games: asMember ? [] : [made.game],
    gameAccess: asMember
      ? {}
      : {
          [made.game.id]: {
            scorerUserId: adminId,
            deviceId: "test-device",
            generation: 1,
            mode: "practice",
            recordsEligible: false,
            protests: [],
            canScore: true,
            approvals: [],
          },
        },
    verifiedWords: [],
    nextCursor: null,
    removedGameIds: [],
  };
}
async function mock(
  page: Page,
  shared: SharedState,
  onWrite?: (route: Route, mutation: SharedMutation) => Promise<void>,
) {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        configured: true,
        signInMethod: "google",
        user: { id: shared.member.userId, email: shared.member.email },
      },
    }),
  );
  await page.route(/\/api\/family(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      if (!onWrite) throw new Error("Unexpected mutation");
      return onWrite(route, route.request().postDataJSON() as SharedMutation);
    }
    return route.fulfill({ json: shared });
  });
  await page.route("**/api/family/draft*", (route) =>
    route.fulfill({ json: { draft: null } }),
  );
  await page.goto("/family/scrabble");
  await expect(
    page.getByRole("button", { name: "Open game menu" }),
  ).toBeVisible();
}
async function openPermissions(
  page: Page,
  email = "nate.long-email-address@example.test",
) {
  await page.getByRole("button", { name: "Open game menu" }).click();
  await page
    .getByRole("button", { name: "Family access", exact: true })
    .click();
  await page
    .locator(".family-members li")
    .filter({ hasText: email })
    .getByRole("button", { name: "Permissions" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Member permissions" }),
  ).toBeVisible();
}

test("permission switches retain edits after a failed save, retry the same request and persist on reopen", async ({
  page,
}, testInfo) => {
  const shared = fixture();
  const writes: SharedMutation[] = [];
  await mock(page, shared, async (route, mutation) => {
    writes.push(mutation);
    if (writes.length === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Connection interrupted. Your change is kept." },
      });
    if (mutation.operation.type !== "update-member")
      throw new Error("Unexpected operation");
    const op = mutation.operation;
    Object.assign(shared.members[1], {
      permissions: op.permissions,
      revision: 1,
    });
    return route.fulfill({ json: {} });
  });
  await openPermissions(page);
  const panel = page.getByRole("dialog", { name: "Member permissions" });
  await expect(
    panel.getByRole("switch", { name: "Manage equipment" }),
  ).toBeChecked();
  await expect(
    panel.getByRole("switch", { name: "Invite people" }),
  ).not.toBeChecked();
  // The entire labelled row is a touch target, not only the small thumb.
  await panel
    .locator("label")
    .filter({ has: page.getByRole("switch", { name: "Manage equipment" }) })
    .click();
  await panel.getByRole("switch", { name: "Invite people" }).check();
  await panel
    .getByLabel("Reason for change")
    .fill("Nate may invite people; leave the bag setup to me.");
  await panel.getByRole("button", { name: "Save permissions" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Connection interrupted",
  );
  await expect(
    panel.getByRole("switch", { name: "Manage equipment" }),
  ).not.toBeChecked();
  await expect(panel.getByLabel("Reason for change")).toHaveValue(
    "Nate may invite people; leave the bag setup to me.",
  );
  await panel.getByRole("button", { name: "Retry saved change" }).click();
  await expect(
    page.getByRole("dialog", { name: "Amberly access" }),
  ).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0].requestId).toBe(writes[1].requestId);
  await page
    .locator(".family-members li")
    .filter({ hasText: shared.members[1].email })
    .getByRole("button", { name: "Permissions" })
    .click();
  await expect(
    panel.getByRole("switch", { name: "Manage equipment" }),
  ).not.toBeChecked();
  await expect(
    panel.getByRole("switch", { name: "Invite people" }),
  ).toBeChecked();
  await panel.evaluate((el) => {
    el.scrollTop = 0;
  });
  const dimensions = await panel.evaluate((el) => ({
    content: el.scrollWidth,
    width: el.clientWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1);
  await page.screenshot({
    path: testInfo.outputPath("member-permissions.png"),
  });
});

test("stale permission forms cannot overwrite newer access and superadmin capabilities stay enabled", async ({
  page,
}) => {
  const shared = fixture();
  await mock(page, shared);
  await openPermissions(page, "ada@example.test");
  const panel = page.getByRole("dialog", { name: "Member permissions" });
  await expect(panel.getByRole("switch", { name: "Keep score" })).toBeChecked();
  await expect(
    panel.getByRole("switch", { name: "Keep score" }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "Back to members" }).click();
  await page
    .locator(".family-members li")
    .filter({ hasText: shared.members[1].email })
    .getByRole("button", { name: "Permissions" })
    .click();
  await panel.getByLabel("Reason for change").fill("My proposed change");
  shared.members[1].revision = 1;
  // Normal polling, not client state injection, updates the authoritative version.
  await expect(panel.getByRole("alert")).toContainText("changed elsewhere", {
    timeout: 12000,
  });
  await expect(
    panel.getByRole("button", { name: "Save permissions" }),
  ).toBeDisabled();
  await expect(panel.getByLabel("Reason for change")).toHaveValue(
    "My proposed change",
  );
});

test("members get shared setup only and controls reflect disabled permissions", async ({
  page,
}) => {
  const shared = fixture(true);
  await mock(page, shared);
  await page.getByRole("button", { name: "New game", exact: false }).click();
  await expect(page.getByRole("option", { name: /Private test/ })).toHaveCount(
    0,
  );
  await expect(page.getByText("Private test", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();
  shared.member.permissions = {
    startGames: false,
    manageEquipment: false,
    addPlayers: false,
  };
  await expect(
    page.getByRole("button", { name: "New game", exact: false }),
  ).toBeDisabled({ timeout: 12000 });
  await page.getByRole("button", { name: "Open game menu" }).click();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeEnabled(); // Shared settings include readable rules; editing stays permission-gated.
  await expect(
    page.getByRole("button", { name: "Family access", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Players", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add player", exact: true }),
  ).toHaveCount(0);
});

test("practice deletion requires confirmation, handles rejection and removes the history row", async ({
  page,
}, testInfo) => {
  const shared = fixture();
  const writes: SharedMutation[] = [];
  await mock(page, shared, async (route, mutation) => {
    writes.push(mutation);
    if (mutation.operation.type !== "delete-practice-game")
      throw new Error("Unexpected operation");
    if (writes.length === 1)
      return route.fulfill({
        status: 409,
        json: {
          code: "REVISION_CONFLICT",
          error: "This game changed. Review it again.",
        },
      });
    if (writes.length === 2)
      return route.fulfill({
        status: 503,
        json: {
          error: "Connection interrupted. The deletion is saved for retry.",
        },
      });
    shared.removedGameIds = [mutation.operation.gameId];
    shared.games = [];
    shared.gameAccess = {};
    return route.fulfill({
      json: { removedGameId: mutation.operation.gameId },
    });
  });
  await page.getByRole("button", { name: "Open game menu" }).click();
  await page
    .getByRole("button", { name: "Scrabble history", exact: true })
    .click();
  await page.getByRole("button", { name: "Show delete action" }).click();
  await page.getByRole("button", { name: "Delete practice game…" }).click();
  const panel = page.getByRole("dialog", {
    name: "Delete this practice game?",
  });
  await expect(
    panel.getByRole("button", { name: "Delete practice game", exact: true }),
  ).toBeDisabled();
  expect(writes).toHaveLength(0);
  await panel.getByRole("button", { name: "Keep game" }).click();
  await expect(page.locator(".game-list-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Show delete action" }).click();
  await page.getByRole("button", { name: "Delete practice game…" }).click();
  await panel.getByLabel("Reason for deleting").fill("Done testing");
  await page.screenshot({ path: testInfo.outputPath("delete-practice.png") });
  await panel
    .getByRole("button", { name: "Delete practice game", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("changed");
  await expect(panel.getByLabel("Reason for deleting")).toHaveValue(
    "Done testing",
  );
  await panel
    .getByRole("button", { name: "Delete practice game", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Connection interrupted",
  );
  await expect(
    panel.getByRole("button", { name: "Keep game", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Close for now", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Retry saved deletion" }).click();
  expect(writes).toHaveLength(3);
  expect(writes[0].requestId).not.toBe(writes[1].requestId);
  expect(writes[1].requestId).toBe(writes[2].requestId);
  await expect(panel).not.toBeVisible();
  await expect(page.locator(".game-list-item")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open game menu" }),
  ).toBeVisible();
  await expect(page.locator(".game-list-item")).toHaveCount(0);
});

test("swiping a practice row reveals Delete without opening it, supports cancellation and keyboard access", async ({
  page,
}, testInfo) => {
  await mock(page, fixture());
  const row = page.locator(".swipe-game").first();
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  const swipe = async (dx: number) => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
  };
  await swipe(-25);
  await expect(
    row.getByRole("button", { name: "Show delete action" }),
  ).toHaveAttribute("aria-expanded", "false");
  await swipe(-110);
  await expect(
    row.getByRole("button", { name: "Delete practice game…" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("swipe-delete.png") });
  await swipe(110);
  await expect(
    row.getByRole("button", { name: "Show delete action" }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Show delete action" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    row.getByRole("button", { name: "Delete practice game…" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    row.getByRole("button", { name: "Delete practice game…" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    row.getByRole("button", { name: "Show delete action" }),
  ).toHaveAttribute("aria-expanded", "false");
  await row.locator(".game-list-item > button").first().click();
  await expect(row).not.toBeVisible();
});

test("removing an invitation needs confirmation and preserves it on cancel or a failed request", async ({
  page,
}, testInfo) => {
  const shared = fixture();
  shared.invitations = [{ email: "guest@example.test", active: true }];
  const writes: SharedMutation[] = [];
  await mock(page, shared, async (route, mutation) => {
    writes.push(mutation);
    if (mutation.operation.type !== "revoke-invitation")
      throw new Error("Unexpected operation");
    if (writes.length === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Connection interrupted" },
      });
    shared.invitations = [];
    return route.fulfill({ json: {} });
  });
  await page.getByRole("button", { name: "Open game menu" }).click();
  await page
    .getByRole("button", { name: "Family access", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove invitation…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Remove this invitation?" });
  await expect(dialog).toContainText("guest@example.test");
  expect(writes).toHaveLength(0);
  await dialog.getByRole("button", { name: "Keep invitation" }).click();
  await expect(page.locator(".family-invitation")).toContainText(
    "guest@example.test",
  );
  await page
    .getByRole("button", { name: "Remove invitation…", exact: true })
    .click();
  await page.screenshot({ path: testInfo.outputPath("remove-invitation.png") });
  await dialog
    .getByRole("button", { name: "Remove invitation", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Connection interrupted",
  );
  await expect(
    dialog.getByRole("button", { name: "Remove invitation", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Retry saved change" }).click();
  expect(writes).toHaveLength(2);
  expect(writes[0].requestId).toBe(writes[1].requestId);
  await expect(page.locator(".family-invitation")).toHaveCount(0);
});

test("turning off member access asks for confirmation before saving and retains changes on cancel", async ({
  page,
}, testInfo) => {
  const shared = fixture();
  const writes: SharedMutation[] = [];
  await mock(page, shared, async (route, mutation) => {
    writes.push(mutation);
    if (mutation.operation.type !== "update-member")
      throw new Error("Unexpected operation");
    Object.assign(shared.members[1], {
      active: mutation.operation.active,
      revision: 1,
    });
    return route.fulfill({ json: {} });
  });
  await openPermissions(page);
  const panel = page.getByRole("dialog", { name: "Member permissions" });
  await panel.getByRole("switch", { name: "Account access" }).uncheck();
  await panel
    .getByLabel("Reason for change")
    .fill("Remove test account access");
  await panel.getByRole("button", { name: "Save permissions" }).click();
  await expect(panel).toContainText("Remove this member’s access?");
  await expect(panel).toContainText(shared.members[1].email);
  expect(writes).toHaveLength(0);
  await panel.getByRole("button", { name: "Back to permissions" }).click();
  await expect(panel.getByLabel("Reason for change")).toHaveValue(
    "Remove test account access",
  );
  await panel.getByRole("button", { name: "Save permissions" }).click();
  await page.screenshot({ path: testInfo.outputPath("remove-member.png") });
  await panel.getByRole("button", { name: "Remove member access" }).click();
  await expect(
    page
      .locator(".family-members li")
      .filter({ hasText: shared.members[1].email }),
  ).toContainText("Access revoked");
  expect(writes).toHaveLength(1);
  expect(writes[0].operation).toMatchObject({
    type: "update-member",
    active: false,
    expectedRevision: 0,
  });
});

test("touch swipe starting on the game button preserves vertical scroll and never opens the game", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "CDP touch input is Chromium-only; WebKit covers pointer and keyboard paths separately.",
  );
  await mock(page, fixture());
  const row = page.locator(".swipe-game").first();
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let step = 1; step <= 10; step++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x - step * 11, y }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(
    row.getByRole("button", { name: "Delete practice game…" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await row.getByRole("button", { name: "Hide delete action" }).click();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let step = 1; step <= 10; step++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - step * 8 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(
    row.getByRole("button", { name: "Show delete action" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await cdp.detach();
});

test("superadmin can end and remove a regular game owned by another scorer", async ({
  page,
}) => {
  const shared = fixture();
  const game = shared.games[0];
  shared.gameAccess[game.id] = {
    ...shared.gameAccess[game.id],
    mode: "confirmed",
    scorerUserId: memberId,
    canScore: false,
  };
  const writes: SharedMutation[] = [];
  await mock(page, shared, async (route, mutation) => {
    writes.push(mutation);
    expect(mutation.operation).toMatchObject({
      type: "remove-game",
      gameId: game.id,
      expectedRevision: game.revision,
      reason: "Duplicate game",
    });
    shared.games = [];
    shared.gameAccess = {};
    shared.removedGameIds = [game.id];
    await route.fulfill({ json: { removedGameId: game.id } });
  });
  await page.getByRole("button", { name: "Open game menu" }).click();
  await page
    .getByRole("button", { name: "Scrabble history", exact: true })
    .click();
  await page.getByRole("button", { name: "Show delete action" }).click();
  await page
    .getByRole("button", { name: "End and remove game…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "End and remove game?" });
  await expect(
    dialog.getByRole("button", { name: "End and remove game", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Reason for removing").fill("Duplicate game");
  await dialog
    .getByRole("button", { name: "End and remove game", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(writes).toHaveLength(1);
  await expect(page.locator(".game-list-item")).toHaveCount(0);
});

test("Quit game cancels safely and retries only the chosen unfinished game", async ({
  page,
}, info) => {
  const shared = fixture();
  const game = shared.games[0];
  const other = structuredClone(game);
  other.id = "another-paused-game";
  other.definition.id = other.id;
  other.status = "paused";
  shared.games.push(other);
  shared.gameAccess[other.id] = { ...shared.gameAccess[game.id] };
  const otherBefore = JSON.stringify(other);
  const writes: SharedMutation[] = [];
  await mock(page, shared, async (route, mutation) => {
    writes.push(mutation);
    expect(mutation.operation).toMatchObject({
      type: "delete-practice-game",
      gameId: game.id,
      expectedRevision: game.revision,
      reason: "Quit unfinished game",
    });
    if (writes.length === 1) return route.abort("internetdisconnected");
    shared.games = shared.games.filter((g) => g.id !== game.id);
    delete shared.gameAccess[game.id];
    shared.removedGameIds = [game.id];
    return route.fulfill({ json: { removedGameId: game.id } });
  });
  await page.getByRole("button", { name: / · active$/ }).click();
  await page.getByRole("button", { name: "Open game menu" }).click();
  await page.getByRole("button", { name: "Quit game", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Quit and discard this game?",
  });
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await expect(dialog).toContainText(game.id);
  await expect(dialog).toContainText("internal audit archive");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Open game menu" }).click();
  await page.getByRole("button", { name: "Quit game", exact: true }).click();
  await page.screenshot({
    path: info.outputPath("quit-game-confirmation.png"),
  });
  await dialog
    .getByRole("button", { name: "Quit and discard", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  const finalDialog = page.getByRole("dialog", {
    name: "Are you sure?",
    exact: true,
  });
  await expect(
    finalDialog.getByRole("button", { name: "Keep playing", exact: true }),
  ).toBeFocused();
  expect(writes).toHaveLength(0);
  await finalDialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Quit and discard", exact: true })
    .click();
  await finalDialog
    .getByRole("button", { name: "Keep playing", exact: true })
    .click();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Open game menu" }).click();
  await page.getByRole("button", { name: "Quit game", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Quit and discard", exact: true })
    .click();
  const confirm = finalDialog.getByRole("button", {
    name: "Yes, quit this game",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("quit-final-confirmation.png"),
  });
  await confirm.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(
    finalDialog.getByRole("button", { name: "Retry saved deletion" }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  await expect(
    finalDialog.getByRole("button", {
      name: "Yes, quit this game",
      exact: true,
    }),
  ).toBeDisabled();
  await finalDialog
    .getByRole("button", { name: "Retry saved deletion" })
    .click();
  await expect(finalDialog).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(JSON.stringify(shared.games[0])).toBe(otherBefore);
  await expect(page.getByLabel("Current turn elapsed time")).toHaveCount(0);
  await page.goto("/family/scrabble");
  await page.getByRole("button", { name: "Open game menu" }).click();
  await page
    .getByRole("button", { name: "Scrabble history", exact: true })
    .click();
  await expect(page.locator(".game-list-item")).toHaveCount(1);
  await expect(page.locator(".game-list-item")).toContainText("Paused");
});

for (const change of ["ownership", "revision", "finalized"] as const) {
  test(`Quit rechecks ${change} while final confirmation is open`, async ({
    page,
  }) => {
    const shared = fixture();
    const game = shared.games[0];
    let writes = 0;
    await mock(page, shared, async () => {
      writes++;
      throw Error("Quit must not send after the game changes");
    });
    await page
      .getByRole("button", { name: "Return to game", exact: true })
      .click();
    await page.getByRole("button", { name: "Open game menu" }).click();
    await page.getByRole("button", { name: "Quit game", exact: true }).click();
    await page
      .getByRole("button", { name: "Quit and discard", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Are you sure?",
      exact: true,
    });
    if (change === "ownership") {
      shared.gameAccess[game.id].scorerUserId = memberId;
      shared.gameAccess[game.id].canScore = false;
    } else {
      const next = applyCommand(
        game,
        change === "revision"
          ? { type: "pass", id: "elsewhere", expectedRevision: game.revision }
          : {
              type: "finalize",
              reason: "early",
              racks: { ada: Array.from({ length: 7 }, () => "A" as const) },
              id: "ended-elsewhere",
              expectedRevision: game.revision,
            },
        testLexicon,
      );
      if (!next.ok) throw Error(next.error.message);
      shared.games[0] = next.game;
    }
    const refreshed = page.waitForResponse(
      (r) => r.url().endsWith("/api/family") && r.request().method() === "GET",
    );
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await (await refreshed).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await dialog
      .getByRole("button", { name: "Yes, quit this game", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Nothing was discarded",
    );
    expect(writes).toBe(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
}
