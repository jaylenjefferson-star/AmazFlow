"use client";

import { useMemo, useState } from "react";
import {
  ACTIONS_BY_TARGET, BROWSER_ACTIONS, DESKTOP_ACTIONS, requiredTargets, targetForAction, targetForProvider,
  type AmazFlowRole, type ExecutionTarget, type WorkflowDefinition, type WorkflowStep,
} from "@amazflow/workflow-schema";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   Vocabulary. Every label a person reads is written in terms of the work, not the mechanism.
   Raw enum values stay as the stored value; they are never the thing on screen.
   ───────────────────────────────────────────────────────────────────────────────────────── */

const STEP_TYPES = ["ai", "action", "condition", "approval", "verify", "end"] as const;
type StepType = (typeof STEP_TYPES)[number];

const STEP_TYPE_LABEL: Record<StepType, string> = {
  ai: "Read or decide",
  action: "Do something",
  condition: "Branch on a value",
  approval: "Ask a person",
  verify: "Check the result",
  end: "Finish",
};

const STEP_TYPE_HINT: Record<StepType, string> = {
  ai: "AmazFlow reads the information available and produces one value.",
  action: "AmazFlow changes something in a real system.",
  condition: "Send the run down one of two paths depending on a value.",
  approval: "Pause until someone decides. Nothing changes while it waits.",
  verify: "Re-check a value and stop the run if it isn't what was expected.",
  end: "Where this path finishes.",
};

const AI_OPERATIONS = ["classify", "extract", "transform", "summarize", "choose"] as const;
const AI_OPERATION_LABEL: Record<(typeof AI_OPERATIONS)[number], string> = {
  classify: "Classify — pick one of a fixed set of answers",
  extract: "Extract — pull specific fields out of the input",
  transform: "Transform — rewrite the input into another shape",
  summarize: "Summarize — condense the input",
  choose: "Choose — select one option from those offered",
};

const PROVIDERS = ["browser", "desktop", "api", "spreadsheet", "email", "file", "mock"] as const;
const PROVIDER_LABEL: Record<(typeof PROVIDERS)[number], string> = {
  browser: "A website, through the Chrome Extension",
  desktop: "A Mac app, through the Desktop App",
  api: "An API AmazFlow calls itself",
  spreadsheet: "A spreadsheet",
  email: "Email",
  file: "A file store",
  mock: "Simulated — does nothing real",
};

const TARGET_LABEL: Record<ExecutionTarget, string> = {
  browser_extension: "Chrome Extension",
  desktop_agent: "Desktop App",
};
const PROVIDER_FOR_TARGET: Record<ExecutionTarget, "browser" | "desktop"> = {
  browser_extension: "browser",
  desktop_agent: "desktop",
};

const COMPARATORS = ["equals", "notEquals", "exists", "gt", "lt"] as const;
const COMPARATOR_LABEL: Record<(typeof COMPARATORS)[number], string> = {
  equals: "is exactly",
  notEquals: "is not",
  exists: "has any value",
  gt: "is greater than",
  lt: "is less than",
};

const ROLES: AmazFlowRole[] = ["FRONTLINE", "CLIENT_ADMIN", "SUPER_ADMIN"];
const ROLE_LABEL: Record<AmazFlowRole, string> = {
  FRONTLINE: "Frontline user",
  CLIENT_ADMIN: "Client operations admin",
  SUPER_ADMIN: "AmazFlow super admin",
};

const ACTION_LABEL: Record<string, string> = {
  NAVIGATE: "Open a page", READ_TEXT: "Read text from the page", CLICK: "Click something",
  TYPE: "Type into a field", SELECT: "Choose from a dropdown", CHECK: "Tick a checkbox",
  SCROLL_TO: "Scroll to something", WAIT_FOR: "Wait for something to appear",
  VERIFY_TEXT: "Confirm the page says something", CAPTURE_EVIDENCE: "Capture visual evidence",
  SET_EMPLOYEE_STATUS: "Set an employee's status",
  "desktop.open_app": "Open an app", "desktop.focus_window": "Bring a window to the front",
  "desktop.click": "Click something", "desktop.type_text": "Type text",
  "desktop.keypress": "Press a key", "desktop.wait_for": "Wait for something to appear",
  "desktop.verify_text": "Confirm the app shows something",
  "desktop.capture_evidence": "Capture visual evidence",
};

const actionLabel = (operation: string) => ACTION_LABEL[operation] ?? operation;

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   Action inputs, as fields rather than a JSON blob.

   These key names are exactly what the two agents read at run time -- browser keys from
   apps/browser-agent/src/content.ts and service-worker.ts, desktop keys from
   apps/desktop-agent/src/executor.ts. Getting them from a code file was previously the only way
   to know what to put in the Input (JSON) textarea.
   ───────────────────────────────────────────────────────────────────────────────────────── */

type FieldKind = "text" | "url" | "selector" | "number" | "longtext";
type FieldSpec = {
  key: string;
  label: string;
  kind?: FieldKind;
  placeholder?: string;
  hint?: string;
  required?: boolean;
};

const SELECTOR_HINT = "A CSS selector for the element on the page.";

