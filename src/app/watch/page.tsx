import { linkPreviewMetadata } from "../../lib/link-preview";
import { WatchGame } from "../../components/WatchGame";
export const metadata = linkPreviewMetadata(
  "Watch the game live · Amberly Games",
  "Follow the board, watch each word land, and see the scores unfold. Open this private viewing link — no sign-in needed.",
);

export default function WatchPage() {
  return <WatchGame />;
}
