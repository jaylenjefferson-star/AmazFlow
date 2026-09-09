"use client";

import { useEffect, useMemo, useState } from "react";
import {
  sampleWorkflow,
  type AmazFlowRole,
  type WorkflowDefinition,
  type WorkflowRun,
} from "@amazflow/workflow-schema";
import { LogoMark } from "../site-components";
import { WorkflowBuilder } from "./workflow-builder";
import { CopilotPanel } from "./copilot";
import { Overview } from "./overview";
import { RunsPanel } from "./runs-panel";
import type { ExecutorInvokeResult } from "../console/run-detail";
import { ClientsPanel } from "./clients-panel";
import { ConnectionsPanel } from "./connections-panel";
import { AuditPanel } from "./audit-panel";
import { SettingsPanel } from "./settings-panel";
import { SupportPanel } from "./support-panel";
import { API, type Session, signOut as authSignOut, guardBFCacheRestore, resolveSession } from "../lib/cognito-auth";
import "./product.css";

const json = (value: unknown) => JSON.stringify(value, null, 2);

type Organization = { id: string; name: string; slug: string; status: string; plan: string; createdAt: string; branding?: { displayName?: string; logoUrl?: string; accent?: string; loginMessage?: string } };
type AgentTask = { id: string; runId: string; stepId: string; provider: string; operation: string; expiresAt: string; status: string };
type Agent = { id: string; name: string; tenantId: string; status: string; allowedDomains: string[]; lastSeenAt: string | null; version: string | null; createdAt: string };
type ActivityEvent = { id: string; tenantId: string; at: string; actor: string; actorLabel?: string; action: string; summary: string };
type Ticket = { id: string; tenantId: string; createdBy: string; subject: string; message: string; category: string; priority: string; status: string; runId?: string; workflowId?: string; notes: { id: string; at: string; by: string; text: string; internal: boolean }[]; createdAt: string; updatedAt: string };
type RuntimeSettings = { aiRuntimeLabel: string; dataBoundary: string };

type SectionKey = "overview" | "workflows" | "clients" | "agents" | "runs" | "approvals" | "exceptions" | "connections" | "audit" | "settings" | "support";
type View = { section: SectionKey; entityId?: string; filter?: string };

const SECTION_PATH: Record<SectionKey, string> = {
  overview: "/app/",
  workflows: "/app/workflows/",
  clients: "/app/clients/",
  agents: "/app/agents/",
  runs: "/app/runs/",
  approvals: "/app/approvals/",
  exceptions: "/app/exceptions/",
  connections: "/app/connections/",
  audit: "/app/audit/",
  settings: "/app/settings/",
  support: "/app/support/",
};

// Static export, no server-side rewrite for arbitrary sub-paths existed originally -- an Amplify
// Hosting rewrite (/app/<*> -> /app/index.html, 200) was added so a hard reload of a deep link
// like /app/clients/acme/ now actually resolves. pushState/popstate still drives in-session
// navigation; the rewrite is what makes a bookmarked or shared link work on first load too.
function viewToPath(view: View): string {
  const base = SECTION_PATH[view.section];
  return view.entityId ? `${base}${encodeURIComponent(view.entityId)}/` : base;
}

function pathToView(pathname: string): View {
  for (const [section, base] of Object.entries(SECTION_PATH) as [SectionKey, string][]) {
    if (section === "overview") continue;
    if (pathname === base) return { section };
    const match = pathname.startsWith(base) ? pathname.slice(base.length).replace(/\/$/, "") : null;
    if (match) return { section, entityId: decodeURIComponent(match) };
  }
  return { section: "overview" };
}

