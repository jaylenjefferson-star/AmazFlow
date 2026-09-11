// AmazFlow operator vocabulary.
//
// The control plane speaks in implementation terms -- AgentCore harnesses, Gateway tool
// invocations, Bedrock traces, Cognito groups, DynamoDB audit rows. None of that belongs in
// front of an operator. This module is the single translation boundary: every enum, status,
// provider, and audit type the backend emits gets mapped here to the AmazFlow name for it.
//
// The rule: normal views use these labels only. Raw backend identifiers appear exclusively
// inside an explicitly opened "Technical detail" disclosure, never in a table cell, pill,
// heading, or timeline row.

export type Tone = "neutral" | "running" | "waiting" | "good" | "bad" | "muted" | "ai";

/* ------------------------------------------------------------------ run status ------------ */

export const RUN_STATUS_LABEL: Record<string, string> = {
  RUNNING: "Running",
  AWAITING_CONFIRMATION: "Awaiting confirmation",
  WAITING_AGENT: "Waiting on browser",
  WAITING_APPROVAL: "Waiting on approval",
  CANCELLED: "Cancelled",
  TIMED_OUT: "Timed out",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export const RUN_STATUS_TONE: Record<string, Tone> = {
  RUNNING: "running",
  AWAITING_CONFIRMATION: "waiting",
  WAITING_AGENT: "waiting",
  WAITING_APPROVAL: "waiting",
  CANCELLED: "muted",
  TIMED_OUT: "bad",
  COMPLETED: "good",
  FAILED: "bad",
};

/**
 * The same statuses, in the register a customer reads (task 9.2).
 *
 * There were two enumeration-to-label mappings in this repository: this file for the staff console
 * and `console/copy.ts` for the customer one, each with its own `switch` over run status. That is
 * the arrangement requirement 3.2 forbids, and the reason is not tidiness -- the two had already
 * diverged on which statuses exist, so the same run could be "Failed" to staff and "In progress" to
 * the customer looking at it, and the customer's reading is the one that becomes true for them.
 *
 * The two registers are both kept, because they are genuinely different registers: an operator wants
 * the status, a customer wants to know what is happening to their work. What is NOT kept is two
 * enumerations. Both maps are keyed by the same status set and `runStatus()` below reads whichever
 * register the surface asks for, so a status added in one place cannot go missing from the other.
 */
export const CUSTOMER_RUN_STATUS_LABEL: Record<string, string> = {
  RUNNING: "Making the change",
  AWAITING_CONFIRMATION: "Waiting for your confirmation",
  WAITING_AGENT: "Waiting for the AmazFlow Agent",
  WAITING_APPROVAL: "Waiting on your approval",
  CANCELLED: "Cancelled",
  TIMED_OUT: "Timed out",
  COMPLETED: "Completed and verified",
  FAILED: "Needs a look",
};

/** Which register a surface speaks in. */
export type LabelRegister = "operator" | "customer";

/** Statuses that mean AmazFlow is mid-flight and the row should feel alive. */
export const LIVE_STATUSES = ["RUNNING", "WAITING_AGENT", "WAITING_APPROVAL", "AWAITING_CONFIRMATION"];
/** Statuses that mean a human needs to look at this. */
export const EXCEPTION_STATUSES = ["FAILED", "TIMED_OUT"];
/** Statuses the control plane will accept a cancel for (handler.ts cancelRun). */
export const CANCELLABLE_STATUSES = ["RUNNING", "WAITING_APPROVAL", "WAITING_AGENT", "AWAITING_CONFIRMATION"];

export const isLive = (status: string) => LIVE_STATUSES.includes(status);
export const isException = (status: string) => EXCEPTION_STATUSES.includes(status);
export const isTerminal = (status: string) =>
  ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(status);

export function runStatus(status: string, register: LabelRegister = "operator") {
  const labels = register === "customer" ? CUSTOMER_RUN_STATUS_LABEL : RUN_STATUS_LABEL;
  return {
    label: labels[status] ?? humanize(status),
    tone: RUN_STATUS_TONE[status] ?? "neutral",
  };
}

/* ------------------------------------------------------------- step & provider ------------ */

export const STEP_TYPE_LABEL: Record<string, string> = {
  ai: "Decision",
  action: "Action",
  condition: "Branch",
  approval: "Approval",
  verify: "Verification",
  end: "Outcome",
};

/**
 * The same step types in the customer register (task 9.2, moved from `console/copy.ts`).
 *
 * An operator wants the step's kind; a customer wants to know what is being done to their work. Both
 * are keyed by the same six-member step union, so a step type added to the schema cannot end up named
 * on one surface and unnamed on the other.
 */
export const CUSTOMER_STAGE_LABEL: Record<string, string> = {
  ai: "Reading the request",
  condition: "Checking the details",
  approval: "Waiting for approval",
  action: "Making the change",
  verify: "Confirming it worked",
  end: "Done",
};

/**
 * Which real execution mechanism handled a step. Staff-only troubleshooting detail (moved from
 * `console/copy.ts`, where it was a second provider map that disagreed with `PROVIDER_LABEL` about
 * what `browser` is called).
 */
export const PROVIDER_BACKEND_LABEL: Record<string, string> = {
  browser: "Chrome extension agent",
  api: "AmazFlow API call",
  spreadsheet: "Spreadsheet connector",
  email: "Email connector",
  file: "File connector",
  mock: "Simulated (mock)",
};

/**
 * How a step actually gets executed, in AmazFlow terms. This is the "identify the agent or
 * execution method used by each step" answer -- derived from the step's provider and, for
 * browser steps, its browserMode.
 */
export const PROVIDER_LABEL: Record<string, string> = {
  browser: "AmazFlow Browser",
  api: "Connected API",
  spreadsheet: "Spreadsheet",
  email: "Email",
  file: "File store",
  mock: "Simulated",
};

export const BROWSER_MODE_LABEL: Record<string, string> = {
  auto: "AmazFlow Browser (automatic)",
  managed: "AmazFlow Browser (hosted)",
  connected: "Chrome Agent",
};

/** The AmazFlow name for the tool a step's action resolves to. */
export function toolLabel(provider?: string, browserMode?: string) {
  if (provider === "browser") return BROWSER_MODE_LABEL[browserMode ?? "auto"] ?? PROVIDER_LABEL.browser;
  return PROVIDER_LABEL[provider ?? ""] ?? humanize(provider ?? "Unknown");
}

/** The AI operations a Decision step can perform. */
export const AI_OPERATION_LABEL: Record<string, string> = {
  classify: "Classify",
  extract: "Extract",
  transform: "Transform",
  summarize: "Summarize",
  choose: "Choose",
};

/* --------------------------------------------------------------------- executor ----------- */

/**
 * `run.executionBackend` is "agentcore" | "legacy" on the wire. Operators see the AmazFlow
 * product name; the underlying runtime identity is engineering detail.
 */
/** The two agent surfaces, named as the product names them. */
export const SURFACE_LABEL: Record<string, string> = {
  browser_extension: "Chrome Extension",
  desktop_agent: "Desktop App",
};

export const AGENT_TYPE_LABEL: Record<string, string> = {
  CHROME_EXTENSION: "Chrome Extension",
  DESKTOP_AGENT: "Desktop App",
};

/** Readiness of a surface, and the action that clears it. Mirrors the preflight contract. */
export const SURFACE_STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  missing_permissions: "Needs permission",
  outdated: "Needs updating",
  offline: "Not connected",
  not_installed: "Not installed",
};

