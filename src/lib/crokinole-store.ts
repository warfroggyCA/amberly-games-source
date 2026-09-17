import {
  hydrateCrokinoleGame,
  validateDefinition,
  isPieceColour,
  type CrokinoleGame,
} from "../domain/crokinole";
import type {
  CrokinoleAccess,
  CrokinoleDraft,
  CrokinoleMutation,
  CrokinoleMutationResult,
  CrokinoleOperation,
  CrokinolePalette,
  CrokinoleSharedState,
} from "./crokinole-contract";
import { isCrokinoleDefaults } from "../domain/crokinole-defaults";
import { familyRequest, FamilyRequestError } from "./shared-store";

export type CrokinoleEntry = {
  values: Record<string, string>;
  editingRoundId: string | null;
};
type LocalDraft = CrokinoleEntry & {
  baseRevision: number;
  generation: number;
  serverRevision: number;
  dirty: boolean;
};
type Workspace = {
  version: 1;
  drafts: Record<string, LocalDraft>;
  pending: CrokinoleMutation | null;
};
type Stored = { owner: string; workspace: Workspace };
export type CrokinoleSnapshot = {
  status: "loading" | "ready" | "error";
  games: CrokinoleGame[];
  access: Record<string, CrokinoleAccess>;
  palette: CrokinolePalette | null;
  drafts: Record<string, LocalDraft>;
  conflicts: Record<string, CrokinoleDraft>;
  busy: boolean;
  pending: boolean;
  error: string | null;
  storageError: boolean;
  recoveryNeeded: boolean;
  displaced: boolean;
  creationEnabled: boolean;
  nextCursor: string | null;
};
const initial = (): CrokinoleSnapshot => ({
  status: "loading",
  games: [],
  access: {},
  palette: null,
  drafts: {},
  conflicts: {},
  busy: false,
  pending: false,
  error: null,
  storageError: false,
  recoveryNeeded: false,
  displaced: false,
  creationEnabled: false,
  nextCursor: null,
});
const empty = (): Workspace => ({ version: 1, drafts: {}, pending: null });
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const safeId = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
const revision = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
const text = (e: unknown) =>
  e instanceof Error ? e.message : "Couldn't save. Your entry is retained.";
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? "[" + value.map(canonical).join(",") + "]"
    : object(value)
      ? "{" +
        Object.keys(value)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
          .join(",") +
        "}"
      : JSON.stringify(value);
const sameEntry = (a: CrokinoleEntry, b: CrokinoleEntry) =>
  a.editingRoundId === b.editingRoundId &&
  canonical(a.values) === canonical(b.values);
