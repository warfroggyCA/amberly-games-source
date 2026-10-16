import { createHash } from "node:crypto";
import { readFile, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

sharp.concurrency(2);
const source = "public/gym/scarlett-lift.webp";
const expected =
  "e7c75308723411072bd3f08e82fba6232c7a5cb296b17eea7fdc62a7f085e22e";
if (
  createHash("sha256")
    .update(await readFile(source))
    .digest("hex") !== expected
)
  throw new Error(
    "The approved Scarlett source changed; review before deriving an animation.",
  );
const metadata = await sharp(source, { animated: true }).metadata();
if (
  metadata.width !== 640 ||
  metadata.pageHeight !== 640 ||
  metadata.pages !== 120 ||
  metadata.delay?.reduce((a, b) => a + b, 0) !== 5000 ||
  metadata.loop !== 0 ||
  !metadata.hasAlpha
)
  throw new Error("Unexpected Scarlett animation metadata.");
const directory = await mkdtemp(join(tmpdir(), "amberly-scarlett-shared-"));
try {
  const output = join(directory, "shared.webp");
  await sharp(source, { animated: true })
    .webp({
      quality: 82,
      alphaQuality: 100,
      effort: 6,
      minSize: true,
      smartSubsample: true,
      loop: metadata.loop,
      delay: metadata.delay,
    })
    .toFile(output);
  const result = await sharp(output, { animated: true }).metadata();
  if (
    result.width !== 640 ||
    result.pageHeight !== 640 ||
    result.pages !== metadata.pages ||
    JSON.stringify(result.delay) !== JSON.stringify(metadata.delay) ||
    result.loop !== metadata.loop ||
    !result.hasAlpha
  )
    throw new Error(
      "The derived animation changed dimensions, frames, timing or transparency.",
    );
  const alpha = async (path) =>
    sharp(path, { animated: true }).extractChannel("alpha").raw().toBuffer();
  if (!(await alpha(source)).equals(await alpha(output)))
    throw new Error("The derived animation changed alpha samples.");
  if ((await readFile(output)).length >= (await readFile(source)).length)
    throw new Error("The derived animation did not reduce the source payload.");
  await rename(output, "public/gym/scarlett-shared.webp");
  console.log(
    "Derived shared 640px Scarlett animation; approved source unchanged.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
