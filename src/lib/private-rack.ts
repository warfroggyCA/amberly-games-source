import { playedTiles, subtractTiles } from "../domain/turn-coaching";
import type { GameTurn } from "../domain/game";

export type RackMemory = {
  revision: number;
  epoch?: number;
  awaitingDraw: boolean;
  turns: GameTurn[];
  rack: string[] | null;
  snapshots: Record<string, string[]>;
  exchange: GameTurn | null;
  notice: string;
};
export function emptyRackMemory(
  revision: number,
  turns: GameTurn[],
  epoch?: number,
): RackMemory {
  return {
    revision,
    epoch,
    awaitingDraw: false,
    turns,
    rack: null,
    snapshots: {},
    exchange: null,
    notice: "Rack not entered. Manual pre-turn entry is always available.",
  };
}
/** Conservative reconciliation: uncertainty clears tracking, never fabricates earlier racks. */
export function advanceRack(
  memory: RackMemory,
  revision: number,
  turns: GameTurn[],
  playerId: string,
  epoch?: number,
  expectedCount?: number,
): RackMemory {
  if (
    revision === memory.revision &&
    epoch === memory.epoch &&
    JSON.stringify(turns) === JSON.stringify(memory.turns)
  )
    return memory;
  const samePrefix =
    JSON.stringify(turns.slice(0, memory.turns.length)) ===
    JSON.stringify(memory.turns);
  const added = turns.slice(memory.turns.length);
  if (
    !samePrefix ||
    (epoch === undefined
      ? revision - memory.revision !== added.length
      : epoch !== memory.epoch)
  ) {
    return {
      ...emptyRackMemory(revision, turns, epoch),
      notice:
        "Game history or inventory changed. Confirm your current rack again; earlier racks need manual entry.",
    };
  }
  let next = {
    ...memory,
    revision,
    epoch,
    turns,
    snapshots: { ...memory.snapshots },
  };
  for (const [index, turn] of added.entries()) {
    if (turn.playerId !== playerId) continue;
    if (!next.rack || next.exchange || turn.source !== "human") {
      next = {
        ...next,
        rack: null,
        exchange: null,
        notice:
          "A turn was recorded with incomplete tracking. Enter your current rack to resume.",
      };
      continue;
    }
    // A rack left awaiting a refill must not silently become a complete next-turn rack.
    if (next.awaitingDraw) {
      next = {
        ...next,
        rack: null,
        notice:
          "A refill was missing. This turn requires manual pre-turn entry.",
      };
      continue;
    }
    next.snapshots[turn.id] = [...next.rack];
    try {
      next.rack = subtractTiles(next.rack, playedTiles(turn));
      const lastOwnTurn = !added
        .slice(index + 1)
        .some((t) => t.playerId === playerId);
      next.awaitingDraw =
        turn.type === "play" &&
        (!lastOwnTurn || next.rack.length !== expectedCount);
      next.exchange = turn.type === "exchange" ? turn : null;
      next.notice =
        turn.type === "exchange"
          ? "Enter returned tiles and their replacements."
          : next.awaitingDraw
            ? "Enter the tiles you drew to complete your current rack."
            : "Current rack recorded on this device.";
    } catch {
      delete next.snapshots[turn.id];
      next.rack = null;
      next.notice =
        "The played tiles did not match. Confirm your current rack; review needs manual entry.";
    }
  }
  return next;
}

export function completeExchange(
  memory: RackMemory,
  returned: string[],
  drawn: string[],
  expected: number,
): RackMemory {
  if (
    !memory.rack ||
    !memory.exchange ||
    returned.length !== memory.exchange.exchangeCount ||
    drawn.length !== returned.length
  )
    throw Error(
      "Enter exactly the recorded number of returned and replacement tiles.",
    );
  const rack = [...subtractTiles(memory.rack, returned), ...drawn];
  if (rack.length !== expected)
    throw Error("The exchanged rack count does not match this game.");
  return {
    ...memory,
    rack,
    exchange: null,
    awaitingDraw: false,
    notice: "Current rack recorded on this device.",
  };
}
