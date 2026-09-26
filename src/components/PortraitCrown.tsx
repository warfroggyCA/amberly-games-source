import { PORTRAIT_CROWN } from "../lib/portrait-geometry";
import "./winner-portrait.css";

/** Decorative overlay only; it never participates in photo processing. */
export function PortraitCrown() {
  return (
    // The local SVG is also drawn onto exported result images.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="winner-portrait-crown"
      src="/results/crown.svg"
      alt=""
      draggable={false}
      aria-hidden="true"
      style={{
        left: `${PORTRAIT_CROWN.left * 100}%`,
        top: `${PORTRAIT_CROWN.top * 100}%`,
        width: `${PORTRAIT_CROWN.width * 100}%`,
        height: `${PORTRAIT_CROWN.height * 100}%`,
      }}
    />
  );
}
