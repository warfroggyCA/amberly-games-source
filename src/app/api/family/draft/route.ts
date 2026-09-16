import { reportFailure } from "../../../../server/diagnostics";
import { createAuthContext, type AuthContext } from "../../../../server/auth";
import { getSharedRepository } from "../../../../server/database";
import { configuredFamilyId } from "../../../../server/family-config";
import { SharedRepositoryError } from "../../../../server/shared-repository";
import {
  HttpError,
  errorJson,
  privateJson,
  readMutationJson,
} from "../../../../server/shared-http";
import type { LiveDraftInput } from "../../../../lib/live-draft";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, write: boolean) {
  let context: AuthContext | null = null;
  try {
    const input = write ? await readMutationJson(request, 4096) : null;
    context = createAuthContext(request);
    if (!context) throw new HttpError(503, "Shared sign-in is unavailable.");
    const user = await context.requireUser();
    if (request.headers.get("x-scrabble-user") !== user.id)
      throw new HttpError(401, "Your account changed. Reload to continue.");
    const actor = {
      userId: user.id,
      email: user.email,
      emailVerified: true as const,
    };
    const repository = getSharedRepository();
    return context.json(
      write
        ? await repository.writeLiveDraft(
            actor,
            configuredFamilyId(),
            input as LiveDraftInput,
          )
        : {
            draft: await repository.readLiveDraft(
              actor,
              configuredFamilyId(),
              new URL(request.url).searchParams.get("gameId") ?? "",
            ),
          },
    );
  } catch (error) {
    if (error instanceof SharedRepositoryError && error.status >= 500)
      reportFailure("live-draft", error);
    if (error instanceof SharedRepositoryError)
      return (context?.json ?? privateJson)(
        { error: error.message, code: error.code },
        error.status,
      );
    return errorJson(error, context);
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
