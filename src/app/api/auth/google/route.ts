import {
  getSignInMethod,
  requireAuthContext,
  type AuthContext,
} from "../../../../server/auth";
import {
  errorJson,
  getAppOrigin,
  HttpError,
  readMutationJson,
  requireObject,
} from "../../../../server/shared-http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let context: AuthContext | null = null;
  try {
    requireObject(await readMutationJson(request));
    if (getSignInMethod() === "email") {
      throw new HttpError(409, "Google sign-in is not enabled here.");
    }
    context = requireAuthContext(request);
    const callback = new URL("/api/auth/callback", getAppOrigin()).href;
    const { data, error } = await context.run(() =>
      context!.client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callback,
          skipBrowserRedirect: true,
          queryParams: { prompt: "select_account" },
        },
      }),
    );
    if (error || !data.url) {
      throw new HttpError(503, "Google sign-in is unavailable. Please retry.");
    }
    // Only the configured provider's authorization endpoint can leave this app.
    const target = new URL(data.url);
    if (
      target.origin !== new URL(process.env.SCRABBLE_SUPABASE_URL!).origin ||
      target.pathname !== "/auth/v1/authorize" ||
      target.username ||
      target.password ||
      target.hash ||
      target.searchParams.get("provider") !== "google" ||
      target.searchParams.get("redirect_to") !== callback
    ) {
      throw new HttpError(503, "Google sign-in is unavailable. Please retry.");
    }
    // This response carries the HTTP-only PKCE verifier cookie. No session or
    // provider access tokens are returned to browser JavaScript.
    return context.json({ url: target.href });
  } catch (error) {
    return errorJson(error, context);
  }
}
