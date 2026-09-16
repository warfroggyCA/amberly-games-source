/** Operator-only recovery tool. Connection secrets use libpq environment/service files. */
import {
  readFile,
  writeFile,
  mkdtemp,
  mkdir,
  rm,
  stat,
} from "node:fs/promises";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const magic = Buffer.from("AMBERLY1");
const bin =
  process.env.SCRABBLE_PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const [mode, file] = process.argv.slice(2);
const limit = 256 * 1024 * 1024;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function run(name, args, env = process.env, input) {
  const result = spawnSync(join(bin, name), args, {
    env,
    input,
    maxBuffer: limit,
    timeout: 120000,
  });
  // libpq errors can contain connection details; don't expose stderr or connection strings.
  if (result.error || result.status !== 0)
    throw new Error(
      `${name} failed. Check operator access, PostgreSQL version and connectivity. No restore was applied to the source.`,
    );
  return result.stdout;
}
async function key() {
  const path = process.env.SCRABBLE_BACKUP_KEY_FILE;
  if (!path)
    throw new Error(
      "Set SCRABBLE_BACKUP_KEY_FILE to a protected 32-byte key file.",
    );
  const info = await stat(path);
  if (info.mode & 0o077)
    throw new Error("The backup key must have owner-only permissions (0600).");
  const bytes = await readFile(path);
  if (bytes.length !== 32)
    throw new Error("The backup key must contain exactly 32 random bytes.");
  return bytes;
}
async function capture() {
  if (!process.env.PGHOST || !process.env.PGUSER || !process.env.PGDATABASE)
    throw new Error(
      "Set PGHOST, PGUSER and PGDATABASE explicitly for the source.",
    );
  const local =
    process.env.PGHOST.startsWith("/") ||
    ["127.0.0.1", "localhost", "::1"].includes(process.env.PGHOST);
  if (!local && process.env.PGSSLMODE !== "verify-full")
    throw new Error(
      "Remote backups require PGSSLMODE=verify-full and a trusted CA.",
    );
  const encryptionKey = await key();
  const dump = run("pg_dump", [
    "--schema=scrabble",
    "--format=custom",
    "--no-owner",
    "--lock-wait-timeout=5000",
  ]);
  if (!dump.subarray(0, 5).equals(Buffer.from("PGDMP")))
    throw new Error("No valid archive received.");
  const body = Buffer.from(
    JSON.stringify({
      format: "amberly-database-backup-v1",
      createdAt: new Date().toISOString(),
      sha256: hash(dump),
      dump: dump.toString("base64"),
    }),
  );
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
  cipher.setAAD(magic);
  const encrypted = Buffer.concat([
    magic,
    nonce,
    cipher.update(body),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  if (encrypted.length > limit)
    throw new Error("Archive exceeds the 256 MB operator-tool limit.");
  await writeFile(file, encrypted, { mode: 0o600, flag: "wx" });
  console.log(
    JSON.stringify({
      format: "amberly-encrypted-backup-v1",
      bytes: encrypted.length,
      sha256: hash(encrypted),
    }),
  );
}
async function decrypt() {
  const info = await stat(file);
  if (info.size > limit || info.size < 37)
    throw new Error("Backup size is invalid.");
  const encrypted = await readFile(file);
  if (!encrypted.subarray(0, 8).equals(magic))
    throw new Error("Unknown backup format.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    await key(),
    encrypted.subarray(8, 20),
  );
  decipher.setAAD(magic);
  decipher.setAuthTag(encrypted.subarray(-16));
  let data;
  try {
    data = JSON.parse(
      Buffer.concat([
        decipher.update(encrypted.subarray(20, -16)),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new Error(
      "Backup authentication failed. Wrong key or damaged archive; nothing restored.",
    );
  }
  if (
    data.format !== "amberly-database-backup-v1" ||
    typeof data.dump !== "string"
  )
    throw new Error("Unknown archive contents.");
  const dump = Buffer.from(data.dump, "base64");
  if (hash(dump) !== data.sha256) throw new Error("Archive checksum mismatch.");
  return dump;
}
async function rehearse() {
  const dump = await decrypt(); // Authenticate before starting any database.
  const directory = await mkdtemp(join(tmpdir(), "amberly-restore-"));
  const data = join(directory, "data"),
    socket = join(directory, "socket");
  await mkdir(socket, { mode: 0o700 });
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (name.startsWith("PG")) delete env[name];
  Object.assign(env, {
    PGHOST: socket,
    PGPORT: "5432",
    PGDATABASE: "postgres",
    PGUSER: "scrabble_restore_owner",
    PGSSLMODE: "disable",
  });
  let started = false;
  try {
    run(
      "initdb",
      [
        "-D",
        data,
        "--username=scrabble_restore_owner",
        "--auth-local=trust",
        "--auth-host=reject",
        "--encoding=UTF8",
        "--no-locale",
      ],
      env,
    );
    run(
      "pg_ctl",
      [
        "-D",
        data,
        "-l",
        join(directory, "postgres.log"),
        "-o",
        `-F -c listen_addresses='' -k '${socket}'`,
        "-w",
        "start",
      ],
      env,
    );
    started = true;
    run(
      "psql",
      [
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "create role scrabble_runtime nologin nosuperuser nobypassrls",
      ],
      env,
    );
    // No remote destination is accepted. Grants are deliberately not exercised by this data rehearsal.
    run(
      "pg_restore",
      ["--dbname=postgres", "--exit-on-error", "--no-owner", "--no-privileges"],
      env,
      dump,
    );
    const tables = run(
      "psql",
      [
        "-X",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "select tablename from pg_tables where schemaname='scrabble' order by tablename",
      ],
      env,
    )
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
    if (!tables.length)
      throw new Error("The restored archive contains no game tables.");
    const integrity = {};
    for (const table of tables) {
      if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected table name.");
      const result = run(
        "psql",
        [
          "-X",
          "-A",
          "-t",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          `select json_build_object('rows',count(*),'digest',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),''))) from scrabble.${table} t`,
        ],
        env,
      );
      integrity[table] = JSON.parse(result.toString());
    }
    console.log(
      JSON.stringify({ restored: true, isolated: true, tables: integrity }),
    );
  } finally {
    if (started) {
      const stopped = spawnSync(
        join(bin, "pg_ctl"),
        ["-D", data, "-m", "immediate", "-w", "stop"],
        { env, timeout: 30000 },
      );
      if (stopped.status !== 0)
        throw new Error(
          "Restore rehearsal could not stop its isolated database; retained files need operator attention.",
        );
    }
    await rm(directory, { recursive: true, force: true });
  }
}
try {
  if (!file || !["capture", "restore-check", "new-key"].includes(mode))
    throw new Error(
      "Usage: node scripts/backup-database.mjs capture|restore-check|new-key FILE",
    );
  if (mode === "new-key") {
    await writeFile(file, randomBytes(32), { mode: 0o600, flag: "wx" });
    console.log(
      "Backup key created. Keep a separate secure copy; it is required to recover backups.",
    );
  } else if (mode === "capture") await capture();
  else await rehearse();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Backup operation failed.",
  );
  process.exitCode = 1;
}
