import {
  getSignInMethod,
  googleSignInRedirect,
  requireAuthContext,
  type AuthContext,
} from "../../../../server/auth";
import { errorJson, HttpError } from "../../../../server/shared-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  let context: AuthContext | null = null;
  try {
    if (getSignInMethod() !== "google") return googleSignInRedirect("failed");
    const params = new URL(request.url).searchParams;
    if (params.has("error")) {
      return googleSignInRedirect(
        params.get("error") === "access_denied" ? "cancelled" : "failed",
      );
    }
    const code = params.get("code");
    if (
      !code ||
      code.length > 2048 ||
      /[\s\u0000-\u001f\u007f]/.test(code) ||
      params.getAll("code").length !== 1
    ) {
      return googleSignInRedirect("failed");
    }
    context = requireAuthContext(request);
    // The provider exchanges this one-use code only with the matching verifier
    // held in this browser's HTTP-only cookie. Existing sessions cannot stand in
    // for a missing, expired, or mismatched code.
    const { data, error } = await context.run(() =>
      context!.client.auth.exchangeCodeForSession(code),
    );
    if (error || !data.session) {
      return context.googleRedirect(
        error && (!error.status || error.status >= 500)
          ? "unavailable"
          : "failed",
      );
    }
    await context.requireUser();
    // Verified identity is not membership. /family checks invitations and active
    // membership separately; this callback never assigns profiles or roles.
    return context.googleRedirect();
  } catch (error) {
    try {
      return (context?.googleRedirect ?? googleSignInRedirect)(
        error instanceof HttpError && error.status === 401
          ? "failed"
          : "unavailable",
      );
    } catch {
      // With no valid configured origin there is no safe redirect destination.
      return errorJson(error, context);
    }
  }
}
