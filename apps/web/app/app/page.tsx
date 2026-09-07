"use client";

import { useEffect, useMemo, useState } from "react";
import {
  sampleWorkflow,
  type AmazFlowRole,
  type WorkflowDefinition,
  type WorkflowRun,
} from "@amazflow/workflow-schema";
import "./product.css";

const API = "https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com";
const COGNITO_DOMAIN = "https://amazflow-dev-398681517793.auth.us-east-1.amazoncognito.com";
const COGNITO_CLIENT_ID = "4cjp4kpmmofnr9gmd3h90i4i2i";
const json = (value: unknown) => JSON.stringify(value, null, 2);

type Session = { idToken: string; email: string; role: AmazFlowRole; tenantId: string; expiresAt: number };

export default function ProductConsole() {
  const [session, setSession] = useState<Session | null>();
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([sampleWorkflow]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selected, setSelected] = useState<WorkflowDefinition>(sampleWorkflow);
  const [draft, setDraft] = useState(json(sampleWorkflow));
  const [input, setInput] = useState(json({ employee: { id: "E-10042", name: "Sarah Chen" }, request: "DISABLE" }));
  const [notice, setNotice] = useState("Loading your workspace…");
  const [busy, setBusy] = useState(false);
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
    restoreSession().then((restored) => {
      setSession(restored);
      if (restored) refresh(restored).catch((error) => setNotice(error.message));
    }).catch((error) => { setSession(null); setNotice(error.message); });
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
    localStorage.removeItem("amazflow_session");
    setSession(null);
    const target = encodeURIComponent(`${window.location.origin}/app/`);
    window.location.assign(`${COGNITO_DOMAIN}/logout?client_id=${COGNITO_CLIENT_ID}&logout_uri=${target}`);
  };

  if (session === undefined) return <main className="product-login"><div className="login-card"><div className="product-brand"><span>A</span>AmazFlow</div><div className="login-loader" /><h1>Opening your workspace…</h1><p>Connecting securely to AmazFlow on AWS.</p></div></main>;
  if (!session) return <main className="product-login"><div className="login-card"><a className="product-brand" href="/"><span>A</span>AmazFlow</a><p className="product-eyebrow">FOUNDER WORKSPACE</p><h1>Build the work.<br /><i>Run it for real.</i></h1><p>Sign in to create configurable workflows, run bounded AI steps through Amazon Bedrock, and keep execution history in your AWS workspace.</p><button className="login-button" onClick={beginLogin}>Sign in to AmazFlow <span>→</span></button><small>Authorized accounts only · Synthetic development data</small></div></main>;

  return <main className="product-app">
    <aside className="product-sidebar"><a className="product-brand" href="/"><span>A</span>AmazFlow</a><p className="product-eyebrow">OPERATIONS CONTROL</p><nav>{navFor(role).map((name, index) => <button className={index === 1 ? "active" : ""} key={name}>{name}<em>{name === "Approvals" ? runs.filter((run) => run.status === "WAITING_APPROVAL").length : ""}</em></button>)}</nav><div className="product-boundary"><b>Development boundary</b><span>Synthetic data only</span><small>Persistent AWS workspace</small></div></aside>
    <section className="product-shell">
      <header className="product-header"><div><p className="product-eyebrow">WORKFLOW FABRIC</p><h1>{canConfigure ? <>Configure the work.<br /></> : <>Run the work.<br /></>}<i>AmazFlow executes it.</i></h1></div><div className="product-identity"><a className="back-to-site" href="/">← Marketing site</a><div className="identity-card"><span>{session.email.slice(0, 1).toUpperCase()}</span><div><b>{session.email}</b><small>{roleLabel(role)} · {session.tenantId}</small></div><button onClick={signOut}>Sign out</button></div><div className="product-status"><span /> {notice}</div></div></header>
      <div className="product-stats"><Metric n={stats.active} t="Active workflows" /><Metric n={stats.running} t="Waiting / running" /><Metric n={stats.completed} t="Completed" /><Metric n={stats.exceptions} t="Failed / exceptions" /></div>
      <div className="product-workspace"><section className="product-panel product-library"><div className="product-panelhead"><div><p className="product-eyebrow">WORKFLOW LIBRARY</p><h2>Business processes</h2></div><button className="product-plus" onClick={() => { const fresh = { ...sampleWorkflow, id: `workflow-${Date.now()}`, name: "Untitled operations workflow", version: 1, status: "draft" as const }; setSelected(fresh); setDraft(json(fresh)); }}>＋</button></div>{workflows.map((workflow) => <button key={workflow.id} className={`product-workflow ${selected?.id === workflow.id ? "chosen" : ""}`} onClick={() => { setSelected(workflow); setDraft(json(workflow)); }}><span className="product-glyph">↝</span><span><b>{workflow.name}</b><small>{workflow.steps.length} configured steps · v{workflow.version}</small></span><mark>{workflow.status}</mark></button>)}<div className="product-addhint">Any department. Any repeatable SOP.<br />AI is bounded by the workflow definition.</div></section>
        <section className="product-panel product-builder"><div className="product-panelhead"><div><p className="product-eyebrow">{canConfigure ? "SUPER ADMIN BUILDER" : "PUBLISHED WORKFLOW"}</p><h2>{selected?.name ?? "New workflow"}</h2></div>{canConfigure && <button disabled={busy} onClick={save}>{busy ? "Working…" : "Save to AWS"}</button>}</div><div className="product-flow">{selected?.steps.map((step, index) => <div className="product-step" key={step.id}><span>{icon(step.type)}</span><div><small>{step.type.toUpperCase()}</small><b>{step.name}</b>{step.type === "action" && <em>{step.provider} · {step.operation}</em>}</div>{index < selected.steps.length - 1 && <i>→</i>}</div>)}</div>{canConfigure ? <label>Workflow definition <small>Saved definitions persist in DynamoDB</small><textarea value={draft} onChange={(event) => { setDraft(event.target.value); try { setSelected(JSON.parse(event.target.value)); } catch {} }} spellCheck={false} /></label> : <div className="product-rolecopy"><b>{roleLabel(role)}</b><p>{role === "FRONTLINE" ? "Run workflows assigned to you and see your execution history." : "Run published workflows, review tenant activity, manage assignments, and decide approvals. Global configuration stays locked."}</p></div>}</section></div>
      <div className="product-workspace product-lower"><section className="product-panel product-runbox"><div className="product-panelhead"><div><p className="product-eyebrow">LIVE AWS EXECUTION</p><h2>Run with synthetic input</h2></div><button className="product-run" disabled={busy} onClick={run}>{busy ? "Running…" : "Run workflow →"}</button></div><textarea value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} /><small className="aws-note">✦ AI steps run through Amazon Bedrock Nova Lite in us-east-1.</small></section><section className="product-panel product-activity"><div className="product-panelhead"><div><p className="product-eyebrow">PERSISTED RUNS</p><h2>Execution & audit</h2></div><button disabled={busy} onClick={() => refresh().catch((error) => setNotice(error.message))}>Refresh</button></div>{runs.length === 0 ? <p className="product-empty">No AWS runs yet. Save the starter workflow, then execute it.</p> : runs.slice(0, 5).map((runItem) => <div className="product-runrow" key={runItem.id}><span className={`product-dot ${runItem.status}`} /><div><b>{runItem.id}</b><small>{runItem.audit.at(-1)?.message} · {runItem.audit.length} audit events</small></div><mark>{runItem.status.replaceAll("_", " ")}</mark></div>)}</section></div>
    </section>
  </main>;
}

