"use client";

import { useEffect, useMemo, useState } from "react";
import {
  sampleWorkflow,
  type AmazFlowRole,
  type WorkflowDefinition,
  type WorkflowRun,
} from "@amazflow/workflow-schema";
import "./product.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com";
const json = (value: unknown) => JSON.stringify(value, null, 2);

export default function ProductConsole() {
  const [role, setRole] = useState<AmazFlowRole>("SUPER_ADMIN");
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([sampleWorkflow]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selected, setSelected] = useState<WorkflowDefinition>(sampleWorkflow);
  const [draft, setDraft] = useState(json(sampleWorkflow));
  const [input, setInput] = useState(json({ employee: { id: "E-10042", name: "Sarah Chen" }, request: "DISABLE" }));
  const [notice, setNotice] = useState("Connecting to AmazFlow…");
  const authHeaders = {
    "x-amazflow-role": role,
    "x-amazflow-tenant": "tenant-demo",
    "x-amazflow-user": role === "SUPER_ADMIN" ? "jay-founder" : "client-user-demo",
  };
  const canConfigure = role === "SUPER_ADMIN";

  const refresh = async () => {
    const [workflowResponse, runResponse] = await Promise.all([
      fetch(`${API}/workflows`, { headers: authHeaders }).then((response) => response.json()),
      fetch(`${API}/runs`, { headers: authHeaders }).then((response) => response.json()),
    ]);
    setWorkflows(workflowResponse);
    setRuns(runResponse);
    const current = workflowResponse.find((item: WorkflowDefinition) => item.id === selected?.id) ?? workflowResponse[0];
    setSelected(current);
    if (current) setDraft(json(current));
    setNotice(`${roleLabel(role)} access active`);
  };

  useEffect(() => {
    refresh().catch(() => setNotice("Interactive product preview · synthetic data"));
  }, [role]);

  const stats = useMemo(
    () => ({
      active: workflows.filter((workflow) => workflow.status === "active").length,
      running: runs.filter((run) => run.status.startsWith("WAITING") || run.status === "RUNNING").length,
      completed: runs.filter((run) => run.status === "COMPLETED").length,
      exceptions: runs.filter((run) => run.status === "FAILED").length,
    }),
    [workflows, runs],
  );

  const save = async () => {
    try {
      const body = JSON.parse(draft);
      const response = await fetch(`${API}/workflows`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setNotice("Workflow configuration saved");
      await refresh();
    } catch (error) {
      try {
        const localWorkflow = JSON.parse(draft) as WorkflowDefinition;
        setWorkflows((current) => [...current.filter((item) => item.id !== localWorkflow.id), localWorkflow]);
        setSelected(localWorkflow);
        setNotice("Demo configuration saved locally");
      } catch {
        setNotice(`Configuration error: ${error instanceof Error ? error.message : error}`);
      }
    }
  };

  const run = async () => {
    if (!selected) return;
    try {
      const response = await fetch(`${API}/workflows/${selected.id}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: input,
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const created = await response.json();
      setNotice(`Execution ${created.status.toLowerCase().replaceAll("_", " ")}`);
      await refresh();
    } catch {
      const now = new Date();
      const demoRun: WorkflowRun = {
        id: `AF-DEMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        tenantId: "tenant-demo",
        workflowId: selected.id,
        workflowVersion: selected.version,
        status: "COMPLETED",
        context: (() => { try { return JSON.parse(input); } catch { return { raw: input }; } })(),
        createdAt: now.toISOString(),
        updatedAt: new Date(now.getTime() + 43000).toISOString(),
        audit: [
          { id: "a1", at: now.toISOString(), type: "RECEIVED", message: "Work item received" },
          { id: "a2", at: new Date(now.getTime() + 4000).toISOString(), type: "AI_DECISION", stepId: "interpret", message: "Authorized action selected within policy" },
          { id: "a3", at: new Date(now.getTime() + 29000).toISOString(), type: "ACTION", stepId: "execute", message: "Browser action completed" },
          { id: "a4", at: new Date(now.getTime() + 41000).toISOString(), type: "VERIFIED", stepId: "verified", message: "Expected final state verified" },
          { id: "a5", at: new Date(now.getTime() + 43000).toISOString(), type: "COMPLETED", stepId: "done", message: "Synthetic workflow completed" },
        ],
      };
      setRuns((current) => [demoRun, ...current]);
      setNotice(`Execution completed and verified · ${demoRun.id}`);
    }
  };

  return (
    <main className="product-app">
      <aside className="product-sidebar">
        <a className="product-brand" href="/" aria-label="AmazFlow home"><span>A</span>AmazFlow</a>
        <p className="product-eyebrow">OPERATIONS CONTROL</p>
        <nav>{navFor(role).map((name, index) => <button className={index === 1 ? "active" : ""} key={name}>{name}<em>{name === "Approvals" ? runs.filter((run) => run.status === "WAITING_APPROVAL").length : name === "Agent tasks" ? runs.filter((run) => run.status === "WAITING_AGENT").length : ""}</em></button>)}</nav>
        <div className="product-boundary"><b>Demo boundary</b><span>Synthetic data only</span><small>Production authentication is being hardened</small></div>
      </aside>

      <section className="product-shell">
        <header className="product-header">
          <div><p className="product-eyebrow">WORKFLOW FABRIC</p><h1>{canConfigure ? <>Configure the work.<br /></> : <>Run the work.<br /></>}<i>AmazFlow executes it.</i></h1></div>
          <div className="product-identity">
            <a className="back-to-site" href="/">← Marketing site</a>
            <label>Preview access level<select value={role} onChange={(event) => setRole(event.target.value as AmazFlowRole)}><option value="FRONTLINE">Frontline user</option><option value="CLIENT_ADMIN">Client operations admin</option><option value="SUPER_ADMIN">AmazFlow super admin</option></select></label>
            <div className="product-status"><span /> {notice}</div>
          </div>
        </header>

        <div className="product-stats"><Metric n={stats.active} t="Active workflows" /><Metric n={stats.running} t="Waiting / running" /><Metric n={stats.completed} t="Completed" /><Metric n={stats.exceptions} t="Failed / exceptions" /></div>
        <div className="product-workspace">
          <section className="product-panel product-library">
            <div className="product-panelhead"><div><p className="product-eyebrow">WORKFLOW LIBRARY</p><h2>Business processes</h2></div><button className="product-plus">＋</button></div>
            {workflows.map((workflow) => <button key={workflow.id} className={`product-workflow ${selected?.id === workflow.id ? "chosen" : ""}`} onClick={() => { setSelected(workflow); setDraft(json(workflow)); }}><span className="product-glyph">↝</span><span><b>{workflow.name}</b><small>{workflow.steps.length} configured steps · v{workflow.version}</small></span><mark>{workflow.status}</mark></button>)}
            <div className="product-addhint">Any department. Any repeatable SOP.<br />AI is a bounded step—not the workflow owner.</div>
          </section>

          <section className="product-panel product-builder">
            <div className="product-panelhead"><div><p className="product-eyebrow">{canConfigure ? "SUPER ADMIN CONFIGURATION" : "PUBLISHED WORKFLOW"}</p><h2>{selected?.name ?? "New workflow"}</h2></div>{canConfigure && <button onClick={save}>Save definition</button>}</div>
            <div className="product-flow">{selected?.steps.map((step, index) => <div className="product-step" key={step.id}><span>{icon(step.type)}</span><div><small>{step.type.toUpperCase()}</small><b>{step.name}</b>{step.type === "action" && <em>{step.provider} · {step.operation}</em>}</div>{index < selected.steps.length - 1 && <i>→</i>}</div>)}</div>
            {canConfigure ? <label>Workflow definition <small>Only AmazFlow super admins can edit</small><textarea value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} /></label> : <div className="product-rolecopy"><b>{roleLabel(role)}</b><p>{role === "FRONTLINE" ? "Run workflows assigned to you and see your own execution history. Configuration and other client activity stay hidden." : "Run every published workflow for your organization, review tenant activity, manage assignments, and decide approvals. AmazFlow configuration stays locked."}</p></div>}
          </section>
        </div>

        <div className="product-workspace product-lower">
          <section className="product-panel product-runbox"><div className="product-panelhead"><div><p className="product-eyebrow">TEST EXECUTION</p><h2>Run with synthetic input</h2></div><button className="product-run" onClick={run}>Run workflow →</button></div><textarea value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} /></section>
          <section className="product-panel product-activity"><div className="product-panelhead"><div><p className="product-eyebrow">LIVE RUNS</p><h2>Execution & audit</h2></div><button onClick={refresh}>Refresh</button></div>{runs.length === 0 ? <p className="product-empty">No runs yet. Execute a configured workflow.</p> : runs.slice(0, 4).map((runItem) => <div className="product-runrow" key={runItem.id}><span className={`product-dot ${runItem.status}`} /><div><b>{runItem.id.slice(0, 18)}…</b><small>{runItem.audit.at(-1)?.message} · {runItem.audit.length} audit events</small></div><mark>{runItem.status.replaceAll("_", " ")}</mark></div>)}</section>
        </div>
      </section>
    </main>
  );
}

function Metric({ n, t }: { n: number; t: string }) { return <div><strong>{n}</strong><span>{t}</span></div>; }
function icon(type: string) { return ({ ai: "✦", action: "↗", condition: "◇", approval: "✓", verify: "◎", end: "●" } as Record<string, string>)[type] ?? "·"; }
function roleLabel(role: AmazFlowRole) { return role === "FRONTLINE" ? "Frontline user" : role === "CLIENT_ADMIN" ? "Client operations admin" : "AmazFlow super admin"; }
function navFor(role: AmazFlowRole) { return role === "FRONTLINE" ? ["Home", "My workflows", "My runs"] : role === "CLIENT_ADMIN" ? ["Overview", "Workflows", "Runs", "Approvals", "Team assignments", "Agent tasks"] : ["Global overview", "Workflow studio", "Clients", "Connections", "Agents", "Audit & policy", "Platform settings"]; }
