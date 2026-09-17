import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import {
  hasPermission,
  type MemberPermission,
} from "../lib/member-permissions";
import type {
  FamilyMember,
  GameProtest,
  VerifiedActor,
} from "../lib/shared-contract";
import type {
  CrokinoleAccess,
  CrokinoleDraft,
  CrokinoleMutation,
  CrokinoleMutationResult,
  CrokinolePalette,
  CrokinoleSharedState,
} from "../lib/crokinole-contract";
import { SharedRepositoryError } from "./shared-repository";
import {
  createCrokinoleGame,
  createCrokinoleRematch,
  applyCrokinoleCommand,
  hydrateCrokinoleGame,
} from "../domain/crokinole";
import { isCrokinoleDefinition, isCrokinoleCommand } from "../domain/crokinole";
import { DEFAULT_PIECE_COLOURS, isPieceColour } from "../domain/crokinole";
import type { CrokinoleGame } from "../domain/crokinole";

import {
  DEFAULT_CROKINOLE_SETTINGS,
  isCrokinoleDefaults,
} from "../domain/crokinole-defaults";
type Tx = postgres.TransactionSql;
const fail = (code: string, message: string, status = 400): never => {
  throw new SharedRepositoryError(code, message, status);
};
const id = (x: unknown): x is string =>
  typeof x === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(x) &&
  !["__proto__", "constructor", "prototype"].includes(x);
const revision = (x: unknown): x is number =>
  Number.isSafeInteger(x) && Number(x) >= 0 && Number(x) < 2147483646;
