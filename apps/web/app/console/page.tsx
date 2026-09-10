"use client";

import { useEffect, useState } from "react";
import type { AmazFlowRole, WorkflowDefinition, WorkflowRun } from "@amazflow/workflow-schema";
import { LogoMark } from "../site-components";
import "./console.css";
import { HomeScreen } from "./home";
import { RunDetailScreen } from "./run-detail";
import { TeamScreen, type TeamMember } from "./team";
import { visibleWorkflows } from "./copy";
import { type Session, signOut as authSignOut, guardBFCacheRestore } from "../lib/cognito-auth";
import { apiCall } from "../lib/api-client";
import { customerSurface, enforceSessionAccess } from "../lib/session-gate";

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
    enforceSessionAccess(customerSurface("/console/", { staffPath: "/app/" })).then((allowed) => {
      if (!allowed) return;
      setSession(allowed);
      setViewState(pathToView(window.location.pathname));
      loadData(allowed);
    });
  }, []);

  // Every control-plane call on this surface goes through apiCall(), which is what makes the
  // session lifecycle actually work: one refresh attempt on an expired id token before giving up,
  // and a forced sign-out when the account has been deactivated mid-session. Calling fetch()
  // directly -- as this file used to -- meant a refreshable session showed "Something went wrong"
  // and a deactivated account kept rendering a workspace it no longer had.
  //
  // onSessionRenewed lifts the renewed session into state so the NEXT call uses the new token
  // rather than refreshing again.
  const call = <T,>(currentSession: Session, path: string, options: { method?: string; body?: unknown } = {}) =>
    apiCall<T>(currentSession, path, { ...options, onSessionRenewed: setSession });

  const authGet = <T,>(currentSession: Session, path: string) => call<T>(currentSession, path);

  const loadData = async (currentSession: Session) => {
    setDataLoading(true);
    setDataError(null);
    try {
      const [workflowResponse, runResponse] = await Promise.all([
        authGet<ConsoleWorkflow[]>(currentSession, "/workflows"),
        authGet<WorkflowRun[]>(currentSession, "/runs"),
      ]);
      setWorkflows(visibleWorkflows(workflowResponse, currentSession.role));
      setRuns(runResponse.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (err) {
      setDataError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDataLoading(false);
    }
  };

  /**
   * `background` re-reads the team without showing the loading skeleton.
   *
   * The skeleton replaces the whole team screen, which unmounts the invite form along with it. A
   * refresh after a successful invitation would therefore blank the screen the admin is looking at
   * and throw away the "invitation sent" confirmation they had just earned. A refresh of something
   * already on screen should not look like a first load.
   */
  const loadTeam = async (currentSession: Session, background = false) => {
    if (!background) setTeamLoading(true);
    setTeamError(null);
    try {
      const response = await authGet<TeamMember[]>(currentSession, `/tenants/${currentSession.tenantId}/users`);
      setMembers(response);
    } catch (err) {
      setTeamError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      if (!background) setTeamLoading(false);
    }
  };

  useEffect(() => {
    // The team list also feeds the getting-started checklist on Home, so a team admin loads it
    // on arrival rather than only when they open the Team tab. Restricted to CLIENT_ADMIN because
    // the route refuses a frontline caller.
    if (session && session.role === "CLIENT_ADMIN" && members.length === 0 && !teamError) {
      loadTeam(session);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, view.kind]);

  const startRun = async (workflow: ConsoleWorkflow, description: string) => {
    if (!session) return;
    const body = await call<WorkflowRun>(session, `/workflows/${workflow.id}/runs`, {
      method: "POST",
      body: { description },
    });
    setRuns((current) => [body, ...current]);
    setView({ kind: "run", runId: body.id });
  };

  const postAction = async (path: string, body?: unknown) => {
    if (!session) throw new Error("Sign in required");
    const responseBody = await call<WorkflowRun>(session, path, { method: "POST", body: body ?? {} });
    setRuns((current) => current.map((item) => (item.id === responseBody.id ? responseBody : item)));
    return responseBody;
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
    const body = await call<WorkflowRun>(session, `/runs/${run.id}/approvals/${run.currentStepId}`, {
      method: "POST",
      body: { approved },
    });
    setRuns((current) => current.map((item) => (item.id === body.id ? body : item)));
  };

  const setMemberEnabled = async (member: TeamMember, enabled: boolean) => {
    if (!session) return;
    await call(session, `/tenants/${session.tenantId}/users/${member.username}/status`, {
      method: "POST",
      body: { enabled },
    });
    setMembers((current) => current.map((item) => (item.username === member.username ? { ...item, enabled } : item)));
  };

  const inviteMember = async (email: string, role: AmazFlowRole) => {
    if (!session) throw new Error("Sign in required");
    // The control plane's message is shown as-is: it knows why it refused (an address outside the
    // allowed domains, someone who already has an account) and paraphrasing it here would lose
    // the reason. apiCall() surfaces that message on ApiError.message.
    await call(session, `/tenants/${session.tenantId}/users`, { method: "POST", body: { email, role } });
    // Re-read rather than appending the response: the list is the source of truth for who is a
    // member, and an invitation that half-succeeded must not appear as though it worked. Done in
    // the background so the screen -- and the confirmation the admin just earned -- survives it.
    await loadTeam(session, true);
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
            {/* Outside the CLIENT_ADMIN branch above on purpose: every role has an account, and
                changing your own password is the one thing nobody should need an administrator
                for. */}
            <a
              href="/console/account/"
              style={{
                display: "block",
                padding: "10px 16px",
                fontSize: 13,
                fontWeight: 700,
                color: "var(--muted)",
                textDecoration: "none",
              }}
            >
              Your account
            </a>
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
                teamSize={members.length}
                onOpenTeam={
                  session.role === "CLIENT_ADMIN" ? () => setView({ kind: "team" }) : undefined
                }
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
              <TeamScreen members={members} loading={teamLoading} error={teamError} onRetry={() => loadTeam(session)} onSetEnabled={setMemberEnabled} onInvite={inviteMember} />
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

