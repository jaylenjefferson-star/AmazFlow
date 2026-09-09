"use client";

import { useState } from "react";
import {
  ACTIONS_BY_TARGET, BROWSER_ACTIONS, DESKTOP_ACTIONS, requiredTargets, targetForAction, targetForProvider,
  type ExecutionTarget, type WorkflowDefinition, type WorkflowStep,
} from "@amazflow/workflow-schema";

const STEP_TYPES = ["ai", "action", "condition", "approval", "verify", "end"] as const;
const AI_OPERATIONS = ["classify", "extract", "transform", "summarize", "choose"] as const;
const PROVIDERS = ["browser", "desktop", "api", "spreadsheet", "email", "file", "mock"] as const;

// The two agent surfaces, as the builder talks about them. Providers AmazFlow runs itself have no
// surface at all, which is why this is keyed by target rather than by provider.
const TARGET_LABEL: Record<ExecutionTarget, string> = {
  browser_extension: "Chrome Extension",
  desktop_agent: "Desktop App",
};
const PROVIDER_FOR_TARGET: Record<ExecutionTarget, "browser" | "desktop"> = {
  browser_extension: "browser",
  desktop_agent: "desktop",
};
const COMPARATORS = ["equals", "notEquals", "exists", "gt", "lt"] as const;

