interface GymStorage {
  name: string;
  store: string;
  blockedMessage: string;
}

function openGymStorage(storage: GymStorage): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest | undefined;
    const abortUpgrade = () => {
      try {
        request?.transaction?.abort();
      } catch {
        // The upgrade may already have finished; a late success closes it below.
      }
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortUpgrade();
      reject(error);
    };
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            "Practice storage did not respond. Keep this page open to preserve unsaved practice.",
          ),
        ),
      15_000,
    );
    try {
      const opening = indexedDB.open(storage.name, 1);
      request = opening;
      opening.onupgradeneeded = () => {
        if (settled) {
          abortUpgrade();
          return;
        }
        try {
          opening.result.createObjectStore(storage.store, { keyPath: "key" });
        } catch (error) {
          fail(error);
        }
      };
      opening.onsuccess = () => {
        const db = opening.result;
        if (settled) {
          db.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        db.onversionchange = () => db.close();
        resolve(db);
      };
      opening.onerror = () =>
        fail(
          opening.error ??
            new Error("Practice storage is unavailable. Keep this page open."),
        );
      opening.onblocked = () => fail(new Error(storage.blockedMessage));
    } catch (error) {
      fail(error);
    }
  });
}

/** Bound opening only; callers still wait for their transaction to commit. */
export async function withGymStorage<T>(
  storage: GymStorage,
  work: (db: IDBDatabase) => Promise<T>,
): Promise<T> {
  const db = await openGymStorage(storage);
  try {
    return await work(db);
  } finally {
    db.close();
  }
}
