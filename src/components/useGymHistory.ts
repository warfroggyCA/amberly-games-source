"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  sameGymOwner,
  retainedHistory,
  historyAccessDenied,
  historyServiceFailure,
  validGymAuth,
  validHistory,
  validHistoryDetail,
  type GymReadState,
  type HistoryTarget,
} from "../lib/gym-history-read-state";
import type { Puzzle } from "../domain/gym/model";
import type {
  GymEventPayload,
  GymIdentity,
  GymHistory,
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
  signal?: AbortSignal,
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
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok)
    throw Object.assign(
      new Error(
        typeof data?.error === "string"
          ? data.error
          : (data?.error?.message ??
              "Practice could not sync. Your pending saves are kept on this device."),
      ),
      { code: data?.code ?? data?.error?.code, status: r.status },
    );
  return data;
}
export function useGymHistory(enabled: boolean, referenceWords: string[] = []) {
  const [identity, setIdentity] = useState<GymIdentity | null>(null),
    [status, setStatus] = useState(enabled ? "Connecting profile…" : ""),
    [readState, setReadState] = useState<GymReadState>({ kind: "closed" }),
    [practiceOwner, setPracticeOwner] = useState<GymIdentity | null>(null),
    [denied, setDenied] = useState(false),
    [connectionState, setConnectionState] = useState<
      "connecting" | "failed" | "complete"
    >(enabled ? "connecting" : "complete");
  const current = useRef<GymIdentity | null>(null),
    alive = useRef(true),
    writing = useRef(Promise.resolve()),
    syncing = useRef<Promise<void> | null>(null),
    accessGeneration = useRef(0),
    readGeneration = useRef(0),
    readAbort = useRef<AbortController | null>(null),
    readSnapshot = useRef<GymReadState>({ kind: "closed" }),
    accessDenied = useRef(false),
    generation = useRef(0);
  const session = useRef<{
    id: string;
    owner: GymIdentity;
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
  const getOwner = useCallback(
    () => (enabled && !accessDenied.current ? current.current : null),
    [enabled],
  );
  function invalidateAccess() {
    accessGeneration.current++;
  }
  const updateRead = useCallback((state: GymReadState) => {
    readSnapshot.current = state;
    setReadState(state);
  }, []);
  const invalidateRead = useCallback(() => {
    readGeneration.current++;
    readAbort.current?.abort();
    readAbort.current = null;
  }, []);
  const denialMessage =
    "Profile history access is unavailable or your account/profile changed. Your pending practice is kept for its original profile. Reload to reconnect; check your profile through Games.";
  const deny = useCallback(
    (owner: GymIdentity | null) => {
      if (!alive.current || (owner && !sameGymOwner(current.current, owner)))
        return;
      accessGeneration.current++;
      accessDenied.current = true;
      current.current = null;
      invalidateRead();
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
      setIdentity(null);
      setDenied(true);
      setStatus(denialMessage);
      updateRead({ kind: "denied", message: denialMessage });
    },
    [invalidateRead, updateRead],
  );
  function flush(): Promise<void> {
    const owner = current.current;
    if (!owner || !enabled || !alive.current || accessDenied.current)
      return Promise.resolve();
    if (syncing.current) return syncing.current;
    const version = accessGeneration.current;
    const isCurrent = () =>
      alive.current &&
      version === accessGeneration.current &&
      sameGymOwner(current.current, owner) &&
      !accessDenied.current;
    const work = (async () => {
      try {
        const auth = await response<{ user: { id: string } | null }>(
          "/api/auth/session",
        );
        if (!isCurrent()) return;
        if (!validGymAuth(auth))
          throw new Error(
            "Profile connection returned an invalid response. Please retry.",
          );
        if (auth.user?.id !== owner.userId) {
          deny(owner);
          return;
        }
        const pending = await pendingGymEvents(owner);
        if (!isCurrent()) return;
        if (pending.length) setStatus("Saving practice…");
        for (const item of pending) {
          if (!isCurrent()) return;
          const receipt = await response<{
            eventId: string;
            sessionId: string;
            sequence: number;
          }>("/api/family/gym", owner.userId, item.data);
          if (
            !receipt ||
            receipt.eventId !== item.data.event.id ||
            receipt.sessionId !== item.data.sessionId ||
            receipt.sequence !== item.data.event.sequence
          )
            throw new Error(
              "Save receipt did not match. Pending practice has been kept.",
            );
          // A matching in-flight receipt belongs to this exact original-owner row,
          // even if access was revoked while the write was on the wire.
          await acknowledgeGymEvent(item.key);
        }
        const remaining = await pendingGymEvents(owner);
        if (!isCurrent()) return;
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
        if (!isCurrent()) return;
        if (historyAccessDenied(e)) {
          deny(owner);
          return;
        }
        setStatus(e instanceof Error ? e.message : "Waiting to sync");
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          if (isCurrent()) void flushRef.current();
        }, delay.current);
        delay.current = Math.min(delay.current * 2, 60000);
      } finally {
        if (isCurrent() && !retryTimer.current) {
          retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            void pendingGymEvents(owner)
              .then((rows) => {
                if (isCurrent() && rows.length) void flushRef.current();
              })
              .catch(() => {});
          }, 2000);
        }
      }
    })();
    syncing.current = work;
    void work.finally(() => {
      if (syncing.current === work) syncing.current = null;
    });
    return work;
  }
  async function connect() {
    // Only initial connection failures can reconnect in place. Once practice
    // belongs to a profile, the existing account-change path requires reload.
    if (
      !enabled ||
      !alive.current ||
      connected.current ||
      accessDenied.current ||
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
      if (!validGymAuth(auth))
        throw new Error(
          "Profile connection returned an invalid response. Please retry.",
        );
      if (!auth.user)
        throw new Error(
          "Sign in through Games to save practice to your profile.",
        );
      const result = await response<GymHistory>(
        "/api/family/gym",
        auth.user.id,
      );
      if (!isCurrent()) return;
      if (!validHistory(result)) throw historyServiceFailure();
      // A delayed history response must not expose the previous account's
      // history or flush its pending saves after the browser session changes.
      const latest = await response<{ user: { id: string } | null }>(
        "/api/auth/session",
      );
      if (!isCurrent()) return;
      if (!validGymAuth(latest))
        throw new Error(
          "Profile connection returned an invalid response. Please retry.",
        );
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
      setPracticeOwner(result.identity);
      setConnectionState("complete");
      setStatus("Profile connected");
      await flushRef.current();
    } catch (e) {
      if (isCurrent()) {
        if (historyAccessDenied(e)) {
          deny(null);
          return;
        }
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
    if (!enabled || accessDenied.current) return;
    if (current.current) await flushRef.current();
    else await connect();
  }
  useEffect(() => {
    flushRef.current = flush;
    retryRef.current = retry;
  });
  useEffect(() => {
    alive.current = true;
    if (!enabled) {
      if (connected.current) deny(null);
      current.current = null;
      invalidateRead();
      return () => {
        alive.current = false;
      };
    }
    void retryRef.current();
    const retry = () => void retryRef.current();
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      alive.current = false;
      generation.current += 1;
      invalidateAccess();
      invalidateRead();
      connecting.current = null;
      // Preserve the explicit reload policy once an owner was established.
      current.current = null;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
    };
  }, [enabled, deny, invalidateRead]);
  function start(puzzle: Puzzle) {
    if (!enabled || !current.current) {
      session.current = null;
      return;
    }
    storageFailure.current = null;
    session.current = {
      id: crypto.randomUUID(),
      owner: current.current,
      puzzle,
      sequence: 0,
      live: false,
      failed: false,
    };
  }
  function record(payload: GymEventPayload): string | null {
    const owner = current.current,
      s = session.current;
    if (
      !enabled ||
      accessDenied.current ||
      !owner ||
      !s ||
      !sameGymOwner(owner, s.owner) ||
      s.failed
    )
      return null;
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
        if (
          alive.current &&
          !accessDenied.current &&
          sameGymOwner(current.current, owner)
        )
          setStatus("Waiting to sync");
      } catch {
        s.failed = true;
        storageFailure.current =
          "Practice could not be saved on this device. This session is not recoverable after refresh.";
        if (
          alive.current &&
          !accessDenied.current &&
          sameGymOwner(current.current, owner)
        )
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
  async function navigate(target: HistoryTarget) {
    // Allocate the intent before any durable-write prerequisites can suspend.
    invalidateRead();
    const version = readGeneration.current;
    const access = accessGeneration.current;
    const owner = current.current;
    if (!enabled || !owner || accessDenied.current) return;
    const controller = new AbortController();
    readAbort.current = controller;
    const isCurrent = () =>
      alive.current &&
      readGeneration.current === version &&
      accessGeneration.current === access &&
      sameGymOwner(current.current, owner) &&
      !accessDenied.current;
    const retained = retainedHistory(readSnapshot.current);
    updateRead({
      kind: "loading",
      target,
      retained:
        retained && sameGymOwner(retained.owner, owner) ? retained : null,
    });
    try {
      if (target.kind === "list") {
        await writing.current;
        if (!isCurrent()) return;
        await flushRef.current();
        if (!isCurrent()) return;
      }
      const params = new URLSearchParams({
        ownerFamilyId: owner.familyId,
        ownerPlayerId: owner.playerId,
      });
      if (target.kind === "list" && target.cursor)
        params.set("cursor", target.cursor);
      if (target.kind === "detail") params.set("sessionId", target.id);
      if (!isCurrent()) return;
      const result = await response<unknown>(
        `/api/family/gym?${params}`,
        owner.userId,
        undefined,
        controller.signal,
      );
      if (!isCurrent()) return;
      if (target.kind === "list") {
        if (!validHistory(result)) throw historyServiceFailure();
        if (!sameGymOwner(result.identity, owner)) {
          deny(owner);
          return;
        }
        updateRead({ kind: "list", owner, page: result });
      } else {
        if (!validHistoryDetail(result, target.id))
          throw historyServiceFailure();
        updateRead({ kind: "detail", owner, detail: result });
      }
    } catch (e) {
      if (!isCurrent()) return;
      if (historyAccessDenied(e)) {
        deny(owner);
        return;
      }
      updateRead({
        kind: "failed",
        target,
        retained: retainedHistory(readSnapshot.current),
        message:
          e instanceof Error ? e.message : "History unavailable. Please retry.",
      });
    } finally {
      // Loading belongs to the tagged intent. An older completion cannot clear it.
      if (isCurrent()) readAbort.current = null;
    }
  }
  function close() {
    invalidateRead();
    updateRead(
      accessDenied.current
        ? { kind: "denied", message: denialMessage }
        : { kind: "closed" },
    );
  }
  return {
    identity: enabled && !denied ? identity : null,
    practiceOwner,
    getOwner,
    denied,
    readState: enabled ? readState : ({ kind: "closed" } as GymReadState),
    close,
    retryHistory: () => {
      const state = readSnapshot.current;
      if (state.kind === "failed") void navigate(state.target);
    },
    status,
    start,
    record,
    history: (cursor?: string) => navigate({ kind: "list", cursor }),
    review: (id: string) => navigate({ kind: "detail", id }),
    canRetry:
      enabled && !denied && (connectionState === "failed" || !!identity),
    retry: () => void retryRef.current(),
  };
}
