"use client";

import { useMemo, useState } from "react";
import type { AmazFlowRole, WorkflowDefinition, WorkflowRun, WorkflowStep } from "@amazflow/workflow-schema";
import {
  HOW_WAS_THIS_CHECKED,
  cancelSummary,
  completedDurationLine,
  completionVerdict,
  interpretationSummary,
  providerBackendLabel,
  stageLabel,
  statusInfo,
  verificationStatement,
} from "./copy";

type ConsoleWorkflow = WorkflowDefinition & { manualMinutesEstimate?: number };

// Response shape from POST /runs/{id}/executor/invoke -- UI-only, not part of the shared
// workflow-schema package since it's specific to this one diagnostic route.
export type ExecutorInvokeResult = {
  grantIssued: boolean;
  grantId: string;
  stepId: string;
  confirmationGranted: boolean;
  harnessInvoked: boolean;
  harnessText?: string | null;
  harnessError?: string;
};

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

const CANCELLABLE = new Set(["RUNNING", "WAITING_APPROVAL", "WAITING_AGENT", "AWAITING_CONFIRMATION"]);

export function RunDetailScreen({
  run,
  workflow,
  role,
  currentUserId,
  onApprove,
  onSendBack,
  onConfirm,
  onFixRequest,
  onCancelRun,
  onInvokeExecutor,
}: {
  run: WorkflowRun;
  workflow: ConsoleWorkflow;
  role: AmazFlowRole;
  currentUserId: string;
  onApprove: () => Promise<void>;
  onSendBack: () => Promise<void>;
  onConfirm: () => Promise<void>;
  onFixRequest: () => Promise<void>;
  onCancelRun: () => Promise<void>;
  onInvokeExecutor?: () => Promise<ExecutorInvokeResult>;
}) {
  const status = statusInfo(run.status);
  const stages = useMemo(() => buildStages(workflow, run), [workflow, run]);
  const currentIndex = stages.findIndex((step) => step.id === run.currentStepId);
  const [busy, setBusy] = useState<"approve" | "reject" | "confirm" | "fix" | "cancel" | "executor" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [executorResult, setExecutorResult] = useState<ExecutorInvokeResult | null>(null);

  const terminal = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(run.status);
  const canCancel = CANCELLABLE.has(run.status) && (role !== "FRONTLINE" || run.createdBy === currentUserId);

  const act = async (kind: "approve" | "reject" | "confirm" | "fix" | "cancel" | "executor") => {
    setBusy(kind);
    setActionError(null);
    try {
      if (kind === "approve") await onApprove();
      else if (kind === "reject") await onSendBack();
      else if (kind === "confirm") await onConfirm();
      else if (kind === "fix") await onFixRequest();
      else if (kind === "cancel") {
        await onCancelRun();
        setCancelling(false);
      } else if (kind === "executor" && onInvokeExecutor) {
        setExecutorResult(await onInvokeExecutor());
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That didn’t go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const approvalStep = workflow.steps.find((step) => step.id === run.currentStepId && step.type === "approval") as
    | Extract<WorkflowStep, { type: "approval" }>
    | undefined;

  // Shared by the COMPLETED and (SUPER_ADMIN-only) FAILED cards -- the underlying data
  // (run.stepResults, provider/operation) is populated identically for both terminal states,
  // so a failed run gets the same real evidence a completed one does instead of a dead end.
  const renderEvidenceTimeline = () => (
    <div className="console-evidence-timeline">
      {stages.map((step) => {
        const result = run.stepResults?.[step.id];
        if (!result) return null;
        if (result.type === "verify") {
          const passed = result.verificationResult?.passed;
          return (
            <div className="console-evidence-row" key={step.id}>
              <span className={`console-evidence-check ${passed ? "ok" : "bad"}`}>{passed ? "✓" : "!"}</span>
              <div>
                <b>{passed ? "Verified" : "Verification failed"}</b>
                <p>{HOW_WAS_THIS_CHECKED}</p>
                {result.verificationResult && (
                  <div className="console-evidence-facts">
                    <span>
                      Expected <b>{String(result.verificationResult.expected)}</b>
                    </span>
                    <span>
                      Observed <b>{String(result.verificationResult.actual)}</b>
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        }
        return (
          <div className="console-evidence-row" key={step.id}>
            <span className={`console-evidence-check ${result.status === "SUCCEEDED" ? "ok" : "bad"}`}>
              {result.status === "SUCCEEDED" ? "✓" : "!"}
            </span>
            <div>
              <b>{step.name}</b>
              <p>{result.status === "SUCCEEDED" ? "Completed" : "Failed"}</p>
              {role === "SUPER_ADMIN" && result.provider && (
                <p className="console-evidence-meta">
                  Ran via {providerBackendLabel(result.provider)}
                  {result.operation ? ` · ${result.operation}` : ""}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <div className="console-run-header">
        <span className={`console-status-badge ${status.tone}`}>
          {status.tone === "progress" && <span className="console-status-dot pulse" />}
          {status.label}
        </span>
        {canCancel && (
          <button className="console-btn-text" style={{ marginLeft: "auto" }} onClick={() => setCancelling((open) => !open)}>
            Cancel this run
          </button>
        )}
      </div>
      <h1 className="console-run-title">{workflow.name}</h1>

      {cancelling && (
        <div className="console-run-card" style={{ marginBottom: 20 }}>
          <h2 style={{ font: "800 20px var(--font-display)", margin: "0 0 8px" }}>Stop this workflow?</h2>
          <p style={{ color: "var(--muted)", marginBottom: 18 }}>Nothing further will happen, but any step already completed won’t be undone.</p>
          {actionError && <p style={{ color: "var(--ink)", fontWeight: 700, fontSize: 13, marginBottom: 12 }}>{actionError}</p>}
          <div className="console-approval-actions">
            <button className="console-btn console-btn-quiet" onClick={() => setCancelling(false)} disabled={busy !== null}>
              Keep running
            </button>
            <button className="console-btn console-btn-primary" onClick={() => act("cancel")} disabled={busy !== null}>
              {busy === "cancel" ? "Stopping…" : "Stop workflow"}
            </button>
          </div>
        </div>
      )}

      {!terminal && run.status !== "AWAITING_CONFIRMATION" && (
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

      {run.status === "AWAITING_CONFIRMATION" && (
        <div className="console-run-card">
          <p className="console-eyebrow" style={{ marginBottom: 10 }}>HERE’S WHAT I’LL DO</p>
          <p className="console-verification" style={{ fontWeight: 800 }}>{interpretationSummary(run, workflow).headline}</p>
          <dl className="console-interpretation-details">
            {interpretationSummary(run, workflow).details.map((detail) => (
              <div key={detail.label}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
          {role === "FRONTLINE" ? (
            <p className="console-approval-note">Waiting on your team admin to confirm this before it runs.</p>
          ) : (
            <>
              <div className="console-approval-actions" style={{ marginTop: 18 }}>
                <button className="console-btn console-btn-primary" onClick={() => act("confirm")} disabled={busy !== null}>
                  {busy === "confirm" ? "Starting…" : "Looks right, go ahead →"}
                </button>
                <button className="console-btn console-btn-quiet" onClick={() => act("fix")} disabled={busy !== null}>
                  {busy === "fix" ? "One moment…" : "Let me fix this"}
                </button>
              </div>
              {actionError && <p className="console-approval-note" style={{ color: "var(--ink)", fontWeight: 700 }}>{actionError}</p>}
            </>
          )}
        </div>
      )}

      {run.status === "WAITING_APPROVAL" && approvalStep && (
        <div className="console-run-card">
          <p className="console-approval-message">{approvalStep.message}</p>
          {role !== "FRONTLINE" ? (
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

      {run.status === "WAITING_AGENT" && role === "SUPER_ADMIN" && (() => {
        const waitingStep = workflow.steps.find(
          (step) => step.id === run.currentStepId && step.type === "action"
        ) as Extract<WorkflowStep, { type: "action" }> | undefined;
        return (
          <div className="console-run-card">
            <p className="console-eyebrow" style={{ marginBottom: 10 }}>SUPER ADMIN · DIAGNOSTIC</p>
            <p className="console-verification" style={{ fontWeight: 800 }}>
              Waiting on {waitingStep?.provider === "browser" ? "a connected Chrome extension agent" : "the configured agent"}
              {waitingStep?.operation ? ` to run ${waitingStep.operation}` : ""}.
            </p>
            <p style={{ color: "var(--muted)", marginBottom: 16 }}>
              Invoking the AmazFlow Executor asks it to review this step and report progress into
              the run’s audit trail. It does <b>not</b> perform the browser action itself — that
              still requires a connected Chrome extension agent to pick up this step.
            </p>
            {onInvokeExecutor && (
              <div className="console-approval-actions">
                <button className="console-btn console-btn-diagnostic" onClick={() => act("executor")} disabled={busy !== null}>
                  {busy === "executor" ? "Invoking…" : "Invoke AmazFlow Executor"}
                </button>
              </div>
            )}
            {actionError && <p className="console-approval-note" style={{ color: "var(--ink)", fontWeight: 700 }}>{actionError}</p>}
            {executorResult && (
              <div className="console-evidence-facts" style={{ marginTop: 14, flexDirection: "column", gap: 4 }}>
                <span>Grant issued <b>{String(executorResult.grantIssued)}</b></span>
                <span>Harness invoked <b>{String(executorResult.harnessInvoked)}</b></span>
                {executorResult.harnessText && <span>Executor said: <b>{executorResult.harnessText}</b></span>}
                {executorResult.harnessError && <span>Harness error: <b>{executorResult.harnessError}</b></span>}
              </div>
            )}
          </div>
        );
      })()}

      {run.status === "COMPLETED" && (
        <div className="console-run-card">
          {(() => {
            const verdict = completionVerdict(run);
            return (
              <span className={`console-status-badge ${verdict.tone === "verified" ? "done" : "attention"}`} style={{ marginBottom: 16 }}>
                {verdict.tone === "verified" ? "✓ " : ""}
                {verdict.headline}
              </span>
            );
          })()}
          <p className="console-verification">{verificationStatement(run, workflow)}</p>

          {renderEvidenceTimeline()}

          <details className="console-disclosure">
            <summary>How was this checked?</summary>
            <p>{HOW_WAS_THIS_CHECKED}</p>
          </details>
          <p className="console-duration">{completedDurationLine(run, workflow)}</p>
        </div>
      )}

      {run.status === "CANCELLED" && (
        <div className="console-run-card">
          <h2 style={{ font: "800 22px var(--font-display)", margin: "0 0 10px" }}>Run cancelled</h2>
          <p style={{ color: "var(--muted)", marginBottom: 12 }}>AmazFlow stopped before any additional steps could start.</p>
          <p style={{ fontSize: 14 }}>{cancelSummary(run)}</p>
        </div>
      )}

      {run.status === "TIMED_OUT" && (
        <div className="console-run-card">
          <div className="console-failed-icon">!</div>
          <h2 style={{ font: "800 22px var(--font-display)", margin: "0 0 10px" }}>Timed out</h2>
          <p style={{ color: "var(--muted)", marginBottom: 20 }}>
            AmazFlow couldn’t reach the execution agent in time. No additional actions were taken.
          </p>
          <a className="console-btn console-btn-primary" href="mailto:sales@amazflow.com?subject=A%20workflow%20run%20timed%20out">
            Contact your AmazFlow team
          </a>
        </div>
      )}

      {run.status === "FAILED" && (
        <div className="console-run-card">
          <div className="console-failed-icon">!</div>
          <h2 style={{ font: "800 22px var(--font-display)", margin: "0 0 10px" }}>Needs a look</h2>
          <p style={{ color: "var(--muted)", marginBottom: 20 }}>AmazFlow stopped before making any change, because it couldn’t confirm the expected result.</p>
          {role === "SUPER_ADMIN" ? (
            renderEvidenceTimeline()
          ) : (
            <a className="console-btn console-btn-primary" href="mailto:sales@amazflow.com?subject=A%20workflow%20run%20needs%20a%20look">
              Contact your AmazFlow team
            </a>
          )}
        </div>
      )}
    </div>
  );
}
