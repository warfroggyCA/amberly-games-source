"use client";
import { useEffect, useRef, useState } from "react";
import { SpectatorGame } from "./SpectatorGame";
import { Modal } from "./Modal";
import { TabletopIcon } from "./TabletopIcon";
import { BrandWordmark } from "./BrandWordmark";
import {
  currentLiveDraft,
  LIVE_DRAFT_POLL_MS,
  type LiveDraft,
} from "../lib/live-draft";
import type { SpectatorState } from "../lib/shared-contract";
import "./family-shared.css";
import "./persistent-board.css";
export function WatchGame() {
  const [game, setGame] = useState<SpectatorState | null>(null);
  const [draft, setDraft] = useState<LiveDraft | null>(null);
  const currentGame = useRef<SpectatorState | null>(null);
  const [toolsTarget, setToolsTarget] = useState<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let stopped = false;
    let busy = false;
    let request: AbortController | null = null;
    let draftRequest: AbortController | null = null;
    let draftBusy = false;
    const load = async () => {
      if (disposed || stopped || busy || document.visibilityState !== "visible")
        return;
      const token = location.hash.slice(1);
      if (!/^[a-f0-9]{64}$/.test(token)) {
        setGame(null);
        setError(
          "This viewing link is incomplete. Ask the scorer for a new link.",
        );
        stopped = true;
        return;
      }
      busy = true;
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch("/api/watch", {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();
        if (disposed || stopped || controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 404 || response.status === 401) {
            setGame(null);
            stopped = true;
          }
          setError(
            result.error ?? "The live view is unavailable. Reconnecting…",
          );
          return;
        }
        const previous = currentGame.current;
        currentGame.current = result.game;
        setGame(result.game);
        if (
          !previous ||
          previous.id !== result.game.id ||
          previous.revision !== result.game.revision ||
          previous.scorerGeneration !== result.game.scorerGeneration
        )
          setDraft(currentLiveDraft(result.game.liveDraft, result.game));
        setError(null);
      } catch (e) {
        if (!disposed)
          setError(
            e instanceof Error && e.name !== "AbortError"
              ? "The live view is unavailable. Reconnecting…"
              : "The live view lost its connection. Reconnecting…",
          );
      } finally {
        clearTimeout(timeout);
        busy = false;
      }
    };
    const loadDraft = async () => {
      if (
        disposed ||
        stopped ||
        draftBusy ||
        !currentGame.current ||
        currentGame.current.status !== "active" ||
        document.visibilityState !== "visible"
      )
        return;
      draftBusy = true;
      const controller = new AbortController();
      draftRequest = controller;
      try {
        const response = await fetch("/api/watch/draft", {
          headers: { Authorization: `Bearer ${location.hash.slice(1)}` },
          credentials: "omit",
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(6000),
          ]),
        });
        const result = await response.json();
        if (disposed || stopped || controller.signal.aborted) return;
        if (!response.ok) {
          setDraft(null);
          if ([401, 404].includes(response.status)) {
            setGame(null);
            currentGame.current = null;
            stopped = true;
            setError(
              "This viewing link has expired or was closed. Ask the scorer for a new link.",
            );
          }
          return;
        }
        if (
          currentGame.current &&
          (result.revision !== currentGame.current.revision ||
            result.generation !== currentGame.current.scorerGeneration)
        ) {
          setDraft(null);
          void load();
        } else if (currentGame.current)
          setDraft(currentLiveDraft(result.draft, currentGame.current));
      } catch {
        if (!disposed) setDraft(null);
      } finally {
        draftBusy = false;
      }
    };
    void load();
    const draftTimer = setInterval(() => void loadDraft(), LIVE_DRAFT_POLL_MS);
    const timer = setInterval(() => void load(), 5000);
    const visible = () => void load();
    const changed = () => location.reload();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("hashchange", changed);
    return () => {
      disposed = true;
      request?.abort();
      draftRequest?.abort();
      clearInterval(draftTimer);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("hashchange", changed);
    };
  }, []);
  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(
      () => setDraft(null),
      Math.max(0, Date.parse(draft.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [draft]);
  return (
    <div className="app-shell spectator-shell">
      <header className="site-header">
        <button
          className="tabletop-tool tabletop-menu-button"
          aria-label="Open game menu"
          title="Game menu"
          onClick={() => setMenu(true)}
        >
          <TabletopIcon name="menu" />
        </button>
        <a className="brand" href="/family" aria-label="Amberly Games — Home">
          <BrandWordmark />
        </a>
        <div className="spectator-header-tools" ref={setToolsTarget} />
      </header>
      <main>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {game ? (
          <SpectatorGame
            game={game}
            liveDraft={currentLiveDraft(draft, game)}
            toolsTarget={toolsTarget}
          />
        ) : (
          !error && <p role="status">Opening the live scoreboard…</p>
        )}
      </main>
      {menu && (
        <Modal
          title="Amberly Games"
          className="tabletop-menu"
          onClose={() => setMenu(false)}
        >
          <p>Private live view · no sign-in needed.</p>
          <p>
            The scorer records turns. Tap a word to see who played it, or a
            player to highlight their plays.
          </p>
          <a className="button light" href="/family">
            <TabletopIcon name="home" />
            Home
          </a>
        </Modal>
      )}
    </div>
  );
}
