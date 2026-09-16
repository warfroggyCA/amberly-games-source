import { afterEach, expect, it, vi } from "vitest";
import { reportFailure } from "../src/server/diagnostics";
import { POST } from "../src/app/api/diagnostics/route";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("logs only bounded classifications, never exception secrets or input", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = Object.assign(new Error("password=secret-person@example.com"), {
    code: "23505",
    detail: "private game",
  });
  const id = reportFailure("family", error);
  const message = log.mock.calls[0][0];
  expect(JSON.parse(message)).toMatchObject({
    incidentId: id,
    area: "family",
    databaseCode: "23505",
  });
  expect(message).not.toMatch(/password|secret-person|private game|stack/);
});
it("rejects cross-origin reports and reports containing private text", async () => {
  vi.stubEnv("SCRABBLE_APP_ORIGIN", "https://amberly.example");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const [origin, body] of [
    ["https://evil.example", { event: "browser-failure" }],
    [
      "https://amberly.example",
      { event: "browser-failure", secret: "private" },
    ],
  ]) {
    const response = await POST(
      new Request("https://amberly.example/api/diagnostics", {
        method: "POST",
        headers: { origin: String(origin), "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(400);
  }
  expect(log).not.toHaveBeenCalled();
});
