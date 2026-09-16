import { expect, it, vi } from "vitest";
import {
  createOfficialLookup,
  LookupBusyError,
} from "../src/server/official-word-cache";
import {
  officialWordUrl,
  type OfficialWordResult,
} from "../src/lib/official-word";
const result = (word: string): OfficialWordResult => ({
  word,
  playable: true,
  source: "merriam-webster",
  sourceUrl: officialWordUrl(word),
  verifiedAt: "2026-09-16T12:00:00.000Z",
});
it("coalesces matching requests, expires cached verdicts and preserves verification time", async () => {
  let time = 0;
  const fetcher = vi.fn(async (word: string) => result(word));
  const lookup = createOfficialLookup(fetcher, () => time);
  const [a, b] = await Promise.all([lookup("onyx"), lookup("ONYX")]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(a).toEqual(b);
  a.playable = false;
  expect((await lookup("ONYX")).playable).toBe(true);
  time = 300001;
  await lookup("ONYX");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("never caches failed checks as playable or unplayable", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(result("ONYX"));
  const lookup = createOfficialLookup(fetcher);
  await expect(lookup("ONYX")).rejects.toThrow("offline");
  expect((await lookup("ONYX")).playable).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("bounds distinct concurrent upstream requests and recovers after completion", async () => {
  const resolve: Array<() => void> = [];
  const fetcher = vi.fn(
    (word: string) =>
      new Promise<OfficialWordResult>((done) => {
        resolve.push(() => done(result(word)));
      }),
  );
  const lookup = createOfficialLookup(fetcher);
  const requests = ["AA", "AB", "AC", "AD"].map((word) => lookup(word));
  await expect(lookup("AE")).rejects.toBeInstanceOf(LookupBusyError);
  resolve.forEach((done) => done());
  await Promise.all(requests);
  const next = lookup("AE");
  resolve[4]();
  await expect(next).resolves.toMatchObject({ word: "AE" });
  expect(fetcher).toHaveBeenCalledTimes(5);
});
it("cancels a caller without cancelling another caller sharing its request", async () => {
  let resolve!: (value: OfficialWordResult) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<OfficialWordResult>((done) => {
        resolve = done;
      }),
  );
  const lookup = createOfficialLookup(fetcher);
  const controller = new AbortController();
  const first = lookup("ONYX", controller.signal);
  const second = lookup("ONYX");
  const failed = expect(first).rejects.toThrow();
  controller.abort();
  await failed;
  resolve(result("ONYX"));
  expect((await second).playable).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("caps uncached traffic in a minute but lets existing cache hits through", async () => {
  let time = 0;
  const fetcher = vi.fn(async (word: string) => result(word));
  const lookup = createOfficialLookup(fetcher, () => time);
  for (let index = 0; index < 30; index++)
    await lookup(
      `A${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`,
    );
  await expect(lookup("ZZZ")).rejects.toBeInstanceOf(LookupBusyError);
  await expect(lookup("AAA")).resolves.toMatchObject({ playable: true });
  time = 60000;
  await expect(lookup("ZZZ")).resolves.toMatchObject({ playable: true });
});
