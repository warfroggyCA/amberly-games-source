/** Presentation only: canonical seats, coordinates, and play order never change. */
export function boardPerspective(
  players: readonly { id: string; seat: number }[],
  viewerPlayerId?: string | null,
) {
  const viewer = players.find((player) => player.id === viewerPlayerId);
  return viewer ? (2 - viewer.seat + 4) % 4 : 0;
}

export function displayedSeat(seat: number, quarterTurns: number) {
  return (seat + quarterTurns) % 4;
}

export function boardDirectionArrow(
  direction: "across" | "down",
  quarterTurns: number,
) {
  return ["→", "↓", "←", "↑"][
    ((direction === "down" ? 1 : 0) + quarterTurns) % 4
  ];
}

/** Convert a visual arrow key into a canonical coordinate step. */
export function boardArrowStep(key: string, quarterTurns: number) {
  let row = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
  let col = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  for (let turn = 0; turn < quarterTurns; turn++) [row, col] = [-col, row];
  return { row, col };
}
