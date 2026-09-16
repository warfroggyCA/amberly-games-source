import { normalizeOfficialWord } from "./official-word";
import {
  isWordDefinitionResult,
  type WordDefinitionResult,
} from "./word-definition";

export async function lookupWordDefinition(
  query: string,
  signal?: AbortSignal,
): Promise<WordDefinitionResult> {
  const word = normalizeOfficialWord(query);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("Definition lookup timed out.", "TimeoutError"),
      ),
    8000,
  );
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    const response = await fetch(`/api/word-definition?word=${word}`, {
      signal: controller.signal,
      credentials: "same-origin",
      redirect: "error",
    });
    if (!response.ok) throw new Error("The definition could not be loaded.");
    const result: unknown = await response.json();
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!isWordDefinitionResult(result, word))
      throw new Error("The definition response could not be read.");
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}
