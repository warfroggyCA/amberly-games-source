import type { SharedState } from "./shared-contract";

export const REFRESH_HEADER = "x-scrabble-refresh";
export const REFRESH_HEADER_LIMIT = 6000;
export type RefreshVersions = Record<string, string>;
export type RefreshCatalog = Omit<
  SharedState,
  "players" | "games" | "gameAccess"
>;
export type SharedRefresh = {
  kind: "family-refresh-v1";
  userId: string;
  familyId: string;
  scope: string;
  versions: RefreshVersions;
  values: Record<string, unknown>;
  playerIds: string[];
  gameIds: string[];
  nextCursor: string | null;
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const resource = (key: string) =>
  key === "catalog" || /^[pg]:[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(key);
export function parseRefreshVersions(raw: string): RefreshVersions {
  if (raw.length > REFRESH_HEADER_LIMIT)
    throw new Error("Invalid refresh versions");
  const value: unknown = JSON.parse(raw);
  if (
    !object(value) ||
    Object.entries(value).some(
      ([key, v]) =>
        !resource(key) || typeof v !== "string" || !/^[a-f0-9]{32}$/.test(v),
    )
  )
    throw new Error("Invalid refresh versions");
  return value as RefreshVersions;
}
/** Bound header size even for unusually large families. Omitted resources are fetched. */
export function refreshHeader(versions: RefreshVersions): string {
  const selected: RefreshVersions = {};
  for (const [key, value] of Object.entries(versions)) {
    selected[key] = value;
    if (JSON.stringify(selected).length > REFRESH_HEADER_LIMIT)
      delete selected[key];
  }
  return JSON.stringify(selected);
}
export type RefreshCache = {
  versions: RefreshVersions;
  values: Record<string, unknown>;
};
/** Reconstruct a full snapshot before existing state validation/installation. Never persist this cache. */
export function materializeRefresh(
  input: unknown,
  prior: RefreshCache | undefined,
  userId: string,
  familyId: string | undefined,
  scope: string,
): { state: SharedState; cache: RefreshCache } {
  if (
    !object(input) ||
    input.kind !== "family-refresh-v1" ||
    input.userId !== userId ||
    typeof input.familyId !== "string" ||
    (familyId && input.familyId !== familyId) ||
    input.scope !== scope ||
    !(input.nextCursor === null || typeof input.nextCursor === "string") ||
    !object(input.versions) ||
    !object(input.values) ||
    !Array.isArray(input.playerIds) ||
    !Array.isArray(input.gameIds)
  )
    throw new Error("The refreshed family snapshot is invalid.");
  const ids = (items: unknown[], prefix: string) => {
    if (
      items.length > 500 ||
      new Set(items).size !== items.length ||
      items.some((id) => typeof id !== "string" || !resource(prefix + id))
    )
      throw new Error("The refreshed resource list is invalid.");
    return items as string[];
  };
  const players = ids(input.playerIds, "p:"),
    games = ids(input.gameIds, "g:");
  const keys = [
    "catalog",
    ...players.map((id) => "p:" + id),
    ...games.map((id) => "g:" + id),
  ];
  if (
    Object.keys(input.versions).length !== keys.length ||
    Object.keys(input.values).some((key) => !keys.includes(key))
  )
    throw new Error("Unexpected refreshed resources.");
  const versions: RefreshVersions = {},
    values: Record<string, unknown> = {};
  for (const key of keys) {
    const version = input.versions[key];
    if (typeof version !== "string" || !/^[a-f0-9]{32}$/.test(version))
      throw new Error("Invalid resource version.");
    versions[key] = version;
    if (Object.hasOwn(input.values, key)) values[key] = input.values[key];
    else if (
      prior?.versions[key] === version &&
      Object.hasOwn(prior.values, key)
    )
      values[key] = prior.values[key];
    else throw new Error("The refreshed snapshot needs a complete reload.");
  }
  if (!object(values.catalog)) throw new Error("Invalid family catalog.");
  const entries = games.map((id) => {
    const value = values["g:" + id];
    if (
      !object(value) ||
      !object(value.game) ||
      value.game.id !== id ||
      !object(value.access)
    )
      throw new Error("Invalid refreshed game.");
    return { id, game: value.game, access: value.access };
  });
  for (const id of players)
    if (
      !object(values["p:" + id]) ||
      (values["p:" + id] as Record<string, unknown>).id !== id
    )
      throw new Error("Invalid refreshed player.");
  return {
    state: {
      ...values.catalog,
      nextCursor: input.nextCursor,
      players: players.map((id) => values["p:" + id]),
      games: entries.map((e) => e.game),
      gameAccess: Object.fromEntries(entries.map((e) => [e.id, e.access])),
    } as SharedState,
    cache: { versions, values },
  };
}
