import * as preview from "./preview-store";
import type { SharedState } from "./shared-contract";

export type ScorerSnapshot = ReturnType<typeof preview.getSnapshot> & {
  shared?: SharedState;
  unresolved?: boolean;
  scoringElsewhere?: boolean;
  draftConflicts?: string[];
};
export type ScorerStore = {
  mode: "local" | "shared";
  subscribe: typeof preview.subscribe;
  getSnapshot: () => ScorerSnapshot;
  getServerSnapshot: () => ScorerSnapshot;
  load: () => Promise<void>;
  update: typeof preview.updatePreview;
  downloadBackup: () => Promise<void>;
  setCreationMode?: (mode: "confirmed" | "practice") => void;
  canScore?: (gameId: string) => boolean;
  canEditPlayer?: (playerId: string) => boolean;
  refresh?: () => Promise<void>;
  loadMore?: () => Promise<void>;
  retry?: () => Promise<void>;
  discardDraftConflict?: (
    gameId: string,
    expectedRevision: number,
  ) => Promise<void>;
  exportWorkspace?: () => void;
};
export const localScorerStore: ScorerStore = {
  mode: "local",
  subscribe: preview.subscribe,
  getSnapshot: preview.getSnapshot,
  getServerSnapshot: preview.getServerSnapshot,
  load: preview.loadPreview,
  update: preview.updatePreview,
  downloadBackup: preview.downloadBackup,
};
