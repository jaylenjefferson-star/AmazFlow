"use client";

/**
 * Workflow Studio — authoring.
 *
 * Everything the previous Studio could do is preserved: browse the library, edit a definition,
 * draft one from a plain-English SOP, save it (which pins a new version), and execute it against
 * an input. The surrounding experience is now operational rather than a wall of textareas.
 */

import { useEffect, useMemo, useState } from "react";
import { sampleWorkflow, type WorkflowDefinition } from "@amazflow/workflow-schema";
import { useOps } from "../data";
import { useNav } from "../nav";
import { PageHead } from "../shell";
import { useOpsActions } from "../actions";
import {
  Alert,
  Btn,
  CodeBlock,
  EmptyState,
  Field,
  Modal,
  Panel,
  Pill,
  SearchInput,
  Tabs,
  ToolbarSpacer,
  type TabSpec,
  Chevron,
} from "../primitives";
import {
  RESTRICTED_DATA_CLASSES,
  WORKFLOW_STATUS_LABEL,
  WORKFLOW_STATUS_TONE,
  relativeTime,
} from "../terms";
import { WorkflowBuilder } from "./builder";

const stringify = (value: unknown) => JSON.stringify(value, null, 2);

function blankWorkflow(tenantId: string): WorkflowDefinition {
  return {
    ...sampleWorkflow,
    id: `workflow-${Date.now().toString(36)}`,
    tenantId,
    name: "Untitled workflow",
    description: "",
    version: 1,
    status: "draft",
  };
}

