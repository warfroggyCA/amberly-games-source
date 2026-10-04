import type { GameEvent, GameState } from "../domain/game";

export function replayStepLabel(game: GameState, event?: GameEvent): string {
  if (!event) return "Before the first recorded action";
  const turn = event.turn;
  if (turn) {
    const name =
      game.players.find((player) => player.id === turn.playerId)?.name ??
      "Player";
    if (turn.type === "pass") return `${name} passed`;
    if (turn.type === "exchange") {
      const count =
        turn.exchangeCount ??
        (event.command.type === "exchange" ? event.command.count : null);
      return count === null
        ? `${name} exchanged tiles · count not recorded`
        : `${name} exchanged ${count} tiles`;
    }
    return `${name} played ${turn.words.map((word) => word.word).join(" and ")} · ${turn.score} points`;
  }
  switch (event.command.type) {
    case "undo":
      return "Last turn undone · board and scores restored";
    case "edit-turn":
      return "Earlier play corrected · board and scores recalculated";
    case "pause":
      return "Game paused";
    case "resume":
      return "Game resumed";
    case "start-clock":
      return "Game timing started";
    case "reconcile":
      return "Recorded tile counts corrected";
    case "extend-supply":
      return "Tile supply extended";
    case "assist":
      return "Assisted finish started";
    case "verify-words":
      return "Word verification recorded";
    case "finalize":
      return "Final result · recorded ending adjustments applied";
    default:
      return "Recorded action";
  }
}
