"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@amazflow/api-client";
import {
  diagnose,
  gates,
  grantScopes,
  retryPolicy,
  runStatus,
  stepProgression,
  timeline,
  toolCalls,
  decisions,
} from "@amazflow/domain-ui";
import { can } from "@amazflow/permissions";
import type { StepResult, WorkflowDefinition, WorkflowRun } from "@amazflow/workflow-schema";
import { Alert, Btn, EmptyState, PageHead, Panel, Pill, SkeletonPanel } from "@amazflow/ui";
import * as endpoints from "./endpoints";
import type { ViewProps } from "./views";

const elapsed = (ms?: number) => {
  if (ms === undefined) return "Not recorded";
  if (ms < 1_000) return "< 1 second";
  if (ms < 60_000) return Math.round(ms / 1_000) + " seconds";
  return Math.floor(ms / 60_000) + " minutes";
};
const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : error instanceof Error ? error.message : "The request did not complete.";

type Version = WorkflowDefinition;
type CustomerRun = WorkflowRun & { workflowName?: string };

/**
 * The customer run detail uses the same shared narrative model as the operations surface. It renders
 * only recorded facts; a missing recording or retry counter is stated as absent rather than inferred.
 */
export function RunWorkspace({
  runId,
  principal,
  slots,
  client,
  navigate,
  refresh,
}: ViewProps & { runId: string }) {
  const runs = (slots.runs?.value ?? []) as CustomerRun[];
  const run = runs.find((candidate) => candidate.id === runId);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"cancel" | "confirm" | "resume" | null>(null);

  useEffect(() => {
    if (!run) return;
    let active = true;
    setWorkflow(null);
    setLoadError(null);
    client
      .get<Version[]>(`/workflows/${encodeURIComponent(run.workflowId)}/versions`)
      .then((versions) => {
        if (!active) return;
        setWorkflow(versions.find((version) => version.version === run.workflowVersion) ?? null);
      })
      .catch((error) => active && setLoadError(errorText(error)));
    return () => {
      active = false;
    };
  }, [client, run?.id, run?.workflowId, run?.workflowVersion]);

  const narrative = useMemo(() => (run && workflow ? {
    diagnosis: diagnose(workflow, run),
    progression: stepProgression(workflow, run),
    entries: timeline(workflow, run),
    calls: toolCalls(workflow, run),
    decisions: decisions(workflow, run),
    gates: gates(workflow, run),
    grants: grantScopes(workflow, run),
    retries: retryPolicy(workflow, run),
  } : null), [run, workflow]);

  const mutate = async (kind: "cancel" | "confirm", path: string) => {
    setBusy(kind);
    setActionError(null);
    try {
      await client.post(path);
      await refresh();
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const resumeAsNewRun = async () => {
    if (!run) return;
    setBusy("resume");
    setActionError(null);
    try {
      const resumed = await client.post<{ id: string }>(endpoints.resumeRun(run.id).path);
      navigate({ routeId: "runs", entityId: resumed.id });
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  if (!run) {
    return (
      <section>
        <PageHead title="Run" sub="Loading the shared run link." />
        {slots.runs?.state === "loading" ? <SkeletonPanel rows={5} /> : <EmptyState title="Run not found" body="It may have been removed, or your role may not be allowed to view it." />}
      </section>
    );
  }
  if (!narrative) {
    return (
      <section>
        <PageHead title={run.workflowName ?? "Run"} sub="Loading the pinned workflow version and recorded narrative." />
        {loadError ? <Alert tone="bad" title="Run detail did not load">{loadError}</Alert> : <SkeletonPanel rows={6} />}
      </section>
    );
  }

  const status = runStatus(run.status, "customer");
  const mayCancel = can(principal, "run:cancel", { orgId: run.tenantId, ownerUserId: run.createdBy }).allow;
  const mayConfirm = can(principal, "run:confirm", { orgId: run.tenantId, ownerUserId: run.createdBy }).allow;
  const mayResume = can(principal, "exception:resume", { orgId: run.tenantId, ownerUserId: run.createdBy }).allow;
  const canResumeThisRun =
    mayResume &&
    ["FAILED", "TIMED_OUT"].includes(run.status) &&
    !narrative.diagnosis.unsafeToRetry;
  const pendingConfirmation = narrative.gates.find((gate) => gate.kind === "confirmation" && gate.state === "pending" && gate.stepId);
  const evidence = (Object.values(run.stepResults ?? {}) as StepResult[]).filter((result) => result.evidence);

  return (
    <section className="ops-col ops-gap-md">
      <PageHead
        title={run.workflowName ?? "Workflow run"}
        sub={`Run ${run.id} · pinned to workflow version ${run.workflowVersion}`}
        pills={<Pill tone={status.tone}>{status.label}</Pill>}
        actions={<Btn variant="ghost" onClick={() => navigate({ routeId: "runs" })}>Back to runs</Btn>}
      />
      {actionError && <Alert tone="bad" title="This action did not complete">{actionError}</Alert>}

      <Alert tone={narrative.diagnosis.tone} title={narrative.diagnosis.headline}>
        {narrative.diagnosis.detail}{narrative.diagnosis.suggestion ? " " + narrative.diagnosis.suggestion : ""}
      </Alert>

      <Panel
        title="Current path"
        sub={`${narrative.progression.filter((step) => step.state === "done").length} of ${narrative.progression.length} visible steps completed`}
        actions={
          mayCancel && ["RUNNING", "WAITING_AGENT", "WAITING_APPROVAL", "AWAITING_CONFIRMATION"].includes(run.status) ? (
            <Btn variant="danger" onClick={() => { if (window.confirm(`Cancel this run of "${run.workflowName ?? run.workflowId}"? It cannot be resumed.`)) void mutate("cancel", endpoints.cancelRun(run.id).path); }} disabled={busy !== null}>{busy === "cancel" ? "Cancelling…" : "Cancel run"}</Btn>
          ) : canResumeThisRun ? (
            <Btn variant="primary" onClick={() => void resumeAsNewRun()} disabled={busy !== null}>{busy === "resume" ? "Starting…" : "Resume as new run"}</Btn>
          ) : undefined
        }
      >
        <ol className="ops-list">
          {narrative.progression.map((item) => (
            <li key={item.step.id}>
              <span><b>{item.step.name}</b><br /><span className="ops-muted">{item.executedBy} · {item.state}</span></span>
              <span>{item.durationMs === undefined ? "Not recorded" : elapsed(item.durationMs)}</span>
            </li>
          ))}
        </ol>
      </Panel>

      {pendingConfirmation && (
        <Panel title="Confirmation required" sub={pendingConfirmation.message}>
          {mayConfirm ? <Btn variant="primary" onClick={() => void mutate("confirm", endpoints.confirmRunAction(run.id, pendingConfirmation.stepId!).path)} disabled={busy !== null}>{busy === "confirm" ? "Confirming…" : "Confirm this action"}</Btn> : <p>Your role cannot confirm this action.</p>}
        </Panel>
      )}

      <Panel title="Timeline" sub="From recorded audit entries, including the time a run spent waiting.">
        <ol className="ops-list">
          {narrative.entries.map((entry) => (
            <li key={entry.event.id}>
              <span><b>{entry.label}</b>{entry.stepName ? " · " + entry.stepName : ""}<br /><span className="ops-muted">{entry.event.message}</span></span>
              <span className="ops-muted">{entry.gapMs ? "after " + elapsed(entry.gapMs) : "at start"}</span>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Tool calls">
        {narrative.calls.length === 0 ? <p>No tool call has been recorded yet.</p> : <ul className="ops-list">{narrative.calls.map((call) => <li key={call.id}><span><b>{call.stepName}</b><br /><span className="ops-muted">{call.tool} · {call.operation}{call.error ? " — " + call.error : ""}</span></span><Pill tone={call.status === "SUCCEEDED" ? "good" : call.status === "PENDING" ? "waiting" : "bad"}>{call.status}</Pill></li>)}</ul>}
      </Panel>

      <Panel title="Evidence">
        {evidence.length === 0 ? <p>No step evidence has been recorded yet.</p> : <ul className="ops-list">{evidence.map((result) => {
          const item = result.evidence!;
          return <li key={result.stepId}><span><b>{result.stepId}</b><br /><span className="ops-muted">Agent {item.agentId ?? "Not recorded"} · grant {item.grantId ?? "Not recorded"} · {item.page?.url ?? item.page?.title ?? "Page or application not recorded"} · {item.verified === undefined ? "Independent verification not recorded" : item.verified ? "Independently verified" : "Not independently verified"}</span></span></li>;
        })}</ul>}
      </Panel>

      <Panel title="Decisions">
        {narrative.decisions.length === 0 ? <p>No automated decision has been recorded.</p> : <ul className="ops-list">{narrative.decisions.map((decision) => <li key={decision.id}><span><b>{decision.stepName}</b><br /><span className="ops-muted">Confidence {decision.confidence === undefined ? "Not recorded" : decision.confidence} against {decision.threshold === undefined ? "Not recorded" : decision.threshold}</span></span><Pill tone={decision.belowThreshold ? "waiting" : "neutral"}>{decision.belowThreshold ? "Below threshold" : "Recorded"}</Pill></li>)}</ul>}
      </Panel>

      <Panel title="Issued authority" sub="A grant is scoped to this run and one step. The signed token itself is never returned.">
        {narrative.grants.length === 0 ? <p>No action grant has been issued yet.</p> : <ul className="ops-list">{narrative.grants.map((grant) => <li key={grant.stepId}><span><b>{grant.stepName}</b><br /><span className="ops-muted">{grant.tool} · {grant.allowedTools.join(", ")} · confirmation {grant.confirmationGranted ? "granted" : "not granted"}</span></span></li>)}</ul>}
      </Panel>

      <Panel title="Execution telemetry">
        <p>Retry attempts are not recorded by the platform, so no attempt count is shown.</p>
        <p>Browser or desktop recordings are not available in this release.</p>
        {narrative.retries.configured.length > 0 && <p className="ops-muted">This workflow has retry limits configured, but the platform does not record attempts.</p>}
      </Panel>
    </section>
  );
}
