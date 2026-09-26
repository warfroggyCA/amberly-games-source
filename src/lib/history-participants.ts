import { playerDisplayName, type PlayerProfileFields } from "./player-profile";

export type HistoryParticipant = {
  id: string;
  name: string;
  playerIds?: readonly string[];
};
export type HistoryProfile = PlayerProfileFields & { id: string };

/** Saved names/results remain untouched. Current profiles supply presentation
 * only, including archived profiles retained for historical games. */
export function historyParticipants(
  participants: readonly HistoryParticipant[],
  winnerIds: readonly string[],
  profiles: readonly HistoryProfile[],
) {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const winners = new Set(winnerIds);
  return participants.map((participant) => {
    const ids = participant.playerIds?.length
      ? participant.playerIds
      : [participant.id];
    const members = ids.map((id) => {
      const profile = byId.get(id);
      return {
        id,
        name: profile
          ? playerDisplayName(profile)
          : ids.length === 1
            ? participant.name
            : "?",
        ...(profile?.photoDataUrl
          ? { photoDataUrl: profile.photoDataUrl }
          : {}),
      };
    });
    return {
      id: participant.id,
      name: ids.every((id) => byId.has(id))
        ? members.map((member) => member.name).join(" & ")
        : participant.name,
      members,
      winner: winners.has(participant.id),
      tied: winners.has(participant.id) && winners.size > 1,
    };
  });
}

/** Include the result as well as names when a history row has an explicit label. */
export function historyLabel(
  participants: readonly HistoryParticipant[],
  winnerIds: readonly string[],
  profiles: readonly HistoryProfile[],
  totals?: Readonly<Record<string, number>>,
  separator = " vs ",
): string {
  const sides = historyParticipants(participants, winnerIds, profiles);
  const winners = sides.filter((side) => side.winner);
  const scores = totals
    ? sides
        .filter((side) => Number.isFinite(totals[side.id]))
        .map((side) => `${side.name}: ${totals[side.id]} points`)
        .join("; ")
    : "";
  return [
    sides.map((side) => side.name).join(separator),
    winners.length
      ? `${winners.length > 1 ? "Tied winners" : "Winner"}: ${winners.map((side) => side.name).join(" & ")}`
      : "",
    scores,
  ]
    .filter(Boolean)
    .join(". ");
}
