import { expect, test, type Page } from "@playwright/test";

async function fitsPhoneWidth(page: Page) {
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.width);
  const title = await page.getByRole("heading", { level: 1 }).boundingBox();
  expect(title).not.toBeNull();
  expect(title!.x).toBeGreaterThanOrEqual(20);
  expect(title!.x + title!.width).toBeLessThanOrEqual(dimensions.width - 20);
}

// All requests are intercepted; these checks cannot send email or enter Google.
test("welcome stays usable through a slow session check and sign-in failures", async ({
  page,
}, testInfo) => {
  let finishCheck!: () => void;
  const pendingCheck = new Promise<void>((resolve) => {
    finishCheck = resolve;
  });
  let checks = 0;
  await page.route("**/api/auth/session", async (route) => {
    if (++checks === 1) {
      await pendingCheck;
      return route.fulfill({
        status: 503,
        json: { error: "Connection interrupted. Please retry." },
      });
    }
    return route.fulfill({
      json: { configured: true, user: null, signInMethod: "google" },
    });
  });
  await page.route("**/api/auth/google", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Google sign-in could not start. Please retry." },
    }),
  );
  await page.goto("/family");
  await expect(page.getByRole("status")).toHaveText(
    "Checking Amberly sign-in…",
  );
  await fitsPhoneWidth(page);
  await page.screenshot({
    path: testInfo.outputPath("welcome-loading.png"),
    fullPage: true,
  });
  finishCheck();
  await expect(
    page.getByRole("alert").filter({ hasText: "Connection interrupted" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  const google = page.getByRole("button", { name: "Continue with Google" });
  await expect(google).toBeEnabled();
  await fitsPhoneWidth(page);
  if (page.viewportSize()!.height > 600) await expect(google).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("welcome-ready.png"),
    fullPage: true,
  });
  await google.click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Google sign-in could not start" }),
  ).toBeVisible();
  await expect(google).toBeEnabled();
  await page.getByRole("link", { name: "Amberly Games home" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("email-code entry preserves input and recovery controls after rejection", async ({
  page,
}) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { configured: true, user: null, signInMethod: "email" },
    }),
  );
  await page.route("**/api/auth/code", (route) =>
    route.fulfill({ json: { accepted: true } }),
  );
  await page.route("**/api/auth/verify", (route) =>
    route.fulfill({
      status: 401,
      json: { error: "That code has expired. Please try again." },
    }),
  );
  await page.goto("/family");
  await page.getByLabel("Your email").fill("player@example.test");
  await page.getByRole("button", { name: "Email me a code" }).click();
  const code = page.getByLabel("Email code");
  await code.fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "That code has expired" }),
  ).toBeVisible();
  await expect(code).toHaveValue("123456");
  await fitsPhoneWidth(page);
  await page.getByRole("button", { name: "Use another email" }).click();
  await expect(page.getByLabel("Your email")).toHaveValue(
    "player@example.test",
  );
  await page.getByRole("link", { name: "Games on this device" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("shared-history loading and connection recovery use the same welcome surface", async ({
  page,
}, testInfo) => {
  let finishLoad!: () => void;
  const pendingLoad = new Promise<void>((resolve) => {
    finishLoad = resolve;
  });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        configured: true,
        signInMethod: "google",
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "player@example.test",
        },
      },
    }),
  );
  await page.route(/\/api\/family(?:\?.*)?$/, async (route) => {
    await pendingLoad;
    return route.fulfill({
      status: 403,
      json: { error: "Accept your Amberly invitation to open shared games." },
    });
  });
  await page.goto("/family");
  await expect(page.getByRole("status")).toHaveText("Opening shared history…");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await fitsPhoneWidth(page);
  finishLoad();
  await expect(
    page.getByRole("heading", { name: "Amberly access" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept family invitation" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Retry connection" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Export retained entry" }),
  ).toBeEnabled();
  await fitsPhoneWidth(page);
  await page.screenshot({
    path: testInfo.outputPath("welcome-recovery.png"),
    fullPage: true,
  });
});
