import { test, expect } from "@playwright/test";

test("profile progress keeps its denominators across pages and explains assistance", async ({
  page,
}, info) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        configured: true,
        user: {
          id: "b1111111-1111-4111-8111-111111111111",
          email: "practice@example.test",
        },
      },
    }),
  );
  await page.route("**/api/family/words", (route) =>
    route.fulfill({ json: { words: [] } }),
  );
  await page.route("**/api/family/gym**", (route) =>
    route.fulfill({
      json: {
        identity: {
          familyId: "a1111111-1111-4111-8111-111111111111",
          userId: "b1111111-1111-4111-8111-111111111111",
          playerId: "ada",
        },
        sessions: [],
        nextCursor: new URL(route.request().url()).searchParams.has("cursor")
          ? null
          : "older",
        progress: {
          version: "verified-first-moves-v1",
          sessions: 24,
          attempts: 30,
          retries: 10,
          firstAttempts: 20,
          validFirstAttempts: 15,
          assistedFirstAttempts: 12,
          eligibleFirstAttempts: 4,
          eligibleValidFirstAttempts: 3,
          repeatedSessions: 4,
          resumedSessions: 2,
          score: {
            evaluator: "complete-score-v1",
            ratedFirstMoves: 10,
            maximumFirstMoves: 2,
            averagePercentage: 72.5,
          },
        },
      },
    }),
  );
  await page.goto("/gym-lab?from=family");
  await page
    .getByRole("button", { name: "My practice history", exact: true })
    .click();
  const progress = page.getByRole("region", { name: "Profile progress" });
  await expect(progress).toContainText("3 of 4 valid");
  await expect(progress).toContainText("73% of maximum");
  await expect(progress).toContainText(
    "2 of 10 found a maximum-scoring placement",
  );
  await page.screenshot({
    path: info.outputPath("profile-progress.png"),
    fullPage: true,
  });
  await page
    .getByText("What counts in these results?", { exact: true })
    .click();
  await expect(progress).toContainText(
    "12 first moves had recorded assistance",
  );
  await expect(progress).toContainText("4 sessions have no checked move yet");
  await page
    .getByRole("button", { name: "Older practice", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Older practice", exact: true }),
  ).toHaveCount(0);
  await expect(progress).toContainText("3 of 4 valid");
  await expect(progress.getByRole("progressbar")).toHaveAttribute("max", "4");
});
