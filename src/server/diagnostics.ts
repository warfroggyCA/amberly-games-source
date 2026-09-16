/** Never log exception messages/stacks, URLs, headers, words or family data. */
export type FailureArea =
  | "family"
  | "live-draft"
  | "watch"
  | "watch-draft"
  | "word-lookup"
  | "definition"
  | "server-render"
  | "browser";
export function reportFailure(area: FailureArea, error?: unknown): string {
  const incidentId = crypto.randomUUID();
  const databaseCode =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[0-9]{2}[A-Z0-9]{3}$/.test(error.code)
      ? error.code
      : undefined;
  console.error(
    JSON.stringify({
      event: "amberly.failure",
      incidentId,
      area,
      databaseCode,
      at: new Date().toISOString(),
    }),
  );
  return incidentId;
}
