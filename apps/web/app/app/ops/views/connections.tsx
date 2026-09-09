"use client";

/**
 * Connections — the integrations console.
 *
 * Connections are treated as first-class AmazFlow objects: which organization owns them, whether
 * they are authenticated, what origins they are scoped to, and which workflows depend on them.
 * No AWS implementation detail appears here; a connection is a system AmazFlow Browser can sign
 * in to and act within.
 */

import { useMemo, useState } from "react";
import { useOps, type BrowserConnection } from "../data";
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
  Metrics,
  Modal,
  Panel,
  Pill,
  ResultCount,
  SearchInput,
  Select,
  Tag,
  TechnicalDetail,
  Toolbar,
  ToolbarSpacer,
  type Column,
  Chevron,
} from "../primitives";
import {
  BROWSER_MODE_LABEL,
  CONNECTION_STATUS_LABEL,
  CONNECTION_STATUS_TONE,
  absoluteTime,
  relativeTime,
} from "../terms";

/** Connectors the platform has prepared credential infrastructure for but not shipped. */
const PLANNED = [
  { name: "Gmail", kind: "Email" },
  { name: "Microsoft 365", kind: "Email" },
  { name: "HRIS", kind: "Connected API" },
  { name: "Spreadsheets", kind: "Spreadsheet" },
  { name: "Generic API", kind: "Connected API" },
];

