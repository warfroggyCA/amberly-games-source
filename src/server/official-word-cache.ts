import { fetchOfficialWord } from "../lib/official-word-server";
import {
  normalizeOfficialWord,
  type OfficialWordResult,
} from "../lib/official-word";
export class LookupBusyError extends Error {}
/** Per-instance resource bounds, not a distributed abuse-prevention service. */
export function createOfficialLookup(
  fetcher = fetchOfficialWord,
  now = Date.now,
) {
  const cache = new Map<string, { until: number; value: OfficialWordResult }>();
  const pending = new Map<string, Promise<OfficialWordResult>>();
  let windowStarted = now();
  let started = 0;
  return async (
    query: string,
    signal?: AbortSignal,
  ): Promise<OfficialWordResult> => {
    const word = normalizeOfficialWord(query);
    signal?.throwIfAborted();
    const time = now();
    const hit = cache.get(word);
    if (hit && hit.until > time) return { ...hit.value };
    cache.delete(word);
    let request = pending.get(word);
    if (!request) {
      if (time - windowStarted >= 60_000) {
        windowStarted = time;
        started = 0;
      }
      if (pending.size >= 4 || started >= 30)
        throw new LookupBusyError(
          "Word checks are busy. Please retry shortly.",
        );
      started += 1;
      request = fetcher(word)
        .then((value) => {
          if (cache.size >= 256) cache.delete(cache.keys().next().value!);
          const copy = Object.freeze({ ...value });
          cache.set(word, { until: now() + 300_000, value: copy });
          return copy;
        })
        .finally(() => {
          pending.delete(word);
        });
      pending.set(word, request);
    }
    // Cancelling one viewer must not cancel another viewer's shared lookup.
    let abort: (() => void) | undefined;
    try {
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(signal?.reason ?? new Error("Request cancelled"));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
      return { ...(await Promise.race([request, cancelled])) };
    } finally {
      if (abort) signal?.removeEventListener("abort", abort);
    }
  };
}
export const lookupOfficialWordCached = createOfficialLookup();
