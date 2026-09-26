import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getAppOrigin, HttpError, privateJson } from "./shared-http";

export type SignInMethod = "email" | "google" | "both";
export type GoogleSignInError = "cancelled" | "failed" | "unavailable";

export function getSignInMethod(): SignInMethod {
  const method = process.env.SCRABBLE_AUTH_METHOD || "email";
  if (method !== "email" && method !== "google" && method !== "both") {
    throw new HttpError(503, "Family sign-in is not configured yet.");
  }
  return method;
}

/** The callback never uses a destination or origin supplied by a request. */
export function googleSignInRedirect(error?: GoogleSignInError): NextResponse {
  const destination = new URL("/family", getAppOrigin());
  if (error) destination.searchParams.set("signin", error);
  const response = NextResponse.redirect(destination, 303);
  const headers = privateJson({}).headers;
  for (const [name, value] of headers) {
    if (name !== "content-type") response.headers.set(name, value);
  }
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export type AuthenticatedUser = { id: string; email: string };
export type AuthContext = {
  client: SupabaseClient;
  requireUser: () => Promise<AuthenticatedUser>;
  run: <T>(operation: () => PromiseLike<T>) => Promise<T>;
  json: (data: unknown, status?: number) => NextResponse;
  googleRedirect: (error?: GoogleSignInError) => NextResponse;
};

export function createAuthContext(request: Request): AuthContext | null {
  const rawUrl = process.env.SCRABBLE_SUPABASE_URL;
  const key = process.env.SCRABBLE_SUPABASE_PUBLISHABLE_KEY;
  if (!rawUrl && !key && !process.env.SCRABBLE_APP_ORIGIN) return null;
  const origin = getAppOrigin();
  getSignInMethod();
  let url: URL;
  try {
    url = new URL(rawUrl ?? "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      !key?.startsWith("sb_publishable_") ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      throw new Error();
    }
  } catch {
    throw new HttpError(503, "Family sign-in is not configured yet.");
  }
  const nextRequest = new NextRequest(request.url, {
    headers: request.headers,
  });
  const cookieJar = new Map(
    nextRequest.cookies.getAll().map(({ name, value }) => [name, value]),
  );
  const pendingCookies = new Map<
    string,
    { name: string; value: string; options: CookieOptions }
  >();
  const responseHeaders = new Headers();
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const client = createServerClient(url.origin, key, {
    cookieOptions: {
      httpOnly: true,
      secure: origin.startsWith("https:"),
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
      setAll(cookies, headers) {
        if (signal.aborted) return;
        for (const cookie of cookies) {
          cookieJar.set(cookie.name, cookie.value);
          pendingCookies.set(cookie.name, cookie);
        }
        for (const [name, value] of Object.entries(headers)) {
          responseHeaders.set(name, value);
        }
      },
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(10_000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
    },
  });
  async function run<T>(operation: () => PromiseLike<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new HttpError(503, "The family service timed out. Please retry."),
            );
          }, 10_000);
        }),
      ]);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        503,
        "The family service is unavailable. Please retry.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  function applyCookies(response: NextResponse): NextResponse {
    for (const { name, value, options } of pendingCookies.values()) {
      response.cookies.set(name, value, {
        ...options,
        httpOnly: true,
        secure: origin.startsWith("https:"),
        sameSite: "lax",
        path: "/",
      });
    }
    return response;
  }
  return {
    client,
    run,
    async requireUser() {
      const { data, error } = await run(() => client.auth.getUser());
      if (error && ![400, 401, 403].includes(error.status ?? 0)) {
        throw new HttpError(503, "Sign-in could not be checked. Please retry.");
      }
      const user = data.user;
      if (
        error ||
        !user ||
        user.is_anonymous ||
        !user.email ||
        !user.email_confirmed_at
      ) {
        throw new HttpError(401, "Please sign in again to continue.");
      }
      return { id: user.id, email: user.email };
    },
    json(data, status = 200) {
      return applyCookies(privateJson(data, status, responseHeaders));
    },
    googleRedirect(error) {
      return applyCookies(googleSignInRedirect(error));
    },
  };
}

export function requireAuthContext(request: Request): AuthContext {
  const context = createAuthContext(request);
  if (!context) {
    throw new HttpError(503, "Family sign-in is not configured yet.");
  }
  return context;
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "Enter a valid email address.");
  }
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/.test(
      email,
    )
  ) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  return email;
}
