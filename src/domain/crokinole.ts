/** Crokinole rules and immutable journal. No clocks, storage or account access here. */
export const CROKINOLE_HIGH_SCORE = 240;
export const CROKINOLE_MAX_EVENTS = 5000;
export type PieceColour = {
  id: string;
  name: string;
  value: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
};
export type CrokinoleColour = Pick<PieceColour, "id" | "name" | "value">;
export type CrokinolePlayer = { id: string; name: string; seatOrder: number };
export type CrokinoleParticipant = {
  id: string;
  name: string;
  playerIds: string[];
  colour: CrokinoleColour;
};
export type CrokinoleScoringMode =
  "traditional_differential" | "nca_match_points" | "cumulative_round_totals";
export type CrokinoleDefinition = {
  schemaVersion: 1;
  rulesVersion: 1;
  id: string;
  familyId: string;
  mode: "confirmed" | "practice";
  createdAt: string;
  players: CrokinolePlayer[];
  participants: CrokinoleParticipant[];
  format: "singles" | "doubles" | "free_for_all";
  scoringMode: CrokinoleScoringMode;
  endCondition:
    | { type: "target"; target: number }
    | { type: "fixed_rounds"; rounds: number };
  initialStartingPlayerId: string;
};
export type CrokinoleEntry = { participantId: string; rawScore: number };
export type CrokinoleResult = {
  winnerIds: string[];
  tied: boolean;
  totals: Record<string, number>;
  roundsPlayed: number;
};
export type CrokinoleRound = {
  id: string;
  number: number;
  startingPlayerId: string;
  entries: CrokinoleEntry[];
  awards: Record<string, number>;
  totals: Record<string, number>;
};
type CommandBase = { id: string; expectedRevision: number };
export type CrokinoleCommand = CommandBase &
  (
    | {
        type: "record_round";
        roundId: string;
        entries: CrokinoleEntry[];
        acknowledgedHighScores?: boolean;
      }
    | {
        type: "correct_round";
        roundId: string;
        entries: CrokinoleEntry[];
        excludedRoundIds: string[];
        reason?: string;
        acknowledgedHighScores?: boolean;
      }
    | { type: "undo_round"; reason?: string }
    | { type: "end_early"; reason: string }
  );
export type CrokinoleEvent = {
  sequence: number;
  command: CrokinoleCommand;
  actorId: string;
  createdAt: string;
  result: CrokinoleResult | null;
};
export type CrokinoleGame = {
  definition: CrokinoleDefinition;
  events: CrokinoleEvent[];
  revision: number;
  rounds: CrokinoleRound[];
  totals: Record<string, number>;
  status: "active" | "completed" | "ended_early";
  result: CrokinoleResult | null;
};
export class CrokinoleError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "CrokinoleError";
  }
}
function fail(code: string, message: string): never {
  throw new CrokinoleError(code, message);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max = 160): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}
function identifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(value) &&
    !["__proto__", "constructor", "prototype"].includes(value)
  );
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  );
}
function unique(values: string[]) {
  return new Set(values).size === values.length;
}
function clone<T>(value: T): T {
  return structuredClone(value);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (object(value))
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function isCrokinoleColour(value: unknown): value is CrokinoleColour {
  return (
    object(value) &&
    keys(value, ["id", "name", "value"]) &&
    identifier(value.id) &&
    text(value.name, 60) &&
    typeof value.value === "string" &&
    /^#[0-9a-f]{6}$/i.test(value.value)
  );
}
export function isPieceColour(value: unknown): value is PieceColour {
  return (
    object(value) &&
    keys(value, [
      "id",
      "name",
      "value",
      "isDefault",
      "isActive",
      "sortOrder",
    ]) &&
    isCrokinoleColour({ id: value.id, name: value.name, value: value.value }) &&
    typeof value.isDefault === "boolean" &&
    typeof value.isActive === "boolean" &&
    integer(value.sortOrder)
  );
}
export const DEFAULT_PIECE_COLOURS: PieceColour[] = [
  "Black:#252525",
  "Natural Wood:#D6B784",
  "Red:#B64238",
  "Blue:#356AA0",
  "Green:#356A4E",
  "Yellow:#E4BF42",
  "White:#F5F2E9",
  "Purple:#76508A",
].map((item, sortOrder) => {
  const [name, value] = item.split(":");
  return {
    id: "crokinole-" + name.toLowerCase().replaceAll(" ", "-"),
    name,
    value,
    isDefault: true,
    isActive: true,
    sortOrder,
  };
});
export function restoreDefaultColours(palette: PieceColour[]): PieceColour[] {
  return [
    ...clone(DEFAULT_PIECE_COLOURS),
    ...palette
      .filter((c) => !DEFAULT_PIECE_COLOURS.some((d) => d.id === c.id))
      .map((c, i) => ({ ...c, sortOrder: i + DEFAULT_PIECE_COLOURS.length })),
  ];
}
export function colourForeground(hex: string): "#ffffff" | "#000000" {
  const rgb = /^#[0-9a-f]{6}$/i.test(hex)
    ? [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    : [1, 1, 1];
  const l = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#ffffff";
}
export function similarColours(a: string, b: string): boolean {
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return false;
  return (
    Math.sqrt(
      [1, 3, 5].reduce(
        (sum, i) =>
          sum +
          (parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) **
            2,
        0,
      ),
    ) < 55
  );
}
export function validateDefinition(
  value: unknown,
): asserts value is CrokinoleDefinition {
  if (
    !object(value) ||
    !keys(value, [
      "schemaVersion",
      "rulesVersion",
      "id",
      "familyId",
      "mode",
      "createdAt",
      "players",
      "participants",
      "format",
      "scoringMode",
      "endCondition",
      "initialStartingPlayerId",
    ]) ||
    value.schemaVersion !== 1 ||
    value.rulesVersion !== 1 ||
    !identifier(value.id) ||
    !identifier(value.familyId) ||
    !timestamp(value.createdAt) ||
    typeof value.mode !== "string" ||
    !["confirmed", "practice"].includes(value.mode)
  )
    fail("INVALID_DEFINITION", "Invalid match definition or version.");
  if (
    !Array.isArray(value.players) ||
    value.players.length < 2 ||
    value.players.length > 4 ||
    !value.players.every(
      (p: unknown) =>
        object(p) &&
        keys(p, ["id", "name", "seatOrder"]) &&
        identifier(p.id) &&
        text(p.name) &&
        integer(p.seatOrder),
    )
  )
    fail("INVALID_PLAYERS", "Choose two to four named players.");
  const players = value.players as CrokinolePlayer[];
  if (
    !unique(players.map((p) => p.id)) ||
    !unique(players.map((p) => String(p.seatOrder))) ||
    players.some((p) => p.seatOrder >= players.length) ||
    !players.some((p) => p.id === value.initialStartingPlayerId)
  )
    fail("INVALID_PLAYERS", "Players and clockwise seats must be unique.");
  if (
    !Array.isArray(value.participants) ||
    value.participants.length < 2 ||
    value.participants.length > 4 ||
    !value.participants.every(
      (p: unknown) =>
        object(p) &&
        keys(p, ["id", "name", "playerIds", "colour"]) &&
        identifier(p.id) &&
        text(p.name) &&
        Array.isArray(p.playerIds) &&
        p.playerIds.every((id) => identifier(id)) &&
        isCrokinoleColour(p.colour),
    )
  )
    fail("INVALID_PARTICIPANTS", "Invalid scoring participants.");
  const sides = value.participants as CrokinoleParticipant[];
  const ids = sides.flatMap((s) => s.playerIds);
  if (
    !unique(sides.map((s) => s.id)) ||
    !unique(sides.map((s) => s.colour.id)) ||
    !unique(ids) ||
    ids.length !== players.length ||
    ids.some((id) => !players.some((p) => p.id === id))
  )
    fail(
      "INVALID_PARTICIPANTS",
      "Every player needs exactly one side and opposing sides need different colours.",
    );
  if (value.format === "doubles") {
    if (
      players.length !== 4 ||
      sides.length !== 2 ||
      sides.some(
        (s) =>
          s.playerIds.length !== 2 ||
          Math.abs(
            players.find((p) => p.id === s.playerIds[0])!.seatOrder -
              players.find((p) => p.id === s.playerIds[1])!.seatOrder,
          ) !== 2,
      )
    )
      fail(
        "INVALID_TEAMS",
        "Doubles requires two teams of two, seated opposite.",
      );
  } else if (
    (value.format === "singles" && players.length === 2) ||
    (value.format === "free_for_all" && players.length >= 3)
  ) {
    if (
      sides.length !== players.length ||
      sides.some((s) => s.playerIds.length !== 1 || s.id !== s.playerIds[0])
    )
      fail(
        "INVALID_PARTICIPANTS",
        "Individual scoring uses each player as a side.",
      );
  } else fail("INVALID_FORMAT", "Unsupported play format.");
  if (
    typeof value.scoringMode !== "string" ||
    ![
      "traditional_differential",
      "nca_match_points",
      "cumulative_round_totals",
    ].includes(value.scoringMode) ||
    (value.format === "free_for_all" &&
      value.scoringMode !== "cumulative_round_totals")
  )
    fail("INVALID_SCORING", "This scoring mode requires two sides.");
  const end = value.endCondition;
  if (!object(end)) fail("INVALID_END", "Choose a target or round count.");
  if (
    end.type === "target" &&
    keys(end, ["type", "target"]) &&
    integer(end.target) &&
    end.target > 0
  ) {
    if (
      value.scoringMode === "nca_match_points"
        ? ![5, 7, 9, 11].includes(end.target)
        : end.target % 5 !== 0
    )
      fail("INVALID_END", "Invalid target.");
  } else if (
    end.type === "fixed_rounds" &&
    keys(end, ["type", "rounds"]) &&
    integer(end.rounds) &&
    end.rounds > 0 &&
    end.rounds <= CROKINOLE_MAX_EVENTS
  ) {
    if (
      value.scoringMode === "traditional_differential" ||
      (value.scoringMode === "nca_match_points" && end.rounds !== 4)
    )
      fail("INVALID_END", "Unsupported fixed-round format.");
  } else fail("INVALID_END", "Invalid match length.");
}
export function isCrokinoleDefinition(
  value: unknown,
): value is CrokinoleDefinition {
  try {
    validateDefinition(value);
    return true;
  } catch {
    return false;
  }
}
export function validateRoundEntries(
  definition: CrokinoleDefinition,
  value: unknown,
): asserts value is CrokinoleEntry[] {
  if (
    !Array.isArray(value) ||
    value.length !== definition.participants.length ||
    !value.every(
      (e) =>
        object(e) &&
        keys(e, ["participantId", "rawScore"]) &&
        identifier(e.participantId) &&
        integer(e.rawScore) &&
        e.rawScore % 5 === 0,
    ) ||
    !unique(value.map((e) => e.participantId)) ||
    value.some(
      (e) => !definition.participants.some((p) => p.id === e.participantId),
    )
  )
    fail(
      "INVALID_SCORES",
      "Enter a non-negative multiple of five for every side.",
    );
}
export function calculateRoundAwards(
  mode: CrokinoleScoringMode,
  entries: CrokinoleEntry[],
): Record<string, number> {
  if (
    !entries.length ||
    entries.some((e) => !integer(e.rawScore) || e.rawScore % 5 !== 0) ||
    !unique(entries.map((e) => e.participantId))
  )
    fail("INVALID_SCORES", "Invalid round scores.");
  if (mode === "cumulative_round_totals")
    return Object.fromEntries(
      entries.map((e) => [e.participantId, e.rawScore]),
    );
  if (
    entries.length !== 2 ||
    !["traditional_differential", "nca_match_points"].includes(mode)
  )
    fail("INVALID_SCORING", "This scoring mode requires two sides.");
  const [a, b] = entries;
  const tie = a.rawScore === b.rawScore;
  return Object.fromEntries(
    entries.map((e) => [
      e.participantId,
      mode === "traditional_differential"
        ? Math.max(0, e.rawScore - (e === a ? b.rawScore : a.rawScore))
        : tie
          ? 1
          : e.rawScore === Math.max(a.rawScore, b.rawScore)
            ? 2
            : 0,
    ]),
  );
}
export function getStartingPlayer(
  definition: CrokinoleDefinition,
  roundIndex: number,
): CrokinolePlayer {
  if (!integer(roundIndex)) fail("INVALID_ROUND", "Invalid round index.");
  const players = [...definition.players].sort(
    (a, b) => a.seatOrder - b.seatOrder,
  );
  return players[
    (players.findIndex((p) => p.id === definition.initialStartingPlayerId) +
      roundIndex) %
      players.length
  ];
}
export function getStartingParticipant(
  definition: CrokinoleDefinition,
  roundIndex: number,
): string {
  const player = getStartingPlayer(definition, roundIndex);
  return definition.participants.find((p) => p.playerIds.includes(player.id))!
    .id;
}
function project(
  definition: CrokinoleDefinition,
  raw: Pick<CrokinoleRound, "id" | "entries">[],
  endedEarly = false,
  stopAtResult = false,
) {
  const totals: Record<string, number> = Object.fromEntries(
    definition.participants.map((p) => [p.id, 0]),
  );
  const rounds: CrokinoleRound[] = [];
  let result: CrokinoleResult | null = null;
  for (const [index, round] of raw.entries()) {
    if (result) {
      if (stopAtResult) break;
      fail("POST_WIN_ROUNDS", "Rounds remain after this match ends.");
    }
    validateRoundEntries(definition, round.entries);
    const awards = calculateRoundAwards(definition.scoringMode, round.entries);
    for (const id of Object.keys(totals)) {
      const sum = totals[id] + awards[id];
      if (!Number.isSafeInteger(sum))
        fail("SCORE_OVERFLOW", "The combined score is too large.");
      totals[id] = sum;
    }
    rounds.push({
      ...clone(round),
      number: index + 1,
      startingPlayerId: getStartingPlayer(definition, index).id,
      awards,
      totals: { ...totals },
    });
    const end = definition.endCondition;
    if (
      end.type === "fixed_rounds"
        ? rounds.length === end.rounds
        : Math.max(...Object.values(totals)) >= end.target
    ) {
      const max = Math.max(...Object.values(totals));
      const winnerIds = Object.keys(totals).filter((id) => totals[id] === max);
      result = {
        winnerIds,
        tied: winnerIds.length > 1,
        totals: { ...totals },
        roundsPlayed: rounds.length,
      };
    }
  }
  return {
    rounds,
    totals,
    result,
    status: result
      ? ("completed" as const)
      : endedEarly
        ? ("ended_early" as const)
        : ("active" as const),
  };
}
export function createCrokinoleGame(
  definition: CrokinoleDefinition,
): CrokinoleGame {
  validateDefinition(definition);
  return {
    definition: clone(definition),
    events: [],
    revision: 0,
    ...project(definition, []),
  };
}
export function isCrokinoleCommand(value: unknown): value is CrokinoleCommand {
  if (
    !object(value) ||
    !identifier(value.id) ||
    !integer(value.expectedRevision)
  )
    return false;
  const base = ["id", "expectedRevision", "type"];
  if (value.type === "undo_round" || value.type === "end_early")
    return (
      keys(value, [...base, "reason"]) &&
      (value.reason === undefined
        ? value.type === "undo_round"
        : text(value.reason, 500))
    );
  if (value.type !== "record_round" && value.type !== "correct_round")
    return false;
  if (
    !keys(value, [
      ...base,
      "roundId",
      "entries",
      "acknowledgedHighScores",
      ...(value.type === "correct_round" ? ["excludedRoundIds", "reason"] : []),
    ]) ||
    !identifier(value.roundId) ||
    !Array.isArray(value.entries) ||
    value.entries.length < 2 ||
    value.entries.length > 4 ||
    !value.entries.every(
      (e) =>
        object(e) &&
        keys(e, ["participantId", "rawScore"]) &&
        identifier(e.participantId) &&
        integer(e.rawScore) &&
        e.rawScore % 5 === 0,
    ) ||
    (value.acknowledgedHighScores !== undefined &&
      typeof value.acknowledgedHighScores !== "boolean")
  )
    return false;
  return (
    value.type === "record_round" ||
    (Array.isArray(value.excludedRoundIds) &&
      value.excludedRoundIds.length <= CROKINOLE_MAX_EVENTS &&
      value.excludedRoundIds.every((id) => identifier(id)) &&
      unique(value.excludedRoundIds as string[]) &&
      (value.reason === undefined || text(value.reason, 500)))
  );
}
export function previewCrokinoleCorrection(
  game: CrokinoleGame,
  roundId: string,
  entries: CrokinoleEntry[],
): {
  excludedRoundIds: string[];
  rounds: CrokinoleRound[];
  totals: Record<string, number>;
  result: CrokinoleResult | null;
  status: CrokinoleGame["status"];
} {
  validateRoundEntries(game.definition, entries);
  const index = game.rounds.findIndex((r) => r.id === roundId);
  if (index < 0) fail("ROUND_NOT_FOUND", "This round is no longer available.");
  const raw = game.rounds.map((r) => ({
    id: r.id,
    entries: r.id === roundId ? entries : r.entries,
  }));
  const projected = project(game.definition, raw, false, true);
  return {
    ...projected,
    excludedRoundIds: raw.slice(projected.rounds.length).map((r) => r.id),
  };
}
export function applyCrokinoleCommand(
  game: CrokinoleGame,
  command: CrokinoleCommand,
  metadata: { actorId: string; createdAt: string } = {
    actorId: "local",
    createdAt: game.definition.createdAt,
  },
): CrokinoleGame {
  if (
    !isCrokinoleCommand(command) ||
    !identifier(metadata.actorId) ||
    !timestamp(metadata.createdAt)
  )
    fail("INVALID_COMMAND", "Invalid game command.");
  const previous = game.events.find((e) => e.command.id === command.id);
  if (previous) {
    if (canonical(previous.command) !== canonical(command))
      fail("COMMAND_REUSED", "This request ID was used for different input.");
    return clone(game);
  }
  if (command.expectedRevision !== game.revision)
    fail("REVISION_CONFLICT", "The game changed. Review the latest scores.");
  if (game.events.length >= CROKINOLE_MAX_EVENTS)
    fail("EVENT_LIMIT", "This match has reached its history limit.");
  if (
    game.status !== "active" &&
    (command.type === "record_round" || command.type === "end_early")
  )
    fail("MATCH_ENDED", "This match has ended.");
  if (
    game.status !== "active" &&
    (!("reason" in command) || !text(command.reason, 500))
  )
    fail("AMENDMENT_REASON", "Give a reason for changing an ended match.");
  if ("entries" in command) {
    validateRoundEntries(game.definition, command.entries);
    if (
      command.entries.some((e) => e.rawScore > CROKINOLE_HIGH_SCORE) &&
      !command.acknowledgedHighScores
    )
      fail("HIGH_SCORE_CONFIRMATION", "Confirm unusually high round scores.");
  }
  let raw = game.rounds.map((r) => ({ id: r.id, entries: r.entries }));
  let endedEarly = false;
  if (command.type === "record_round") {
    if (
      game.events.some(
        (e) =>
          e.command.type === "record_round" &&
          e.command.roundId === command.roundId,
      )
    )
      fail("ROUND_ID_REUSED", "Use a new ID for a new round.");
    raw = [...raw, { id: command.roundId, entries: command.entries }];
  }
  if (command.type === "correct_round") {
    const preview = previewCrokinoleCorrection(
      game,
      command.roundId,
      command.entries,
    );
    if (
      canonical(preview.excludedRoundIds) !==
      canonical(command.excludedRoundIds)
    )
      fail(
        "TAIL_CONFIRMATION",
        "Confirm the exact later rounds excluded by this correction.",
      );
    raw = preview.rounds;
  }
  if (command.type === "undo_round") {
    if (!raw.length) fail("NO_ROUNDS", "There is no saved round to undo.");
    raw = raw.slice(0, -1);
  }
  if (command.type === "end_early") endedEarly = true;
  const projected = project(game.definition, raw, endedEarly);
  const event: CrokinoleEvent = {
    sequence: game.revision + 1,
    command: clone(command),
    actorId: metadata.actorId,
    createdAt: metadata.createdAt,
    result: clone(projected.result),
  };
  return {
    definition: clone(game.definition),
    ...projected,
    revision: event.sequence,
    events: [...clone(game.events), event],
  };
}
export function hydrateCrokinoleGame(
  definition: CrokinoleDefinition,
  events: unknown,
): CrokinoleGame {
  let game = createCrokinoleGame(definition);
  if (!Array.isArray(events) || events.length > CROKINOLE_MAX_EVENTS)
    fail("INVALID_JOURNAL", "Invalid game history.");
  for (const event of events) {
    if (
      !object(event) ||
      !keys(event, ["sequence", "command", "actorId", "createdAt", "result"]) ||
      event.sequence !== game.revision + 1 ||
      !isCrokinoleCommand(event.command) ||
      event.command.expectedRevision !== game.revision ||
      !identifier(event.actorId) ||
      !timestamp(event.createdAt)
    )
      fail("INVALID_JOURNAL", "Invalid game history sequence.");
    const command = event.command;
    if (game.events.some((e) => e.command.id === command.id))
      fail("INVALID_JOURNAL", "Repeated game history command.");
    const next = applyCrokinoleCommand(game, command, {
      actorId: event.actorId,
      createdAt: event.createdAt,
    });
    if (canonical(next.result) !== canonical(event.result))
      fail("INVALID_JOURNAL", "The saved result does not match its rounds.");
    game = next;
  }
  return game;
}
export function createCrokinoleRematch(
  game: CrokinoleGame,
  id: string,
  createdAt: string,
): CrokinoleGame {
  return createCrokinoleGame({
    ...clone(game.definition),
    id,
    createdAt,
    initialStartingPlayerId: getStartingPlayer(game.definition, 1).id,
  });
}
export function calculateMatchTotals(
  game: CrokinoleGame,
): Record<string, number> {
  return { ...game.totals };
}
export function getMatchResult(game: CrokinoleGame): CrokinoleResult | null {
  return clone(game.result);
}
