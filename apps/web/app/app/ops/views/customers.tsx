"use client";

/**
 * Customers — the internal SaaS operator console for an organization.
 *
 * Opening an organization should answer everything at once: is it healthy, what plan is it on,
 * how much is it actually using AmazFlow, who its users are, which workflows it runs, what's
 * failing, which systems it has connected, what's waiting on a human, what it has asked support,
 * and what has been changed on its account. Everything is one click from here rather than
 * scattered across disconnected pages.
 */

import { useEffect, useMemo, useState } from "react";
import type { WorkflowDefinition, WorkflowRun } from "@amazflow/workflow-schema";
import {
  isPendingInvite,
  orgSettingsOf,
  runsByDay,
  useOps,
  type Organization,
  type UserRecord,
} from "../data";
import { useDetailCrumb, useNav } from "../nav";
import { PageHead } from "../shell";
import { useOpsActions } from "../actions";
import {
  Alert,
  Btn,
  CellStack,
  CodeBlock,
  DataTable,
  EmptyState,
  Field,
  IdChip,
  KeyValue,
  Legend,
  Meter,
  Metrics,
  Modal,
  Panel,
  Pill,
  ResultCount,
  SearchInput,
  Select,
  Sparkline,
  StackBar,
  Tabs,
  TechnicalDetail,
  Timeline,
  Toolbar,
  ToolbarSpacer,
  type Column,
  type TabSpec,
  Chevron,
} from "../primitives";
import {
  CONNECTION_STATUS_LABEL,
  CONNECTION_STATUS_TONE,
  ORG_PLANS,
  ORG_STATUSES,
  ORG_STATUS_EFFECT,
  ORG_STATUS_TONE,
  ROLE_SHORT,
  concurrencyLabel,
  orgPlanLabel,
  orgStatusLabel,
  timezoneOptions,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  WORKFLOW_STATUS_LABEL,
  WORKFLOW_STATUS_TONE,
  absoluteTime,
  activityAction,
  clockTime,
  isException,
  money,
  percent,
  relativeTime,
  runStatus,
  shortDuration,
} from "../terms";
import { runDuration } from "../run-model";

/* ================================================================================ list view = */

