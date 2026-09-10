"use client";

/**
 * Audit & security — the investigation surface.
 *
 * Two real sources are unified: configuration/administration activity from `GET /activity`, and
 * per-run audit events embedded in every run record. Every row reads as a sentence first, with
 * the raw payload one click away.
 *
 * Known limit, stated in the UI: the control plane writes durable per-run audit rows but exposes
 * no query route for them, and `/activity` is capped server-side. So this view searches what has
 * been loaded, not the entire historical archive.
 */

import { useMemo, useState } from "react";
import { useOps } from "../data";
import { useNav } from "../nav";
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
  Metrics,
  Panel,
  Pill,
  ResultCount,
  SavedViews,
  SearchInput,
  Select,
  TechnicalDetail,
  Toolbar,
  ToolbarSpacer,
  type Column,
  Chevron,
} from "../primitives";
import {
  AUDIT_CATEGORY_LABEL,
  absoluteTime,
  activityAction,
  auditEvent,
  relativeTime,
  type AuditCategory,
  type Tone,
} from "../terms";

type Row = {
  id: string;
  at: string;
  tenantId: string;
  source: "config" | "run";
  /** Raw backend code, only shown in the technical view. */
  code: string;
  label: string;
  category: AuditCategory | "config";
  tone: Tone;
  summary: string;
  actor?: string;
  actorLabel?: string;
  runId?: string;
  workflowId?: string;
  stepId?: string;
  details?: unknown;
  /** Success / failure / neutral, for the result filter. */
  result: "ok" | "fail" | "neutral";
};

const FAILURE_CODES = new Set([
  "ACTION_FAILED",
  "VERIFICATION_FAILED",
  "AGENT_RESULT_FAILED",
  "ACTION_RECONCILIATION_REQUIRED",
  "RUN_TIMED_OUT",
  "FAILED",
  "REJECTED",
  "AGENT_REVOKED",
  "BROWSER_CONNECTION_REVOKED",
]);

const SUCCESS_CODES = new Set([
  "ACTION_COMPLETED",
  "VERIFIED",
  "APPROVED",
  "CONFIRMATION_GRANTED",
  "COMPLETED",
  "AGENT_RESULT",
  "ORG_CREATED",
  "AGENT_CREATED",
  "BROWSER_CONNECTION_AUTHENTICATED",
]);