export const SURFACE_STATUS_TONE: Record<string, Tone> = {
  connected: "good",
  missing_permissions: "waiting",
  outdated: "waiting",
  offline: "bad",
  not_installed: "bad",
};

export const SURFACE_ACTION_LABEL: Record<string, string> = {
  grant_permission: "Grant permission",
  update: "Update it",
  connect: "Connect it",
  open_app: "Open the app",
  install: "Install it",
};

export const CONNECTION_STATE_LABEL: Record<string, string> = {
  connected: "Connected",
  offline: "Offline",
  revoked: "Revoked",
};

export const EXECUTOR_LABEL: Record<string, string> = {
  agentcore: "AmazFlow Executor",
  legacy: "Legacy executor",
};

export const executorLabel = (backend?: string) =>
  EXECUTOR_LABEL[backend ?? ""] ?? "AmazFlow Executor";

/* ---------------------------------------------------------------- audit events ------------ */

export type AuditCategory =
  | "lifecycle"
  | "decision"
  | "tool"
  | "browser"
  | "approval"
  | "verification"
  | "failure"
  | "config";

export const AUDIT_CATEGORY_LABEL: Record<AuditCategory, string> = {
  lifecycle: "Run lifecycle",
  decision: "Decision",
  tool: "Tool call",
  browser: "Browser",
  approval: "Approval",
  verification: "Verification",
  failure: "Failure",
  config: "Configuration",
};

