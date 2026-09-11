// This package is the shared workflow state machine used by production and local tests.
// Infrastructure and provider adapters remain outside it so state transitions stay deterministic.
import type { StepResult, WorkflowDefinition, WorkflowRun, WorkflowStep } from "@amazflow/workflow-schema";

export * from "./execution-grant.js";

export type AgentTask = { id: string; runId: string; tenantId: string; stepId: string; provider: string; operation: string; input: Record<string, unknown>; expiresAt: string; status: "PENDING" | "COMPLETED"; workflowId?: string; assignedRoles?: string[]; createdBy?: string };
export type Approval = { runId: string; stepId: string; message: string; roles: string[]; status: "PENDING" | "APPROVED" | "REJECTED" };
export type Confirmation = { id: string; runId: string; tenantId: string; stepId: string; message: string; status: "PENDING" | "CONFIRMED" | "CANCELLED"; kind?: "ACTION_GATE"; summary?: Record<string, unknown>; createdAt?: string; expiresAt?: string };
export interface Store {
  getWorkflow(id: string): Promise<WorkflowDefinition | undefined>;
  saveRun(run: WorkflowRun): Promise<void>;
  getRun(id: string): Promise<WorkflowRun | undefined>;
  saveTask(task: AgentTask): Promise<void>;
  saveApproval(approval: Approval): Promise<void>;
  saveConfirmation?(confirmation: Confirmation): Promise<void>;
}
export type ExecutionMetadata = {
  executionBackend: "agentcore" | "legacy";
  agentSessionId?: string;
  browserSessionId?: string;
  traceId?: string;
};
export interface AiProvider {
  run(step: Extract<WorkflowStep,{type:"ai"}>, context: Record<string, unknown>, run?: WorkflowRun): Promise<{ value: unknown; confidence: number; raw?: unknown; metadata?: ExecutionMetadata }>;
}
export type ActionExecutionResult = {
  status: "SUCCEEDED" | "FAILED" | "FALLBACK";
  result?: Record<string, unknown>;
  error?: string;
  sideEffectObserved?: boolean;
  metadata?: ExecutionMetadata;
};
export interface ActionExecutor {
  execute(args: {
    workflow: WorkflowDefinition;
    run: WorkflowRun;
    step: Extract<WorkflowStep,{type:"action"}>;
    input: Record<string, unknown>;
    executionGrant?: string;
  }): Promise<ActionExecutionResult>;
}
export interface ExecutionGrantIssuer {
  issue(args: { workflow: WorkflowDefinition; run: WorkflowRun; step: Extract<WorkflowStep,{type:"action"}> }): Promise<string> | string;
}
export type WorkflowEngineOptions = { taskExpiryMs?: number; confirmationExpiryMs?: number };

const getPath = (obj: unknown, path: string): unknown => {
  const keys = path.split(".");
  const read = (root: unknown) => keys.reduce((value: any, key) => value?.[key], root as any);
  const direct = read(obj);
  return direct === undefined ? read((obj as any)?.values) : direct;
};
const compare = (actual: unknown, operator: string, expected?: unknown) => operator === "exists" ? actual !== undefined && actual !== null : operator === "equals" ? actual === expected : operator === "notEquals" ? actual !== expected : operator === "gt" ? Number(actual) > Number(expected) : Number(actual) < Number(expected);
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

export class WorkflowEngine {
  constructor(
    private store: Store,
    private ai: AiProvider,
    private actionExecutor?: ActionExecutor,
    private grantIssuer?: ExecutionGrantIssuer,
    private options: WorkflowEngineOptions = {}
  ) {}

