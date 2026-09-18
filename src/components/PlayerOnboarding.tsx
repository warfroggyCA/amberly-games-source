"use client";
import { useState, useSyncExternalStore } from "react";
import { FamilyWelcome } from "./FamilyWelcome";
import { PlayerProfileEditor } from "./PlayerProfileEditor";
import type { SharedScorerStore } from "../lib/shared-store";

export function PlayerOnboarding({
  store,
  onSignOut,
  onComplete,
}: {
  store: SharedScorerStore;
  onSignOut: () => void;
  onComplete: () => void;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const [newId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [initial] = useState(() => ({
    member: state.shared!.member,
    player: state.data.players.find(
      (p) => p.id === state.shared!.member.playerId,
    ),
    revision:
      state.shared!.playerAccess[state.shared!.member.playerId ?? ""]
        ?.revision ?? null,
  }));
  const member = initial.member;
  const linked = initial.player;
  return (
    <FamilyWelcome title="Set up your player profile" profile>
      <p>
        {linked
          ? `Your invitation is connected to ${linked.name}. Your existing games stay with this profile.`
          : "One player profile for every Amberly game. Already on the player list? Ask your superadmin to link your existing player before creating another."}
      </p>
      {state.unresolved ? (
        <div role="status">
          <p>
            Your profile save needs confirmation. Your changes are retained.
          </p>
          <button
            className="button primary"
            disabled={!!state.pending}
            onClick={async () => {
              try {
                await store.retry!();
                await store.refresh!();
                onComplete();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Please retry.");
              }
            }}
          >
            Retry saved profile
          </button>
        </div>
      ) : (
        <PlayerProfileEditor
          key={`${member.playerId ?? newId}-${member.revision}`}
          onboarding
          player={linked ?? { id: newId, name: "" }}
          onClose={onSignOut}
          onSave={async (profile) => {
            await store.administer({
              type: "complete-profile",
              id: linked?.id ?? newId,
              expectedRevision: member.revision ?? 0,
              expectedPlayerRevision: initial.revision,
              profile,
            });
            onComplete();
            return true;
          }}
        />
      )}
      {error && <p role="alert">{error}</p>}
    </FamilyWelcome>
  );
}
