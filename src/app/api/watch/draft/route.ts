import { reportFailure } from "../../../../server/diagnostics";
import { getSharedRepository } from "../../../../server/database";
import { SharedRepositoryError } from "../../../../server/shared-repository";
import { privateJson } from "../../../../server/shared-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token)
    return privateJson({ error: "This viewing link is incomplete." }, 401);
  try {
    return privateJson(await getSharedRepository().readWatchDraft(token));
  } catch (error) {
    const unavailable =
      error instanceof SharedRepositoryError && error.status < 500;
    if (!unavailable) reportFailure("watch-draft", error);
    return privateJson(
      {
        error: unavailable
          ? "This viewing link has expired or was closed."
          : "The live entry is reconnecting.",
      },
      unavailable ? 404 : 503,
    );
  }
}
