"use client";
import { useEffect, useRef, useState } from "react";
import {
  CROKINOLE_HIGH_SCORE,
  calculateRoundAwards,
  createCrokinoleRematch,
  getStartingPlayer,
  previewCrokinoleCorrection,
  type CrokinoleCommand,
  type CrokinoleDefinition,
  type CrokinoleEntry,
  type CrokinoleGame,
  type CrokinoleRound,
  type PieceColour,
} from "../../domain/crokinole";
import type { CrokinoleDefaults } from "../../domain/crokinole-defaults";
import { CrokinoleRules } from "./CrokinoleRules";
import type { SavedPlayer } from "../../lib/preview-store";
import { Modal } from "../Modal";
import { PlayerAvatar } from "../PlayerAvatar";
import { Disc } from "./Disc";
import { ColourSettings } from "./ColourSettings";
import { CrokinoleSetup, SCORING_LABELS } from "./CrokinoleSetup";
import "./crokinole.css";
import { useScoringWakeLock } from "./useScoringWakeLock";
export type CrokinoleUiDraft = {
  values: Record<string, string>;
  editingRoundId: string | null;
};
export type CrokinoleAppProps = {
  familyId: string;
  initialDefinition?: CrokinoleDefinition;
  defaults?: CrokinoleDefaults;
  onAddPlayer?: () => void;
  players: SavedPlayer[];
  palette: PieceColour[];
  match: CrokinoleGame | null;
  canScore: boolean;
  canCreate: boolean;
  canManageEquipment: boolean;
  canPractice: boolean;
  busy: boolean;
  saveStatus?: string;
  draft: CrokinoleUiDraft | null;
  onDraftChange: (draft: CrokinoleUiDraft) => void;
  onCreate: (definition: CrokinoleDefinition) => Promise<void>;
  onCommand: (command: CrokinoleCommand) => Promise<void>;
  onSavePalette: (colours: PieceColour[]) => Promise<void>;
  onNewGame: () => void;
  onHome: () => void;
  onMenu?: () => void;
};
type Confirmation = {
  title: string;
  message: string;
  action: string;
  run: () => Promise<void>;
  reasonRequired?: boolean;
};
export function CrokinoleApp(props: CrokinoleAppProps) {
  const { match, palette, canScore, busy, draft, onDraftChange, onCommand } =
    props;
  useScoringWakeLock(canScore && match?.status === "active");
  const [showColours, setShowColours] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [selectedRound, setDetails] = useState<CrokinoleRound | null>(null);
  const details =
    match?.rounds.find((round) => round.id === selectedRound?.id) ?? null;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [reason, setReason] = useState("");
  const reasonRef = useRef("");
  const matrix = useRef<HTMLDivElement>(null);
  const previousRoundCount = useRef(-1);
  const pending = working || busy;
  const participants = match?.definition.participants ?? [];
  const editing = match?.rounds.find((r) => r.id === draft?.editingRoundId);
  const values = Object.fromEntries(
    participants.map((p) => [p.id, draft?.values[p.id] ?? "0"]),
  );
  const entries: CrokinoleEntry[] = participants.map((p) => ({
    participantId: p.id,
    rawScore: /^\d+$/.test(values[p.id] ?? "") ? Number(values[p.id]) : NaN,
  }));
  const valid =
    !(draft?.editingRoundId && !editing) &&
    entries.length >= 2 &&
    (match?.definition.scoringMode !== "net_winner_only" ||
      entries.filter((e) => e.rawScore > 0).length <= 1) &&
    entries.every(
      (e) =>
        Number.isSafeInteger(e.rawScore) &&
        e.rawScore >= 0 &&
        e.rawScore % 5 === 0,
    );
  const awards =
    valid && match
      ? calculateRoundAwards(match.definition.scoringMode, entries)
      : null;
  const maximum = match ? Math.max(...Object.values(match.totals)) : 0;
  const leaders = match
    ? participants.filter((p) => match.totals[p.id] === maximum)
    : [];
  useEffect(() => {
    if (match && match.rounds.length > previousRoundCount.current)
      matrix.current?.scrollTo({
        left: matrix.current.scrollWidth,
        behavior: "instant",
      });
    previousRoundCount.current = match?.rounds.length ?? 0;
  }, [match]);
  async function run(action: () => Promise<void>, message: string) {
    if (lock.current || busy) return;
    lock.current = true;
    setWorking(true);
    setError("");
    try {
      await action();
      setNotice(message);
      setConfirmation(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Your entry is still available.",
      );
    } finally {
      lock.current = false;
      setWorking(false);
    }
  }
  function confirm(value: Confirmation) {
    setReason("");
    reasonRef.current = "";
    setConfirmation(value);
  }
  function change(id: string, value: string) {
    onDraftChange({
      values: { ...values, [id]: value },
      editingRoundId: draft?.editingRoundId ?? null,
    });
  }
  function openNew() {
    if (draft?.editingRoundId) {
      setEntryOpen(true);
      return;
    }
    setEntryOpen(true);
  }
  function edit(round: CrokinoleRound) {
    const begin = () => {
      onDraftChange({
        values: Object.fromEntries(
          round.entries.map((e) => [e.participantId, String(e.rawScore)]),
        ),
        editingRoundId: round.id,
      });
      setDetails(null);
      setEntryOpen(true);
    };
    if (
      Object.values(draft?.values ?? {}).some((v) => v !== "") &&
      draft?.editingRoundId !== round.id
    ) {
      confirm({
        title: "Replace your current entry?",
        message:
          "There is an unfinished score entry. Opening this round for editing replaces that draft. Saved rounds are unchanged.",
        action: "Replace draft",
        run: async () => begin(),
      });
    } else begin();
  }
  async function saveRound() {
    if (!match || !valid || pending) return;
    setError("");
    let excluded: string[] = [];
    try {
      if (editing)
        excluded = previewCrokinoleCorrection(
          match,
          editing.id,
          entries,
        ).excludedRoundIds;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check these scores.");
      return;
    }
    const high = entries.some((e) => e.rawScore > CROKINOLE_HIGH_SCORE);
    const ended = match.status !== "active";
    const submit = async () => {
      const command: CrokinoleCommand = editing
        ? {
            id: crypto.randomUUID(),
            expectedRevision: match.revision,
            type: "correct_round",
            roundId: editing.id,
            entries,
            excludedRoundIds: excluded,
            acknowledgedHighScores: high,
            ...(ended ? { reason: reasonRef.current.trim() } : {}),
          }
        : {
            id: crypto.randomUUID(),
            expectedRevision: match.revision,
            type: "record_round",
            roundId: crypto.randomUUID(),
            entries,
            acknowledgedHighScores: high,
          };
      await onCommand(command);
      setEntryOpen(false);
      requestAnimationFrame(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
    };
    if (high || excluded.length || ended) {
      confirm({
        title: ended
          ? "Amend this result?"
          : excluded.length
            ? "This changes when the match ends"
            : "Check the round total",
        message: [
          high
            ? `A round total exceeds ${CROKINOLE_HIGH_SCORE}. Keep it if that matches your pieces and rules.`
            : "",
          excluded.length
            ? `The corrected scores finish this game earlier. ${excluded.length} later round${excluded.length === 1 ? "" : "s"} will stop contributing to the result. Their original entries remain in history.`
            : "",
          ended
            ? "This can change the winner or reopen the match. The original result is retained in its amendment history."
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        action: editing ? "Save correction" : "Keep and save",
        reasonRequired: ended,
        run: submit,
      });
    } else
      await run(
        submit,
        editing ? "Round corrected. All totals recalculated." : "Round saved.",
      );
  }
  function undo() {
    if (!match || !match.rounds.length) return;
    const last = match.rounds.at(-1)!;
    const hasDraft = Object.values(draft?.values ?? {}).some((v) => v !== "");
    confirm({
      title: `Undo round ${last.number}?`,
      message: `The last round will stop contributing to the match, and its values will reopen for correction.${hasDraft ? " This replaces your unfinished entry." : ""} Original entries remain in history.`,
      action: "Undo round",
      reasonRequired: match.status !== "active",
      run: async () => {
        await onCommand({
          id: crypto.randomUUID(),
          expectedRevision: match.revision,
          type: "undo_round",
          ...(match.status !== "active"
            ? { reason: reasonRef.current.trim() }
            : {}),
        });
        onDraftChange({
          values: Object.fromEntries(
            last.entries.map((e) => [e.participantId, String(e.rawScore)]),
          ),
          editingRoundId: null,
        });
        setEntryOpen(true);
      },
    });
  }
  function participantAvatar(p: CrokinoleDefinition["participants"][number]) {
    return (
      <span className="crokinole-participant-avatars">
        {p.playerIds.map((id) => {
          const player = match?.definition.players.find(
            (player) => player.id === id,
          );
          return (
            <Disc key={id} value={p.colour.value} label={p.colour.name}>
              <PlayerAvatar
                name={player?.name ?? p.name}
                photoDataUrl={
                  props.players.find((profile) => profile.id === id)
                    ?.photoDataUrl
                }
              />
            </Disc>
          );
        })}
      </span>
    );
  }
  const starter = match
    ? getStartingPlayer(match.definition, match.rounds.length)
    : null;
  return (
    <main className="crokinole">
      {!props.onMenu && (
        <header className="crokinole-header">
          <button
            className="text-button"
            onClick={props.onHome}
            disabled={pending}
          >
            ← Games
          </button>
          <span className="crokinole-save-status" role="status">
            {props.saveStatus}
          </span>
          {match && props.onMenu && (
            <button
              className="button light"
              aria-label="More game options"
              onClick={props.onMenu}
            >
              ⋯
            </button>
          )}
          {match && canScore && !props.onMenu && (
            <button
              className="text-button"
              disabled={pending}
              onClick={() =>
                confirm({
                  title: "Start another game?",
                  message:
                    "This match stays in your history. Any unfinished match can be resumed later.",
                  action: "New game",
                  run: async () => props.onNewGame(),
                })
              }
            >
              New game
            </button>
          )}
        </header>
      )}
      {!match ? (
        <CrokinoleSetup
          {...props}
          onColours={
            props.canManageEquipment ? () => setShowColours(true) : null
          }
        />
      ) : (
        <>
          <span className="eyebrow">
            {match.definition.format === "free_for_all"
              ? "Family Free-for-All"
              : match.definition.format === "doubles"
                ? "Doubles"
                : "Singles"}
            {match.definition.mode === "practice" ? " · Private test" : ""}
          </span>
          <h1>Crokinole</h1>
          <CrokinoleRules mode={match.definition.scoringMode} />
          <p className="crokinole-subtitle">
            {SCORING_LABELS[match.definition.scoringMode]} ·{" "}
            {match.definition.endCondition.type === "target"
              ? `First to ${match.definition.endCondition.target}`
              : `${match.definition.endCondition.rounds} rounds`}
          </p>
          {match.status !== "active" && (
            <section className="crokinole-result">
              <span className="eyebrow">
                {match.status === "ended_early"
                  ? "Ended early · no winner declared"
                  : "Final result"}
              </span>
              <h2>
                {match.result
                  ? match.result.tied
                    ? `${match.result.winnerIds.map((id) => participants.find((p) => p.id === id)!.name).join(" & ")} tied`
                    : `${participants.find((p) => p.id === match.result!.winnerIds[0])!.name} wins`
                  : "Saved where you left it"}
              </h2>
              <p>{match.rounds.length} rounds played</p>
              {canScore && match.rounds.length > 0 && (
                <button
                  className="button light"
                  onClick={() =>
                    document
                      .getElementById("crokinole-rounds")
                      ?.scrollIntoView({ block: "start" })
                  }
                >
                  Edit rounds
                </button>
              )}
              {props.canCreate && (
                <button
                  className="button primary"
                  disabled={pending}
                  onClick={() =>
                    void run(
                      () =>
                        props.onCreate(
                          createCrokinoleRematch(
                            match,
                            crypto.randomUUID(),
                            new Date().toISOString(),
                          ).definition,
                        ),
                      "Rematch started.",
                    )
                  }
                >
                  Rematch
                </button>
              )}
            </section>
          )}
          <div className="crokinole-standings">
            {participants.map((p) => (
              <section className="crokinole-standing" key={p.id}>
                <div className="crokinole-identity">
                  {participantAvatar(p)}
                  <div>
                    <strong>{p.name}</strong>
                    {leaders.length === 1 &&
                      leaders[0].id === p.id &&
                      maximum > 0 && (
                        <small className="crokinole-leader">♛ Leading</small>
                      )}
                  </div>
                </div>
                <strong className="crokinole-total">
                  {match.totals[p.id]}
                </strong>
              </section>
            ))}
          </div>
          {match.status === "active" && (
            <div className="crokinole-start">
              <strong>Round {match.rounds.length + 1}</strong>
              <span>· {starter?.name} starts</span>
            </div>
          )}
          {!canScore && (
            <p className="crokinole-notice">
              You’re viewing this match. Only its designated scorer can change
              the scores.
            </p>
          )}
          {notice && (
            <p role="status" className="crokinole-subtitle">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="crokinole-error">
              {error}
            </p>
          )}
          {match.rounds.length > 0 ? (
            <>
              <h2 id="crokinole-rounds">Rounds</h2>
              <p className="crokinole-subtitle">
                {match.definition.scoringMode === "net_winner_only"
                  ? "Only the winner’s net points are added. Tied rounds add zero."
                  : match.definition.scoringMode === "cumulative_round_totals"
                    ? "Round totals add up to each score."
                    : "Awarded match points are shown. Open a round to see its raw totals."}
              </p>
              <button
                className="text-button crokinole-latest"
                onClick={() =>
                  matrix.current?.scrollTo({
                    left: matrix.current.scrollWidth,
                    behavior: "instant",
                  })
                }
              >
                Latest round →
              </button>
              <div className="crokinole-matrix" ref={matrix}>
                <table>
                  <caption className="sr-only">
                    Crokinole awarded points by round
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Player / team</th>
                      {match.rounds.map((r) => (
                        <th key={r.id} scope="col">
                          <button
                            aria-label={`Review round ${r.number}`}
                            onClick={() => setDetails(r)}
                          >
                            R{r.number}
                          </button>
                        </th>
                      ))}
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {participants.map((p) => (
                      <tr key={p.id}>
                        <th scope="row">
                          <div className="crokinole-identity">
                            {participantAvatar(p)}
                            <strong>{p.name}</strong>
                          </div>
                        </th>
                        {match.rounds.map((r) => (
                          <td key={r.id}>
                            <button
                              aria-label={`${p.name}, round ${r.number}, ${r.awards[p.id]} points. Review round.`}
                              onClick={() => setDetails(r)}
                            >
                              {r.awards[p.id]}
                            </button>
                          </td>
                        ))}
                        <td>{match.totals[p.id]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="crokinole-phone-history">
                <div className="crokinole-round-list">
                  {[...match.rounds].reverse().map((r) => (
                    <button
                      className="crokinole-round"
                      key={r.id}
                      onClick={() => setDetails(r)}
                    >
                      <header>
                        <span>Round {r.number}</span>
                        <span aria-hidden="true">›</span>
                      </header>
                      <div className="crokinole-round-values">
                        {participants.map((p) => (
                          <span key={p.id}>
                            {p.name}
                            <b>{r.awards[p.id]}</b>
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="crokinole-subtitle">
              Ready for the first round. Enter each side’s total when play
              finishes.
            </p>
          )}
          {canScore && (
            <div className="crokinole-actions crokinole-sticky-actions">
              {match.status === "active" && (
                <button
                  className="button primary"
                  disabled={pending}
                  onClick={openNew}
                >
                  {draft?.editingRoundId
                    ? "Continue correction"
                    : Object.values(draft?.values ?? {}).some((v) => v !== "")
                      ? "Continue entry"
                      : `Add Round ${match.rounds.length + 1}`}
                </button>
              )}
              <button
                className="button light"
                disabled={pending || !match.rounds.length}
                aria-label="Undo last round"
                onClick={undo}
              >
                ↶ Undo
              </button>
              {match.status === "active" && (
                <details className="crokinole-more">
                  <summary>More</summary>
                  <button
                    className="text-button"
                    disabled={pending}
                    onClick={() =>
                      confirm({
                        title: "End this game early?",
                        message:
                          "The current scores will be retained without declaring a winner. Unsaved round entries are not included.",
                        action: "End early",
                        reasonRequired: true,
                        run: () =>
                          onCommand({
                            id: crypto.randomUUID(),
                            expectedRevision: match.revision,
                            type: "end_early",
                            reason: reasonRef.current.trim(),
                          }),
                      })
                    }
                  >
                    End early
                  </button>
                </details>
              )}
            </div>
          )}
        </>
      )}
      {showColours && (
        <ColourSettings
          colours={palette}
          onSave={props.onSavePalette}
          onClose={() => setShowColours(false)}
          disabled={busy || !props.canManageEquipment}
        />
      )}
      {details && match && (
        <Modal
          title={`Round ${details.number}`}
          onClose={() => setDetails(null)}
          className="crokinole-dialog"
        >
          <p className="crokinole-subtitle">
            {
              match.definition.players.find(
                (p) => p.id === details.startingPlayerId,
              )?.name
            }{" "}
            started
          </p>
          {participants.map((p) => (
            <div className="crokinole-palette-row" key={p.id}>
              <div className="crokinole-identity">
                {participantAvatar(p)}
                <strong>{p.name}</strong>
              </div>
              <span>
                {
                  details.entries.find((e) => e.participantId === p.id)
                    ?.rawScore
                }{" "}
                {match.definition.scoringMode === "net_winner_only"
                  ? "net points"
                  : `raw → ${details.awards[p.id]} points`}{" "}
                · total {details.totals[p.id]}
              </span>
            </div>
          ))}
          {canScore && (
            <div className="crokinole-actions">
              <button
                className="button primary"
                disabled={pending}
                onClick={() => edit(details)}
              >
                Edit round
              </button>
            </div>
          )}
        </Modal>
      )}
      {entryOpen && match && canScore && (
        <Modal
          title={
            editing
              ? `Edit round ${editing.number}`
              : `Round ${match.rounds.length + 1}`
          }
          onClose={() => {
            if (!pending) setEntryOpen(false);
          }}
          className="crokinole-dialog crokinole-entry-dialog"
        >
          <div className="crokinole-entry-body">
            <p className="crokinole-subtitle">
              {match.definition.scoringMode === "net_winner_only"
                ? "Enter only the winner’s net points after cancelling pieces on the board. Everyone else stays at zero. For a tie, save all zeros."
                : "Enter each full round total, including 20s. Scores start at zero."}
            </p>
            {draft?.editingRoundId && !editing && (
              <p className="crokinole-error" role="alert">
                This round is no longer available. Your draft is retained.
                Discard it to begin a new entry.
              </p>
            )}
            <div className="crokinole-score-inputs">
              {participants.map((p) => (
                <section className="crokinole-score-panel" key={p.id}>
                  <div className="crokinole-identity">
                    {participantAvatar(p)}
                    <strong>{p.name}</strong>
                  </div>
                  <p>Match total: {match.totals[p.id]}</p>
                  <div className="crokinole-stepper">
                    <button
                      className="button light"
                      aria-label={`Subtract 5 from ${p.name}`}
                      disabled={
                        pending ||
                        !/^\d+$/.test(values[p.id] ?? "") ||
                        Number(values[p.id]) < 5
                      }
                      onClick={() =>
                        change(
                          p.id,
                          String(Math.max(0, Number(values[p.id]) - 5)),
                        )
                      }
                    >
                      −5
                    </button>
                    <input
                      aria-label={`${p.name} round total`}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="0"
                      value={values[p.id] ?? "0"}
                      disabled={pending}
                      onChange={(e) => change(p.id, e.target.value)}
                    />
                    <button
                      className="button light"
                      aria-label={`Add 5 to ${p.name}`}
                      disabled={
                        pending ||
                        ((values[p.id] ?? "") !== "" &&
                          !/^\d+$/.test(values[p.id]))
                      }
                      onClick={() =>
                        change(p.id, String(Number(values[p.id] || 0) + 5))
                      }
                    >
                      +5
                    </button>
                  </div>
                </section>
              ))}
            </div>
            {awards && (
              <div className="crokinole-preview">
                <strong>
                  Provisional {editing ? "round points" : "score update"}
                </strong>
                {participants.map((p) => (
                  <p key={p.id}>
                    <span>{p.name}</span>
                    <strong>
                      +{awards[p.id]}
                      {!editing
                        ? ` → ${match.totals[p.id] + awards[p.id]}`
                        : ""}
                    </strong>
                  </p>
                ))}
              </div>
            )}
            {!valid &&
              Object.values(draft?.values ?? {}).some((v) => v !== "") && (
                <p className="crokinole-subtitle">
                  {match.definition.scoringMode === "net_winner_only"
                    ? "Enter a multiple of five for at most one winner. Everyone else must be zero."
                    : "Scores must be non-negative multiples of five."}
                </p>
              )}
            {error && (
              <p role="alert" className="crokinole-error">
                {error}
              </p>
            )}
          </div>
          <div className="crokinole-actions crokinole-entry-footer">
            <button
              className="button primary"
              disabled={!valid || pending}
              onClick={() => void saveRound()}
            >
              {pending ? "Saving…" : editing ? "Save correction" : "Save round"}
            </button>
            <button
              className="button light"
              disabled={pending}
              onClick={() => setEntryOpen(false)}
            >
              Keep draft & close
            </button>
            <button
              className="text-button"
              disabled={pending}
              onClick={() =>
                confirm({
                  title: "Discard this entry?",
                  message:
                    "Only these unsaved entries will be cleared. Saved rounds stay unchanged.",
                  action: "Discard entry",
                  run: async () => {
                    onDraftChange({ values: {}, editingRoundId: null });
                    setEntryOpen(false);
                  },
                })
              }
            >
              Discard entry
            </button>
          </div>
        </Modal>
      )}
      {confirmation && (
        <Modal
          title={confirmation.title}
          onClose={() => {
            if (!pending) setConfirmation(null);
          }}
          className="crokinole-dialog"
        >
          <p className="crokinole-subtitle">{confirmation.message}</p>
          {confirmation.reasonRequired && (
            <label className="crokinole-field">
              Reason
              <textarea
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  reasonRef.current = e.target.value;
                }}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="crokinole-error">
              {error}
            </p>
          )}
          <div className="crokinole-actions">
            <button
              className="button light"
              disabled={pending}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={
                pending || (confirmation.reasonRequired && !reason.trim())
              }
              onClick={() => void run(confirmation.run, "Change saved.")}
            >
              {pending ? "Saving…" : confirmation.action}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
