import {
  getSignInMethod,
  normalizeEmail,
  requireAuthContext,
  type AuthContext,
} from "../../../../server/auth";
import {
  errorJson,
  HttpError,
  readMutationJson,
  requireObject,
} from "../../../../server/shared-http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let context: AuthContext | null = null;
  try {
    const body = requireObject(await readMutationJson(request));
    if (getSignInMethod() === "google") {
      throw new HttpError(409, "Use Google to sign in to Amberly Games.");
    }
    const email = normalizeEmail(body.email);
    context = requireAuthContext(request);
    const { error } = await context.run(() =>
      context!.client.auth.signInWithOtp({
        email,
        // Authentication never grants membership. Database policies check the
        // independently maintained family invitation and membership records.
        options: { shouldCreateUser: true },
      }),
    );
    if (error?.status === 429) {
      throw new HttpError(429, "Please wait before requesting another code.");
    }
    if (error && (!error.status || error.status >= 500)) {
      throw new HttpError(503, "Sign-in email is unavailable. Please retry.");
    }
    // Keep the response identical for existing, new, and ineligible addresses.
    return context.json({
      message: "If this address can sign in, a code will arrive shortly.",
    });
  } catch (error) {
    return errorJson(error, context);
  }
}
