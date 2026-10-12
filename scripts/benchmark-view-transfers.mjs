import { execFileSync, spawnSync } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

// Load the actual pre-change repository readers beside their existing imports.
// Both implementations use the same isolated database and warmed wire proxy.
const sha = process.argv[2] ?? "6649aba8a7c8d4fd87d0a8fd04600b0033312a3b";
if (!/^[a-f0-9]{40}$/.test(sha))
  throw new Error("Supply a full local commit SHA.");
const files = ["shared-repository", "crokinole-repository"];
const paths = files.map((name) =>
  resolve(`src/server/transfer-baseline-${process.pid}-${name}.ts`),
);
const created = [];
try {
  for (let i = 0; i < files.length; i++) {
    const source = execFileSync(
      "git",
      ["show", `${sha}:src/server/${files[i]}.ts`],
      { encoding: "utf8" },
    );
    await writeFile(paths[i], source, { flag: "wx" });
    created.push(paths[i]);
  }
  const result = spawnSync(
    process.execPath,
    ["scripts/test-shared-database.mjs"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        AMBERLY_BASELINE_SHA: sha,
        AMBERLY_BASELINE_SHARED: paths[0],
        AMBERLY_BASELINE_CROKINOLE: paths[1],
      },
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  for (const path of created) await rm(path, { force: true });
}
