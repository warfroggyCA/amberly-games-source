import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import receipt from "../config/lobby-music.json";

it("preserves the retired music asset and its attribution", async () => {
  const bytes = await readFile(new URL(`../${receipt.asset}`, import.meta.url));
  expect(bytes.subarray(0, 4).toString()).toBe("fLaC");
  expect(bytes.byteLength).toBe(receipt.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(receipt.sha256);
  const credits = await readFile(
    new URL("../public/music/README.md", import.meta.url),
    "utf8",
  );
  expect(credits).toContain(receipt.source);
  expect(credits).toContain(receipt.licenseUrl);
});