const ACTION_FIELDS: Record<string, FieldSpec[]> = {
  NAVIGATE: [{ key: "url", label: "Page address", kind: "url", required: true, placeholder: "https://portal.example.com/people" }],
  READ_TEXT: [{ key: "selector", label: "Element to read", kind: "selector", required: true, hint: SELECTOR_HINT, placeholder: '[data-field="total"]' }],
  CLICK: [{ key: "selector", label: "Element to click", kind: "selector", required: true, hint: SELECTOR_HINT, placeholder: "button.save" }],
  TYPE: [
    { key: "selector", label: "Field to type into", kind: "selector", required: true, hint: SELECTOR_HINT, placeholder: "#employee-id" },
    { key: "value", label: "Text to type", required: true, hint: "Use {{a.path}} to insert a value the run already has.", placeholder: "{{values.employee.id}}" },
  ],
  SELECT: [
    { key: "selector", label: "Dropdown", kind: "selector", required: true, hint: SELECTOR_HINT },
    { key: "value", label: "Option to choose", required: true },
  ],
  CHECK: [
    { key: "selector", label: "Checkbox", kind: "selector", required: true, hint: SELECTOR_HINT },
    { key: "checked", label: "Tick or untick", hint: "Leave blank to tick it. Enter false to untick." },
  ],
  SCROLL_TO: [{ key: "selector", label: "Element to scroll to", kind: "selector", required: true, hint: SELECTOR_HINT }],
  WAIT_FOR: [
    { key: "selector", label: "Element to wait for", kind: "selector", required: true, hint: SELECTOR_HINT },
    { key: "timeoutMs", label: "Give up after", kind: "number", hint: "Milliseconds. Defaults to the agent's own limit.", placeholder: "5000" },
  ],
  VERIFY_TEXT: [
    { key: "selector", label: "Element to check", kind: "selector", required: true, hint: SELECTOR_HINT },
    { key: "expected", label: "Text it should contain", required: true },
  ],
  CAPTURE_EVIDENCE: [
    { key: "selector", label: "Element to capture", kind: "selector", hint: "Leave blank to capture the whole page." },
  ],
  SET_EMPLOYEE_STATUS: [
    { key: "status", label: "Status to set", required: true, placeholder: "disabled" },
    { key: "selector", label: "Status field", kind: "selector", hint: 'Defaults to [data-amazflow="employee-status"].' },
    { key: "identifierSelector", label: "Identifier field to confirm first", kind: "selector", hint: "Strongly recommended: AmazFlow checks this matches before writing, so it cannot act on the wrong record." },
    { key: "expectedIdentifier", label: "Identifier it must show", hint: "Use {{a.path}} to compare against a value the run already has.", placeholder: "{{values.decision.employeeId}}" },
  ],

  "desktop.open_app": [{ key: "app", label: "App name", required: true, placeholder: "TextEdit" }],
  "desktop.focus_window": [
    { key: "app", label: "App name", required: true },
    { key: "window", label: "Window title", hint: "Leave blank for the app's front window." },
  ],
  "desktop.click": [
    { key: "app", label: "App name", required: true },
    { key: "element", label: "Element name", required: true, hint: "The accessibility label, as VoiceOver would read it.", placeholder: "Save" },
    { key: "role", label: "Element kind", hint: "Optional, e.g. button or checkbox." },
  ],
  "desktop.type_text": [
    { key: "app", label: "App name", required: true },
    { key: "text", label: "Text to type", required: true, hint: "Use {{a.path}} to insert a value the run already has." },
  ],
  "desktop.keypress": [
    { key: "app", label: "App name", required: true },
    { key: "key", label: "Key", required: true, placeholder: "return" },
    { key: "modifiers", label: "Held with", hint: "Comma separated: command, shift, option, control." },
  ],
  "desktop.wait_for": [
    { key: "app", label: "App name", required: true },
    { key: "element", label: "Element to wait for", hint: "The accessibility label." },
    { key: "timeoutMs", label: "Give up after", kind: "number", hint: "Milliseconds.", placeholder: "5000" },
  ],
  "desktop.verify_text": [
    { key: "app", label: "App name", required: true },
    { key: "expected", label: "Text it should show", required: true },
    { key: "element", label: "Element to check", hint: "Leave blank to check the window." },
  ],
  "desktop.capture_evidence": [
    { key: "app", label: "App name", required: true },
    { key: "window", label: "Window title", hint: "Leave blank for the front window." },
  ],
};

/** Required input keys, derived from the field specs so the two cannot drift. */
const requiredInputKeys = (operation: string): string[] =>
  (ACTION_FIELDS[operation] ?? []).filter((field) => field.required).map((field) => field.key);

/* ─────────────────────────────────────────────────────────────────────────────── helpers ── */

