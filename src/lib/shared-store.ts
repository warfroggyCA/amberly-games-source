import { hasPermission, isMemberPermissions } from "./member-permissions";
import { EMPTY_EQUIPMENT, isEquipment } from "../domain/equipment";
import type { PreviewData, Draft } from "./preview-store";
import type { ScorerSnapshot, ScorerStore } from "./scorer-store";
import type {
  SharedMutation,
  SharedMutationResult,
  SharedState,
  SharedOperation,
} from "./shared-contract";
import { describeSharedChange } from "./shared-operation";
import { isCoordinate, isTile } from "../domain/board";
import { isValidSavedPlayerProfile } from "./player-profile";
import { isVerifiedWord } from "../domain/verified-words";

export class FamilyRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}
export async function familyRequest<T>(
  path: string,
  body?: unknown,
  options: { signal?: AbortSignal; expectedUserId?: string } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40000);
  try {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (options.expectedUserId)
      headers["X-Scrabble-User"] = options.expectedUserId;
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal,
    });
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      // Even a malformed auth-error response must remove previously exposed data.
      if ([401, 403].includes(response.status)) {
        throw new FamilyRequestError(
          "Family access must be checked again. Please sign in again.",
          response.status,
        );
      }
      throw new Error("Incomplete response");
    }
    if (!response.ok) {
      throw new FamilyRequestError(
        record(result) &&
          typeof result.error === "string" &&
          result.error.length <= 500
          ? result.error
          : "The family service could not complete this request.",
        response.status,
        record(result) && typeof result.code === "string"
          ? result.code
          : undefined,
      );
    }
    return result as T;
  } catch (error) {
    if (error instanceof FamilyRequestError) throw error;
    throw new FamilyRequestError(
      "The connection was interrupted. Your entry is retained; retry the saved action before recording anything else.",
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
}
function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function record(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Reflect.ownKeys(value).every(
      (key) =>
        typeof key === "string" &&
        !["__proto__", "constructor", "prototype"].includes(key) &&
        !!Object.getOwnPropertyDescriptor(value, key)?.enumerable &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"),
    )
  );
}
function dense(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    Object.getPrototypeOf(value) === Array.prototype &&
    Reflect.ownKeys(value).length === value.length + 1 &&
    Array.from({ length: value.length }, (_, index) =>
      Object.getOwnPropertyDescriptor(value, index),
    ).every((property) => !!property && Object.hasOwn(property, "value"))
  );
}
const id = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z0-9-]{1,120}$/.test(value) &&
  !["constructor", "prototype", "__proto__"].includes(value);
