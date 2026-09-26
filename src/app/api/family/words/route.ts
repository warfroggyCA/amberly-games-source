import { createAuthContext, type AuthContext } from "../../../../server/auth";
import { getSharedRepository } from "../../../../server/database";
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
    const input = write ? await readMutationJson(request, 2048) : undefined;
    context = createAuthContext(request);
    if (!context) throw new HttpError(503, "Family sign-in is not configured.");
    const user = await context.requireUser();
    if (request.headers.get("x-scrabble-user") !== user.id)
      throw new HttpError(
        401,
        "Your account changed. Reload before continuing.",
      );
    const actor = {
      userId: user.id,
      email: user.email,
      emailVerified: true as const,
    };
    const repo = getSharedRepository(),
      family = configuredFamilyId();
    const words = write
      ? await repo.confirmWords(actor, family, input)
      : await repo.readWords(actor, family);
    return context.json({ words });
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
