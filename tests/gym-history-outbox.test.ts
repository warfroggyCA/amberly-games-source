import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import {
  queueGymEvent,
  pendingGymEvents,
  acknowledgeGymEvent,
} from "../src/lib/gym-history-outbox";
import { isGymWrite, type GymWrite } from "../src/lib/gym-history-contract";
import type { Puzzle } from "../src/domain/gym/model";
describe("Gym pending saves", () => {
  it("keeps profiles/accounts isolated, preserves order and only removes acknowledged events", async () => {
    const owner = {
      familyId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      playerId: "one",
    };
    const data: GymWrite = {
      sessionId: crypto.randomUUID(),
      playerId: "one",
      puzzle: {} as Puzzle,
      event: {
        id: crypto.randomUUID(),
        sequence: 1,
        occurredAt: new Date().toISOString(),
        payload: { type: "solve" },
      },
    };
    await queueGymEvent(owner, {
      ...data,
      event: { ...data.event, id: crypto.randomUUID(), sequence: 2 },
    });
    await queueGymEvent(owner, data);
    expect(
      (await pendingGymEvents(owner)).map((r) => r.data.event.sequence),
    ).toEqual([1, 2]);
    expect(await pendingGymEvents({ ...owner, playerId: "two" })).toEqual([]);
    expect(
      await pendingGymEvents({ ...owner, userId: crypto.randomUUID() }),
    ).toEqual([]);
    await expect(queueGymEvent(owner, data)).rejects.toBeTruthy();
    const rows = await pendingGymEvents(owner);
    await acknowledgeGymEvent(rows[0].key);
    expect(
      (await pendingGymEvents(owner)).map((r) => r.data.event.sequence),
    ).toEqual([2]);
  });
  it("rejects malformed events and assessment references", () => {
    const data: GymWrite = {
      sessionId: crypto.randomUUID(),
      playerId: "one",
      puzzle: {} as Puzzle,
      event: {
        id: crypto.randomUUID(),
        sequence: 1,
        occurredAt: new Date().toISOString(),
        payload: { type: "hint", level: 1 },
      },
    };
    expect(isGymWrite(data)).toBe(true);
    expect(isGymWrite({ ...data, event: { ...data.event, sequence: 0 } })).toBe(
      false,
    );
    expect(
      isGymWrite({
        ...data,
        event: { ...data.event, payload: { type: "hint", level: 4 } },
      }),
    ).toBe(false);
    expect(
      isGymWrite({
        ...data,
        event: {
          ...data.event,
          payload: {
            type: "score",
            attemptId: "other",
            points: 10,
            rank: 1,
            percentage: 100,
          },
        },
      }),
    ).toBe(false);
  });
});
