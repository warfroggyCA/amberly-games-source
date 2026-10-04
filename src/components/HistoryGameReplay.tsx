"use client";
import { useEffect, useState } from "react";
import { readGameForReplay } from "../lib/shared-store";
import { GameReplay } from "./GameReplay";

export function HistoryGameReplay({
  gameId,
  userId,
  familyId,
  onClose,
}: {
  gameId: string;
  userId: string;
  familyId: string;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<Awaited<
    ReturnType<typeof readGameForReplay>
  > | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function refresh() {
      if (loading || document.visibilityState !== "visible") return;
      loading = true;
      try {
        const next = await readGameForReplay(
          gameId,
          userId,
          familyId,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setRecord(next);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted) {
          setRecord(null);
          setError(
            "This game is unavailable. It may have been removed or your access may have changed. Return to history and try again.",
          );
        }
      } finally {
        loading = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    const visible = () => void refresh();
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [gameId, userId, familyId]);
  return record ? (
    <GameReplay
      key={`${gameId}:${record.game.revision}`}
      {...record}
      onClose={onClose}
    />
  ) : (
    <main className="hub-content">
      <h1>Game replay</h1>
      <p role={error ? "alert" : "status"}>
        {error || "Loading recorded game…"}
      </p>
      <button className="button light" onClick={onClose}>
        Back to history
      </button>
    </main>
  );
}
