"use client";
import { Modal } from "./Modal";
import { useId, useState } from "react";
import { resolveLexicon, type LexiconReference } from "../lib/lexicons";
import { extendLexicon, type VerifiedWord } from "../domain/verified-words";
import "./word-buddy.css";
import { wordBuddyAvailable } from "../lib/word-buddy-availability";

/** Queries never leave this component: no network, storage, or game commands. */
export function WordBuddy({
  reference,
  verifiedWords = [],
}: {
  reference: LexiconReference;
  verifiedWords?: readonly VerifiedWord[];
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const word = query.trim().toUpperCase();
  const valid = /^[A-Z]{2,15}$/.test(word);
  const lexicon = extendLexicon(resolveLexicon(reference), verifiedWords);
  if (!wordBuddyAvailable) return null;
  return (
    <section className="word-buddy" aria-label="Word Buddy">
      <button
        className="button light"
        aria-label={`Word Buddy · ${open ? "Close" : "Check a word"}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setQuery("");
          setOpen(!open);
        }}
      >
        {open ? "Close" : "Check word"}
      </button>
      {open && (
        <Modal
          title="Private word check"
          onClose={() => {
            setQuery("");
            setOpen(false);
          }}
        >
          <div id={id}>
            <label className="field">
              Private word check
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={15}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="done"
              />
            </label>
            <p role="status">
              {!word
                ? "Type 2–15 letters. Unlimited checks, only on this device."
                : !valid
                  ? "Use 2–15 letters A–Z."
                  : lexicon.has(word)
                    ? "Yes — accepted in this game."
                    : "Not in this game’s word list."}
            </p>
            <button className="button light" onClick={() => setQuery("")}>
              Clear word
            </button>
            <small>
              Word validity only; a board placement must still be reviewed.
            </small>
          </div>
        </Modal>
      )}
    </section>
  );
}
