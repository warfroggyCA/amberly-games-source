import {
  createServer,
  createConnection,
  type Socket,
  type AddressInfo,
} from "node:net";
import { gzipSync } from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { expect } from "vitest";
import { createSharedRepository } from "../src/server/shared-repository";
import { createCrokinoleRepository } from "../src/server/crokinole-repository";
import {
  DEFAULT_PIECE_COLOURS,
  type CrokinoleDefinition,
} from "../src/domain/crokinole";
import { testLexicon } from "../src/lib/test-lexicon";
import type { VerifiedActor } from "../src/lib/shared-contract";
import type { LiveDraftInput } from "../src/lib/live-draft";

/** Paired calls to the actual released readers and candidate on one synthetic
 * database and warmed connection. No hosted services or production records. */
export async function benchmarkDraftRefresh(owner: postgres.Sql) {
  const baselineShared = (
    await import(/* @vite-ignore */ process.env.AMBERLY_BASELINE_SHARED!)
  ).createSharedRepository as typeof createSharedRepository;
  const baselineCrokinole = (
    await import(/* @vite-ignore */ process.env.AMBERLY_BASELINE_CROKINOLE!)
  ).createCrokinoleRepository as typeof createCrokinoleRepository;
  let bytes = 0;
  const sockets = new Set<Socket>();
  const proxy = createServer((client) => {
    const upstream = createConnection({
      path:
        process.env.SCRABBLE_TEST_SOCKET +
        "/.s.PGSQL." +
        process.env.SCRABBLE_TEST_PORT,
    });
    sockets.add(client);
    sockets.add(upstream);
    upstream.on("data", (chunk) => {
      bytes += chunk.length;
    });
    client.pipe(upstream);
    upstream.pipe(client);
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("close", () => {
      sockets.delete(client);
      upstream.destroy();
    });
    upstream.on("close", () => sockets.delete(upstream));
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  let versionQuery: { query: string; parameters: unknown[] } | undefined;
  const sql = postgres({
    host: "127.0.0.1",
    port: (proxy.address() as AddressInfo).port,
    username: "scrabble_test_login",
    database: "postgres",
    max: 1,
    ssl: false,
    prepare: false,
    onnotice: () => undefined,
    debug: (_connection, query, parameters) => {
      if (
        query.startsWith("select md5(jsonb_build_array") &&
        query.includes("g.definition")
      )
        versionQuery = { query, parameters: [...parameters] };
    },
  });
  const options = {
    defaultLexicon: testLexicon,
    resolveLexicon: () => testLexicon,
  };
  const before = baselineShared(sql, options),
    after = createSharedRepository(sql, options);
  const oldCrok = baselineCrokinole(sql, { enabled: true }),
    crok = createCrokinoleRepository(sql, { enabled: true });
  const familyId = randomUUID();
  const actor: VerifiedActor = {
    userId: randomUUID(),
    email: "benchmark@example.test",
    emailVerified: true,
    deviceHash: createHash("sha256")
      .update("f4-synthetic-device")
      .digest("hex"),
  };
  const viewer: VerifiedActor = {
    userId: randomUUID(),
    email: "viewer@example.test",
    emailVerified: true,
  };
  const rows: {
    label: string;
    size: number;
    repeat: number;
    before: Metrics;
    after: Metrics;
  }[] = [];
  const plans: Record<string, unknown>[] = [];
  type Metrics = {
    dbBytes: number;
    jsonBytes: number;
    gzipBytes: number;
    elapsedMs: number;
  };
  async function measure<T>(read: () => Promise<T>) {
    bytes = 0;
    const started = performance.now(),
      value = await read();
    const dbBytes = bytes,
      elapsedMs = performance.now() - started;
    const body = JSON.stringify(value);
    return {
      value,
      metrics: {
        dbBytes,
        jsonBytes: Buffer.byteLength(body),
        gzipBytes: gzipSync(body).length,
        elapsedMs,
      },
    };
  }
  async function paired<T>(
    label: string,
    size: number,
    repeat: number,
    old: () => Promise<unknown>,
    next: () => Promise<T>,
  ) {
    const first = await measure(old),
      second = await measure(next);
    rows.push({
      label,
      size,
      repeat,
      before: first.metrics,
      after: second.metrics,
    });
    return second.value;
  }
  const mutate = (operation: Parameters<typeof after.mutate>[2]["operation"]) =>
    after.mutate(actor, familyId, { requestId: randomUUID(), operation });
  try {
    await owner`insert into scrabble.families(id,name) values(${familyId},'Synthetic F4 benchmark')`;
    await owner`insert into scrabble.memberships(family_id,user_id,email,role) values(${familyId},${actor.userId},${actor.email},'superadmin'),(${familyId},${viewer.userId},${viewer.email},'member')`;
    for (const [id, name] of [
      ["ada", "Ada"],
      ["ben", "Ben"],
    ])
      await mutate({ type: "create-player", id, profile: { name } });
    await sql`select 1`; // Warm the single measured connection before any counter.
    for (const events of [0, 40, 100]) {
      const gameId = "draft-" + events;
      await mutate({
        type: "create-game",
        id: gameId,
        mode: "confirmed",
        players: [
          { id: "ada", seat: 0 },
          { id: "ben", seat: 2 },
        ],
        firstPlayerId: "ada",
        direction: "clockwise",
        deviceId: "benchmark-device",
      });
      for (let i = 0; i < events; i++)
        await mutate({
          type: "game-commands",
          gameId,
          deviceId: "benchmark-device",
          generation: 1,
          commands: [
            {
              id: randomUUID(),
              type: "exchange",
              count: 1,
              expectedRevision: i,
            },
          ],
        });
      const input: LiveDraftInput = {
        gameId,
        revision: events,
        generation: 1,
        streamId: randomUUID(),
        sequence: 0,
        kind: "edit",
        placements: ["A", "T"].map((letter, i) => ({
          row: 7,
          col: 7 + i,
          tile: { letter: letter as "A" | "T", blank: false },
        })),
      };
      const write = async (repo: typeof after, kind: "edit" | "heartbeat") => {
        input.sequence++;
        return repo.writeLiveDraft(actor, familyId, { ...input, kind });
      };
      await paired(
        "draft-publication",
        events,
        0,
        () => write(before, "edit"),
        () => write(after, "edit"),
      );
      expect(await after.readLiveDraft(viewer, familyId, gameId)).toMatchObject(
        { score: 4, valid: true },
      );
      for (let repeat = 1; repeat <= 3; repeat++) {
        const result = await paired(
          "draft-heartbeat",
          events,
          repeat,
          () => write(before, "heartbeat"),
          () => write(after, "heartbeat"),
        );
        expect(result).toEqual({ accepted: true });
      }
      await paired(
        "viewer-draft",
        events,
        0,
        () => before.readLiveDraft(viewer, familyId, gameId),
        () => after.readLiveDraft(viewer, familyId, gameId),
      );
      const family = await after.readRefresh(actor, familyId, {}, gameId);
      await paired(
        "conditional-family-idle",
        events,
        0,
        () => before.readRefresh(actor, familyId, family.versions, gameId),
        () => after.readRefresh(actor, familyId, family.versions, gameId),
      );
    }
    const base: CrokinoleDefinition = {
      schemaVersion: 1,
      rulesVersion: 1,
      id: "crok",
      familyId,
      mode: "confirmed",
      createdAt: "2026-10-01T12:00:00Z",
      players: [
        { id: "ada", name: "Ada", seatOrder: 0 },
        { id: "ben", name: "Ben", seatOrder: 1 },
      ],
      participants: ["ada", "ben"].map((id, i) => ({
        id,
        name: i ? "Ben" : "Ada",
        playerIds: [id],
        colour: {
          id: DEFAULT_PIECE_COLOURS[i].id,
          name: DEFAULT_PIECE_COLOURS[i].name,
          value: DEFAULT_PIECE_COLOURS[i].value,
        },
      })),
      format: "singles",
      scoringMode: "cumulative_round_totals",
      endCondition: { type: "fixed_rounds", rounds: 100 },
      initialStartingPlayerId: "ada",
    };
    for (const rounds of [0, 20, 100]) {
      const gameId = "crok-" + rounds;
      await crok.mutate(actor, familyId, {
        requestId: randomUUID(),
        operation: {
          type: "create-game",
          definition: { ...base, id: gameId },
          paletteRevision: 0,
        },
      });
      for (let i = 0; i < rounds; i++)
        await crok.mutate(actor, familyId, {
          requestId: randomUUID(),
          operation: {
            type: "command",
            gameId,
            generation: 1,
            expectedDraftRevision: i,
            command: {
              id: randomUUID(),
              type: "record_round",
              roundId: "round-" + i,
              expectedRevision: i,
              entries: [
                { participantId: "ada", rawScore: 10 },
                { participantId: "ben", rawScore: 5 },
              ],
            },
          },
        });
      const cached = await paired(
        "crokinole-selected-cold",
        rounds,
        0,
        () => oldCrok.readState(actor, familyId, { gameId }),
        () => crok.readGameRefresh(actor, familyId, gameId, ""),
      );
      expect(cached.state?.games[0].rounds).toHaveLength(rounds);
      for (let repeat = 1; repeat <= 3; repeat++) {
        const idle = await paired(
          "crokinole-selected-idle",
          rounds,
          repeat,
          () => oldCrok.readState(actor, familyId, { gameId }),
          () => crok.readGameRefresh(actor, familyId, gameId, cached.version),
        );
        expect(idle.state).toBeNull();
      }
      const history = await crok.readHistoryRefresh(actor, familyId, "");
      await paired(
        "conditional-crokinole-history-idle",
        rounds,
        0,
        () => oldCrok.readHistoryRefresh(actor, familyId, history.version),
        () => crok.readHistoryRefresh(actor, familyId, history.version),
      );
      const query = versionQuery!;
      await sql.begin("read only", async (tx) => {
        await tx`set local role scrabble_runtime`;
        await tx`select set_config('scrabble.actor_id',${actor.userId},true),set_config('scrabble.family_id',${familyId},true)`;
        const [result] = await tx.unsafe(
          "explain (analyze,buffers,format json) " + query.query,
          query.parameters as never[],
        );
        const plan = result["QUERY PLAN"][0];
        plans.push({
          rounds,
          planningMs: plan["Planning Time"],
          executionMs: plan["Execution Time"],
          sharedHitBlocks: plan.Plan["Shared Hit Blocks"],
          sharedReadBlocks: plan.Plan["Shared Read Blocks"],
          plan: plan.Plan,
        });
      });
    }
    const heartbeat = rows.filter((r) => r.label === "draft-heartbeat");
    const renewBytes = heartbeat.map((r) => r.after.dbBytes);
    expect(Math.max(...renewBytes) - Math.min(...renewBytes)).toBeLessThan(100);
    expect(heartbeat.find((r) => r.size === 100)!.after.dbBytes).toBeLessThan(
      heartbeat.find((r) => r.size === 100)!.before.dbBytes * 0.1,
    );
    for (const row of rows.filter(
      (r) => r.label === "crokinole-selected-idle" && r.size === 100,
    ))
      expect(row.after.dbBytes).toBeLessThan(row.before.dbBytes * 0.1);
    const sourceFiles = Object.fromEntries(
      await Promise.all(
        [
          "src/server/shared-repository.ts",
          "src/server/crokinole-repository.ts",
        ].map(async (path) => [
          path,
          createHash("sha256")
            .update(await readFile(path))
            .digest("hex"),
        ]),
      ),
    );
    const receipt = {
      baseline: process.env.AMBERLY_BASELINE_SHA,
      node: process.version,
      postgres: execFileSync(
        process.env.SCRABBLE_PG_BIN + "/postgres",
        ["--version"],
        { encoding: "utf8" },
      ).trim(),
      sourceFiles,
      rows,
      plans,
      method:
        "Paired actual released and candidate repository calls on the same isolated PostgreSQL 17 cluster, synthetic players and canonical migrations. One warmed connection, max:1 and prepare:false. DB server-to-application bytes counted through loopback TCP; JSON and gzip are response body bytes. Timings include application/repository work. Excludes TLS/pooler framing, Supabase Auth HTTP and HTTP headers. Journal size fixtures follow the F4 audit handoff; not household usage or billing projections.",
    };
    await writeFile(
      process.env.AMBERLY_F4_RECEIPT!,
      JSON.stringify(receipt, null, 2) + "\n",
    );
    console.log(
      "F4 paired measurement receipt written; " +
        rows.length +
        " paired requests and " +
        plans.length +
        " PostgreSQL query plans.",
    );
  } finally {
    await sql.end();
    for (const s of sockets) s.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
}
