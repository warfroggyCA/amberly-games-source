// Local LAN preview, explicitly disconnected from hosted accounts and game storage.
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
const port = Number(process.env.GYM_PREVIEW_PORT ?? 4321);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("GYM_PREVIEW_PORT must be between 1024 and 65535.");
const env = {
  ...process.env,
  AMBERLY_GYM_LAB_ENABLED: "true",
  NEXT_TELEMETRY_DISABLED: "1",
};
env.GYM_PREVIEW_HOSTS = Object.values(networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .filter((address) => address.family === "IPv4" && !address.internal)
  .map((address) => address.address)
  .join(",");
for (const key of Object.keys(env))
  if (key.startsWith("SCRABBLE_")) env[key] = "";
for (const key of [
  "SCRABBLE_DATABASE_URL",
  "SCRABBLE_SUPABASE_URL",
  "SCRABBLE_SUPABASE_PUBLISHABLE_KEY",
  "SCRABBLE_FAMILY_ID",
])
  env[key] = "";
env.SCRABBLE_APP_ORIGIN = `http://127.0.0.1:${port}`;
console.log(`Gym engine preview: http://localhost:${port}/gym-lab`);
for (const addresses of Object.values(networkInterfaces()))
  for (const address of addresses ?? [])
    if (address.family === "IPv4" && !address.internal)
      console.log(
        `Same-network tablet: http://${address.address}:${port}/gym-lab`,
      );
console.log(
  "Hosted game storage and sign-in are disabled in this local process.",
);
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "0.0.0.0",
    "--port",
    String(port),
  ],
  { stdio: "inherit", env },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => process.exit(code ?? 1));
