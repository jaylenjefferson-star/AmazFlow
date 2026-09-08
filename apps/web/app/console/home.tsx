"use client";

import { useEffect, useState } from "react";
import type { AmazFlowRole, WorkflowDefinition, WorkflowRun } from "@amazflow/workflow-schema";
import { LogoMark } from "../site-components";
import { computeStats, requestExample, statusInfo, workflowSummary } from "./copy";

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
  draftResume,
  onDraftConsumed,
}: {
  role: AmazFlowRole;
  workflows: ConsoleWorkflow[];
  runs: WorkflowRun[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onStartRun: (workflow: ConsoleWorkflow, description: string) => Promise<void>;
  onOpenRun: (runId: string) => void;
  draftResume?: { workflowId: string; text: string } | null;
  onDraftConsumed?: () => void;
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
          <WorkflowCard
            key={workflow.id}
            workflow={workflow}
            onStartRun={onStartRun}
            initialText={draftResume?.workflowId === workflow.id ? draftResume.text : undefined}
            onDraftConsumed={onDraftConsumed}
          />
        ))}
      </div>

      <h2 className="console-section-title" style={{ marginTop: 36 }}>
        Recent runs
      </h2>
      {runs.length === 0 ? (
        <div className="console-empty" style={{ padding: "32px 20px" }}>
          <h2 style={{ font: "800 20px var(--font-display)" }}>No runs yet</h2>
          <p>Your completed and in-progress workflow runs will appear here.</p>
        </div>
      ) : (
        <div className="console-run-rows">
          {runs.slice(0, 8).map((run) => {
            const workflow = workflows.find((item) => item.id === run.workflowId);
            const status = statusInfo(run.status);
            return (
              <button key={run.id} className="console-run-row" onClick={() => onOpenRun(run.id)}>
                <div className="console-run-row-main">
                  <b>{workflow?.name ?? "Workflow run"}</b>
                  <small>Started {new Date(run.createdAt).toLocaleString()}</small>
                </div>
                <span className={`console-status-badge ${status.tone}`}>{status.label}</span>
                <span className="console-run-row-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WorkflowCard({
  workflow,
  onStartRun,
  initialText,
  onDraftConsumed,
}: {
  workflow: ConsoleWorkflow;
  onStartRun: (workflow: ConsoleWorkflow, description: string) => Promise<void>;
  initialText?: string;
  onDraftConsumed?: () => void;
}) {
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (initialText === undefined) return;
    setText(initialText);
    setComposing(true);
    setDirty(false);
    onDraftConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText]);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onStartRun(workflow, text);
      setComposing(false);
      setText("");
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t review this request. Try again.");
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
            onChange={(event) => {
              setText(event.target.value);
              setDirty(true);
            }}
            placeholder="Describe what you’d like AmazFlow to do…"
            autoFocus
          />
          <small style={{ color: "var(--muted)" }}>
            Example: “{requestExample(workflow)}”
          </small>
          {dirty && !text.trim() && (
            <p style={{ color: "var(--ink)", fontSize: 13, fontWeight: 700 }}>Tell us what you need done before starting.</p>
          )}
          {error && <p style={{ color: "var(--ink)", fontSize: 13 }}>{error}</p>}
          <p style={{ color: "var(--muted)", fontSize: 12 }}>AmazFlow will show you what it understood before anything changes.</p>
          <div className="console-run-compose-actions">
            <button className="console-btn console-btn-quiet" onClick={() => setComposing(false)} disabled={busy}>
              Cancel
            </button>
            <button className="console-btn console-btn-primary" onClick={submit} disabled={busy || !text.trim()}>
              {busy ? "Reviewing…" : "Review request →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