  /**
   * `flags.isTest` marks a run started from a `testing`-status workflow (requirement 13.5).
   *
   * Additive and inert: the engine never reads it, so control flow is identical whether it is set or
   * not. It is stamped at creation rather than patched on afterwards because a run that has already
   * dispatched its first step untagged is a run whose audit trail and any dispatched task describe
   * something other than a test.
   */
  async start(
    workflow: WorkflowDefinition,
    input: Record<string, unknown>,
    actorOverride?: { userId?: string; role?: string },
    flags: { isTest?: boolean } = {}
  ) {
    const timestamp = now();
    const actor = actorOverride ?? (input._actor ?? {}) as { userId?: string; role?: string };
    const run: WorkflowRun = { id: uid("run"), tenantId: workflow.tenantId, workflowId: workflow.id, workflowVersion: workflow.version, ...(flags.isTest ? { isTest: true as const } : {}), status: "RUNNING", currentStepId: workflow.startAt, createdBy: actor.userId, confirmedStepIds: [], stepResults: {}, context: { input, values: {}, lastAction: null }, audit: [{ id: uid("aud"), at: timestamp, type: "RUN_STARTED", message: "Workflow execution started", details: { actor: actor.userId, role: actor.role } }], createdAt: timestamp, updatedAt: timestamp, executionBackend: this.actionExecutor ? "agentcore" : "legacy" };
    await this.store.saveRun(run);
    return this.advance(workflow, run);
  }

  // evidence attributes the result to the agent that actually claimed the step and to the
  // single-use execution grant that authorized the write; the engine stamps the verification
  // outcome onto it so the run's own record says whether AmazFlow re-checked the claim.
  async resumeFromAgent(workflow: WorkflowDefinition, run: WorkflowRun, stepId: string, result: Record<string, unknown>, evidence?: NonNullable<StepResult["evidence"]>) {
    if (run.status !== "WAITING_AGENT" || run.currentStepId !== stepId) throw new Error("Run is not waiting for this agent result");
    const step = this.step(workflow, stepId);
    if (step.type !== "action") throw new Error("Agent task does not reference an action step");
    // The browser is the thing being checked, so its own "ok" is a claim, not a verdict. This
    // is the same independent re-test advance() already applies to managed actions: when the
    // step declares a verify contract, a self-declared success that does not hold up fails the
    // step instead of advancing the run.
    let ok = result.ok !== false;
    const verified = !ok || !step.verify || compare(getPath({ result }, step.verify.path), "equals", step.verify.equals);
    if (ok && !verified) { ok = false; (result as Record<string, unknown>).ok = false; (result as Record<string, unknown>).error = "Independent action verification failed"; }
    const expected = step.verify?.equals;
    const actual = step.verify ? getPath({ result }, step.verify.path) : undefined;
    run.context.lastAction = { result };
    run.stepResults = run.stepResults ?? {};
    run.stepResults[stepId] = { stepId, type: "action", provider: step.provider, operation: step.operation, status: ok ? "SUCCEEDED" : "FAILED", resolvedAt: now(), actionResult: result as any, evidence: evidence ? { ...evidence, verified, expected, actual } : undefined };
    this.event(run, ok ? "AGENT_RESULT" : !verified ? "VERIFICATION_FAILED" : "AGENT_RESULT_FAILED", ok ? `Agent completed ${stepId}` : !verified ? `Agent reported success for ${stepId} but AmazFlow could not verify it` : `Agent reported failure for ${stepId}`, stepId, { ...result, expected, actual });
    if (ok) { run.status = "RUNNING"; run.currentStepId = step.next; }
    else if (step.onFailure) { run.status = "RUNNING"; run.currentStepId = step.onFailure; }
    else { run.status = "FAILED"; run.currentStepId = undefined; await this.store.saveRun(run); return run; }
    return this.advance(workflow, run);
  }

  async resumeFromApproval(workflow: WorkflowDefinition, run: WorkflowRun, stepId: string, approved: boolean, actor?: { userId?: string; role?: string }) {
    const step = this.step(workflow, stepId);
    if (step.type !== "approval" || run.status !== "WAITING_APPROVAL") throw new Error("Run is not waiting for this approval");
    this.event(run, approved ? "APPROVED" : "REJECTED", approved ? "Approval granted" : "Approval rejected", stepId, { by: actor?.userId, role: actor?.role });
    run.status = "RUNNING";
    run.currentStepId = approved ? step.next : step.onReject;
    return this.advance(workflow, run);
  }

