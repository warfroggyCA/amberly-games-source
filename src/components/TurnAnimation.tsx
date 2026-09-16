"use client";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { GameTurn } from "../domain/game";
import { LETTER_VALUES } from "../domain/board";
import {
  playableArrival,
  scoresBeforeArrival,
  tileLaunchPoint,
  tumbleFrames,
  type PlaybackGame,
} from "../lib/turn-playback";
import { positionScoreBubble } from "../lib/score-bubble-position";
import { startTurnSparkles } from "../lib/turn-sparkles";
import "./turn-animation.css";

/** Display-only sequencing: the journal and real scores are already committed. */
export function useTurnPlayback(game: PlaybackGame) {
  const [state, setState] = useState(() => ({
    game,
    seen: new Set(game.turns.map((t) => t.id)),
    turn: null as GameTurn | null,
    scored: false,
  }));
  if (state.game !== game) {
    const added = playableArrival(state.game, game, state.seen);
    const sameHistory =
      game.id === state.game.id &&
      game.status === "active" &&
      game.turns.length === state.game.turns.length &&
      game.turns.every((t, i) => t.id === state.game.turns[i].id);
    const turn = added ?? (sameHistory ? state.turn : null);
    setState({
      game,
      seen: new Set([
        ...(game.id === state.game.id ? state.seen : []),
        ...game.turns.map((t) => t.id),
      ]),
      turn,
      scored: added ? false : state.scored,
    });
  }
  const finish = useCallback(
    () => setState((s) => (s.turn ? { ...s, turn: null } : s)),
    [],
  );
  const revealScore = useCallback(
    () => setState((s) => (s.scored ? s : { ...s, scored: true })),
    [],
  );
  return {
    turn: state.turn,
    turns:
      state.turn && !state.scored
        ? game.turns.filter((t) => t.id !== state.turn!.id)
        : game.turns,
    scores:
      state.turn && !state.scored
        ? scoresBeforeArrival(game, state.turn)
        : (game.result?.scores ?? game.scores),
    currentPlayerId: state.turn ? state.turn.playerId : game.currentPlayerId,
    finish,
    revealScore,
  };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const stop = () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal.addEventListener("abort", stop, { once: true });
  });
}

