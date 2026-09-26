import type { GameTurn, GameWord } from "../domain/game";
import type { Board, Placement } from "../domain/types";
import { ReviewWord } from "./ReviewWord";
import { WordDefinition } from "./WordDefinition";
import "./played-word-details.css";

/** Keep recorded attribution and scores while reusing the board's actual tiles. */
export function PlayedWordDetails({
  word,
  board,
  placements,
  playerName,
  round,
  source,
}: {
  word: GameWord;
  board: Board;
  placements: readonly Placement[];
  playerName: string;
  round: number;
  source: GameTurn["source"];
}) {
  return (
    <section
      className="played-word-details"
      aria-label={`${word.word} by ${playerName}`}
    >
      <p className="played-word-attribution">
        <strong>{playerName}</strong>
        <span>Round {round}</span>
        {source === "assisted" && <span>Assisted play</span>}
      </p>
      <ReviewWord word={word} board={board} placements={placements} />
      <div className="played-word-meaning">
        <span className="played-word-caption">Meaning</span>
        <WordDefinition word={word.word} />
      </div>
    </section>
  );
}
