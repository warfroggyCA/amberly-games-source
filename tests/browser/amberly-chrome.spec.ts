import { expect, test } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";

const photo =
  "data:image/jpeg;base64,/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCABAAEADASIAAhEBAxEB/8QAGgABAAMBAQEAAAAAAAAAAAAAAAUGBwgBAv/EACoQAAICAgEBBwQDAQAAAAAAAAECAAMEEQUGBxMhMUFxgSJhkcESMqFR/8QAGAEAAwEBAAAAAAAAAAAAAAAAAAUGAwL/xAAhEQACAQMEAwEAAAAAAAAAAAABAgADBBEFITFBEhNh4f/aAAwDAQACEQMRAD8A02IiSMo4ieMwVSzEBQNknyEpPL9ovHYd7VYVFmaVOi4b+CH2PiT+JrTovVOEGZnVrJSGXOJd4lI4jtF47LvWrNoswyx0HLB0HufAj8S7KwZQykFSNgjyMKtF6Rw4xClWSqMocz2IiZTSIiIQlI7VuTsw+GoxKWKnLchyPVF1sfJImSTW+1bjLMzhqMulSxxHJcD0RtbPwQJkkoNO8fTtz3J7UvL3HPHUTW+ynk7Mzhr8S5ixxHAQn0Rt6HwQZkk1zsp4yzD4a7LuUqctwUB9UXej8kmGo+Pp356hpvl7hjjuXaIiT8oYiJC9U9QY3T+B31w7y59iqoHRc/oD/s6RC7BV5nLuqKWY7SXuatanNxQVa+ouRrX33Mu6h4jpB8lnxuZXDYnxSpTcm/sB5fmVXnOd5DmrzZnXsyb2tS+CL7D9+ci47trFqW5fB+RJc361dgmR9/Jfun+I6QTJR8nmVy2U7CWqaUPuD5/majS1bVIaShq19JQ+Gvtqc4SU4PneQ4W8WYN7Km9tU3ije4/fnC5sWq7h8n7C2vlpbFMD5+zfokL0t1BjdQYHfUju700LaidlD+wfQyaiR0KMVbmO0dXUMp2MTCetOVfluocq0sTTWxqqHoFU6/3xPzN2nOF6NXfYln91YhvfcZ6WoLM3YizVWIVV6M+IiI6iSIiIQk50Xyj8T1Di2hiKrGFVo9CrHX+eB+Ju05woRrL60r/uzAL77nR8S6ooDK3ZjvSmJVl6E//Z";

test("shared menu preserves Crokinole drafts and reaches the same settings from Scrabble", async ({
  page,
}, testInfo) => {
  const fixture = await installFixture(page);
  fixture.family.players[0].photoDataUrl = photo;
  await page.goto("/family/crokinole/new");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(
    page.locator(".crokinole-standing .player-avatar-photo"),
  ).toHaveCount(1);
  await expect(
    page
      .locator(".crokinole-standing")
      .filter({ hasText: "Erin" })
      .locator(".crokinole-disc"),
  ).toHaveText("E");
  await page.getByRole("button", { name: "Add Round 1", exact: true }).click();
  await expect(
    page.getByRole("dialog").locator(".player-avatar-photo"),
  ).toHaveCount(1);
  await page.getByLabel("Doug round total", { exact: true }).fill("25");
  await page.getByRole("button", { name: "Keep draft & close" }).click();
  await page.getByRole("button", { name: "Open Amberly menu" }).click();
  const menu = page.getByRole("dialog", { name: "Amberly Games", exact: true });
  await expect(menu).toBeVisible();
  for (const name of ["Games", "History", "Players", "Settings"])
    await expect(menu.getByRole("button", { name, exact: true })).toBeVisible();
  await fitsWidth(page);
  await page.screenshot({ path: testInfo.outputPath("shared-menu.png") });
  await menu.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Games", exact: true }).click();
  await page.getByRole("button", { name: "Resume Crokinole" }).click();
  await page.getByRole("button", { name: "Continue entry" }).click();
  await expect(
    page.getByLabel("Doug round total", { exact: true }),
  ).toHaveValue("25");
  await page.getByRole("button", { name: "Keep draft & close" }).click();
  await page
    .getByRole("link", { name: "Amberly Games — Home", exact: true })
    .click();
  await page.getByRole("button", { name: "Open Scrabble" }).click();
  await expect(page).toHaveURL(/\/family\/scrabble$/);
  await expect(
    page.getByRole("button", { name: "New game", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open game menu" }).click();
  await page
    .getByRole("dialog", { name: "Amberly Games", exact: true })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(page).toHaveURL(/\/family\/settings$/);
  expect(fixture.game().rounds).toHaveLength(0);
});

test("doubles display both partners with photos and disc colours", async ({
  page,
}, testInfo) => {
  const fixture = await installFixture(page);
  fixture.family.players[0].photoDataUrl = photo;
  await page.goto("/family/crokinole/new");
  await page.getByRole("button", { name: "4 players", exact: true }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".crokinole-standing .crokinole-disc")).toHaveCount(
    4,
  );
  await expect(
    page.locator(".crokinole-standing .player-avatar-photo"),
  ).toHaveCount(1);
  await fitsWidth(page);
  await page.screenshot({
    path: testInfo.outputPath("shared-doubles-identity.png"),
  });
});

test("saving a round stays available during background draft synchronization", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/family/crokinole*", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().operation.type === "save-draft"
    ) {
      started();
      await gate;
    }
    await route.fallback();
  });
  await page.goto("/family/crokinole/new");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.getByRole("button", { name: "Add Round 1", exact: true }).click();
  await page.getByLabel("Doug round total", { exact: true }).fill("65");
  await began;
  try {
    const save = page.getByRole("button", { name: "Save round", exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(
      page.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    expect(fixture.game().rounds).toHaveLength(0);
  } finally {
    release();
  }
  await expect(
    page.getByRole("button", { name: "Add Round 2", exact: true }),
  ).toBeVisible();
  expect(fixture.game().totals).toEqual({ doug: 65, erin: 0 });
});
