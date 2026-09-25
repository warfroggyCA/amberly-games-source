import { test, expect } from "@playwright/test";
import { generatePuzzle } from "../../src/domain/gym/generator";
import { makeBudget } from "../../src/domain/gym/model";
import { readFileSync } from "node:fs";
import type { EnumerableLexicon } from "../../src/domain/solver";
const dictionary = new Set<string>([
  ...JSON.parse(
    readFileSync(
      new URL(
        "../../src/lib/generated/merriam-2026-09-14.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
  ...JSON.parse(
    readFileSync(
      new URL(
        "../../src/lib/generated/family-additions-2026-09-14.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
]);
const defaultLexicon: EnumerableLexicon = {
  id: "fixture",
  edition: "fixture",
  status: "test",
  words: [...dictionary].sort(),
  has: (word) => dictionary.has(word),
};
import { scoreMove } from "../../src/domain/scoring";
import { draftWordFeedback } from "../../src/domain/gym/word-feedback";
import { fitsWidth } from "./fixtures/crokinole";
const seed = "gym-word-lookup-v1";
function invalidMove() {
  const { puzzle } = generatePuzzle(seed, defaultLexicon, makeBudget());
  for (let id = 0; id < 7; id++)
    for (let row = 0; row < 15; row++)
      for (let col = 0; col < 15; col++) {
        const letter = puzzle.position.rack[id];
        if (letter === "?" || puzzle.position.board[row][col]) continue;
        const placements = [{ row, col, tile: { letter, blank: false } }];
        const score = scoreMove(
          puzzle.position.board,
          placements,
          defaultLexicon,
          7,
        );
        if (!score.ok && score.error.code === "INVALID_WORD") {
          const words = draftWordFeedback(
            puzzle.position.board,
            placements,
            defaultLexicon,
          )
            .filter((word) => !word.valid)
            .map((word) => word.word);
          if (words.length) return { id, row, col, words };
        }
      }
  throw new Error("No invalid crossing in fixture");
}
test("official lookup preserves tiles, recovers publisher failure, refreshes scoring and retains additions", async ({
  page,
}, testInfo) => {
  const move = invalidMove();
  await page.addInitScript((seed) => {
    const Original = window.Worker;
    let failedRefresh = false;
    let generations = 0;
    window.Worker = class extends Original {
      postMessage(value: { type: string; seed?: string; id?: number }) {
        if (value.type === "refresh" && !failedRefresh) {
          failedRefresh = true;
          setTimeout(
            () =>
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: {
                    id: value.id,
                    type: "error",
                    message: "Test refresh interruption",
                  },
                }),
              ),
            0,
          );
          return;
        }
        if (value.type === "generate") {
          value.seed = seed;
          if (++generations === 2) {
            setTimeout(
              () =>
                this.dispatchEvent(
                  new MessageEvent("message", {
                    data: {
                      id: value.id,
                      type: "error",
                      message: "Test generation interruption",
                    },
                  }),
                ),
              0,
            );
            return;
          }
        }
        super.postMessage(value);
      }
    };
  }, seed);
  let unavailable = true;
  await page.route("**/api/official-word?*", (route) => {
    if (unavailable)
      return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    const word = new URL(route.request().url()).searchParams.get("word")!;
    return route.fulfill({
      json: {
        word,
        playable: true,
        source: "merriam-webster",
        sourceUrl: `https://scrabble.merriam.com/finder/${word.toLowerCase()}`,
        verifiedAt: "2026-09-25T00:00:00.000Z",
      },
    });
  });
  await page.goto("/gym-lab");
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  const square = page.locator(
    `[data-row="${move.row}"][data-col="${move.col}"]`,
  );
  await square.click();
  await page.locator(`[data-gym-rack] [data-rack-id="${move.id}"]`).click();
  await expect(page.locator(".gym-move-badge")).toContainText("invalid");
  await page.getByRole("button", { name: "Word lookup", exact: true }).click();
  await expect(page.getByLabel("Word or words")).toHaveValue(
    move.words.join(", "),
  );
  await page.getByRole("button", { name: "Check Merriam-Webster" }).click();
  await expect(page.locator(".official-results")).toContainText("unavailable");
  unavailable = false;
  await page.getByRole("button", { name: "Check Merriam-Webster" }).click();
  await expect(page.locator(".official-results")).toContainText(
    "Verified and saved",
  );
  await page.getByRole("button", { name: "Back to board" }).click();
  await expect(square).toHaveClass(/is-draft/);
  await expect(
    page.getByRole("button", { name: "Check move", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Hint", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Next random puzzle", exact: true })
    .click();
  await expect(
    page.getByText("Test generation interruption", { exact: true }),
  ).toBeVisible();
  await expect(square).toHaveClass(/is-draft/);
  await expect(
    page.getByRole("button", { name: "Check move", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Retry word list", exact: true })
    .click();
  await expect(page.locator(".gym-move-badge")).toHaveClass(/is-valid/);
  await expect(
    page.getByText("Word list updated.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check move", exact: true }).click();
  await expect(
    page.getByText("Your move is legal.", { exact: true }),
  ).toBeVisible();
  await fitsWidth(page);
  await page.screenshot({
    path: testInfo.outputPath("verified-gym-word.png"),
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Start new practice", exact: true })
    .click();
  await square.click();
  await page.locator(`[data-gym-rack] [data-rack-id="${move.id}"]`).click();
  await expect(page.locator(".gym-move-badge")).toHaveClass(/is-valid/);
});

test("family lookup distinguishes a confirmed word from a failed save and records the confirmed snapshot", async ({
  page,
}) => {
  const { installFixture } = await import("./fixtures/crokinole");
  const { family } = await installFixture(page);
  const events: import("../../src/lib/gym-history-contract").GymWrite[] = [];
  const evidence = {
    word: "ZZTEST",
    source: "merriam-webster",
    sourceUrl: "https://scrabble.merriam.com/finder/zztest",
    verifiedAt: "2026-09-25T00:00:00.000Z",
  };
  let saved = false,
    fail = true;
  await page.route("**/api/family/words", (route) => {
    expect(route.request().headers()["x-scrabble-user"]).toBe(
      family.member.userId,
    );
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual(["ZZTEST"]);
      if (fail)
        return route.fulfill({
          status: 503,
          json: { error: "Could not save the confirmed word. Retry safely." },
        });
      saved = true;
    }
    return route.fulfill({ json: { words: saved ? [evidence] : [] } });
  });
  await page.route("**/api/family/gym", (route) => {
    if (route.request().method() === "POST") {
      const data = route.request().postDataJSON();
      events.push(data);
      return route.fulfill({
        json: {
          eventId: data.event.id,
          sessionId: data.sessionId,
          sequence: data.event.sequence,
        },
      });
    }
    return route.fulfill({
      json: {
        identity: {
          userId: family.member.userId,
          familyId: family.family.id,
          playerId: "doug",
        },
        sessions: [],
        nextCursor: null,
      },
    });
  });
  await page.route("**/api/official-word?*", (route) =>
    route.fulfill({ json: { ...evidence, playable: true } }),
  );
  await page.goto("/gym-lab?from=family");
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  await page.locator(".gym-board button:not(.has-tile)").first().click();
  await page
    .locator(
      '[data-gym-rack] button:not([disabled]):not([aria-label*="blank"])',
    )
    .first()
    .click();
  await page.getByRole("button", { name: "Word lookup", exact: true }).click();
  await expect(
    page.getByText("shared across signed-in devices", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Word or words").fill("ZZTEST");
  await page.getByRole("button", { name: "Check Merriam-Webster" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Could not save",
  );
  expect(saved).toBe(false);
  await expect(page.locator(".gym-board .is-draft")).toHaveCount(1);
  fail = false;
  await page.getByRole("button", { name: "Check Merriam-Webster" }).click();
  await expect(page.locator(".official-results")).toContainText(
    "Verified and saved",
  );
  await page.getByRole("button", { name: "Back to board" }).click();
  await expect(page.locator(".gym-board .is-draft")).toHaveCount(1);
  await page.getByRole("button", { name: "Word lookup", exact: true }).click();
  await expect
    .poll(() =>
      events.some(
        (data) =>
          data.event.payload.type === "word-lookup" &&
          data.event.referenceWords?.includes("ZZTEST"),
      ),
    )
    .toBe(true);
});
