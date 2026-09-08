"use client";

import { useState } from "react";
import Link from "next/link";
import { LogoMark } from "../site-components";
import { AuthError, requestPasswordReset } from "../lib/cognito-auth";
import "../auth.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      // Cognito's own PreventUserExistenceErrors keeps this from revealing whether the email
      // exists -- a nonexistent email still returns success here, matching that behavior.
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

        {sent ? (
          <>
            <h2>Check your email</h2>
            <p className="auth-lede">If an AmazFlow account exists for {email.trim() || "that address"}, we’ve sent a code to reset your password.</p>
            <Link href="/reset-password" className="auth-submit" style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>
              I have my code →
            </Link>
          </>
        ) : (
          <>
            <h2>Reset your password</h2>
            <p className="auth-lede">Enter your work email and we’ll send you a reset code.</p>
            {error && <div className="auth-error">{error}</div>}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div className="auth-field">
                <label htmlFor="forgot-email">Work email</label>
                <input id="forgot-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
              <button className="auth-submit" type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send reset code"}
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