const revision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const keys = (value: Record<string, unknown>, names: string[]) =>
  Object.keys(value).every((key) => names.includes(key));
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function validDrafts(value: unknown): value is Record<string, Draft> {
  return (
    record(value) &&
    Object.keys(value).length <= 10000 &&
    Object.entries(value).every(
      ([gameId, draft]) =>
        id(gameId) &&
        record(draft) &&
        keys(draft, [
          "revision",
          "row",
          "col",
          "direction",
          "atEdge",
          "placements",
        ]) &&
        revision(draft.revision) &&
        isCoordinate(draft.row) &&
        isCoordinate(draft.col) &&
        ["across", "down"].includes(draft.direction as string) &&
        (draft.atEdge === undefined || typeof draft.atEdge === "boolean") &&
        dense(draft.placements) &&
        draft.placements.length <= 7 &&
        draft.placements.every(
          (p) =>
            record(p) &&
            keys(p, ["row", "col", "tile"]) &&
            isCoordinate(p.row) &&
            isCoordinate(p.col) &&
            isTile(p.tile),
        ) &&
        new Set(
          draft.placements.map(
            (p) =>
              `${(p as { row: number }).row},${(p as { col: number }).col}`,
          ),
        ).size === draft.placements.length,
    )
  );
}
function plainJson(value: unknown, depth = 0): boolean {
  if (depth > 30) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (dense(value)) return value.every((item) => plainJson(item, depth + 1));
  return (
    record(value) &&
    Object.values(value).every((item) => plainJson(item, depth + 1))
  );
}
const operations = [
  "delete-practice-game",
  "save-equipment",
  "create-player",
  "update-player",
  "create-game",
  "game-commands",
  "verify-words",
  "approve-game",
  "report-protest",
  "resolve-protest",
  "invite-member",
  "complete-profile",
  "revoke-invitation",
  "update-member",
  "take-over-scoring",
  "create-watch-link",
  "revoke-watch-link",
];
function boundedText(
  value: unknown,
  max: number,
  multiline = false,
): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= max &&
    !(
      multiline
        ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
        : /[\u0000-\u001f\u007f]/
    ).test(value)
  );
}
function displayName(value: unknown, max: number): value is string {
  return boundedText(value, max);
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}
function validProtestOperation(operation: Record<string, unknown>): boolean {
  if (operation.type === "report-protest")
    return (
      keys(operation, ["type", "gameId", "reason", "reportedFor"]) &&
      id(operation.gameId) &&
      boundedText(operation.reason, 2000, true) &&
      (operation.reportedFor === null || displayName(operation.reportedFor, 60))
    );
  if (operation.type === "resolve-protest")
    return (
      keys(operation, ["type", "gameId", "protestId", "outcome", "reason"]) &&
      id(operation.gameId) &&
      id(operation.protestId) &&
      ["dismissed", "upheld"].includes(operation.outcome as string) &&
      boundedText(operation.reason, 2000, true)
    );
  return true;
}
function validMutation(value: unknown): value is SharedMutation {
  return (
    record(value) &&
    keys(value, ["requestId", "operation"]) &&
    id(value.requestId) &&
    record(value.operation) &&
    operations.includes(value.operation.type as string) &&
    validProtestOperation(value.operation) &&
    plainJson(value.operation) &&
    JSON.stringify(value).length <= 400000
  );
}
type Pending = {
  mutation: SharedMutation;
  activeGameId: string | null;
  drafts: Record<string, Draft>;
  beforeActiveGameId?: string | null;
};
type LocalWorkspace = {
  version: 1;
  activeGameId: string | null;
  drafts: Record<string, Draft>;
  pending: Pending | null;
};
const emptyLocal = (): LocalWorkspace => ({
  version: 1,
  activeGameId: null,
  drafts: {},
  pending: null,
});
function validateLocal(value: unknown): LocalWorkspace {
  const active = (value: unknown) => value === null || id(value);
  if (
    !record(value) ||
    !keys(value, ["version", "activeGameId", "drafts", "pending"]) ||
    value.version !== 1 ||
    !active(value.activeGameId) ||
    !validDrafts(value.drafts) ||
    !(
      value.pending === null ||
      (record(value.pending) &&
        keys(value.pending, [
          "mutation",
          "activeGameId",
          "drafts",
          "beforeActiveGameId",
        ]) &&
        validMutation(value.pending.mutation) &&
        active(value.pending.activeGameId) &&
        (!Object.hasOwn(value.pending, "beforeActiveGameId") ||
          active(value.pending.beforeActiveGameId)) &&
        validDrafts(value.pending.drafts))
    )
  ) {
    throw new Error(
      "The saved family entry needs recovery. Its stored copy has not been replaced; export it before continuing.",
    );
  }
  return value as LocalWorkspace;
}
function validGame(value: unknown): boolean {
  return (
    record(value) &&
    id(value.id) &&
    revision(value.revision) &&
    record(value.definition) &&
    typeof value.definition.createdAt === "string" &&
    Number.isFinite(Date.parse(value.definition.createdAt)) &&
    dense(value.players) &&
    value.players.length >= 1 &&
    value.players.length <= 4 &&
    dense(value.events) &&
    dense(value.board) &&
    value.board.length === 15 &&
    value.board.every(
      (row) =>
        dense(row) &&
        row.length === 15 &&
        row.every((tile) => tile === null || isTile(tile)),
    )
  );
}
function validProtest(value: unknown): boolean {
  if (
    !record(value) ||
    !keys(value, [
      "id",
      "reason",
      "reportedFor",
      "reportedBy",
      "reportedAt",
      "gameRevision",
      "resolution",
    ]) ||
    !id(value.id) ||
    !boundedText(value.reason, 2000, true) ||
    !(value.reportedFor === null || displayName(value.reportedFor, 60)) ||
    !displayName(value.reportedBy, 120) ||
    !timestamp(value.reportedAt) ||
    !revision(value.gameRevision)
  )
    return false;
  const resolution = value.resolution;
  return (
    resolution === null ||
    (record(resolution) &&
      keys(resolution, ["outcome", "reason", "resolvedBy", "resolvedAt"]) &&
      ["dismissed", "upheld"].includes(resolution.outcome as string) &&
      boundedText(resolution.reason, 2000, true) &&
      displayName(resolution.resolvedBy, 120) &&
      timestamp(resolution.resolvedAt) &&
      Date.parse(resolution.resolvedAt) >= Date.parse(value.reportedAt))
  );
}
function validAccess(value: unknown): boolean {
  return (
    record(value) &&
    id(value.scorerUserId) &&
    id(value.deviceId) &&
    revision(value.generation) &&
    typeof value.canScore === "boolean" &&
    typeof value.recordsEligible === "boolean" &&
    dense(value.protests) &&
    value.protests.length <= 100 &&
    value.protests.every(validProtest) &&
    new Set(value.protests.map((protest) => (protest as { id: string }).id))
      .size === value.protests.length &&
    ["confirmed", "practice"].includes(value.mode as string) &&
    dense(value.approvals) &&
    value.approvals.every(
      (a) =>
        record(a) &&
        id(a.playerId) &&
        (a.userId === null || id(a.userId)) &&
        typeof a.startApproved === "boolean" &&
        typeof a.resultApproved === "boolean",
    )
  );
}
function validPlayerAccess(value: unknown): boolean {
  return (
    record(value) &&
    revision(value.revision) &&
    (value.userId === null || id(value.userId))
  );
}
function validateShared(
  value: unknown,
  userId: string,
  familyId?: string,
): SharedState {
  if (
    !record(value) ||
    !record(value.member) ||
    value.member.userId !== userId ||
    value.member.active !== true ||
    !record(value.family) ||
    (familyId && value.family.id !== familyId)
  ) {
    throw new FamilyRequestError(
      "Your account or family access changed. Sign in again to open the correct workspace.",
      401,
    );
  }
  if (
    (value.equipment !== undefined && !isEquipment(value.equipment)) ||
    (value.removedGameIds !== undefined &&
      (!dense(value.removedGameIds) || !value.removedGameIds.every(id))) ||
    (value.member.permissions !== undefined &&
      !isMemberPermissions(value.member.permissions)) ||
    (value.member.revision !== undefined && !revision(value.member.revision)) ||
    !id(value.family.id) ||
    typeof value.family.name !== "string" ||
    !["member", "superadmin"].includes(value.member.role as string) ||
    !dense(value.members) ||
    !value.members.every(
      (m) =>
        record(m) &&
        ["member", "superadmin"].includes(m.role as string) &&
        (m.permissions === undefined || isMemberPermissions(m.permissions)) &&
        (m.revision === undefined || revision(m.revision)),
    ) ||
    !dense(value.invitations) ||
    !dense(value.players) ||
    !value.players.every((p) => isValidSavedPlayerProfile(p) && id(p.id)) ||
    !record(value.playerAccess) ||
    !Object.values(value.playerAccess).every(validPlayerAccess) ||
    !dense(value.games) ||
    !value.games.every(validGame) ||
    !record(value.gameAccess) ||
    !Object.values(value.gameAccess).every(validAccess) ||
    !dense(value.verifiedWords) ||
    !value.verifiedWords.every(isVerifiedWord) ||
    !(value.nextCursor === null || typeof value.nextCursor === "string")
  ) {
    throw new FamilyRequestError(
      "Shared history returned an incomplete response. Your saved entry is retained; retry the connection.",
      0,
    );
  }
  return value as SharedState;
}
function validateResult(
  value: unknown,
  operation: SharedOperation,
): SharedMutationResult {
  if (
    !record(value) ||
    !keys(value, [
      "equipment",
      "removedGameId",
      "replayed",
      "game",
      "gameAccess",
      "player",
      "playerAccess",
      "verifiedWords",
    ]) ||
    (value.equipment !== undefined && !isEquipment(value.equipment)) ||
    (operation.type === "save-equipment" && value.equipment === undefined) ||
    (value.removedGameId !== undefined &&
      (!id(value.removedGameId) ||
        value.game !== undefined ||
        value.gameAccess !== undefined)) ||
    (value.replayed !== undefined && typeof value.replayed !== "boolean") ||
    (value.game !== undefined &&
      (!validGame(value.game) || !validAccess(value.gameAccess))) ||
    (value.player !== undefined &&
      (!isValidSavedPlayerProfile(value.player) ||
        !validPlayerAccess(value.playerAccess))) ||
    (value.verifiedWords !== undefined &&
      (!dense(value.verifiedWords) ||
        !value.verifiedWords.every(isVerifiedWord)))
  ) {
    throw new FamilyRequestError(
      "The save response was incomplete. Retry the saved action to confirm it safely.",
      0,
    );
  }
  const result = value as SharedMutationResult;
  if (result.removedGameId) {
    const gameId =
      operation.type === "create-game"
        ? operation.id
        : "gameId" in operation
          ? operation.gameId
          : null;
    if (
      result.removedGameId !== gameId ||
      (operation.type !== "delete-practice-game" && !result.replayed)
    )
      throw new FamilyRequestError(
        "The removal response did not match this game. Retry safely.",
        0,
      );
    return result;
  }
  if (operation.type === "delete-practice-game")
    throw new FamilyRequestError(
      "Game removal was not confirmed. Retry the saved action.",
      0,
    );
  if (
    operation.type === "save-equipment" &&
    result.equipment!.revision < operation.equipment.revision
  )
    throw new FamilyRequestError(
      "Tile-set save was not confirmed. Retry the saved action.",
      0,
    );
  if (
    (["create-player", "update-player", "complete-profile"].includes(
      operation.type,
    ) &&
      (!result.player ||
        result.player.id !== (operation as { id: string }).id)) ||
    ([
      "create-game",
      "game-commands",
      "verify-words",
      "approve-game",
      "report-protest",
      "resolve-protest",
      "take-over-scoring",
    ].includes(operation.type) &&
      (!result.game ||
        result.game.id !==
          (operation.type === "create-game"
            ? operation.id
            : (operation as { gameId: string }).gameId)))
  ) {
    throw new FamilyRequestError(
      "The save response did not confirm this action. Retry the saved action.",
      0,
    );
  }
  return result;
}
const emptyData = (): PreviewData => ({
  version: 1,
  revision: 0,
  players: [],
  games: [],
  activeGameId: null,
  drafts: {},
});
const initial: ScorerSnapshot = freeze({
  status: "loading",
  data: emptyData(),
  error: null,
  pending: 0,
});

