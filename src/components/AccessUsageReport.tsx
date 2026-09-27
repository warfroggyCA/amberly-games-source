"use client";
import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { familyRequest, FamilyRequestError } from "../lib/shared-store";
import {
  USAGE_AREAS,
  USAGE_LABELS,
  usageActionLabel,
  isUsageReport,
  type UsageReport,
  type UsagePerson,
  type UsageRow,
} from "../lib/access-usage";
import "./access-usage.css";
const dateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const duration = (ms: number) =>
  ms < 60000
    ? `${Math.floor(ms / 1000)} sec`
    : `${Math.floor(ms / 60000)} min ${Math.floor(ms / 1000) % 60} sec`;
const time = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
function consecutiveActivity(rows: UsageRow[]) {
  const groups: UsageRow[][] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last?.[0].actorId === row.actorId) last.push(row);
    else groups.push([row]);
  }
  return groups;
}
function ActivityEntry({ row: r }: { row: UsageRow }) {
  return (
    <li className="usage-entry">
      <div>
        <strong>{r.name || r.email || r.actorId}</strong>
        {r.name && <small>{r.email}</small>}
        <time dateTime={r.at}>{time(r.at)}</time>
      </div>
      <div>
        <strong>{usageActionLabel(r.action)}</strong>
        <span>
          {USAGE_LABELS[r.area]} ·{" "}
          {r.kind === "saved"
            ? "Saved action"
            : r.kind === "view"
              ? "Screen view"
              : "Visit in this area"}
        </span>
        {r.kind === "visit" ? (
          <span>
            Last observed {time(r.lastAt)} · {duration(r.activeMs ?? 0)} active
          </span>
        ) : (
          r.kind === "saved" && (
            <small className="usage-reference">Reference: {r.subject}</small>
          )
        )}
      </div>
    </li>
  );
}
function initialDates() {
  const to = new Date(),
    from = new Date(to);
  from.setDate(from.getDate() - 6);
  return { from: dateInput(from), to: dateInput(to) };
}
export function AccessUsageReport({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const [dates, setDates] = useState(initialDates);
  const [actor, setActor] = useState(""),
    [area, setArea] = useState(""),
    [kind, setKind] = useState("");
  const [request, setRequest] = useState<{
    query: string;
    cursor?: string;
    version: number;
  } | null>(() => {
    const from = new Date(dates.from + "T00:00:00"),
      to = new Date(dates.to + "T00:00:00");
    to.setDate(to.getDate() + 1);
    return {
      query: new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      }).toString(),
      version: 0,
    };
  });
  const [report, setReport] = useState<UsageReport | null>(null);
  const [people, setPeople] = useState<UsagePerson[]>([]);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [exporting, setExporting] = useState(false);
  const [denied, setDenied] = useState(false);
  const exportAbort = useRef<AbortController | null>(null);
  const exportLock = useRef(false);
  function query() {
    const from = new Date(dates.from + "T00:00:00"),
      end = new Date(dates.to + "T00:00:00");
    end.setDate(end.getDate() + 1);
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= from ||
      end.getTime() - from.getTime() > 31 * 86400000
    )
      throw new Error("Choose a date range of up to 30 days.");
    const p = new URLSearchParams({
      from: from.toISOString(),
      to: end.toISOString(),
    });
    if (actor) p.set("actor", actor);
    if (area) p.set("area", area);
    if (kind) p.set("kind", kind);
    return p.toString();
  }
  function apply() {
    try {
      const q = query();
      setError("");
      setReport(null);
      setLoading(true);
      setRequest({ query: q, version: Date.now() });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => () => exportAbort.current?.abort(), []);
  useEffect(() => {
    if (!request || denied) return;
    const controller = new AbortController();
    const p = new URLSearchParams(request.query);
    if (request.cursor) p.set("cursor", request.cursor);
    void familyRequest<UsageReport>("/api/family/usage?" + p, undefined, {
      expectedUserId: userId,
      signal: controller.signal,
    })
      .then((data) => {
        if (!isUsageReport(data))
          throw new Error("The report response was incomplete. Please retry.");
        if (!controller.signal.aborted) {
          setPeople(data.people);
          setReport((previous) => ({
            ...data,
            rows:
              request.cursor && previous
                ? [...previous.rows, ...data.rows]
                : data.rows,
          }));
        }
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (e instanceof FamilyRequestError && [401, 403].includes(e.status)) {
          setDenied(true);
          setReport(null);
        }
        setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [request, userId, denied]);
  async function download() {
    if (!request || exportLock.current || denied) return;
    exportLock.current = true;
    setExporting(true);
    setError("");
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      const response = await fetch(
        "/api/family/usage?" + request.query + "&format=csv",
        {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: { "X-Scrabble-User": userId },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(30000),
          ]),
        },
      );
      if (!response.ok) {
        if ([401, 403].includes(response.status)) {
          setReport(null);
          setDenied(true);
        }
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error ?? "The export could not be downloaded. Please retry.",
        );
      }
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = "amberly-access-usage.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Export unavailable.");
    } finally {
      exportLock.current = false;
      if (!controller.signal.aborted) setExporting(false);
    }
  }
  return (
    <Modal
      title="Access & Usage"
      wide
      className="usage-report"
      onClose={onClose}
    >
      <p>Signed-in family activity · Superadmins only</p>
      {!denied && (
        <form
          className="usage-filters"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <label>
            From
            <input
              type="date"
              required
              value={dates.from}
              onChange={(e) => setDates({ ...dates, from: e.target.value })}
            />
          </label>
          <label>
            Through
            <input
              type="date"
              required
              value={dates.to}
              onChange={(e) => setDates({ ...dates, to: e.target.value })}
            />
          </label>
          <label>
            Account
            <select
              aria-label="Account"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
            >
              <option value="">All accounts</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.email}
                  {p.active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Area
            <select
              aria-label="Area"
              value={area}
              onChange={(e) => setArea(e.target.value)}
            >
              <option value="">All areas</option>
              {USAGE_AREAS.map((a) => (
                <option key={a} value={a}>
                  {USAGE_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Activity
            <select
              aria-label="Activity"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="">All activity</option>
              <option value="visit">Visits</option>
              <option value="view">Screen views</option>
              <option value="saved">Saved actions</option>
            </select>
          </label>
          <button className="button primary" disabled={loading || exporting}>
            Apply filters
          </button>
        </form>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {!denied && error && !loading && (
        <button
          className="button light"
          onClick={() => {
            setLoading(true);
            setError("");
            setRequest((r) => (r ? { ...r, version: Date.now() } : r));
          }}
        >
          Retry report
        </button>
      )}
      {loading && <p role="status">Loading activity…</p>}
      {report && !denied && (
        <>
          <dl className="usage-summary">
            <div>
              <dt>Accounts active</dt>
              <dd>{report.summary.users}</dd>
            </div>
            <div>
              <dt>Visits</dt>
              <dd>{report.summary.visits}</dd>
            </div>
            <div>
              <dt>Estimated active time</dt>
              <dd>{duration(report.summary.activeMs)}</dd>
            </div>
            <div>
              <dt>Saved actions</dt>
              <dd>{report.summary.savedActions}</dd>
            </div>
          </dl>
          <p className="usage-explanation">
            Showing {time(report.from)} through{" "}
            {time(new Date(Date.parse(report.to) - 1).toISOString())} ·{" "}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
          <details className="usage-explanation">
            <summary>How activity is measured</summary>
            <p className="usage-explanation">
              Active time is an estimate of visible app use with interaction in
              the last minute. Idle time and device sleep are excluded. Visits
              resume after less than 30 minutes away. Anonymous viewing links
              and offline activity are not included.
            </p>
            <p className="usage-explanation">
              Summary follows the date, account and area filters. Activity type
              filters the timeline only. Times shown in{" "}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}. Account names
              reflect current profiles; the account making a change may be
              scoring for someone else.
            </p>
            <p className="usage-explanation">
              {report.trackingSince
                ? `Visit tracking first observed ${time(report.trackingSince)}. Earlier saved actions may be available, but earlier visits and durations are unknown.`
                : "No visits recorded yet. Existing saved actions can still appear below."}{" "}
              Saved-action times are server receipt times; delayed Gym sync may
              arrive later than the original practice.
            </p>
          </details>
          <div className="usage-toolbar">
            <button
              className="button light"
              disabled={loading || exporting}
              onClick={() => void download()}
            >
              {exporting ? "Preparing CSV…" : "Export filtered CSV"}
            </button>
            <span>{report.rows.length} timeline entries loaded</span>
          </div>
          {report.rows.length === 0 ? (
            <p role="status">No activity matches these filters.</p>
          ) : (
            <ol className="usage-timeline">
              {consecutiveActivity(report.rows).map((rows) => {
                const first = rows[0];
                if (rows.length === 1)
                  return <ActivityEntry key={first.id} row={first} />;
                return (
                  <li className="usage-group" key={first.id}>
                    <details>
                      <summary>
                        <strong>
                          {first.name || first.email || first.actorId}
                        </strong>
                        <span> · {rows.length} entries</span>
                        {first.name && <small>{first.email}</small>}
                        <small>
                          {time(rows[rows.length - 1].at)} – {time(first.at)}
                        </small>
                      </summary>
                      <ol className="usage-timeline">
                        {rows.map((row) => (
                          <ActivityEntry key={row.id} row={row} />
                        ))}
                      </ol>
                    </details>
                  </li>
                );
              })}
            </ol>
          )}
          {report.nextCursor && (
            <button
              className="button light"
              disabled={loading || exporting}
              onClick={() => {
                setLoading(true);
                setError("");
                setRequest((r) =>
                  r
                    ? { ...r, cursor: report.nextCursor!, version: Date.now() }
                    : r,
                );
              }}
            >
              Load more activity
            </button>
          )}
        </>
      )}
    </Modal>
  );
}
