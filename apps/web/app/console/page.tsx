"use client";

import { useEffect, useState } from "react";
import type { WorkflowDefinition, WorkflowRun } from "@amazflow/workflow-schema";
import { LogoMark } from "../site-components";
import "./console.css";
import { HomeScreen } from "./home";
import { RunDetailScreen } from "./run-detail";
import { TeamScreen, type TeamMember } from "./team";
import { visibleWorkflows } from "./copy";
import { API, type Session, signOut as authSignOut, guardBFCacheRestore, resolveSession } from "../lib/cognito-auth";

type ConsoleWorkflow = WorkflowDefinition & { manualMinutesEstimate?: number; customerSummary?: string };
type View = { kind: "home" } | { kind: "run"; runId: string } | { kind: "team" };

// Real URL-addressable views without a Next.js dynamic route: this app is a static export
// (next.config output:'export', no server and no configured Amplify rewrite rule for arbitrary
// sub-paths), so a hard reload of /console/runs/<id>/ has nowhere to resolve to -- only the
// prebuilt /console/ page exists as a real static file. pushState/popstate instead gives real
// browser back/forward and a URL that reflects the current view for anything reached by
// navigating within a live session (sharing/bookmarking a run link still needs the recipient to
// land on /console/ first, then follow through -- documented as a known limitation, not silently
// dropped).
function viewToPath(view: View): string {
  if (view.kind === "team") return "/console/team/";
  if (view.kind === "run") return `/console/runs/${view.runId}/`;
  return "/console/";
}

function pathToView(pathname: string): View {
  const runMatch = pathname.match(/^\/console\/runs\/([^/]+)\/?$/);
  if (runMatch) return { kind: "run", runId: runMatch[1] };
  if (/^\/console\/team\/?$/.test(pathname)) return { kind: "team" };
  return { kind: "home" };
}

export default function CustomerConsole() {
  const [session, setSession] = useState<Session | null>();
  const [view, setViewState] = useState<View>({ kind: "home" });

  const setView = (next: View) => {
    setViewState(next);
    const path = viewToPath(next);
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
  };

  useEffect(() => {
    const onPopState = () => setViewState(pathToView(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const [workflows, setWorkflows] = useState<ConsoleWorkflow[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [draftResume, setDraftResume] = useState<{ workflowId: string; text: string } | null>(null);

  useEffect(() => guardBFCacheRestore(), []);

  useEffect(() => {
    const hadStoredSession = Boolean(localStorage.getItem("amazflow_session"));
    resolveSession().then((restored) => {
      if (!restored) {
        const reason = hadStoredSession ? "&reason=expired" : "";
        window.location.assign(`/login?next=${encodeURIComponent("/console/")}${reason}`);
        return;
      }
      if (restored.role === "SUPER_ADMIN") {
        window.location.assign("/app/");
        return;
      }
      setSession(restored);
      setViewState(pathToView(window.location.pathname));
      loadData(restored);
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
      setWorkflows(visibleWorkflows(workflowResponse, currentSession.role));
      setRuns(runResponse.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
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

  const postAction = async (path: string, body?: unknown) => {
    if (!session) throw new Error("Sign in required");
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${session.idToken}` },
      body: JSON.stringify(body ?? {}),
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(responseBody.error ?? `Request failed (${response.status})`);
    setRuns((current) => current.map((item) => (item.id === responseBody.id ? responseBody : item)));
    return responseBody as WorkflowRun;
  };

  const confirmRun = async (run: WorkflowRun) => {
    if (!run.currentStepId) return;
    await postAction(`/runs/${run.id}/confirmations/${run.currentStepId}/confirm`);
  };

  const cancelRun = async (run: WorkflowRun) => {
    await postAction(`/runs/${run.id}/cancel`);
  };

  // "Let me fix this": the run already exists but no irreversible action has run yet (it's
  // still AWAITING_CONFIRMATION) -- cancel it outright rather than leaving a stale confirmation
  // that could later authorize a materially different, re-edited request, then hand the
  // customer's original free text back to the composer so they can edit and resubmit fresh.
  const fixRequest = async (run: WorkflowRun) => {
    await cancelRun(run);
    const originalText = typeof (run.context as { input?: { description?: unknown } } | undefined)?.input?.description === "string" ? (run.context as { input: { description: string } }).input.description : "";
    setDraftResume({ workflowId: run.workflowId, text: originalText });
    setView({ kind: "home" });
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

  const signOut = async () => {
    await authSignOut(session);
  };

  if (!session) {
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
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {session.role === "CLIENT_ADMIN" && (
              <a
                href="/console/settings/"
                style={{
                  display: "block",
                  padding: "10px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--muted)",
                  textDecoration: "none",
                }}
              >
                Organization settings
              </a>
            )}
            <a
              href="/console/support/"
              style={{
                display: "block",
                padding: "10px 16px",
                fontSize: 13,
                fontWeight: 700,
                color: "var(--muted)",
                textDecoration: "none",
              }}
            >
              Get help
            </a>
          </div>
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
                draftResume={draftResume}
                onDraftConsumed={() => setDraftResume(null)}
              />
            )}
            {view.kind === "run" && activeRun && activeWorkflow && (
              <RunDetailScreen
                run={activeRun}
                workflow={activeWorkflow}
                role={session.role}
                currentUserId={session.sub}
                onApprove={() => decideApproval(activeRun, true)}
                onSendBack={() => decideApproval(activeRun, false)}
                onConfirm={() => confirmRun(activeRun)}
                onFixRequest={() => fixRequest(activeRun)}
                onCancelRun={() => cancelRun(activeRun)}
              />
            )}
            {view.kind === "run" && !activeRun && !dataLoading && (
              <NotFoundScreen onBackHome={() => setView({ kind: "home" })} />
            )}
            {view.kind === "team" && session.role === "CLIENT_ADMIN" && (
              <TeamScreen members={members} loading={teamLoading} error={teamError} onRetry={() => loadTeam(session)} onSetEnabled={setMemberEnabled} />
            )}
            {view.kind === "team" && session.role !== "CLIENT_ADMIN" && <NotFoundScreen onBackHome={() => setView({ kind: "home" })} />}
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

function NotFoundScreen({ onBackHome }: { onBackHome: () => void }) {
  return (
    <div className="console-empty">
      <h2>We couldn’t find that page.</h2>
      <button className="console-btn console-btn-primary" onClick={onBackHome}>
        Back to Home
      </button>
    </div>
  );
}

