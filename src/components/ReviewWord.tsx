import { LETTER_VALUES, premiumAt } from "../domain/board";
import type { Board, Placement, ScoredWord } from "../domain/types";
import "./review-word.css";

const PREMIUM_NAMES = {
  DL: "Double letter",
  TL: "Triple letter",
  DW: "Double word",
  TW: "Triple word",
};

/** Read the scored board in word order, while always displaying a horizontal strip. */
export function ReviewWord({
  word,
  board,
  placements,
}: {
  word: ScoredWord;
  board: Board;
  placements: readonly Placement[];
}) {
  return (
    <section
      className="review-word"
      aria-label={`${word.word}, ${word.score} points`}
    >
      <ol
        className="review-tile-strip"
        aria-label={`${word.word} tile spaces`}
        tabIndex={0}
      >
        {Array.from(word.word, (_, index) => {
          const row = word.row + (word.direction === "down" ? index : 0);
          const col = word.col + (word.direction === "across" ? index : 0);
          const tile = board[row][col];
          if (!tile) return null;
          const fresh = placements.some((p) => p.row === row && p.col === col);
          const premium = premiumAt(row, col);
          const points = tile.blank ? 0 : LETTER_VALUES[tile.letter];
          const label = `${tile.letter}${tile.blank ? " blank" : ""}, ${points} tile point${points === 1 ? "" : "s"}, ${fresh ? "new tile" : "already on board"}${premium ? `, ${PREMIUM_NAMES[premium]} ${fresh ? "applies" : "already used"}` : ""}`;
          return (
            <li
              key={`${row}:${col}`}
              className={`review-tile-space ${premium?.toLowerCase() ?? "plain"} ${fresh ? "is-new" : "is-existing"}`}
              aria-label={label}
              title={label}
            >
              <span
                className={`letter-tile ${tile.blank ? "blank-tile" : ""}`}
                aria-hidden="true"
              >
                <b>{tile.letter}</b>
                <small>{points}</small>
              </span>
              {premium && (
                <span className="review-premium" aria-hidden="true">
                  {premium}
                  {!fresh && <small>used</small>}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <strong className="review-word-score">
        {word.score}
        <small>points</small>
      </strong>
    </section>
  );
}
