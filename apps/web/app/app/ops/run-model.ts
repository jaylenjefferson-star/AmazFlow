/**
 * Turns a raw run record into the operations narrative the console renders.
 *
 * Everything here is derived from data the control plane actually returns on `GET /runs`:
 * the run document, its embedded `audit[]`, `stepResults`, `context`, plus the pinned workflow
 * definition. Nothing is synthesised. Where the platform genuinely has no telemetry -- retry
 * attempt counters, per-tool-call latency, browser recordings -- the model reports the absence
 * so the UI can say "not recorded" instead of showing a misleading zero.
 */

import type {
  AuditEvent,
  StepResult,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStep,
} from "@amazflow/workflow-schema";
import { auditEvent, toolLabel, type AuditCategory, type Tone } from "./terms";

/* ============================================================================== progression = */

export type StepState = "done" | "current" | "failed" | "pending";

export type StepProgress = {
  step: WorkflowStep;
  state: StepState;
  /** Wall-clock of the first audit event attributed to this step. */
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  result?: StepResult;
  /** How this step is executed, in AmazFlow terms. */
  executedBy: string;
};

/**
 * The ordered step path for a run: every step the run actually touched, in the order the audit
 * trail touched it, followed by the projected remaining path from the current step. Projecting
 * forward is what lets an operator see "3 of 6" on a run that is still mid-flight.
 */
export function stepProgression(workflow: WorkflowDefinition, run: WorkflowRun): StepProgress[] {
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));

  // Order visited steps by first appearance in the audit trail.
  const visited: string[] = [];
  for (const event of run.audit) {
    if (event.stepId && !visited.includes(event.stepId)) visited.push(event.stepId);
  }

  // Project the happy path forward from wherever the run currently sits.
  const projected: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = run.currentStepId ?? workflow.startAt;
  while (cursor && !seen.has(cursor) && projected.length < 40) {
    seen.add(cursor);
    projected.push(cursor);
    const step = byId.get(cursor);
    if (!step || step.type === "end") break;
    cursor = step.type === "condition" ? step.whenTrue : step.next;
  }

  const ordered = [...visited, ...projected].filter(
    (id, index, all) => Boolean(id) && all.indexOf(id) === index,
  );

  const eventsByStep = new Map<string, AuditEvent[]>();
  for (const event of run.audit) {
    if (!event.stepId) continue;
    const list = eventsByStep.get(event.stepId);
    if (list) list.push(event);
    else eventsByStep.set(event.stepId, [event]);
  }

  const currentIndex = run.currentStepId ? ordered.indexOf(run.currentStepId) : -1;

  return ordered
    .map((id, index): StepProgress | null => {
      const step = byId.get(id);
      if (!step) return null;
      const events = eventsByStep.get(id) ?? [];
      const result = run.stepResults?.[id];
      const failedHere = events.some((event) =>
        ["ACTION_FAILED", "VERIFICATION_FAILED", "AGENT_RESULT_FAILED", "ACTION_RECONCILIATION_REQUIRED", "REJECTED"].includes(
          event.type,
        ),
      );

      let state: StepState;
      if (failedHere || result?.status === "FAILED") state = "failed";
      else if (id === run.currentStepId) state = "current";
      else if (events.length > 0 || (currentIndex >= 0 && index < currentIndex)) state = "done";
      else state = "pending";

      const startedAt = events[0]?.at;
      const finishedAt = result?.resolvedAt ?? (events.length > 1 ? events[events.length - 1].at : undefined);

      return {
        step,
        state,
        startedAt,
        finishedAt,
        durationMs:
          startedAt && finishedAt
            ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
            : undefined,
        result,
        executedBy: executionMethod(step),
      };
    })
    .filter((entry): entry is StepProgress => entry !== null);
}

/** The AmazFlow execution method for a step -- the "who actually does this" answer. */
export function executionMethod(step: WorkflowStep): string {
  switch (step.type) {
    case "ai":
      return "AmazFlow Executor";
    case "action":
      return toolLabel(step.provider, step.browserMode);
    case "approval":
      return "Human approval";
    case "condition":
      return "Control plane";
    case "verify":
      return "Independent verification";
    case "end":
      return "Control plane";
    default:
      return "Control plane";
  }
}

/* ================================================================================ tool calls = */

