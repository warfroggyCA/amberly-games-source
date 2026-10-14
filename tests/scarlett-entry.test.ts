import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, it } from "vitest";

it("keeps Scarlett's approved source and all animated entry frames, timing and transparency", async () => {
  const source = await readFile("public/gym/scarlett-lift.webp");
  const entry = await readFile("public/gym/scarlett-entry.webp");
  expect(source.length).toBe(7270588);
  expect(createHash("sha256").update(source).digest("hex")).toBe(
    "e7c75308723411072bd3f08e82fba6232c7a5cb296b17eea7fdc62a7f085e22e",
  );
  const before = await sharp(source, { animated: true }).metadata();
  const after = await sharp(entry, { animated: true }).metadata();
  expect(after).toMatchObject({
    width: 360,
    pageHeight: 360,
    pages: 120,
    hasAlpha: true,
    loop: 0,
  });
  expect(after.delay).toEqual(before.delay);
  expect(after.delay!.reduce((a, b) => a + b, 0)).toBe(5000);
  expect(entry.length).toBeLessThan(source.length / 2);
});
