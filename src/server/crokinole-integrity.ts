import {
  hydrateCrokinoleGame,
  type CrokinoleDefinition,
} from "../domain/crokinole";
import { isDeepStrictEqual } from "node:util";
import { SharedRepositoryError } from "./shared-repository";

export function checkedCrokinoleState(
  definition: CrokinoleDefinition,
  events: unknown,
  state: unknown,
  revision: number,
) {
  try {
    const game = hydrateCrokinoleGame(definition, events);
    if (game.revision !== revision || !isDeepStrictEqual(game, state))
      throw new Error();
    return game;
  } catch {
    throw new SharedRepositoryError(
      "HISTORY_INTEGRITY",
      "The game history needs recovery. No data has been changed.",
      500,
    );
  }
}
