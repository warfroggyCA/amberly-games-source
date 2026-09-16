import { isCoordinate, isTile, type TileSupply } from "../domain/board";
import type { MoveSearchResult, ScoredMove } from "../domain/solver";
import type { Board, Lexicon } from "../domain/types";
import type { VerifiedWord } from "../domain/verified-words";
import { testLexicon } from "./test-lexicon";

export const SOLVER_VERSION = "trie-v1";
const SEARCH_TIMEOUT_MS = 30_000;
const LEGACY_REFERENCE: Pick<Lexicon, "id" | "edition" | "status"> =
  Object.freeze({
    id: testLexicon.id,
    edition: testLexicon.edition,
    status: testLexicon.status,
  });
let requestSequence = 0;

function unavailable(reason: string): MoveSearchResult {
  return {
    status: "unavailable",
    reason,
    moves: [],
    visitedNodes: 0,
    totalMoves: 0,
  };
}
function cancelled(): MoveSearchResult {
  return {
    status: "incomplete",
    reason: "cancelled",
    moves: [],
    visitedNodes: 0,
    totalMoves: 0,
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function validMove(value: unknown): value is ScoredMove {
  if (
    !record(value) ||
    !Array.isArray(value.placements) ||
    value.placements.length < 1 ||
    value.placements.length > 7 ||
    !Array.isArray(value.words) ||
    value.words.length < 1 ||
    value.words.length > 8 ||
    !nonnegativeInteger(value.score) ||
    ![0, 50].includes(value.bingo as number) ||
    value.newTileCount !== value.placements.length ||
    typeof value.key !== "string" ||
    value.key.length > 300
  )
    return false;
  if (
    !Array.from(value.placements).every(
      (p: unknown) =>
        record(p) &&
        isCoordinate(p.row) &&
        isCoordinate(p.col) &&
        isTile(p.tile),
    )
  )
    return false;
  return Array.from(value.words).every(
    (word: unknown) =>
      record(word) &&
      typeof word.word === "string" &&
      word.word.length >= 2 &&
      word.word.length <= 15 &&
      !/[^A-Z]/.test(word.word) &&
      nonnegativeInteger(word.score) &&
      isCoordinate(word.row) &&
      isCoordinate(word.col) &&
      (word.direction === "across" || word.direction === "down"),
  );
}
function validResult(value: unknown): value is MoveSearchResult {
  if (
    !record(value) ||
    !Array.isArray(value.moves) ||
    value.moves.length > 5 ||
    !nonnegativeInteger(value.visitedNodes) ||
    !nonnegativeInteger(value.totalMoves) ||
    value.totalMoves < value.moves.length ||
    !Array.from(value.moves).every(validMove)
  )
    return false;
  if (value.status === "complete") return true;
  if (value.status === "incomplete")
    return value.reason === "node-budget" || value.reason === "cancelled";
  if (
    value.moves.length !== 0 ||
    value.visitedNodes !== 0 ||
    value.totalMoves !== 0
  )
    return false;
  return (
    (value.status === "unavailable" && typeof value.reason === "string") ||
    (value.status === "invalid" && typeof value.error === "string")
  );
}

/** Search the game's pinned word reference in a worker; omitted references preserve legacy callers. */
export function searchMoves(
  board: Board,
  rack: string[],
  signal?: AbortSignal,
  tileSupply?: TileSupply,
  lexicon: Pick<Lexicon, "id" | "edition" | "status"> = LEGACY_REFERENCE,
  verifiedWords?: readonly VerifiedWord[],
): Promise<MoveSearchResult> {
  if (signal?.aborted) return Promise.resolve(cancelled());
  if (typeof Worker === "undefined")
    return Promise.resolve(
      unavailable("Background move search is unavailable in this browser."),
    );
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./solver.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      resolve(
        unavailable("The move-search worker could not start. Please retry."),
      );
      return;
    }
    const id = ++requestSequence;
    let settled = false;
    const finish = (result: MoveSearchResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.removeEventListener("message", message);
      worker.removeEventListener("error", failure);
      worker.removeEventListener("messageerror", decodeFailure);
      worker.terminate();
      resolve(result);
    };
    const abort = () => finish(cancelled());
    const failure = (event: ErrorEvent) => {
      event.preventDefault();
      finish(
        unavailable(
          "The move search stopped unexpectedly. The game has not advanced.",
        ),
      );
    };
    const decodeFailure = () =>
      finish(
        unavailable(
          "The move-search response could not be read. Please retry.",
        ),
      );
    const message = (event: MessageEvent<unknown>) => {
      const response = event.data;
      if (
        !record(response) ||
        response.id !== id ||
        !validResult(response.result)
      ) {
        finish(
          unavailable(
            "The move search returned an invalid response. The game has not advanced.",
          ),
        );
        return;
      }
      finish(response.result);
    };
    const timer = setTimeout(
      () =>
        finish(
          unavailable(
            "The move search timed out. Pause and retry; no pass has been recorded.",
          ),
        ),
      SEARCH_TIMEOUT_MS,
    );
    worker.addEventListener("message", message);
    worker.addEventListener("error", failure);
    worker.addEventListener("messageerror", decodeFailure);
    signal?.addEventListener("abort", abort, { once: true });
    // Covers an abort occurring while constructing the worker or installing listeners.
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      worker.postMessage({
        id,
        board,
        rack,
        lexicon,
        ...(verifiedWords === undefined ? {} : { verifiedWords }),
        ...(tileSupply ? { tileSupply } : {}),
      });
    } catch {
      finish(
        unavailable(
          "The position could not be sent to the move-search worker. Please retry.",
        ),
      );
    }
  });
}
