import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, it } from "vitest";

it("keeps Scarlett's approved source and the shared full-size animation's frames, timing and exact alpha", async () => {
  const source = await readFile("public/gym/scarlett-lift.webp");
  const entry = await readFile("public/gym/scarlett-shared.webp");
  expect(source.length).toBe(7270588);
  expect(createHash("sha256").update(source).digest("hex")).toBe(
    "e7c75308723411072bd3f08e82fba6232c7a5cb296b17eea7fdc62a7f085e22e",
  );
  const before = await sharp(source, { animated: true }).metadata();
  const after = await sharp(entry, { animated: true }).metadata();
  expect(after).toMatchObject({
    width: 640,
    pageHeight: 640,
    pages: 120,
    hasAlpha: true,
    loop: 0,
  });
  expect(after.delay).toEqual(before.delay);
  expect(after.delay!.reduce((a, b) => a + b, 0)).toBe(5000);
  expect(entry.length).toBeLessThan(source.length * 0.85);
  expect(createHash("sha256").update(entry).digest("hex")).toBe(
    "08e3c095ee969a9cc69895b5a1bfd39e63fbbbe09f8d245e3b551e53e4902c76",
  );
  const alpha = async (bytes: Buffer) =>
    sharp(bytes, { animated: true }).extractChannel("alpha").raw().toBuffer();
  expect((await alpha(source)).equals(await alpha(entry))).toBe(true);
}, 30000);
