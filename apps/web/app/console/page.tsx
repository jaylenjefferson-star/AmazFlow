"use client";

import { useEffect, useState } from "react";
import type { AmazFlowRole, WorkflowDefinition, WorkflowRun } from "@amazflow/workflow-schema";
import { LogoMark } from "../site-components";
import "./console.css";
import { HomeScreen } from "./home";
import { RunDetailScreen } from "./run-detail";
import { TeamScreen, type TeamMember } from "./team";
import { visibleWorkflows } from "./copy";

const API = "https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com";
const COGNITO_DOMAIN = "https://amazflow-dev-398681517793.auth.us-east-1.amazoncognito.com";
const COGNITO_CLIENT_ID = "4cjp4kpmmofnr9gmd3h90i4i2i";

type Session = { idToken: string; sub: string; email: string; role: AmazFlowRole; tenantId: string; expiresAt: number };
type ConsoleWorkflow = WorkflowDefinition & { manualMinutesEstimate?: number; customerSummary?: string };
type View = { kind: "home" } | { kind: "run"; runId: string } | { kind: "team" };

export default function CustomerConsole() {
  const [session, setSession] = useState<Session | null>();
  const [view, setView] = useState<View>({ kind: "home" });

  const [workflows, setWorkflows] = useState<ConsoleWorkflow[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);

  useEffect(() => {
    restoreSession()
      .then((restored) => {
        if (restored?.role === "SUPER_ADMIN") {
          window.location.assign("/app/");
          return;
        }
        setSession(restored);
        if (restored) loadData(restored);
      })
      .catch((err) => {
        setSession(null);
        setDataError(err.message);
      });
  }, []);

  const authGet = async (currentSession: Session, path: string) => {
    const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${currentSession.idToken}` } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
    return body;
  };

  const loadData = async (currentSession: Session) => {
    setDataLoading(true);
    setDataError(null);
    try {
      const [workflowResponse, runResponse]: [ConsoleWorkflow[], WorkflowRun[]] = await Promise.all([
        authGet(currentSession, "/workflows"),
        authGet(currentSession, "/runs"),
      ]);
      // Server-side scoping stops at tenant today -- GET /runs does not yet filter FRONTLINE
      // down to their own runs. Filter client-side using the actor recorded on the run's first
      // audit event until the deployed Lambda gets the same restriction.
      const scopedRuns = currentSession.role === "FRONTLINE" ? runResponse.filter((run) => run.audit?.[0]?.details?.actor === currentSession.sub) : runResponse;
      setWorkflows(visibleWorkflows(workflowResponse, currentSession.role));
      setRuns(scopedRuns.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (err) {
      setDataError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDataLoading(false);
    }
  };

  const loadTeam = async (currentSession: Session) => {
    setTeamLoading(true);
    setTeamError(null);
    try {
      const response: TeamMember[] = await authGet(currentSession, `/tenants/${currentSession.tenantId}/users`);
      setMembers(response);
    } catch (err) {
      setTeamError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setTeamLoading(false);
    }
  };

  useEffect(() => {
    if (session && view.kind === "team" && members.length === 0 && !teamError) {
      loadTeam(session);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, view.kind]);

  const startRun = async (workflow: ConsoleWorkflow, description: string) => {
    if (!session) return;
    const response = await fetch(`${API}/workflows/${workflow.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${session.idToken}` },
      body: JSON.stringify({ description }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
    setRuns((current) => [body, ...current]);
    setView({ kind: "run", runId: body.id });
  };

  const decideApproval = async (run: WorkflowRun, approved: boolean) => {
    if (!session) return;
    const response = await fetch(`${API}/runs/${run.id}/approvals/${run.currentStepId}`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${session.idToken}` },
      body: JSON.stringify({ approved }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
    setRuns((current) => current.map((item) => (item.id === body.id ? body : item)));
  };

  const setMemberEnabled = async (member: TeamMember, enabled: boolean) => {
    if (!session) return;
    const response = await fetch(`${API}/tenants/${session.tenantId}/users/${member.username}/status`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${session.idToken}` },
      body: JSON.stringify({ enabled }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
    setMembers((current) => current.map((item) => (item.username === member.username ? { ...item, enabled } : item)));
  };

  const signOut = () => {
    localStorage.removeItem("amazflow_session");
    setSession(null);
    const target = encodeURIComponent(`${window.location.origin}/console/`);
    window.location.assign(`${COGNITO_DOMAIN}/logout?client_id=${COGNITO_CLIENT_ID}&logout_uri=${target}`);
  };

  if (session === undefined) {
    return (
      <div className="console-app">
        <div className="console-loading">
          <div className="console-signin-logo" style={{ margin: "0 auto 18px" }}>
            <LogoMark size={24} />
          </div>
          <p>Opening your workspace…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="console-app">
        <div className="console-signin">
          <div className="console-signin-card">
            <div className="console-signin-logo">
              <LogoMark size={24} />
            </div>
            <p className="console-eyebrow">YOUR WORKFLOWS</p>
            <h1>
              Everything running.
              <br />
              <mark>Nothing hidden.</mark>
            </h1>
            <p>Sign in to see what AmazFlow is running for your team, what it’s saved you, and what’s waiting on your approval.</p>
            <button className="console-btn console-btn-primary" style={{ width: "100%" }} onClick={beginLogin}>
              Sign in →
            </button>
            <small>Your account was set up by your AmazFlow contact. If you don’t have sign-in details yet, reach out to the person who invited you.</small>
          </div>
        </div>
      </div>
    );
  }

  const activeRun = view.kind === "run" ? runs.find((run) => run.id === view.runId) : undefined;
  const activeWorkflow = activeRun ? workflows.find((workflow) => workflow.id === activeRun.workflowId) : undefined;

  const sectionTitle = view.kind === "team" ? "Your team" : view.kind === "run" ? activeWorkflow?.name ?? "Run" : "Home";

  return (
    <div className="console-app">
      <div className="console-shell">
        <aside className="console-sidebar">
          <a className="console-brand" href="/console/">
            <span>
              <LogoMark size={16} />
            </span>
            AmazFlow
          </a>
          <nav className="console-nav">
            <button className={view.kind === "home" ? "active" : ""} onClick={() => setView({ kind: "home" })}>
              Home
            </button>
            {session.role === "CLIENT_ADMIN" && (
              <button className={view.kind === "team" ? "active" : ""} onClick={() => setView({ kind: "team" })}>
                Team
              </button>
            )}
          </nav>
          <div className="console-identity">
            <div className="console-identity-text">
              <b>{session.email}</b>
              {session.role === "CLIENT_ADMIN" ? "Team admin" : "Team member"}
            </div>
            <button className="console-btn-text" onClick={signOut}>
              Sign out
            </button>
          </div>
        </aside>

        <div>
          <div className="console-mobile-topbar">
            <div className="console-mobile-topbar-left">
              {view.kind === "run" ? (
                <button className="console-mobile-back" aria-label="Back" onClick={() => setView({ kind: "home" })}>
                  ←
                </button>
              ) : (
                <span>
                  <LogoMark size={16} />
                </span>
              )}
              <h2>{sectionTitle}</h2>
            </div>
            {view.kind !== "run" && (
              <button className="console-btn-text" onClick={signOut}>
                Sign out
              </button>
            )}
          </div>

          <main className="console-main">
            {view.kind === "home" && (
              <HomeScreen
                role={session.role}
                workflows={workflows}
                runs={runs}
                loading={dataLoading}
                error={dataError}
                onRetry={() => loadData(session)}
                onStartRun={startRun}
                onOpenRun={(runId) => setView({ kind: "run", runId })}
              />
            )}
            {view.kind === "run" && activeRun && activeWorkflow && (
              <RunDetailScreen
                run={activeRun}
                workflow={activeWorkflow}
                role={session.role}
                onApprove={() => decideApproval(activeRun, true)}
                onSendBack={() => decideApproval(activeRun, false)}
              />
            )}
            {view.kind === "team" && session.role === "CLIENT_ADMIN" && (
              <TeamScreen members={members} loading={teamLoading} error={teamError} onRetry={() => loadTeam(session)} onSetEnabled={setMemberEnabled} />
            )}
          </main>
        </div>
      </div>

      {session.role === "CLIENT_ADMIN" && (
        <nav className="console-tabbar">
          <button className={view.kind === "home" ? "active" : ""} onClick={() => setView({ kind: "home" })}>
            Home
          </button>
          <button className={view.kind === "team" ? "active" : ""} onClick={() => setView({ kind: "team" })}>
            Team
          </button>
        </nav>
      )}
    </div>
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
