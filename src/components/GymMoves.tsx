"use client";
import { useEffect, useRef, useState } from "react";
import type { Puzzle } from "../domain/gym/model";
import type { ScoredMove } from "../domain/solver";
import type { VerifiedWord } from "../domain/verified-words";
import type { StrategyCoaching } from "../domain/gym/coaching";
import {
  describeMove,
  groupMoves,
  type MoveCatalog,
} from "../domain/gym/move-catalog";

function MoveName({ move }: { move: ScoredMove }) {
  const description = describeMove(move);
  return (
    <>
      {description.label} {description.arrow}
    </>
  );
}
function Crosswords({ move }: { move: ScoredMove }) {
  const { crosswords } = describeMove(move);
  return crosswords.length ? (
    <span style={{ display: "block" }}>
      Also forms {crosswords.map((w) => w.word).join(" + ")}
    </span>
  ) : null;
}

function Choices({
  moves,
  selected,
  choose,
  busy,
}: {
  moves: ScoredMove[];
  selected?: string;
  choose: (move: ScoredMove) => void;
  busy: boolean;
}) {
  const [limit, setLimit] = useState(10);
  return (
    <>
      <ol className="gym-move-choices">
        {moves.slice(0, limit).map((move) => (
          <li key={move.key}>
            <button
              className="button light"
              disabled={busy}
              aria-pressed={selected === move.key}
              onClick={() => choose(move)}
            >
              <strong>
                <MoveName move={move} /> · {move.score} points
              </strong>{" "}
              · {move.newTileCount} rack tiles
              <Crosswords move={move} />
              <span>
                {move.words
                  .map(
                    (w) =>
                      `${w.word} at ${String.fromCharCode(65 + w.col)}${w.row + 1} ${w.direction === "across" ? "→" : "↓"}`,
                  )
                  .join(" + ")}
                {move.placements.some((p) => p.tile.blank)
                  ? " · uses a blank"
                  : ""}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {moves.length > limit && (
        <button className="text-button" onClick={() => setLimit((n) => n + 10)}>
          More placements ({moves.length - limit})
        </button>
      )}
    </>
  );
}
export function GymMoves({
  puzzle,
  words,
  onPreview,
  onClose,
  onStrategy,
}: {
  puzzle: Puzzle;
  words: VerifiedWord[];
  onPreview: (move: ScoredMove) => void;
  onClose: () => void;
  onStrategy: () => void;
}) {
  const [catalog, setCatalog] = useState<MoveCatalog | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [selected, setSelected] = useState<ScoredMove | null>(null);
  const [coaching, setCoaching] = useState<StrategyCoaching | null>(null);
  const [limit, setLimit] = useState(25);
  const [retry, setRetry] = useState(0);
  const worker = useRef<Worker | null>(null),
    serial = useRef(1);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let instance: Worker;
    try {
      instance = new Worker(
        new URL("../lib/gym-lab.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      queueMicrotask(() => {
        setBusy(false);
        setError(
          "This browser could not start the search. Your tiles are kept; please retry.",
        );
      });
      return;
    }
    worker.current = instance;
    const id = ++serial.current;
    const fail = () => {
      instance.terminate();
      worker.current = null;
      setBusy(false);
      setError(
        "Search could not finish. Your own tiles are kept; close this list or retry.",
      );
    };
    timeout.current = setTimeout(fail, 18000);
    instance.onerror = fail;
    instance.onmessage = ({ data }) => {
      if (data.id !== serial.current || data.type === "progress") return;
      if (timeout.current) clearTimeout(timeout.current);
      setBusy(false);
      if (data.type === "error") {
        setError(data.message);
        return;
      }
      if (data.type === "all-moves") setCatalog(data.catalogue);
      if (data.type === "strategy") setCoaching(data.strategy);
    };
    instance.postMessage({ id, type: "all-moves", puzzle, words });
    return () => {
      instance.terminate();
      worker.current = null;
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [puzzle, words, retry]);
  const groups = groupMoves(catalog?.moves ?? []);
  function choose(move: ScoredMove) {
    if (busy) return;
    setSelected(move);
    setCoaching(null);
    onPreview(move);
  }
  function compare() {
    if (!selected || busy || !worker.current) return;
    onStrategy();
    setBusy(true);
    setError("");
    setCoaching(null);
    const instance = worker.current;
    timeout.current = setTimeout(() => {
      instance.terminate();
      worker.current = null;
      setBusy(false);
      setError(
        "Strategy analysis reached its time limit. Your draft and move list are kept.",
      );
    }, 18000);
    instance.postMessage({
      id: ++serial.current,
      type: "strategy",
      puzzle,
      words,
      action: { type: "play", placements: selected.placements },
    });
  }
  return (
    <section className="gym-move-explorer" aria-label="Move explorer">
      <div className="gym-header-actions">
        <h3>
          {catalog?.complete
            ? "All moves"
            : catalog
              ? "Moves found"
              : "Finding moves…"}
        </h3>
        <button className="button light" onClick={onClose}>
          Close move list
        </button>
      </div>
      <p>
        {catalog
          ? `${catalog.moves.length}${catalog.complete ? " legal placements" : " placements found so far — search incomplete"}. Highest score first; tap a word to preview, or expand its other placements.`
          : "Searching your full rack and this board. Your draft is kept."}
      </p>
      {busy && (
        <p role="status">
          {catalog
            ? "Thinking about this placement…"
            : "Finding legal placements…"}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!busy && (error || (catalog && !catalog.complete)) && (
        <button
          className="button light"
          onClick={() => {
            setBusy(true);
            setError("");
            setRetry((n) => n + 1);
          }}
        >
          Retry search
        </button>
      )}
      {selected && (
        <div className="gym-selected-move">
          <p>
            <strong>Preview: {selected.score} points</strong> ·{" "}
            <MoveName move={selected} />
            <Crosswords move={selected} />
          </p>
          <button
            className="button light"
            disabled={busy || !!error}
            onClick={compare}
          >
            Compare strategy for this move
          </button>
          {coaching && (
            <p role="status">
              {coaching.verdict === "same"
                ? "This is also the suggested strategy move."
                : `Suggested: ${coaching.recommended.label}. Your selected placement: ${coaching.requested.label}.`}{" "}
              Sampled opponent reply:{" "}
              {coaching.requested.replyPoints.toFixed(1)} points; recommended
              move’s reply: {coaching.recommended.replyPoints.toFixed(1)}. This
              is a short-horizon estimate, not winning odds.
            </p>
          )}
        </div>
      )}
      <div
        className="gym-move-list"
        aria-label="Moves ranked by score"
        aria-busy={busy}
      >
        {groups.slice(0, limit).map((group) => (
          <div key={group.word}>
            <button
              className="gym-move-main"
              disabled={busy}
              aria-pressed={selected?.key === group.placements[0].key}
              onClick={() => choose(group.placements[0])}
            >
              <strong>
                <MoveName move={group.placements[0]} />
              </strong>{" "}
              · {group.placements[0].score} points
              <Crosswords move={group.placements[0]} />
              <span>
                {group.placements[0].newTileCount} rack tiles · Tap to preview
              </span>
            </button>
            {group.placements.length > 1 && (
              <details>
                <summary>
                  Other placements ({group.placements.length - 1})
                </summary>
                <Choices
                  moves={group.placements.slice(1)}
                  selected={selected?.key}
                  choose={choose}
                  busy={busy}
                />
              </details>
            )}
          </div>
        ))}
        {catalog?.complete && !catalog.moves.length && (
          <p>No legal word placements are available with this rack.</p>
        )}
        {groups.length > limit && (
          <button
            className="button light"
            onClick={() => setLimit((n) => n + 25)}
          >
            Show more words ({groups.length - limit})
          </button>
        )}
      </div>
    </section>
  );
}
