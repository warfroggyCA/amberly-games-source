import { reportFailure } from "../../../server/diagnostics";
import { bindScoringDevice } from "../../../server/scoring-device";
import { createAuthContext, type AuthContext } from "../../../server/auth";
import { getSharedRepository } from "../../../server/database";
import { SharedRepositoryError } from "../../../server/shared-repository";
import { configuredFamilyId } from "../../../server/family-config";
import {
  errorJson,
  HttpError,
  privateJson,
  readMutationJson,
} from "../../../server/shared-http";
import type {
  SharedMutation,
  VerifiedActor,
} from "../../../lib/shared-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(error: unknown, context: AuthContext | null) {
  if (error instanceof SharedRepositoryError && error.status >= 500)
    reportFailure("family", error);
  if (error instanceof SharedRepositoryError)
    return (context?.json ?? privateJson)(
      { error: error.message, code: error.code },
      error.status,
    );
  return errorJson(error, context);
}
export async function GET(request: Request) {
  let context: AuthContext | null = null;
  try {
    context = createAuthContext(request);
    if (!context)
      throw new HttpError(503, "Shared family sign-in is not configured yet.");
    const device = bindScoringDevice(request, context);
    context = device.context;
    const user = await context.requireUser();
    if (
      request.headers.has("x-scrabble-user") &&
      request.headers.get("x-scrabble-user") !== user.id
    )
      throw new HttpError(
        401,
        "Your signed-in account changed. Reload before continuing.",
      );
    const actor: VerifiedActor = {
      userId: user.id,
      email: user.email,
      emailVerified: true,
      deviceHash: device.deviceHash,
    };
    const familyId = configuredFamilyId();
    const repo = getSharedRepository();
    const params = new URL(request.url).searchParams;
    if (params.get("export") === "1")
      return context.json(await repo.exportHistory(actor, familyId));
    const cursor = params.get("cursor") ?? undefined;
    const gameId = params.get("gameId") ?? undefined;
    if ((cursor?.length ?? 0) > 600 || (gameId?.length ?? 0) > 120)
      throw new HttpError(400, "The history reference is invalid.");
    return context.json(
      await repo.readState(actor, familyId, { cursor, gameId }),
    );
  } catch (error) {
    return failure(error, context);
  }
}
export async function POST(request: Request) {
  let context: AuthContext | null = null;
  try {
    const input = await readMutationJson(request, 350_000);
    context = createAuthContext(request);
    if (!context)
      throw new HttpError(503, "Shared family sign-in is not configured yet.");
    const device = bindScoringDevice(request, context);
    context = device.context;
    const user = await context.requireUser();
    if (
      request.headers.has("x-scrabble-user") &&
      request.headers.get("x-scrabble-user") !== user.id
    )
      throw new HttpError(
        401,
        "Your signed-in account changed. Reload before continuing.",
      );
    return context.json(
      await getSharedRepository().mutate(
        {
          userId: user.id,
          email: user.email,
          emailVerified: true,
          deviceHash: device.deviceHash,
        },
        configuredFamilyId(),
        input as SharedMutation,
      ),
    );
  } catch (error) {
    return failure(error, context);
  }
}
