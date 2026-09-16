"use client";
import { useSyncExternalStore, type ReactNode } from "react";
import { Modal } from "./Modal";

const query = "(max-width: 900px)";
function subscribe(onChange: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const getSnapshot = () => window.matchMedia(query).matches;
const getServerSnapshot = () => false;
export function useNarrowGameScreen() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
export function GameScorePanel({
  open,
  overlay,
  onClose,
  children,
}: {
  open: boolean;
  overlay: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      id="score-drawer"
      className="score-drawer"
      inert={!open}
      aria-hidden={!open}
    >
      {overlay
        ? open && (
            <Modal
              title="Score sheet"
              className="score-sheet-modal"
              onClose={onClose}
            >
              {children}
            </Modal>
          )
        : children}
    </div>
  );
}
