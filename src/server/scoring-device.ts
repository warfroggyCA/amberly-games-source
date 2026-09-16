import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import type { AuthContext } from "./auth";
import { getAppOrigin } from "./shared-http";
const COOKIE = "scrabble-scoring-device";
/** A displayable device ID is not a credential. This server-only cookie binds its browser. */
export function bindScoringDevice(
  request: Request,
  context: AuthContext,
): { context: AuthContext; deviceHash: string } {
  const existing = new NextRequest(request.url, {
    headers: request.headers,
  }).cookies.get(COOKIE)?.value;
  const token =
    existing && /^[A-Za-z0-9_-]{43}$/.test(existing)
      ? existing
      : randomBytes(32).toString("base64url");
  return {
    deviceHash: createHash("sha256").update(token).digest("hex"),
    context: {
      ...context,
      json(data, status) {
        const response = context.json(data, status);
        if (token !== existing)
          response.cookies.set(COOKIE, token, {
            httpOnly: true,
            secure: getAppOrigin().startsWith("https:"),
            sameSite: "strict",
            path: "/api/family",
            maxAge: 365 * 24 * 60 * 60,
          });
        return response;
      },
    },
  };
}
