import { createAuthContext, type AuthContext } from "../../../../server/auth";
import { getGameSummaryRepository } from "../../../../server/database";
import { configuredFamilyId } from "../../../../server/family-config";
import { repositoryFailure, HttpError } from "../../../../server/shared-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let context: AuthContext | null = null;
  try {
    context = createAuthContext(request);
    if (!context) throw new HttpError(503, "Family sign-in is not configured.");
    const user = await context.requireUser();
    if (request.headers.get("x-scrabble-user") !== user.id)
      throw new HttpError(
        401,
        "Your signed-in account changed. Reload before continuing.",
      );
    const params = new URL(request.url).searchParams;
    if (params.get("export") === "1")
      return context.json(
        await getGameSummaryRepository().exportHistory(
          { userId: user.id, email: user.email, emailVerified: true },
          configuredFamilyId(),
        ),
      );
    const query = {
      cursor: params.get("cursor") ?? undefined,
      gameType: params.get("gameType") ?? undefined,
      playerId: params.get("playerId") ?? undefined,
    };
    if ((query.cursor?.length ?? 0) > 600)
      throw new HttpError(400, "Invalid history page.");
    return context.json(
      await getGameSummaryRepository().read(
        { userId: user.id, email: user.email, emailVerified: true },
        configuredFamilyId(),
        query,
      ),
    );
  } catch (error) {
    return repositoryFailure(error, context);
  }
}
