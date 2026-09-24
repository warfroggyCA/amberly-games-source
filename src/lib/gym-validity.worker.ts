import { draftWordFeedback } from "../domain/gym/word-feedback";
import { scoreMove } from "../domain/scoring";
import { consumedTiles, removeTiles, type Position } from "../domain/gym/model";
import type { Placement } from "../domain/types";
import { defaultLexicon } from "./lexicons";
const scope = self as unknown as {
  onmessage: (
    event: MessageEvent<{
      id: number;
      position: Position;
      placements: Placement[];
    }>,
  ) => void;
  postMessage: (value: unknown) => void;
};
scope.onmessage = ({ data }) => {
  try {
    removeTiles(
      data.position.rack,
      consumedTiles({ type: "play", placements: data.placements }),
    );
    const result = scoreMove(
      data.position.board,
      data.placements,
      defaultLexicon,
      data.position.rack.length,
    );
    // Invalid words can have a potential point value; never present it as a legal score.
    const tentative =
      !result.ok && result.error.code === "INVALID_WORD"
        ? scoreMove(
            data.position.board,
            data.placements,
            { ...defaultLexicon, has: () => true },
            data.position.rack.length,
          )
        : null;
    scope.postMessage({
      id: data.id,
      result,
      words: draftWordFeedback(
        data.position.board,
        data.placements,
        defaultLexicon,
      ),
      ...(tentative?.ok ? { tentativeScore: tentative.score } : {}),
    });
  } catch {
    scope.postMessage({
      id: data.id,
      result: {
        ok: false,
        error: {
          code: "INVALID_RACK",
          message: "The draft does not match your rack.",
        },
      },
    });
  }
};
