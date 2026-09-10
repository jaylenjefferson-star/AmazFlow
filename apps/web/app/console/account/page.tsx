"use client";

// Account self-service: the surface where a person changes their own password and ends their own
// sessions.
//
// Why this is its own page rather than a section of /console/settings/: that page is gated on
// CLIENT_ADMIN, because organization branding and time zone are an administrator's business. A
// password is not. A FRONTLINE user routed to an admin-gated page to change their password simply
// never can -- and the only alternative on offer today is asking an administrator, which is exactly
// the operator-sets-a-customer-password path requirement 12.2 forbids. So this page is gated on
// nothing but being signed in (anySignedInSurface), and staff land here too rather than being
// bounced to /app.
//
// The change itself goes through changeOwnPassword(), which authorizes with the caller's own access
// token plus their current password. There is deliberately no control-plane route behind this: the
// control plane holds AdminSetUserPassword-shaped power and never exposes it, so no operator and no
// staff member can set a customer's password at all.

import { useEffect, useState } from "react";
import { LogoMark } from "../../site-components";
import {
  AuthError,
  type Session,
  changeOwnPassword,
  signOut,
  signOutEverywhere,
} from "../../lib/cognito-auth";
import { anySignedInSurface, enforceSessionAccess, isStaff } from "../../lib/session-gate";
import "../../auth.css";
import "../console.css";

// Mirrors the user pool's own policy (infrastructure/aws-cdk/amazflow-dev.yaml: MinimumLength 12,
// lower + upper + number + symbol). Checked here so a person learns what is wrong before a round
// trip, not instead of the server check -- Cognito remains the authority.
const RULES: { label: string; ok: (value: string) => boolean }[] = [
  { label: "At least 12 characters", ok: (v) => v.length >= 12 },
  { label: "A lowercase letter", ok: (v) => /[a-z]/.test(v) },
  { label: "An uppercase letter", ok: (v) => /[A-Z]/.test(v) },
  { label: "A number", ok: (v) => /\d/.test(v) },
  { label: "A symbol", ok: (v) => /[^A-Za-z0-9]/.test(v) },
];

export default function AccountPage() {
  const [session, setSession] = useState<Session | null>();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    enforceSessionAccess(anySignedInSurface("/console/account/")).then((allowed) => {
      if (allowed) setSession(allowed);
    });
  }, []);

  const unmet = RULES.filter((rule) => !rule.ok(next));
  const mismatch = confirm.length > 0 && next !== confirm;
  const submittable =
    !saving && current.length > 0 && next.length > 0 && unmet.length === 0 && !mismatch;

  const submit = async () => {
    if (!session || !submittable) return;
    setSaving(true);
    setError(null);
    setChanged(false);
    try {
      await changeOwnPassword(session, current, next);
      setChanged(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      // Cognito distinguishes "your current password is wrong" (NotAuthorizedException) from "the
      // new one is not acceptable" (InvalidPasswordException). Both are things the person can fix,
      // and telling them which one it is costs nothing: they already hold the account.
      const message =
        err instanceof AuthError && err.code === "NotAuthorizedException"
          ? "That current password is not right. Try again."
          : err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (!session) {
    return (
      <div className="auth-standalone">
        <div className="console-loading">
          <div className="console-signin-logo" style={{ margin: "0 auto 18px" }}>
            <LogoMark size={24} />
          </div>
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  const home = isStaff(session) ? "/app/" : "/console/";

  return (
    <div className="auth-standalone">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <a
          className="auth-card-mobile-brand"
          href={home}
          style={{ display: "flex", marginBottom: 20 }}
        >
          <span>
            <LogoMark size={16} />
          </span>
          Your account
        </a>

        <h2>Your account</h2>
        <p className="auth-lede" style={{ marginBottom: 20 }}>
          Signed in as <strong>{session.email}</strong> · {session.tenantId}
        </p>

        {error && (
          <div className="auth-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}
        {changed && (
          <div className="auth-success" style={{ marginBottom: 16 }}>
            ✓ Your password has been changed. Other devices stay signed in until you sign them out
            below.
          </div>
        )}

        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Change your password</h3>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="auth-field">
            <label htmlFor="current-password">Current password</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              disabled={saving}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              disabled={saving}
            />
            {next.length > 0 && unmet.length > 0 && (
              <small
                style={{ color: "var(--muted)", fontSize: 12, marginTop: 6, display: "block" }}
              >
                Still needed: {unmet.map((rule) => rule.label.toLowerCase()).join(", ")}
              </small>
            )}
          </div>

          <div className="auth-field">
            <label htmlFor="confirm-password">Confirm new password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              disabled={saving}
            />
            {mismatch && (
              <small style={{ color: "var(--danger)", fontSize: 12, marginTop: 6, display: "block" }}>
                These two do not match.
              </small>
            )}
          </div>

          <button className="auth-submit" type="submit" disabled={!submittable}>
            {saving ? "Changing…" : "Change password"}
          </button>
        </form>

        <div className="support-or" style={{ margin: "26px 0 18px" }}>
          <span>sessions</span>
        </div>

        {/* Two distinct actions, deliberately not merged: signing out of this browser is the
            everyday case, and revoking everywhere is what someone reaches for when they think a
            session is somewhere it should not be. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            className="auth-submit"
            type="button"
            style={{ background: "transparent", border: "1px solid var(--line)", color: "inherit" }}
            onClick={() => void signOut(session)}
          >
            Sign out of this browser
          </button>
          <button
            className="auth-submit"
            type="button"
            style={{ background: "transparent", border: "1px solid var(--line)", color: "inherit" }}
            onClick={() => void signOutEverywhere(session)}
          >
            Sign out everywhere
          </button>
          <small style={{ color: "var(--muted)", fontSize: 12 }}>
            Signing out everywhere ends every session on every device, including this one.
          </small>
        </div>

        <p style={{ marginTop: 22, fontSize: 13 }}>
          <a href={home}>← Back to your workspace</a>
        </p>
      </div>
    </div>
  );
}
