"use client";
import { useEffect, useRef, useState } from "react";
import {
  readGymDraft,
  writeGymDraft,
  validGymDraft,
  type GymDraft,
} from "../lib/gym-draft";
export function useGymDraft(key: string | null, value: GymDraft | null) {
  const [saved, setSaved] = useState<GymDraft | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loaded = key !== null && loadedKey === key;
  const [status, setStatus] = useState("");
  const [written, setWritten] = useState<string | null>(null);
  const [writable, setWritable] = useState(false);
  const active = useRef<{
    key: string;
    revision: number;
    failed: boolean;
  } | null>(null);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    active.current = null;

    if (!key) return;
    void readGymDraft(key)
      .then((row) => {
        if (cancelled) return;
        active.current = { key, revision: row?.revision ?? 0, failed: false };
        setWritable(true);
        setWritten(row ? JSON.stringify(row.value) : null);
        if (row && !validGymDraft(row.value)) {
          setSaved(null);
          setStatus(
            "The saved practice cannot be restored. It is kept until you start a new puzzle.",
          );
        } else {
          setSaved(row?.value ?? null);
          setStatus(
            row
              ? "Unfinished practice is available on this device."
              : "Practice will save on this device.",
          );
        }
        setLoadedKey(key);
      })
      .catch(() => {
        if (!cancelled) {
          setSaved(null);
          setWritable(false);
          setStatus(
            "Draft recovery is unavailable. Keep this page open to preserve your practice.",
          );
          setLoadedKey(key);
        }
      });
    return () => {
      cancelled = true;
      active.current = null;
    };
  }, [key]);
  const encoded = value ? JSON.stringify(value) : null;
  useEffect(() => {
    const owner = active.current;
    if (!loaded || !owner || owner.key !== key || !encoded || owner.failed)
      return;
    const snapshot = JSON.parse(encoded) as GymDraft;
    queue.current = queue.current.then(async () => {
      if (owner.failed) return;
      try {
        owner.revision = await writeGymDraft(
          owner.key,
          owner.revision,
          snapshot,
        );
        if (active.current === owner) {
          setWritten(encoded);
          setSaved(snapshot);
          setStatus("Practice saved on this device.");
        }
      } catch (e) {
        owner.failed = true;
        if (active.current === owner) {
          setWritable(false);
          setStatus(
            e instanceof Error
              ? e.message
              : "Practice could not be saved. Keep this page open.",
          );
        }
      }
    });
  }, [encoded, key, loaded]);
  return {
    saved: loaded ? saved : null,
    loaded,
    status:
      loaded && writable && encoded && encoded !== written
        ? "Saving practice on this device…"
        : status,
    flush: () => queue.current,
  };
}
