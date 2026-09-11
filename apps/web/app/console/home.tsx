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
  teamSize = 0,
  onOpenTeam,
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
  /** Members already in this tenant, so the checklist reflects real state rather than guessing. */
  teamSize?: number;
  onOpenTeam?: () => void;
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
      <GettingStarted role={role} teamSize={teamSize} onOpenTeam={onOpenTeam} />
    );
  }

  const stats = computeStats(workflows, runs);
  const hoursCaption = role === "FRONTLINE" ? "vs. doing this by hand yourself." : "vs. doing this by hand.";
  const runsThisMonthCaption = `${stats.runsLast30Days} in the last 30 days`;

  return (
    <div>
      {runs.length === 0 ? (
        <div className="console-empty console-impact-empty">
          <h2>Your impact will appear here.</h2>
          <p>Run a workflow below and AmazFlow will start tracking its activity for your team.</p>
        </div>
      ) : (
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
            <p className="console-stat-label">Estimated time saved</p>
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
        </div>
      )}

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


/**
 * What a brand-new workspace sees instead of a dead end.
 *
 * This replaced "Your workspace is ready. Your AmazFlow contact will assign your first workflow
 * shortly." -- which was accurate but left the customer with nothing to do and no sense of what
 * was outstanding. Each step below reflects real state: the account exists because they are
 * reading this, the team step counts actual members, and the workflow step is genuinely waiting on
 * AmazFlow, which it now says plainly rather than implying the customer is blocked on themselves.
 */
function GettingStarted({
  role,
  teamSize,
  onOpenTeam,
}: {
  role: AmazFlowRole;
  teamSize: number;
  onOpenTeam?: () => void;
}) {
  const isAdmin = role === "CLIENT_ADMIN";
  // The signed-in person is themselves a member, so "invited someone" means more than one.
  const teamDone = teamSize > 1;

  const steps = [
    {
      done: true,
      title: "Your workspace is set up",
      body: "You're signed in, so this one is already finished.",
      action: null as React.ReactNode,
    },
    ...(isAdmin
      ? [
          {
            done: teamDone,
            title: teamDone
              ? `Your team is set up — ${teamSize} people`
              : "Invite the people who'll run your workflows",
            body: teamDone
              ? "You can add more or switch someone off at any time."
              : "They get an email with a temporary password and choose their own on first sign-in.",
            action: onOpenTeam ? (
              <button className="console-btn console-btn-quiet" onClick={onOpenTeam}>
                {teamDone ? "Manage your team" : "Invite someone"}
              </button>
            ) : null,
          },
          {
            done: false,
            title: "Install the AmazFlow extension",
            body: "Workflows that use your browser need it. Install it on the computer that will run the work.",
            action: (
              <a
                className="console-btn console-btn-quiet"
                href="/downloads/amazflow-agent.zip"
                style={{ textDecoration: "none" }}
              >
                Download the extension
              </a>
            ),
          },
        ]
      : []),
    {
      done: false,
      waiting: true,
      title: "Your first workflow",
      body: isAdmin
        ? "Your AmazFlow contact is building this with you. It'll appear here the moment it's published — nothing is needed from you."
        : "Nothing is assigned to you yet. Your team admin will let you know when there is.",
      action: null,
    },
  ];

  return (
    <div className="console-onboarding">
      <div className="console-onboarding-head">
        <div className="console-signin-logo" style={{ width: 56, height: 56, borderRadius: 18 }}>
          <LogoMark size={26} />
        </div>
        <div>
          <h2>Let&apos;s get you running.</h2>
          <p>
            {isAdmin
              ? "Two things you can do now, and one we're doing for you."
              : "Your workspace is ready. Here's where things stand."}
          </p>
        </div>
      </div>

      <ol className="console-checklist">
        {steps.map((step) => (
          <li
            key={step.title}
            className="console-checklist-item"
            data-done={step.done ? "true" : undefined}
            data-waiting={"waiting" in step && step.waiting ? "true" : undefined}
          >
            <span className="console-checklist-mark" aria-hidden="true">
              {step.done ? "✓" : ""}
            </span>
            <div className="console-checklist-body">
              <b>{step.title}</b>
              <p>{step.body}</p>
              {step.action && <div className="console-checklist-action">{step.action}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
