import { z } from "zod";

export const dataClassSchema = z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "PII", "PHI", "FINANCIAL", "RESTRICTED"]);
export const roleSchema = z.enum(["FRONTLINE", "CLIENT_ADMIN", "SUPER_ADMIN"]);
export const browserModeSchema = z.enum(["auto", "managed", "connected"]);

// One canonical execution surface per agent-executed step. Providers that AmazFlow runs itself
// (api, spreadsheet, email, file, mock) have no target -- nothing is dispatched to an agent.
export const executionTargetSchema = z.enum(["browser_extension", "desktop_agent"]);
export type ExecutionTarget = z.infer<typeof executionTargetSchema>;
export const agentTypeSchema = z.enum(["CHROME_EXTENSION", "DESKTOP_AGENT"]);
export type AgentType = z.infer<typeof agentTypeSchema>;

export const AGENT_TYPE_FOR_TARGET: Record<ExecutionTarget, AgentType> = {
  browser_extension: "CHROME_EXTENSION",
  desktop_agent: "DESKTOP_AGENT"
};

// The action vocabulary each surface can carry out. An agent advertises the subset it implements
// at registration, and the server refuses a claim for anything the agent did not advertise -- so
// an older agent build simply does not receive work it would fail.
export const BROWSER_ACTIONS = [
  "NAVIGATE", "READ_TEXT", "CLICK", "TYPE", "SELECT", "CHECK",
  "SCROLL_TO", "WAIT_FOR", "VERIFY_TEXT", "CAPTURE_EVIDENCE", "SET_EMPLOYEE_STATUS"
] as const;
export const DESKTOP_ACTIONS = [
  "desktop.open_app", "desktop.focus_window", "desktop.click", "desktop.type_text",
  "desktop.keypress", "desktop.wait_for", "desktop.verify_text", "desktop.capture_evidence"
] as const;
export type BrowserAction = (typeof BROWSER_ACTIONS)[number];
export type DesktopAction = (typeof DESKTOP_ACTIONS)[number];

export const ACTIONS_BY_TARGET: Record<ExecutionTarget, readonly string[]> = {
  browser_extension: BROWSER_ACTIONS,
  desktop_agent: DESKTOP_ACTIONS
};

// The provider a step uses fully determines its surface, so the builder never has to offer an
// invalid pairing and older workflows get the right target without being rewritten.
export function targetForProvider(provider: string): ExecutionTarget | undefined {
  if (provider === "browser") return "browser_extension";
  if (provider === "desktop") return "desktop_agent";
  return undefined;
}
export function targetForAction(operation: string): ExecutionTarget | undefined {
  if ((DESKTOP_ACTIONS as readonly string[]).includes(operation)) return "desktop_agent";
  if ((BROWSER_ACTIONS as readonly string[]).includes(operation)) return "browser_extension";
  return undefined;
}
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
  baseStep.extend({
    type: z.literal("action"),
    provider: z.enum(["browser", "desktop", "api", "spreadsheet", "email", "file", "mock"]),
    operation: z.string(),
    executionTarget: executionTargetSchema.optional(),
    input: z.record(z.unknown()).default({}),
    verify: z.object({ path: z.string(), equals: z.unknown() }).optional(),
    requiresConfirmation: z.boolean().optional(),
    onFailure: z.string().optional(),
    connectionId: z.string().min(1).optional(),
    browserMode: browserModeSchema.default("auto").optional(),
    path: z.string().startsWith("/").optional()
  }),
  baseStep.extend({ type: z.literal("condition"), path: z.string(), operator: z.enum(["equals", "notEquals", "exists", "gt", "lt"]), value: z.unknown().optional(), whenTrue: z.string(), whenFalse: z.string() }),
  baseStep.extend({ type: z.literal("approval"), message: z.string(), roles: z.array(roleSchema).default(["CLIENT_ADMIN"]), onReject: z.string().optional() }),
  baseStep.extend({ type: z.literal("verify"), path: z.string(), operator: z.enum(["equals", "notEquals", "exists", "gt", "lt"]), value: z.unknown().optional(), onFailure: z.string().optional() }),
  baseStep.extend({ type: z.literal("end"), outcome: z.enum(["success", "failed"]) })
]);