export function CustomersView() {
  const ops = useOps();
  const nav = useNav();
  const actions = useOpsActions();

  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState("all");
  const [creating, setCreating] = useState(nav.view.view === "new");
  const [newName, setNewName] = useState("");

  /** Tenants that have real records but no organization row — a real operational gap. */
  const unmapped = useMemo(
    () => ops.allTenantIds.filter((tenantId) => !ops.orgByTenant(tenantId)),
    [ops],
  );

  const rows = useMemo(() => {
    let list = ops.organizations;
    if (healthFilter !== "all") {
      list = list.filter((org) => ops.healthForOrg(org).tone === healthFilter);
    }
    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (org) =>
          org.name.toLowerCase().includes(needle) ||
          org.slug.toLowerCase().includes(needle) ||
          (org.branding?.displayName ?? "").toLowerCase().includes(needle) ||
          org.plan.toLowerCase().includes(needle),
      );
    }
    return list;
  }, [ops, healthFilter, search]);

  const healthCounts = useMemo(() => {
    const counts = { good: 0, waiting: 0, bad: 0, muted: 0 };
    for (const org of ops.organizations) counts[ops.healthForOrg(org).tone] += 1;
    return counts;
  }, [ops]);

  const columns: Column<Organization>[] = [
    {
      key: "health",
      header: "Health",
      width: 132,
      nowrap: true,
      sort: (a, b) => ops.healthForOrg(a).score - ops.healthForOrg(b).score,
      render: (org) => {
        const health = ops.healthForOrg(org);
        return (
          <Pill tone={health.tone} title={health.reasons.join(" · ")}>
            {health.label}
          </Pill>
        );
      },
    },
    {
      key: "name",
      header: "Organization",
      primary: true,
      sort: (a, b) => a.name.localeCompare(b.name),
      render: (org) => (
        <CellStack top={org.branding?.displayName || org.name} bottom={org.slug} />
      ),
    },
    {
      key: "plan",
      header: "Plan",
      width: 140,
      sort: (a, b) => a.plan.localeCompare(b.plan),
      render: (org) => <Pill tone="muted">{orgPlanLabel(org.plan)}</Pill>,
    },
    {
      // A paused or suspended organization cannot start work, which is the kind of thing that
      // should be visible while scanning the list rather than only after opening the customer.
      key: "status",
      header: "Execution",
      width: 128,
      sort: (a, b) => String(a.status).localeCompare(String(b.status)),
      render: (org) => {
        const limit = orgSettingsOf(org).maxConcurrentRuns;
        return (
          <CellStack
            top={
              <Pill tone={ORG_STATUS_TONE[org.status] ?? "muted"}>{orgStatusLabel(org.status)}</Pill>
            }
            bottom={limit > 0 ? concurrencyLabel(limit) : undefined}
          />
        );
      },
    },
    {
      key: "workflows",
      header: "Workflows",
      align: "right",
      width: 96,
      sort: (a, b) => ops.workflowsForTenant(a.slug).length - ops.workflowsForTenant(b.slug).length,
      render: (org) => {
        const list = ops.workflowsForTenant(org.slug);
        const published = list.filter((workflow) => workflow.status === "active").length;
        return (
          <span className="ops-cell-num">
            {published}
            <span className="ops-muted"> / {list.length}</span>
          </span>
        );
      },
    },
    {
      key: "runs",
      header: "Runs",
      align: "right",
      width: 78,
      sort: (a, b) => ops.runsForTenant(a.slug).length - ops.runsForTenant(b.slug).length,
      render: (org) => <span className="ops-cell-num">{ops.runsForTenant(org.slug).length}</span>,
    },
    {
      key: "failures",
      header: "Attention",
      align: "right",
      width: 92,
      sort: (a, b) =>
        ops.runsForTenant(a.slug).filter((run) => isException(run.status)).length -
        ops.runsForTenant(b.slug).filter((run) => isException(run.status)).length,
      render: (org) => {
        const count = ops.runsForTenant(org.slug).filter((run) => isException(run.status)).length;
        return count > 0 ? (
          <span className="ops-cell-num ops-tone-bad ops-strong">{count}</span>
        ) : (
          <span className="ops-muted">0</span>
        );
      },
    },
    {
      key: "connections",
      header: "Connections",
      width: 128,
      render: (org) => {
        const list = ops.connectionsForTenant(org.slug);
        if (list.length === 0) return <span className="ops-muted">none</span>;
        const active = list.filter((connection) => connection.status === "active").length;
        return (
          <span className="ops-row ops-gap-sm">
            <Pill tone={active === list.length ? "good" : active > 0 ? "waiting" : "bad"}>
              {active}/{list.length} signed in
            </Pill>
          </span>
        );
      },
    },
    {
      key: "activity",
      header: "Last run",
      nowrap: true,
      width: 108,
      sort: (a, b) => (lastRunAt(ops, a) ?? "").localeCompare(lastRunAt(ops, b) ?? ""),
      render: (org) => {
        const at = lastRunAt(ops, org);
        return at ? <span title={absoluteTime(at)}>{relativeTime(at)}</span> : <span className="ops-muted">never</span>;
      },
    },
    { key: "open", header: "", align: "right", width: 36, render: () => <Chevron /> },
  ];

  return (
    <>
      <PageHead
        title="Organizations"
        sub="Every customer organization on the platform, with the health signal that decides where to look first."
        actions={
          <Btn variant="primary" glyph="plus" onClick={() => setCreating(true)}>
            New organization
          </Btn>
        }
      />

      <Metrics
        items={[
          { label: "Organizations", value: ops.organizations.length, foot: "Total on the platform" },
          {
            label: "Healthy",
            value: healthCounts.good,
            tone: healthCounts.good > 0 ? "good" : undefined,
            onClick: () => setHealthFilter("good"),
          },
          {
            label: "Need a look",
            value: healthCounts.waiting,
            tone: healthCounts.waiting > 0 ? "waiting" : undefined,
            onClick: () => setHealthFilter("waiting"),
          },
          {
            label: "At risk",
            value: healthCounts.bad,
            tone: healthCounts.bad > 0 ? "bad" : "good",
            onClick: () => setHealthFilter("bad"),
          },
          {
            label: "Not started",
            value: healthCounts.muted,
            foot: "No runs yet",
            onClick: () => setHealthFilter("muted"),
          },
        ]}
      />

      {unmapped.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="waiting" title={`${unmapped.length} tenant${unmapped.length === 1 ? "" : "s"} without an organization record`}>
            {unmapped.join(", ")} — these have real workflows or runs but no organization row, so
            they can&apos;t be managed here. Runs still execute normally; organizations are a
            management layer.
          </Alert>
        </div>
      )}

      <div className="ops-section">
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search organizations…" />
          <Select
            label="Health"
            value={healthFilter}
            onChange={setHealthFilter}
            options={[
              { value: "all", label: "All health" },
              { value: "good", label: "Healthy" },
              { value: "waiting", label: "Needs a look" },
              { value: "bad", label: "At risk" },
              { value: "muted", label: "Not started" },
            ]}
          />
          <ToolbarSpacer />
          <ResultCount shown={rows.length} total={ops.organizations.length} noun="organization" />
        </Toolbar>

        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(org) => org.id}
          onRowClick={(org) => nav.openOrg(org.slug)}
          loading={ops.loading && ops.organizations.length === 0}
          defaultSort={{ key: "activity", dir: "desc" }}
          emptyState={
            <EmptyState
              glyph="organizations"
              title={ops.organizations.length === 0 ? "No organizations yet" : "No organizations match"}
              body={
                ops.organizations.length === 0
                  ? "Create your first customer organization to start managing workflows, users, and connections for them."
                  : "Try clearing the search or the health filter."
              }
              actions={
                ops.organizations.length === 0 ? (
                  <Btn variant="primary" onClick={() => setCreating(true)}>
                    New organization
                  </Btn>
                ) : undefined
              }
            />
          }
        />
      </div>

      {creating && (
        <Modal
          title="New organization"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Btn onClick={() => setCreating(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                disabled={!newName.trim() || actions.busy === "createOrg"}
                onClick={async () => {
                  const created = await actions.createOrganization(newName.trim());
                  if (created) {
                    setNewName("");
                    setCreating(false);
                    nav.openOrg(created.slug);
                  }
                }}
              >
                Create organization
              </Btn>
            </>
          }
        >
          <Field label="Organization name" hint="A URL slug is generated from this automatically.">
            <input
              className="ops-input"
              value={newName}
              autoFocus
              placeholder="Acme Corporation"
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && newName.trim()) {
                  actions.createOrganization(newName.trim()).then((created) => {
                    if (created) {
                      setNewName("");
                      setCreating(false);
                      nav.openOrg(created.slug);
                    }
                  });
                }
              }}
            />
          </Field>
          <p className="ops-small ops-muted">
            New organizations start on the <b>design partner</b> plan and are immediately active.
            Users are provisioned separately in the identity pool.
          </p>
        </Modal>
      )}
    </>
  );
}

function lastRunAt(ops: ReturnType<typeof useOps>, org: Organization): string | null {
  return ops
    .runsForTenant(org.slug)
    .reduce<string | null>((latest, run) => (!latest || run.createdAt > latest ? run.createdAt : latest), null);
}

/* ============================================================================== detail view = */

