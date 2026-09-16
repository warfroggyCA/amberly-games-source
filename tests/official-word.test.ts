import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
let GET: typeof import("../src/app/api/official-word/route").GET;
beforeEach(async () => {
  vi.resetModules();
  ({ GET } = await import("../src/app/api/official-word/route"));
});
import { lookupOfficialWord } from "../src/lib/official-word-client";
import {
  fetchOfficialWord,
  MAX_OFFICIAL_PAGE_BYTES,
  parseOfficialWordPage,
} from "../src/lib/official-word-server";
import { officialWordUrl } from "../src/lib/official-word";
const page = (word: string, playable = true) =>
  `<link rel="canonical" href="${officialWordUrl(word)}"><div class="play_area play_${playable ? "yes" : "no"}">${playable ? '<i class="fa fa-check"></i>' : ""} ${word} is ${playable ? "" : "not "}a playable word </div>`;
const html = (body: string, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
const request = (query: string) =>
  new Request(`http://localhost/api/official-word?${query}`);
const answer = {
  word: "ONYX",
  playable: true,
  source: "merriam-webster",
  sourceUrl: officialWordUrl("ONYX"),
  verifiedAt: "2026-09-14T12:00:00.000Z",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("publisher verdict parsing", () => {
  it("accepts only the dedicated exact-word positive verdict", () => {
    expect(parseOfficialWordPage(page("ONYX"), "onyx")).toBe(true);
  });
  it("keeps a negative verdict despite definitions, inflections, and playable anagrams", () => {
    expect(
      parseOfficialWordPage(
        page("NOTELETS", false) +
          "<h1>notelet</h1><p>pl. notelets</p><h2>150 Playable Words</h2><a>notelet</a>",
        "NOTELETS",
      ),
    ).toBe(false);
  });
  it.each([
    page("ONYX").replace("ONYX is", "ON is"),
    page("ONYX").replace("/finder/onyx", "/finder/onyxes"),
    page("ONYX").replace("play_yes", "play_no"),
    page("ONYX") + page("ONYX", false),
    "<p>ONYX is a playable word</p>",
    `<script>${page("ONYX")}</script>`,
    `<!--${page("ONYX")}-->`,
    page("ONYX").replace(
      'class="play_area play_yes"',
      'class="changed-layout"',
    ),
  ])("rejects missing, mismatched, or ambiguous markup", (body) => {
    expect(() => parseOfficialWordPage(body, "ONYX")).toThrow();
  });
});
describe("official lookup route and transport", () => {
  it.each([
    "word=https%3A%2F%2Fevil.test",
    "word=ON%0A",
    "word=ÅA",
    "word=A",
    "word=ABCDEFGHIJKLMNOP",
    "word=ONYX&word=CAT",
    "",
  ])("rejects malformed query %s before network access", async (query) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await GET(request(query))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("fetches only the fixed publisher origin without redirects, cookies, or cached verdicts", async () => {
    const fetcher = vi.fn().mockResolvedValue(html(page("ONYX")));
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(request("word=onyx"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      ...answer,
      verifiedAt: expect.any(String),
    });
    expect(fetcher).toHaveBeenCalledWith(
      officialWordUrl("ONYX"),
      expect.objectContaining({
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it("returns a definitive negative as success, without promoting an inflection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(html(page("NOTELETS", false) + "pl. notelets")),
    );
    const response = await GET(request("word=NOTELETS"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      word: "NOTELETS",
      playable: false,
    });
  });
  it.each([
    () => html(page("ONYX"), 503),
    () => html(page("ONYX"), 302),
    () =>
      new Response("{}", { headers: { "content-type": "application/json" } }),
    () => html(page("CAT")),
    () => html("unknown layout"),
    () =>
      html(page("ONYX"), 200, {
        "content-length": String(MAX_OFFICIAL_PAGE_BYTES + 1),
      }),
    () => html("X".repeat(MAX_OFFICIAL_PAGE_BYTES + 1)),
  ])(
    "does not certify an unsuccessful or untrusted upstream response",
    async (makeResponse) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse()));
      const response = await GET(request("word=ONYX"));
      expect(response.status).toBe(502);
      expect(await response.json()).not.toHaveProperty("playable");
    },
  );
  it("rejects network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect((await GET(request("word=ONYX"))).status).toBe(502);
  });
  it("aborts the upstream request at eight seconds and clears its timer", async () => {
    vi.useFakeTimers();
    let upstream: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            upstream = options.signal;
            upstream!.addEventListener(
              "abort",
              () => reject(upstream!.reason),
              { once: true },
            );
          }),
      ),
    );
    const pending = GET(request("word=ONYX"));
    await vi.advanceTimersByTimeAsync(8_000);
    expect((await pending).status).toBe(502);
    expect(upstream!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("propagates incoming cancellation without classifying it as a negative word", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(options.signal.reason),
              { once: true },
            );
          }),
      ),
    );
    const pending = fetchOfficialWord("ONYX", controller.signal);
    const assertion = expect(pending).rejects.toThrow();
    controller.abort();
    await assertion;
  });
});
describe("official lookup client", () => {
  it("normalizes the request and validates provenance without changing playable", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ ...answer, playable: false }));
    vi.stubGlobal("fetch", fetcher);
    expect(await lookupOfficialWord("onyx")).toEqual({
      ...answer,
      playable: false,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/official-word?word=ONYX",
      expect.objectContaining({ cache: "no-store", redirect: "error" }),
    );
  });
  it.each([
    { ...answer, word: "CAT" },
    { ...answer, sourceUrl: "https://evil.test" },
    { ...answer, playable: "true" },
    { ...answer, verifiedAt: "2026-02-31T00:00:00.000Z" },
  ])("rejects mismatched or malformed response", async (value) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value)));
    await expect(lookupOfficialWord("ONYX")).rejects.toThrow();
  });
  it("rejects failed responses and pre-aborted checks", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ error: "offline" }, { status: 502 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(lookupOfficialWord("ONYX")).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      lookupOfficialWord("ONYX", controller.signal),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("lookup interruption cleanup", () => {
  it("bounds the client wait and aborts an interrupted response", async () => {
    vi.useFakeTimers();
    let upstream: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            upstream = options.signal;
            upstream!.addEventListener(
              "abort",
              () => reject(upstream!.reason),
              { once: true },
            );
          }),
      ),
    );
    const pending = lookupOfficialWord("ONYX");
    const assertion = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
    expect(upstream!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not fetch after incoming cancellation", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchOfficialWord("ONYX", controller.signal),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
