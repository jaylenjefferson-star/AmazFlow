// The internal console's route bodies and its two data-free shells.
//
// Extracted from `page.tsx` so task 9.13's rendering tests can render them directly: a state that can
// only be reached by mounting a page, running two effects, and waiting for a poll is a state nobody
// tests, and the untested one here would be the access-denied shell — the single most important thing
// on this surface to get right.

import { useEffect, useState, type FormEvent } from "react";
import type { ApiClient } from "@amazflow/api-client";
import {
  Alert,
  Btn,
  EmptyState,
  Field,
  Metrics,
  Panel,
  Pill,
  Select,
  SkeletonPanel,
} from "@amazflow/ui";
import type { ResourceSlot } from "@amazflow/domain-ui";
import type { Principal } from "@amazflow/permissions";

/**
 * Which read backs which section. A section absent from this map has no read yet and says so, rather
 * than rendering an empty list that implies AmazFlow looked and found nothing.
 */
export const SECTION_RESOURCE: Record<string, string> = {
  overview: "organizations",
  approvals: "runs",
  exceptions: "runs",
  organizations: "organizations",
  users: "organizations",
  runs: "runs",
  workflows: "workflows",
  studio: "workflows",
  agents: "agents",
  connections: "connections",
  activity: "activity",
  leads: "leads",
  support: "tickets",
  health: "health",
  settings: "settings",
};

/**
 * The staff sections backed by the control-plane reads already available to this origin.
 *
 * The legacy console showed these lists from a browser-local store. These tables use the staff APIs
 * instead: a list is only a staff list if its records came from the cross-organization route the
 * staff permission protects.
 */
export function StaffSection({
  routeId,
  slots,
  client,
  refresh,
}: {
  routeId: string;
  slots: Record<string, ResourceSlot<unknown>>;
  client?: ApiClient;
  refresh?: () => Promise<void>;
}) {
  // There is deliberately no feature-flag write or list endpoint. Runtime behaviour currently reads
  // no flags, and presenting a proposal form or a list of decorative switches would claim a control
  // plane behaviour that does not exist.
  if (routeId === "flags")
    return <EmptyState title="No runtime feature flags" body="This release has no feature flags read by runtime behaviour, so there are no switches to configure." />;
  const key = SECTION_RESOURCE[routeId];
  if (!key)
    return (
      <EmptyState
        title="This section moves here in a later phase"
        body="Today's staff console at /app is still the live one, and it stays live until the cutover."
      />
    );

  const slot = slots[key];
  if (!slot || slot.state === "loading")
    return (
      <div aria-busy="true" aria-live="polite">
        <SkeletonPanel rows={4} />
      </div>
    );
  if (slot.state === "unavailable")
    return <EmptyState title="Not available to your role" body="Staff hold no grant for this section." />;
  if (slot.state === "error")
    return (
      <Alert tone="bad" title="This did not load">
        {slot.error}
      </Alert>
    );

  const rows = Array.isArray(slot.value) ? (slot.value as Record<string, unknown>[]) : [];
  if (Array.isArray(slot.value) && rows.length === 0)
    return <EmptyState title="Nothing here yet" body="This section is empty, not broken." />;
  if (routeId === "overview")
    return <Overview organizations={rows} runs={slots.runs?.value as Record<string, unknown>[] | undefined} agents={slots.agents?.value as Record<string, unknown>[] | undefined} />;
  if (routeId === "approvals")
    return <RunQueue rows={rows.filter((row) => row.status === "WAITING_APPROVAL")} empty="No approvals are waiting across organizations." />;
  if (routeId === "exceptions")
    return <RunQueue rows={rows.filter((row) => row.status === "FAILED" || row.status === "TIMED_OUT")} empty="No runs need attention across organizations." />;
  if (routeId === "health" || routeId === "settings")
    return <Facts value={(slot.value ?? {}) as Record<string, unknown>} />;
  if (routeId === "users" && client)
    return <StaffUsers organizations={rows as Organization[]} client={client} />;
  if (routeId === "organizations" && client && refresh)
    return <OrganizationsManager rows={rows} client={client} refresh={refresh} runs={(slots.runs?.value ?? []) as Record<string, unknown>[]} workflows={(slots.workflows?.value ?? []) as Record<string, unknown>[]} agents={(slots.agents?.value ?? []) as Record<string, unknown>[]} connections={(slots.connections?.value ?? []) as Record<string, unknown>[]} />;
  return <Table routeId={routeId} rows={rows} />;
}

const label = (value: unknown, fallback = "Not recorded") =>
  value === null || value === undefined || value === "" ? fallback : String(value);

