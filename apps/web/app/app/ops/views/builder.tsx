"use client";

import { Icon, STEP_ICON } from "../icons";

/**
 * Workflow builder — structured editing for a workflow definition.
 *
 * Behaviour is carried over from the previous Studio builder (same schema, same fields, same raw
 * JSON escape hatch); only the presentation is rebuilt in the AmazFlow Control design language.
 */

import { useState } from "react";
import type { WorkflowDefinition, WorkflowStep } from "@amazflow/workflow-schema";
import { Alert, Btn, Field, IconBtn, Panel, Pill, ToolbarSpacer } from "../primitives";
import { AI_OPERATION_LABEL, STEP_TYPE_LABEL, toolLabel } from "../terms";
import { executionMethod } from "../run-model";

const STEP_TYPES = ["ai", "action", "condition", "approval", "verify", "end"] as const;
const AI_OPERATIONS = ["classify", "extract", "transform", "summarize", "choose"] as const;
const PROVIDERS = ["browser", "api", "spreadsheet", "email", "file", "mock"] as const;
const COMPARATORS = ["equals", "notEquals", "exists", "gt", "lt"] as const;
const DATA_CLASSES = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "PII",
  "PHI",
  "FINANCIAL",
  "RESTRICTED",
] as const;
const ROLES = ["FRONTLINE", "CLIENT_ADMIN", "SUPER_ADMIN"] as const;

