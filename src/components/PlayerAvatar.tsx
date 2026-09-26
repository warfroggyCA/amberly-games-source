"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "./Modal";
import "./player-avatar.css";

/** A shared photo viewer; initials remain decorative beside the player's name. */
export function PlayerAvatar({
  name,
  photoDataUrl,
}: {
  name: string;
  photoDataUrl?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!photoDataUrl) return <>{Array.from(name)[0]?.toUpperCase()}</>;
  return (
    <>
      <button
        type="button"
        className="player-avatar-open"
        aria-label={`View ${name}’s profile photo`}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.stopPropagation();
          // Safari does not focus buttons on tap; give the dialog an opener.
          event.currentTarget.focus({ preventScroll: true });
          setExpanded(true);
        }}
      >
        {/* Profile photos are validated and resized before storage. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="player-avatar-photo" src={photoDataUrl} alt="" />
      </button>
      {expanded &&
        createPortal(
          <div
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Modal
              title={name}
              onClose={() => setExpanded(false)}
              className="player-photo-viewer"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="player-photo-enlarged"
                src={photoDataUrl}
                alt={`${name}’s profile photo`}
              />
            </Modal>
          </div>,
          document.body,
        )}
    </>
  );
}
