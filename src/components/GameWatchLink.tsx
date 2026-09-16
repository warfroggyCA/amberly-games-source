"use client";
import { useRef, useState } from "react";
import { Modal } from "./Modal";
import "./game-watch-link.css";
import type { SharedScorerStore } from "../lib/shared-store";

export function GameWatchLink({
  gameId,
  store,
  disabled,
}: {
  gameId: string;
  store: SharedScorerStore;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  async function change(revoke: boolean) {
    if (busy.current || disabled) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      if (revoke) {
        await store.administer({ type: "revoke-watch-link", gameId });
        setLink(null);
        setMessage("The viewing link is closed.");
      } else {
        const token = Array.from(
          crypto.getRandomValues(new Uint8Array(32)),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
        // A replacement invalidates any older link; never offer that old link after an uncertain save.
        setLink(null);
        await store.administer({ type: "create-watch-link", gameId, token });
        setLink(`${location.origin}/watch#${token}`);
        setMessage(
          "Ready to share. Anyone with this link can watch for seven days.",
        );
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The viewing link could not be updated.",
      );
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="watch-link-button"
        onClick={() => setOpen(true)}
        aria-label="Share viewing link"
        title="Share viewing link"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg
          width="25"
          height="25"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2" />
        </svg>
      </button>
      {open && (
        <Modal title="Let the family watch" onClose={() => setOpen(false)}>
          <p>
            Share a live board and scoreboard. Guests need no account or
            sign-in, and cannot enter or change scores.
          </p>
          <p>
            A link lasts seven days. Creating a replacement closes the previous
            link for this game.
          </p>
          {link && (
            <label className="field">
              Viewing link
              <input
                readOnly
                value={link}
                autoComplete="off"
                spellCheck={false}
                onFocus={(e) => e.target.select()}
              />
            </label>
          )}
          {message && <p role="status">{message}</p>}
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            {link && (
              <button
                className="button primary"
                disabled={working || disabled}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setMessage("Link copied. You can send it to the family.");
                    setError(null);
                  } catch {
                    setError(
                      "Select the viewing link above and copy it manually.",
                    );
                  }
                }}
              >
                Copy link
              </button>
            )}
            <button
              className="button light"
              disabled={working || disabled}
              onClick={() => void change(false)}
            >
              {working
                ? "Updating…"
                : link
                  ? "Replace link"
                  : "Create or replace link"}
            </button>
            <button
              className="text-button"
              disabled={working || disabled}
              onClick={() => void change(true)}
            >
              Close viewing link
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