  async resumeFromConfirmation(workflow: WorkflowDefinition, run: WorkflowRun, stepId: string, actor?: { userId?: string; role?: string }) {
    const step = this.step(workflow, stepId);
    if (step.type !== "action" || run.status !== "AWAITING_CONFIRMATION" || run.currentStepId !== stepId) throw new Error("Run is not waiting for this confirmation");
    run.confirmedStepIds = [...new Set([...(run.confirmedStepIds ?? []), stepId])];
    run.pendingConfirmationId = undefined;
    run.status = "RUNNING";
    this.event(run, "CONFIRMATION_GRANTED", actor?.userId ? `Confirmed by ${actor.userId}` : `Confirmed ${step.name}`, stepId, { by: actor?.userId, role: actor?.role });
    return this.advance(workflow, run);
  }

  async cancel(run: WorkflowRun, actor?: { userId?: string; role?: string }) {
    if (!["RUNNING", "WAITING_APPROVAL", "WAITING_AGENT", "AWAITING_CONFIRMATION"].includes(run.status)) throw new Error("This run can no longer be cancelled");
    const completedSteps = Object.keys(run.stepResults ?? {}).length;
    run.status = "CANCELLED";
    run.currentStepId = undefined;
    this.event(run, "RUN_CANCEL_REQUESTED", "Cancellation requested", undefined, { by: actor?.userId, role: actor?.role });
    this.event(run, "RUN_CANCELLED", `Cancelled. ${completedSteps} step(s) completed before cancellation.`, undefined, { completedSteps });
    run.updatedAt = now();
    await this.store.saveRun(run);
    return run;
  }

  async timeout(run: WorkflowRun, message = "Execution timed out. No additional actions were taken.") {
    if (run.status !== "WAITING_AGENT" && run.status !== "AWAITING_CONFIRMATION") throw new Error("Run is not waiting on expirable work");
    run.status = "TIMED_OUT";
    this.event(run, "RUN_TIMED_OUT", message);
    run.updatedAt = now();
    await this.store.saveRun(run);
    return run;
  }

