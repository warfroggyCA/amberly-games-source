import type { ReactNode } from "react";
import { colourForeground } from "../../domain/crokinole";

/** A disc is always paired with a readable name; its colour is never the label. */
export function Disc({
  value,
  label,
  initial,
  children,
}: {
  value: string;
  label: string;
  initial?: string;
  children?: ReactNode;
}) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#d9c499";
  return (
    <span
      className="crokinole-disc"
      title={label}
      aria-label={`${label} disc`}
      style={{ background: hex, color: colourForeground(hex) }}
    >
      {children ?? initial ?? ""}
    </span>
  );
}
