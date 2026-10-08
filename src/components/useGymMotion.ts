"use client";
import { useSyncExternalStore } from "react";

const key = "amberly-gym-motion-v1";
const changed = "amberly-gym-motion-change";
type Preference = "reduce" | "full" | "system" | null;
// Keep an explicit choice for this visit when browser storage is unavailable.
let temporary: Preference | undefined;
function preference(): Preference {
  if (temporary !== undefined) return temporary;
  try {
    const saved = localStorage.getItem(key);
    return saved === "reduce" || saved === "full" || saved === "system"
      ? saved
      : null;
  } catch {
    return null;
  }
}
function snapshot() {
  const saved = preference();
  return (
    (saved !== "system" ? saved : null) ??
    (matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "system-reduce"
      : "system-full")
  );
}
function subscribe(notify: () => void) {
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const storage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== key) return;
    temporary = undefined;
    notify();
  };
  media.addEventListener("change", notify);
  window.addEventListener(changed, notify);
  window.addEventListener("storage", storage);
  return () => {
    media.removeEventListener("change", notify);
    window.removeEventListener(changed, notify);
    window.removeEventListener("storage", storage);
  };
}
function setPreference(value: Preference) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    temporary = undefined;
  } catch {
    temporary = value;
  }
  window.dispatchEvent(new Event(changed));
}
export function useGymMotion() {
  // A static first render also avoids animation before hydration reads the OS.
  const value = useSyncExternalStore(
    subscribe,
    snapshot,
    () => "system-reduce",
  );
  return {
    reducedMotion: value === "reduce" || value === "system-reduce",
    followsSystem: value.startsWith("system-"),
    setReducedMotion: (reduce: boolean) =>
      setPreference(reduce ? "reduce" : "full"),
    followSystem: () => setPreference("system"),
    restoreLegacyReduction: () => {
      if (preference() === null) setPreference("reduce");
    },
  };
}
