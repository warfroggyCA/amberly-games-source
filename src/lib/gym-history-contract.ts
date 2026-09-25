import { MAX_VERIFIED_WORDS } from "../domain/verified-words";
import type { Puzzle, Action } from "../domain/gym/model";
export type GymEventPayload =
  | { type: "hint"; level: number }
  | {
      type:
        | "solve"
        | "live-coaching"
        | "strategy-request"
        | "word-lookup"
        | "resume";
    }
  | { type: "attempt"; action: Action }
  | {
      type: "score";
      attemptId: string;
      points: number;
      rank: number | null;
      percentage: number | null;
    }
  | {
      type: "strategy";
      attemptId: string;
      policy: "sampled-reply-rack-v1";
      verdict: "same" | "favoured" | "uncertain";
      requested: string;
      recommended: string;
      replyPoints: number;
      alternativeReplyPoints: number;
      gap: number;
      samples: number;
    };
export interface GymEvent {
  id: string;
  sequence: number;
  occurredAt: string;
  payload: GymEventPayload;
  referenceWords?: string[];
}
export interface GymWrite {
  sessionId: string;
  playerId: string;
  puzzle: Puzzle;
  event: GymEvent;
}
export interface GymIdentity {
  familyId: string;
  userId: string;
  playerId: string;
}
export interface GymStoredEvent extends GymEvent {
  receivedAt: string;
  verifiedPoints?: number | null;
  valid?: boolean;
  reason?: string;
  assisted: boolean;
  firstAttempt: boolean;
}
export interface GymSessionSummary {
  id: string;
  createdAt: string;
  replay: boolean;
  attempts: number;
  firstPoints: number | null;
  assisted: boolean;
}
export interface GymHistory {
  identity: GymIdentity;
  sessions: GymSessionSummary[];
  nextCursor: string | null;
}
export interface GymSessionDetail {
  id: string;
  puzzle: Puzzle;
  events: GymStoredEvent[];
  replay: boolean;
}
export const gymId = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const integer = (v: unknown, min: number, max: number) =>
  number(v, min, max) && Number.isInteger(v);
export function isGymWrite(v: unknown): v is GymWrite {
  if (
    !object(v) ||
    !gymId(v.sessionId) ||
    typeof v.playerId !== "string" ||
    v.playerId.length > 120 ||
    !v.playerId ||
    !object(v.puzzle) ||
    !object(v.event)
  )
    return false;
  const e = v.event;
  if (
    !gymId(e.id) ||
    !integer(e.sequence, 1, 1000) ||
    typeof e.occurredAt !== "string" ||
    e.occurredAt.length > 32 ||
    !Number.isFinite(Date.parse(e.occurredAt)) ||
    !object(e.payload) ||
    (e.referenceWords !== undefined &&
      (!Array.isArray(e.referenceWords) ||
        e.referenceWords.length > MAX_VERIFIED_WORDS ||
        Object.keys(e.referenceWords).length !== e.referenceWords.length ||
        !e.referenceWords.every(
          (word) => typeof word === "string" && /^[A-Z]{2,15}$/.test(word),
        ) ||
        new Set(e.referenceWords).size !== e.referenceWords.length))
  )
    return false;
  const p = e.payload;
  switch (p.type) {
    case "hint":
      return integer(p.level, 1, 3);
    case "solve":
    case "live-coaching":
    case "strategy-request":
    case "resume":
    case "word-lookup":
      return true;
    case "attempt": {
      const a = p.action;
      return (
        object(a) &&
        a.type === "play" &&
        Array.isArray(a.placements) &&
        a.placements.length > 0 &&
        a.placements.length <= 7 &&
        a.placements.every(
          (t) =>
            object(t) &&
            integer(t.row, 0, 14) &&
            integer(t.col, 0, 14) &&
            object(t.tile) &&
            typeof t.tile.letter === "string" &&
            /^[A-Z]$/.test(t.tile.letter) &&
            (t.tile.blank === undefined || typeof t.tile.blank === "boolean"),
        )
      );
    }
    case "score":
      return (
        gymId(p.attemptId) &&
        integer(p.points, 0, 3000) &&
        (p.rank === null || integer(p.rank, 1, 10000000)) &&
        (p.percentage === null || number(p.percentage, 0, 100))
      );
    case "strategy":
      return (
        gymId(p.attemptId) &&
        p.policy === "sampled-reply-rack-v1" &&
        ["same", "favoured", "uncertain"].includes(String(p.verdict)) &&
        [p.requested, p.recommended].every(
          (x) => typeof x === "string" && x.length <= 200,
        ) &&
        number(p.replyPoints, 0, 3000) &&
        number(p.alternativeReplyPoints, 0, 3000) &&
        number(p.gap, -10000, 10000) &&
        integer(p.samples, 1, 4096)
      );
    default:
      return false;
  }
}
