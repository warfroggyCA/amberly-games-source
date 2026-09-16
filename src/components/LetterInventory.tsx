import {
  countUnplayed,
  LETTER_COUNTS,
  LETTER_VALUES,
  type TileSupply,
} from "../domain/board";
import type { Board } from "../domain/types";
import "./tile-inventory.css";
export function LetterInventory({
  board,
  tileSupply,
  expectedBagCount,
  assisted = false,
}: {
  board: Board;
  tileSupply?: TileSupply | null;
  expectedBagCount: number;
  assisted?: boolean;
}) {
  const supply = tileSupply ?? LETTER_COUNTS;
  const remaining = countUnplayed(board, supply);
  const total = Object.values(remaining).reduce((sum, n) => sum + n, 0);
  const vowels = Object.entries(remaining)
    .filter(([letter]) => "AEIOU".includes(letter))
    .reduce((sum, [, n]) => sum + n, 0);
  return (
    <>
      <div className="tile-inventory-heading">
        <strong>{total} tiles not yet played</strong>
        <span>
          {expectedBagCount}{" "}
          {assisted ? "left unused in the bag" : "expected in the bag"} ·{" "}
          {Object.values(supply).reduce((sum, count) => sum + count, 0)} in this
          set
        </span>
      </div>
      <p className="inventory-explainer">
        Letter counts include tiles on everyone’s racks. The exact letters in
        the bag are unknown during normal play.
      </p>
      <div className="tile-inventory">
        {Object.entries(supply).map(([letter, original]) => (
          <div
            className={`inventory-item ${remaining[letter as keyof typeof remaining] === 0 ? "exhausted" : ""}`}
            key={letter}
            aria-label={`${letter === "?" ? "Blank" : letter}: ${remaining[letter as keyof typeof remaining]} remaining of ${original}`}
          >
            <span className="inventory-tile letter-tile">
              <b>{letter === "?" ? "" : letter}</b>
              <small>
                {letter === "?"
                  ? 0
                  : LETTER_VALUES[letter as keyof typeof LETTER_VALUES]}
              </small>
              {letter === "?" && <span className="blank-label">blank</span>}
            </span>
            <span className="inventory-quantity">
              <strong>{remaining[letter as keyof typeof remaining]}</strong>
              <small>of {original}</small>
            </span>
          </div>
        ))}
      </div>
      <div className="inventory-totals">
        <span>
          Vowels <b>{vowels}</b>
        </span>
        <span>
          Consonants <b>{total - vowels - remaining["?"]}</b>
        </span>
        <span>
          Blanks <b>{remaining["?"]}</b>
        </span>
      </div>
    </>
  );
}