export function TurnAnimation({
  turn,
  containerRef,
  onScore,
  onComplete,
}: {
  turn: GameTurn | null;
  containerRef: RefObject<HTMLElement | null>;
  onScore: () => void;
  onComplete: () => void;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!turn) return;
    const root = containerRef.current;
    const layer = overlay.current;
    const controller = new AbortController();
    const { signal } = controller;
    const animations = new Set<Animation>();
    const hidden = new Map<HTMLElement, string>();
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let sparkles: ReturnType<typeof startTurnSparkles> | undefined;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const restore = () => {
      for (const [node, visibility] of hidden)
        node.style.visibility = visibility;
      hidden.clear();
    };
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      controller.abort();
      sparkles?.stop();
      animations.forEach((a) => a.cancel());
      animations.clear();
      restore();
      if (layer) layer.style.visibility = "hidden";
      observer?.disconnect();
    };
    const finish = () => {
      if (disposed) return;
      cleanup();
      onComplete();
    };
    async function animate(
      node: HTMLElement,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const animation = node.animate(frames, { ...options, fill: "both" });
      animations.add(animation);
      try {
        await animation.finished;
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      } finally {
        animations.delete(animation);
        animation.cancel();
      }
    }
    function invalidate() {
      finish();
    }
    function hiddenPage() {
      if (document.hidden) finish();
    }
    async function run() {
      if (
        !root ||
        !layer ||
        document.hidden ||
        typeof Element.prototype.animate !== "function"
      ) {
        finish();
        return;
      }
      const seat = [
        ...root.querySelectorAll<HTMLElement>("[data-turn-player]"),
      ].find((el) => el.dataset.turnPlayer === turn!.playerId);
      const score = [
        ...root.querySelectorAll<HTMLElement>("[data-turn-score]"),
      ].find((el) => el.dataset.turnScore === turn!.playerId);
      const board = root.querySelector<HTMLElement>(".board-grid");
      const badge = layer.querySelector<HTMLElement>(".turn-points")!;
      // A faster incoming turn can reuse this element while its prior score is up.
      badge.style.visibility = "hidden";
      const flying = [
        ...layer.querySelectorAll<HTMLElement>(".turn-flying-tile"),
      ];
      const sources = turn!.placements.map((p) =>
        root.querySelector<HTMLElement>(
          `[data-turn-cell="${p.row}:${p.col}"] .letter-tile`,
        ),
      );
      if (!seat || !score || !board || sources.some((el) => !el)) {
        finish();
        return;
      }
      const bounds = board.getBoundingClientRect();
      const seatBounds = seat.getBoundingClientRect();
      if (
        bounds.width <= 0 ||
        seatBounds.width <= 0 ||
        bounds.bottom < 0 ||
        bounds.top > innerHeight
      ) {
        finish();
        return;
      }
      const origin = tileLaunchPoint(seatBounds, bounds);
      const destinations = sources.map((node) => node!.getBoundingClientRect());
      if (destinations.some((rect) => rect.width <= 0)) {
        finish();
        return;
      }
      layer.style.visibility = "visible";
      // Reuse the entry bubble's obstacle-aware positioning, including existing
      // letters in crosswords. The score pop must leave the whole board readable.
      const obstacles = [
        ...board.querySelectorAll<HTMLElement>(".letter-tile"),
      ].map((el) => el.getBoundingClientRect());
      const anchor = destinations[destinations.length - 1];
      const badgeSize = badge.getBoundingClientRect();
      const position = positionScoreBubble(
        anchor,
        { width: badgeSize.width + 18, height: badgeSize.height + 18 },
        { left: 8, top: 8, right: innerWidth - 8, bottom: innerHeight - 8 },
        obstacles,
        turn!.words[0]?.direction ?? "across",
      );
      if (position) {
        badge.style.left = `${position.left + 9}px`;
        badge.style.top = `${position.top + 9}px`;
      }
      if (motion.matches) {
        if (!position) {
          finish();
          return;
        }
        badge.style.visibility = "visible";
        onScore();
        await wait(1100, signal);
        finish();
        return;
      }
      // Read all geometry before hiding or moving anything.
      sources.forEach((node) => {
        hidden.set(node!, node!.style.visibility);
        node!.style.visibility = "hidden";
      });
      flying.forEach((node, i) => {
        const rect = destinations[i];
        Object.assign(node.style, {
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
      });
      // A resize invalidates measured paths. One initial notification is normal.
      observer = new ResizeObserver(() => {
        const next = board.getBoundingClientRect();
        if (
          Math.abs(next.width - bounds.width) > 1 ||
          Math.abs(next.height - bounds.height) > 1 ||
          Math.abs(next.left - bounds.left) > 1 ||
          Math.abs(next.top - bounds.top) > 1
        )
          finish();
      });
      observer.observe(board);
      const canvas = layer.querySelector<HTMLCanvasElement>(".turn-sparkles");
      // Decoration is optional even when a device cannot allocate a canvas.
      if (canvas) {
        try {
          sparkles = startTurnSparkles(canvas, flying, badge);
          sparkles.land({ left: origin.x, top: origin.y, width: 0, height: 0 });
        } catch {
          /* Keep the tile animation. */
        }
      }
      await Promise.all(
        flying.map(async (node, i) => {
          await wait(i * 125, signal);
          if (signal.aborted) return;
          node.style.visibility = "visible";
          await animate(node, tumbleFrames(origin, destinations[i], i), {
            duration: 760,
            easing: "linear",
          });
          node.style.visibility = "hidden";
          const original = sources[i]!;
          original.style.visibility = hidden.get(original) ?? "";
          hidden.delete(original);
          sparkles?.land(destinations[i]);
        }),
      );
      await wait(120, signal);
      if (!position) {
        finish();
        return;
      }
      badge.style.visibility = "visible";
      sparkles?.land(badge.getBoundingClientRect());
      await animate(
        badge,
        [
          { transform: "translateY(12px) scale(.65)", opacity: 0 },
          {
            transform: "translateY(-3px) scale(1.1)",
            opacity: 1,
            offset: 0.65,
          },
          { transform: "none", opacity: 1 },
        ],
        { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
      await wait(650, signal);
      const from = badge.getBoundingClientRect(),
        to = score.getBoundingClientRect();
      const dx = to.left + to.width / 2 - from.left - from.width / 2;
      const dy = to.top + to.height / 2 - from.top - from.height / 2;
      await animate(
        badge,
        [
          { transform: "none", opacity: 1, offset: 0 },
          {
            transform: `translate(${dx * 0.45}px, ${Math.min(dy, 0) - 42}px) scale(.85)`,
            opacity: 1,
            offset: 0.5,
          },
          {
            transform: `translate(${dx}px, ${dy}px) scale(.3)`,
            opacity: 0,
            offset: 1,
          },
        ],
        { duration: 650, easing: "cubic-bezier(.4,0,.2,1)" },
      );
      badge.style.visibility = "hidden";
      onScore();
      sparkles?.land(score.getBoundingClientRect());
      await animate(
        score,
        [
          { transform: "scale(1)", textShadow: "0 0 0 transparent" },
          {
            transform: "scale(1.22)",
            textShadow: "0 0 6px #fff5ce, 0 0 18px #ffc948",
            offset: 0.4,
          },
          { transform: "scale(1)", textShadow: "0 0 0 transparent" },
        ],
        { duration: 360, easing: "ease-out" },
      );
      finish();
    }
    document.addEventListener("visibilitychange", hiddenPage);
    document.addEventListener("pointerdown", invalidate, true);
    document.addEventListener("keydown", invalidate, true);
    window.addEventListener("resize", invalidate);
    window.addEventListener("scroll", invalidate, true);
    motion.addEventListener("change", invalidate);
    // Motion is optional: any unsupported API or cancelled animation settles the
    // authoritative board. It must never block entry or create another command.
    void run().catch(() => {
      if (!disposed) finish();
    });
    return () => {
      cleanup();
      document.removeEventListener("visibilitychange", hiddenPage);
      document.removeEventListener("pointerdown", invalidate, true);
      document.removeEventListener("keydown", invalidate, true);
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("scroll", invalidate, true);
      motion.removeEventListener("change", invalidate);
    };
  }, [turn, containerRef, onScore, onComplete]);

  if (!turn) return null;
  return createPortal(
    <div
      className="turn-animation-layer"
      ref={overlay}
      aria-hidden="true"
      data-turn-animation={turn.id}
    >
      <canvas className="turn-sparkles" />
      {turn.placements.map((p, index) => (
        <div className="turn-flying-tile" key={`${turn.id}-${index}`}>
          <span
            className={`turn-tile-face turn-tile-front ${p.tile.blank ? "is-blank" : ""}`}
          >
            <b>{p.tile.letter}</b>
            <small>{p.tile.blank ? 0 : LETTER_VALUES[p.tile.letter]}</small>
          </span>
          <span className="turn-tile-face turn-tile-back" />
        </div>
      ))}
      <div className="turn-points">
        <strong>+{turn.score}</strong>
        <span>{turn.source === "assisted" ? "assisted points" : "points"}</span>
        <small>{turn.words.map((w) => w.word).join(" + ")}</small>
      </div>
    </div>,
    document.body,
  );
}
