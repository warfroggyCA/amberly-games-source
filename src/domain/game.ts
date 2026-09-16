import {
  createBoard,
  LETTER_COUNTS,
  LETTER_VALUES,
  MAX_TILE_TOTAL,
  type TileSupply,
} from "./board";
import {
  isTileSetSnapshot,
  standardSupply,
  tileTotal,
  type TileSetSnapshot,
} from "./equipment";
import { scoreMove } from "./scoring";
import {
  extendLexicon,
  isVerifiedWord,
  MAX_VERIFIED_WORDS,
  MAX_VERIFICATIONS_PER_COMMAND,
  type VerifiedWord,
} from "./verified-words";
import type { Board, Lexicon, Placement } from "./types";

export const GAME_VERSION = "family-v1.0.0";
export const MAX_GAME_EVENTS = 5000;
export type Player = { id: string; name: string; seat: 0 | 1 | 2 | 3 };
export type PhysicalTile = keyof typeof LETTER_COUNTS;
export type Racks = Record<string, PhysicalTile[]>;
export type GameWord = {
  word: string;
  score: number;
  row: number;
  col: number;
  direction: "across" | "down";
};
export type GameTurn = {
  id: string;
  number: number;
  round: number;
  type: "play" | "pass" | "exchange";
  playerId: string;
  score: number;
  words: GameWord[];
  source: "human" | "assisted";
  placements: Placement[];
  bingo: boolean;
  newTileCount: number;
  runningScores: Record<string, number>;
  exchangeCount?: number;
};
export type CreateGameInput = {
  tileSet?: TileSetSnapshot;
  id: string;
  players: Player[];
  firstPlayerId: string;
  direction: "clockwise" | "counterclockwise";
  lexicon: Pick<Lexicon, "id" | "edition" | "status">;
  createdAt?: string;
};
type CommandBase = { id: string; expectedRevision: number };
export type GameCommand = CommandBase &
  (
    | { type: "play"; placements: Placement[] }
    | { type: "pass" }
    | { type: "exchange"; count: number }
    | { type: "pause" | "resume" }
    | { type: "undo"; reason: string }
    | { type: "assist"; racks: Racks }
    | { type: "verify-words"; words: VerifiedWord[] }
    | {
        type: "extend-supply";
        additions: Record<string, number>;
        reason: string;
        recordedBy: string;
        recordedAt: string;
      }
    | {
        type: "reconcile";
        rackCounts: Record<string, number>;
        bagCount: number;
        reason: string;
        /** Local scorer label only; this is not an authenticated identity. */
        recordedBy: string;
        recordedAt: string;
      }
    | { type: "assisted-pass"; solverVersion: string }
    | {
        type: "finalize";
        reason: "natural" | "blocked" | "early" | "assisted";
        racks: Racks;
      }
  );
export type FinalResult = {
  reason: "natural" | "blocked" | "early" | "assisted";
  assisted: boolean;
  assistedTermination?: "rack-out" | "blocked" | "early";
  scores: Record<string, number>;
  scoresBeforeAdjustments: Record<string, number>;
  adjustments: Record<
    string,
    { deduction: number; transfer: number; finalScore: number }
  >;
  racks: Racks;
  actualBagCount: number;
  winnerIds: string[];
  unequalTurns: boolean;
  competitiveEligible: boolean;
  revision: number;
};
export type Assistance = {
  startedAtRevision: number;
  humanTurnIds: string[];
  humanScores: Record<string, number>;
  initialRacks: Racks;
  racks: Racks;
  bagCountAtStart: number;
};
export type GameEvent = {
  sequence: number;
  command: GameCommand;
  fingerprint: string;
  turn?: GameTurn;
  undoneTurnId?: string;
  result?: FinalResult;
};
export type GameState = {
  /** Absent on original standard games, preserving old journal snapshots. */
  tileSupply?: TileSupply;
  /** Publisher confirmations are additive journal evidence, never a change to the original definition. */
  verifiedWords?: VerifiedWord[];
  version: typeof GAME_VERSION;
  definition: CreateGameInput & { createdAt: string };
  id: string;
  players: Player[];
  order: string[];
  currentPlayerId: string;
  direction: "clockwise" | "counterclockwise";
  mode: "solo" | "multiplayer";
  lexicon: Pick<Lexicon, "id" | "edition" | "status">;
  board: Board;
  scores: Record<string, number>;
  turns: GameTurn[];
  events: GameEvent[];
  revision: number;
  status: "active" | "paused" | "finalized";
  expectedRackCounts: Record<string, number>;
  expectedBagCount: number;
  consecutivePasses: number;
  pendingEnd: "natural" | "blocked" | "assisted" | null;
  assistance: Assistance | null;
  result: FinalResult | null;
};
export type GameError = { code: string; message: string };
export type GameResult =
  | { ok: true; game: GameState; replayed?: boolean; acceptedRevision?: number }
  | { ok: false; error: GameError };
/** Supply only from a trusted solver adapter. A failed/incomplete search must not return false. */
export type CommandContext = {
  hasLegalMove?: (
    board: Board,
    rack: PhysicalTile[],
    lexicon: Lexicon,
    tileSupply?: TileSupply,
    verifiedWords?: readonly VerifiedWord[],
  ) => boolean;
};

