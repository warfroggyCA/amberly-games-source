"use client";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_PHOTO_FRAME,
  photoCrop,
  prepareProfilePhoto,
} from "../lib/player-profile";
import { PortraitCrown } from "./PortraitCrown";
import {
  movePhotoFrame,
  type PhotoPointer,
} from "../lib/profile-photo-gesture";

export function ProfilePhotoFramer({
  file,
  onApply,
  onCancel,
}: {
  file: File;
  onApply: (photo: string) => void;
  onCancel: () => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [frame, renderFrame] = useState(DEFAULT_PHOTO_FRAME);
  const frameRef = useRef(DEFAULT_PHOTO_FRAME);
  const pointers = useRef(new Map<number, PhotoPointer>());
  function setFrame(next: typeof frame) {
    frameRef.current = next;
    renderFrame(next);
  }
  const [showCrown, setShowCrown] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (imageRef.current) imageRef.current.src = url;
    return () => {
      URL.revokeObjectURL(url);
      abort.current?.abort();
    };
  }, [file]);
  const crop = dimensions.width
    ? photoCrop(dimensions.width, dimensions.height, frame)
    : null;
  async function apply() {
    if (abort.current || !crop) return;
    const controller = new AbortController();
    abort.current = controller;
    pointers.current.clear();
    setBusy(true);
    setError("");
    try {
      const result = await prepareProfilePhoto(file, controller.signal, frame);
      if (!controller.signal.aborted) onApply(result);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Could not adjust photo. Try again.",
        );
    } finally {
      if (!controller.signal.aborted) {
        abort.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <section className="profile-framer" aria-label="Adjust profile photo">
      <strong>Frame your photo</strong>
      <p className="muted">
        Drag in any direction to position. Pinch with two fingers to zoom in or
        out, or use the sliders. You can move beyond the edges; empty areas stay
        transparent. The crown previews your winner portrait; it is not saved in
        your photo.
      </p>
      <label className="profile-crown-toggle">
        <input
          type="checkbox"
          role="switch"
          checked={showCrown}
          onChange={(e) => setShowCrown(e.target.checked)}
        />
        Show crown
      </label>
      <div className="profile-crop-stage">
        <div
          className="profile-crop-window"
          onPointerDown={(e) => {
            if (busy || !crop || (e.pointerType === "mouse" && e.button !== 0))
              return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const rect = e.currentTarget.getBoundingClientRect();
            pointers.current.set(e.pointerId, {
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
            });
          }}
          onPointerMove={(e) => {
            if (!pointers.current.has(e.pointerId) || !crop || busy) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const before = [...pointers.current.values()].slice(0, 2);
            pointers.current.set(e.pointerId, {
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
            });
            const after = [...pointers.current.values()].slice(0, 2);
            setFrame(
              movePhotoFrame(
                frameRef.current,
                dimensions.width,
                dimensions.height,
                rect.width,
                before,
                after,
              ),
            );
          }}
          onPointerUp={(e) => {
            pointers.current.delete(e.pointerId);
          }}
          onPointerCancel={(e) => {
            pointers.current.delete(e.pointerId);
          }}
          onLostPointerCapture={(e) => {
            pointers.current.delete(e.pointerId);
          }}
        >
          {/* Local object URL, never uploaded or persisted. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            alt="Circular photo preview"
            draggable={false}
            onLoad={(e) =>
              setDimensions({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
            onError={() => setError("This photo could not be opened.")}
            style={
              crop
                ? {
                    width: `${(dimensions.width / crop.size) * 100}%`,
                    height: `${(dimensions.height / crop.size) * 100}%`,
                    left: `${(-crop.x / crop.size) * 100}%`,
                    top: `${(-crop.y / crop.size) * 100}%`,
                  }
                : { visibility: "hidden" }
            }
          />
        </div>
        {showCrown && <PortraitCrown />}
      </div>
      <label>
        Zoom{" "}
        <input
          aria-label="Photo zoom"
          type="range"
          min="0.25"
          max="4"
          step="0.001"
          value={frame.zoom}
          disabled={busy}
          onChange={(e) => setFrame({ ...frame, zoom: Number(e.target.value) })}
        />
      </label>
      <details className="profile-fine-position">
        <summary>Fine-tune position</summary>
        <label>
          Horizontal position{" "}
          <input
            type="range"
            min={Math.min(-1, frame.x, frame.y)}
            max={Math.max(2, frame.x, frame.y)}
            step="0.001"
            value={frame.x}
            disabled={busy}
            onChange={(e) => setFrame({ ...frame, x: Number(e.target.value) })}
          />
        </label>
        <label>
          Vertical position{" "}
          <input
            type="range"
            min={Math.min(-1, frame.x, frame.y)}
            max={Math.max(2, frame.x, frame.y)}
            step="0.001"
            value={frame.y}
            disabled={busy}
            onChange={(e) => setFrame({ ...frame, y: Number(e.target.value) })}
          />
        </label>
      </details>
      {error && <p role="alert">{error}</p>}
      <div className="profile-framer-actions">
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => setFrame(DEFAULT_PHOTO_FRAME)}
        >
          Reset framing
        </button>
        <button type="button" className="button light" onClick={onCancel}>
          Cancel adjustment
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy || !crop}
          onClick={() => void apply()}
        >
          {busy ? "Preparing…" : "Use photo"}
        </button>
      </div>
    </section>
  );
}
