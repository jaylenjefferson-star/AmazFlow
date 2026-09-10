"use client";

/**
 * Runs — the operational spine of the console.
 *
 * A dense, sortable, filterable table over every run in the platform with saved views for the
 * queues an operator actually works: what's in flight, what's blocked on a human, what needs
 * attention. Also backs the Approvals and Needs-attention sections, which are the same table
 * pinned to a queue.
 */

import { useMemo, useState } from "react";
import type { WorkflowRun } from "@amazflow/workflow-schema";
import { runsByDay, useOps, waitingFor } from "../data";
import { useNav } from "../nav";
import { PageHead } from "../shell";
import {
  Btn,
  CellStack,
  DataTable,
  EmptyState,
  IdChip,
  Metrics,
  Pill,
  ResultCount,
  SavedViews,
  SearchInput,
  Select,
  Toolbar,
  ToolbarSpacer,
  type Column,
  type SavedView,
  Chevron,
} from "../primitives";
import {
  EXCEPTION_STATUSES,
  RUN_STATUS_LABEL,
  executorLabel,
  isException,
  isLive,
  percent,
  relativeTime,
  runStatus,
  shortDuration,
  shortId,
} from "../terms";
import { runDuration } from "../run-model";
import { useOpsActions } from "../actions";

type Mode = "runs" | "approvals" | "exceptions";

const VIEW_FILTERS: Record<string, (run: WorkflowRun) => boolean> = {
  all: () => true,
  live: (run) => isLive(run.status),
  approval: (run) => run.status === "WAITING_APPROVAL",
  confirmation: (run) => run.status === "AWAITING_CONFIRMATION",
  browser: (run) => run.status === "WAITING_AGENT",
  attention: (run) => isException(run.status),
  completed: (run) => run.status === "COMPLETED",
  cancelled: (run) => run.status === "CANCELLED",
};

