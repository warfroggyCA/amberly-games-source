import { describe, expect, it } from "vitest";
import {
  positionScoreBubble,
  type ScreenRect,
} from "../src/lib/score-bubble-position";

const rect = (
  left: number,
  top: number,
  width = 30,
  height = 30,
): ScreenRect => ({ left, top, right: left + width, bottom: top + height });
const size = { width: 90, height: 32 };
const bounds = rect(0, 0, 390, 450);
function clear(
  point: { left: number; top: number } | null,
  tiles: ScreenRect[],
) {
  expect(point).not.toBeNull();
  if (!point) return;
  expect(point.left).toBeGreaterThanOrEqual(bounds.left);
  expect(point.top).toBeGreaterThanOrEqual(bounds.top);
  expect(point.left + size.width).toBeLessThanOrEqual(bounds.right);
  expect(point.top + size.height).toBeLessThanOrEqual(bounds.bottom);
  for (const tile of tiles)
    expect(
      point.left < tile.right &&
        point.left + size.width > tile.left &&
        point.top < tile.bottom &&
        point.top + size.height > tile.top,
    ).toBe(false);
}
describe("score bubble avoids entered and existing letters", () => {
  it("sits beside a vertical word, clear of the preceding letter and following cursor", () => {
    const tiles = [0, 1, 2, 3].map((index) => rect(150, 100 + index * 30));
    const point = positionScoreBubble(tiles[2], size, bounds, tiles, "down");
    clear(point, tiles);
    expect(point!.left).toBe(185);
  });
  it("switches to the left at the right edge without clamping over the word", () => {
    const tiles = [rect(350, 300), rect(350, 330), rect(350, 360)];
    const point = positionScoreBubble(tiles[1], size, bounds, tiles, "down");
    clear(point, tiles);
    expect(point!.left + size.width).toBeLessThan(350);
  });
  it("moves below a horizontal word at the upper edge", () => {
    const tiles = [0, 1, 2, 3].map((index) => rect(50 + index * 30, 0));
    const point = positionScoreBubble(tiles[2], size, bounds, tiles, "across");
    clear(point, tiles);
    expect(point!.top).toBe(35);
  });
  it("avoids neighbouring committed tiles as well as the current word", () => {
    const tiles = [
      rect(150, 160),
      rect(185, 150, 90, 45),
      rect(55, 150, 90, 45),
      rect(150, 130),
      rect(150, 190),
    ];
    clear(positionScoreBubble(tiles[0], size, bounds, tiles, "down"), tiles);
  });
  it("uses the external dock if a crowded or tiny board has no clear space", () => {
    expect(
      positionScoreBubble(rect(150, 160), size, bounds, [bounds], "down"),
    ).toBeNull();
    expect(
      positionScoreBubble(rect(0, 0), size, rect(0, 0, 40, 25), [], "across"),
    ).toBeNull();
  });
});
