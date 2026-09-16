import {
  normalizeOfficialWord,
  officialWordUrl,
  type OfficialWordResult,
} from "./official-word";

export const MAX_OFFICIAL_PAGE_BYTES = 512_000;
export const OFFICIAL_LOOKUP_TIMEOUT_MS = 8_000;

/** Conservative adapter for the observed publisher markup. Changes are unknown, never approval. */
export function parseOfficialWordPage(html: string, query: string): boolean {
  const word = normalizeOfficialWord(query);
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const canonicals = [
    ...clean.matchAll(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/gi),
  ];
  if (
    canonicals.length !== 1 ||
    !canonicals[0][0].includes(`href="${officialWordUrl(word)}"`)
  )
    throw new Error("The official word page did not match the requested word.");
  const verdicts = [
    ...clean.matchAll(
      /<div\s+class=["']play_area (play_yes|play_no)["']\s*>([\s\S]*?)<\/div\s*>/g,
    ),
  ];
  if (verdicts.length !== 1)
    throw new Error(
      "The official word page did not contain one clear verdict.",
    );
  const [, kind, content] = verdicts[0];
  const text = content
    .replace(/<i class="fa fa-check"><\/i>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const playable = kind === "play_yes";
  if (text !== `${word} is ${playable ? "" : "not "}a playable word`)
    throw new Error(
      "The official word verdict was ambiguous or did not match.",
    );
  return playable;
}

export async function fetchOfficialWord(
  query: string,
  signal?: AbortSignal,
): Promise<OfficialWordResult> {
  const word = normalizeOfficialWord(query);
  const sourceUrl = officialWordUrl(word);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("Official lookup timed out.", "TimeoutError"),
      ),
    OFFICIAL_LOOKUP_TIMEOUT_MS,
  );
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    const response = await fetch(sourceUrl, {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "text/html" },
      signal: controller.signal,
    });
    if (
      !response.ok ||
      response.redirected ||
      (response.url && response.url !== sourceUrl)
    )
      throw new Error(
        "The official word service did not return the requested page.",
      );
    if (
      !/^text\/html(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
    )
      throw new Error(
        "The official word service returned an unexpected format.",
      );
    const declaredSize = response.headers.get("content-length");
    if (
      declaredSize &&
      (!/^\d+$/.test(declaredSize) ||
        Number(declaredSize) > MAX_OFFICIAL_PAGE_BYTES)
    )
      throw new Error("The official word response was too large.");
    if (!response.body)
      throw new Error("The official word response was empty.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let html = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_OFFICIAL_PAGE_BYTES)
          throw new Error("The official word response was too large.");
        html += decoder.decode(chunk.value, { stream: true });
      }
      html += decoder.decode();
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (controller.signal.aborted) throw controller.signal.reason;
    return {
      word,
      playable: parseOfficialWordPage(html, word),
      source: "merriam-webster",
      sourceUrl,
      verifiedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}