export function getTileSupply(game: GameState): TileSupply {
  return game.tileSupply ?? LETTER_COUNTS;
}
export function getTileTotal(game: GameState): number {
  return Object.values(getTileSupply(game)).reduce(
    (sum, count) => sum + count,
    0,
  );
}
export function hasCustomTileSupply(game: GameState): boolean {
  return (
    game.tileSupply !== undefined ||
    game.events.some((event) => event.command.type === "extend-supply")
  );
}
export function hasVerifiedWords(game: GameState): boolean {
  return (
    !!game.verifiedWords?.length ||
    game.events.some((event) => event.command.type === "verify-words")
  );
}
const fail = (code: string, message: string): GameResult => ({
  ok: false,
  error: { code, message },
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const safeId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(value) &&
  !["__proto__", "prototype", "constructor"].includes(value);
/** JSON arrays must have every own index and no extra properties or accessors. */
function isDenseArray(value: unknown): value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return false;
  }
  return true;
}
const copy = <T>(value: T): T => structuredClone(value);
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** Stable JSON fingerprint: key ordering does not change retry identity. */
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (!isDenseArray(value))
      throw new Error("Sparse or non-JSON arrays are not supported.");
    return `[${value.map(canonical).join(",")}]`;
  }
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    const keys = Object.keys(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Reflect.ownKeys(value).length !== keys.length ||
      keys.some(
        (key) =>
          !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"),
      )
    ) {
      throw new Error("Only plain JSON objects are supported.");
    }
    return `{${keys
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("Payload must contain only JSON values.");
}
function orderPlayers(input: CreateGameInput): string[] {
  const sorted = [...input.players].sort((a, b) =>
    input.direction === "clockwise" ? a.seat - b.seat : b.seat - a.seat,
  );
  const first = sorted.findIndex((player) => player.id === input.firstPlayerId);
  return [...sorted.slice(first), ...sorted.slice(0, first)].map(
    (player) => player.id,
  );
}
function baseGame(
  definition: CreateGameInput & { createdAt: string },
): GameState {
  const order = orderPlayers(definition);
  return {
    ...(definition.tileSet && !standardSupply(definition.tileSet.counts)
      ? { tileSupply: copy(definition.tileSet.counts) }
      : {}),
    version: GAME_VERSION,
    definition: copy(definition),
    id: definition.id,
    players: copy(definition.players),
    order,
    currentPlayerId: order[0],
    direction: definition.direction,
    mode: definition.players.length === 1 ? "solo" : "multiplayer",
    lexicon: copy(definition.lexicon),
    board: createBoard(),
    scores: Object.fromEntries(order.map((id) => [id, 0])),
    turns: [],
    events: [],
    revision: 0,
    status: "active",
    expectedRackCounts: Object.fromEntries(order.map((id) => [id, 7])),
    expectedBagCount:
      (definition.tileSet ? tileTotal(definition.tileSet.counts) : 100) -
      order.length * 7,
    consecutivePasses: 0,
    pendingEnd: null,
    assistance: null,
    result: null,
  };
}
export function createGame(input: CreateGameInput): GameResult {
  try {
    return createValidatedGame(input);
  } catch {
    return fail(
      "INVALID_SETUP",
      "The game setup must contain valid player and word-reference data.",
    );
  }
}
function createValidatedGame(input: CreateGameInput): GameResult {
  if (
    !isRecord(input) ||
    !safeId(input.id) ||
    !Array.isArray(input.players) ||
    input.players.length < 1 ||
    input.players.length > 4 ||
    !isDenseArray(input.players)
  )
    return fail(
      "INVALID_SETUP",
      "Choose one to four players and a valid game ID.",
    );
  if (
    input.players.some(
      (player) =>
        !isRecord(player) ||
        !safeId(player.id) ||
        typeof player.name !== "string" ||
        !player.name.trim() ||
        player.name.trim().length > 60 ||
        /[\u0000-\u001f\u007f]/.test(player.name) ||
        !Number.isInteger(player.seat) ||
        player.seat < 0 ||
        player.seat > 3,
    )
  ) {
    return fail(
      "INVALID_PLAYER",
      "Each player needs a valid ID, name, and seat from 0 to 3.",
    );
  }
  if (
    new Set(input.players.map((player) => player.id)).size !==
      input.players.length ||
    new Set(input.players.map((player) => player.seat)).size !==
      input.players.length
  ) {
    return fail(
      "DUPLICATE_PLAYER_OR_SEAT",
      "Each player and seat can appear only once.",
    );
  }
  if (
    !input.players.some((player) => player.id === input.firstPlayerId) ||
    !["clockwise", "counterclockwise"].includes(input.direction)
  )
    return fail(
      "INVALID_ORDER",
      "Choose a participating first player and a play direction.",
    );
  if (
    !isRecord(input.lexicon) ||
    !safeId(input.lexicon.id) ||
    typeof input.lexicon.edition !== "string" ||
    !input.lexicon.edition.trim() ||
    input.lexicon.edition.length > 100 ||
    !["ready", "unavailable", "test"].includes(input.lexicon.status)
  )
    return fail("INVALID_LEXICON", "A versioned word reference is required.");
  if (input.lexicon.status === "unavailable")
    return fail(
      "LEXICON_UNAVAILABLE",
      "The selected word reference is unavailable. A game cannot start with unverified words.",
    );
  if (
    input.tileSet !== undefined &&
    (!isTileSetSnapshot(input.tileSet) ||
      tileTotal(input.tileSet.counts) < input.players.length * 7)
  )
    return fail(
      "INVALID_TILE_SET",
      "Choose a valid tile set with at least seven tiles for each player.",
    );
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt)))
    return fail("INVALID_DATE", "The game start date is invalid.");
  const definition = {
    ...(input.tileSet ? { tileSet: copy(input.tileSet) } : {}),
    id: input.id,
    players: input.players.map((player) => ({
      id: player.id,
      name: player.name.trim(),
      seat: player.seat,
    })),
    firstPlayerId: input.firstPlayerId,
    direction: input.direction,
    lexicon: {
      id: input.lexicon.id,
      edition: input.lexicon.edition,
      status: input.lexicon.status,
    },
    createdAt,
  };
  return { ok: true, game: freeze(baseGame(definition)) };
}
function applyTurnProjection(game: GameState, turn: GameTurn): void {
  game.turns.push(copy(turn));
  if (turn.type === "play") {
    const board = game.board.map((row) => [...row]);
    for (const placement of turn.placements)
      board[placement.row][placement.col] = copy(placement.tile);
    game.board = board;
    game.scores[turn.playerId] += turn.score;
    if (game.assistance) {
      const rack = game.assistance.racks[turn.playerId];
      for (const placement of turn.placements) {
        const physical = placement.tile.blank ? "?" : placement.tile.letter;
        rack.splice(rack.indexOf(physical), 1);
      }
      game.expectedRackCounts[turn.playerId] = rack.length;
    } else {
      const afterPlay =
        game.expectedRackCounts[turn.playerId] - turn.newTileCount;
      const drawn = Math.min(7 - afterPlay, game.expectedBagCount);
      game.expectedRackCounts[turn.playerId] = afterPlay + drawn;
      game.expectedBagCount -= drawn;
    }
    game.consecutivePasses = 0;
  } else if (turn.type === "pass") {
    game.consecutivePasses += 1;
  } else {
    game.consecutivePasses = 0;
  }
  game.currentPlayerId = game.order[game.turns.length % game.order.length];
  refreshPendingEnd(game);
}
function refreshPendingEnd(game: GameState): void {
  const last = game.turns.at(-1);
  game.pendingEnd = null;
  if (game.assistance) {
    if (
      Object.values(game.expectedRackCounts).some((count) => count === 0) ||
      game.consecutivePasses >= game.order.length
    )
      game.pendingEnd = "assisted";
  } else if (
    last?.type === "play" &&
    game.expectedBagCount === 0 &&
    game.expectedRackCounts[last.playerId] === 0
  ) {
    game.pendingEnd = "natural";
  } else if (game.consecutivePasses >= game.order.length * 2) {
    game.pendingEnd = "blocked";
  }
}
/** Only validated events enter this projector. Originals remain in events; undo changes the effective view. */
function project(
  definition: GameState["definition"],
  events: GameEvent[],
): GameState {
  const game = baseGame(definition);
  const undone = new Set(
    events.map((event) => event.undoneTurnId).filter(Boolean),
  );
  for (const event of events) {
    if (event.turn && !undone.has(event.turn.id))
      applyTurnProjection(game, event.turn);
    if (event.command.type === "pause") game.status = "paused";
    if (event.command.type === "resume") game.status = "active";
    if (event.command.type === "verify-words") {
      game.verifiedWords = [
        ...(game.verifiedWords ?? []),
        ...copy(event.command.words),
      ];
    }
    if (event.command.type === "extend-supply") {
      const supply = { ...getTileSupply(game) };
      for (const [letter, count] of Object.entries(event.command.additions)) {
        supply[letter as PhysicalTile] += count;
        game.expectedBagCount += count;
      }
      game.tileSupply = supply;
      refreshPendingEnd(game);
    }
    if (event.command.type === "reconcile") {
      game.expectedRackCounts = copy(event.command.rackCounts);
      game.expectedBagCount = event.command.bagCount;
      refreshPendingEnd(game);
    }
    if (event.command.type === "assist") {
      const racks = copy(event.command.racks);
      const bagCount =
        getTileTotal(game) -
        game.board.flat().filter(Boolean).length -
        Object.values(racks).reduce((sum, rack) => sum + rack.length, 0);
      game.assistance = {
        startedAtRevision: event.sequence,
        humanTurnIds: game.turns.map((turn) => turn.id),
        humanScores: { ...game.scores },
        initialRacks: copy(racks),
        racks,
        bagCountAtStart: bagCount,
      };
      game.expectedRackCounts = Object.fromEntries(
        game.order.map((id) => [id, racks[id].length]),
      );
      game.expectedBagCount = bagCount;
      game.consecutivePasses = 0;
      game.pendingEnd = Object.values(racks).some((rack) => rack.length === 0)
        ? "assisted"
        : null;
    }
    if (event.result) {
      game.result = copy(event.result);
      game.status = "finalized";
    }
  }
  game.events = copy(events);
  game.revision = events.length;
  return game;
}
function checkRacks(
  game: GameState,
  racks: unknown,
):
  | { ok: true; racks: Racks; bagCount: number }
  | { ok: false; error: GameError } {
  if (
    !isRecord(racks) ||
    Object.keys(racks).length !== game.order.length ||
    Object.keys(racks).some((id) => !game.order.includes(id))
  )
    return {
      ok: false,
      error: {
        code: "INVALID_RACKS",
        message: "Enter a rack for every participant, including an empty rack.",
      },
    };
  const used = Object.fromEntries(
    Object.keys(LETTER_COUNTS).map((letter) => [letter, 0]),
  );
  for (const tile of game.board.flat())
    if (tile) used[tile.blank ? "?" : tile.letter] += 1;
  for (const id of game.order) {
    const rack = racks[id];
    if (
      !Array.isArray(rack) ||
      rack.length > 7 ||
      !isDenseArray(rack) ||
      rack.some(
        (tile) =>
          typeof tile !== "string" || !Object.hasOwn(LETTER_COUNTS, tile),
      )
    ) {
      return {
        ok: false,
        error: {
          code: "INVALID_RACK",
          message:
            "Racks contain at most seven uppercase letters or ? for a blank.",
        },
      };
    }
    if (rack.length !== game.expectedRackCounts[id])
      return {
        ok: false,
        error: {
          code: "RACK_COUNT_MISMATCH",
          message: `${game.players.find((player) => player.id === id)?.name}: expected ${game.expectedRackCounts[id]} tiles but entered ${rack.length}. Reconcile physical draws before confirming.`,
        },
      };
    for (const tile of rack as PhysicalTile[]) used[tile] += 1;
    if (
      game.assistance &&
      canonical([...rack].sort()) !==
        canonical([...game.assistance.racks[id]].sort())
    ) {
      return {
        ok: false,
        error: {
          code: "ASSISTED_RACK_MISMATCH",
          message:
            "Remaining assisted racks must match the tiles recorded at assistance start minus subsequent plays.",
        },
      };
    }
  }
  for (const [tile, quantity] of Object.entries(getTileSupply(game))) {
    if (used[tile] > quantity)
      return {
        ok: false,
        error: {
          code: "IMPOSSIBLE_INVENTORY",
          message: `The board and racks contain ${used[tile]} ${tile} tiles; the set contains ${quantity}.`,
        },
      };
  }
  const validated = racks as Racks;
  return {
    ok: true,
    racks: copy(validated),
    bagCount:
      getTileTotal(game) -
      game.board.flat().filter(Boolean).length -
      Object.values(validated).reduce((sum, rack) => sum + rack.length, 0),
  };
}
function makeTurn(
  game: GameState,
  command: GameCommand,
  fields: Partial<GameTurn>,
): GameTurn {
  const score = fields.score ?? 0;
  return {
    id: command.id,
    number: game.turns.length + 1,
    round: Math.floor(game.turns.length / game.order.length) + 1,
    type: "pass",
    playerId: game.currentPlayerId,
    score,
    words: [],
    source: game.assistance ? "assisted" : "human",
    placements: [],
    bingo: false,
    newTileCount: 0,
    ...fields,
    runningScores: {
      ...game.scores,
      [game.currentPlayerId]: game.scores[game.currentPlayerId] + score,
    },
  };
}
function makeFinalResult(
  game: GameState,
  command: Extract<GameCommand, { type: "finalize" }>,
): FinalResult | GameError {
  const checked = checkRacks(game, command.racks);
  if (!checked.ok) return checked.error;
  const { racks, bagCount } = checked;
  const last = game.turns.at(-1);
  const rackOut =
    last?.type === "play" && racks[last.playerId].length === 0
      ? last.playerId
      : null;
  if (
    command.reason === "natural" &&
    (game.assistance ||
      bagCount !== 0 ||
      !rackOut ||
      game.pendingEnd !== "natural")
  ) {
    return {
      code: "INVALID_NATURAL_END",
      message:
        "A normal rack-out requires an empty bag and a player who has just played their final tile.",
    };
  }
  if (
    command.reason === "blocked" &&
    (game.assistance || game.consecutivePasses < game.order.length * 2)
  ) {
    return {
      code: "NOT_BLOCKED",
      message:
        "A household blocked ending requires every player to pass twice consecutively.",
    };
  }
  if (
    command.reason === "assisted" &&
    (!game.assistance || game.pendingEnd !== "assisted")
  ) {
    return {
      code: "ASSISTANCE_NOT_FINISHED",
      message:
        "Assisted finishing stops at an empty rack or one complete cycle with no legal placements. Use early ending to stop sooner.",
    };
  }
  const deducted = Object.fromEntries(
    game.order.map((id) => [
      id,
      racks[id].reduce(
        (sum, tile) => sum + (tile === "?" ? 0 : LETTER_VALUES[tile]),
        0,
      ),
    ]),
  );
  const transferAllowed =
    !!rackOut &&
    bagCount === 0 &&
    (command.reason === "natural" ||
      (command.reason === "assisted" &&
        game.assistance?.bagCountAtStart === 0));
  const adjustments = Object.fromEntries(
    game.order.map((id) => {
      const transfer =
        transferAllowed && rackOut === id
          ? Object.entries(deducted).reduce(
              (sum, [otherId, value]) => sum + (otherId === id ? 0 : value),
              0,
            )
          : 0;
      return [
        id,
        {
          deduction: deducted[id],
          transfer,
          finalScore: game.scores[id] - deducted[id] + transfer,
        },
      ];
    }),
  );
  const scores = Object.fromEntries(
    game.order.map((id) => [id, adjustments[id].finalScore]),
  );
  const highest = Math.max(...Object.values(scores));
  const tied = game.order.filter((id) => scores[id] === highest);
  const before = Math.max(...tied.map((id) => game.scores[id]));
  const winnerIds =
    game.mode === "solo" ? [] : tied.filter((id) => game.scores[id] === before);
  const counts = game.order.map(
    (id) => game.turns.filter((turn) => turn.playerId === id).length,
  );
  return {
    reason: game.assistance ? "assisted" : command.reason,
    assisted: !!game.assistance,
    ...(game.assistance
      ? {
          assistedTermination:
            command.reason === "early"
              ? ("early" as const)
              : rackOut
                ? ("rack-out" as const)
                : ("blocked" as const),
        }
      : {}),
    scores,
    scoresBeforeAdjustments: { ...game.scores },
    adjustments,
    racks,
    actualBagCount: bagCount,
    winnerIds,
    unequalTurns: new Set(counts).size > 1,
    competitiveEligible:
      game.mode === "multiplayer" &&
      game.lexicon.status === "ready" &&
      !game.assistance &&
      !hasCustomTileSupply(game) &&
      !hasVerifiedWords(game) &&
      (command.reason === "natural" || command.reason === "blocked"),
    revision: game.revision + 1,
  };
}
/** Explicit ISO timestamp, with a real calendar date and a timezone; no locale-dependent parsing. */
function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(
      value,
    );
  if (!parts) return false;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    zone,
  ] = parts;
  const [year, month, day, hour, minute, second] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
  ].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    (!/^[+-]14:/.test(zone) || zone.endsWith(":00")) &&
    Number.isFinite(Date.parse(value))
  );
}
function validateReconciliation(
  game: GameState,
  command: Extract<GameCommand, { type: "reconcile" }>,
): GameError | null {
  const counts = command.rackCounts;
  if (command.bagCount > getTileTotal(game))
    return {
      code: "INVALID_COMMAND",
      message: "The bag count cannot exceed the complete physical tile supply.",
    };
  if (
    Object.keys(counts).length !== game.order.length ||
    game.order.some((id) => !Object.hasOwn(counts, id)) ||
    Object.keys(counts).some((id) => !game.order.includes(id)) ||
    Object.values(counts).some(
      (count) => !Number.isInteger(count) || count < 0 || count > 7,
    )
  ) {
    return {
      code: "INVALID_RACK_COUNTS",
      message:
        "Enter an integer tile count from zero to seven for every participant, with no extra players.",
    };
  }
  const boardCount = game.board.flat().filter(Boolean).length;
  const total =
    boardCount +
    Object.values(counts).reduce((sum, count) => sum + count, 0) +
    command.bagCount;
  if (total !== getTileTotal(game))
    return {
      code: "INVENTORY_COUNT_MISMATCH",
      message: `Board (${boardCount}), racks, and bag add up to ${total} tiles. Recount the physical tiles; the full set must contain ${getTileTotal(game)}.`,
    };
  return null;
}
function validCommand(command: unknown): command is GameCommand {
  if (
    !isRecord(command) ||
    !safeId(command.id) ||
    !Number.isSafeInteger(command.expectedRevision) ||
    (command.expectedRevision as number) < 0 ||
    typeof command.type !== "string"
  )
    return false;
  const allowed: Record<string, string[]> = {
    play: ["placements"],
    pass: [],
    exchange: ["count"],
    pause: [],
    resume: [],
    undo: ["reason"],
    assist: ["racks"],
    "verify-words": ["words"],
    reconcile: ["rackCounts", "bagCount", "reason", "recordedBy", "recordedAt"],
    "extend-supply": ["additions", "reason", "recordedBy", "recordedAt"],
    "assisted-pass": ["solverVersion"],
    finalize: ["reason", "racks"],
  };
  if (!Object.hasOwn(allowed, command.type)) return false;
  const keys = new Set([
    "id",
    "expectedRevision",
    "type",
    ...allowed[command.type],
  ]);
  if (
    Object.keys(command).some((key) => !keys.has(key)) ||
    allowed[command.type].some((key) => !Object.hasOwn(command, key))
  )
    return false;
  if (command.type === "play") {
    if (
      !Array.isArray(command.placements) ||
      command.placements.length < 1 ||
      command.placements.length > 7 ||
      !isDenseArray(command.placements)
    )
      return false;
    return command.placements.every(
      (placement) =>
        isRecord(placement) &&
        Number.isInteger(placement.row) &&
        Number.isInteger(placement.col) &&
        isRecord(placement.tile) &&
        typeof placement.tile.blank === "boolean" &&
        typeof placement.tile.letter === "string" &&
        /^[A-Z]$/.test(placement.tile.letter) &&
        Object.keys(placement).every((key) =>
          ["row", "col", "tile"].includes(key),
        ) &&
        Object.keys(placement.tile).every((key) =>
          ["letter", "blank"].includes(key),
        ),
    );
  }
  if (command.type === "verify-words")
    return (
      isDenseArray(command.words) &&
      command.words.length > 0 &&
      command.words.length <= MAX_VERIFICATIONS_PER_COMMAND &&
      command.words.every(isVerifiedWord) &&
      new Set(command.words.map((entry) => entry.word)).size ===
        command.words.length
    );
  if (command.type === "exchange")
    return (
      Number.isInteger(command.count) &&
      (command.count as number) > 0 &&
      (command.count as number) <= 7
    );
  if (command.type === "undo")
    return (
      typeof command.reason === "string" &&
      !!command.reason.trim() &&
      command.reason.length <= 500
    );
  if (command.type === "assisted-pass")
    return (
      typeof command.solverVersion === "string" &&
      !!command.solverVersion.trim() &&
      command.solverVersion.length <= 100
    );
  if (command.type === "finalize")
    return (
      ["natural", "blocked", "early", "assisted"].includes(
        command.reason as string,
      ) && isRecord(command.racks)
    );
  if (command.type === "reconcile") {
    return (
      isRecord(command.rackCounts) &&
      Number.isInteger(command.bagCount) &&
      (command.bagCount as number) >= 0 &&
      (command.bagCount as number) <= MAX_TILE_TOTAL &&
      typeof command.reason === "string" &&
      !!command.reason.trim() &&
      command.reason.length <= 200 &&
      !/[\u0000-\u001f\u007f]/.test(command.reason) &&
      typeof command.recordedBy === "string" &&
      !!command.recordedBy.trim() &&
      command.recordedBy.length <= 60 &&
      !/[\u0000-\u001f\u007f]/.test(command.recordedBy) &&
      isIsoTimestamp(command.recordedAt)
    );
  }
  if (command.type === "extend-supply")
    return (
      isRecord(command.additions) &&
      typeof command.reason === "string" &&
      !!command.reason.trim() &&
      command.reason.length <= 200 &&
      !/[\u0000-\u001f\u007f]/.test(command.reason) &&
      typeof command.recordedBy === "string" &&
      !!command.recordedBy.trim() &&
      command.recordedBy.length <= 60 &&
      !/[\u0000-\u001f\u007f]/.test(command.recordedBy) &&
      isIsoTimestamp(command.recordedAt)
    );
  if (command.type === "assist") return isRecord(command.racks);
  return true;
}
export function applyCommand(
  game: GameState,
  command: GameCommand,
  lexicon: Lexicon,
  context: CommandContext = {},
): GameResult {
  if (game.version !== GAME_VERSION)
    return fail(
      "UNSUPPORTED_VERSION",
      "This game requires its original rules engine.",
    );
  let fingerprint: string;
  try {
    if (!validCommand(command))
      return fail(
        "INVALID_COMMAND",
        "The action contains missing, malformed, or unexpected fields.",
      );
    fingerprint = canonical(command);
  } catch {
    return fail(
      "INVALID_COMMAND",
      "The action must contain plain JSON data without sparse arrays.",
    );
  }
  if (fingerprint.length > 12000)
    return fail("PAYLOAD_TOO_LARGE", "The action is too large.");
  const prior = game.events.find((event) => event.command.id === command.id);
  if (prior)
    return prior.fingerprint === fingerprint
      ? { ok: true, game, replayed: true, acceptedRevision: prior.sequence }
      : fail(
          "COMMAND_ID_REUSED",
          "This action ID was already used for different content.",
        );
  if (command.expectedRevision !== game.revision)
    return fail(
      "REVISION_CONFLICT",
      "The game changed. Refresh its state before submitting this action.",
    );
  if (game.status === "finalized")
    return fail(
      "GAME_FINALIZED",
      "The result is final. A historical amendment is required for corrections.",
    );
  if (
    game.revision >= MAX_GAME_EVENTS ||
    (game.revision === MAX_GAME_EVENTS - 1 && command.type !== "finalize")
  ) {
    return fail(
      "HISTORY_LIMIT_REACHED",
      "This long game has reached its action limit. Its history is intact. Review and finalize the game before starting a new one.",
    );
  }
  if (
    lexicon.id !== game.lexicon.id ||
    lexicon.edition !== game.lexicon.edition ||
    lexicon.status !== game.lexicon.status
  ) {
    return fail(
      "LEXICON_MISMATCH",
      "Use the word reference and edition recorded when this game started.",
    );
  }
  const event: GameEvent = {
    sequence: game.revision + 1,
    command: copy(command),
    fingerprint,
  };
  if (command.type === "resume") {
    if (game.status !== "paused")
      return fail("NOT_PAUSED", "This game is already active.");
  } else if (command.type === "pause") {
    if (game.status !== "active")
      return fail("ALREADY_PAUSED", "This game is already paused.");
  } else {
    if (
      game.status !== "active" &&
      command.type !== "finalize" &&
      command.type !== "reconcile" &&
      command.type !== "extend-supply"
    )
      return fail("GAME_PAUSED", "Resume the game before recording an action.");
    if (
      [
        "play",
        "pass",
        "exchange",
        "assisted-pass",
        "assist",
        "verify-words",
      ].includes(command.type) &&
      game.pendingEnd
    ) {
      return fail(
        "END_REVIEW_REQUIRED",
        "The stopping condition has been reached. Review the ending or correct the last turn.",
      );
    }
    if (command.type === "play") {
      const scored = scoreMove(
        game.board,
        command.placements,
        extendLexicon(lexicon, game.verifiedWords ?? []),
        game.expectedRackCounts[game.currentPlayerId],
        getTileSupply(game),
      );
      if (!scored.ok) return fail(scored.error.code, scored.error.message);
      if (game.assistance) {
        const rack = [...game.assistance.racks[game.currentPlayerId]];
        for (const placement of command.placements) {
          const tile = placement.tile.blank ? "?" : placement.tile.letter;
          const index = rack.indexOf(tile);
          if (index < 0)
            return fail(
              "TILE_NOT_IN_RACK",
              `The current player's recorded rack does not contain ${tile}.`,
            );
          rack.splice(index, 1);
        }
      }
      event.turn = makeTurn(game, command, {
        type: "play",
        score: scored.score,
        words: copy(scored.words),
        placements: copy(command.placements),
        bingo: scored.bingo > 0,
        newTileCount: scored.newTileCount,
      });
    } else if (command.type === "pass") {
      if (game.assistance)
        return fail(
          "ASSISTED_SEARCH_REQUIRED",
          "An assisted pass needs a completed search establishing that this rack has no legal move.",
        );
      event.turn = makeTurn(game, command, {});
    } else if (command.type === "assisted-pass") {
      if (!game.assistance || !context.hasLegalMove)
        return fail(
          "ASSISTED_SEARCH_REQUIRED",
          "A trusted complete move search is required for an assisted pass.",
        );
      try {
        const hasMove = context.hasLegalMove(
          game.board,
          [...game.assistance.racks[game.currentPlayerId]],
          extendLexicon(lexicon, game.verifiedWords ?? []),
          getTileSupply(game),
          game.verifiedWords,
        );
        if (hasMove !== false)
          return fail(
            "LEGAL_MOVE_AVAILABLE",
            "An assisted pass cannot be recorded while a legal placement exists or search is incomplete.",
          );
      } catch {
        return fail(
          "SOLVER_UNAVAILABLE",
          "The move search failed. No pass was recorded.",
        );
      }
      event.turn = makeTurn(game, command, {});
    } else if (command.type === "exchange") {
      if (game.assistance)
        return fail(
          "NO_ASSISTED_DRAWS",
          "Current-rack assistance permits no exchanges or new draws.",
        );
      if (
        command.count > game.expectedRackCounts[game.currentPlayerId] ||
        command.count > game.expectedBagCount
      )
        return fail(
          "INVALID_EXCHANGE",
          "The rack and bag must each contain enough tiles for this exchange.",
        );
      event.turn = makeTurn(game, command, {
        type: "exchange",
        exchangeCount: command.count,
      });
    } else if (command.type === "verify-words") {
      if (game.assistance)
        return fail(
          "ASSISTED_LEXICON_LOCKED",
          "Word additions must be confirmed before assisted finishing begins.",
        );
      if (
        (game.verifiedWords?.length ?? 0) + command.words.length >
        MAX_VERIFIED_WORDS
      )
        return fail(
          "VERIFIED_WORD_LIMIT",
          `A game can retain at most ${MAX_VERIFIED_WORDS} publisher confirmations.`,
        );
      try {
        const effective = extendLexicon(lexicon, game.verifiedWords ?? []);
        if (command.words.some((entry) => effective.has(entry.word)))
          return fail(
            "WORD_ALREADY_AVAILABLE",
            "Every addition must be missing from this game's current word reference. Previously recorded confirmations cannot be replaced.",
          );
      } catch {
        return fail(
          "LEXICON_UNAVAILABLE",
          "The game's word reference could not be checked. No confirmation was recorded.",
        );
      }
    } else if (command.type === "extend-supply") {
      if (game.assistance)
        return fail(
          "ASSISTED_SUPPLY_LOCKED",
          "The physical supply cannot change after assisted racks have been confirmed.",
        );
      const additions = Object.entries(command.additions);
      if (
        !additions.length ||
        additions.some(
          ([letter, count]) =>
            !Object.hasOwn(LETTER_COUNTS, letter) ||
            !Number.isSafeInteger(count) ||
            count <= 0 ||
            count > MAX_TILE_TOTAL - 100,
        )
      ) {
        return fail(
          "INVALID_SUPPLY_ADDITIONS",
          "Add a positive whole number of known letter tiles or blanks; reductions and unknown tile types are not permitted.",
        );
      }
      if (
        getTileTotal(game) +
          additions.reduce((sum, [, count]) => sum + count, 0) >
        MAX_TILE_TOTAL
      )
        return fail(
          "TILE_SUPPLY_LIMIT",
          `The complete tile supply cannot exceed ${MAX_TILE_TOTAL} tiles.`,
        );
    } else if (command.type === "reconcile") {
      if (game.assistance)
        return fail(
          "ASSISTED_RECONCILIATION_LOCKED",
          "Assisted racks are fixed by their starting inventory and recorded plays. Counts cannot be rewritten after assistance starts.",
        );
      const invalid = validateReconciliation(game, command);
      if (invalid) return { ok: false, error: invalid };
    } else if (command.type === "undo") {
      const latest = game.turns.at(-1);
      if (!latest)
        return fail("NOTHING_TO_UNDO", "No effective turn can be undone.");
      const reconciliation = game.events.findLast(
        (event) =>
          event.command.type === "reconcile" ||
          event.command.type === "extend-supply",
      );
      const turnEvent = game.events.find(
        (event) => event.turn?.id === latest.id,
      );
      if (
        reconciliation &&
        turnEvent &&
        turnEvent.sequence < reconciliation.sequence
      ) {
        return fail(
          "RECONCILIATION_BOUNDARY_LOCKED",
          "This turn precedes a confirmed physical tile count and cannot be undone safely. Reconcile the physical counts for count corrections; changing this earlier turn requires an audited historical correction.",
        );
      }
      if (game.assistance && latest.source === "human")
        return fail(
          "ASSISTANCE_BOUNDARY_LOCKED",
          "A human turn before revealed assistance cannot be undone by a live correction.",
        );
      event.undoneTurnId = latest.id;
    } else if (command.type === "assist") {
      if (game.assistance)
        return fail(
          "ALREADY_ASSISTED",
          "Assistance has already started and cannot be removed.",
        );
      const checked = checkRacks(game, command.racks);
      if (!checked.ok) return { ok: false, error: checked.error };
      if (Object.values(checked.racks).some((rack) => rack.length === 0))
        return fail(
          "EMPTY_START_RACK",
          "An empty rack must be resolved through end review before starting assistance.",
        );
    } else if (command.type === "finalize") {
      const result = makeFinalResult(game, command);
      if ("code" in result) return { ok: false, error: result };
      event.result = result;
    }
  }
  return {
    ok: true,
    game: freeze(project(game.definition, [...game.events, event])),
    acceptedRevision: event.sequence,
  };
}
/** Revalidate persisted journals rather than trusting saved scores, boards, or record flags. */
export function hydrateGame(
  value: unknown,
  lexicon: Lexicon,
  context: CommandContext = {},
): GameResult {
  try {
    return hydrateValidatedGame(value, lexicon, context);
  } catch {
    return fail(
      "INVALID_SAVED_GAME",
      "The saved game contains malformed data. Preserve its original copy for recovery.",
    );
  }
}
function hydrateValidatedGame(
  value: unknown,
  lexicon: Lexicon,
  context: CommandContext,
): GameResult {
  if (
    !isRecord(value) ||
    value.version !== GAME_VERSION ||
    !isRecord(value.definition) ||
    !Array.isArray(value.events) ||
    value.events.length > MAX_GAME_EVENTS ||
    !isDenseArray(value.events)
  )
    return fail(
      "INVALID_SAVED_GAME",
      "The saved game has an unsupported or malformed journal.",
    );
  let restored = createGame(value.definition as CreateGameInput);
  if (!restored.ok) return restored;
  if (
    lexicon.id !== restored.game.lexicon.id ||
    lexicon.edition !== restored.game.lexicon.edition ||
    lexicon.status !== restored.game.lexicon.status
  )
    return fail(
      "LEXICON_MISMATCH",
      "The saved game requires its original word reference.",
    );
  for (const stored of value.events) {
    if (!isRecord(stored) || !isRecord(stored.command))
      return fail("INVALID_SAVED_GAME", "A journal action is malformed.");
    const applied = applyCommand(
      restored.game,
      stored.command as GameCommand,
      lexicon,
      context,
    );
    if (!applied.ok)
      return fail(
        "INVALID_SAVED_GAME",
        `Journal replay failed: ${applied.error.message}`,
      );
    try {
      if (canonical(applied.game.events.at(-1)) !== canonical(stored))
        return fail(
          "INVALID_SAVED_GAME",
          "A saved journal result does not match verified replay.",
        );
    } catch {
      return fail(
        "INVALID_SAVED_GAME",
        "The journal contains malformed JSON values.",
      );
    }
    restored = applied;
  }
  try {
    if (canonical(restored.game) !== canonical(value))
      return fail(
        "INVALID_SAVED_GAME",
        "The saved view does not match its verified journal. Preserve the file for recovery.",
      );
  } catch {
    return fail("INVALID_SAVED_GAME", "The saved game contains invalid data.");
  }
  return restored;
}
