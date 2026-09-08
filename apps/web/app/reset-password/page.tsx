"use client";

import { useState } from "react";
import Link from "next/link";
import { LogoMark } from "../site-components";
import { AuthError, confirmPasswordReset } from "../lib/cognito-auth";
import "../auth.css";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await confirmPasswordReset(email.trim(), code.trim(), newPassword);
      setDone(true);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-standalone">
      <div className="auth-card" style={{ background: "var(--paper)", border: "1.5px solid var(--ink)", borderRadius: 24, padding: "36px 32px", boxShadow: "8px 8px 0 var(--ink)" }}>
        <a className="auth-card-mobile-brand" href="/" style={{ display: "flex" }}>
          <span>
            <LogoMark size={16} />
          </span>
          AmazFlow
        </a>

        {done ? (
          <>
            <div className="auth-success">Your password has been reset.</div>
            <h2>You’re all set</h2>
            <p className="auth-lede">Sign in with your new password.</p>
            <Link href="/login" className="auth-submit" style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>
              Sign in →
            </Link>
          </>
        ) : (
          <>
            <h2>Set a new password</h2>
            <p className="auth-lede">Enter the code we emailed you along with your new password.</p>
            {error && <div className="auth-error">{error}</div>}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div className="auth-field">
                <label htmlFor="reset-email">Work email</label>
                <input id="reset-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
              <div className="auth-field">
                <label htmlFor="reset-code">Reset code</label>
                <input id="reset-code" type="text" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(event) => setCode(event.target.value)} />
              </div>
              <div className="auth-field">
                <label htmlFor="reset-new-password">New password</label>
                <input
                  id="reset-new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </div>
              <button className="auth-submit" type="submit" disabled={busy}>
                {busy ? "Resetting…" : "Reset password"}
              </button>
            </form>
          </>
        )}

        <div className="auth-links" style={{ justifyContent: "center", marginTop: 20 }}>
          <Link href="/login">← Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
