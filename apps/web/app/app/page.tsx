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
import { API, type Session, clearSession, resolveSession, revokeRefreshToken } from "../lib/cognito-auth";
import "./product.css";

const json = (value: unknown) => JSON.stringify(value, null, 2);

type Organization = { id: string; name: string; slug: string; status: string; plan: string; createdAt: string };
type AgentTask = { id: string; runId: string; stepId: string; provider: string; operation: string; expiresAt: string; status: string };

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
  const [view, setView] = useState<"workflows" | "clients" | "agents">("workflows");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
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
    const [workflowResponse, runResponse] = await Promise.all([authRequest("/workflows"), authRequest("/runs")]);
    const loadedWorkflows = workflowResponse.length ? workflowResponse : [sampleWorkflow];
    setWorkflows(loadedWorkflows);
    setRuns(runResponse);
    const current = loadedWorkflows.find((item: WorkflowDefinition) => item.id === selected?.id) ?? loadedWorkflows[0];
    setSelected(current);
    setDraft(json(current));
    setNotice(workflowResponse.length ? "AWS workspace connected" : "Starter workflow ready — save it to your AWS workspace");
  };

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
      refresh(restored).catch((error) => setNotice(error.message));
    });
  }, []);

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
      setNotice("Workflow saved permanently in AWS");
      await refresh();
    } catch (error) { setNotice(`Save failed: ${error instanceof Error ? error.message : error}`); }
    finally { setBusy(false); }
  };

  const generateFromSop = async () => {
    if (!sopText.trim()) return;
    setGenerating(true);
    try {
      const generated = (await request("/workflows/generate", { method: "POST", body: JSON.stringify({ sop: sopText }) })) as WorkflowDefinition;
      setSelected(generated);
      setDraft(json(generated));
      setSopOpen(false);
      setSopText("");
      setNotice("Draft generated — review it below, then Save to AWS when it's ready");
    } catch (error) {
      setNotice(`Generation failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      setGenerating(false);
    }
  };

  const loadOrganizations = async () => {
    setOrgsLoading(true);
    try {
      const orgs = (await request("/organizations")) as Organization[];
      setOrganizations(orgs);
    } catch (error) {
      setNotice(`Could not load organizations: ${error instanceof Error ? error.message : error}`);
    } finally {
      setOrgsLoading(false);
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

  const run = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const created = await request(`/workflows/${selected.id}/runs`, { method: "POST", body: input });
      setNotice(`Execution ${created.status.toLowerCase().replaceAll("_", " ")} · Amazon Bedrock used for AI steps`);
      await refresh();
    } catch (error) { setNotice(`Run failed: ${error instanceof Error ? error.message : error}`); }
    finally { setBusy(false); }
  };

  const signOut = () => {
    revokeRefreshToken(session?.refreshToken);
    clearSession();
    setSession(null);
    window.location.assign("/signed-out");
  };

  if (!session) return <main className="product-login"><div className="login-card"><div className="product-brand"><span><LogoMark /></span>AmazFlow</div><div className="login-loader" /><h1>Opening your workspace…</h1><p>Connecting securely to AmazFlow.</p></div></main>;

  return <main className="product-app">
    <aside className="product-sidebar"><a className="product-brand" href="/"><span><LogoMark /></span>AmazFlow</a><p className="product-eyebrow">OPERATIONS CONTROL</p><nav>{navFor(role).map((name, index) => {
        if (role !== "SUPER_ADMIN") return <button className={index === 1 ? "active" : ""} key={name}>{name}<em>{name === "Approvals" ? runs.filter((run) => run.status === "WAITING_APPROVAL").length : ""}</em></button>;
        const clickable = name === "Workflow studio" || name === "Clients" || name === "Agents";
        const isActive = (name === "Workflow studio" && view === "workflows") || (name === "Clients" && view === "clients") || (name === "Agents" && view === "agents");
        return <button key={name} className={isActive ? "active" : ""} disabled={!clickable} onClick={clickable ? () => { if (name === "Clients") { setView("clients"); if (organizations.length === 0) loadOrganizations(); } else if (name === "Agents") { setView("agents"); loadAgentTasks(); } else { setView("workflows"); } } : undefined}>{name}{!clickable && <em>Soon</em>}</button>;
      })}</nav><div className="product-boundary"><b>Development boundary</b><span>Synthetic data only</span><small>Persistent AWS workspace</small></div></aside>
    <section className="product-shell">
      <header className="product-header"><div><p className="product-eyebrow">WORKFLOW FABRIC</p><h1>{canConfigure ? <>Configure the work.<br /></> : <>Run the work.<br /></>}<i>AmazFlow executes it.</i></h1></div><div className="product-identity"><a className="back-to-site" href="/">← Marketing site</a><div className="identity-card"><span>{session.email.slice(0, 1).toUpperCase()}</span><div><b>{session.email}</b><small>{roleLabel(role)} · {session.tenantId}</small></div><button onClick={signOut}>Sign out</button></div><div className="product-status"><span /> {notice}</div></div></header>
      {view === "clients" ? <div className="product-workspace product-clientsview"><section className="product-panel product-clients"><div className="product-panelhead"><div><p className="product-eyebrow">CUSTOMER ORGANIZATIONS</p><h2>Clients</h2></div></div><div className="product-neworg"><input value={newOrgName} onChange={(event) => setNewOrgName(event.target.value)} placeholder="Organization name (e.g. Acme Corp)" onKeyDown={(event) => { if (event.key === "Enter") createOrganization(); }} /><button disabled={creatingOrg || !newOrgName.trim()} onClick={createOrganization}>{creatingOrg ? "Creating…" : "Create organization →"}</button></div>{orgsLoading ? <p className="product-empty">Loading organizations…</p> : organizations.length === 0 ? <p className="product-empty">No organizations yet. Create your first customer above.</p> : organizations.map((org) => <div className="product-orgrow" key={org.id}><span className="product-glyph">◇</span><div><b>{org.name}</b><small>{org.slug} · {org.plan}</small></div><mark>{org.status}</mark></div>)}</section></div> : view === "agents" ? <div className="product-workspace product-clientsview"><section className="product-panel product-clients"><div className="product-panelhead"><div><p className="product-eyebrow">BROWSER AUTOMATION</p><h2>AmazFlow Agent</h2></div><a className="product-download" href="/downloads/amazflow-agent.zip" download>Download for Chrome →</a></div><div className="product-addhint">Workflow steps with the <b>browser</b> provider pause a run and wait for this agent to act. Setup: 1) unzip the download, 2) open <code>chrome://extensions</code>, enable Developer mode, click &quot;Load unpacked&quot;, and select the unzipped folder, 3) open the extension popup, sign in to AmazFlow in a normal tab, copy the <code>idToken</code> from DevTools → Application → Local Storage → <code>amazflow_session</code>, and paste it into the popup, 4) open the tab where the action should run and click &quot;Enable on this site&quot;.</div><div className="product-panelhead" style={{ marginTop: 18 }}><div><p className="product-eyebrow">PENDING AGENT TASKS</p><h2>Waiting on a browser step</h2></div><button disabled={tasksLoading} onClick={loadAgentTasks}>Refresh</button></div>{tasksLoading ? <p className="product-empty">Loading tasks…</p> : agentTasks.length === 0 ? <p className="product-empty">No runs are currently waiting on the browser agent.</p> : agentTasks.map((task) => <div className="product-runrow" key={task.id}><span className="product-dot" /><div><b>{task.operation}</b><small>run {task.runId} · step {task.stepId} · expires {new Date(task.expiresAt).toLocaleTimeString()}</small></div><mark>{task.status}</mark></div>)}</section></div> : <>
      <div className="product-stats"><Metric n={stats.active} t="Active workflows" /><Metric n={stats.running} t="Waiting / running" /><Metric n={stats.completed} t="Completed" /><Metric n={stats.exceptions} t="Failed / exceptions" /></div>
      <div className="product-workspace"><section className="product-panel product-library"><div className="product-panelhead"><div><p className="product-eyebrow">WORKFLOW LIBRARY</p><h2>Business processes</h2></div><div style={{ display: "flex", gap: 6 }}><button className="product-plus" title="Generate from SOP" onClick={() => setSopOpen((v) => !v)}>✎</button><button className="product-plus" onClick={() => { const fresh = { ...sampleWorkflow, id: `workflow-${Date.now()}`, name: "Untitled operations workflow", version: 1, status: "draft" as const }; setSelected(fresh); setDraft(json(fresh)); }}>＋</button></div></div>
          {sopOpen && <div className="product-sopgen"><small>Describe the SOP in plain English. AmazFlow drafts a workflow you can review and edit below before saving.</small><textarea value={sopText} onChange={(event) => setSopText(event.target.value)} placeholder="e.g. When a new vendor invoice arrives by email, read the vendor, amount, and due date, flag anything over $5,000 for manager approval, then record it in the AP spreadsheet and confirm it was recorded." rows={4} /><div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button onClick={() => setSopOpen(false)} disabled={generating}>Cancel</button><button disabled={generating || !sopText.trim()} onClick={generateFromSop}>{generating ? "Designing…" : "Generate draft →"}</button></div></div>}
          {workflows.map((workflow) => <button key={workflow.id} className={`product-workflow ${selected?.id === workflow.id ? "chosen" : ""}`} onClick={() => { setSelected(workflow); setDraft(json(workflow)); }}><span className="product-glyph">↝</span><span><b>{workflow.name}</b><small>{workflow.steps.length} configured steps · v{workflow.version}</small></span><mark>{workflow.status}</mark></button>)}<div className="product-addhint">Any department. Any repeatable SOP.<br />AI is bounded by the workflow definition.</div></section>
        <section className="product-panel product-builder"><div className="product-panelhead"><div><p className="product-eyebrow">{canConfigure ? "SUPER ADMIN BUILDER" : "PUBLISHED WORKFLOW"}</p><h2>{selected?.name ?? "New workflow"}</h2></div>{canConfigure && <button disabled={busy} onClick={save}>{busy ? "Working…" : "Save to AWS"}</button>}</div><div className="product-flow">{selected?.steps.map((step, index) => <div className="product-step" key={step.id}><span>{icon(step.type)}</span><div><small>{step.type.toUpperCase()}</small><b>{step.name}</b>{step.type === "action" && <em>{step.provider} · {step.operation}</em>}</div>{index < selected.steps.length - 1 && <i>→</i>}</div>)}</div>{canConfigure ? <WorkflowBuilder workflow={selected} canEdit={canConfigure} onChange={(next) => { setSelected(next); setDraft(json(next)); }} /> : <div className="product-rolecopy"><b>{roleLabel(role)}</b><p>{role === "FRONTLINE" ? "Run workflows assigned to you and see your execution history." : "Run published workflows, review tenant activity, manage assignments, and decide approvals. Global configuration stays locked."}</p></div>}</section></div>
      <div className="product-workspace product-lower"><section className="product-panel product-runbox"><div className="product-panelhead"><div><p className="product-eyebrow">LIVE AWS EXECUTION</p><h2>Run with synthetic input</h2></div><button className="product-run" disabled={busy} onClick={run}>{busy ? "Running…" : "Run workflow →"}</button></div><textarea value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} /><small className="aws-note">✦ AI steps run through Amazon Bedrock Nova Lite in us-east-1.</small></section><section className="product-panel product-activity"><div className="product-panelhead"><div><p className="product-eyebrow">PERSISTED RUNS</p><h2>Execution & audit</h2></div><button disabled={busy} onClick={() => refresh().catch((error) => setNotice(error.message))}>Refresh</button></div>{runs.length === 0 ? <p className="product-empty">No AWS runs yet. Save the starter workflow, then execute it.</p> : runs.slice(0, 5).map((runItem) => <div className="product-runrow" key={runItem.id}><span className={`product-dot ${runItem.status}`} /><div><b>{runItem.id}</b><small>{runItem.audit.at(-1)?.message} · {runItem.audit.length} audit events</small></div><mark>{runItem.status.replaceAll("_", " ")}</mark></div>)}</section></div>
      </>}
    </section>
  </main>;
}
function Metric({ n, t }: { n: number; t: string }) { return <div><strong>{n}</strong><span>{t}</span></div>; }
function icon(type: string) { return ({ ai: "✦", action: "↗", condition: "◇", approval: "✓", verify: "◎", end: "●" } as Record<string, string>)[type] ?? "·"; }
function roleLabel(role: AmazFlowRole) { return role === "FRONTLINE" ? "Frontline user" : role === "CLIENT_ADMIN" ? "Client operations admin" : "AmazFlow super admin"; }
function navFor(role: AmazFlowRole) { return role === "FRONTLINE" ? ["Home", "My workflows", "My runs"] : role === "CLIENT_ADMIN" ? ["Overview", "Workflows", "Runs", "Approvals", "Team assignments", "Agent tasks"] : ["Global overview", "Workflow studio", "Clients", "Connections", "Agents", "Audit & policy", "Platform settings"]; }
