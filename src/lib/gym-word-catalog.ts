import {
  isVerifiedWord,
  MAX_VERIFIED_WORDS,
  type VerifiedWord,
} from "../domain/verified-words";
import { localScorerStore } from "./scorer-store";
export async function gymWordCatalog(
  userId?: string,
  additions?: VerifiedWord[],
): Promise<VerifiedWord[]> {
  if (!userId) {
    await localScorerStore.load();
    if (localScorerStore.getSnapshot().status !== "ready")
      throw new Error(
        "The word list could not be loaded. Retry before practising.",
      );
    if (additions)
      await localScorerStore.update((data) => {
        if (!additions.every(isVerifiedWord))
          throw new Error("The word confirmation is invalid.");
        const words = new Map(
          (data.verifiedWords ?? []).map((entry) => [entry.word, entry]),
        );
        for (const entry of additions)
          if (!words.has(entry.word)) words.set(entry.word, entry);
        if (words.size > MAX_VERIFIED_WORDS)
          throw new Error("The saved word list has reached its limit.");
        return { ...data, verifiedWords: [...words.values()] };
      });
    return localScorerStore.getSnapshot().data.verifiedWords ?? [];
  }
  const response = await fetch("/api/family/words", {
    method: additions ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: {
      "x-scrabble-user": userId,
      ...(additions ? { "content-type": "application/json" } : {}),
    },
    body: additions
      ? JSON.stringify(additions.map((entry) => entry.word))
      : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : "The family word list could not be saved. Retry; your letters are kept.",
    );
  if (
    !Array.isArray(data.words) ||
    data.words.length > MAX_VERIFIED_WORDS ||
    !data.words.every(isVerifiedWord) ||
    new Set(data.words.map((word: VerifiedWord) => word.word)).size !==
      data.words.length
  )
    throw new Error(
      "The word-list receipt could not be verified. Retry safely.",
    );
  return data.words;
}