function newStepId() { return `step-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

// A step's surface, whether or not it was stored explicitly -- workflows authored before targets
// existed still resolve to the right one from their provider.
function stepTarget(step: WorkflowStep): ExecutionTarget | undefined {
  if (step.type !== "action") return undefined;
  return step.executionTarget ?? targetForProvider(step.provider);
}

// Exactly the contracts the two surfaces need, not a general validation framework: every agent
// step names a surface, its action belongs to that surface, and the fields that action cannot run
// without are present.
const REQUIRED_INPUT: Record<string, string[]> = {
  NAVIGATE: ["url"], CLICK: ["selector"], TYPE: ["selector", "value"], SELECT: ["selector", "value"],
  CHECK: ["selector"], READ_TEXT: ["selector"], SCROLL_TO: ["selector"], WAIT_FOR: ["selector"],
  VERIFY_TEXT: ["selector", "expected"],
  "desktop.open_app": ["app"], "desktop.focus_window": ["app"], "desktop.click": ["app", "element"],
  "desktop.type_text": ["app", "text"], "desktop.keypress": ["app", "key"], "desktop.wait_for": ["app"],
  "desktop.verify_text": ["app", "expected"], "desktop.capture_evidence": ["app"],
};

export function validateWorkflowTargets(workflow: WorkflowDefinition): string[] {
  const problems: string[] = [];
  for (const step of workflow.steps) {
    if (step.type !== "action") continue;
    const target = stepTarget(step);
    if (!target) continue;
    if (!ACTIONS_BY_TARGET[target].includes(step.operation)) {
      problems.push(`"${step.name}" runs on the ${TARGET_LABEL[target]}, which cannot perform ${step.operation || "an unnamed action"}.`);
      continue;
    }
    for (const field of REQUIRED_INPUT[step.operation] ?? []) {
      const value = (step.input as Record<string, unknown>)?.[field];
      if (value === undefined || value === null || value === "") {
        problems.push(`"${step.name}" needs ${field} in its Input (JSON) before it can run.`);
      }
    }
    if (step.verify && target === "desktop_agent" && !String(step.verify.path).startsWith("result.")) {
      problems.push(`"${step.name}" verifies ${step.verify.path}, but a Desktop App step can only verify a value the action itself returned (result.…).`);
    }
  }
  return problems;
}

function defaultStep(type: (typeof STEP_TYPES)[number], id: string): WorkflowStep {
  const name = "New step";
  switch (type) {
    case "ai": return { id, name, type, operation: "extract", prompt: "", outputKey: "result", confidenceThreshold: 0.85 };
    case "action": return { id, name, type, provider: "browser", executionTarget: "browser_extension", operation: "CLICK", input: {} };
    case "condition": return { id, name, type, path: "", operator: "equals", whenTrue: id, whenFalse: id };
    case "approval": return { id, name, type, message: "", roles: ["CLIENT_ADMIN"] };
    case "verify": return { id, name, type, path: "", operator: "equals" };
    case "end": return { id, name, type, outcome: "success" };
    default: throw new Error(`Unhandled step type: ${type}`);
  }
}

function stepIcon(type: string) { return ({ ai: "✦", action: "↗", condition: "◇", approval: "✓", verify: "◎", end: "●" } as Record<string, string>)[type] ?? "·"; }

function StepTarget({ label, value, stepIds, onChange, allowNone }: { label: string; value?: string; stepIds: string[]; onChange: (value: string | undefined) => void; allowNone?: boolean }) {
  return (
    <label className="wf-field">
      <small>{label}</small>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)}>
        {allowNone && <option value="">— none —</option>}
        {stepIds.map((id) => <option key={id} value={id}>{id}</option>)}
      </select>
    </label>
  );
}

export function WorkflowBuilder({ workflow, canEdit, onChange }: { workflow: WorkflowDefinition; canEdit: boolean; onChange: (next: WorkflowDefinition) => void }) {
  const [showJson, setShowJson] = useState(false);
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(workflow, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  // Per-step raw text for the action-step Input (JSON) field, keyed by step id. Necessary
  // because the field used to bind its value straight to JSON.parse(step.input) -- every
  // keystroke that didn't happen to leave valid JSON behind (i.e. almost every keystroke)
  // silently failed to parse, so the textarea's value snapped back to the last-valid state
  // and undid whatever the person just typed. Tracking the literal text here means the field
  // always shows what was typed; it only commits into step.input once that text parses.
  const [actionInputDrafts, setActionInputDrafts] = useState<Record<string, string>>({});
  const stepIds = workflow.steps.map((step) => step.id);

  const updateStep = (index: number, patch: Record<string, unknown>) => {
    const steps = workflow.steps.slice();
    steps[index] = { ...steps[index], ...patch } as WorkflowStep;
    onChange({ ...workflow, steps });
  };

  const changeStepType = (index: number, type: (typeof STEP_TYPES)[number]) => {
    const steps = workflow.steps.slice();
    const current = steps[index];
    steps[index] = { ...defaultStep(type, current.id), name: current.name, next: (current as { next?: string }).next } as WorkflowStep;
    onChange({ ...workflow, steps });
  };

  const addStep = () => {
    const id = newStepId();
    const steps = [...workflow.steps, defaultStep("action", id)];
    onChange({ ...workflow, steps, startAt: workflow.startAt || id });
  };

  const removeStep = (index: number) => {
    const removedId = workflow.steps[index].id;
    const steps = workflow.steps.filter((_, i) => i !== index);
    if (steps.length === 0) return;
    const startAt = workflow.startAt === removedId ? steps[0].id : workflow.startAt;
    onChange({ ...workflow, steps, startAt });
  };

  const moveStep = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= workflow.steps.length) return;
    const steps = workflow.steps.slice();
    [steps[index], steps[target]] = [steps[target], steps[index]];
    onChange({ ...workflow, steps });
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft) as WorkflowDefinition;
      onChange(parsed);
      setJsonError(null);
      setShowJson(false);
    } catch (error) { setJsonError(error instanceof Error ? error.message : "Invalid JSON"); }
  };

  return (
    <div className="wf-builder">
      <div className="wf-meta">
        <label className="wf-field wf-grow"><small>Workflow name</small><input value={workflow.name} disabled={!canEdit} onChange={(event) => onChange({ ...workflow, name: event.target.value })} /></label>
        <label className="wf-field"><small>Status</small><select value={workflow.status} disabled={!canEdit} onChange={(event) => onChange({ ...workflow, status: event.target.value as WorkflowDefinition["status"] })}><option value="draft">draft</option><option value="active">active</option><option value="paused">paused</option></select></label>
        <StepTarget label="Start step" value={workflow.startAt} stepIds={stepIds} onChange={(value) => value && onChange({ ...workflow, startAt: value })} />
      </div>
      <label className="wf-field wf-full"><small>Description</small><input value={workflow.description ?? ""} disabled={!canEdit} onChange={(event) => onChange({ ...workflow, description: event.target.value })} /></label>
      <label className="wf-field wf-full"><small>Customer-facing summary</small><input value={workflow.customerSummary ?? ""} disabled={!canEdit} placeholder="Plain-English sentence shown on the customer's workflow card" onChange={(event) => onChange({ ...workflow, customerSummary: event.target.value || undefined })} /></label>
      <label className="wf-field"><small>Manual minutes estimate</small><input type="number" min={0} step={1} value={workflow.manualMinutesEstimate ?? ""} disabled={!canEdit} onChange={(event) => onChange({ ...workflow, manualMinutesEstimate: event.target.value ? Number(event.target.value) : undefined })} /></label>

      {(() => {
        // Derived from the steps themselves, so it can never disagree with what the workflow does.
        const targets = requiredTargets(workflow);
        const problems = validateWorkflowTargets(workflow);
        return (
          <div className="wf-requirements">
            <p className="product-eyebrow">REQUIRED TO RUN</p>
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
            {problems.length > 0 && (
              <ul className="wf-req-problems">
                {problems.map((problem) => <li key={problem}>{problem}</li>)}
              </ul>
            )}
          </div>
        );
      })()}

      <div className="wf-steps">
        {workflow.steps.map((step, index) => (
          <div className="wf-step" key={step.id}>
            <div className="wf-step-head">
              <span className="wf-step-icon">{stepIcon(step.type)}</span>
              <input className="wf-step-name" value={step.name} disabled={!canEdit} onChange={(event) => updateStep(index, { name: event.target.value })} />
              <select value={step.type} disabled={!canEdit} onChange={(event) => changeStepType(index, event.target.value as (typeof STEP_TYPES)[number])}>
                {STEP_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <div className="wf-step-ops">
                <button type="button" disabled={!canEdit || index === 0} onClick={() => moveStep(index, -1)} title="Move up">↑</button>
                <button type="button" disabled={!canEdit || index === workflow.steps.length - 1} onClick={() => moveStep(index, 1)} title="Move down">↓</button>
                <button type="button" disabled={!canEdit || workflow.steps.length <= 1} onClick={() => removeStep(index)} title="Delete step">✕</button>
              </div>
            </div>
            <small className="wf-step-id">
              id: {step.id}
              {step.type === "action" && stepTarget(step) && (
                <span className={`wf-target-badge ${stepTarget(step) === "desktop_agent" ? "wf-target-desktop" : "wf-target-browser"}`}>
                  {TARGET_LABEL[stepTarget(step) as ExecutionTarget]}
                </span>
              )}
            </small>

            {step.type === "ai" && <div className="wf-step-body">
              <label className="wf-field"><small>Operation</small><select value={step.operation} disabled={!canEdit} onChange={(event) => updateStep(index, { operation: event.target.value as (typeof AI_OPERATIONS)[number] })}>{AI_OPERATIONS.map((op) => <option key={op} value={op}>{op}</option>)}</select></label>
              <label className="wf-field"><small>Output key</small><input value={step.outputKey} disabled={!canEdit} onChange={(event) => updateStep(index, { outputKey: event.target.value })} /></label>
              <label className="wf-field"><small>Confidence threshold</small><input type="number" min={0} max={1} step={0.05} value={step.confidenceThreshold ?? 0.85} disabled={!canEdit} onChange={(event) => updateStep(index, { confidenceThreshold: Number(event.target.value) })} /></label>
              <label className="wf-field wf-full"><small>Prompt</small><textarea value={step.prompt} disabled={!canEdit} onChange={(event) => updateStep(index, { prompt: event.target.value })} /></label>
              <label className="wf-field wf-full"><small>Allowed values (comma separated)</small><input value={(step.allowedValues ?? []).join(", ")} disabled={!canEdit} onChange={(event) => updateStep(index, { allowedValues: event.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} /></label>
              <StepTarget label="Next step" value={step.next} stepIds={stepIds} allowNone onChange={(value) => updateStep(index, { next: value })} />
            </div>}

            {step.type === "action" && <div className="wf-step-body">
              <label className="wf-field"><small>Provider</small><select value={step.provider} disabled={!canEdit} onChange={(event) => {
                const provider = event.target.value as (typeof PROVIDERS)[number];
                const target = targetForProvider(provider);
                // Changing the provider settles the surface, and an operation that belonged to the
                // old surface cannot survive the move -- so it resets to that surface's first action
                // rather than leaving an invalid pairing on the card.
                updateStep(index, target
                  ? { provider, executionTarget: target, operation: ACTIONS_BY_TARGET[target].includes(step.operation) ? step.operation : ACTIONS_BY_TARGET[target][0] }
                  : { provider, executionTarget: undefined });
              }}>{PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
              {stepTarget(step) && (
                <label className="wf-field"><small>Runs on</small><select value={stepTarget(step)} disabled={!canEdit} onChange={(event) => {
                  const target = event.target.value as ExecutionTarget;
                  updateStep(index, { executionTarget: target, provider: PROVIDER_FOR_TARGET[target], operation: ACTIONS_BY_TARGET[target][0] });
                }}>
                  <option value="browser_extension">Chrome Extension</option>
                  <option value="desktop_agent">Desktop App</option>
                </select></label>
              )}
              {stepTarget(step) ? (
                <label className="wf-field"><small>Action</small><select value={step.operation} disabled={!canEdit} onChange={(event) => {
                  const operation = event.target.value;
                  // Picking an action settles its surface too, so the two can never disagree.
                  const target = targetForAction(operation);
                  updateStep(index, target ? { operation, executionTarget: target, provider: PROVIDER_FOR_TARGET[target] } : { operation });
                }}>
                  {(stepTarget(step) === "desktop_agent" ? DESKTOP_ACTIONS : BROWSER_ACTIONS).map((op) => <option key={op} value={op}>{op}</option>)}
                </select></label>
              ) : (
                <label className="wf-field"><small>Operation</small><input value={step.operation} disabled={!canEdit} onChange={(event) => updateStep(index, { operation: event.target.value })} /></label>
              )}
              <label className="wf-field wf-full">
                <small>Input (JSON)</small>
                <textarea
                  value={actionInputDrafts[step.id] ?? JSON.stringify(step.input ?? {}, null, 2)}
                  disabled={!canEdit}
                  spellCheck={false}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setActionInputDrafts((prev) => ({ ...prev, [step.id]: raw }));
                    try { updateStep(index, { input: JSON.parse(raw || "{}") }); } catch { /* keep the draft, wait for valid JSON */ }
                  }}
                />
                {(() => {
                  const draft = actionInputDrafts[step.id];
                  if (draft === undefined) return null;
                  try { JSON.parse(draft || "{}"); return null; } catch (error) {
                    return <p className="wf-json-error">{error instanceof Error ? error.message : "Invalid JSON"} -- not saved yet</p>;
                  }
                })()}
              </label>
              <label className="wf-field"><small>Verify path (optional)</small><input value={step.verify?.path ?? ""} disabled={!canEdit} onChange={(event) => updateStep(index, { verify: event.target.value ? { path: event.target.value, equals: step.verify?.equals ?? "" } : undefined })} /></label>
              <label className="wf-field"><small>Verify equals</small><input value={String(step.verify?.equals ?? "")} disabled={!canEdit || !step.verify} onChange={(event) => step.verify && updateStep(index, { verify: { ...step.verify, equals: event.target.value } })} /></label>
              <StepTarget label="Next step" value={step.next} stepIds={stepIds} allowNone onChange={(value) => updateStep(index, { next: value })} />
            </div>}

            {step.type === "condition" && <div className="wf-step-body">
              <label className="wf-field"><small>Path (dot notation)</small><input value={step.path} disabled={!canEdit} onChange={(event) => updateStep(index, { path: event.target.value })} /></label>
              <label className="wf-field"><small>Operator</small><select value={step.operator} disabled={!canEdit} onChange={(event) => updateStep(index, { operator: event.target.value as (typeof COMPARATORS)[number] })}>{COMPARATORS.map((op) => <option key={op} value={op}>{op}</option>)}</select></label>
              <label className="wf-field"><small>Compare to value</small><input value={String(step.value ?? "")} disabled={!canEdit} onChange={(event) => updateStep(index, { value: event.target.value })} /></label>
              <StepTarget label="When true" value={step.whenTrue} stepIds={stepIds} onChange={(value) => value && updateStep(index, { whenTrue: value })} />
              <StepTarget label="When false" value={step.whenFalse} stepIds={stepIds} onChange={(value) => value && updateStep(index, { whenFalse: value })} />
            </div>}

            {step.type === "approval" && <div className="wf-step-body">
              <label className="wf-field wf-full"><small>Message shown to the approver</small><input value={step.message} disabled={!canEdit} onChange={(event) => updateStep(index, { message: event.target.value })} /></label>
              <label className="wf-field"><small>Roles that can decide (comma separated)</small><input value={step.roles.join(", ")} disabled={!canEdit} onChange={(event) => updateStep(index, { roles: event.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} /></label>
              <StepTarget label="On approve → next" value={step.next} stepIds={stepIds} allowNone onChange={(value) => updateStep(index, { next: value })} />
              <StepTarget label="On reject" value={step.onReject} stepIds={stepIds} allowNone onChange={(value) => updateStep(index, { onReject: value })} />
            </div>}

            {step.type === "verify" && <div className="wf-step-body">
              <label className="wf-field"><small>Path (dot notation)</small><input value={step.path} disabled={!canEdit} onChange={(event) => updateStep(index, { path: event.target.value })} /></label>
              <label className="wf-field"><small>Operator</small><select value={step.operator} disabled={!canEdit} onChange={(event) => updateStep(index, { operator: event.target.value as (typeof COMPARATORS)[number] })}>{COMPARATORS.map((op) => <option key={op} value={op}>{op}</option>)}</select></label>
              <label className="wf-field"><small>Expected value</small><input value={String(step.value ?? "")} disabled={!canEdit} onChange={(event) => updateStep(index, { value: event.target.value })} /></label>
              <StepTarget label="On pass → next" value={step.next} stepIds={stepIds} allowNone onChange={(value) => updateStep(index, { next: value })} />
              <StepTarget label="On failure" value={step.onFailure} stepIds={stepIds} allowNone onChange={(value) => updateStep(index, { onFailure: value })} />
            </div>}

            {step.type === "end" && <div className="wf-step-body">
              <label className="wf-field"><small>Outcome</small><select value={step.outcome} disabled={!canEdit} onChange={(event) => updateStep(index, { outcome: event.target.value as "success" | "failed" })}><option value="success">success</option><option value="failed">failed</option></select></label>
            </div>}
          </div>
        ))}
        {canEdit && <button type="button" className="wf-add-step" onClick={addStep}>＋ Add step</button>}
      </div>

      <button type="button" className="wf-json-toggle" onClick={() => { setJsonDraft(JSON.stringify(workflow, null, 2)); setJsonError(null); setShowJson((v) => !v); }}>{showJson ? "Hide raw JSON" : "Advanced: edit as JSON"}</button>
      {showJson && <div className="wf-json-panel">
        <textarea value={jsonDraft} disabled={!canEdit} spellCheck={false} onChange={(event) => setJsonDraft(event.target.value)} />
        {jsonError && <p className="wf-json-error">{jsonError}</p>}
        {canEdit && <button type="button" onClick={applyJson}>Apply JSON to builder</button>}
      </div>}
    </div>
  );
}
