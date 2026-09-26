import type { GymIdentity, GymWrite } from "./gym-history-contract";
export interface PendingGymEvent {
  key: string;
  owner: GymIdentity;
  data: GymWrite;
}
const ownerKey = (o: GymIdentity) =>
  JSON.stringify([o.familyId, o.userId, o.playerId]);
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("amberly-gym-outbox", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("events", { keyPath: "key" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(
        new Error("Close another Gym tab to finish opening practice storage."),
      );
  });
}
async function run<T>(
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("events", mode);
    const req = work(tx.objectStore("events"));
    let value: T;
    req.onsuccess = () => {
      value = req.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(
        tx.error ??
          req.error ??
          new Error("Could not store practice on this device."),
      );
    };
  });
}
export async function queueGymEvent(owner: GymIdentity, data: GymWrite) {
  const key = ownerKey(owner) + ":" + data.event.id;
  await run("readwrite", (s) =>
    s.add({ key, owner, data } satisfies PendingGymEvent),
  );
}
export async function pendingGymEvents(owner: GymIdentity) {
  const prefix = ownerKey(owner) + ":";
  const rows = (await run("readonly", (s) =>
    s.getAll(IDBKeyRange.bound(prefix, prefix + "\uffff")),
  )) as PendingGymEvent[];
  return rows
    .filter((r) => ownerKey(r.owner) === ownerKey(owner))
    .sort(
      (a, b) =>
        a.data.sessionId.localeCompare(b.data.sessionId) ||
        a.data.event.sequence - b.data.event.sequence,
    );
}
export async function acknowledgeGymEvent(key: string) {
  await run("readwrite", (s) => s.delete(key));
}
