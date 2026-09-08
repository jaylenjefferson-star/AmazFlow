import type { AmazFlowRole, RunStatus, WorkflowDefinition, WorkflowRun, WorkflowStep } from "@amazflow/workflow-schema";

export type StatusTone = "progress" | "approval" | "done" | "attention";

export function statusInfo(status: RunStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case "RUNNING":
    case "WAITING_AGENT":
      return { label: "In progress", tone: "progress" };
    case "WAITING_APPROVAL":
      return { label: "Waiting on your approval", tone: "approval" };
    case "COMPLETED":
      return { label: "Completed and verified", tone: "done" };
    case "FAILED":
      return { label: "Needs a look", tone: "attention" };
    default:
      return { label: "In progress", tone: "progress" };
  }
}

const STAGE_LABELS: Record<WorkflowStep["type"], string> = {
  ai: "Reading the request",
  condition: "Checking the details",
  approval: "Waiting for approval",
  action: "Making the change",
  verify: "Confirming it worked",
  end: "Done",
};

export function stageLabel(stepType: string): string {
  return STAGE_LABELS[stepType as WorkflowStep["type"]] ?? "Working on it";
}

export function roleLabel(role: AmazFlowRole): string {
  return role === "CLIENT_ADMIN" ? "Team admin" : "Team member";
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
