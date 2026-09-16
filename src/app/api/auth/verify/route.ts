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
    if (getSignInMethod() !== "email") {
      throw new HttpError(409, "Use Google to sign in to Amberly Games.");
    }
    const email = normalizeEmail(body.email);
    if (typeof body.token !== "string" || !/^\d{6,10}$/.test(body.token)) {
      throw new HttpError(400, "Enter the code from your sign-in email.");
    }
    context = requireAuthContext(request);
    const { data, error } = await context.run(() =>
      context!.client.auth.verifyOtp({
        email,
        token: body.token as string,
        type: "email",
      }),
    );
    if (error?.status === 429) {
      throw new HttpError(429, "Too many attempts. Wait before trying again.");
    }
    if (error && (!error.status || error.status >= 500)) {
      throw new HttpError(503, "Sign-in is unavailable. Please retry.");
    }
    if (error || !data.session) {
      throw new HttpError(
        401,
        "This code is invalid or expired. Request a new code.",
      );
    }
    const user = await context.requireUser();
    if (user.email.toLowerCase() !== email) {
      throw new HttpError(401, "Please request a new sign-in code.");
    }
    return context.json({ user });
  } catch (error) {
    return errorJson(error, context);
  }
}
