import { notFound } from "next/navigation";
import { GymLab } from "../../components/GymLab";
export const dynamic = "force-dynamic";
export default async function GymLabPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  if (process.env.AMBERLY_GYM_LAB_ENABLED !== "true") notFound();
  const { from } = await searchParams;
  return (
    <GymLab
      gamesHref={from === "family" ? "/family" : "/gym-lab/games"}
      profileHistory={
        from === "family" && process.env.AMBERLY_GYM_HISTORY_ENABLED === "true"
      }
    />
  );
}
