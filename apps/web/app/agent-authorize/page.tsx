"use client";

import { useEffect, useState } from "react";
import { LogoMark } from "../site-components";
import { API, type Session, resolveSession } from "../lib/cognito-auth";
import "../auth.css";

// Opened by the AmazFlow Agent Chrome extension's "Connect to AmazFlow" button, in a normal
// authenticated browser tab -- the extension never sees the human's Cognito session. Once
// authorized, the resulting one-time code is pushed into this same tab's URL via
// history.replaceState (?code=...), which the extension's background service worker observes
// via chrome.tabs.onUpdated on the specific tab it opened, then exchanges server-side for an
// agent-scoped credential. No token is ever pasted or copied by hand.

type Step = "loading" | "signed_out" | "form" | "authorizing" | "done" | "error";

export default function AgentAuthorizePage() {
  const [step, setStep] = useState<Step>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [name, setName] = useState("Browser Agent");
  const [error, setError] = useState<string | null>(null);
  const [agentName, setAgentName] = useState("");

  useEffect(() => {
    resolveSession().then((restored) => {
      if (!restored) {
        setStep("signed_out");
        return;
      }
      if (restored.role === "FRONTLINE") {
        setError("Only a team admin or AmazFlow administrator can authorize a Browser Agent.");
        setStep("error");
        return;
      }
      setSession(restored);
      setStep("form");
    });
  }, []);

  const authorize = async () => {
    if (!session) return;
    setStep("authorizing");
    setError(null);
    try {
      const response = await fetch(`${API}/agent-authorizations`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${session.idToken}` },
        body: JSON.stringify({ name: name.trim() || "Browser Agent" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      setAgentName(body.agent.name);
      window.history.replaceState(null, "", `/agent-authorize/?code=${encodeURIComponent(body.code)}`);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setStep("form");
    }
  };

  return (
    <div className="auth-standalone">
      <div className="auth-status-card" style={{ textAlign: step === "form" ? "left" : "center" }}>
        <div className="auth-status-icon" style={{ margin: step === "form" ? "0 0 20px" : "0 auto 20px" }}>
          <LogoMark size={24} />
        </div>

        {step === "loading" && <p style={{ color: "var(--muted)" }}>Loading…</p>}

        {step === "signed_out" && (
          <>
            <h1>Sign in required</h1>
            <p>Sign in to authorize the AmazFlow Agent for your workspace.</p>
            <a className="auth-submit" href={`/login?next=${encodeURIComponent("/agent-authorize/")}`} style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>
              Sign in →
            </a>
          </>
        )}

        {step === "error" && (
          <>
            <h1>Can’t authorize this agent</h1>
            <p>{error}</p>
          </>
        )}

        {(step === "form" || step === "authorizing") && session && (
          <>
            <h1 style={{ textAlign: "left" }}>Authorize AmazFlow Agent</h1>
            <p style={{ textAlign: "left" }}>Review before connecting this browser to your AmazFlow workspace.</p>
            <div className="auth-interpretation-details" style={{ display: "grid", gap: 10, margin: "16px 0", padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", textAlign: "left" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ color: "var(--muted)" }}>Organization</span>
                <b>{session.tenantId}</b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ color: "var(--muted)" }}>Authorized by</span>
                <b>{session.email}</b>
              </div>
            </div>
            <div className="auth-field">
              <label htmlFor="agent-name">Agent name</label>
              <input id="agent-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. People Operations Agent" />
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "left", marginBottom: 16 }}>
              This agent will only be able to act on sites you explicitly enable from its extension popup, one site at a time, and only for workflow steps assigned to it. You can revoke it anytime from Agents in the AmazFlow console.
            </p>
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-submit" onClick={authorize} disabled={step === "authorizing"}>
              {step === "authorizing" ? "Authorizing…" : "Authorize agent"}
            </button>
          </>
        )}

        {step === "done" && (
          <>
            <h1>Connected</h1>
            <p>
              “{agentName}” is now authorized. If the extension doesn’t pick this up automatically within a few seconds, you can close this tab and check its popup.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
