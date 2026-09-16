import {
  createAuthContext,
  getSignInMethod,
  type AuthContext,
} from "../../../../server/auth";
import {
  errorJson,
  HttpError,
  privateJson,
} from "../../../../server/shared-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  let context: AuthContext | null = null;
  try {
    context = createAuthContext(request);
    if (!context) return privateJson({ configured: false, user: null });
    const signInMethod = getSignInMethod();
    try {
      const user = await context.requireUser();
      return context.json({ configured: true, signInMethod, user });
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        return context.json({ configured: true, signInMethod, user: null });
      }
      throw error;
    }
  } catch (error) {
    return errorJson(error, context);
  }
}
