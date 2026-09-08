"use client";

import { useEffect, useState } from "react";
import type { AmazFlowRole, WorkflowDefinition, WorkflowRun } from "@amazflow/workflow-schema";

// Phase 3 skeleton: routing, auth, and correctly-scoped data fetching only.
// The real interface (Section 3 of the master build prompt) lands in Phase 4.

const API = "https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com";
const COGNITO_DOMAIN = "https://amazflow-dev-398681517793.auth.us-east-1.amazoncognito.com";
const COGNITO_CLIENT_ID = "4cjp4kpmmofnr9gmd3h90i4i2i";

type Session = { idToken: string; sub: string; email: string; role: AmazFlowRole; tenantId: string; expiresAt: number };

export default function CustomerConsole() {
  const [session, setSession] = useState<Session | null>();
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    restoreSession()
      .then((restored) => {
        if (restored?.role === "SUPER_ADMIN") {
          window.location.assign("/app/");
          return;
        }
        setSession(restored);
        if (restored) loadData(restored).catch((err) => setError(err.message));
      })
      .catch((err) => {
        setSession(null);
        setError(err.message);
      });
  }, []);

  const loadData = async (currentSession: Session) => {
    const authGet = async (path: string) => {
      const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${currentSession.idToken}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      return body;
    };
    const [workflowResponse, runResponse]: [WorkflowDefinition[], WorkflowRun[]] = await Promise.all([authGet("/workflows"), authGet("/runs")]);
    // Server-side scoping stops at tenant today -- GET /runs does not yet filter FRONTLINE
    // down to their own runs (that check only exists in the never-deployed local server).
    // Filter client-side here using the actor recorded on the run's first audit event until
    // the deployed Lambda gets the same restriction.
    const visibleRuns = currentSession.role === "FRONTLINE" ? runResponse.filter((run) => run.audit?.[0]?.details?.actor === currentSession.sub) : runResponse;
    setWorkflows(workflowResponse.filter((workflow) => workflow.status !== "draft"));
    setRuns(visibleRuns);
    setError(null);
  };

  const signOut = () => {
    localStorage.removeItem("amazflow_session");
    setSession(null);
    const target = encodeURIComponent(`${window.location.origin}/console/`);
    window.location.assign(`${COGNITO_DOMAIN}/logout?client_id=${COGNITO_CLIENT_ID}&logout_uri=${target}`);
  };

  if (session === undefined) return <main><p>Opening your workspace…</p></main>;
  if (!session) return <main><button onClick={beginLogin}>Sign in</button></main>;

  return (
    <main>
      <p>
        Signed in as {session.email} ({session.role}, tenant {session.tenantId}) <button onClick={signOut}>Sign out</button>
      </p>
      {error && <p>Error: {error}</p>}
      <h2>Workflows</h2>
      <ul>
        {workflows.map((workflow) => (
          <li key={workflow.id}>
            {workflow.name} — {workflow.status}
          </li>
        ))}
      </ul>
      <h2>Runs</h2>
      <ul>
        {runs.map((run) => (
          <li key={run.id}>
            {run.id} — {run.status}
          </li>
        ))}
      </ul>
    </main>
  );
}

async function beginLogin() {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = base64Url(bytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64Url(new Uint8Array(digest));
  sessionStorage.setItem("amazflow_pkce", verifier);
  const params = new URLSearchParams({ client_id: COGNITO_CLIENT_ID, response_type: "code", scope: "openid email profile", redirect_uri: `${window.location.origin}/console/`, code_challenge_method: "S256", code_challenge: challenge });
  window.location.assign(`${COGNITO_DOMAIN}/oauth2/authorize?${params}`);
}

async function restoreSession(): Promise<Session | null> {
  const code = new URLSearchParams(window.location.search).get("code");
  if (code) {
    const verifier = sessionStorage.getItem("amazflow_pkce");
    if (!verifier) throw new Error("Sign-in session expired. Please try again.");
    const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: COGNITO_CLIENT_ID, code, redirect_uri: `${window.location.origin}/console/`, code_verifier: verifier }) });
    const tokens = await response.json();
    if (!response.ok || !tokens.id_token) throw new Error(tokens.error_description ?? "Unable to complete sign in");
    const next = sessionFromToken(tokens.id_token);
    localStorage.setItem("amazflow_session", JSON.stringify(next));
    sessionStorage.removeItem("amazflow_pkce");
    window.history.replaceState({}, "", "/console/");
    return next;
  }
  const stored = localStorage.getItem("amazflow_session");
  if (!stored) return null;
  const parsed = JSON.parse(stored) as Session;
  if (parsed.expiresAt < Date.now()) {
    localStorage.removeItem("amazflow_session");
    return null;
  }
  return parsed;
}

function sessionFromToken(idToken: string): Session {
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0))));
  const groups = (claims["cognito:groups"] ?? []) as string[];
  const role = (["SUPER_ADMIN", "CLIENT_ADMIN", "FRONTLINE"] as AmazFlowRole[]).find((candidate) => groups.includes(candidate));
  if (!role) throw new Error("This account does not have an AmazFlow access role.");
  return { idToken, sub: claims.sub, email: claims.email, role, tenantId: claims["custom:tenant_id"] ?? "amazflow", expiresAt: Number(claims.exp) * 1000 };
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
