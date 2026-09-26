/** Crown placement in fractions of the portrait diameter. This is the framing
 * used by the shared result image, so editing previews match the final artwork. */
export const PORTRAIT_CROWN = {
  left: 80 / 380,
  top: -54 / 380,
  width: 220 / 380,
  height: 176 / 380,
} as const;

export function portraitCrownRect(x: number, y: number, diameter: number) {
  return {
    x: x + PORTRAIT_CROWN.left * diameter,
    y: y + PORTRAIT_CROWN.top * diameter,
    width: PORTRAIT_CROWN.width * diameter,
    height: PORTRAIT_CROWN.height * diameter,
  };
}
