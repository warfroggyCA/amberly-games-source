// Private source artifact only: never publish this asset to a public repository.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
const paths = [
  "docs/OSPD5.txt",
  "data/lexicons/merriam-2026-09-14/words.txt",
  "data/lexicons/merriam-2026-09-14/report.json",
];
const [mode, file] = process.argv.slice(2);
if (!["pack", "restore"].includes(mode) || !file)
  throw new Error("Usage: node scripts/lexicon-artifact.mjs pack|restore FILE");
if (mode === "pack") {
  const sources = Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [path, await readFile(path, "utf8")]),
    ),
  );
  const bytes = gzipSync(JSON.stringify({ version: 1, sources }));
  await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  console.log(
    `Private asset SHA-256: ${createHash("sha256").update(bytes).digest("hex")}`,
  );
} else {
  const bytes = await readFile(file);
  const pin = JSON.parse(
    await readFile("config/lexicon-artifact.json", "utf8"),
  );
  if (createHash("sha256").update(bytes).digest("hex") !== pin.sha256)
    throw new Error("Private word asset checksum mismatch. Nothing restored.");
  const archive = JSON.parse(
    gunzipSync(bytes, { maxOutputLength: 25000000 }).toString("utf8"),
  );
  if (
    archive.version !== 1 ||
    JSON.stringify(Object.keys(archive.sources).sort()) !==
      JSON.stringify([...paths].sort())
  )
    throw new Error("Unexpected word asset structure.");
  // Validate all destinations before writing; never overwrite a changed original.
  const missing = [];
  for (const path of paths) {
    if (typeof archive.sources[path] !== "string")
      throw new Error("Invalid word asset.");
    try {
      await access(path);
    } catch {
      missing.push(path);
      continue;
    }
    if ((await readFile(path, "utf8")) !== archive.sources[path])
      throw new Error(
        `Existing original differs: ${path}. Nothing overwritten.`,
      );
  }
  for (const path of missing) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, archive.sources[path], { flag: "wx", mode: 0o600 });
  }
  const result = spawnSync(process.execPath, ["scripts/prepare-lexicons.mjs"], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(1);
}
