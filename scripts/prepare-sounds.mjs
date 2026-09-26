// Licensed audio is packaged into the app, never redistributed in its source tree.
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
const manifest = JSON.parse(
  await readFile(
    new URL("../config/game-sounds.json", import.meta.url),
    "utf8",
  ),
);
const root = new URL("../public/sounds/", import.meta.url);
await mkdir(root, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const asset of manifest) {
  const file = new URL(`${asset.key}.wav`, root);
  try {
    if (hash(await readFile(file)) === asset.sha256) continue;
  } catch {}
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(asset.url, {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (hash(bytes) !== asset.sha256)
        throw new Error("Recording checksum changed");
      const temporary = new URL(`${asset.key}.wav.tmp`, root);
      await writeFile(temporary, bytes);
      await rename(temporary, file);
      failure = null;
      break;
    } catch (error) {
      failure = error;
    }
  }
  if (failure)
    throw new Error(
      `Cannot prepare licensed sound ${asset.key}: ${failure.message}`,
    );
}
console.log("Approved game sounds verified.");
