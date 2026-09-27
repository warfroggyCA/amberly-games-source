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
    const crop = photoCrop(800, 400, frame);
    expect(crop.size).toBe(200);
    expect(crop.x).toBeCloseTo(270);
    expect(crop.y).toBeCloseTo(120);
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
  it("allows subpixel movement past every edge at minimum zoom", () => {
    const frame = movePhotoFrame(
      { zoom: 1, x: 0.5, y: 0.5 },
      256,
      256,
      256,
      [{ x: 100, y: 100 }],
      [{ x: 100.25, y: 130.25 }],
    );
    expect(photoCrop(256, 256, frame)).toEqual({
      size: 256,
      x: -0.25,
      y: -30.25,
    });
    const reverse = movePhotoFrame(
      frame,
      256,
      256,
      256,
      [{ x: 100.25, y: 130.25 }],
      [{ x: 99.75, y: 99.75 }],
    );
    expect(photoCrop(256, 256, reverse)).toEqual({
      size: 256,
      x: 0.25,
      y: 0.25,
    });
  });
  it("can shrink below frame size while keeping zoom bounded", () => {
    const before = [
      { x: 50, y: 100 },
      { x: 150, y: 100 },
    ];
    const next = movePhotoFrame(
      { zoom: 1, x: 0.5, y: 0.5 },
      400,
      800,
      200,
      before,
      [
        { x: 100, y: 100 },
        { x: 100, y: 100 },
      ],
    );
    expect(next.zoom).toBe(0.25);
    expect(photoCrop(400, 800, next).size).toBe(1600);
    const large = movePhotoFrame(
      { zoom: 1, x: 0.5, y: 0.5 },
      400,
      800,
      200,
      before,
      [
        { x: -1000, y: 100 },
        { x: 1000, y: 100 },
      ],
    );
    expect(large.zoom).toBe(4);
  });
});
