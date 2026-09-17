import { expect, test, type Page, type Route } from "@playwright/test";
import { createGame } from "../../src/domain/game";
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
  await page.goto("/family");
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
    panel.getByRole("switch", { name: "Change tile sets" }),
  ).toBeChecked();
  await expect(
    panel.getByRole("switch", { name: "Invite people" }),
  ).not.toBeChecked();
  // The entire labelled row is a touch target, not only the small thumb.
  await panel
    .locator("label")
    .filter({ has: page.getByRole("switch", { name: "Change tile sets" }) })
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
    panel.getByRole("switch", { name: "Change tile sets" }),
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
    panel.getByRole("switch", { name: "Change tile sets" }),
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
  ).toBeDisabled();
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
  await page.getByRole("button", { name: "History", exact: true }).click();
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
