import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as startGoogle } from "../src/app/api/auth/google/route";
import { GET as googleCallback } from "../src/app/api/auth/callback/route";

const origin = "https://amberly.example";
const authOrigin = "https://pkce-test.supabase.co";
const user = {
  id: "838278da-6373-47e8-a966-41a4a326b21e",
  aud: "authenticated",
  role: "authenticated",
  email: "ada@example.com",
  email_confirmed_at: "2026-09-14T12:00:00Z",
  is_anonymous: false,
  app_metadata: { provider: "google", providers: ["google"] },
  user_metadata: {},
  created_at: "2026-09-14T12:00:00Z",
};

beforeEach(() => {
  vi.stubEnv("SCRABBLE_AUTH_METHOD", "google");
  vi.stubEnv("SCRABBLE_APP_ORIGIN", origin);
  vi.stubEnv("SCRABBLE_SUPABASE_URL", authOrigin);
  vi.stubEnv("SCRABBLE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Exercise the installed Supabase client and SSR cookie adapter, rather than
// mocking their methods. Only the Auth HTTP service is replaced.
it("binds the actual SDK's authorization challenge to the callback cookie and persists the verified session", async () => {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const accessToken =
    [
      { alg: "HS256", typ: "JWT" },
      {
        exp: expiry,
        sub: user.id,
        aud: "authenticated",
        role: "authenticated",
      },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
      .join(".") + ".synthetic-signature";
  let verifier: string | undefined;
  const fetchStub = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      if (url.origin !== authOrigin) throw new Error("Unexpected Auth origin");
      if (
        url.pathname === "/auth/v1/token" &&
        url.searchParams.get("grant_type") === "pkce"
      ) {
        const body = JSON.parse(init?.body as string);
        expect(body.auth_code).toBe("one-use-provider-code");
        verifier = body.code_verifier;
        return Response.json({
          access_token: accessToken,
          refresh_token: "synthetic-refresh",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: expiry,
          user,
        });
      }
      if (url.pathname === "/auth/v1/user") return Response.json(user);
      throw new Error("Unexpected Auth request");
    },
  );
  vi.stubGlobal("fetch", fetchStub);
  const started = await startGoogle(
    new Request(`${origin}/api/auth/google`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    }),
  );
  expect(started.status).toBe(200);
  expect(fetchStub).not.toHaveBeenCalled();
  const destination = new URL((await started.json()).url);
  expect(destination.searchParams.get("code_challenge_method")).toBe("s256");
  expect(destination.searchParams.get("redirect_to")).toBe(
    `${origin}/api/auth/callback`,
  );
  const cookies = started.headers.getSetCookie();
  expect(cookies.length).toBeGreaterThan(0);
  expect(
    cookies.every(
      (cookie) =>
        cookie.includes("HttpOnly") &&
        cookie.includes("Secure") &&
        cookie.includes("SameSite=lax"),
    ),
  ).toBe(true);
  const cookieHeader = cookies
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
  const callback = await googleCallback(
    new Request(`${origin}/api/auth/callback?code=one-use-provider-code`, {
      headers: { Cookie: cookieHeader },
    }),
  );
  expect(callback.headers.get("location")).toBe(`${origin}/family`);
  expect(verifier).toBeTruthy();
  expect(createHash("sha256").update(verifier!).digest("base64url")).toBe(
    destination.searchParams.get("code_challenge"),
  );
  expect(fetchStub).toHaveBeenCalledTimes(2);
  expect(
    callback.headers
      .getSetCookie()
      .some((cookie) => cookie.startsWith("sb-pkce-test-auth-token=")),
  ).toBe(true);
  expect(
    callback.headers
      .getSetCookie()
      .every(
        (cookie) => cookie.includes("HttpOnly") && cookie.includes("Secure"),
      ),
  ).toBe(true);
  expect(await callback.text()).not.toContain("synthetic-refresh");
});

it("rejects a callback in a browser without the PKCE verifier before any HTTP exchange", async () => {
  const fetchStub = vi.fn();
  vi.stubGlobal("fetch", fetchStub);
  const response = await googleCallback(
    new Request(`${origin}/api/auth/callback?code=someone-elses-code`),
  );
  expect(response.headers.get("location")).toBe(
    `${origin}/family?signin=failed`,
  );
  expect(fetchStub).not.toHaveBeenCalled();
});
