"use client";
import { useRef, useState } from "react";
import {
  similarColours,
  validateDefinition,
  type CrokinoleDefinition,
  type CrokinoleScoringMode,
  type PieceColour,
} from "../../domain/crokinole";
import type { SavedPlayer } from "../../lib/preview-store";
import {
  DEFAULT_CROKINOLE_SETTINGS,
  type CrokinoleDefaults,
} from "../../domain/crokinole-defaults";
import { CrokinoleRules } from "./CrokinoleRules";
import { Disc } from "./Disc";
export const SCORING_LABELS: Record<CrokinoleScoringMode, string> = {
  net_winner_only: "Net score — winner only",
  cumulative_round_totals: "Cumulative Round Totals",
  traditional_differential: "Traditional Difference",
  nca_match_points: "NCA-style Match Points",
};
export function CrokinoleSetup({
  familyId,
  players,
  palette,
  canCreate,
  canPractice,
  busy,
  onCreate,
  onColours,
  initialDefinition,
  defaults = DEFAULT_CROKINOLE_SETTINGS,
  onAddPlayer,
}: {
  familyId: string;
  players: SavedPlayer[];
  palette: PieceColour[];
  canCreate: boolean;
  canPractice: boolean;
  busy: boolean;
  onCreate: (definition: CrokinoleDefinition) => Promise<void>;
  onColours: (() => void) | null;
  initialDefinition?: CrokinoleDefinition;
  defaults?: CrokinoleDefaults;
  onAddPlayer?: () => void;
}) {
  const [count, setCount] = useState<2 | 3 | 4>(
    (initialDefinition?.players.length ?? defaults.playerCount) as 2 | 3 | 4,
  );
  const [individual, setIndividual] = useState(
    (initialDefinition?.format ?? defaults.format) === "free_for_all",
  );
  const [ids, setIds] = useState<string[]>(() =>
    [
      ...new Set([
        ...(initialDefinition?.players ?? [])
          .slice()
          .sort((a, b) => a.seatOrder - b.seatOrder)
          .map((p) => p.id)
          .filter((id) => players.some((p) => p.id === id)),
        ...players.map((p) => p.id),
      ]),
    ].slice(0, 4),
  );
  const [colours, setColours] = useState<string[]>(() =>
    [
      ...new Set([
        ...(initialDefinition?.participants ?? [])
          .map((p) => p.colour.id)
          .filter((id) => palette.some((c) => c.id === id && c.isActive)),
        ...palette
          .filter((c) => c.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((c) => c.id),
      ]),
    ].slice(0, 4),
  );
  const [mode, setMode] = useState<CrokinoleScoringMode>(
    initialDefinition?.scoringMode ?? defaults.scoringMode,
  );
  const [endType, setEndType] = useState<"target" | "fixed_rounds">(
    initialDefinition?.endCondition.type ?? defaults.endCondition.type,
  );
  const [length, setLength] = useState(
    String(
      (initialDefinition?.endCondition ?? defaults.endCondition).type ===
        "target"
        ? (
            (initialDefinition?.endCondition ?? defaults.endCondition) as {
              target: number;
            }
          ).target
        : (
            (initialDefinition?.endCondition ?? defaults.endCondition) as {
              rounds: number;
            }
          ).rounds,
    ),
  );
  const [starter, setStarter] = useState("random");
  const [practice, setPractice] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const doubles = count === 4 && !individual;
  const free = count === 3 || (count === 4 && individual);
  const selected = ids
    .slice(0, count)
    .map((id) => players.find((p) => p.id === id));
  const sides = doubles
    ? [
        [0, 2],
        [1, 3],
      ]
    : Array.from({ length: count }, (_, i) => [i]);
  const available = palette
    .filter((c) => c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const assigned = sides.map((_, i) =>
    palette.find((c) => c.id === colours[i]),
  );
  const similar = assigned.some(
    (a, i) =>
      a &&
      assigned.some(
        (b, j) =>
          b && j > i && a.id !== b.id && similarColours(a.value, b.value),
      ),
  );
  const ready =
    selected.length === count &&
    selected.every(Boolean) &&
    new Set(ids.slice(0, count)).size === count &&
    assigned.every((c) => c?.isActive) &&
    new Set(colours.slice(0, sides.length)).size === sides.length;
  function changeCount(value: 2 | 3 | 4) {
    setCount(value);
    setIndividual(false);
    setStarter("random");
    setIds([...new Set([...ids, ...players.map((p) => p.id)])].slice(0, 4));
    if (
      value === 3 &&
      !["net_winner_only", "cumulative_round_totals"].includes(mode)
    )
      changeMode("net_winner_only");
  }
  function changeMode(value: CrokinoleScoringMode) {
    setMode(value);
    setEndType(value === "nca_match_points" ? "fixed_rounds" : "target");
    setLength(
      value === "nca_match_points"
        ? "4"
        : value === "traditional_differential"
          ? "100"
          : "300",
    );
  }
  async function start() {
    if (lock.current || busy || !ready) return;
    setError("");
    const actualPlayers = selected.map((p, seatOrder) => ({
      id: p!.id,
      name: p!.name,
      seatOrder,
    }));
    const definition: CrokinoleDefinition = {
      schemaVersion: 1,
      rulesVersion: 1,
      id: crypto.randomUUID(),
      familyId,
      mode: practice ? "practice" : "confirmed",
      createdAt: new Date().toISOString(),
      players: actualPlayers,
      participants: sides.map((seats, i) => ({
        id: doubles ? crypto.randomUUID() : actualPlayers[seats[0]].id,
        name: seats.map((s) => actualPlayers[s].name).join(" & "),
        playerIds: seats.map((s) => actualPlayers[s].id),
        colour: {
          id: assigned[i]!.id,
          name: assigned[i]!.name,
          value: assigned[i]!.value,
        },
      })),
      format: doubles ? "doubles" : free ? "free_for_all" : "singles",
      scoringMode: mode,
      endCondition:
        endType === "target"
          ? { type: "target", target: Number(length) }
          : { type: "fixed_rounds", rounds: Number(length) },
      initialStartingPlayerId:
        starter === "random"
          ? actualPlayers[crypto.getRandomValues(new Uint32Array(1))[0] % count]
              .id
          : starter,
    };
    try {
      validateDefinition(definition);
      lock.current = true;
      setSaving(true);
      await onCreate(definition);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start this game.");
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <>
      <h1>New Crokinole game</h1>
      <p className="crokinole-subtitle">
        Choose your people. Enter one total per side after each round.
      </p>
      <label className="crokinole-field">Players</label>
      <div className="segmented" aria-label="Number of players">
        {([2, 3, 4] as const).map((n) => (
          <button
            key={n}
            aria-pressed={count === n}
            onClick={() => changeCount(n)}
          >
            {n} players
          </button>
        ))}
      </div>
      {count === 4 && (
        <div className="crokinole-actions">
          <div className="segmented" aria-label="Play format">
            <button
              aria-pressed={!individual}
              onClick={() => setIndividual(false)}
            >
              Doubles
            </button>
            <button
              aria-pressed={individual}
              onClick={() => {
                setIndividual(true);
                if (
                  !["net_winner_only", "cumulative_round_totals"].includes(mode)
                )
                  changeMode("net_winner_only");
              }}
            >
              Individual
            </button>
          </div>
        </div>
      )}
      <p className="crokinole-subtitle">
        {doubles
          ? "Two teams of two. Partners sit opposite each other."
          : free
            ? "Family Free-for-All · each player keeps their own total."
            : "Singles · one player per side."}
      </p>
      {players.length < count && (
        <p className="crokinole-notice">
          Add more people in Players before starting a {count}-player game.
        </p>
      )}
      {onAddPlayer && (
        <button className="text-button" onClick={onAddPlayer}>
          Add a player
        </button>
      )}
      <div className="crokinole-roster">
        {sides.map((seats, i) => (
          <section className="crokinole-person" key={i}>
            <h3>{doubles ? `Team ${i + 1}` : `Player ${i + 1}`}</h3>
            {seats.map((seat) => (
              <label className="crokinole-field" key={seat}>
                {doubles ? `Partner ${seats.indexOf(seat) + 1}` : "Name"}
                <select
                  value={ids[seat] ?? ""}
                  onChange={(e) =>
                    setIds((current) => {
                      const next = [...current];
                      const other = next.indexOf(e.target.value);
                      if (other >= 0) next[other] = next[seat];
                      next[seat] = e.target.value;
                      return next;
                    })
                  }
                >
                  <option value="">Choose a player</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <div
              className="crokinole-swatches"
              aria-label={`Piece colour for ${doubles ? "team" : "player"} ${i + 1}`}
            >
              {available.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  aria-label={c.name}
                  aria-pressed={colours[i] === c.id}
                  disabled={colours
                    .slice(0, sides.length)
                    .some((id, j) => j !== i && id === c.id)}
                  onClick={() =>
                    setColours((current) => {
                      const next = [...current];
                      next[i] = c.id;
                      return next;
                    })
                  }
                >
                  <Disc value={c.value} label={c.name} />
                </button>
              ))}
            </div>
            <small>{assigned[i]?.name ?? "Choose a colour"}</small>
          </section>
        ))}
      </div>
      {doubles && (
        <p className="crokinole-subtitle">
          Clockwise seats:{" "}
          {selected.map((p) => p?.name ?? "Choose player").join(" → ")}. Change
          a name to swap seats.
        </p>
      )}
      {similar && (
        <p className="crokinole-notice">
          These piece colours look similar. You can keep them; names identify
          each side.
        </p>
      )}
      {onColours && (
        <button className="text-button" onClick={onColours}>
          Manage piece colours
        </button>
      )}
      <details className="crokinole-options">
        <summary>
          Game options · {SCORING_LABELS[mode]} ·{" "}
          {endType === "target" ? `first to ${length}` : `${length} rounds`}
        </summary>
        <div className="crokinole-fields">
          {
            <label className="crokinole-field">
              Scoring
              <select
                value={mode}
                onChange={(e) =>
                  changeMode(e.target.value as CrokinoleScoringMode)
                }
              >
                {Object.entries(SCORING_LABELS)
                  .filter(
                    ([value]) =>
                      !free ||
                      ["net_winner_only", "cumulative_round_totals"].includes(
                        value,
                      ),
                  )
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
          }
          <label className="crokinole-field">
            Match length
            <select
              value={endType}
              disabled={mode === "traditional_differential"}
              onChange={(e) => {
                const type = e.target.value as typeof endType;
                setEndType(type);
                setLength(
                  type === "fixed_rounds"
                    ? "4"
                    : mode === "nca_match_points"
                      ? "5"
                      : "300",
                );
              }}
            >
              <option value="fixed_rounds">Fixed rounds</option>
              <option value="target">First to a target</option>
            </select>
          </label>
          <label className="crokinole-field">
            {endType === "target" ? "Target" : "Rounds"}
            {mode === "nca_match_points" ? (
              <select
                value={length}
                onChange={(e) => setLength(e.target.value)}
              >
                {(endType === "target" ? [5, 7, 9, 11] : [4]).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                inputMode="numeric"
                min={endType === "target" ? 5 : 1}
                step={endType === "target" ? 5 : 1}
                value={length}
                onChange={(e) => setLength(e.target.value)}
              />
            )}
          </label>
          <label className="crokinole-field">
            Who starts?
            <select
              value={starter}
              onChange={(e) => setStarter(e.target.value)}
            >
              <option value="random">Random player</option>
              {selected.filter(Boolean).map((p) => (
                <option key={p!.id} value={p!.id}>
                  {p!.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="crokinole-subtitle">
          {mode === "net_winner_only"
            ? "Enter the winner’s already-netted points. Other players stay at zero. No further subtraction."
            : mode === "cumulative_round_totals"
              ? "Family scoring: add each round total. Equal leaders at the end share a tie."
              : mode === "traditional_differential"
                ? "The higher side receives the difference. A tied round awards zero."
                : "A round win awards 2 points; a tie awards 1 each. Equal leaders at the target share a tie."}
        </p>
        {canPractice && (
          <label>
            <input
              type="checkbox"
              checked={practice}
              onChange={(e) => setPractice(e.target.checked)}
            />{" "}
            Private test game · superadmins only
          </label>
        )}
      </details>
      <CrokinoleRules mode={mode} />
      {error && (
        <p role="alert" className="crokinole-error">
          {error}
        </p>
      )}
      <div className="crokinole-actions">
        <button
          className="button primary"
          disabled={!canCreate || busy || saving || !ready}
          onClick={() => void start()}
        >
          {saving ? "Starting…" : "Start game"}
        </button>
      </div>
      {!canCreate && (
        <p className="crokinole-subtitle">Your account cannot start games.</p>
      )}
    </>
  );
}
