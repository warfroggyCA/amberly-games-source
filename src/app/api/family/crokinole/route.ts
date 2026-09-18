import { createAuthContext, type AuthContext } from "../../../../server/auth";
import { getCrokinoleRepository } from "../../../../server/database";
import { configuredFamilyId } from "../../../../server/family-config";
import { SharedRepositoryError } from "../../../../server/shared-repository";
import {
  errorJson,
  HttpError,
  privateJson,
  readMutationJson,
} from "../../../../server/shared-http";
import type { CrokinoleMutation } from "../../../../lib/crokinole-contract";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, write: boolean) {
  let context: AuthContext | null = null;
  try {
    const input = write ? await readMutationJson(request, 80_000) : null;
    context = createAuthContext(request);
    if (!context) throw new HttpError(503, "Family sign-in is not configured.");
    const user = await context.requireUser();
    if (
      request.headers.has("x-scrabble-user") &&
      request.headers.get("x-scrabble-user") !== user.id
    )
      throw new HttpError(
        401,
        "Your signed-in account changed. Reload before continuing.",
      );
    const actor = {
      userId: user.id,
      email: user.email,
      emailVerified: true as const,
    };
    const repo = getCrokinoleRepository();
    const familyId = configuredFamilyId();
    if (write)
      return context.json(
        await repo.mutate(actor, familyId, input as CrokinoleMutation),
      );
    const params = new URL(request.url).searchParams;
    const gameId = params.get("gameId") ?? undefined;
    const cursor = params.get("cursor") ?? undefined;
    if ((gameId?.length ?? 0) > 120 || (cursor?.length ?? 0) > 600)
      throw new HttpError(400, "Invalid game reference.");
    return context.json(
      await repo.readState(actor, familyId, { gameId, cursor }),
    );
  } catch (error) {
    if (error instanceof SharedRepositoryError)
      return (context?.json ?? privateJson)(
        { error: error.message, code: error.code },
        error.status,
      );
    return errorJson(error, context);
  }
}
export async function GET(request: Request) {
  return handle(request, false);
}
export async function POST(request: Request) {
  return handle(request, true);
}
