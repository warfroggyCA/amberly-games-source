import { useEffect } from "react";

/** Best effort only: a denied or interrupted wake lock never blocks scoring. */
export function useScoringWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let stopped = false;
    let requesting = false;
    let sentinel: WakeLockSentinel | null = null;
    async function acquire() {
      if (
        stopped ||
        requesting ||
        document.visibilityState !== "visible" ||
        (sentinel && !sentinel.released)
      )
        return;
      requesting = true;
      try {
        const acquired = await navigator.wakeLock.request("screen");
        if (stopped || document.visibilityState !== "visible")
          await acquired.release();
        else sentinel = acquired;
      } catch {
        // Low battery, browser policy and unsupported environments are ordinary.
      } finally {
        requesting = false;
      }
    }
    function visibility() {
      if (document.visibilityState === "visible") void acquire();
      else {
        void sentinel?.release().catch(() => {});
        sentinel = null;
      }
    }
    void acquire();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", visibility);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
