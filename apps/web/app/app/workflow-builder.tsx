"use client";

import { useState } from "react";
import type { WorkflowDefinition, WorkflowStep } from "@amazflow/workflow-schema";

const STEP_TYPES = ["ai", "action", "condition", "approval", "verify", "end"] as const;
const AI_OPERATIONS = ["classify", "extract", "transform", "summarize", "choose"] as const;
const PROVIDERS = ["browser", "api", "spreadsheet", "email", "file", "mock"] as const;
const COMPARATORS = ["equals", "notEquals", "exists", "gt", "lt"] as const;

function newStepId() { return `step-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

function defaultStep(type: (typeof STEP_TYPES)[number], id: string): WorkflowStep {
  const name = "New step";
  switch (type) {
    case "ai": return { id, name, type, operation: "extract", prompt: "", outputKey: "result", confidenceThreshold: 0.85 };
    case "action": return { id, name, type, provider: "mock", operation: "", input: {} };
    case "condition": return { id, name, type, path: "", operator: "equals", whenTrue: id, whenFalse: id };
    case "approval": return { id, name, type, message: "", roles: ["admin"] };
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
            <small className="wf-step-id">id: {step.id}</small>

            {step.type === "ai" && <div className="wf-step-body">
              <label className="wf-field"><small>Operation</small><select value={step.operation} disabled={!canEdit} onChange={(event) => updateStep(index, { operation: event.target.value as (typeof AI_OPERATIONS)[number] })}>{AI_OPERATIONS.map((op) => <option key={op} value={op}>{op}</option>)}</select></label>
              <label className="wf-field"><small>Output key</small><input value={step.outputKey} disabled={!canEdit} onChange={(event) => updateStep(index, { outputKey: event.target.value })} /></label>
              <label className="wf-field"><small>Confidence threshold</small><input type="number" min={0} max={1} step={0.05} value={step.confidenceThreshold ?? 0.85} disabled={!canEdit} onChange={(event) => updateStep(index, { confidenceThreshold: Number(event.target.value) })} /></label>
              <label className="wf-field wf-full"><small>Prompt</small><textarea value={step.prompt} disabled={!canEdit} onChange={(event) => updateStep(index, { prompt: event.target.value })} /></label>
              <label className="wf-field wf-full"><small>Allowed values (comma separated)</small><input value={(step.allowedValues ?? []).join(", ")} disabled={!canEdit} onChange={(event) => updateStep(index, { allowedValues: event.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} /></label>
              <StepTarget label="Next step" value={step.next} stepIds={stepIds} allowNone onChange={(value) => updateStep(index, { next: value })} />
            </div>}

            {step.type === "action" && <div className="wf-step-body">
              <label className="wf-field"><small>Provider</small><select value={step.provider} disabled={!canEdit} onChange={(event) => updateStep(index, { provider: event.target.value as (typeof PROVIDERS)[number] })}>{PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
              <label className="wf-field"><small>Operation</small><input value={step.operation} disabled={!canEdit} onChange={(event) => updateStep(index, { operation: event.target.value })} /></label>
              <label className="wf-field wf-full"><small>Input (JSON)</small><textarea value={JSON.stringify(step.input ?? {}, null, 2)} disabled={!canEdit} onChange={(event) => { try { updateStep(index, { input: JSON.parse(event.target.value || "{}") }); } catch { /* wait for valid JSON */ } }} /></label>
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
