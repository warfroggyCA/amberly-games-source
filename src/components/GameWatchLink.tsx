"use client";
import { useRef, useState } from "react";
import { Modal } from "./Modal";
import { TabletopIcon } from "./TabletopIcon";
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
        setMessage("Sharing stopped. Previous viewing links no longer work.");
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
          "Your link is ready. Copy it and send it to your spectators.",
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
        <span className="watch-link-label">Viewing link</span>
      </button>
      {open && (
        <Modal
          title="Share this game"
          className="watch-share-modal"
          onClose={() => setOpen(false)}
        >
          <div className="watch-share-intro">
            <span className="watch-share-tile" aria-hidden="true">
              <TabletopIcon name="board" />
            </span>
            <div>
              <span className="watch-share-eyebrow">A seat at the game</span>
              <p>Send a link to follow every word and score, live.</p>
            </div>
          </div>
          <ul className="watch-share-details" aria-label="Viewing access">
            <li>No sign-in</li>
            <li>View only</li>
            <li>Valid for 7 days</li>
          </ul>
          {link && (
            <label className="field watch-share-field">
              Your viewing link
              <input
                readOnly
                value={link}
                autoComplete="off"
                spellCheck={false}
                onFocus={(e) => e.target.select()}
              />
            </label>
          )}
          {message && (
            <p className="watch-share-status" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <div className="watch-share-actions">
            {link ? (
              <button
                type="button"
                className="button primary watch-share-primary"
                disabled={working || disabled}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setMessage("Link copied. It’s ready to send.");
                    setError(null);
                  } catch {
                    setError(
                      "Select the viewing link above and copy it manually.",
                    );
                  }
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="8" y="8" width="12" height="13" rx="2" />
                  <path d="M15 8V3H3v13h5" />
                </svg>
                Copy viewing link
              </button>
            ) : (
              <button
                type="button"
                className="button primary watch-share-primary"
                disabled={working || disabled}
                onClick={() => void change(false)}
              >
                {working ? "Updating…" : "Create viewing link"}
                <span aria-hidden="true">↗</span>
              </button>
            )}
            <p className="watch-share-note">
              A new link replaces any previous link for this game.
            </p>
            <div className="watch-share-manage">
              {link && (
                <button
                  type="button"
                  className="text-button"
                  disabled={working || disabled}
                  onClick={() => void change(false)}
                >
                  {working ? "Updating…" : "Replace link"}
                </button>
              )}
              <button
                type="button"
                className="text-button watch-share-stop"
                disabled={working || disabled}
                onClick={() => void change(true)}
              >
                Stop sharing
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
