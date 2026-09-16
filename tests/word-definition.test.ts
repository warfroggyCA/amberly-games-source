import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import entries from "../src/lib/generated/ospd5-definitions.json";
import {
  DEFINITION_SOURCE,
  definitionFromEntries,
  formatOspdDefinition,
  isWordDefinitionResult,
} from "../src/lib/word-definition";
import { lookupWordDefinition } from "../src/lib/word-definition-client";
import { GET } from "../src/app/api/word-definition/route";
import * as definitionServer from "../src/lib/word-definition-server";

const dictionary = entries as Record<string, string>;
const request = (query: string) =>
  new Request(`http://localhost/api/word-definition${query}`);

describe("local word meanings", () => {
  it("prepares every supplied entry without changing its original definition", () => {
    expect(Object.keys(dictionary)).toHaveLength(109928);
    expect(dictionary.REMOTE).toBe(
      "situated far away [adj -MOTER, -MOTEST] : REMOTELY [adv] / a broadcast originating outside a studio [n -S]",
    );
    for (const [word, text] of Object.entries(dictionary)) {
      expect(word).toMatch(/^[A-Z]{2,15}$/);
      expect(text.length).toBeGreaterThan(0);
    }
  });
  it("shows a readable meaning and attributes the older local reference", () => {
    expect(definitionFromEntries("ton", dictionary)).toEqual({
      word: "TON",
      definition: "a unit of weight (noun)",
      related: [],
      source: DEFINITION_SOURCE,
    });
  });
  it("follows references through inflections and synonyms with readable source text", () => {
    const result = definitionFromEntries("REIGNITING", dictionary);
    expect(result.definition).toBe("See REIGNITE (verb)");
    expect(result.related.map((entry) => entry.word)).toEqual([
      "REIGNITE",
      "IGNITE",
    ]);
    expect(result.related.at(-1)?.definition).toContain("fire");
    expect(formatOspdDefinition("a {pal=n} [n BOS]")).toBe("a pal (noun)");
  });
  it("keeps missing definitions distinct from a word's eligibility", () => {
    expect(definitionFromEntries("ABACTERIAL", dictionary)).toEqual({
      word: "ABACTERIAL",
      definition: null,
      related: [],
      source: DEFINITION_SOURCE,
    });
  });
  it("bounds reference traversal, tolerates missing links and stops cycles", () => {
    const source = {
      AA: "<bb=n> [n]",
      BB: "<aa=n> and <cc=n> [n]",
      CC: "<dd=n> [n]",
      DD: "<ee=n> [n]",
      EE: "<ff=n> [n]",
      FF: "end [n]",
    };
    expect(
      definitionFromEntries("AA", source).related.map((entry) => entry.word),
    ).toEqual(["BB", "CC", "DD"]);
    expect(definitionFromEntries("AA", { AA: "<bb=n> [n]" }).related).toEqual(
      [],
    );
  });
  it.each([
    "",
    "A",
    "AA AA",
    "<script>",
    "ßa",
    "AAAAAAAAAAAAAAAA",
    "__proto__",
  ])("rejects malformed query %s", (word) => {
    expect(() => definitionFromEntries(word, dictionary)).toThrow();
  });
  it("does not inherit properties from an entry object", () => {
    expect(
      definitionFromEntries("AB", Object.create({ AB: "Not our entry" }))
        .definition,
    ).toBeNull();
  });
  it("rejects mismatched or malformed response shapes", () => {
    const valid = definitionFromEntries("TON", dictionary);
    expect(isWordDefinitionResult(valid, "TON")).toBe(true);
    expect(isWordDefinitionResult(valid, "CAT")).toBe(false);
    expect(
      isWordDefinitionResult(
        { ...valid, source: "current official dictionary" },
        "TON",
      ),
    ).toBe(false);
    expect(
      isWordDefinitionResult(
        { ...valid, related: [{ word: "<bad>", definition: "bad" }] },
        "TON",
      ),
    ).toBe(false);
    expect(
      isWordDefinitionResult(
        {
          ...valid,
          definition: null,
          related: [{ word: "CAT", definition: "cat" }],
        },
        "TON",
      ),
    ).toBe(false);
  });
});

describe("word definition route", () => {
  it("reports a source-loading failure separately from a missing definition", async () => {
    const lookup = vi
      .spyOn(definitionServer, "lookupLocalDefinition")
      .mockRejectedValueOnce(new Error("Unavailable asset"));
    try {
      const response = await GET(request("?word=TON"));
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toHaveProperty("error");
    } finally {
      lookup.mockRestore();
    }
  });
  it("returns only a selected word and bounded related meanings", async () => {
    const response = await GET(request("?word=remote"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "private, max-age=86400",
    );
    const body = await response.json();
    expect(body.word).toBe("REMOTE");
    expect(body.definition).toContain("situated far away");
    expect(body).not.toHaveProperty("CAT");
  });
  it("returns an explicit missing definition without inventing one", async () => {
    const response = await GET(request("?word=abacterial"));
    expect(response.status).toBe(200);
    expect((await response.json()).definition).toBeNull();
  });
  it.each([
    "",
    "?word=CAT&word=TON",
    "?word=%3Cscript%3E",
    "?word=A",
    "?word=AA%20AA",
  ])("rejects invalid request %s", async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("word definition client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  it("requests one meaning on demand", async () => {
    const result = definitionFromEntries("TON", dictionary);
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(result));
    await expect(lookupWordDefinition("ton")).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/word-definition?word=TON",
      expect.objectContaining({
        credentials: "same-origin",
        redirect: "error",
      }),
    );
  });
  it("does not accept a successful response for another word", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(definitionFromEntries("CAT", dictionary)),
    );
    await expect(lookupWordDefinition("TON")).rejects.toThrow(
      "could not be read",
    );
  });
  it("reports unavailable data instead of fabricating a missing entry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 503 }),
    );
    await expect(lookupWordDefinition("TON")).rejects.toThrow(
      "could not be loaded",
    );
  });
  it("cancels superseded requests and rejects a late response", async () => {
    const controller = new AbortController();
    let resolve!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const pending = lookupWordDefinition("TON", controller.signal);
    controller.abort();
    resolve(Response.json(definitionFromEntries("TON", dictionary)));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  it("times out a stalled request so the UI can offer retry", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, "fetch").mockImplementation(
        (_input, options) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(options.signal?.reason),
              { once: true },
            );
          }),
      );
      const result = expect(lookupWordDefinition("TON")).rejects.toMatchObject({
        name: "TimeoutError",
      });
      await vi.advanceTimersByTimeAsync(8000);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not make requests after a selection has been cleared", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    const controller = new AbortController();
    controller.abort();
    await expect(
      lookupWordDefinition("TON", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