async function beginLogin() {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = base64Url(bytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64Url(new Uint8Array(digest));
  sessionStorage.setItem("amazflow_pkce", verifier);
  const params = new URLSearchParams({ client_id: COGNITO_CLIENT_ID, response_type: "code", scope: "openid email profile", redirect_uri: `${window.location.origin}/app/`, code_challenge_method: "S256", code_challenge: challenge });
  window.location.assign(`${COGNITO_DOMAIN}/oauth2/authorize?${params}`);
}

async function restoreSession(): Promise<Session | null> {
  const code = new URLSearchParams(window.location.search).get("code");
  if (code) {
    const verifier = sessionStorage.getItem("amazflow_pkce");
    if (!verifier) throw new Error("Sign-in session expired. Please try again.");
    const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: COGNITO_CLIENT_ID, code, redirect_uri: `${window.location.origin}/app/`, code_verifier: verifier }) });
    const tokens = await response.json();
    if (!response.ok || !tokens.id_token) throw new Error(tokens.error_description ?? "Unable to complete sign in");
    const next = sessionFromToken(tokens.id_token);
    localStorage.setItem("amazflow_session", JSON.stringify(next));
    sessionStorage.removeItem("amazflow_pkce");
    window.history.replaceState({}, "", "/app/");
    return next;
  }
  const stored = localStorage.getItem("amazflow_session");
  if (!stored) return null;
  const parsed = JSON.parse(stored) as Session;
  if (parsed.expiresAt < Date.now()) { localStorage.removeItem("amazflow_session"); return null; }
  return parsed;
}

function sessionFromToken(idToken: string): Session {
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0))));
  const groups = (claims["cognito:groups"] ?? []) as string[];
  const role = (["SUPER_ADMIN", "CLIENT_ADMIN", "FRONTLINE"] as AmazFlowRole[]).find((candidate) => groups.includes(candidate));
  if (!role) throw new Error("This account does not have an AmazFlow access role.");
  return { idToken, email: claims.email, role, tenantId: claims["custom:tenant_id"] ?? "amazflow", expiresAt: Number(claims.exp) * 1000 };
}

function base64Url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function Metric({ n, t }: { n: number; t: string }) { return <div><strong>{n}</strong><span>{t}</span></div>; }
function icon(type: string) { return ({ ai: "✦", action: "↗", condition: "◇", approval: "✓", verify: "◎", end: "●" } as Record<string, string>)[type] ?? "·"; }
function roleLabel(role: AmazFlowRole) { return role === "FRONTLINE" ? "Frontline user" : role === "CLIENT_ADMIN" ? "Client operations admin" : "AmazFlow super admin"; }
function navFor(role: AmazFlowRole) { return role === "FRONTLINE" ? ["Home", "My workflows", "My runs"] : role === "CLIENT_ADMIN" ? ["Overview", "Workflows", "Runs", "Approvals", "Team assignments", "Agent tasks"] : ["Global overview", "Workflow studio", "Clients", "Connections", "Agents", "Audit & policy", "Platform settings"]; }
