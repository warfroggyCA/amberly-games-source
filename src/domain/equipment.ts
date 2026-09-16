import { isTileSupply, LETTER_COUNTS, type TileSupply } from "./board";

export type TileSet = {
  id: string;
  name: string;
  counts: TileSupply;
  checkedAt: string | null;
};
export type TileSetSnapshot = TileSet & { revision: number };
export type Equipment = {
  revision: number;
  sets: TileSet[];
  defaultSetId: string | null;
};
export const EMPTY_EQUIPMENT: Equipment = Object.freeze({
  revision: 0,
  sets: Object.freeze([]) as unknown as TileSet[],
  defaultSetId: null,
});
export const tileTotal = (counts: TileSupply) =>
  Object.values(counts).reduce((sum, n) => sum + n, 0);
export const standardSupply = (counts: TileSupply) =>
  Object.entries(LETTER_COUNTS).every(
    ([letter, count]) => counts[letter as keyof TileSupply] === count,
  );
function plain(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Reflect.ownKeys(value).every(
      (key) =>
        typeof key === "string" &&
        !!Object.getOwnPropertyDescriptor(value, key)?.enumerable &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"),
    )
  );
}
const safeId = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-zA-Z0-9-]{1,120}$/.test(v) &&
  !["constructor", "prototype", "__proto__"].includes(v);
const revision = (v: unknown) =>
  Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) < 2147483647;
const only = (v: Record<string, unknown>, fields: string[]) =>
  Object.keys(v).length === fields.length &&
  Object.keys(v).every((k) => fields.includes(k));
export function isTileSet(value: unknown): value is TileSet {
  return (
    plain(value) &&
    only(value, ["id", "name", "counts", "checkedAt"]) &&
    safeId(value.id) &&
    typeof value.name === "string" &&
    value.name === value.name.trim() &&
    value.name.length > 0 &&
    value.name.length <= 60 &&
    !/[\u0000-\u001f\u007f]/.test(value.name) &&
    isTileSupply(value.counts) &&
    (value.checkedAt === null ||
      (typeof value.checkedAt === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.checkedAt) &&
        Number.isFinite(Date.parse(value.checkedAt)) &&
        new Date(value.checkedAt).toISOString() === value.checkedAt))
  );
}
export function isTileSetSnapshot(value: unknown): value is TileSetSnapshot {
  if (!plain(value) || !revision(value.revision)) return false;
  const { revision: _revision, ...set } = value;
  void _revision;
  return isTileSet(set);
}
export function isEquipment(value: unknown): value is Equipment {
  if (
    !plain(value) ||
    !only(value, ["revision", "sets", "defaultSetId"]) ||
    !revision(value.revision) ||
    !Array.isArray(value.sets) ||
    Object.getPrototypeOf(value.sets) !== Array.prototype ||
    value.sets.length > 20 ||
    Reflect.ownKeys(value.sets).length !== value.sets.length + 1
  )
    return false;
  if (
    !Array.from({ length: value.sets.length }, (_, i) =>
      Object.getOwnPropertyDescriptor(value.sets, i),
    ).every((p) => !!p && Object.hasOwn(p, "value") && isTileSet(p.value))
  )
    return false;
  const sets = value.sets as TileSet[];
  return (
    new Set(sets.map((s) => s.id)).size === sets.length &&
    new Set(sets.map((s) => s.name.toLowerCase())).size === sets.length &&
    (value.defaultSetId === null ||
      sets.some((s) => s.id === value.defaultSetId))
  );
}
export function validateEquipmentChange(
  previous: Equipment,
  next: Equipment,
): void {
  if (!isEquipment(next))
    throw new Error(
      "Use unique set names and whole-number quantities for A–Z and blanks, totaling 1–200 tiles.",
    );
  if (next.revision !== previous.revision + 1)
    throw new Error(
      "Tile sets changed elsewhere. Refresh shared history and review the current quantities before saving again.",
    );
  if (previous.sets.some((set) => !next.sets.some((n) => n.id === set.id)))
    throw new Error(
      "Saved tile sets cannot be removed. Select another default instead.",
    );
}
export function snapshotTileSet(
  equipment: Equipment,
  setId: string | null,
): TileSetSnapshot | undefined {
  if (setId === null) return undefined;
  const set = equipment.sets.find((s) => s.id === setId);
  if (!set) throw new Error("Choose an available tile set in Settings.");
  return structuredClone({ ...set, revision: equipment.revision });
}
