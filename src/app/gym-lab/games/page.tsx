import { notFound } from "next/navigation";
import { LocalGameChooser } from "../../../components/LocalGameChooser";
export const dynamic = "force-dynamic";
export default function LocalGamesPage() {
  if (process.env.AMBERLY_GYM_LAB_ENABLED !== "true") notFound();
  return <LocalGameChooser />;
}