export function ConnectionsView() {
  const ops = useOps();
  const nav = useNav();
  const actions = useOpsActions();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [orgFilter, setOrgFilter] = useState("all");
  const [creating, setCreating] = useState(nav.view.view === "new");

  const filtered = useMemo(() => {
    let list = ops.connections;
    if (statusFilter !== "all") list = list.filter((connection) => connection.status === statusFilter);
    if (orgFilter !== "all") list = list.filter((connection) => connection.tenantId === orgFilter);
    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (connection) =>
          connection.name.toLowerCase().includes(needle) ||
          connection.baseUrl.toLowerCase().includes(needle) ||
          ops.orgLabel(connection.tenantId).toLowerCase().includes(needle),
      );
    }
    return list;
  }, [ops, statusFilter, orgFilter, search]);

  const counts = useMemo(
    () => ({
      active: ops.connections.filter((connection) => connection.status === "active").length,
      pending: ops.connections.filter((connection) => connection.status === "pending").length,
      revoked: ops.connections.filter((connection) => connection.status === "revoked").length,
      error: ops.connections.filter((connection) => connection.status === "error").length,
      orphaned: ops.connections.filter(
        (connection) =>
          connection.status === "active" && ops.workflowsUsingConnection(connection.id).length === 0,
      ).length,
    }),
    [ops],
  );

  const columns: Column<BrowserConnection>[] = [
    {
      key: "status",
      header: "State",
      width: 132,
      nowrap: true,
      sort: (a, b) => a.status.localeCompare(b.status),
      render: (connection) => (
        <Pill tone={CONNECTION_STATUS_TONE[connection.status] ?? "neutral"} dot={connection.status === "pending"}>
          {CONNECTION_STATUS_LABEL[connection.status] ?? connection.status}
        </Pill>
      ),
    },
    {
      key: "name",
      header: "Connection",
      primary: true,
      sort: (a, b) => a.name.localeCompare(b.name),
      render: (connection) => <CellStack top={connection.name} bottom={connection.baseUrl} />,
    },
    {
      key: "org",
      header: "Organization",
      sort: (a, b) => ops.orgLabel(a.tenantId).localeCompare(ops.orgLabel(b.tenantId)),
      render: (connection) => ops.orgLabel(connection.tenantId),
    },
    {
      key: "mode",
      header: "Mode",
      width: 190,
      render: (connection) => (
        <Pill tone="muted">{BROWSER_MODE_LABEL[connection.preferredMode] ?? connection.preferredMode}</Pill>
      ),
    },
    {
      key: "origins",
      header: "Scoped origins",
      align: "right",
      width: 116,
      render: (connection) => (
        <span className="ops-cell-num">
          {connection.allowedOrigins.length || <span className="ops-muted">base URL only</span>}
        </span>
      ),
    },
    {
      key: "dependents",
      header: "Workflows",
      align: "right",
      width: 96,
      sort: (a, b) =>
        ops.workflowsUsingConnection(a.id).length - ops.workflowsUsingConnection(b.id).length,
      render: (connection) => {
        const count = ops.workflowsUsingConnection(connection.id).length;
        return count === 0 ? (
          <span className="ops-muted">none</span>
        ) : (
          <span className="ops-cell-num">{count}</span>
        );
      },
    },
    {
      key: "updated",
      header: "Last change",
      nowrap: true,
      width: 118,
      sort: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
      render: (connection) => (
        <span title={absoluteTime(connection.updatedAt)}>{relativeTime(connection.updatedAt)}</span>
      ),
    },
    { key: "open", header: "", align: "right", width: 36, render: () => <Chevron /> },
  ];

  return (
    <>
      <PageHead
        title="Connections"
        sub="Systems AmazFlow can sign in to and act within, per organization. A workflow step can only reach a system through one of these."
        actions={
          <Btn variant="primary" glyph="plus" onClick={() => setCreating(true)}>
            New connection
          </Btn>
        }
      />

      <Metrics
        items={[
          {
            label: "Signed in",
            value: counts.active,
            tone: counts.active > 0 ? "good" : undefined,
            foot: "Ready to execute",
            onClick: () => setStatusFilter("active"),
          },
          {
            label: "Need sign-in",
            value: counts.pending,
            tone: counts.pending > 0 ? "waiting" : undefined,
            foot: "Created but not authenticated",
            onClick: () => setStatusFilter("pending"),
          },
          {
            label: "In error",
            value: counts.error,
            tone: counts.error > 0 ? "bad" : "good",
            onClick: () => setStatusFilter("error"),
          },
          {
            label: "Revoked",
            value: counts.revoked,
            foot: "No longer usable",
            onClick: () => setStatusFilter("revoked"),
          },
          {
            label: "Unused",
            value: counts.orphaned,
            tone: counts.orphaned > 0 ? "waiting" : undefined,
            foot: "Signed in but no workflow needs them",
          },
        ]}
      />

      <div className="ops-section">
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search connections…" />
          <Select
            label="State"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All states" },
              { value: "active", label: "Signed in" },
              { value: "pending", label: "Needs sign-in" },
              { value: "error", label: "Error" },
              { value: "revoked", label: "Revoked" },
            ]}
          />
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
          <ToolbarSpacer />
          <ResultCount shown={filtered.length} total={ops.connections.length} noun="connection" />
        </Toolbar>

        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(connection) => connection.id}
          onRowClick={(connection) => nav.openConnection(connection.id)}
          rowTone={(connection) => (connection.status === "error" ? "bad" : undefined)}
          loading={ops.loading && ops.connections.length === 0}
          emptyState={
            <EmptyState
              glyph="connections"
              title={ops.connections.length === 0 ? "No connections yet" : "No connections match"}
              body={
                ops.connections.length === 0
                  ? "Create a connection, sign in to it once through an isolated session, then reference it from a browser step."
                  : "Try clearing the filters."
              }
              actions={
                ops.connections.length === 0 ? (
                  <Btn variant="primary" onClick={() => setCreating(true)}>
                    New connection
                  </Btn>
                ) : undefined
              }
            />
          }
        />
      </div>

      <div className="ops-section">
        <Panel title="Other integrations" sub="Not available yet">
          <div className="ops-col ops-gap-sm">
            {PLANNED.map((connector) => (
              <div className="ops-row" key={connector.name}>
                <span className="ops-strong" style={{ minWidth: 160 }}>
                  {connector.name}
                </span>
                <Pill tone="muted">{connector.kind}</Pill>
                <ToolbarSpacer />
                <span className="ops-small ops-muted">Not yet available</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <p className="ops-small ops-muted">
              Credential-provider infrastructure exists for these, but no connector has shipped.
              Until then, reaching one of these systems means driving it through AmazFlow Browser.
            </p>
          </div>
        </Panel>
      </div>

      {creating && <NewConnectionModal onClose={() => setCreating(false)} />}
      {actions.busy === null && null}
    </>
  );
}

function NewConnectionModal({ onClose }: { onClose: () => void }) {
  const ops = useOps();
  const actions = useOpsActions();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [tenantId, setTenantId] = useState(ops.organizations[0]?.slug ?? "");
  const [mode, setMode] = useState("auto");

  const valid = name.trim() && /^https:\/\/.+/.test(baseUrl.trim()) && tenantId;

  return (
    <Modal
      title="New connection"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            variant="primary"
            disabled={!valid || actions.busy === "createConnection"}
            onClick={async () => {
              const created = await actions.createConnection({
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                tenantId,
                preferredMode: mode,
              });
              if (created) onClose();
            }}
          >
            Create connection
          </Btn>
        </>
      }
    >
      <Field label="Connection name" hint="What the team calls this system.">
        <input
          className="ops-input"
          value={name}
          autoFocus
          placeholder="HR portal"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label="Base URL" hint="Must be a public HTTPS address.">
        <input
          className="ops-input"
          value={baseUrl}
          placeholder="https://portal.example.com"
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </Field>
      <Field label="Organization">
        <select
          className="ops-select"
          value={tenantId}
          onChange={(event) => setTenantId(event.target.value)}
        >
          {ops.organizations.map((org) => (
            <option key={org.slug} value={org.slug}>
              {org.branding?.displayName || org.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Execution mode"
        hint="Automatic lets AmazFlow choose the hosted browser and fall back to a Chrome Agent when it must."
      >
        <select className="ops-select" value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="auto">Automatic</option>
          <option value="managed">AmazFlow Browser only</option>
          <option value="connected">Chrome Agent only</option>
        </select>
      </Field>
      <Alert tone="neutral" title="Next step">
        The connection starts as <b>needs sign-in</b>. Open it and sign in once through an isolated
        session — the credentials stay in an encrypted profile AmazFlow controls, never in a
        workflow definition.
      </Alert>
    </Modal>
  );
}

/* ============================================================================== detail view = */

export function ConnectionDetailView({ connectionId }: { connectionId: string }) {
  const ops = useOps();
  const nav = useNav();
  const actions = useOpsActions();

  const connection = ops.connections.find((candidate) => candidate.id === connectionId);
  useDetailCrumb(connection?.name ?? connectionId);

  const [loginSession, setLoginSession] = useState<{ loginSessionId: string; expiresAt: string } | null>(
    null,
  );
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  if (!connection) {
    return (
      <EmptyState
        glyph="connections"
        title="That connection no longer exists"
        actions={<Btn onClick={() => nav.goSection("connections")}>Back to connections</Btn>}
      />
    );
  }

  const dependents = ops.workflowsUsingConnection(connection.id);
  const org = ops.orgByTenant(connection.tenantId);

  // Runs whose steps reference this connection, so an operator can see it actually working.
  const relatedRuns = ops.runs
    .filter((run) => {
      const workflow = ops.workflowById(run.workflowId);
      if (!workflow) return false;
      return workflow.steps.some(
        (step) => step.type === "action" && step.connectionId === connection.id,
      );
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);

  return (
    <>
      <PageHead
        title={connection.name}
        pills={
          <>
            <Pill tone={CONNECTION_STATUS_TONE[connection.status] ?? "neutral"} dot={connection.status === "pending"}>
              {CONNECTION_STATUS_LABEL[connection.status] ?? connection.status}
            </Pill>
            <Pill tone="muted">{BROWSER_MODE_LABEL[connection.preferredMode]}</Pill>
          </>
        }
        sub={
          <>
            {connection.baseUrl} · {ops.orgLabel(connection.tenantId)}
          </>
        }
        actions={
          <>
            {org && <Btn onClick={() => nav.openOrg(org.slug)}>Open organization</Btn>}
            {connection.status !== "revoked" && (
              <>
                {loginSession ? (
                  <Btn
                    variant="primary"
                    disabled={actions.busy === `loginDone_${connection.id}`}
                    onClick={async () => {
                      const done = await actions.completeConnectionLogin(
                        connection.id,
                        loginSession.loginSessionId,
                      );
                      if (done) setLoginSession(null);
                    }}
                  >
                    Finish sign-in
                  </Btn>
                ) : (
                  <Btn
                    variant="primary"
                    disabled={actions.busy === `login_${connection.id}`}
                    onClick={async () => {
                      const session = await actions.beginConnectionLogin(connection.id);
                      if (session) setLoginSession(session);
                    }}
                  >
                    {connection.status === "active" ? "Refresh sign-in" : "Sign in"}
                  </Btn>
                )}
                <Btn variant="danger" onClick={() => setConfirmRevoke(true)}>
                  Revoke
                </Btn>
              </>
            )}
          </>
        }
      />

      {loginSession && (
        <Alert tone="waiting" title="Sign-in session open">
          A live browser session opened in a new tab. Sign in to {connection.baseUrl} there, then
          come back and choose <b>Finish sign-in</b>. The session expires{" "}
          {relativeTime(loginSession.expiresAt)}.
        </Alert>
      )}

      {connection.status === "pending" && !loginSession && (
        <Alert tone="waiting" title="This connection can't execute yet">
          It has never been signed in, so any workflow step depending on it will fail or fall back
          to a Chrome Agent.
        </Alert>
      )}

      {connection.status === "active" && dependents.length === 0 && (
        <Alert tone="waiting" title="Signed in but unused">
          No workflow step references this connection. It is holding a credential profile for
          nothing — consider revoking it.
        </Alert>
      )}

      <div className="ops-section">
        <div className="ops-split">
          <div className="ops-col">
            <Panel title="Workflows depending on this connection" sub={`${dependents.length}`}>
              {dependents.length === 0 ? (
                <p className="ops-small ops-muted">Nothing depends on this connection.</p>
              ) : (
                <div className="ops-col ops-gap-sm">
                  {dependents.map((workflow) => {
                    const explicit = workflow.steps.some(
                      (step) => step.type === "action" && step.connectionId === connection.id,
                    );
                    return (
                      <button
                        key={workflow.id}
                        className="ops-row"
                        style={{ width: "100%" }}
                        onClick={() => nav.openWorkflow(workflow.id)}
                      >
                        <span className="ops-strong ops-truncate" style={{ flex: 1 }}>
                          {workflow.name}
                        </span>
                        <Pill tone={explicit ? "muted" : "waiting"}>
                          {explicit ? "explicit" : "resolved at run time"}
                        </Pill>
                        <Chevron />
                      </button>
                    );
                  })}
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <p className="ops-small ops-muted">
                  &ldquo;Resolved at run time&rdquo; means the step doesn&apos;t name a connection,
                  so the control plane picks this organization&apos;s active one when it executes.
                </p>
              </div>
            </Panel>

            <Panel title="Recent runs using it" sub={`${relatedRuns.length}`}>
              {relatedRuns.length === 0 ? (
                <p className="ops-small ops-muted">
                  No run has referenced this connection explicitly.
                </p>
              ) : (
                <div className="ops-col ops-gap-sm">
                  {relatedRuns.map((run) => (
                    <button
                      key={run.id}
                      className="ops-row"
                      style={{ width: "100%" }}
                      onClick={() => nav.openRun(run.id)}
                    >
                      <span className="ops-truncate" style={{ flex: 1 }}>
                        {ops.workflowById(run.workflowId)?.name ?? run.workflowId}
                      </span>
                      <span className="ops-small ops-muted ops-nowrap">
                        {relativeTime(run.createdAt)}
                      </span>
                      <Chevron />
                    </button>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="ops-col">
            <Panel title="Configuration">
              <KeyValue
                rows={[
                  { label: "Organization", value: ops.orgLabel(connection.tenantId) },
                  { label: "Base URL", value: <code>{connection.baseUrl}</code> },
                  {
                    label: "Allowed origins",
                    value:
                      connection.allowedOrigins.length === 0 ? (
                        <span className="ops-muted">base URL only</span>
                      ) : (
                        <span className="ops-row ops-gap-sm ops-row-wrap">
                          {connection.allowedOrigins.map((origin) => (
                            <Tag key={origin}>{origin}</Tag>
                          ))}
                        </span>
                      ),
                  },
                  { label: "Mode", value: BROWSER_MODE_LABEL[connection.preferredMode] },
                  { label: "Created", value: absoluteTime(connection.createdAt) },
                  { label: "Created by", value: connection.createdBy ?? "—" },
                  { label: "Last change", value: absoluteTime(connection.updatedAt) },
                ]}
              />
            </Panel>

            <Panel title="Health telemetry">
              <Alert tone="neutral" title="Not recorded yet">
                The control plane stores no last-successful-use timestamp, failure counter, granted
                scopes, or credential-expiry for a connection. The only durable signals are its{" "}
                <b>state</b> and when it last changed — both shown above. Everything else on this
                page is derived from workflow definitions and run history.
              </Alert>
            </Panel>

            <TechnicalDetail label="Raw connection record">
              <CodeBlock value={connection} />
              <div style={{ marginTop: 10 }}>
                <KeyValue
                  rows={[{ label: "Connection id", value: <IdChip value={connection.id} /> }]}
                />
              </div>
            </TechnicalDetail>
          </div>
        </div>
      </div>

      {confirmRevoke && (
        <Modal
          title="Revoke this connection?"
          onClose={() => setConfirmRevoke(false)}
          footer={
            <>
              <Btn onClick={() => setConfirmRevoke(false)}>Cancel</Btn>
              <Btn
                variant="danger"
                disabled={actions.busy === `revokeConn_${connection.id}`}
                onClick={async () => {
                  await actions.revokeConnection(connection.id);
                  setConfirmRevoke(false);
                }}
              >
                Revoke connection
              </Btn>
            </>
          }
        >
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            The stored credential profile is destroyed and this connection can no longer execute.
          </p>
          {dependents.length > 0 && (
            <Alert tone="bad" title={`${dependents.length} workflow${dependents.length === 1 ? "" : "s"} depend on it`}>
              {dependents.map((workflow) => workflow.name).join(", ")} — browser steps in{" "}
              {dependents.length === 1 ? "this workflow" : "these workflows"} will stop working or
              fall back to a Chrome Agent.
            </Alert>
          )}
        </Modal>
      )}
    </>
  );
}

/* =============================================================================== agents ==== */

export function AgentsView() {
  const ops = useOps();
  const nav = useNav();
  const actions = useOpsActions();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return ops.agents;
    return ops.agents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(needle) ||
        ops.orgLabel(agent.tenantId).toLowerCase().includes(needle) ||
        agent.allowedDomains.join(" ").toLowerCase().includes(needle),
    );
  }, [ops, search]);

  const online = (agent: { lastSeenAt: string | null; status: string }) =>
    agent.status !== "revoked" &&
    Boolean(agent.lastSeenAt) &&
    Date.now() - new Date(agent.lastSeenAt as string).getTime() < 10 * 60_000;

  return (
    <>
      <PageHead
        title="Chrome Agents"
        sub="The fallback executor: a Chrome extension used when a target is private, local, or has authentication AmazFlow Browser can't complete."
        actions={
          <Btn href="/downloads/amazflow-agent.zip" download glyph="download">
            Download extension
          </Btn>
        }
      />

      <Metrics
        items={[
          {
            label: "Connected now",
            value: ops.agents.filter(online).length,
            tone: ops.agents.filter(online).length > 0 ? "good" : undefined,
            foot: "Seen in the last 10 minutes",
          },
          {
            label: "Authorized",
            value: ops.agents.filter((agent) => agent.status !== "revoked").length,
            foot: `${ops.agents.length} total`,
          },
          {
            label: "Revoked",
            value: ops.agents.filter((agent) => agent.status === "revoked").length,
          },
          {
            label: "Open browser tasks",
            value: ops.agentTasks.length,
            tone: ops.agentTasks.length > 0 ? "waiting" : undefined,
            foot: "Runs waiting on a browser",
          },
        ]}
      />

      <div className="ops-section">
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search agents…" />
          <ToolbarSpacer />
          <ResultCount shown={filtered.length} total={ops.agents.length} noun="agent" />
        </Toolbar>

        <DataTable
          rows={filtered}
          columns={[
            {
              key: "status",
              header: "State",
              width: 150,
              nowrap: true,
              render: (agent) =>
                agent.status === "revoked" ? (
                  <Pill tone="muted">Revoked</Pill>
                ) : online(agent) ? (
                  <Pill tone="good" dot>
                    Connected
                  </Pill>
                ) : agent.lastSeenAt ? (
                  <Pill tone="waiting">Offline</Pill>
                ) : (
                  <Pill tone="muted">Never connected</Pill>
                ),
            },
            {
              key: "name",
              header: "Agent",
              primary: true,
              sort: (a, b) => a.name.localeCompare(b.name),
              render: (agent) => (
                <CellStack
                  top={agent.name}
                  bottom={agent.version ? `extension v${agent.version}` : "version not reported"}
                />
              ),
            },
            {
              key: "org",
              header: "Organization",
              render: (agent) => ops.orgLabel(agent.tenantId),
            },
            {
              key: "domains",
              header: "Scoped to",
              render: (agent) =>
                agent.allowedDomains.length === 0 ? (
                  <span className="ops-muted">no domains scoped</span>
                ) : (
                  <span className="ops-truncate">{agent.allowedDomains.join(", ")}</span>
                ),
            },
            {
              key: "seen",
              header: "Last seen",
              nowrap: true,
              width: 116,
              sort: (a, b) => (a.lastSeenAt ?? "").localeCompare(b.lastSeenAt ?? ""),
              render: (agent) =>
                agent.lastSeenAt ? (
                  <span title={absoluteTime(agent.lastSeenAt)}>{relativeTime(agent.lastSeenAt)}</span>
                ) : (
                  <span className="ops-muted">never</span>
                ),
            },
            {
              key: "actions",
              header: "",
              align: "right",
              width: 96,
              render: (agent) =>
                agent.status === "revoked" ? null : (
                  <div className="ops-rowactions">
                    <Btn
                      size="sm"
                      variant="danger"
                      disabled={actions.busy === `revokeAgent_${agent.id}`}
                      onClick={() => actions.revokeAgent(agent.id)}
                    >
                      Revoke
                    </Btn>
                  </div>
                ),
            },
          ]}
          rowKey={(agent) => agent.id}
          loading={ops.loading && ops.agents.length === 0}
          emptyState={
            <EmptyState
              glyph="agents"
              title="No Chrome Agents authorized"
              body="Install the extension in a browser that can reach the target system, then authorize it from the extension popup."
              inline
            />
          }
        />
      </div>

      <div className="ops-section">
        <Panel title="Open browser tasks" sub="Runs currently waiting on a browser">
          {ops.agentTasks.length === 0 ? (
            <EmptyState glyph="check" title="Nothing waiting" body="No run is blocked on a browser step." inline />
          ) : (
            <DataTable
              rows={ops.agentTasks}
              columns={[
                {
                  key: "operation",
                  header: "Operation",
                  primary: true,
                  render: (task) => <CellStack top={task.operation} bottom={task.stepId} />,
                },
                { key: "org", header: "Organization", render: (task) => ops.orgLabel(task.tenantId) },
                {
                  key: "run",
                  header: "Run",
                  render: (task) => {
                    const workflow = task.workflowId ? ops.workflowById(task.workflowId) : undefined;
                    return workflow?.name ?? task.runId;
                  },
                },
                {
                  key: "expires",
                  header: "Expires",
                  nowrap: true,
                  width: 128,
                  render: (task) => (
                    <span
                      className={
                        new Date(task.expiresAt).getTime() - Date.now() < 60_000 ? "ops-tone-bad" : undefined
                      }
                      title={absoluteTime(task.expiresAt)}
                    >
                      {relativeTime(task.expiresAt)}
                    </span>
                  ),
                },
                {
                  key: "open",
                  header: "",
                  align: "right",
                  width: 36,
                  render: () => <Chevron />,
                },
              ]}
              rowKey={(task) => task.id}
              onRowClick={(task) => nav.openRun(task.runId)}
            />
          )}
        </Panel>
      </div>

      <div className="ops-section">
        <Panel title="How an agent gets authorized">
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, lineHeight: 1.85 }}>
            <li>Download and unzip the extension, then load it unpacked in Chrome.</li>
            <li>
              Open the extension popup and choose <b>Connect to AmazFlow</b> — it opens a normal
              AmazFlow tab to sign in and authorize. No token is ever copied by hand.
            </li>
            <li>
              On the tab where the action should run, click <b>Enable on this site</b>. The agent
              only ever acts on origins granted this way.
            </li>
          </ol>
          <div style={{ marginTop: 12 }}>
            <p className="ops-small ops-muted">
              An authorized agent polls for short-lived, tenant-scoped tasks and executes only its
              explicit operation allowlist. Revoking it takes effect on its next poll.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
