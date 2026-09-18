import type { Equipment } from "../domain/equipment";
import type { LiveDraft } from "./live-draft";
import type { GameCommand, GameState } from "../domain/game";
import type { SavedPlayer } from "./preview-store";
import type { PlayerProfileFields } from "./player-profile";
import type { VerifiedWord } from "../domain/verified-words";

import type { MemberPermissions } from "./member-permissions";

export type FamilyRole = "member" | "superadmin";
export type VerifiedActor = {
  userId: string;
  email: string;
  emailVerified: true;
  deviceHash?: string;
};
export type FamilyMember = {
  userId: string;
  email: string;
  role: FamilyRole;
  active: boolean;
  playerId: string | null;
  profileSetupPending?: boolean;
  permissions?: MemberPermissions;
  revision?: number;
};
export type PlayerAccess = { revision: number; userId: string | null };
export type GameProtest = {
  id: string;
  reason: string;
  reportedFor: string | null;
  reportedBy: string;
  reportedAt: string;
  gameRevision: number;
  resolution: {
    outcome: "dismissed" | "upheld";
    reason: string;
    resolvedBy: string;
    resolvedAt: string;
  } | null;
};
export type GameAccess = {
  scorerUserId: string;
  /** Original/transfer device metadata; never used to authorize scoring. */
  deviceId: string;
  generation: number;
  mode: "confirmed" | "practice";
  recordsEligible: boolean;
  protests: GameProtest[];
  canScore: boolean;
  approvals: {
    playerId: string;
    userId: string | null;
    startApproved: boolean;
    resultApproved: boolean;
  }[];
};
export type FamilyInvitation = {
  email: string;
  active: boolean;
  playerId?: string | null;
};
export type SharedState = {
  equipment?: Equipment;
  removedGameIds?: string[];
  family: { id: string; name: string };
  member: FamilyMember;
  members: FamilyMember[];
  invitations: FamilyInvitation[];
  players: SavedPlayer[];
  playerAccess: Record<string, PlayerAccess>;
  games: GameState[];
  gameAccess: Record<string, GameAccess>;
  verifiedWords: VerifiedWord[];
  nextCursor: string | null;
};
export type SharedOperation =
  | {
      type: "delete-practice-game";
      gameId: string;
      expectedRevision: number;
      reason: string;
    }
  | { type: "save-equipment"; equipment: Equipment; expectedRevision: number }
  | { type: "create-player"; id: string; profile: PlayerProfileFields }
  | {
      type: "update-player";
      id: string;
      expectedRevision: number;
      profile: PlayerProfileFields;
    }
  | {
      type: "create-game";
      tileSet?: { id: string; revision: number };
      id: string;
      players: { id: string; seat: 0 | 1 | 2 | 3 }[];
      firstPlayerId: string;
      direction: "clockwise" | "counterclockwise";
      deviceId: string;
      mode: "confirmed" | "practice";
    }
  | {
      type: "game-commands";
      gameId: string;
      commands: GameCommand[];
      deviceId: string;
      generation: number;
    }
  | {
      type: "verify-words";
      gameId: string;
      words: string[];
      expectedRevision: number;
      deviceId: string;
      generation: number;
    }
  | {
      type: "take-over-scoring";
      gameId: string;
      deviceId: string;
      expectedGeneration: number;
      reason: string;
    }
  | { type: "create-watch-link"; gameId: string; token: string }
  | { type: "revoke-watch-link"; gameId: string }
  | {
      type: "approve-game";
      gameId: string;
      stage: "start" | "result";
      expectedRevision: number;
    }
  | {
      type: "report-protest";
      gameId: string;
      reason: string;
      reportedFor: string | null;
    }
  | {
      type: "resolve-protest";
      gameId: string;
      protestId: string;
      outcome: "dismissed" | "upheld";
      reason: string;
    }
  | {
      type: "complete-profile";
      id: string;
      expectedRevision: number;
      expectedPlayerRevision: number | null;
      profile: PlayerProfileFields;
    }
  | { type: "invite-member"; email: string; playerId?: string | null }
  | { type: "revoke-invitation"; email: string }
  | {
      type: "update-member";
      permissions?: MemberPermissions;
      expectedRevision?: number;
      userId: string;
      role: FamilyRole;
      active: boolean;
      playerId: string | null;
      reason: string;
    };
export type SharedMutation = { requestId: string; operation: SharedOperation };
export type SharedMutationResult = {
  removedGameId?: string;
  equipment?: Equipment;
  replayed?: boolean;
  game?: GameState;
  gameAccess?: GameAccess;
  player?: SavedPlayer;
  playerAccess?: PlayerAccess;
  verifiedWords?: VerifiedWord[];
};
export type SharedApiError = { error: string; code?: string };

/** The guest view deliberately omits journal actors, memberships and private account data. */
export type SpectatorState = Pick<
  GameState,
  | "id"
  | "players"
  | "board"
  | "scores"
  | "turns"
  | "order"
  | "status"
  | "pendingEnd"
  | "currentPlayerId"
  | "expectedBagCount"
> & {
  revision?: number;
  scorerGeneration?: number;
  liveDraft?: LiveDraft | null;
  tileSupply?: GameState["tileSupply"] | null;
  assisted?: boolean;
  result: Pick<
    NonNullable<GameState["result"]>,
    | "scores"
    | "winnerIds"
    | "reason"
    | "assisted"
    | "unequalTurns"
    | "scoresBeforeAdjustments"
    | "adjustments"
  > | null;
};
