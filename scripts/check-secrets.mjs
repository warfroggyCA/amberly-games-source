// Lightweight preflight, not a substitute for provider-side secret scanning.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const patterns = [
  /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/g,
  /gh[opusr]_[A-Za-z0-9]{30,}/g,
  /sbp_[A-Za-z0-9]{30,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
];
const failures = [];
for (const file of files) {
  if (
    (/(^|\/)\.env/.test(file) && file !== ".env.example") ||
    /\.(dump|backup\.(enc|key))$/.test(file) ||
    file.startsWith(".vercel/")
  )
    failures.push(`${file}: forbidden private file`);
  const bytes = await readFile(file);
  if (bytes.includes(0)) continue;
  const lines = bytes.toString("utf8").split("\n");
  lines.forEach((line, index) => {
    if (
      patterns.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(line);
      })
    )
      failures.push(
        `${file}:${index + 1}: potential credential (value redacted)`,
      );
  });
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(`Credential preflight passed for ${files.length} tracked files.`);
