"use client";
import { playerDisplayName } from "../lib/player-profile";
import { PlayerName } from "./PlayerName";
import { useRef, useState, type PointerEvent } from "react";
import {
  EMPTY_EQUIPMENT,
  tileTotal,
  standardSupply,
  type Equipment,
} from "../domain/equipment";
import "./tile-sets.css";
import { premiumAt } from "../domain/board";
import type { SavedPlayer } from "../lib/preview-store";
import { Modal } from "./Modal";
import { defaultLexicon, lexiconDetails } from "../lib/lexicons";
import "./playersetup.css";

const SEATS = ["Top", "Right", "Bottom", "Left"];
type Direction = "clockwise" | "counterclockwise";
type Drag = {
  playerId: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

export function PlayerSetup({
  equipment = EMPTY_EQUIPMENT,
  players,
  busy,
  onAdd,
  onStart,
  onClose,
  error,
  sharedMode,
  onSharedModeChange,
  canAddPlayers = true,
  allowPractice = true,
}: {
  equipment?: Equipment;
  canAddPlayers?: boolean;
  allowPractice?: boolean;
  sharedMode?: "confirmed" | "practice";
  onSharedModeChange?: (mode: "confirmed" | "practice") => void;
  players: SavedPlayer[];
  busy: boolean;
  onAdd: (name: string) => Promise<string | null>;
  onStart: (
    seats: string[],
    first: string,
    direction: Direction,
    tileSetId: string | null,
    equipmentRevision: number,
  ) => Promise<void>;
  onClose: () => void;
  error: string | null;
}) {
  const [tileSetId, setTileSetId] = useState<string | null>(
    equipment.defaultSetId,
  );
  const [equipmentRevision] = useState(equipment.revision);
  const chosenSet = equipment.sets.find((set) => set.id === tileSetId);
  const chosenTotal = chosenSet ? tileTotal(chosenSet.counts) : 100;
  const [seats, setSeats] = useState(["", "", "", ""]);
  const [first, setFirst] = useState("");
  const [direction, setDirection] = useState<Direction>("clockwise");
  const [picked, setPicked] = useState("");
  const [name, setName] = useState("");
  const [recent, setRecent] = useState<SavedPlayer[]>([]);
  const [working, setWorking] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [ghost, setGhost] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const operation = useRef(false);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const seatElements = useRef<(HTMLDivElement | null)[]>([]);
  const roster = [
    ...players,
    ...recent.filter(
      (player) => !players.some((known) => known.id === player.id),
    ),
  ];
  const disabled = busy || working;
  const selected = seats.filter(Boolean);
  const ordered =
    direction === "clockwise" ? selected : [...selected].reverse();
  const firstIndex = ordered.indexOf(first);
  const sequence =
    firstIndex < 0
      ? ordered
      : [...ordered.slice(firstIndex), ...ordered.slice(0, firstIndex)];
  const playerName = (playerId: string) => {
    const player = roster.find((player) => player.id === playerId);
    return player ? playerDisplayName(player) : "Player";
  };

  function seatPlayer(index: number, playerId: string) {
    if (disabled) return;
    const next = [...seats];
    const source = next.indexOf(playerId);
    const displaced = next[index];
    if (source >= 0 && source !== index) next[source] = displaced;
    next[index] = playerId;
    setSeats(next);
    setFirst((current) =>
      next.includes(current) ? current : (next.find(Boolean) ?? ""),
    );
    setPicked("");
    setAnnouncement(
      `${playerName(playerId)} is in the ${SEATS[index].toLowerCase()} seat.${displaced && displaced !== playerId ? (source >= 0 ? ` Swapped with ${playerName(displaced)}.` : ` ${playerName(displaced)} is back in the roster.`) : ""}`,
    );
  }
  function removePlayer(index: number) {
    const next = [...seats];
    const removed = next[index];
    next[index] = "";
    setSeats(next);
    setFirst((current) =>
      next.includes(current) ? current : (next.find(Boolean) ?? ""),
    );
    setAnnouncement(`${playerName(removed)} is back in the roster.`);
  }
  function choosePlayer(playerId: string) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setPicked((current) => (current === playerId ? "" : playerId));
    setAnnouncement(
      `${playerName(playerId)} selected. Choose a seat around the board.`,
    );
  }
  function hitSeat(x: number, y: number): number | null {
    const index = seatElements.current.findIndex((element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      );
    });
    return index < 0 ? null : index;
  }
  function beginDrag(event: PointerEvent<HTMLButtonElement>, playerId: string) {
    if (disabled || event.button !== 0 || !event.isPrimary) return;
    suppressClick.current = false;
    drag.current = {
      playerId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (
      !active.moved &&
      Math.hypot(event.clientX - active.startX, event.clientY - active.startY) <
        6
    )
      return;
    active.moved = true;
    setGhost({ id: active.playerId, x: event.clientX, y: event.clientY });
    setOver(hitSeat(event.clientX, event.clientY));
  }
  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.moved) {
      suppressClick.current = true;
      const target = hitSeat(event.clientX, event.clientY);
      if (target !== null) seatPlayer(target, active.playerId);
      else setAnnouncement("No seat selected. The seating is unchanged.");
    }
    drag.current = null;
    setGhost(null);
    setOver(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function cancelDrag() {
    drag.current = null;
    setGhost(null);
    setOver(null);
    suppressClick.current = false;
  }
  const pointerHandlers = (playerId: string) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) =>
      beginDrag(event, playerId),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: cancelDrag,
  });

  return (
    <Modal title="Set the table" onClose={onClose} wide>
      <div className="player-setup">
        <p className="setup-instructions">
          Drag anywhere on a player’s card to a seat, or tap their name and then
          tap a seat. Choose up to four players for this game; everyone you add
          stays in your roster for next time.
        </p>
        <div className="player-setup-columns">
          <section className="setup-roster" aria-labelledby="roster-heading">
            <h3 id="roster-heading">
              Your players <small>{roster.length}</small>
            </h3>
            <div className="roster-list">
              {roster.map((player) => {
                const seat = seats.indexOf(player.id);
                return (
                  <button
                    type="button"
                    key={player.id}
                    className={`roster-player ${picked === player.id ? "is-picked" : ""} ${seat >= 0 ? "is-seated" : ""}`}
                    disabled={disabled}
                    aria-pressed={picked === player.id}
                    onClick={() => choosePlayer(player.id)}
                    {...pointerHandlers(player.id)}
                  >
                    <span className="roster-initial" aria-hidden="true">
                      {player.photoDataUrl ? (
                        // Already resized, browser-local JPEG; no remote optimizer is needed.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={player.photoDataUrl}
                          alt=""
                          draggable={false}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            borderRadius: "inherit",
                          }}
                        />
                      ) : (
                        player.name.charAt(0).toUpperCase()
                      )}
                    </span>
                    <span>
                      <strong>
                        <PlayerName player={player} profile={player} />
                      </strong>
                      <small>
                        {seat >= 0 ? `${SEATS[seat]} seat` : "Ready to join"}
                      </small>
                    </span>
                    <span className="drag-grip" aria-hidden="true">
                      ⠿
                    </span>
                  </button>
                );
              })}
              {!roster.length && (
                <p className="roster-empty">
                  No players yet. Add the first name below.
                </p>
              )}
            </div>
            {canAddPlayers && (
              <form
                className="setup-add-player"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (disabled || operation.current || !name.trim()) return;
                  operation.current = true;
                  setWorking(true);
                  setLocalError(null);
                  const enteredName = name.trim();
                  try {
                    const playerId = await onAdd(enteredName);
                    if (playerId) {
                      setRecent((current) => [
                        ...current.filter((player) => player.id !== playerId),
                        { id: playerId, name: enteredName },
                      ]);
                      const next = [...seats];
                      const empty = next.indexOf("");
                      if (empty >= 0) {
                        next[empty] = playerId;
                        setSeats(next);
                        setFirst((current) => current || playerId);
                      }
                      setName("");
                      setPicked("");
                      setAnnouncement(
                        `${enteredName} added to your roster${empty >= 0 ? ` and placed in the ${SEATS[empty].toLowerCase()} seat` : ". All four seats are occupied; the new player is ready for another game"}.`,
                      );
                    }
                  } catch (failure) {
                    setLocalError(
                      failure instanceof Error
                        ? failure.message
                        : "The player could not be added. Your name entry has been kept.",
                    );
                  } finally {
                    operation.current = false;
                    setWorking(false);
                  }
                }}
              >
                <label htmlFor="setup-player-name">Add someone new</label>
                <div>
                  <input
                    id="setup-player-name"
                    aria-label="Player name"
                    value={name}
                    disabled={disabled}
                    maxLength={60}
                    required
                    autoComplete="off"
                    placeholder="e.g. Doug"
                    onChange={(event) => setName(event.target.value)}
                  />
                  <button
                    type="submit"
                    className="button primary"
                    disabled={disabled || !name.trim()}
                  >
                    {working ? "Saving…" : "Add player"}
                  </button>
                </div>
              </form>
            )}
          </section>
          <section
            className="setup-table-section"
            aria-label="Player seats around the board"
          >
            <div className="setup-table-grid">
              {SEATS.map((label, index) => (
                <div
                  key={label}
                  ref={(element) => {
                    seatElements.current[index] = element;
                  }}
                  data-setup-seat={index}
                  className={`table-seat table-seat-${index} ${over === index ? "drop-target" : ""} ${seats[index] ? "has-player" : ""}`}
                >
                  <button
                    type="button"
                    className="table-seat-button"
                    aria-label={`${label} seat${seats[index] ? `: ${playerName(seats[index])}` : ": empty"}`}
                    disabled={disabled}
                    {...(seats[index] ? pointerHandlers(seats[index]) : {})}
                    onClick={() => {
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        return;
                      }
                      if (picked) seatPlayer(index, picked);
                      else if (seats[index]) choosePlayer(seats[index]);
                      else
                        setAnnouncement(
                          "Select a player in the roster, then choose this seat.",
                        );
                    }}
                  >
                    <small>{label}</small>
                    <strong>
                      {seats[index]
                        ? playerName(seats[index])
                        : "+ Seat player"}
                    </strong>
                    {seats[index] && first === seats[index] && (
                      <span className="first-seat-label">First to play</span>
                    )}
                  </button>
                  {seats[index] && (
                    <button
                      type="button"
                      className="unseat-player"
                      disabled={disabled}
                      onClick={() => removePlayer(index)}
                      aria-label={`Remove ${playerName(seats[index])} from ${label.toLowerCase()} seat`}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <div className="setup-mini-board" aria-hidden="true">
                {Array.from({ length: 225 }, (_, index) => {
                  const row = Math.floor(index / 15),
                    col = index % 15;
                  return (
                    <span
                      key={index}
                      className={`mini-square ${(premiumAt(row, col) ?? "").toLowerCase()}`}
                    >
                      {row === 7 && col === 7 ? "★" : ""}
                    </span>
                  );
                })}
              </div>
            </div>
            <p className="setup-picked-message">
              {picked
                ? `${playerName(picked)} selected — choose a seat.`
                : `${selected.length} of 4 seats filled${selected.length === 1 ? " · Solo practice" : ""}`}
            </p>
          </section>
        </div>
        <div className="setup-play-order">
          <label className="field">
            Who plays first?
            <select
              value={first}
              disabled={disabled || !selected.length}
              onChange={(event) => setFirst(event.target.value)}
            >
              <option value="">Choose a player</option>
              {selected.map((playerId) => (
                <option key={playerId} value={playerId}>
                  {playerName(playerId)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Playing direction
            <select
              value={direction}
              disabled={disabled}
              onChange={(event) =>
                setDirection(event.target.value as Direction)
              }
            >
              <option value="clockwise">Clockwise ↻</option>
              <option value="counterclockwise">Counterclockwise ↺</option>
            </select>
          </label>
        </div>
        {equipment.sets.length > 0 && (
          <details className="setup-equipment">
            <summary>
              {chosenSet?.name ?? "Standard English set"} · {chosenTotal} tiles
              · Change set
            </summary>
            <label className="field">
              Tile set
              <select
                value={tileSetId ?? ""}
                disabled={disabled}
                onChange={(e) => setTileSetId(e.target.value || null)}
              >
                <option value="">Standard English set · 100 tiles</option>
                {equipment.sets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name} · {tileTotal(set.counts)} tiles
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              Manage quantities and your default in Settings → Tile sets.
            </p>
          </details>
        )}
        {chosenSet && !standardSupply(chosenSet.counts) && (
          <p className="muted">
            Custom tile quantities · retained in history, excluded from standard
            player records.
          </p>
        )}
        {chosenTotal < selected.length * 7 && (
          <p role="alert">
            This set needs at least {selected.length * 7} tiles to deal seven to
            each player.
          </p>
        )}
        {sequence.length > 0 && (
          <div className="setup-sequence">
            <span>Play order</span>
            <ol>
              {sequence.map((playerId) => (
                <li key={playerId}>{playerName(playerId)}</li>
              ))}
            </ol>
          </div>
        )}
        <p className="setup-live-status" role="status" aria-live="polite">
          {announcement}
        </p>
        {(localError || error) && (
          <p className="inline-message" role="alert">
            {localError || error}
          </p>
        )}
        {sharedMode && allowPractice && (
          <label className="field">
            Game type
            <select
              value={sharedMode}
              onChange={(event) =>
                onSharedModeChange?.(
                  event.target.value as "confirmed" | "practice",
                )
              }
              disabled={disabled}
            >
              <option value="confirmed">Family game</option>
              <option value="practice">Private test — superadmins only</option>
            </select>
            <small>
              Only the scorer needs to sign in. Other players can play without
              accounts or approvals. Concerns can be flagged for superadmin
              review.
            </small>
          </label>
        )}
        <p className="muted">
          {lexiconDetails(defaultLexicon).shortLabel} ·{" "}
          {defaultLexicon.words.length.toLocaleString("en-US")} words ·{" "}
          {chosenTotal} tiles ·{" "}
          {sharedMode === "practice"
            ? "private to superadmins"
            : sharedMode
              ? "saved to shared history"
              : "saved on this device"}
          . Solo practice and custom tile quantities stay outside standard
          family records.
        </p>
        <div className="dialog-actions">
          <button type="button" className="button light" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={
              disabled ||
              !selected.length ||
              !selected.includes(first) ||
              chosenTotal < selected.length * 7
            }
            onClick={async () => {
              if (disabled || operation.current) return;
              operation.current = true;
              setWorking(true);
              setLocalError(null);
              try {
                await onStart(
                  [...seats],
                  first,
                  direction,
                  tileSetId,
                  equipmentRevision,
                );
              } catch (failure) {
                setLocalError(
                  failure instanceof Error
                    ? failure.message
                    : "The game could not be started. Your setup has been kept.",
                );
              } finally {
                operation.current = false;
                setWorking(false);
              }
            }}
          >
            {`Start ${selected.length === 1 ? "practice" : "game"}`}
          </button>
        </div>
        {ghost && (
          <div
            className="setup-drag-ghost"
            style={{ left: ghost.x, top: ghost.y }}
          >
            {playerName(ghost.id)}
          </div>
        )}
      </div>
    </Modal>
  );
}
