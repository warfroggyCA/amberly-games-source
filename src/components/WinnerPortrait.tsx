import { PlayerPortrait } from "./PlayerPortrait";

export function WinnerPortrait({
  name,
  photoDataUrl,
}: {
  name: string;
  photoDataUrl?: string;
}) {
  return <PlayerPortrait name={name} photoDataUrl={photoDataUrl} crowned />;
}
