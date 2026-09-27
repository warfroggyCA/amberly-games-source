"use client";
import { useEffect, useRef } from "react";
import { browserId } from "./browser-id";
import { activeSample, type UsageArea, type UsagePulse } from "./access-usage";

/** Best-effort telemetry never blocks a score, stores drafts, or retries offline time. */
export function useUsageTracking(userId: string | undefined, area: UsageArea) {
  const currentArea = useRef(area);
  const resetArea = useRef<(() => void) | null>(null);
  useEffect(() => {
    currentArea.current = area;
    resetArea.current?.();
  }, [area]);
  useEffect(() => {
    if (!userId) return;
    let stopped = false,
      disabled = false,
      busy = false;
    let previous = performance.now(),
      lastInput = previous,
      activeMs = 0;
    let sentAt = -Infinity;
    let lastArea: UsageArea | undefined;
    const controller = new AbortController();
    const visible = () => document.visibilityState === "visible";
    let wasVisible = visible();
    const sample = (countVisible = visible()) => {
      const now = performance.now();
      activeMs = Math.min(
        15000,
        activeMs +
          activeSample(
            previous,
            now,
            lastInput,
            countVisible && navigator.onLine,
          ),
      );
      previous = now;
    };
    const input = () => {
      sample();
      lastInput = performance.now();
    };
    const send = (leaving = false) => {
      if (
        stopped ||
        disabled ||
        busy ||
        (!visible() && !leaving) ||
        !navigator.onLine
      )
        return;
      sample();
      const now = performance.now();
      if (leaving && activeMs === 0) return;
      if (
        !leaving &&
        currentArea.current === lastArea &&
        (now - sentAt < 15000 || activeMs === 0)
      )
        return;
      const pulse: UsagePulse = {
        id: browserId(),
        area: currentArea.current,
        activeMs: Math.floor(activeMs),
      };
      activeMs = 0;
      sentAt = now;
      lastArea = currentArea.current;
      busy = true;
      void fetch("/api/family/usage", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        keepalive: leaving,
        headers: {
          "Content-Type": "application/json",
          "X-Scrabble-User": userId,
        },
        body: JSON.stringify(pulse),
        signal: leaving
          ? AbortSignal.timeout(8000)
          : AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      })
        .then((response) => {
          if ([401, 403, 503].includes(response.status)) disabled = true;
        })
        .catch(() => {
          /* Missing telemetry is preferable to disrupting gameplay. */
        })
        .finally(() => {
          busy = false;
        });
    };
    const visibility = () => {
      // The interval before this transition was visible; capture even brief
      // visits before switching to the hidden state. Never credit hidden time.
      sample(wasVisible);
      wasVisible = visible();
      if (!wasVisible) send(true);
      previous = performance.now();
      activeMs = 0;
      if (visible()) {
        lastInput = previous;
        lastArea = undefined;
        send();
      }
    };
    const pagehide = () => {
      sample(wasVisible);
      wasVisible = false;
      send(true);
    };
    const connectivity = () => {
      activeMs = 0;
      previous = performance.now();
      if (navigator.onLine) {
        lastInput = previous;
        lastArea = undefined;
        send();
      }
    };
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    for (const event of ["pointerdown", "keydown", "scroll"])
      window.addEventListener(event, input, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pagehide);
    resetArea.current = () => {
      activeMs = 0;
      previous = performance.now();
      lastArea = undefined;
    };
    const timer = setInterval(() => {
      sample();
      send();
    }, 5000);
    // Defer initial receipt so React Strict Mode cannot create a throwaway visit.
    const initial = setTimeout(() => send(), 0);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      // A route departure can lose the final few seconds; never delay navigation.
      resetArea.current = null;
      stopped = true;
      controller.abort();
      for (const event of ["pointerdown", "keydown", "scroll"])
        window.removeEventListener(event, input);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
    };
  }, [userId]);
}
