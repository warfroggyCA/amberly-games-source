import { describe, expect, it } from "vitest";
import { createGame, applyCommand } from "../src/domain/game";
import { testLexicon } from "../src/lib/test-lexicon";
import type { PreviewData } from "../src/lib/preview-store";
import type { SharedState } from "../src/lib/shared-contract";
import { describeSharedChange } from "../src/lib/shared-operation";
function fixture() {
  const result = createGame({
    id: "game",
    players: [
      { id: "ada", name: "Ada", seat: 0 },
      { id: "ben", name: "Ben", seat: 2 },
    ],
    firstPlayerId: "ada",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!result.ok) throw Error(result.error.message);
  const data: PreviewData = {
    version: 1,
    revision: 0,
    players: [
      { id: "ada", name: "Ada" },
      { id: "ben", name: "Ben" },
    ],
    games: [result.game],
    activeGameId: "game",
    drafts: {},
  };
  const shared: SharedState = {
    family: { id: "family", name: "Family" },
    member: {
      userId: "owner",
      email: "test@example.com",
      role: "superadmin",
      active: true,
      playerId: "ada",
    },
    members: [],
    invitations: [],
    players: data.players,
    playerAccess: { ada: { revision: 3, userId: "owner" } },
    games: data.games,
    gameAccess: {
      game: {
        scorerUserId: "owner",
        deviceId: "device",
        generation: 4,
        mode: "confirmed",
        recordsEligible: false,
        canScore: true,
        approvals: [],
        protests: [],
      },
    },
    verifiedWords: [],
    nextCursor: null,
  };
  return { data, shared };
}
describe("shared UI command translation", () => {
  it("sends play commands without accepting a client score snapshot", () => {
    const { data, shared } = fixture();
    const result = applyCommand(
      data.games[0],
      {
        id: "turn",
        expectedRevision: 0,
        type: "play",
        placements: [
          { row: 7, col: 7, tile: { letter: "C", blank: false } },
          { row: 7, col: 8, tile: { letter: "A", blank: false } },
          { row: 7, col: 9, tile: { letter: "T", blank: false } },
        ],
      },
      testLexicon,
    );
    if (!result.ok) throw Error(result.error.message);
    const op = describeSharedChange(
      data,
      { ...data, games: [result.game] },
      shared,
      "device",
    );
    expect(op).toMatchObject({
      type: "game-commands",
      gameId: "game",
      generation: 4,
      commands: [{ type: "play", id: "turn", expectedRevision: 0 }],
    });
    expect(JSON.stringify(op)).not.toContain('"score"');
    expect(JSON.stringify(op)).not.toContain('"board"');
  });
  it("profile edits carry the server revision, not ownership supplied by the browser", () => {
    const { data, shared } = fixture();
    expect(
      describeSharedChange(
        data,
        {
          ...data,
          players: [
            { id: "ada", name: "Ada", bio: "Word fan" },
            data.players[1],
          ],
        },
        shared,
        "device",
      ),
    ).toEqual({
      type: "update-player",
      id: "ada",
      expectedRevision: 3,
      profile: { name: "Ada", bio: "Word fan" },
    });
  });
  it("persists drafts locally without posting incomplete turns", () => {
    const { data, shared } = fixture();
    expect(
      describeSharedChange(
        data,
        {
          ...data,
          drafts: {
            game: {
              revision: 0,
              row: 7,
              col: 7,
              placements: [],
              direction: "down",
            },
          },
        },
        shared,
        "device",
      ),
    ).toBeNull();
  });
  it("rejects removal or rewriting of game history", () => {
    const { data, shared } = fixture();
    expect(() =>
      describeSharedChange(data, { ...data, games: [] }, shared, "device"),
    ).toThrow(/cannot be deleted/);
    expect(() =>
      describeSharedChange(
        data,
        {
          ...data,
          games: [{ ...data.games[0], scores: { ada: 999, ben: 0 } }],
        },
        shared,
        "device",
      ),
    ).toThrow(/commands/);
  });
  it("new games send player IDs and an explicit consent mode rather than fabricated names or eligibility", () => {
    const { data, shared } = fixture();
    const op = describeSharedChange(
      { ...data, games: [] },
      data,
      shared,
      "device",
      "practice",
    );
    expect(op).toEqual({
      type: "create-game",
      id: "game",
      deviceId: "device",
      mode: "practice",
      players: [
        { id: "ada", seat: 0 },
        { id: "ben", seat: 2 },
      ],
      firstPlayerId: "ada",
      direction: "clockwise",
    });
  });
});
