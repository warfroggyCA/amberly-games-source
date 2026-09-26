"use client";
import { useEffect, useRef, useState } from "react";
import type { GameState } from "../domain/game";
import type { Draft } from "../lib/preview-store";
import {
  currentLiveDraft,
  LIVE_DRAFT_POLL_MS,
  type LiveDraft,
  type LiveDraftInput,
} from "../lib/live-draft";
import { createLiveDraftPublisher } from "../lib/live-draft-publisher";
export type LiveContext = { userId: string; generation: number };
async function requestDraft(
  userId: string,
  body?: LiveDraftInput,
  gameId?: string,
  closing = false,
  signal?: AbortSignal,
) {
  const response = await fetch(
    body
      ? "/api/family/draft"
      : `/api/family/draft?gameId=${encodeURIComponent(gameId!)}`,
    {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: {
        "X-Scrabble-User": userId,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      keepalive: closing,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(6000)])
        : AbortSignal.timeout(6000),
    },
  );
  if (!response.ok) throw new Error("Live preview unavailable");
  return response.json();
}
export function useLiveDraft(
  game: GameState | null,
  draft: Draft | undefined,
  canPublish: boolean,
  context?: LiveContext,
) {
  const [incoming, setIncoming] = useState<LiveDraft | null>(null);
  const [failedConnection, setFailedConnection] = useState<{
    gameId: string;
    revision: number;
    generation: number;
    userId: string;
  } | null>(null);
  const latest = useRef(draft);
  const publisher = useRef<ReturnType<typeof createLiveDraftPublisher> | null>(
    null,
  );
  const gameRef = useRef(game);
  useEffect(() => {
    gameRef.current = game;
  }, [game]);
  const gameId = game?.id;
  const revision = game?.revision;
  const active = game?.status === "active" && !game.pendingEnd;
  const userId = context?.userId;
  const generation = context?.generation;
  useEffect(() => {
    latest.current = draft;
    publisher.current?.update(
      draft && draft.revision === revision ? draft.placements : [],
    );
  }, [draft, revision]);
  useEffect(() => {
    if (
      !gameId ||
      revision === undefined ||
      !active ||
      !userId ||
      !generation ||
      !canPublish
    )
      return;
    const source = createLiveDraftPublisher(
      { gameId, revision, generation, streamId: crypto.randomUUID() },
      (input, closing) => requestDraft(userId, input, undefined, closing),
      (connected) =>
        setFailedConnection(
          connected ? null : { gameId, revision, generation, userId },
        ),
    );
    const publish = () => {
      if (document.visibilityState !== "visible") return;
      source.update(
        latest.current?.revision === revision ? latest.current.placements : [],
      );
    };
    publisher.current = source;
    publish();
    const heartbeat = setInterval(() => {
      if (document.visibilityState === "visible") source.heartbeat();
    }, 4000);
    const close = () => source.stop();
    document.addEventListener("visibilitychange", publish);
    window.addEventListener("pagehide", close);
    return () => {
      publisher.current = null;
      source.stop();
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", publish);
      window.removeEventListener("pagehide", close);
    };
  }, [gameId, revision, generation, userId, active, canPublish]);
  useEffect(() => {
    if (!gameId || !active || !userId || canPublish) return;
    let disposed = false;
    let busy = false;
    let controller: AbortController | undefined;
    const load = async () => {
      if (disposed || busy || document.visibilityState !== "visible") return;
      busy = true;
      controller = new AbortController();
      try {
        const result = await requestDraft(
          userId,
          undefined,
          gameId,
          false,
          controller.signal,
        );
        if (!disposed && gameRef.current)
          setIncoming(currentLiveDraft(result.draft, gameRef.current));
      } catch {
        if (!disposed) setIncoming(null);
      } finally {
        busy = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), LIVE_DRAFT_POLL_MS);
    const visible = () => void load();
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [gameId, active, userId, canPublish]);
  useEffect(() => {
    if (!incoming) return;
    const timer = setTimeout(
      () => setIncoming(null),
      Math.max(0, Date.parse(incoming.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [incoming]);
  return {
    draft:
      game && !canPublish && incoming?.generation === generation
        ? currentLiveDraft(incoming, game)
        : null,
    connectionFailed: !!(
      game &&
      active &&
      context &&
      canPublish &&
      draft?.placements.length &&
      draft.revision === revision &&
      failedConnection &&
      failedConnection.gameId === gameId &&
      failedConnection.revision === revision &&
      failedConnection.generation === generation &&
      failedConnection.userId === userId
    ),
  };
}
