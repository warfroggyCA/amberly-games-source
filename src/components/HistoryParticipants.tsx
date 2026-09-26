"use client";
import { useMemo } from "react";
import {
  historyParticipants,
  type HistoryParticipant,
  type HistoryProfile,
} from "../lib/history-participants";
import { PlayerPortrait } from "./PlayerPortrait";
import "./history-participants.css";

const NO_WINNERS: readonly string[] = [];

/** Noninteractive content: the containing history row owns navigation. */
export function HistoryParticipants({
  participants,
  winnerIds = NO_WINNERS,
  profiles,
  totals,
}: {
  participants: readonly HistoryParticipant[];
  winnerIds?: readonly string[];
  profiles: readonly HistoryProfile[];
  totals?: Readonly<Record<string, number>>;
}) {
  const sides = useMemo(
    () => historyParticipants(participants, winnerIds, profiles),
    [participants, winnerIds, profiles],
  );
  return (
    <span className="history-participants">
      {sides.map((side) => (
        <span
          className={`history-participant${side.winner ? " history-participant-winner" : ""}${side.members.length > 1 ? " history-participant-team" : ""}`}
          key={side.id}
        >
          <span className="history-participant-portraits">
            {side.members.map((member) => (
              <span className="history-portrait-slot" key={member.id}>
                <PlayerPortrait
                  name={member.name}
                  photoDataUrl={member.photoDataUrl}
                  crowned={side.winner}
                  lazy
                />
              </span>
            ))}
          </span>
          <span className="history-participant-copy">
            {side.winner && (
              <small className="history-participant-result">
                {side.tied ? "Tied winner" : "Winner"}
              </small>
            )}
            <strong className="history-participant-name">{side.name}</strong>
            {totals && Number.isFinite(totals[side.id]) && (
              <span className="history-participant-score">
                {totals[side.id]} points
              </span>
            )}
          </span>
        </span>
      ))}
    </span>
  );
}
