"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@amazflow/api-client";
import { can } from "@amazflow/permissions";
import { requiredTargets, type ExecutionTarget, type WorkflowDefinition } from "@amazflow/workflow-schema";
import { Alert, Btn, EmptyState, PageHead, Panel, Pill, SkeletonPanel } from "@amazflow/ui";
import type { ViewProps } from "./views";
import * as endpoints from "./endpoints";
import { WorkflowBuilder, workflowBlockingProblems } from "./workflow-builder";

type Version = Pick<WorkflowDefinition, "id" | "version" | "status" | "name" | "steps"> & {
  createdAt?: string;
  updatedAt?: string;
};
type Preflight = {
  ready?: boolean;
  requiredTargets?: ExecutionTarget[];
  surfaces?: Array<{ target?: ExecutionTarget; ready?: boolean; status?: string; action?: string; reason?: string }>;
};

const TARGET_LABEL: Record<ExecutionTarget, string> = {
  browser_extension: "Chrome Extension",
  desktop_agent: "Desktop App",
};

const freshDraft = (tenantId: string): WorkflowDefinition => ({
  id: "new",
  tenantId,
  name: "",
  description: "",
  version: 1,
  status: "draft",
  dataClass: "INTERNAL",
  assignedRoles: ["FRONTLINE", "CLIENT_ADMIN"],
  startAt: "finish",
  steps: [{ id: "finish", name: "Finished", type: "end", outcome: "success" }],
  allowedProviders: ["browser"],
});

function messageOf(error: unknown) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : "The request did not complete.";
}

/**
 * The authoring/detail surface is intentionally one component: an editable draft is still the same
 * workflow whose versions, derived requirements, and readiness a person needs to understand.
 */
