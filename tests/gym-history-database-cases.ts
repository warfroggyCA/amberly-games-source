import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { describe, it, expect, beforeAll } from "vitest";
import {
  createGymRepository,
  gymFingerprint,
} from "../src/server/gym-repository";
import { generatePuzzle } from "../src/domain/gym/generator";
import { makeBudget, type Puzzle } from "../src/domain/gym/model";
import { defaultLexicon } from "../src/lib/lexicons";
import type {
  GymWrite,
  GymHistory,
  GymSessionDetail,
  GymEventPayload,
} from "../src/lib/gym-history-contract";
export function gymHistoryDatabaseCases(
  owner: postgres.Sql,
  runtime: postgres.Sql,
) {
  describe("private Gym history", () => {
    let puzzle: Puzzle, move: GymEventPayload;
    beforeAll(() => {
      const result = generatePuzzle(
        "gym-history-db-v1",
        defaultLexicon,
        makeBudget(),
      );
      puzzle = result.puzzle;
      move = {
        type: "attempt",
        action: { type: "play", placements: result.answer.best[0].placements },
      };
    }, 20000);
    async function fixture() {
      const familyId = randomUUID(),
        actor = {
          userId: randomUUID(),
          email: "gym@example.test",
          emailVerified: true as const,
        },
        other = {
          userId: randomUUID(),
          email: "other@example.test",
          emailVerified: true as const,
        };
      await owner`insert into scrabble.families(id,name) values(${familyId}::uuid,'Gym test')`;
      await owner`insert into scrabble.players(family_id,id,name) values(${familyId}::uuid,'one','One'),(${familyId}::uuid,'two','Two')`;
      await owner`insert into scrabble.memberships(family_id,user_id,email,role,player_id) values(${familyId}::uuid,${actor.userId}::uuid,${actor.email},'member','one'),(${familyId}::uuid,${other.userId}::uuid,${other.email},'superadmin','two')`;
      const repo = createGymRepository(runtime, { enabled: true });
      const sessionId = randomUUID();
      const write = (sequence: number, payload: GymEventPayload): GymWrite => ({
        sessionId,
        playerId: "one",
        puzzle,
        event: {
          id: randomUUID(),
          sequence,
          occurredAt: new Date().toISOString(),
          payload,
        },
      });
      return { familyId, actor, other, repo, write, sessionId };
    }
    it("reports zero progress without treating an empty denominator as failure", async () => {
      const f = await fixture();
      const history = (await f.repo.read(f.actor, f.familyId)) as GymHistory;
      expect(history.progress).toEqual({
        version: "verified-first-moves-v1",
        sessions: 0,
        attempts: 0,
        retries: 0,
        firstAttempts: 0,
        validFirstAttempts: 0,
        assistedFirstAttempts: 0,
        eligibleFirstAttempts: 0,
        eligibleValidFirstAttempts: 0,
        repeatedSessions: 0,
        resumedSessions: 0,
        score: {
          evaluator: "complete-score-v1",
          ratedFirstMoves: 0,
          maximumFirstMoves: 0,
          averagePercentage: null,
        },
      });
    });
    it("uses one versioned rating of the first move and excludes retries and legacy ratings", async () => {
      const f = await fixture();
      const first = f.write(1, move);
      await f.repo.append(f.actor, f.familyId, first);
      const detail = (await f.repo.read(f.actor, f.familyId, {
        sessionId: f.sessionId,
      })) as GymSessionDetail;
      const points = detail.events[0].verifiedPoints!;
      const score: GymEventPayload = {
        type: "score",
        attemptId: first.event.id,
        points,
        rank: 1,
        percentage: 100,
      };
      await f.repo.append(f.actor, f.familyId, f.write(2, score));
      expect(
        ((await f.repo.read(f.actor, f.familyId)) as GymHistory).progress?.score
          .ratedFirstMoves,
      ).toBe(0);
      await f.repo.append(
        f.actor,
        f.familyId,
        f.write(3, { ...score, evaluator: "complete-score-v1" }),
      );
      await f.repo.append(
        f.actor,
        f.familyId,
        f.write(4, {
          ...score,
          evaluator: "complete-score-v1",
          rank: 2,
          percentage: 50,
        }),
      );
      const retry = f.write(5, move);
      await f.repo.append(f.actor, f.familyId, retry);
      await f.repo.append(
        f.actor,
        f.familyId,
        f.write(6, {
          ...score,
          evaluator: "complete-score-v1",
          attemptId: retry.event.id,
        }),
      );
      expect(
        ((await f.repo.read(f.actor, f.familyId)) as GymHistory).progress
          ?.score,
      ).toEqual({
        evaluator: "complete-score-v1",
        ratedFirstMoves: 1,
        maximumFirstMoves: 1,
        averagePercentage: 100,
      });
    });
    it("keeps an invalid first move in the denominator even after a valid retry", async () => {
      const f = await fixture();
      const invalid = f.write(1, {
        type: "attempt",
        action: {
          type: "play",
          placements: [{ row: 0, col: 0, tile: { letter: "Q", blank: false } }],
        },
      });
      await f.repo.append(f.actor, f.familyId, invalid);
      await f.repo.append(f.actor, f.familyId, f.write(2, move));
      const progress = ((await f.repo.read(f.actor, f.familyId)) as GymHistory)
        .progress;
      expect(progress).toMatchObject({
        sessions: 1,
        attempts: 2,
        retries: 1,
        firstAttempts: 1,
        validFirstAttempts: 0,
        eligibleFirstAttempts: 1,
        eligibleValidFirstAttempts: 0,
      });
      expect(
        ((await f.repo.read(f.other, f.familyId)) as GymHistory).progress
          ?.sessions,
      ).toBe(0);
    });
    it("excludes both copies of a repeated position regardless of upload timestamps", async () => {
      const f = await fixture();
      await f.repo.append(f.actor, f.familyId, f.write(1, move));
      expect(
        ((await f.repo.read(f.actor, f.familyId)) as GymHistory).progress
          ?.eligibleValidFirstAttempts,
      ).toBe(1);
      const repeat = f.write(1, move);
      repeat.sessionId = randomUUID();
      repeat.event.occurredAt = "2026-01-01T00:00:00.000Z";
      await f.repo.append(f.actor, f.familyId, repeat);
      expect(
        ((await f.repo.read(f.actor, f.familyId)) as GymHistory).progress,
      ).toMatchObject({
        sessions: 2,
        firstAttempts: 2,
        validFirstAttempts: 2,
        repeatedSessions: 2,
        eligibleFirstAttempts: 0,
        eligibleValidFirstAttempts: 0,
      });
    });
    it.each(["resume", "all-moves"] as const)(
      "marks %s practice as assisted even without an earlier synced session",
      async (type) => {
        const f = await fixture();
        await f.repo.append(f.actor, f.familyId, f.write(1, { type }));
        await f.repo.append(f.actor, f.familyId, f.write(2, move));
        const detail = (await f.repo.read(f.actor, f.familyId, {
          sessionId: f.sessionId,
        })) as GymSessionDetail;
        expect(detail.events[1].assisted).toBe(true);
        expect(detail.events[0].payload.type).toBe(type);
        expect(
          ((await f.repo.read(f.actor, f.familyId)) as GymHistory).progress,
        ).toMatchObject({
          assistedFirstAttempts: 1,
          eligibleFirstAttempts: 0,
          resumedSessions: type === "resume" ? 1 : 0,
        });
      },
    );
    it("preserves attempt word snapshots and rejects unconfirmed additions", async () => {
      const f = await fixture();
      const lookup = f.write(1, { type: "word-lookup" });
      await f.repo.append(f.actor, f.familyId, lookup);
      const attempt = f.write(2, move);
      attempt.event.referenceWords = ["ZZTEST"];
      await expect(f.repo.append(f.actor, f.familyId, attempt)).rejects.toThrow(
        "unconfirmed",
      );
      const evidence = {
        word: "ZZTEST",
        source: "merriam-webster",
        sourceUrl: "https://scrabble.merriam.com/finder/zztest",
        verifiedAt: "2026-09-25T00:00:00.000Z",
      };
      await owner`insert into scrabble.verified_words(family_id,word,evidence,verified_by) values(${f.familyId}::uuid,'ZZTEST',${owner.json(evidence)},${f.actor.userId}::uuid)`;
      await f.repo.append(f.actor, f.familyId, attempt);
      const detail = (await f.repo.read(f.actor, f.familyId, {
        sessionId: f.sessionId,
      })) as GymSessionDetail;
      expect(detail.events[0].referenceWords).toBeUndefined();
      expect(detail.events[1]).toMatchObject({
        referenceWords: ["ZZTEST"],
        valid: true,
        assisted: true,
      });
      const assessment = f.write(3, {
        type: "score",
        attemptId: attempt.event.id,
        points: detail.events[1].verifiedPoints!,
        rank: 1,
        percentage: 100,
      });
      await expect(
        f.repo.append(f.actor, f.familyId, assessment),
      ).rejects.toThrow("word list changed");
    });
    it("retrieves the same profile history through independent clients, deduplicates a lost receipt and preserves first attempts", async () => {
      const f = await fixture(),
        hint = f.write(1, { type: "hint", level: 1 });
      await Promise.all([
        f.repo.append(f.actor, f.familyId, hint),
        f.repo.append(f.actor, f.familyId, hint),
      ]);
      await f.repo.append(f.actor, f.familyId, f.write(2, move));
      await f.repo.append(f.actor, f.familyId, f.write(3, move));
      const second = createGymRepository(runtime, { enabled: true });
      const history = (await second.read(f.actor, f.familyId)) as GymHistory;
      expect(history.sessions).toHaveLength(1);
      expect(history.sessions[0]).toMatchObject({
        attempts: 2,
        assisted: true,
      });
      const detail = (await second.read(f.actor, f.familyId, {
        sessionId: f.sessionId,
      })) as GymSessionDetail;
      expect(history.progress).toMatchObject({
        sessions: 1,
        attempts: 2,
        retries: 1,
        assistedFirstAttempts: 1,
        eligibleFirstAttempts: 0,
      });
      expect(detail.events).toHaveLength(3);
      expect(detail.events[1]).toMatchObject({
        valid: true,
        assisted: true,
        firstAttempt: true,
      });
      expect(detail.events[2].firstAttempt).toBe(false);
      const changed = structuredClone(hint);
      changed.event.payload = { type: "solve" };
      await expect(
        f.repo.append(f.actor, f.familyId, changed),
      ).rejects.toMatchObject({ code: "EVENT_CONFLICT" });
    });
    it("denies even admins another profile, rejects out-of-order events and pauses revoked/relinked owners", async () => {
      const f = await fixture();
      await expect(
        f.repo.append(f.actor, f.familyId, f.write(2, move)),
      ).rejects.toMatchObject({ code: "SEQUENCE_CONFLICT" });
      await f.repo.append(f.actor, f.familyId, f.write(1, move));
      await expect(
        f.repo.read(f.other, f.familyId, { sessionId: f.sessionId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        f.repo.append(f.other, f.familyId, f.write(2, move)),
      ).rejects.toMatchObject({ code: "PROFILE_CHANGED" });
      await owner`update scrabble.memberships set active=false where family_id=${f.familyId}::uuid and user_id=${f.actor.userId}::uuid`;
      await expect(f.repo.read(f.actor, f.familyId)).rejects.toMatchObject({
        code: "NO_PROFILE",
      });
    });
    it("keeps replay exposure across sessions, validates snapshots/scores and prevents assessment forgery", async () => {
      const f = await fixture(),
        attempt = f.write(1, move);
      await f.repo.append(f.actor, f.familyId, attempt);
      const replay = { ...f.write(1, move), sessionId: randomUUID() };
      await f.repo.append(f.actor, f.familyId, replay);
      const history = (await f.repo.read(f.actor, f.familyId)) as GymHistory;
      expect(history.sessions.filter((s) => s.replay)).toHaveLength(1);
      const bad = f.write(2, {
        type: "score",
        attemptId: attempt.event.id,
        points: 2999,
        rank: 1,
        percentage: 100,
      });
      await expect(
        f.repo.append(f.actor, f.familyId, bad),
      ).rejects.toMatchObject({ code: "INVALID_SCORE" });
      const tampered = structuredClone(f.write(2, move));
      tampered.puzzle.position.scores[0]++;
      await expect(
        f.repo.append(f.actor, f.familyId, tampered),
      ).rejects.toMatchObject({ code: "INVALID_PUZZLE" });
      expect(gymFingerprint(puzzle)).toBe(
        gymFingerprint({
          ...puzzle,
          seed: "different",
          position: {
            ...puzzle.position,
            rack: [...puzzle.position.rack].reverse(),
          },
        }),
      );
    });
    it("paginates without duplicate rows and blocks relinked accounts and foreign families", async () => {
      const f = await fixture();
      for (let n = 0; n < 22; n++)
        await f.repo.append(f.actor, f.familyId, {
          ...f.write(1, { type: "solve" }),
          sessionId: randomUUID(),
        });
      const first = (await f.repo.read(f.actor, f.familyId)) as GymHistory;
      expect(first.sessions).toHaveLength(20);
      expect(first.nextCursor).toBeTruthy();
      const second = (await f.repo.read(f.actor, f.familyId, {
        cursor: first.nextCursor!,
      })) as GymHistory;
      expect(second.sessions).toHaveLength(2);
      expect(first.progress?.sessions).toBe(22);
      expect(second.progress).toEqual(first.progress);
      expect(
        new Set([...first.sessions, ...second.sessions].map((s) => s.id)).size,
      ).toBe(22);
      await expect(f.repo.read(f.actor, randomUUID())).rejects.toMatchObject({
        code: "NO_PROFILE",
      });
      await owner`update scrabble.memberships set player_id=null where family_id=${f.familyId}::uuid and user_id=${f.other.userId}::uuid`;
      await owner`update scrabble.memberships set player_id='two' where family_id=${f.familyId}::uuid and user_id=${f.actor.userId}::uuid`;
      await expect(
        f.repo.append(f.actor, f.familyId, f.write(1, move)),
      ).rejects.toMatchObject({ code: "PROFILE_CHANGED" });
      expect(
        ((await f.repo.read(f.actor, f.familyId)) as GymHistory).sessions,
      ).toHaveLength(0);
    });
    it("runtime cannot update/delete journals or directly read another owner", async () => {
      const f = await fixture();
      await f.repo.append(f.actor, f.familyId, f.write(1, move));
      await runtime.begin(async (tx) => {
        await tx`set local role scrabble_runtime`;
        await tx`select set_config('scrabble.actor_id',${f.other.userId},true),set_config('scrabble.family_id',${f.familyId},true)`;
        expect(
          await tx`select id from scrabble.gym_sessions where family_id=${f.familyId}::uuid and player_id='one'`,
        ).toHaveLength(0);
      });
      await expect(
        runtime.begin(async (tx) => {
          await tx`set local role scrabble_runtime`;
          await tx`delete from scrabble.gym_events`;
        }),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        createGymRepository(runtime, { enabled: false }).read(
          f.actor,
          f.familyId,
        ),
      ).rejects.toMatchObject({ code: "GYM_UNAVAILABLE" });
    });
  });
}
