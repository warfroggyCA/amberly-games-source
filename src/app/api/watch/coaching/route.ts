import { getSharedRepository } from "../../../../server/database";
import { SharedRepositoryError } from "../../../../server/shared-repository";
import { privateJson } from "../../../../server/shared-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  const turnId = new URL(request.url).searchParams.get("turnId");
  if (!token)
    return privateJson({ error: "A valid viewing link is required." }, 401);
  if (!turnId || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(turnId))
    return privateJson({ error: "Choose a registered turn." }, 400);
  try {
    return privateJson({
      position: await getSharedRepository().readWatchCoaching(token, turnId),
    });
  } catch (error) {
    const denied = error instanceof SharedRepositoryError && error.status < 500;
    return privateJson(
      {
        error: denied
          ? "This turn review is unavailable. The link or game may have changed."
          : "Turn review is temporarily unavailable.",
      },
      denied ? 404 : 503,
    );
  }
}
