import { expect, test } from "@playwright/test";
import { installFixture } from "./fixtures/crokinole";

test("lobby stays silent across navigation and reload, including saved music preferences", async ({
  page,
}) => {
  const musicRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/music/"))
      musicRequests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem("amberly-lobby-music-muted-v1", "false");
    localStorage.setItem("amberly-lobby-music-volume-v1", "1");
  });
  await installFixture(page);
  await page.route("**/api/family/games?*", (route) =>
    route.fulfill({ json: { games: [], nextCursor: null, standings: [] } }),
  );
  await page.goto("/family");
  await expect(
    page.getByRole("heading", { name: "What are we playing?", exact: true }),
  ).toBeVisible();
  for (const name of ["History", "Players", "Settings", "Games"]) {
    await page
      .getByRole("navigation", { name: "Amberly Games", exact: true })
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page).toHaveURL(
      name === "Games"
        ? /\/family$/
        : new RegExp(`/family/${name.toLowerCase()}$`),
    );
    await expect(
      page.getByRole("heading", { name: "Background music", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("slider", { name: "Background music volume" }),
    ).toHaveCount(0);
    await expect(page.locator("[data-lobby-music-toggle]")).toHaveCount(0);
  }
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What are we playing?", exact: true }),
  ).toBeVisible();
  expect(musicRequests).toEqual([]);
});
