import { test, expect, type Page } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";
import type { UsageReport } from "../../src/lib/access-usage";
const report: UsageReport = {
  from: "2026-09-20T04:00:00.000Z",
  to: "2026-09-27T04:00:00.000Z",
  generatedAt: "2026-09-26T16:00:00.000Z",
  trackingSince: "2026-09-26T12:00:00.000Z",
  summary: { users: 1, visits: 2, activeMs: 75000, savedActions: 1 },
  people: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Doug",
      email: "doug@example.test",
      active: true,
    },
  ],
  rows: [
    {
      id: "visit:1",
      at: "2026-09-26T12:00:00.000Z",
      lastAt: "2026-09-26T12:01:15.000Z",
      actorId: "11111111-1111-4111-8111-111111111111",
      name: "Doug",
      email: "doug@example.test",
      area: "scrabble",
      kind: "visit",
      action: "visit",
      subject: "visit-1",
      activeMs: 75000,
    },
  ],
  nextCursor: null,
};
async function openReport(page: Page) {
  await page.goto("/family");
  await page
    .getByRole("button", { name: "Open Amberly menu", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Access & Usage", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Access & Usage", exact: true }),
  ).toBeVisible();
}
test("superadmin report filters, CSV, keyboard closure and mobile fit", async ({
  page,
}, info) => {
  await installFixture(page);
  const queries: string[] = [];
  await page.route("**/api/family/usage**", (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ json: { accepted: true } });
    const url = new URL(route.request().url());
    queries.push(url.search);
    if (url.searchParams.get("format") === "csv")
      return route.fulfill({
        contentType: "text/csv",
        headers: {
          "Content-Disposition":
            'attachment; filename="amberly-access-usage.csv"',
        },
        body: '"Account"\r\n"Doug"\r\n',
      });
    return route.fulfill({ json: report });
  });
  await openReport(page);
  const dialog = page.getByRole("dialog", {
    name: "Access & Usage",
    exact: true,
  });
  await expect(dialog.getByText("1 min 15 sec", { exact: true })).toBeVisible();
  await expect(
    dialog.locator(".usage-timeline").getByText("Doug", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("Account", { exact: true })
    .selectOption(report.people[0].id);
  await dialog.getByLabel("Area", { exact: true }).selectOption("scrabble");
  await dialog.getByLabel("Activity", { exact: true }).selectOption("visit");
  await dialog.getByRole("button", { name: "Apply filters" }).click();
  await expect.poll(() => queries.at(-1)).toContain("area=scrabble");
  await expect(dialog.getByLabel("Account", { exact: true })).toHaveValue(
    report.people[0].id,
  );
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export filtered CSV" }).click();
  expect((await download).suggestedFilename()).toBe("amberly-access-usage.csv");
  expect(queries.at(-1)).toContain("format=csv");
  await fitsWidth(page);
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
    true,
  );
  await dialog.screenshot({ path: info.outputPath("access-usage.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
test("ordinary members never receive the report menu entry, even with invitation permission", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  fixture.family.member.role = "member";
  fixture.family.member.permissions = {
    startGames: true,
    scoreGames: true,
    addPlayers: true,
    editOwnProfile: true,
    manageEquipment: true,
    shareGames: true,
    inviteMembers: true,
    exportHistory: true,
  };
  await page.route("**/api/family/usage**", (route) =>
    route.fulfill({ json: { accepted: true } }),
  );
  await page.goto("/family");
  await page
    .getByRole("button", { name: "Open Amberly menu", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Access & Usage", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.goto("/family/scrabble");
  await page
    .getByRole("button", { name: /open.*menu/i })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Access & Usage", exact: true }),
  ).toHaveCount(0);
});
test("report errors are retryable and loss of access clears previously loaded data", async ({
  page,
}) => {
  await installFixture(page);
  let status = 503;
  await page.route("**/api/family/usage**", (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ json: { accepted: true } });
    return route.fulfill({
      status,
      json:
        status === 200
          ? report
          : {
              error:
                status === 403
                  ? "Only superadmins can view access and usage."
                  : "Temporarily unavailable",
            },
    });
  });
  await openReport(page);
  const dialog = page.getByRole("dialog", {
    name: "Access & Usage",
    exact: true,
  });
  await expect(dialog.getByRole("alert")).toHaveText("Temporarily unavailable");
  status = 200;
  await dialog.getByRole("button", { name: "Retry report" }).click();
  await expect(
    dialog.locator(".usage-timeline").getByText("Doug", { exact: true }),
  ).toBeVisible();
  status = 403;
  await dialog.getByRole("button", { name: "Export filtered CSV" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Only superadmins can view access and usage.",
  );
  await expect(
    dialog.locator(".usage-timeline").getByText("Doug", { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Export filtered CSV" }),
  ).toHaveCount(0);
});
test("tracking stops on idle and hidden pages, and resumes on interaction", async ({
  page,
}) => {
  await installFixture(page);
  const pulses: { activeMs: number; area: string }[] = [];
  await page.route("**/api/family/usage**", (route) => {
    pulses.push(route.request().postDataJSON());
    return route.fulfill({ json: { accepted: true } });
  });
  await page.clock.install();
  await page.goto("/family");
  await expect(
    page.getByRole("button", { name: "Open Amberly menu", exact: true }),
  ).toBeVisible();
  await page.clock.runFor(75000);
  await expect.poll(() => pulses.length).toBeGreaterThan(1);
  expect(pulses.reduce((s, p) => s + p.activeMs, 0)).toBeLessThanOrEqual(60000);
  const idle = pulses.length;
  await page.clock.runFor(30000);
  expect(pulses).toHaveLength(idle);
  await page
    .getByRole("button", { name: "Open Amberly menu", exact: true })
    .click();
  await page.clock.runFor(15000);
  await expect.poll(() => pulses.length).toBeGreaterThan(idle);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(5000);
  const hidden = pulses.length;
  await page.clock.runFor(60000);
  expect(pulses).toHaveLength(hidden);
});

test("a brief visible visit is measured, while closing an idle tab creates no extra receipt", async ({
  page,
}) => {
  await installFixture(page);
  const pulses: { activeMs: number }[] = [];
  await page.route("**/api/family/usage**", (route) => {
    pulses.push(route.request().postDataJSON());
    return route.fulfill({ json: { accepted: true } });
  });
  await page.clock.install();
  await page.goto("/family");
  await expect.poll(() => pulses.length).toBe(1);
  await page.clock.runFor(2000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => pulses.length).toBe(2);
  expect(pulses[1].activeMs).toBeGreaterThan(0);
  expect(pulses[1].activeMs).toBeLessThanOrEqual(3000);
  await page.clock.fastForward(3600000);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.clock.runFor(5000);
  expect(pulses).toHaveLength(2);
});
