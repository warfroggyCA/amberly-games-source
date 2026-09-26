import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { createSharedRepository } from "../src/server/shared-repository";
import { createCrokinoleRepository } from "../src/server/crokinole-repository";
import { testLexicon } from "../src/lib/test-lexicon";
import {
  DEFAULT_PIECE_COLOURS,
  type CrokinoleDefinition,
} from "../src/domain/crokinole";
import { DEFAULT_CROKINOLE_SETTINGS } from "../src/domain/crokinole-defaults";
import type { MemberPermissions } from "../src/lib/member-permissions";

export function crokinolePermissionDatabaseCases(
  owner: postgres.Sql,
  runtime: postgres.Sql,
) {
  describe("Crokinole capability recovery", () => {
    async function recoveryFixture() {
      const familyId = randomUUID();
      const admin = {
        userId: randomUUID(),
        email: "recovery-admin@example.test",
        emailVerified: true as const,
      };
      const guest = {
        userId: randomUUID(),
        email: "recovery-member@example.test",
        emailVerified: true as const,
      };
      await owner`insert into scrabble.families(id,name) values(${familyId}::uuid,'Disposable recovery test')`;
      await owner`insert into scrabble.memberships(family_id,user_id,email,role) values(${familyId}::uuid,${admin.userId}::uuid,${admin.email},'superadmin'),(${familyId}::uuid,${guest.userId}::uuid,${guest.email},'member')`;
      await owner`insert into scrabble.players(family_id,id,name) values(${familyId}::uuid,'ada','Ada'),(${familyId}::uuid,'ben','Ben')`;
      const shared = createSharedRepository(runtime, {
        defaultLexicon: testLexicon,
        resolveLexicon: () => testLexicon,
      });
      const crokinole = createCrokinoleRepository(runtime, { enabled: true });
      const permissions = async (permissions: MemberPermissions) => {
        const who = (await shared.readState(admin, familyId)).members.find(
          (m) => m.userId === guest.userId,
        )!;
        await shared.mutate(admin, familyId, {
          requestId: randomUUID(),
          operation: {
            type: "update-member",
            userId: guest.userId,
            role: "member",
            active: true,
            playerId: who.playerId,
            expectedRevision: who.revision!,
            reason: "Disposable Gauntlet capability change",
            permissions,
          },
        });
      };
      const definition: CrokinoleDefinition = {
        schemaVersion: 1,
        rulesVersion: 1,
        id: randomUUID(),
        familyId,
        mode: "confirmed",
        createdAt: new Date().toISOString(),
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
        endCondition: { type: "fixed_rounds", rounds: 4 },
        initialStartingPlayerId: "ada",
      };
      return {
        familyId,
        admin,
        guest,
        shared,
        crokinole,
        permissions,
        definition,
      };
    }

    it("removing only scoreGames denies a new draft while ordinary family reads remain authorized", async () => {
      const f = await recoveryFixture();
      await f.crokinole.mutate(f.guest, f.familyId, {
        requestId: randomUUID(),
        operation: {
          type: "create-game",
          definition: f.definition,
          paletteRevision: 0,
        },
      });
      await f.permissions({ scoreGames: false });
      const mutation = {
        requestId: randomUUID(),
        operation: {
          type: "save-draft" as const,
          gameId: f.definition.id,
          generation: 1,
          expectedRevision: 0,
          expectedDraftRevision: 0,
          values: { ada: "65", ben: "0" },
          editingRoundId: null,
        },
      };
      await expect(
        f.crokinole.mutate(f.guest, f.familyId, mutation),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
      const current = await f.crokinole.readState(f.guest, f.familyId, {
        gameId: f.definition.id,
      });
      const member = (await f.shared.readState(f.guest, f.familyId)).member;
      expect(member.active).toBe(true);
      expect(current.games).toHaveLength(1);
      expect(current.access[f.definition.id].canScore).toBe(false);
      expect(current.games[0].revision).toBe(0);
      const drafts =
        await owner`select * from scrabble.crokinole_drafts where family_id=${f.familyId}::uuid`;
      expect(drafts).toHaveLength(0);
    });

    it.each(["save-defaults", "save-palette"] as const)(
      "committed %s replay remains confirmable after equipment permission changes without granting new writes",
      async (type) => {
        const f = await recoveryFixture();
        const mutation = {
          requestId: randomUUID(),
          operation:
            type === "save-defaults"
              ? {
                  type,
                  expectedRevision: 0,
                  defaults: DEFAULT_CROKINOLE_SETTINGS,
                }
              : { type, expectedRevision: 0, colours: DEFAULT_PIECE_COLOURS },
        };
        const accepted = await f.crokinole.mutate(
          f.guest,
          f.familyId,
          mutation,
        );
        expect(accepted.palette!.revision).toBe(1);
        await f.permissions({ manageEquipment: false });
        const replay = await f.crokinole.mutate(f.guest, f.familyId, mutation);
        expect(replay).toMatchObject({
          replayed: true,
          palette: { revision: 1 },
        });
        await expect(
          f.crokinole.mutate(f.guest, f.familyId, {
            ...mutation,
            requestId: randomUUID(),
          }),
        ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
        const current = await f.crokinole.readState(f.guest, f.familyId, {});
        const saved =
          await owner`select revision,defaults from scrabble.crokinole_palette where family_id=${f.familyId}::uuid`;
        expect(current.palette.revision).toBe(1);
        expect(current.palette.defaults).toEqual(DEFAULT_CROKINOLE_SETTINGS);
        // Creating a colours-only palette leaves defaults unset in storage;
        // the normal read path supplies the existing family defaults.
        expect(saved[0].defaults).toEqual(
          type === "save-defaults" ? DEFAULT_CROKINOLE_SETTINGS : null,
        );
        const requests =
          await owner`select count(*)::int as count from scrabble.requests where family_id=${f.familyId}::uuid and actor_id=${f.guest.userId}::uuid`;
        expect(requests[0].count).toBe(1);
        const member = (
          await f.shared.readState(f.admin, f.familyId)
        ).members.find((m) => m.userId === f.guest.userId)!;
        await f.shared.mutate(f.admin, f.familyId, {
          requestId: randomUUID(),
          operation: {
            type: "update-member",
            userId: f.guest.userId,
            role: "member",
            active: false,
            playerId: member.playerId,
            reason: "Revoke disposable member",
            expectedRevision: member.revision!,
            permissions: member.permissions,
          },
        });
        await expect(
          f.crokinole.mutate(f.guest, f.familyId, mutation),
        ).rejects.toMatchObject({ code: "NOT_A_MEMBER", status: 403 });
      },
    );
  });
}
