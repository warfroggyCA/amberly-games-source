import { fileURLToPath } from "node:url";
import { runBounded } from "./bounded-process.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.exitCode = await runBounded(
  process.execPath,
  ["--max-old-space-size=512", "node_modules/eslint/bin/eslint.js", "."],
  { cwd: root, duration: 120_000 },
);
