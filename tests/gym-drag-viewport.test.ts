import { describe, expect, test } from "vitest";
import {
  panDragBoard,
  zoomDragBoard,
  type DragBounds,
} from "../src/lib/gym-drag-viewport";

const board: DragBounds = { x: 24, y: 110, width: 330, height: 330 };
const viewport = board;

describe("Gym touch-drag viewport", () => {
  test.each([
    [0, 0],
    [0, 330],
    [330, 0],
    [330, 330],
    [165, 165],
    [27, 235],
  ])("zoom preserves the aimed-at board point at %s,%s", (x, y) => {
    const anchor = { x: board.x + x, y: board.y + y };
    for (const scale of [1, 1.25, 1.8, 2]) {
      const transform = zoomDragBoard(board, viewport, anchor, scale);
      expect(board.x + transform.x + x * scale).toBeCloseTo(anchor.x);
      expect(board.y + transform.y + y * scale).toBeCloseTo(anchor.y);
    }
  });

  test("a partially visible board anchors correctly and pans within the visible part", () => {
    const clipped = { x: 40, y: 180, width: 280, height: 170 };
    const anchor = { x: 175, y: 250 };
    const transform = zoomDragBoard(board, clipped, anchor, 2);
    expect(board.x + transform.x + (anchor.x - board.x) * 2).toBe(anchor.x);
    expect(board.y + transform.y + (anchor.y - board.y) * 2).toBe(anchor.y);
    const pan = panDragBoard(
      board,
      clipped,
      transform,
      { x: 40, y: 180 },
      0.04,
    );
    expect(pan.x).toBeGreaterThan(transform.x);
    expect(pan.y).toBeGreaterThan(transform.y);
    expect(board.x + pan.x).toBeLessThanOrEqual(clipped.x);
    expect(board.y + pan.y).toBeLessThanOrEqual(clipped.y);
  });

  test.each([
    ["top left", 24, 110, 0, 0],
    ["bottom right", 354, 440, -330, -330],
    ["top right", 354, 110, -330, 0],
    ["bottom left", 24, 440, 0, -330],
  ])(
    "edge pan reaches %s without exposing empty space",
    (_, x, y, endX, endY) => {
      let transform = zoomDragBoard(board, viewport, { x: 189, y: 275 }, 2);
      for (let frame = 0; frame < 240; frame++) {
        transform = panDragBoard(board, viewport, transform, { x, y }, 1 / 60);
        expect(transform.x).toBeGreaterThanOrEqual(-330);
        expect(transform.x).toBeLessThanOrEqual(0);
        expect(transform.y).toBeGreaterThanOrEqual(-330);
        expect(transform.y).toBeLessThanOrEqual(0);
      }
      expect(transform.x).toBe(endX);
      expect(transform.y).toBe(endY);
    },
  );

  test("holding still in the centre or outside the viewport does not pan", () => {
    const transform = zoomDragBoard(board, viewport, { x: 189, y: 275 }, 2);
    for (const aim of [
      { x: 189, y: 275 },
      { x: 23, y: 275 },
      { x: 189, y: 441 },
    ])
      expect(panDragBoard(board, viewport, transform, aim, 0.03)).toEqual(
        transform,
      );
  });

  test("pan speed is independent of frame rate and bounded after interruption", () => {
    const initial = zoomDragBoard(board, viewport, { x: 189, y: 275 }, 2);
    const aim = { x: 352, y: 275 };
    let sixty = initial;
    let thirty = initial;
    for (let frame = 0; frame < 15; frame++) {
      thirty = panDragBoard(board, viewport, thirty, aim, 1 / 30);
      sixty = panDragBoard(board, viewport, sixty, aim, 1 / 60);
      sixty = panDragBoard(board, viewport, sixty, aim, 1 / 60);
    }
    expect(sixty.x).toBeCloseTo(thirty.x);
    expect(panDragBoard(board, viewport, initial, aim, 30)).toEqual(
      panDragBoard(board, viewport, initial, aim, 0.04),
    );
    expect(panDragBoard(board, viewport, initial, aim, -2)).toEqual(initial);
  });
});