export type ToolCall = {
  id: string;
  stepId: string;
  stepName: string;
  /** e.g. "AmazFlow Browser (hosted)", "Connected API". */
  tool: string;
  operation: string;
  status: "SUCCEEDED" | "FAILED" | "UNCERTAIN" | "PENDING";
  at?: string;
  durationMs?: number;
  /** True when the platform could not rule out a side effect -- needs reconciliation. */
  sideEffectObserved: boolean;
  traceId?: string;
  httpStatus?: number;
  error?: string;
  request?: unknown;
  response?: unknown;
  verification?: { passed: boolean; expected: unknown; actual: unknown };
  connectionId?: string;
};

/**
 * Every tool call the run made. `stepResults` is authoritative for the outcome and payloads;
 * the audit trail supplies timing, trace, and the uncertain-side-effect signal.
 */
export function toolCalls(workflow: WorkflowDefinition, run: WorkflowRun): ToolCall[] {
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  const calls: ToolCall[] = [];

  const actionEvents = run.audit.filter((event) =>
    ["ACTION_COMPLETED", "ACTION_FAILED", "ACTION_RECONCILIATION_REQUIRED", "VERIFICATION_FAILED"].includes(
      event.type,
    ),
  );

  const results = Object.values(run.stepResults ?? {}).filter((result) => result.type === "action");

  for (const result of results) {
    const step = byId.get(result.stepId);
    const event = actionEvents.find((candidate) => candidate.stepId === result.stepId);
    const details = (event?.details ?? {}) as Record<string, unknown>;
    const startEvent = run.audit.find(
      (candidate) => candidate.stepId === result.stepId && candidate.type === "STEP_STARTED",
    );
    const uncertain = event?.type === "ACTION_RECONCILIATION_REQUIRED" || details.sideEffectObserved === true;

    calls.push({
      id: `call_${result.stepId}`,
      stepId: result.stepId,
      stepName: step?.name ?? result.stepId,
      tool:
        step?.type === "action"
          ? toolLabel(step.provider, step.browserMode)
          : toolLabel(result.provider),
      operation: result.operation ?? (step?.type === "action" ? step.operation : "—"),
      status: uncertain ? "UNCERTAIN" : result.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
      at: result.resolvedAt,
      durationMs:
        startEvent && result.resolvedAt
          ? Math.max(0, new Date(result.resolvedAt).getTime() - new Date(startEvent.at).getTime())
          : undefined,
      sideEffectObserved: uncertain,
      traceId: typeof details.traceId === "string" ? details.traceId : undefined,
      httpStatus: result.actionResult?.status,
      error: result.actionResult?.error,
      request: step?.type === "action" ? step.input : undefined,
      response: result.actionResult?.body,
      verification: result.verificationResult,
      connectionId: step?.type === "action" ? step.connectionId : undefined,
    });
  }

  // A step that is mid-flight has no stepResult yet, but the operator still needs to see the
  // in-progress call -- that is the whole point of watching a live run.
  if (run.currentStepId && !run.stepResults?.[run.currentStepId]) {
    const step = byId.get(run.currentStepId);
    if (step?.type === "action") {
      const created = run.audit.find(
        (event) => event.stepId === run.currentStepId && event.type === "AGENT_TASK_CREATED",
      );
      calls.push({
        id: `call_${step.id}_pending`,
        stepId: step.id,
        stepName: step.name,
        tool: toolLabel(step.provider, step.browserMode),
        operation: step.operation,
        status: "PENDING",
        at: created?.at,
        sideEffectObserved: false,
        request: step.input,
        connectionId: step.connectionId,
      });
    }
  }

  return calls.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

/* ================================================================================= decisions = */

export type Decision = {
  id: string;
  stepId: string;
  stepName: string;
  operation: string;
  outputKey?: string;
  value?: unknown;
  confidence?: number;
  threshold?: number;
  belowThreshold: boolean;
  at?: string;
  traceId?: string;
  usage?: unknown;
  prompt?: string;
  allowedValues?: string[];
};

/** AmazFlow Executor decisions, joined to the value they wrote into the run context. */
export function decisions(workflow: WorkflowDefinition, run: WorkflowRun): Decision[] {
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  const values = (run.context as { values?: Record<string, { value: unknown; confidence: number }> })
    ?.values ?? {};

  return run.audit
    .filter((event) => event.type === "AI_COMPLETED")
    .map((event) => {
      const step = event.stepId ? byId.get(event.stepId) : undefined;
      const details = (event.details ?? {}) as Record<string, unknown>;
      const outputKey = step?.type === "ai" ? step.outputKey : undefined;
      const stored = outputKey ? values[outputKey] : undefined;
      const confidence =
        typeof details.confidence === "number" ? details.confidence : stored?.confidence;
      const threshold = step?.type === "ai" ? (step.confidenceThreshold ?? 0.85) : undefined;

      return {
        id: event.id,
        stepId: event.stepId ?? "—",
        stepName: step?.name ?? event.stepId ?? "Decision",
        operation: step?.type === "ai" ? step.operation : "decision",
        outputKey,
        value: stored?.value,
        confidence,
        threshold,
        belowThreshold:
          confidence !== undefined && threshold !== undefined ? confidence < threshold : false,
        at: event.at,
        traceId: typeof details.traceId === "string" ? details.traceId : undefined,
        usage: details.usage,
        prompt: step?.type === "ai" ? step.prompt : undefined,
        allowedValues: step?.type === "ai" ? step.allowedValues : undefined,
      } satisfies Decision;
    });
}

/* ========================================================================== browser activity = */

export type BrowserEvent = {
  id: string;
  at: string;
  kind: "issued" | "returned" | "failed" | "handoff";
  label: string;
  message: string;
  stepId?: string;
  taskId?: string;
  connectionId?: string;
  traceId?: string;
};

/** AmazFlow Browser / Chrome Agent activity for this run. */
export function browserActivity(run: WorkflowRun): BrowserEvent[] {
  const kinds: Record<string, BrowserEvent["kind"]> = {
    AGENT_TASK_CREATED: "issued",
    AGENT_RESULT: "returned",
    AGENT_RESULT_FAILED: "failed",
    MANAGED_EXECUTION_FALLBACK: "handoff",
  };

  return run.audit
    .filter((event) => event.type in kinds)
    .map((event) => {
      const details = (event.details ?? {}) as Record<string, unknown>;
      return {
        id: event.id,
        at: event.at,
        kind: kinds[event.type],
        label: auditEvent(event.type).label,
        message: event.message,
        stepId: event.stepId,
        taskId: typeof details.taskId === "string" ? details.taskId : undefined,
        connectionId: typeof details.connectionId === "string" ? details.connectionId : undefined,
        traceId: typeof details.traceId === "string" ? details.traceId : undefined,
      } satisfies BrowserEvent;
    });
}

/* ============================================================================ approval gates = */

export type Gate = {
  id: string;
  kind: "approval" | "confirmation";
  state: "pending" | "granted" | "rejected";
  at: string;
  stepId?: string;
  stepName?: string;
  message: string;
  /** Roles allowed to decide, for approval gates. */
  roles?: string[];
  decidedBy?: string;
  decidedRole?: string;
};

export function gates(workflow: WorkflowDefinition, run: WorkflowRun): Gate[] {
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  const list: Gate[] = [];

  for (const event of run.audit) {
    const details = (event.details ?? {}) as Record<string, unknown>;
    const step = event.stepId ? byId.get(event.stepId) : undefined;
    const base = {
      id: event.id,
      at: event.at,
      stepId: event.stepId,
      stepName: step?.name,
      message: event.message,
    };

    if (event.type === "APPROVAL_REQUIRED") {
      list.push({
        ...base,
        kind: "approval",
        state: "pending",
        message: step?.type === "approval" ? step.message : event.message,
        roles: Array.isArray(details.roles) ? (details.roles as string[]) : undefined,
      });
    } else if (event.type === "APPROVED" || event.type === "REJECTED") {
      list.push({
        ...base,
        kind: "approval",
        state: event.type === "APPROVED" ? "granted" : "rejected",
        decidedBy: typeof details.by === "string" ? details.by : undefined,
        decidedRole: typeof details.role === "string" ? details.role : undefined,
      });
    } else if (event.type === "CONFIRMATION_REQUIRED") {
      list.push({ ...base, kind: "confirmation", state: "pending" });
    } else if (event.type === "CONFIRMATION_GRANTED") {
      list.push({
        ...base,
        kind: "confirmation",
        state: "granted",
        decidedBy: typeof details.by === "string" ? details.by : undefined,
        decidedRole: typeof details.role === "string" ? details.role : undefined,
      });
    }
  }

  return list;
}

/* ========================================================================== execution grants = */

export type GrantScope = {
  stepId: string;
  stepName: string;
  /** The tool names the grant authorises, e.g. ["browser.execute"]. */
  allowedTools: string[];
  confirmationGranted: boolean;
  tool: string;
};

/**
 * The execution grant scope for each action step in this run.
 *
 * Grants are single-use, signed, and short-lived; the control plane keeps only a replay marker,
 * never the grant document, so there is no grant history to read back. What IS knowable and
 * worth showing is the binding: a grant for this run could only ever authorise this tenant,
 * this run, this pinned workflow version, this step, and this one tool -- which is the security
 * property an operator actually needs to confirm.
 */
export function grantScopes(workflow: WorkflowDefinition, run: WorkflowRun): GrantScope[] {
  const confirmed = new Set(run.confirmedStepIds ?? []);
  return workflow.steps
    .filter((step): step is Extract<WorkflowStep, { type: "action" }> => step.type === "action")
    .filter((step) => Boolean(run.stepResults?.[step.id]) || step.id === run.currentStepId)
    .map((step) => ({
      stepId: step.id,
      stepName: step.name,
      allowedTools: [`${step.provider}.execute`],
      confirmationGranted: confirmed.has(step.id),
      tool: toolLabel(step.provider, step.browserMode),
    }));
}

/* =================================================================================== timeline = */

export type TimelineEntry = {
  event: AuditEvent;
  label: string;
  category: AuditCategory;
  tone: Tone;
  stepName?: string;
  /** Elapsed time since the run started. */
  offsetMs: number;
  /** Gap since the previous event -- surfaces where a run actually sat waiting. */
  gapMs: number;
};

export function timeline(workflow: WorkflowDefinition, run: WorkflowRun): TimelineEntry[] {
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  const start = new Date(run.createdAt).getTime();
  const sorted = run.audit.slice().sort((a, b) => a.at.localeCompare(b.at));

  return sorted.map((event, index) => {
    const meta = auditEvent(event.type);
    const at = new Date(event.at).getTime();
    const previous = index > 0 ? new Date(sorted[index - 1].at).getTime() : at;
    return {
      event,
      label: meta.label,
      category: meta.category,
      tone: meta.tone,
      stepName: event.stepId ? byId.get(event.stepId)?.name : undefined,
      offsetMs: Math.max(0, at - start),
      gapMs: Math.max(0, at - previous),
    };
  });
}

/* ================================================================================= diagnosis = */

export type Diagnosis = {
  tone: Tone;
  headline: string;
  detail: string;
  /** The audit event that explains the outcome, if there is one. */
  cause?: AuditEvent;
  stepName?: string;
  /** True when a side effect could not be ruled out -- do not blindly retry. */
  unsafeToRetry: boolean;
  suggestion?: string;
};

/**
 * A plain-language read on why the run ended where it did. This is the "understand what
 * happened within seconds" surface.
 */
export function diagnose(workflow: WorkflowDefinition, run: WorkflowRun): Diagnosis {
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  const reversed = run.audit.slice().reverse();
  const stepName = (id?: string) => (id ? byId.get(id)?.name : undefined);

  const reconciliation = reversed.find((event) => event.type === "ACTION_RECONCILIATION_REQUIRED");
  if (reconciliation) {
    return {
      tone: "bad",
      headline: "Outcome could not be confirmed",
      detail:
        "A tool call started but AmazFlow could not verify whether it took effect on the customer's system. Nothing was retried, deliberately.",
      cause: reconciliation,
      stepName: stepName(reconciliation.stepId),
      unsafeToRetry: true,
      suggestion:
        "Check the target system for a partial change before starting another run. Retrying could duplicate the action.",
    };
  }

  if (run.status === "FAILED") {
    const cause =
      reversed.find((event) => event.type === "VERIFICATION_FAILED") ??
      reversed.find((event) => event.type === "ACTION_FAILED") ??
      reversed.find((event) => event.type === "AGENT_RESULT_FAILED") ??
      reversed.find((event) => event.type === "REJECTED");

    if (cause?.type === "VERIFICATION_FAILED") {
      const details = (cause.details ?? {}) as Record<string, unknown>;
      return {
        tone: "bad",
        headline: "Verification failed",
        detail: `AmazFlow acted but the independent check did not match. Expected ${JSON.stringify(details.expected)}, observed ${JSON.stringify(details.actual)}.`,
        cause,
        stepName: stepName(cause.stepId),
        unsafeToRetry: true,
        suggestion: "Confirm the real state of the target system, then decide whether to re-run.",
      };
    }
    if (cause?.type === "REJECTED") {
      return {
        tone: "muted",
        headline: "Sent back by an approver",
        detail: cause.message,
        cause,
        stepName: stepName(cause.stepId),
        unsafeToRetry: false,
        suggestion: "No change was made. Fix the input or the workflow, then run it again.",
      };
    }
    return {
      tone: "bad",
      headline: "Run failed before completing",
      detail: cause?.message ?? "The run stopped without completing its final step.",
      cause,
      stepName: stepName(cause?.stepId),
      unsafeToRetry: false,
      suggestion: "AmazFlow stops rather than guessing. Review the step below, then re-run.",
    };
  }

  if (run.status === "TIMED_OUT") {
    return {
      tone: "bad",
      headline: "Timed out waiting",
      detail:
        "The step AmazFlow was waiting on never came back inside its window, so the run was closed out. No further action was taken.",
      cause: reversed.find((event) => event.type === "RUN_TIMED_OUT"),
      stepName: stepName(run.currentStepId),
      unsafeToRetry: false,
      suggestion: "Check that the browser connection or Chrome Agent for this step is available.",
    };
  }

  if (run.status === "CANCELLED") {
    const cause = reversed.find((event) => event.type === "RUN_CANCELLED");
    return {
      tone: "muted",
      headline: "Cancelled",
      detail: cause?.message ?? "An operator stopped this run. Completed steps were not rolled back.",
      cause,
      unsafeToRetry: false,
    };
  }

  if (run.status === "COMPLETED") {
    const verified = run.audit.some((event) => event.type === "VERIFIED");
    return {
      tone: "good",
      headline: verified ? "Completed and verified" : "Completed",
      detail: verified
        ? "Every configured verification passed."
        : "The run finished its final step. This workflow has no independent verification step configured.",
      unsafeToRetry: false,
    };
  }

  // In-flight states.
  const waitingLabels: Record<string, { headline: string; detail: string }> = {
    WAITING_APPROVAL: {
      headline: "Waiting on a human approval",
      detail: "Nothing will happen on the customer's systems until someone decides.",
    },
    AWAITING_CONFIRMATION: {
      headline: "Waiting for confirmation before acting",
      detail: "AmazFlow has described what it intends to do and is holding until it's confirmed.",
    },
    WAITING_AGENT: {
      headline: "Waiting on the browser",
      detail: "A browser task has been issued and AmazFlow is waiting for the result.",
    },
    RUNNING: {
      headline: "Running",
      detail: "AmazFlow is working through the steps now.",
    },
  };
  const waiting = waitingLabels[run.status];
  return {
    tone: run.status === "RUNNING" ? "running" : "waiting",
    headline: waiting?.headline ?? "In flight",
    detail: waiting?.detail ?? "",
    stepName: stepName(run.currentStepId),
    unsafeToRetry: false,
  };
}

/* ==================================================================================== misc == */

/** Total wall-clock the run has been alive. */
export function runDuration(run: WorkflowRun): number {
  const end = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(run.status)
    ? new Date(run.updatedAt).getTime()
    : Date.now();
  return Math.max(0, end - new Date(run.createdAt).getTime());
}

/**
 * Retry telemetry, honestly reported. `step.retry.maxAttempts` exists in the workflow schema but
 * no execution path reads it today, and no attempt counter is persisted -- so the console must
 * not imply retries happened.
 */
export function retryPolicy(workflow: WorkflowDefinition, run: WorkflowRun) {
  const configured = workflow.steps
    .filter((step) => step.retry?.maxAttempts)
    .map((step) => ({ stepId: step.id, stepName: step.name, maxAttempts: step.retry?.maxAttempts ?? 0 }));
  return {
    configured,
    /** The platform records no per-attempt telemetry, so this is always null today. */
    attemptsRecorded: null as number | null,
    currentStepId: run.currentStepId,
  };
}

/** Values the run has accumulated in its context, for the data tab. */
export function contextValues(run: WorkflowRun) {
  const context = run.context as {
    input?: unknown;
    values?: Record<string, { value: unknown; confidence: number }>;
    lastAction?: unknown;
  };
  return {
    input: context?.input ?? {},
    values: context?.values ?? {},
    lastAction: context?.lastAction ?? null,
  };
}