export function isCrokinoleEntry(v: unknown): v is CrokinoleEntry {
  return (
    object(v) &&
    (v.editingRoundId === null || safeId(v.editingRoundId)) &&
    object(v.values) &&
    Object.keys(v.values).length <= 4 &&
    Object.entries(v.values).every(
      ([id, value]) =>
        safeId(id) && typeof value === "string" && value.length <= 16,
    )
  );
}
class CorruptWorkspaceError extends Error {}
function readWorkspace(v: unknown): Workspace {
  if (
    !object(v) ||
    v.version !== 1 ||
    !object(v.drafts) ||
    Object.keys(v.drafts).length > 10000 ||
    !Object.entries(v.drafts).every(
      ([id, d]) =>
        safeId(id) &&
        object(d) &&
        revision(d.baseRevision) &&
        revision(d.generation) &&
        revision(d.serverRevision) &&
        typeof d.dirty === "boolean" &&
        isCrokinoleEntry(d),
    ) ||
    !(
      v.pending === null ||
      (object(v.pending) &&
        safeId(v.pending.requestId) &&
        object(v.pending.operation) &&
        typeof v.pending.operation.type === "string")
    )
  )
    throw new CorruptWorkspaceError(
      "The saved Crokinole entry needs recovery. Its original copy has not been replaced.",
    );
  return v as Workspace;
}
function isServerDraft(v: unknown): v is CrokinoleDraft {
  return (
    object(v) &&
    revision(v.revision) &&
    revision(v.baseRevision) &&
    revision(v.generation) &&
    isCrokinoleEntry(v)
  );
}
function validGame(value: unknown): value is CrokinoleGame {
  if (!object(value)) return false;
  try {
    validateDefinition(value.definition);
    const game = hydrateCrokinoleGame(value.definition, value.events);
    return ["revision", "rounds", "totals", "status", "result"].every(
      (k) =>
        JSON.stringify(value[k]) ===
        JSON.stringify(game[k as keyof CrokinoleGame]),
    );
  } catch {
    return false;
  }
}
function validPalette(v: unknown): v is CrokinolePalette {
  return (
    object(v) &&
    revision(v.revision) &&
    (v.defaults === undefined || isCrokinoleDefaults(v.defaults)) &&
    Array.isArray(v.colours) &&
    v.colours.length <= 64 &&
    v.colours.every(isPieceColour) &&
    new Set(v.colours.map((c) => c.id)).size === v.colours.length
  );
}
function validAccess(v: unknown): v is CrokinoleAccess {
  return (
    object(v) &&
    safeId(v.scorerUserId) &&
    revision(v.generation) &&
    v.generation > 0 &&
    typeof v.canScore === "boolean" &&
    typeof v.mode === "string" &&
    ["practice", "confirmed"].includes(v.mode) &&
    Array.isArray(v.concerns)
  );
}
function checkShared(v: unknown): asserts v is CrokinoleSharedState {
  if (
    !object(v) ||
    !Array.isArray(v.games) ||
    !object(v.access) ||
    !validPalette(v.palette) ||
    typeof v.creationEnabled !== "boolean" ||
    !(v.nextCursor === null || typeof v.nextCursor === "string") ||
    !(v.draft === undefined || v.draft === null || isServerDraft(v.draft)) ||
    !v.games.every(validGame) ||
    !Object.values(v.access).every(validAccess) ||
    !v.games.every(
      (g) => object(v.access) && validAccess(v.access[g.definition.id]),
    )
  )
    throw new Error(
      "Crokinole returned an incomplete response. Your saved entry is retained.",
    );
}
function checkResult(
  v: unknown,
  mutation: CrokinoleMutation,
): asserts v is CrokinoleMutationResult {
  if (
    !object(v) ||
    !(v.draft === undefined || v.draft === null || isServerDraft(v.draft)) ||
    (v.game !== undefined && !validGame(v.game)) ||
    (v.access !== undefined && !validAccess(v.access)) ||
    (v.palette !== undefined && !validPalette(v.palette)) ||
    (v.removedGameId !== undefined && !safeId(v.removedGameId))
  )
    throw new Error(
      "The saved action has not been confirmed. Retry the same action.",
    );
  const op = mutation.operation;
  const expectedGameId =
    op.type === "create-game"
      ? op.definition.id
      : op.type === "rematch"
        ? op.newGameId
        : "gameId" in op
          ? op.gameId
          : null;
  const requiresGame = [
    "create-game",
    "rematch",
    "command",
    "take-over",
    "report-concern",
    "resolve-concern",
  ].includes(op.type);
  if (
    (requiresGame && (!validGame(v.game) || !validAccess(v.access))) ||
    (op.type === "save-draft" && !isServerDraft(v.draft)) ||
    (op.type === "save-defaults" &&
      (!validPalette(v.palette) ||
        v.palette.revision !== op.expectedRevision + 1 ||
        canonical(v.palette.defaults) !== canonical(op.defaults))) ||
    (op.type === "save-palette" &&
      (!validPalette(v.palette) ||
        v.palette.revision !== op.expectedRevision + 1 ||
        canonical(v.palette.colours) !== canonical(op.colours))) ||
    (op.type === "delete-practice" && v.removedGameId !== op.gameId) ||
    (object(v.game) &&
      object(v.game.definition) &&
      v.game.definition.id !== expectedGameId)
  )
    throw new Error(
      "The response did not confirm this action. Retry the saved action.",
    );
  if (
    op.type === "command" &&
    validGame(v.game) &&
    !v.game.events.some(
      (event) => canonical(event.command) === canonical(op.command),
    )
  )
    throw new Error(
      "The recorded round was not confirmed. Retry the saved action.",
    );
  if (
    op.type === "save-draft" &&
    isServerDraft(v.draft) &&
    (v.draft.generation < op.generation ||
      (v.draft.generation === op.generation &&
        v.draft.revision <= op.expectedDraftRevision))
  )
    throw new Error(
      "The draft save was not confirmed. Retry the saved action.",
    );
  if (op.type === "create-game" && validGame(v.game)) {
    const expected = { ...op.definition, createdAt: "server-assigned" };
    const actual = { ...v.game.definition, createdAt: "server-assigned" };
    if (canonical(expected) !== canonical(actual))
      throw new Error("The created game does not match your setup.");
  }
  if (
    op.type === "take-over" &&
    validAccess(v.access) &&
    v.access.generation <= op.generation
  )
    throw new Error(
      "Scoring ownership was not confirmed. Retry the saved action.",
    );
}

