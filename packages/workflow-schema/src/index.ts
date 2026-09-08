import { z } from "zod";

export const dataClassSchema = z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "PII", "PHI", "FINANCIAL", "RESTRICTED"]);
export const roleSchema = z.enum(["FRONTLINE", "CLIENT_ADMIN", "SUPER_ADMIN"]);
export type AmazFlowRole = z.infer<typeof roleSchema>;

export const permissionsByRole: Record<AmazFlowRole, readonly string[]> = {
  FRONTLINE: ["workflow:view_assigned", "run:create_assigned", "run:view_own"],
  CLIENT_ADMIN: ["workflow:view_tenant", "run:create_tenant", "run:view_tenant", "approval:decide", "assignment:manage_tenant"],
  SUPER_ADMIN: ["tenant:manage", "workflow:configure", "workflow:publish", "connector:manage", "run:create_any", "run:view_any", "approval:decide", "audit:view_any"]
};

const baseStep = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  next: z.string().optional(),
  retry: z.object({ maxAttempts: z.number().int().min(1).max(10).default(1) }).optional()
});

export const workflowStepSchema = z.discriminatedUnion("type", [
  baseStep.extend({ type: z.literal("ai"), operation: z.enum(["classify", "extract", "transform", "summarize", "choose"]), prompt: z.string(), outputKey: z.string(), allowedValues: z.array(z.string()).optional(), confidenceThreshold: z.number().min(0).max(1).default(0.85) }),
  baseStep.extend({ type: z.literal("action"), provider: z.enum(["browser", "api", "spreadsheet", "email", "file", "mock"]), operation: z.string(), input: z.record(z.unknown()).default({}), verify: z.object({ path: z.string(), equals: z.unknown() }).optional(), requiresConfirmation: z.boolean().optional(), onFailure: z.string().optional() }),
  baseStep.extend({ type: z.literal("condition"), path: z.string(), operator: z.enum(["equals", "notEquals", "exists", "gt", "lt"]), value: z.unknown().optional(), whenTrue: z.string(), whenFalse: z.string() }),
  baseStep.extend({ type: z.literal("approval"), message: z.string(), roles: z.array(roleSchema).default(["CLIENT_ADMIN"]), onReject: z.string().optional() }),
  baseStep.extend({ type: z.literal("verify"), path: z.string(), operator: z.enum(["equals", "notEquals", "exists", "gt", "lt"]), value: z.unknown().optional(), onFailure: z.string().optional() }),
  baseStep.extend({ type: z.literal("end"), outcome: z.enum(["success", "failed"]) })
]);

export const workflowDefinitionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  version: z.number().int().positive(),
  status: z.enum(["draft", "active", "paused"]).default("draft"),
  dataClass: dataClassSchema.default("INTERNAL"),
  assignedRoles: z.array(roleSchema).default(["FRONTLINE", "CLIENT_ADMIN"]),
  manualMinutesEstimate: z.number().positive().optional(),
  customerSummary: z.string().optional(),
  startAt: z.string().min(1),
  steps: z.array(workflowStepSchema).min(1),
  allowedProviders: z.array(z.enum(["browser", "api", "spreadsheet", "email", "file", "mock"])).min(1)
}).superRefine((workflow, ctx) => {
  const ids = new Set(workflow.steps.map(s => s.id));
  if (!ids.has(workflow.startAt)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "startAt must reference a step" });
  for (const step of workflow.steps) {
    const refs = [step.next, step.type === "condition" ? step.whenTrue : undefined, step.type === "condition" ? step.whenFalse : undefined, step.type === "approval" ? step.onReject : undefined, step.type === "verify" ? step.onFailure : undefined, step.type === "action" ? step.onFailure : undefined].filter(Boolean) as string[];
    for (const ref of refs) if (!ids.has(ref)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Step ${step.id} references missing step ${ref}` });
    if (step.type === "action" && !workflow.allowedProviders.includes(step.provider)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Provider ${step.provider} is not allowed`, path: ["steps"] });
  }
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export type RunStatus = "RUNNING" | "AWAITING_CONFIRMATION" | "WAITING_AGENT" | "WAITING_APPROVAL" | "CANCELLED" | "TIMED_OUT" | "COMPLETED" | "FAILED";
export type AuditEvent = { id: string; at: string; type: string; stepId?: string; message: string; details?: Record<string, unknown> };
export type StepResult = {
  stepId: string;
  type: "action" | "verify";
  provider?: string;
  operation?: string;
  status: "SUCCEEDED" | "FAILED";
  resolvedAt: string;
  actionResult?: { ok: boolean; status?: number; body?: unknown; error?: string };
  verificationResult?: { passed: boolean; expected: unknown; actual: unknown };
};
export type WorkflowRun = {
  id: string;
  tenantId: string;
  workflowId: string;
  workflowVersion: number;
  status: RunStatus;
  currentStepId?: string;
  createdBy?: string;
  confirmedStepIds?: string[];
  pendingConfirmationId?: string;
  stepResults?: Record<string, StepResult>;
  context: Record<string, unknown>;
  audit: AuditEvent[];
  createdAt: string;
  updatedAt: string;
};

export const sampleWorkflow: WorkflowDefinition = {
  id: "workflow-sample-ops",
  tenantId: "amazflow",
  name: "Configurable employee status change",
  description: "A sample definition proving that business workflows are configuration, not application code.",
  version: 1,
  status: "active",
  dataClass: "PII",
  assignedRoles: ["FRONTLINE", "CLIENT_ADMIN"],
  manualMinutesEstimate: 20,
  customerSummary: "Turns off a departing employee's access across your systems",
  startAt: "interpret",
  allowedProviders: ["browser", "mock"],
  steps: [
    { id: "interpret", name: "Interpret request", type: "ai", operation: "extract", prompt: "Extract the requested employee action, and also extract the employee's id if one is mentioned in the request (a code like E-10042) as the field employeeId -- omit employeeId if none is mentioned.", outputKey: "decision", allowedValues: ["DISABLE", "REVIEW"], confidenceThreshold: 0.85, next: "safe" },
    { id: "safe", name: "Check certainty", type: "condition", path: "decision.value", operator: "equals", value: "DISABLE", whenTrue: "execute", whenFalse: "approval" },
    { id: "approval", name: "Human review", type: "approval", message: "Review the requested employee change", roles: ["CLIENT_ADMIN"], next: "execute", onReject: "rejected" },
    { id: "execute", name: "Execute in browser", type: "action", provider: "browser", operation: "SET_EMPLOYEE_STATUS", input: { status: "DISABLED", identifierSelector: '[data-amazflow="employee-id"]', expectedIdentifier: "{{values.decision.employeeId}}" }, verify: { path: "result.status", equals: "DISABLED" }, requiresConfirmation: true, next: "verified" },
    { id: "verified", name: "Verify final state", type: "verify", path: "lastAction.result.status", operator: "equals", value: "DISABLED", next: "done", onFailure: "failed" },
    { id: "done", name: "Completed", type: "end", outcome: "success" },
    { id: "rejected", name: "Rejected", type: "end", outcome: "failed" },
    { id: "failed", name: "Verification failed", type: "end", outcome: "failed" }
  ]
};

export { sampleDataEntryWorkflow } from "./sample-data-entry";
