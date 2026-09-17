"use client";
import { useState } from "react";
import {
  MEMBER_PERMISSIONS,
  memberPermissionDefaults,
} from "../lib/member-permissions";
import type { FamilyMember, SharedOperation } from "../lib/shared-contract";
import type { SavedPlayer } from "../lib/preview-store";
import "./member-permissions.css";

export function MemberPermissions({
  member,
  players,
  working,
  stale,
  onSave,
  onCancel,
}: {
  member: FamilyMember;
  players: SavedPlayer[];
  working: boolean;
  stale: boolean;
  onSave: (op: SharedOperation) => Promise<void>;
  onCancel: () => void;
}) {
  const [role, setRole] = useState(member.role);
  const [active, setActive] = useState(member.active);
  const [playerId, setPlayerId] = useState(member.playerId ?? "");
  const [permissions, setPermissions] = useState(() => ({
    ...memberPermissionDefaults(),
    ...member.permissions,
  }));
  const [reason, setReason] = useState("");
  const fullAccess = role === "superadmin";
  return (
    <form
      className="member-permissions"
      onSubmit={(e) => {
        e.preventDefault();
        if (working || stale || member.revision === undefined) return;
        void onSave({
          type: "update-member",
          userId: member.userId,
          role,
          active,
          playerId: playerId || null,
          reason: reason.trim(),
          permissions,
          expectedRevision: member.revision,
        });
      }}
    >
      <div className="permissions-person">
        <span className="eyebrow">Access for</span>
        <h3>
          {players.find((p) => p.id === member.playerId)?.name ??
            "Family member"}
        </h3>
        <p>{member.email}</p>
      </div>
      {stale && (
        <p role="alert" className="error-banner">
          Access changed elsewhere. Go back and reopen this person to review the
          latest settings. Your changes have not been saved.
        </p>
      )}
      {member.revision === undefined && (
        <p role="alert">
          Reload after the permissions update is available before changing
          access.
        </p>
      )}
      <fieldset disabled={working}>
        <label className="permission-switch permission-access">
          <span>
            <strong>Account access</strong>
            <small>
              {active
                ? "Can sign in and view shared games."
                : "Sign-in access is suspended. Their history is kept."}
            </small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            aria-label="Account access"
          />
        </label>
        <details className="permissions-account-details">
          <summary>
            Role &amp; player profile{" "}
            <span>{fullAccess ? "Superadmin" : "Member"}</span>
          </summary>
          <div className="permissions-identity">
            <label className="field">
              Role
              <select
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as FamilyMember["role"])
                }
              >
                <option value="member">Member</option>
                <option value="superadmin">Superadmin</option>
              </select>
            </label>
            <label className="field">
              Player profile
              <select
                value={playerId}
                onChange={(e) => setPlayerId(e.target.value)}
              >
                <option value="">No linked player</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        {fullAccess && (
          <p className="permissions-note">
            Superadmins have every capability below. Choose Member to customize
            individual permissions.
          </p>
        )}
        {!active && (
          <p className="permissions-note">
            These settings will apply if account access is restored.
          </p>
        )}
        {["Everyday play", "Extra trust"].map((group) => (
          <section key={group} className="permission-group" aria-label={group}>
            <h4>{group}</h4>
            {MEMBER_PERMISSIONS.filter((p) => p.group === group).map((p) => (
              <label key={p.key} className="permission-switch">
                <span>
                  <strong>{p.label}</strong>
                  <small>{p.description}</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={p.label}
                  checked={fullAccess || permissions[p.key]}
                  disabled={fullAccess}
                  onChange={(e) =>
                    setPermissions((v) => ({ ...v, [p.key]: e.target.checked }))
                  }
                />
              </label>
            ))}
          </section>
        ))}
        <p className="permissions-note">
          Everyone with access can view shared games and report concerns. Only
          superadmins can create, view or delete practice games, change account
          access and open the internal audit archive. Final scores and games
          that count toward records stay protected.
        </p>
        <label className="field">
          Reason for change
          <input
            value={reason}
            required
            maxLength={240}
            placeholder="e.g. Let Nate score and manage tile sets"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </fieldset>
      <div className="dialog-actions permissions-actions">
        <button
          type="button"
          className="button light"
          disabled={working}
          onClick={onCancel}
        >
          Back to members
        </button>
        <button
          className="button primary"
          disabled={
            working || stale || !reason.trim() || member.revision === undefined
          }
        >
          {working ? "Saving…" : "Save permissions"}
        </button>
      </div>
    </form>
  );
}
