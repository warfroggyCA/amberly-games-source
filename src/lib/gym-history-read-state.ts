import type {
  GymHistory,
  GymIdentity,
  GymSessionDetail,
} from "./gym-history-contract";
import { isGymWrite } from "./gym-history-contract";
import { isBoard, isLetter } from "../domain/board";

export const sameGymOwner = (a: GymIdentity | null, b: GymIdentity | null) =>
  !!a &&
  !!b &&
  a.familyId === b.familyId &&
  a.userId === b.userId &&
  a.playerId === b.playerId;
export type HistoryTarget =
  { kind: "list"; cursor?: string } | { kind: "detail"; id: string };
export type HistoryContent =
  | { kind: "list"; owner: GymIdentity; page: GymHistory }
  | { kind: "detail"; owner: GymIdentity; detail: GymSessionDetail };
export type GymReadState =
  | { kind: "closed" }
  | { kind: "loading"; target: HistoryTarget; retained: HistoryContent | null }
  | HistoryContent
  | {
      kind: "failed";
      target: HistoryTarget;
      retained: HistoryContent | null;
      message: string;
    }
  | { kind: "denied"; message: string };
export function retainedHistory(state: GymReadState): HistoryContent | null {
  return state.kind === "list" || state.kind === "detail"
    ? state
    : state.kind === "loading" || state.kind === "failed"
      ? state.retained
      : null;
}
export const historyAccessDenied = (error: unknown) => {
  const e = error as { status?: number; code?: string } | null;
  return (
    e?.status === 401 ||
    e?.status === 403 ||
    e?.code === "NO_PROFILE" ||
    e?.code === "PROFILE_CHANGED"
  );
};
export const historyServiceFailure = () =>
  new Error("Practice history returned an invalid response. Please retry.");
export function validHistory(value: unknown): value is GymHistory {
  const v = value as GymHistory | null;
  return (
    !!v &&
    !!v.identity &&
    [v.identity.familyId, v.identity.userId, v.identity.playerId].every(
      (x) => typeof x === "string" && !!x,
    ) &&
    Array.isArray(v.sessions) &&
    v.sessions.every(
      (s) =>
        !!s &&
        typeof s.id === "string" &&
        typeof s.createdAt === "string" &&
        Number.isFinite(Date.parse(s.createdAt)) &&
        typeof s.replay === "boolean" &&
        Number.isInteger(s.attempts) &&
        s.attempts >= 0 &&
        (s.firstPoints === null || typeof s.firstPoints === "number") &&
        typeof s.assisted === "boolean",
    ) &&
    (v.nextCursor === null || typeof v.nextCursor === "string") &&
    (v.progress === undefined || validProgress(v.progress))
  );
}
export function validHistoryDetail(
  value: unknown,
  id: string,
): value is GymSessionDetail {
  const v = value as GymSessionDetail | null;
  return (
    !!v &&
    v.id === id &&
    typeof v.replay === "boolean" &&
    !!v.puzzle?.position &&
    isBoard(v.puzzle.position.board) &&
    Array.isArray(v.puzzle.position.rack) &&
    v.puzzle.position.rack.length === 7 &&
    v.puzzle.position.rack.every((t) => t === "?" || isLetter(t)) &&
    Array.isArray(v.events) &&
    v.events.every((e) =>
      isGymWrite({
        sessionId: id,
        playerId: "history",
        puzzle: v.puzzle,
        event: e,
      }),
    )
  );
}
function validProgress(value: unknown): boolean {
  const v = value as GymHistory["progress"];
  if (
    !v ||
    v.version !== "verified-first-moves-v1" ||
    !v.score ||
    v.score.evaluator !== "complete-score-v1"
  )
    return false;
  return (
    [
      v.sessions,
      v.attempts,
      v.retries,
      v.firstAttempts,
      v.validFirstAttempts,
      v.assistedFirstAttempts,
      v.eligibleFirstAttempts,
      v.eligibleValidFirstAttempts,
      v.repeatedSessions,
      v.resumedSessions,
      v.score.ratedFirstMoves,
      v.score.maximumFirstMoves,
    ].every((n) => Number.isInteger(n) && n >= 0) &&
    (v.score.averagePercentage === null ||
      (typeof v.score.averagePercentage === "number" &&
        Number.isFinite(v.score.averagePercentage)))
  );
}

export function validGymAuth(
  value: unknown,
): value is { user: { id: string } | null } {
  if (!value || typeof value !== "object" || !("user" in value)) return false;
  const user = (value as { user: unknown }).user;
  return (
    user === null ||
    (!!user &&
      typeof user === "object" &&
      "id" in user &&
      typeof user.id === "string" &&
      !!user.id)
  );
}