/** Separate durable workspace: old Scrabble draft readers never encounter these records. */
export function createCrokinoleStore(
  familyId: string,
  userId: string,
  request = familyRequest,
) {
  let state = initial();
  const serverState = state;
  const listeners = new Set<() => void>();
  let db: IDBDatabase | null = null;
  let workspace = empty();
  let owner = "";
  let closed = false;
  let opening: Promise<void> | null = null;
  let writes: Promise<void> = Promise.resolve();
  let working = false;
  let network = false;
  let refreshDone: Promise<void> | null = null;
  let revoked = false;
  const pausedSync = new Set<string>();
  let refreshAfterFailure: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let channel: BroadcastChannel | null = null;
  const key = `${familyId}:${userId}`;
  const controller = new AbortController();
  const publish = (patch: Partial<CrokinoleSnapshot>) => {
    if (closed) return;
    state = { ...state, ...patch };
    // Retained recovery data is not an authorization grant. Expose drafts only
    // while a fresh shared response grants this account scoring access.
    state.drafts = Object.fromEntries(
      Object.entries(state.drafts).filter(([id]) => state.access[id]?.canScore),
    );
    state.conflicts = Object.fromEntries(
      Object.entries(state.conflicts).filter(
        ([id]) => state.access[id]?.canScore,
      ),
    );
    listeners.forEach((fn) => fn());
  };
  const displaced = () => {
    clearTimeout(timer);
    publish({
      displaced: true,
      busy: false,
      error: "Scoring moved to another tab. Use this tab to continue.",
    });
  };
  function transaction(next?: Workspace, claim = false): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!db || closed)
        return reject(
          new Error("Draft storage is unavailable. Keep this page open."),
        );
      const tx = db.transaction("workspaces", "readwrite");
      const table = tx.objectStore("workspaces");
      let failure: Error | null = null;
      const read = table.get(key);
      read.onsuccess = () => {
        try {
          const row = read.result as Stored | undefined;
          if (claim) {
            try {
              workspace =
                row !== undefined
                  ? readWorkspace(object(row) ? row.workspace : undefined)
                  : empty();
            } catch (error) {
              if (error instanceof CorruptWorkspaceError)
                publish({ recoveryNeeded: true });
              throw error;
            }
            table.put({ owner, workspace }, key);
          } else if (!row || row.owner !== owner) {
            displaced();
            throw new Error(
              "Scoring moved to another tab. This entry was not overwritten.",
            );
          } else if (next) table.put({ owner, workspace: next }, key);
        } catch (e) {
          failure = e instanceof Error ? e : new Error(text(e));
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(
          failure ??
            new Error(
              "Couldn't preserve this entry on the device. Keep this page open and retry.",
            ),
        );
    });
  }
  function checkpoint(next: Workspace) {
    const copy = structuredClone(next);
    const done = writes.then(() => transaction(copy));
    writes = done.catch(() => {});
    return done.catch((e) => {
      publish({ storageError: true, error: text(e) });
      throw e;
    });
  }
  async function open() {
    if (opening) return opening;
    opening = new Promise<void>((resolve, reject) => {
      owner = crypto.randomUUID();
      const req = indexedDB.open("amberly-crokinole-workspaces", 1);
      let expired = false;
      const deadline = setTimeout(() => {
        expired = true;
        reject(
          new Error(
            "Draft storage could not open. Close older Amberly tabs and retry.",
          ),
        );
      }, 10000);
      req.onupgradeneeded = () => req.result.createObjectStore("workspaces");
      req.onerror = () => {
        clearTimeout(deadline);
        reject(new Error("Draft storage is unavailable. Keep this page open."));
      };
      req.onsuccess = () => {
        clearTimeout(deadline);
        if (expired || closed) {
          req.result.close();
          return;
        }
        db = req.result;
        db.onversionchange = () => {
          displaced();
          db?.close();
        };
        transaction(undefined, true).then(() => {
          if (typeof BroadcastChannel !== "undefined") {
            channel = new BroadcastChannel(`amberly-crokinole:${key}`);
            channel.onmessage = () => void transaction().catch(displaced);
            channel.postMessage("claimed");
          }
          publish({ drafts: workspace.drafts, pending: !!workspace.pending });
          resolve();
        }, reject);
      };
    });
    return opening;
  }
  async function get(gameId?: string, cursor?: string) {
    const params = new URLSearchParams();
    if (gameId) params.set("gameId", gameId);
    if (cursor) params.set("cursor", cursor);
    const value = await request<unknown>(
      `/api/family/crokinole?${params}`,
      undefined,
      { expectedUserId: userId, signal: controller.signal },
    );
    checkShared(value);
    return value;
  }
  function mergeGame(game: CrokinoleGame) {
    return [
      game,
      ...state.games.filter((g) => g.definition.id !== game.definition.id),
    ];
  }
  async function refresh(gameId?: string, cursor?: string) {
    if (
      working ||
      network ||
      workspace.pending ||
      closed ||
      state.displaced ||
      revoked
    )
      return;
    network = true;
    let finishRefresh!: () => void;
    refreshDone = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    try {
      await open();
      await writes;
      await transaction();
      const incoming = await get(gameId, cursor);
      if (closed || state.displaced) return;
      const games = new Map(
        (gameId || cursor ? state.games : []).map((g) => [g.definition.id, g]),
      );
      incoming.games.forEach((g) => games.set(g.definition.id, g));
      const drafts = { ...workspace.drafts };
      const conflicts = { ...state.conflicts };
      if (gameId) {
        const local = drafts[gameId];
        const access = incoming.access[gameId];
        const game = incoming.games.find((g) => g.definition.id === gameId);
        const remote =
          incoming.draft ??
          (access && game
            ? {
                revision: 0,
                baseRevision: game.revision,
                generation: access.generation,
                values: {},
                editingRoundId: null,
              }
            : null);
        if (remote && access?.canScore) {
          const changedBase =
            !!local &&
            (local.generation !== remote.generation ||
              local.baseRevision !== remote.baseRevision);
          if (
            local?.dirty &&
            (changedBase ||
              (!sameEntry(local, remote) &&
                remote.revision > local.serverRevision))
          ) {
            conflicts[gameId] = remote;
            pausedSync.add(gameId);
          } else if (
            !local?.dirty ||
            (sameEntry(local, remote) && !changedBase)
          ) {
            drafts[gameId] = {
              values: remote.values,
              editingRoundId: remote.editingRoundId,
              baseRevision: remote.baseRevision,
              generation: remote.generation,
              serverRevision: remote.revision,
              dirty: false,
            };
            delete conflicts[gameId];
          }
        }
        // New ownership cannot submit a previous scorer's private draft.
        if (!incoming.access[gameId]?.canScore) {
          pausedSync.add(gameId);
          delete conflicts[gameId];
        }
      }
      const next = { ...workspace, drafts };
      workspace = next;
      await checkpoint(next);
      publish({
        status: "ready",
        games: [...games.values()],
        access:
          gameId || cursor
            ? { ...state.access, ...incoming.access }
            : incoming.access,
        palette: incoming.palette,
        drafts: workspace.drafts,
        conflicts,
        creationEnabled: incoming.creationEnabled,
        nextCursor: gameId ? state.nextCursor : incoming.nextCursor,
        error: null,
        storageError: false,
      });
    } catch (e) {
      if (e instanceof FamilyRequestError && [401, 403].includes(e.status)) {
        revoked = true;
        clearTimeout(timer);
        publish({
          status: "error",
          games: [],
          access: {},
          drafts: {},
          conflicts: {},
          palette: null,
          error: text(e),
        });
      } else if (
        e instanceof FamilyRequestError &&
        e.status === 404 &&
        gameId
      ) {
        clearTimeout(timer);
        pausedSync.add(gameId);
        const access = { ...state.access },
          drafts = { ...state.drafts },
          conflicts = { ...state.conflicts };
        delete access[gameId];
        delete drafts[gameId];
        delete conflicts[gameId];
        publish({
          status: state.status === "loading" ? "error" : state.status,
          games: state.games.filter((g) => g.definition.id !== gameId),
          access,
          drafts,
          conflicts,
          error: text(e),
        });
      } else
        publish({
          status: state.status === "loading" ? "error" : state.status,
          error: text(e),
        });
    } finally {
      network = false;
      refreshDone = null;
      finishRefresh();
    }
  }
  function schedule(gameId: string) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void syncDraft(gameId).catch(() => {});
    }, 650);
  }
  function setDraft(gameId: string, entry: CrokinoleEntry) {
    if (
      closed ||
      revoked ||
      state.displaced ||
      state.busy ||
      !isCrokinoleEntry(entry)
    )
      return;
    const game = state.games.find((g) => g.definition.id === gameId);
    const access = state.access[gameId];
    if (!game || !access?.canScore) return;
    pausedSync.delete(gameId);
    const old = workspace.drafts[gameId];
    workspace = {
      ...workspace,
      drafts: {
        ...workspace.drafts,
        [gameId]: {
          ...entry,
          baseRevision: old?.baseRevision ?? game.revision,
          generation: old?.generation ?? access.generation,
          serverRevision: old?.serverRevision ?? 0,
          dirty: true,
        },
      },
    };
    publish({ drafts: workspace.drafts });
    void checkpoint(workspace)
      .then(() => {
        publish({ storageError: false });
        schedule(gameId);
      })
      .catch(() => {});
  }
  async function applyResult(
    result: CrokinoleMutationResult,
    mutation: CrokinoleMutation,
  ) {
    const op = mutation.operation;
    const gameId =
      op.type === "rematch"
        ? op.newGameId
        : "gameId" in op
          ? op.gameId
          : result.game?.definition.id;
    let conflicts = { ...state.conflicts };
    // A checkpoint can overlap typing during draft synchronization. Rebase its
    // metadata on the newest local text until one complete checkpoint commits.
    for (;;) {
      const before = workspace;
      const drafts = { ...before.drafts };
      conflicts = { ...state.conflicts };
      if (gameId && op.type === "save-draft" && result.draft) {
        const local = drafts[gameId];
        if (local) {
          if (
            !sameEntry(result.draft, op) ||
            result.draft.baseRevision !== op.expectedRevision ||
            result.draft.generation !== op.generation
          ) {
            conflicts[gameId] = result.draft;
            drafts[gameId] = { ...local, dirty: true };
          } else
            drafts[gameId] = {
              ...local,
              serverRevision: result.draft.revision,
              dirty: !sameEntry(local, op),
            };
        }
      } else if (gameId && op.type === "command") {
        delete drafts[gameId];
        delete conflicts[gameId];
        if (result.draft)
          drafts[gameId] = {
            ...result.draft,
            serverRevision: result.draft.revision,
            dirty: false,
          };
      }
      if (result.removedGameId) {
        delete drafts[result.removedGameId];
        delete conflicts[result.removedGameId];
      }
      const next: Workspace = { ...before, drafts, pending: null };
      await checkpoint(next);
      if (workspace !== before) continue;
      workspace = next;
      break;
    }
    if (gameId && conflicts[gameId]) pausedSync.add(gameId);
    const games = (result.game ? mergeGame(result.game) : state.games).filter(
      (g) => g.definition.id !== result.removedGameId,
    );
    const access = { ...state.access };
    if (result.access && gameId) access[gameId] = result.access;
    if (result.removedGameId) delete access[result.removedGameId];
    publish({
      games,
      access,
      drafts: workspace.drafts,
      conflicts,
      palette: result.palette ?? state.palette,
      pending: false,
      storageError: false,
      error: null,
    });
  }
  async function sendPending() {
    const mutation = workspace.pending;
    if (!mutation) return;
    await writes;
    await transaction();
    try {
      const result = await request<unknown>("/api/family/crokinole", mutation, {
        expectedUserId: userId,
        signal: controller.signal,
      });
      checkResult(result, mutation);
      // A displaced tab must never apply a late acknowledgment over its new owner.
      await applyResult(result, mutation);
    } catch (e) {
      const definite =
        e instanceof FamilyRequestError &&
        [400, 404, 409, 413, 422].includes(e.status);
      if (definite) {
        for (;;) {
          const before = workspace;
          const next = { ...before, pending: null };
          await checkpoint(next);
          if (workspace !== before) continue;
          workspace = next;
          break;
        }
        if ("gameId" in mutation.operation) {
          pausedSync.add(mutation.operation.gameId);
          if (e instanceof FamilyRequestError && e.status === 409)
            refreshAfterFailure = mutation.operation.gameId;
        }
        publish({ pending: false });
      }
      if (e instanceof FamilyRequestError && [401, 403].includes(e.status)) {
        revoked = true;
        clearTimeout(timer);
        publish({
          games: [],
          access: {},
          drafts: {},
          conflicts: {},
          palette: null,
          status: "error",
        });
      }
      publish({ error: text(e), pending: !!workspace.pending });
      throw e;
    }
  }
  async function mutate(
    operation: CrokinoleOperation,
  ): Promise<CrokinoleMutationResult | undefined> {
    // Background reads must not reject an otherwise available scoring action.
    // Recheck ownership and pending writes after the read reconciles its result.
    if (refreshDone) await refreshDone;
    if (working || network || closed || state.displaced || revoked)
      throw new Error("Another action is still being saved.");
    if (workspace.pending)
      throw new Error(
        "Retry the interrupted action before recording another round.",
      );
    if (state.storageError)
      throw new Error("Restore draft storage before saving another round.");
    working = true;
    clearTimeout(timer);
    publish({ busy: operation.type !== "save-draft", error: null });
    try {
      await open();
      await writes;
      const mutation = { requestId: crypto.randomUUID(), operation };
      const next = { ...workspace, pending: mutation };
      workspace = next;
      await checkpoint(next);
      publish({ pending: true });
      await sendPending();
      return undefined;
    } finally {
      working = false;
      publish({ busy: false });
      if (refreshAfterFailure) {
        const id = refreshAfterFailure;
        refreshAfterFailure = null;
        await refresh(id);
      }
      if (
        !workspace.pending &&
        "gameId" in operation &&
        !pausedSync.has(operation.gameId) &&
        workspace.drafts[operation.gameId]?.dirty
      )
        schedule(operation.gameId);
    }
  }
  async function syncDraft(gameId: string) {
    if (
      working ||
      network ||
      workspace.pending ||
      state.conflicts[gameId] ||
      state.displaced ||
      revoked ||
      pausedSync.has(gameId)
    )
      return;
    const d = workspace.drafts[gameId];
    if (!d?.dirty) return;
    await mutate({
      type: "save-draft",
      gameId,
      generation: d.generation,
      expectedRevision: d.baseRevision,
      expectedDraftRevision: d.serverRevision,
      values: d.values,
      editingRoundId: d.editingRoundId,
    });
  }
  async function command(
    gameId: string,
    command: Extract<CrokinoleOperation, { type: "command" }>["command"],
  ) {
    clearTimeout(timer);
    if (refreshDone) await refreshDone;
    if (working || network)
      throw new Error(
        "Your entry is still synchronizing. Please try again in a moment.",
      );
    if (state.conflicts[gameId])
      throw new Error("Choose which draft to keep before saving.");
    await syncDraft(gameId);
    if (state.conflicts[gameId] || pausedSync.has(gameId))
      throw new Error("Review the latest entry before saving.");
    const access = state.access[gameId];
    if (!access?.canScore)
      throw new Error(
        "Only this game's designated scorer can change its scores.",
      );
    await mutate({
      type: "command",
      gameId,
      command,
      generation: access.generation,
      expectedDraftRevision: workspace.drafts[gameId]?.serverRevision ?? 0,
      ...("reason" in command && command.reason
        ? { amendmentReason: command.reason }
        : {}),
    });
  }
  async function resolveConflict(gameId: string, choice: "local" | "shared") {
    const remote = state.conflicts[gameId];
    const local = workspace.drafts[gameId];
    if (!remote || !local || revoked || working || network) return;
    working = true;
    publish({ busy: true });
    try {
      const chosen = choice === "shared" ? remote : local;
      const next = {
        ...workspace,
        drafts: {
          ...workspace.drafts,
          [gameId]: {
            values: chosen.values,
            editingRoundId: chosen.editingRoundId,
            baseRevision: remote.baseRevision,
            generation: remote.generation,
            serverRevision: remote.revision,
            dirty: choice === "local",
          },
        },
      };
      workspace = next;
      await checkpoint(next);
      const conflicts = { ...state.conflicts };
      delete conflicts[gameId];
      pausedSync.delete(gameId);
      publish({ drafts: workspace.drafts, conflicts });
      schedule(gameId);
    } finally {
      working = false;
      publish({ busy: false });
    }
  }
  async function recoverLocalWorkspace(confirmed: boolean) {
    if (!confirmed)
      throw new Error("Confirm local recovery before continuing.");
    if (!state.recoveryNeeded || !db || closed || revoked || working || network)
      throw new Error("Local recovery is not available right now.");
    working = true;
    clearTimeout(timer);
    publish({ busy: true });
    try {
      // Verify active family access before touching account-scoped local data.
      await get();
      await new Promise<void>((resolve, reject) => {
        const tx = db!.transaction("workspaces", "readwrite");
        const table = tx.objectStore("workspaces");
        let failure: Error | null = null;
        const read = table.get(key);
        read.onsuccess = () => {
          try {
            const raw = read.result as Stored | undefined;
            if (raw === undefined)
              throw new Error(
                "The retained workspace changed. Reload before recovery.",
              );
            let corrupt = false;
            try {
              readWorkspace(object(raw) ? raw.workspace : undefined);
            } catch (error) {
              if (error instanceof CorruptWorkspaceError) corrupt = true;
              else throw error;
            }
            if (!corrupt)
              throw new Error(
                "Another tab recovered this workspace. Reload to continue.",
              );
            table.put(raw, `recovery:${key}:${crypto.randomUUID()}`);
            table.put({ owner, workspace: empty() }, key);
          } catch (error) {
            failure = error instanceof Error ? error : new Error(text(error));
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () =>
          reject(
            failure ??
              new Error(
                "Couldn't preserve the original entry. Nothing was reset.",
              ),
          );
      });
      workspace = empty();
      opening = Promise.resolve();
      pausedSync.clear();
      publish({
        status: "loading",
        pending: false,
        drafts: {},
        conflicts: {},
        storageError: false,
        recoveryNeeded: false,
        error: null,
      });
    } catch (error) {
      if (
        error instanceof FamilyRequestError &&
        [401, 403].includes(error.status)
      ) {
        revoked = true;
        publish({
          games: [],
          access: {},
          drafts: {},
          conflicts: {},
          palette: null,
        });
      }
      publish({ error: text(error) });
      throw error;
    } finally {
      working = false;
      publish({ busy: false });
    }
    await refresh();
  }
  function exportWorkspace() {
    if (
      revoked ||
      state.status !== "ready" ||
      Object.keys(workspace.drafts).some((id) => !state.access[id]?.canScore)
    )
      throw new Error(
        "Sign in with active family access before exporting retained entries.",
      );
    const blob = new Blob(
      [JSON.stringify({ familyId, userId, workspace }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "amberly-crokinole-retained-entry.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSnapshot: () => state,
    getServerSnapshot: () => serverState,
    load: refresh,
    refresh,
    setDraft,
    command,
    mutate,
    syncDraft,
    resolveConflict,
    exportWorkspace,
    recoverLocalWorkspace,
    async flush() {
      await writes;
      if (state.storageError)
        throw new Error(
          "Your latest entry has not been saved on this device. Retry before leaving.",
        );
    },
    async retry() {
      if (working || network || revoked || closed || state.displaced) return;
      working = true;
      publish({ busy: true });
      try {
        await checkpoint(workspace);
        publish({ storageError: false });
        await sendPending();
      } finally {
        working = false;
        publish({ busy: false });
        if (refreshAfterFailure) {
          const id = refreshAfterFailure;
          refreshAfterFailure = null;
          await refresh(id);
        }
      }
    },
    close() {
      closed = true;
      clearTimeout(timer);
      controller.abort();
      channel?.close();
      void writes.finally(() => db?.close());
    },
  };
}
export type CrokinoleStore = ReturnType<typeof createCrokinoleStore>;
