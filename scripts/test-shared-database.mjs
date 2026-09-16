import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";

const binaries =
  process.env.SCRABBLE_PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const directory = await mkdtemp(join(tmpdir(), "scrabble-db-test-"));
const data = join(directory, "data");
const socket = join(directory, "socket");
await mkdir(socket, { mode: 0o700 });
let started = false;
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`${command} exited ${result.status}`);
}
try {
  run(join(binaries, "initdb"), [
    "-D",
    data,
    "--username=scrabble_test_owner",
    "--auth-local=trust",
    "--auth-host=trust",
    "--encoding=UTF8",
    "--no-locale",
  ]);
  run(join(binaries, "pg_ctl"), [
    "-D",
    data,
    "-l",
    join(directory, "postgres.log"),
    "-o",
    `-F -c listen_addresses='127.0.0.1' -p ${port} -k '${socket}'`,
    "-w",
    "start",
  ]);
  started = true;
  run(
    resolve("node_modules/.bin/vitest"),
    ["run", "tests/shared-database.test.ts"],
    {
      env: {
        ...process.env,
        SCRABBLE_TEST_SOCKET: socket,
        SCRABBLE_TEST_PORT: String(port),
        PGPORT: String(port),
        SCRABBLE_TEST_DIRECTORY: directory,
        SCRABBLE_PG_BIN: binaries,
      },
    },
  );
} finally {
  if (started && process.env.SCRABBLE_TEST_KEEP !== "1")
    spawnSync(
      join(binaries, "pg_ctl"),
      ["-D", data, "-m", "immediate", "-w", "stop"],
      { stdio: "inherit" },
    );
  if (process.env.SCRABBLE_TEST_KEEP !== "1")
    await rm(directory, { recursive: true, force: true });
  else console.log(`Retained isolated browser test cluster: ${directory}`);
}