export function AuditView() {
  const ops = useOps();
  const nav = useNav();

  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const [orgFilter, setOrgFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [workflowFilter, setWorkflowFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [range, setRange] = useState("all");
  const [open, setOpen] = useState<Row | null>(null);

  /* ------------------------------------------------------------------------ unification --- */

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];

    for (const event of ops.activity) {
      const meta = activityAction(event.action);
      list.push({
        id: `cfg_${event.id}`,
        at: event.at,
        tenantId: event.tenantId,
        source: "config",
        code: event.action,
        label: meta.label,
        category: "config",
        tone: meta.tone,
        summary: event.summary,
        actor: event.actor,
        actorLabel: event.actorLabel,
        result: FAILURE_CODES.has(event.action) ? "fail" : SUCCESS_CODES.has(event.action) ? "ok" : "neutral",
      });
    }

    for (const run of ops.runs) {
      const workflow = ops.workflowById(run.workflowId);
      for (const event of run.audit) {
        const meta = auditEvent(event.type);
        const details = (event.details ?? {}) as Record<string, unknown>;
        list.push({
          id: `run_${run.id}_${event.id}`,
          at: event.at,
          tenantId: run.tenantId,
          source: "run",
          code: event.type,
          label: meta.label,
          category: meta.category,
          tone: meta.tone,
          summary: event.message,
          actor: typeof details.by === "string" ? details.by : (typeof details.actor === "string" ? details.actor : run.createdBy),
          actorLabel: workflow ? workflow.name : undefined,
          runId: run.id,
          workflowId: run.workflowId,
          stepId: event.stepId,
          details: event.details,
          result: FAILURE_CODES.has(event.type) ? "fail" : SUCCESS_CODES.has(event.type) ? "ok" : "neutral",
        });
      }
    }

    return list.sort((a, b) => b.at.localeCompare(a.at));
  }, [ops.activity, ops.runs, ops]);

  const actors = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) if (row.actor) set.add(row.actor);
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;

    if (view === "config") list = list.filter((row) => row.source === "config");
    else if (view === "run") list = list.filter((row) => row.source === "run");
    else if (view === "failures") list = list.filter((row) => row.result === "fail");
    else if (view === "access") {
      list = list.filter((row) =>
        [
          "TEAM_MEMBER_STATUS",
          "AGENT_CREATED",
          "AGENT_REVOKED",
          "BROWSER_CONNECTION_AUTHENTICATED",
          "BROWSER_CONNECTION_REVOKED",
          "WORKFLOW_ROLES",
          "SETTINGS_CHANGED",
        ].includes(row.code),
      );
    } else if (view === "decisions") list = list.filter((row) => row.category === "decision");

    if (orgFilter !== "all") list = list.filter((row) => row.tenantId === orgFilter);
    if (categoryFilter !== "all") list = list.filter((row) => row.category === categoryFilter);
    if (actorFilter !== "all") list = list.filter((row) => row.actor === actorFilter);
    if (workflowFilter !== "all") list = list.filter((row) => row.workflowId === workflowFilter);
    if (resultFilter !== "all") list = list.filter((row) => row.result === resultFilter);

    if (range !== "all") {
      const days = range === "24h" ? 1 : range === "7d" ? 7 : 30;
      const cutoff = Date.now() - days * 86_400_000;
      list = list.filter((row) => new Date(row.at).getTime() >= cutoff);
    }

    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (row) =>
          row.summary.toLowerCase().includes(needle) ||
          row.label.toLowerCase().includes(needle) ||
          row.code.toLowerCase().includes(needle) ||
          (row.actor ?? "").toLowerCase().includes(needle) ||
          (row.actorLabel ?? "").toLowerCase().includes(needle) ||
          (row.runId ?? "").toLowerCase().includes(needle) ||
          ops.orgLabel(row.tenantId).toLowerCase().includes(needle),
      );
    }

    return list;
  }, [rows, view, orgFilter, categoryFilter, actorFilter, workflowFilter, resultFilter, range, search, ops]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) set.add(row.category);
    return [...set];
  }, [rows]);

  const columns: Column<Row>[] = [
    {
      key: "at",
      header: "When",
      width: 132,
      nowrap: true,
      sort: (a, b) => a.at.localeCompare(b.at),
      render: (row) => <span title={absoluteTime(row.at)}>{relativeTime(row.at)}</span>,
    },
    {
      key: "event",
      header: "Event",
      primary: true,
      render: (row) => (
        // Several backend events carry a message identical to their label; showing it twice
        // just adds noise to a dense table.
        <CellStack
          top={row.label}
          bottom={row.summary.toLowerCase() === row.label.toLowerCase() ? undefined : row.summary}
        />
      ),
    },
    {
      key: "category",
      header: "Kind",
      width: 132,
      nowrap: true,
      render: (row) => (
        <Pill tone={row.source === "config" ? "muted" : row.tone}>
          {row.category === "config"
            ? "Configuration"
            : AUDIT_CATEGORY_LABEL[row.category as AuditCategory]}
        </Pill>
      ),
    },
    {
      key: "org",
      header: "Organization",
      sort: (a, b) => a.tenantId.localeCompare(b.tenantId),
      render: (row) => ops.orgLabel(row.tenantId),
    },
    {
      key: "actor",
      header: "Actor",
      render: (row) =>
        row.actorLabel && row.source === "config" ? (
          <CellStack top={row.actorLabel} bottom={row.actor} />
        ) : row.actor ? (
          <span className="ops-truncate">{row.actor}</span>
        ) : (
          <span className="ops-muted">system</span>
        ),
    },
    {
      key: "result",
      header: "Result",
      width: 96,
      render: (row) =>
        row.result === "ok" ? (
          <Pill tone="good">OK</Pill>
        ) : row.result === "fail" ? (
          <Pill tone="bad">Failed</Pill>
        ) : (
          <span className="ops-muted">—</span>
        ),
    },
    { key: "open", header: "", align: "right", width: 36, render: () => <Chevron /> },
  ];

  const failures = rows.filter((row) => row.result === "fail").length;

  return (
    <>
      <PageHead
        title="Audit & security"
        sub="Every configuration change and every run event, in one searchable trail. Human-readable first; raw payloads one click away."
      />

      <Metrics
        items={[
          { label: "Events loaded", value: rows.length, foot: `${ops.activity.length} config · ${rows.length - ops.activity.length} run` },
          {
            label: "Failures",
            value: failures,
            tone: failures > 0 ? "bad" : "good",
            onClick: () => setView("failures"),
          },
          {
            label: "Access changes",
            value: rows.filter((row) =>
              ["TEAM_MEMBER_STATUS", "AGENT_CREATED", "AGENT_REVOKED", "BROWSER_CONNECTION_AUTHENTICATED", "BROWSER_CONNECTION_REVOKED", "WORKFLOW_ROLES", "SETTINGS_CHANGED"].includes(row.code),
            ).length,
            foot: "Security-relevant",
            onClick: () => setView("access"),
          },
          { label: "Distinct actors", value: actors.length },
          {
            label: "Oldest event",
            value: rows.length ? relativeTime(rows[rows.length - 1].at) : "—",
            foot: "Extent of what's loaded",
          },
        ]}
      />

      <div className="ops-section">
        <Toolbar>
          <SavedViews
            views={[
              { id: "all", label: "Everything", count: rows.length },
              { id: "run", label: "Run activity" },
              { id: "config", label: "Configuration", count: ops.activity.length },
              { id: "access", label: "Access & security" },
              { id: "decisions", label: "Decisions" },
              { id: "failures", label: "Failures", count: failures, tone: "bad" },
            ]}
            active={view}
            onSelect={setView}
          />
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search events, actors, run ids…"
          />
          <ToolbarSpacer />
          <ResultCount shown={filtered.length} total={rows.length} noun="event" />
        </Toolbar>

        <Toolbar>
          {ops.allTenantIds.length > 1 && (
            <Select
              label="Organization"
              value={orgFilter}
              onChange={setOrgFilter}
              options={[
                { value: "all", label: "All organizations" },
                ...ops.allTenantIds.map((tenantId) => ({ value: tenantId, label: ops.orgLabel(tenantId) })),
              ]}
            />
          )}
          <Select
            label="Kind"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { value: "all", label: "All kinds" },
              ...categories.map((category) => ({
                value: category,
                label:
                  category === "config"
                    ? "Configuration"
                    : (AUDIT_CATEGORY_LABEL[category as AuditCategory] ?? category),
              })),
            ]}
          />
          <Select
            label="Workflow"
            value={workflowFilter}
            onChange={setWorkflowFilter}
            options={[
              { value: "all", label: "All workflows" },
              ...ops.workflows.map((workflow) => ({ value: workflow.id, label: workflow.name })),
            ]}
          />
          {actors.length > 1 && (
            <Select
              label="Actor"
              value={actorFilter}
              onChange={setActorFilter}
              options={[
                { value: "all", label: "All actors" },
                ...actors.map((actor) => ({ value: actor, label: actor })),
              ]}
            />
          )}
          <Select
            label="Result"
            value={resultFilter}
            onChange={setResultFilter}
            options={[
              { value: "all", label: "Any result" },
              { value: "ok", label: "Succeeded" },
              { value: "fail", label: "Failed" },
              { value: "neutral", label: "Informational" },
            ]}
          />
          <Select
            label="Date range"
            value={range}
            onChange={setRange}
            options={[
              { value: "all", label: "All time" },
              { value: "24h", label: "Last 24 hours" },
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
            ]}
          />
          <ToolbarSpacer />
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => {
              setView("all");
              setSearch("");
              setOrgFilter("all");
              setCategoryFilter("all");
              setActorFilter("all");
              setWorkflowFilter("all");
              setResultFilter("all");
              setRange("all");
            }}
          >
            Reset filters
          </Btn>
        </Toolbar>

        <DataTable
          rows={filtered.slice(0, 500)}
          columns={columns}
          rowKey={(row) => row.id}
          onRowClick={setOpen}
          rowTone={(row) => (row.result === "fail" ? "bad" : undefined)}
          loading={ops.loading && rows.length === 0}
          defaultSort={{ key: "at", dir: "desc" }}
          maxHeight={720}
          emptyState={
            <EmptyState
              glyph="audit"
              title={rows.length === 0 ? "No audit events yet" : "No events match these filters"}
              body={
                rows.length === 0
                  ? "Events appear as soon as workflows run or configuration changes."
                  : "Try resetting the filters or widening the date range."
              }
            />
          }
        />

        {filtered.length > 500 && (
          <p className="ops-small ops-muted" style={{ marginTop: 8 }}>
            Showing the 500 most recent of {filtered.length} matching events. Narrow the filters to
            see older ones.
          </p>
        )}
      </div>

      <div className="ops-section">
        <Alert tone="neutral" title="What this trail covers">
          Configuration activity is capped server-side at the 300 most recent events and can only
          be filtered by organization and action at source. Per-run events are read from the run
          records themselves — the control plane also writes durable per-run audit rows, but exposes
          no query route for them, so this view searches loaded runs rather than the full archive.
        </Alert>
      </div>

      {open && (
        <Drawer
          title={
            <>
              <Pill tone={open.source === "config" ? "muted" : open.tone}>
                {open.source === "config" ? "Configuration" : AUDIT_CATEGORY_LABEL[open.category as AuditCategory]}
              </Pill>
              <span>{open.label}</span>
            </>
          }
          sub={<>{absoluteTime(open.at)} · {ops.orgLabel(open.tenantId)}</>}
          onClose={() => setOpen(null)}
          footer={
            open.runId ? (
              <Btn
                variant="primary"
                onClick={() => {
                  const runId = open.runId as string;
                  setOpen(null);
                  nav.openRun(runId);
                }}
              >
                Open this run
              </Btn>
            ) : undefined
          }
        >
          <Panel title="What happened">
            <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>{open.summary}</p>
            <KeyValue
              rows={[
                { label: "Event", value: open.label },
                {
                  label: "Result",
                  value:
                    open.result === "ok" ? (
                      <Pill tone="good">Succeeded</Pill>
                    ) : open.result === "fail" ? (
                      <Pill tone="bad">Failed</Pill>
                    ) : (
                      "Informational"
                    ),
                },
                { label: "When", value: absoluteTime(open.at) },
                { label: "Organization", value: ops.orgLabel(open.tenantId) },
                {
                  label: "Actor",
                  value: open.actorLabel && open.source === "config" ? open.actorLabel : (open.actor ?? "system"),
                },
                {
                  label: "Workflow",
                  value: open.workflowId ? (ops.workflowById(open.workflowId)?.name ?? open.workflowId) : undefined,
                  hide: !open.workflowId,
                },
                {
                  label: "Step",
                  value: open.stepId ? <code>{open.stepId}</code> : undefined,
                  hide: !open.stepId,
                },
              ]}
            />
          </Panel>

          <div style={{ marginTop: 12 }}>
            <TechnicalDetail label="Technical detail">
              <KeyValue
                rows={[
                  { label: "Event code", value: <code>{open.code}</code> },
                  { label: "Source", value: open.source === "config" ? "/activity" : "run.audit[]" },
                  { label: "Tenant", value: <IdChip value={open.tenantId} /> },
                  {
                    label: "Run id",
                    value: open.runId ? <IdChip value={open.runId} /> : <span className="ops-muted">—</span>,
                  },
                  {
                    label: "Actor subject",
                    value: open.actor ? <IdChip value={open.actor} /> : <span className="ops-muted">—</span>,
                  },
                ]}
              />
              {open.details != null && (
                <div style={{ marginTop: 10 }}>
                  <CodeBlock value={open.details} />
                </div>
              )}
            </TechnicalDetail>
          </div>
        </Drawer>
      )}
    </>
  );
}
