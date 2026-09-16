// Own a separate production server; tests never attach to the user's scoring tab.
import { spawn } from "node:child_process";
const env = { ...process.env, SCRABBLE_APP_ORIGIN: "http://127.0.0.1:4319" };
for (const key of Object.keys(env)) {
  if (key.startsWith("SCRABBLE_") && key !== "SCRABBLE_APP_ORIGIN")
    env[key] = "";
}
// Empty values deliberately prevent Next's .env.local from supplying live services.
for (const key of [
  "SCRABBLE_DATABASE_URL",
  "SCRABBLE_SUPABASE_URL",
  "SCRABBLE_SUPABASE_PUBLISHABLE_KEY",
  "SCRABBLE_FAMILY_ID",
])
  env[key] = "";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "4319",
  ],
  { stdio: "inherit", env },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
