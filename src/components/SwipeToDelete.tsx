"use client";
import { useId, useRef, useState, type ReactNode } from "react";
import "./swipe-to-delete.css";

const REVEAL_WIDTH = 88;
export function SwipeToDelete({
  children,
  disabled,
  onDelete,
  actionLabel = "Delete practice game…",
}: {
  children: ReactNode;
  disabled: boolean;
  onDelete: () => void;
  actionLabel?: string;
}) {
  const actionId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    start: number;
    offset: number;
    horizontal: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const offset = disabled ? 0 : (dragOffset ?? (revealed ? -REVEAL_WIDTH : 0));
  const close = () => {
    setRevealed(false);
    setDragOffset(null);
  };
  return (
    <div
      className="swipe-game"
      onKeyDown={(e) => {
        if (e.key === "Escape" && revealed) {
          e.stopPropagation();
          close();
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) close();
      }}
    >
      <div
        className={`swipe-game-front${dragOffset !== null ? " is-dragging" : ""}`}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={(e) => {
          suppressClick.current = false;
          if (
            disabled ||
            !e.isPrimary ||
            e.button !== 0 ||
            (e.target as Element).closest(".swipe-game-toggle")
          )
            return;
          const start = revealed ? -REVEAL_WIDTH : 0;
          gesture.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            start,
            offset: start,
            horizontal: false,
          };
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g || g.id !== e.pointerId || disabled) return;
          const dx = e.clientX - g.x;
          const dy = e.clientY - g.y;
          if (!g.horizontal) {
            if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
              gesture.current = null;
              return;
            }
            if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy)) return;
            g.horizontal = true;
            suppressClick.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          g.offset = Math.max(-REVEAL_WIDTH, Math.min(0, g.start + dx));
          setDragOffset(g.offset);
        }}
        onPointerUp={(e) => {
          const g = gesture.current;
          if (!g || g.id !== e.pointerId) return;
          if (g.horizontal) setRevealed(g.offset <= -REVEAL_WIDTH / 2);
          gesture.current = null;
          setDragOffset(null);
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setDragOffset(null);
        }}
        onLostPointerCapture={(e) => {
          if (e.target !== e.currentTarget) return;
          gesture.current = null;
          setDragOffset(null);
        }}
        onClickCapture={(e) => {
          if (suppressClick.current && e.detail !== 0) {
            e.preventDefault();
            e.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        {children}
        <button
          type="button"
          className="swipe-game-toggle"
          ref={toggleRef}
          aria-label={revealed ? "Hide delete action" : "Show delete action"}
          title="Swipe left or tap to show Delete"
          aria-expanded={revealed && !disabled}
          aria-controls={actionId}
          disabled={disabled}
          onClick={() => setRevealed(!revealed)}
        >
          ···
        </button>
      </div>
      <button
        id={actionId}
        className="swipe-game-delete"
        type="button"
        aria-label={actionLabel}
        aria-hidden={!revealed || disabled}
        tabIndex={revealed && !disabled ? 0 : -1}
        disabled={!revealed || disabled}
        onClick={() => {
          toggleRef.current?.focus({ preventScroll: true });
          close();
          onDelete();
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" />
        </svg>
        Delete
      </button>
    </div>
  );
}
