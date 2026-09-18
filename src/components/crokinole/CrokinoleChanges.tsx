"use client";
import { useMemo, useState } from "react";
import type { CrokinoleGame, CrokinoleResult } from "../../domain/crokinole";
import { crokinoleChangeHistory } from "../../lib/crokinole-change-history";

export function CrokinoleChanges({
  match,
  actorNames,
}: {
  match: CrokinoleGame;
  actorNames?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(20);
  const changes = useMemo(
    () => (open ? crokinoleChangeHistory(match) : []),
    [match, open],
  );
  const count = match.events.filter(
    (event) => event.command.type !== "record_round",
  ).length;
  if (!count) return null;
  const resultLabel = (
    result: CrokinoleResult | null,
    status: CrokinoleGame["status"],
  ) => {
    if (!result)
      return status === "ended_early"
        ? "Ended early · no winner"
        : "In progress";
    const names = result.winnerIds.map(
      (id) => match.definition.participants.find((p) => p.id === id)!.name,
    );
    return `${names.join(" & ")} ${result.tied ? "tied" : "won"}`;
  };
  return (
    <details
      className="crokinole-changes"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Changes ({count})</summary>
      <p>
        Original entries and results are kept below. Latest change first. Scorer
        names use current linked profiles.
      </p>
      {open && (
        <>
          <ol className="crokinole-change-list">
            {changes
              .slice(-shown)
              .reverse()
              .map((change) => {
                const { event } = change;
                const title =
                  event.command.type === "correct_round"
                    ? `Round ${change.roundNumber} corrected`
                    : event.command.type === "undo_round"
                      ? `Round ${change.roundNumber} undone`
                      : "Game ended early";
                return (
                  <li key={event.sequence}>
                    <h3>{title}</h3>
                    <p className="crokinole-change-meta">
                      <time dateTime={event.createdAt}>
                        {new Date(event.createdAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>
                      {" · Recorded by "}
                      {actorNames?.[event.actorId] ?? "Family scorer"}
                    </p>
                    {"reason" in event.command && event.command.reason && (
                      <p>Reason: {event.command.reason}</p>
                    )}
                    <div className="crokinole-change-table">
                      <table>
                        <caption>Match totals · {title.toLowerCase()}</caption>
                        <thead>
                          <tr>
                            <th scope="col">Player / team</th>
                            <th scope="col">Before</th>
                            <th scope="col">After</th>
                          </tr>
                        </thead>
                        <tbody>
                          {match.definition.participants.map((participant) => (
                            <tr key={participant.id}>
                              <th scope="row">{participant.name}</th>
                              <td>{change.beforeTotals[participant.id]}</td>
                              <td>{change.afterTotals[participant.id]}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p>
                      Result before:{" "}
                      {resultLabel(change.beforeResult, change.beforeStatus)}
                      <br />
                      Result after:{" "}
                      {resultLabel(event.result, change.afterStatus)}
                    </p>
                    {change.beforeEntries && (
                      <details className="crokinole-change-originals">
                        <summary>Original round entries</summary>
                        <p>
                          {match.definition.scoringMode === "net_winner_only"
                            ? "Entered net points"
                            : "Entered raw points"}
                        </p>
                        <ul>
                          {match.definition.participants.map((participant) => (
                            <li key={participant.id}>
                              {participant.name}:{" "}
                              {
                                change.beforeEntries!.find(
                                  (e) => e.participantId === participant.id,
                                )!.rawScore
                              }
                              {change.afterEntries
                                ? ` → ${change.afterEntries.find((e) => e.participantId === participant.id)!.rawScore}`
                                : " (removed from totals)"}
                            </li>
                          ))}
                        </ul>
                        {change.excluded.map((round) => (
                          <p key={round.number}>
                            Round {round.number} excluded from the result:{" "}
                            {round.entries
                              .map(
                                (entry) =>
                                  `${match.definition.participants.find((p) => p.id === entry.participantId)!.name} ${entry.rawScore}`,
                              )
                              .join(" · ")}
                          </p>
                        ))}
                      </details>
                    )}
                    {change.excluded.length > 0 && (
                      <p>
                        Excluded later rounds:{" "}
                        {change.excluded
                          .map((round) => round.number)
                          .join(", ")}
                        . Original entries are retained above.
                      </p>
                    )}
                  </li>
                );
              })}
          </ol>
          {changes.length > shown && (
            <button
              className="button light"
              onClick={() => setShown((count) => count + 20)}
            >
              Show older changes
            </button>
          )}
        </>
      )}
    </details>
  );
}
