import {
  analyseCoaching,
  type CoachingAnswer,
} from "../domain/coaching-analysis";
import type { CoachingPosition } from "../domain/turn-coaching";
import { extendLexicon } from "../domain/verified-words";
import { resolveLexicon } from "./lexicons";
export type { CoachingAnswer } from "../domain/coaching-analysis";
const scope = self as unknown as {
  onmessage: (
    event: MessageEvent<{ position: CoachingPosition; rack: string[] }>,
  ) => void;
  postMessage: (answer: CoachingAnswer) => void;
};
scope.onmessage = ({ data }) => {
  try {
    scope.postMessage(
      analyseCoaching(
        data.position,
        data.rack,
        extendLexicon(
          resolveLexicon(data.position.lexicon),
          data.position.verifiedWords,
        ),
      ),
    );
  } catch {
    scope.postMessage({
      status: "unavailable",
      totalMoves: 0,
      best: [],
      histogram: [],
      message:
        "This rack or the game's exact dictionary is unavailable for analysis.",
    });
  }
};
