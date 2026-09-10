import type { AmazFlowRole, RunStatus, WorkflowDefinition, WorkflowRun, WorkflowStep } from "@amazflow/workflow-schema";
import {
  CUSTOMER_ROLE_LABEL,
  CUSTOMER_STAGE_LABEL,
  PROVIDER_BACKEND_LABEL,
  runStatus,
  type Tone,
} from "@amazflow/domain-ui";

export type StatusTone = "progress" | "approval" | "done" | "attention";

/**
 * Task 9.2: this file's own run-status `switch`, step-stage map, role labels and provider-backend map
 * are DELETED. They were the second enumeration-to-label mapping in the repository, and the two had
 * already diverged on which statuses exist. The labels themselves are unchanged -- they moved into
 * `@amazflow/domain-ui` as the customer register of the one shared status enumeration, so this
 * surface reads exactly what it read before while there is now only one place a status can be named.
 *
 * `StatusTone` stays local because it is this surface's stylesheet vocabulary, mapped from the shared
 * tone rather than re-decided per status.
 */
const TONE_TO_STATUS_TONE: Record<Tone, StatusTone> = {
  running: "progress",
  waiting: "approval",
  good: "done",
  bad: "attention",
  muted: "attention",
  neutral: "progress",
  ai: "progress",
};

export function statusInfo(status: RunStatus): { label: string; tone: StatusTone } {
  const shared = runStatus(status, "customer");
  return { label: shared.label, tone: TONE_TO_STATUS_TONE[shared.tone] ?? "progress" };
}

export function stageLabel(stepType: string): string {
  return CUSTOMER_STAGE_LABEL[stepType as WorkflowStep["type"]] ?? "Working on it";
}

export function roleLabel(role: AmazFlowRole): string {
  return CUSTOMER_ROLE_LABEL[role] ?? "Team member";
}

/**
 * Staff-only troubleshooting label: which real execution mechanism handled a step. Now the shared
 * `EXECUTOR_LABEL`, so "Chrome extension agent" is named once rather than in two files that could
 * disagree about what `browser` means.
 */
export function providerBackendLabel(provider?: string): string {
  if (!provider) return "Unknown";
  return PROVIDER_BACKEND_LABEL[provider] ?? provider;
}

function humanizeSegment(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
}

function humanizeField(path: string | undefined): string | null {
  if (!path) return null;
  const segments = path.split(".").filter(Boolean);
  const leaf = segments.at(-1);
  if (!leaf) return null;
  const humanized = humanizeSegment(leaf);
  return humanized || null;
}

function humanizeValue(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const spaced = humanizeSegment(value);
  if (!spaced) return null;
  return spaced.replace(/^\w/, (character) => character.toUpperCase());
}

// The engine stores the POSTed run input at context.input (see runWorkflow in the deployed
// Lambda), with context.values/context.lastAction populated as the run advances. Check the
// places a human-facing subject would actually live, not the raw context envelope.
function findSubjectName(context: Record<string, unknown> | undefined): string | null {
  if (!context) return null;
  const candidates: unknown[] = [context.input, context.values, context];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    for (const value of Object.values(candidate as Record<string, unknown>)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const name = (value as Record<string, unknown>).name;
        if (typeof name === "string" && name.trim()) return name.trim();
      }
    }
  }
  return null;
}

function findVerifyStep(workflow: WorkflowDefinition): Extract<WorkflowStep, { type: "verify" }> | null {
  const step = workflow.steps.find((candidate) => candidate.type === "verify");
  return (step as Extract<WorkflowStep, { type: "verify" }> | undefined) ?? null;
}

// Three-tier fallback per the master build prompt's Section 3.5: never let this go fully
// generic if a more specific version is renderable, and never surface the raw path string.
export function verificationStatement(run: WorkflowRun, workflow: WorkflowDefinition): string {
  const verifyStep = findVerifyStep(workflow);
  const field = humanizeField(verifyStep?.path);
  const value = humanizeValue(verifyStep?.value);

  if (field && value) {
    const subject = findSubjectName(run.context);
    const opening = subject ? `${subject}’s ${field}` : `The ${field}`;
    return `${opening} is now ${value} — AmazFlow checked.`;
  }
  if (field) {
    return `AmazFlow checked the ${field} before marking this complete.`;
  }
  return "AmazFlow checked the result before marking this complete.";
}

export const HOW_WAS_THIS_CHECKED = "AmazFlow re-read the system after making the change and compared it to what was expected.";

// Only the two seeded demo workflows exist today, so map examples by id with a generic
// fallback -- avoids inventing per-workflow config that doesn't exist yet.
export function requestExample(workflow: { id: string }): string {
  if (workflow.id === "workflow-sample-ops") return "Disable access for Maria Lopez, who left the team on Friday.";
  if (workflow.id === "workflow-sample-data-entry") return "Add invoice 10482 for $3,450 from Acme Supply to this month's invoice tracker.";
  return "Describe what you'd like AmazFlow to do, in plain language.";
}

