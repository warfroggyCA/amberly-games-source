import { reportFailure } from "../../../server/diagnostics";
import { getSharedRepository } from "../../../server/database";
import { SharedRepositoryError } from "../../../server/shared-repository";
import { privateJson } from "../../../server/shared-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token)
    return privateJson(
      {
        error:
          "This viewing link is incomplete. Ask the scorer for a new link.",
      },
      401,
    );
  try {
    const version = request.headers.get("x-scrabble-watch-version");
    if (version !== null) {
      if (version !== "" && !/^[a-f0-9]{32}$/.test(version))
        return privateJson({ error: "Invalid scoreboard version." }, 400);
      return privateJson(
        await getSharedRepository().readWatchRefresh(token, version),
      );
    }
    return privateJson({ game: await getSharedRepository().readWatch(token) });
  } catch (error) {
    const unavailable =
      error instanceof SharedRepositoryError && error.status < 500;
    if (!unavailable) reportFailure("watch", error);
    return privateJson(
      {
        error: unavailable
          ? "This viewing link has expired or was closed. Ask the scorer for a new link."
          : "The live scoreboard is temporarily unavailable. Reconnecting…",
      },
      unavailable ? 404 : 503,
    );
  }
}