function newStepId() {
  return `step-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A step's surface, whether or not it was stored explicitly. */
function stepTarget(step: WorkflowStep): ExecutionTarget | undefined {
  if (step.type !== "action") return undefined;
  return step.executionTarget ?? targetForProvider(step.provider);
}

/**
 * Step icons as inline SVG rather than decorative Unicode. The glyphs previously used (✦ ↗ ◇ ◎)
 * fall outside many font stacks' coverage and render as an empty box, which is a poor first
 * impression of a builder whose whole job is to look legible.
 */
const STEP_GLYPH_PATHS: Record<StepType, React.ReactNode> = {
  ai: <path d="M8 2.2l1.5 4.3 4.3 1.5-4.3 1.5L8 13.8l-1.5-4.3L2.2 8l4.3-1.5L8 2.2z" />,
  action: (
    <>
      <circle cx="8" cy="8" r="5.9" />
      <path d="M6.7 5.5l3.5 2.5-3.5 2.5V5.5z" />
    </>
  ),
  condition: (
    <>
      <circle cx="4.4" cy="4" r="1.6" />
      <circle cx="11.6" cy="12" r="1.6" />
      <circle cx="4.4" cy="12" r="1.6" />
      <path d="M4.4 5.6v4.8M6 4.5h3.5a2 2 0 012 2v3.9" />
    </>
  ),
  approval: (
    <>
      <circle cx="8" cy="8" r="5.9" />
      <path d="M5.6 8.2l1.7 1.7 3.2-3.6" />
    </>
  ),
  verify: (
    <>
      <path d="M8 2l5 1.9v4c0 3-2.1 5.3-5 6.2-2.9-.9-5-3.2-5-6.2v-4L8 2z" />
      <path d="M5.9 7.9l1.6 1.6 2.7-3" />
    </>
  ),
  end: (
    <>
      <path d="M3.7 2.4v11.2" />
      <path d="M3.7 3.1h8.1l-1.4 2.7 1.4 2.7H3.7" />
    </>
  ),
};

const CONTROL_PATHS = {
  up: <path d="M8 12.6V3.4M4.6 6.8L8 3.4l3.4 3.4" />,
  down: <path d="M8 3.4v9.2M4.6 9.2L8 12.6l3.4-3.4" />,
  add: <path d="M8 3.4v9.2M3.4 8h9.2" />,
  remove: <path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" />,
} as const;

function ControlGlyph({ name, size = 12 }: { name: keyof typeof CONTROL_PATHS; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" style={{ display: "block" }}
    >
      {CONTROL_PATHS[name]}
    </svg>
  );
}

function StepGlyph({ type, size = 14 }: { type: string; size?: number }) {
  const paths = STEP_GLYPH_PATHS[type as StepType];
  if (!paths) return null;
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" style={{ display: "block", flexShrink: 0 }}
    >
      {paths}
    </svg>
  );
}

/**
 * `allowedProviders` is a hard schema constraint that the builder never exposed, so a workflow
 * using a provider missing from the list failed to save with an error about providers the person
 * had no field for. Deriving it from the steps means it can never disagree with what the
 * workflow does, and the failure disappears rather than being explained.
 */
function deriveAllowedProviders(steps: WorkflowStep[]): WorkflowDefinition["allowedProviders"] {
  const used = new Set<string>();
  for (const step of steps) if (step.type === "action") used.add(step.provider);
  // The schema requires at least one entry even for a workflow with no action steps yet.
  return (used.size > 0 ? [...used] : ["mock"]) as WorkflowDefinition["allowedProviders"];
}

/** Every step id a step can hand control to. */
function outgoingRefs(step: WorkflowStep): { key: string; value: string | undefined }[] {
  const refs: { key: string; value: string | undefined }[] = [{ key: "next", value: step.next }];
  if (step.type === "condition") {
    refs.push({ key: "whenTrue", value: step.whenTrue }, { key: "whenFalse", value: step.whenFalse });
  }
  if (step.type === "approval") refs.push({ key: "onReject", value: step.onReject });
  if (step.type === "verify" || step.type === "action") refs.push({ key: "onFailure", value: step.onFailure });
  return refs;
}

/** Steps reachable from startAt, following every branch. */
function reachableIds(workflow: WorkflowDefinition): Set<string> {
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  const seen = new Set<string>();
  const queue = [workflow.startAt];
  while (queue.length) {
    const id = queue.shift() as string;
    if (!id || seen.has(id)) continue;
    const step = byId.get(id);
    if (!step) continue;
    seen.add(id);
    for (const ref of outgoingRefs(step)) if (ref.value) queue.push(ref.value);
  }
  return seen;
}

/**
 * Execution order for the flow map: a breadth-first walk from startAt, so what is shown is the
 * real path rather than the order the cards happen to sit in. The previous linear strip implied
 * array order was execution order, which it never was.
 */
function flowOrder(workflow: WorkflowDefinition): { step: WorkflowStep; depth: number; via?: string }[] {
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  const out: { step: WorkflowStep; depth: number; via?: string }[] = [];
  const seen = new Set<string>();
  const queue: { id: string; depth: number; via?: string }[] = [{ id: workflow.startAt, depth: 0 }];
  while (queue.length) {
    const entry = queue.shift() as { id: string; depth: number; via?: string };
    if (seen.has(entry.id)) continue;
    const step = byId.get(entry.id);
    if (!step) continue;
    seen.add(entry.id);
    out.push({ step, depth: entry.depth, via: entry.via });
    for (const ref of outgoingRefs(step)) {
      if (!ref.value || seen.has(ref.value)) continue;
      const label = ref.key === "whenTrue" ? "if true" : ref.key === "whenFalse" ? "if false"
        : ref.key === "onReject" ? "if sent back" : ref.key === "onFailure" ? "if it fails" : undefined;
      queue.push({ id: ref.value, depth: entry.depth + 1, via: label });
    }
  }
  return out;
}

/**
 * Value paths a step could plausibly read, offered as suggestions. Previously the person had to
 * know that an AI step's output lands under its own outputKey, that an action's result is under
 * lastAction.result, and that a desktop step may only verify result.*.
 */
function availablePaths(workflow: WorkflowDefinition, upToStepId: string): string[] {
  const paths = new Set<string>(["lastAction.result.ok", "lastAction.result.status"]);
  for (const step of workflow.steps) {
    if (step.id === upToStepId) break;
    if (step.type === "ai") {
      paths.add(step.outputKey);
      paths.add(`${step.outputKey}.value`);
    }
  }
  return [...paths].filter(Boolean);
}

/* ───────────────────────────────────────────────────────────────────────────── validation ── */

export type WorkflowProblem = {
  level: "error" | "warning";
  stepId?: string;
  message: string;
};

/** Surface and action-input contracts. Kept exported: it predates this rewrite. */
export function validateWorkflowTargets(workflow: WorkflowDefinition): string[] {
  return workflowProblems(workflow)
    .filter((problem) => problem.level === "error")
    .map((problem) => problem.message);
}

/**
 * Everything that would make this workflow either fail to save or misbehave at run time,
 * reported before the person clicks Save. Previously most of these were only discoverable by
 * failing a save and reading one flat error string, and several were not caught at all until a
 * run stalled.
 */
export function workflowProblems(workflow: WorkflowDefinition): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const ids = new Set(workflow.steps.map((step) => step.id));

  if (!workflow.name.trim()) problems.push({ level: "error", message: "The workflow needs a name." });
  if (!ids.has(workflow.startAt)) {
    problems.push({ level: "error", message: "The first step is missing. Pick which step starts this workflow." });
  }

  for (const step of workflow.steps) {
    const where = `"${step.name || "Untitled step"}"`;
    if (!step.name.trim()) problems.push({ level: "error", stepId: step.id, message: "Every step needs a name." });

    // Dangling and self-referencing links.
    for (const ref of outgoingRefs(step)) {
      if (!ref.value) continue;
      if (!ids.has(ref.value)) {
        problems.push({ level: "error", stepId: step.id, message: `${where} points at a step that no longer exists.` });
      } else if (ref.value === step.id) {
        problems.push({ level: "error", stepId: step.id, message: `${where} points at itself, which would loop forever.` });
      }
    }

    if (step.type === "ai") {
      if (!step.prompt.trim()) problems.push({ level: "error", stepId: step.id, message: `${where} needs a prompt describing what to read or decide.` });
      if (!step.outputKey.trim()) problems.push({ level: "error", stepId: step.id, message: `${where} needs a name for the value it produces.` });
      if (step.operation === "classify" && !(step.allowedValues ?? []).length) {
        problems.push({ level: "warning", stepId: step.id, message: `${where} classifies without a list of allowed answers, so anything it returns is accepted.` });
      }
    }

    if (step.type === "action") {
      const target = stepTarget(step);
      if (!step.operation.trim()) {
        problems.push({ level: "error", stepId: step.id, message: `${where} needs an action.` });
      } else if (target && !ACTIONS_BY_TARGET[target].includes(step.operation)) {
        problems.push({ level: "error", stepId: step.id, message: `${where} runs on the ${TARGET_LABEL[target]}, which cannot perform that action.` });
      }
      for (const key of requiredInputKeys(step.operation)) {
        const value = (step.input as Record<string, unknown>)?.[key];
        if (value === undefined || value === null || value === "") {
          const field = (ACTION_FIELDS[step.operation] ?? []).find((candidate) => candidate.key === key);
          problems.push({ level: "error", stepId: step.id, message: `${where} needs "${field?.label ?? key}" filled in.` });
        }
      }
      if (step.verify && target === "desktop_agent" && !String(step.verify.path).startsWith("result.")) {
        problems.push({ level: "error", stepId: step.id, message: `${where} can only check a value the action itself returned, so its check must start with "result.".` });
      }
      if (step.provider === "browser" && step.browserMode === "managed" && !step.connectionId && workflow.status === "active") {
        problems.push({ level: "error", stepId: step.id, message: `${where} uses a hosted browser, which needs a signed-in connection before this workflow can be published.` });
      }
      if (step.provider === "mock") {
        problems.push({ level: "warning", stepId: step.id, message: `${where} is simulated — it reports success without changing anything.` });
      }
    }

    if (step.type === "condition" && !step.path.trim()) {
      problems.push({ level: "error", stepId: step.id, message: `${where} needs a value to branch on.` });
    }
    if (step.type === "verify" && !step.path.trim()) {
      problems.push({ level: "error", stepId: step.id, message: `${where} needs a value to check.` });
    }
    if (step.type === "approval") {
      if (!step.message.trim()) problems.push({ level: "error", stepId: step.id, message: `${where} needs a question for the approver.` });
      if (!step.roles.length) problems.push({ level: "error", stepId: step.id, message: `${where} has nobody who can decide it.` });
    }
  }

  // Reachability. An orphan step saves cleanly and then simply never runs.
  const reachable = reachableIds(workflow);
  for (const step of workflow.steps) {
    if (!reachable.has(step.id)) {
      problems.push({ level: "warning", stepId: step.id, message: `"${step.name || step.id}" can't be reached from the first step, so it will never run.` });
    }
  }
  const reachesEnd = workflow.steps.some((step) => step.type === "end" && reachable.has(step.id));
  if (workflow.steps.length > 0 && !reachesEnd) {
    problems.push({ level: "warning", message: "No finishing step can be reached, so a run has no defined end." });
  }
  for (const step of workflow.steps) {
    if (step.type === "end" || !reachable.has(step.id)) continue;
    const hasOnward = outgoingRefs(step).some((ref) => ref.value);
    if (!hasOnward) {
      problems.push({ level: "warning", stepId: step.id, message: `"${step.name || step.id}" has nothing after it, so a run stops there without finishing.` });
    }
  }
  return problems;
}

