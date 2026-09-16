"use client";
import { useEffect, useState } from "react";
import { officialWordUrl } from "../lib/official-word";
import {
  DEFINITION_SOURCE_LABEL,
  type WordDefinitionResult,
} from "../lib/word-definition";
import { lookupWordDefinition } from "../lib/word-definition-client";
import "./word-definition.css";

type Lookup = {
  word: string;
  result: WordDefinitionResult | null;
  error: boolean;
};
export function WordDefinition({ word }: { word: string }) {
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    lookupWordDefinition(word, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted)
          setLookup({ word, result, error: false });
      },
      () => {
        if (!controller.signal.aborted)
          setLookup({ word, result: null, error: true });
      },
    );
    return () => controller.abort();
  }, [word, attempt]);
  const current = lookup?.word === word ? lookup : null;
  return (
    <div className="word-definition" aria-label={`Definition of ${word}`}>
      <div role="status" aria-live="polite">
        {!current ? (
          <p className="muted">Loading meaning…</p>
        ) : current.error ? (
          <p className="muted">
            Meaning unavailable right now.{" "}
            <button
              className="text-button"
              onClick={() => {
                setLookup(null);
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </button>
          </p>
        ) : current.result?.definition ? (
          <>
            <p>{current.result.definition}</p>
            {!!current.result.related.length && (
              <dl className="word-definition-references">
                {current.result.related.map((entry) => (
                  <div key={entry.word}>
                    <dt>{entry.word}</dt>
                    <dd>{entry.definition}</dd>
                  </div>
                ))}
              </dl>
            )}
            <small
              className="word-definition-source"
              title="From the supplied OSPD5 download, labeled 2014. This source does not determine this game's word validity."
            >
              {DEFINITION_SOURCE_LABEL}
            </small>
          </>
        ) : (
          <p className="muted">
            No definition in our local reference for this word.
          </p>
        )}
      </div>
      <a
        className="word-definition-link"
        href={officialWordUrl(word)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Look up {word} on Merriam-Webster ↗
      </a>
    </div>
  );
}
