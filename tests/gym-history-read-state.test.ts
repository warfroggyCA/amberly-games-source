import { expect, it } from "vitest";
import {
  historyAccessDenied,
  sameGymOwner,
  validHistory,
  validHistoryDetail,
} from "../src/lib/gym-history-read-state";
it("requires every owner dimension", () => {
  const owner = { familyId: "family", userId: "user", playerId: "player" };
  expect(sameGymOwner(owner, { ...owner })).toBe(true);
  for (const key of ["familyId", "userId", "playerId"] as const)
    expect(sameGymOwner(owner, { ...owner, [key]: "other" })).toBe(false);
});
it("classifies access from HTTP status independently of JSON", () => {
  for (const error of [
    { status: 401 },
    { status: 403 },
    { code: "NO_PROFILE" },
    { code: "PROFILE_CHANGED" },
  ])
    expect(historyAccessDenied(error)).toBe(true);
  for (const error of [
    { status: 503 },
    new DOMException("Timeout", "TimeoutError"),
    new TypeError("Offline"),
    new Error("Invalid response"),
  ])
    expect(historyAccessDenied(error)).toBe(false);
});
it("rejects malformed successful payloads without treating them as denials", () => {
  for (const value of [
    null,
    {},
    {
      identity: { familyId: "f", userId: "u", playerId: "p" },
      sessions: [],
      nextCursor: null,
      progress: {},
    },
  ])
    expect(validHistory(value)).toBe(false);
  for (const value of [
    null,
    { id: "wanted" },
    { id: "wrong", puzzle: {}, events: [], replay: false },
  ])
    expect(validHistoryDetail(value, "wanted")).toBe(false);
});
