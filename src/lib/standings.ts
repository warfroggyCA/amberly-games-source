export type Standing = {
  playerId: string;
  gameType: "scrabble" | "crokinole";
  played: number;
  wins: number;
  ties: number;
};
export function isStandings(value: unknown): value is Standing[] {
  return (
    Array.isArray(value) &&
    value.every(
      (r) =>
        r &&
        typeof r === "object" &&
        typeof r.playerId === "string" &&
        ["scrabble", "crokinole"].includes(r.gameType) &&
        [r.played, r.wins, r.ties].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ) &&
        r.wins + r.ties <= r.played,
    )
  );
}