  private async advance(workflow: WorkflowDefinition, run: WorkflowRun): Promise<WorkflowRun> {
    for (let guard=0; guard<100 && run.status === "RUNNING"; guard++) {
      if (!run.currentStepId) throw new Error("Workflow ended without an end step");
      const step = this.step(workflow, run.currentStepId);
      if (step.type === "action" && step.requiresConfirmation && !(run.confirmedStepIds ?? []).includes(step.id)) {
        if (!this.store.saveConfirmation) throw new Error("Store does not support protected action confirmations");
        const timestamp = now();
        const confirmation: Confirmation = { id: uid("conf"), runId: run.id, tenantId: run.tenantId, stepId: step.id, message: `Confirm before: ${step.name}`, status: "PENDING", kind: "ACTION_GATE", summary: { provider: step.provider, operation: step.operation, name: step.name }, createdAt: timestamp, expiresAt: new Date(Date.now() + (this.options.confirmationExpiryMs ?? 10 * 60_000)).toISOString() };
        await this.store.saveConfirmation(confirmation);
        run.status = "AWAITING_CONFIRMATION";
        run.pendingConfirmationId = confirmation.id;
        this.event(run, "CONFIRMATION_REQUIRED", confirmation.message, step.id, { confirmationId: confirmation.id });
        run.updatedAt = now();
        await this.store.saveRun(run);
        break;
      }
      this.event(run, "STEP_STARTED", step.name, step.id);
      if (step.type === "ai") {
        try {
          const output = await this.ai.run(step, { input: run.context.input, ...((run.context.values as Record<string, unknown> | undefined) ?? {}) }, run);
          const values = (run.context.values ??= {}) as Record<string, unknown>;
          values[step.outputKey] = { value: output.value, confidence: output.confidence };
          this.applyMetadata(run, output.metadata);
          this.event(run, "AI_COMPLETED", `${step.operation} completed`, step.id, { confidence: output.confidence, traceId: output.metadata?.traceId });
          run.currentStepId = step.next;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const allowlistRejected = /outside.*allowlist/i.test(message);
          const canRouteToReview = allowlistRejected && step.allowedValues?.map(String).includes("REVIEW");
          if (canRouteToReview) {
            const values = (run.context.values ??= {}) as Record<string, unknown>;
            values[step.outputKey] = { value: "REVIEW", confidence: 0 };
            this.event(
              run,
              "AI_ALLOWLIST_REJECTED",
              `AmazFlow's AI returned a value outside what "${step.name}" allows -- routed to human review and no action was taken`,
              step.id,
              { operation: step.operation, fallback: "REVIEW" },
            );
            run.currentStepId = step.next;
            continue;
          }
          run.status = "FAILED";
          run.currentStepId = undefined;
          this.event(
            run,
            allowlistRejected ? "AI_ALLOWLIST_REJECTED" : "AI_FAILED",
            allowlistRejected
              ? `AmazFlow's AI returned a value outside what "${step.name}" allows -- no action was taken`
              : `"${step.name}" could not complete: ${message}`,
            step.id,
            { operation: step.operation },
          );
        }
      } else if (step.type === "condition") {
        const outcome = compare(getPath(run.context, step.path), step.operator, step.value);
        this.event(run, "CONDITION_EVALUATED", `${step.path} was ${outcome}`, step.id, { outcome });
        run.currentStepId = outcome ? step.whenTrue : step.whenFalse;
      } else if (step.type === "approval") {
        run.status = "WAITING_APPROVAL";
        await this.store.saveApproval({ runId: run.id, stepId: step.id, message: step.message, roles: step.roles, status: "PENDING" });
        this.event(run, "APPROVAL_REQUIRED", step.message, step.id, { roles: step.roles });
      } else if (step.type === "action") {
        if (step.provider === "mock") {
          const result = { ok: true, provider: step.provider, operation: step.operation, simulated: true, status: step.input?.status ?? "COMPLETED" };
          run.context.lastAction = { result };
          run.stepResults = run.stepResults ?? {};
          run.stepResults[step.id] = { stepId: step.id, type: "action", provider: step.provider, operation: step.operation, status: "SUCCEEDED", resolvedAt: now(), actionResult: { ok: true, body: result } };
          this.event(run, "ACTION_COMPLETED", `${step.provider} action completed`, step.id, result);
          run.currentStepId = step.next;
        } else if (this.shouldUseConnectedAgent(step) || !this.actionExecutor) {
          await this.queueConnectedTask(workflow, run, step);
        } else {
          const executionGrant = await this.grantIssuer?.issue({ workflow, run, step });
          const outcome = await this.actionExecutor.execute({ workflow, run, step, input: this.resolve(step.input, run.context), executionGrant });
          this.applyMetadata(run, outcome.metadata);
          if (outcome.status === "FALLBACK" && !outcome.sideEffectObserved && step.browserMode !== "managed") {
            this.event(run, "MANAGED_EXECUTION_FALLBACK", outcome.error ?? "Managed execution unavailable before acting", step.id, { traceId: outcome.metadata?.traceId });
            await this.queueConnectedTask(workflow, run, step);
          } else if (outcome.status === "SUCCEEDED") {
            const result = { ok: true, ...(outcome.result ?? {}) };
            run.context.lastAction = { result };
            const verified = !step.verify || compare(getPath({ result }, step.verify.path), "equals", step.verify.equals);
            run.stepResults = run.stepResults ?? {};
            run.stepResults[step.id] = { stepId: step.id, type: "action", provider: step.provider, operation: step.operation, status: verified ? "SUCCEEDED" : "FAILED", resolvedAt: now(), actionResult: { ok: verified, body: result, error: verified ? undefined : "Independent action verification failed" } };
            this.event(run, verified ? "ACTION_COMPLETED" : "VERIFICATION_FAILED", verified ? `${step.provider}:${step.operation}` : "Independent action verification failed", step.id, { traceId: outcome.metadata?.traceId, expected: step.verify?.equals, actual: step.verify ? getPath({ result }, step.verify.path) : undefined });
            if (verified) run.currentStepId = step.next;
            else if (step.onFailure) run.currentStepId = step.onFailure;
            else { run.status = "FAILED"; run.currentStepId = undefined; }
          } else {
            const uncertain = outcome.sideEffectObserved === true;
            run.context.lastAction = { result: { ok: false, error: outcome.error, uncertain } };
            run.stepResults = run.stepResults ?? {};
            run.stepResults[step.id] = { stepId: step.id, type: "action", provider: step.provider, operation: step.operation, status: "FAILED", resolvedAt: now(), actionResult: { ok: false, error: outcome.error } };
            this.event(run, uncertain ? "ACTION_RECONCILIATION_REQUIRED" : "ACTION_FAILED", outcome.error ?? "Managed execution failed", step.id, { traceId: outcome.metadata?.traceId, sideEffectObserved: uncertain });
            if (step.onFailure) run.currentStepId = step.onFailure;
            else { run.status = "FAILED"; run.currentStepId = undefined; }
          }
        }
      } else if (step.type === "verify") {
        const actual = getPath(run.context, step.path);
        const passed = compare(actual, step.operator, step.value);
        run.stepResults = run.stepResults ?? {};
        run.stepResults[step.id] = { stepId: step.id, type: "verify", status: passed ? "SUCCEEDED" : "FAILED", resolvedAt: now(), verificationResult: { passed, expected: step.value, actual } };
        this.event(run, passed ? "VERIFIED" : "VERIFICATION_FAILED", passed ? "Expected state confirmed" : "Expected state not confirmed", step.id, { actual: getPath(run.context, step.path) });
        run.currentStepId = passed ? step.next : step.onFailure;
      } else {
        run.status = step.outcome === "success" ? "COMPLETED" : "FAILED";
        run.currentStepId = undefined;
        this.event(run, run.status, step.name, step.id);
      }
      run.updatedAt = now();
      await this.store.saveRun(run);
    }
    return run;
  }