/**
 * The persisted workflow status set (requirement 13.1, design decision D-5).
 *
 * `active` still means published-and-runnable and is deliberately NOT renamed. It is the value the
 * run gate reads, the value `preflightFor` reads, and the value the managed-connection check reads;
 * renaming it to `published` would be a rename of the one string the whole execution path depends on,
 * for a cosmetic gain that belongs at the presentation layer. The Published label lives in the shared
 * label mapping, which is what that module is for.
 */
export const WORKFLOW_STATUSES = ["draft", "testing", "active", "archived"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

/**
 * `paused` predates the status set above and still exists in stored records.
 *
 * It stays PARSEABLE and is never written again (requirement 13.3). Dropping it from the schema would
 * make every stored workflow carrying it fail validation -- so a record that is merely old would read
 * as a record that is corrupt, and the workflow would disappear from its owner's list rather than
 * displaying as Archived.
 */
export const LEGACY_WORKFLOW_STATUSES = ["paused"] as const;

/** The two statuses the run gate admits. Everything else is refused with a state conflict (13.4). */
export const RUNNABLE_WORKFLOW_STATUSES = ["active", "testing"] as const;

export const isRunnableWorkflowStatus = (status: string): boolean =>
  (RUNNABLE_WORKFLOW_STATUSES as readonly string[]).includes(status);

/**
 * The status a surface should render, which is not always the status that is stored.
 *
 * The single place the legacy value is translated. A view that compared against `"paused"` itself
 * would be a second opinion about what the legacy value means, and the two would eventually disagree.
 */
export const displayWorkflowStatus = (status: string): WorkflowStatus | string =>
  status === "paused" ? "archived" : status;

export const workflowDefinitionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  version: z.number().int().positive(),
  status: z.enum([...WORKFLOW_STATUSES, ...LEGACY_WORKFLOW_STATUSES]).default("draft"),
  dataClass: dataClassSchema.default("INTERNAL"),
  assignedRoles: z.array(roleSchema).default(["FRONTLINE", "CLIENT_ADMIN"]),
  manualMinutesEstimate: z.number().positive().optional(),
  customerSummary: z.string().optional(),
  // The fourth entry point. A workflow can start because a person asked for it in the app, from
  // an agent, or because its own schedule came due -- all three produce the same run.
  trigger: z.object({
    type: z.literal("schedule"),
    everyMinutes: z.number().int().min(5).max(10080),
    enabled: z.boolean().default(false),
    lastFiredAt: z.string().datetime().optional()
  }).optional(),
  startAt: z.string().min(1),
  steps: z.array(workflowStepSchema).min(1),
  allowedProviders: z.array(z.enum(["browser", "desktop", "api", "spreadsheet", "email", "file", "mock"])).min(1)
}).superRefine((workflow, ctx) => {
  const ids = new Set(workflow.steps.map(s => s.id));
  if (!ids.has(workflow.startAt)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "startAt must reference a step" });
  for (const step of workflow.steps) {
    const refs = [step.next, step.type === "condition" ? step.whenTrue : undefined, step.type === "condition" ? step.whenFalse : undefined, step.type === "approval" ? step.onReject : undefined, step.type === "verify" ? step.onFailure : undefined, step.type === "action" ? step.onFailure : undefined].filter(Boolean) as string[];
    for (const ref of refs) if (!ids.has(ref)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Step ${step.id} references missing step ${ref}` });
    if (step.type === "action" && !workflow.allowedProviders.includes(step.provider)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Provider ${step.provider} is not allowed`, path: ["steps"] });
    if (step.type === "action" && step.provider !== "browser" && (step.connectionId || step.browserMode || step.path)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Step ${step.id} can only use browser connection fields with the browser provider`, path: ["steps"] });
    }
    if (workflow.status === "active" && step.type === "action" && step.provider === "browser" && step.browserMode === "managed" && !step.connectionId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Managed browser step ${step.id} must reference an active connection`, path: ["steps"] });
    }
    // An agent-executed step must name exactly one surface, and that surface must be the one its
    // provider and action actually belong to. This is what keeps a desktop action from being
    // dispatched to a browser and vice versa.
    if (step.type === "action") {
      const expected = targetForProvider(step.provider);
      if (expected && step.executionTarget && step.executionTarget !== expected) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Step ${step.id} runs on ${expected.replace("_", " ")}, so it cannot target ${step.executionTarget}`, path: ["steps"] });
      }
      if (!expected && step.executionTarget) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Step ${step.id} uses the ${step.provider} provider, which AmazFlow runs itself and cannot be assigned to an agent`, path: ["steps"] });
      }
      if (expected) {
        const target = step.executionTarget ?? expected;
        if (!ACTIONS_BY_TARGET[target].includes(step.operation)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${step.operation} is not an action the ${target === "desktop_agent" ? "Desktop App" : "Chrome Extension"} can perform`, path: ["steps"] });
        }
      }
    }
  }
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

// What a workflow needs installed before it can run, derived from its own steps rather than
// declared separately -- so it can never drift from what the workflow actually does.
export function requiredTargets(workflow: Pick<WorkflowDefinition, "steps">): ExecutionTarget[] {
  const targets = new Set<ExecutionTarget>();
  for (const step of workflow.steps) {
    if (step.type !== "action") continue;
    const target = step.executionTarget ?? targetForProvider(step.provider);
    if (target) targets.add(target);
  }
  return [...targets];
}

export type AgentRegistration = {
  agentId: string;
  installationId: string;
  agentType: AgentType;
  version: string;
  capabilities: string[];
  organizationId: string;
  platform: string;
  lastHeartbeatAt: string | null;
  connectionStatus: "connected" | "offline" | "revoked";
};

export const browserConnectionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1).max(120),
  baseUrl: z.string().url().refine(value => new URL(value).protocol === "https:", "baseUrl must use https"),
  allowedOrigins: z.array(z.string().url().refine(value => new URL(value).origin === value, "allowedOrigins must contain origins only")).min(1).max(20),
  preferredMode: browserModeSchema.default("auto"),
  status: z.enum(["pending", "active", "revoked", "error"]).default("pending"),
  managedProfileId: z.string().optional(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type BrowserConnection = z.infer<typeof browserConnectionSchema>;

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
  // Who actually performed this step and under what authority. Written when a browser agent
  // resolves a claimed task: the agent identity comes from the claim, the grant id from the
  // single-use execution grant that authorized the write, and `verified` records whether
  // AmazFlow re-tested the step's own verify contract rather than taking the browser's word.
  evidence?: {
    taskId?: string;
    agentId?: string;
    grantId?: string | null;
    claimedAt?: string | null;
    reportedAt?: string;
    page?: { url?: string; title?: string | null; origin?: string; observedAt?: string } | null;
    verified?: boolean;
    expected?: unknown;
    actual?: unknown;
  };
};
export type WorkflowRun = {
  id: string;
  tenantId: string;
  workflowId: string;
  workflowVersion: number;
  status: RunStatus;
  /**
   * Set when the run was started from a `testing`-status workflow (requirement 13.5).
   *
   * The tag and nothing more: no counting or analytics-exclusion policy is attached to it, because
   * whether test runs consume the concurrency ceiling and whether they appear in a customer's numbers
   * are separate business decisions (deferred question Q-7) and neither has been made. Recording the
   * fact now is what lets either be applied later without a schema change — and a run that was a test
   * cannot be identified after the fact from anything else the record holds.
   */
  isTest?: boolean;
  currentStepId?: string;
  createdBy?: string;
  confirmedStepIds?: string[];
  pendingConfirmationId?: string;
  stepResults?: Record<string, StepResult>;
  context: Record<string, unknown>;
  audit: AuditEvent[];
  createdAt: string;
  updatedAt: string;
  executionBackend?: "agentcore" | "legacy";
  agentSessionId?: string;
  browserSessionId?: string;
  traceId?: string;
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
