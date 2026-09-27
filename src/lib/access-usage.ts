export const USAGE_AREAS = [
  "games",
  "scrabble",
  "crokinole",
  "gym",
  "history",
  "players",
  "settings",
  "administration",
] as const;
export type UsageArea = (typeof USAGE_AREAS)[number];
export const USAGE_LABELS: Record<UsageArea, string> = {
  games: "Games",
  scrabble: "Scrabble",
  crokinole: "Crokinole",
  gym: "Gym",
  history: "History",
  players: "Players",
  settings: "Settings",
  administration: "Administration",
};
export type UsagePulse = { id: string; area: UsageArea; activeMs: number };
export type UsageKind = "visit" | "view" | "saved";
export type UsageRow = {
  id: string;
  at: string;
  lastAt: string;
  actorId: string;
  name: string;
  email: string;
  area: UsageArea;
  kind: UsageKind;
  action: string;
  subject: string;
  activeMs: number | null;
};
export type UsagePerson = {
  id: string;
  name: string;
  email: string;
  active: boolean;
};
export type UsageReport = {
  from: string;
  to: string;
  generatedAt: string;
  trackingSince: string | null;
  summary: {
    users: number;
    visits: number;
    activeMs: number;
    savedActions: number;
  };
  people: UsagePerson[];
  rows: UsageRow[];
  nextCursor: string | null;
};
export const usageUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v);
export function usageArea(path: string): UsageArea {
  if (path.startsWith("/gym-lab")) return "gym";
  return (
    USAGE_AREAS.find((a) => a !== "games" && path.startsWith(`/family/${a}`)) ??
    "games"
  );
}
export function isUsagePulse(v: unknown): v is UsagePulse {
  if (!v || typeof v !== "object") return false;
  const p = v as UsagePulse;
  return (
    usageUuid(p.id) &&
    USAGE_AREAS.includes(p.area) &&
    Number.isInteger(p.activeMs) &&
    p.activeMs >= 0 &&
    p.activeMs <= 15000
  );
}
// Conservative sampling: do not count hidden time, idle time, or delayed timers
// after device sleep. This measures recent app interaction, not physical play.
export function activeSample(
  previous: number,
  now: number,
  lastInput: number,
  visible: boolean,
): number {
  const elapsed = now - previous;
  if (!visible || elapsed < 0 || elapsed > 10000) return 0;
  return Math.max(0, Math.min(elapsed, lastInput + 60000 - previous));
}
export function usageActionLabel(action: string): string {
  const labels: Record<string, string> = {
    visit: "Visit",
    view: "Viewed screen",
    "game.created": "Created game",
    "scrabble:play": "Entered Scrabble move",
    "scrabble:pass": "Passed turn",
    "scrabble:exchange": "Exchanged tiles",
    "gym:hint": "Used Gym hint",
    "gym:attempt": "Checked Gym move",
    "gym:solve": "Revealed Gym solution",
  };
  return (
    labels[action] ??
    action.replace(/[:._-]+/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}
export function usageCsv(rows: UsageRow[]): string {
  // Neutralize spreadsheet formula injection, including leading whitespace/control chars.
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    [
      [
        "Recorded at (UTC)",
        "Last observed (UTC)",
        "Account ID",
        "Player name (current)",
        "Email (current)",
        "Area",
        "Type",
        "Action",
        "Reference",
        "Estimated active seconds",
      ],
      ...rows.map((r) => [
        r.at,
        r.lastAt,
        r.actorId,
        r.name,
        r.email,
        USAGE_LABELS[r.area],
        r.kind,
        usageActionLabel(r.action),
        r.subject,
        r.activeMs === null ? "" : r.activeMs / 1000,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n") + "\r\n"
  );
}

/** Reject incomplete responses before they can break the report or retain stale data. */
export function isUsageReport(value: unknown): value is UsageReport {
  if (!value || typeof value !== "object") return false;
  const r = value as UsageReport;
  const date = (v: unknown) =>
    typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v));
  const text = (v: unknown, max: number) =>
    typeof v === "string" && v.length <= max;
  const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  return (
    date(r.from) &&
    date(r.to) &&
    date(r.generatedAt) &&
    (r.trackingSince === null || date(r.trackingSince)) &&
    !!r.summary &&
    count(r.summary.users) &&
    count(r.summary.visits) &&
    count(r.summary.activeMs) &&
    count(r.summary.savedActions) &&
    (r.nextCursor === null || text(r.nextCursor, 1000)) &&
    Array.isArray(r.people) &&
    r.people.every(
      (p) =>
        p &&
        usageUuid(p.id) &&
        text(p.name, 60) &&
        text(p.email, 254) &&
        typeof p.active === "boolean",
    ) &&
    Array.isArray(r.rows) &&
    r.rows.length <= 10000 &&
    r.rows.every(
      (row) =>
        row &&
        text(row.id, 400) &&
        date(row.at) &&
        date(row.lastAt) &&
        usageUuid(row.actorId) &&
        text(row.name, 60) &&
        text(row.email, 254) &&
        USAGE_AREAS.includes(row.area) &&
        ["visit", "view", "saved"].includes(row.kind) &&
        text(row.action, 200) &&
        text(row.subject, 500) &&
        (row.activeMs === null || count(row.activeMs)),
    )
  );
}