type AuditMeta = { label: string; category: AuditCategory; tone: Tone };

/**
 * Every audit `type` the engine and control plane emit, mapped to operator language.
 * Sources: packages/engine/src/index.ts and services/control-plane/src/handler.ts.
 */
export const AUDIT_EVENT: Record<string, AuditMeta> = {
  RUN_STARTED: { label: "Run started", category: "lifecycle", tone: "neutral" },
  STEP_STARTED: { label: "Step started", category: "lifecycle", tone: "neutral" },

  AI_COMPLETED: { label: "Decision made", category: "decision", tone: "ai" },
  CONDITION_EVALUATED: { label: "Branch evaluated", category: "decision", tone: "neutral" },

  APPROVAL_REQUIRED: { label: "Approval requested", category: "approval", tone: "waiting" },
  APPROVED: { label: "Approved", category: "approval", tone: "good" },
  REJECTED: { label: "Sent back", category: "approval", tone: "bad" },
  CONFIRMATION_REQUIRED: { label: "Confirmation requested", category: "approval", tone: "waiting" },
  CONFIRMATION_GRANTED: { label: "Confirmed", category: "approval", tone: "good" },

  AGENT_TASK_CREATED: { label: "Work offered to an agent", category: "browser", tone: "waiting" },
  // Landed with the claim/lease model: an agent now takes the work under a single-winner lease
  // before acting, so "claimed" is a distinct, visible stage.
  AGENT_TASK_CLAIMED: { label: "Agent picked up the work", category: "browser", tone: "running" },
  EXECUTOR_PROGRESS: { label: "Agent reported progress", category: "browser", tone: "running" },
  AI_ALLOWLIST_REJECTED: { label: "Answer outside what the step allows", category: "decision", tone: "waiting" },
  AI_FAILED: { label: "Decision failed", category: "decision", tone: "bad" },
  AGENT_RESULT: { label: "Browser task returned", category: "browser", tone: "good" },
  AGENT_RESULT_FAILED: { label: "Browser task failed", category: "browser", tone: "bad" },
  MANAGED_EXECUTION_FALLBACK: {
    label: "Handed off to Chrome Agent",
    category: "browser",
    tone: "waiting",
  },

  ACTION_COMPLETED: { label: "Tool call succeeded", category: "tool", tone: "good" },
  ACTION_FAILED: { label: "Tool call failed", category: "tool", tone: "bad" },
  ACTION_RECONCILIATION_REQUIRED: {
    label: "Needs reconciliation",
    category: "failure",
    tone: "bad",
  },

  VERIFIED: { label: "Verified", category: "verification", tone: "good" },
  VERIFICATION_FAILED: { label: "Verification failed", category: "verification", tone: "bad" },

  RUN_CANCEL_REQUESTED: { label: "Cancel requested", category: "lifecycle", tone: "muted" },
  RUN_CANCELLED: { label: "Run cancelled", category: "lifecycle", tone: "muted" },
  RUN_TIMED_OUT: { label: "Run timed out", category: "failure", tone: "bad" },
  COMPLETED: { label: "Run completed", category: "lifecycle", tone: "good" },
  FAILED: { label: "Run failed", category: "failure", tone: "bad" },
};

