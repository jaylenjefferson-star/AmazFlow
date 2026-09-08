"use client";

import { useMemo, useState } from "react";
import type { AmazFlowRole, WorkflowDefinition, WorkflowRun, WorkflowStep } from "@amazflow/workflow-schema";
import { HOW_WAS_THIS_CHECKED, completedDurationLine, stageLabel, statusInfo, verificationStatement } from "./copy";

type ConsoleWorkflow = WorkflowDefinition & { manualMinutesEstimate?: number };

function buildStages(workflow: WorkflowDefinition, run: WorkflowRun): WorkflowStep[] {
  const stepsById = new Map(workflow.steps.map((step) => [step.id, step]));
  const visitedIds = [...new Set(run.audit.map((event) => event.stepId).filter((id): id is string => Boolean(id)))];

  const happyPath: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = workflow.startAt;
  while (cursor && !seen.has(cursor) && happyPath.length < 20) {
    seen.add(cursor);
    happyPath.push(cursor);
    const step = stepsById.get(cursor);
    if (!step || step.type === "end") break;
    cursor = step.type === "condition" ? step.whenTrue : step.next;
  }

  const currentIndex = run.currentStepId ? happyPath.indexOf(run.currentStepId) : -1;
  const remaining = currentIndex >= 0 ? happyPath.slice(currentIndex) : happyPath;
  const orderedIds = [...visitedIds, ...remaining].filter((id, index, all) => id && all.indexOf(id) === index);
  return orderedIds.map((id) => stepsById.get(id)).filter((step): step is WorkflowStep => Boolean(step));
}

export function RunDetailScreen({
  run,
  workflow,
  role,
  onApprove,
  onSendBack,
}: {
  run: WorkflowRun;
  workflow: ConsoleWorkflow;
  role: AmazFlowRole;
  onApprove: () => Promise<void>;
  onSendBack: () => Promise<void>;
}) {
  const status = statusInfo(run.status);
  const stages = useMemo(() => buildStages(workflow, run), [workflow, run]);
  const currentIndex = stages.findIndex((step) => step.id === run.currentStepId);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);

  const terminal = run.status === "COMPLETED" || run.status === "FAILED";

  const act = async (kind: "approve" | "reject") => {
    setBusy(kind);
    setActionError(null);
    try {
      await (kind === "approve" ? onApprove() : onSendBack());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That didn’t go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const approvalStep = workflow.steps.find((step) => step.id === run.currentStepId && step.type === "approval") as
    | Extract<WorkflowStep, { type: "approval" }>
    | undefined;

  return (
    <div>
      <div className="console-run-header">
        <span className={`console-status-badge ${status.tone}`}>
          {(status.tone === "progress") && <span className="console-status-dot pulse" />}
          {status.label}
        </span>
      </div>
      <h1 className="console-run-title">{workflow.name}</h1>

      {!terminal && (
        <>
          <div className="console-tracker">
            {stages.map((step, index) => {
              const done = index < currentIndex;
              const isCurrent = index === currentIndex;
              return (
                <div key={step.id} className={`console-tracker-step ${done ? "done" : ""} ${isCurrent ? "current" : ""}`}>
                  <div className="console-tracker-bar" />
                  <small>{stageLabel(step.type)}</small>
                </div>
              );
            })}
          </div>
          <div className="console-tracker-collapsed">
            <p className="console-tracker-collapsed-label">{stageLabel(stages[currentIndex]?.type ?? "")}</p>
            <button
              className="console-tracker-progress"
              onClick={() => setOverlayOpen((open) => !open)}
              aria-expanded={overlayOpen}
              aria-label="Show all stages"
            >
              <span style={{ width: `${stages.length ? ((currentIndex + 1) / stages.length) * 100 : 0}%` }} />
            </button>
            {overlayOpen && (
              <div className="console-tracker-overlay">
                {stages.map((step, index) => (
                  <div className="console-tracker-overlay-row" key={step.id}>
                    <span>{index <= currentIndex ? "●" : "○"}</span>
                    <span>{stageLabel(step.type)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {run.status === "WAITING_APPROVAL" && approvalStep && (
        <div className="console-run-card">
          <p className="console-approval-message">{approvalStep.message}</p>
          {role === "CLIENT_ADMIN" ? (
            <>
              <div className="console-approval-actions">
                <button className="console-btn console-btn-primary" onClick={() => act("approve")} disabled={busy !== null}>
                  {busy === "approve" ? "Approving…" : "Approve →"}
                </button>
                <button className="console-btn console-btn-quiet" onClick={() => act("reject")} disabled={busy !== null}>
                  {busy === "reject" ? "Sending back…" : "Send back"}
                </button>
              </div>
              <p className="console-approval-note">Approving lets AmazFlow finish this automatically. Sending it back stops the run — nothing changes on your systems.</p>
              {actionError && <p className="console-approval-note" style={{ color: "var(--ink)", fontWeight: 700 }}>{actionError}</p>}
            </>
          ) : (
            <p className="console-approval-note">Waiting on your team admin to review this.</p>
          )}
        </div>
      )}

      {run.status === "COMPLETED" && (
        <div className="console-run-card">
          <span className="console-status-badge done" style={{ marginBottom: 16 }}>
            ✓ Completed and verified
          </span>
          <p className="console-verification">{verificationStatement(run, workflow)}</p>
          <details className="console-disclosure">
            <summary>How was this checked?</summary>
            <p>{HOW_WAS_THIS_CHECKED}</p>
          </details>
          <p className="console-duration">{completedDurationLine(run, workflow)}</p>
        </div>
      )}

      {run.status === "FAILED" && (
        <div className="console-run-card">
          <div className="console-failed-icon">!</div>
          <h2 style={{ font: "800 22px var(--font-display)", margin: "0 0 10px" }}>Needs a look</h2>
          <p style={{ color: "var(--muted)", marginBottom: 20 }}>AmazFlow stopped before making any change, because it couldn’t confirm the expected result.</p>
          <a className="console-btn console-btn-primary" href="mailto:sales@amazflow.com?subject=A%20workflow%20run%20needs%20a%20look">
            Contact your AmazFlow team
          </a>
        </div>
      )}
    </div>
  );
}
