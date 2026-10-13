"use client";
import { useEffect, useRef, useState } from "react";
import type { Puzzle } from "../domain/gym/model";
import type {
  GymEventPayload,
  GymIdentity,
  GymHistory,
  GymSessionDetail,
  GymWrite,
} from "../lib/gym-history-contract";
import {
  queueGymEvent,
  pendingGymEvents,
  acknowledgeGymEvent,
} from "../lib/gym-history-outbox";
async function response<T>(
  url: string,
  userId?: string,
  body?: unknown,
): Promise<T> {
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(userId ? { "x-scrabble-user": userId } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(
      new Error(
        typeof data.error === "string"
          ? data.error
          : (data.error?.message ??
              "Practice could not sync. Your pending saves are kept on this device."),
      ),
      { code: data.code },
    );
  return data;
}
export function useGymHistory(enabled: boolean, referenceWords: string[] = []) {
  const [identity, setIdentity] = useState<GymIdentity | null>(null),
    [status, setStatus] = useState(enabled ? "Connecting profile…" : ""),
    [page, setPage] = useState<GymHistory | null>(null),
    [detail, setDetail] = useState<GymSessionDetail | null>(null),
    [loading, setLoading] = useState(false),
    [connectionState, setConnectionState] = useState<
      "connecting" | "failed" | "complete"
    >(enabled ? "connecting" : "complete");
  const current = useRef<GymIdentity | null>(null),
    alive = useRef(true),
    writing = useRef(Promise.resolve()),
    syncing = useRef(false),
    generation = useRef(0);
  const session = useRef<{
    id: string;
    puzzle: Puzzle;
    sequence: number;
    live: boolean;
    failed: boolean;
  } | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {}),
    retryRef = useRef<() => Promise<void>>(async () => {}),
    connecting = useRef<number | null>(null),
    connected = useRef(false);
  const storageFailure = useRef<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    delay = useRef(2000);
  async function flush() {
    const owner = current.current;
    if (!owner || syncing.current || !alive.current) return;
    syncing.current = true;
    try {
      const auth = await response<{ user: { id: string } | null }>(
        "/api/auth/session",
      );
      if (auth.user?.id !== owner.userId) {
        current.current = null;
        setIdentity(null);
        setPage(null);
        setDetail(null);
        throw new Error(
          "Your account changed. Pending practice is kept for the original profile; reload to reconnect.",
        );
      }
      const pending = await pendingGymEvents(owner);
      if (pending.length && alive.current) setStatus("Saving practice…");
      for (const item of pending) {
        if (!alive.current || current.current !== owner) return;
        const receipt = await response<{
          eventId: string;
          sessionId: string;
          sequence: number;
        }>("/api/family/gym", owner.userId, item.data);
        if (
          receipt.eventId !== item.data.event.id ||
          receipt.sessionId !== item.data.sessionId ||
          receipt.sequence !== item.data.event.sequence
        )
          throw new Error(
            "Save receipt did not match. Pending practice has been kept.",
          );
        await acknowledgeGymEvent(item.key);
      }
      const remaining = await pendingGymEvents(owner);
      if (alive.current && current.current === owner)
        setStatus(
          storageFailure.current ??
            (remaining.length
              ? "Waiting to sync"
              : pending.length
                ? "Saved to profile"
                : "Profile connected"),
        );
      delay.current = 2000;
    } catch (e) {
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        e.code === "PROFILE_CHANGED"
      ) {
        current.current = null;
        setIdentity(null);
        setPage(null);
        setDetail(null);
      }
      if (alive.current) {
        setStatus(e instanceof Error ? e.message : "Waiting to sync");
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          void flushRef.current();
        }, delay.current);
        delay.current = Math.min(delay.current * 2, 60000);
      }
    } finally {
      syncing.current = false;
      if (alive.current && current.current === owner && !retryTimer.current) {
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          void pendingGymEvents(owner)
            .then((rows) => {
              if (rows.length) void flushRef.current();
            })
            .catch(() => {});
        }, 2000);
      }
    }
  }
  async function connect() {
    // Only initial connection failures can reconnect in place. Once practice
    // belongs to a profile, the existing account-change path requires reload.
    if (
      !enabled ||
      !alive.current ||
      connected.current ||
      connecting.current !== null
    )
      return;
    const version = ++generation.current;
    connecting.current = version;
    setConnectionState("connecting");
    setStatus("Connecting profile…");
    const isCurrent = () => alive.current && generation.current === version;
    try {
      const auth = await response<{ user: { id: string } | null }>(
        "/api/auth/session",
      );
      if (!isCurrent()) return;
      if (!auth.user)
        throw new Error(
          "Sign in through Games to save practice to your profile.",
        );
      const result = await response<GymHistory>(
        "/api/family/gym",
        auth.user.id,
      );
      if (!isCurrent()) return;
      // A delayed history response must not expose the previous account's
      // history or flush its pending saves after the browser session changes.
      const latest = await response<{ user: { id: string } | null }>(
        "/api/auth/session",
      );
      if (!isCurrent()) return;
      if (
        latest.user?.id !== auth.user.id ||
        result.identity.userId !== auth.user.id
      )
        throw new Error(
          "Your account changed while connecting. Retry to connect to your current profile.",
        );
      connected.current = true;
      current.current = result.identity;
      setIdentity(result.identity);
      setPage(result);
      setConnectionState("complete");
      setStatus("Profile connected");
      await flushRef.current();
    } catch (e) {
      if (isCurrent()) {
        setConnectionState("failed");
        setStatus(
          e instanceof Error
            ? e.message
            : "Profile saving unavailable. Please retry.",
        );
      }
    } finally {
      if (connecting.current === version) connecting.current = null;
    }
  }
  async function retry() {
    if (current.current) await flushRef.current();
    else await connect();
  }
  useEffect(() => {
    flushRef.current = flush;
    retryRef.current = retry;
  });
  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    void retryRef.current();
    const retry = () => void retryRef.current();
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      alive.current = false;
      generation.current += 1;
      connecting.current = null;
      connected.current = false;
      current.current = null;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
    };
  }, [enabled]);
  function start(puzzle: Puzzle) {
    if (!enabled || !current.current) {
      session.current = null;
      return;
    }
    storageFailure.current = null;
    session.current = {
      id: crypto.randomUUID(),
      puzzle,
      sequence: 0,
      live: false,
      failed: false,
    };
  }
  function record(payload: GymEventPayload): string | null {
    const owner = current.current,
      s = session.current;
    if (!owner || !s || s.failed) return null;
    if (payload.type === "live-coaching") {
      if (s.live) return null;
      s.live = true;
    }
    if (s.sequence >= 1000) {
      s.failed = true;
      setStatus(
        "This practice session reached its save limit. Start a new puzzle to save more practice.",
      );
      return null;
    }
    const data: GymWrite = {
      sessionId: s.id,
      playerId: owner.playerId,
      puzzle: s.puzzle,
      event: {
        id: crypto.randomUUID(),
        sequence: ++s.sequence,
        occurredAt: new Date().toISOString(),
        payload,
        ...(referenceWords.length
          ? { referenceWords: [...referenceWords].sort() }
          : {}),
      },
    };
    setStatus("Saving on this device…");
    writing.current = writing.current.then(async () => {
      if (s.failed) return;
      try {
        await queueGymEvent(owner, data);
        if (alive.current) setStatus("Waiting to sync");
      } catch {
        s.failed = true;
        storageFailure.current =
          "Practice could not be saved on this device. This session is not recoverable after refresh.";
        if (alive.current)
          setStatus(
            "Practice could not be saved on this device. Keep this page open; this session is not recoverable after refresh.",
          );
      }
    });
    void writing.current
      .then(() => flushRef.current())
      .then(async () => {
        if (
          current.current &&
          (await pendingGymEvents(current.current)).length &&
          !syncing.current
        )
          void flushRef.current();
      })
      .catch(() => {});
    return data.event.id;
  }
  async function history(cursor?: string) {
    const owner = current.current;
    if (!owner) return;
    setLoading(true);
    try {
      await writing.current;
      await flushRef.current();
      const result = await response<GymHistory>(
        `/api/family/gym${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        owner.userId,
      );
      if (alive.current && current.current === owner) {
        if (result.identity.playerId !== owner.playerId) {
          current.current = null;
          setIdentity(null);
          setPage(null);
          setDetail(null);
          throw new Error("Your profile changed. Reload to reconnect.");
        }
        setPage(result);
        setDetail(null);
      }
    } catch (e) {
      if (alive.current)
        setStatus(e instanceof Error ? e.message : "History unavailable.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  async function review(id: string) {
    const owner = current.current;
    if (!owner) return;
    setLoading(true);
    try {
      const result = await response<GymSessionDetail>(
        `/api/family/gym?sessionId=${encodeURIComponent(id)}`,
        owner.userId,
      );
      if (alive.current && current.current === owner) setDetail(result);
    } catch (e) {
      if (alive.current)
        setStatus(e instanceof Error ? e.message : "Practice unavailable.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  return {
    identity,
    status,
    page,
    detail,
    loading,
    start,
    record,
    history,
    review,
    canRetry: connectionState === "failed" || !!identity,
    retry: () => void retryRef.current(),
  };
}
