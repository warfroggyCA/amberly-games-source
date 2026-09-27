import { describe, expect, it } from "vitest";
import { photoCrop } from "../src/lib/player-profile";
import { movePhotoFrame } from "../src/lib/profile-photo-gesture";

describe("profile photo gestures", () => {
  it("moves the image with a finger in both axes", () => {
    const frame = movePhotoFrame(
      { zoom: 2, x: 0.5, y: 0.5 },
      800,
      400,
      200,
      [{ x: 100, y: 100 }],
      [{ x: 130, y: 80 }],
    );
    expect(photoCrop(800, 400, frame)).toEqual({ size: 200, x: 270, y: 120 });
  });
  it("anchors a pinch to its moving midpoint and reverses without drift", () => {
    const frame = { zoom: 2, x: 0.5, y: 0.5 };
    const before = [
      { x: 40, y: 80 },
      { x: 120, y: 80 },
    ];
    const after = [
      { x: 30, y: 100 },
      { x: 150, y: 100 },
    ];
    const next = movePhotoFrame(frame, 800, 400, 200, before, after);
    expect(next.zoom).toBe(3);
    const startCrop = photoCrop(800, 400, frame);
    const endCrop = photoCrop(800, 400, next);
    expect(endCrop.x + (90 / 200) * endCrop.size).toBeCloseTo(
      startCrop.x + (80 / 200) * startCrop.size,
    );
    expect(endCrop.y + (100 / 200) * endCrop.size).toBeCloseTo(
      startCrop.y + (80 / 200) * startCrop.size,
    );
    const restored = movePhotoFrame(next, 800, 400, 200, after, before);
    expect(restored.zoom).toBeCloseTo(2);
    expect(restored.x).toBeCloseTo(0.5);
    expect(restored.y).toBeCloseTo(0.5);
  });
  it("limits zoom and panning so portrait and landscape crops stay covered", () => {
    for (const [width, height] of [
      [800, 400],
      [400, 800],
    ]) {
      for (const distance of [0, 10000]) {
        const next = movePhotoFrame(
          { zoom: 2, x: 0.5, y: 0.5 },
          width,
          height,
          200,
          [
            { x: 50, y: 100 },
            { x: 150, y: 100 },
          ],
          [
            { x: -1000, y: 1000 },
            { x: -1000 + distance, y: 1000 },
          ],
        );
        expect(next.zoom).toBe(distance === 0 ? 1 : 4);
        const crop = photoCrop(width, height, next);
        expect(crop.x).toBeGreaterThanOrEqual(0);
        expect(crop.y).toBeGreaterThanOrEqual(0);
        expect(crop.x + crop.size).toBeLessThanOrEqual(width);
        expect(crop.y + crop.size).toBeLessThanOrEqual(height);
      }
    }
  });
});
