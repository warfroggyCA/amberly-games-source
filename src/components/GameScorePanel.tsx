"use client";
import type { ReactNode } from "react";
import { Modal } from "./Modal";
import "./score-drawer.css";

export function GameScorePanel({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <Modal title="Score sheet" className="score-sheet-modal" onClose={onClose}>
      {children}
    </Modal>
  );
}
