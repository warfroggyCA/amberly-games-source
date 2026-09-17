import "./player-avatar.css";

/** Shared visual identity; the adjacent player name supplies its accessible label. */
export function PlayerAvatar({
  name,
  photoDataUrl,
}: {
  name: string;
  photoDataUrl?: string;
}) {
  return photoDataUrl ? (
    // Profile photos are validated and resized before storage.
    // eslint-disable-next-line @next/next/no-img-element
    <img className="player-avatar-photo" src={photoDataUrl} alt="" />
  ) : (
    <>{Array.from(name)[0]?.toUpperCase()}</>
  );
}
