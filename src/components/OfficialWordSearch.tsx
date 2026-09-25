"use client";
import { useEffect, useRef, useState } from "react";
import type { VerifiedWord } from "../domain/verified-words";
import { lookupOfficialWord } from "../lib/official-word-client";
import { Modal } from "./Modal";
import "./official-word-search.css";

type Result = {
  word: string;
  sourceUrl?: string;
  message: string;
  playable?: boolean;
  saved?: boolean;
  evidence?: VerifiedWord;
};
export function OfficialWordSearch({
  initialQuery,
  onSave,
  onClose,
  storageScope = "device",
}: {
  initialQuery: string;
  storageScope?: "device" | "family";
  onSave: (words: VerifiedWord[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);
  useEffect(() => () => request.current?.abort(), []);
  async function search() {
    if (request.current) return;
    const inputs = query.trim().split(/[\s,]+/);
    if (
      inputs.length > 8 ||
      !inputs.every((word) => /^[a-zA-Z]{2,15}$/.test(word))
    ) {
      setError(
        "Enter 2–15 letters per word, separated by commas. Check up to eight words at once.",
      );
      return;
    }
    const words = [...new Set(inputs.map((word) => word.toUpperCase()))];
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    setResults([]);
    const checked: Result[] = [];
    try {
      for (const word of words) {
        try {
          const result = await lookupOfficialWord(word, controller.signal);
          if (controller.signal.aborted) return;
          const evidence: VerifiedWord = {
            word: result.word,
            source: result.source,
            sourceUrl: result.sourceUrl,
            verifiedAt: result.verifiedAt,
          };
          checked.push({
            word,
            sourceUrl: result.sourceUrl,
            playable: result.playable,
            message: result.playable
              ? "Playable on Merriam-Webster."
              : "Merriam-Webster says this word is not playable.",
            ...(result.playable ? { evidence } : {}),
          });
        } catch (cause) {
          if (controller.signal.aborted) return;
          checked.push({
            word,
            message:
              cause instanceof Error
                ? cause.message
                : "The site could not be checked. Try again.",
          });
        }
        setResults([...checked]);
      }
      const additions = checked.flatMap((result) =>
        result.evidence ? [result.evidence] : [],
      );
      if (additions.length) {
        saving.current = true;
        const saved = await onSave(additions);
        saving.current = false;
        if (controller.signal.aborted) return;
        setResults(
          checked.map((result) =>
            result.playable
              ? {
                  ...result,
                  saved,
                  message: saved
                    ? "Verified and saved to your word list."
                    : "Verified, but could not be saved. Retry after resolving the storage error.",
                }
              : result,
          ),
        );
        if (!saved)
          setError(
            "The verified words were not saved. Your board letters are retained.",
          );
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "The words could not be saved. Your board letters are kept; retry safely.",
        );
    } finally {
      saving.current = false;
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function close() {
    if (saving.current) return;
    request.current?.abort();
    onClose();
  }
  return (
    <Modal title="Search official site" onClose={close}>
      <p>
        Check Merriam-Webster’s live Scrabble finder. Playable words are saved
        {storageScope === "family"
          ? " to your family word list, shared across signed-in devices"
          : " on this device"}{" "}
        with their source and verification date, ready for future games and
        practice.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label className="field">
          Word or words
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={busy}
            maxLength={135}
            placeholder="ONYX"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? "Checking and saving…" : "Check Merriam-Webster"}
        </button>
      </form>
      {error && (
        <p className="inline-message" role="alert">
          {error}
        </p>
      )}
      <div className="official-results" aria-live="polite">
        {results.map((result) => (
          <div
            key={result.word}
            className={`official-result official-verdict ${result.playable === true ? "is-playable" : result.playable === false ? "is-unplayable" : "is-unknown"}`}
          >
            <h3 className="official-verdict-heading">
              <span className="official-verdict-icon" aria-hidden="true">
                {result.playable === true
                  ? "✓"
                  : result.playable === false
                    ? "×"
                    : "?"}
              </span>
              <span>
                <span className="official-verdict-word">{result.word}</span>
                <span className="official-verdict-label">
                  {result.playable === true
                    ? "Playable"
                    : result.playable === false
                      ? "Not playable"
                      : "Could not verify"}
                </span>
              </span>
            </h3>
            <p>{result.message}</p>
            {result.sourceUrl && (
              <a
                href={result.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View official result ↗
              </a>
            )}
          </div>
        ))}
      </div>
      <p className="muted">
        Every complete word formed on the board must be accepted, including
        crosswords. Verification does not bypass placement, tile-count or
        scoring rules. Earlier scores stay unchanged.
      </p>
      <div className="dialog-actions">
        <button className="button light" disabled={busy} onClick={close}>
          Back to board
        </button>
      </div>
    </Modal>
  );
}
