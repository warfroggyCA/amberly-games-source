import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
const env = {
  ...process.env,
  NEXT_PUBLIC_AMBERLY_COACHING_ENABLED: "false",
  NEXT_PUBLIC_AMBERLY_WORD_BUDDY_ENABLED: "true",
  CI: "1",
};
delete env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS;
rmSync(".next/coaching-rollback-receipt.json", { force: true });
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim())
  throw new Error(
    "Commit the complete source before verifying a rollback artifact.",
  );
for (const args of [
  ["run", "build"],
  [
    "exec",
    "playwright",
    "test",
    "--",
    "--config=playwright.coaching-rollback.config.ts",
    "--workers=1",
  ],
  ["run", "test:integrated"],
]) {
  const result = spawnSync("npm", args, { env, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    process.exitCode = result.status || 1;
    throw result.error ?? new Error("Compatible rollback verification failed");
  }
}
if (
  execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !==
    commit
)
  throw new Error(
    "Source changed during fallback verification; no receipt was written.",
  );
const receipt = {
  commit,
  buildId: readFileSync(".next/BUILD_ID", "utf8").trim(),
  buildEnvironment: {
    NEXT_PUBLIC_AMBERLY_COACHING_ENABLED: "false",
    NEXT_PUBLIC_AMBERLY_WORD_BUDDY_ENABLED: "true",
  },
  compatibleFallbackVerified: true,
  publicationAuthorized: false,
};
writeFileSync(
  ".next/coaching-rollback-receipt.json",
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(JSON.stringify(receipt));