export function OrgDetailView({ slug }: { slug: string }) {
  const ops = useOps();
  const nav = useNav();
  const org = ops.organizations.find((candidate) => candidate.slug === slug || candidate.id === slug);
  useDetailCrumb(org ? org.branding?.displayName || org.name : slug);

  const [tab, setTab] = useState(nav.view.tab ?? "overview");

  const tenantId = org?.slug ?? slug;

  useEffect(() => {
    if (tab === "users") ops.loadUsers(tenantId);
    if (tab === "overview" || tab === "usage") ops.loadSummary(tenantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tenantId]);

  if (!org) {
    return (
      <EmptyState
        glyph="organizations"
        title="No organization record for that tenant"
        body={`Records exist under tenant "${slug}" but there is no organization row, so there is nothing to manage here yet.`}
        actions={<Btn onClick={() => nav.goSection("customers")}>Back to organizations</Btn>}
      />
    );
  }

  const runs = ops.runsForTenant(tenantId);
  const workflows = ops.workflowsForTenant(tenantId);
  const connections = ops.connectionsForTenant(tenantId);
  const agents = ops.agentsForTenant(tenantId);
  const tickets = ops.ticketsForTenant(tenantId);
  const activity = ops.activityForTenant(tenantId);
  const health = ops.healthForOrg(org);

  const failures = runs.filter((run) => isException(run.status));
  const waiting = runs.filter(
    (run) => run.status === "WAITING_APPROVAL" || run.status === "AWAITING_CONFIRMATION",
  );
  const openTickets = tickets.filter(
    (ticket) => ticket.status === "open" || ticket.status === "in_progress",
  );

  const tabs: TabSpec[] = [
    { id: "overview", label: "Overview" },
    { id: "workflows", label: "Workflows", count: workflows.length },
    { id: "runs", label: "Runs", count: runs.length },
    { id: "attention", label: "Needs attention", count: failures.length, tone: "bad" },
    { id: "approvals", label: "Approvals", count: waiting.length, tone: "waiting" },
    { id: "users", label: "Users" },
    { id: "connections", label: "Connections", count: connections.length },
    { id: "support", label: "Support", count: openTickets.length, tone: "waiting" },
    { id: "audit", label: "Audit", count: activity.length },
    { id: "usage", label: "Usage" },
    { id: "config", label: "Configuration" },
  ];

  return (
    <>
      <PageHead
        title={org.branding?.displayName || org.name}
        pills={
          <>
            <Pill tone={health.tone} dot>
              {health.label}
            </Pill>
            <Pill tone={ORG_STATUS_TONE[org.status] ?? "muted"} title={ORG_STATUS_EFFECT[org.status]}>
              {orgStatusLabel(org.status)}
            </Pill>
            <Pill tone="muted">{orgPlanLabel(org.plan)}</Pill>
          </>
        }
        sub={
          <>
            <code>{org.slug}</code> · customer since{" "}
            {new Date(org.createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
            {health.reasons.length > 0 && <> · {health.reasons.join(" · ")}</>}
          </>
        }
        actions={
          <>
            <Btn onClick={() => setTab("config")}>Configuration</Btn>
            <PreviewButton org={org} />
          </>
        }
      />

      <Metrics
        items={[
          {
            label: "Runs",
            value: runs.length,
            foot: `${runs.filter((run) => run.status === "COMPLETED").length} completed`,
            onClick: () => setTab("runs"),
          },
          {
            label: "Needs attention",
            value: failures.length,
            tone: failures.length > 0 ? "bad" : "good",
            foot: failures.length > 0 ? "Failed or timed out" : "Nothing failing",
            onClick: () => setTab("attention"),
          },
          {
            label: "Blocked on a human",
            value: waiting.length,
            tone: waiting.length > 0 ? "waiting" : undefined,
            onClick: () => setTab("approvals"),
          },
          {
            label: "Published workflows",
            value: workflows.filter((workflow) => workflow.status === "active").length,
            foot: `${workflows.length} total`,
            onClick: () => setTab("workflows"),
          },
          {
            label: "Connections",
            value: `${connections.filter((connection) => connection.status === "active").length}/${connections.length}`,
            tone:
              connections.length === 0
                ? undefined
                : connections.some((connection) => connection.status === "active")
                  ? "good"
                  : "bad",
            foot: "Signed in",
            onClick: () => setTab("connections"),
          },
          {
            label: "Open tickets",
            value: openTickets.length,
            tone: openTickets.length > 0 ? "waiting" : undefined,
            onClick: () => setTab("support"),
          },
        ]}
      />

      <div className="ops-section">
        <Tabs tabs={tabs} active={tab} onSelect={setTab} />
        <div className="ops-tabpanel">
          {tab === "overview" && <OrgOverview org={org} tenantId={tenantId} />}
          {tab === "workflows" && <OrgWorkflows workflows={workflows} />}
          {tab === "runs" && <OrgRuns runs={runs} />}
          {tab === "attention" && <OrgRuns runs={failures} emptyLabel="Nothing needs attention" />}
          {tab === "approvals" && <OrgRuns runs={waiting} emptyLabel="Nothing is waiting on a human" />}
          {tab === "users" && <OrgUsers tenantId={tenantId} org={org} />}
          {tab === "connections" && <OrgConnections tenantId={tenantId} />}
          {tab === "support" && <OrgSupport tickets={tickets} />}
          {tab === "audit" && <OrgAudit tenantId={tenantId} />}
          {tab === "usage" && <OrgUsage tenantId={tenantId} runs={runs} workflows={workflows} />}
          {tab === "config" && <OrgConfig org={org} agents={agents} />}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------------- overview --- */

function OrgOverview({ org, tenantId }: { org: Organization; tenantId: string }) {
  const ops = useOps();
  const nav = useNav();

  const runs = ops.runsForTenant(tenantId);
  const workflows = ops.workflowsForTenant(tenantId);
  const health = ops.healthForOrg(org);
  const summary = ops.summaries[tenantId];
  const day = runsByDay(runs, 21);

  const completed = runs.filter((run) => run.status === "COMPLETED").length;
  const failed = runs.filter((run) => isException(run.status)).length;
  const live = runs.filter((run) => !["COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED"].includes(run.status)).length;
  const cancelled = runs.filter((run) => run.status === "CANCELLED").length;

  const recent = runs.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const topWorkflows = workflows
    .map((workflow) => ({ workflow, stats: ops.statsForWorkflow(workflow.id) }))
    .filter((entry) => entry.stats.total > 0)
    .sort((a, b) => b.stats.total - a.stats.total)
    .slice(0, 6);

  return (
    <div className="ops-split" data-side="wide">
      <div className="ops-col">
        <Panel title="Health" sub={health.label}>
          <Meter value={health.score} tone={health.tone === "muted" ? "muted" : health.tone} />
          <div style={{ marginTop: 12 }}>
            {health.reasons.length === 0 ? (
              <p className="ops-small ops-muted">No issues detected.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }}>
                {health.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel title="Run outcomes" sub={`${runs.length} total`}>
          <StackBar
            segments={[
              { tone: "good", value: completed, label: "Completed" },
              { tone: "bad", value: failed, label: "Needing attention" },
              { tone: "waiting", value: live, label: "In flight" },
              { tone: "muted", value: cancelled, label: "Cancelled" },
            ]}
          />
          <div style={{ marginTop: 10 }}>
            <Legend
              items={[
                { tone: "good", label: "Completed", value: completed },
                { tone: "bad", label: "Attention", value: failed },
                { tone: "waiting", label: "In flight", value: live },
                { tone: "muted", label: "Cancelled", value: cancelled },
              ]}
            />
          </div>
          <div style={{ marginTop: 16 }}>
            <span className="ops-small ops-muted">Volume, last 21 days</span>
            <Sparkline values={day.map((bucket) => bucket.total)} tone={failed > 0 ? "bad" : "good"} />
          </div>
        </Panel>

        <Panel title="Busiest workflows">
          {topWorkflows.length === 0 ? (
            <EmptyState glyph="workflows" title="No runs yet" body="Nothing has been executed for this customer." inline />
          ) : (
            <div className="ops-col ops-gap-sm">
              {topWorkflows.map(({ workflow, stats }) => (
                <button
                  key={workflow.id}
                  className="ops-row"
                  style={{ width: "100%" }}
                  onClick={() => nav.openWorkflow(workflow.id)}
                >
                  <span className="ops-truncate ops-strong" style={{ flex: 1 }}>
                    {workflow.name}
                  </span>
                  <span className="ops-small ops-muted ops-nowrap">{stats.total} runs</span>
                  {stats.successRate !== null && (
                    <Pill tone={stats.successRate >= 0.95 ? "good" : stats.successRate >= 0.8 ? "waiting" : "bad"}>
                      {percent(stats.successRate)}
                    </Pill>
                  )}
                  <Chevron />
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="ops-col">
        <Panel title="Value delivered" sub="From the control plane">
          {!summary || summary.state === "loading" ? (
            <p className="ops-small ops-muted">Loading…</p>
          ) : summary.state === "error" ? (
            <p className="ops-small ops-muted">Couldn&apos;t load: {summary.error}</p>
          ) : summary.data ? (
            <KeyValue
              rows={[
                { label: "Runs completed", value: summary.data.totalRunsCompleted },
                {
                  label: "Time saved",
                  value: `${summary.data.totalMinutesSaved.toLocaleString()} min`,
                },
                { label: "Estimated value", value: money(summary.data.dollarEstimate) },
              ]}
            />
          ) : null}
          <div style={{ marginTop: 10 }}>
            <p className="ops-small ops-muted">
              Derived from each workflow&apos;s manual-minutes estimate at a blended rate. This is
              the value story, not billing — the platform has no invoicing surface yet.
            </p>
          </div>
        </Panel>

        <Panel
          title="Recent activity"
          actions={
            <Btn size="sm" variant="ghost" onClick={() => nav.goSection("runs")}>
              All runs
            </Btn>
          }
        >
          {recent.length === 0 ? (
            <EmptyState glyph="runs" title="No runs yet" inline />
          ) : (
            <div className="ops-col ops-gap-sm">
              {recent.map((run) => {
                const status = runStatus(run.status);
                const workflow = ops.workflowById(run.workflowId);
                return (
                  <button
                    key={run.id}
                    className="ops-row"
                    style={{ width: "100%" }}
                    onClick={() => nav.openRun(run.id)}
                  >
                    <Pill tone={status.tone} dot>
                      {status.label}
                    </Pill>
                    <span className="ops-truncate" style={{ flex: 1 }}>
                      {workflow?.name ?? run.workflowId}
                    </span>
                    <span className="ops-small ops-muted ops-nowrap">
                      {relativeTime(run.updatedAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------ workflows --- */

function OrgWorkflows({ workflows }: { workflows: WorkflowDefinition[] }) {
  const ops = useOps();
  const nav = useNav();

  return (
    <DataTable
      rows={workflows}
      columns={[
        {
          key: "status",
          header: "Status",
          width: 108,
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
            <CellStack top={workflow.name} bottom={`v${workflow.version} · ${workflow.steps.length} steps`} />
          ),
        },
        {
          key: "runs",
          header: "Runs",
          align: "right",
          width: 78,
          render: (workflow) => <span className="ops-cell-num">{ops.statsForWorkflow(workflow.id).total}</span>,
        },
        {
          key: "success",
          header: "Success",
          align: "right",
          width: 92,
          render: (workflow) => {
            const stats = ops.statsForWorkflow(workflow.id);
            if (stats.successRate === null) return <span className="ops-muted">—</span>;
            const tone = stats.successRate >= 0.95 ? "good" : stats.successRate >= 0.8 ? "waiting" : "bad";
            return <span className={`ops-cell-num ops-tone-${tone}`}>{percent(stats.successRate)}</span>;
          },
        },
        {
          key: "last",
          header: "Last run",
          nowrap: true,
          width: 108,
          render: (workflow) => {
            const stats = ops.statsForWorkflow(workflow.id);
            return stats.lastRunAt ? relativeTime(stats.lastRunAt) : <span className="ops-muted">never</span>;
          },
        },
        { key: "open", header: "", align: "right", width: 36, render: () => <Chevron /> },
      ]}
      rowKey={(workflow) => workflow.id}
      onRowClick={(workflow) => nav.openWorkflow(workflow.id)}
      emptyState={
        <EmptyState
          glyph="workflows"
          title="No workflows for this customer"
          body="Create one in Workflow Studio and assign it to this organization."
          actions={<Btn onClick={() => nav.goSection("studio")}>Open Workflow Studio</Btn>}
          inline
        />
      }
    />
  );
}

/* ----------------------------------------------------------------------------------- runs --- */

function OrgRuns({ runs, emptyLabel }: { runs: WorkflowRun[]; emptyLabel?: string }) {
  const ops = useOps();
  const nav = useNav();

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
          key: "workflow",
          header: "Workflow",
          primary: true,
          render: (run) => {
            const workflow = ops.workflowById(run.workflowId);
            return <CellStack top={workflow?.name ?? run.workflowId} bottom={`v${run.workflowVersion}`} />;
          },
        },
        {
          key: "step",
          header: "Current step",
          render: (run) => {
            const workflow = ops.workflowById(run.workflowId);
            const step = workflow?.steps.find((candidate) => candidate.id === run.currentStepId);
            return step ? step.name : <span className="ops-muted">—</span>;
          },
        },
        {
          key: "started",
          header: "Started",
          nowrap: true,
          width: 120,
          sort: (a, b) => a.createdAt.localeCompare(b.createdAt),
          render: (run) => <span title={absoluteTime(run.createdAt)}>{relativeTime(run.createdAt)}</span>,
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
      rowTone={(run) => (isException(run.status) ? "bad" : undefined)}
      defaultSort={{ key: "started", dir: "desc" }}
      emptyState={<EmptyState glyph="runs" title={emptyLabel ?? "No runs yet"} inline />}
    />
  );
}

/* ---------------------------------------------------------------------------------- users --- */

/**
 * Invitation form. The organization's allowed-domain list is mirrored here so the operator is
 * told before sending rather than after the server refuses -- but the server check is the real
 * one, and its message is shown verbatim if they disagree.
 */
function InviteMemberModal({
  org,
  onClose,
}: {
  org: Organization;
  onClose: () => void;
}) {
  const actions = useOpsActions();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("FRONTLINE");
  const allowed = orgSettingsOf(org).allowedEmailDomains;

  const trimmed = email.trim().toLowerCase();
  const looksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed);
  const domain = looksLikeEmail ? trimmed.slice(trimmed.lastIndexOf("@") + 1) : "";
  const domainBlocked = looksLikeEmail && allowed.length > 0 && !allowed.includes(domain);
  const busy = actions.busy === `invite_${org.slug}`;

  const error = !trimmed
    ? undefined
    : !looksLikeEmail
      ? "That doesn't look like an email address"
      : domainBlocked
        ? `${domain} is not one of this organization's allowed domains`
        : undefined;

  return (
    <Modal
      title={`Invite someone to ${org.branding?.displayName || org.name}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            variant="primary"
            disabled={!looksLikeEmail || domainBlocked || busy}
            onClick={async () => {
              await actions.inviteUser(org.slug, trimmed, role);
              onClose();
            }}
          >
            {busy ? "Sending…" : "Send invitation"}
          </Btn>
        </>
      }
    >
      <div className="ops-col">
        <Field
          label="Email address"
          hint="They receive a temporary password and set their own on first sign-in."
          error={error}
        >
          <input
            className="ops-input"
            type="email"
            autoFocus
            value={email}
            placeholder={allowed.length ? `name@${allowed[0]}` : "name@company.com"}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field
          label="Role"
          hint={
            role === "CLIENT_ADMIN"
              ? "Can run workflows, decide approvals, manage their team, and edit branding."
              : "Can run the workflows assigned to their role and see their own runs."
          }
        >
          <Select
            value={role}
            onChange={setRole}
            label="Role"
            // ROLE_SHORT, not friendlier wording of my own: this modal adds a row to the table
            // directly behind it, and one role should not have two names on one screen.
            options={[
              { value: "FRONTLINE", label: ROLE_SHORT.FRONTLINE },
              { value: "CLIENT_ADMIN", label: ROLE_SHORT.CLIENT_ADMIN },
            ]}
          />
        </Field>
        {allowed.length > 0 && (
          <p className="ops-small ops-muted">
            Allowed domains: {allowed.join(", ")}. Change this on the Configuration tab.
          </p>
        )}
      </div>
    </Modal>
  );
}

function OrgUsers({ tenantId, org }: { tenantId: string; org: Organization }) {
  const ops = useOps();
  const actions = useOpsActions();
  const [inviting, setInviting] = useState(false);
  const slot = ops.users[tenantId];

  if (!slot || slot.state === "loading") {
    return <Panel title="Users">Loading the user directory…</Panel>;
  }
  if (slot.state === "error") {
    return (
      <Alert
        tone="bad"
        title="Couldn't load users"
        actions={
          <Btn size="sm" onClick={() => ops.loadUsers(tenantId)}>
            Retry
          </Btn>
        }
      >
        {slot.error}
      </Alert>
    );
  }

  const users = slot.data ?? [];

  const pending = users.filter(isPendingInvite);

  return (
    <>
      <Toolbar>
        <ResultCount shown={users.length} total={users.length} noun="person" />
        {pending.length > 0 && (
          <Pill tone="waiting" title="Invited, but they have not signed in yet">
            {pending.length} awaiting first sign-in
          </Pill>
        )}
        <ToolbarSpacer />
        <Btn variant="primary" size="sm" onClick={() => setInviting(true)}>
          Invite someone
        </Btn>
      </Toolbar>

      {inviting && <InviteMemberModal org={org} onClose={() => setInviting(false)} />}

      <DataTable
        rows={users}
        columns={[
          {
            key: "status",
            header: "Access",
            width: 132,
            render: (user) =>
              !user.enabled ? (
                <Pill tone="bad">Disabled</Pill>
              ) : isPendingInvite(user) ? (
                <Pill tone="waiting" title="The invitation has been sent but not accepted">
                  Invited
                </Pill>
              ) : (
                <Pill tone="good">Active</Pill>
              ),
          },
          {
            key: "email",
            header: "User",
            primary: true,
            sort: (a, b) => a.email.localeCompare(b.email),
            render: (user) => <CellStack top={user.email || user.username} bottom={user.username} />,
          },
          {
            key: "role",
            header: "Role",
            width: 190,
            render: (user) => <Pill tone="muted">{ROLE_SHORT[user.role] ?? user.role}</Pill>,
          },
          {
            key: "actions",
            header: "",
            align: "right",
            width: 128,
            render: (user) => (
              <div className="ops-rowactions">
                <Btn
                  size="sm"
                  variant={user.enabled ? "danger" : undefined}
                  disabled={actions.busy === `user_${user.username}`}
                  onClick={() => actions.setUserEnabled(tenantId, user.username, !user.enabled)}
                >
                  {user.enabled ? "Disable" : "Enable"}
                </Btn>
              </div>
            ),
          },
        ]}
        rowKey={(user: UserRecord) => user.username}
        emptyState={
          <EmptyState
            glyph="users"
            title="Nobody has been invited yet"
            body="Invite the first person and AmazFlow emails them a temporary password. They set their own on first sign-in."
            actions={
              <Btn variant="primary" size="sm" onClick={() => setInviting(true)}>
                Invite someone
              </Btn>
            }
            inline
          />
        }
      />

      <div style={{ marginTop: 12 }}>
        <Alert tone="neutral" title="What can be changed here">
          Inviting creates the account, stamps the tenant claim, and grants the role in one step.
          Disabling blocks sign-in immediately and is reversible, which is why there is no delete:
          removing the account would take its audit trail with it.
          <br />
          <br />
          Changing an existing person&apos;s role and resetting passwords are still identity-pool
          operations with no control-plane route. AmazFlow staff are intentionally not listed here,
          and cannot be created through this screen.
        </Alert>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------------- connections --- */

function OrgConnections({ tenantId }: { tenantId: string }) {
  const ops = useOps();
  const nav = useNav();
  const connections = ops.connectionsForTenant(tenantId);
  const agents = ops.agentsForTenant(tenantId);

  return (
    <div className="ops-col">
      <Panel
        title="Connected systems"
        sub={`${connections.length}`}
        actions={
          <Btn size="sm" onClick={() => nav.go({ section: "connections", view: "new" })}>
            New connection
          </Btn>
        }
        flush
      >
        {connections.length === 0 ? (
          <EmptyState
            glyph="connections"
            title="No systems connected"
            body="A connection binds this customer to a system AmazFlow Browser can sign in to and act within."
            inline
          />
        ) : (
          <DataTable
            rows={connections}
            columns={[
              {
                key: "status",
                header: "State",
                width: 128,
                render: (connection) => (
                  <Pill tone={CONNECTION_STATUS_TONE[connection.status] ?? "neutral"}>
                    {CONNECTION_STATUS_LABEL[connection.status] ?? connection.status}
                  </Pill>
                ),
              },
              {
                key: "name",
                header: "Connection",
                primary: true,
                render: (connection) => <CellStack top={connection.name} bottom={connection.baseUrl} />,
              },
              {
                key: "workflows",
                header: "Used by",
                render: (connection) => {
                  const dependents = ops.workflowsUsingConnection(connection.id);
                  return dependents.length === 0 ? (
                    <span className="ops-muted">no workflows</span>
                  ) : (
                    `${dependents.length} workflow${dependents.length === 1 ? "" : "s"}`
                  );
                },
              },
              {
                key: "updated",
                header: "Last change",
                nowrap: true,
                width: 116,
                render: (connection) => relativeTime(connection.updatedAt),
              },
              { key: "open", header: "", align: "right", width: 36, render: () => <Chevron /> },
            ]}
            rowKey={(connection) => connection.id}
            onRowClick={(connection) => nav.openConnection(connection.id)}
          />
        )}
      </Panel>

      <Panel title="Agents" sub={`${agents.length}`}>
        {agents.length === 0 ? (
          <p className="ops-small ops-muted">
            No agent authorized. This customer relies entirely on AmazFlow Browser.
          </p>
        ) : (
          <div className="ops-col ops-gap-sm">
            {agents.map((agent) => (
              <div key={agent.id} className="ops-row">
                <Pill tone={agent.status === "revoked" ? "muted" : agent.lastSeenAt ? "good" : "waiting"}>
                  {agent.status === "revoked"
                    ? "Revoked"
                    : agent.lastSeenAt
                      ? `Last seen ${relativeTime(agent.lastSeenAt)}`
                      : "Never connected"}
                </Pill>
                <span className="ops-strong">{agent.name}</span>
                <ToolbarSpacer />
                <span className="ops-small ops-muted ops-truncate">
                  {agent.allowedDomains.length ? agent.allowedDomains.join(", ") : "no domains scoped"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------------- support --- */

function OrgSupport({ tickets }: { tickets: ReturnType<typeof useOps>["tickets"] }) {
  const nav = useNav();

  return (
    <DataTable
      rows={tickets.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))}
      columns={[
        {
          key: "status",
          header: "Status",
          width: 118,
          render: (ticket) => (
            <Pill tone={TICKET_STATUS_TONE[ticket.status] ?? "neutral"}>
              {TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}
            </Pill>
          ),
        },
        {
          key: "subject",
          header: "Subject",
          primary: true,
          render: (ticket) => <CellStack top={ticket.subject} bottom={ticket.category} />,
        },
        { key: "priority", header: "Priority", width: 96, render: (ticket) => ticket.priority },
        {
          key: "updated",
          header: "Updated",
          nowrap: true,
          width: 116,
          sort: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
          render: (ticket) => relativeTime(ticket.updatedAt),
        },
        { key: "open", header: "", align: "right", width: 36, render: () => <Chevron /> },
      ]}
      rowKey={(ticket) => ticket.id}
      onRowClick={(ticket) => nav.go({ section: "support", entityId: ticket.id })}
      defaultSort={{ key: "updated", dir: "desc" }}
      emptyState={
        <EmptyState glyph="support" title="No support tickets" body="This customer hasn't raised anything." inline />
      }
    />
  );
}

/* ---------------------------------------------------------------------------------- audit --- */

function OrgAudit({ tenantId }: { tenantId: string }) {
  const ops = useOps();
  const activity = ops
    .activityForTenant(tenantId)
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Panel title="Account changes" sub={`${activity.length} recorded`}>
      {activity.length === 0 ? (
        <EmptyState glyph="audit" title="No account changes recorded" inline />
      ) : (
        <Timeline
          items={activity.slice(0, 80).map((event) => {
            const meta = activityAction(event.action);
            return {
              id: event.id,
              timeLabel: clockTime(event.at),
              tone: meta.tone,
              headline: (
                <>
                  <b>{meta.label}</b>
                  {event.actorLabel && <Pill tone="muted">{event.actorLabel}</Pill>}
                </>
              ),
              message: event.summary,
              facts: [{ label: "At", value: absoluteTime(event.at) }],
            };
          })}
        />
      )}
      <div style={{ marginTop: 12 }}>
        <p className="ops-small ops-muted">
          This is the configuration and administration trail. Per-run audit events live on each run
          — see the Runs tab, or the Audit &amp; security section for a combined view.
        </p>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------------------------- usage --- */

function OrgUsage({
  tenantId,
  runs,
  workflows,
}: {
  tenantId: string;
  runs: WorkflowRun[];
  workflows: WorkflowDefinition[];
}) {
  const ops = useOps();
  const summary = ops.summaries[tenantId];
  const day = runsByDay(runs, 30);
  const completed = runs.filter((run) => run.status === "COMPLETED");

  const minutesConfigured = workflows.reduce(
    (sum, workflow) => sum + (workflow.manualMinutesEstimate ?? 0),
    0,
  );

  return (
    <div className="ops-col">
      <Panel title="Usage, last 30 days">
        <div className="ops-bars">
          {day.map((bucket) => (
            <span
              className="ops-bar"
              key={bucket.key}
              data-tone={bucket.failed > 0 ? "bad" : bucket.total > 0 ? "good" : undefined}
              title={`${bucket.label}: ${bucket.total} runs`}
              style={{
                height: `${Math.max(
                  bucket.total === 0 ? 2 : (bucket.total / Math.max(...day.map((entry) => entry.total), 1)) * 100,
                  2,
                )}%`,
              }}
            />
          ))}
        </div>
        <div className="ops-barchart-axis" style={{ marginTop: 6 }}>
          <span>{day[0]?.label}</span>
          <span>{day[day.length - 1]?.label}</span>
        </div>
        <div style={{ marginTop: 14 }}>
          <KeyValue
            rows={[
              { label: "Runs in window", value: day.reduce((sum, bucket) => sum + bucket.total, 0) },
              { label: "Runs all time", value: runs.length },
              { label: "Completed all time", value: completed.length },
            ]}
          />
        </div>
      </Panel>

      <Panel title="Plan and commercial">
        <KeyValue
          rows={[
            {
              label: "Plan",
              value: (
                <Pill tone="muted">
                  {(ops.orgByTenant(tenantId)?.plan ?? "unknown").replace(/_/g, " ")}
                </Pill>
              ),
            },
            {
              label: "Runs completed",
              value:
                summary?.state === "ready" && summary.data
                  ? summary.data.totalRunsCompleted
                  : "loading…",
            },
            {
              label: "Minutes saved",
              value:
                summary?.state === "ready" && summary.data
                  ? summary.data.totalMinutesSaved.toLocaleString()
                  : "loading…",
            },
            {
              label: "Estimated value",
              value:
                summary?.state === "ready" && summary.data
                  ? money(summary.data.dollarEstimate)
                  : "loading…",
            },
            {
              label: "Configured minutes per run",
              value: minutesConfigured > 0 ? `${minutesConfigured} across ${workflows.length} workflows` : "not estimated",
            },
          ]}
        />
        <div style={{ marginTop: 12 }}>
          <Alert tone="neutral" title="No billing surface yet">
            The control plane records no invoices, seat counts, rate cards, or metered spend. The
            numbers above are the value estimate it does compute. Treat plan as a label, not an
            entitlement — enforcement today is by workflow status and assigned roles.
          </Alert>
        </div>
      </Panel>
    </div>
  );
}

/* --------------------------------------------------------------------------- configuration --- */

/**
 * Name, status and plan. Status is the one control here with teeth: the control plane refuses to
 * start a run for an organization that is not active, so the effect of each choice is spelled out
 * rather than left to be discovered by pausing a live customer.
 */
function OrgProfilePanel({ org }: { org: Organization }) {
  const actions = useOpsActions();
  const [name, setName] = useState(org.name);
  const [status, setStatus] = useState(org.status);
  const [plan, setPlan] = useState(org.plan);

  useEffect(() => {
    setName(org.name);
    setStatus(org.status);
    setPlan(org.plan);
  }, [org.name, org.status, org.plan]);

  const busy = actions.busy === `orgprofile_${org.slug}`;
  const trimmed = name.trim();
  const dirty = trimmed !== org.name || status !== org.status || plan !== org.plan;
  const valid = trimmed.length > 0;

  return (
    <Panel
      title="Profile"
      sub="Name, commercial plan, and whether this organization may run work"
      actions={
        <Btn
          variant="primary"
          size="sm"
          disabled={!dirty || !valid || busy}
          onClick={() =>
            actions.saveOrgProfile(org.slug, {
              ...(trimmed !== org.name ? { name: trimmed } : {}),
              ...(status !== org.status ? { status } : {}),
              ...(plan !== org.plan ? { plan } : {}),
            })
          }
        >
          {busy ? "Saving…" : "Save profile"}
        </Btn>
      }
    >
      <div className="ops-grid" data-cols="2">
        <Field
          label="Organization name"
          hint="Shown throughout this console and on the customer's sign-in page."
          error={valid ? undefined : "A name is required"}
        >
          <input
            className="ops-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Plan" hint="Recorded for reporting. It does not itself impose limits.">
          <Select
            value={plan}
            onChange={setPlan}
            label="Plan"
            options={ORG_PLANS.map((option) => ({ value: option, label: orgPlanLabel(option) }))}
          />
        </Field>
        <Field label="Execution status" hint={ORG_STATUS_EFFECT[status]}>
          <Select
            value={status}
            onChange={setStatus}
            label="Execution status"
            options={ORG_STATUSES.map((option) => ({
              value: option,
              label: orgStatusLabel(option),
            }))}
          />
        </Field>
        <Field label="Currently">
          <div style={{ paddingTop: 6 }}>
            <Pill tone={ORG_STATUS_TONE[org.status] ?? "muted"}>{orgStatusLabel(org.status)}</Pill>
          </div>
        </Field>
      </div>

      {status !== org.status && status !== "active" && (
        <Alert tone="waiting" title={`Saving this will stop new runs for ${org.name}`}>
          {ORG_STATUS_EFFECT[status]} Anything already in flight keeps going, and nothing is
          deleted. Set it back to Active to resume.
        </Alert>
      )}
    </Panel>
  );
}

/**
 * The execution ceiling and who may be invited. Both are read by the control plane -- the run
 * limit at run creation, the domain list when a team member is invited -- so what this panel
 * says is what actually happens.
 */
function OrgExecutionPanel({ org }: { org: Organization }) {
  const actions = useOpsActions();
  const saved = orgSettingsOf(org);
  const [limit, setLimit] = useState(String(saved.maxConcurrentRuns));
  const [timezone, setTimezone] = useState(saved.timezone);
  const [domains, setDomains] = useState(saved.allowedEmailDomains.join(", "));

  useEffect(() => {
    setLimit(String(saved.maxConcurrentRuns));
    setTimezone(saved.timezone);
    setDomains(saved.allowedEmailDomains.join(", "));
  }, [saved.maxConcurrentRuns, saved.timezone, saved.allowedEmailDomains.join(",")]);

  const busy = actions.busy === `orgsettings_${org.slug}`;
  const parsedLimit = Number(limit);
  const limitValid = Number.isInteger(parsedLimit) && parsedLimit >= 0 && parsedLimit <= 1000;
  const parsedDomains = domains
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^@+/, ""))
    .filter(Boolean);
  const badDomain = parsedDomains.find(
    (entry) => !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(entry),
  );

  const dirty =
    parsedLimit !== saved.maxConcurrentRuns ||
    timezone !== saved.timezone ||
    parsedDomains.join(",") !== saved.allowedEmailDomains.join(",");
  const valid = limitValid && !badDomain;

  return (
    <Panel
      title="Execution and access"
      sub="Enforced by the control plane, not advisory"
      actions={
        <Btn
          variant="primary"
          size="sm"
          disabled={!dirty || !valid || busy}
          onClick={() =>
            actions.saveOrgSettings(org.slug, {
              ...(parsedLimit !== saved.maxConcurrentRuns
                ? { maxConcurrentRuns: parsedLimit }
                : {}),
              ...(timezone !== saved.timezone ? { timezone } : {}),
              ...(parsedDomains.join(",") !== saved.allowedEmailDomains.join(",")
                ? { allowedEmailDomains: parsedDomains }
                : {}),
            })
          }
        >
          {busy ? "Saving…" : "Save settings"}
        </Btn>
      }
    >
      <div className="ops-grid" data-cols="2">
        <Field
          label="Concurrent runs"
          hint={
            parsedLimit > 0
              ? `A run that would be the ${parsedLimit + 1}th in flight is refused until one finishes.`
              : "0 means no limit. Every run is allowed to start."
          }
          error={limitValid ? undefined : "A whole number from 0 to 1000"}
        >
          <input
            className="ops-input"
            inputMode="numeric"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
          />
        </Field>
        <Field label="Time zone" hint="How this organization's timestamps are shown.">
          <Select
            value={timezone}
            onChange={setTimezone}
            label="Time zone"
            options={timezoneOptions().map((zone) => ({ value: zone, label: zone }))}
          />
        </Field>
        <Field
          label="Allowed email domains"
          hint="Comma separated. Leave empty to allow any address. Checked when a team member is invited."
          error={badDomain ? `"${badDomain}" is not a valid domain` : undefined}
        >
          <input
            className="ops-input"
            value={domains}
            placeholder="acme.com, acme.co.uk"
            onChange={(event) => setDomains(event.target.value)}
          />
        </Field>
        <Field label="In force now">
          <div className="ops-kv-hint" style={{ marginTop: 6 }}>
            {concurrencyLabel(saved.maxConcurrentRuns)} · {saved.timezone} ·{" "}
            {saved.allowedEmailDomains.length
              ? `${saved.allowedEmailDomains.length} domain${saved.allowedEmailDomains.length === 1 ? "" : "s"}`
              : "any email domain"}
          </div>
        </Field>
      </div>
    </Panel>
  );
}

function OrgConfig({
  org,
  agents,
}: {
  org: Organization;
  agents: ReturnType<typeof useOps>["agents"];
}) {
  const actions = useOpsActions();
  const [displayName, setDisplayName] = useState(org.branding?.displayName ?? "");
  const [loginMessage, setLoginMessage] = useState(org.branding?.loginMessage ?? "");
  const [accent, setAccent] = useState(org.branding?.accent ?? "");
  const [logoUrl, setLogoUrl] = useState(org.branding?.logoUrl ?? "");

  const dirty =
    displayName !== (org.branding?.displayName ?? "") ||
    loginMessage !== (org.branding?.loginMessage ?? "") ||
    accent !== (org.branding?.accent ?? "") ||
    logoUrl !== (org.branding?.logoUrl ?? "");

  return (
    <div className="ops-col">
      <OrgProfilePanel org={org} />
      <OrgExecutionPanel org={org} />

      <Panel title="Identity" sub="Fixed for the life of the organization">
        <KeyValue
          rows={[
            {
              label: "Tenant identifier",
              value: <IdChip value={org.slug} />,
              hint: "Carried in every sign-in claim and every stored record. It cannot be changed.",
            },
            { label: "Organization id", value: <IdChip value={org.id} /> },
            { label: "Created", value: absoluteTime(org.createdAt) },
            { label: "Last updated", value: org.updatedAt ? absoluteTime(org.updatedAt) : "—" },
          ]}
        />
      </Panel>

      <Panel
        title="Customer console branding"
        sub="What this customer sees when they sign in"
        actions={
          <Btn
            variant="primary"
            size="sm"
            disabled={!dirty || actions.busy === `branding_${org.slug}`}
            onClick={() =>
              actions.saveBranding(org.slug, {
                ...(displayName ? { displayName } : {}),
                ...(loginMessage ? { loginMessage } : {}),
                ...(accent ? { accent } : {}),
                ...(logoUrl ? { logoUrl } : {}),
              })
            }
          >
            {actions.busy === `branding_${org.slug}` ? "Saving…" : "Save branding"}
          </Btn>
        }
      >
        <div className="ops-grid" data-cols="2">
          <Field label="Display name" hint="Overrides the organization name in the customer console.">
            <input
              className="ops-input"
              value={displayName}
              placeholder={org.name}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field label="Accent colour" hint="Six-digit hex, e.g. #2f6f4f.">
            <input
              className="ops-input"
              value={accent}
              placeholder="#2f6f4f"
              onChange={(event) => setAccent(event.target.value)}
            />
          </Field>
          <Field label="Logo URL" hint="Must be HTTPS.">
            <input
              className="ops-input"
              value={logoUrl}
              placeholder="https://…"
              onChange={(event) => setLogoUrl(event.target.value)}
            />
          </Field>
          <Field label="Sign-in message" hint="Shown on their login screen.">
            <input
              className="ops-input"
              value={loginMessage}
              onChange={(event) => setLoginMessage(event.target.value)}
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Agents" sub={`${agents.length}`}>
        {agents.length === 0 ? (
          <p className="ops-small ops-muted">None authorized.</p>
        ) : (
          <div className="ops-col ops-gap-sm">
            {agents.map((agent) => (
              <div className="ops-row" key={agent.id}>
                <span className="ops-strong">{agent.name}</span>
                <Pill tone={agent.status === "revoked" ? "muted" : "good"}>{agent.status}</Pill>
                <ToolbarSpacer />
                {agent.status !== "revoked" && (
                  <Btn
                    size="sm"
                    variant="danger"
                    disabled={actions.busy === `revokeAgent_${agent.id}`}
                    onClick={() => actions.revokeAgent(agent.id)}
                  >
                    Revoke
                  </Btn>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="What actually takes effect">
        <Alert tone="neutral" title="Every control on this page is read by the control plane">
          The organization&apos;s <b>execution status</b> and <b>concurrent run limit</b> are checked
          when a run is created, and the <b>allowed email domains</b> when a team member is invited.
          Alongside those: a workflow&apos;s <b>status</b> (draft or paused blocks new runs) and its{" "}
          <b>assigned roles</b>, connection <b>revocation</b>, agent <b>revocation</b>, and disabling
          individual <b>users</b> — each on the relevant tab.
          <br />
          <br />
          There is still no general per-organization feature-flag store, and <b>plan</b> is recorded
          for reporting only: it imposes nothing on its own. Set the run limit if you need a ceiling.
        </Alert>
      </Panel>

      <TechnicalDetail label="Raw organization record">
        <CodeBlock value={org} />
      </TechnicalDetail>
    </div>
  );
}

/* -------------------------------------------------------------------------------- preview --- */

/**
 * Safe customer preview. The control plane has no impersonation endpoint, and minting a session
 * for another tenant from the browser would be a real security regression -- so this opens the
 * customer console the customer actually uses, and is explicit that it runs as the current
 * operator rather than pretending to be them.
 */
function PreviewButton({ org }: { org: Organization }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Btn onClick={() => setOpen(true)}>Preview as customer</Btn>
      {open && (
        <Modal
          title="Preview the customer experience"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Btn onClick={() => setOpen(false)}>Cancel</Btn>
              <Btn variant="primary" href="/console/">
                Open customer console
              </Btn>
            </>
          }
        >
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            This opens the customer console at <code>/console</code> — the same surface{" "}
            <b>{org.branding?.displayName || org.name}</b> uses, including their branding.
          </p>
          <Alert tone="waiting" title="This is not impersonation">
            You will still be signed in as yourself, so you will see your own tenant&apos;s data,
            not theirs. The control plane exposes no impersonation or session-assumption endpoint,
            and adding one from the browser would weaken the tenant boundary. To see exactly what
            they see, use a test user provisioned inside their organization.
          </Alert>
        </Modal>
      )}
    </>
  );
}
