import { createAuthContext, type AuthContext } from "../../../../server/auth";
import { getSharedRepository } from "../../../../server/database";
import { SharedRepositoryError } from "../../../../server/shared-repository";
import {
  errorJson,
  HttpError,
  readMutationJson,
  requireObject,
} from "../../../../server/shared-http";
import { configuredFamilyId } from "../../../../server/family-config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let context: AuthContext | null = null;
  try {
    const input = requireObject(await readMutationJson(request));
    if (
      typeof input.requestId !== "string" ||
      Object.keys(input).some((k) => k !== "requestId")
    )
      throw new HttpError(400, "The invitation acceptance is incomplete.");
    context = createAuthContext(request);
    if (!context)
      throw new HttpError(503, "Family sign-in is not configured yet.");
    const user = await context.requireUser();
    const result = await getSharedRepository().admit(
      { userId: user.id, email: user.email, emailVerified: true },
      configuredFamilyId(),
      input.requestId,
    );
    return context.json({ joined: true, result });
  } catch (error) {
    if (error instanceof SharedRepositoryError && context)
      return context.json(
        { error: error.message, code: error.code },
        error.status,
      );
    return errorJson(error, context);
  }
}