export default function ProductConsole() {
  const [session, setSession] = useState<Session | null>();
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([sampleWorkflow]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selected, setSelected] = useState<WorkflowDefinition>(sampleWorkflow);
  const [draft, setDraft] = useState(json(sampleWorkflow));
  const [input, setInput] = useState(json({ employee: { id: "E-10042", name: "Sarah Chen" }, request: "DISABLE" }));
  const [notice, setNotice] = useState("Loading your workspace…");
  const [busy, setBusy] = useState(false);
  const [sopOpen, setSopOpen] = useState(false);
  const [sopText, setSopText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings>({ aiRuntimeLabel: "AmazFlow managed AI", dataBoundary: "synthetic-only" });

  const [view, setViewState] = useState<View>({ section: "overview" });
  const setView = (next: View) => {
    setViewState(next);
    const path = viewToPath(next);
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
  };

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [revokingAgentId, setRevokingAgentId] = useState<string | null>(null);
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);

  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityLoaded, setActivityLoaded] = useState(false);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsLoaded, setTicketsLoaded] = useState(false);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);

  const role = session?.role ?? "FRONTLINE";
  const canConfigure = role === "SUPER_ADMIN";

  const request = async (path: string, options: RequestInit = {}) => {
    if (!session) throw new Error("Sign in required");
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { "content-type": "application/json", Authorization: `Bearer ${session.idToken}`, ...options.headers },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
    return body;
  };

  const refresh = async (currentSession = session) => {
    if (!currentSession) return;
    const authRequest = async (path: string) => {
      const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${currentSession.idToken}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      return body;
    };
    const [workflowResponse, runResponse, agentResponse, orgResponse, settingsResponse] = await Promise.all([
      authRequest("/workflows"),
      authRequest("/runs"),
      authRequest("/agents").catch(() => []),
      authRequest("/organizations").catch(() => []),
      authRequest("/settings").catch(() => ({ aiRuntimeLabel: "AmazFlow managed AI", dataBoundary: "synthetic-only" })),
    ]);
    const loadedWorkflows = workflowResponse.length ? workflowResponse : [sampleWorkflow];
    setWorkflows(loadedWorkflows);
    setRuns(runResponse);
    setAgents(agentResponse);
    setOrganizations(orgResponse);
    setRuntimeSettings(settingsResponse);
    const current = loadedWorkflows.find((item: WorkflowDefinition) => item.id === selected?.id) ?? loadedWorkflows[0];
    setSelected(current);
    setDraft(json(current));
    setNotice(workflowResponse.length ? "Workspace connected" : "Starter workflow ready — save it to your workspace");
  };

  useEffect(() => guardBFCacheRestore(), []);

  useEffect(() => {
    const hadStoredSession = Boolean(localStorage.getItem("amazflow_session"));
    resolveSession().then((restored) => {
      if (!restored) {
        const reason = hadStoredSession ? "&reason=expired" : "";
        window.location.assign(`/login?next=${encodeURIComponent("/app/")}${reason}`);
        return;
      }
      if (restored.role !== "SUPER_ADMIN") {
        window.location.assign("/console/");
        return;
      }
      setSession(restored);
      setViewState(pathToView(window.location.pathname));
      refresh(restored).catch((error) => setNotice(error.message));
    });
  }, []);

  useEffect(() => {
    const onPopState = () => setViewState(pathToView(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (session && view.section === "audit" && !activityLoaded) {
      setActivityLoading(true);
      request("/activity")
        .then((data) => {
          setActivity(data as ActivityEvent[]);
          setActivityLoaded(true);
        })
        .catch((error) => setNotice(error.message))
        .finally(() => setActivityLoading(false));
    }
    if (session && view.section === "support" && !ticketsLoaded) {
      setTicketsLoading(true);
      request("/support/tickets")
        .then((data) => {
          setTickets(data as Ticket[]);
          setTicketsLoaded(true);
        })
        .catch((error) => setNotice(error.message))
        .finally(() => setTicketsLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, view.section]);

  const stats = useMemo(() => ({
    active: workflows.filter((workflow) => workflow.status === "active").length,
    running: runs.filter((run) => run.status.startsWith("WAITING") || run.status === "RUNNING").length,
    completed: runs.filter((run) => run.status === "COMPLETED").length,
    exceptions: runs.filter((run) => run.status === "FAILED").length,
  }), [workflows, runs]);

  const save = async () => {
    setBusy(true);
    try {
      const body = JSON.parse(draft) as WorkflowDefinition;
      await request("/workflows", { method: "POST", body: JSON.stringify(body) });
      setNotice("Workflow saved to your workspace");
      await refresh();
    } catch (error) { setNotice(`Save failed: ${error instanceof Error ? error.message : error}`); }
    finally { setBusy(false); }
  };

  const generateFromSop = async () => {
    if (!sopText.trim()) return;
    setGenerating(true);
    try {
      const generated = (await request("/workflows/generate", { method: "POST", body: JSON.stringify({ sop: sopText }) })) as WorkflowDefinition;
      await request("/workflows", { method: "POST", body: JSON.stringify(generated) });
      setWorkflows((current) => [generated, ...current.filter((workflow) => workflow.id !== generated.id)]);
      setSelected(generated);
      setDraft(json(generated));
      setSopOpen(false);
      setSopText("");
      setNotice("Draft generated and saved — edit it anytime, then publish it when it's ready");
    } catch (error) {
      setNotice(`Generation failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      setGenerating(false);
    }
  };

  const createOrganization = async () => {
    if (!newOrgName.trim()) return;
    setCreatingOrg(true);
    try {
      const org = (await request("/organizations", { method: "POST", body: JSON.stringify({ name: newOrgName.trim() }) })) as Organization;
      setOrganizations((current) => [...current, org]);
      setNewOrgName("");
      setNotice(`${org.name} created`);
    } catch (error) {
      setNotice(`Could not create organization: ${error instanceof Error ? error.message : error}`);
    } finally {
      setCreatingOrg(false);
    }
  };

  const loadAgentTasks = async () => {
    setTasksLoading(true);
    try {
      const tasks = (await request("/agent-tasks")) as AgentTask[];
      setAgentTasks(tasks);
    } catch (error) {
      setNotice(`Could not load agent tasks: ${error instanceof Error ? error.message : error}`);
    } finally {
      setTasksLoading(false);
    }
  };

  const revokeAgentById = async (agentId: string) => {
    setRevokingAgentId(agentId);
    try {
      const updated = (await request(`/agents/${agentId}/revoke`, { method: "POST" })) as Agent;
      setAgents((current) => current.map((item) => (item.id === agentId ? updated : item)));
    } catch (error) {
      setNotice(`Could not revoke agent: ${error instanceof Error ? error.message : error}`);
    } finally {
      setRevokingAgentId(null);
    }
  };

  const run = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const created = await request(`/workflows/${selected.id}/runs`, { method: "POST", body: input });
      setNotice(`Execution ${created.status.toLowerCase().replaceAll("_", " ")} · AmazFlow AI used for this step`);
      await refresh();
    } catch (error) { setNotice(`Run failed: ${error instanceof Error ? error.message : error}`); }
    finally { setBusy(false); }
  };

  const postRunAction = async (path: string, body?: unknown) => {
    const responseBody = (await request(path, { method: "POST", body: JSON.stringify(body ?? {}) })) as WorkflowRun;
    setRuns((current) => current.map((item) => (item.id === responseBody.id ? responseBody : item)));
    return responseBody;
  };
  const approveRun = (r: WorkflowRun) => postRunAction(`/runs/${r.id}/approvals/${r.currentStepId}`, { approved: true }).then(() => undefined);
  const rejectRun = (r: WorkflowRun) => postRunAction(`/runs/${r.id}/approvals/${r.currentStepId}`, { approved: false }).then(() => undefined);
  const confirmRun = (r: WorkflowRun) => postRunAction(`/runs/${r.id}/confirmations/${r.currentStepId}/confirm`).then(() => undefined);
  const cancelRunAction = (r: WorkflowRun) => postRunAction(`/runs/${r.id}/cancel`).then(() => undefined);
  const fixRequest = async (r: WorkflowRun) => {
    await cancelRunAction(r);
    setView({ section: "workflows" });
  };
  const retryRun = async (r: WorkflowRun) => {
    setRetryingRunId(r.id);
    try {
      const inputBody = (r.context as { input?: unknown } | undefined)?.input ?? {};
      const created = await request(`/workflows/${r.workflowId}/runs`, { method: "POST", body: JSON.stringify(inputBody) });
      setRuns((current) => [created, ...current]);
      setNotice("Retried — a new run was started with the same input");
    } catch (error) {
      setNotice(`Retry failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      setRetryingRunId(null);
    }
  };

  // POST /runs/{id}/executor/invoke doesn't return a WorkflowRun (it returns a grant/harness
  // diagnostic result), so it can't reuse postRunAction's setRuns update -- refresh() afterward
  // instead, since a real call writes an EXECUTOR_PROGRESS audit entry the run list should reflect.
  const invokeExecutorAction = async (r: WorkflowRun): Promise<ExecutorInvokeResult> => {
    const result = (await request(`/runs/${r.id}/executor/invoke`, { method: "POST" })) as ExecutorInvokeResult;
    await refresh().catch(() => undefined);
    return result;
  };

  const setTicketStatus = async (ticket: Ticket, status: string) => {
    setBusyTicketId(ticket.id);
    try {
      const updated = (await request(`/support/tickets/${ticket.id}/status`, { method: "POST", body: JSON.stringify({ status }) })) as Ticket;
      setTickets((current) => current.map((t) => (t.id === updated.id ? updated : t)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyTicketId(null);
    }
  };
  const addTicketNote = async (ticket: Ticket, note: string) => {
    setBusyTicketId(ticket.id);
    try {
      const updated = (await request(`/support/tickets/${ticket.id}/status`, { method: "POST", body: JSON.stringify({ note, internal: true }) })) as Ticket;
      setTickets((current) => current.map((t) => (t.id === updated.id ? updated : t)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyTicketId(null);
    }
  };

  const signOut = async () => {
    await authSignOut(session);
  };

  if (!session) return <main className="product-login"><div className="login-card"><div className="product-brand"><span><LogoMark /></span>AmazFlow</div><div className="login-loader" /><h1>Opening your workspace…</h1><p>Connecting securely to AmazFlow.</p></div></main>;

  const NAV: { label: string; section: SectionKey }[] = [
    { label: "Global overview", section: "overview" },
    { label: "Workflow studio", section: "workflows" },
    { label: "Runs", section: "runs" },
    { label: "Approvals", section: "approvals" },
    { label: "Exceptions", section: "exceptions" },
    { label: "Clients", section: "clients" },
    { label: "Connections", section: "connections" },
    { label: "Agents", section: "agents" },
    { label: "Audit & policy", section: "audit" },
    { label: "Support", section: "support" },
    { label: "Platform settings", section: "settings" },
  ];

  const sectionTitle: Record<SectionKey, string> = {
    overview: "Global overview",
    workflows: "Workflow studio",
    clients: "Clients",
    agents: "Agents",
    runs: "Runs",
    approvals: "Approvals",
    exceptions: "Exceptions",
    connections: "Connections",
    audit: "Audit & policy",
    settings: "Platform settings",
    support: "Support",
  };

  return <main className="product-app">
    <aside className="product-sidebar">
      <a className="product-brand" href="/"><span><LogoMark /></span>AmazFlow</a>
      <p className="product-eyebrow">OPERATIONS CONTROL</p>
      <nav>
        {role !== "SUPER_ADMIN"
          ? navFor(role).map((name, index) => <button className={index === 1 ? "active" : ""} key={name}>{name}<em>{name === "Approvals" ? runs.filter((r) => r.status === "WAITING_APPROVAL").length : ""}</em></button>)
          : NAV.map((item) => (
            <button
              key={item.section}
              className={view.section === item.section ? "active" : ""}
              onClick={() => {
                setView({ section: item.section });
                if (item.section === "agents") { loadAgentTasks(); }
              }}
            >
              {item.label}
              {item.section === "approvals" && runs.filter((r) => r.status === "WAITING_APPROVAL").length > 0 && (
                <em>{runs.filter((r) => r.status === "WAITING_APPROVAL").length}</em>
              )}
              {item.section === "exceptions" && runs.filter((r) => r.status === "FAILED" || r.status === "TIMED_OUT").length > 0 && (
                <em>{runs.filter((r) => r.status === "FAILED" || r.status === "TIMED_OUT").length}</em>
              )}
            </button>
          ))}
      </nav>
    </aside>
    <section className="product-shell">
      <header className="product-header">
        <div><p className="product-eyebrow">{sectionTitle[view.section].toUpperCase()}</p><h1>{canConfigure ? <>Configure the work.<br /></> : <>Run the work.<br /></>}<i>AmazFlow executes it.</i></h1></div>
        <div className="product-identity">
          <a className="back-to-site" href="/">← Marketing site</a>
          <div className="identity-card"><span>{session.email.slice(0, 1).toUpperCase()}</span><div><b>{session.email}</b><small>{roleLabel(role)} · {session.tenantId}</small></div><button onClick={signOut}>Sign out</button></div>
          <div className="product-status"><span /> {notice}</div>
        </div>
      </header>

      {view.section === "overview" && (
        <Overview
          workflows={workflows}
          runs={runs}
          agents={agents}
          organizations={organizations}
          onOpenRuns={(filter) => setView({ section: "runs", filter })}
          onOpenExceptions={() => setView({ section: "exceptions" })}
          onOpenApprovals={() => setView({ section: "approvals" })}
          onOpenAgents={() => setView({ section: "agents" })}
          onOpenClients={() => setView({ section: "clients" })}
        />
      )}

      {(view.section === "runs" || view.section === "approvals" || view.section === "exceptions") && (
        <RunsPanel
          key={`${view.section}_${view.filter ?? "default"}`}
          mode={view.section}
          runs={runs}
          workflows={workflows}
          role={role}
          currentUserId={session.sub}
          selectedRunId={view.entityId ?? null}
          initialStatusFilter={view.filter}
          onSelectRun={(runId) => setView({ section: view.section, entityId: runId ?? undefined })}
          onApprove={approveRun}
          onSendBack={rejectRun}
          onConfirm={confirmRun}
          onFixRequest={fixRequest}
          onCancelRun={cancelRunAction}
          onRetry={view.section === "exceptions" ? retryRun : undefined}
          retryingId={retryingRunId}
          onInvokeExecutor={role === "SUPER_ADMIN" ? invokeExecutorAction : undefined}
        />
      )}

      {view.section === "clients" && (
        <div className="product-workspace product-clientsview"><section className="product-panel product-clients">
          {!view.entityId && <div className="product-panelhead"><div><p className="product-eyebrow">CUSTOMER ORGANIZATIONS</p><h2>Clients</h2></div></div>}
          <ClientsPanel
            organizations={organizations}
            orgsLoading={orgsLoading}
            workflows={workflows}
            runs={runs}
            agents={agents}
            newOrgName={newOrgName}
            onNewOrgNameChange={setNewOrgName}
            creatingOrg={creatingOrg}
            onCreateOrganization={createOrganization}
            selectedSlug={view.entityId ?? null}
            onSelectOrg={(slug) => setView({ section: "clients", entityId: slug ?? undefined })}
          />
        </section></div>
      )}

      {view.section === "agents" && (
        <div className="product-workspace product-clientsview"><section className="product-panel product-clients">
          <div className="product-panelhead"><div><p className="product-eyebrow">BROWSER AUTOMATION</p><h2>AmazFlow Agent</h2></div><a className="product-download" href="/downloads/amazflow-agent.zip" download>Download for Chrome →</a></div>
          <div className="product-addhint">Workflow steps with the <b>browser</b> provider pause a run and wait for this agent to act. Setup: 1) unzip the download, 2) open <code>chrome://extensions</code>, enable Developer mode, click &quot;Load unpacked&quot;, and select the unzipped folder, 3) click the extension icon and sign in with your AmazFlow account. That is the whole setup — the agent stays connected across restarts, works on any site the workflow targets, and needs no AmazFlow tab left open.</div>
          <div className="product-panelhead" style={{ marginTop: 18 }}><div><p className="product-eyebrow">CONNECTED AGENTS</p><h2>Authorized browsers</h2></div><button disabled={agentsLoading} onClick={() => { setAgentsLoading(true); refresh().finally(() => setAgentsLoading(false)); }}>{agentsLoading ? "Refreshing…" : "Refresh"}</button></div>
          {agentsLoading ? <p className="product-empty">Loading agents…</p> : agents.length === 0 ? <p className="product-empty">No agents connected yet.</p> : agents.map((agentItem) => <div className="product-orgrow" key={agentItem.id}><span className="product-glyph">◈</span><div><b>{agentItem.name}</b><small>{agentItem.status === "revoked" ? "Revoked" : agentItem.lastSeenAt ? `Last seen ${new Date(agentItem.lastSeenAt).toLocaleString()}` : "Never connected"}{agentItem.version ? ` · v${agentItem.version}` : ""}</small></div>{agentItem.status === "revoked" ? <mark>revoked</mark> : <button disabled={revokingAgentId === agentItem.id} onClick={() => revokeAgentById(agentItem.id)}>{revokingAgentId === agentItem.id ? "Revoking…" : "Revoke"}</button>}</div>)}
          <div className="product-panelhead" style={{ marginTop: 18 }}><div><p className="product-eyebrow">PENDING AGENT TASKS</p><h2>Waiting on a browser step</h2></div><button disabled={tasksLoading} onClick={loadAgentTasks}>Refresh</button></div>
          {tasksLoading ? <p className="product-empty">Loading tasks…</p> : agentTasks.length === 0 ? <p className="product-empty">No runs are currently waiting on the browser agent.</p> : agentTasks.map((task) => { const taskRun = runs.find((r) => r.id === task.runId); const taskWorkflow = taskRun ? workflows.find((w) => w.id === taskRun.workflowId) : undefined; return <button className="product-runrow product-runrow-clickable" key={task.id} onClick={() => setView({ section: "runs", entityId: task.runId })}><span className="product-dot" /><div><b>{taskWorkflow?.name ?? task.operation}</b><small>{taskWorkflow ? `${task.operation} · step ${task.stepId}` : `run ${task.runId} · step ${task.stepId}`} · expires {new Date(task.expiresAt).toLocaleTimeString()}</small></div><mark>{task.status}</mark></button>; })}
        </section></div>
      )}

      {view.section === "connections" && <ConnectionsPanel agents={agents} request={request} organizations={organizations} />}

      {view.section === "audit" && (
        <AuditPanel activity={activity} loading={activityLoading} runs={runs} onOpenRun={(runId) => setView({ section: "runs", entityId: runId })} />
      )}

      {view.section === "settings" && <SettingsPanel request={request} />}

      {view.section === "support" && (
        <SupportPanel tickets={tickets} loading={ticketsLoading} onSetStatus={setTicketStatus} onAddNote={addTicketNote} busyTicketId={busyTicketId} />
      )}

      {view.section === "workflows" && <>
      <div className="product-stats"><Metric n={stats.active} t="Active workflows" /><Metric n={stats.running} t="Waiting / running" /><Metric n={stats.completed} t="Completed" /><Metric n={stats.exceptions} t="Failed / exceptions" /></div>
      <div className="product-workspace"><section className="product-panel product-library"><div className="product-panelhead"><div><p className="product-eyebrow">WORKFLOW LIBRARY</p><h2>Business processes</h2></div><div style={{ display: "flex", gap: 6 }}><button className="product-plus" title="Generate from SOP" onClick={() => setSopOpen((v) => !v)}>✎</button><button className="product-plus" onClick={() => { const fresh = { ...sampleWorkflow, id: `workflow-${Date.now()}`, name: "Untitled operations workflow", version: 1, status: "draft" as const }; setSelected(fresh); setDraft(json(fresh)); }}>＋</button></div></div>
          {sopOpen && <div className="product-sopgen"><small>Describe the SOP in plain English. AmazFlow drafts a workflow you can review and edit below before saving.</small><textarea value={sopText} onChange={(event) => setSopText(event.target.value)} placeholder="e.g. When a new vendor invoice arrives by email, read the vendor, amount, and due date, flag anything over $5,000 for manager approval, then record it in the AP spreadsheet and confirm it was recorded." rows={4} /><div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button onClick={() => setSopOpen(false)} disabled={generating}>Cancel</button><button disabled={generating || !sopText.trim()} onClick={generateFromSop}>{generating ? "Designing…" : "Generate draft →"}</button></div></div>}
          {workflows.map((workflow) => <button key={workflow.id} className={`product-workflow ${selected?.id === workflow.id ? "chosen" : ""}`} onClick={() => { setSelected(workflow); setDraft(json(workflow)); }}><span className="product-glyph">↝</span><span><b>{workflow.name}</b><small>{workflow.steps.length} configured steps · v{workflow.version}</small></span><mark>{workflow.status}</mark></button>)}<div className="product-addhint">Any department. Any repeatable SOP.<br />AI is bounded by the workflow definition.</div></section>
        <section className="product-panel product-builder"><div className="product-panelhead"><div><p className="product-eyebrow">{canConfigure ? "SUPER ADMIN BUILDER" : "PUBLISHED WORKFLOW"}</p><h2>{selected?.name ?? "New workflow"}</h2></div>{canConfigure && <button disabled={busy} onClick={save}>{busy ? "Working…" : "Save workflow"}</button>}</div><div className="product-flow">{selected?.steps.map((step, index) => <div className="product-step" key={step.id}><span>{icon(step.type)}</span><div><small>{step.type.toUpperCase()}</small><b>{step.name}</b>{step.type === "action" && <em>{step.provider} · {step.operation}</em>}</div>{index < selected.steps.length - 1 && <i>→</i>}</div>)}</div>{canConfigure ? <WorkflowBuilder workflow={selected} canEdit={canConfigure} onChange={(next) => { setSelected(next); setDraft(json(next)); }} /> : <div className="product-rolecopy"><b>{roleLabel(role)}</b><p>{role === "FRONTLINE" ? "Run workflows assigned to you and see your execution history." : "Run published workflows, review tenant activity, manage assignments, and decide approvals. Global configuration stays locked."}</p></div>}</section></div>
      <div className="product-workspace product-lower"><section className="product-panel product-runbox"><div className="product-panelhead"><div><p className="product-eyebrow">LIVE EXECUTION</p><h2>{runtimeSettings.dataBoundary.startsWith("production") ? "Run with live input" : "Run with synthetic input"}</h2></div><button className="product-run" disabled={busy} onClick={run}>{busy ? "Running…" : "Run workflow →"}</button></div><textarea value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} /><small className="aws-note">✦ AI steps run through {runtimeSettings.aiRuntimeLabel || "AmazFlow managed AI"}.</small></section><section className="product-panel product-activity"><div className="product-panelhead"><div><p className="product-eyebrow">PERSISTED RUNS</p><h2>Execution & audit</h2></div><button disabled={busy} onClick={() => refresh().catch((error) => setNotice(error.message))}>Refresh</button></div>{runs.length === 0 ? <p className="product-empty">No runs yet. Save the starter workflow, then execute it.</p> : runs.slice(0, 5).map((runItem) => <button className="product-runrow product-runrow-clickable" key={runItem.id} onClick={() => setView({ section: "runs", entityId: runItem.id })}><span className={`product-dot ${runItem.status}`} /><div><b>{runItem.id}</b><small>{runItem.audit.at(-1)?.message} · {runItem.audit.length} audit events</small></div><mark>{runItem.status.replaceAll("_", " ")}</mark></button>)}</section></div>
      </>}
    </section>
    {canConfigure && <CopilotPanel request={request} context={{ section: view.section, entityId: view.entityId }} />}
  </main>;
}
function Metric({ n, t }: { n: number; t: string }) { return <div><strong>{n}</strong><span>{t}</span></div>; }
function icon(type: string) { return ({ ai: "✦", action: "↗", condition: "◇", approval: "✓", verify: "◎", end: "●" } as Record<string, string>)[type] ?? "·"; }
function roleLabel(role: AmazFlowRole) { return role === "FRONTLINE" ? "Frontline user" : role === "CLIENT_ADMIN" ? "Client operations admin" : "AmazFlow super admin"; }
function navFor(role: AmazFlowRole) { return role === "FRONTLINE" ? ["Home", "My workflows", "My runs"] : ["Overview", "Workflows", "Runs", "Approvals", "Team assignments", "Agent tasks"]; }
