const LEGACY = "amberly-game-sounds";
const MIGRATION = "amberly-game-sounds:per-game-migration";
export const gameSoundPreferenceKey = (gameId: string) =>
  `amberly-game-sounds:game:${gameId}`;
type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Freeze the legacy preference at upgrade; never carry a later game's mute forward. */
export function initializeGameSoundPreferences(
  storage: StorageLike,
  now = Date.now(),
) {
  try {
    if (!storage.getItem(MIGRATION))
      storage.setItem(
        MIGRATION,
        JSON.stringify({
          before: now,
          muted: storage.getItem(LEGACY) === "off",
        }),
      );
  } catch {
    /* In-memory preferences still work when storage is unavailable. */
  }
}
export function readGameSoundPreference(
  storage: StorageLike,
  gameId: string,
  createdAt?: string,
): boolean {
  try {
    initializeGameSoundPreferences(storage);
    const saved = storage.getItem(gameSoundPreferenceKey(gameId));
    if (saved === "on" || saved === "off") return saved === "on";
    const migration = JSON.parse(storage.getItem(MIGRATION) ?? "null");
    const created = createdAt ? Date.parse(createdAt) : NaN;
    // Guest projections without dates can preserve the first currently open game;
    // subsequent unidentified games start fresh rather than inheriting global mute forever.
    const existing = Number.isFinite(created)
      ? created <= migration?.before
      : !migration?.unknownGameId || migration.unknownGameId === gameId;
    const on = !(migration?.muted === true && existing);
    if (!Number.isFinite(created) && migration && !migration.unknownGameId)
      storage.setItem(
        MIGRATION,
        JSON.stringify({ ...migration, unknownGameId: gameId }),
      );
    storage.setItem(gameSoundPreferenceKey(gameId), on ? "on" : "off");
    return on;
  } catch {
    return true;
  }
}
export function saveGameSoundPreference(
  storage: StorageLike,
  gameId: string,
  on: boolean,
) {
  try {
    storage.setItem(gameSoundPreferenceKey(gameId), on ? "on" : "off");
  } catch {
    /* Keep the in-memory decision. */
  }
}