export type SharedScorerStore = ScorerStore & {
  openGame: (gameId: string) => Promise<void>;
  administer: (operation: SharedOperation) => Promise<void>;
  takeOver: (gameId: string, reason: string) => Promise<void>;
  close: () => void;
  exportWorkspace: () => void;
};
export function createSharedStore(userId: string): SharedScorerStore {
  let snapshot = initial;
  let creationMode: "confirmed" | "practice" = "confirmed";
  let workspace = emptyLocal();
  let recoveryValue: unknown;
  let database: IDBDatabase | null = null;
  let key = "";
  const writerId = crypto.randomUUID();
  let writerKey = "";
  let deviceId = "";
  let familyId: string | undefined;
  let loading: Promise<void> | null = null;
  let queue = Promise.resolve();
  let ownershipChannel: BroadcastChannel | undefined;
  let stopOwnershipChecks: (() => void) | undefined;
  let retired = false;
  let accessLost = false;
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  const publish = (next: ScorerSnapshot) => {
    snapshot = freeze(next);
    listeners.forEach((l) => l());
  };
  const assertOpen = () => {
    if (retired)
      throw new Error(
        "This scoring page has closed. Reload to restore and verify the saved entry.",
      );
  };
  const disconnect = (
    message: string,
    denied = false,
    scoringElsewhere = false,
  ) => {
    retired = true;
    accessLost ||= denied;
    lifetime.abort();
    ownershipChannel?.close();
    ownershipChannel = undefined;
    stopOwnershipChecks?.();
    stopOwnershipChecks = undefined;
    database?.close();
    database = null;
    publish({
      status: "error",
      data: emptyData(),
      pending: 0,
      unresolved: !!workspace.pending,
      scoringElsewhere,
      error: message,
    });
  };
  const displaced = () => {
    if (!retired)
      disconnect(
        "Scoring moved to another tab. Your saved letters and any unfinished save are available there.",
        false,
        true,
      );
  };
  async function request<T>(path: string, body?: unknown): Promise<T> {
    assertOpen();
    try {
      const result = await familyRequest<T>(path, body, {
        signal: lifetime.signal,
        expectedUserId: userId,
      });
      assertOpen();
      return result;
    } catch (error) {
      if (
        error instanceof FamilyRequestError &&
        [401, 403].includes(error.status) &&
        error.code !== "PERMISSION_DENIED"
      )
        disconnect(error.message, true);
      throw error;
    }
  }
  async function sharedRequest(path: string): Promise<SharedState> {
    try {
      return validateShared(await request(path), userId, familyId);
    } catch (error) {
      if (
        error instanceof FamilyRequestError &&
        [401, 403].includes(error.status) &&
        error.code !== "PERMISSION_DENIED"
      )
        disconnect(error.message, true);
      throw error;
    }
  }
  const save = (nextValue: LocalWorkspace) =>
    new Promise<void>((resolve, reject) => {
      assertOpen();
      const next = structuredClone(validateLocal(nextValue));
      if (!database) {
        reject(
          new Error("Local draft storage is unavailable. Keep this page open."),
        );
        return;
      }
      const tx = database.transaction("workspaces", "readwrite");
      const values = tx.objectStore("workspaces");
      let ownershipLost = false;
      const owner = values.get(writerKey);
      owner.onsuccess = () => {
        // Check and write in one transaction. A sleeping or displaced tab must
        // not overwrite the new tab's draft, even before it handles lock loss.
        ownershipLost =
          retired ||
          !record(owner.result) ||
          owner.result.writerId !== writerId ||
          owner.result.deviceId !== deviceId;
        if (ownershipLost) {
          tx.abort();
          return;
        }
        try {
          values.put(next, key);
        } catch {
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        workspace = freeze(next);
        recoveryValue = next;
        if (retired)
          reject(
            new Error(
              "The page closed. The saved action is retained; reload before continuing.",
            ),
          );
        else resolve();
      };
      tx.onabort = () => {
        if (ownershipLost) displaced();
        reject(
          new Error(
            ownershipLost
              ? "Scoring moved to another tab. Use that tab or select Use this tab to switch back."
              : "The device could not preserve this action. Nothing new was sent. Keep your entry open and free some storage.",
          ),
        );
      };
      tx.onerror = () => {};
    });
  const enqueue = (operation: () => Promise<void>) => {
    const next = queue.then(() => {
      assertOpen();
      return operation();
    });
    queue = next.catch(() => {});
    return next;
  };
  function install(
    shared: SharedState,
    preserveGames = false,
    preserveCursor = false,
  ) {
    assertOpen();
    const removed = new Set([
      ...(snapshot.shared?.removedGameIds ?? []),
      ...(shared.removedGameIds ?? []),
    ]);
    const availableGames = preserveGames
      ? [
          ...new Map(
            [...snapshot.data.games, ...shared.games].map((g) => [g.id, g]),
          ).values(),
        ].sort(
          (a, b) =>
            a.definition.createdAt.localeCompare(b.definition.createdAt) ||
            a.id.localeCompare(b.id),
        )
      : shared.games;
    const allAccess = { ...snapshot.shared?.gameAccess, ...shared.gameAccess };
    const games = availableGames.filter(
      (g) =>
        !removed.has(g.id) &&
        (shared.member.role === "superadmin" ||
          allAccess[g.id]?.mode !== "practice"),
    );
    const visibleIds = new Set(games.map((g) => g.id));
    const meta = {
      ...shared,
      removedGameIds: [...removed],
      games,
      gameAccess: Object.fromEntries(
        Object.entries(
          preserveGames && snapshot.shared
            ? { ...snapshot.shared.gameAccess, ...shared.gameAccess }
            : shared.gameAccess,
        ).filter(([id]) => visibleIds.has(id)),
      ),
      nextCursor:
        preserveCursor && snapshot.shared
          ? snapshot.shared.nextCursor
          : shared.nextCursor,
    };
    const wantedActive = workspace.activeGameId ?? snapshot.data.activeGameId;
    const activeGameId =
      wantedActive && visibleIds.has(wantedActive)
        ? wantedActive
        : (games.at(-1)?.id ?? null);
    const stale = Object.entries(workspace.drafts).some(
      ([gameId, draft]) =>
        draft.placements.length > 0 &&
        games.some(
          (g) =>
            g.id === gameId &&
            (g.revision !== draft.revision ||
              draft.placements.some((p) => g.board[p.row][p.col] !== null)),
        ),
    );
    publish({
      ...snapshot,
      // A pending acknowledgement may itself explain a newer server revision;
      // keep its retry control available while scoring remains locked.
      status: stale && !workspace.pending ? "error" : "ready",
      shared: meta,
      data: {
        ...snapshot.data,
        equipment: shared.equipment ?? EMPTY_EQUIPMENT,
        players: shared.players,
        games,
        verifiedWords: shared.verifiedWords,
        activeGameId,
        drafts: workspace.drafts,
      },
      unresolved: !!workspace.pending,
      error: stale
        ? "This game changed while an entry was saved on this device. Your letters are retained. Export the retained entry before reviewing the updated game."
        : null,
    });
  }
  async function receive(pending: Pending) {
    const result = validateResult(
      await request("/api/family", pending.mutation),
      pending.mutation.operation,
    );
    const shared = snapshot.shared!;
    const drafts = { ...pending.drafts };
    if (result.game && drafts[result.game.id])
      drafts[result.game.id] = {
        ...drafts[result.game.id],
        revision: result.game.revision,
      };
    const activeGameId =
      Object.hasOwn(pending, "beforeActiveGameId") &&
      workspace.activeGameId !== pending.beforeActiveGameId
        ? workspace.activeGameId
        : pending.activeGameId;
    // Retain the exact request until acknowledgement AND the local checkpoint succeed.
    await save({ ...workspace, drafts, activeGameId, pending: null });
    const currentGame =
      result.game &&
      snapshot.data.games.find((game) => game.id === result.game!.id);
    const keepCurrentGame =
      !!currentGame && currentGame.revision > result.game!.revision;
    const currentAccess = result.game && shared.gameAccess[result.game.id];
    const keepCurrentAccess =
      !!currentAccess &&
      !!result.gameAccess &&
      (keepCurrentGame ||
        currentAccess.generation > result.gameAccess.generation);
    const keepCurrentPlayer =
      !!result.player &&
      !!result.playerAccess &&
      (shared.playerAccess[result.player.id]?.revision ?? -1) >
        result.playerAccess.revision;
    const games =
      result.game && !keepCurrentGame
        ? [
            ...snapshot.data.games.filter((g) => g.id !== result.game!.id),
            result.game,
          ].sort(
            (a, b) =>
              a.definition.createdAt.localeCompare(b.definition.createdAt) ||
              a.id.localeCompare(b.id),
          )
        : snapshot.data.games;
    install({
      ...shared,
      removedGameIds: [
        ...(shared.removedGameIds ?? []),
        ...(result.removedGameId ? [result.removedGameId] : []),
      ],
      equipment:
        result.equipment &&
        result.equipment.revision >= (shared.equipment?.revision ?? 0)
          ? result.equipment
          : shared.equipment,
      players:
        result.player && !keepCurrentPlayer
          ? [
              ...shared.players.filter((p) => p.id !== result.player!.id),
              result.player,
            ]
          : shared.players,
      playerAccess:
        result.player && result.playerAccess && !keepCurrentPlayer
          ? { ...shared.playerAccess, [result.player.id]: result.playerAccess }
          : shared.playerAccess,
      games,
      gameAccess:
        result.game && result.gameAccess && !keepCurrentAccess
          ? { ...shared.gameAccess, [result.game.id]: result.gameAccess }
          : shared.gameAccess,
      verifiedWords: [
        ...new Map(
          [...(result.verifiedWords ?? []), ...shared.verifiedWords].map(
            (word) => [word.word, word],
          ),
        ).values(),
      ],
    });
  }
  async function send(pending: Pending) {
    publish({ ...snapshot, pending: snapshot.pending + 1, error: null });
    try {
      await receive(pending);
    } catch (error) {
      if (retired) throw error;
      // Authentication loss may follow an earlier successful but unacknowledged
      // commit. Never discard that saved request merely because a retry is denied.
      if (
        error instanceof FamilyRequestError &&
        error.status >= 400 &&
        error.status < 500 &&
        (![401, 403, 408, 429].includes(error.status) ||
          error.code === "PERMISSION_DENIED")
      ) {
        try {
          await save({ ...workspace, pending: null });
          if (
            error instanceof FamilyRequestError &&
            error.code === "PERMISSION_DENIED"
          )
            install(await sharedRequest("/api/family"), true, true);
        } catch (storageError) {
          error = storageError;
        }
      }
      publish({
        ...snapshot,
        pending: Math.max(0, snapshot.pending - 1),
        unresolved: !!workspace.pending,
        error: error instanceof Error ? error.message : "Shared save failed.",
      });
      throw error;
    }
    publish({
      ...snapshot,
      pending: Math.max(0, snapshot.pending - 1),
      unresolved: false,
    });
  }
  async function load() {
    assertOpen();
    if (loading) return loading;
    loading = (async () => {
      let shared = await sharedRequest("/api/family");
      familyId = shared.family.id;
      const slot = `scrabble-device:${familyId}:${userId}`;
      deviceId =
        localStorage.getItem(slot) ??
        sessionStorage.getItem(slot) ??
        crypto.randomUUID();
      if (!id(deviceId))
        throw new Error(
          "The saved device identity needs recovery. Open a new tab without replacing its stored entry.",
        );
      writerKey = `writer:${familyId}:${userId}`;
      database = await new Promise<IDBDatabase>((resolve, reject) => {
        // Version 2 retires pre-takeover clients via their versionchange handler.
        // Their workspace format stays intact; no saved records are migrated.
        const open = indexedDB.open("family-scrabble-shared-workspaces", 2);
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                "Device draft storage timed out. Close other scoring tabs and retry.",
              ),
            ),
          10000,
        );
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains("workspaces"))
            open.result.createObjectStore("workspaces");
        };
        open.onsuccess = () => {
          clearTimeout(timer);
          if (retired) {
            open.result.close();
            reject(new Error("The scoring page closed."));
          } else resolve(open.result);
        };
        open.onerror = () => {
          clearTimeout(timer);
          reject(new Error("Device draft storage could not open."));
        };
        // Legacy tabs close on versionchange; give that event time to run.
        // The timeout above still prevents an indefinitely blocked opening.
        open.onblocked = () => {};
      });
      database.onversionchange = () =>
        disconnect(
          "Device storage changed in another tab. Reload before continuing.",
        );
      let takingOver = false;
      await new Promise<void>((resolve, reject) => {
        const tx = database!.transaction("workspaces", "readwrite");
        const values = tx.objectStore("workspaces");
        const owner = values.get(writerKey);
        let restored: LocalWorkspace;
        let error: unknown;
        owner.onsuccess = () => {
          try {
            assertOpen();
            takingOver = owner.result !== undefined;
            if (takingOver) {
              if (
                !record(owner.result) ||
                !id(owner.result.writerId) ||
                !id(owner.result.deviceId)
              )
                throw new Error(
                  "The saved scoring identity needs recovery. Its stored entry has not been replaced.",
                );
              // Resolve first-use races in the same transaction as the claim.
              // Every tab on this browser uses the existing workspace identity.
              deviceId = owner.result.deviceId;
            }
            key = `${familyId}:${userId}:${deviceId}`;
            const read = values.get(key);
            read.onsuccess = () => {
              try {
                assertOpen();
                recoveryValue = read.result ?? emptyLocal();
                restored = freeze(validateLocal(recoveryValue));
                // Read the checkpoint and claim ownership atomically. Earlier
                // saves finish first; later saves must pass the owner check.
                values.put({ writerId, deviceId }, writerKey);
              } catch (cause) {
                error = cause;
                tx.abort();
              }
            };
          } catch (cause) {
            error = cause;
            tx.abort();
          }
        };
        tx.oncomplete = () => {
          workspace = restored;
          resolve();
        };
        tx.onabort = () =>
          reject(
            error ??
              new Error(
                "Your saved entry could not be opened. Its stored copy is retained.",
              ),
          );
        tx.onerror = () => {};
      });
      assertOpen();
      localStorage.setItem(slot, deviceId);
      const checkOwnership = async () => {
        if (retired || !database) return;
        try {
          const owner = await new Promise<unknown>((resolve, reject) => {
            const read = database!
              .transaction("workspaces", "readonly")
              .objectStore("workspaces")
              .get(writerKey);
            read.onsuccess = () => resolve(read.result);
            read.onerror = () => reject(read.error);
          });
          if (
            !record(owner) ||
            owner.writerId !== writerId ||
            owner.deviceId !== deviceId
          )
            displaced();
        } catch {
          if (!retired)
            disconnect(
              "Scoring ownership could not be checked. Reload to restore your saved entry.",
            );
        }
      };
      // Notifications only update the UI. IndexedDB is the authority, so a lost
      // or delayed message cannot let a retired writer replace another draft.
      if (typeof BroadcastChannel !== "undefined") {
        ownershipChannel = new BroadcastChannel(
          `scrabble-writer:${familyId}:${userId}`,
        );
        ownershipChannel.onmessage = () => {
          void checkOwnership();
        };
        ownershipChannel.postMessage("claimed");
      }
      if (typeof window !== "undefined") {
        const check = () => {
          void checkOwnership();
        };
        window.addEventListener("focus", check);
        document.addEventListener("visibilitychange", check);
        stopOwnershipChecks = () => {
          window.removeEventListener("focus", check);
          document.removeEventListener("visibilitychange", check);
        };
      }
      // Also catches a claim that happened just before our listener was ready.
      await checkOwnership();
      assertOpen();
      // The previous tab may have saved after our first membership read.
      if (takingOver) shared = await sharedRequest("/api/family");
      install(shared);
      if (
        workspace.activeGameId &&
        !shared.removedGameIds?.includes(workspace.activeGameId) &&
        !shared.games.some((g) => g.id === workspace.activeGameId)
      ) {
        try {
          install(
            await sharedRequest(
              `/api/family?gameId=${encodeURIComponent(workspace.activeGameId)}`,
            ),
            true,
            true,
          );
        } catch (error) {
          if (!(
            error instanceof FamilyRequestError &&
            error.code === "GAME_NOT_FOUND"
          ))
            throw error;
        }
      }
      if (workspace.pending)
        publish({
          ...snapshot,
          unresolved: true,
          error:
            "A saved action needs confirmation. Retry it to check the server without duplicating it.",
        });
    })().catch((error) => {
      if (!retired)
        disconnect(
          error instanceof Error ? error.message : "Family access unavailable.",
        );
      throw error;
    });
    return loading;
  }
  const refresh = () =>
    enqueue(async () => {
      if (workspace.pending)
        throw new Error(
          "Confirm the saved action before refreshing shared history.",
        );
      try {
        const shared = await sharedRequest("/api/family");
        const activeGameId =
          workspace.activeGameId ?? snapshot.data.activeGameId;
        let active: SharedState | null = null;
        if (
          activeGameId &&
          !shared.removedGameIds?.includes(activeGameId) &&
          !shared.games.some((g) => g.id === activeGameId)
        ) {
          try {
            active = await sharedRequest(
              `/api/family?gameId=${encodeURIComponent(activeGameId)}`,
            );
          } catch (error) {
            if (!(
              error instanceof FamilyRequestError &&
              error.code === "GAME_NOT_FOUND"
            ))
              throw error;
          }
        }
        install(shared, true, true);
        if (active) install(active, true, true);
      } catch (error) {
        if (!retired)
          publish({
            ...snapshot,
            error:
              error instanceof Error
                ? error.message
                : "Shared history could not be refreshed.",
          });
        throw error;
      }
    });
  const store: SharedScorerStore = {
    mode: "shared",
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    update: (change) =>
      enqueue(async () => {
        if (snapshot.status !== "ready" || !snapshot.shared)
          throw new Error("Shared history is not ready.");
        const next = change(snapshot.data);
        if (
          !validDrafts(next.drafts) ||
          !(next.activeGameId === null || id(next.activeGameId))
        )
          throw new Error(
            "This draft could not be preserved. The previous saved entry is retained.",
          );
        const operation = describeSharedChange(
          snapshot.data,
          next,
          snapshot.shared,
          deviceId,
          creationMode,
        );
        if (!operation) {
          if (workspace.pending && !same(next.drafts, workspace.drafts))
            throw new Error(
              "Confirm the saved action before editing its letters.",
            );
          await save({
            ...workspace,
            activeGameId: next.activeGameId,
            drafts: next.drafts,
          });
          publish({
            ...snapshot,
            data: {
              ...snapshot.data,
              activeGameId: next.activeGameId,
              drafts: workspace.drafts,
            },
          });
          return;
        }
        if (workspace.pending)
          throw new Error(
            "Retry the saved action before recording another change.",
          );
        const pending: Pending = {
          mutation: { requestId: crypto.randomUUID(), operation },
          activeGameId: next.activeGameId,
          beforeActiveGameId: workspace.activeGameId,
          drafts: next.drafts,
        };
        await save({ ...workspace, pending });
        await send(workspace.pending!);
      }),
    retry: () =>
      enqueue(async () => {
        if (workspace.pending) await send(workspace.pending);
      }),
    refresh,
    openGame: (gameId) =>
      enqueue(async () => {
        if (workspace.pending)
          throw new Error(
            "Confirm the pending action before opening another game.",
          );
        install(
          await sharedRequest(
            `/api/family?gameId=${encodeURIComponent(gameId)}`,
          ),
          true,
          true,
        );
        if (!snapshot.data.games.some((game) => game.id === gameId))
          throw new Error("This game is no longer available.");
        await save({ ...workspace, activeGameId: gameId });
        publish({
          ...snapshot,
          data: { ...snapshot.data, activeGameId: gameId },
        });
      }),
    loadMore: () =>
      enqueue(async () => {
        const cursor = snapshot.shared?.nextCursor;
        if (cursor)
          install(
            await sharedRequest(
              `/api/family?cursor=${encodeURIComponent(cursor)}`,
            ),
            true,
          );
      }),
    setCreationMode: (mode) => {
      creationMode = mode;
    },
    canScore: (gameId) => {
      if (retired || snapshot.status !== "ready") return false;
      const access = snapshot.shared?.gameAccess[gameId];
      return (
        !!access &&
        access.canScore === true &&
        hasPermission(snapshot.shared?.member, "scoreGames") &&
        access.scorerUserId === userId &&
        !snapshot.unresolved
      );
    },
    canEditPlayer: (playerId) =>
      !retired &&
      snapshot.status === "ready" &&
      (hasPermission(snapshot.shared?.member, "editAllProfiles") ||
        (hasPermission(snapshot.shared?.member, "editOwnProfile") &&
          snapshot.shared?.playerAccess[playerId]?.userId === userId)),
    downloadBackup: async () => {
      const value = await request("/api/family?export=1");
      download(
        value,
        `scrabble-family-history-${new Date().toISOString().slice(0, 10)}.json`,
      );
    },
    administer: (operation) =>
      enqueue(async () => {
        if (snapshot.status !== "ready" || !snapshot.shared)
          throw new Error("Shared history is not ready.");
        if (workspace.pending) throw new Error("Retry the saved action first.");
        const pending: Pending = {
          mutation: { requestId: crypto.randomUUID(), operation },
          activeGameId: workspace.activeGameId,
          beforeActiveGameId: workspace.activeGameId,
          drafts: workspace.drafts,
        };
        if (!validMutation(pending.mutation))
          throw new Error(
            "This family action contains invalid details. Your entry has been kept.",
          );
        await save({ ...workspace, pending });
        await send(workspace.pending!);
        install(await sharedRequest("/api/family"), true, true);
      }),
    takeOver: (gameId, reason) => {
      const access = snapshot.shared?.gameAccess[gameId];
      if (!access)
        return Promise.reject(
          new Error("Refresh this game before taking over scoring."),
        );
      return store.administer({
        type: "take-over-scoring",
        gameId,
        deviceId,
        expectedGeneration: access.generation,
        reason,
      });
    },
    exportWorkspace: () => {
      if (accessLost) {
        publish({
          ...snapshot,
          error:
            "Sign in with the original account before exporting its retained entry.",
        });
        return;
      }
      try {
        download(recoveryValue ?? workspace, "scrabble-unsent-workspace.json");
      } catch {
        publish({
          ...snapshot,
          error:
            "The retained entry could not be exported as JSON. Its stored copy has not been changed.",
        });
      }
    },
    close: () => {
      if (!retired)
        disconnect(
          "This scoring page has closed. Reload to restore the saved entry.",
        );
    },
  };
  return store;
}
