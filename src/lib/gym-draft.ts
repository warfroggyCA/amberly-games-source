import { isBoard, isCoordinate, isLetter } from "../domain/board";
import type { Puzzle } from "../domain/gym/model";
import type { Draft } from "../domain/gym/placement";
import type { GymIdentity } from "./gym-history-contract";
export interface GymDraft {
  version: 1;
  puzzle: Puzzle;
  draft: Draft;
  undo: Draft[];
  referenceWords: string[];
  hint: number;
  pointToHint: boolean;
  reveal: boolean;
  solutionIndex: number;
  help: boolean;
  reducedMotion: boolean;
  liveCoaching: boolean;
  petPaused: boolean;
}
export const gymDraftKey = (owner?: GymIdentity) =>
  owner
    ? JSON.stringify([owner.familyId, owner.userId, owner.playerId])
    : "local";
export function validGymDraft(value: unknown): value is GymDraft {
  try {
    const v = value as GymDraft;
    if (
      !v ||
      v.version !== 1 ||
      !isBoard(v.puzzle.position.board) ||
      !Array.isArray(v.puzzle.position.rack) ||
      v.puzzle.position.rack.length !== 7 ||
      !v.puzzle.position.rack.every((t) => t === "?" || isLetter(t))
    )
      return false;
    const square = (p: Draft["cursor"]) =>
      p === null || (!!p && isCoordinate(p.row) && isCoordinate(p.col));
    const draft = (d: Draft) =>
      !!d &&
      Array.isArray(d.order) &&
      d.order.length === 7 &&
      new Set(d.order).size === 7 &&
      d.order.every((id) => Number.isInteger(id) && id >= 0 && id < 7) &&
      ["across", "down"].includes(d.direction) &&
      square(d.start) &&
      square(d.cursor) &&
      (d.manualDirection === undefined ||
        typeof d.manualDirection === "boolean") &&
      Array.isArray(d.tiles) &&
      d.tiles.length <= 7 &&
      new Set(d.tiles.map((t) => t.id)).size === d.tiles.length &&
      new Set(d.tiles.map((t) => `${t.row}:${t.col}`)).size ===
        d.tiles.length &&
      d.tiles.every(
        (t) =>
          Number.isInteger(t.id) &&
          t.id >= 0 &&
          t.id < 7 &&
          square(t) &&
          !v.puzzle.position.board[t.row][t.col] &&
          isLetter(t.tile.letter) &&
          (v.puzzle.position.rack[t.id] === "?"
            ? t.tile.blank === true
            : !t.tile.blank && t.tile.letter === v.puzzle.position.rack[t.id]),
      );
    return (
      draft(v.draft) &&
      Array.isArray(v.undo) &&
      v.undo.length <= 100 &&
      v.undo.every(draft) &&
      Array.isArray(v.referenceWords) &&
      v.referenceWords.length <= 10000 &&
      v.referenceWords.every(
        (w) => typeof w === "string" && /^[A-Z]{2,15}$/.test(w),
      ) &&
      new Set(v.referenceWords).size === v.referenceWords.length &&
      Number.isInteger(v.hint) &&
      v.hint >= 0 &&
      v.hint <= 3 &&
      Number.isInteger(v.solutionIndex) &&
      v.solutionIndex >= 0 &&
      v.solutionIndex <= 2 &&
      [
        v.pointToHint,
        v.reveal,
        v.help,
        v.reducedMotion,
        v.liveCoaching,
        v.petPaused,
      ].every((b) => typeof b === "boolean")
    );
  } catch {
    return false;
  }
}
export interface StoredGymDraft {
  key: string;
  revision: number;
  value: GymDraft;
}
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("amberly-gym-drafts", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("drafts", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Close other Gym tabs to enable draft recovery."));
  });
}
export async function readGymDraft(
  key: string,
): Promise<StoredGymDraft | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", "readonly");
    const req = tx.objectStore("drafts").get(key);
    tx.oncomplete = () => {
      db.close();
      resolve(req.result ?? null);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
/** Compare and write in one transaction: another tab cannot silently overwrite this draft. */
export async function writeGymDraft(
  key: string,
  revision: number,
  value: GymDraft,
): Promise<number> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", "readwrite"),
      store = tx.objectStore("drafts");
    let conflict = false;
    const req = store.get(key);
    req.onsuccess = () => {
      if ((req.result?.revision ?? 0) !== revision) {
        conflict = true;
        tx.abort();
        return;
      }
      store.put({ key, revision: revision + 1, value });
    };
    tx.oncomplete = () => {
      db.close();
      resolve(revision + 1);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(
        new Error(
          conflict
            ? "Another tab updated this practice. Your changes are still on screen; reload to use the saved draft."
            : "Practice could not be saved on this device. Keep this page open.",
        ),
      );
    };
  });
}
