import {
  hydrateGame,
  type GameState,
  type CommandContext,
} from "../domain/game";
import type { Direction, Placement } from "../domain/types";
import { isCoordinate, isTile } from "../domain/board";
import { verifyMoveExists } from "../domain/solver";
import { resolveLexicon } from "./lexicons";
import {
  extendLexicon,
  isVerifiedWord,
  type VerifiedWord,
} from "../domain/verified-words";
import {
  isValidSavedPlayerProfile,
  type PlayerProfileFields,
} from "./player-profile";

import {
  EMPTY_EQUIPMENT,
  isEquipment,
  validateEquipmentChange,
  type Equipment,
} from "../domain/equipment";

export type SavedPlayer = PlayerProfileFields & { id: string };
export type Draft = {
  revision: number;
  placements: Placement[];
  row: number;
  col: number;
  direction: Direction;
  atEdge?: boolean;
};
export type PreviewData = {
  equipment?: Equipment;
  verifiedWords?: VerifiedWord[];
  version: 1;
  revision: number;
  players: SavedPlayer[];
  games: GameState[];
  activeGameId: string | null;
  drafts: Record<string, Draft>;
};
type Snapshot = {
  status: "loading" | "ready" | "error";
  data: PreviewData;
  error: string | null;
  pending: number;
};
const EMPTY: PreviewData = {
  version: 1,
  revision: 0,
  players: [],
  games: [],
  activeGameId: null,
  drafts: {},
};
const initial: Snapshot = {
  status: "loading",
  data: EMPTY,
  error: null,
  pending: 0,
};
let snapshot = initial;
let database: IDBDatabase | null = null;
let loading: Promise<void> | null = null;
let queue = Promise.resolve();
let persistedFingerprint: string | null = null;
let writeBlocked: string | null = null;
const listeners = new Set<() => void>();
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getSnapshot = () => snapshot;
export const getServerSnapshot = () => initial;
function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export const solverContext: CommandContext = {
  hasLegalMove(board, rack, lexicon, tileSupply, verifiedWords) {
    const registered = resolveLexicon({
      id: lexicon.id,
      edition: lexicon.edition,
      status: lexicon.status,
    });
    const effective = extendLexicon(registered, verifiedWords ?? []);
    const search = verifyMoveExists(board, rack, effective, { tileSupply });
    if (search.status === "found") return true;
    if (search.status === "none") return false;
    throw new Error("Move search could not complete. No pass was recorded.");
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
function denseArray(value: unknown): value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    return false;
  return Array.from({ length: value.length }, (_, index) =>
    Object.getOwnPropertyDescriptor(value, index),
  ).every((descriptor) => !!descriptor && Object.hasOwn(descriptor, "value"));
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function validate(value: unknown, previous?: PreviewData): PreviewData {
  if (!isRecord(value))
    throw new Error(
      "Saved preview data is unreadable. Its stored copy has not been replaced.",
    );
  const raw = value as PreviewData;
  if (
    raw.version !== 1 ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 0 ||
    !denseArray(raw.players) ||
    !denseArray(raw.games) ||
    !isRecord(raw.drafts)
  )
    throw new Error(
      "The saved preview structure or version needs recovery. Its stored copy has not been replaced.",
    );
  if (
    raw.players.some(
      (p) =>
        !isRecord(p) ||
        !isValidSavedPlayerProfile(p) ||
        typeof p.id !== "string" ||
        !/^[a-zA-Z0-9-]{1,120}$/.test(p.id) ||
        ["constructor", "prototype", "__proto__"].includes(p.id) ||
        typeof p.name !== "string" ||
        !p.name.trim() ||
        p.name.length > 60 ||
        /[\u0000-\u001f\u007f]/.test(p.name),
    ) ||
    new Set(raw.players.map((p) => p.id)).size !== raw.players.length
  )
    throw new Error(
      "Saved player data needs recovery. Nothing has been replaced.",
    );
  if (
    raw.verifiedWords !== undefined &&
    (!denseArray(raw.verifiedWords) ||
      raw.verifiedWords.length > 10000 ||
      !raw.verifiedWords.every(isVerifiedWord) ||
      new Set(raw.verifiedWords.map((entry) => entry.word)).size !==
        raw.verifiedWords.length)
  )
    throw new Error(
      "Saved word verifications need recovery. Nothing was replaced.",
    );
  for (const entry of previous?.verifiedWords ?? []) {
    if (
      !raw.verifiedWords?.some(
        (saved) => JSON.stringify(saved) === JSON.stringify(entry),
      )
    )
      throw new Error(
        "Saved word verifications cannot be removed or replaced.",
      );
  }
  if (raw.equipment !== undefined && !isEquipment(raw.equipment))
    throw new Error("Saved tile sets need recovery. Nothing was replaced.");
  if (
    previous &&
    JSON.stringify(previous.equipment) !== JSON.stringify(raw.equipment)
  ) {
    if (!raw.equipment) throw new Error("Saved equipment cannot be removed.");
    validateEquipmentChange(
      previous.equipment ?? EMPTY_EQUIPMENT,
      raw.equipment,
    );
  }
  const games = raw.games.map((saved) => {
    // Unchanged snapshots are deeply frozen; typing a draft need not replay their journals.
    if (previous?.games.includes(saved)) return saved;
    if (!isRecord(saved))
      throw new Error(
        "Saved game data needs recovery. Its stored copy has not been replaced.",
      );
    const registered = resolveLexicon(saved.lexicon);
    const restored = hydrateGame(saved, registered, solverContext);
    if (!restored.ok)
      throw new Error(`Saved game needs recovery: ${restored.error.message}`);
    return restored.game;
  });
  for (const original of previous?.games ?? []) {
    const replacement = games.find((game) => game.id === original.id);
    if (
      !replacement ||
      JSON.stringify(replacement.definition) !==
        JSON.stringify(original.definition) ||
      replacement.events.length < original.events.length ||
      original.events.some(
        (event, index) =>
          JSON.stringify(event) !== JSON.stringify(replacement.events[index]),
      )
    ) {
      throw new Error(
        "Previously saved game history cannot be removed or replaced. Record a correction that preserves the original journal.",
      );
    }
  }
  const playerIds = new Set(raw.players.map((p) => p.id));
  if (
    new Set(games.map((g) => g.id)).size !== games.length ||
    games.some((g) => g.players.some((p) => !playerIds.has(p.id))) ||
    (raw.activeGameId !== null &&
      (typeof raw.activeGameId !== "string" ||
        !games.some((g) => g.id === raw.activeGameId)))
  ) {
    throw new Error(
      "Saved game references need recovery. Nothing has been replaced.",
    );
  }
  for (const [id, draft] of Object.entries(raw.drafts)) {
    const game = games.find((g) => g.id === id);
    if (
      !game ||
      !isRecord(draft) ||
      !Number.isSafeInteger(draft.revision) ||
      draft.revision !== game.revision ||
      !isCoordinate(draft.row) ||
      !isCoordinate(draft.col) ||
      !["across", "down"].includes(draft.direction) ||
      (draft.atEdge !== undefined && typeof draft.atEdge !== "boolean") ||
      !denseArray(draft.placements) ||
      draft.placements.length > 7 ||
      draft.placements.some(
        (p) =>
          !isRecord(p) ||
          !isCoordinate(p.row) ||
          !isCoordinate(p.col) ||
          !isTile(p.tile) ||
          game.board[p.row][p.col] !== null,
      ) ||
      new Set(draft.placements.map((p) => `${p.row},${p.col}`)).size !==
        draft.placements.length
    ) {
      throw new Error(
        "A saved draft needs recovery. Nothing has been replaced.",
      );
    }
  }
  return freeze({ ...raw, games });
}

export function loadPreview(): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve) => {
    let finished = false;
    let request: IDBOpenDBRequest;
    const finish = (error?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) publish({ ...snapshot, status: "error", error });
      resolve();
    };
    const timer = setTimeout(
      () =>
        finish(
          "Device storage did not respond. No saved history was replaced. Reload to retry.",
        ),
      15_000,
    );
    try {
      request = indexedDB.open("family-scrabble-development", 1);
    } catch {
      finish(
        "Device storage could not be opened. No saved history was changed.",
      );
      return;
    }
    request.onupgradeneeded = () => {
      if (finished) {
        request.transaction?.abort();
        return;
      }
      if (!request.result.objectStoreNames.contains("state"))
        request.result.createObjectStore("state");
    };
    request.onerror = () =>
      finish("Device storage is unavailable. No saved history was changed.");
    request.onblocked = () =>
      finish(
        "Close other preview tabs, then reload to complete the storage update. No saved history was replaced.",
      );
    request.onsuccess = () => {
      const opened = request.result;
      if (finished) {
        opened.close();
        return;
      }
      database = opened;
      opened.onversionchange = () => {
        opened.close();
        if (database === opened) database = null;
        writeBlocked =
          "Storage was updated in another tab. Copy any unsaved input before reloading.";
        if (!finished) finish(writeBlocked);
        else publish({ ...snapshot, error: writeBlocked });
      };
      try {
        const tx = opened.transaction("state", "readonly");
        const read = tx.objectStore("state").get("preview");
        let restored: PreviewData | undefined;
        let fingerprint: string | null = null;
        read.onsuccess = () => {
          if (finished) return;
          try {
            restored =
              read.result === undefined
                ? freeze(structuredClone(EMPTY))
                : validate(read.result);
            fingerprint =
              read.result === undefined ? null : JSON.stringify(read.result);
          } catch (error) {
            finish(
              error instanceof Error
                ? error.message
                : "Could not restore the stored preview. Nothing was replaced.",
            );
          }
        };
        tx.oncomplete = () => {
          if (finished || !restored) return;
          persistedFingerprint = fingerprint;
          publish({ status: "ready", data: restored, error: null, pending: 0 });
          finish();
        };
        tx.onabort = () =>
          finish(
            "Saved preview could not be read. Its stored copy has not been replaced.",
          );
        tx.onerror = () => {
          /* The abort event reports the complete transaction failure. */
        };
      } catch {
        finish(
          "Saved preview could not be opened for reading. Its stored copy has not been replaced.",
        );
      }
    };
  });
  return loading;
}

