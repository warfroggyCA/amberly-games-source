import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoard } from "../src/domain/board";
import {
  currentLiveDraft,
  isLiveDraftInput,
  type LiveDraft,
  type LiveDraftInput,
} from "../src/lib/live-draft";
import { createLiveDraftPublisher } from "../src/lib/live-draft-publisher";
import type { Letter, Placement } from "../src/domain/types";
const tile = (letter: Letter = "C", col = 7): Placement => ({
  row: 7,
  col,
  tile: { letter, blank: false },
});
const identity = {
  gameId: "game-one",
  revision: 0,
  generation: 1,
  streamId: "11111111-1111-4111-8111-111111111111",
};
const input = (): LiveDraftInput => ({
  ...identity,
  sequence: 1,
  kind: "edit",
  placements: [tile()],
});
const game = () => ({
  id: "game-one",
  revision: 0,
  currentPlayerId: "ada",
  status: "active",
  pendingEnd: null,
  board: createBoard(),
});
const draft = (): LiveDraft => ({
  gameId: "game-one",
  revision: 0,
  generation: 1,
  playerId: "ada",
  placements: [tile()],
  score: 6,
  valid: false,
  expiresAt: new Date(Date.now() + 12000).toISOString(),
});
afterEach(() => vi.useRealTimers());
describe("ephemeral live draft boundary", () => {
  it("accepts only bounded, unique placements and a real UUID; never accepts a client score", () => {
    expect(isLiveDraftInput(input())).toBe(true);
    expect(isLiveDraftInput({ ...input(), streamId: "-".repeat(36) })).toBe(
      false,
    );
    expect(isLiveDraftInput({ ...input(), score: 900 })).toBe(false);
    expect(isLiveDraftInput({ ...input(), placements: [tile(), tile()] })).toBe(
      false,
    );
    expect(
      isLiveDraftInput({
        ...input(),
        placements: Array.from({ length: 8 }, (_, i) => tile("C", i)),
      }),
    ).toBe(false);
    expect(isLiveDraftInput({ ...input(), kind: "clear" })).toBe(false);
  });
  it("renders only the current unexpired turn and never modifies the official board/scores", () => {
    const g = game(),
      d = draft();
    expect(currentLiveDraft(d, g)).toEqual(d);
    expect(currentLiveDraft(d, { ...g, scorerGeneration: 2 })).toBeNull();
    expect(g.board[7][7]).toBeNull();
    for (const changed of [
      { revision: 1 },
      { currentPlayerId: "ben" },
      { status: "paused" },
      { pendingEnd: {} },
    ])
      expect(currentLiveDraft(d, { ...g, ...changed })).toBeNull();
    expect(
      currentLiveDraft(
        { ...d, expiresAt: new Date(Date.now() - 1).toISOString() },
        g,
      ),
    ).toBeNull();
    expect(currentLiveDraft({ ...d, placements: [] }, g)).toBeNull();
    const occupied = g.board.map((r) => [...r]);
    occupied[7][7] = tile().tile;
    expect(currentLiveDraft(d, { ...g, board: occupied })).toBeNull();
  });
});
describe("ordered live publisher", () => {
  it("coalesces quick letters, serializes requests, and sends clear after the last edit", async () => {
    vi.useFakeTimers();
    let finish!: (result: unknown) => void;
    const send = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ accepted: true });
    const publisher = createLiveDraftPublisher(identity, send);
    publisher.update([tile()]);
    publisher.update([tile(), tile("A", 8)]);
    await vi.advanceTimersByTimeAsync(250);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].placements).toHaveLength(2);
    publisher.update([tile(), tile("A", 8), tile("T", 9)]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(1);
    finish({ accepted: true });
    await vi.advanceTimersByTimeAsync(250);
    expect(send.mock.calls[1][0].placements).toHaveLength(3);
    publisher.stop();
    expect(send.mock.calls[2]).toEqual([
      { ...identity, sequence: 3, kind: "clear", placements: [] },
      true,
    ]);
  });
  it("never treats a lost response retry as a new human edit or repeatedly reclaims from another device", async () => {
    vi.useFakeTimers();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValue({ accepted: false });
    const publisher = createLiveDraftPublisher(identity, send);
    publisher.update([tile()]);
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(2000);
    expect(send.mock.calls[0][0].kind).toBe("edit");
    expect(send.mock.calls[1][0].kind).toBe("heartbeat");
    publisher.heartbeat();
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(2);
    publisher.update([tile(), tile("A", 8)]);
    await vi.advanceTimersByTimeAsync(250);
    expect(send.mock.calls[2][0].kind).toBe("edit");
    publisher.stop();
  });
  it("retries the newest input after connection loss and suppresses empty idle traffic", async () => {
    vi.useFakeTimers();
    let fail!: (reason: unknown) => void;
    const send = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValue({ accepted: true });
    const publisher = createLiveDraftPublisher(identity, send);
    publisher.update([]);
    publisher.heartbeat();
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).not.toHaveBeenCalled();
    publisher.update([tile()]);
    await vi.advanceTimersByTimeAsync(250);
    publisher.update([tile("A")]);
    fail(new Error("offline"));
    await vi.advanceTimersByTimeAsync(2250);
    expect(send.mock.calls[1][0]).toMatchObject({
      kind: "edit",
      placements: [tile("A")],
    });
    publisher.stop();
  });
});