export function StudioView({ workflowId }: { workflowId?: string }) {
  const ops = useOps();
  const nav = useNav();
  const actions = useOpsActions();

  const [draft, setDraft] = useState<WorkflowDefinition | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("build");
  const [sopOpen, setSopOpen] = useState(nav.view.view === "sop");
  const [sopText, setSopText] = useState("");
  const [sopTenant, setSopTenant] = useState("");
  const [input, setInput] = useState(
    stringify({ employee: { id: "E-10042", name: "Sarah Chen" }, request: "DISABLE" }),
  );
  const [inputError, setInputError] = useState<string | null>(null);

  // Resolve which workflow is being edited: an explicit id, a requested blank, or the first in
  // the library. Only re-runs when the target actually changes so edits aren't clobbered.
  useEffect(() => {
    if (nav.view.view === "new") {
      setDraft(blankWorkflow(ops.session.tenantId));
      return;
    }
    if (workflowId) {
      const found = ops.workflowById(workflowId);
      if (found) setDraft(found);
      return;
    }
    setDraft((current) => current ?? ops.workflows[0] ?? blankWorkflow(ops.session.tenantId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, nav.view.view, ops.workflows.length]);

  const saved = draft ? ops.workflowById(draft.id) : undefined;
  const dirty = Boolean(draft && (!saved || stringify(saved) !== stringify(draft)));

  const library = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = needle
      ? ops.workflows.filter(
          (workflow) =>
            workflow.name.toLowerCase().includes(needle) ||
            (workflow.description ?? "").toLowerCase().includes(needle),
        )
      : ops.workflows;
    return list.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [ops.workflows, search]);

  const tabs: TabSpec[] = [
    { id: "build", label: "Build" },
    { id: "run", label: "Test run" },
    { id: "preview", label: "Definition" },
  ];

  const restricted = draft ? RESTRICTED_DATA_CLASSES.includes(draft.dataClass) : false;

  return (
    <>
      <PageHead
        title="Workflow Studio"
        sub="Author and publish workflow definitions. Saving pins a new immutable version; publishing is a separate, explicit choice."
        actions={
          <>
            <Btn glyph="sparkle" onClick={() => setSopOpen(true)}>
              Draft from an SOP
            </Btn>
            <Btn
              glyph="plus"
              onClick={() => {
                setDraft(blankWorkflow(ops.session.tenantId));
                nav.go({ section: "studio", view: "new" });
              }}
            >
              New
            </Btn>
            {draft && (
              <Btn
                variant="primary"
                disabled={!dirty || actions.busy === `saveWorkflow_${draft.id}`}
                onClick={async () => {
                  const result = await actions.saveWorkflow(draft);
                  if (result) nav.go({ section: "studio", entityId: result.id });
                }}
              >
                {actions.busy === `saveWorkflow_${draft.id}`
                  ? "Saving…"
                  : dirty
                    ? "Save workflow"
                    : "Saved"}
              </Btn>
            )}
          </>
        }
      />

      <div className="ops-split">
        <div>
          {!draft ? (
            <EmptyState
              glyph="workflows"
              title="Nothing selected"
              body="Pick a workflow from the library, or start a new one."
            />
          ) : (
            <>
              <Panel>
                <div className="ops-row ops-row-wrap">
                  <h2 style={{ fontSize: 15 }}>{draft.name || "Untitled workflow"}</h2>
                  <Pill tone={WORKFLOW_STATUS_TONE[draft.status] ?? "neutral"}>
                    {WORKFLOW_STATUS_LABEL[draft.status] ?? draft.status}
                  </Pill>
                  <Pill tone="muted">v{draft.version}</Pill>
                  {dirty && <Pill tone="waiting">unsaved changes</Pill>}
                  <ToolbarSpacer />
                  {saved && (
                    <Btn size="sm" variant="ghost" onClick={() => nav.openWorkflow(draft.id)}>
                      Operations view
                    </Btn>
                  )}
                </div>
                {restricted && (
                  <div style={{ marginTop: 10 }}>
                    <Alert tone="bad" title="Data class outside the production boundary">
                      A workflow classified {draft.dataClass} must not process live data until the
                      matching compliance controls are enabled.
                    </Alert>
                  </div>
                )}
              </Panel>

              <div style={{ marginTop: 12 }}>
                <Tabs tabs={tabs} active={tab} onSelect={setTab} />
              </div>

              <div className="ops-tabpanel">
                {tab === "build" && (
                  <WorkflowBuilder workflow={draft} canEdit onChange={setDraft} />
                )}

                {tab === "run" && (
                  <div className="ops-col">
                    <Panel
                      title="Run this workflow"
                      sub={
                        ops.settings?.dataBoundary?.startsWith("production")
                          ? "Live operational data"
                          : "Synthetic data only"
                      }
                      actions={
                        <Btn
                          variant="accent"
                          size="sm"
                          disabled={dirty || draft.status !== "active" || actions.busy === `start_${draft.id}`}
                          onClick={async () => {
                            try {
                              const parsed = JSON.parse(input);
                              setInputError(null);
                              const created = await actions.startRun(draft.id, parsed);
                              if (created) nav.openRun(created.id);
                            } catch (error) {
                              setInputError(
                                error instanceof Error ? error.message : "Input must be valid JSON",
                              );
                            }
                          }}
                        >
                          Run workflow
                        </Btn>
                      }
                    >
                      {dirty && (
                        <div style={{ marginBottom: 10 }}>
                          <Alert tone="waiting" title="Save first">
                            The control plane runs the saved, pinned version — not your unsaved
                            edits.
                          </Alert>
                        </div>
                      )}
                      {draft.status !== "active" && (
                        <div style={{ marginBottom: 10 }}>
                          <Alert tone="waiting" title="Not published">
                            The control plane rejects runs for a workflow that isn&apos;t published.
                            Set status to Published and save to run it.
                          </Alert>
                        </div>
                      )}
                      <Field label="Input (JSON)" hint="Becomes the run's starting context.">
                        <textarea
                          className="ops-textarea"
                          style={{ minHeight: 200, fontFamily: "var(--font-mono)", fontSize: 11.5 }}
                          value={input}
                          spellCheck={false}
                          onChange={(event) => setInput(event.target.value)}
                        />
                      </Field>
                      {inputError && <Alert tone="bad" title="Invalid input">{inputError}</Alert>}
                      <div style={{ marginTop: 12 }}>
                        <p className="ops-small ops-muted">
                          Decision steps run through {ops.settings?.aiRuntimeLabel ?? "AmazFlow managed AI"}.
                          Actions are bounded by this workflow&apos;s allowed providers and a
                          single-use execution grant per step.
                        </p>
                      </div>
                    </Panel>

                    <Panel title="Recent runs of this workflow">
                      {(() => {
                        const runs = ops
                          .runsForWorkflow(draft.id)
                          .slice()
                          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                          .slice(0, 8);
                        if (runs.length === 0) {
                          return <p className="ops-small ops-muted">No runs yet.</p>;
                        }
                        return (
                          <div className="ops-col ops-gap-sm">
                            {runs.map((run) => (
                              <button
                                key={run.id}
                                className="ops-row"
                                style={{ width: "100%" }}
                                onClick={() => nav.openRun(run.id)}
                              >
                                <Pill tone={WORKFLOW_STATUS_TONE[run.status] ?? "muted"}>
                                  {run.status.replaceAll("_", " ").toLowerCase()}
                                </Pill>
                                <span className="ops-small ops-muted">v{run.workflowVersion}</span>
                                <ToolbarSpacer />
                                <span className="ops-small ops-muted">
                                  {relativeTime(run.createdAt)}
                                </span>
                                <Chevron />
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </Panel>
                  </div>
                )}

                {tab === "preview" && (
                  <Panel title="Definition as it will be saved">
                    <CodeBlock value={draft} />
                  </Panel>
                )}
              </div>
            </>
          )}
        </div>

        {/* ------------------------------------------------------------------- library --- */}
        <div className="ops-col">
          <Panel title="Library" sub={`${ops.workflows.length}`}>
            <SearchInput value={search} onChange={setSearch} placeholder="Filter workflows…" />
            <div className="ops-col ops-gap-sm" style={{ marginTop: 10, maxHeight: 560, overflowY: "auto" }}>
              {library.length === 0 ? (
                <p className="ops-small ops-muted">
                  {ops.workflows.length === 0 ? "The library is empty." : "Nothing matches."}
                </p>
              ) : (
                library.map((workflow) => (
                  <button
                    key={workflow.id}
                    className="ops-col"
                    style={{
                      width: "100%",
                      gap: 2,
                      textAlign: "left",
                      padding: "7px 8px",
                      borderRadius: "var(--r-sm)",
                      background:
                        draft?.id === workflow.id ? "var(--surface-3)" : "transparent",
                    }}
                    onClick={() => {
                      setDraft(workflow);
                      nav.go({ section: "studio", entityId: workflow.id });
                    }}
                  >
                    <span className="ops-row">
                      <span className="ops-strong ops-truncate" style={{ flex: 1 }}>
                        {workflow.name}
                      </span>
                      <Pill tone={WORKFLOW_STATUS_TONE[workflow.status] ?? "neutral"}>
                        {WORKFLOW_STATUS_LABEL[workflow.status] ?? workflow.status}
                      </Pill>
                    </span>
                    <span className="ops-small ops-muted ops-truncate">
                      {ops.orgLabel(workflow.tenantId)} · v{workflow.version} ·{" "}
                      {workflow.steps.length} steps
                    </span>
                  </button>
                ))
              )}
            </div>
          </Panel>

          <Panel title="How saving works">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8 }}>
              <li>Saving writes the definition and pins an immutable version record.</li>
              <li>Runs always execute a pinned version, never a live draft.</li>
              <li>
                A browser step in <b>hosted</b> mode requires an authenticated connection for its
                organization — the control plane rejects the save otherwise.
              </li>
              <li>Publishing is the status change, and it is deliberately separate from saving.</li>
            </ul>
          </Panel>
        </div>
      </div>

      {sopOpen && (
        <Modal
          title="Draft a workflow from an SOP"
          onClose={() => setSopOpen(false)}
          footer={
            <>
              <Btn onClick={() => setSopOpen(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                disabled={!sopText.trim() || actions.busy === "generateSop"}
                onClick={async () => {
                  const generated = await actions.generateFromSop(
                    sopText.trim(),
                    sopTenant || undefined,
                  );
                  if (generated) {
                    setDraft(generated);
                    setSopOpen(false);
                    setSopText("");
                    nav.go({ section: "studio", entityId: generated.id });
                  }
                }}
              >
                {actions.busy === "generateSop" ? "Drafting…" : "Generate draft"}
              </Btn>
            </>
          }
        >
          <Field
            label="Describe the procedure in plain English"
            hint="AmazFlow drafts an editable workflow and saves it immediately as a draft. Nothing runs until you publish it."
          >
            <textarea
              className="ops-textarea"
              style={{ minHeight: 140 }}
              value={sopText}
              autoFocus
              placeholder="When a new vendor invoice arrives by email, read the vendor, amount, and due date, flag anything over $5,000 for manager approval, then record it in the AP spreadsheet and confirm it was recorded."
              onChange={(event) => setSopText(event.target.value)}
            />
          </Field>
          {ops.organizations.length > 0 && (
            <Field label="Organization" hint="Leave blank to draft against your own tenant.">
              <select
                className="ops-select"
                value={sopTenant}
                onChange={(event) => setSopTenant(event.target.value)}
              >
                <option value="">— your tenant —</option>
                {ops.organizations.map((org) => (
                  <option key={org.slug} value={org.slug}>
                    {org.branding?.displayName || org.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </Modal>
      )}
    </>
  );
}
