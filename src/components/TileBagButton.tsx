"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Board } from "../domain/types";
import type { TileSupply } from "../domain/board";
import { LetterInventory } from "./LetterInventory";
import "./tile-bag-button.css";

export function TileBagButton({
  remaining,
  board,
  tileSupply,
  assisted = false,
  onOpen,
  onCheckCounts,
  checkCountsDisabled = false,
}: {
  remaining: number;
  board: Board;
  tileSupply?: TileSupply | null;
  assisted?: boolean;
  onOpen?: () => void;
  onCheckCounts?: () => void;
  checkCountsDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();

  function closeAndReturnFocus() {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!open) return;
    function keepOpenerVisible() {
      const panel = panelRef.current;
      const button = buttonRef.current;
      if (!panel || !button) return;
      panel.style.removeProperty("top");
      panel.style.removeProperty("max-height");
      const bounds = panel.getBoundingClientRect();
      const opener = button.getBoundingClientRect();
      if (
        bounds.left < opener.right &&
        bounds.right > opener.left &&
        bounds.top < opener.bottom &&
        bounds.bottom > opener.top
      ) {
        // Results pages can place the bag below the header. Leave that bag visible too.
        const top = opener.bottom + 8;
        panel.style.top = `${top}px`;
        panel.style.maxHeight = `calc(100dvh - ${top + 24}px - env(safe-area-inset-bottom))`;
      }
    }
    keepOpenerVisible();
    panelRef.current?.focus({ preventScroll: true });
    function dismissOutside(event: Event) {
      if (
        event.target instanceof Node &&
        !panelRef.current?.contains(event.target) &&
        !buttonRef.current?.contains(event.target)
      ) {
        // Leave focus and the outside action with the control the user chose.
        setOpen(false);
      }
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus({ preventScroll: true });
    }
    window.addEventListener("resize", keepOpenerVisible);
    window.addEventListener("scroll", keepOpenerVisible);
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside, true);
    document.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      window.removeEventListener("resize", keepOpenerVisible);
      window.removeEventListener("scroll", keepOpenerVisible);
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside, true);
      document.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="tile-bag-button"
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        aria-label={`Tiles remaining in bag: ${remaining}`}
        title={`${remaining} tiles expected in the bag`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
      >
        <span className="tabletop-bag-count" aria-hidden="true">
          {remaining}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="tile-bag-panel"
          >
            <div className="modal-heading">
              <h2 id={titleId}>Tiles remaining</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close tiles remaining"
                onClick={closeAndReturnFocus}
              >
                ×
              </button>
            </div>
            <LetterInventory
              board={board}
              tileSupply={tileSupply}
              expectedBagCount={remaining}
              assisted={assisted}
            />
            {onCheckCounts && (
              <button
                type="button"
                className="button primary tile-bag-count-check"
                disabled={checkCountsDisabled}
                onClick={() => {
                  closeAndReturnFocus();
                  onCheckCounts();
                }}
              >
                Check tile counts
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