export function auditEvent(type: string): AuditMeta {
  return AUDIT_EVENT[type] ?? { label: humanize(type), category: "lifecycle", tone: "neutral" };
}

/* ------------------------------------------------- configuration activity actions --------- */

/**
 * `GET /activity` action codes. These are configuration/admin changes rather than run
 * telemetry, and they are what the audit explorer filters on server-side.
 */
export const ACTIVITY_ACTION: Record<string, { label: string; tone: Tone }> = {
  WORKFLOW_SAVE: { label: "Workflow saved", tone: "neutral" },
  WORKFLOW_GENERATED: { label: "Workflow drafted from SOP", tone: "ai" },
  WORKFLOW_DRAFT: { label: "Workflow draft proposed", tone: "ai" },
  WORKFLOW_DUPLICATE: { label: "Workflow duplicated", tone: "neutral" },
  WORKFLOW_STEP_UPDATE: { label: "Workflow step changed", tone: "neutral" },
  WORKFLOW_STEP_ADD: { label: "Workflow step added", tone: "neutral" },
  WORKFLOW_ROLES: { label: "Workflow access changed", tone: "waiting" },
  WORKFLOW_STATUS: { label: "Workflow status changed", tone: "waiting" },
  ORG_CREATED: { label: "Organization created", tone: "good" },
  ORG_BRANDING: { label: "Organization branding changed", tone: "neutral" },
  AGENT_CREATED: { label: "Chrome Agent authorized", tone: "good" },
  AGENT_REVOKED: { label: "Chrome Agent revoked", tone: "bad" },
  TEAM_MEMBER_STATUS: { label: "User access changed", tone: "waiting" },
  SETTINGS_CHANGED: { label: "Platform settings changed", tone: "waiting" },
  SUPPORT_TICKET_CREATED: { label: "Support ticket opened", tone: "neutral" },
  SUPPORT_TICKET_STATUS: { label: "Support ticket updated", tone: "neutral" },
  BROWSER_CONNECTION_AUTHENTICATED: { label: "Connection signed in", tone: "good" },
  BROWSER_CONNECTION_REVOKED: { label: "Connection revoked", tone: "bad" },
};

export function activityAction(action: string) {
  return ACTIVITY_ACTION[action] ?? { label: humanize(action), tone: "neutral" as Tone };
}

/* ------------------------------------------------------------------ other enums ----------- */

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "AmazFlow Super Admin",
  CLIENT_ADMIN: "Client Operations Admin",
  FRONTLINE: "Frontline User",
};

export const ROLE_SHORT: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  CLIENT_ADMIN: "Ops Admin",
  FRONTLINE: "Frontline",
};

/**
 * The coarse group in the register a customer reads (moved from `console/copy.ts`).
 *
 * `SUPER_ADMIN` is deliberately absent rather than mapped: AmazFlow staff are not a role a customer's
 * team member has, and a customer-facing surface that names one is describing something the customer
 * cannot act on. A lookup miss reads as "Team member", which is the safe direction.
 */
export const CUSTOMER_ROLE_LABEL: Record<string, string> = {
  CLIENT_ADMIN: "Team admin",
  FRONTLINE: "Team member",
};

/** The seven fine-grained platform roles, named for a person rather than for the policy. */
export const PLATFORM_ROLE_LABEL: Record<string, string> = {
  ORG_OWNER: "Owner",
  ORG_ADMIN: "Administrator",
  WORKFLOW_BUILDER: "Workflow builder",
  OPERATOR: "Operator",
  APPROVER: "Approver",
  VIEWER: "Viewer",
  STAFF_ADMIN: "AmazFlow staff",
};

/** What each fine role is FOR, so a person choosing one is not guessing from its name. */
export const PLATFORM_ROLE_DESCRIPTION: Record<string, string> = {
  ORG_OWNER: "Everything an administrator can do, plus transferring ownership of the organization.",
  ORG_ADMIN: "Runs the organization: people, workflows, connections, agents and settings.",
  WORKFLOW_BUILDER: "Builds and edits workflows, and starts runs. Publishing is done by AmazFlow.",
  OPERATOR: "Starts assigned workflows and works on their own runs and tasks.",
  APPROVER: "Decides approvals and reads the organization's runs. Cannot start or edit work.",
  VIEWER: "Reads everything in the organization, including the audit trail. Changes nothing.",
  STAFF_ADMIN: "AmazFlow staff. Not assignable to a member of your organization.",
};

