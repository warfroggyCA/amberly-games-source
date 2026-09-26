"use client";
import { useEffect, useState } from "react";
import { TabletopIcon } from "./TabletopIcon";
import { CrownIcon } from "./CrownIcon";
import { Modal } from "./Modal";
import "./result-badge.css";

import { makeResultBadge, type BadgeResult } from "../lib/result-badge";
export function ResultBadge({ result }: { result: BadgeResult | null }) {
  const [seen, setSeen] = useState({ id: result?.gameId, complete: !!result });
  const [open, setOpen] = useState(false);
  // Celebrate a newly completed game, not every historical visit or polling refresh.
  if (seen.id !== result?.gameId || seen.complete !== !!result) {
    setSeen({ id: result?.gameId, complete: !!result });
    setOpen(!seen.complete && !!result);
  }
  if (!result || !result.winners.length) return null;
  return (
    <>
      <button
        className="button light result-share-button"
        onClick={() => setOpen(true)}
      >
        <TabletopIcon name="share" /> Share result
      </button>
      {open && (
        <BadgeDialog
          key={JSON.stringify(result)}
          result={result}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function BadgeDialog({
  result,
  onClose,
}: {
  result: BadgeResult;
  onClose: () => void;
}) {
  const [image, setImage] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const serialized = JSON.stringify(result);
  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    void makeResultBadge(
      JSON.parse(serialized) as BadgeResult,
      controller.signal,
    )
      .then((blob) => {
        window.clearTimeout(timeout);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setImage({
          file: new File([blob], "amberly-winner.png", { type: "image/png" }),
          url,
        });
      })
      .catch(() => {
        window.clearTimeout(timeout);
        if (!cancelled)
          setError("Could not prepare the image. Please try again.");
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [serialized, attempt]);
  const canShare =
    image &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [image.file] });
  async function share() {
    if (!image || busy) return;
    setBusy(true);
    setError("");
    try {
      await navigator.share({
        files: [image.file],
        title: `Amberly Games · ${result.game}`,
        text: `${result.winners.map((w) => w.name).join(" & ")} ${result.winners.length > 1 ? "tied" : "won"} at ${result.game}!`,
      });
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError"))
        setError(
          "Sharing didn’t open. You can save the image and attach it to a message.",
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Well played!"
      onClose={onClose}
      className="result-badge-modal"
    >
      <div className="result-badge" role="status">
        {image ? (
          // The local generated PNG is also the exact file shared by the device.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            width={1080}
            height={1080}
            alt={`${result.game} ${result.winners.length > 1 ? "tied result" : "winner"}: ${result.winners.map((w) => `${w.name}, ${w.score} points`).join("; ")}${result.note ? `. ${result.note}` : ""}`}
          />
        ) : (
          <div className="result-badge-loading">
            <CrownIcon />
            <strong>{result.game}</strong>
            <p>Preparing your winner’s badge…</p>
          </div>
        )}
        <div className="sr-only">
          {result.winners.map((w, i) => (
            <p key={i}>
              {w.name} · {w.score} points
            </p>
          ))}
          {result.note}
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="result-badge-actions">
        {!image && !error && <p role="status">Preparing your badge…</p>}
        {!image && error && (
          <button
            className="button light"
            onClick={() => {
              setError("");
              setAttempt((a) => a + 1);
            }}
          >
            Try again
          </button>
        )}
        {canShare && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void share()}
          >
            {busy ? "Sharing…" : "Share badge"}
          </button>
        )}
        {image && (
          <a
            className={`button ${canShare ? "light" : "primary"}`}
            href={image.url}
            download="amberly-winner.png"
          >
            Save image
          </a>
        )}
      </div>
      <p className="result-badge-hint">
        Send the badge in a text or your favourite messaging app.
      </p>
    </Modal>
  );
}
