"use client";

/**
 * Workflows — the operational management surface for the workflow library.
 *
 * Deliberately not the builder: this is where an operator browses, searches, compares versions,
 * checks success rates, sees which execution method each step uses, and decides what to look at.
 * Authoring lives in Workflow Studio.
 */

import { useEffect, useMemo, useState } from "react";
import type { WorkflowDefinition, WorkflowStep } from "@amazflow/workflow-schema";
import { Icon, STEP_ICON } from "../icons";
import { useOps, workflowUpdatedAt } from "../data";
import { useDetailCrumb, useNav } from "../nav";
import { PageHead } from "../shell";
import {
  Alert,
  Btn,
  CellStack,
  CodeBlock,
  DataTable,
  Drawer,
  EmptyState,
  IdChip,
  KeyValue,
  Legend,
  Metrics,
  Panel,
  Pill,
  ResultCount,
  SavedViews,
  SearchInput,
  Select,
  Sparkline,
  StackBar,
  Tabs,
  TechnicalDetail,
  Toolbar,
  ToolbarSpacer,
  type Column,
  type KVRow,
  type TabSpec,
  Chevron,
} from "../primitives";
import {
  AI_OPERATION_LABEL,
  DATA_CLASS_LABEL,
  RESTRICTED_DATA_CLASSES,
  ROLE_SHORT,
  STEP_TYPE_LABEL,
  WORKFLOW_STATUS_LABEL,
  WORKFLOW_STATUS_TONE,
  absoluteTime,
  percent,
  relativeTime,
  runStatus,
  shortDuration,
  toolLabel,
} from "../terms";
import { executionMethod, runDuration } from "../run-model";
import { runsByDay } from "../data";

/* ================================================================================ list view = */

