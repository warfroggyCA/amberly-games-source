import {
  EMPTY_EQUIPMENT,
  isEquipment,
  snapshotTileSet,
  validateEquipmentChange,
  type Equipment,
  type TileSetSnapshot,
} from "../domain/equipment";
import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import sharp from "sharp";
import {
  applyCommand,
  createGame,
  hydrateGame,
  getTileSupply,
  type CommandContext,
  type GameCommand,
  type GameState,
} from "../domain/game";
import { verifyMoveExists, type EnumerableLexicon } from "../domain/solver";
import {
  isVerifiedWord,
  extendLexicon,
  MAX_VERIFIED_WORDS,
  type VerifiedWord,
} from "../domain/verified-words";
import { defaultLexicon, resolveLexicon } from "../lib/lexicons";
import { isValidPlayerProfile } from "../lib/player-profile";
import { fetchOfficialWord } from "../lib/official-word-server";
import {
  normalizeOfficialWord,
  type OfficialWordResult,
} from "../lib/official-word";
import type {
  FamilyMember,
  GameAccess,
  GameProtest,
  SharedMutation,
  SharedMutationResult,
  SharedState,
  SpectatorState,
  VerifiedActor,
} from "../lib/shared-contract";

import { calculateDraftScore, scoreMove } from "../domain/scoring";
import {
  isLiveDraftInput,
  liveGameId,
  LIVE_DRAFT_TTL_MS,
  type LiveDraft,
  type LiveDraftInput,
} from "../lib/live-draft";

type Tx = postgres.TransactionSql;
type Options = {
  resolveLexicon?: (reference: unknown) => EnumerableLexicon;
  defaultLexicon?: EnumerableLexicon;
  verifyWord?: (word: string) => Promise<OfficialWordResult>;
};
export class SharedRepositoryError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "SharedRepositoryError";
  }
}
function reject(code: string, message: string, status = 400): never {
  throw new SharedRepositoryError(code, message, status);
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const safeId = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(v) &&
  !["__proto__", "prototype", "constructor"].includes(v);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).length === allowed.length &&
  Object.keys(v).every((k) => allowed.includes(k));
const revision = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
function email(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  )
    reject("INVALID_EMAIL", "Enter a valid email address.");
  return value.toLowerCase();
}
/** JSON-only canonicalization prevents object ordering from changing retry identity. */
function canonical(value: unknown, depth = 0): string {
  if (depth > 30)
    reject("INVALID_REQUEST", "The request is too deeply nested.");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length)
      reject("INVALID_REQUEST", "Arrays must contain plain JSON data.");
    return `[${value.map((v) => canonical(v, depth + 1)).join(",")}]`;
  }
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k], depth + 1)}`)
      .join(",")}}`;
  reject("INVALID_REQUEST", "The request must contain plain JSON data.");
}
const fingerprint = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
const json = (tx: Tx, v: unknown) => tx.json(JSON.parse(JSON.stringify(v)));
function validateActor(actor: VerifiedActor, familyId: string) {
  if (
    !actor ||
    !uuid(actor.userId) ||
    actor.emailVerified !== true ||
    !uuid(familyId)
  )
    reject("UNAUTHENTICATED", "Sign in with a verified email address.", 401);
  email(actor.email);
}
function validateMutation(input: SharedMutation) {
  if (
    !record(input) ||
    !keys(input, ["requestId", "operation"]) ||
    !safeId(input.requestId) ||
    !record(input.operation)
  )
    reject("INVALID_REQUEST", "The action is malformed.");
  if (canonical(input).length > 400000)
    reject("PAYLOAD_TOO_LARGE", "The action is too large.", 413);
  const op = input.operation as unknown as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    "save-equipment": ["equipment", "expectedRevision"],
    "create-player": ["id", "profile"],
    "update-player": ["id", "expectedRevision", "profile"],
    "create-game": [
      "id",
      "players",
      "firstPlayerId",
      "direction",
      "deviceId",
      "mode",
      ...(Object.hasOwn(op, "tileSet") ? ["tileSet"] : []),
    ],
    "game-commands": ["gameId", "commands", "deviceId", "generation"],
    "verify-words": [
      "gameId",
      "words",
      "expectedRevision",
      "deviceId",
      "generation",
    ],
    "approve-game": ["gameId", "stage", "expectedRevision"],
    "report-protest": ["gameId", "reason", "reportedFor"],
    "resolve-protest": ["gameId", "protestId", "outcome", "reason"],
    "create-watch-link": ["gameId", "token"],
    "revoke-watch-link": ["gameId"],
    "take-over-scoring": ["gameId", "deviceId", "expectedGeneration", "reason"],
    "invite-member": ["email"],
    "revoke-invitation": ["email"],
    "update-member": ["userId", "role", "active", "playerId", "reason"],
  };
  if (
    typeof op.type !== "string" ||
    !Object.hasOwn(fields, op.type) ||
    !keys(op, ["type", ...fields[op.type]])
  )
    reject(
      "INVALID_REQUEST",
      "The action contains missing or unexpected fields.",
    );
  if (
    ("id" in op && !safeId(op.id)) ||
    ("gameId" in op && !safeId(op.gameId)) ||
    ("deviceId" in op && !safeId(op.deviceId))
  )
    reject("INVALID_REQUEST", "An identifier is invalid.");
  if (
    ("expectedRevision" in op && !revision(op.expectedRevision)) ||
    ("generation" in op && (!revision(op.generation) || op.generation === 0))
  )
    reject("INVALID_REQUEST", "The revision is invalid.");
  if (op.type === "save-equipment" && !isEquipment(op.equipment))
    reject(
      "INVALID_EQUIPMENT",
      "Enter valid named sets with whole-number tile quantities and a valid default.",
    );
  if (op.type === "create-player" || op.type === "update-player") {
    if (!isValidPlayerProfile(op.profile))
      reject(
        "INVALID_PROFILE",
        "Enter a name of 1–60 characters, a bio up to 240 characters, and a supported small JPEG photo.",
      );
  } else if (op.type === "create-game") {
    if (
      op.tileSet !== undefined &&
      (!record(op.tileSet) ||
        !keys(op.tileSet, ["id", "revision"]) ||
        !safeId(op.tileSet.id) ||
        !revision(op.tileSet.revision))
    )
      reject(
        "INVALID_EQUIPMENT",
        "Select an existing tile set and its current revision.",
      );
    if (
      !Array.isArray(op.players) ||
      op.players.length < 1 ||
      op.players.length > 4 ||
      !op.players.every(
        (p) =>
          record(p) &&
          keys(p, ["id", "seat"]) &&
          safeId(p.id) &&
          Number.isInteger(p.seat) &&
          Number(p.seat) >= 0 &&
          Number(p.seat) <= 3,
      ) ||
      !["confirmed", "practice"].includes(op.mode as string) ||
      !safeId(op.firstPlayerId) ||
      !["clockwise", "counterclockwise"].includes(op.direction as string)
    )
      reject(
        "INVALID_GAME",
        "Choose one to four players and a valid seating order.",
      );
  } else if (op.type === "game-commands") {
    if (
      !Array.isArray(op.commands) ||
      op.commands.length < 1 ||
      op.commands.length > 32
    )
      reject("INVALID_COMMAND", "Submit between one and 32 actions.");
    if (op.commands.some((c) => !record(c) || !safeId(c.id)))
      reject("INVALID_COMMAND", "Every action needs a valid identifier.");
  } else if (op.type === "verify-words") {
    if (
      !Array.isArray(op.words) ||
      op.words.length < 1 ||
      op.words.length > 16 ||
      new Set(op.words).size !== op.words.length ||
      !op.words.every((w) => typeof w === "string" && /^[A-Z]{2,15}$/.test(w))
    )
      reject("INVALID_WORDS", "Choose up to 16 different English words.");
  } else if (op.type === "report-protest" || op.type === "resolve-protest") {
    const reason = op.reason;
    if (
      typeof reason !== "string" ||
      reason !== reason.trim() ||
      !reason ||
      reason.length > 2000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)
    )
      reject(
        "INVALID_PROTEST",
        "Explain the concern or decision in up to 2,000 characters.",
      );
    if (
      op.type === "report-protest" &&
      op.reportedFor !== null &&
      (typeof op.reportedFor !== "string" ||
        !op.reportedFor ||
        op.reportedFor !== op.reportedFor.trim() ||
        op.reportedFor.length > 60 ||
        /[\u0000-\u001f\u007f]/.test(op.reportedFor))
    )
      reject(
        "INVALID_PROTEST",
        "Enter a guest name of up to 60 characters, or report your own concern.",
      );
    if (
      op.type === "resolve-protest" &&
      (!uuid(op.protestId) ||
        !["dismissed", "upheld"].includes(op.outcome as string))
    )
      reject(
        "INVALID_PROTEST",
        "Choose an existing protest and a valid review outcome.",
      );
  } else if (op.type === "create-watch-link") {
    if (typeof op.token !== "string" || !/^[a-f0-9]{64}$/.test(op.token))
      reject("INVALID_WATCH_TOKEN", "Generate a fresh private viewing link.");
  } else if (op.type === "take-over-scoring") {
    if (
      !revision(op.expectedGeneration) ||
      op.expectedGeneration === 0 ||
      typeof op.reason !== "string" ||
      !op.reason.trim() ||
      op.reason.length > 500 ||
      /[\u0000-\u001f\u007f]/.test(op.reason)
    )
      reject(
        "INVALID_TAKEOVER",
        "Choose the current scorer generation and explain the transfer.",
      );
  } else if (op.type === "approve-game") {
    if (!["start", "result"].includes(op.stage as string))
      reject(
        "INVALID_APPROVAL",
        "Choose whether to approve participation or the final result.",
      );
  } else if (op.type === "invite-member" || op.type === "revoke-invitation")
    email(op.email);
  else if (op.type === "update-member") {
    if (
      !uuid(op.userId) ||
      !["member", "superadmin"].includes(op.role as string) ||
      typeof op.active !== "boolean" ||
      (op.playerId !== null && !safeId(op.playerId)) ||
      typeof op.reason !== "string" ||
      !op.reason.trim() ||
      op.reason.length > 500 ||
      /[\u0000-\u001f\u007f]/.test(op.reason)
    )
      reject(
        "INVALID_MEMBER",
        "Choose a valid member, role, player link and reason.",
      );
  }
}
function member(row: postgres.Row): FamilyMember {
  return {
    userId: row.user_id,
    email: row.email,
    role: row.role,
    active: row.active,
    playerId: row.player_id,
  };
}
function access(
  row: postgres.Row,
  participants: postgres.Row[],
  actor: VerifiedActor,
  protests: GameProtest[],
): GameAccess {
  return {
    scorerUserId: row.scorer_user_id,
    deviceId: row.scorer_device_id,
    generation: row.scorer_generation,
    mode: row.mode,
    // Scoring belongs to the verified person; device fields are retained for history.
    canScore: row.scorer_user_id === actor.userId,
    recordsEligible:
      row.mode === "confirmed" &&
      row.state?.result?.competitiveEligible === true &&
      !protests.some((p) => !p.resolution || p.resolution.outcome === "upheld"),
    protests,
    approvals: participants.map((p) => ({
      playerId: p.player_id,
      userId: p.user_id,
      startApproved: !!p.start_approved,
      resultApproved: !!p.result_approved,
    })),
  };
}
function player(row: postgres.Row) {
  return {
    id: row.id,
    name: row.name,
    ...(row.bio ? { bio: row.bio } : {}),
    ...(row.photo_data_url ? { photoDataUrl: row.photo_data_url } : {}),
  };
}

