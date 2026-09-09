"use client";

import { useEffect, useState } from "react";
import { sampleWorkflow, type WorkflowDefinition, type WorkflowRun } from "@amazflow/workflow-schema";
import { LogoMark } from "../../site-components";
import { WorkflowBuilder } from "../workflow-builder";
import { AIWorkflowCreator } from "../ai-workflow-creator";
import { API, type Session, clearSession, guardBFCacheRestore, resolveSession, revokeRefreshToken } from "../../lib/cognito-auth";
import "../product.css";

type ViewMode = "list" | "ai-create" | "edit" | "preview";

const json = (value: unknown) => JSON.stringify(value, null, 2);

export default function WorkflowStudioPage() {
  const [session, setSession] = useState<Session | null>();
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([sampleWorkflow]);
  const [selected, setSelected] = useState<WorkflowDefinition | null>(null);
  const [mode, setMode] = useState<ViewMode>("list");
  const [notice, setNotice] = useState("Loading your workspace…");
  const [busy, setBusy] = useState(false);

  useEffect(() => guardBFCacheRestore(), []);

  useEffect(() => {
    const hadStoredSession = Boolean(localStorage.getItem("amazflow_session"));
    resolveSession().then((restored) => {
      if (!restored) {
        const reason = hadStoredSession ? "&reason=expired" : "";
        window.location.assign(`/login?next=${encodeURIComponent("/app/workflows/")}${reason}`);
        return;
      }
      if (restored.role !== "SUPER_ADMIN") {
        window.location.assign("/console/");
        return;
      }
      setSession(restored);
      loadWorkflows(restored);
    });
  }, []);

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

  const loadWorkflows = async (currentSession = session) => {
    if (!currentSession) return;
    try {
      const response = await fetch(`${API}/workflows`, {
        headers: { Authorization: `Bearer ${currentSession.idToken}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Failed to load workflows");
      
      const loadedWorkflows = body.length ? body : [sampleWorkflow];
      setWorkflows(loadedWorkflows);
      setNotice(body.length ? "Workspace connected" : "Starter workflow ready — save it to your workspace");
    } catch (error) {
      setNotice(`Failed to load: ${error instanceof Error ? error.message : error}`);
    }
  };

  const saveWorkflow = async (workflow: WorkflowDefinition) => {
    setBusy(true);
    try {
      await request("/workflows", { method: "POST", body: JSON.stringify(workflow) });
      setNotice(`"${workflow.name}" saved successfully`);
      await loadWorkflows();
      setMode("list");
      setSelected(null);
    } catch (error) {
      setNotice(`Save failed: ${error instanceof Error ? error.message : error}`);
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const deleteWorkflow = async (workflow: WorkflowDefinition) => {
    if (!confirm(`Delete "${workflow.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await request(`/workflows/${workflow.id}`, { method: "DELETE" });
      setNotice(`"${workflow.name}" deleted`);
      await loadWorkflows();
      if (selected?.id === workflow.id) {
        setSelected(null);
        setMode("list");
      }
    } catch (error) {
      setNotice(`Delete failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    revokeRefreshToken(session?.refreshToken);
    clearSession();
    setSession(null);
    window.location.replace("/signed-out");
  };

  if (!session) {
    return (
      <main className="product-login">
        <div className="login-card">
          <div className="product-brand">
            <span>
              <LogoMark />
            </span>
            AmazFlow
          </div>
          <div className="login-loader" />
          <h1>Opening your workspace…</h1>
          <p>Connecting securely to AmazFlow.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="product-app">
      <aside className="product-sidebar">
        <a className="product-brand" href="/">
          <span>
            <LogoMark />
          </span>
          AmazFlow
        </a>
        <p className="product-eyebrow">WORKFLOW STUDIO</p>
        <nav>
          <button className={mode === "list" ? "active" : ""} onClick={() => setMode("list")}>
            All workflows
          </button>
          <button onClick={() => window.location.assign("/app/")}>← Back to dashboard</button>
        </nav>
        <div className="product-boundary">
          <b>Development boundary</b>
          <span>Synthetic data only</span>
          <small>Persistent workspace</small>
        </div>
      </aside>

      <section className="product-shell">
        <header className="product-header">
          <div>
            <p className="product-eyebrow">WORKFLOW STUDIO</p>
            <h1>
              {mode === "list" ? "Your workflows" : mode === "ai-create" ? "Create with AI" : selected?.name || "New workflow"}
            </h1>
          </div>
          <div className="product-identity">
            <a className="back-to-site" href="/">
              ← Marketing site
            </a>
            <div className="identity-card">
              <span>{session.email.slice(0, 1).toUpperCase()}</span>
              <div>
                <b>{session.email}</b>
                <small>Super admin · {session.tenantId}</small>
              </div>
              <button onClick={signOut}>Sign out</button>
            </div>
            <div className="product-status">
              <span /> {notice}
            </div>
          </div>
        </header>

        {mode === "list" && (
          <div style={{ maxWidth: 1200 }}>
            <div style={{ display: "flex", gap: 12, marginBottom: 32 }}>
              <button
                className="console-btn console-btn-primary"
                onClick={() => setMode("ai-create")}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span style={{ fontSize: 18 }}>✨</span>
                Create workflow with AI
              </button>
              <button
                className="console-btn console-btn-quiet"
                onClick={() => {
                  const fresh = {
                    ...sampleWorkflow,
                    id: `workflow-${Date.now()}`,
                    name: "Untitled workflow",
                    version: 1,
                    status: "draft" as const,
                  };
                  setSelected(fresh);
                  setMode("edit");
                }}
              >
                + Manual create
              </button>
            </div>

            {workflows.length === 0 ? (
              <div className="console-empty" style={{ padding: "60px 20px" }}>
                <h2>No workflows yet</h2>
                <p>Create your first workflow to get started.</p>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 16 }}>
                {workflows.map((workflow) => (
                  <div
                    key={workflow.id}
                    style={{
                      background: "var(--paper)",
                      border: "1px solid var(--line)",
                      borderRadius: 16,
                      padding: 24,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <h3 style={{ font: "800 20px var(--font-display)", margin: "0 0 8px" }}>
                        {workflow.name}
                      </h3>
                      <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 12px" }}>
                        {workflow.description}
                      </p>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span
                          style={{
                            background: workflow.status === "active" ? "#e2f0e5" : "#efe9d9",
                            color: workflow.status === "active" ? "#287743" : "var(--muted)",
                            padding: "4px 10px",
                            borderRadius: 99,
                            fontSize: 11,
                            fontWeight: 800,
                            textTransform: "uppercase",
                          }}
                        >
                          {workflow.status}
                        </span>
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>
                          {workflow.steps.length} steps · v{workflow.version}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="console-btn console-btn-quiet"
                        onClick={() => {
                          setSelected(workflow);
                          setMode("preview");
                        }}
                      >
                        View
                      </button>
                      <button
                        className="console-btn console-btn-primary"
                        onClick={() => {
                          setSelected(workflow);
                          setMode("edit");
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="console-btn console-btn-quiet"
                        onClick={() => deleteWorkflow(workflow)}
                        disabled={busy}
                        style={{ color: "#c1402b" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === "ai-create" && (
          <AIWorkflowCreator
            onSave={saveWorkflow}
            onCancel={() => setMode("list")}
          />
        )}

        {mode === "edit" && selected && (
          <div style={{ maxWidth: 1000 }}>
            <div style={{ marginBottom: 24 }}>
              <button className="console-btn console-btn-quiet" onClick={() => setMode("list")}>
                ← Back to workflows
              </button>
            </div>
            <WorkflowBuilder workflow={selected} canEdit={true} onChange={setSelected} />
            <div style={{ display: "flex", gap: 12, marginTop: 32, paddingTop: 32, borderTop: "1px solid var(--line)" }}>
              <button
                className="console-btn console-btn-primary"
                onClick={() => saveWorkflow(selected)}
                disabled={busy}
              >
                {busy ? "Saving..." : "Save workflow"}
              </button>
              <button className="console-btn console-btn-quiet" onClick={() => setMode("list")}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {mode === "preview" && selected && (
          <div style={{ maxWidth: 900 }}>
            <div style={{ marginBottom: 24 }}>
              <button className="console-btn console-btn-quiet" onClick={() => setMode("list")}>
                ← Back to workflows
              </button>
            </div>
            <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 16, padding: 32 }}>
              <h2 style={{ font: "800 28px var(--font-display)", margin: "0 0 8px" }}>{selected.name}</h2>
              <p style={{ color: "var(--muted)", marginBottom: 24 }}>{selected.description}</p>
              
              <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 16 }}>Steps</h3>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 16 }}>
                {selected.steps.map((step, index) => (
                  <div
                    key={step.id}
                    style={{
                      minWidth: 140,
                      border: "1px solid var(--line)",
                      borderRadius: 12,
                      padding: 12,
                      position: "relative",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{step.type.toUpperCase()}</div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{step.name}</div>
                    {index < selected.steps.length - 1 && (
                      <div style={{ position: "absolute", right: -8, top: 24, fontSize: 16, color: "var(--coral)" }}>
                        →
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 32 }}>
                <button
                  className="console-btn console-btn-primary"
                  onClick={() => setMode("edit")}
                >
                  Edit workflow
                </button>
                <button className="console-btn console-btn-quiet" onClick={() => setMode("list")}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