export function WorkflowsView() {
  const ops = useOps();
  const nav = useNav();

  const [search, setSearch] = useState("");
  const [statusView, setStatusView] = useState("all");
  const [orgFilter, setOrgFilter] = useState("all");

  const counts = useMemo(
    () => ({
      all: ops.workflows.length,
      active: ops.workflows.filter((workflow) => workflow.status === "active").length,
      draft: ops.workflows.filter((workflow) => workflow.status === "draft").length,
      paused: ops.workflows.filter((workflow) => workflow.status === "paused").length,
      failing: ops.workflows.filter((workflow) => {
        const stats = ops.statsForWorkflow(workflow.id);
        return stats.failed > 0;
      }).length,
    }),
    [ops],
  );

  const filtered = useMemo(() => {
    let list = ops.workflows;
    if (statusView === "failing") {
      list = list.filter((workflow) => ops.statsForWorkflow(workflow.id).failed > 0);
    } else if (statusView !== "all") {
      list = list.filter((workflow) => workflow.status === statusView);
    }
    if (orgFilter !== "all") list = list.filter((workflow) => workflow.tenantId === orgFilter);
    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (workflow) =>
          workflow.name.toLowerCase().includes(needle) ||
          (workflow.description ?? "").toLowerCase().includes(needle) ||
          workflow.id.toLowerCase().includes(needle) ||
          ops.orgLabel(workflow.tenantId).toLowerCase().includes(needle),
      );
    }
    return list;
  }, [ops, statusView, orgFilter, search]);

  const columns: Column<WorkflowDefinition>[] = [
    {
      key: "status",
      header: "Status",
      width: 108,
      nowrap: true,
      sort: (a, b) => a.status.localeCompare(b.status),
      render: (workflow) => (
        <Pill tone={WORKFLOW_STATUS_TONE[workflow.status] ?? "neutral"}>
          {WORKFLOW_STATUS_LABEL[workflow.status] ?? workflow.status}
        </Pill>
      ),
    },
    {
      key: "name",
      header: "Workflow",
      primary: true,
      sort: (a, b) => a.name.localeCompare(b.name),
      render: (workflow) => (
        <CellStack
          top={workflow.name}
          bottom={workflow.description || `${workflow.steps.length} steps`}
        />
      ),
    },
    {
      key: "org",
      header: "Organization",
      sort: (a, b) => ops.orgLabel(a.tenantId).localeCompare(ops.orgLabel(b.tenantId)),
      render: (workflow) => ops.orgLabel(workflow.tenantId),
    },
    {
      key: "version",
      header: "Version",
      align: "right",
      width: 78,
      nowrap: true,
      sort: (a, b) => a.version - b.version,
      render: (workflow) => <span className="ops-cell-num">v{workflow.version}</span>,
    },
    {
      key: "steps",
      header: "Steps",
      align: "right",
      width: 66,
      sort: (a, b) => a.steps.length - b.steps.length,
      render: (workflow) => <span className="ops-cell-num">{workflow.steps.length}</span>,
    },
    {
      key: "methods",
      header: "Execution",
      render: (workflow) => <MethodSummary workflow={workflow} />,
    },
    {
      key: "runs",
      header: "Runs",
      align: "right",
      width: 72,
      sort: (a, b) => ops.statsForWorkflow(a.id).total - ops.statsForWorkflow(b.id).total,
      render: (workflow) => (
        <span className="ops-cell-num">{ops.statsForWorkflow(workflow.id).total}</span>
      ),
    },
    {
      key: "success",
      header: "Success",
      align: "right",
      width: 92,
      nowrap: true,
      sort: (a, b) =>
        (ops.statsForWorkflow(a.id).successRate ?? -1) - (ops.statsForWorkflow(b.id).successRate ?? -1),
      render: (workflow) => {
        const stats = ops.statsForWorkflow(workflow.id);
        if (stats.successRate === null) return <span className="ops-muted">—</span>;
        const tone =
          stats.successRate >= 0.95 ? "good" : stats.successRate >= 0.8 ? "waiting" : "bad";
        return <span className={`ops-cell-num ops-tone-${tone}`}>{percent(stats.successRate)}</span>;
      },
    },
    {
      key: "last",
      header: "Last run",
      nowrap: true,
      width: 104,
      sort: (a, b) =>
        (ops.statsForWorkflow(a.id).lastRunAt ?? "").localeCompare(
          ops.statsForWorkflow(b.id).lastRunAt ?? "",
        ),
      render: (workflow) => {
        const stats = ops.statsForWorkflow(workflow.id);
        return stats.lastRunAt ? (
          <span title={absoluteTime(stats.lastRunAt)}>{relativeTime(stats.lastRunAt)}</span>
        ) : (
          <span className="ops-muted">never</span>
        );
      },
    },
    {
      key: "open",
      header: "",
      align: "right",
      width: 36,
      render: () => <Chevron />,
    },
  ];

  const totalRuns = ops.runs.length;
  const publishedShare = counts.all > 0 ? counts.active / counts.all : 0;

  return (
    <>
      <PageHead
        title="Workflows"
        sub="Every workflow definition in the platform, with how it is executed and how well it is doing."
        actions={
          <Btn variant="primary" glyph="plus" onClick={() => nav.go({ section: "studio", view: "new" })}>
            New workflow
          </Btn>
        }
      />

      <Metrics
        items={[
          {
            label: "Published",
            value: counts.active,
            tone: counts.active > 0 ? "good" : undefined,
            foot: `${percent(publishedShare)} of the library`,
            onClick: () => setStatusView("active"),
          },
          { label: "Drafts", value: counts.draft, foot: "Not runnable yet", onClick: () => setStatusView("draft") },
          {
            label: "Paused",
            value: counts.paused,
            tone: counts.paused > 0 ? "waiting" : undefined,
            onClick: () => setStatusView("paused"),
          },
          {
            label: "With failures",
            value: counts.failing,
            tone: counts.failing > 0 ? "bad" : "good",
            foot: "Have at least one run needing attention",
            onClick: () => setStatusView("failing"),
          },
          { label: "Total runs", value: totalRuns, foot: "All workflows, all time" },
        ]}
      />

      <div className="ops-section">
        <Toolbar>
          <SavedViews
            views={[
              { id: "all", label: "All", count: counts.all },
              { id: "active", label: "Published", count: counts.active },
              { id: "draft", label: "Drafts", count: counts.draft },
              { id: "paused", label: "Paused", count: counts.paused, tone: "waiting" },
              { id: "failing", label: "With failures", count: counts.failing, tone: "bad" },
            ]}
            active={statusView}
            onSelect={setStatusView}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Search workflows…" />
          {ops.allTenantIds.length > 1 && (
            <Select
              label="Organization"
              value={orgFilter}
              onChange={setOrgFilter}
              options={[
                { value: "all", label: "All organizations" },
                ...ops.allTenantIds.map((tenantId) => ({
                  value: tenantId,
                  label: ops.orgLabel(tenantId),
                })),
              ]}
            />
          )}
          <ToolbarSpacer />
          <ResultCount shown={filtered.length} total={ops.workflows.length} noun="workflow" />
        </Toolbar>

        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(workflow) => workflow.id}
          onRowClick={(workflow) => nav.openWorkflow(workflow.id)}
          loading={ops.loading && ops.workflows.length === 0}
          defaultSort={{ key: "last", dir: "desc" }}
          emptyState={
            <EmptyState
              glyph="workflows"
              title={ops.workflows.length === 0 ? "No workflows yet" : "No workflows match"}
              body={
                ops.workflows.length === 0
                  ? "Create one in Workflow Studio, or describe an SOP in plain English and let AmazFlow draft it."
                  : "Try clearing the search or switching views."
              }
              actions={
                ops.workflows.length === 0 ? (
                  <Btn variant="primary" onClick={() => nav.go({ section: "studio", view: "sop" })}>
                    Draft from an SOP
                  </Btn>
                ) : undefined
              }
            />
          }
        />
      </div>
    </>
  );
}

