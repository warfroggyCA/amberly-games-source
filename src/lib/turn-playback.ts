import type { GameTurn } from "../domain/game";
import type { SpectatorState } from "./shared-contract";
import { newlyObservedPlay } from "./spectator-plays";

export type PlaybackGame = Pick<
  SpectatorState,
  | "id"
  | "turns"
  | "status"
  | "board"
  | "players"
  | "scores"
  | "currentPlayerId"
  | "result"
>;

/** Only committed, still-present tiles can take part in a visual replay. */
export function playableArrival(
  previous: PlaybackGame,
  next: PlaybackGame,
  seen: ReadonlySet<string>,
): GameTurn | null {
  const turn = newlyObservedPlay(previous, next);
  if (
    !turn ||
    seen.has(turn.id) ||
    next.status !== "active" ||
    !next.players.some((p) => p.id === turn.playerId) ||
    !turn.placements.length ||
    turn.placements.length > 7
  )
    return null;
  const cells = new Set<string>();
  for (const { row, col, tile } of turn.placements) {
    const key = `${row}:${col}`;
    const actual = next.board[row]?.[col];
    if (
      cells.has(key) ||
      !actual ||
      actual.letter !== tile.letter ||
      actual.blank !== tile.blank
    )
      return null;
    cells.add(key);
  }
  return turn;
}

export function scoresBeforeArrival(
  game: PlaybackGame,
  turn: GameTurn,
): Record<string, number> {
  return {
    ...game.scores,
    [turn.playerId]: game.scores[turn.playerId] - turn.score,
  };
}

export type Rectangle = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type Point = { x: number; y: number };

/** Use the actual rendered seat, including compact mobile seat arrangements. */
export function tileLaunchPoint(seat: Rectangle, board: Rectangle): Point {
  const center = {
    x: seat.left + seat.width / 2,
    y: seat.top + seat.height / 2,
  };
  const dx = board.left + board.width / 2 - center.x;
  const dy = board.top + board.height / 2 - center.y;
  const scale = Math.min(
    Math.abs(dx) > 0 ? seat.width / 2 / Math.abs(dx) : Infinity,
    Math.abs(dy) > 0 ? seat.height / 2 / Math.abs(dy) : Infinity,
  );
  if (!Number.isFinite(scale)) return center;
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/** All tiles begin at the same world point; only their paths and landings differ. */
export function tumbleFrames(
  origin: Point,
  destination: Rectangle,
  index: number,
): Keyframe[] {
  const size = destination.width;
  const x = (origin.x - destination.left - size / 2) / size;
  const y = (origin.y - destination.top - destination.height / 2) / size;
  const direction = [-1, 1, -1, 1, 1, -1, 1][index % 7];
  const pose = (
    px: number,
    py: number,
    z: number,
    pitch: number,
    yaw: number,
    roll: number,
    scale = 1,
  ) =>
    `translate(${px * size}px, ${py * size}px) perspective(${size * 8}px) translateZ(${z * size}px) rotateX(${pitch}deg) rotateY(${yaw}deg) rotateZ(${roll}deg) scale(${scale})`;
  return [
    { transform: pose(x, y, 0.45, -235, 45, -125, 0.88), offset: 0 },
    {
      transform: pose(
        x * 0.72,
        y * 0.72 - 1.5,
        0.75,
        -155,
        direction * -30,
        direction * 75,
        0.94,
      ),
      offset: 0.23,
    },
    {
      transform: pose(
        x * 0.28,
        y * 0.28 - 0.7,
        0.3,
        -58,
        direction * 18,
        direction * 24,
      ),
      offset: 0.49,
    },
    {
      transform: pose(0, 0.025, 0, 7, direction * -3, direction * -5, 0.99),
      offset: 0.72,
    },
    {
      transform: pose(
        direction * 0.035,
        -0.14,
        0.07,
        -15,
        direction * 4,
        direction * 3,
      ),
      offset: 0.84,
    },
    { transform: pose(0, 0, 0, 3, direction, direction * -1), offset: 0.94 },
    { transform: pose(0, 0, 0, 0, 0, 0), offset: 1 },
  ];
}