/** Customer-visible organization execution state. Commercial lifecycle state is internal-only. */
export const ORGANIZATION_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  suspended: "Suspended",
};

export const ORGANIZATION_STATUS_TONE: Record<string, Tone> = {
  active: "good",
  paused: "waiting",
  suspended: "bad",
};

/** Membership state derived from the identity provider plus the stored membership record. */
export const USER_STATE_LABEL: Record<string, string> = {
  invited: "Invited",
  active: "Active",
  deactivated: "Deactivated",
};

export const USER_STATE_TONE: Record<string, Tone> = {
  invited: "waiting",
  active: "good",
  deactivated: "muted",
};

/**
 * The eight in-app notification kinds the control plane persists (requirement 22.3).
 *
 * Exactly the eight keys `NOTIFICATION_KINDS` in the handler accepts, in the same spelling. An earlier
 * draft also carried upper-case aliases for each one "in case" the wire format differed — that is a
 * fabricated contract, and it would have silently hidden a real mismatch by labelling a key the API
 * never sends. A kind absent from this table falls back to its stored key, which is visible and
 * fixable, rather than to a guess.
 */
export const NOTIFICATION_KINDS = [
  "approval_required",
  "run_failed",
  "run_timed_out",
  "agent_offline",
  "connection_error",
  "exception_raised",
  "invitation_accepted",
  "onboarding_step_ready",
] as const;

export const NOTIFICATION_KIND_LABEL: Record<string, string> = {
  approval_required: "Approval required",
  run_failed: "Run failed",
  run_timed_out: "Run timed out",
  agent_offline: "Agent offline",
  connection_error: "Connection error",
  exception_raised: "Exception raised",
  invitation_accepted: "Invitation accepted",
  onboarding_step_ready: "Onboarding step ready",
};

export const WORKFLOW_STATUS_LABEL: Record<string, string> = {
  active: "Published",
  draft: "Draft",
  paused: "Paused",
};

export const WORKFLOW_STATUS_TONE: Record<string, Tone> = {
  active: "good",
  draft: "muted",
  paused: "waiting",
};

export const CONNECTION_STATUS_LABEL: Record<string, string> = {
  active: "Signed in",
  pending: "Needs sign-in",
  revoked: "Revoked",
  error: "Error",
};

export const CONNECTION_STATUS_TONE: Record<string, Tone> = {
  active: "good",
  pending: "waiting",
  revoked: "muted",
  error: "bad",
};

export const TICKET_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const TICKET_STATUS_TONE: Record<string, Tone> = {
  open: "waiting",
  in_progress: "running",
  resolved: "good",
  closed: "muted",
};

export const PRIORITY_TONE: Record<string, Tone> = {
  urgent: "bad",
  high: "bad",
  normal: "neutral",
  low: "muted",
};

export const DATA_CLASS_LABEL: Record<string, string> = {
  PUBLIC: "Public",
  INTERNAL: "Internal",
  CONFIDENTIAL: "Confidential",
  PII: "Personal data",
  PHI: "Health data",
  FINANCIAL: "Financial",
  RESTRICTED: "Restricted",
};

/** Data classes the production boundary does not yet permit (see README/ARCHITECTURE). */
export const RESTRICTED_DATA_CLASSES = ["PHI", "FINANCIAL", "RESTRICTED"];

export const TASK_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

/* ------------------------------------------------------------------- formatting ----------- */

