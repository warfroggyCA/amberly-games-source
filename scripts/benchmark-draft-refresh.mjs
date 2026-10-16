import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const baseline = process.argv[2] ?? "ef8a0d6cfaad42985e0df047b9d8f64340dc3dba";
const receipt = process.env.AMBERLY_F4_RECEIPT;
if (!receipt)
  throw new Error("Set AMBERLY_F4_RECEIPT to the measurement output path.");
const result = spawnSync(
  process.execPath,
  ["scripts/benchmark-view-transfers.mjs", baseline],
  {
    stdio: "inherit",
    env: { ...process.env, AMBERLY_F4_RECEIPT: resolve(receipt) },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