/** Compact summary of the distinct execution methods a workflow uses. */
function MethodSummary({ workflow }: { workflow: WorkflowDefinition }) {
  const methods = useMemo(() => {
    const set = new Set<string>();
    for (const step of workflow.steps) {
      if (step.type === "action") set.add(toolLabel(step.provider, step.browserMode));
      else if (step.type === "ai") set.add("AmazFlow Executor");
      else if (step.type === "approval") set.add("Human approval");
    }
    return [...set];
  }, [workflow]);

  if (methods.length === 0) return <span className="ops-muted">—</span>;
  return (
    <span className="ops-row ops-gap-sm ops-row-wrap">
      {methods.slice(0, 2).map((method) => (
        <Pill key={method} tone="muted">
          {method}
        </Pill>
      ))}
      {methods.length > 2 && <span className="ops-small ops-muted">+{methods.length - 2}</span>}
    </span>
  );
}

/* ============================================================================== detail view = */

export function WorkflowDetailView({ workflowId }: { workflowId: string }) {
  const ops = useOps();
  const nav = useNav();
  const workflow = ops.workflowById(workflowId);
  useDetailCrumb(workflow?.name ?? workflowId);

  const [tab, setTab] = useState(nav.view.tab ?? "steps");
  const [openStep, setOpenStep] = useState<WorkflowStep | null>(null);

  const versionSlot = ops.versions[workflowId];
  useEffect(() => {
    if (tab === "versions") ops.loadVersions(workflowId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, workflowId]);

  if (!workflow) {
    return (
      <EmptyState
        glyph="workflows"
        title="That workflow isn't in the library"
        body="It may have been created in another environment."
        actions={<Btn onClick={() => nav.goSection("workflows")}>Back to workflows</Btn>}
      />
    );
  }

  const stats = ops.statsForWorkflow(workflowId);
  const runs = ops.runsForWorkflow(workflowId);
  const org = ops.orgByTenant(workflow.tenantId);
  const restricted = RESTRICTED_DATA_CLASSES.includes(workflow.dataClass);

  const tabs: TabSpec[] = [
    { id: "steps", label: "Steps", count: workflow.steps.length },
    { id: "runs", label: "Runs", count: runs.length },
    { id: "versions", label: "Versions" },
    { id: "access", label: "Access" },
    { id: "technical", label: "Definition" },
  ];

  const day = runsByDay(runs, 14);

  return (
    <>
      <PageHead
        title={workflow.name}
        pills={
          <>
            <Pill tone={WORKFLOW_STATUS_TONE[workflow.status] ?? "neutral"}>
              {WORKFLOW_STATUS_LABEL[workflow.status] ?? workflow.status}
            </Pill>
            <Pill tone="muted">v{workflow.version}</Pill>
            <Pill tone={restricted ? "bad" : "muted"}>
              {DATA_CLASS_LABEL[workflow.dataClass] ?? workflow.dataClass}
            </Pill>
          </>
        }
        sub={workflow.description || "No description set."}
        actions={
          <>
            {org && (
              <Btn onClick={() => nav.openOrg(org.slug)}>
                {org.branding?.displayName || org.name}
              </Btn>
            )}
            <Btn variant="primary" onClick={() => nav.go({ section: "studio", entityId: workflow.id })}>
              Open in Studio
            </Btn>
          </>
        }
      />

      {restricted && (
        <Alert tone="bad" title="Data class is outside the current production boundary">
          This workflow is classified {DATA_CLASS_LABEL[workflow.dataClass]}. The platform boundary
          permits non-regulated operational data only until the matching compliance controls are
          enabled.
        </Alert>
      )}

      <div style={{ marginTop: restricted ? 12 : 0 }}>
        <Metrics
          items={[
            { label: "Runs", value: stats.total, foot: `${stats.live} in flight` },
            {
              label: "Success rate",
              value: stats.successRate === null ? "—" : percent(stats.successRate),
              tone:
                stats.successRate === null
                  ? undefined
                  : stats.successRate >= 0.95
                    ? "good"
                    : stats.successRate >= 0.8
                      ? "waiting"
                      : "bad",
              foot: `${stats.completed} completed · ${stats.failed} needing attention`,
            },
            {
              label: "Typical duration",
              value: stats.medianDurationMs === null ? "—" : shortDuration(stats.medianDurationMs),
              foot: "Median of completed runs",
            },
            {
              label: "Last run",
              value: stats.lastRunAt ? relativeTime(stats.lastRunAt) : "never",
              foot: stats.lastRunAt ? absoluteTime(stats.lastRunAt) : "Not started yet",
            },
            {
              label: "Manual estimate",
              value: workflow.manualMinutesEstimate ?? "—",
              unit: workflow.manualMinutesEstimate ? "min" : undefined,
              foot: "Per run, if done by hand",
            },
          ]}
        />
      </div>

      {runs.length > 0 && (
        <div className="ops-section">
          <Panel title="Outcome mix" sub={`${runs.length} runs`}>
            <StackBar
              segments={[
                { tone: "good", value: stats.completed, label: "Completed" },
                { tone: "bad", value: stats.failed, label: "Needing attention" },
                { tone: "waiting", value: stats.live, label: "In flight" },
                {
                  tone: "muted",
                  value: runs.filter((run) => run.status === "CANCELLED").length,
                  label: "Cancelled",
                },
              ]}
            />
            <div style={{ marginTop: 10 }}>
              <Legend
                items={[
                  { tone: "good", label: "Completed", value: stats.completed },
                  { tone: "bad", label: "Needing attention", value: stats.failed },
                  { tone: "waiting", label: "In flight", value: stats.live },
                  {
                    tone: "muted",
                    label: "Cancelled",
                    value: runs.filter((run) => run.status === "CANCELLED").length,
                  },
                ]}
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <span className="ops-small ops-muted">Volume, last 14 days</span>
              <Sparkline values={day.map((bucket) => bucket.total)} tone="running" />
            </div>
          </Panel>
        </div>
      )}

      <div className="ops-section">
        <Tabs tabs={tabs} active={tab} onSelect={setTab} />
        <div className="ops-tabpanel">
          {tab === "steps" && <StepsTab workflow={workflow} onOpenStep={setOpenStep} />}
          {tab === "runs" && <WorkflowRunsTab workflowId={workflowId} />}
          {tab === "versions" && (
            <VersionsTab workflow={workflow} slot={versionSlot} onReload={() => ops.loadVersions(workflowId)} />
          )}
          {tab === "access" && <AccessTab workflow={workflow} />}
          {tab === "technical" && (
            <Panel title="Workflow definition">
              <CodeBlock value={workflow} />
            </Panel>
          )}
        </div>
      </div>

      {openStep && <StepDrawer step={openStep} workflow={workflow} onClose={() => setOpenStep(null)} />}
    </>
  );
}

/* ----------------------------------------------------------------------------- steps tab --- */

function StepsTab({
  workflow,
  onOpenStep,
}: {
  workflow: WorkflowDefinition;
  onOpenStep: (step: WorkflowStep) => void;
}) {
  const ops = useOps();

  const columns: Column<WorkflowStep>[] = [
    {
      key: "type",
      header: "Type",
      width: 122,
      nowrap: true,
      render: (step) => (
        <span className="ops-row ops-gap-sm">
          <span className="ops-muted"><Icon name={STEP_ICON[step.type] ?? "action"} size={13} /></span>
          {STEP_TYPE_LABEL[step.type] ?? step.type}
        </span>
      ),
    },
    {
      key: "name",
      header: "Step",
      primary: true,
      render: (step) => <CellStack top={step.name} bottom={step.id} />,
    },
    {
      key: "method",
      header: "Executed by",
      render: (step) => executionMethod(step),
    },
    {
      key: "detail",
      header: "Does",
      render: (step) => <span className="ops-truncate">{stepSummary(step)}</span>,
    },
    {
      key: "gate",
      header: "Gate",
      width: 132,
      render: (step) => {
        if (step.type === "approval") return <Pill tone="waiting">Human approval</Pill>;
        if (step.type === "action" && step.requiresConfirmation) {
          return <Pill tone="waiting">Confirm first</Pill>;
        }
        if (step.type === "action" && step.verify) return <Pill tone="good">Verified</Pill>;
        return <span className="ops-muted">—</span>;
      },
    },
    {
      key: "connection",
      header: "Connection",
      render: (step) => {
        if (step.type !== "action" || step.provider !== "browser") {
          return <span className="ops-muted">—</span>;
        }
        if (step.connectionId) {
          const connection = ops.connections.find((candidate) => candidate.id === step.connectionId);
          return connection ? connection.name : <span className="ops-muted">missing</span>;
        }
        return <span className="ops-muted">resolved at run time</span>;
      },
    },
    {
      key: "open",
      header: "",
      align: "right",
      width: 36,
      render: () => <Chevron />,
    },
  ];

  return (
    <>
      <Panel title="Flow" sub={`Starts at ${workflow.startAt}`}>
        <div className="ops-steps">
          {workflow.steps.map((step) => (
            <button
              className="ops-step"
              key={step.id}
              data-state={step.id === workflow.startAt ? "current" : "done"}
              onClick={() => onOpenStep(step)}
            >
              <span className="ops-step-top">
                <span className="ops-step-glyph"><Icon name={STEP_ICON[step.type] ?? "action"} size={12} /></span>
                <span className="ops-step-type">{STEP_TYPE_LABEL[step.type] ?? step.type}</span>
              </span>
              <span className="ops-step-name">{step.name}</span>
              <span className="ops-step-meta">{executionMethod(step)}</span>
            </button>
          ))}
        </div>
      </Panel>

      <div style={{ marginTop: 12 }}>
        <DataTable
          rows={workflow.steps}
          columns={columns}
          rowKey={(step) => step.id}
          onRowClick={onOpenStep}
        />
      </div>
    </>
  );
}

function stepSummary(step: WorkflowStep): string {
  switch (step.type) {
    case "ai":
      return `${AI_OPERATION_LABEL[step.operation] ?? step.operation} into "${step.outputKey}", at least ${Math.round((step.confidenceThreshold ?? 0.85) * 100)}% confidence`;
    case "action":
      return `${step.operation || "operation not set"}`;
    case "condition":
      return `${step.path} ${step.operator} ${JSON.stringify(step.value ?? "")}`;
    case "approval":
      return step.message || "Approval required";
    case "verify":
      return `${step.path} ${step.operator} ${JSON.stringify(step.value ?? "")}`;
    case "end":
      return `Ends as ${step.outcome}`;
    default:
      return "";
  }
}

function StepDrawer({
  step,
  workflow,
  onClose,
}: {
  step: WorkflowStep;
  workflow: WorkflowDefinition;
  onClose: () => void;
}) {
  const ops = useOps();
  const rows: KVRow[] = [
    { label: "Type", value: STEP_TYPE_LABEL[step.type] ?? step.type },
    { label: "Executed by", value: executionMethod(step) },
    { label: "Step id", value: <IdChip value={step.id} /> },
  ];

  if (step.type === "ai") {
    rows.push(
      { label: "Operation", value: AI_OPERATION_LABEL[step.operation] ?? step.operation },
      { label: "Writes to", value: <code>{step.outputKey}</code> },
      { label: "Confidence floor", value: percent(step.confidenceThreshold ?? 0.85) },
      {
        label: "Allowed values",
        value: step.allowedValues?.length ? step.allowedValues.join(", ") : <span className="ops-muted">unconstrained</span>,
      },
      { label: "Prompt", value: <CodeBlock value={step.prompt} /> },
    );
  } else if (step.type === "action") {
    const connection = step.connectionId
      ? ops.connections.find((candidate) => candidate.id === step.connectionId)
      : undefined;
    rows.push(
      { label: "Operation", value: <code>{step.operation}</code> },
      { label: "Tool", value: toolLabel(step.provider, step.browserMode) },
      {
        label: "Connection",
        value: connection ? connection.name : <span className="ops-muted">resolved at run time</span>,
      },
      {
        label: "Confirmation",
        value: step.requiresConfirmation ? (
          <Pill tone="waiting">Required before acting</Pill>
        ) : (
          <span className="ops-muted">not required</span>
        ),
      },
      {
        label: "Verification",
        value: step.verify ? (
          <code>
            {step.verify.path} equals {JSON.stringify(step.verify.equals)}
          </code>
        ) : (
          <span className="ops-muted">none configured</span>
        ),
      },
      { label: "Input", value: <CodeBlock value={step.input} /> },
    );
  } else if (step.type === "approval") {
    rows.push(
      { label: "Message", value: step.message },
      { label: "Roles that can decide", value: step.roles.map((role) => ROLE_SHORT[role] ?? role).join(", ") },
    );
  } else if (step.type === "condition" || step.type === "verify") {
    rows.push(
      { label: "Path", value: <code>{step.path}</code> },
      { label: "Operator", value: step.operator },
      { label: "Compared to", value: <code>{JSON.stringify(step.value ?? null)}</code> },
    );
  } else if (step.type === "end") {
    rows.push({ label: "Outcome", value: step.outcome });
  }

  if (step.retry?.maxAttempts) {
    rows.push({
      label: "Retry policy",
      value: (
        <span className="ops-row ops-gap-sm">
          max {step.retry.maxAttempts} attempts
          <Pill tone="waiting">not enforced yet</Pill>
        </span>
      ),
    });
  }

  const runsTouching = ops
    .runsForWorkflow(workflow.id)
    .filter((run) => Boolean(run.stepResults?.[step.id]) || run.currentStepId === step.id);
  const failuresHere = runsTouching.filter((run) => run.stepResults?.[step.id]?.status === "FAILED");

  return (
    <Drawer
      title={
        <>
          <span className="ops-muted"><Icon name={STEP_ICON[step.type] ?? "action"} size={13} /></span>
          <span>{step.name}</span>
        </>
      }
      sub={<>{STEP_TYPE_LABEL[step.type]} · {executionMethod(step)}</>}
      onClose={onClose}
    >
      <Panel title="Configuration">
        <KeyValue rows={rows} />
      </Panel>

      <div style={{ marginTop: 12 }}>
        <Panel title="How this step is doing">
          <KeyValue
            rows={[
              { label: "Runs that reached it", value: runsTouching.length },
              {
                label: "Failures here",
                value:
                  failuresHere.length > 0 ? (
                    <span className="ops-tone-bad ops-strong">{failuresHere.length}</span>
                  ) : (
                    0
                  ),
              },
            ]}
          />
        </Panel>
      </div>

      <div style={{ marginTop: 12 }}>
        <TechnicalDetail label="Raw step definition">
          <CodeBlock value={step} />
        </TechnicalDetail>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------------------ runs tab --- */

function WorkflowRunsTab({ workflowId }: { workflowId: string }) {
  const ops = useOps();
  const nav = useNav();
  const runs = useMemo(
    () => ops.runsForWorkflow(workflowId).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [ops, workflowId],
  );

  return (
    <DataTable
      rows={runs}
      columns={[
        {
          key: "status",
          header: "Status",
          width: 170,
          nowrap: true,
          render: (run) => {
            const status = runStatus(run.status);
            return (
              <Pill tone={status.tone} dot>
                {status.label}
              </Pill>
            );
          },
        },
        {
          key: "org",
          header: "Organization",
          primary: true,
          render: (run) => ops.orgLabel(run.tenantId),
        },
        { key: "version", header: "Version", width: 78, render: (run) => `v${run.workflowVersion}` },
        {
          key: "started",
          header: "Started",
          nowrap: true,
          width: 120,
          sort: (a, b) => a.createdAt.localeCompare(b.createdAt),
          render: (run) => (
            <span title={absoluteTime(run.createdAt)}>{relativeTime(run.createdAt)}</span>
          ),
        },
        {
          key: "duration",
          header: "Duration",
          align: "right",
          width: 92,
          nowrap: true,
          render: (run) => <span className="ops-cell-num">{shortDuration(runDuration(run))}</span>,
        },
        { key: "open", header: "", align: "right", width: 36, render: () => <Chevron /> },
      ]}
      rowKey={(run) => run.id}
      onRowClick={(run) => nav.openRun(run.id)}
      rowTone={(run) => (run.status === "FAILED" || run.status === "TIMED_OUT" ? "bad" : undefined)}
      defaultSort={{ key: "started", dir: "desc" }}
      emptyState={
        <EmptyState glyph="runs" title="No runs yet" body="This workflow hasn't been started." inline />
      }
    />
  );
}

/* -------------------------------------------------------------------------- versions tab --- */

function VersionsTab({
  workflow,
  slot,
  onReload,
}: {
  workflow: WorkflowDefinition;
  slot?: { state: string; data?: WorkflowDefinition[]; error?: string };
  onReload: () => void;
}) {
  const ops = useOps();
  const [compare, setCompare] = useState<WorkflowDefinition | null>(null);

  if (!slot || slot.state === "loading") {
    return <Panel title="Version history">Loading versions…</Panel>;
  }
  if (slot.state === "error") {
    return (
      <Alert tone="bad" title="Couldn't load version history" actions={<Btn size="sm" onClick={onReload}>Retry</Btn>}>
        {slot.error}
      </Alert>
    );
  }

  const versions = (slot.data ?? []).slice().sort((a, b) => b.version - a.version);
  const runsByVersion = new Map<number, number>();
  for (const run of ops.runsForWorkflow(workflow.id)) {
    runsByVersion.set(run.workflowVersion, (runsByVersion.get(run.workflowVersion) ?? 0) + 1);
  }

  return (
    <>
      <DataTable
        rows={versions}
        columns={[
          {
            key: "version",
            header: "Version",
            width: 96,
            primary: true,
            render: (version) => (
              <span className="ops-row ops-gap-sm">
                v{version.version}
                {version.version === workflow.version && <Pill tone="good">Current</Pill>}
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            width: 108,
            render: (version) => (
              <Pill tone={WORKFLOW_STATUS_TONE[version.status] ?? "neutral"}>
                {WORKFLOW_STATUS_LABEL[version.status] ?? version.status}
              </Pill>
            ),
          },
          { key: "name", header: "Name", render: (version) => version.name },
          {
            key: "steps",
            header: "Steps",
            align: "right",
            width: 70,
            render: (version) => <span className="ops-cell-num">{version.steps.length}</span>,
          },
          {
            key: "runs",
            header: "Runs on it",
            align: "right",
            width: 92,
            render: (version) => (
              <span className="ops-cell-num">{runsByVersion.get(version.version) ?? 0}</span>
            ),
          },
          {
            key: "updated",
            header: "Saved",
            nowrap: true,
            width: 128,
            render: (version) => {
              const savedAt = workflowUpdatedAt(version);
              return savedAt ? (
                <span title={absoluteTime(savedAt)}>{relativeTime(savedAt)}</span>
              ) : (
                <span className="ops-muted">—</span>
              );
            },
          },
          {
            key: "open",
            header: "",
            align: "right",
            width: 36,
            render: () => <Chevron />,
          },
        ]}
        rowKey={(version) => `v${version.version}`}
        onRowClick={setCompare}
        defaultSort={{ key: "version", dir: "desc" }}
        emptyState={
          <EmptyState
            glyph="workflows"
            title="Only one version recorded"
            body="A new pinned version is written each time the workflow is saved."
            inline
          />
        }
      />

      {compare && (
        <Drawer
          title={`v${compare.version} — ${compare.name}`}
          sub={
            <>
              {WORKFLOW_STATUS_LABEL[compare.status] ?? compare.status} ·{" "}
              {compare.steps.length} steps
              {workflowUpdatedAt(compare) && <> · saved {absoluteTime(workflowUpdatedAt(compare))}</>}
            </>
          }
          onClose={() => setCompare(null)}
        >
          <VersionDiff current={workflow} other={compare} />
          <div style={{ marginTop: 12 }}>
            <TechnicalDetail label="Full definition for this version">
              <CodeBlock value={compare} />
            </TechnicalDetail>
          </div>
        </Drawer>
      )}
    </>
  );
}

/** Structural diff between the current definition and a historical version. */
function VersionDiff({ current, other }: { current: WorkflowDefinition; other: WorkflowDefinition }) {
  if (other.version === current.version) {
    return (
      <Alert tone="good" title="This is the current version">
        Nothing to compare.
      </Alert>
    );
  }

  const changes: string[] = [];
  if (current.name !== other.name) changes.push(`Renamed from "${other.name}" to "${current.name}"`);
  if (current.status !== other.status) changes.push(`Status changed from ${other.status} to ${current.status}`);
  if (JSON.stringify(current.assignedRoles) !== JSON.stringify(other.assignedRoles)) {
    changes.push(
      `Access changed from ${other.assignedRoles.join(", ")} to ${current.assignedRoles.join(", ")}`,
    );
  }
  if (current.dataClass !== other.dataClass) {
    changes.push(`Data class changed from ${other.dataClass} to ${current.dataClass}`);
  }

  const otherSteps = new Map(other.steps.map((step) => [step.id, step]));
  const currentIds = new Set(current.steps.map((step) => step.id));
  for (const step of current.steps) {
    const previous = otherSteps.get(step.id);
    if (!previous) changes.push(`Added step "${step.name}" (${step.type})`);
    else if (JSON.stringify(previous) !== JSON.stringify(step)) {
      changes.push(`Changed step "${step.name}"`);
    }
  }
  for (const step of other.steps) {
    if (!currentIds.has(step.id)) changes.push(`Removed step "${step.name}"`);
  }

  return (
    <Panel title={`What changed between v${other.version} and v${current.version}`}>
      {changes.length === 0 ? (
        <p className="ops-small ops-muted">
          No structural differences — the version was bumped without changing the definition.
        </p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }}>
          {changes.map((change, index) => (
            <li key={index}>{change}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------------------- access tab --- */

function AccessTab({ workflow }: { workflow: WorkflowDefinition }) {
  return (
    <div className="ops-col">
      <Panel title="Who can run this">
        <KeyValue
          rows={[
            {
              label: "Assigned roles",
              value: (
                <span className="ops-row ops-gap-sm ops-row-wrap">
                  {workflow.assignedRoles.map((role) => (
                    <Pill key={role} tone="muted">
                      {ROLE_SHORT[role] ?? role}
                    </Pill>
                  ))}
                </span>
              ),
            },
            {
              label: "Status gate",
              value:
                workflow.status === "active" ? (
                  <span>Published — customers can start it</span>
                ) : (
                  <span className="ops-tone-waiting">
                    {WORKFLOW_STATUS_LABEL[workflow.status]} — the control plane rejects new runs
                  </span>
                ),
            },
          ]}
        />
      </Panel>

      <Panel title="What this workflow is allowed to use">
        <KeyValue
          rows={[
            {
              label: "Allowed providers",
              value: (
                <span className="ops-row ops-gap-sm ops-row-wrap">
                  {workflow.allowedProviders.map((provider) => (
                    <Pill key={provider} tone="muted">
                      {toolLabel(provider)}
                    </Pill>
                  ))}
                </span>
              ),
            },
            { label: "Data class", value: DATA_CLASS_LABEL[workflow.dataClass] ?? workflow.dataClass },
            {
              label: "Customer-facing summary",
              value: workflow.customerSummary || <span className="ops-muted">not set</span>,
            },
          ]}
        />
        <div style={{ marginTop: 10 }}>
          <p className="ops-small ops-muted">
            A workflow can only ever use the providers on this list. Every action also runs under a
            single-use execution grant scoped to one step and one tool.
          </p>
        </div>
      </Panel>
    </div>
  );
}