function Overview({ organizations, runs = [], agents = [] }: { organizations: Record<string, unknown>[]; runs?: Record<string, unknown>[]; agents?: Record<string, unknown>[] }) {
  const live = runs.filter((run) => ["RUNNING", "WAITING_AGENT", "WAITING_APPROVAL", "WAITING_CONFIRMATION"].includes(String(run.status))).length;
  const attention = runs.filter((run) => ["FAILED", "TIMED_OUT"].includes(String(run.status))).length;
  const connected = agents.filter((agent) => agent.connectionStatus === "connected").length;
  return <Metrics items={[
    { label: "Organizations", value: organizations.length },
    { label: "Live runs", value: live, tone: live ? "waiting" : undefined },
    { label: "Needs attention", value: attention, tone: attention ? "bad" : "good" },
    { label: "Connected agents", value: connected, tone: connected ? "good" : undefined },
  ]} />;
}

function RunQueue({ rows, empty }: { rows: Record<string, unknown>[]; empty: string }) {
  if (!rows.length) return <EmptyState title="Nothing here yet" body={empty} />;
  return <div className="ops-tablewrap"><table className="ops-table"><thead><tr><th>Run</th><th>Organization</th><th>Workflow</th><th>Status</th><th>Started</th></tr></thead><tbody>{rows.slice(0, 100).map((run, index) => <tr key={label(run.id, String(index))}><td>{label(run.id)}</td><td>{label(run.tenantId)}</td><td>{label(run.workflowName ?? run.workflowId)}</td><td><Pill tone={run.status === "FAILED" || run.status === "TIMED_OUT" ? "bad" : "waiting"}>{label(run.status)}</Pill></td><td>{label(run.startedAt ?? run.createdAt)}</td></tr>)}</tbody></table></div>;
}

function Facts({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value).filter(([, item]) => typeof item !== "object" || item === null);
  if (!entries.length) return <EmptyState title="Nothing recorded" body="The control plane returned no displayable facts for this section." />;
  return <div className="ops-tablewrap"><table className="ops-table"><thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>{entries.map(([key, item]) => <tr key={key}><th scope="row">{key}</th><td>{typeof item === "boolean" ? (item ? "Yes" : "No") : label(item)}</td></tr>)}</tbody></table></div>;
}

type Organization = {
  id: string;
  name: string;
  slug: string;
  status?: string;
  lifecycleStatus?: string;
  plan?: string;
  activatedAt?: string | null;
};

