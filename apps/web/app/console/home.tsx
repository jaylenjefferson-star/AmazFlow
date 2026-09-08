"use client";

import { useState } from "react";
import type { AmazFlowRole, WorkflowDefinition, WorkflowRun } from "@amazflow/workflow-schema";
import { LogoMark } from "../site-components";
import { computeStats, workflowSummary } from "./copy";

type ConsoleWorkflow = WorkflowDefinition & { manualMinutesEstimate?: number; customerSummary?: string };

export function HomeScreen({
  role,
  workflows,
  runs,
  loading,
  error,
  onRetry,
  onStartRun,
  onOpenRun,
}: {
  role: AmazFlowRole;
  workflows: ConsoleWorkflow[];
  runs: WorkflowRun[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onStartRun: (workflow: ConsoleWorkflow, description: string) => Promise<void>;
  onOpenRun: (runId: string) => void;
}) {
  if (loading) {
    return (
      <div>
        <div className="console-skeleton" style={{ marginBottom: 32 }}>
          <div className="console-skeleton-card" style={{ height: 116 }} />
        </div>
        <div className="console-skeleton">
          <div className="console-skeleton-card" />
          <div className="console-skeleton-card" />
          <div className="console-skeleton-card" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="console-error">
        <div className="console-error-icon">!</div>
        <h2>We couldn’t load your workflows just now.</h2>
        <p>This is usually temporary. Try again in a moment.</p>
        <button className="console-btn console-btn-primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="console-empty">
        <div className="console-signin-logo" style={{ width: 64, height: 64, borderRadius: 20 }}>
          <LogoMark size={30} />
        </div>
        <h2>Your workspace is ready.</h2>
        <p>Your AmazFlow contact will assign your first workflow shortly.</p>
      </div>
    );
  }

  const stats = computeStats(workflows, runs);
  const hoursCaption = role === "FRONTLINE" ? "vs. doing this by hand yourself." : "vs. doing this by hand.";
  const runsThisMonthCaption = `${stats.runsLast30Days} in the last 30 days`;

  return (
    <div>
      <div className="console-stats">
        <div className="console-stat">
          <p className="console-stat-label">Active workflows</p>
          <p className="console-stat-value">{stats.activeWorkflows}</p>
        </div>
        <div className="console-stat">
          <p className="console-stat-label">Runs this month</p>
          <p className="console-stat-value">{stats.runsThisMonth}</p>
          <p className="console-stat-caption">{runsThisMonthCaption}</p>
        </div>
        <div className="console-stat">
          <p className="console-stat-label">Hours saved</p>
          {stats.hoursSaved === null ? (
            <>
              <p className="console-stat-value">—</p>
              <p className="console-stat-caption">Set up once your AmazFlow contact adds a time estimate.</p>
            </>
          ) : (
            <>
              <p className="console-stat-value accent">{stats.hoursSaved}</p>
              <p className="console-stat-caption">{hoursCaption}</p>
            </>
          )}
        </div>
        <div className="console-stat">
          <p className="console-stat-label">Value saved</p>
          {stats.valueSaved === null ? (
            <p className="console-stat-value">—</p>
          ) : (
            <>
              <p className="console-stat-value">${stats.valueSaved.toLocaleString()}</p>
              <p className="console-stat-caption">Estimated at $35/hr — ask your AmazFlow contact to set your team’s actual rate.</p>
            </>
          )}
        </div>
      </div>

      <h2 className="console-section-title">Workflows</h2>
      <div className="console-workflow-list">
        {workflows.map((workflow) => (
          <WorkflowCard key={workflow.id} workflow={workflow} onStartRun={onStartRun} />
        ))}
      </div>

      {runs.length > 0 && (
        <>
          <h2 className="console-section-title" style={{ marginTop: 36 }}>
            Recent runs
          </h2>
          <div className="console-workflow-list">
            {runs.slice(0, 8).map((run) => {
              const workflow = workflows.find((item) => item.id === run.workflowId);
              return (
                <button
                  key={run.id}
                  className="console-workflow-card"
                  style={{ textAlign: "left", cursor: "pointer", border: "1.5px solid var(--line)" }}
                  onClick={() => onOpenRun(run.id)}
                >
                  <h3>{workflow?.name ?? "Workflow run"}</h3>
                  <p>Started {new Date(run.createdAt).toLocaleString()}</p>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function WorkflowCard({
  workflow,
  onStartRun,
}: {
  workflow: ConsoleWorkflow;
  onStartRun: (workflow: ConsoleWorkflow, description: string) => Promise<void>;
}) {
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onStartRun(workflow, text);
      setComposing(false);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t start this workflow. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="console-workflow-card">
      <h3>{workflow.name}</h3>
      <p>{workflowSummary(workflow)}</p>
      <span className={`console-pill ${workflow.status === "active" ? "console-pill-active" : "console-pill-paused"}`}>
        {workflow.status === "active" ? "Active" : "Paused"}
      </span>
      {!composing ? (
        <div className="console-workflow-card-footer">
          <button className="console-btn console-btn-primary" onClick={() => setComposing(true)} disabled={workflow.status !== "active"}>
            Run this workflow →
          </button>
        </div>
      ) : (
        <div className="console-run-compose">
          <label htmlFor={`run-${workflow.id}`} style={{ fontSize: 13, fontWeight: 700 }}>
            What do you need done?
          </label>
          <textarea
            id={`run-${workflow.id}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Describe what you’d like AmazFlow to do…"
            autoFocus
          />
          {error && <p style={{ color: "var(--ink)", fontSize: 13 }}>{error}</p>}
          <div className="console-run-compose-actions">
            <button className="console-btn console-btn-quiet" onClick={() => setComposing(false)} disabled={busy}>
              Cancel
            </button>
            <button className="console-btn console-btn-primary" onClick={submit} disabled={busy || !text.trim()}>
              {busy ? "Starting…" : "Start →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
