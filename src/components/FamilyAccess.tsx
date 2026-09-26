"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { FamilyWelcome } from "./FamilyWelcome";

export type FamilyUser = { id: string; email: string };
type Session = {
  configured: boolean;
  user: FamilyUser | null;
  signInMethod: "email" | "google" | "both";
};

function isUser(value: unknown): value is FamilyUser {
  return (
    !!value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    "email" in value &&
    typeof value.email === "string"
  );
}

async function authRequest(
  route: "session" | "code" | "verify" | "google",
  signal: AbortSignal,
  body?: Record<string, string>,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${route}`, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
  } catch {
    throw new Error(
      "We could not reach the family service. Your entries are kept; please retry.",
    );
  }
  let result: Record<string, unknown>;
  try {
    result = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error();
    }
  } catch {
    throw new Error(
      "The family service returned an incomplete response. Please retry.",
    );
  }
  if (!response.ok) {
    throw new Error(
      typeof result.error === "string" && result.error.length <= 300
        ? result.error
        : "The family service is unavailable. Please retry.",
    );
  }
  return result;
}

export function FamilyAccess({
  children,
}: {
  children: (user: FamilyUser) => ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [codeEmail, setCodeEmail] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [retryAt, setRetryAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const active = useRef<AbortController | null>(null);

  const loadSession = useCallback(() => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    void authRequest("session", controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (
          typeof result.configured !== "boolean" ||
          (result.user !== null && !isUser(result.user)) ||
          (result.signInMethod !== undefined &&
            result.signInMethod !== "email" &&
            result.signInMethod !== "google" &&
            result.signInMethod !== "both")
        ) {
          throw new Error("Sign-in could not be checked. Please retry.");
        }
        setSession({
          configured: result.configured,
          user: result.user,
          signInMethod:
            result.signInMethod === "both"
              ? "both"
              : result.signInMethod === "google"
                ? "google"
                : "email",
        });
        const address = new URL(window.location.href);
        const signInResult = address.searchParams.get("signin");
        if (signInResult) {
          address.searchParams.delete("signin");
          window.history.replaceState(window.history.state, "", address);
          if (!result.user) {
            if (signInResult === "cancelled") {
              setNotice(
                "Google sign-in was cancelled. You can try again whenever you’re ready.",
              );
            } else if (signInResult === "failed") {
              setError(
                "Google sign-in did not finish. It may have expired or opened in a different browser. Please try again.",
              );
            } else if (signInResult === "unavailable") {
              setError(
                "Google sign-in could not be checked. Please try again.",
              );
            }
          }
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Sign-in could not be checked.",
          );
        }
      })
      .finally(() => {
        if (active.current === controller) {
          active.current = null;
          setBusy(false);
        }
      });
  }, []);

  function recheckSession() {
    setBusy(true);
    setError(null);
    void loadSession();
  }

  useEffect(() => {
    void loadSession();
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("pageshow", restore);
      active.current?.abort();
      active.current = null;
    };
  }, [loadSession]);

  useEffect(() => {
    if (!retryAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (!remaining) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [retryAt]);

  async function submit(kind: "code" | "verify") {
    if (active.current || (kind === "code" && Date.now() < retryAt)) return;
    const address = (codeEmail ?? email).trim().toLowerCase();
    if (!address || (kind === "verify" && !/^\d{6,10}$/.test(token))) {
      setError(
        kind === "code"
          ? "Enter your email address."
          : "Enter the code from your sign-in email.",
      );
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    setNotice(null);
    // Count every send attempt, including uncertain network results. The
    // provider independently rate-limits direct API requests.
    if (kind === "code") {
      setRetryAt(Date.now() + 60_000);
      setSecondsLeft(60);
    }
    try {
      const result = await authRequest(kind, controller.signal, {
        email: address,
        ...(kind === "verify" ? { token } : {}),
      });
      if (controller.signal.aborted) return;
      if (kind === "code") {
        setCodeEmail(address);
        setNotice(
          "If this address can sign in, a code will arrive shortly. Check your inbox and spam folder.",
        );
      } else {
        if (!isUser(result.user)) {
          throw new Error(
            "Sign-in could not be confirmed. Check your sign-in or request a new code.",
          );
        }
        setToken("");
        setSession({
          configured: true,
          user: result.user,
          signInMethod: "email",
        });
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Sign-in did not finish. Please retry.",
        );
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  async function signInWithGoogle() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    setNotice(null);
    let navigating = false;
    try {
      const result = await authRequest("google", controller.signal, {});
      if (controller.signal.aborted) return;
      if (typeof result.url !== "string")
        throw new Error("Google sign-in did not start. Please retry.");
      const destination = new URL(result.url);
      if (
        destination.protocol !== "https:" &&
        !(
          destination.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname)
        )
      ) {
        throw new Error("Google sign-in did not start. Please retry.");
      }
      window.location.assign(destination.href);
      navigating = true;
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Google sign-in did not start. Please retry.",
        );
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (!navigating) setBusy(false);
      }
    }
  }

  if (session?.user) return children(session.user);

  return (
    <FamilyWelcome
      title={
        session?.configured === false ? "Your table is ready." : "Let’s play."
      }
      loading={session === null && busy}
    >
      {session?.configured === false ? (
        <>
          <p>
            Shared games aren’t connected here yet. You can still score a game
            on this device.
          </p>
          <p>Your existing games and profiles are safely saved here.</p>
          <Link href="/" className="btn primary">
            Continue on this device
          </Link>
        </>
      ) : session === null ? (
        <>
          <p className="family-access-status" role="status">
            {busy
              ? "Checking Amberly sign-in…"
              : "We could not check your sign-in."}
          </p>
          {error && (
            <p className="family-access-error" role="alert">
              {error}
            </p>
          )}
          {!busy && (
            <button className="btn primary" onClick={recheckSession}>
              Try again
            </button>
          )}
        </>
      ) : session.signInMethod === "google" ? (
        <>
          <p>
            Sign in to score games, relive the best words, and see who’s on a
            winning streak.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void signInWithGoogle();
            }}
            aria-busy={busy}
          >
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Opening Google…" : "Continue with Google"}
            </button>
            {notice && (
              <p className="family-access-notice" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="family-access-error" role="alert">
                {error}
              </p>
            )}
          </form>
          <p className="family-access-hint">
            Use the Google account invited to Amberly.
          </p>
          <p className="family-access-watch">
            <strong>Just watching?</strong> Open a game’s viewing link.
            <br />
            No sign-in needed.
          </p>
        </>
      ) : (
        <>
          <p>
            Sign in with the email invited to Amberly, including Hotmail or
            Outlook. We’ll send you a code to open your shared games and
            records.
          </p>
          {session.signInMethod === "both" && !codeEmail && (
            <>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void signInWithGoogle()}
              >
                Continue with Google
              </button>
              <p>Or use an email code — no Google account needed.</p>
            </>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit(codeEmail ? "verify" : "code");
            }}
            aria-busy={busy}
          >
            {codeEmail ? (
              <>
                <p className="family-access-email">
                  Enter the code for <strong>{codeEmail}</strong>
                </p>
                <label htmlFor="family-code">Email code</label>
                <input
                  id="family-code"
                  name="token"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6,10}"
                  maxLength={10}
                  value={token}
                  onChange={(event) =>
                    setToken(event.target.value.replace(/\s/g, ""))
                  }
                  required
                  disabled={busy}
                  autoFocus
                />
                <button
                  className="btn primary"
                  type="submit"
                  disabled={busy || !/^\d{6,10}$/.test(token)}
                >
                  {busy ? "Checking code…" : "Sign in"}
                </button>
                <div className="family-access-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || secondsLeft > 0}
                    onClick={() => void submit("code")}
                  >
                    {secondsLeft > 0
                      ? `Resend in ${secondsLeft}s`
                      : "Send another code"}
                  </button>
                  <button
                    type="button"
                    className="btn quiet"
                    disabled={busy}
                    onClick={() => {
                      setCodeEmail(null);
                      setToken("");
                      setError(null);
                      setNotice(null);
                    }}
                  >
                    Use another email
                  </button>
                  {error && (
                    <button
                      type="button"
                      className="btn quiet"
                      disabled={busy}
                      onClick={recheckSession}
                    >
                      Check sign-in
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <label htmlFor="family-email">Your email</label>
                <input
                  id="family-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  disabled={busy}
                />
                <button
                  className="btn primary"
                  type="submit"
                  disabled={busy || secondsLeft > 0}
                >
                  {busy
                    ? "Requesting code…"
                    : secondsLeft > 0
                      ? `Try again in ${secondsLeft}s`
                      : "Email me a code"}
                </button>
              </>
            )}
            {notice && (
              <p className="family-access-notice" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="family-access-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </>
      )}
    </FamilyWelcome>
  );
}
