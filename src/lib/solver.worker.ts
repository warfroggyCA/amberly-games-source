import type { TileSupply } from "../domain/board";
import { findMoves } from "../domain/solver";
import type { MoveSearchResult } from "../domain/solver";
import type { Board } from "../domain/types";
import { extendLexicon, type VerifiedWord } from "../domain/verified-words";
import { resolveLexicon } from "./lexicons";

// Keep the worker type local: adding the WebWorker lib globally conflicts with DOM declarations.
const scope = self as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
    options: { once: boolean },
  ): void;
  postMessage(value: unknown): void;
};
scope.addEventListener(
  "message",
  (event) => {
    const data = event.data;
    const request =
      typeof data === "object" && data !== null
        ? (data as Record<string, unknown>)
        : {};
    const id = request.id;
    let result: MoveSearchResult;
    try {
      result =
        typeof id === "number" && Number.isSafeInteger(id) && id > 0
          ? findMoves(
              request.board as Board,
              request.rack as string[],
              extendLexicon(
                resolveLexicon(request.lexicon),
                (request.verifiedWords === undefined
                  ? []
                  : request.verifiedWords) as readonly VerifiedWord[],
              ),
              {
                limit: 5,
                // Two-blank full-list fixtures require more than 1M states.
                // The client also bounds wall time and terminates on cancellation.
                maxNodes: 2_000_000,
                tileSupply: request.tileSupply as TileSupply | undefined,
              },
            )
          : {
              status: "invalid",
              error: "Invalid search request identifier.",
              moves: [],
              visitedNodes: 0,
              totalMoves: 0,
            };
    } catch {
      result = {
        status: "unavailable",
        reason:
          "The selected word reference or move search is unavailable. The game has not advanced.",
        moves: [],
        visitedNodes: 0,
        totalMoves: 0,
      };
    }
    scope.postMessage({ id, result });
  },
  { once: true },
);
