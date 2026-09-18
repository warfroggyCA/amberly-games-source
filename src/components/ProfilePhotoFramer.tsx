"use client";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_PHOTO_FRAME,
  photoCrop,
  prepareProfilePhoto,
} from "../lib/player-profile";

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
  const [frame, setFrame] = useState(DEFAULT_PHOTO_FRAME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const drag = useRef<{ x: number; y: number; frame: typeof frame } | null>(
    null,
  );
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
        Drag to position, then zoom to fill the circle. You can also use the
        position sliders.
      </p>
      <div
        className="profile-crop-window"
        onPointerDown={(e) => {
          if (busy || !crop) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, frame };
        }}
        onPointerMove={(e) => {
          if (!drag.current || !crop || busy) return;
          const scale =
            e.currentTarget.getBoundingClientRect().width / crop.size;
          const start = drag.current;
          const clamp = (n: number) => Math.max(0, Math.min(1, n));
          setFrame({
            ...start.frame,
            x:
              dimensions.width === crop.size
                ? 0.5
                : clamp(
                    start.frame.x -
                      (e.clientX - start.x) /
                        scale /
                        (dimensions.width - crop.size),
                  ),
            y:
              dimensions.height === crop.size
                ? 0.5
                : clamp(
                    start.frame.y -
                      (e.clientY - start.y) /
                        scale /
                        (dimensions.height - crop.size),
                  ),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
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
      <label>
        Zoom{" "}
        <input
          aria-label="Photo zoom"
          type="range"
          min="1"
          max="4"
          step="0.01"
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
            min="0"
            max="1"
            step="0.01"
            value={frame.x}
            disabled={busy}
            onChange={(e) => setFrame({ ...frame, x: Number(e.target.value) })}
          />
        </label>
        <label>
          Vertical position{" "}
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
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
