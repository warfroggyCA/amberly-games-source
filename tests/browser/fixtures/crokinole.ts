import { expect, type Page } from "@playwright/test";
import {
  applyCrokinoleCommand,
  createCrokinoleGame,
  createCrokinoleRematch,
  DEFAULT_PIECE_COLOURS,
  type CrokinoleGame,
} from "../../../src/domain/crokinole";
import type {
  CrokinoleDraft,
  CrokinoleMutation,
  CrokinoleSharedState,
} from "../../../src/lib/crokinole-contract";
import type { SharedState } from "../../../src/lib/shared-contract";

export async function installFixture(
  page: Page,
  defaults: import("../../../src/domain/crokinole-defaults").CrokinoleDefaults = {
    playerCount: 2,
    format: "singles",
    scoringMode: "cumulative_round_totals",
    endCondition: { type: "fixed_rounds", rounds: 4 },
  },
) {
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "doug@example.test",
  };
  const member = {
    userId: user.id,
    email: user.email,
    role: "superadmin" as const,
    active: true,
    playerId: "doug",
  };
  const family: SharedState = {
    family: { id: "22222222-2222-4222-8222-222222222222", name: "Amberly" },
    member,
    members: [member],
    invitations: [],
    players: [
      { id: "doug", name: "Doug" },
      { id: "erin", name: "Erin" },
      { id: "nate", name: "Nate" },
      { id: "cristine", name: "Cristine" },
    ],
    playerAccess: {},
    games: [],
    gameAccess: {},
    verifiedWords: [],
    nextCursor: null,
  };
  const shared: CrokinoleSharedState = {
    games: [],
    access: {},
    palette: {
      revision: 0,
      colours: structuredClone(DEFAULT_PIECE_COLOURS),
      defaults,
    },
    nextCursor: null,
    creationEnabled: true,
  };
  let draft: CrokinoleDraft | null = null;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { configured: true, signInMethod: "google", user } }),
  );
  await page.route(/\/api\/family(?:\?.*)?$/, (route) => {
    if (route.request().method() !== "GET")
      throw new Error("Unexpected Scrabble mutation");
    return route.fulfill({ json: family });
  });
  await page.route("**/api/family/crokinole*", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { ...shared, draft } });
    const { operation: op } = route
      .request()
      .postDataJSON() as CrokinoleMutation;
    if (op.type === "create-game") {
      const game = createCrokinoleGame(op.definition);
      shared.games.push(game);
      shared.access[game.definition.id] = {
        scorerUserId: user.id,
        generation: 1,
        canScore: true,
        mode: game.definition.mode,
        concerns: [],
      };
      draft = null;
      return route.fulfill({
        json: { game, access: shared.access[game.definition.id], draft: null },
      });
    }
    if (op.type === "rematch") {
      const prior = shared.games.find((g) => g.definition.id === op.gameId)!;
      const game = createCrokinoleRematch(
        prior,
        op.newGameId,
        new Date().toISOString(),
      );
      shared.games.push(game);
      shared.access[game.definition.id] = { ...shared.access[op.gameId] };
      draft = null;
      return route.fulfill({
        json: { game, access: shared.access[game.definition.id], draft: null },
      });
    }
    if (op.type === "save-draft") {
      draft = {
        revision: (draft?.revision ?? 0) + 1,
        baseRevision: op.expectedRevision,
        generation: op.generation,
        values: op.values,
        editingRoundId: op.editingRoundId,
      };
      return route.fulfill({ json: { draft } });
    }
    if (op.type === "command") {
      const index = shared.games.findIndex(
        (g) => g.definition.id === op.gameId,
      );
      const game = applyCrokinoleCommand(shared.games[index], op.command, {
        actorId: user.id,
        createdAt: new Date().toISOString(),
      });
      shared.games[index] = game;
      draft =
        op.command.type === "resume" && draft
          ? {
              ...draft,
              revision: draft.revision + 1,
              baseRevision: game.revision,
            }
          : null;
      return route.fulfill({
        json: { game, access: shared.access[op.gameId], draft },
      });
    }
    if (op.type === "save-defaults") {
      shared.palette = {
        ...shared.palette,
        revision: shared.palette.revision + 1,
        defaults: op.defaults,
      };
      return route.fulfill({ json: { palette: shared.palette } });
    }
    if (op.type === "save-palette") {
      shared.palette = {
        ...shared.palette,
        revision: shared.palette.revision + 1,
        colours: op.colours,
      };
      return route.fulfill({ json: { palette: shared.palette } });
    }
    throw new Error(`Unexpected Crokinole mutation ${op.type}`);
  });
  return { family, shared, game: () => shared.games.at(-1) as CrokinoleGame };
}
export async function fitsWidth(page: Page) {
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
}
