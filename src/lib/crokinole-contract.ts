import type {
  CrokinoleCommand,
  CrokinoleDefinition,
  CrokinoleGame,
} from "../domain/crokinole";
import type { PieceColour } from "../domain/crokinole";
import type { GameProtest } from "./shared-contract";
import type { CrokinoleDefaults } from "../domain/crokinole-defaults";
export type CrokinolePalette = {
  revision: number;
  colours: PieceColour[];
  defaults?: CrokinoleDefaults;
};
export type CrokinoleDraft = {
  revision: number;
  baseRevision: number;
  generation: number;
  values: Record<string, string>;
  editingRoundId: string | null;
};
export type CrokinoleAccess = {
  scorerUserId: string;
  generation: number;
  canScore: boolean;
  mode: "confirmed" | "practice";
  concerns: GameProtest[];
};
export type CrokinoleSharedState = {
  games: CrokinoleGame[];
  access: Record<string, CrokinoleAccess>;
  palette: CrokinolePalette;
  draft?: CrokinoleDraft | null;
  nextCursor: string | null;
  creationEnabled: boolean;
};
export type CrokinoleOperation =
  | {
      type: "rematch";
      gameId: string;
      newGameId: string;
      expectedRevision: number;
    }
  | {
      type: "create-game";
      definition: CrokinoleDefinition;
      paletteRevision: number;
    }
  | {
      type: "command";
      gameId: string;
      generation: number;
      command: CrokinoleCommand;
      expectedDraftRevision: number;
      amendmentReason?: string;
    }
  | {
      type: "save-draft";
      gameId: string;
      generation: number;
      expectedRevision: number;
      expectedDraftRevision: number;
      values: Record<string, string>;
      editingRoundId: string | null;
    }
  | {
      type: "save-defaults";
      expectedRevision: number;
      defaults: CrokinoleDefaults;
    }
  | { type: "save-palette"; expectedRevision: number; colours: PieceColour[] }
  | {
      type: "take-over";
      gameId: string;
      expectedRevision: number;
      generation: number;
      reason: string;
    }
  | {
      type: "delete-practice" | "remove-game";
      gameId: string;
      expectedRevision: number;
      reason: string;
    }
  | {
      type: "report-concern";
      gameId: string;
      expectedRevision: number;
      reason: string;
    }
  | {
      type: "resolve-concern";
      gameId: string;
      expectedRevision: number;
      concernId: string;
      outcome: "dismissed" | "upheld";
      reason: string;
    };
export type CrokinoleMutation = {
  requestId: string;
  operation: CrokinoleOperation;
};
export type CrokinoleMutationResult = {
  game?: CrokinoleGame;
  access?: CrokinoleAccess;
  draft?: CrokinoleDraft | null;
  palette?: CrokinolePalette;
  removedGameId?: string;
  replayed?: boolean;
};