function newStepId() {
  return `step-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function defaultStep(type: (typeof STEP_TYPES)[number], id: string): WorkflowStep {
  const name = "New step";
  switch (type) {
    case "ai":
      return { id, name, type, operation: "extract", prompt: "", outputKey: "result", confidenceThreshold: 0.85 };
    case "action":
      return { id, name, type, provider: "mock", operation: "", input: {} };
    case "condition":
      return { id, name, type, path: "", operator: "equals", whenTrue: id, whenFalse: id };
    case "approval":
      return { id, name, type, message: "", roles: ["CLIENT_ADMIN"] };
    case "verify":
      return { id, name, type, path: "", operator: "equals" };
    case "end":
      return { id, name, type, outcome: "success" };
    default:
      throw new Error(`Unhandled step type: ${type}`);
  }
}

function StepTarget({
  label,
  value,
  stepIds,
  onChange,
  allowNone,
  disabled,
}: {
  label: string;
  value?: string;
  stepIds: string[];
  onChange: (value: string | undefined) => void;
  allowNone?: boolean;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <select
        className="ops-select"
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        {allowNone && <option value="">— none —</option>}
        {stepIds.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function WorkflowBuilder({
  workflow,
  canEdit,
  onChange,
}: {
  workflow: WorkflowDefinition;
  canEdit: boolean;
  onChange: (next: WorkflowDefinition) => void;
}) {
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
    steps[index] = {
      ...defaultStep(type, current.id),
      name: current.name,
      next: (current as { next?: string }).next,
    } as WorkflowStep;
    onChange({ ...workflow, steps });
  };

  const addStep = () => {
    const id = newStepId();
    const steps = [...workflow.steps, defaultStep("action", id)];
    onChange({ ...workflow, steps, startAt: workflow.startAt || id });
  };

  const removeStep = (index: number) => {
    const removedId = workflow.steps[index].id;
    const steps = workflow.steps.filter((_, position) => position !== index);
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
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Invalid JSON");
    }
  };

  return (
    <div className="ops-wf">
      <Panel title="Workflow">
        <div className="ops-wf-meta">
          <Field label="Name">
            <input
              className="ops-input"
              value={workflow.name}
              disabled={!canEdit}
              onChange={(event) => onChange({ ...workflow, name: event.target.value })}
            />
          </Field>
          <Field label="Status" hint="Draft and paused workflows cannot be run.">
            <select
              className="ops-select"
              value={workflow.status}
              disabled={!canEdit}
              onChange={(event) =>
                onChange({ ...workflow, status: event.target.value as WorkflowDefinition["status"] })
              }
            >
              <option value="draft">Draft</option>
              <option value="active">Published</option>
              <option value="paused">Paused</option>
            </select>
          </Field>
          <StepTarget
            label="Starts at"
            value={workflow.startAt}
            stepIds={stepIds}
            disabled={!canEdit}
            onChange={(value) => value && onChange({ ...workflow, startAt: value })}
          />
          <Field label="Data class" hint="Drives the platform's data-boundary checks.">
            <select
              className="ops-select"
              value={workflow.dataClass}
              disabled={!canEdit}
              onChange={(event) =>
                onChange({ ...workflow, dataClass: event.target.value as WorkflowDefinition["dataClass"] })
              }
            >
              {DATA_CLASSES.map((dataClass) => (
                <option key={dataClass} value={dataClass}>
                  {dataClass}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Manual minutes per run" hint="Used for the value estimate.">
            <input
              className="ops-input"
              type="number"
              min={0}
              step={1}
              value={workflow.manualMinutesEstimate ?? ""}
              disabled={!canEdit}
              onChange={(event) =>
                onChange({
                  ...workflow,
                  manualMinutesEstimate: event.target.value ? Number(event.target.value) : undefined,
                })
              }
            />
          </Field>
          <Field label="Who can run it">
            <select
              className="ops-select"
              value={workflow.assignedRoles.join(",")}
              disabled={!canEdit}
              onChange={(event) =>
                onChange({
                  ...workflow,
                  assignedRoles: event.target.value.split(",") as WorkflowDefinition["assignedRoles"],
                })
              }
            >
              <option value="FRONTLINE,CLIENT_ADMIN,SUPER_ADMIN">Everyone</option>
              <option value="CLIENT_ADMIN,SUPER_ADMIN">Ops admins and above</option>
              <option value="SUPER_ADMIN">AmazFlow Super Admin only</option>
              {!["FRONTLINE,CLIENT_ADMIN,SUPER_ADMIN", "CLIENT_ADMIN,SUPER_ADMIN", "SUPER_ADMIN"].includes(
                workflow.assignedRoles.join(","),
              ) && <option value={workflow.assignedRoles.join(",")}>{workflow.assignedRoles.join(", ")}</option>}
            </select>
          </Field>
        </div>

        <div style={{ marginTop: 12 }} className="ops-col">
          <Field label="Description" hint="Internal — what this workflow does.">
            <input
              className="ops-input"
              value={workflow.description ?? ""}
              disabled={!canEdit}
              onChange={(event) => onChange({ ...workflow, description: event.target.value })}
            />
          </Field>
          <Field label="Customer-facing summary" hint="Plain-English sentence shown in the customer console.">
            <input
              className="ops-input"
              value={workflow.customerSummary ?? ""}
              disabled={!canEdit}
              onChange={(event) =>
                onChange({ ...workflow, customerSummary: event.target.value || undefined })
              }
            />
          </Field>
        </div>
      </Panel>

      <Panel
        title="Steps"
        sub={`${workflow.steps.length}`}
        actions={
          canEdit ? (
            <Btn size="sm" glyph="plus" onClick={addStep}>
              Add step
            </Btn>
          ) : undefined
        }
      >
        <div className="ops-wf-steps">
          {workflow.steps.map((step, index) => (
            <div className="ops-wf-step" key={step.id}>
              <div className="ops-wf-step-head">
                <span className="ops-wf-step-glyph"><Icon name={STEP_ICON[step.type] ?? "action"} size={12} /></span>
                <input
                  className="ops-wf-step-name"
                  value={step.name}
                  disabled={!canEdit}
                  onChange={(event) => updateStep(index, { name: event.target.value })}
                  aria-label="Step name"
                />
                {step.id === workflow.startAt && <Pill tone="running">start</Pill>}
                <Pill tone="muted">{executionMethod(step)}</Pill>
                <select
                  className="ops-select"
                  value={step.type}
                  disabled={!canEdit}
                  style={{ width: 128 }}
                  onChange={(event) =>
                    changeStepType(index, event.target.value as (typeof STEP_TYPES)[number])
                  }
                  aria-label="Step type"
                >
                  {STEP_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {STEP_TYPE_LABEL[type]}
                    </option>
                  ))}
                </select>
                <div className="ops-wf-step-ops">
                  <IconBtn
                    glyph="arrowUp"
                    label="Move up"
                    disabled={!canEdit || index === 0}
                    onClick={() => moveStep(index, -1)}
                  />
                  <IconBtn
                    glyph="download"
                    label="Move down"
                    disabled={!canEdit || index === workflow.steps.length - 1}
                    onClick={() => moveStep(index, 1)}
                  />
                  <IconBtn
                    glyph="close"
                    label="Delete step"
                    disabled={!canEdit || workflow.steps.length <= 1}
                    onClick={() => removeStep(index)}
                  />
                </div>
              </div>

              <div className="ops-wf-step-body">
                <div className="ops-wf-full ops-row">
                  <span className="ops-wf-stepid">{step.id}</span>
                </div>

                {step.type === "ai" && (
                  <>
                    <Field label="Operation">
                      <select
                        className="ops-select"
                        value={step.operation}
                        disabled={!canEdit}
                        onChange={(event) => updateStep(index, { operation: event.target.value })}
                      >
                        {AI_OPERATIONS.map((operation) => (
                          <option key={operation} value={operation}>
                            {AI_OPERATION_LABEL[operation]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Writes to key">
                      <input
                        className="ops-input"
                        value={step.outputKey}
                        disabled={!canEdit}
                        onChange={(event) => updateStep(index, { outputKey: event.target.value })}
                      />
                    </Field>
                    <Field label="Confidence floor" hint="0 to 1. Below this, AmazFlow won't act.">
                      <input
                        className="ops-input"
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={step.confidenceThreshold ?? 0.85}
                        disabled={!canEdit}
                        onChange={(event) =>
                          updateStep(index, { confidenceThreshold: Number(event.target.value) })
                        }
                      />
                    </Field>
                    <div className="ops-wf-full">
                      <Field label="Prompt">
                        <textarea
                          className="ops-textarea"
                          value={step.prompt}
                          disabled={!canEdit}
                          onChange={(event) => updateStep(index, { prompt: event.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="ops-wf-full">
                      <Field label="Allowed values" hint="Comma separated. Constrains the output.">
                        <input
                          className="ops-input"
                          value={(step.allowedValues ?? []).join(", ")}
                          disabled={!canEdit}
                          onChange={(event) =>
                            updateStep(index, {
                              allowedValues: event.target.value
                                .split(",")
                                .map((value) => value.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </Field>
                    </div>
                    <StepTarget
                      label="Next step"
                      value={step.next}
                      stepIds={stepIds}
                      allowNone
                      disabled={!canEdit}
                      onChange={(value) => updateStep(index, { next: value })}
                    />
                  </>
                )}

                {step.type === "action" && (
                  <>
                    <Field label="Executed by">
                      <select
                        className="ops-select"
                        value={step.provider}
                        disabled={!canEdit}
                        onChange={(event) => updateStep(index, { provider: event.target.value })}
                      >
                        {PROVIDERS.map((provider) => (
                          <option key={provider} value={provider}>
                            {toolLabel(provider)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Operation">
                      <input
                        className="ops-input"
                        value={step.operation}
                        disabled={!canEdit}
                        onChange={(event) => updateStep(index, { operation: event.target.value })}
                      />
                    </Field>
                    {step.provider === "browser" && (
                      <Field label="Browser mode">
                        <select
                          className="ops-select"
                          value={step.browserMode ?? "auto"}
                          disabled={!canEdit}
                          onChange={(event) => updateStep(index, { browserMode: event.target.value })}
                        >
                          <option value="auto">Automatic</option>
                          <option value="managed">AmazFlow Browser only</option>
                          <option value="connected">Chrome Agent only</option>
                        </select>
                      </Field>
                    )}
                    <Field label="Confirm before acting">
                      <select
                        className="ops-select"
                        value={step.requiresConfirmation ? "yes" : "no"}
                        disabled={!canEdit}
                        onChange={(event) =>
                          updateStep(index, { requiresConfirmation: event.target.value === "yes" })
                        }
                      >
                        <option value="no">No</option>
                        <option value="yes">Yes — hold for a human</option>
                      </select>
                    </Field>
                    <div className="ops-wf-full">
                      <Field label="Input (JSON)">
                        <textarea
                          className="ops-textarea"
                          style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}
                          defaultValue={JSON.stringify(step.input ?? {}, null, 2)}
                          disabled={!canEdit}
                          onChange={(event) => {
                            try {
                              updateStep(index, { input: JSON.parse(event.target.value || "{}") });
                            } catch {
                              // Wait for the operator to finish typing valid JSON.
                            }
                          }}
                        />
                      </Field>
                    </div>
                    <Field label="Verify path" hint="Optional independent check after acting.">
                      <input
                        className="ops-input"
                        value={step.verify?.path ?? ""}
                        disabled={!canEdit}
                        onChange={(event) =>
                          updateStep(index, {
                            verify: event.target.value
                              ? { path: event.target.value, equals: step.verify?.equals ?? "" }
                              : undefined,
                          })
                        }
                      />
                    </Field>
                    <Field label="Verify equals">
                      <input
                        className="ops-input"
                        value={String(step.verify?.equals ?? "")}
                        disabled={!canEdit || !step.verify}
                        onChange={(event) =>
                          step.verify &&
                          updateStep(index, { verify: { ...step.verify, equals: event.target.value } })
                        }
                      />
                    </Field>
                    <StepTarget
                      label="Next step"
                      value={step.next}
                      stepIds={stepIds}
                      allowNone
                      disabled={!canEdit}
                      onChange={(value) => updateStep(index, { next: value })}
                    />
                    <StepTarget
                      label="On failure"
                      value={step.onFailure}
                      stepIds={stepIds}
                      allowNone
                      disabled={!canEdit}
                      onChange={(value) => updateStep(index, { onFailure: value })}
                    />
                  </>
                )}

                {step.type === "condition" && (
                  <>
                    <Field label="Path" hint="Dot notation into the run context.">
                      <input
                        className="ops-input"
                        value={step.path}
                        disabled={!canEdit}
                        onChange={(event) => updateStep(index, { path: event.target.value })}
                      />
                    </Field>
                    <Field label="Operator">
                      <select
                        className="ops-select"
                        value={step.operator}
                        disabled={!canEdit}
                        onChange={(event) => updateStep(index, { operator: event.target.value })}
                      >
                        {COMPARATORS.map((operator) => (
                          <option key={operator} value={operator}>
                            {operator}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Compare to">
                      <input
                        className="ops-input"
                        value={String(step.value ?? "")}
                        disabled={!canEdit}
                        onChange={(event) => updateStep(index, { value: event.target.value })}
                      />
                    </Field>
                    <StepTarget
                      label="When true"
                      value={step.whenTrue}
                      stepIds={stepIds}
                      disabled={!canEdit}
                      onChange={(value) => value && updateStep(index, { whenTrue: value })}
                    />
                    <StepTarget
                      label="When false"
                      value={step.whenFalse}
                      stepIds={stepIds}
                      disabled={!canEdit}
                      onChange={(value) => value && updateStep(index, { whenFalse: value })}
                    />
                  </>
                )}

                {step.type === "approval" && (
                  <>
                    <div className="ops-wf-full">
                      <Field label="Message shown to the approver">
                        <input
                          className="ops-input"
                          value={step.message}
                          disabled={!canEdit}
                          onChange={(event) => updateStep(index, { message: event.target.value })}
                        />
                      </Field>
                    </div>
                    <Field label="Roles that can decide">
                      <select
                        className="ops-select"
                        value={step.roles.join(",")}
                        disabled={!canEdit}
                        onChange={(event) =>
                          updateStep(index, { roles: event.target.value.split(",") })
                        }
                      >
                        <option value="CLIENT_ADMIN">Ops admin</option>
                        <option value="CLIENT_ADMIN,SUPER_ADMIN">Ops admin or AmazFlow</option>
                        <option value="SUPER_ADMIN">AmazFlow only</option>
                        {!["CLIENT_ADMIN", "CLIENT_ADMIN,SUPER_ADMIN", "SUPER_ADMIN"].includes(
                          step.roles.join(","),
                        ) && <option value={step.roles.join(",")}>{step.roles.join(", ")}</option>}
                      </select>
                    </Field>
                    <StepTarget
                      label="Next step when approved"
                      value={step.next}
                      stepIds={stepIds}
                      allowNone
                      disabled={!canEdit}
                      onChange={(value) => updateStep(index, { next: value })}
                    />
                    <StepTarget
                      label="On send back"
                      value={step.onReject}
                      stepIds={stepIds}
                      allowNone
                      disabled={!canEdit}
                      onChange={(value) => updateStep(index, { onReject: value })}
                    />
                  </>
                )}

                {step.type === "verify" && (
                  <>
                    <Field label="Path">
                      <input
                        className="ops-input"
                        value={step.path}
                        disabled={!canEdit}
                        onChange={(event) => updateStep(index, { path: event.target.value })}
                      />
                    </Field>
                    <Field label="Operator">
                      <select
                        className="ops-select"
                        value={step.operator}
                        disabled={!canEdit}
                        onChange={(event) => updateStep(index, { operator: event.target.value })}
                      >
                        {COMPARATORS.map((operator) => (
                          <option key={operator} value={operator}>
                            {operator}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Expected value">
                      <input
                        className="ops-input"
                        value={String(step.value ?? "")}
                        disabled={!canEdit}
                        onChange={(event) => updateStep(index, { value: event.target.value })}
                      />
                    </Field>
                    <StepTarget
                      label="Next step when it passes"
                      value={step.next}
                      stepIds={stepIds}
                      allowNone
                      disabled={!canEdit}
                      onChange={(value) => updateStep(index, { next: value })}
                    />
                    <StepTarget
                      label="On failure"
                      value={step.onFailure}
                      stepIds={stepIds}
                      allowNone
                      disabled={!canEdit}
                      onChange={(value) => updateStep(index, { onFailure: value })}
                    />
                  </>
                )}

                {step.type === "end" && (
                  <Field label="Outcome">
                    <select
                      className="ops-select"
                      value={step.outcome}
                      disabled={!canEdit}
                      onChange={(event) => updateStep(index, { outcome: event.target.value })}
                    >
                      <option value="success">Success</option>
                      <option value="failed">Failed</option>
                    </select>
                  </Field>
                )}
              </div>
            </div>
          ))}

          {canEdit && (
            <button type="button" className="ops-wf-add" onClick={addStep}>
              Add step
            </button>
          )}
        </div>
      </Panel>

      <Panel
        title="Raw definition"
        actions={
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => {
              setJsonDraft(JSON.stringify(workflow, null, 2));
              setJsonError(null);
              setShowJson((value) => !value);
            }}
          >
            {showJson ? "Hide JSON" : "Edit as JSON"}
          </Btn>
        }
      >
        {showJson ? (
          <div className="ops-col">
            <textarea
              className="ops-textarea"
              style={{ minHeight: 320, fontFamily: "var(--font-mono)", fontSize: 11.5 }}
              value={jsonDraft}
              disabled={!canEdit}
              spellCheck={false}
              onChange={(event) => setJsonDraft(event.target.value)}
            />
            {jsonError && <Alert tone="bad" title="Invalid JSON">{jsonError}</Alert>}
            <div className="ops-row">
              <ToolbarSpacer />
              {canEdit && (
                <Btn variant="primary" onClick={applyJson}>
                  Apply to builder
                </Btn>
              )}
            </div>
          </div>
        ) : (
          <p className="ops-small ops-muted">
            The structured editor above covers every field. Use raw JSON for bulk edits or to paste
            a definition from elsewhere.
          </p>
        )}
      </Panel>
    </div>
  );
}