function OrganizationsManager({ rows, client, refresh, runs, workflows, agents, connections }: { rows: Record<string, unknown>[]; client: ApiClient; refresh: () => Promise<void>; runs: Record<string, unknown>[]; workflows: Record<string, unknown>[]; agents: Record<string, unknown>[]; connections: Record<string, unknown>[] }) {
  const organizations = rows as Organization[];
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const busy = pending !== null;
  const mutate = async (key: string, success: string, operation: () => Promise<unknown>) => {
    if (busy) return;
    setPending(key);
    setMessage(null);
    try {
      await operation();
      await refresh();
      setMessage({ tone: "good", text: success });
    } catch (error) {
      setMessage({ tone: "bad", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(null);
    }
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    void mutate("create", `Created ${name.trim()}.`, async () => {
      await client.post("/organizations", { name: name.trim(), ...(slug.trim() ? { slug: slug.trim() } : {}) });
      setName("");
      setSlug("");
    });
  };
  return <div className="ops-col ops-gap-md">
    <OrganizationUsage organizations={organizations} runs={runs} workflows={workflows} agents={agents} connections={connections} />
    <Panel title="Create organization" sub="The tenant slug is permanent once created.">
      <form className="ops-toolbar" onSubmit={create}>
        <input className="ops-input" aria-label="Organization name" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} placeholder="Organization name" required />
        <input className="ops-input" aria-label="Tenant slug" value={slug} onChange={(event) => setSlug(event.target.value)} disabled={busy} placeholder="Optional permanent slug" />
        <Btn type="submit" variant="primary" disabled={busy || !name.trim()}>{pending === "create" ? "Creating…" : "Create organization"}</Btn>
      </form>
    </Panel>
    {message && <Alert tone={message.tone} title={message.tone === "good" ? "Saved" : "This did not work"}>{message.text}</Alert>}
    <Alert title="Execution and commercial state are separate">Changing a commercial lifecycle never stops execution. When handling a churned customer, set the execution status explicitly after deciding what should happen to live work.</Alert>
    {organizations.length === 0 ? <EmptyState title="Nothing here yet" body="Create the first organization when a customer is ready to be configured." /> : <div className="ops-col ops-gap-sm">{organizations.map((organization) => <OrganizationEditor key={organization.id} organization={organization} client={client} busy={busy} pending={pending} save={mutate} />)}</div>}
  </div>;
}

function OrganizationUsage({ organizations, runs, workflows, agents, connections }: { organizations: Organization[]; runs: Record<string, unknown>[]; workflows: Record<string, unknown>[]; agents: Record<string, unknown>[]; connections: Record<string, unknown>[] }) {
  if (!organizations.length) return null;
  const count = (items: Record<string, unknown>[], org: Organization, active?: (item: Record<string, unknown>) => boolean) =>
    items.filter((item) => item.tenantId === org.slug && (!active || active(item))).length;
  return <Panel title="Customer usage summary" sub="Counts are derived from live control-plane records, not a billing estimate.">
    <div className="ops-tablewrap"><table className="ops-table"><thead><tr><th>Organization</th><th>Runs</th><th>Active workflows</th><th>Connected agents</th><th>Active connections</th></tr></thead><tbody>{organizations.map((organization) => <tr key={organization.id}><td>{organization.name}</td><td>{count(runs, organization)}</td><td>{count(workflows, organization, (workflow) => workflow.status === "active")}</td><td>{count(agents, organization, (agent) => agent.connectionStatus === "connected")}</td><td>{count(connections, organization, (connection) => connection.status === "active")}</td></tr>)}</tbody></table></div>
  </Panel>;
}

type StaffUser = {
  username?: string;
  email?: string;
  platformRole?: string;
  state?: string;
  lastLoginAt?: string | null;
  tenantId: string;
};

function StaffUsers({ organizations, client }: { organizations: Organization[]; client: ApiClient }) {
  const [state, setState] = useState<{ loading: boolean; users: StaffUser[]; error: string | null }>({ loading: true, users: [], error: null });
  useEffect(() => {
    let current = true;
    void Promise.allSettled(organizations.map(async (organization) => {
      const users = await client.get<Omit<StaffUser, "tenantId">[]>(`/tenants/${encodeURIComponent(organization.slug)}/users`);
      return users.map((user) => ({ ...user, tenantId: organization.slug }));
    })).then((settled) => {
      if (!current) return;
      const failed = settled.find((result) => result.status === "rejected");
      if (failed && failed.status === "rejected") {
        setState({ loading: false, users: [], error: failed.reason instanceof Error ? failed.reason.message : String(failed.reason) });
        return;
      }
      setState({ loading: false, users: settled.flatMap((result) => result.status === "fulfilled" ? result.value : []), error: null });
    });
    return () => { current = false; };
  }, [client, organizations]);
  if (state.loading) return <div aria-busy="true" aria-live="polite"><SkeletonPanel rows={4} /></div>;
  if (state.error) return <Alert tone="bad" title="The user directory did not load">{state.error}</Alert>;
  if (!state.users.length) return <EmptyState title="No organization members" body="No customer accounts are recorded across the organizations you can view." />;
  return <div className="ops-tablewrap"><table className="ops-table"><thead><tr><th>Person</th><th>Organization</th><th>Role</th><th>State</th><th>Last sign-in</th></tr></thead><tbody>{state.users.map((user, index) => <tr key={`${user.tenantId}-${user.username ?? user.email ?? index}`}><td>{label(user.email ?? user.username)}</td><td>{user.tenantId}</td><td>{label(user.platformRole)}</td><td>{label(user.state)}</td><td>{label(user.lastLoginAt)}</td></tr>)}</tbody></table></div>;
}

function OrganizationEditor({ organization, client, busy, pending, save }: { organization: Organization; client: ApiClient; busy: boolean; pending: string | null; save: (key: string, success: string, operation: () => Promise<unknown>) => Promise<void> }) {
  const [status, setStatus] = useState(organization.status ?? "active");
  const [lifecycleStatus, setLifecycleStatus] = useState(organization.lifecycleStatus ?? "active");
  const [plan, setPlan] = useState(organization.plan ?? "");
  const key = `organization-${organization.id}`;
  return <Panel title={organization.name} sub={`Tenant: ${organization.slug}`}>
    <form className="ops-col ops-gap-sm" onSubmit={(event) => { event.preventDefault(); void save(key, `Updated ${organization.name}.`, () => client.put(`/organizations/${encodeURIComponent(organization.slug)}`, { status, lifecycleStatus, plan })); }}>
      <div className="ops-grid-2">
        <Select value={status} onChange={setStatus} label="Execution status" options={[{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }, { value: "suspended", label: "Suspended" }]} />
        <Select value={lifecycleStatus} onChange={setLifecycleStatus} label="Commercial lifecycle" options={[{ value: "prospect", label: "Prospect" }, { value: "onboarding", label: "Onboarding" }, { value: "trial", label: "Trial" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "canceled", label: "Canceled / churned" }]} />
      </div>
      <Field label="Plan" hint="Reporting-only: this field does not enforce runtime limits."><input className="ops-input" value={plan} onChange={(event) => setPlan(event.target.value)} disabled={busy} /></Field>
      <div><Btn type="submit" variant="primary" disabled={busy}>{pending === key ? "Saving…" : "Save organization"}</Btn></div>
    </form>
  </Panel>;
}

function Table({ routeId, rows }: { routeId: string; rows: Record<string, unknown>[] }) {
  const headings = routeId === "organizations" ? ["Organization", "Execution", "Commercial", "Plan", "Activated"] :
    routeId === "runs" ? ["Run", "Organization", "Workflow", "Status", "Started"] :
    routeId === "workflows" || routeId === "studio" ? ["Workflow", "Organization", "Status", "Version", "Updated"] :
    routeId === "connections" ? ["Connection", "Organization", "Location", "Status", "Mode"] :
    routeId === "agents" ? ["Agent", "Organization", "Surface", "Connectivity", "Last seen"] :
    routeId === "activity" ? ["When", "Organization", "Action", "Summary", "Actor"] :
    routeId === "leads" ? ["Lead", "Company", "Status", "Submitted"] :
    ["Ticket", "Organization", "Status", "Subject", "Updated"];
  const cells = (row: Record<string, unknown>) => {
    if (routeId === "organizations") return [label(row.name ?? row.slug), label(row.status), label(row.lifecycleStatus), `${label(row.plan)} (reporting-only)`, label(row.activatedAt)];
    if (routeId === "runs") return [label(row.id), label(row.tenantId), label(row.workflowName ?? row.workflowId), label(row.status), label(row.startedAt ?? row.createdAt)];
    if (routeId === "workflows" || routeId === "studio") return [label(row.name ?? row.id), label(row.tenantId), label(row.status), label(row.version), label(row.updatedAt)];
    if (routeId === "connections") return [label(row.name ?? row.id), label(row.tenantId), label(row.baseUrl), label(row.status), label(row.preferredMode)];
    if (routeId === "agents") return [label(row.name ?? row.id), label(row.organizationId ?? row.tenantId), label(row.agentType), label(row.connectionStatus), label(row.lastSeenAt)];
    if (routeId === "activity") return [label(row.at), label(row.tenantId), label(row.action), label(row.summary), label(row.actorLabel ?? row.actor)];
    if (routeId === "leads") return [label(row.name ?? row.email ?? row.id), label(row.company), label(row.status), label(row.createdAt)];
    return [label(row.id), label(row.tenantId), label(row.status), label(row.subject), label(row.updatedAt ?? row.createdAt)];
  };
  return <div className="ops-tablewrap"><table className="ops-table"><thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((row, index) => <tr key={label(row.id ?? row.slug, String(index))}>{cells(row).map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

/**
 * The access-denied shell: requirement 2.3 and 2.4, and task 9.7's "data-free" is the load-bearing
 * word.
 *
 * There is no table here waiting to be filled, no provider mounted, and no request in flight. A
 * customer who downloads this bundle and opens this origin gets this page and nothing else. It names
 * the principal's own organization — which the person already knows, since it is their own — and names
 * no other, because a message that said "this is for AmazFlow staff, you are org X of Y" would be
 * leaking the shape of the tenancy to make a point about it.
 */
export function AccessDenied({ principal }: { principal: Principal }) {
  return (
    <div className="ops-boot" role="alert">
      <h1>This is the AmazFlow staff console</h1>
      <p>
        Your account is a member of <strong>{principal.orgId}</strong> and does not have access here.
        Nothing on this page is loaded from AmazFlow, and no organization&rsquo;s data has been
        requested.
      </p>
      <p>
        Your own workspace is at <a href="https://app.amazflow.com/">app.amazflow.com</a>.
      </p>
    </div>
  );
}

export function NoOrganizationShell() {
  return (
    <div className="ops-boot" role="alert">
      <h1>This account is not attached to an organization</h1>
      <p>
        The sign-in worked, but the account carries no organization claim, so there is no workspace to
        open. An AmazFlow administrator can attach it.
      </p>
    </div>
  );
}
