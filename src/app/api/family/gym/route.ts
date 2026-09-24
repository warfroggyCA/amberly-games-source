import { createAuthContext, type AuthContext } from "../../../../server/auth";
import { getGymRepository } from "../../../../server/database";
import { configuredFamilyId } from "../../../../server/family-config";
import {
  repositoryFailure,
  HttpError,
  readMutationJson,
} from "../../../../server/shared-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, write: boolean) {
  let context: AuthContext | null = null;
  try {
    const input = write ? await readMutationJson(request, 128 * 1024) : null;
    context = createAuthContext(request);
    if (!context) throw new HttpError(503, "Family sign-in is not configured.");
    const user = await context.requireUser();
    if (request.headers.get("x-scrabble-user") !== user.id)
      throw new HttpError(
        401,
        "Your signed-in account changed. Reload before continuing.",
      );
    const actor = {
      userId: user.id,
      email: user.email,
      emailVerified: true as const,
    };
    const repo = getGymRepository(),
      familyId = configuredFamilyId();
    const params = new URL(request.url).searchParams;
    const sessionId = params.get("sessionId") ?? undefined,
      cursor = params.get("cursor") ?? undefined;
    if ((cursor?.length ?? 0) > 600 || (sessionId?.length ?? 0) > 36)
      throw new HttpError(400, "Invalid practice reference.");
    return context.json(
      write
        ? await repo.append(actor, familyId, input)
        : await repo.read(actor, familyId, { sessionId, cursor }),
    );
  } catch (error) {
    return repositoryFailure(error, context);
  }
}
export async function GET(request: Request) {
  return handle(request, false);
}
export async function POST(request: Request) {
  return handle(request, true);
}
