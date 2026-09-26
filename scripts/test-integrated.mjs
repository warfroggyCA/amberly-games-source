// Real production Next routes + restricted PostgreSQL, with only the external
// Supabase Auth service replaced by a localhost fixture. Never reads hosted data.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { createServer as netServer } from "node:net";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import postgres from "postgres";

const binaries =
  process.env.SCRABBLE_PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
await readFile(resolve(".next/BUILD_ID")); // Run npm run build first.
const directory = await mkdtemp(join(tmpdir(), "amberly-integrated-"));
const data = join(directory, "data"),
  socket = join(directory, "socket");
await mkdir(socket, { mode: 0o700 });
const children = new Set();
let started = false,
  sql,
  auth;
const familyId = randomUUID();
const identities = {
  owner: {
    id: randomUUID(),
    email: "owner@amberly.example.test",
    name: "Alice",
  },
  member: {
    id: randomUUID(),
    email: "member@amberly.example.test",
    name: "Bob",
  },
};
function runSync(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`${command} failed`);
}
async function freePort() {
  const server = netServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function child(command, args, env) {
  const process = spawn(command, args, { env, stdio: "inherit" });
  children.add(process);
  process.once("exit", () => children.delete(process));
  return process;
}
function completion(process) {
  return new Promise((resolve, reject) => {
    process.once("error", reject);
    process.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Integrated test process exited ${code}`)),
    );
  });
}
async function stop(process) {
  if (process.exitCode !== null) return;
  const finished = new Promise((resolve) => process.once("exit", resolve));
  process.kill("SIGTERM");
  const timer = setTimeout(() => process.kill("SIGKILL"), 5000);
  await finished;
  clearTimeout(timer);
}
const abort = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    abort.abort();
    for (const process of children) process.kill("SIGTERM");
  });

try {
  const port = await freePort();
  runSync(join(binaries, "initdb"), [
    "-D",
    data,
    "--username=scrabble_test_owner",
    "--auth-local=trust",
    "--auth-host=trust",
    "--encoding=UTF8",
    "--no-locale",
  ]);
  runSync(join(binaries, "pg_ctl"), [
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
  sql = postgres({
    host: "127.0.0.1",
    port,
    database: "postgres",
    username: "scrabble_test_owner",
    max: 1,
    onnotice: () => undefined,
  });
  await sql`create role anon nologin`;
  await sql`create role authenticated nologin`;
  await sql`create role service_role nologin`;
  for (const name of JSON.parse(
    await readFile("config/database-migrations.json", "utf8"),
  ))
    await sql.unsafe(await readFile(join("supabase/migrations", name), "utf8"));
  await sql`create role scrabble_test_login login nosuperuser nocreatedb nocreaterole nobypassrls`;
  await sql`grant scrabble_runtime to scrabble_test_login`;
  await sql`create schema auth`;
  await sql`create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz)`;
  for (const user of Object.values(identities))
    await sql`insert into auth.users(id,email,email_confirmed_at) values(${user.id}::uuid,${user.email},now())`;
  await sql`insert into scrabble.families(id,name) values(${familyId}::uuid,'Disposable integrated family')`;
  await sql`insert into scrabble.players(family_id,id,name) values(${familyId}::uuid,'alice','Alice')`;
  await sql`insert into scrabble.memberships(family_id,user_id,email,role,player_id) values(${familyId}::uuid,${identities.owner.id}::uuid,${identities.owner.email},'superadmin','alice')`;

  const signingKey = randomBytes(32),
    accessTokens = new Map(),
    refreshTokens = new Map(),
    refreshCalls = new Map();
  function userRecord(identity) {
    return {
      ...identity,
      aud: "authenticated",
      role: "authenticated",
      email_confirmed_at: "2026-09-18T00:00:00Z",
      confirmed_at: "2026-09-18T00:00:00Z",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      created_at: "2026-09-18T00:00:00Z",
      updated_at: "2026-09-18T00:00:00Z",
      is_anonymous: false,
    };
  }
  function session(identity) {
    const now = Math.floor(Date.now() / 1000);
    const encoded = [
      { alg: "HS256", typ: "JWT" },
      {
        sub: identity.id,
        aud: "authenticated",
        role: "authenticated",
        email: identity.email,
        jti: randomUUID(),
        iat: now,
        exp: now + 3600,
      },
    ]
      .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
      .join(".");
    const accessToken = `${encoded}.${createHmac("sha256", signingKey).update(encoded).digest("base64url")}`;
    const refreshToken = randomUUID();
    accessTokens.set(accessToken, identity);
    refreshTokens.set(refreshToken, identity);
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      user: userRecord(identity),
    };
  }
  auth = httpServer(async (request, response) => {
    const send = (status, data) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(data));
    };
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 10000)
          return send(413, { message: "Fixture request too large" });
        chunks.push(chunk);
      }
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString())
        : {};
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      if (path === "/__fixture/observations" && request.method === "GET")
        return send(200, { refreshCalls: Object.fromEntries(refreshCalls) });
      const identity = Object.values(identities).find(
        (user) => user.email === body.email,
      );
      if (path === "/auth/v1/otp" && request.method === "POST")
        return send(200, {});
      if (path === "/auth/v1/verify" && request.method === "POST")
        return identity && body.token === "123456"
          ? send(200, session(identity))
          : send(401, { message: "Invalid fixture code" });
      if (path === "/auth/v1/user" && request.method === "GET") {
        const user = accessTokens.get(
          request.headers.authorization?.replace(/^Bearer /, ""),
        );
        return user
          ? send(200, userRecord(user))
          : send(401, { message: "Unknown fixture session" });
      }
      if (path === "/auth/v1/token" && request.method === "POST") {
        const user = refreshTokens.get(body.refresh_token);
        if (!user) return send(401, { message: "Unknown fixture refresh" });
        refreshCalls.set(user.id, (refreshCalls.get(user.id) ?? 0) + 1);
        return send(200, session(user));
      }
      if (path === "/auth/v1/logout" && request.method === "POST")
        return send(200, {});
      send(404, { message: "Unsupported local auth fixture operation" });
    } catch {
      send(400, { message: "Invalid local auth fixture request" });
    }
  });
  await new Promise((resolve, reject) => {
    auth.once("error", reject);
    auth.listen(0, "127.0.0.1", resolve);
  });
  const appPort = await freePort(),
    origin = `http://127.0.0.1:${appPort}`;
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("SCRABBLE_") || key.startsWith("AMBERLY_"))
      env[key] = "";
  Object.assign(env, {
    SCRABBLE_APP_ORIGIN: origin,
    SCRABBLE_DATABASE_URL: `postgresql://scrabble_test_login@127.0.0.1:${port}/postgres`,
    SCRABBLE_DATABASE_CA_CERT: "",
    SCRABBLE_SUPABASE_URL: `http://127.0.0.1:${auth.address().port}`,
    SCRABBLE_SUPABASE_PUBLISHABLE_KEY:
      "sb_publishable_local_integrated_fixture",
    SCRABBLE_AUTH_METHOD: "email",
    SCRABBLE_FAMILY_ID: familyId,
    AMBERLY_CROKINOLE_ENABLED: "true",
    AMBERLY_INTEGRATED_ORIGIN: origin,
    AMBERLY_INTEGRATED_AUTH_ORIGIN: `http://127.0.0.1:${auth.address().port}`,
    AMBERLY_INTEGRATED_IDENTITIES: JSON.stringify(identities),
  });
  const server = child(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(appPort),
    ],
    env,
  );
  const deadline = Date.now() + 45000;
  for (;;) {
    if (
      abort.signal.aborted ||
      server.exitCode !== null ||
      Date.now() > deadline
    )
      throw new Error("Integrated Next server did not become ready");
    try {
      if (
        (
          await fetch(`${origin}/api/auth/session`, {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      )
        break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  console.log(
    "Integrated coverage: real Next HTTP/auth cookie handling, app APIs, restricted PostgreSQL and browser UI. External email/OAuth delivery is simulated locally.",
  );
  await completion(
    child(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "--config",
        "tests/integrated/playwright.config.ts",
      ],
      env,
    ),
  );
  if (!(refreshCalls.get(identities.owner.id) > 0))
    throw new Error("The integrated journey did not exercise session renewal.");
  console.log(
    "Session renewal verified: the real SSR auth client refreshed the synthetic owner's session through the local provider fixture.",
  );
} finally {
  await Promise.all([...children].map(stop));
  if (auth) await new Promise((resolve) => auth.close(resolve));
  if (sql) await sql.end();
  if (started) {
    const stopped = spawnSync(
      join(binaries, "pg_ctl"),
      ["-D", data, "-m", "immediate", "-w", "stop"],
      { stdio: "inherit" },
    );
    if (stopped.error || stopped.status !== 0)
      throw new Error(
        `The disposable PostgreSQL cluster did not confirm shutdown. Its files are preserved at ${directory}.`,
      );
  }
  await rm(directory, { recursive: true, force: true });
}
