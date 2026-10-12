const KEY = "amberly.word-buddy-sharing-holds.v1";
/** Only game/account identifiers are stored. Private words and tiles never are. */
export function readWordBuddyHolds(): string[] | null {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter(
          (x): x is string => typeof x === "string" && x.length < 300,
        )
      : null;
  } catch {
    return null;
  }
}
export function writeWordBuddyHold(scope: string, held: boolean): string[] {
  const current = readWordBuddyHolds();
  if (current === null) throw new Error("Recovery storage unavailable");
  const next = current.filter((x) => x !== scope);
  if (held) next.push(scope);
  // Fail before entering testing if the recovery marker cannot be retained.
  sessionStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
