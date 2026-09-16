import { execFileSync } from "node:child_process";
const read = (program, args) =>
  execFileSync(program, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
try {
  const sha = read("git", ["rev-parse", "HEAD"]);
  if (read("git", ["status", "--porcelain"]))
    throw new Error(
      "Commit the complete change before release; the checkout is dirty.",
    );
  const runs = JSON.parse(
    read("gh", [
      "run",
      "list",
      "--repo",
      "warfroggyCA/amberly-games-source",
      "--workflow",
      "verify.yml",
      "--commit",
      sha,
      "--limit",
      "1",
      "--json",
      "headSha,status,conclusion,url",
    ]),
  );
  const run = runs[0];
  if (
    !run ||
    run.headSha !== sha ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  )
    throw new Error(
      "This exact commit does not have a successful Verify run. Release blocked.",
    );
  console.log(
    JSON.stringify({
      readyForReview: true,
      commit: sha,
      verification: run.url,
    }),
  );
  console.log(
    "Publication still requires release approval. Do not apply database migrations blindly; see docs/releasing.md.",
  );
} catch (error) {
  console.error(
    error instanceof Error && !("stderr" in error)
      ? error.message
      : "Release verification could not reach GitHub or read the repository.",
  );
  process.exitCode = 1;
}
