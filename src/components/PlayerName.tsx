import {
  playerDisplayName,
  type PlayerProfileFields,
} from "../lib/player-profile";
export function PlayerName({
  player,
  profile,
  useNickname = true,
}: {
  player: { name: string };
  profile?: PlayerProfileFields;
  useNickname?: boolean;
}) {
  const name =
    useNickname && profile ? playerDisplayName(profile) : player.name;
  const realName = profile?.name ?? player.name;
  return (
    <span
      title={realName}
      aria-label={name === realName ? realName : `${name} (${realName})`}
    >
      {name}
    </span>
  );
}
