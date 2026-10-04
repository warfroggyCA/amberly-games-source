type DirectionPreference = "auto" | "across" | "down";
const key = (gameId: string) => `amberly-direction:${gameId}`;

// Keep device preferences outside the draft wire/storage format so an older
// scoring tab can still read its drafts during an application update.
export function readDirectionPreference(gameId: string): DirectionPreference {
  try {
    const value = localStorage.getItem(key(gameId));
    return value === "across" || value === "down" ? value : "auto";
  } catch {
    return "auto";
  }
}

export function saveDirectionPreference(
  gameId: string,
  value: DirectionPreference,
) {
  try {
    localStorage.setItem(key(gameId), value);
  } catch {
    // The board keeps the in-session choice if local storage is unavailable.
  }
}
