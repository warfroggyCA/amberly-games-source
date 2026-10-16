import { createHash } from "node:crypto";
import { readFile, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const source = "public/gym/scarlett-lift.webp";
const expected =
  "e7c75308723411072bd3f08e82fba6232c7a5cb296b17eea7fdc62a7f085e22e";
if (
  createHash("sha256")
    .update(await readFile(source))
    .digest("hex") !== expected
)
  throw new Error(
    "The approved Scarlett source changed; review before deriving a new asset.",
  );
const metadata = await sharp(source, { animated: true }).metadata();
if (
  metadata.pages !== 120 ||
  metadata.delay?.reduce((a, b) => a + b, 0) !== 5000 ||
  metadata.loop !== 0 ||
  !metadata.hasAlpha
)
  throw new Error("Unexpected Scarlett animation metadata.");
const directory = await mkdtemp(join(tmpdir(), "amberly-scarlett-entry-"));
try {
  const output = join(directory, "entry.webp");
  await sharp(source, { animated: true })
    .resize({ width: 360 })
    .webp({
      quality: 82,
      alphaQuality: 100,
      effort: 4,
      minSize: true,
      loop: metadata.loop,
      delay: metadata.delay,
    })
    .toFile(output);
  const result = await sharp(output, { animated: true }).metadata();
  if (
    result.pages !== metadata.pages ||
    JSON.stringify(result.delay) !== JSON.stringify(metadata.delay) ||
    result.loop !== 0 ||
    !result.hasAlpha
  )
    throw new Error(
      "The derived animation did not preserve timing, frames or transparency.",
    );
  await rename(output, "public/gym/scarlett-entry.webp");
  console.log("Derived Scarlett entry animation; approved source unchanged.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
