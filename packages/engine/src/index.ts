// NOT DEPLOYED. This local implementation is not connected to any AWS resource and is not
// what customers use. It exists only for local engine-logic testing. The production workflow
// engine lives entirely inside the ZipFile in infrastructure/aws-cdk/amazflow-dev.yaml.
import type { WorkflowDefinition, WorkflowRun, WorkflowStep } from "@amazflow/workflow-schema";

export type AgentTask = { id: string; runId: string; tenantId: string; stepId: string; provider: string; operation: string; input: Record<string, unknown>; expiresAt: string; status: "PENDING" | "COMPLETED" };
export type Approval = { runId: string; stepId: string; message: string; roles: string[]; status: "PENDING" | "APPROVED" | "REJECTED" };
export interface Store {
  getWorkflow(id: string): Promise<WorkflowDefinition | undefined>;
  saveRun(run: WorkflowRun): Promise<void>;
  getRun(id: string): Promise<WorkflowRun | undefined>;
  saveTask(task: AgentTask): Promise<void>;
  saveApproval(approval: Approval): Promise<void>;
}
export interface AiProvider { run(step: Extract<WorkflowStep,{type:"ai"}>, context: Record<string, unknown>): Promise<{ value: unknown; confidence: number; raw?: unknown }>; }

const getPath = (obj: unknown, path: string): unknown => path.split(".").reduce((value: any, key) => value?.[key], obj as any);
const compare = (actual: unknown, operator: string, expected?: unknown) => operator === "exists" ? actual !== undefined && actual !== null : operator === "equals" ? actual === expected : operator === "notEquals" ? actual !== expected : operator === "gt" ? Number(actual) > Number(expected) : Number(actual) < Number(expected);
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

export class WorkflowEngine {
  constructor(private store: Store, private ai: AiProvider) {}

  async start(workflow: WorkflowDefinition, input: Record<string, unknown>) {
    const timestamp = now();
    const run: WorkflowRun = { id: uid("run"), tenantId: workflow.tenantId, workflowId: workflow.id, workflowVersion: workflow.version, status: "RUNNING", currentStepId: workflow.startAt, context: { input }, audit: [{ id: uid("aud"), at: timestamp, type: "RUN_CREATED", message: `Started ${workflow.name}` }], createdAt: timestamp, updatedAt: timestamp };
    await this.store.saveRun(run);
    return this.advance(workflow, run);
  }

  async resumeFromAgent(workflow: WorkflowDefinition, run: WorkflowRun, stepId: string, result: Record<string, unknown>) {
    if (run.status !== "WAITING_AGENT" || run.currentStepId !== stepId) throw new Error("Run is not waiting for this agent result");
    run.context.lastAction = { result };
    this.event(run, "AGENT_RESULT", `Agent completed ${stepId}`, stepId, result);
    const step = this.step(workflow, stepId);
    run.status = "RUNNING";
    run.currentStepId = step.next;
    return this.advance(workflow, run);
  }

  async resumeFromApproval(workflow: WorkflowDefinition, run: WorkflowRun, stepId: string, approved: boolean) {
    const step = this.step(workflow, stepId);
    if (step.type !== "approval" || run.status !== "WAITING_APPROVAL") throw new Error("Run is not waiting for this approval");
    this.event(run, approved ? "APPROVED" : "REJECTED", approved ? "Approval granted" : "Approval rejected", stepId);
    run.status = "RUNNING";
    run.currentStepId = approved ? step.next : step.onReject;
    return this.advance(workflow, run);
  }

  private async advance(workflow: WorkflowDefinition, run: WorkflowRun): Promise<WorkflowRun> {
    for (let guard=0; guard<100 && run.status === "RUNNING"; guard++) {
      if (!run.currentStepId) throw new Error("Workflow ended without an end step");
      const step = this.step(workflow, run.currentStepId);
      this.event(run, "STEP_STARTED", step.name, step.id);
      if (step.type === "ai") {
        const output = await this.ai.run(step, run.context);
        run.context[step.outputKey] = output;
        this.event(run, "AI_COMPLETED", `${step.operation} completed`, step.id, { confidence: output.confidence });
        run.currentStepId = output.confidence < step.confidenceThreshold ? this.findApproval(workflow, step.id) ?? step.next : step.next;
      } else if (step.type === "condition") {
        const outcome = compare(getPath(run.context, step.path), step.operator, step.value);
        this.event(run, "CONDITION_EVALUATED", `${step.path} was ${outcome}`, step.id, { outcome });
        run.currentStepId = outcome ? step.whenTrue : step.whenFalse;
      } else if (step.type === "approval") {
        run.status = "WAITING_APPROVAL";
        await this.store.saveApproval({ runId: run.id, stepId: step.id, message: step.message, roles: step.roles, status: "PENDING" });
        this.event(run, "APPROVAL_REQUESTED", step.message, step.id);
      } else if (step.type === "action") {
        if (step.provider === "mock") {
          run.context.lastAction = { result: { ok: true, operation: step.operation } };
          this.event(run, "ACTION_COMPLETED", `${step.provider}:${step.operation}`, step.id);
          run.currentStepId = step.next;
        } else {
          const task: AgentTask = { id: uid("task"), runId: run.id, tenantId: run.tenantId, stepId: step.id, provider: step.provider, operation: step.operation, input: this.resolve(step.input, run.context), expiresAt: new Date(Date.now()+5*60_000).toISOString(), status: "PENDING" };
          await this.store.saveTask(task);
          run.status = "WAITING_AGENT";
          this.event(run, "AGENT_TASK_CREATED", `${step.provider}:${step.operation}`, step.id, { taskId: task.id });
        }
      } else if (step.type === "verify") {
        const passed = compare(getPath(run.context, step.path), step.operator, step.value);
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
  private findApproval(workflow: WorkflowDefinition, after: string) { const direct = workflow.steps.find(s => s.type === "approval" && s.id !== after); return direct?.id; }
  private resolve(input: Record<string, unknown>, context: Record<string, unknown>) { return Object.fromEntries(Object.entries(input).map(([k,v]) => [k, typeof v === "string" && v.startsWith("$.") ? getPath(context, v.slice(2)) : v])); }
}

export class DemoAiProvider implements AiProvider {
  async run(step: Extract<WorkflowStep,{type:"ai"}>, context: Record<string, unknown>) {
    const text = JSON.stringify(context).toLowerCase();
    const value = step.allowedValues?.find(v => text.includes(v.toLowerCase())) ?? step.allowedValues?.[0] ?? { summary: text.slice(0,120) };
    return { value, confidence: text.includes("ambiguous") ? 0.55 : 0.96, raw: { mode: "synthetic-local" } };
  }
}
