import {
  isOfficialWordResult,
  normalizeOfficialWord,
  type OfficialWordResult,
} from "./official-word";

export async function lookupOfficialWord(
  query: string,
  signal?: AbortSignal,
): Promise<OfficialWordResult> {
  const word = normalizeOfficialWord(query);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("Word check timed out.", "TimeoutError"),
      ),
    12_000,
  );
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    const response = await fetch(`/api/official-word?word=${word}`, {
      signal: controller.signal,
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        "The official word check is unavailable. Your letters have been kept; please retry.",
      );
    const value: unknown = await response.json();
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!isOfficialWordResult(value, word))
      throw new Error(
        "The official word response could not be verified. Please retry.",
      );
    return value;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}
