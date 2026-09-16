import { isCoordinate, isTile } from "../domain/board";
import type { Placement } from "../domain/types";

export const LIVE_DRAFT_TTL_MS = 12_000;
export const LIVE_DRAFT_POLL_MS = 1_000;
export type LiveDraft = {
  gameId: string;
  revision: number;
  generation: number;
  playerId: string;
  placements: Placement[];
  score: number | null;
  valid: boolean;
  expiresAt: string;
};
export type LiveDraftInput = {
  gameId: string;
  revision: number;
  generation: number;
  streamId: string;
  sequence: number;
  kind: "edit" | "heartbeat" | "clear";
  placements: Placement[];
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
export const liveGameId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(value) &&
  !["__proto__", "prototype", "constructor"].includes(value);
export function validLivePlacements(value: unknown): value is Placement[] {
  return (
    Array.isArray(value) &&
    value.length <= 7 &&
    Object.keys(value).length === value.length &&
    value.every(
      (p) =>
        record(p) &&
        Object.keys(p).length === 3 &&
        isCoordinate(p.row) &&
        isCoordinate(p.col) &&
        isTile(p.tile),
    ) &&
    new Set(value.map((p) => `${p.row}:${p.col}`)).size === value.length
  );
}
export function isLiveDraftInput(value: unknown): value is LiveDraftInput {
  return (
    record(value) &&
    Object.keys(value).length === 7 &&
    liveGameId(value.gameId) &&
    integer(value.revision) &&
    value.revision <= 5000 &&
    integer(value.generation) &&
    value.generation > 0 &&
    typeof value.streamId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.streamId,
    ) &&
    ["edit", "heartbeat", "clear"].includes(value.kind as string) &&
    integer(value.sequence) &&
    value.sequence > 0 &&
    validLivePlacements(value.placements) &&
    (value.kind === "clear") === (value.placements.length === 0)
  );
}
/** Discard speculative tiles on expiry, turn changes, or malformed responses. */
export function currentLiveDraft(
  value: unknown,
  game: {
    id: string;
    revision?: number;
    scorerGeneration?: number;
    currentPlayerId: string;
    status: string;
    pendingEnd: unknown;
    board: readonly (readonly (unknown | null)[])[];
  },
  now = Date.now(),
): LiveDraft | null {
  if (
    !record(value) ||
    game.status !== "active" ||
    game.pendingEnd ||
    value.gameId !== game.id ||
    value.revision !== game.revision ||
    value.playerId !== game.currentPlayerId ||
    (game.scorerGeneration !== undefined &&
      value.generation !== game.scorerGeneration) ||
    !integer(value.generation) ||
    value.generation < 1 ||
    !validLivePlacements(value.placements) ||
    value.placements.length === 0 ||
    typeof value.valid !== "boolean" ||
    !(
      value.score === null ||
      (integer(value.score) && value.score <= 100_000)
    ) ||
    typeof value.expiresAt !== "string"
  )
    return null;
  const expires = Date.parse(value.expiresAt);
  if (
    !Number.isFinite(expires) ||
    expires <= now ||
    expires > now + LIVE_DRAFT_TTL_MS + 5_000 ||
    value.placements.some((p) => game.board[p.row]?.[p.col] !== null)
  )
    return null;
  return value as LiveDraft;
}
