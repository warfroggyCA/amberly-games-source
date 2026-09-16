let sent = 0;
export function reportBrowserFailure() {
  // Best effort, bounded per page. No error text, identity, URL, state or input.
  if (sent >= 3) return;
  sent += 1;
  void fetch("/api/diagnostics", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "browser-failure" }),
  }).catch(() => {});
}
