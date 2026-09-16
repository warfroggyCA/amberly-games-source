"use client";
import { useState } from "react";
import {
  familyWordAdditions,
  lexiconDetails,
  resolveLexicon,
  type LexiconReference,
} from "../lib/lexicons";
import { extendLexicon, type VerifiedWord } from "../domain/verified-words";
import { Modal } from "./Modal";

export function WordReference({
  reference,
  verifiedWords = [],
  onClose,
}: {
  reference: LexiconReference;
  verifiedWords?: readonly VerifiedWord[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const lexicon = extendLexicon(resolveLexicon(reference), verifiedWords);
  const details = lexiconDetails(reference);
  const extraCount = verifiedWords.filter(
    (entry) => !resolveLexicon(reference).has(entry.word),
  ).length;
  const word = query.trim().toUpperCase();
  const validInput = /^[a-zA-Z]{2,15}$/.test(query.trim());
  const included = validInput && lexicon.has(word);
  const addition = details.family && familyWordAdditions.includes(word);
  return (
    <Modal title="Word list" onClose={onClose} wide>
      <h3>{details.label}</h3>
      <p>
        <strong>
          {(details.count + extraCount).toLocaleString("en-US")} words
        </strong>
        {extraCount > 0 &&
          ` (${details.count.toLocaleString("en-US")} base + ${extraCount} verified)`}{" "}
        · {lexicon.edition}
      </p>
      <p>{details.description}</p>
      <label className="field">
        Check a word
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={30}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="Type a word"
        />
      </label>
      <p className="inline-message" role="status">
        {!query.trim()
          ? "Enter 2–15 letters to check this game's exact word list."
          : !validInput
            ? "Use 2–15 letters A–Z without spaces or punctuation."
            : included
              ? `${word} is included${addition ? " as a family addition from OSPD5" : ""}.`
              : `${word} is not in this word list.`}
      </p>
      <p className="muted">
        A word’s inclusion does not establish that a board placement is legal.
        New and crossing words, tile counts and scoring are checked together
        when you enter a turn.
      </p>
      {!!verifiedWords.length && (
        <details>
          <summary>Live verified additions ({verifiedWords.length})</summary>
          {verifiedWords.map((entry) => (
            <p key={entry.word}>
              <a
                href={entry.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {entry.word} ↗
              </a>{" "}
              · {new Date(entry.verifiedAt).toLocaleDateString()}
            </p>
          ))}
        </details>
      )}
      {details.family && (
        <details>
          <summary>View the 130 family additions from OSPD5</summary>
          <div className="example-words">{familyWordAdditions.join(" · ")}</div>
        </details>
      )}
      {details.legacy && (
        <>
          <p>Start a new game to use the combined family word list.</p>
          <div className="example-words">
            {resolveLexicon(reference).words.join(" · ")}
          </div>
        </>
      )}
      <p className="muted">
        Each game keeps its original word-list version. Existing scores and
        history are preserved. This local preview is saved only in this browser.
      </p>
    </Modal>
  );
}