  private step(workflow: WorkflowDefinition, id: string) { const step = workflow.steps.find(s => s.id === id); if (!step) throw new Error(`Missing step ${id}`); return step; }
  private event(run: WorkflowRun, type: string, message: string, stepId?: string, details?: Record<string, unknown>) { run.audit.push({ id: uid("aud"), at: now(), type, stepId, message, details }); }
  private resolve(input: Record<string, unknown>, context: Record<string, unknown>): Record<string, unknown> {
    const resolveValue = (value: unknown): unknown => {
      if (typeof value === "string" && value.startsWith("$.")) return getPath(context, value.slice(2));
      if (typeof value === "string") return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
        const resolved = getPath(context, path);
        return resolved === undefined ? "" : String(resolved);
      });
      if (Array.isArray(value)) return value.map(resolveValue);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, resolveValue(nested)]));
      return value;
    };
    return resolveValue(input) as Record<string, unknown>;
  }
  private shouldUseConnectedAgent(step: Extract<WorkflowStep,{type:"action"}>) {
    if (step.provider !== "browser") return false;
    return step.browserMode === "connected" || (!step.connectionId && step.browserMode !== "managed");
  }
  private async queueConnectedTask(workflow: WorkflowDefinition, run: WorkflowRun, step: Extract<WorkflowStep,{type:"action"}>) {
    const task: AgentTask = { id: uid("task"), runId: run.id, tenantId: run.tenantId, stepId: step.id, provider: step.provider, operation: step.operation, input: this.resolve(step.input, run.context), expiresAt: new Date(Date.now()+(this.options.taskExpiryMs ?? 5*60_000)).toISOString(), status: "PENDING", workflowId: workflow.id, assignedRoles: workflow.assignedRoles, createdBy: run.createdBy };
    await this.store.saveTask(task);
    run.status = "WAITING_AGENT";
    this.event(run, "AGENT_TASK_CREATED", `${step.provider}:${step.operation}`, step.id, { taskId: task.id });
  }
  private applyMetadata(run: WorkflowRun, metadata?: ExecutionMetadata) {
    if (!metadata) return;
    run.executionBackend = metadata.executionBackend;
    run.agentSessionId = metadata.agentSessionId ?? run.agentSessionId;
    run.browserSessionId = metadata.browserSessionId ?? run.browserSessionId;
    run.traceId = metadata.traceId ?? run.traceId;
  }
}

export class DemoAiProvider implements AiProvider {
  async run(step: Extract<WorkflowStep,{type:"ai"}>, context: Record<string, unknown>) {
    const text = JSON.stringify(context).toLowerCase();
    const value = step.allowedValues?.find(v => text.includes(v.toLowerCase())) ?? step.allowedValues?.[0] ?? { summary: text.slice(0,120) };
    return { value, confidence: text.includes("ambiguous") ? 0.55 : 0.96, raw: { mode: "synthetic-local" } };
  }
}
