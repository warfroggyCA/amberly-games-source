import { expect, test } from "@playwright/test";

// Attribute-mismatch diagnostics are development-only. Run with a dedicated dev server.
test.skip(
  process.env.GYM_HYDRATION_DEV !== "true",
  "Requires the development hydration diagnostics",
);

test("browser-injected root attributes are tolerated while Gym hydrates", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.request.get("/gym-lab");
  expect(await response.text()).not.toContain("__gcrremoteframetoken=");
  await page.addInitScript(() => {
    const inject = () => {
      if (!document.documentElement) return;
      document.documentElement.setAttribute(
        "__gcrremoteframetoken",
        "test-browser-token",
      );
      observer.disconnect();
    };
    const observer = new MutationObserver(inject);
    observer.observe(document, { childList: true, subtree: true });
    inject();
  });
  await page.goto("/gym-lab");
  await page.getByRole("button", { name: "How to play", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    errors.filter((text) => /hydrat|didn't match|server rendered/i.test(text)),
  ).toEqual([]);
});

test("descendant mismatches still produce hydration diagnostics", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const inject = () => {
      if (!document.body) return;
      document.body.setAttribute("data-unexpected-test-attribute", "mismatch");
      observer.disconnect();
    };
    const observer = new MutationObserver(inject);
    observer.observe(document, { childList: true, subtree: true });
    inject();
  });
  await page.goto("/gym-lab");
  await expect
    .poll(() =>
      errors.some((text) => /hydrat|didn't match|server rendered/i.test(text)),
    )
    .toBe(true);
});