const record = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (record(x))
    return `{${Object.keys(x)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
      .join(",")}}`;
  return JSON.stringify(x);
}
const json = (tx: Tx, x: unknown) => tx.json(JSON.parse(JSON.stringify(x)));
const reason = (x: unknown) => {
  if (typeof x !== "string" || !x.trim() || x.length > 500)
    fail("INVALID_REASON", "Enter a reason of 1–500 characters.");
  return (x as string).trim();
};
const permit = (who: FamilyMember, p: MemberPermission) => {
  if (!hasPermission(who, p))
    fail(
      "PERMISSION_DENIED",
      "Your permissions do not allow this action.",
      403,
    );
};
export function createCrokinoleRepository(
  sql: postgres.Sql,
  options: { enabled?: boolean } = {},
) {
  const enabled = () =>
    options.enabled ?? process.env.AMBERLY_CROKINOLE_ENABLED === "true";
  async function transaction<T>(
    actor: VerifiedActor,
    familyId: string,
    write: boolean,
    work: (tx: Tx, who: FamilyMember) => Promise<T>,
  ): Promise<T> {
    const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
    if (
      !uuid.test(actor.userId) ||
      !uuid.test(familyId) ||
      actor.emailVerified !== true ||
      typeof actor.email !== "string"
    )
      fail("INVALID_ACTOR", "Verified family access is required.", 403);
    return (await sql.begin(
      write ? "" : "isolation level repeatable read read only",
      async (tx) => {
        await tx`set local role scrabble_runtime`;
        await tx`select set_config('scrabble.actor_id',${actor.userId},true),set_config('scrabble.family_id',${familyId},true),set_config('scrabble.actor_email',${actor.email.toLowerCase()},true),set_config('scrabble.email_verified','true',true),set_config('statement_timeout','15000',true),set_config('lock_timeout','5000',true)`;
        if (write)
          await tx`select id from scrabble.families where id=${familyId}::uuid for update`;
        const [m] =
          await tx`select * from scrabble.memberships where family_id=${familyId}::uuid and user_id=${actor.userId}::uuid and active`;
        if (!m)
          fail(
            "NOT_A_MEMBER",
            "This account does not have active family access.",
            403,
          );
        const who: FamilyMember = {
          userId: m.user_id,
          email: m.email,
          role: m.role,
          active: m.active,
          playerId: m.player_id,
          permissions: m.permissions,
        };
        return work(tx, who);
      },
    )) as T;
  }
  async function palette(tx: Tx, familyId: string): Promise<CrokinolePalette> {
    const [p] =
      await tx`select * from scrabble.crokinole_palette where family_id=${familyId}::uuid`;
    return p
      ? {
          revision: p.revision,
          colours: p.colours,
          defaults: p.defaults ?? DEFAULT_CROKINOLE_SETTINGS,
        }
      : {
          revision: 0,
          colours: structuredClone(DEFAULT_PIECE_COLOURS),
          defaults: structuredClone(DEFAULT_CROKINOLE_SETTINGS),
        };
  }
  async function checked(tx: Tx, familyId: string, gameId: string) {
    if (!id(gameId)) fail("INVALID_GAME", "Invalid game reference.");
    const [row] =
      await tx`select * from scrabble.crokinole_games where family_id=${familyId}::uuid and game_id=${gameId} and not removed`;
    if (!row) fail("GAME_NOT_FOUND", "This game is not available.", 404);
    const events =
      await tx`select event from scrabble.crokinole_events where family_id=${familyId}::uuid and game_id=${gameId} order by sequence`;
    let game: CrokinoleGame;
    try {
      game = hydrateCrokinoleGame(
        row.definition,
        events.map((e) => e.event),
      );
    } catch {
      return fail(
        "HISTORY_INTEGRITY",
        "The game history needs recovery. No data has been changed.",
        500,
      );
    }
    if (
      canonical(game) !== canonical(row.state) ||
      game.revision !== row.revision
    )
      fail(
        "HISTORY_INTEGRITY",
        "The saved projection differs from its journal.",
        500,
      );
    return { row, game };
  }
  async function access(
    tx: Tx,
    familyId: string,
    row: postgres.Row,
    who: FamilyMember,
  ): Promise<CrokinoleAccess> {
    const concerns =
      await tx`select concern from scrabble.crokinole_concerns where family_id=${familyId}::uuid and game_id=${row.game_id} order by id`;
    return {
      scorerUserId: row.scorer_user_id,
      generation: row.generation,
      mode: row.mode,
      canScore:
        row.scorer_user_id === who.userId && hasPermission(who, "scoreGames"),
      concerns: concerns.map((r) => r.concern as GameProtest),
    };
  }
  async function draft(
    tx: Tx,
    familyId: string,
    row: postgres.Row,
  ): Promise<CrokinoleDraft | null> {
    const [d] =
      await tx`select revision,payload from scrabble.crokinole_drafts where family_id=${familyId}::uuid and game_id=${row.game_id} and generation=${row.generation}`;
    return d
      ? {
          revision: d.revision,
          baseRevision: row.revision,
          generation: row.generation,
          values: {},
          editingRoundId: null,
          ...d.payload,
        }
      : null;
  }
  async function audit(
    tx: Tx,
    actor: VerifiedActor,
    familyId: string,
    action: string,
    subject: string,
    before: unknown,
    after: unknown,
  ) {
    await tx`insert into scrabble.audit(family_id,id,actor_id,action,subject,before_value,after_value) values(${familyId}::uuid,${randomUUID()}::uuid,${actor.userId}::uuid,${"crokinole:" + action},${subject},${json(tx, before)},${json(tx, after)})`;
  }
  async function readState(
    actor: VerifiedActor,
    familyId: string,
    query: { gameId?: string; cursor?: string } = {},
  ): Promise<CrokinoleSharedState> {
    return transaction(actor, familyId, false, async (tx, who) => {
      const result: CrokinoleSharedState = {
        games: [],
        access: {},
        palette: await palette(tx, familyId),
        nextCursor: null,
        creationEnabled: enabled(),
      };
      if (query.gameId) {
        const { row, game } = await checked(tx, familyId, query.gameId);
        result.games = [game];
        result.access[query.gameId] = await access(tx, familyId, row, who);
        if (result.access[query.gameId].canScore)
          result.draft = await draft(tx, familyId, row);
        return result;
      }
      let cursor: { date: string; id: string } | null = null;
      if (query.cursor) {
        try {
          cursor = JSON.parse(
            Buffer.from(query.cursor, "base64url").toString(),
          );
          if (
            !cursor ||
            !id(cursor.id) ||
            !Number.isFinite(Date.parse(cursor.date))
          )
            throw Error();
        } catch {
          fail("INVALID_CURSOR", "Invalid history page.");
        }
      }
      const rows =
        await tx`select game_id,state,scorer_user_id,generation,mode,created_at::text as created_at_cursor from scrabble.crokinole_games where family_id=${familyId}::uuid and not removed ${cursor ? tx`and (created_at,game_id)<(${cursor.date}::text::timestamptz,${cursor.id})` : tx``} order by created_at desc,game_id desc limit 31`;
      for (const row of rows.slice(0, 30)) {
        result.games.push(row.state);
        result.access[row.game_id] = {
          scorerUserId: row.scorer_user_id,
          generation: row.generation,
          mode: row.mode,
          canScore:
            row.scorer_user_id === who.userId &&
            hasPermission(who, "scoreGames"),
          concerns: [],
        };
      }
      if (rows.length > 30) {
        const last = rows[29];
        result.nextCursor = Buffer.from(
          JSON.stringify({
            date: last.created_at_cursor,
            id: last.game_id,
          }),
        ).toString("base64url");
      }
      return result;
    });
  }
  async function mutate(
    actor: VerifiedActor,
    familyId: string,
    input: CrokinoleMutation,
  ): Promise<CrokinoleMutationResult> {
    if (
      !record(input) ||
      Object.keys(input).some((k) => !["requestId", "operation"].includes(k)) ||
      !id(input.requestId) ||
      !record(input.operation)
    )
      fail("INVALID_REQUEST", "Invalid Crokinole request.");
    const op = input.operation;
    const allowed: Record<string, string[]> = {
      "create-game": ["definition", "paletteRevision"],
      rematch: ["gameId", "newGameId", "expectedRevision"],
      "save-palette": ["expectedRevision", "colours"],
      "save-defaults": ["expectedRevision", "defaults"],
      command: [
        "gameId",
        "generation",
        "command",
        "expectedDraftRevision",
        "amendmentReason",
      ],
      "save-draft": [
        "gameId",
        "generation",
        "expectedRevision",
        "expectedDraftRevision",
        "values",
        "editingRoundId",
      ],
      "take-over": ["gameId", "expectedRevision", "generation", "reason"],
      "delete-practice": ["gameId", "expectedRevision", "reason"],
      "report-concern": ["gameId", "expectedRevision", "reason"],
      "resolve-concern": [
        "gameId",
        "expectedRevision",
        "concernId",
        "outcome",
        "reason",
      ],
    };
    if (
      !Object.hasOwn(allowed, op.type) ||
      Object.keys(op).some((k) => k !== "type" && !allowed[op.type].includes(k))
    )
      fail("INVALID_OPERATION", "Invalid Crokinole action fields.");
    const fingerprint = createHash("sha256")
      .update(canonical(op))
      .digest("hex");
    const requestId =
      "crokinole:" + createHash("sha256").update(input.requestId).digest("hex");
    return transaction(actor, familyId, true, async (tx, who) => {
      const [prior] =
        await tx`select * from scrabble.requests where family_id=${familyId}::uuid and actor_id=${actor.userId}::uuid and request_id=${requestId}`;
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          fail(
            "REQUEST_REUSED",
            "This request ID was already used for a different action.",
            409,
          );
        const response = prior.response as CrokinoleMutationResult;
        if (response.removedGameId && who.role !== "superadmin")
          fail("FORBIDDEN", "Test games are superadmin-only.", 403);
        if (response.game) {
          const current = await checked(
            tx,
            familyId,
            response.game.definition.id,
          );
          const a = await access(tx, familyId, current.row, who);
          return {
            ...response,
            game: current.game,
            access: a,
            draft: a.canScore
              ? await draft(tx, familyId, current.row)
              : undefined,
            replayed: true,
          };
        }
        if ("gameId" in op && !response.removedGameId) {
          const current = await checked(tx, familyId, op.gameId);
          if (op.type === "save-draft") {
            if (
              current.row.scorer_user_id !== actor.userId ||
              !hasPermission(who, "scoreGames")
            )
              fail("SCORER_CONFLICT", "Scoring access changed.", 409);
            return {
              draft: await draft(tx, familyId, current.row),
              replayed: true,
            };
          }
        }
        if (op.type === "save-palette" || op.type === "save-defaults")
          permit(who, "manageEquipment");
        return { ...response, draft: undefined, replayed: true };
      }
      if (!enabled())
        fail(
          "FEATURE_DISABLED",
          "Crokinole changes are temporarily unavailable. Saved history remains available.",
          503,
        );
      let response: CrokinoleMutationResult = {};
      if (op.type === "save-defaults") {
        permit(who, "manageEquipment");
        const old = await palette(tx, familyId);
        if (
          !revision(op.expectedRevision) ||
          old.revision !== op.expectedRevision
        )
          fail(
            "REVISION_CONFLICT",
            "Family settings changed elsewhere. Reload before saving.",
            409,
          );
        if (!isCrokinoleDefaults(op.defaults))
          fail(
            "INVALID_DEFAULTS",
            "Choose a valid format, scoring method and match length.",
          );
        const next = {
          ...old,
          revision: old.revision + 1,
          defaults: op.defaults,
        };
        await tx`insert into scrabble.crokinole_palette(family_id,revision,colours,defaults) values(${familyId}::uuid,${next.revision},${json(tx, next.colours)},${json(tx, next.defaults)}) on conflict(family_id) do update set revision=excluded.revision,defaults=excluded.defaults`;
        await audit(tx, actor, familyId, op.type, familyId, old, next);
        response = { palette: next };
      } else if (op.type === "save-palette") {
        permit(who, "manageEquipment");
        const old = await palette(tx, familyId);
        if (
          !revision(op.expectedRevision) ||
          old.revision !== op.expectedRevision
        )
          fail(
            "REVISION_CONFLICT",
            "Colours changed elsewhere. Reload before saving.",
            409,
          );
        if (
          !Array.isArray(op.colours) ||
          op.colours.length > 64 ||
          !op.colours.every(isPieceColour) ||
          new Set(op.colours.map((c) => c.id)).size !== op.colours.length ||
          DEFAULT_PIECE_COLOURS.some(
            (d) =>
              !op.colours.some(
                (c) =>
                  c.id === d.id &&
                  c.isDefault &&
                  c.name === d.name &&
                  c.value === d.value,
              ),
          ) ||
          op.colours.some(
            (c) =>
              c.isDefault && !DEFAULT_PIECE_COLOURS.some((d) => d.id === c.id),
          )
        )
          fail("INVALID_PALETTE", "The colour palette is invalid.");
        const next = {
          ...old,
          revision: old.revision + 1,
          colours: op.colours,
        };
        await tx`insert into scrabble.crokinole_palette(family_id,revision,colours) values(${familyId}::uuid,${next.revision},${json(tx, next.colours)}) on conflict(family_id) do update set revision=excluded.revision,colours=excluded.colours`;
        await audit(tx, actor, familyId, op.type, familyId, old, next);
        response = { palette: next };
      } else if (op.type === "rematch") {
        permit(who, "startGames");
        permit(who, "scoreGames");
        const { game: source } = await checked(tx, familyId, op.gameId);
        if (
          !id(op.newGameId) ||
          !revision(op.expectedRevision) ||
          source.revision !== op.expectedRevision
        )
          fail(
            "REVISION_CONFLICT",
            "The previous match changed. Reload before starting a rematch.",
            409,
          );
        if (source.status === "active")
          fail(
            "MATCH_ACTIVE",
            "Finish or end this match before starting a rematch.",
            409,
          );
        const roster =
          await tx`select id from scrabble.players where family_id=${familyId}::uuid`;
        if (
          source.definition.players.some(
            (p) => !roster.some((r) => r.id === p.id),
          )
        )
          fail("ROSTER_CHANGED", "A player is no longer available.", 409);
        const game = createCrokinoleRematch(
          source,
          op.newGameId,
          new Date().toISOString(),
        );
        const existing =
          await tx`select game_id from scrabble.crokinole_games where family_id=${familyId}::uuid and game_id=${op.newGameId}`;
        if (existing.length)
          fail("GAME_EXISTS", "This rematch already exists.", 409);
        await tx`insert into scrabble.crokinole_games(family_id,game_id,definition,state,revision,scorer_user_id,mode) values(${familyId}::uuid,${op.newGameId},${json(tx, game.definition)},${json(tx, game)},0,${actor.userId}::uuid,${game.definition.mode})`;
        await audit(
          tx,
          actor,
          familyId,
          op.type,
          op.newGameId,
          { sourceGameId: op.gameId },
          game.definition,
        );
        response = {
          game,
          access: {
            scorerUserId: actor.userId,
            generation: 1,
            canScore: true,
            mode: game.definition.mode,
            concerns: [],
          },
          draft: null,
        };
      } else if (op.type === "create-game") {
        permit(who, "startGames");
        permit(who, "scoreGames");
        if (
          !isCrokinoleDefinition(op.definition) ||
          op.definition.familyId !== familyId
        )
          fail("INVALID_GAME", "Invalid game setup.");
        if (op.definition.mode === "practice" && who.role !== "superadmin")
          fail("FORBIDDEN", "Test games are superadmin-only.", 403);
        const p = await palette(tx, familyId);
        if (p.revision !== op.paletteRevision)
          fail(
            "REVISION_CONFLICT",
            "Colours changed. Review setup before starting.",
            409,
          );
        for (const side of op.definition.participants) {
          const c = p.colours.find(
            (c) => c.id === side.colour.id && c.isActive,
          );
          if (
            !c ||
            c.name !== side.colour.name ||
            c.value !== side.colour.value
          )
            fail("INVALID_COLOUR", "Choose an available piece colour.");
        }
        const players =
          await tx`select id,name from scrabble.players where family_id=${familyId}::uuid`;
        for (const player of op.definition.players) {
          if (
            !players.some((p) => p.id === player.id && p.name === player.name)
          )
            fail(
              "ROSTER_CHANGED",
              "A player changed. Reload the roster before starting.",
              409,
            );
        }
        for (const participant of op.definition.participants) {
          const name = participant.playerIds
            .map((playerId) => players.find((p) => p.id === playerId)!.name)
            .join(" & ");
          if (participant.name !== name)
            fail(
              "ROSTER_CHANGED",
              "Participant names must match the selected players.",
              409,
            );
        }
        const definition = {
          ...op.definition,
          createdAt: new Date().toISOString(),
        };
        const game = createCrokinoleGame(definition);
        const exists =
          await tx`select game_id from scrabble.crokinole_games where family_id=${familyId}::uuid and game_id=${definition.id}`;
        if (exists.length)
          fail("GAME_EXISTS", "This game already exists.", 409);
        await tx`insert into scrabble.crokinole_games(family_id,game_id,definition,state,revision,scorer_user_id,mode) values(${familyId}::uuid,${definition.id},${json(tx, definition)},${json(tx, game)},${game.revision},${actor.userId}::uuid,${definition.mode})`;
        await audit(
          tx,
          actor,
          familyId,
          op.type,
          definition.id,
          null,
          definition,
        );
        response = {
          game,
          access: {
            scorerUserId: actor.userId,
            generation: 1,
            canScore: true,
            mode: definition.mode,
            concerns: [],
          },
          draft: null,
        };
      } else {
        if (!("gameId" in op)) fail("INVALID_OPERATION", "Unknown operation.");
        const { row, game } = await checked(tx, familyId, op.gameId);
        const before = game;
        const a = await access(tx, familyId, row, who);
        const scorer = () => {
          permit(who, "scoreGames");
          if (row.scorer_user_id !== actor.userId)
            fail(
              "SCORER_CONFLICT",
              "Only the designated scorer can change this match.",
              409,
            );
          if (!("generation" in op) || op.generation !== row.generation)
            fail(
              "SCORER_CONFLICT",
              "Scoring ownership changed. Reload the match.",
              409,
            );
        };
        if (op.type === "command") {
          scorer();
          if (!isCrokinoleCommand(op.command))
            fail("INVALID_COMMAND", "Invalid round action.");
          const d = await draft(tx, familyId, row);
          if (
            !revision(op.expectedDraftRevision) ||
            (d?.revision ?? 0) !== op.expectedDraftRevision
          )
            fail(
              "DRAFT_CONFLICT",
              "A newer entry exists on another device. Review it before saving.",
              409,
            );
          if (game.status !== "active") reason(op.amendmentReason);
          let next: CrokinoleGame;
          try {
            next = applyCrokinoleCommand(game, op.command, {
              actorId: actor.userId,
              createdAt: new Date().toISOString(),
            });
          } catch (e) {
            fail(
              "INVALID_COMMAND",
              e instanceof Error ? e.message : "Invalid round action.",
              409,
            );
          }
          if (next!.revision === game.revision)
            fail(
              "COMMAND_REUSED",
              "This command was already accepted. Reload the match.",
              409,
            );
          const event = next!.events.at(-1)!;
          await tx`insert into scrabble.crokinole_events(family_id,game_id,sequence,event) values(${familyId}::uuid,${op.gameId},${next!.revision},${json(tx, event)})`;
          await tx`update scrabble.crokinole_games set state=${json(tx, next!)},revision=${next!.revision},updated_at=now() where family_id=${familyId}::uuid and game_id=${op.gameId}`;
          const cleared: CrokinoleDraft = {
            revision: (d?.revision ?? 0) + 1,
            baseRevision: next!.revision,
            generation: row.generation,
            values:
              op.command.type === "undo_round"
                ? Object.fromEntries(
                    game.rounds
                      .at(-1)!
                      .entries.map((e) => [
                        e.participantId,
                        String(e.rawScore),
                      ]),
                  )
                : {},
            editingRoundId: null,
          };
          await tx`insert into scrabble.crokinole_drafts(family_id,game_id,scorer_user_id,generation,revision,payload) values(${familyId}::uuid,${op.gameId},${actor.userId}::uuid,${row.generation},${cleared.revision},${json(tx, cleared)}) on conflict(family_id,game_id,generation) do update set revision=excluded.revision,payload=excluded.payload`;
          await audit(
            tx,
            actor,
            familyId,
            op.type,
            op.gameId,
            { revision: before.revision },
            {
              revision: next!.revision,
              command: op.command,
              amendmentReason: op.amendmentReason ?? null,
            },
          );
          response = { game: next!, access: a, draft: cleared };
        } else if (op.type === "save-draft") {
          scorer();
          if (op.expectedRevision !== game.revision)
            fail(
              "REVISION_CONFLICT",
              "The match changed. Review your retained entry.",
              409,
            );
          if (
            !record(op.values) ||
            Object.keys(op.values).some(
              (k) => !game.definition.participants.some((p) => p.id === k),
            ) ||
            Object.values(op.values).some(
              (v) => typeof v !== "string" || v.length > 16,
            ) ||
            !(
              op.editingRoundId === null ||
              game.rounds.some((r) => r.id === op.editingRoundId)
            )
          )
            fail("INVALID_DRAFT", "Invalid round entry.");
          const d = await draft(tx, familyId, row);
          if (
            !revision(op.expectedDraftRevision) ||
            (d?.revision ?? 0) !== op.expectedDraftRevision
          )
            fail("DRAFT_CONFLICT", "Another device saved a newer draft.", 409);
          const next: CrokinoleDraft = {
            revision: (d?.revision ?? 0) + 1,
            baseRevision: game.revision,
            generation: row.generation,
            values: op.values,
            editingRoundId: op.editingRoundId,
          };
          await tx`insert into scrabble.crokinole_drafts(family_id,game_id,scorer_user_id,generation,revision,payload) values(${familyId}::uuid,${op.gameId},${actor.userId}::uuid,${row.generation},${next.revision},${json(tx, next)}) on conflict(family_id,game_id,generation) do update set revision=excluded.revision,payload=excluded.payload`;
          response = { draft: next };
        } else {
          if (
            !revision(op.expectedRevision) ||
            op.expectedRevision !== game.revision
          )
            fail(
              "REVISION_CONFLICT",
              "The match changed. Reload before continuing.",
              409,
            );
          if (op.type === "take-over") {
            permit(who, "scoreGames");
            permit(who, "takeOverScoring");
            reason(op.reason);
            if (op.generation !== row.generation)
              fail("SCORER_CONFLICT", "The scorer changed.", 409);
            await tx`update scrabble.crokinole_games set scorer_user_id=${actor.userId}::uuid,generation=generation+1,updated_at=now() where family_id=${familyId}::uuid and game_id=${op.gameId}`;
            response = {
              game,
              access: {
                ...a,
                scorerUserId: actor.userId,
                generation: row.generation + 1,
                canScore: true,
              },
              draft: null,
            };
          } else if (op.type === "delete-practice") {
            if (who.role !== "superadmin" || row.mode !== "practice")
              fail("FORBIDDEN", "Only superadmins can remove test games.", 403);
            reason(op.reason);
            await tx`update scrabble.crokinole_games set removed=true,updated_at=now() where family_id=${familyId}::uuid and game_id=${op.gameId}`;
            response = { removedGameId: op.gameId };
          } else if (op.type === "report-concern") {
            if (
              a.concerns.some(
                (c) => c.reportedBy === actor.userId && !c.resolution,
              )
            )
              fail(
                "CONCERN_ALREADY_OPEN",
                "You already have an open concern for this match.",
                409,
              );
            if (a.concerns.length >= 100)
              fail(
                "CONCERN_LIMIT",
                "This match has reached its review-entry limit. Ask a superadmin to review the existing history.",
                409,
              );
            const concern: GameProtest = {
              id: randomUUID(),
              reason: reason(op.reason),
              reportedFor: null,
              reportedBy: actor.userId,
              reportedAt: new Date().toISOString(),
              gameRevision: game.revision,
              resolution: null,
            };
            await tx`insert into scrabble.crokinole_concerns(family_id,game_id,id,concern) values(${familyId}::uuid,${op.gameId},${concern.id}::uuid,${json(tx, concern)})`;
            response = {
              game,
              access: { ...a, concerns: [...a.concerns, concern] },
            };
          } else if (op.type === "resolve-concern") {
            permit(who, "resolveConcerns");
            if (!["dismissed", "upheld"].includes(op.outcome))
              fail("INVALID_OUTCOME", "Invalid resolution.");
            const c = a.concerns.find((c) => c.id === op.concernId);
            if (!c || c.resolution)
              return fail(
                "CONCERN_RESOLVED",
                "The concern is no longer open.",
                409,
              );
            c.resolution = {
              outcome: op.outcome,
              reason: reason(op.reason),
              resolvedBy: actor.userId,
              resolvedAt: new Date().toISOString(),
            };
            await tx`update scrabble.crokinole_concerns set concern=${json(tx, c)} where family_id=${familyId}::uuid and id=${c.id}::uuid`;
            response = { game, access: a };
          } else fail("INVALID_OPERATION", "Unknown Crokinole action.");
          await audit(
            tx,
            actor,
            familyId,
            op.type,
            op.gameId,
            { revision: game.revision, scorerUserId: row.scorer_user_id },
            { operation: op },
          );
        }
      }
      await tx`insert into scrabble.requests(family_id,actor_id,request_id,fingerprint,response) values(${familyId}::uuid,${actor.userId}::uuid,${requestId},${fingerprint},${json(tx, response)})`;
      return response;
    });
  }
  async function exportHistory(actor: VerifiedActor, familyId: string) {
    return transaction(actor, familyId, false, async (tx, who) => {
      permit(who, "exportHistory");
      const [size] =
        await tx`select count(*)::integer games,coalesce(sum(jsonb_array_length(state->'events')),0)::integer events from scrabble.crokinole_games where family_id=${familyId}::uuid ${who.role === "superadmin" ? tx`` : tx`and mode='confirmed' and not removed`}`;
      if (size.games > 10000 || size.events > 100000)
        fail(
          "EXPORT_TOO_LARGE",
          "This family archive needs an operator database export.",
          413,
        );
      const games =
        await tx`select definition,state,revision,scorer_user_id,generation,mode,removed,created_at,updated_at from scrabble.crokinole_games where family_id=${familyId}::uuid ${who.role === "superadmin" ? tx`` : tx`and mode='confirmed' and not removed`} order by created_at,game_id`;
      const concerns =
        await tx`select game_id,concern from scrabble.crokinole_concerns where family_id=${familyId}::uuid order by game_id,id`;
      return {
        version: 1,
        gameType: "crokinole",
        palette: await palette(tx, familyId),
        games,
        concerns,
      };
    });
  }
  return { readState, mutate, exportHistory };
}
