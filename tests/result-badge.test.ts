import { afterEach, describe, expect, it, vi } from "vitest";
import {
  badgeCharacters,
  badgeNameRows,
  makeResultBadge,
} from "../src/lib/result-badge";

describe("winner name lettering", () => {
  it("keeps spaces, punctuation and team membership", () => {
    expect(badgeCharacters("Doug & Erin").join("")).toBe("DOUG & ERIN");
    expect(badgeCharacters("O’Neil").join("")).toBe("O’NEIL");
  });
  it("keeps accented and joined characters together", () => {
    expect(badgeCharacters("Jose\u0301")).toEqual(["J", "O", "S", "É"]);
    expect(badgeCharacters("👩‍👩‍👦")).toHaveLength(1);
  });
});

it("wraps long team names without dropping either partner", () => {
  expect(badgeNameRows("Cristine & Nathan").join(" ")).toBe(
    "Cristine & Nathan",
  );
  expect(badgeNameRows("Cristine & Nathan")).toHaveLength(2);
  expect(badgeNameRows("Doug")).toEqual(["Doug"]);
});
afterEach(() => vi.unstubAllGlobals());
it("fails clearly when artwork cannot load", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  await expect(
    makeResultBadge(
      {
        gameId: "test",
        game: "Scrabble",
        winners: [{ name: "Doug", score: 312 }],
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow("Badge artwork is unavailable");
});