export function updatePreview(
  change: (current: PreviewData) => PreviewData,
): Promise<void> {
  publish({ ...snapshot, pending: snapshot.pending + 1 });
  const operation = queue.then(
    () =>
      new Promise<void>((resolve, reject) => {
        if (writeBlocked || !database || snapshot.status !== "ready") {
          reject(
            new Error(
              writeBlocked ?? snapshot.error ?? "Device storage is not ready.",
            ),
          );
          return;
        }
        const expected = snapshot.data.revision;
        let next: PreviewData;
        try {
          next = validate(
            { ...change(snapshot.data), version: 1, revision: expected + 1 },
            snapshot.data,
          );
        } catch (error) {
          reject(error);
          return;
        }
        let tx: IDBTransaction;
        let nextFingerprint: string;
        try {
          nextFingerprint = JSON.stringify(next);
          tx = database.transaction("state", "readwrite");
          const store = tx.objectStore("state");
          let failure: string | null = null;
          const read = store.get("preview");
          read.onsuccess = () => {
            try {
              const actualFingerprint =
                read.result === undefined ? null : JSON.stringify(read.result);
              if (
                (read.result?.revision ?? 0) !== expected ||
                actualFingerprint !== persistedFingerprint
              ) {
                writeBlocked =
                  "Another tab changed this preview. Nothing was overwritten. Copy any unsaved input before reloading.";
                failure = writeBlocked;
                tx.abort();
                return;
              }
              store.put(next, "preview");
            } catch {
              failure =
                "The change could not be saved on this device. Previously saved history is unchanged. Keep this page open and retry.";
              tx.abort();
            }
          };
          tx.oncomplete = () => {
            persistedFingerprint = nextFingerprint;
            publish({ ...snapshot, data: next, error: null });
            resolve();
          };
          tx.onabort = () =>
            reject(
              new Error(
                failure ??
                  "The change was not saved. Previously saved history is unchanged. Keep this page open and retry.",
              ),
            );
          tx.onerror = () => {
            /* The abort event reports the complete transaction failure. */
          };
        } catch {
          reject(
            new Error(
              "Device storage could not save this change. Previously saved history is unchanged. Keep this page open and retry.",
            ),
          );
        }
      }),
  );
  const reported = operation.catch((error) => {
    publish({
      ...snapshot,
      error:
        error instanceof Error
          ? error.message
          : "This change was not saved. Keep this page open to recover your input.",
    });
    throw error;
  });
  queue = reported.catch(() => undefined);
  return reported.finally(() =>
    publish({ ...snapshot, pending: Math.max(0, snapshot.pending - 1) }),
  );
}

export async function downloadBackup() {
  if (!database) throw new Error("Device storage is not available.");
  const raw = await new Promise<unknown>((resolve, reject) => {
    const request = database!
      .transaction("state", "readonly")
      .objectStore("state")
      .get("preview");
    request.onsuccess = () => resolve(request.result ?? EMPTY);
    request.onerror = () =>
      reject(new Error("The stored copy could not be read."));
  });
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(raw, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `scrabble-preview-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
