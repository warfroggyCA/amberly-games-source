type DirectionPreference = "auto" | "across" | "down";
const key = (gameId: string) => `amberly-direction:${gameId}`;
const sessionChoices = new Map<string, DirectionPreference>();

// Keep device preferences outside the draft wire/storage format so an older
// scoring tab can still read its drafts during an application update.
export function readDirectionPreference(gameId: string): DirectionPreference {
  const chosen = sessionChoices.get(gameId);
  if (chosen) return chosen;
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
  sessionChoices.set(gameId, value);
  try {
    localStorage.setItem(key(gameId), value);
  } catch {
    // Keep the choice across board revision remounts even when storage is denied.
  }
}
