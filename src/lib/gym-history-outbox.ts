import type { GymIdentity, GymWrite } from "./gym-history-contract";
import { withGymStorage } from "./gym-storage";
export interface PendingGymEvent {
  key: string;
  owner: GymIdentity;
  data: GymWrite;
}
const ownerKey = (o: GymIdentity) =>
  JSON.stringify([o.familyId, o.userId, o.playerId]);
const storage = {
  name: "amberly-gym-outbox",
  store: "events",
  blockedMessage: "Close another Gym tab to finish opening practice storage.",
};
async function run<T>(
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return withGymStorage(
    storage,
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("events", mode);
        const req = work(tx.objectStore("events"));
        let value: T;
        req.onsuccess = () => {
          value = req.result;
        };
        tx.oncomplete = () => {
          resolve(value);
        };
        tx.onerror = tx.onabort = () => {
          reject(
            tx.error ??
              req.error ??
              new Error("Could not store practice on this device."),
          );
        };
      }),
  );
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
