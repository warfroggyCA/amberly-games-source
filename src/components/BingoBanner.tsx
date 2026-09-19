"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { GameState, GameTurn } from "../domain/game";
import { newlyObservedPlay } from "../lib/spectator-plays";
import "./bingo-banner.css";

type BingoGame = Pick<GameState, "id" | "turns" | "players" | "status">;

/** Celebrate committed arrivals only; drafts, refreshes and retries do not replay. */
export function BingoBanner({
  game,
  containerRef,
}: {
  game: BingoGame;
  containerRef: RefObject<HTMLElement | null>;
}) {
  const bannerRef = useRef<HTMLElement>(null);
  const [state, setState] = useState(() => ({
    game,
    seen: new Set(game.turns.map((turn) => turn.id)),
    turn: null as GameTurn | null,
  }));
  if (state.game !== game) {
    const arrival = newlyObservedPlay(state.game, game);
    const bingo =
      arrival?.bingo && !state.seen.has(arrival.id) ? arrival : null;
    const retained =
      game.id === state.game.id &&
      game.status === "active" &&
      game.turns.at(-1)?.id === state.turn?.id
        ? state.turn
        : null;
    setState({
      game,
      seen: new Set([
        ...(game.id === state.game.id ? state.seen : []),
        ...game.turns.map((turn) => turn.id),
      ]),
      turn: bingo ?? retained,
    });
  }
  const turn = state.turn;
  useEffect(() => {
    if (!turn) return;
    const timer = window.setTimeout(
      () => setState((current) => ({ ...current, turn: null })),
      8000,
    );
    return () => window.clearTimeout(timer);
  }, [turn]);
  useLayoutEffect(() => {
    if (!turn) return;
    const banner = bannerRef.current;
    const board = containerRef.current?.querySelector(".board-grid");
    if (!banner || !board) return;
    // Keep the portal above score animations, but anchor it to this board.
    const place = () => {
      const rect = board.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const halfWidth = banner.offsetWidth / 2;
      const halfHeight = banner.offsetHeight / 2;
      const x = Math.max(
        left + halfWidth + 8,
        Math.min(rect.left + rect.width / 2, left + width - halfWidth - 8),
      );
      const y = Math.max(
        top + halfHeight + 8,
        Math.min(rect.top + rect.height / 2, top + height - halfHeight - 8),
      );
      banner.style.setProperty("--bingo-x", `${x}px`);
      banner.style.setProperty("--bingo-y", `${y}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(board);
    observer.observe(banner);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [turn, containerRef]);
  if (!turn) return null;
  const player =
    game.players.find((p) => p.id === turn.playerId)?.name ?? "Player";
  return createPortal(
    <aside
      key={turn.id}
      ref={bannerRef}
      className="bingo-banner"
      aria-label="Bingo celebration"
    >
      <div className="bingo-sparkles" aria-hidden="true">
        {Array.from({ length: 14 }, (_, index) => (
          <span key={index} style={{ "--spark": index } as CSSProperties}>
            ✦
          </span>
        ))}
      </div>
      <div className="bingo-banner-copy" role="status" aria-live="polite">
        <strong className="sr-only">Bingo!</strong>
        <div className="bingo-banner-hero" aria-hidden="true">
          <div className="bingo-banner-headline">
            <span className="bingo-banner-kicker">
              A seven-tile showstopper
            </span>
            <div className="bingo-banner-tiles">
              {["B", "I", "N", "G", "O", "!"].map((letter, index) => (
                <span
                  className="bingo-celebration-tile"
                  key={letter}
                  style={{ "--tile": index } as CSSProperties}
                >
                  {letter}
                  <small>{[3, 1, 1, 2, 1, ""][index]}</small>
                </span>
              ))}
            </div>
          </div>
          <div className="bingo-banner-medal">
            <span>+50</span>
            <small>BONUS</small>
          </div>
        </div>
        <div className="bingo-banner-details">
          <p className="bingo-banner-player">{player} played all seven tiles</p>
          <p className="bingo-banner-score">
            <strong>{turn.score} points</strong> · includes the 50-point bonus
          </p>
        </div>
      </div>
      <button
        type="button"
        className="bingo-banner-close"
        aria-label="Dismiss bingo celebration"
        onClick={() => setState((current) => ({ ...current, turn: null }))}
      >
        <span aria-hidden="true">×</span>
      </button>
    </aside>,
    document.body,
  );
}
