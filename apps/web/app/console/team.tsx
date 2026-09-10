"use client";

import { useState } from "react";
import type { AmazFlowRole } from "@amazflow/workflow-schema";
import { roleLabel } from "./copy";

export type TeamMember = {
  username: string;
  email: string;
  role: AmazFlowRole;
  enabled: boolean;
  /** FORCE_CHANGE_PASSWORD means invited but not yet accepted. */
  userStatus?: string | null;
};

const isPendingInvite = (member: TeamMember) => member.userStatus === "FORCE_CHANGE_PASSWORD";

/**
 * Invite form. A team admin can now add their own people; this used to say "ask your AmazFlow
 * contact", because creating a user was a manual operation in the AWS console.
 *
 * The organization's allowed email domains are enforced by the control plane, and its message is
 * shown verbatim when it refuses -- the domain list is not mirrored here, because a customer admin
 * does not necessarily know it and a wrong guess in the UI would be worse than the real answer.
 */
function InviteRow({ onInvite }: { onInvite: (email: string, role: AmazFlowRole) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AmazFlowRole>("FRONTLINE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const trimmed = email.trim().toLowerCase();
  const looksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onInvite(trimmed, role);
      setSentTo(trimmed);
      setEmail("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="console-invite-bar">
        {sentTo ? (
          <p className="console-invite-sent">
            Invitation sent to <strong>{sentTo}</strong>. They&apos;ll get an email with a temporary
            password.
          </p>
        ) : (
          <span />
        )}
        <button className="console-btn console-btn-primary" onClick={() => setOpen(true)}>
          Invite someone
        </button>
      </div>
    );
  }

  return (
    <div className="console-invite-card">
      <h3>Invite someone to your team</h3>
      <p>
        They&apos;ll receive an email with a temporary password and choose their own the first time
        they sign in.
      </p>
      {error && <div className="console-invite-error">{error}</div>}
      <div className="console-invite-fields">
        <label>
          <span>Email address</span>
          <input
            type="email"
            autoFocus
            value={email}
            placeholder="name@company.com"
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <span>Role</span>
          <select
            value={role}
            disabled={busy}
            onChange={(event) => setRole(event.target.value as AmazFlowRole)}
          >
            <option value="FRONTLINE">Team member — runs the workflows assigned to them</option>
            <option value="CLIENT_ADMIN">Team admin — also manages the team and approvals</option>
          </select>
        </label>
      </div>
      <div className="console-invite-actions">
        <button
          className="console-btn console-btn-primary"
          disabled={!looksLikeEmail || busy}
          onClick={submit}
        >
          {busy ? "Sending…" : "Send invitation"}
        </button>
        <button
          className="console-btn console-btn-quiet"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function TeamScreen({
  members,
  loading,
  error,
  onRetry,
  onSetEnabled,
  onInvite,
}: {
  members: TeamMember[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSetEnabled: (member: TeamMember, enabled: boolean) => Promise<void>;
  onInvite: (email: string, role: AmazFlowRole) => Promise<void>;
}) {
  if (loading) {
    return (
      <div className="console-skeleton">
        <div className="console-skeleton-card" />
        <div className="console-skeleton-card" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="console-error">
        <div className="console-error-icon">!</div>
        <h2>We couldn’t load your team just now.</h2>
        <p>This is usually temporary. Try again in a moment.</p>
        <button className="console-btn console-btn-primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div>
        <h1 className="console-section-title">Your team</h1>
        <div className="console-empty">
          <h2>It&apos;s just you so far.</h2>
          <p>Invite the people who will be running your workflows.</p>
        </div>
        <InviteRow onInvite={onInvite} />
      </div>
    );
  }

  const pending = members.filter(isPendingInvite);

  return (
    <div>
      <h1 className="console-section-title">Your team</h1>
      <InviteRow onInvite={onInvite} />
      {pending.length > 0 && (
        <p className="console-team-pending">
          {pending.length === 1
            ? `${pending[0].email} hasn't signed in yet.`
            : `${pending.length} people haven't signed in yet.`}{" "}
          Their invitation email has the temporary password.
        </p>
      )}
      <table className="console-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Active</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <TeamRow key={member.username} member={member} onSetEnabled={onSetEnabled} />
          ))}
        </tbody>
      </table>
      <p className="console-team-footer">
        Changing someone&apos;s role, or removing them entirely, still needs your AmazFlow contact.
        Switching someone off here blocks their sign-in straight away and can be undone.
      </p>
    </div>
  );
}

function TeamRow({ member, onSetEnabled }: { member: TeamMember; onSetEnabled: (member: TeamMember, enabled: boolean) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const requestToggle = () => {
    if (member.enabled) {
      setConfirming(true);
    } else {
      void apply(true);
    }
  };

  const apply = async (enabled: boolean) => {
    setBusy(true);
    try {
      await onSetEnabled(member, enabled);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className={confirming ? "dimmed" : ""}>
      <td>
        <div>
          {member.email}
          {isPendingInvite(member) && <span className="console-invite-pill">Invited</span>}
        </div>
        {confirming && (
          <div className="console-inline-confirm">
            <span>{member.email} won’t be able to sign in. Toggle back on anytime.</span>
            <button className="console-btn-text" disabled={busy} onClick={() => apply(false)}>
              Confirm
            </button>
            <button className="console-btn-text" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        )}
      </td>
      <td>{roleLabel(member.role)}</td>
      <td>
        <button
          className={`console-toggle ${member.enabled ? "on" : ""}`}
          role="switch"
          aria-checked={member.enabled}
          aria-label={`Active: ${member.email}`}
          onClick={requestToggle}
          disabled={busy || confirming}
        />
      </td>
    </tr>
  );
}