/** Whether the workflow can be saved at all. Used to gate the Save button. */
export function workflowBlockingProblems(workflow: WorkflowDefinition): WorkflowProblem[] {
  return workflowProblems(workflow).filter((problem) => problem.level === "error");
}

/* ────────────────────────────────────────────────────────────────────────── sub-components ── */

/**
 * A link to another step, shown by name. This used to render raw ids, so "Next step" read
 * `step-lz8f3a2bq7` and the only way to know which step that was, was to scroll and compare.
 */
function StepLink({
  label, value, steps, currentId, onChange, allowNone, disabled, hint,
}: {
  label: string;
  value?: string;
  steps: WorkflowStep[];
  currentId: string;
  onChange: (value: string | undefined) => void;
  allowNone?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="wf-field">
      <small>{label}</small>
      <select value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value || undefined)}>
        {allowNone && <option value="">— nothing, stop here —</option>}
        {steps.map((step) => (
          <option key={step.id} value={step.id} disabled={step.id === currentId}>
            {step.name || "Untitled step"}
            {step.id === currentId ? " (this step)" : ""}
          </option>
        ))}
      </select>
      {hint && <em className="wf-hint">{hint}</em>}
    </label>
  );
}

/** A path field with suggestions, instead of bare dot-notation typed from memory. */
function PathField({
  label, value, onChange, disabled, suggestions, hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  suggestions: string[];
  hint?: string;
}) {
  const listId = useMemo(() => `paths-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <label className="wf-field">
      <small>{label}</small>
      <input
        value={value}
        disabled={disabled}
        list={listId}
        placeholder="decision.value"
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {suggestions.map((path) => <option key={path} value={path} />)}
      </datalist>
      {hint && <em className="wf-hint">{hint}</em>}
    </label>
  );
}

/** The structured replacement for the action-step Input (JSON) textarea. */
function ActionInputFields({
  step, disabled, onChange,
}: {
  step: Extract<WorkflowStep, { type: "action" }>;
  disabled?: boolean;
  onChange: (input: Record<string, unknown>) => void;
}) {
  const [showJson, setShowJson] = useState(false);
  const [jsonDraft, setJsonDraft] = useState<string | null>(null);
  const fields = ACTION_FIELDS[step.operation];
  const input = (step.input ?? {}) as Record<string, unknown>;

  const setField = (key: string, raw: string, kind?: FieldKind) => {
    const next = { ...input };
    if (raw === "") delete next[key];
    else if (kind === "number") {
      const parsed = Number(raw);
      next[key] = Number.isFinite(parsed) ? parsed : raw;
    } else next[key] = raw;
    onChange(next);
  };

  // Keys already in the input that this action has no field for -- e.g. after switching action,
  // or from a workflow authored through the JSON panel. Shown rather than silently hidden.
  const extraKeys = Object.keys(input).filter((key) => !(fields ?? []).some((field) => field.key === key));

  if (!fields) {
    // Providers AmazFlow runs itself have no fixed action vocabulary, so raw JSON is still the
    // honest editor for them.
    return (
      <label className="wf-field wf-full">
        <small>Details for this action (JSON)</small>
        <textarea
          value={jsonDraft ?? JSON.stringify(input, null, 2)}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => {
            setJsonDraft(event.target.value);
            try { onChange(JSON.parse(event.target.value || "{}")); } catch { /* wait for valid JSON */ }
          }}
        />
        {jsonDraft !== null && (() => {
          try { JSON.parse(jsonDraft || "{}"); return null; }
          catch (error) { return <p className="wf-json-error">{error instanceof Error ? error.message : "Invalid JSON"} — not saved yet</p>; }
        })()}
      </label>
    );
  }

  return (
    <>
      {fields.map((field) => (
        <label className={`wf-field ${field.kind === "longtext" ? "wf-full" : ""}`} key={field.key}>
          <small>
            {field.label}
            {field.required && <span className="wf-required" title="Required"> *</span>}
          </small>
          <input
            value={String(input[field.key] ?? "")}
            disabled={disabled}
            type={field.kind === "number" ? "number" : "text"}
            inputMode={field.kind === "number" ? "numeric" : undefined}
            placeholder={field.placeholder}
            spellCheck={field.kind === "selector" || field.kind === "url" ? false : undefined}
            className={field.kind === "selector" || field.kind === "url" ? "wf-mono" : undefined}
            onChange={(event) => setField(field.key, event.target.value, field.kind)}
          />
          {field.hint && <em className="wf-hint">{field.hint}</em>}
        </label>
      ))}

      {extraKeys.length > 0 && (
        <div className="wf-field wf-full">
          <small>Also set on this action</small>
          <div className="wf-extra-keys">
            {extraKeys.map((key) => (
              <span key={key} className="wf-extra-key">
                <code>{key}</code>
                <span>{JSON.stringify(input[key])}</span>
                {!disabled && (
                  <button
                    type="button"
                    title={`Remove ${key}`}
                    onClick={() => { const next = { ...input }; delete next[key]; onChange(next); }}
                  >
                    <ControlGlyph name="remove" size={9} />
                  </button>
                )}
              </span>
            ))}
          </div>
          <em className="wf-hint">
            This action doesn&apos;t use these, so they&apos;re ignored at run time.
          </em>
        </div>
      )}

      <div className="wf-field wf-full">
        <button type="button" className="wf-json-toggle" onClick={() => { setJsonDraft(JSON.stringify(input, null, 2)); setShowJson((value) => !value); }}>
          {showJson ? "Hide the raw details" : "Advanced: edit these details as JSON"}
        </button>
        {showJson && (
          <>
            <textarea
              value={jsonDraft ?? JSON.stringify(input, null, 2)}
              disabled={disabled}
              spellCheck={false}
              onChange={(event) => {
                setJsonDraft(event.target.value);
                try { onChange(JSON.parse(event.target.value || "{}")); } catch { /* wait for valid JSON */ }
              }}
            />
            {jsonDraft !== null && (() => {
              try { JSON.parse(jsonDraft || "{}"); return null; }
              catch (error) { return <p className="wf-json-error">{error instanceof Error ? error.message : "Invalid JSON"} — not saved yet</p>; }
            })()}
          </>
        )}
      </div>
    </>
  );
}

/** Allowed answers for an AI step, with the REVIEW behaviour made discoverable. */
function AllowedValuesEditor({
  values, disabled, onChange,
}: {
  values: string[];
  disabled?: boolean;
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const hasReview = values.includes("REVIEW");

  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) { setDraft(""); return; }
    onChange([...values, value]);
    setDraft("");
  };

  return (
    <div className="wf-field wf-full">
      <small>Answers AmazFlow is allowed to give</small>
      <div className="wf-chips">
        {values.map((value) => (
          <span className={`wf-chip ${value === "REVIEW" ? "wf-chip-review" : ""}`} key={value}>
            {value}
            {!disabled && (
              <button type="button" title={`Remove ${value}`} onClick={() => onChange(values.filter((candidate) => candidate !== value))}><ControlGlyph name="remove" size={9} /></button>
            )}
          </span>
        ))}
        {!disabled && (
          <span className="wf-chip-add">
            <input
              value={draft}
              placeholder="Add an answer"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }}
              onBlur={add}
            />
          </span>
        )}
      </div>
      {values.length === 0 ? (
        <em className="wf-hint">With no list, any answer is accepted.</em>
      ) : hasReview ? (
        <em className="wf-hint wf-hint-good">
          Because <code>REVIEW</code> is in the list, an answer outside it sends the run to a person instead of failing it.
        </em>
      ) : (
        <em className="wf-hint">
          An answer outside this list stops the run. Add <button type="button" className="wf-linkish" disabled={disabled} onClick={() => onChange([...values, "REVIEW"])}>REVIEW</button> to send it to a person instead.
        </em>
      )}
    </div>
  );
}

function RoleChecks({
  selected, disabled, onChange, label,
}: {
  selected: string[];
  disabled?: boolean;
  onChange: (roles: AmazFlowRole[]) => void;
  label: string;
}) {
  return (
    <div className="wf-field wf-full">
      <small>{label}</small>
      <div className="wf-checks">
        {ROLES.map((role) => (
          <label className="wf-inline" key={role}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={selected.includes(role)}
              onChange={(event) => onChange(
                event.target.checked
                  ? ([...selected, role] as AmazFlowRole[])
                  : (selected.filter((candidate) => candidate !== role) as AmazFlowRole[]),
              )}
            />
            {ROLE_LABEL[role]}
          </label>
        ))}
      </div>
    </div>
  );
}

/** The real execution path, including branches. */
function FlowMap({ workflow, onFocus }: { workflow: WorkflowDefinition; onFocus: (stepId: string) => void }) {
  const order = useMemo(() => flowOrder(workflow), [workflow]);
  const orphans = useMemo(() => {
    const reachable = reachableIds(workflow);
    return workflow.steps.filter((step) => !reachable.has(step.id));
  }, [workflow]);

  return (
    <div className="wf-flowmap">
      <p className="wf-eyebrow">THE PATH A RUN TAKES</p>
      <ol className="wf-flowlist">
        {order.map(({ step, depth, via }) => (
          <li key={step.id} style={{ marginLeft: Math.min(depth, 6) * 14 }}>
            <button type="button" className="wf-flowstep" onClick={() => onFocus(step.id)}>
              {via && <em className="wf-flowvia">{via}</em>}
              <span className="wf-flowicon"><StepGlyph type={step.type} size={13} /></span>
              <span className="wf-flowname">{step.name || "Untitled step"}</span>
              <span className="wf-flowtype">{STEP_TYPE_LABEL[step.type as StepType]}</span>
            </button>
          </li>
        ))}
      </ol>
      {orphans.length > 0 && (
        <div className="wf-flow-orphans">
          <small>Never reached, so never runs:</small>
          {orphans.map((step) => (
            <button type="button" key={step.id} className="wf-linkish" onClick={() => onFocus(step.id)}>
              {step.name || step.id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────── builder ── */

function defaultStep(type: StepType, id: string, fallbackTarget?: string): WorkflowStep {
  const name = type === "end" ? "Finished" : "New step";
  switch (type) {
    case "ai": return { id, name, type, operation: "extract", prompt: "", outputKey: "result", confidenceThreshold: 0.85 };
    case "action": return { id, name, type, provider: "browser", executionTarget: "browser_extension", operation: "CLICK", input: {} };
    // Both branches point somewhere real rather than at the step itself. The old default was a
    // guaranteed infinite loop that saved cleanly.
    case "condition": return { id, name, type, path: "", operator: "equals", whenTrue: fallbackTarget ?? id, whenFalse: fallbackTarget ?? id };
    case "approval": return { id, name, type, message: "", roles: ["CLIENT_ADMIN"] };
    case "verify": return { id, name, type, path: "", operator: "equals" };
    case "end": return { id, name, type, outcome: "success" };
    default: throw new Error(`Unhandled step type: ${type}`);
  }
}

export function WorkflowBuilder({
  workflow, canEdit, onChange,
}: {
  workflow: WorkflowDefinition;
  canEdit: boolean;
  onChange: (next: WorkflowDefinition) => void;
}) {
  const [showJson, setShowJson] = useState(false);
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(workflow, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [focusedStepId, setFocusedStepId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const problems = useMemo(() => workflowProblems(workflow), [workflow]);
  const errors = problems.filter((problem) => problem.level === "error");
  const warnings = problems.filter((problem) => problem.level === "warning");
  const problemsByStep = useMemo(() => {
    const map = new Map<string, WorkflowProblem[]>();
    for (const problem of problems) {
      if (!problem.stepId) continue;
      map.set(problem.stepId, [...(map.get(problem.stepId) ?? []), problem]);
    }
    return map;
  }, [problems]);

  /** Every change funnels through here so allowedProviders is always in step with the steps. */
  const commit = (next: WorkflowDefinition) => {
    onChange({ ...next, allowedProviders: deriveAllowedProviders(next.steps) });
  };

  const commitSteps = (steps: WorkflowStep[], extra?: Partial<WorkflowDefinition>) => {
    commit({ ...workflow, ...extra, steps });
  };

  const updateStep = (index: number, patch: Record<string, unknown>) => {
    const steps = workflow.steps.slice();
    steps[index] = { ...steps[index], ...patch } as WorkflowStep;
    commitSteps(steps);
  };

  const changeStepType = (index: number, type: StepType) => {
    const steps = workflow.steps.slice();
    const current = steps[index];
    const endStep = workflow.steps.find((step) => step.type === "end" && step.id !== current.id);
    steps[index] = {
      ...defaultStep(type, current.id, endStep?.id),
      name: current.name,
      next: (current as { next?: string }).next,
    } as WorkflowStep;
    commitSteps(steps);
  };

  /**
   * Insert a step and wire it into the chain. The old Add step appended an unlinked step, so
   * every new step was an orphan that saved cleanly and never ran.
   */
  const addStepAfter = (index: number | null) => {
    const id = newStepId();
    const endStep = workflow.steps.find((step) => step.type === "end");
    const fresh = defaultStep("action", id, endStep?.id) as WorkflowStep;
    const steps = workflow.steps.slice();

    if (index === null || steps.length === 0) {
      steps.push(fresh);
      commitSteps(steps, { startAt: workflow.startAt || id });
      setFocusedStepId(id);
      return;
    }

    const previous = steps[index];
    (fresh as { next?: string }).next = (previous as { next?: string }).next;
    steps[index] = { ...previous, next: id } as WorkflowStep;
    steps.splice(index + 1, 0, fresh);
    commitSteps(steps, { startAt: workflow.startAt || id });
    setFocusedStepId(id);
  };

  /**
   * Remove a step and repair what pointed at it, rather than leaving dangling references that
   * only surface as a rejected save.
   */
  const removeStep = (index: number) => {
    const removed = workflow.steps[index];
    const successor = (removed as { next?: string }).next;
    const steps = workflow.steps
      .filter((_, position) => position !== index)
      .map((step) => {
        const patch: Record<string, unknown> = {};
        for (const ref of outgoingRefs(step)) {
          if (ref.value === removed.id) patch[ref.key] = successor && successor !== removed.id ? successor : undefined;
        }
        return Object.keys(patch).length ? ({ ...step, ...patch } as WorkflowStep) : step;
      });
    if (steps.length === 0) return;
    const startAt = workflow.startAt === removed.id ? (successor && successor !== removed.id ? successor : steps[0].id) : workflow.startAt;
    commitSteps(steps, { startAt });
    setPendingDelete(null);
  };

  const moveStep = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= workflow.steps.length) return;
    const steps = workflow.steps.slice();
    [steps[index], steps[target]] = [steps[target], steps[index]];
    commitSteps(steps);
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft) as WorkflowDefinition;
      commit(parsed);
      setJsonError(null);
      setShowJson(false);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Invalid JSON");
    }
  };

  const incomingCount = (stepId: string) =>
    workflow.steps.filter((step) => step.id !== stepId && outgoingRefs(step).some((ref) => ref.value === stepId)).length;

  const targets = requiredTargets(workflow);

  return (
    <div className="wf-builder">
      {/* ── What this workflow is ─────────────────────────────────────────────────────── */}
      <div className="wf-meta">
        <label className="wf-field wf-grow">
          <small>Workflow name</small>
          <input value={workflow.name} disabled={!canEdit} onChange={(event) => commit({ ...workflow, name: event.target.value })} />
        </label>
        <label className="wf-field">
          <small>Status</small>
          <select value={workflow.status} disabled={!canEdit} onChange={(event) => commit({ ...workflow, status: event.target.value as WorkflowDefinition["status"] })}>
            <option value="draft">Draft — not runnable</option>
            <option value="testing">Testing — only builders can run it</option>
          </select>
        </label>
        <StepLink
          label="Starts with"
          value={workflow.startAt}
          steps={workflow.steps}
          currentId=""
          disabled={!canEdit}
          onChange={(value) => value && commit({ ...workflow, startAt: value })}
        />
      </div>

      <label className="wf-field wf-full">
        <small>What it does, for your team</small>
        <input value={workflow.description ?? ""} disabled={!canEdit} onChange={(event) => commit({ ...workflow, description: event.target.value })} />
      </label>
      <label className="wf-field wf-full">
        <small>What it does, for the customer</small>
        <input
          value={workflow.customerSummary ?? ""}
          disabled={!canEdit}
          placeholder="Plain-English sentence shown on the customer's workflow card"
          onChange={(event) => commit({ ...workflow, customerSummary: event.target.value || undefined })}
        />
      </label>

      <RoleChecks
        label="Who can run this"
        selected={workflow.assignedRoles}
        disabled={!canEdit}
        onChange={(roles) => commit({ ...workflow, assignedRoles: roles })}
      />

      <div className="wf-field wf-full">
        <small>Starts when</small>
        <div className="wf-trigger">
          {/* A workflow always starts on request -- from the app or from either agent. A schedule
              is an additional entry point, not a different kind of workflow. */}
          <label className="wf-inline">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={Boolean(workflow.trigger?.enabled)}
              onChange={(event) => commit({
                ...workflow,
                trigger: event.target.checked
                  ? { type: "schedule", everyMinutes: workflow.trigger?.everyMinutes ?? 60, enabled: true }
                  : workflow.trigger ? { ...workflow.trigger, enabled: false } : undefined,
              })}
            />
            Also start it on a schedule
          </label>
          {workflow.trigger?.enabled && (
            <label className="wf-inline">
              every
              <input
                type="number" min={5} max={10080} step={5} disabled={!canEdit}
                value={workflow.trigger.everyMinutes}
                onChange={(event) => commit({ ...workflow, trigger: { ...workflow.trigger!, everyMinutes: Math.max(5, Number(event.target.value) || 5) } })}
              />
              minutes
            </label>
          )}
        </div>
        <small className="wf-trigger-note">
          Anyone assigned can start this from AmazFlow, the browser extension, or the desktop app. A schedule only fires when the agents it needs are actually connected.
        </small>
      </div>

      <label className="wf-field">
        <small>Minutes this takes by hand</small>
        <input
          type="number" min={0} step={1} value={workflow.manualMinutesEstimate ?? ""} disabled={!canEdit}
          onChange={(event) => commit({ ...workflow, manualMinutesEstimate: event.target.value ? Number(event.target.value) : undefined })}
        />
      </label>

      {/* ── What it needs, and what's wrong with it ───────────────────────────────────── */}
      <div className="wf-requirements">
        <p className="wf-eyebrow">REQUIRED TO RUN</p>
        {targets.length === 0 ? (
          <small>Every step runs inside AmazFlow. Nothing needs to be installed.</small>
        ) : (
          <div className="wf-req-list">
            {targets.map((target) => (
              <span key={target} className={`wf-target-badge ${target === "desktop_agent" ? "wf-target-desktop" : "wf-target-browser"}`}>
                {TARGET_LABEL[target]}
              </span>
            ))}
            <small>
              {targets.length === 2
                ? "This workflow uses both surfaces, so a person running it needs the Chrome extension and the macOS app connected."
                : targets[0] === "desktop_agent"
                  ? "Only the macOS app is needed — the Chrome extension is not involved."
                  : "Only the Chrome extension is needed — the macOS app is not involved."}
            </small>
          </div>
        )}

        {errors.length > 0 && (
          <div className="wf-problems wf-problems-error">
            <b>{errors.length === 1 ? "One thing to fix before this can be saved" : `${errors.length} things to fix before this can be saved`}</b>
            <ul>
              {errors.map((problem, index) => (
                <li key={index}>
                  {problem.stepId ? (
                    <button type="button" className="wf-linkish" onClick={() => setFocusedStepId(problem.stepId!)}>{problem.message}</button>
                  ) : problem.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="wf-problems wf-problems-warn">
            <b>{warnings.length === 1 ? "One thing worth checking" : `${warnings.length} things worth checking`}</b>
            <ul>
              {warnings.map((problem, index) => (
                <li key={index}>
                  {problem.stepId ? (
                    <button type="button" className="wf-linkish" onClick={() => setFocusedStepId(problem.stepId!)}>{problem.message}</button>
                  ) : problem.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {errors.length === 0 && warnings.length === 0 && workflow.steps.length > 0 && (
          <p className="wf-problems wf-problems-ok">Nothing to fix. Every step is reachable and finishes.</p>
        )}
      </div>

      {/* ── The real path, not the card order ─────────────────────────────────────────── */}
      {workflow.steps.length > 0 && <FlowMap workflow={workflow} onFocus={setFocusedStepId} />}

      {/* ── The steps ─────────────────────────────────────────────────────────────────── */}
      <div className="wf-steps">
        {workflow.steps.map((step, index) => {
          const target = stepTarget(step);
          const stepIssues = problemsByStep.get(step.id) ?? [];
          const hasError = stepIssues.some((problem) => problem.level === "error");
          const isFocused = focusedStepId === step.id;
          const paths = availablePaths(workflow, step.id);

          return (
            <div
              className={`wf-step ${hasError ? "wf-step-error" : ""} ${isFocused ? "wf-step-focused" : ""}`}
              key={step.id}
              ref={isFocused ? (node) => { node?.scrollIntoView({ block: "nearest", behavior: "smooth" }); } : undefined}
            >
              <div className="wf-step-head">
                <span className="wf-step-icon"><StepGlyph type={step.type} /></span>
                <input
                  className="wf-step-name"
                  value={step.name}
                  disabled={!canEdit}
                  placeholder="Name this step"
                  onChange={(event) => updateStep(index, { name: event.target.value })}
                />
                {workflow.startAt === step.id && <span className="wf-start-badge">First step</span>}
                <select
                  value={step.type}
                  disabled={!canEdit}
                  title={STEP_TYPE_HINT[step.type as StepType]}
                  onChange={(event) => changeStepType(index, event.target.value as StepType)}
                >
                  {STEP_TYPES.map((type) => <option key={type} value={type}>{STEP_TYPE_LABEL[type]}</option>)}
                </select>
                <div className="wf-step-ops">
                  <button type="button" disabled={!canEdit || index === 0} onClick={() => moveStep(index, -1)} title="Move this card up (does not change the path)"><ControlGlyph name="up" /></button>
                  <button type="button" disabled={!canEdit || index === workflow.steps.length - 1} onClick={() => moveStep(index, 1)} title="Move this card down (does not change the path)"><ControlGlyph name="down" /></button>
                  <button type="button" disabled={!canEdit} onClick={() => addStepAfter(index)} title="Add a step after this one"><ControlGlyph name="add" /></button>
                  <button type="button" disabled={!canEdit || workflow.steps.length <= 1} onClick={() => setPendingDelete(step.id)} title="Delete this step"><ControlGlyph name="remove" /></button>
                </div>
              </div>

              <small className="wf-step-sub">
                {STEP_TYPE_HINT[step.type as StepType]}
                {step.type === "action" && target && (
                  <span className={`wf-target-badge ${target === "desktop_agent" ? "wf-target-desktop" : "wf-target-browser"}`}>
                    {TARGET_LABEL[target]}
                  </span>
                )}
              </small>

              {pendingDelete === step.id && (
                <div className="wf-confirm">
                  <b>Delete &ldquo;{step.name || "this step"}&rdquo;?</b>
                  <p>
                    {incomingCount(step.id) > 0
                      ? `${incomingCount(step.id)} ${incomingCount(step.id) === 1 ? "step points" : "steps point"} at it. They'll be repointed to whatever came next.`
                      : "Nothing points at it."}
                  </p>
                  <div className="wf-confirm-actions">
                    <button type="button" onClick={() => setPendingDelete(null)}>Keep it</button>
                    <button type="button" className="wf-confirm-danger" onClick={() => removeStep(index)}>Delete step</button>
                  </div>
                </div>
              )}

              {stepIssues.length > 0 && (
                <ul className="wf-step-issues">
                  {stepIssues.map((problem, issueIndex) => (
                    <li key={issueIndex} className={problem.level === "error" ? "wf-issue-error" : "wf-issue-warn"}>{problem.message}</li>
                  ))}
                </ul>
              )}

              {/* ── Read or decide ─────────────────────────────────────────────────── */}
              {step.type === "ai" && (
                <div className="wf-step-body">
                  <label className="wf-field wf-grow">
                    <small>What kind of answer</small>
                    <select value={step.operation} disabled={!canEdit} onChange={(event) => updateStep(index, { operation: event.target.value })}>
                      {AI_OPERATIONS.map((operation) => <option key={operation} value={operation}>{AI_OPERATION_LABEL[operation]}</option>)}
                    </select>
                  </label>
                  <label className="wf-field">
                    <small>Remember the answer as</small>
                    <input value={step.outputKey} disabled={!canEdit} className="wf-mono" onChange={(event) => updateStep(index, { outputKey: event.target.value })} />
                    <em className="wf-hint">Later steps read it by this name.</em>
                  </label>
                  <label className="wf-field">
                    <small>Act only if this sure</small>
                    <input
                      type="number" min={0} max={1} step={0.05}
                      value={step.confidenceThreshold ?? 0.85}
                      disabled={!canEdit}
                      onChange={(event) => updateStep(index, { confidenceThreshold: Number(event.target.value) })}
                    />
                    <em className="wf-hint">{Math.round((step.confidenceThreshold ?? 0.85) * 100)}% or more, otherwise the run stops.</em>
                  </label>
                  <label className="wf-field wf-full">
                    <small>What to ask</small>
                    <textarea
                      value={step.prompt}
                      disabled={!canEdit}
                      placeholder="Read the vendor, amount, and due date from this invoice."
                      onChange={(event) => updateStep(index, { prompt: event.target.value })}
                    />
                  </label>
                  <AllowedValuesEditor
                    values={step.allowedValues ?? []}
                    disabled={!canEdit}
                    onChange={(values) => updateStep(index, { allowedValues: values.length ? values : undefined })}
                  />
                  <StepLink label="Then go to" value={step.next} steps={workflow.steps} currentId={step.id} allowNone disabled={!canEdit} onChange={(value) => updateStep(index, { next: value })} />
                </div>
              )}

              {/* ── Do something ──────────────────────────────────────────────────── */}
              {step.type === "action" && (
                <div className="wf-step-body">
                  <label className="wf-field wf-grow">
                    <small>Where it happens</small>
                    <select
                      value={step.provider}
                      disabled={!canEdit}
                      onChange={(event) => {
                        const provider = event.target.value as (typeof PROVIDERS)[number];
                        const nextTarget = targetForProvider(provider);
                        // Changing where it happens settles the surface, and an action belonging
                        // to the old surface cannot survive the move.
                        updateStep(index, nextTarget
                          ? { provider, executionTarget: nextTarget, operation: ACTIONS_BY_TARGET[nextTarget].includes(step.operation) ? step.operation : ACTIONS_BY_TARGET[nextTarget][0], input: {} }
                          : { provider, executionTarget: undefined });
                      }}
                    >
                      {PROVIDERS.map((provider) => <option key={provider} value={provider}>{PROVIDER_LABEL[provider]}</option>)}
                    </select>
                  </label>

                  {target ? (
                    <label className="wf-field wf-grow">
                      <small>What it does</small>
                      <select
                        value={step.operation}
                        disabled={!canEdit}
                        onChange={(event) => {
                          const operation = event.target.value;
                          const actionTarget = targetForAction(operation);
                          // Picking an action settles its surface too, so the two can never disagree.
                          updateStep(index, actionTarget
                            ? { operation, executionTarget: actionTarget, provider: PROVIDER_FOR_TARGET[actionTarget], input: {} }
                            : { operation, input: {} });
                        }}
                      >
                        {(target === "desktop_agent" ? DESKTOP_ACTIONS : BROWSER_ACTIONS).map((operation) => (
                          <option key={operation} value={operation}>{actionLabel(operation)}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label className="wf-field wf-grow">
                      <small>What it does</small>
                      <input value={step.operation} disabled={!canEdit} className="wf-mono" onChange={(event) => updateStep(index, { operation: event.target.value })} />
                    </label>
                  )}

                  <ActionInputFields step={step} disabled={!canEdit} onChange={(input) => updateStep(index, { input })} />

                  <label className="wf-field wf-full wf-inline-check">
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={Boolean(step.requiresConfirmation)}
                      onChange={(event) => updateStep(index, { requiresConfirmation: event.target.checked || undefined })}
                    />
                    <span>Ask a person to confirm before this runs</span>
                  </label>

                  <PathField
                    label="Afterwards, check (optional)"
                    value={step.verify?.path ?? ""}
                    disabled={!canEdit}
                    suggestions={target === "desktop_agent" ? ["result.status", "result.text"] : ["result.status", "result.text", "lastAction.result.ok"]}
                    hint={target === "desktop_agent" ? "A Desktop App step can only check what the action itself returned, so start with result." : "AmazFlow re-checks this itself rather than trusting the agent."}
                    onChange={(path) => updateStep(index, { verify: path ? { path, equals: step.verify?.equals ?? "" } : undefined })}
                  />
                  <label className="wf-field">
                    <small>…and expect</small>
                    <input
                      value={String(step.verify?.equals ?? "")}
                      disabled={!canEdit || !step.verify}
                      onChange={(event) => step.verify && updateStep(index, { verify: { ...step.verify, equals: event.target.value } })}
                    />
                  </label>

                  <StepLink label="Then go to" value={step.next} steps={workflow.steps} currentId={step.id} allowNone disabled={!canEdit} onChange={(value) => updateStep(index, { next: value })} />
                  <StepLink label="If it fails, go to" value={step.onFailure} steps={workflow.steps} currentId={step.id} allowNone disabled={!canEdit} onChange={(value) => updateStep(index, { onFailure: value })} hint="Leave blank to stop the run." />
                </div>
              )}

              {/* ── Branch ────────────────────────────────────────────────────────── */}
              {step.type === "condition" && (
                <div className="wf-step-body">
                  <PathField
                    label="Look at"
                    value={step.path}
                    disabled={!canEdit}
                    suggestions={paths}
                    onChange={(path) => updateStep(index, { path })}
                    hint="A value an earlier step produced."
                  />
                  <label className="wf-field">
                    <small>And if it</small>
                    <select value={step.operator} disabled={!canEdit} onChange={(event) => updateStep(index, { operator: event.target.value })}>
                      {COMPARATORS.map((operator) => <option key={operator} value={operator}>{COMPARATOR_LABEL[operator]}</option>)}
                    </select>
                  </label>
                  {step.operator !== "exists" && (
                    <label className="wf-field">
                      <small>this value</small>
                      <input value={String(step.value ?? "")} disabled={!canEdit} onChange={(event) => updateStep(index, { value: event.target.value })} />
                    </label>
                  )}
                  <StepLink label="…then go to" value={step.whenTrue} steps={workflow.steps} currentId={step.id} disabled={!canEdit} onChange={(value) => value && updateStep(index, { whenTrue: value })} />
                  <StepLink label="otherwise go to" value={step.whenFalse} steps={workflow.steps} currentId={step.id} disabled={!canEdit} onChange={(value) => value && updateStep(index, { whenFalse: value })} />
                </div>
              )}

              {/* ── Ask a person ──────────────────────────────────────────────────── */}
              {step.type === "approval" && (
                <div className="wf-step-body">
                  <label className="wf-field wf-full">
                    <small>What to ask them</small>
                    <input
                      value={step.message}
                      disabled={!canEdit}
                      placeholder="This invoice is over $5,000. Approve before AmazFlow files it?"
                      onChange={(event) => updateStep(index, { message: event.target.value })}
                    />
                  </label>
                  <RoleChecks
                    label="Who can decide"
                    selected={step.roles}
                    disabled={!canEdit}
                    onChange={(roles) => updateStep(index, { roles })}
                  />
                  <StepLink label="If approved, go to" value={step.next} steps={workflow.steps} currentId={step.id} allowNone disabled={!canEdit} onChange={(value) => updateStep(index, { next: value })} />
                  <StepLink label="If sent back, go to" value={step.onReject} steps={workflow.steps} currentId={step.id} allowNone disabled={!canEdit} onChange={(value) => updateStep(index, { onReject: value })} hint="Leave blank to stop the run." />
                </div>
              )}

              {/* ── Check the result ──────────────────────────────────────────────── */}
              {step.type === "verify" && (
                <div className="wf-step-body">
                  <PathField label="Check" value={step.path} disabled={!canEdit} suggestions={paths} onChange={(path) => updateStep(index, { path })} />
                  <label className="wf-field">
                    <small>is</small>
                    <select value={step.operator} disabled={!canEdit} onChange={(event) => updateStep(index, { operator: event.target.value })}>
                      {COMPARATORS.map((operator) => <option key={operator} value={operator}>{COMPARATOR_LABEL[operator]}</option>)}
                    </select>
                  </label>
                  {step.operator !== "exists" && (
                    <label className="wf-field">
                      <small>this</small>
                      <input value={String(step.value ?? "")} disabled={!canEdit} onChange={(event) => updateStep(index, { value: event.target.value })} />
                    </label>
                  )}
                  <StepLink label="If it passes, go to" value={step.next} steps={workflow.steps} currentId={step.id} allowNone disabled={!canEdit} onChange={(value) => updateStep(index, { next: value })} />
                  <StepLink label="If it doesn't, go to" value={step.onFailure} steps={workflow.steps} currentId={step.id} allowNone disabled={!canEdit} onChange={(value) => updateStep(index, { onFailure: value })} hint="Leave blank to stop the run." />
                </div>
              )}

              {/* ── Finish ────────────────────────────────────────────────────────── */}
              {step.type === "end" && (
                <div className="wf-step-body">
                  <label className="wf-field">
                    <small>Record this run as</small>
                    <select value={step.outcome} disabled={!canEdit} onChange={(event) => updateStep(index, { outcome: event.target.value as "success" | "failed" })}>
                      <option value="success">Done</option>
                      <option value="failed">Needing attention</option>
                    </select>
                  </label>
                </div>
              )}
            </div>
          );
        })}

        {canEdit && (
          <button type="button" className="wf-add-step" onClick={() => addStepAfter(workflow.steps.length ? workflow.steps.length - 1 : null)}>
            <ControlGlyph name="add" /> Add a step
          </button>
        )}
      </div>

      <button
        type="button"
        className="wf-json-toggle"
        onClick={() => { setJsonDraft(JSON.stringify(workflow, null, 2)); setJsonError(null); setShowJson((value) => !value); }}
      >
        {showJson ? "Hide the whole workflow as JSON" : "Advanced: edit the whole workflow as JSON"}
      </button>
      {showJson && (
        <div className="wf-json-panel">
          <textarea value={jsonDraft} disabled={!canEdit} spellCheck={false} onChange={(event) => setJsonDraft(event.target.value)} />
          {jsonError && <p className="wf-json-error">{jsonError}</p>}
          {canEdit && <button type="button" onClick={applyJson}>Apply JSON to builder</button>}
        </div>
      )}
    </div>
  );
}
