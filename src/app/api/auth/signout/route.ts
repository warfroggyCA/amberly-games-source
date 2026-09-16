import { requireAuthContext, type AuthContext } from "../../../../server/auth";
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
    requireObject(await readMutationJson(request));
    context = requireAuthContext(request);
    const { error } = await context.run(() =>
      context!.client.auth.signOut({ scope: "local" }),
    );
    if (error)
      throw new HttpError(503, "Sign-out did not finish. Please retry.");
    return context.json({ signedOut: true });
  } catch (error) {
    return errorJson(error, context);
  }
}
