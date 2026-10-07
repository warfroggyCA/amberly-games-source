import { createHash } from "node:crypto";
import type { SharedState } from "../src/lib/shared-contract";
import type { RefreshVersions, SharedRefresh } from "../src/lib/shared-refresh";
/** Synthetic protocol fixture; production versions are computed inside PostgreSQL. */
export function refreshFixture(
  state: SharedState,
  known: RefreshVersions = {},
  scope = "",
): SharedRefresh {
  const { players, games, gameAccess, ...catalog } = state;
  const all: Record<string, unknown> = { catalog };
  players.forEach((p) => {
    all["p:" + p.id] = p;
  });
  games.forEach((g) => {
    all["g:" + g.id] = { game: g, access: gameAccess[g.id] };
  });
  const versions = Object.fromEntries(
    Object.entries(all).map(([key, value]) => [
      key,
      createHash("md5").update(JSON.stringify(value)).digest("hex"),
    ]),
  );
  return {
    kind: "family-refresh-v1",
    userId: state.member.userId,
    familyId: state.family.id,
    scope,
    versions,
    values: Object.fromEntries(
      Object.entries(all).filter(([key]) => known[key] !== versions[key]),
    ),
    playerIds: players.map((p) => p.id),
    gameIds: games.map((g) => g.id),
    nextCursor: state.nextCursor,
  };
}
