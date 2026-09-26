import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CookieMethodsServer } from "@supabase/ssr";

const provider = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithOtp: vi.fn(),
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: provider.create }));

import { createAuthContext, normalizeEmail } from "../src/server/auth";
import {
  errorJson,
  getAppOrigin,
  HttpError,
  readMutationJson,
} from "../src/server/shared-http";
import { GET as session } from "../src/app/api/auth/session/route";
import { POST as sendCode } from "../src/app/api/auth/code/route";
import { POST as verifyCode } from "../src/app/api/auth/verify/route";
import { POST as signOut } from "../src/app/api/auth/signout/route";
import { POST as startGoogle } from "../src/app/api/auth/google/route";
import { GET as googleCallback } from "../src/app/api/auth/callback/route";

const origin = "https://scrabble.example";
const user = {
  id: "838278da-6373-47e8-a966-41a4a326b21e",
  email: "ada@example.com",
  email_confirmed_at: "2026-09-14T12:00:00Z",
  is_anonymous: false,
};

function mutation(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${origin}/api/auth/code`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
function cookieMethods(index = 0): CookieMethodsServer {
  return provider.create.mock.calls[index][2].cookies;
}
function assertPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("expires")).toBe("0");
  expect(response.headers.get("vary")).toBe("Cookie");
}

beforeEach(() => {
  vi.stubEnv("SCRABBLE_AUTH_METHOD", "");
  vi.stubEnv("SCRABBLE_APP_ORIGIN", origin);
  vi.stubEnv("SCRABBLE_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SCRABBLE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.clearAllMocks();
  provider.create.mockImplementation(() => ({
    auth: {
      getUser: provider.getUser,
      signInWithOtp: provider.signInWithOtp,
      signInWithOAuth: provider.signInWithOAuth,
      exchangeCodeForSession: provider.exchangeCodeForSession,
      verifyOtp: provider.verifyOtp,
      signOut: provider.signOut,
    },
  }));
  provider.getUser.mockResolvedValue({ data: { user }, error: null });
  provider.signInWithOtp.mockResolvedValue({ error: null });
  provider.verifyOtp.mockResolvedValue({ data: { session: {} }, error: null });
  provider.signOut.mockResolvedValue({ error: null });
  provider.signInWithOAuth.mockResolvedValue({
    data: {
      url: `https://project.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(`${origin}/api/auth/callback`)}`,
    },
    error: null,
  });
  provider.exchangeCodeForSession.mockResolvedValue({
    data: { session: {} },
    error: null,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("request-scoped family authentication", () => {
  it("returns the honest unconfigured state without contacting a provider", async () => {
    vi.stubEnv("SCRABBLE_APP_ORIGIN", "");
    vi.stubEnv("SCRABBLE_SUPABASE_URL", "");
    vi.stubEnv("SCRABBLE_SUPABASE_PUBLISHABLE_KEY", "");
    const response = await session(new Request(`${origin}/api/auth/session`));
    expect(await response.json()).toEqual({ configured: false, user: null });
    expect(provider.create).not.toHaveBeenCalled();
    assertPrivate(response);
  });

  it("does not treat partial or invalid configuration as a local fallback", async () => {
    vi.stubEnv("SCRABBLE_SUPABASE_PUBLISHABLE_KEY", "");
    const response = await session(new Request(`${origin}/api/auth/session`));
    expect(response.status).toBe(503);
    expect(provider.create).not.toHaveBeenCalled();
    assertPrivate(response);
  });

  it.each(["sb_secret_private", "eyJservice-role", "anon-key"])(
    "rejects non-publishable keys: %s",
    (key) => {
      vi.stubEnv("SCRABBLE_SUPABASE_PUBLISHABLE_KEY", key);
      expect(() => createAuthContext(new Request(origin))).toThrow(HttpError);
    },
  );

  it.each([
    "http://scrabble.example",
    "https://scrabble.example/path",
    "https://user:pass@scrabble.example",
    "https://scrabble.example/?secret=value",
  ])("rejects unsafe application origin %s", (value) => {
    vi.stubEnv("SCRABBLE_APP_ORIGIN", value);
    expect(() => getAppOrigin()).toThrow(HttpError);
  });

  it("allows explicitly configured loopback HTTP for local verification", () => {
    vi.stubEnv("SCRABBLE_APP_ORIGIN", "http://127.0.0.1:3000");
    vi.stubEnv("SCRABBLE_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(
      createAuthContext(new Request("http://127.0.0.1:3000")),
    ).not.toBeNull();
  });

  it("uses server-confirmed identity and does not expose provider tokens or metadata", async () => {
    provider.getUser.mockResolvedValue({
      data: { user: { ...user, user_metadata: { role: "superadmin" } } },
      error: null,
    });
    const response = await session(new Request(origin));
    expect(provider.getUser).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({
      configured: true,
      signInMethod: "email",
      user: { id: user.id, email: user.email },
    });
    assertPrivate(response);
  });

  it.each([
    { ...user, is_anonymous: true },
    { ...user, email_confirmed_at: undefined },
    { ...user, email: undefined },
    null,
  ])(
    "does not authorize anonymous, unconfirmed, or absent users",
    async (invalid) => {
      provider.getUser.mockResolvedValue({
        data: { user: invalid },
        error: null,
      });
      const context = createAuthContext(new Request(origin))!;
      await expect(context.requireUser()).rejects.toMatchObject({
        status: 401,
      });
      expect(await (await session(new Request(origin))).json()).toEqual({
        configured: true,
        signInMethod: "email",
        user: null,
      });
    },
  );

  it("treats expired or missing sessions as signed out", async () => {
    provider.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 400, message: "Auth session missing!" },
    });
    const response = await session(new Request(origin));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: true,
      signInMethod: "email",
      user: null,
    });
  });

  it("distinguishes provider outages from signed out and hides raw error details", async () => {
    provider.getUser.mockResolvedValue({
      data: { user: null },
      error: {
        status: 500,
        message: "private key XYZ backend internal failure",
      },
    });
    const response = await session(new Request(origin));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("XYZ");
    assertPrivate(response);
  });

  it("has a total provider deadline, even when the provider never resolves", async () => {
    vi.useFakeTimers();
    provider.getUser.mockImplementation(() => new Promise(() => {}));
    const pending = session(new Request(origin));
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("timed out");
    assertPrivate(response);
  });

  it("keeps refreshed cookies and cache headers on success and error responses", async () => {
    const first = createAuthContext(
      new Request(origin, { headers: { cookie: "sb-test=first" } }),
    )!;
    const second = createAuthContext(
      new Request(origin, { headers: { cookie: "sb-test=second" } }),
    )!;
    expect(await cookieMethods(0).getAll()).toEqual([
      { name: "sb-test", value: "first" },
    ]);
    expect(await cookieMethods(1).getAll()).toEqual([
      { name: "sb-test", value: "second" },
    ]);
    await cookieMethods(0).setAll!(
      [
        {
          name: "sb-test",
          value: "refreshed",
          options: { httpOnly: false, secure: false, path: "/" },
        },
      ],
      { "Cache-Control": "no-store", Pragma: "no-cache", Expires: "0" },
    );
    const response = errorJson(new HttpError(409, "Please reload."), first);
    expect(response.headers.get("set-cookie")).toContain("refreshed");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    assertPrivate(response);
    expect(second.json({}).headers.get("set-cookie")).toBeNull();
  });

  it("disables provider fetch caching and attaches a deadline signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    createAuthContext(new Request(origin));
    const providerFetch = provider.create.mock.calls[0][2].global.fetch;
    await providerFetch("https://project.supabase.co/auth/v1/user", {});
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("shared mutation request protection", () => {
  it.each(["https://evil.example", "null", ""])(
    "rejects a missing or foreign origin: %s",
    async (value) => {
      const response = await sendCode(
        mutation({ email: user.email }, { Origin: value }),
      );
      expect(response.status).toBe(403);
      expect(provider.signInWithOtp).not.toHaveBeenCalled();
      assertPrivate(response);
    },
  );

  it("does not trust attacker-controlled forwarded host headers", async () => {
    const response = await sendCode(
      mutation(
        { email: user.email },
        {
          Origin: "https://evil.example",
          "X-Forwarded-Host": "evil.example",
          Host: "evil.example",
        },
      ),
    );
    expect(response.status).toBe(403);
  });

  it.each(["cross-site", "same-site"])(
    "rejects foreign Fetch Metadata %s",
    async (site) => {
      expect(
        (
          await sendCode(
            mutation({ email: user.email }, { "Sec-Fetch-Site": site }),
          )
        ).status,
      ).toBe(403);
    },
  );

  it("accepts same-origin JSON after streaming body consumption", async () => {
    const response = await sendCode(
      mutation(
        { email: " Ada@Example.com " },
        {
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json; charset=utf-8",
        },
      ),
    );
    expect(response.status).toBe(200);
    expect(provider.signInWithOtp).toHaveBeenCalledWith({
      email: user.email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${origin}/api/auth/callback`,
      },
    });
  });

  it.each(["text/plain", "application/x-www-form-urlencoded"])(
    "rejects unsafe content type %s",
    async (type) => {
      expect(
        (
          await sendCode(
            mutation({ email: user.email }, { "Content-Type": type }),
          )
        ).status,
      ).toBe(415);
    },
  );

  it("rejects malformed JSON without contacting the provider", async () => {
    const response = await sendCode(
      new Request(origin, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
    expect(provider.create).not.toHaveBeenCalled();
  });

  it.each([null, [], { email: 123 }, { email: "a\n@b.com" }, { email: "a@b" }])(
    "rejects invalid body and email values",
    async (body) => {
      const response = await sendCode(mutation(body));
      expect(response.status).toBe(400);
      expect(provider.create).not.toHaveBeenCalled();
    },
  );

  it("rejects an oversized advertised body before reading it", async () => {
    expect(
      (
        await sendCode(
          mutation({ email: user.email }, { "Content-Length": "9999999" }),
        )
      ).status,
    ).toBe(413);
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("bounds streamed bodies even when Content-Length lies or is absent", async () => {
    const response = await sendCode(
      mutation({ email: "A".repeat(20_000) }, { "Content-Length": "2" }),
    );
    expect(response.status).toBe(413);
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("supports explicit larger bounded requests for profile storage", async () => {
    const input = { image: "a".repeat(20_000) };
    expect(await readMutationJson(mutation(input), 30_000)).toEqual(input);
  });

  it("times out a body stream that stalls", async () => {
    vi.useFakeTimers();
    const request = new Request(origin, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: new ReadableStream(),
      duplex: "half",
    } as RequestInit);
    const pending = sendCode(request);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).status).toBe(408);
  });
});

describe("email code flow", () => {
  it("does not reveal email eligibility from a provider rejection", async () => {
    const normal = await sendCode(mutation({ email: user.email }));
    provider.signInWithOtp.mockResolvedValue({
      error: { status: 400, message: "not eligible" },
    });
    const rejected = await sendCode(
      mutation({ email: "different@example.com" }),
    );
    expect(rejected.status).toBe(normal.status);
    expect(await rejected.json()).toEqual(await normal.json());
  });

  it("returns a safe actionable rate-limit response", async () => {
    provider.signInWithOtp.mockResolvedValue({
      error: { status: 429, message: "private provider details" },
    });
    const response = await sendCode(mutation({ email: user.email }));
    expect(response.status).toBe(429);
    expect(await response.text()).not.toContain("private provider");
    assertPrivate(response);
  });

  it("does not report an email as sent during provider failure", async () => {
    provider.signInWithOtp.mockRejectedValue(
      new Error("secret network detail"),
    );
    const response = await sendCode(mutation({ email: user.email }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });

  it.each(["123456", "12345678", "1234567890"])(
    "verifies configured provider code length %s and then confirms identity",
    async (token) => {
      const response = await verifyCode(mutation({ email: user.email, token }));
      expect(response.status).toBe(200);
      expect(provider.verifyOtp).toHaveBeenCalledWith({
        email: user.email,
        token,
        type: "email",
      });
      expect(provider.getUser).toHaveBeenCalledOnce();
      expect(await response.json()).toEqual({
        user: { id: user.id, email: user.email },
      });
      assertPrivate(response);
    },
  );

  it.each(["12345", "12345678901", "abcdef", 123456])(
    "rejects malformed code %s before provider work",
    async (token) => {
      expect(
        (await verifyCode(mutation({ email: user.email, token }))).status,
      ).toBe(400);
      expect(provider.verifyOtp).not.toHaveBeenCalled();
    },
  );

  it("does not reuse an existing signed-in cookie when a new code expires", async () => {
    provider.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { status: 403, message: "expired code" },
    });
    const response = await verifyCode(
      mutation({ email: user.email, token: "123456" }),
    );
    expect(response.status).toBe(401);
    expect(provider.getUser).not.toHaveBeenCalled();
    expect(await response.text()).toContain("invalid or expired");
  });

  it("requires an actual session and matching verified identity", async () => {
    provider.verifyOtp.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    expect(
      (await verifyCode(mutation({ email: user.email, token: "123456" })))
        .status,
    ).toBe(401);
    provider.getUser.mockResolvedValue({
      data: { user: { ...user, email: "someoneelse@example.com" } },
      error: null,
    });
    expect(
      (await verifyCode(mutation({ email: user.email, token: "123456" })))
        .status,
    ).toBe(401);
  });

  it("signs out only this device and returns private headers", async () => {
    const response = await signOut(mutation({}));
    expect(response.status).toBe(200);
    expect(provider.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(await response.json()).toEqual({ signedOut: true });
    assertPrivate(response);
  });

  it("does not claim sign-out succeeded during a provider failure", async () => {
    provider.signOut.mockResolvedValue({ error: { status: 500 } });
    const response = await signOut(mutation({}));
    expect(response.status).toBe(503);
  });

  it("normalizes email without accepting controls or overlong input", () => {
    expect(normalizeEmail(" ADA@EXAMPLE.COM ")).toBe(user.email);
    expect(() => normalizeEmail("a\0@b.com")).toThrow(HttpError);
    expect(() => normalizeEmail(`${"a".repeat(250)}@b.com`)).toThrow(HttpError);
  });
});

describe("Google PKCE sign-in flow", () => {
  beforeEach(() => vi.stubEnv("SCRABBLE_AUTH_METHOD", "google"));

  it("advertises the configured method without exposing provider secrets", async () => {
    const response = await session(new Request(origin));
    expect(await response.json()).toEqual({
      configured: true,
      signInMethod: "google",
      user: { id: user.id, email: user.email },
    });
  });

  it("rejects unknown auth configuration instead of silently choosing a method", async () => {
    vi.stubEnv("SCRABBLE_AUTH_METHOD", "typo");
    expect((await session(new Request(origin))).status).toBe(503);
    expect(provider.create).not.toHaveBeenCalled();
  });

  it.each(["", "https://evil.example", "null"])(
    "requires a same-origin POST to start: %s",
    async (value) => {
      const response = await startGoogle(mutation({}, { Origin: value }));
      expect(response.status).toBe(403);
      expect(provider.signInWithOAuth).not.toHaveBeenCalled();
    },
  );

  it("ignores request destinations and returns only the fixed provider URL with private PKCE cookies", async () => {
    provider.signInWithOAuth.mockImplementationOnce(async () => {
      await cookieMethods().setAll!(
        [
          {
            name: "sb-test-code-verifier",
            value: "private-verifier",
            options: {},
          },
        ],
        {},
      );
      return {
        data: {
          url: `https://project.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(`${origin}/api/auth/callback`)}`,
        },
        error: null,
      };
    });
    const response = await startGoogle(
      mutation({ next: "https://evil.example", provider: "evil" }),
    );
    expect(response.status).toBe(200);
    expect(provider.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: `${origin}/api/auth/callback`,
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["url"]);
    expect(JSON.stringify(body)).not.toContain("private-verifier");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    assertPrivate(response);
  });

  it.each([
    "https://evil.example/auth/v1/authorize?provider=google",
    `https://project.supabase.co/auth/v1/authorize?provider=google&redirect_to=https://evil.example`,
    `https://project.supabase.co/other?provider=google&redirect_to=${encodeURIComponent(`${origin}/api/auth/callback`)}`,
    "javascript:alert(1)",
  ])(
    "does not navigate to an unexpected provider destination: %s",
    async (url) => {
      provider.signInWithOAuth.mockResolvedValue({
        data: { url },
        error: null,
      });
      const response = await startGoogle(mutation({}));
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(url);
    },
  );

  it("fails safely when the provider cannot start sign-in", async () => {
    provider.signInWithOAuth.mockRejectedValue(
      new Error("secret provider detail"),
    );
    const response = await startGoogle(mutation({}));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });

  it("requires a fresh successful exchange and verified identity before the fixed redirect", async () => {
    provider.exchangeCodeForSession.mockImplementationOnce(async () => {
      await cookieMethods().setAll!(
        [
          { name: "sb-session", value: "private-session", options: {} },
          { name: "sb-test-code-verifier", value: "", options: { maxAge: 0 } },
        ],
        {},
      );
      return { data: { session: {} }, error: null };
    });
    const response = await googleCallback(
      new Request(
        `https://untrusted-host.example/api/auth/callback?code=one-use-code&next=https://evil.example`,
        { headers: { "X-Forwarded-Host": "evil.example" } },
      ),
    );
    expect(provider.exchangeCodeForSession).toHaveBeenCalledWith(
      "one-use-code",
    );
    expect(provider.getUser).toHaveBeenCalledOnce();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/family`);
    expect(response.headers.get("set-cookie")).toContain("private-session");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    assertPrivate(response);
  });

  it.each([
    "",
    "?code=",
    "?code=first&code=second",
    "?code=bad%20code",
    `?code=${"x".repeat(2049)}`,
  ])(
    "rejects malformed callbacks before provider exchange: %s",
    async (query) => {
      const response = await googleCallback(
        new Request(`${origin}/api/auth/callback${query}`),
      );
      expect(response.headers.get("location")).toBe(
        `${origin}/family?signin=failed`,
      );
      expect(provider.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(provider.getUser).not.toHaveBeenCalled();
      assertPrivate(response);
    },
  );

  it("returns cancellation without reflecting provider error descriptions", async () => {
    const response = await googleCallback(
      new Request(
        `${origin}/api/auth/callback?error=access_denied&error_description=private-secret&next=//evil.example`,
      ),
    );
    expect(response.headers.get("location")).toBe(
      `${origin}/family?signin=cancelled`,
    );
    expect(await response.text()).not.toContain("private-secret");
    expect(provider.create).not.toHaveBeenCalled();
  });

  it.each([
    { data: { session: null }, error: null },
    {
      data: { session: {} },
      error: { status: 400, message: "verifier mismatch" },
    },
  ])(
    "does not reuse an existing session when exchange fails",
    async (result) => {
      provider.exchangeCodeForSession.mockResolvedValue(result);
      const response = await googleCallback(
        new Request(`${origin}/api/auth/callback?code=old-code`),
      );
      expect(response.headers.get("location")).toBe(
        `${origin}/family?signin=failed`,
      );
      expect(provider.getUser).not.toHaveBeenCalled();
    },
  );

  it("rejects an unverified identity after a successful exchange", async () => {
    provider.getUser.mockResolvedValue({
      data: { user: { ...user, email_confirmed_at: null } },
      error: null,
    });
    const response = await googleCallback(
      new Request(`${origin}/api/auth/callback?code=one-use-code`),
    );
    expect(response.headers.get("location")).toBe(
      `${origin}/family?signin=failed`,
    );
  });

  it("times out stalled callback exchanges and offers a retry without raw details", async () => {
    vi.useFakeTimers();
    provider.exchangeCodeForSession.mockImplementation(
      () => new Promise(() => {}),
    );
    const pending = googleCallback(
      new Request(`${origin}/api/auth/callback?code=one-use-code`),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;
    expect(response.headers.get("location")).toBe(
      `${origin}/family?signin=unavailable`,
    );
    expect(provider.getUser).not.toHaveBeenCalled();
  });

  it("never uses request hosts for redirects when the configured origin is invalid", async () => {
    vi.stubEnv("SCRABBLE_APP_ORIGIN", "https://example.com/invalid");
    const response = await googleCallback(
      new Request("https://evil.example/api/auth/callback?code=x"),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not enable unconfigured email delivery in Google mode", async () => {
    expect((await sendCode(mutation({ email: user.email }))).status).toBe(409);
    expect(
      (await verifyCode(mutation({ email: user.email, token: "123456" })))
        .status,
    ).toBe(409);
    expect(provider.signInWithOtp).not.toHaveBeenCalled();
    expect(provider.verifyOtp).not.toHaveBeenCalled();
  });

  it("keeps Google initiation disabled while email links use the PKCE callback", async () => {
    vi.stubEnv("SCRABBLE_AUTH_METHOD", "");
    expect((await startGoogle(mutation({}))).status).toBe(409);
    expect(
      (
        await googleCallback(new Request(`${origin}/api/auth/callback?code=x`))
      ).headers.get("location"),
    ).toBe(`${origin}/family`);
    expect(provider.signInWithOAuth).not.toHaveBeenCalled();
    expect(provider.exchangeCodeForSession).toHaveBeenCalledWith("x");
    expect(provider.getUser).toHaveBeenCalledOnce();
  });
});

describe("combined sign-in", () => {
  it("offers Google and email codes together, including Hotmail", async () => {
    vi.stubEnv("SCRABBLE_AUTH_METHOD", "both");
    expect(await (await session(new Request(origin))).json()).toMatchObject({
      signInMethod: "both",
    });
    expect(
      (await sendCode(mutation({ email: "erin@hotmail.com" }))).status,
    ).toBe(200);
    expect(provider.signInWithOtp).toHaveBeenCalledWith({
      email: "erin@hotmail.com",
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${origin}/api/auth/callback`,
      },
    });
    expect((await startGoogle(mutation({}))).status).toBe(200);
  });
});
