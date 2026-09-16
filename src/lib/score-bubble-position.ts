import type { Direction } from "../domain/types";

export type ScreenRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
type Point = { left: number; top: number };
const GAP = 5;

/** Prefer the side of a vertical word, and never cover a visible tile or cursor. */
export function positionScoreBubble(
  anchor: ScreenRect,
  size: { width: number; height: number },
  bounds: ScreenRect,
  obstacles: readonly ScreenRect[],
  direction: Direction,
): Point | null {
  const { width, height } = size;
  if (
    width <= 0 ||
    height <= 0 ||
    bounds.right - bounds.left < width ||
    bounds.bottom - bounds.top < height
  )
    return null;
  const clampX = (x: number) =>
    Math.max(bounds.left, Math.min(x, bounds.right - width));
  const clampY = (y: number) =>
    Math.max(bounds.top, Math.min(y, bounds.bottom - height));
  const middleY = (anchor.top + anchor.bottom - height) / 2;
  const middleX = (anchor.left + anchor.right - width) / 2;
  const sides = [
    { left: anchor.right + GAP, top: middleY },
    { left: anchor.left - width - GAP, top: middleY },
  ];
  const ends = [
    { left: middleX, top: anchor.top - height - GAP },
    { left: middleX, top: anchor.bottom + GAP },
  ];
  const candidates =
    direction === "down" ? [...sides, ...ends] : [...ends, ...sides];
  // Search a bounded set of nearby alternatives, including board gutters, when
  // adjoining words occupy the preferred sides. Never clamp over an obstacle.
  const xs = [clampX(middleX), bounds.left, bounds.right - width];
  const ys = [clampY(middleY), bounds.top, bounds.bottom - height];
  for (const rect of obstacles) {
    for (const x of [rect.right + GAP, rect.left - width - GAP])
      for (const y of ys) candidates.push({ left: x, top: y });
    for (const y of [rect.top - height - GAP, rect.bottom + GAP])
      for (const x of xs) candidates.push({ left: x, top: y });
  }
  const clear = ({ left, top }: Point) =>
    !obstacles.some(
      (rect) =>
        left < rect.right + GAP &&
        left + width > rect.left - GAP &&
        top < rect.bottom + GAP &&
        top + height > rect.top - GAP,
    );
  const preferred = candidates
    .slice(0, 4)
    .map((point) => ({ left: clampX(point.left), top: clampY(point.top) }))
    .find(clear);
  if (preferred) return preferred;
  const alternatives = candidates
    .slice(4)
    .map((point) => ({ left: clampX(point.left), top: clampY(point.top) }))
    .filter(clear);
  alternatives.sort(
    (a, b) =>
      Math.hypot(a.left - middleX, a.top - middleY) -
      Math.hypot(b.left - middleX, b.top - middleY),
  );
  return alternatives[0] ?? null;
}
