"use client";
import { PlayerElapsedTime } from "./TurnTiming";
import { TurnClock, TimingSummary } from "./TurnTiming";
import "./game-feedback.css";
import { BingoBanner } from "./BingoBanner";
import "./score-drawer.css";
import { ResultBadge } from "./ResultBadge";
import { PlayerName } from "./PlayerName";
import "./live-draft.css";
import { PlayerAvatar } from "./PlayerAvatar";
import type { SavedPlayer } from "../lib/preview-store";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { currentLiveDraft, type LiveDraft } from "../lib/live-draft";
import type { SpectatorState } from "../lib/shared-contract";
import { LETTER_VALUES, premiumAt } from "../domain/board";
import { buildRoundRows } from "../lib/round-scores";
import { spectatorWords, type SpectatorWord } from "../lib/spectator-plays";
import { Modal } from "./Modal";
import { PlayedWordDetails } from "./PlayedWordDetails";
import { CrownIcon } from "./CrownIcon";
import { liveLeader, LEADER_LABELS } from "../lib/live-leader";
import { TileBagButton } from "./TileBagButton";
import { TabletopIcon } from "./TabletopIcon";
import { useTurnPlayback, TurnAnimation } from "./TurnAnimation";
import "./tile-appearance.css";
import "./spectator-game.css";