export function WorkflowWorkspace({
  workflowId,
  principal,
  slots,
  navigate,
  client,
  refresh,
}: ViewProps & { workflowId: string }) {
  const workflows = (slots.workflows?.value ?? []) as WorkflowDefinition[];
  // A new draft must stay the same object for this route. Re-creating it on each render would make
  // the synchronization effect below overwrite a person’s edits as soon as React re-renders.
  const source = useMemo(
    () => (workflowId === "new" ? freshDraft(principal.orgId) : workflows.find((workflow) => workflow.id === workflowId)),
    [principal.orgId, workflowId, workflows],
  );
  const canCreate = can(principal, "workflow:create", { orgId: principal.orgId }).allow;
  const canEdit = can(principal, "workflow:edit", { orgId: principal.orgId }).allow;
  const [draft, setDraft] = useState<WorkflowDefinition | null>(source ?? null);
  const [sop, setSop] = useState("");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "generate" | null>(null);

  useEffect(() => {
    setDraft(source ?? null);
    setVersions(null);
    setPreflight(null);
    setLoadError(null);
  }, [workflowId, source?.id, source?.version]);

  useEffect(() => {
    if (!source || workflowId === "new") return;
    let active = true;
    Promise.all([
      client.get<Version[]>(`/workflows/${encodeURIComponent(workflowId)}/versions`),
      client.get<Preflight>(`/workflows/${encodeURIComponent(workflowId)}/preflight`),
    ])
      .then(([history, readiness]) => {
        if (!active) return;
        setVersions(history);
        setPreflight(readiness);
      })
      .catch((error) => active && setLoadError(messageOf(error)));
    return () => {
      active = false;
    };
  }, [client, source?.id, source?.version, workflowId]);

  const blocking = useMemo(() => (draft ? workflowBlockingProblems(draft) : []), [draft]);
  const targets = useMemo(() => (draft ? requiredTargets(draft) : []), [draft]);

  const save = async () => {
    if (!draft || !canEdit || blocking.length) return;
    setBusy("save");
    setMutationError(null);
    try {
      const saved = await client.post<WorkflowDefinition>(endpoints.saveWorkflowDraft(workflowId).path, draft);
      await refresh();
      navigate({ routeId: "workflows", entityId: saved.id });
    } catch (error) {
      setMutationError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (!canCreate || !sop.trim()) return;
    setBusy("generate");
    setMutationError(null);
    try {
      const saved = await client.post<WorkflowDefinition>(endpoints.generateWorkflow().path, { sop: sop.trim() });
      await refresh();
      navigate({ routeId: "workflows", entityId: saved.id });
    } catch (error) {
      setMutationError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  if (!draft) {
    return (
      <section>
        <PageHead title="Workflow" sub="Loading the workflow and its saved definition." />
        {slots.workflows?.state === "loading" ? <SkeletonPanel rows={5} /> : <EmptyState title="Workflow not found" body="It may have been removed, or you may not have access to it." />}
      </section>
    );
  }

  return (
    <section className="ops-col ops-gap-md">
      <PageHead
        title={workflowId === "new" ? "New workflow" : draft.name || "Untitled workflow"}
        sub={workflowId === "new" ? "Build a draft, then ask your AmazFlow contact to publish it." : "Versions and readiness are based on the workflow you are editing."}
        actions={<Btn variant="ghost" onClick={() => navigate({ routeId: "workflows" })}>Back to workflows</Btn>}
      />

      {mutationError && <Alert tone="bad" title="This did not save">{mutationError}</Alert>}

      {canCreate && (
        <Panel title="Start from a plain-language description" sub="A candidate is validated and saved as a draft before it opens here.">
          <div className="ops-col ops-gap-sm">
            <label>
              <span className="ops-field-label">Describe the process</span>
              <textarea
                className="ops-input"
                value={sop}
                onChange={(event) => setSop(event.target.value)}
                placeholder="For example: when a new employee joins, create their accounts and ask their manager to confirm access."
              />
            </label>
            <div><Btn variant="accent" onClick={() => void generate()} disabled={busy !== null || !sop.trim()}>{busy === "generate" ? "Creating draft…" : "Create validated draft"}</Btn></div>
          </div>
        </Panel>
      )}

      <Panel
        title="Workflow definition"
        sub={canEdit ? "Changes save as a structured definition, never as the description above." : "Your role can view this workflow but cannot change it."}
        actions={<Btn variant="primary" onClick={() => void save()} disabled={!canEdit || busy !== null || blocking.length > 0}>{busy === "save" ? "Saving…" : "Save draft"}</Btn>}
      >
        <WorkflowBuilder workflow={draft} canEdit={canEdit} onChange={setDraft} />
      </Panel>

      <Panel title="Publishing">
        <p>Your AmazFlow contact publishes this workflow after reviewing its draft and readiness. This release intentionally does not show a publish control that your role cannot use.</p>
      </Panel>

      <Panel title="Required to run" sub="Derived from the workflow’s steps; it is never a separately stored setting.">
        {targets.length ? (
          <div className="ops-row ops-gap-sm">
            {targets.map((target) => <Pill key={target} tone="neutral">{TARGET_LABEL[target]}</Pill>)}
          </div>
        ) : <p>Every step runs inside AmazFlow. No browser extension or desktop app is required.</p>}
        {loadError && <Alert tone="bad" title="Readiness did not load">{loadError}</Alert>}
        {!loadError && !preflight && workflowId !== "new" && <SkeletonPanel rows={2} />}
        {preflight && (
          <div className="ops-col ops-gap-sm">
            <Pill tone={preflight.ready ? "good" : "waiting"}>{preflight.ready ? "Ready to run" : "Not ready to run"}</Pill>
            {(preflight.surfaces ?? []).map((surface, index) => (
              <p key={`${surface.target ?? "surface"}-${index}`}>
                <b>{surface.target ? TARGET_LABEL[surface.target] : "Required surface"}:</b> {surface.ready ? "ready" : surface.reason ?? surface.status ?? "not ready"}{surface.action ? ` — ${surface.action}` : ""}
              </p>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Version history" sub="Each saved version remains readable so a run keeps the definition it started with.">
        {workflowId === "new" ? <p>This draft has not been saved yet.</p> : !versions ? <SkeletonPanel rows={3} /> : versions.length === 0 ? <p>No saved versions were returned.</p> : (
          <ol className="ops-list">
            {versions.map((version) => <li key={`${version.id}-${version.version}`}><b>Version {version.version}</b> — {version.status} — {version.steps.length} steps</li>)}
          </ol>
        )}
      </Panel>
    </section>
  );
}
