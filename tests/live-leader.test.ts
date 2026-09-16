import { describe, expect, it } from "vitest";
import { liveLeader } from "../src/lib/live-leader";
const turns = (...ids: string[]) => ids.map((playerId) => ({ playerId }));
describe("one live crown", () => {
  it("awards a higher score even if that player has had more turns", () => {
    expect(liveLeader(["a", "b"], { a: 20, b: 19 }, turns("a"))).toEqual({
      playerId: "a",
      reason: "score",
    });
  });
  it("awards equal points to the player with a turn in hand", () => {
    expect(
      liveLeader(["a", "b"], { a: 20, b: 20 }, turns("a", "b", "a")),
    ).toEqual({ playerId: "b", reason: "turns" });
  });
  it("uses actual play order when points and turns match", () => {
    expect(liveLeader(["b", "a"], { a: 20, b: 20 }, turns("b", "a"))).toEqual({
      playerId: "b",
      reason: "order",
    });
  });
  it("chooses one of several tied players with fewer turns, in play order", () => {
    expect(
      liveLeader(
        ["a", "c", "b", "d"],
        { a: 20, b: 20, c: 20, d: 10 },
        turns("a", "c", "b", "d", "a"),
      ),
    ).toEqual({ playerId: "c", reason: "order" });
  });
  it("uses every completed turn, including passes, exchanges and assisted turns", () => {
    const completed = [
      { playerId: "a", type: "play", source: "human" },
      { playerId: "b", type: "pass", source: "human" },
      { playerId: "a", type: "exchange", source: "human" },
      { playerId: "b", type: "play", source: "assisted" },
      { playerId: "a", type: "pass", source: "assisted" },
    ];
    expect(liveLeader(["a", "b"], { a: 20, b: 20 }, completed)).toEqual({
      playerId: "b",
      reason: "turns",
    });
  });
  it("follows effective history after Undo and does not count a provisional turn", () => {
    const history = turns("a", "b", "a");
    expect(liveLeader(["a", "b"], { a: 20, b: 20 }, history)?.playerId).toBe(
      "b",
    );
    expect(
      liveLeader(["a", "b"], { a: 20, b: 20 }, history.slice(0, -1))?.playerId,
    ).toBe("a");
    expect(history).toHaveLength(3);
  });
  it("does not crown zero scores or a solo practice player", () => {
    expect(liveLeader(["a", "b"], { a: 0, b: 0 }, [])).toBeNull();
    expect(liveLeader(["a"], { a: 20 }, turns("a"))).toBeNull();
  });
  it("ignores nonplayer scores and unavailable totals", () => {
    expect(liveLeader(["a", "b"], { a: 20, b: NaN, other: 1000 }, [])).toEqual({
      playerId: "a",
      reason: "score",
    });
    expect(liveLeader(["a", "b"], {}, [])).toBeNull();
  });
});