type Selection = { type: "player" | "word"; id: string } | null;
export function SpectatorGame({
  game,
  profiles = [],
  liveDraft,
  confirmation,
  toolsTarget,
  assisted = game.assisted ?? false,
}: {
  game: SpectatorState;
  profiles?: SavedPlayer[];
  liveDraft?: LiveDraft | null;
  confirmation?: ReactNode;
  toolsTarget?: HTMLElement | null;
  assisted?: boolean;
}) {
  const playback = useTurnPlayback(game);
  const provisional = currentLiveDraft(liveDraft, game);
  const provisionalTiles = new Map(
    provisional?.placements.map((p) => [`${p.row}:${p.col}`, p.tile]) ?? [],
  );
  const stageRef = useRef<HTMLElement>(null);
  const [selectedGameId, setSelectedGameId] = useState(game.id);
  const [scoresOpen, setScoresOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [squareOpen, setSquareOpen] = useState<string | null>(null);
  // Selections belong to a particular game, including when this viewer is reused.
  if (selectedGameId !== game.id) {
    setSelectedGameId(game.id);
    setSelection(null);
    setSquareOpen(null);
    setScoresOpen(false);
  }

  useEffect(() => {
    if (!selection) return;
    function clearFromBackground(event: MouseEvent) {
      if (
        event.target instanceof Element &&
        !event.target.closest(
          'button, a, input, select, textarea, label, summary, dialog, [role="dialog"], .spectator-word-detail',
        )
      )
        setSelection(null);
    }
    document.addEventListener("click", clearFromBackground, true);
    return () =>
      document.removeEventListener("click", clearFromBackground, true);
  }, [selection]);

  const words = useMemo(() => spectatorWords(game.turns), [game.turns]);
  const wordsByCell = useMemo(() => {
    const index = new Map<string, SpectatorWord[]>();
    for (const word of words)
      for (const cell of word.cells) {
        const entries = index.get(cell) ?? [];
        entries.push(word);
        index.set(cell, entries);
      }
    return index;
  }, [words]);
  const selectedWords = words.filter((word) =>
    selection?.type === "player"
      ? word.playerId === selection.id
      : word.id === selection?.id,
  );
  const highlighted = new Set(selectedWords.flatMap((word) => word.cells));
  const selectedPlayer =
    selection?.type === "player"
      ? game.players.find((p) => p.id === selection.id)
      : null;
  const chosenWord = selection?.type === "word" ? selectedWords[0] : null;
  const squareWords = squareOpen ? (wordsByCell.get(squareOpen) ?? []) : [];
  const scores = game.result?.scores ?? game.scores;
  const ranking = [...game.players].sort((a, b) => scores[b.id] - scores[a.id]);
  const topScore = ranking.length ? scores[ranking[0].id] : 0;
  const crown = liveLeader(game.order, scores, game.turns);
  const displayScores = playback.scores;
  const displayCrown = liveLeader(game.order, displayScores, playback.turns);
  const displayRanking = [...game.players].sort(
    (a, b) => displayScores[b.id] - displayScores[a.id],
  );
  const displayTopScore = displayRanking.length
    ? displayScores[displayRanking[0].id]
    : 0;
  const displayLeaderIds = displayRanking
    .filter((p) => displayScores[p.id] === displayTopScore)
    .map((p) => p.id);
  const leaderText =
    game.turns.length === 0
      ? "No scores yet"
      : displayLeaderIds.length > 1
        ? "Tied for the lead"
        : `${displayRanking[0]?.name ?? "Player"} leads`;
  const nameOf = (id: string) =>
    game.players.find((p) => p.id === id)?.name ?? "Player";
  const statusText =
    game.status === "finalized"
      ? game.result?.winnerIds.length
        ? `${game.result.winnerIds.map(nameOf).join(" & ")} ${game.result.winnerIds.length > 1 ? "win" : "wins"}`
        : "Game complete"
      : game.status === "paused"
        ? "Game paused"
        : game.pendingEnd
          ? "Ending game"
          : null;
  const last = game.turns.at(-1);
  const rows = buildRoundRows(game, false);
  function pickPlayer(id: string) {
    playback.finish();
    setSelection(
      selection?.type === "player" && selection.id === id
        ? null
        : { type: "player", id },
    );
    setScoresOpen(false);
  }
  function pickWord(id: string) {
    playback.finish();
    setSelection((previous) =>
      previous?.type === "word" && previous.id === id
        ? null
        : { type: "word", id },
    );
  }
  function pickSquare(cell: string) {
    playback.finish();
    const matches = wordsByCell.get(cell) ?? [];
    if (chosenWord?.cells.includes(cell)) setSelection(null);
    else if (matches.length === 1) pickWord(matches[0].id);
    else if (matches.length > 1) setSquareOpen(cell);
  }
  const tools = (
    <div className="spectator-view-actions">
      <TurnClock game={game} />
      <TileBagButton
        key={game.id}
        remaining={game.expectedBagCount}
        board={game.board}
        tileSupply={game.tileSupply}
        assisted={assisted}
        onOpen={playback.finish}
      />
      <button
        className="tabletop-tool spectator-scores-toggle"
        aria-label={`Scores. ${leaderText}. Leading score ${displayTopScore}`}
        title="Scores and game history"
        aria-haspopup="dialog"
        aria-expanded={scoresOpen}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          playback.finish();
          setScoresOpen(true);
        }}
      >
        <TabletopIcon name="trophy" />
      </button>
    </div>
  );
  return (
    <section
      ref={stageRef}
      className="spectator-game"
      aria-label="Live game viewer"
    >
      <BingoBanner game={game} containerRef={stageRef} />
      {toolsTarget ? (
        createPortal(tools, toolsTarget)
      ) : (
        <div className="spectator-inline-tools">{tools}</div>
      )}
      <ResultBadge
        key={game.id}
        result={
          game.result?.winnerIds.length
            ? {
                gameId: game.id,
                game: "Scrabble",
                winners: game.players
                  .filter((p) => game.result!.winnerIds.includes(p.id))
                  .map((p) => ({
                    name: p.name,
                    photoDataUrl: profiles.find(
                      (profile) => profile.id === p.id,
                    )?.photoDataUrl,
                    score: game.result!.scores[p.id],
                  })),
                note:
                  game.result.reason === "early"
                    ? "Early finish"
                    : assisted
                      ? "Assisted result"
                      : game.tileSupply
                        ? "Nonstandard tile set"
                        : undefined,
              }
            : null
        }
      />
      <div className="spectator-stage">
        <div className="spectator-table">
          {game.players.map((player) => {
            const isCurrent =
              game.status === "active" &&
              player.id === playback.currentPlayerId;
            const isLeader =
              displayTopScore > 0 &&
              (game.result
                ? displayLeaderIds.includes(player.id)
                : displayCrown?.playerId === player.id);
            const isSelected =
              selection?.type === "player" && selection.id === player.id;
            const leaderLabel = game.result
              ? displayLeaderIds.length > 1
                ? "Joint winner"
                : "Winner"
              : displayCrown
                ? LEADER_LABELS[displayCrown.reason]
                : "Leader";
            return (
              <div
                key={player.id}
                className={`spectator-seat spectator-seat-${player.seat} ${isCurrent ? "is-current" : ""} ${isSelected ? "is-selected" : ""}`}
                data-turn-player={player.id}
                data-turn-seat={player.seat}
              >
                <span
                  className={`spectator-player-initial seat-colour-${player.seat}`}
                >
                  <PlayerAvatar
                    name={player.name}
                    photoDataUrl={
                      profiles.find((p) => p.id === player.id)?.photoDataUrl
                    }
                  />
                  {isLeader && <CrownIcon />}
                </span>
                <button
                  type="button"
                  className="spectator-seat-copy"
                  aria-pressed={isSelected}
                  aria-label={`${player.name}, ${displayScores[player.id]} points${isCurrent ? ", playing now" : ""}${isLeader ? `, ${leaderLabel.toLowerCase()}` : ""}. Highlight their words`}
                  onClick={() => pickPlayer(player.id)}
                >
                  <strong className="spectator-seat-name" title={player.name}>
                    <PlayerName
                      player={player}
                      profile={profiles.find(
                        (profile) => profile.id === player.id,
                      )}
                      useNickname={game.status === "active"}
                    />
                  </strong>
                  <b
                    className="spectator-seat-score"
                    data-turn-score={player.id}
                  >
                    {displayScores[player.id]}
                  </b>
                  <PlayerElapsedTime game={game} playerId={player.id} />
                  {game.expectedRackCounts && (
                    <small className="board-seat-rack">
                      {game.expectedRackCounts[player.id]} tiles left
                    </small>
                  )}
                  <small className="spectator-seat-turn" aria-hidden="true">
                    {isCurrent ? "Playing now" : "\u00a0"}
                  </small>
                </button>
              </div>
            );
          })}
          <div className="board-workspace spectator-board">
            <div className="board-frame">
              <div
                className="board-grid"
                role="grid"
                aria-label="Shared Scrabble board, select a word to see its player and meaning"
              >
                {game.board.map((row, r) => (
                  <div className="board-row" role="row" key={r}>
                    {row.map((committedTile, c) => {
                      const pendingTile = provisionalTiles.get(`${r}:${c}`);
                      const tile = committedTile ?? pendingTile;
                      const premium = premiumAt(r, c);
                      const cell = `${r}:${c}`;
                      const coordinate = `${String.fromCharCode(65 + c)}${r + 1}`;
                      const matches = wordsByCell.get(cell) ?? [];
                      return (
                        <div
                          role="gridcell"
                          key={c}
                          data-turn-cell={cell}
                          className={`square ${premium?.toLowerCase() ?? "plain"} ${tile ? "occupied" : ""} ${pendingTile ? "spectator-provisional" : ""} ${highlighted.has(cell) ? "spectator-matched" : ""} ${highlighted.size && tile && !highlighted.has(cell) ? "spectator-dimmed" : ""}`}
                          aria-label={tile ? undefined : `${coordinate} empty`}
                        >
                          {tile ? (
                            <button
                              className="spectator-tile"
                              onClick={() => pickSquare(cell)}
                              disabled={!!pendingTile || !matches.length}
                              aria-pressed={
                                chosenWord?.cells.includes(cell) ?? false
                              }
                              aria-label={`${pendingTile ? "Provisional tile, not recorded. " : ""}${coordinate} ${tile.letter}${tile.blank ? " blank, zero points" : `, ${LETTER_VALUES[tile.letter]} points`}. ${matches.length ? `View ${[...new Set(matches.map((w) => w.word))].join(", ")}` : "No recorded word"}`}
                            >
                              <span
                                className={`letter-tile ${tile.blank ? "blank-tile" : ""}`}
                              >
                                <b>{tile.letter}</b>
                                <small>
                                  {tile.blank ? 0 : LETTER_VALUES[tile.letter]}
                                </small>
                              </span>
                            </button>
                          ) : (
                            <span className="premium-label">
                              {r === 7 && c === 7
                                ? "★"
                                : premium
                                  ? premium
                                  : ""}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {!!selectedWords.length && (
                  <svg
                    className="spectator-word-outlines"
                    viewBox="0 0 15 15"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {selectedWords.map((word) => (
                      <rect
                        key={word.id}
                        x={word.col + 0.07}
                        y={word.row + 0.07}
                        width={
                          (word.direction === "across" ? word.word.length : 1) -
                          0.14
                        }
                        height={
                          (word.direction === "down" ? word.word.length : 1) -
                          0.14
                        }
                        rx="0.08"
                        vectorEffect="non-scaling-stroke"
                        className={word.source === "assisted" ? "assisted" : ""}
                      />
                    ))}
                  </svg>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <TurnAnimation
        turn={playback.turn}
        containerRef={stageRef}
        onScore={playback.revealScore}
        onComplete={playback.finish}
      />
      {chosenWord && (
        <aside
          className="spectator-word-detail"
          aria-label={`${chosenWord.word} word details`}
        >
          <div className="spectator-word-detail-heading">
            <h3>Word details</h3>
            <button
              className="icon-button"
              aria-label="Clear word selection"
              onClick={() => setSelection(null)}
            >
              ×
            </button>
          </div>
          <PlayedWordDetails
            key={chosenWord.id}
            word={chosenWord}
            board={game.board}
            placements={
              game.turns.find((turn) => turn.id === chosenWord.turnId)
                ?.placements ?? []
            }
            playerName={nameOf(chosenWord.playerId)}
            round={chosenWord.round}
            source={chosenWord.source}
          />
        </aside>
      )}
      <div className="spectator-selection" aria-live="polite">
        {provisional && !chosenWord && !selectedPlayer ? (
          <div
            className={`spectator-live-score ${provisional.valid ? "is-valid" : "needs-check"}`}
          >
            <span>
              <strong>{nameOf(provisional.playerId)} is placing tiles</strong>
              <small>
                Provisional · not recorded
                {provisional.valid ? "" : " · checking"}
              </small>
            </span>
            <b>
              {provisional.score ?? "—"}
              <small>pts</small>
            </b>
          </div>
        ) : chosenWord ? (
          <span>
            Tap the word again or anywhere outside its details to clear.
          </span>
        ) : selectedPlayer ? (
          <>
            <span>
              <strong>{selectedPlayer.name}’s words</strong> ·{" "}
              {selectedWords.length}
              <small>
                {selectedWords.some((word) => word.source === "assisted")
                  ? "Includes assisted plays, shown with dashed outlines."
                  : "Tap a highlighted word for its details."}
              </small>
            </span>
            <button className="text-button" onClick={() => setSelection(null)}>
              Clear
            </button>
          </>
        ) : last ? (
          <button
            className="spectator-last-turn"
            onClick={() => {
              playback.finish();
              setScoresOpen(true);
            }}
          >
            <span>
              {statusText && (
                <strong className="spectator-game-status">{statusText}</strong>
              )}
              Last: {nameOf(last.playerId)} ·{" "}
              {last.words.map((w) => w.word).join(" + ") || last.type}
              {last.source === "assisted" ? " · Assisted" : ""}
            </span>
            <strong>{last.score} pts</strong>
          </button>
        ) : (
          <span>
            {statusText && (
              <strong className="spectator-game-status">{statusText}</strong>
            )}
            Tap a word to see who played it. Tap a player to highlight their
            words.
          </span>
        )}
      </div>
      {squareOpen && (
        <Modal title="Words on this square" onClose={() => setSquareOpen(null)}>
          <p>
            Crossing words and later extensions can belong to different turns.
          </p>
          <div className="spectator-word-choices">
            {squareWords.map((word) => (
              <button
                key={word.id}
                onClick={() => {
                  pickWord(word.id);
                  setSquareOpen(null);
                }}
              >
                <strong>{word.word}</strong>
                <span>
                  {nameOf(word.playerId)} · {word.score} points
                </span>
                <small>
                  Round {word.round} · {word.turnScore} for the turn
                  {word.source === "assisted" ? " · Assisted play" : ""}
                </small>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {scoresOpen && (
        <Modal
          className="score-sheet-modal"
          title={game.status === "finalized" ? "Final scores" : "Scores"}
          onClose={() => setScoresOpen(false)}
        >
          {statusText && <p className="spectator-game-status">{statusText}</p>}
          <ol className="spectator-ranking">
            {ranking.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => pickPlayer(p.id)}
                  aria-pressed={
                    selection?.type === "player" && selection.id === p.id
                  }
                >
                  <span className="spectator-player-initial">
                    {p.name.charAt(0)}
                    {(game.result
                      ? topScore > 0 && scores[p.id] === topScore
                      : crown?.playerId === p.id) && <CrownIcon />}
                  </span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {game.status === "active" && p.id === game.currentPlayerId
                        ? "Playing now · "
                        : ""}
                      Show words
                    </small>
                  </span>
                  <b>{scores[p.id]}</b>
                </button>
              </li>
            ))}
          </ol>
          <TimingSummary game={game} />
          {confirmation}
          <details className="spectator-history">
            <summary>Rounds and turn history</summary>
            <div className="table-overflow">
              <table>
                <caption>Round scores</caption>
                <thead>
                  <tr>
                    <th>Round</th>
                    {game.players.map((p) => (
                      <th key={p.id}>{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.round}>
                      <th>{row.round}</th>
                      {game.players.map((p) => (
                        <td key={p.id}>
                          {row.cells.find((cell) => cell.playerId === p.id)
                            ?.value ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ol>
              {game.turns.map((turn) => (
                <li key={turn.id}>
                  <strong>{nameOf(turn.playerId)}</strong>:{" "}
                  {turn.words
                    .map((w) => `${w.word} (${w.score})`)
                    .join(" + ") || turn.type}{" "}
                  — {turn.score} points
                  {turn.source === "assisted" ? " · Assisted" : ""}
                </li>
              ))}
            </ol>
            {game.result && (
              <div>
                <h3>Final adjustments</h3>
                {game.players.map((p) => (
                  <p key={p.id}>
                    {p.name}: −{game.result!.adjustments[p.id].deduction} +
                    {game.result!.adjustments[p.id].transfer} ={" "}
                    {game.result!.scores[p.id]}
                  </p>
                ))}
              </div>
            )}
          </details>
        </Modal>
      )}
    </section>
  );
}
