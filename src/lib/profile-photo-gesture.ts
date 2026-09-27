import { photoCrop, type PhotoFrame } from "./player-profile";

export type PhotoPointer = { x: number; y: number };

// Points are relative to the crop window. Keep the source pixel under the
// gesture's midpoint in place while zooming and allow that midpoint to move.
export function movePhotoFrame(
  frame: PhotoFrame,
  width: number,
  height: number,
  windowSize: number,
  before: PhotoPointer[],
  after: PhotoPointer[],
): PhotoFrame {
  if (!windowSize || !before.length || before.length !== after.length)
    return frame;
  const midpoint = (points: PhotoPointer[]) => ({
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  });
  const distance = (points: PhotoPointer[]) =>
    Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const start = midpoint(before);
  const end = midpoint(after);
  const ratio =
    before.length === 2 && distance(before) > 1
      ? distance(after) / distance(before)
      : 1;
  const zoom = Math.max(0.25, Math.min(4, frame.zoom * ratio));
  const crop = photoCrop(width, height, frame);
  const size = Math.min(width, height) / zoom;
  const position = (origin: number, from: number, to: number, length: number) =>
    (origin + (from * crop.size - to * size) / windowSize + size / 2) / length;
  return {
    zoom,
    x: position(crop.x, start.x, end.x, width),
    y: position(crop.y, start.y, end.y, height),
  };
}
