"use client";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { AnimatedBoardEditor } from "./AnimatedBoardEditor";
import { BoardEditor } from "./BoardEditor";
import { Modal } from "./Modal";
import { WordBuddy } from "./WordBuddy";
import type { Draft } from "../lib/preview-store";

/** A private editor never receives a persistence, recording, or publishing callback. */
export function WordBuddyScorer({
  onHold,
  initiallyParked = false,
  onPromote,
  ...props
}: ComponentProps<typeof BoardEditor> & {
  initiallyParked?: boolean;
  onHold: (hold: boolean) => void;
  onPromote: (draft: Draft) => Promise<boolean>;
}) {
  const [help, setHelp] = useState(false);
  const [testing, setTesting] = useState(false);
  const [parked, setParked] = useState(initiallyParked);
  const [draft, setDraft] = useState<Draft>();
  const [recording, setRecording] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const occupied = !!props.savedDraft?.placements.length;
  function toggle() {
    if (working.current || props.locked) return;
    try {
      onHold(testing ? occupied : true);
    } catch {
      setError(
        "Private testing cannot start or resume safely because browser recovery storage is unavailable.",
      );
      return;
    }
    setDraft(undefined);
    setConfirm(false);
    setError("");
    if (testing) {
      setTesting(false);
      setParked(occupied);
    } else {
      setTesting(true);
      setParked(false);
    }
  }
  async function promote() {
    if (
      working.current ||
      props.locked ||
      occupied ||
      !draft?.placements.length
    )
      return;
    working.current = true;
    setRecording(true);
    try {
      if (await onPromote(draft)) {
        if (!mounted.current) return;
        setDraft(undefined);
        setConfirm(false);
        setTesting(false);
        try {
          onHold(false);
          setParked(false);
          setError("");
        } catch {
          setParked(true);
          setError(
            "Your play is saved as a scoring draft, but sharing is still paused because browser recovery storage is unavailable. Retry Resume live draft. Nothing was recorded.",
          );
        }
      } else {
        setConfirm(false);
        setError(
          "The game changed or the draft could not be saved. Nothing was recorded. Return to scoring to review the current game.",
        );
      }
    } catch {
      setConfirm(false);
      if (mounted.current)
        setError(
          "The draft could not be saved. Sharing remains paused; review the current game before retrying.",
        );
    } finally {
      working.current = false;
      if (mounted.current) setRecording(false);
    }
  }
  function resume() {
    try {
      onHold(false);
      setParked(false);
      setError("");
    } catch {
      setError(
        "Sharing is still paused because browser recovery storage is unavailable. Retry Resume live draft.",
      );
    }
  }
  return (
    <>
      <div className="word-buddy-controls">
        <button
          className="button light"
          disabled={props.locked || recording}
          aria-pressed={testing}
          onClick={toggle}
        >
          {testing ? "Score game" : "Test words"}
        </button>
        {!testing && !parked && (
          <span
            className="word-buddy-mode"
            title="Live scoring — entries are shared"
          >
            Live scoring
          </span>
        )}
        {testing && occupied && <p>Your scoring draft is preserved.</p>}
        {testing && !occupied && (
          <button
            className="button primary"
            disabled={props.locked || recording || !draft?.placements.length}
            onClick={() => setConfirm(true)}
          >
            Use this play
          </button>
        )}
        {testing && confirm && (
          <Modal
            title="Use this play?"
            onClose={() => {
              if (!recording) setConfirm(false);
            }}
          >
            <div role="group" aria-label="Share test play">
              <p>
                Everyone will see these tiles as the scorer’s live draft for the
                current turn. Review and Record are still required.
              </p>
              <button
                className="button primary"
                disabled={props.locked || recording || occupied}
                onClick={() => void promote()}
              >
                Share as live draft
              </button>
              <button
                className="button light"
                disabled={recording}
                onClick={() => setConfirm(false)}
              >
                Keep testing
              </button>
            </div>
          </Modal>
        )}
        {error && <p role="alert">{error}</p>}
        {parked && (
          <>
            <p>
              Your previous scoring draft is saved. Resuming makes it visible to
              everyone.
            </p>
            <button
              className="button primary"
              disabled={props.locked || recording}
              onClick={resume}
            >
              Resume live draft
            </button>
          </>
        )}
        <button className="button light" onClick={() => setHelp(true)}>
          About
        </button>
        {help && (
          <Modal title="About Word Buddy" onClose={() => setHelp(false)}>
            <p>
              Word Buddy is on for this game. Scores and records count normally.
              Everyone can privately check words against this game's word list.
            </p>
            <p>
              Test words uses green tiles, only on this device, for the current
              player's turn. Returning to Score game clears test placements and
              restores available tiles. Your previous scoring draft is
              preserved; record or clear it before using a test play.
            </p>
            <p>
              Earlier live letters may remain visible briefly while clearing.
              Letters already seen cannot be made unseen. Use this play asks
              before sharing and never records a turn automatically.
            </p>
          </Modal>
        )}
        <WordBuddy
          reference={props.game.lexicon}
          verifiedWords={props.game.verifiedWords}
        />
      </div>
      {testing ? (
        <BoardEditor
          key="private"
          {...props}
          privateTesting
          locked={props.locked || recording}
          savedDraft={undefined}
          onDraft={setDraft}
          onRecord={async () => false}
          onUndo={undefined}
          onRequestExtraTiles={undefined}
          onOfficialSearch={() => {}}
        />
      ) : (
        !parked && (
          <AnimatedBoardEditor
            {...props}
            onRecord={async (placements) => {
              if (working.current) return false;
              working.current = true;
              setRecording(true);
              try {
                return await props.onRecord(placements);
              } finally {
                working.current = false;
                setRecording(false);
              }
            }}
          />
        )
      )}
    </>
  );
}