// Builds the "Here's what I'll do" interpretation card from real persisted run data --
// context.input.description (the customer's own text) and whatever the workflow's leading
// ai step extracted into context.values. Never fabricates fields that aren't actually there.
export function interpretationSummary(run: WorkflowRun, workflow: WorkflowDefinition): { headline: string; details: { label: string; value: string }[] } {
  const context = (run.context ?? {}) as Record<string, unknown>;
  const input = context.input as Record<string, unknown> | undefined;
  const requestText = typeof input?.description === "string" && input.description.trim() ? input.description.trim() : null;
  const values = (context.values ?? {}) as Record<string, unknown>;
  const decision = Object.values(values).find((value) => value && typeof value === "object" && "value" in (value as Record<string, unknown>)) as
    | { value?: unknown; confidence?: number }
    | undefined;
  const subject = findSubjectName(context);
  const action = typeof decision?.value === "string" ? humanizeValue(decision.value) : null;

  const headline = action
    ? `${action}${subject ? ` for ${subject}` : ""}, as part of ${workflow.name}.`
    : `Run ${workflow.name}${requestText ? ", based on your request below" : ""}.`;

  const details: { label: string; value: string }[] = [];
  if (requestText) details.push({ label: "Your request", value: requestText });
  if (subject) details.push({ label: "Who", value: subject });
  if (action) details.push({ label: "Action", value: action });
  if (typeof decision?.confidence === "number") details.push({ label: "Confidence", value: `${Math.round(decision.confidence * 100)}%` });
  return { headline, details };
}

// Distinguishes real verified-vs-unverified outcomes rather than always saying "verified" --
// only shows VERIFIED when a persisted verify-type stepResult actually passed.
export function completionVerdict(run: WorkflowRun): { headline: string; tone: "verified" | "unavailable" | "failed" } {
  const results = Object.values(run.stepResults ?? {});
  const verifyResults = results.filter((result) => result.type === "verify");
  if (verifyResults.length === 0) return { headline: "Completed, verification unavailable", tone: "unavailable" };
  const allPassed = verifyResults.every((result) => result.verificationResult?.passed);
  return allPassed ? { headline: "Completed and verified", tone: "verified" } : { headline: "Action completed, verification failed", tone: "failed" };
}

export function cancelSummary(run: WorkflowRun): string {
  const completed = Object.values(run.stepResults ?? {}).filter((result) => result.status === "SUCCEEDED").length;
  const cancelEvent = run.audit.find((event) => event.type === "RUN_CANCELLED");
  if (cancelEvent?.message) return cancelEvent.message;
  return completed > 0 ? `${completed} step${completed === 1 ? "" : "s"} completed before cancellation.` : "AmazFlow stopped before any step ran.";
}

export function workflowSummary(workflow: WorkflowDefinition & { customerSummary?: string }): string {
  if (workflow.customerSummary) return workflow.customerSummary;
  const cleaned = workflow.name.toLowerCase().replace(/\bconfigurable\b\s*/g, "").trim();
  return `Handles ${cleaned}, with a human check before anything happens.`;
}

function runDurationMs(run: WorkflowRun): number {
  return new Date(run.updatedAt).getTime() - new Date(run.createdAt).getTime();
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "a moment";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes === 1) return "1 minute";
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

export function completedDurationLine(run: WorkflowRun, workflow: WorkflowDefinition & { manualMinutesEstimate?: number }): string {
  const actual = formatDuration(runDurationMs(run));
  if (typeof workflow.manualMinutesEstimate === "number" && workflow.manualMinutesEstimate > 0) {
    return `Took ${actual} · usually takes your team about ${formatDuration(workflow.manualMinutesEstimate * 60000)}.`;
  }
  return `Took ${actual}.`;
}

export const BLENDED_HOURLY_RATE = 35;

export type StatRow = {
  activeWorkflows: number;
  runsThisMonth: number;
  runsLast30Days: number;
  hoursSaved: number | null;
  valueSaved: number | null;
};

export function computeStats(
  workflows: (WorkflowDefinition & { manualMinutesEstimate?: number })[],
  runs: WorkflowRun[]
): StatRow {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const runsThisMonth = runs.filter((run) => new Date(run.createdAt) >= monthStart).length;
  const runsLast30Days = runs.filter((run) => new Date(run.createdAt) >= thirtyDaysAgo).length;
  const activeWorkflows = workflows.filter((workflow) => workflow.status === "active").length;

  const workflowById = new Map(workflows.map((workflow) => [workflow.id, workflow]));
  const anyEstimateSet = workflows.some((workflow) => typeof workflow.manualMinutesEstimate === "number" && workflow.manualMinutesEstimate > 0);

  let hoursSaved: number | null = null;
  if (anyEstimateSet) {
    const totalMinutesSaved = runs
      .filter((run) => run.status === "COMPLETED")
      .reduce((sum, run) => {
        const workflow = workflowById.get(run.workflowId);
        const estimate = workflow?.manualMinutesEstimate;
        if (typeof estimate !== "number" || estimate <= 0) return sum;
        const actualMinutes = runDurationMs(run) / 60000;
        return sum + Math.max(0, estimate - actualMinutes);
      }, 0);
    hoursSaved = Math.round(totalMinutesSaved / 60);
  }

  const valueSaved = hoursSaved === null ? null : hoursSaved * BLENDED_HOURLY_RATE;

  return { activeWorkflows, runsThisMonth, runsLast30Days, hoursSaved, valueSaved };
}

export function visibleWorkflows<T extends { assignedRoles: AmazFlowRole[]; status: string }>(workflows: T[], role: AmazFlowRole): T[] {
  return workflows.filter((workflow) => workflow.status !== "draft" && workflow.assignedRoles.includes(role));
}
