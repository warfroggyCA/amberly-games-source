"use client";
import { useState } from "react";
import type { GameState } from "../domain/game";
import type { CrokinoleGame } from "../domain/crokinole";
import type { CrokinoleAccess } from "../lib/crokinole-contract";
import type { GameAccess } from "../lib/shared-contract";
import type { SavedPlayer } from "../lib/preview-store";
import {
  recordBookGames,
  bookHighlights,
  bookRivalry,
  type BookGame,
} from "../lib/family-record-book";
import { PlayerPortrait } from "./PlayerPortrait";
import { ScrabbleRecordDetails } from "./ScrabbleRecordDetails";
import "./record-book.css";

function Sprig() {
  return (
    <svg className="book-sprig" viewBox="0 0 100 150" aria-hidden="true">
      <path
        d="M20 145Q65 70 67 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      {[20, 45, 70, 95, 120].map((y, i) => (
        <g
          key={y}
          transform={`translate(${63 - i * 7} ${y}) rotate(${i % 2 ? 30 : -25})`}
        >
          <ellipse
            cx="-12"
            cy="-10"
            rx="9"
            ry="21"
            fill="currentColor"
            opacity=".65"
          />
          <ellipse
            cx="13"
            cy="-2"
            rx="8"
            ry="19"
            fill="currentColor"
            opacity=".85"
          />
        </g>
      ))}
    </svg>
  );
}
function WordTiles({ word }: { word: string }) {
  return (
    <span className="book-word" aria-label={word}>
      {Array.from(word).map((letter, i) => (
        <span key={i} aria-hidden="true">
          {letter}
        </span>
      ))}
    </span>
  );
}
export function RecordsPage({
  games,
  players,
  access,
  hasMore,
  onLoadMore,
  onOpen,
  onHistory,
  crokinole = [],
  crokinoleAccess = {},
  onOpenCrokinole,
  loading = false,
  error,
}: {
  games: GameState[];
  players: SavedPlayer[];
  access?: Record<string, GameAccess>;
  hasMore: boolean;
  onLoadMore: () => void;
  onOpen: (id: string) => void;
  onHistory: () => void;
  crokinole?: CrokinoleGame[];
  crokinoleAccess?: Record<string, CrokinoleAccess>;
  onOpenCrokinole?: (id: string) => void;
  loading?: boolean;
  error?: string | null;
}) {
  const [tab, setTab] = useState<"Highlights" | "Rivalries" | "Journal">(
    "Highlights",
  );
  const [kind, setKind] = useState<"scrabble" | "crokinole" | "all">(
    "scrabble",
  );
  const selectTab = (next: typeof tab) => {
    setTab(next);
    if (next !== "Journal" && kind === "all") {
      setKind("scrabble");
      setGroup("");
    }
  };
  const [group, setGroup] = useState("");
  const [pair, setPair] = useState<[string, string]>(["", ""]);
  const all = recordBookGames(games, access, crokinole, crokinoleAccess);
  const filtered = all.filter((g) => kind === "all" || g.kind === kind);
  const groups = [
    ...new Map(filtered.map((g) => [g.group, g.context])).entries(),
  ];
  const selectedGroup = groups.some(([id]) => id === group)
    ? group
    : groups[0]?.[0];
  const selected = filtered.filter((g) => g.group === selectedGroup);
  const highlights = bookHighlights(selected);
  const rivals = [
    ...new Map(
      selected
        .filter((g) => g.eligible && g.players.length === 2)
        .flatMap((g) => g.players.map((p) => [p.id, p.name] as const)),
    ).entries(),
  ];
  const first = rivals.some(([id]) => id === pair[0])
    ? pair[0]
    : (rivals[0]?.[0] ?? "");
  const second = rivals.some(([id]) => id === pair[1] && id !== first)
    ? pair[1]
    : (rivals.find(([id]) => id !== first)?.[0] ?? "");
  const rivalry = bookRivalry(selected, first, second);
  const name = (id: string) =>
    selected.flatMap((g) => g.players).find((p) => p.id === id)?.name ??
    players.find((p) => p.id === id)?.name ??
    "Player";
  const photo = (id: string) => players.find((p) => p.id === id)?.photoDataUrl;
  const open = (game: BookGame) =>
    game.kind === "crokinole" ? onOpenCrokinole?.(game.id) : onOpen(game.id);
  const feature = highlights.best[0];
  const word = highlights.words[0];
  const personal =
    highlights.personal.find((p) => p.id === feature?.id) ??
    highlights.personal.find((p) => p.humanTurns > 0);
  const incomplete = hasMore || loading || !!error;
  return (
    <section className="record-book" aria-label="Family Record Book">
      <header className="book-heading">
        <div>
          <span className="eyebrow">Family Record Book</span>
          <h1>
            {tab === "Highlights"
              ? "A game worth remembering"
              : tab === "Rivalries"
                ? "Good games. Great rivals."
                : "Our games, kept together"}
          </h1>
          <p>
            {tab === "Journal"
              ? "The scores, the words, the little wins."
              : "Earned at the table. Kept in the family."}
          </p>
        </div>
        <Sprig />
      </header>
      <div className="book-controls">
        <div className="book-tabs" role="group" aria-label="Record Book view">
          {(["Highlights", "Rivalries", "Journal"] as const).map((label) => (
            <button
              key={label}
              aria-pressed={tab === label}
              onClick={() => selectTab(label)}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className="book-filters"
          role="group"
          aria-label="Record Book game"
        >
          {(
            [
              ["scrabble", "Scrabble"],
              ["crokinole", "Crokinole"],
              ...(tab === "Journal" ? [["all", "All games"]] : []),
            ] as [typeof kind, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={kind === id}
              onClick={() => {
                setKind(id);
                setGroup("");
                setPair(["", ""]);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab !== "Journal" && groups.length > 0 && (
        <label className="book-context">
          Compare like games
          <select
            value={selectedGroup}
            onChange={(e) => setGroup(e.target.value)}
          >
            {groups.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="inline-message">
          {error}{" "}
          <button className="text-button" onClick={onLoadMore}>
            Retry history
          </button>
        </p>
      )}
      {incomplete ? (
        <div className="book-empty" role="status">
          <h2>
            {loading
              ? "Opening the family record book…"
              : "Bring the whole history to the table."}
          </h2>
          <p>
            Load every game before comparing achievements. Partial history
            cannot establish a family record.
          </p>
          <button
            className="button primary"
            disabled={loading}
            onClick={onLoadMore}
          >
            {loading ? "Loading…" : "Load earlier games"}
          </button>
        </div>
      ) : !filtered.length ||
        (tab !== "Journal" &&
          !highlights.best.length &&
          !highlights.personal.some((p) => p.humanTurns > 0)) ? (
        <div className="book-empty">
          <Sprig />
          <h2>Your next game can make history.</h2>
          <p>
            Completed shared games will appear here. Private tests and
            unresolved concerns stay outside this book.
          </p>
          <button className="button light" onClick={onHistory}>
            Browse game history
          </button>
        </div>
      ) : (
        <>
          {tab === "Highlights" && (
            <>
              {feature ? (
                <button
                  className="book-hero"
                  onClick={() => open(feature.game)}
                >
                  <Sprig />
                  <span className="book-hero-portrait">
                    <PlayerPortrait
                      name={feature.name}
                      photoDataUrl={photo(feature.id)}
                      crowned
                    />
                  </span>
                  <span className="book-hero-copy">
                    <span className="book-kicker">
                      Highest game · {highlights.competitive.length} completed
                    </span>
                    <h2>{feature.name}’s high score</h2>
                    <strong className="book-score">{feature.score}</strong>
                    <span>
                      {feature.game.kind === "scrabble"
                        ? "Scrabble"
                        : "Crokinole"}{" "}
                      points
                    </span>
                    <small>
                      {highlights.best.length > 1
                        ? `${highlights.best.length} performances share this high score`
                        : "A family record in this group"}
                    </small>
                    <span className="book-link">View game →</span>
                  </span>
                  <span className="book-bravo">
                    <WordTiles word="BRAVO" />
                  </span>
                </button>
              ) : (
                <div className="book-empty">
                  <h2>Every game has its moments.</h2>
                  <p>
                    No eligible competitive high score in this group yet.
                    Completed human words can still be celebrated below.
                  </p>
                </div>
              )}
              <div className="book-cards">
                <section className="book-card">
                  <span className="book-kicker">Highest scoring words</span>
                  <h2>Best word</h2>
                  {word ? (
                    <>
                      <WordTiles word={word.word} />
                      <strong>{word.score} points</strong>
                      <p>
                        {name(word.playerId)}
                        {highlights.words.length > 1
                          ? ` · ${highlights.words.length} words share the record`
                          : ""}
                      </p>
                      <button
                        className="text-button"
                        onClick={() => onOpen(word.gameId)}
                      >
                        View word in game →
                      </button>
                    </>
                  ) : (
                    <p>No eligible recorded words in this group.</p>
                  )}
                  <Sprig />
                </section>
                <section className="book-card">
                  <span className="book-kicker">Two sides, one table</span>
                  <h2>Friendly rivalry</h2>
                  {rivals.length > 1 ? (
                    <>
                      <div className="book-mini-pair">
                        {[first, second].map((id) => (
                          <PlayerPortrait
                            key={id}
                            name={name(id)}
                            photoDataUrl={photo(id)}
                          />
                        ))}
                      </div>
                      <p>
                        {name(first)} · {name(second)}
                      </p>
                      <button
                        className="text-button"
                        onClick={() => selectTab("Rivalries")}
                      >
                        Explore the rivalry →
                      </button>
                    </>
                  ) : (
                    <p>
                      Complete a compatible two-player game to start a rivalry.
                    </p>
                  )}
                  <Sprig />
                </section>
                <section className="book-card">
                  <span className="book-kicker">Every turn counts</span>
                  <h2>Points per turn</h2>
                  {personal?.pointsPerTurn !== null &&
                  personal?.pointsPerTurn !== undefined ? (
                    <>
                      <strong className="book-metric">
                        {personal.pointsPerTurn.toFixed(1)}
                      </strong>
                      <p>
                        {name(personal.id)} · {personal.humanTurns} human turns
                      </p>
                      <small>
                        Includes passes, exchanges and eligible pre-assistance
                        turns.
                      </small>
                    </>
                  ) : (
                    <p>
                      This measure is available for eligible Scrabble turns.
                    </p>
                  )}
                  <Sprig />
                </section>
              </div>
              <div className="book-bottom">
                <section className="book-card">
                  <h2>Games to remember</h2>
                  {selected.slice(0, 3).map((g) => (
                    <button
                      key={`${g.kind}:${g.id}`}
                      className="book-game-link"
                      onClick={() => open(g)}
                    >
                      <span>
                        {g.kind === "scrabble" ? "Scrabble" : "Crokinole"} ·{" "}
                        {g.players
                          .map((p) => `${p.name} ${p.score}`)
                          .join(" · ")}
                      </span>
                      <span aria-hidden="true">→</span>
                    </button>
                  ))}
                  <button
                    className="text-button"
                    onClick={() => selectTab("Journal")}
                  >
                    Open the game journal →
                  </button>
                </section>
                <section className="book-card">
                  <h2>Little victories</h2>
                  {personal ? (
                    <>
                      <p>
                        {name(personal.id)} · {personal.uniqueWords.length}{" "}
                        unique words played
                      </p>
                      <p>{personal.bingoCount} seven-tile bonuses</p>
                      {personal.biggestComebacks.map((a) => (
                        <button
                          key={a.gameId}
                          className="text-button"
                          onClick={() => onOpen(a.gameId)}
                        >
                          {name(a.playerId)} overcame {a.deficit} points →
                        </button>
                      ))}
                    </>
                  ) : (
                    <p>Every completed game keeps its own story.</p>
                  )}
                </section>
              </div>
              <details className="book-details">
                <summary>Explore every player’s Scrabble records</summary>
                <ScrabbleRecordDetails
                  games={games}
                  players={players}
                  access={access}
                  hasMore={hasMore}
                  onLoadMore={onLoadMore}
                  onOpen={onOpen}
                  onHistory={onHistory}
                />
              </details>
            </>
          )}
          {tab === "Rivalries" && (
            <>
              {rivals.length > 1 ? (
                <>
                  <div className="book-pair-select">
                    {([0, 1] as const).map((index) => (
                      <label key={index}>
                        {index === 0
                          ? "First player or side"
                          : "Second player or side"}
                        <select
                          value={index === 0 ? first : second}
                          onChange={(e) =>
                            setPair(
                              index === 0
                                ? [e.target.value, second]
                                : [first, e.target.value],
                            )
                          }
                        >
                          {rivals
                            .filter(([id]) => index === 0 || id !== first)
                            .map(([id, label]) => (
                              <option key={id} value={id}>
                                {label}
                              </option>
                            ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <section className="book-rivalry">
                    <Sprig />
                    <div className="book-rival-player">
                      <PlayerPortrait
                        name={name(first)}
                        photoDataUrl={photo(first)}
                      />
                      <h2>{name(first)}</h2>
                    </div>
                    <div className="book-match">
                      <span className="book-kicker">Head to head</span>
                      <strong>
                        {rivalry.firstWins}
                        <span> : </span>
                        {rivalry.secondWins}
                      </strong>
                      <h3>
                        {rivalry.firstWins === rivalry.secondWins
                          ? "Level on wins"
                          : `${name(rivalry.firstWins > rivalry.secondWins ? first : second)} leads by ${Math.abs(rivalry.firstWins - rivalry.secondWins)}`}
                      </h3>
                      <p>
                        {rivalry.matches.length} games together · {rivalry.ties}{" "}
                        {rivalry.ties === 1 ? "tie" : "ties"}
                      </p>
                    </div>
                    <div className="book-rival-player">
                      <PlayerPortrait
                        name={name(second)}
                        photoDataUrl={photo(second)}
                      />
                      <h2>{name(second)}</h2>
                    </div>
                    <div className="book-win-bar" aria-hidden="true">
                      <span style={{ flex: rivalry.firstWins || 0.01 }} />
                      <i style={{ flex: rivalry.ties }} />
                      <b style={{ flex: rivalry.secondWins || 0.01 }} />
                    </div>
                  </section>
                  <div className="book-cards">
                    {[first, second].map((id) => {
                      const best = rivalry.matches
                        .flatMap((g) =>
                          g.players
                            .filter((p) => p.id === id)
                            .map((p) => ({ game: g, score: p.score })),
                        )
                        .sort((a, b) => b.score - a.score)[0];
                      return (
                        <section className="book-card" key={id}>
                          <h2>{name(id)}’s best</h2>
                          {best ? (
                            <>
                              <strong>{best.score} points</strong>
                              <button
                                className="text-button"
                                onClick={() => open(best.game)}
                              >
                                View game →
                              </button>
                            </>
                          ) : (
                            <p>No games together in this group yet.</p>
                          )}
                        </section>
                      );
                    })}
                    <section className="book-card">
                      <h2>Closest finish</h2>
                      {rivalry.closest ? (
                        <>
                          <strong>{rivalry.closest.margin} points apart</strong>
                          <button
                            className="text-button"
                            onClick={() => open(rivalry.closest!.game)}
                          >
                            A game to remember →
                          </button>
                        </>
                      ) : (
                        <p>Choose two sides who have played together.</p>
                      )}
                    </section>
                  </div>
                </>
              ) : (
                <div className="book-empty">
                  <h2>A little friendly competition.</h2>
                  <p>
                    Rivalries need completed two-sided games with the same
                    rules. Larger tables keep their achievements in Highlights
                    and Journal.
                  </p>
                </div>
              )}
            </>
          )}
          {tab === "Journal" && (
            <>
              <div className="book-journal-summary">
                <span>
                  <strong>{filtered.length}</strong> completed games
                </span>
                <span>
                  <strong>
                    {
                      new Set(
                        filtered.flatMap((g) => g.players.map((p) => p.id)),
                      ).size
                    }
                  </strong>{" "}
                  players or sides
                </span>
                <span>The scores, kept together</span>
              </div>
              <div className="book-journal">
                <div className="book-timeline">
                  {filtered.map((g) => (
                    <article
                      className="book-journal-entry"
                      key={`${g.kind}:${g.id}`}
                    >
                      <time dateTime={g.createdAt}>
                        Started{" "}
                        {new Date(g.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </time>
                      <div className="book-journal-content">
                        <span
                          className={`book-game-piece ${g.kind}`}
                          aria-hidden="true"
                        >
                          {g.kind === "scrabble" ? "S" : "◎"}
                        </span>
                        <div>
                          <h2>
                            {g.kind === "scrabble" ? "Scrabble" : "Crokinole"}
                          </h2>
                          <div className="book-journal-players">
                            {g.players.map((p) => (
                              <span key={p.id}>
                                <PlayerPortrait
                                  name={p.name}
                                  photoDataUrl={photo(p.id)}
                                  crowned={p.winner && g.eligible}
                                />
                                <strong>
                                  {p.name} {p.score}
                                </strong>
                              </span>
                            ))}
                          </div>
                          <p>
                            {g.eligible
                              ? "Completed competitive game"
                              : "Kept in history · outside competitive records"}
                          </p>
                          <small>{g.context}</small>
                        </div>
                        <button className="text-button" onClick={() => open(g)}>
                          Open game →
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                <aside className="book-journal-aside">
                  <Sprig />
                  <h2>Family milestones</h2>
                  <p>
                    Find high scores and memorable words in Highlights, with a
                    link back to the game.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => selectTab("Highlights")}
                  >
                    Explore highlights →
                  </button>
                  <blockquote>
                    Good games.
                    <br />
                    Longer memories.
                  </blockquote>
                </aside>
              </div>
              <button className="text-button" onClick={onHistory}>
                Browse every game →
              </button>
            </>
          )}
        </>
      )}
      <p className="book-footnote">
        Records keep compatible rules and player counts together. Private
        practice, disputed results and assisted competitive finishes do not
        become family wins. Dates in the Journal show when games started.
      </p>
    </section>
  );
}
