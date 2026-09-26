import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import receipt from "../config/lobby-music.json";
import { lobbyTrack } from "../src/lib/lobby-track";

it("ships the approved music with its pinned bytes and attribution", async () => {
  const bytes = await readFile(
    new URL(`../public${lobbyTrack.src}`, import.meta.url),
  );
  expect(bytes.subarray(0, 4).toString()).toBe("fLaC");
  expect(bytes.byteLength).toBe(receipt.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(receipt.sha256);
  expect(lobbyTrack.source).toBe(receipt.source);
  expect(lobbyTrack.licenseUrl).toBe(receipt.licenseUrl);
  expect(lobbyTrack.credit).toContain(receipt.artist);
});
