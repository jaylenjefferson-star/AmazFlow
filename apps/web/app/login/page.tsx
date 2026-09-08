"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogoMark, WorkflowVisual } from "../site-components";
import type { AmazFlowRole } from "@amazflow/workflow-schema";
import { AuthError, completeNewPassword, loadSession, loginPathFor, saveSession, signIn } from "../lib/cognito-auth";
import "../auth.css";

function redirectAfterSignIn(role: AmazFlowRole, next: string | null) {
  const target = next && (next.startsWith("/app") || next.startsWith("/console")) ? next : loginPathFor(role);
  window.location.assign(target);
}

export default function LoginPage() {
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<{ session: string; email: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [expiredNotice, setExpiredNotice] = useState(false);
  const [nextPath, setNextPath] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setExpiredNotice(params.get("reason") === "expired");
    setNextPath(params.get("next"));
    const existing = loadSession();
    if (existing) {
      redirectAfterSignIn(existing.role, params.get("next"));
      return;
    }
    setChecking(false);
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(email.trim(), password);
      if (result.kind === "new_password_required") {
        setChallenge({ session: result.session, email: result.email });
      } else {
        saveSession(result.session);
        redirectAfterSignIn(result.session.role, nextPath);
      }
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitNewPassword = async () => {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const session = await completeNewPassword(challenge.email, newPassword, challenge.session);
      saveSession(session);
      redirectAfterSignIn(session.role, nextPath);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Couldn’t set your password. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <div className="auth-standalone">
        <p style={{ color: "var(--muted)" }}>Opening your workspace…</p>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-left">
        <a className="auth-brand" href="/">
          <span>
            <LogoMark size={18} />
          </span>
          AmazFlow
        </a>
        <h1>
          Everything running.
          <br />
          <mark>Nothing hidden.</mark>
        </h1>
        <p>Sign in to manage workflows, review approvals, and see exactly what AmazFlow completed.</p>
        <WorkflowVisual />
      </div>

      <div className="auth-right">
        <div className="auth-card">
          <a className="auth-card-mobile-brand" href="/">
            <span>
              <LogoMark size={16} />
            </span>
            AmazFlow
          </a>

          {!challenge ? (
            <>
              <h2>{expiredNotice ? "Your session expired" : "Welcome back"}</h2>
              <p className="auth-lede">{expiredNotice ? "For your security, please sign in again." : "Sign in to your AmazFlow workspace."}</p>
              {error && <div className="auth-error">{error}</div>}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                <div className="auth-field">
                  <label htmlFor="login-email">Work email</label>
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div className="auth-field">
                  <label htmlFor="login-password">Password</label>
                  <input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
                <button className="auth-submit" type="submit" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </button>
              </form>
              <div className="auth-links">
                <Link href="/forgot-password">Forgot password?</Link>
                <span />
              </div>
            </>
          ) : (
            <>
              <h2>Set your password</h2>
              <p className="auth-lede">Your account was just created. Choose a password to finish setting up your workspace.</p>
              {error && <div className="auth-error">{error}</div>}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submitNewPassword();
                }}
              >
                <div className="auth-field">
                  <label htmlFor="new-password">New password</label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                </div>
                <button className="auth-submit" type="submit" disabled={busy}>
                  {busy ? "Setting up…" : "Set password and sign in"}
                </button>
              </form>
            </>
          )}

          <div className="auth-footer-links">
            <a href="/privacy">Privacy</a>
            <a href="/security">Security</a>
            <a href="/terms">Terms</a>
          </div>
        </div>
      </div>
    </div>
  );
}