function isToday(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function RunsView({ mode }: { mode: Mode }) {
  const ops = useOps();
  const nav = useNav();
  const actions = useOpsActions();

  const initialView =
    mode === "approvals" ? "approval" : mode === "exceptions" ? "attention" : (nav.view.view ?? "all");
  const [activeView, setActiveView] = useState(initialView);
  const [search, setSearch] = useState("");
  const [orgFilter, setOrgFilter] = useState("all");
  const [workflowFilter, setWorkflowFilter] = useState("all");
  const [range, setRange] = useState("all");

  // Approvals and Needs-attention are the same table locked to a queue, so the saved-view
  // switcher only appears in the general Runs section.
  const locked = mode !== "runs";
  const effectiveView = locked ? initialView : activeView;

  const counts = useMemo(
    () => ({
      all: ops.runs.length,
      live: ops.liveRuns.length,
      approval: ops.approvals.length,
      confirmation: ops.confirmations.length,
      browser: ops.runs.filter((run) => run.status === "WAITING_AGENT").length,
      attention: ops.exceptions.length,
      completed: ops.runs.filter((run) => run.status === "COMPLETED").length,
      cancelled: ops.runs.filter((run) => run.status === "CANCELLED").length,
    }),
    [ops.runs, ops.liveRuns, ops.approvals, ops.confirmations, ops.exceptions],
  );

  const views: SavedView[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "live", label: "In flight", count: counts.live },
    { id: "approval", label: "Approval", count: counts.approval, tone: "waiting" },
    { id: "confirmation", label: "Confirmation", count: counts.confirmation, tone: "waiting" },
    { id: "browser", label: "Browser", count: counts.browser, tone: "waiting" },
    { id: "attention", label: "Needs attention", count: counts.attention, tone: "bad" },
    { id: "completed", label: "Completed", count: counts.completed },
    { id: "cancelled", label: "Cancelled", count: counts.cancelled },
  ];

  const filtered = useMemo(() => {
    const predicate = VIEW_FILTERS[effectiveView] ?? VIEW_FILTERS.all;
    let list = ops.runs.filter(predicate);

    if (orgFilter !== "all") list = list.filter((run) => run.tenantId === orgFilter);
    if (workflowFilter !== "all") list = list.filter((run) => run.workflowId === workflowFilter);

    if (range === "today") list = list.filter((run) => isToday(run.createdAt));
    else if (range === "7d") {
      const cutoff = Date.now() - 7 * 86_400_000;
      list = list.filter((run) => new Date(run.createdAt).getTime() >= cutoff);
    } else if (range === "30d") {
      const cutoff = Date.now() - 30 * 86_400_000;
      list = list.filter((run) => new Date(run.createdAt).getTime() >= cutoff);
    }

    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter((run) => {
        const workflow = ops.workflowById(run.workflowId);
        return (
          run.id.toLowerCase().includes(needle) ||
          run.workflowId.toLowerCase().includes(needle) ||
          run.tenantId.toLowerCase().includes(needle) ||
          (workflow?.name ?? "").toLowerCase().includes(needle) ||
          ops.orgLabel(run.tenantId).toLowerCase().includes(needle)
        );
      });
    }

    return list;
  }, [ops, effectiveView, orgFilter, workflowFilter, range, search]);

  /* ------------------------------------------------------------------------- metrics --- */

  const metrics = useMemo(() => {
    const last7 = ops.runs.filter(
      (run) => new Date(run.createdAt).getTime() >= Date.now() - 7 * 86_400_000,
    );
    const decided = last7.filter((run) => run.status === "COMPLETED" || isException(run.status));
    const successRate =
      decided.length > 0
        ? decided.filter((run) => run.status === "COMPLETED").length / decided.length
        : null;
    const oldestWait = ops.runs
      .filter((run) => run.status === "WAITING_APPROVAL" || run.status === "AWAITING_CONFIRMATION")
      .reduce((oldest, run) => Math.max(oldest, waitingFor(run)), 0);

    return [
      {
        label: "In flight",
        value: counts.live,
        tone: counts.live > 0 ? ("running" as const) : undefined,
        foot: "Running or blocked",
        onClick: () => setActiveView("live"),
      },
      {
        label: "Blocked on a human",
        value: counts.approval + counts.confirmation,
        tone: counts.approval + counts.confirmation > 0 ? ("waiting" as const) : undefined,
        foot: oldestWait > 0 ? `Oldest ${shortDuration(oldestWait)}` : "Nothing waiting",
        onClick: () => setActiveView("approval"),
      },
      {
        label: "Needs attention",
        value: counts.attention,
        tone: counts.attention > 0 ? ("bad" as const) : ("good" as const),
        foot: "Failed or timed out",
        onClick: () => setActiveView("attention"),
      },
      {
        label: "Runs today",
        value: ops.runs.filter((run) => isToday(run.createdAt)).length,
        foot: `${last7.length} in last 7 days`,
        onClick: () => {
          setActiveView("all");
          setRange("today");
        },
      },
      {
        label: "Success rate",
        value: successRate === null ? "—" : percent(successRate),
        tone:
          successRate === null
            ? undefined
            : successRate >= 0.95
              ? ("good" as const)
              : successRate >= 0.8
                ? ("waiting" as const)
                : ("bad" as const),
        foot: `Last 7 days · ${decided.length} decided`,
      },
    ];
  }, [ops.runs, counts]);

  /* -------------------------------------------------------------------------- columns --- */

  const columns: Column<WorkflowRun>[] = [
    {
      key: "status",
      header: "Status",
      width: 172,
      nowrap: true,
      sort: (a, b) => a.status.localeCompare(b.status),
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
      key: "workflow",
      header: "Workflow",
      primary: true,
      sort: (a, b) =>
        (ops.workflowById(a.workflowId)?.name ?? a.workflowId).localeCompare(
          ops.workflowById(b.workflowId)?.name ?? b.workflowId,
        ),
      render: (run) => {
        const workflow = ops.workflowById(run.workflowId);
        return (
          <CellStack
            top={workflow?.name ?? run.workflowId}
            bottom={`v${run.workflowVersion} · ${shortId(run.id)}`}
          />
        );
      },
    },
    {
      key: "org",
      header: "Organization",
      sort: (a, b) => ops.orgLabel(a.tenantId).localeCompare(ops.orgLabel(b.tenantId)),
      render: (run) => {
        const org = ops.orgByTenant(run.tenantId);
        return <CellStack top={ops.orgLabel(run.tenantId)} bottom={org ? org.plan.replace(/_/g, " ") : "no organization record"} />;
      },
    },
    {
      key: "step",
      header: "Current step",
      render: (run) => {
        if (!run.currentStepId) return <span className="ops-muted">—</span>;
        const workflow = ops.workflowById(run.workflowId);
        const step = workflow?.steps.find((candidate) => candidate.id === run.currentStepId);
        if (!step) return <span className="ops-muted">{run.currentStepId}</span>;
        return <CellStack top={step.name} bottom={executorFor(step.type)} />;
      },
    },
    {
      key: "started",
      header: "Started",
      nowrap: true,
      width: 116,
      sort: (a, b) => a.createdAt.localeCompare(b.createdAt),
      render: (run) => (
        <span title={new Date(run.createdAt).toLocaleString()}>{relativeTime(run.createdAt)}</span>
      ),
    },
    {
      key: "duration",
      header: "Duration",
      align: "right",
      nowrap: true,
      width: 96,
      sort: (a, b) => runDuration(a) - runDuration(b),
      render: (run) => (
        <span className="ops-cell-num">
          {shortDuration(runDuration(run))}
          {isLive(run.status) && <span className="ops-muted"> +</span>}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: 108,
      render: (run) => (
        <div className="ops-rowactions" onClick={(event) => event.stopPropagation()}>
          {run.status === "WAITING_APPROVAL" && (
            <Btn
              size="sm"
              variant="primary"
              disabled={actions.busy === `approve_${run.id}`}
              onClick={() => actions.approve(run)}
            >
              Approve
            </Btn>
          )}
          {run.status === "AWAITING_CONFIRMATION" && (
            <Btn
              size="sm"
              variant="primary"
              disabled={actions.busy === `confirm_${run.id}`}
              onClick={() => actions.confirm(run)}
            >
              Confirm
            </Btn>
          )}
          {isException(run.status) && (
            <Btn
              size="sm"
              disabled={actions.busy === `rerun_${run.id}`}
              onClick={() => actions.rerun(run)}
              title="Start a new run from the same input"
            >
              Re-run
            </Btn>
          )}
          <Chevron />
        </div>
      ),
    },
  ];

  const title =
    mode === "approvals" ? "Approvals" : mode === "exceptions" ? "Needs attention" : "Runs";
  const sub =
    mode === "approvals"
      ? "Runs holding for a human decision. Nothing reaches a customer system until one of these is decided."
      : mode === "exceptions"
        ? "Runs that failed, timed out, or could not confirm their outcome. AmazFlow stops rather than guessing."
        : "Every workflow run across all organizations, newest first.";

  const dayBuckets = useMemo(() => runsByDay(filtered, 14), [filtered]);

  return (
    <>
      <PageHead
        title={title}
        sub={sub}
        actions={
          <>
            <Btn glyph="refresh" onClick={() => ops.refreshRuns()}>
              Refresh
            </Btn>
          </>
        }
      />

      {mode === "runs" && (
        <>
          <Metrics items={metrics} />
          {filtered.length > 0 && (
            <div className="ops-panel" style={{ marginTop: 12 }}>
              <div className="ops-panel-body">
                <div className="ops-row" style={{ marginBottom: 8 }}>
                  <span className="ops-small ops-muted">Run volume, last 14 days</span>
                  <ToolbarSpacer />
                  <span className="ops-small ops-muted">
                    {dayBuckets.reduce((sum, bucket) => sum + bucket.total, 0)} runs
                  </span>
                </div>
                <div className="ops-bars">
                  {dayBuckets.map((bucket) => (
                    <span
                      className="ops-bar"
                      key={bucket.key}
                      data-tone={bucket.failed > 0 ? "bad" : bucket.total > 0 ? "good" : undefined}
                      title={`${bucket.label}: ${bucket.total} run${bucket.total === 1 ? "" : "s"}${bucket.failed ? `, ${bucket.failed} needing attention` : ""}`}
                      style={{
                        height: `${Math.max(
                          bucket.total === 0
                            ? 2
                            : (bucket.total / Math.max(...dayBuckets.map((entry) => entry.total), 1)) * 100,
                          2,
                        )}%`,
                      }}
                    />
                  ))}
                </div>
                <div className="ops-barchart-axis" style={{ marginTop: 6 }}>
                  <span>{dayBuckets[0]?.label}</span>
                  <span>{dayBuckets[dayBuckets.length - 1]?.label}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="ops-section">
        <Toolbar>
          {!locked && <SavedViews views={views} active={activeView} onSelect={setActiveView} />}
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search runs…"
          />
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
          {ops.workflows.length > 1 && (
            <Select
              label="Workflow"
              value={workflowFilter}
              onChange={setWorkflowFilter}
              options={[
                { value: "all", label: "All workflows" },
                ...ops.workflows.map((workflow) => ({ value: workflow.id, label: workflow.name })),
              ]}
            />
          )}
          <Select
            label="Time range"
            value={range}
            onChange={setRange}
            options={[
              { value: "all", label: "All time" },
              { value: "today", label: "Today" },
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
            ]}
          />
          <ToolbarSpacer />
          <ResultCount shown={filtered.length} total={ops.runs.length} noun="run" />
        </Toolbar>

        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(run) => run.id}
          onRowClick={(run) => nav.openRun(run.id)}
          rowTone={(run) => (isException(run.status) ? "bad" : undefined)}
          loading={ops.loading && ops.runs.length === 0}
          defaultSort={{ key: "started", dir: "desc" }}
          emptyState={
            <EmptyState
              glyph={mode === "exceptions" ? "check" : "runs"}
              title={
                mode === "approvals"
                  ? "Nothing is waiting on approval"
                  : mode === "exceptions"
                    ? "Nothing needs attention"
                    : ops.runs.length === 0
                      ? "No runs yet"
                      : "No runs match these filters"
              }
              body={
                mode === "exceptions"
                  ? "Every run either completed or is still in flight."
                  : ops.runs.length === 0
                    ? "Runs appear here as soon as a workflow is started, by a customer or from Workflow Studio."
                    : "Try widening the time range or clearing the search."
              }
              actions={
                ops.runs.length > 0 && filtered.length === 0 ? (
                  <Btn
                    onClick={() => {
                      setSearch("");
                      setOrgFilter("all");
                      setWorkflowFilter("all");
                      setRange("all");
                      if (!locked) setActiveView("all");
                    }}
                  >
                    Clear filters
                  </Btn>
                ) : undefined
              }
            />
          }
        />
      </div>

      {mode === "runs" && ops.runs.length > 0 && <StatusBreakdown />}
    </>
  );
}

function executorFor(stepType: string) {
  if (stepType === "ai") return executorLabel("agentcore");
  if (stepType === "approval") return "Human approval";
  if (stepType === "action") return "Tool call";
  if (stepType === "verify") return "Verification";
  return "Control plane";
}

/** A compact read on where every run in the platform currently sits. */
function StatusBreakdown() {
  const ops = useOps();
  const nav = useNav();

  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of ops.runs) counts.set(run.status, (counts.get(run.status) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ status, count }));
  }, [ops.runs]);

  return (
    <div className="ops-section">
      <div className="ops-panel">
        <header className="ops-panel-head">
          <h3>Where every run sits</h3>
          <span className="ops-panel-head-sub">{ops.runs.length} total</span>
        </header>
        <div className="ops-panel-body">
          <div className="ops-col ops-gap-sm">
            {rows.map((row) => {
              const status = runStatus(row.status);
              return (
                <button
                  key={row.status}
                  className="ops-row"
                  style={{ width: "100%" }}
                  onClick={() =>
                    nav.go({
                      section: EXCEPTION_STATUSES.includes(row.status) ? "exceptions" : "runs",
                    })
                  }
                >
                  <span style={{ width: 172, flexShrink: 0 }}>
                    <Pill tone={status.tone}>{RUN_STATUS_LABEL[row.status] ?? row.status}</Pill>
                  </span>
                  <span className="ops-spacer">
                    <span className="ops-meter-track">
                      <span
                        className="ops-meter-fill"
                        data-tone={status.tone === "good" ? "good" : status.tone === "bad" ? "bad" : status.tone === "waiting" ? "waiting" : undefined}
                        style={{ width: `${(row.count / ops.runs.length) * 100}%` }}
                      />
                    </span>
                  </span>
                  <span className="ops-num ops-strong" style={{ width: 44, textAlign: "right" }}>
                    {row.count}
                  </span>
                  <span className="ops-num ops-muted ops-small" style={{ width: 46, textAlign: "right" }}>
                    {percent(row.count / ops.runs.length)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