export function humanize(value: string) {
  if (!value) return "";
  return value
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

/** Compact relative time: "just now", "4m ago", "3h ago", "6d ago", then a date. */
export function relativeTime(iso?: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const delta = Date.now() - then;
  if (delta < 0) return "in " + shortDuration(-delta);
  if (delta < 45_000) return "just now";
  if (delta < 86_400_000 * 7) return shortDuration(delta) + " ago";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "1.4s", "22s", "4m", "3h 12m", "6d" -- for durations, not timestamps. */
export function shortDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const remMin = Math.round(m % 60);
  if (h < 24) return remMin ? `${h}h ${remMin}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/** Absolute wall-clock time, to the second -- what an investigator needs. */
export function absoluteTime(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Time only, for dense timeline gutters. */
export function clockTime(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function durationBetween(from?: string, to?: string): string {
  if (!from || !to) return "—";
  return shortDuration(new Date(to).getTime() - new Date(from).getTime());
}

export function percent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? singular + "s")}`;
}

export function money(value: number): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Shorten a long opaque identifier for display while keeping it recognizable. */
export function shortId(id?: string, keep = 8): string {
  if (!id) return "—";
  const body = id.includes("_") ? id.slice(id.indexOf("_") + 1) : id;
  return body.length <= keep ? body : body.slice(0, keep);
}

export const DATA_BOUNDARY_LABEL: Record<string, string> = {
  "synthetic-only": "Synthetic data only",
  "production-nonregulated": "Live operational data (non-regulated)",
};

export function dataBoundaryLabel(value?: string) {
  if (!value) return "Unknown";
  return DATA_BOUNDARY_LABEL[value] ?? humanize(value);
}


/**
 * Human names for the collections the console loads. The load-error banner is the one place
 * an internal key would otherwise reach the screen, and "Couldn't load agentTasks" is not
 * language an operator should ever be shown.
 */
export const COLLECTION_LABEL: Record<string, string> = {
  workflows: "workflows",
  runs: "workflow runs",
  organizations: "organizations",
  agents: "agents",
  agentTasks: "the agent work queue",
  connections: "connections",
  tickets: "support tickets",
  activity: "audit events",
  leads: "leads",
  settings: "platform settings",
  health: "the platform health check",
};

export function collectionLabel(key: string): string {
  return COLLECTION_LABEL[key] ?? humanize(key).toLowerCase();
}


/* ---------------------------------------------------------------- organizations ------------ */

/** Must match ORG_STATUSES in the control plane; anything else is refused server-side. */
export const ORG_STATUSES = ["active", "paused", "suspended"] as const;
export const ORG_PLANS = ["design_partner", "pilot", "standard", "enterprise"] as const;

export const ORG_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  suspended: "Suspended",
};

export const ORG_STATUS_TONE: Record<string, Tone> = {
  active: "good",
  paused: "waiting",
  suspended: "bad",
};

/** What each status actually does, so an operator is never guessing before they change one. */
export const ORG_STATUS_EFFECT: Record<string, string> = {
  active: "Work runs normally.",
  paused: "No new runs can start. Runs already in flight are left alone.",
  suspended: "No new runs can start, and the customer is told to contact AmazFlow.",
};

export const ORG_PLAN_LABEL: Record<string, string> = {
  design_partner: "Design partner",
  pilot: "Pilot",
  standard: "Standard",
  enterprise: "Enterprise",
};

export function orgStatusLabel(status?: string): string {
  if (!status) return "Unknown";
  return ORG_STATUS_LABEL[status] ?? humanize(status);
}

export function orgPlanLabel(plan?: string): string {
  if (!plan) return "—";
  return ORG_PLAN_LABEL[plan] ?? humanize(plan);
}

/** "No limit" is the honest reading of 0, and the one an operator needs to see. */
export function concurrencyLabel(limit: number): string {
  return limit > 0 ? `${limit} at a time` : "No limit";
}

/**
 * Time zones from the runtime's own database, matching how the control plane validates them.
 * Falls back to a short list on a runtime without Intl.supportedValuesOf so the field is never
 * empty and unusable.
 */
export function timezoneOptions(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (supported && supported.length) return supported;
  } catch {
    // Fall through to the short list.
  }
  return [
    "UTC",
    "America/Los_Angeles",
    "America/Denver",
    "America/Chicago",
    "America/New_York",
    "Europe/London",
    "Europe/Amsterdam",
    "Europe/Berlin",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
  ];
}
