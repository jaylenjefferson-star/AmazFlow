"use client";

import { useState } from "react";
import type { AmazFlowRole } from "@amazflow/workflow-schema";
import { roleLabel } from "./copy";

export type TeamMember = { username: string; email: string; role: AmazFlowRole; enabled: boolean };

export function TeamScreen({
  members,
  loading,
  error,
  onRetry,
  onSetEnabled,
}: {
  members: TeamMember[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSetEnabled: (member: TeamMember, enabled: boolean) => Promise<void>;
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
      <div className="console-empty">
        <h2>No team members yet.</h2>
        <p>Your AmazFlow contact will help set up your team.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="console-section-title">Your team</h1>
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
      <p className="console-team-footer">Need to add someone? Ask your AmazFlow contact.</p>
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
        <div>{member.email}</div>
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