export function createSharedRepository(
  sql: postgres.Sql,
  options: Options = {},
) {
  const resolve = options.resolveLexicon ?? resolveLexicon;
  const lexiconDefault = options.defaultLexicon ?? defaultLexicon;
  const verifyWord = options.verifyWord ?? fetchOfficialWord;
  const context: CommandContext = {
    hasLegalMove: (board, rack, lexicon, tileSupply, verifiedWords) => {
      const base = resolve(lexicon);
      const extra = verifiedWords?.map((v) => v.word) ?? [];
      const effective: EnumerableLexicon = extra.length
        ? { ...base, words: [...base.words, ...extra], has: lexicon.has }
        : base;
      const answer = verifyMoveExists(board, rack, effective, {
        tileSupply,
        maxNodes: 2_000_000,
      });
      if (answer.status === "found") return true;
      if (answer.status === "none") return false;
      throw new Error("Move search did not finish.");
    },
  };
  async function transaction<T>(
    actor: VerifiedActor,
    familyId: string,
    work: (tx: Tx) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    validateActor(actor, familyId);
    return (await sql.begin(
      readOnly ? "isolation level repeatable read read only" : "",
      async (tx) => {
        await tx`set local role scrabble_runtime`;
        await tx`select set_config('scrabble.actor_id', ${actor.userId}, true), set_config('scrabble.family_id', ${familyId}, true), set_config('scrabble.actor_email', ${email(actor.email)}, true), set_config('scrabble.email_verified', 'true', true), set_config('statement_timeout', '15000', true), set_config('lock_timeout', '5000', true)`;
        return work(tx);
      },
    )) as T;
  }
  async function activeMember(
    tx: Tx,
    actor: VerifiedActor,
    familyId: string,
    lock: boolean,
  ) {
    if (lock) {
      const locked =
        await tx`select id from scrabble.families where id = ${familyId}::uuid for update`;
      if (!locked.length)
        reject(
          "NOT_A_MEMBER",
          "This account does not have active family access.",
          403,
        );
    }
    const rows =
      await tx`select * from scrabble.memberships where family_id = ${familyId}::uuid and user_id = ${actor.userId}::uuid and active`;
    if (!rows.length)
      reject(
        "NOT_A_MEMBER",
        "This account does not have active family access.",
        403,
      );
    return member(rows[0]);
  }
  function requireAdmin(who: FamilyMember) {
    if (who.role !== "superadmin")
      reject("FORBIDDEN", "Only a superadmin can manage family access.", 403);
  }
  async function audit(
    tx: Tx,
    actor: VerifiedActor,
    familyId: string,
    action: string,
    subject: string,
    before: unknown,
    after: unknown,
  ) {
    await tx`insert into scrabble.audit(family_id,id,actor_id,action,subject,before_value,after_value) values(${familyId}::uuid,${randomUUID()}::uuid,${actor.userId}::uuid,${action},${subject},${json(tx, before)},${json(tx, after)})`;
  }
  async function checkedGame(
    tx: Tx,
    familyId: string,
    gameId: string,
    lock = false,
  ) {
    const rows =
      await tx`select h.*,d.definition,d.mode from scrabble.game_heads h join scrabble.game_definitions d using(family_id,game_id) where h.family_id = ${familyId}::uuid and h.game_id = ${gameId} ${lock ? tx`for update of h` : tx``}`;
    if (!rows.length)
      reject("GAME_NOT_FOUND", "This game is not in the family history.", 404);
    const row = rows[0];
    const events =
      await tx`select event from scrabble.game_events where family_id = ${familyId}::uuid and game_id = ${gameId} order by sequence`;
    if (
      canonical(row.state.definition) !== canonical(row.definition) ||
      canonical(row.state.events) !== canonical(events.map((e) => e.event)) ||
      row.revision !== row.state.revision
    )
      reject(
        "HISTORY_INTEGRITY",
        "The game projection differs from its permanent history. Preserve the records for recovery.",
        500,
      );
    const restored = hydrateGame(
      row.state,
      resolve(row.state.lexicon),
      context,
    );
    if (!restored.ok) reject("HISTORY_INTEGRITY", restored.error.message, 500);
    return { row, game: restored.game };
  }
  async function participants(tx: Tx, familyId: string, gameIds: string[]) {
    return tx`select p.*,s.revision is not null start_approved,(r.revision=h.revision and h.state->>'status'='finalized') result_approved from scrabble.game_participants p join scrabble.game_heads h using(family_id,game_id) left join scrabble.game_approvals s on s.family_id=p.family_id and s.game_id=p.game_id and s.player_id=p.player_id and s.stage='start' left join scrabble.game_approvals r on r.family_id=p.family_id and r.game_id=p.game_id and r.player_id=p.player_id and r.stage='result' where p.family_id=${familyId}::uuid and p.game_id in ${tx(gameIds)} order by p.player_id`;
  }
  async function gameProtests(
    tx: Tx,
    familyId: string,
    gameIds: string[],
  ): Promise<Map<string, GameProtest[]>> {
    const grouped = new Map<string, GameProtest[]>();
    if (!gameIds.length) return grouped;
    const rows =
      await tx`select p.game_id,p.id,p.reason,p.reported_for,p.reported_by,p.reported_at,p.game_revision,r.outcome,r.reason resolution_reason,r.resolved_by,r.resolved_at from scrabble.game_protests p left join scrabble.game_protest_resolutions r on r.family_id=p.family_id and r.game_id=p.game_id and r.protest_id=p.id where p.family_id=${familyId}::uuid and p.game_id in ${tx(gameIds)} order by p.reported_at,p.id`;
    for (const row of rows) {
      const list = grouped.get(row.game_id) ?? [];
      list.push({
        id: row.id,
        reason: row.reason,
        reportedFor: row.reported_for,
        reportedBy: row.reported_by,
        reportedAt: new Date(row.reported_at).toISOString(),
        gameRevision: row.game_revision,
        resolution: row.outcome
          ? {
              outcome: row.outcome,
              reason: row.resolution_reason,
              resolvedBy: row.resolved_by,
              resolvedAt: new Date(row.resolved_at).toISOString(),
            }
          : null,
      });
      grouped.set(row.game_id, list);
    }
    return grouped;
  }
  async function currentAccess(
    tx: Tx,
    familyId: string,
    row: postgres.Row,
    actor: VerifiedActor,
  ): Promise<GameAccess> {
    const entries = await participants(tx, familyId, [row.game_id]);
    const protests = await gameProtests(tx, familyId, [row.game_id]);
    return access(row, entries, actor, protests.get(row.game_id) ?? []);
  }
  async function reporterName(
    tx: Tx,
    familyId: string,
    who: FamilyMember,
  ): Promise<string> {
    if (who.playerId) {
      const [profile] =
        await tx`select name from scrabble.players where family_id=${familyId}::uuid and id=${who.playerId}`;
      if (profile) return profile.name;
    }
    return "Family member";
  }
  async function storeGame(
    tx: Tx,
    actor: VerifiedActor,
    familyId: string,
    previous: GameState,
    next: GameState,
  ) {
    for (const event of next.events.slice(previous.revision))
      await tx`insert into scrabble.game_events(family_id,game_id,sequence,command_id,event,actor_id) values(${familyId}::uuid,${next.id},${event.sequence},${event.command.id},${json(tx, event)},${actor.userId}::uuid)`;
    if (!previous.result && next.result)
      await tx`insert into scrabble.game_results(family_id,game_id,result) values(${familyId}::uuid,${next.id},${json(tx, next.result)})`;
    await tx`update scrabble.game_heads set state = ${json(tx, next)}, revision = ${next.revision}, updated_at = now() where family_id = ${familyId}::uuid and game_id = ${next.id}`;
  }
  async function knownWords(
    tx: Tx,
    familyId: string,
    words: readonly string[],
  ) {
    if (!words.length) return new Map<string, VerifiedWord>();
    const rows =
      await tx`select word,evidence from scrabble.verified_words where family_id = ${familyId}::uuid and word in ${tx([...words])}`;
    return new Map(
      rows.map((r) => [r.word as string, r.evidence as VerifiedWord]),
    );
  }
  function requireScorer(
    actor: VerifiedActor,
    row: postgres.Row,
    op: { generation: number },
  ) {
    if (
      row.scorer_user_id !== actor.userId ||
      row.scorer_generation !== op.generation
    )
      reject(
        "SCORER_CONFLICT",
        "The designated scorer has changed. Refresh the game and sign in with the scorer's account.",
        409,
      );
  }
  async function readEquipment(tx: Tx, familyId: string): Promise<Equipment> {
    const [row] =
      await tx`select equipment from scrabble.equipment where family_id=${familyId}::uuid`;
    if (!row) return EMPTY_EQUIPMENT;
    if (!isEquipment(row.equipment))
      reject(
        "INVALID_EQUIPMENT",
        "Saved equipment needs recovery. No quantities were changed.",
        500,
      );
    return row.equipment;
  }
  async function perform(
    tx: Tx,
    actor: VerifiedActor,
    familyId: string,
    who: FamilyMember,
    input: SharedMutation,
    confirmations: Map<string, VerifiedWord>,
    deferred: Array<() => Promise<unknown>>,
  ): Promise<SharedMutationResult> {
    const op = input.operation;
    if (op.type === "save-equipment") {
      const before = await readEquipment(tx, familyId);
      if (op.expectedRevision !== before.revision)
        reject(
          "STALE_EQUIPMENT",
          "Tile sets changed elsewhere. Refresh shared history and review the quantities before saving again.",
          409,
        );
      try {
        validateEquipmentChange(before, op.equipment);
      } catch (error) {
        reject(
          "INVALID_EQUIPMENT",
          error instanceof Error ? error.message : "The tile set is invalid.",
        );
      }
      await tx`insert into scrabble.equipment(family_id,equipment,updated_by) values(${familyId}::uuid,${json(tx, op.equipment)},${actor.userId}::uuid) on conflict(family_id) do update set equipment=excluded.equipment,updated_by=excluded.updated_by`;
      await audit(
        tx,
        actor,
        familyId,
        "equipment.updated",
        familyId,
        before,
        op.equipment,
      );
      return { equipment: op.equipment };
    }
    if (op.type === "create-player" || op.type === "update-player") {
      const rows =
        await tx`select * from scrabble.players where family_id = ${familyId}::uuid and id = ${op.id}`;
      if (op.type === "create-player" && rows.length)
        reject("PLAYER_EXISTS", "That player already exists.", 409);
      if (op.type === "update-player") {
        if (!rows.length)
          reject("PLAYER_NOT_FOUND", "That player is not in this family.", 404);
        if (who.role !== "superadmin" && who.playerId !== op.id)
          reject(
            "FORBIDDEN",
            "You can edit only your own linked profile.",
            403,
          );
        if (rows[0].revision !== op.expectedRevision)
          reject(
            "REVISION_CONFLICT",
            "This profile changed. Reload it before saving.",
            409,
          );
        await tx`update scrabble.players set name=${op.profile.name},bio=${op.profile.bio ?? ""},photo_data_url=${op.profile.photoDataUrl ?? null},revision=revision+1 where family_id=${familyId}::uuid and id=${op.id}`;
      } else
        await tx`insert into scrabble.players(family_id,id,name,bio,photo_data_url) values(${familyId}::uuid,${op.id},${op.profile.name},${op.profile.bio ?? ""},${op.profile.photoDataUrl ?? null})`;
      const [updated] =
        await tx`select p.*,m.user_id from scrabble.players p left join scrabble.memberships m on p.family_id=m.family_id and p.id=m.player_id where p.family_id=${familyId}::uuid and p.id=${op.id}`;
      await audit(
        tx,
        actor,
        familyId,
        op.type,
        op.id,
        rows[0] ? player(rows[0]) : null,
        player(updated),
      );
      return {
        player: player(updated),
        playerAccess: {
          revision: updated.revision,
          userId: updated.user_id ?? null,
        },
      };
    }
    if (op.type === "create-game") {
      if (!actor.deviceHash || !/^[a-f0-9]{64}$/.test(actor.deviceHash))
        reject(
          "DEVICE_REQUIRED",
          "Reload this browser to establish a secure scoring device.",
          409,
        );
      const selected =
        await tx`select p.id,p.name,m.user_id from scrabble.players p left join scrabble.memberships m on m.family_id=p.family_id and m.player_id=p.id and m.active where p.family_id=${familyId}::uuid and p.id in ${tx(op.players.map((p) => p.id))}`;
      if (selected.length !== op.players.length)
        reject(
          "INVALID_PLAYERS",
          "Every participant must be a different player in this family.",
        );
      if (
        (
          await tx`select 1 from scrabble.game_definitions where family_id=${familyId}::uuid and game_id=${op.id}`
        ).length
      )
        reject("GAME_EXISTS", "This game already exists.", 409);
      let tileSet: TileSetSnapshot | undefined;
      if (op.tileSet) {
        const equipment = await readEquipment(tx, familyId);
        if (op.tileSet.revision !== equipment.revision)
          reject(
            "STALE_EQUIPMENT",
            "Tile sets changed since setup opened. Refresh shared history and choose the set again.",
            409,
          );
        try {
          tileSet = snapshotTileSet(equipment, op.tileSet.id);
        } catch {
          reject(
            "INVALID_EQUIPMENT",
            "That tile set is not available in this family.",
          );
        }
      }
      const created = createGame({
        ...(tileSet ? { tileSet } : {}),
        id: op.id,
        players: op.players.map((p) => ({
          ...p,
          name: selected.find((s) => s.id === p.id)!.name,
        })),
        firstPlayerId: op.firstPlayerId,
        direction: op.direction,
        lexicon: {
          id: lexiconDefault.id,
          edition: lexiconDefault.edition,
          status: lexiconDefault.status,
        },
        createdAt: new Date().toISOString(),
      });
      if (!created.ok) reject(created.error.code, created.error.message);
      let game = created.game;
      const additions =
        await tx`select evidence from scrabble.verified_words where family_id=${familyId}::uuid order by word`;
      const missing = additions
        .map((r) => r.evidence as VerifiedWord)
        .filter((v) => !lexiconDefault.has(v.word));
      // Existing domain caps keep a shared game bounded; catalog additions are immutable evidence.
      if (missing.length > MAX_VERIFIED_WORDS)
        reject(
          "VERIFIED_WORD_LIMIT",
          "The family word additions need a new reviewed dictionary version before starting this game.",
        );
      for (let i = 0; i < missing.length; i += 16) {
        const applied = applyCommand(
          game,
          {
            type: "verify-words",
            id: `catalog-${i}`,
            expectedRevision: game.revision,
            words: missing.slice(i, i + 16),
          },
          lexiconDefault,
          context,
        );
        if (!applied.ok) reject(applied.error.code, applied.error.message);
        game = applied.game;
      }
      await tx`insert into scrabble.game_definitions(family_id,game_id,mode,definition,created_by) values(${familyId}::uuid,${game.id},${op.mode},${json(tx, game.definition)},${actor.userId}::uuid)`;
      await tx`insert into scrabble.game_heads(family_id,game_id,revision,state,scorer_user_id,scorer_device_id,scorer_device_hash) values(${familyId}::uuid,${game.id},${created.game.revision},${json(tx, created.game)},${actor.userId}::uuid,${op.deviceId},${actor.deviceHash})`;
      for (const p of selected)
        await tx`insert into scrabble.game_participants(family_id,game_id,player_id,user_id) values(${familyId}::uuid,${game.id},${p.id},${p.user_id ?? null}::uuid)`;
      if (game.revision)
        await storeGame(tx, actor, familyId, created.game, game);
      await audit(tx, actor, familyId, "game.created", game.id, null, {
        definition: game.definition,
        deviceId: op.deviceId,
        generation: 1,
      });
      return {
        game,
        gameAccess: {
          scorerUserId: actor.userId,
          deviceId: op.deviceId,
          generation: 1,
          mode: op.mode,
          recordsEligible: false,
          protests: [],
          canScore: true,
          approvals: selected.map((p) => ({
            playerId: p.id,
            userId: p.user_id ?? null,
            startApproved: false,
            resultApproved: false,
          })),
        },
      };
    }
    if (op.type === "create-watch-link" || op.type === "revoke-watch-link") {
      const { row } = await checkedGame(tx, familyId, op.gameId, true);
      if (row.scorer_user_id !== actor.userId && who.role !== "superadmin")
        reject(
          "FORBIDDEN",
          "Only the current scorer or a superadmin can manage the private viewing link.",
          403,
        );
      const [before] =
        await tx`select active,expires_at,revision from scrabble.watch_links where family_id=${familyId}::uuid and game_id=${op.gameId} for update`;
      if (op.type === "create-watch-link") {
        const tokenHash = createHash("sha256").update(op.token).digest("hex");
        await tx`insert into scrabble.watch_links(family_id,game_id,token_hash,created_by,expires_at) values(${familyId}::uuid,${op.gameId},${tokenHash},${actor.userId}::uuid,now()+interval '7 days') on conflict(family_id,game_id) do update set token_hash=excluded.token_hash,created_by=excluded.created_by,expires_at=excluded.expires_at,active=true,revision=scrabble.watch_links.revision+1`;
      } else if (before)
        await tx`update scrabble.watch_links set active=false,revision=revision+1 where family_id=${familyId}::uuid and game_id=${op.gameId}`;
      const [after] =
        await tx`select active,expires_at,revision from scrabble.watch_links where family_id=${familyId}::uuid and game_id=${op.gameId}`;
      await audit(
        tx,
        actor,
        familyId,
        op.type,
        op.gameId,
        before ?? null,
        after ?? null,
      );
      return {};
    }
    if (op.type === "report-protest" || op.type === "resolve-protest") {
      const { row, game } = await checkedGame(tx, familyId, op.gameId, true);
      if (op.type === "report-protest") {
        const [open] =
          await tx`select p.id from scrabble.game_protests p left join scrabble.game_protest_resolutions r on r.family_id=p.family_id and r.game_id=p.game_id and r.protest_id=p.id where p.family_id=${familyId}::uuid and p.game_id=${op.gameId} and p.reporter_id=${actor.userId}::uuid and r.protest_id is null limit 1`;
        if (open)
          reject(
            "PROTEST_ALREADY_OPEN",
            "You already have an open concern for this game. A superadmin can review it before another is recorded.",
            409,
          );
        const [{ count }] =
          await tx`select count(*)::int count from scrabble.game_protests where family_id=${familyId}::uuid and game_id=${op.gameId}`;
        if (count >= 100)
          reject(
            "PROTEST_LIMIT",
            "This game has reached its review-entry limit. Ask a superadmin to inspect the existing history.",
            409,
          );
        const id = randomUUID(),
          name = await reporterName(tx, familyId, who);
        await tx`insert into scrabble.game_protests(family_id,game_id,id,reason,reported_for,reporter_id,reported_by,game_revision) values(${familyId}::uuid,${op.gameId},${id}::uuid,${op.reason},${op.reportedFor},${actor.userId}::uuid,${name},${game.revision})`;
        await audit(
          tx,
          actor,
          familyId,
          "game.protest-reported",
          op.gameId,
          null,
          {
            protestId: id,
            reason: op.reason,
            reportedFor: op.reportedFor,
            reportedBy: name,
            gameRevision: game.revision,
          },
        );
      } else {
        requireAdmin(who);
        const [protest] =
          await tx`select * from scrabble.game_protests where family_id=${familyId}::uuid and game_id=${op.gameId} and id=${op.protestId}::uuid`;
        if (!protest)
          reject(
            "PROTEST_NOT_FOUND",
            "That concern does not belong to this family game.",
            404,
          );
        const [resolved] =
          await tx`select outcome from scrabble.game_protest_resolutions where family_id=${familyId}::uuid and game_id=${op.gameId} and protest_id=${op.protestId}::uuid`;
        if (resolved)
          reject(
            "PROTEST_ALREADY_RESOLVED",
            "This review decision is already recorded and cannot be overwritten.",
            409,
          );
        const name = await reporterName(tx, familyId, who);
        await tx`insert into scrabble.game_protest_resolutions(family_id,game_id,protest_id,outcome,reason,resolver_id,resolved_by) values(${familyId}::uuid,${op.gameId},${op.protestId}::uuid,${op.outcome},${op.reason},${actor.userId}::uuid,${name})`;
        await audit(
          tx,
          actor,
          familyId,
          "game.protest-resolved",
          op.gameId,
          { protestId: op.protestId, status: "open" },
          {
            protestId: op.protestId,
            outcome: op.outcome,
            reason: op.reason,
            resolvedBy: name,
          },
        );
      }
      return {
        game,
        gameAccess: await currentAccess(tx, familyId, row, actor),
      };
    }
    if (op.type === "take-over-scoring") {
      const { row, game } = await checkedGame(tx, familyId, op.gameId, true);
      if (row.scorer_user_id !== actor.userId && who.role !== "superadmin")
        reject(
          "FORBIDDEN",
          "Only the current scorer or a superadmin can transfer scoring.",
          403,
        );
      if (!actor.deviceHash || !/^[a-f0-9]{64}$/.test(actor.deviceHash))
        reject(
          "DEVICE_REQUIRED",
          "Reload this browser to establish a secure scoring device.",
          409,
        );
      if (game.status === "finalized")
        reject(
          "GAME_FINALIZED",
          "The game's final result cannot be reopened by changing scorers.",
          409,
        );
      if (row.scorer_generation !== op.expectedGeneration)
        reject(
          "SCORER_CONFLICT",
          "Scoring was already transferred. Review the current scorer before retrying.",
          409,
        );
      const before = {
        scorerUserId: row.scorer_user_id,
        deviceId: row.scorer_device_id,
        generation: row.scorer_generation,
      };
      await tx`update scrabble.game_heads set scorer_user_id=${actor.userId}::uuid,scorer_device_id=${op.deviceId},scorer_device_hash=${actor.deviceHash},scorer_generation=scorer_generation+1 where family_id=${familyId}::uuid and game_id=${op.gameId}`;
      const updated = {
        ...row,
        scorer_user_id: actor.userId,
        scorer_device_id: op.deviceId,
        scorer_device_hash: actor.deviceHash,
        scorer_generation: row.scorer_generation + 1,
      };
      await audit(
        tx,
        actor,
        familyId,
        "game.scorer-transferred",
        op.gameId,
        before,
        {
          scorerUserId: actor.userId,
          deviceId: op.deviceId,
          generation: updated.scorer_generation,
          reason: op.reason,
        },
      );
      return {
        game,
        gameAccess: await currentAccess(tx, familyId, updated, actor),
      };
    }
    if (op.type === "approve-game") {
      const { row, game } = await checkedGame(tx, familyId, op.gameId, true);
      if (row.mode !== "confirmed")
        reject(
          "PRACTICE_GAME",
          "Practice games cannot be promoted through participant approvals.",
          409,
        );
      if (game.revision !== op.expectedRevision)
        reject(
          "REVISION_CONFLICT",
          "The game changed. Review the current version before approving.",
          409,
        );
      const entries = await participants(tx, familyId, [op.gameId]);
      const own = entries.find((p) => p.user_id === actor.userId);
      if (!own)
        reject(
          "NOT_A_PARTICIPANT",
          "Only the account originally linked to this participant can approve for them.",
          403,
        );
      if (
        op.stage === "start" &&
        (game.turns.length > 0 || game.status === "finalized")
      )
        reject(
          "GAME_ALREADY_STARTED",
          "Participation must be approved before scoring begins.",
          409,
        );
      if (
        op.stage === "result" &&
        (game.status !== "finalized" || !entries.every((p) => p.start_approved))
      )
        reject(
          "RESULT_NOT_READY",
          "Review a finalized game with approved participants before confirming its result.",
          409,
        );
      const [existing] =
        await tx`select revision from scrabble.game_approvals where family_id=${familyId}::uuid and game_id=${op.gameId} and player_id=${own.player_id} and stage=${op.stage}`;
      if (!existing) {
        await tx`insert into scrabble.game_approvals(family_id,game_id,player_id,stage,revision,actor_id) values(${familyId}::uuid,${op.gameId},${own.player_id},${op.stage},${game.revision},${actor.userId}::uuid)`;
        await audit(
          tx,
          actor,
          familyId,
          `game.approved.${op.stage}`,
          op.gameId,
          null,
          { playerId: own.player_id, revision: game.revision },
        );
      }
      return {
        game,
        gameAccess: await currentAccess(tx, familyId, row, actor),
      };
    }
    if (op.type === "game-commands" || op.type === "verify-words") {
      const { row, game: original } = await checkedGame(
        tx,
        familyId,
        op.gameId,
        true,
      );
      requireScorer(actor, row, op);
      let commands: GameCommand[];
      if (op.type === "verify-words") {
        const cached = await knownWords(tx, familyId, op.words);
        const words = op.words.map(
          (word) =>
            cached.get(word) ??
            confirmations.get(word) ??
            reject(
              "WORD_UNVERIFIED",
              `${word} has not been confirmed as playable.`,
            ),
        );
        for (const entry of words)
          if (!cached.has(entry.word))
            await tx`insert into scrabble.verified_words(family_id,word,evidence,verified_by) values(${familyId}::uuid,${entry.word},${json(tx, entry)},${actor.userId}::uuid)`;
        commands = [
          {
            type: "verify-words",
            id: input.requestId,
            expectedRevision: op.expectedRevision,
            words,
          },
        ];
      } else {
        commands = [];
        for (const candidate of op.commands) {
          if (candidate.type === "verify-words") {
            // The browser's timestamps/URLs are never accepted as publisher evidence.
            if (
              !Array.isArray(candidate.words) ||
              !candidate.words.every(isVerifiedWord)
            )
              reject(
                "WORD_UNVERIFIED",
                "Word confirmations must come from the official server check.",
              );
            const cached = await knownWords(
              tx,
              familyId,
              candidate.words.map((v) => v.word),
            );
            if (candidate.words.some((v) => !cached.has(v.word)))
              reject(
                "WORD_UNVERIFIED",
                "Verify missing words through the official server check first.",
              );
            commands.push({
              ...candidate,
              words: candidate.words.map((v) => cached.get(v.word)!),
            });
          } else if (
            candidate.type === "reconcile" ||
            candidate.type === "extend-supply"
          )
            commands.push({
              ...candidate,
              recordedBy: actor.userId,
              recordedAt: new Date().toISOString(),
            });
          else commands.push(candidate);
        }
      }
      let game = original;
      for (const command of commands) {
        const applied = applyCommand(
          game,
          command,
          resolve(game.lexicon),
          context,
        );
        if (!applied.ok)
          reject(
            applied.error.code,
            applied.error.message,
            [
              "REVISION_CONFLICT",
              "COMMAND_ID_REUSED",
              "GAME_FINALIZED",
            ].includes(applied.error.code)
              ? 409
              : 400,
          );
        game = applied.game;
      }
      await storeGame(tx, actor, familyId, original, game);
      await audit(
        tx,
        actor,
        familyId,
        "game.commands",
        game.id,
        { revision: original.revision },
        { revision: game.revision, commands: commands.map((c) => c.id) },
      );
      return {
        game,
        gameAccess: await currentAccess(
          tx,
          familyId,
          { ...row, state: game },
          actor,
        ),
        ...(op.type === "verify-words"
          ? { verifiedWords: game.verifiedWords ?? [] }
          : {}),
      };
    }
    requireAdmin(who);
    if (op.type === "invite-member" || op.type === "revoke-invitation") {
      const address = email(op.email);
      const [before] =
        await tx`select * from scrabble.invitations where family_id=${familyId}::uuid and email=${address} for update`;
      if (op.type === "invite-member") {
        if (
          (
            await tx`select 1 from scrabble.memberships where family_id=${familyId}::uuid and email=${address}`
          ).length
        )
          reject(
            "MEMBER_EXISTS",
            "This email already belongs to a family member. Manage their existing access.",
            409,
          );
        await tx`insert into scrabble.invitations(family_id,email) values(${familyId}::uuid,${address}) on conflict(family_id,email) do update set active=true,revision=scrabble.invitations.revision+1`;
      } else {
        if (!before)
          reject(
            "INVITATION_NOT_FOUND",
            "No invitation exists for this email.",
            404,
          );
        await tx`update scrabble.invitations set active=false,revision=revision+1 where family_id=${familyId}::uuid and email=${address}`;
      }
      const [after] =
        await tx`select * from scrabble.invitations where family_id=${familyId}::uuid and email=${address}`;
      await audit(tx, actor, familyId, op.type, address, before ?? null, after);
      return {};
    }
    if (op.type === "update-member") {
      const [before] =
        await tx`select * from scrabble.memberships where family_id=${familyId}::uuid and user_id=${op.userId}::uuid for update`;
      if (!before)
        reject("MEMBER_NOT_FOUND", "This account is not in the family.", 404);
      if (
        before.active &&
        before.role === "superadmin" &&
        (!op.active || op.role !== "superadmin")
      ) {
        const [{ count }] =
          await tx`select count(*)::int count from scrabble.memberships where family_id=${familyId}::uuid and active and role='superadmin'`;
        if (count <= 1)
          reject(
            "LAST_SUPERADMIN",
            "The family must retain an active superadmin.",
            409,
          );
      }
      if (op.playerId !== null) {
        if (
          !(
            await tx`select 1 from scrabble.players where family_id=${familyId}::uuid and id=${op.playerId}`
          ).length
        )
          reject(
            "PLAYER_NOT_FOUND",
            "Choose an existing player in this family.",
            404,
          );
        if (
          (
            await tx`select 1 from scrabble.memberships where family_id=${familyId}::uuid and player_id=${op.playerId} and user_id<>${op.userId}::uuid`
          ).length
        )
          reject(
            "PLAYER_ALREADY_LINKED",
            "That profile is linked to another account.",
            409,
          );
      }
      // Audit is written while the actor remains authorized, then the access change is atomic.
      const after = {
        ...member(before),
        role: op.role,
        active: op.active,
        playerId: op.playerId,
      };
      await audit(
        tx,
        actor,
        familyId,
        "member.updated",
        op.userId,
        member(before),
        { ...after, reason: op.reason },
      );
      deferred.push(
        () =>
          tx`update scrabble.memberships set role=${op.role},active=${op.active},player_id=${op.playerId},revision=revision+1 where family_id=${familyId}::uuid and user_id=${op.userId}::uuid`,
      );
      return {};
    }
    reject("INVALID_REQUEST", "This action is unsupported.");
  }
  async function readState(
    actor: VerifiedActor,
    familyId: string,
    options: { cursor?: string; gameId?: string } = {},
  ): Promise<SharedState> {
    if (options.gameId && !safeId(options.gameId))
      reject("INVALID_CURSOR", "Choose a valid game.");
    let cursor: { createdAt: string; id: string } | undefined;
    if (options.cursor) {
      try {
        cursor = JSON.parse(
          Buffer.from(options.cursor, "base64url").toString(),
        );
      } catch {
        reject("INVALID_CURSOR", "The history cursor is invalid.");
      }
      if (
        !cursor ||
        !safeId(cursor.id) ||
        typeof cursor.createdAt !== "string" ||
        !Number.isFinite(Date.parse(cursor.createdAt)) ||
        options.cursor.length > 500
      )
        reject("INVALID_CURSOR", "The history cursor is invalid.");
    }
    return transaction(
      actor,
      familyId,
      async (tx) => {
        const who = await activeMember(tx, actor, familyId, false);
        const [family] =
          await tx`select id,name from scrabble.families where id=${familyId}::uuid`;
        const members =
          await tx`select * from scrabble.memberships where family_id=${familyId}::uuid order by joined_at,user_id`;
        const players =
          await tx`select * from scrabble.players where family_id=${familyId}::uuid order by lower(name),id limit 500`;
        const invitations =
          who.role === "superadmin"
            ? await tx`select email,active from scrabble.invitations where family_id=${familyId}::uuid order by email limit 500`
            : [];
        const page =
          await tx`select d.game_id,d.created_at,d.created_at::text created_cursor,d.mode,h.state,h.scorer_user_id,h.scorer_device_id,h.scorer_device_hash,h.scorer_generation from scrabble.game_definitions d join scrabble.game_heads h using(family_id,game_id) where d.family_id=${familyId}::uuid ${cursor ? tx`and (d.created_at,d.game_id)<(${cursor.createdAt}::text::timestamptz,${cursor.id})` : tx``} order by d.created_at desc,d.game_id desc limit 21`;
        const visible = page.slice(0, 20);
        if (
          options.gameId &&
          !visible.some((r) => r.game_id === options.gameId)
        ) {
          const extra =
            await tx`select d.game_id,d.created_at,d.created_at::text created_cursor,d.mode,h.state,h.scorer_user_id,h.scorer_device_id,h.scorer_device_hash,h.scorer_generation from scrabble.game_definitions d join scrabble.game_heads h using(family_id,game_id) where d.family_id=${familyId}::uuid and d.game_id=${options.gameId}`;
          if (!extra.length)
            reject("GAME_NOT_FOUND", "That game is not in this family.", 404);
          visible.push(extra[0]);
        }
        const words =
          await tx`select evidence from scrabble.verified_words where family_id=${familyId}::uuid order by word`;
        const approvalRows = visible.length
          ? await participants(
              tx,
              familyId,
              visible.map((r) => r.game_id),
            )
          : [];
        const protests = await gameProtests(
          tx,
          familyId,
          visible.map((r) => r.game_id),
        );
        const last = page[19];
        return {
          equipment: await readEquipment(tx, familyId),
          family: { id: family.id, name: family.name },
          member: who,
          members: members
            .filter(
              (m) => who.role === "superadmin" || m.user_id === actor.userId,
            )
            .map(member),
          invitations: invitations.map((r) => ({
            email: r.email,
            active: r.active,
          })),
          players: players.map(player),
          playerAccess: Object.fromEntries(
            players.map((p) => [
              p.id,
              {
                revision: p.revision,
                userId:
                  members.find((m) => m.player_id === p.id)?.user_id ?? null,
              },
            ]),
          ),
          games: visible
            .sort(
              (a, b) =>
                new Date(a.created_at).getTime() -
                  new Date(b.created_at).getTime() ||
                a.game_id.localeCompare(b.game_id),
            )
            .map((r) => r.state as GameState),
          gameAccess: Object.fromEntries(
            visible.map((r) => [
              r.game_id,
              access(
                r,
                approvalRows.filter((p) => p.game_id === r.game_id),
                actor,
                protests.get(r.game_id) ?? [],
              ),
            ]),
          ),
          verifiedWords: words.map((r) => r.evidence),
          nextCursor:
            page.length > 20
              ? Buffer.from(
                  JSON.stringify({
                    createdAt: last.created_cursor,
                    id: last.game_id,
                  }),
                ).toString("base64url")
              : null,
        };
      },
      true,
    );
  }
  async function mutate(
    actor: VerifiedActor,
    familyId: string,
    input: SharedMutation,
  ): Promise<SharedMutationResult> {
    validateActor(actor, familyId);
    validateMutation(input);
    const hash = fingerprint(input.operation);
    if (
      (input.operation.type === "create-player" ||
        input.operation.type === "update-player") &&
      input.operation.profile.photoDataUrl
    ) {
      try {
        const image = sharp(
          Buffer.from(input.operation.profile.photoDataUrl.slice(23), "base64"),
          { limitInputPixels: 256 * 256, failOn: "warning" },
        );
        const metadata = await image.metadata();
        if (
          metadata.format !== "jpeg" ||
          !metadata.width ||
          !metadata.height ||
          metadata.width > 256 ||
          metadata.height > 256
        )
          throw new Error("Invalid dimensions");
        await image.raw().toBuffer();
      } catch {
        reject(
          "INVALID_PROFILE_PHOTO",
          "Choose a valid JPEG profile photo no larger than 256 by 256 pixels.",
        );
      }
    }
    // Authenticate before network work, then authenticate again under the family lock.
    const confirmations = new Map<string, VerifiedWord>();
    if (input.operation.type === "verify-words") {
      const wanted = input.operation.words;
      const prior = await transaction(
        actor,
        familyId,
        async (tx) => {
          await activeMember(tx, actor, familyId, false);
          const op = input.operation;
          if (op.type !== "verify-words")
            reject("INVALID_REQUEST", "The word action changed.");
          const [request] =
            await tx`select fingerprint,response from scrabble.requests where family_id=${familyId}::uuid and actor_id=${actor.userId}::uuid and request_id=${input.requestId}`;
          if (request) {
            if (request.fingerprint !== hash)
              reject(
                "REQUEST_ID_REUSED",
                "This request ID was already used for different content.",
                409,
              );
            return {
              response: request.response as SharedMutationResult,
              cached: new Map<string, VerifiedWord>(),
            };
          }
          const [head] =
            await tx`select * from scrabble.game_heads where family_id=${familyId}::uuid and game_id=${op.gameId}`;
          if (!head)
            reject(
              "GAME_NOT_FOUND",
              "This game is not in the family history.",
              404,
            );
          requireScorer(actor, head, op);
          return {
            response: null,
            cached: await knownWords(tx, familyId, wanted),
          };
        },
        true,
      );
      for (const word of prior.response ? [] : wanted)
        if (!prior.cached.has(word)) {
          let result: OfficialWordResult;
          try {
            result = await verifyWord(normalizeOfficialWord(word));
          } catch {
            reject(
              "WORD_LOOKUP_UNAVAILABLE",
              "The official word check could not finish. No changes were recorded.",
              502,
            );
          }
          const { playable, ...evidence } = result;
          if (!playable || evidence.word !== word || !isVerifiedWord(evidence))
            reject(
              "WORD_NOT_PLAYABLE",
              `${word} was not confirmed as playable.`,
            );
          confirmations.set(word, evidence);
        }
    }
    return transaction(actor, familyId, async (tx) => {
      const who = await activeMember(tx, actor, familyId, true);
      const [prior] =
        await tx`select fingerprint,response from scrabble.requests where family_id=${familyId}::uuid and actor_id=${actor.userId}::uuid and request_id=${input.requestId}`;
      if (prior) {
        if (prior.fingerprint !== hash)
          reject(
            "REQUEST_ID_REUSED",
            "This request ID was already used for different content.",
            409,
          );
        const response = prior.response as SharedMutationResult;
        // A committed request may be acknowledged after the scorer changes. Return
        // current state/permissions so retry recovery cannot restore the former scorer.
        if (response.game) {
          const { row, game } = await checkedGame(
            tx,
            familyId,
            response.game.id,
            true,
          );
          return {
            ...response,
            game,
            gameAccess: await currentAccess(tx, familyId, row, actor),
            replayed: true,
          };
        }
        if (response.player) {
          const [current] =
            await tx`select p.*,m.user_id from scrabble.players p left join scrabble.memberships m on p.family_id=m.family_id and p.id=m.player_id where p.family_id=${familyId}::uuid and p.id=${response.player.id}`;
          if (current)
            return {
              ...response,
              player: player(current),
              playerAccess: {
                revision: current.revision,
                userId: current.user_id ?? null,
              },
              replayed: true,
            };
        }
        if (response.equipment)
          return {
            ...response,
            equipment: await readEquipment(tx, familyId),
            replayed: true,
          };
        return { ...response, replayed: true };
      }
      if (
        input.operation.type === "game-commands" ||
        input.operation.type === "verify-words"
      ) {
        const op = input.operation;
        const [head] =
          await tx`select * from scrabble.game_heads where family_id=${familyId}::uuid and game_id=${op.gameId} for update`;
        if (!head)
          reject(
            "GAME_NOT_FOUND",
            "This game is not in the family history.",
            404,
          );
        requireScorer(actor, head, op);
      }
      const deferred: Array<() => Promise<unknown>> = [];
      const result = await perform(
        tx,
        actor,
        familyId,
        who,
        input,
        confirmations,
        deferred,
      );
      // Record retry identity before any deferred self-revocation removes insert access.
      await tx`insert into scrabble.requests(family_id,actor_id,request_id,fingerprint,response) values(${familyId}::uuid,${actor.userId}::uuid,${input.requestId},${hash},${json(tx, result)})`;
      for (const finish of deferred) await finish();
      return result;
    });
  }
  async function admit(
    actor: VerifiedActor,
    familyId: string,
    requestId: string,
  ): Promise<void> {
    if (!safeId(requestId))
      reject("INVALID_REQUEST", "The admission request is invalid.");
    await transaction(actor, familyId, async (tx) => {
      const [result] = await tx`select scrabble.admit_member() admitted`;
      if (!result.admitted)
        reject(
          "NOT_INVITED",
          "This verified email has not been invited, or access has been revoked.",
          403,
        );
    });
  }
  async function exportHistory(
    actor: VerifiedActor,
    familyId: string,
  ): Promise<unknown> {
    return transaction(
      actor,
      familyId,
      async (tx) => {
        requireAdmin(await activeMember(tx, actor, familyId, false));
        const definitions =
          await tx`select * from scrabble.game_definitions where family_id=${familyId}::uuid order by created_at,game_id limit 10001`;
        if (definitions.length > 10000)
          reject(
            "EXPORT_TOO_LARGE",
            "This family archive needs an operator database export.",
            413,
          );
        const players =
          await tx`select * from scrabble.players where family_id=${familyId}::uuid order by id`;
        const events =
          await tx`select * from scrabble.game_events where family_id=${familyId}::uuid order by game_id,sequence limit 100001`;
        if (events.length > 100000)
          reject(
            "EXPORT_TOO_LARGE",
            "This family archive needs an operator database export.",
            413,
          );
        const results =
          await tx`select * from scrabble.game_results where family_id=${familyId}::uuid order by game_id`;
        const auditRows =
          await tx`select * from scrabble.audit where family_id=${familyId}::uuid order by recorded_at,id limit 100001`;
        if (auditRows.length > 100000)
          reject(
            "EXPORT_TOO_LARGE",
            "This family archive needs an operator database export.",
            413,
          );
        const words =
          await tx`select * from scrabble.verified_words where family_id=${familyId}::uuid order by word`;
        const participants =
          await tx`select * from scrabble.game_participants where family_id=${familyId}::uuid order by game_id,player_id`;
        const approvals =
          await tx`select * from scrabble.game_approvals where family_id=${familyId}::uuid order by game_id,player_id,stage`;
        const protests =
          await tx`select * from scrabble.game_protests where family_id=${familyId}::uuid order by game_id,reported_at,id limit 100001`;
        const protestResolutions =
          await tx`select * from scrabble.game_protest_resolutions where family_id=${familyId}::uuid order by game_id,resolved_at,protest_id limit 100001`;
        if (protests.length > 100000 || protestResolutions.length > 100000)
          reject(
            "EXPORT_TOO_LARGE",
            "This family archive needs an operator database export.",
            413,
          );
        return {
          participants,
          approvals,
          protests,
          protestResolutions,
          equipment: await readEquipment(tx, familyId),
          format: "scrabble-family-archive-v1",
          familyId,
          exportedAt: new Date().toISOString(),
          players,
          definitions,
          events,
          results,
          verifiedWords: words,
          audit: auditRows,
        };
      },
      true,
    );
  }
  /** Ephemeral draft transport deliberately bypasses mutation history/idempotency records. */
  async function writeLiveDraft(
    actor: VerifiedActor,
    familyId: string,
    input: LiveDraftInput,
  ) {
    if (!isLiveDraftInput(input))
      reject("INVALID_DRAFT", "The live entry is malformed.");
    return transaction(actor, familyId, async (tx) => {
      await activeMember(tx, actor, familyId, true);
      const [head] =
        await tx`select * from scrabble.game_heads where family_id=${familyId}::uuid and game_id=${input.gameId} for update`;
      if (!head) reject("GAME_NOT_FOUND", "This game is unavailable.", 404);
      if (head.scorer_user_id !== actor.userId)
        reject(
          "NOT_SCORER",
          "Only the designated scorer can share an entry.",
          403,
        );
      const game = head.state as GameState;
      if (
        head.revision !== input.revision ||
        head.scorer_generation !== input.generation ||
        game.status !== "active" ||
        game.pendingEnd
      )
        reject(
          "STALE_DRAFT",
          "The game has moved on. Refresh before sharing this entry.",
          409,
        );
      if (input.placements.some((p) => game.board[p.row][p.col] !== null))
        reject("INVALID_DRAFT", "The entry overlaps recorded tiles.");
      const lexicon = extendLexicon(
        resolve(game.lexicon),
        game.verifiedWords ?? [],
      );
      const preview = scoreMove(
        game.board,
        input.placements,
        lexicon,
        game.expectedRackCounts[game.currentPlayerId],
        getTileSupply(game),
      );
      const expiresAt = new Date(Date.now() + LIVE_DRAFT_TTL_MS).toISOString();
      const draft: LiveDraft = {
        gameId: game.id,
        revision: game.revision,
        generation: input.generation,
        playerId: game.currentPlayerId,
        placements: input.placements,
        score: preview.ok
          ? preview.score
          : calculateDraftScore(game.board, input.placements),
        valid: preview.ok,
        expiresAt,
      };
      const result =
        await tx`insert into scrabble.live_drafts(family_id,game_id,scorer_user_id,revision,generation,stream_id,sequence,payload,expires_at)
        values(${familyId}::uuid,${game.id},${actor.userId}::uuid,${game.revision},${input.generation},${input.streamId}::uuid,${input.sequence},${json(tx, draft)},${expiresAt}::timestamptz)
        on conflict(family_id,game_id) do update set
          scorer_user_id=excluded.scorer_user_id,revision=excluded.revision,generation=excluded.generation,
          stream_id=excluded.stream_id,sequence=excluded.sequence,payload=excluded.payload,expires_at=excluded.expires_at
        where (scrabble.live_drafts.stream_id=excluded.stream_id and scrabble.live_drafts.sequence<excluded.sequence)
          or (scrabble.live_drafts.stream_id<>excluded.stream_id and ${input.kind === "edit" && input.placements.length > 0})
        returning sequence`;
      return { accepted: result.length > 0 };
    });
  }
  async function readLiveDraft(
    actor: VerifiedActor,
    familyId: string,
    gameId: string,
  ): Promise<LiveDraft | null> {
    if (!liveGameId(gameId)) reject("INVALID_DRAFT", "Choose a valid game.");
    return transaction(
      actor,
      familyId,
      async (tx) => {
        await activeMember(tx, actor, familyId, false);
        const [row] = await tx`select d.payload from scrabble.live_drafts d
        join scrabble.game_heads h using(family_id,game_id)
        join scrabble.memberships m on m.family_id=h.family_id and m.user_id=h.scorer_user_id
        where d.family_id=${familyId}::uuid and d.game_id=${gameId} and d.expires_at>now()
          and d.revision=h.revision and d.generation=h.scorer_generation and d.scorer_user_id=h.scorer_user_id
          and m.active and h.state->>'status'='active' and h.state->'pendingEnd'='null'::jsonb`;
        return (row?.payload as LiveDraft | undefined) ?? null;
      },
      true,
    );
  }
  async function readWatchDraft(token: string): Promise<{
    revision: number;
    generation: number;
    draft: LiveDraft | null;
  }> {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      reject(
        "WATCH_LINK_UNAVAILABLE",
        "This private viewing link is unavailable.",
        404,
      );
    const hash = createHash("sha256").update(token).digest("hex");
    return (await sql.begin("read only", async (tx) => {
      await tx`set local role scrabble_runtime`;
      await tx`select set_config('statement_timeout','5000',true)`;
      const [result] =
        await tx`select scrabble.read_watch_draft(${hash}) state`;
      if (!result?.state)
        reject(
          "WATCH_LINK_UNAVAILABLE",
          "This private viewing link is unavailable.",
          404,
        );
      return result.state;
    })) as unknown as {
      revision: number;
      generation: number;
      draft: LiveDraft | null;
    };
  }
  async function readWatch(token: string): Promise<SpectatorState> {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      reject(
        "WATCH_LINK_UNAVAILABLE",
        "This private viewing link is invalid, expired or revoked.",
        404,
      );
    const hash = createHash("sha256").update(token).digest("hex");
    return (await sql.begin("read only", async (tx) => {
      await tx`set local role scrabble_runtime`;
      await tx`select set_config('statement_timeout','5000',true)`;
      const [result] = await tx`select scrabble.read_watch(${hash}) state`;
      if (!result?.state)
        reject(
          "WATCH_LINK_UNAVAILABLE",
          "This private viewing link is invalid, expired or revoked.",
          404,
        );
      return result.state as SpectatorState;
    })) as SpectatorState;
  }
  return {
    readState,
    mutate,
    admit,
    exportHistory,
    readWatch,
    writeLiveDraft,
    readLiveDraft,
    readWatchDraft,
  };
}
