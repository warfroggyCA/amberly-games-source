import { EMPTY_EQUIPMENT, validateEquipmentChange } from "../domain/equipment";
import type { PreviewData } from "./preview-store";
import type { SharedOperation, SharedState } from "./shared-contract";

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
/** Translate existing UI actions into commands. Scores and snapshots never cross the write API. */
export function describeSharedChange(
  previous: PreviewData,
  next: PreviewData,
  shared: SharedState,
  deviceId: string,
  mode: "confirmed" | "practice" = "confirmed",
): SharedOperation | null {
  if (
    previous.players.some((p) => !next.players.some((n) => n.id === p.id)) ||
    previous.games.some((g) => !next.games.some((n) => n.id === g.id))
  )
    throw new Error("Shared players and game history cannot be deleted.");
  const players = next.players.filter(
    (p) =>
      !same(
        p,
        previous.players.find((n) => n.id === p.id),
      ),
  );
  const games = next.games.filter(
    (g) =>
      !same(
        g,
        previous.games.find((n) => n.id === g.id),
      ),
  );
  const additions = (next.verifiedWords ?? []).filter(
    (w) => !(previous.verifiedWords ?? []).some((n) => n.word === w.word),
  );
  if (
    players.length > 1 ||
    games.length > 1 ||
    (players.length && (games.length || additions.length))
  )
    throw new Error("Save one shared action at a time.");
  if (!same(previous.equipment, next.equipment)) {
    if (players.length || games.length || additions.length)
      throw new Error("Save tile sets separately from other actions.");
    if (!next.equipment) throw new Error("Saved tile sets cannot be removed.");
    validateEquipmentChange(
      previous.equipment ?? EMPTY_EQUIPMENT,
      next.equipment,
    );
    return {
      type: "save-equipment",
      equipment: next.equipment,
      expectedRevision: previous.equipment?.revision ?? 0,
    };
  }
  if (players.length) {
    const { id, ...profile } = players[0];
    const access = shared.playerAccess[id];
    return previous.players.some((p) => p.id === id)
      ? {
          type: "update-player",
          id,
          profile,
          expectedRevision: access.revision,
        }
      : { type: "create-player", id, profile };
  }
  if (games.length) {
    const game = games[0];
    const old = previous.games.find((g) => g.id === game.id);
    if (!old)
      return {
        type: "create-game",
        ...(game.definition.tileSet
          ? {
              tileSet: {
                id: game.definition.tileSet.id,
                revision: game.definition.tileSet.revision,
              },
            }
          : {}),
        id: game.id,
        deviceId,
        mode,
        players: game.players.map(({ id, seat }) => ({ id, seat })),
        firstPlayerId: game.definition.firstPlayerId,
        direction: game.direction,
      };
    if (
      !same(old.definition, game.definition) ||
      game.events.length < old.events.length ||
      old.events.some((event, index) => !same(event, game.events[index]))
    )
      throw new Error("Original shared game history cannot be replaced.");
    const commands = game.events.slice(old.events.length).map((e) => e.command);
    if (!commands.length)
      throw new Error(
        "Shared scores can only change through recorded commands.",
      );
    const access = shared.gameAccess[game.id];
    if (!access)
      throw new Error("Refresh this game before recording another action.");
    if (commands.every((c) => c.type === "verify-words"))
      return {
        type: "verify-words",
        gameId: game.id,
        words: [
          ...new Set([
            ...additions.map((w) => w.word),
            ...commands.flatMap((c) =>
              c.type === "verify-words" ? c.words.map((w) => w.word) : [],
            ),
          ]),
        ],
        expectedRevision: old.revision,
        deviceId,
        generation: access.generation,
      };
    return {
      type: "game-commands",
      gameId: game.id,
      commands,
      deviceId,
      generation: access.generation,
    };
  }
  if (additions.length) {
    const game = previous.games.find((g) => g.id === next.activeGameId);
    const access = game && shared.gameAccess[game.id];
    if (!game || !access)
      throw new Error("Open the game before saving word confirmations.");
    return {
      type: "verify-words",
      gameId: game.id,
      words: additions.map((w) => w.word),
      expectedRevision: game.revision,
      deviceId,
      generation: access.generation,
    };
  }
  return null;
}
