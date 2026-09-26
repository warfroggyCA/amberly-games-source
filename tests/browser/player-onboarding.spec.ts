import { test, expect } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";
import type {
  SharedMutation,
  SharedOperation,
} from "../../src/lib/shared-contract";

test("invitation opens the linked profile, preserves rejected input, then enters Games", async ({
  page,
}, testInfo) => {
  const { family } = await installFixture(page);
  family.member.role = "member";
  family.member.profileSetupPending = true;
  family.member.revision = 0;
  family.playerAccess.doug = { revision: 0, userId: family.member.userId };
  let accepted = false;
  let fail = true;
  let operation: SharedOperation | undefined;
  await page.route("**/api/family/join", (route) => {
    accepted = true;
    return route.fulfill({ json: { accepted: true } });
  });
  await page.route(/\/api\/family(?:\?.*)?$/, async (route) => {
    if (!accepted)
      return route.fulfill({
        status: 403,
        json: { error: "Accept your invitation." },
      });
    if (route.request().method() === "GET")
      return route.fulfill({ json: family });
    operation = (route.request().postDataJSON() as SharedMutation).operation;
    if (fail) {
      fail = false;
      return route.fulfill({
        status: 400,
        json: { error: "Please check your profile and retry." },
      });
    }
    if (operation.type !== "complete-profile") throw Error("Unexpected action");
    const player = { id: operation.id, ...operation.profile };
    family.players = family.players.map((p) =>
      p.id === player.id ? player : p,
    );
    family.member.profileSetupPending = false;
    family.member.revision = 1;
    return route.fulfill({
      json: {
        player,
        playerAccess: { revision: 1, userId: family.member.userId },
      },
    });
  });
  await page.goto("/family");
  await page.getByRole("button", { name: "Accept family invitation" }).click();
  await expect(
    page.getByRole("heading", { name: "Set up your player profile" }),
  ).toBeVisible();
  await expect(page.getByLabel("Real name", { exact: true })).toHaveValue(
    "Doug",
  );
  await page.getByLabel("Nickname (optional)").fill("Warfroggy");
  await fitsWidth(page);
  await page.screenshot({
    path: testInfo.outputPath("profile-welcome.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save & go to games" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "check your profile" }),
  ).toBeVisible();
  await expect(page.getByLabel("Nickname (optional)")).toHaveValue("Warfroggy");
  await page.getByRole("button", { name: "Save & go to games" }).click();
  await expect(
    page.getByRole("heading", { name: "What are we playing?" }),
  ).toBeVisible();
  expect(operation).toMatchObject({
    type: "complete-profile",
    id: "doug",
    profile: { name: "Doug", nickname: "Warfroggy" },
  });
  expect(family.players).toHaveLength(4);
});

test("new profile survives an uncertain save and retries the same request after reload", async ({
  page,
}) => {
  const { family } = await installFixture(page);
  family.member.role = "member";
  family.member.playerId = null;
  family.member.profileSetupPending = true;
  family.member.revision = 0;
  let firstId: string | undefined;
  let fail = true;
  await page.route(/\/api\/family(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: family });
    const { requestId, operation } = route
      .request()
      .postDataJSON() as SharedMutation;
    if (operation.type !== "complete-profile") throw Error("Unexpected action");
    if (fail) {
      fail = false;
      firstId = requestId;
      return route.fulfill({
        status: 503,
        json: { error: "Connection interrupted." },
      });
    }
    expect(requestId).toBe(firstId);
    const player = { id: operation.id, ...operation.profile };
    family.players.push(player);
    family.member.playerId = player.id;
    family.member.profileSetupPending = false;
    return route.fulfill({
      json: {
        player,
        playerAccess: { revision: 0, userId: family.member.userId },
      },
    });
  });
  await page.goto("/family");
  await expect(
    page.getByRole("button", { name: "Save & go to games" }),
  ).toBeDisabled();
  await page.getByLabel("Real name", { exact: true }).fill("New player");
  await page.getByRole("button", { name: "Save & go to games" }).click();
  await expect(
    page.getByRole("button", { name: "Retry saved profile" }),
  ).toBeVisible();
  await page.reload();
  const retry = page.getByRole("button", { name: "Retry saved profile" });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(
    page.getByRole("heading", { name: "What are we playing?" }),
  ).toBeVisible();
  expect(family.players.filter((p) => p.name === "New player")).toHaveLength(1);
});

test("administrator can reserve a roster profile and sees account links", async ({
  page,
}, testInfo) => {
  const { family } = await installFixture(page);
  family.playerAccess.doug = { revision: 0, userId: family.member.userId };
  family.playerAccess.erin = { revision: 0, userId: null };
  let sent: SharedOperation | undefined;
  await page.route(/\/api\/family(?:\?.*)?$/, (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: family });
    sent = (route.request().postDataJSON() as SharedMutation).operation;
    if (sent.type !== "invite-member") throw Error("Unexpected action");
    family.invitations.push({
      email: sent.email,
      active: true,
      playerId: sent.playerId,
    });
    return route.fulfill({ json: {} });
  });
  await page.goto("/family");
  await page.getByRole("button", { name: "Open Amberly menu" }).click();
  await page
    .getByRole("button", { name: "Family access", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Amberly access",
    exact: true,
  });
  await expect(dialog.getByText("Player: Doug", { exact: true })).toBeVisible();
  await dialog.getByLabel("Family member’s email").fill("erin@example.test");
  await dialog
    .getByLabel("Player profile for this invitation")
    .selectOption("erin");
  await fitsWidth(page);
  await page.screenshot({
    path: testInfo.outputPath("invite-profile.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Allow this person to join" })
    .click();
  await expect(
    dialog.getByText("erin@example.test · Invitation available"),
  ).toBeVisible();
  expect(sent).toMatchObject({
    type: "invite-member",
    email: "erin@example.test",
    playerId: "erin",
  });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copiedInvitation = text;
        },
      },
    });
  });
  await dialog.getByRole("button", { name: "Copy invitation link" }).click();
  const expectedLink = new URL("/family", page.url()).href;
  await expect(page.locator("html")).toHaveAttribute(
    "data-copied-invitation",
    expectedLink,
  );
  await expect(
    dialog.getByRole("status").filter({ hasText: "Invitation link copied" }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Invitation link", { exact: true }),
  ).toHaveValue(expectedLink);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });
  await dialog.getByRole("button", { name: "Copy invitation link" }).click();
  await expect(
    dialog.getByRole("status").filter({ hasText: "copy it manually" }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Invitation link", { exact: true }),
  ).toHaveValue(expectedLink);
  await fitsWidth(page);
});
