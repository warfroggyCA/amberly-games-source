import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  createCrokinoleStore,
  type CrokinoleStore,
} from "../src/lib/crokinole-store";
import {
  FamilyRequestError,
  type familyRequest,
} from "../src/lib/shared-store";
import {
  createCrokinoleGame,
  DEFAULT_PIECE_COLOURS,
} from "../src/domain/crokinole";
import type { CrokinoleSharedState } from "../src/lib/crokinole-contract";
const game = createCrokinoleGame({
  schemaVersion: 1,
  rulesVersion: 1,
  id: "game",
  familyId: "family",
  mode: "confirmed",
  createdAt: "2026-09-17T12:00:00Z",
  players: [
    { id: "a", name: "Ada", seatOrder: 0 },
    { id: "b", name: "Ben", seatOrder: 1 },
  ],
  participants: ["a", "b"].map((id, i) => ({
    id,
    name: id,
    playerIds: [id],
    colour: {
      id: DEFAULT_PIECE_COLOURS[i].id,
      name: DEFAULT_PIECE_COLOURS[i].name,
      value: DEFAULT_PIECE_COLOURS[i].value,
    },
  })),
  format: "singles",
  scoringMode: "cumulative_round_totals",
  endCondition: { type: "fixed_rounds", rounds: 4 },
  initialStartingPlayerId: "a",
});
const state = (): CrokinoleSharedState => ({
  games: [structuredClone(game)],
  access: {
    game: {
      scorerUserId: "user",
      generation: 1,
      canScore: true,
      mode: "confirmed",
      concerns: [],
    },
  },
  palette: { revision: 0, colours: structuredClone(DEFAULT_PIECE_COLOURS) },
  nextCursor: null,
  creationEnabled: true,
  draft: null,
});
let stores: CrokinoleStore[] = [];
let request: ReturnType<typeof vi.fn>;
function store() {
  const s = createCrokinoleStore(
    "family",
    "user",
    request as typeof familyRequest,
  );
  stores.push(s);
  return s;
}
async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 15));
}
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  request = vi.fn(async () => state());
  stores = [];
});
afterEach(async () => {
  stores.forEach((s) => s.close());
  await settled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("capability denial retires the rejected draft request and restores read-only access while retaining the local entry", async () => {
  const active = store();
  await active.load("game");
  active.setDraft("game", {
    values: { a: "65", b: "0" },
    editingRoundId: null,
  });
  await active.flush();
  const readonly = state();
  readonly.access.game.canScore = false;
  request.mockImplementation(async (_path: string, body?: unknown) => {
    if (body)
      throw new FamilyRequestError(
        "Scoring permission removed",
        403,
        "PERMISSION_DENIED",
      );
    return readonly;
  });
  await expect(active.syncDraft("game")).rejects.toThrow(
    "Scoring permission removed",
  );
  expect(active.getSnapshot()).toMatchObject({
    status: "ready",
    pending: false,
    accessLost: false,
    drafts: {},
    conflicts: {},
  });
  expect(active.getSnapshot().games).toHaveLength(1);
  expect(active.getSnapshot().access.game.canScore).toBe(false);
  await expect(active.flush()).resolves.toBeUndefined();
  active.close();
  const reloaded = store();
  await reloaded.load("game");
  expect(reloaded.getSnapshot()).toMatchObject({
    status: "ready",
    pending: false,
  });
  request.mockResolvedValue(state());
  await reloaded.refresh("game");
  expect(reloaded.getSnapshot().drafts.game.values).toEqual({
    a: "65",
    b: "0",
  });
});

it("a denied equipment edit leaves allowed scoring and refresh available", async () => {
  const active = store();
  await active.load("game");
  request.mockImplementation(async (_path: string, body?: unknown) => {
    if (body)
      throw new FamilyRequestError(
        "Equipment permission removed",
        403,
        "PERMISSION_DENIED",
      );
    return state();
  });
  await expect(
    active.mutate({
      type: "save-palette",
      expectedRevision: 0,
      colours: DEFAULT_PIECE_COLOURS,
    }),
  ).rejects.toThrow("Equipment permission removed");
  expect(active.getSnapshot()).toMatchObject({
    status: "ready",
    pending: false,
    accessLost: false,
  });
  expect(active.getSnapshot().access.game.canScore).toBe(true);
  const before = request.mock.calls.length;
  await active.refresh("game");
  expect(request.mock.calls.length).toBe(before + 1);
});

it("reload confirms a committed settings request with its original ID without rolling back newer settings", async () => {
  const active = store();
  await active.load();
  request.mockRejectedValueOnce(new FamilyRequestError("Lost response", 0));
  await expect(
    active.mutate({
      type: "save-palette",
      expectedRevision: 0,
      colours: DEFAULT_PIECE_COLOURS,
    }),
  ).rejects.toThrow("Lost response");
  const original = request.mock.calls.find((call) => call[1])![1];
  active.close();
  const newer = state();
  newer.palette = { ...newer.palette, revision: 2 };
  request.mockImplementation(async (_path: string, body?: unknown) =>
    body
      ? { palette: { ...state().palette, revision: 1 }, replayed: true }
      : newer,
  );
  const reopened = store();
  await reopened.load();
  expect(reopened.getSnapshot().pending).toBe(true);
  await reopened.retry();
  expect(request.mock.calls.at(-1)![1]).toEqual(original);
  expect(reopened.getSnapshot()).toMatchObject({
    status: "ready",
    pending: false,
    accessLost: false,
  });
  expect(reopened.getSnapshot().palette!.revision).toBe(2);
});

it("actual membership loss remains distinguishable and retains the exact request without exposing family data", async () => {
  const active = store();
  await active.load("game");
  request.mockRejectedValue(
    new FamilyRequestError("Membership removed", 403, "NOT_A_MEMBER"),
  );
  await expect(
    active.mutate({
      type: "save-palette",
      expectedRevision: 0,
      colours: DEFAULT_PIECE_COLOURS,
    }),
  ).rejects.toThrow("Membership removed");
  expect(active.getSnapshot()).toMatchObject({
    status: "error",
    pending: true,
    accessLost: true,
    games: [],
    access: {},
    drafts: {},
    palette: null,
  });
  await expect(active.flush()).resolves.toBeUndefined();
});

it("an older retained request can recover from capability denial after reload using the same request ID", async () => {
  const first = store();
  await first.load("game");
  first.setDraft("game", {
    values: { a: "65", b: "0" },
    editingRoundId: null,
  });
  await first.flush();
  request.mockRejectedValueOnce(new FamilyRequestError("Unknown outcome", 0));
  await expect(first.syncDraft("game")).rejects.toThrow("Unknown outcome");
  const saved = request.mock.calls.find((call) => call[1])![1];
  first.close();
  const readonly = state();
  readonly.access.game.canScore = false;
  request.mockImplementation(async (_path: string, body?: unknown) => {
    if (body)
      throw new FamilyRequestError(
        "Scoring permission removed",
        403,
        "PERMISSION_DENIED",
      );
    return readonly;
  });
  const reopened = store();
  await reopened.load("game");
  expect(reopened.getSnapshot().pending).toBe(true);
  await expect(reopened.retry()).rejects.toThrow("Scoring permission removed");
  expect(request.mock.calls.filter((call) => call[1]).at(-1)![1]).toEqual(
    saved,
  );
  expect(reopened.getSnapshot()).toMatchObject({
    status: "ready",
    pending: false,
    accessLost: false,
  });
  await reopened.flush();
});
