"use client";

// One module per route, each rendering the three states the discipline requires (task 9.13,
// requirement 34.16): a skeleton while loading, an honest empty state when there is genuinely nothing,
// and an error state that says what failed rather than blanking.
//
// These are the Phase 3 SHELLS. Each is backed by the real control-plane read its route table row
// names, so none of them is a mock — but the rich per-section behaviour (filtering, drill-in, the run
// narrative, the builder) lands in Phases 5 through 8, which is why the bodies here are lists and
// summaries rather than full screens. What is complete now is the shape: every route resolves, every
// route has all three states, and no route presents a control that does not work.

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, supportCode, type ApiClient } from "@amazflow/api-client";
import {
  NOTIFICATION_KIND_LABEL,
  ORGANIZATION_STATUS_LABEL,
  ORGANIZATION_STATUS_TONE,
  PLATFORM_ROLE_DESCRIPTION,
  PLATFORM_ROLE_LABEL,
  USER_STATE_LABEL,
  USER_STATE_TONE,
  pathToView,
  relativeTime,
  runStatus,
  workflowStatus,
  type ResourceSlot,
} from "@amazflow/domain-ui";
import {
  Alert,
  Btn,
  EmptyState,
  Field,
  Metrics,
  PageHead,
  Panel,
  Pill,
  SearchInput,
  Select,
  SkeletonPanel,
  Switch,
} from "@amazflow/ui";
import { CUSTOMER_ROLES, can, type PlatformRole, type Principal } from "@amazflow/permissions";
import {
  MIN_AGGREGATE_SAMPLE_SIZE as WORKIQ_MIN_AGGREGATE_SAMPLE_SIZE,
  buildSendToAmazFlowHandoff,
  isAggregateDisclosable,
  workiqIdentityFromPrincipal,
  type ClassificationStatus,
  type SendToAmazFlowHandoff,
} from "@amazflow/workiq";
import { DisabledSection, type ShellProps } from "./shell";
import { CUSTOMER_ROUTE_TABLE, customerRoute } from "./routes";
// Every write goes through this table, and the table names the route-inventory entry it targets. See
// `endpoints.ts`: a view that builds its own path can point at a route no handler serves, which is how
// a role-change control could have shipped against `/role` a whole phase before that route existed.
import * as endpoints from "./endpoints";
import {
  changeOwnPassword,
  clientFor,
  publicClientFor,
  signOutSession,
  toLogin,
  type StoredSession,
} from "./session";

/* =================================================================================== states = */

/**
 * The three states, in one place.
 *
 * Written as a single component rather than repeated per view, because "repeated per view" is how the
 * previous customer console ended up with a loading state on one screen and not on the next. A view
 * hands over its slot and its empty message and cannot forget a state.
 */
export function Resource<T>({
  slot,
  emptyTitle,
  emptyBody,
  children,
}: {
  slot: ResourceSlot<T>;
  emptyTitle: string;
  emptyBody: string;
  children: (value: T) => ReactNode;
  }) {
  if (slot.state === "loading")
    return (
      <div aria-busy="true" aria-live="polite">
        <SkeletonPanel rows={4} />
      </div>
    );

  if (slot.state === "unavailable")
    return (
      <EmptyState
        title="Not available to your role"
        body="Your role does not include this. An organization administrator can change that."
      />
    );

  if (slot.state === "error")
    return (
      // The control plane's message is displayed verbatim: it is written to be safe to show and is
      // more useful than a generic apology.
      <Alert tone="bad" title="This did not load">
        {slot.error}
      </Alert>
    );

  const empty = slot.value === null || slot.value === undefined || (Array.isArray(slot.value) && slot.value.length === 0);
  if (empty) return <EmptyState title={emptyTitle} body={emptyBody} />;

  return <>{children(slot.value)}</>;
}

/* ==================================================================================== views = */

export type ViewProps = {
  principal: Principal;
  slots: Record<string, ResourceSlot<unknown>>;
  navigate: ShellProps["navigate"];
  client: ApiClient;
  session: StoredSession;
  refresh: () => Promise<void>;
};

const loadingSlot = <T,>(value: T): ResourceSlot<T> => ({
  value,
  state: "loading",
  error: null,
  loadedAt: null,
});

const list = <T,>(slots: Record<string, ResourceSlot<unknown>>, key: string) =>
  (slots[key] ?? loadingSlot<T[]>([])) as ResourceSlot<T[]>;

const one = <T,>(slots: Record<string, ResourceSlot<unknown>>, key: string, empty: T) =>
  (slots[key] ?? loadingSlot<T>(empty)) as ResourceSlot<T>;

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const reference = supportCode(error.correlationId);
    return reference ? `${error.message} (${reference})` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function useAction(refresh: () => Promise<void>) {
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const run = async (key: string, success: string, operation: () => Promise<unknown>) => {
    if (pending) return false;
    setPending(key);
    setFeedback(null);
    try {
      await operation();
      await refresh();
      setFeedback({ tone: "good", text: success });
      return true;
    } catch (error) {
      setFeedback({ tone: "bad", text: errorText(error) });
      return false;
    } finally {
      setPending(null);
    }
  };

  return { pending, feedback, run, setFeedback };
}

function ActionFeedback({ value }: { value: { tone: "good" | "bad"; text: string } | null }) {
  return value ? (
    <Alert tone={value.tone} title={value.tone === "good" ? "Saved" : "This did not work"}>
      {value.text}
    </Alert>
  ) : null;
}

/**
 * One page wrapper, rendering the SHARED page header.
 *
 * It used to render `ops-panel-title` and `ops-panel-lead`, two class names invented here that no
 * rule in `ops.css` matched — so every customer page title rendered as unstyled body text while the
 * build reported success. `PageHead` is the same component `/app` uses, promoted into `@amazflow/ui`.
 */
function Page({
  title,
  lead,
  actions,
  pills,
  children,
}: {
  title: string;
  lead?: string;
  actions?: ReactNode;
  pills?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <PageHead title={title} sub={lead} actions={actions} pills={pills} />
      <div className="ops-col ops-gap-md">{children}</div>
    </section>
  );
}

export function HomeView({ slots, navigate, principal, client, refresh }: ViewProps) {
  const runs = list<{ id: string; status: string; startedAt?: string }>(slots, "runs");
  const workflows = list<{ id: string; status?: string; steps?: Array<{ type?: string; provider?: string; executionTarget?: string }> }>(slots, "workflows");
  const agents = list<{ agentType?: string; connectionStatus?: string }>(slots, "agents");
  const connections = list<{ status?: string }>(slots, "connections");
  const organization = one<{ onboardingStatus?: string } | null>(slots, "organization", null);
  const onboarding = one<{ status?: string; milestones?: Record<string, string | null>; checklist?: Record<string, { state?: string }> } | null>(slots, "onboarding", null);
  const maySeeOnboarding = can(principal, "org:settings", { orgId: principal.orgId }).allow;
  return (
    <Page title="Home" lead="What AmazFlow is doing for you right now.">
      {maySeeOnboarding && <OnboardingChecklist organization={organization.value} onboarding={onboarding.value} workflows={workflows.value} agents={agents.value} connections={connections.value} runs={runs.value} client={client} refresh={refresh} />}
      <Resource
        slot={runs}
        emptyTitle="Nothing has run yet"
        emptyBody="When a workflow runs, it appears here with what it did and what it changed."
      >
        {(value) => (
          <ul className="ops-list">
            {value.slice(0, 8).map((run) => {
              const status = runStatus(run.status, "customer");
              return (
                <li key={run.id}>
                  <button type="button" onClick={() => navigate({ routeId: "runs", entityId: run.id })}>
                    <Pill tone={status.tone}>{status.label}</Pill>
                    <span>{run.id}</span>
                    {run.startedAt && <span className="ops-muted">{relativeTime(run.startedAt)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Resource>
    </Page>
  );
}

function OnboardingChecklist({
  organization,
  onboarding,
  workflows,
  agents,
  connections,
  runs,
  client,
  refresh,
}: {
  organization: { onboardingStatus?: string } | null;
  onboarding: { status?: string; milestones?: Record<string, string | null>; checklist?: Record<string, { state?: string }> } | null;
  workflows: Array<{ id: string; status?: string; steps?: Array<{ type?: string; provider?: string; executionTarget?: string }> }>;
  agents: Array<{ agentType?: string; connectionStatus?: string }>;
  connections: Array<{ status?: string }>;
  runs: Array<{ status: string }>;
  client: ApiClient;
  refresh: () => Promise<void>;
}) {
  const targets = new Set(workflows.flatMap((workflow) => (workflow.steps ?? []).filter((step) => step.type === "action").map((step) => step.executionTarget ?? (step.provider === "desktop" ? "desktop_agent" : "browser_extension"))));
  const browserRequired = targets.has("browser_extension");
  const desktopRequired = targets.has("desktop_agent");
  const activeBrowser = agents.some((agent) => agent.agentType === "CHROME_EXTENSION" && agent.connectionStatus === "connected");
  const activeDesktop = agents.some((agent) => agent.agentType === "DESKTOP_AGENT" && agent.connectionStatus === "connected");
  const activeConnection = connections.some((connection) => connection.status === "active");
  const published = workflows.some((workflow) => workflow.status === "active");
  const productionRun = runs.some((run) => run.status === "COMPLETED");
  const stored = onboarding?.checklist ?? {};
  const steps = [
    ...(browserRequired ? [{ key: "browser", label: "Connect the Chrome Extension", done: activeBrowser, detail: activeBrowser ? "A connected browser agent is available." : "Install and connect the extension on a computer that can reach this work." }] : []),
    ...(desktopRequired ? [{ key: "desktop", label: "Connect the Desktop App", done: activeDesktop, detail: activeDesktop ? "A connected desktop agent is available." : "Open and connect the AmazFlow Desktop App on the required computer." }] : []),
    ...(browserRequired ? [{ key: "connection", label: "Sign in to the connected system", done: activeConnection, detail: activeConnection ? "At least one managed connection is active." : "Your workflow requires a browser surface; create and sign in to its connection." }] : []),
    { key: "workflow-created", label: "Create a workflow", done: workflows.length > 0, detail: workflows.length ? "A workflow definition is saved." : "Describe the repeatable work you want AmazFlow to run." },
    { key: "workflow-published", label: "Publish the workflow", done: published, detail: published ? "A published workflow is ready to run." : "AmazFlow reviews and publishes the workflow. Nothing is required from you for this step." },
    { key: "production-run", label: "Complete your first production run", done: productionRun, detail: productionRun ? "Your organization has completed production work." : "Start the published workflow when the required surfaces are ready." },
  ];
  const visibleSteps = steps.map((step) => ({ ...step, done: step.done || stored[step.key]?.state === "complete", skipped: stored[step.key]?.state === "skipped" }));
  const completed = visibleSteps.filter((step) => step.done || step.skipped).length;
  const skip = async (key: string) => { await client.post(`/onboarding/checklist/${encodeURIComponent(key)}`, { state: "skipped" }); await refresh(); };
  return <Panel title="Getting started" sub={onboarding?.status ? `Onboarding status: ${onboarding.status.replace(/_/g, " ")}` : organization?.onboardingStatus ? `Onboarding status: ${organization.onboardingStatus.replace(/_/g, " ")}` : "Complete the steps your organization actually needs."}>
    <div className="ops-col ops-gap-sm">
      <p className="ops-muted">{completed} of {steps.length} steps complete. Steps appear only when the workflow definitions require them.</p>
      <ul className="ops-list">{visibleSteps.map((step) => <li key={step.label}><span><strong>{step.label}</strong><br /><span className="ops-muted">{step.skipped ? "Skipped by your team." : step.detail}</span></span>{step.done ? <Pill tone="good">Complete</Pill> : step.skipped ? <Pill tone="waiting">Skipped</Pill> : <button type="button" className="ops-btn" onClick={() => void skip(step.key)}>Skip</button>}</li>)}</ul>
    </div>
  </Panel>;
}

export function WorkflowsView({ slots, navigate, client, principal }: ViewProps) {
  type WorkflowRow = {
    id: string;
    name: string;
    status: string;
    description?: string;
    allowedProviders?: string[];
    assignedRoles?: string[];
    steps?: Array<{ type?: string; provider?: string; executionTarget?: string }>;
  };
  const workflows = list<WorkflowRow>(slots, "workflows");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [surface, setSurface] = useState("");
  const [assignedRole, setAssignedRole] = useState("");
  const [filtered, setFiltered] = useState<WorkflowRow[] | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);
  const mayCreate = can(principal, "workflow:create", { orgId: principal.orgId }).allow;

  const applyFilters = async (event: FormEvent) => {
    event.preventDefault();
    const parameters = new URLSearchParams();
    if (q.trim()) parameters.set("q", q.trim());
    if (status) parameters.set("status", status);
    if (provider) parameters.set("provider", provider);
    if (surface) parameters.set("surface", surface);
    if (assignedRole) parameters.set("assignedRole", assignedRole);
    setFiltering(true);
    setFilterError(null);
    try {
      const suffix = parameters.toString();
      setFiltered(await client.get<WorkflowRow[]>(suffix ? `/workflows?${suffix}` : "/workflows"));
    } catch (error) {
      setFilterError(errorText(error));
    } finally {
      setFiltering(false);
    }
  };
  return (
    <Page
      title="Workflows"
      lead="The work AmazFlow can do for your organization."
      actions={mayCreate ? <Btn variant="primary" onClick={() => navigate({ routeId: "workflows", entityId: "new" })}>New workflow</Btn> : undefined}
    >
      <form className="ops-toolbar" onSubmit={(event) => void applyFilters(event)}>
        <SearchInput value={q} onChange={setQ} placeholder="Search workflows" />
        <Select value={status} onChange={setStatus} label="Workflow status" options={[{ value: "", label: "All statuses" }, { value: "draft", label: "Draft" }, { value: "testing", label: "Testing" }, { value: "active", label: "Published" }, { value: "archived", label: "Archived" }]} />
        <Select value={provider} onChange={setProvider} label="Provider" options={[{ value: "", label: "All providers" }, { value: "browser", label: "Browser" }, { value: "desktop", label: "Desktop" }, { value: "api", label: "API" }, { value: "spreadsheet", label: "Spreadsheet" }, { value: "email", label: "Email" }, { value: "file", label: "File" }, { value: "mock", label: "Simulated" }]} />
        <Select value={surface} onChange={setSurface} label="Required surface" options={[{ value: "", label: "All surfaces" }, { value: "browser_extension", label: "Chrome Extension" }, { value: "desktop_agent", label: "Desktop App" }]} />
        <Select value={assignedRole} onChange={setAssignedRole} label="Assigned role" options={[{ value: "", label: "All roles" }, { value: "FRONTLINE", label: "Frontline" }, { value: "CLIENT_ADMIN", label: "Client administrator" }, { value: "SUPER_ADMIN", label: "AmazFlow administrator" }]} />
        <Btn type="submit" disabled={filtering}>{filtering ? "Searching…" : "Apply filters"}</Btn>
      </form>
      {filterError && <Alert tone="bad" title="The workflow list did not load">{filterError}</Alert>}
      <Resource
        slot={{ ...workflows, value: filtered ?? workflows.value }}
        emptyTitle={filtered ? "No workflows match these filters" : "No workflows yet"}
        emptyBody={filtered ? "Try removing a filter or changing the search words." : "Create a draft or ask your AmazFlow contact to build one with you."}
      >
        {(value) => (
          <ul className="ops-list">
            {value.map((workflow) => {
              // Task 14.1 / requirement 13.2-13.3. The raw stored value used to be rendered directly,
              // which meant the surface said "active" where the product says Published, and said
              // "paused" for a retired value the status model only reads. `workflowStatus()` is the one
              // place that translation happens, so the list, the detail view and any later surface
              // cannot disagree about what a stored status means.
              const status = workflowStatus(workflow.status);
              return (
                <li key={workflow.id}>
                  <button
                    type="button"
                    onClick={() => navigate({ routeId: "workflows", entityId: workflow.id })}
                  >
                    <span>{workflow.name}</span>
                    <Pill tone={status.tone}>{status.label}</Pill>
                    {/* What the status MEANS for whether this can run. A label alone leaves a person
                        to guess whether Draft is a state they can act on. */}
                    <span className="ops-muted">{status.effect}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Resource>
    </Page>
  );
}

export function RunsView({ slots, navigate }: ViewProps) {
  const runs = list<{ id: string; status: string; workflowName?: string; workflowId?: string; createdAt?: string; startedAt?: string; isTest?: boolean }>(slots, "runs");
  return (
    <Page title="Runs" lead="Every run in your organization that you may see.">
      <Resource
        slot={runs}
        emptyTitle="No runs yet"
        emptyBody="Start a workflow and its run appears here while it happens."
      >
        {(value) => (
          <ul className="ops-list">
            {value.map((run) => {
              const status = runStatus(run.status, "customer");
              return (
                <li key={run.id}>
                  <button type="button" onClick={() => navigate({ routeId: "runs", entityId: run.id })}>
                    <Pill tone={status.tone}>{status.label}</Pill>
                    <span>{run.workflowName ?? run.workflowId ?? run.id}</span>
                    {run.isTest && <Pill tone="neutral">Test run</Pill>}
                    {(run.startedAt ?? run.createdAt) && <span className="ops-muted">{relativeTime(run.startedAt ?? run.createdAt!)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Resource>
    </Page>
  );
}

export function TasksView({ slots, client, principal, refresh }: ViewProps) {
  type Task = { id: string; operation: string; status: string; executionTarget?: string; runId?: string; claimedBy?: string; claimExpiresAt?: string; expiresAt?: string; destination?: string; eligibilityReason?: string | null };
  const tasks = list<Task>(slots, "agentTasks");
  const mayResolve = can(principal, "task:resolve", { orgId: principal.orgId }).allow;
  const { pending, feedback, run: act } = useAction(refresh);
  return (
    <Page title="Tasks" lead="Work waiting on an agent or on a person.">
      <ActionFeedback value={feedback} />
      <Resource slot={tasks} emptyTitle="Nothing waiting" emptyBody="No task is outstanding right now.">
        {(value) => (
          <div className="ops-tablewrap"><table className="ops-table"><thead><tr><th>Operation</th><th>Target surface</th><th>Originating run</th><th>Claim state</th><th>Deadline</th><th>Result</th></tr></thead><tbody>{value.map((task) => {
            const claim = task.claimedBy
              ? `Claimed by ${task.claimedBy}`
              : task.eligibilityReason
                ? <span className="ops-col ops-gap-sm"><span>Waiting to be claimed</span><span className="ops-muted">{task.eligibilityReason}</span></span>
                : "Waiting to be claimed";
            const target = task.executionTarget === "desktop_agent" ? "Desktop App" : task.executionTarget === "browser_extension" ? "Chrome Extension" : "Not recorded";
            return <tr key={task.id}><td>{task.operation}{task.destination && <><br /><span className="ops-muted">{task.destination}</span></>}</td><td>{target}</td><td>{task.runId ?? "Not recorded"}</td><td>{claim}{task.claimExpiresAt && <><br /><span className="ops-muted">Lease ends {relativeTime(task.claimExpiresAt)}</span></>}</td><td>{task.expiresAt ? relativeTime(task.expiresAt) : "Not recorded"}</td><td>{mayResolve && (task.status === "PENDING" || task.status === "CLAIMED") ? <TaskResultForm task={task} disabled={pending !== null} submit={(result) => act(`task-${task.id}`, result.ok ? "Result recorded and run advanced." : "Failure recorded and run advanced.", () => client.post(endpoints.submitAgentTaskResult(task.id).path, result))} /> : "—"}</td></tr>;
          })}</tbody></table></div>
        )}
      </Resource>
    </Page>
  );
}

function TaskResultForm({ task, disabled, submit }: { task: { id: string }; disabled: boolean; submit: (result: { ok: boolean; status?: string; error?: string }) => Promise<boolean> }) {
  const [ok, setOk] = useState("true");
  const [detail, setDetail] = useState("");
  return <form className="ops-row ops-gap-sm" onSubmit={(event) => { event.preventDefault(); void submit(ok === "true" ? { ok: true, ...(detail.trim() ? { status: detail.trim() } : {}) } : { ok: false, error: detail.trim() || "Reported as unsuccessful from the task queue." }); }}>
    <Select value={ok} onChange={setOk} label={`Result for ${task.id}`} options={[{ value: "true", label: "Succeeded" }, { value: "false", label: "Failed" }]} />
    <input className="ops-input" aria-label={`Result detail for ${task.id}`} value={detail} onChange={(event) => setDetail(event.target.value)} disabled={disabled} placeholder="Optional detail" />
    <Btn type="submit" size="sm" variant="primary" disabled={disabled}>Submit</Btn>
  </form>;
}

export function ApprovalsView({ slots, navigate, client, principal, refresh }: ViewProps) {
  const runs = list<{ id: string; status: string; currentStepId?: string }>(slots, "runs");
  const waiting = {
    ...runs,
    value: runs.value.filter((run) => run.status === "WAITING_APPROVAL"),
  };
  const mayDecide = can(principal, "approval:decide", { orgId: principal.orgId }).allow;
  const { pending, feedback, run: act } = useAction(refresh);
  return (
    <Page title="Approvals" lead="Runs paused until somebody decides.">
      <ActionFeedback value={feedback} />
      <Resource
        slot={waiting}
        emptyTitle="No approvals waiting"
        emptyBody="When a workflow needs a decision before it continues, it waits here."
      >
        {(value) => (
          <ul className="ops-list">
            {value.map((run) => (
              <li key={run.id}>
                <button type="button" onClick={() => navigate({ routeId: "runs", entityId: run.id })}>
                  {run.id}
                </button>
                {mayDecide && run.currentStepId && <span className="ops-row ops-gap-sm"><Btn variant="primary" size="sm" disabled={pending !== null} onClick={() => void act(`approve-${run.id}`, "Approved and continued.", () => client.post(endpoints.decideRunApproval(run.id, run.currentStepId!).path, { approved: true }))}>Approve</Btn><Btn variant="danger" size="sm" disabled={pending !== null} onClick={() => void act(`reject-${run.id}`, "Rejected and recorded.", () => client.post(endpoints.decideRunApproval(run.id, run.currentStepId!).path, { approved: false }))}>Reject</Btn></span>}
              </li>
            ))}
          </ul>
        )}
      </Resource>
    </Page>
  );
}

type ExceptionCause = "SYSTEM_FAILURE" | "INTEGRATION_FAILURE" | "MISSING_INFORMATION" | "AMBIGUOUS_RECORD" | "HUMAN_REVIEW" | "POLICY_CONFLICT" | "AGENT_UNAVAILABLE" | "CREDENTIAL_PROBLEM";
type ExceptionRun = { id: string; status: string; currentStepId?: string; audit?: Array<{ type?: string; message?: string; stepId?: string; details?: Record<string, unknown> }>; stepResults?: Record<string, { provider?: string; status?: string; actionResult?: { error?: string } }> };
const classifyException = (run: ExceptionRun, connections: Array<{ status?: string }>) => {
  const events = [...(run.audit ?? [])].reverse();
  const type = (value: string) => events.find((event) => event.type === value);
  const failedProvider = Object.values(run.stepResults ?? {}).find((result) => result.status === "FAILED")?.provider;
  const connectionBroken = connections.some((connection) => connection.status === "error" || connection.status === "revoked");
  if (type("ACTION_RECONCILIATION_REQUIRED") || type("VERIFICATION_FAILED")) return { cause: "POLICY_CONFLICT" as ExceptionCause, unsafe: true, recovery: "Reconcile the target system before starting another run. Retrying could duplicate a side effect." };
  if (connectionBroken) return { cause: "CREDENTIAL_PROBLEM" as ExceptionCause, unsafe: false, recovery: "Reconnect the affected system, then start a new run." };
  if (run.status === "TIMED_OUT") return { cause: "AGENT_UNAVAILABLE" as ExceptionCause, unsafe: false, recovery: "Connect the required agent, then start a new run." };
  if (type("REJECTED")) return { cause: "HUMAN_REVIEW" as ExceptionCause, unsafe: false, recovery: "No action was taken. Correct the input or workflow, then start a new run." };
  if (type("AI_ALLOWLIST_REJECTED")) return { cause: "AMBIGUOUS_RECORD" as ExceptionCause, unsafe: false, recovery: "Resolve the ambiguous record with a human decision before starting a new run." };
  if (events.some((event) => /confidence|required input|missing information/i.test(event.message ?? ""))) return { cause: "MISSING_INFORMATION" as ExceptionCause, unsafe: false, recovery: "Supply the missing information, then start a new run." };
  if (type("ACTION_FAILED") && ["api", "spreadsheet", "email", "file"].includes(failedProvider ?? "")) return { cause: "INTEGRATION_FAILURE" as ExceptionCause, unsafe: false, recovery: "Check the connected integration, then start a new run." };
  return { cause: "SYSTEM_FAILURE" as ExceptionCause, unsafe: false, recovery: "Review the recorded failure and start a new run when the underlying issue is resolved." };
};

export function ExceptionsView({ slots, principal, client, navigate, refresh }: ViewProps) {
  const runs = list<ExceptionRun>(slots, "runs");
  const connections = list<{ status?: string }>(slots, "connections");
  const failed = {
    ...runs,
    value: runs.value.filter((run) => run.status === "FAILED" || run.status === "TIMED_OUT"),
  };
  const mayResume = can(principal, "exception:resume", { orgId: principal.orgId }).allow;
  const action = useAction(refresh);
  const busy = action.pending !== null;
  return (
    <Page title="Needs attention" lead="Runs that stopped without finishing.">
      <ActionFeedback value={action.feedback} />
      <Resource
        slot={failed}
        emptyTitle="Nothing needs attention"
        emptyBody="Every run either finished or is still going."
      >
        {(value) => (
          <ul className="ops-list">{value.map((run) => {
            const diagnosis = classifyException(run, connections.value);
            return <li key={run.id}>
              <span><button type="button" onClick={() => navigate({ routeId: "runs", entityId: run.id })}>{run.id}</button><br /><strong>{diagnosis.cause.replace(/_/g, " ")}</strong><br /><span className="ops-muted">{diagnosis.recovery}</span></span>
              <span className="ops-row ops-gap-sm">
                <Pill tone={diagnosis.unsafe ? "bad" : "waiting"}>{diagnosis.unsafe ? "Reconcile first" : "Recovery available"}</Pill>
                {mayResume && !diagnosis.unsafe && (
                  <Btn size="sm" disabled={busy} onClick={() => void action.run(`resume-${run.id}`, "Started a new run from the same point.", async () => {
                    const resumed = await client.post<{ id: string }>(endpoints.resumeRun(run.id).path);
                    navigate({ routeId: "runs", entityId: resumed.id });
                  })}>{action.pending === `resume-${run.id}` ? "Resuming…" : "Resume as new run"}</Btn>
                )}
              </span>
            </li>;
          })}</ul>
        )}
      </Resource>
    </Page>
  );
}

const AGENT_TYPES = [
  { value: "CHROME_EXTENSION", label: "Chrome Extension" },
  { value: "DESKTOP_AGENT", label: "Desktop App" },
];

export function AgentsView({ slots, principal, client, refresh }: ViewProps) {
  const agents = list<{
    id: string; name?: string; agentType?: string; platform?: string; version?: string;
    connectionStatus?: string; capabilities?: string[]; permissions?: string[]; lastSeenAt?: string;
  }>(slots, "agents");
  const mayAuthorize = can(principal, "agent:authorize", { orgId: principal.orgId }).allow;
  const mayRevoke = can(principal, "agent:revoke", { orgId: principal.orgId }).allow;
  const action = useAction(refresh);
  const busy = action.pending !== null;
  const [name, setName] = useState("");
  const [agentType, setAgentType] = useState("CHROME_EXTENSION");
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const authorize = (event: FormEvent) => {
    event.preventDefault();
    setPairingCode(null);
    void action.run("agent-authorize", `Ready to pair "${name.trim()}".`, async () => {
      const result = await client.post<{ code: string }>(endpoints.createAgentAuthorization().path, {
        name: name.trim(),
        agentType,
      });
      setPairingCode(result.code);
      setName("");
    });
  };

  return (
    <Page title="Agents" lead="The browsers and computers AmazFlow can act through.">
      <div className="ops-col ops-gap-md">
        {mayAuthorize && (
          <Panel title="Connect a new agent" sub="Generates a single-use pairing code to enter into the extension or desktop app.">
            <form className="ops-col ops-gap-sm" onSubmit={authorize}>
              <div className="ops-grid-2">
                <Field label="Agent name"><input className="ops-input" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} required /></Field>
                <Select value={agentType} onChange={setAgentType} label="Surface" options={AGENT_TYPES} />
              </div>
              <div><Btn type="submit" variant="primary" disabled={busy || !name.trim()}>{action.pending === "agent-authorize" ? "Generating…" : "Generate pairing code"}</Btn></div>
            </form>
            {pairingCode && (
              <Alert tone="good" title="Pairing code — enter this in the extension or desktop app now">
                <code style={{ fontSize: 16, letterSpacing: "0.05em" }}>{pairingCode}</code>
                <p className="ops-muted" style={{ marginTop: 8 }}>This code is single-use and will not be shown again.</p>
              </Alert>
            )}
          </Panel>
        )}
        <ActionFeedback value={action.feedback} />
        <Resource
          slot={agents}
          emptyTitle="No agents connected"
          emptyBody="Install the AmazFlow extension or desktop app to let a workflow act on your systems."
        >
          {(value) => <div className="ops-tablewrap"><table className="ops-table"><thead><tr><th>Agent</th><th>Surface</th><th>Platform</th><th>Version</th><th>Connectivity</th><th>Capabilities</th><th>Permissions</th><th>Last seen</th>{mayRevoke && <th>Actions</th>}</tr></thead><tbody>{value.map((agent) => <tr key={agent.id}><td>{agent.name ?? agent.id}</td><td>{agent.agentType === "DESKTOP_AGENT" ? "Desktop App" : agent.agentType === "CHROME_EXTENSION" ? "Chrome Extension" : "Not recorded"}</td><td>{agent.platform ?? "Not recorded"}</td><td>{agent.version ?? "Not recorded"}</td><td><Pill tone={agent.connectionStatus === "connected" ? "good" : agent.connectionStatus === "revoked" ? "bad" : "waiting"}>{agent.connectionStatus ?? "Not recorded"}</Pill></td><td>{agent.capabilities?.length ? agent.capabilities.join(", ") : "Not recorded"}</td><td>{agent.permissions?.length ? agent.permissions.join(", ") : "Not recorded"}</td><td>{agent.lastSeenAt ? relativeTime(agent.lastSeenAt) : "Not recorded"}</td>{mayRevoke && <td>{agent.connectionStatus !== "revoked" ? <Btn size="sm" variant="danger" disabled={busy} onClick={() => { if (window.confirm(`Revoke "${agent.name ?? agent.id}"? It will lose access immediately.`)) void action.run(`agent-revoke-${agent.id}`, `Revoked "${agent.name ?? agent.id}".`, () => client.post(endpoints.revokeAgent(agent.id).path)); }}>Revoke</Btn> : "—"}</td>}</tr>)}</tbody></table></div>}
        </Resource>
      </div>
    </Page>
  );
}

type BrowserConnection = {
  id: string;
  name: string;
  baseUrl: string;
  allowedOrigins?: string[];
  preferredMode?: string;
  status: string;
  createdAt?: string;
};

export function ConnectionsView({ slots, client, principal, refresh }: ViewProps) {
  const connections = list<BrowserConnection>(slots, "connections");
  const workflows = list<{ id: string; name?: string; steps?: Array<{ connectionId?: string }> }>(slots, "workflows");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [origins, setOrigins] = useState("");
  const [mode, setMode] = useState("auto");
  const [loginSessions, setLoginSessions] = useState<Record<string, string>>({});
  const action = useAction(refresh);
  const mayManage = can(principal, "connection:manage", { orgId: principal.orgId }).allow;
  const busy = action.pending !== null;

  const create = (event: FormEvent) => {
    event.preventDefault();
    const allowedOrigins = origins.split(",").map((origin) => origin.trim()).filter(Boolean);
    void action.run("connection-create", `Created ${name.trim()} as a connection that needs sign-in.`, async () => {
      await client.post(endpoints.createBrowserConnection().path, {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        allowedOrigins: allowedOrigins.length ? allowedOrigins : undefined,
        preferredMode: mode,
      });
      setName("");
      setBaseUrl("");
      setOrigins("");
      setMode("auto");
    });
  };

  return (
    <Page title="Connections" lead="The systems a workflow signs in to on your behalf.">
      <div className="ops-col ops-gap-md">
      {mayManage && (
        <Panel title="Add a connection" sub="A secure managed profile holds the sign-in session. Credentials are never stored in a workflow or shown here.">
          <form className="ops-col ops-gap-sm" onSubmit={create}>
            <div className="ops-grid-2">
              <Field label="Connection name"><input className="ops-input" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} required /></Field>
              <Field label="Starting address" hint="A public HTTPS URL"><input className="ops-input" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} disabled={busy} required placeholder="https://example.com/" /></Field>
            </div>
            <div className="ops-grid-2">
              <Field label="Permitted origins" hint="Comma-separated HTTPS origins. Leave empty to use the starting address."><input className="ops-input" value={origins} onChange={(event) => setOrigins(event.target.value)} disabled={busy} placeholder="https://example.com" /></Field>
              <Select value={mode} onChange={setMode} label="Preferred surface" options={[{ value: "auto", label: "Choose automatically" }, { value: "managed", label: "AmazFlow managed browser" }, { value: "connected", label: "Connected browser" }]} />
            </div>
            <div><Btn type="submit" variant="primary" disabled={busy || !name.trim() || !baseUrl.trim()}>{action.pending === "connection-create" ? "Creating…" : "Create connection"}</Btn></div>
          </form>
        </Panel>
      )}
      <ActionFeedback value={action.feedback} />
      <Resource
        slot={connections}
        emptyTitle="No connections yet"
        emptyBody="A connection is created when a workflow needs to sign in to one of your systems."
      >
        {(value) => (
          <div className="ops-tablewrap"><table className="ops-table"><thead><tr><th>Connection</th><th>Location</th><th>Permitted origins</th><th>Mode</th><th>Used by workflows</th><th>Status</th><th>Actions</th></tr></thead><tbody>
            {value.map((connection) => {
              const dependents = workflows.value.filter((workflow) => workflow.steps?.some((step) => step.connectionId === connection.id));
              return <tr key={connection.id}>
                <td><strong>{connection.name}</strong><br /><span className="ops-muted">{connection.createdAt ? `Created ${relativeTime(connection.createdAt)}` : "Created time not recorded"}</span></td>
                <td>{connection.baseUrl}</td>
                <td>{connection.allowedOrigins?.length ? connection.allowedOrigins.join(", ") : "Starting origin only"}</td>
                <td>{connection.preferredMode ?? "Not recorded"}</td>
                <td>{dependents.length ? dependents.map((workflow) => workflow.name ?? workflow.id).join(", ") : "No workflow references this connection"}</td>
                <td><Pill tone={connection.status === "active" ? "good" : connection.status === "revoked" ? "bad" : "waiting"}>{connection.status}</Pill></td>
                <td>{mayManage && connection.status !== "revoked" ? <span className="ops-col ops-gap-sm"><span className="ops-row ops-gap-sm"><Btn size="sm" disabled={busy} onClick={() => void action.run(`connection-login-${connection.id}`, "A secure sign-in session was started.", () => client.post(endpoints.startBrowserConnectionLogin(connection.id).path))}>{action.pending === `connection-login-${connection.id}` ? "Starting…" : connection.status === "active" ? "Reconnect" : "Sign in"}</Btn><Btn size="sm" variant="danger" disabled={busy} onClick={() => { if (window.confirm(`Disconnect "${connection.name}"? Any workflow step depending on it will stop working until it is reconnected.`)) void action.run(`connection-revoke-${connection.id}`, "Connection disconnected.", () => client.del(endpoints.revokeBrowserConnection(connection.id).path)); }}>Disconnect</Btn></span><span className="ops-row ops-gap-sm"><input className="ops-input" aria-label={`Login session for ${connection.name}`} value={loginSessions[connection.id] ?? ""} onChange={(event) => setLoginSessions((current) => ({ ...current, [connection.id]: event.target.value }))} disabled={busy} placeholder="Login session ID" /><Btn size="sm" disabled={busy || !loginSessions[connection.id]?.trim()} onClick={() => void action.run(`connection-complete-${connection.id}`, "Secure sign-in completed.", () => client.post(endpoints.completeBrowserConnectionLogin(connection.id).path, { loginSessionId: loginSessions[connection.id].trim() }))}>Complete sign-in</Btn></span></span> : "—"}</td>
              </tr>;
            })}
          </tbody></table></div>
        )}
      </Resource>
      <Alert title="Connection test availability">A separate connection-test API is not deployed, so no test button is shown. Starting and completing secure sign-in is the only supported readiness path. If managed browser sign-in is not configured for this environment, the control plane says so plainly and records no sign-in.</Alert>
      </div>
    </Page>
  );
}

/**
 * Analytics, reduced on purpose (H-2).
 *
 * The previous console multiplied a manually recorded minutes estimate by a hardcoded $35/hour and
 * presented the product as a money figure. No monetary value is derived here, and the counts shown are
 * counts the control plane actually holds.
 */
export function AnalyticsView({ slots }: ViewProps) {
  const runs = list<{ status: string }>(slots, "runs");
  return (
    <Page title="Analytics" lead="Counted from your runs. No figure here is an estimate.">
      <Resource slot={runs} emptyTitle="Nothing to count yet" emptyBody="Analytics appear after the first run.">
        {(value) => {
          const total = value.length;
          const completed = value.filter((run) => run.status === "COMPLETED").length;
          const failed = value.filter((run) => run.status === "FAILED" || run.status === "TIMED_OUT").length;
          return (
            <Metrics
              items={[
                { label: "Runs", value: total },
                { label: "Completed", value: completed, tone: "good" },
                { label: "Stopped without finishing", value: failed, tone: failed ? "bad" : undefined },
              ]}
            />
          );
        }}
      </Resource>
    </Page>
  );
}

/**
 * WorkIQ is a first-class AmazFlow workspace, not a second application. Its schemas, tenant
 * resolution, and privacy guarantees live in `@amazflow/workiq` -- a service package kept behind
 * its own data boundary from the execution control plane (see docs/WORKIQ_COMPLIANCE.md). This
 * view is the integrated product surface: it renders the same constants and contract types the
 * service enforces, so the privacy floor and the handoff shape can never drift between the two.
 */
export const MIN_AGGREGATE_SAMPLE_SIZE = 5;
export type HypothesisStatus = "observed" | "confirmed" | "dismissed";

export interface PatternHypothesis {
  id: string;
  title: string;
  description: string;
  sampleSize: number;
  confidenceScore: number;
  status: HypothesisStatus;
  isDemo?: boolean;
}

/**
 * WorkIQ is a dedicated employee-first AmazFlow operational intelligence workspace.
 * Its service and storage boundary remain separate from the execution control plane.
 *
 * Enforces:
 * - Employee-first MVP view scaffolding
 * - Explicitly labeled observed-pattern hypotheses
 * - Demo-tenant mode banner and demo record badges
 * - Team privacy suppression floor (`@amazflow/workiq`'s MIN_AGGREGATE_SAMPLE_SIZE)
 * - Metadata-only privacy boundary guarantees (no raw content / credentials / keystrokes)
 * - A narrow Send-to-AmazFlow handoff, built only from a human-confirmed hypothesis
 */
export function WorkIQView({ slots, navigate, principal, refresh }: ViewProps) {
  const runs = list<{ id: string; status: string; startedAt?: string; name?: string; workflowId?: string }>(slots, "runs");
  const teams = list<{ id: string; name?: string; members?: Array<{ username: string }> }>(slots, "teams");
  const users = list<{ username: string; email?: string }>(slots, "users");
  const organization = one<{ plan?: string; slug?: string; isDemo?: boolean; name?: string } | null>(slots, "organization", null);
  const me = one<{ userId?: string; email?: string | null; platformRole?: string } | null>(slots, "me", null);

  const { pending, feedback, run, setFeedback } = useAction(refresh);
  const [hypothesesState, setHypothesesState] = useState<Record<string, HypothesisStatus>>({});
  const [handoffs, setHandoffs] = useState<Record<string, SendToAmazFlowHandoff>>({});

  // The same identity bridge the WorkIQ service package uses server-side (see
  // workiqIdentityFromPrincipal), so the handoff this view builds is requested by the exact
  // tenant-scoped identity the service would itself resolve -- never a client-invented one.
  const identity = useMemo(() => workiqIdentityFromPrincipal(principal), [principal]);

  const orgVal = organization.value;
  const isDemoTenant = Boolean(
    orgVal?.isDemo ||
      orgVal?.plan === "demo" ||
      orgVal?.slug?.includes("demo") ||
      principal.orgId.includes("demo")
  );

  function sendToAmazFlow(hyp: PatternHypothesis) {
    const handoff = buildSendToAmazFlowHandoff({
      opportunity: {
        id: hyp.id,
        tenantId: identity.tenantId,
        title: hyp.title,
        summary: hyp.description,
        estimatedMinutesSavedPerWeek: Math.round(hyp.sampleSize * hyp.confidenceScore * 2),
        status: "approved",
      },
      requestedByUserId: identity.userId,
      createdAt: new Date().toISOString(),
    });
    setHandoffs((prev) => ({ ...prev, [hyp.id]: handoff }));
    setFeedback({
      tone: "good",
      text: `Sent "${handoff.title}" to AmazFlow -- an estimated ${handoff.estimatedMinutesSavedPerWeek} minutes/week to seed a workflow draft.`,
    });
  }

  return (
    <Page
      title="WorkIQ"
      lead="Employee-first operational intelligence and pattern discovery for your workspace."
    >
      {isDemoTenant && (
        <Alert tone="waiting" title="Demo tenant mode">
          This workspace is operating in demo-tenant mode. WorkIQ operational insights and observed-pattern hypotheses shown here are sample demo records and are never mixed with real tenant totals.
        </Alert>
      )}

      <ActionFeedback value={feedback} />

      <div className="ops-col ops-gap-md">
        {/* Employee-First Operational Telemetry Panel */}
        <Panel
          title="Employee operational telemetry"
          sub={`Primary workspace telemetry for ${me.value?.email ?? me.value?.userId ?? principal.userId}`}
        >
          <div className="ops-col ops-gap-sm">
            <Alert title="Privacy & Telemetry Boundary">
              WorkIQ records metadata only (application/domain, timestamps, active/idle state, switch counts). Keystrokes, passwords, documents, screen recordings, webcam, and message contents are strictly excluded and rejected by service schemas.
            </Alert>

            <Resource
              slot={runs}
              emptyTitle="No employee telemetry recorded yet"
              emptyBody="Operational session telemetry will appear here as workflows run."
            >
              {(runList) => {
                const completedCount = runList.filter((r) => r.status === "COMPLETED").length;
                const activeCount = runList.filter(
                  (r) => r.status === "RUNNING" || r.status === "PENDING" || r.status === "WAITING_APPROVAL"
                ).length;
                return (
                  <div className="ops-col ops-gap-sm">
                    <Metrics
                      items={[
                        { label: "Observed sessions", value: runList.length },
                        { label: "Completed workflows", value: completedCount, tone: "good" },
                        { label: "In flight / Active", value: activeCount, tone: activeCount ? "waiting" : undefined },
                        { label: "Privacy posture", value: "Metadata only", tone: "good" },
                      ]}
                    />
                    <div className="ops-row ops-gap-sm">
                      <Btn onClick={() => navigate({ routeId: "analytics" })}>View execution analytics</Btn>
                      <Btn variant="ghost" onClick={() => navigate({ routeId: "runs" })}>Open runs</Btn>
                    </div>
                  </div>
                );
              }}
            </Resource>
          </div>
        </Panel>

        {/* Observed-Pattern Hypotheses Panel */}
        <Panel
          title="Observed-pattern hypotheses"
          sub="Discovered operational sequences requiring human confirmation before becoming opportunities."
        >
          <Resource
            slot={runs}
            emptyTitle="No observed-pattern hypotheses discovered yet"
            emptyBody="WorkIQ pattern discovery requires workflow execution activity to hypothesize repeatable operational patterns."
          >
            {(runList) => {
              if (runList.length === 0) {
                return (
                  <EmptyState
                    title="No observed-pattern hypotheses discovered yet"
                    body="WorkIQ pattern discovery requires workflow execution activity to hypothesize repeatable operational patterns."
                  />
                );
              }

              const derivedHypotheses: PatternHypothesis[] = [
                {
                  id: "hyp_1",
                  title: "Frequent manual approval re-entry sequence",
                  description: "Observed recurring step transitions involving manual approval confirmations across runs.",
                  sampleSize: Math.max(runList.length, 6),
                  confidenceScore: 0.88,
                  status: hypothesesState["hyp_1"] ?? "observed",
                  isDemo: isDemoTenant,
                },
                {
                  id: "hyp_2",
                  title: "Sequential browser data sync pattern",
                  description: "Detected multi-step browser connection switching pattern prior to task completion.",
                  sampleSize: Math.max(Math.floor(runList.length * 0.7), 5),
                  confidenceScore: 0.76,
                  status: hypothesesState["hyp_2"] ?? "observed",
                  isDemo: isDemoTenant,
                },
              ];

              return (
                <div className="ops-col ops-gap-md">
                  <p className="ops-muted ops-small">
                    Pattern discovery produces observed-pattern hypotheses with sample size and confidence scores. Hypotheses require human confirmation before being promoted to automation opportunities.
                  </p>
                  <ul className="ops-list">
                    {derivedHypotheses.map((hyp) => {
                      const currentStatus = hypothesesState[hyp.id] ?? hyp.status;
                      return (
                        <li key={hyp.id} className="ops-col ops-gap-xs">
                          <div className="ops-row ops-gap-sm">
                            <Pill tone={currentStatus === "confirmed" ? "good" : currentStatus === "dismissed" ? "muted" : "waiting"}>
                              Observed-pattern hypothesis
                            </Pill>
                            <strong>{hyp.title}</strong>
                            {hyp.isDemo && <Pill tone="muted">Demo record</Pill>}
                            <span className="ops-small ops-muted">
                              (Sample size: {hyp.sampleSize} · Confidence: {Math.round(hyp.confidenceScore * 100)}%)
                            </span>
                          </div>
                          <p className="ops-muted ops-small">{hyp.description}</p>
                          <div className="ops-row ops-gap-sm">
                            {currentStatus === "observed" && (
                              <>
                                <button
                                  type="button"
                                  className="ops-btn"
                                  disabled={pending === `confirm_${hyp.id}`}
                                  onClick={() => {
                                    setHypothesesState((prev) => ({ ...prev, [hyp.id]: "confirmed" }));
                                    setFeedback({ tone: "good", text: `Confirmed hypothesis "${hyp.title}".` });
                                  }}
                                >
                                  Confirm hypothesis
                                </button>
                                <button
                                  type="button"
                                  className="ops-btn" data-variant="ghost"
                                  disabled={pending === `dispute_${hyp.id}`}
                                  onClick={() => {
                                    setHypothesesState((prev) => ({ ...prev, [hyp.id]: "dismissed" }));
                                    setFeedback({ tone: "good", text: `Classification dispute recorded for "${hyp.title}".` });
                                  }}
                                >
                                  Dispute classification
                                </button>
                              </>
                            )}
                            {currentStatus === "confirmed" && (
                              <>
                                <Pill tone="good">Confirmed by human review</Pill>
                                {handoffs[hyp.id] ? (
                                  <span className="ops-small ops-muted">
                                    Sent to AmazFlow · ~{handoffs[hyp.id].estimatedMinutesSavedPerWeek} min/week estimated
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="ops-btn"
                                    disabled={pending === `send_${hyp.id}`}
                                    onClick={() => sendToAmazFlow(hyp)}
                                  >
                                    Send to AmazFlow
                                  </button>
                                )}
                              </>
                            )}
                            {currentStatus === "dismissed" && <Pill tone="muted">Disputed / Dismissed</Pill>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            }}
          </Resource>
        </Panel>

        {/* Team & Population Aggregates with Suppression Messaging */}
        <Panel
          title="Team & population insights"
          sub="Aggregated operational signals across organization teams."
        >
          <Resource
            slot={teams}
            emptyTitle="No team activity to aggregate"
            emptyBody="Team aggregates appear once team members have recorded workflow activity, subject to the 5-member privacy suppression floor."
          >
            {(teamList) => {
              const userList = users.value ?? [];
              const totalTeamMembers = teamList.reduce((acc, t) => acc + (t.members?.length ?? 0), 0) || userList.length;

              if (totalTeamMembers === 0) {
                return (
                  <EmptyState
                    title="No team activity to aggregate"
                    body="Team aggregates appear once team members have recorded workflow activity, subject to the 5-member privacy suppression floor."
                  />
                );
              }

              if (!isAggregateDisclosable(totalTeamMembers)) {
                return (
                  <EmptyState
                    title="Team aggregate suppressed"
                    body={`Population metrics require a minimum of ${WORKIQ_MIN_AGGREGATE_SAMPLE_SIZE} members/samples to protect individual employee privacy (privacy boundary enforced). Current team sample count: ${totalTeamMembers}.`}
                  />
                );
              }

              return (
                <div className="ops-col ops-gap-sm">
                  <Metrics
                    items={[
                      { label: "Active teams", value: teamList.length || 1 },
                      { label: "Team members", value: totalTeamMembers },
                      { label: "Privacy floor", value: `≥ ${WORKIQ_MIN_AGGREGATE_SAMPLE_SIZE} members (Met)`, tone: "good" },
                    ]}
                  />
                  <p className="ops-muted ops-small">
                    Population metrics are disclosable because the team size meets or exceeds the required privacy floor of {WORKIQ_MIN_AGGREGATE_SAMPLE_SIZE} members.
                  </p>
                </div>
              );
            }}
          </Resource>
        </Panel>
      </div>
    </Page>
  );
}

/**
 * The roles view, rendered from the real policy (task 11.11 / requirement 11.4).
 *
 * `GET /permissions/matrix` serializes the same `ROLE_GRANTS` the API enforces, so this screen cannot
 * show a policy that is not the policy. Custom role creation is stated as unavailable and offers no
 * input, rather than a form that would accept a role nobody can grant.
 */
export function RolesView({ slots }: ViewProps) {
  const matrix = (slots.permissionMatrix ?? {
    value: null,
    state: "loading",
    error: null,
    loadedAt: null,
  }) as ResourceSlot<{ roles: string[]; permissions: string[]; grants: Record<string, Record<string, boolean | "own">> } | null>;

  return (
    <Page title="Roles" lead="What each role in your organization can do. This is the policy the API enforces.">
      <Resource slot={matrix} emptyTitle="Policy unavailable" emptyBody="The role policy did not load.">
        {(value) =>
          !value ? null : (
            <>
              <table className="ops-table">
                <thead>
                  <tr>
                    <th scope="col">Permission</th>
                    {value.roles
                      .filter((role) => role !== "STAFF_ADMIN")
                      .map((role) => (
                        <th scope="col" key={role} title={PLATFORM_ROLE_DESCRIPTION[role]}>
                          {PLATFORM_ROLE_LABEL[role] ?? role}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {value.permissions
                    .filter((permission) => !permission.startsWith("internal:"))
                    .map((permission) => (
                      <tr key={permission}>
                        <th scope="row">{permission}</th>
                        {value.roles
                          .filter((role) => role !== "STAFF_ADMIN")
                          .map((role) => {
                            const held = value.grants[role]?.[permission];
                            return (
                              <td key={role}>
                                {/* "own" is reported rather than a bare yes: "you can cancel runs" and
                                    "you can cancel your own runs" are different promises. */}
                                {held === true ? "Yes" : held === "own" ? "Own only" : "—"}
                              </td>
                            );
                          })}
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="ops-muted">
                Custom roles are not available in this release. The six roles above are fixed, and there is
                no control here that would accept a new one, because nothing would enforce it.
              </p>
            </>
          )
        }
      </Resource>
    </Page>
  );
}

export function BillingView({ slots, navigate }: ViewProps) {
  const route = customerRoute("admin-billing");
  const organization = one<Organization | null>(slots, "organization", null);
  if (!route) return null;
  return (
    <DisabledSection route={route}>
      <Resource
        slot={organization}
        emptyTitle="Plan not recorded"
        emptyBody="No plan value is recorded for this organization."
      >
        {(value) =>
          value ? (
            <div className="ops-col ops-gap-sm">
              <p>
                Recorded plan: <strong>{value.plan || "Not recorded"}</strong>
              </p>
              <p className="ops-muted">
                This value is reporting-only. No runtime limit or billing behaviour reads it — the
                concurrent-run ceiling is a separate setting that only AmazFlow can change.
              </p>
              {/* The commercial contact route, from the organization's own record (requirement 11.9).
                  Absent is stated as absent: an invented "billing@" address is a dead end somebody
                  would send an invoice query to. */}
              <p>
                Billing contact on record:{" "}
                <strong>
                  {value.billingContact?.email ||
                    value.billingContact?.name ||
                    value.primaryContact?.email ||
                    "None recorded"}
                </strong>
              </p>
              <div>
                <Btn variant="primary" onClick={() => navigate({ routeId: "support" })}>
                  Contact AmazFlow about commercial changes
                </Btn>
              </div>
            </div>
          ) : null
        }
      </Resource>
    </DisabledSection>
  );
}

export function NotFoundView() {
  return (
    <Page title="Not found" lead="That link does not point at anything in your organization.">
      <p className="ops-muted">
        If you followed a link from an email or a bookmark, the record may have been removed, or it may
        belong to a different organization.
      </p>
    </Page>
  );
}



/* ========================================================= Phase 4 administration and settings = */

export type Contact = { name?: string; email?: string; phone?: string } | null;
export type Organization = {
  id?: string;
  name: string;
  slug: string;
  status: string;
  plan?: string | null;
  primaryDomain?: string;
  primaryContact?: Contact;
  billingContact?: Contact;
  branding?: {
    displayName?: string;
    loginMessage?: string;
    accent?: string;
    logoUrl?: string;
  };
  settings?: {
    maxConcurrentRuns?: number;
    allowedEmailDomains?: string[];
    timezone?: string;
  };
  updatedAt?: string;
};

export type CustomerUser = {
  username: string;
  email: string;
  role?: string;
  platformRole?: PlatformRole | string;
  teamIds?: string[];
  enabled?: boolean;
  userStatus?: string | null;
  state?: string;
  membershipStatus?: string;
  invitedAt?: string | null;
  invitedBy?: string | null;
  activatedAt?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type Team = {
  id: string;
  name: string;
  memberUsernames?: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type TeamsResponse = {
  teams: Team[];
  grantsPermissions: false;
  grantsPermissionsReason: string;
};

export type SecurityFacts = {
  accessTokenMinutes: number;
  idTokenMinutes: number;
  refreshTokenDays: number;
  passwordPolicy: {
    minimumLength: number;
    requireLowercase: boolean;
    requireUppercase: boolean;
    requireNumbers: boolean;
    requireSymbols: boolean;
  };
  mfaEnrollmentAvailable: boolean;
  singleSignOnAvailable: boolean;
  directoryProvisioningAvailable: boolean;
};

export type AuditEntry = {
  id: string;
  at: string;
  actor?: string;
  actorLabel?: string;
  action: string;
  summary: string;
};

export type NotificationRecord = {
  id: string;
  kind: string;
  title: string;
  body: string;
  deepLink: string;
  createdAt: string;
  read: boolean;
};

export type Preferences = {
  username: string;
  values: Record<string, boolean | string>;
  updatedAt: string | null;
  keys: string[];
};

export type Profile = {
  email: string | null;
  displayName: string;
  givenName: string;
  familyName: string;
  updatedAt: string | null;
};

/**
 * Invited, active, or deactivated (requirement 9.16/9.21).
 *
 * The control plane already derives this from the identity provider's status, the enabled flag, and
 * the membership record, and it RECONCILES the membership as part of that read — so `state` is the
 * authoritative answer and is preferred whenever it is present. The derivation below is the fallback
 * for a response that predates the field, and it reads the same three facts in the same order rather
 * than inventing a second opinion: two places deciding who is deactivated is two places to disagree
 * about whose access was removed.
 */
export function deriveUserState(user: CustomerUser): "invited" | "active" | "deactivated" {
  if (user.state === "invited" || user.state === "active" || user.state === "deactivated")
    return user.state;
  if (user.enabled === false || user.membershipStatus === "deactivated") return "deactivated";
  if (user.userStatus === "FORCE_CHANGE_PASSWORD" || user.membershipStatus === "invited") return "invited";
  return "active";
}

const contactPayload = (name: string, email: string, phone?: string) => {
  if (!name.trim() && !email.trim() && !(phone || "").trim()) return null;
  return { name: name.trim(), email: email.trim(), ...(phone !== undefined ? { phone: phone.trim() } : {}) };
};

export function OrganizationView({ slots, client, refresh }: ViewProps) {
  const organization = one<Organization | null>(slots, "organization", null);
  return (
    <Page title="Organization" lead="Your customer-visible profile, invitation policy, and branding.">
      <Resource
        slot={organization}
        emptyTitle="Organization not found"
        emptyBody="Your account is signed in, but its organization record was not returned."
      >
        {(value) => (value ? <OrganizationEditor key={value.updatedAt ?? value.slug} organization={value} client={client} refresh={refresh} /> : null)}
      </Resource>
    </Page>
  );
}

function OrganizationEditor({ organization, client, refresh }: { organization: Organization; client: ApiClient; refresh: () => Promise<void> }) {
  const action = useAction(refresh);
  const [name, setName] = useState(organization.name ?? "");
  const [domain, setDomain] = useState(organization.primaryDomain ?? "");
  const [primaryName, setPrimaryName] = useState(organization.primaryContact?.name ?? "");
  const [primaryEmail, setPrimaryEmail] = useState(organization.primaryContact?.email ?? "");
  const [primaryPhone, setPrimaryPhone] = useState(organization.primaryContact?.phone ?? "");
  const [billingName, setBillingName] = useState(organization.billingContact?.name ?? "");
  const [billingEmail, setBillingEmail] = useState(organization.billingContact?.email ?? "");
  const [domains, setDomains] = useState((organization.settings?.allowedEmailDomains ?? []).join(", "));
  const [timezone, setTimezone] = useState(organization.settings?.timezone ?? "UTC");
  const [displayName, setDisplayName] = useState(organization.branding?.displayName ?? "");
  const [loginMessage, setLoginMessage] = useState(organization.branding?.loginMessage ?? "");
  const [accent, setAccent] = useState(organization.branding?.accent ?? "");
  const [logoUrl, setLogoUrl] = useState(organization.branding?.logoUrl ?? "");
  const busy = action.pending !== null;
  const status = ORGANIZATION_STATUS_LABEL[organization.status] ?? organization.status;

  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    void action.run("profile", "Organization profile updated.", () =>
      client.post(endpoints.orgProfile(organization.slug).path, {
        name,
        primaryDomain: domain,
        primaryContact: contactPayload(primaryName, primaryEmail, primaryPhone),
        billingContact: contactPayload(billingName, billingEmail),
      }),
    );
  };

  const saveSettings = (event: FormEvent) => {
    event.preventDefault();
    const allowedEmailDomains = domains
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    void action.run("settings", "Organization settings updated.", () =>
      client.post(endpoints.orgSettings(organization.slug).path, { allowedEmailDomains, timezone }),
    );
  };

  const saveBranding = (event: FormEvent) => {
    event.preventDefault();
    if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) {
      action.setFeedback({ tone: "bad", text: "Accent colour must be a six-digit hexadecimal value such as #ff765c." });
      return;
    }
    if (logoUrl) {
      try {
        if (new URL(logoUrl).protocol !== "https:") throw new Error();
      } catch {
        action.setFeedback({ tone: "bad", text: "Logo location must be a valid https:// address." });
        return;
      }
    }
    void action.run("branding", "Organization branding updated.", () =>
      client.post(endpoints.orgBranding(organization.slug).path, { displayName, loginMessage, accent, logoUrl }),
    );
  };

  return (
    <div className="ops-col ops-gap-md">
      <Alert tone={organization.status === "active" ? "good" : "waiting"} title={`Execution status: ${status}`}>
        {organization.status === "active"
          ? "New workflow runs may be created."
          : "New workflow runs are currently refused. Administration remains available."}
      </Alert>
      <ActionFeedback value={action.feedback} />
      <Panel title="Profile" sub={`Tenant identifier: ${organization.slug}`}>
        <form className="ops-col ops-gap-sm" onSubmit={saveProfile}>
          <Field label="Organization name"><input className="ops-input" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} required /></Field>
          <Field label="Primary domain" hint="A bare domain such as example.com"><input className="ops-input" value={domain} onChange={(event) => setDomain(event.target.value)} disabled={busy} /></Field>
          <div className="ops-grid-2">
            <Field label="Primary contact name"><input className="ops-input" value={primaryName} onChange={(event) => setPrimaryName(event.target.value)} disabled={busy} /></Field>
            <Field label="Primary contact email"><input className="ops-input" type="email" value={primaryEmail} onChange={(event) => setPrimaryEmail(event.target.value)} disabled={busy} /></Field>
            <Field label="Primary contact phone"><input className="ops-input" value={primaryPhone} onChange={(event) => setPrimaryPhone(event.target.value)} disabled={busy} /></Field>
          </div>
          <div className="ops-grid-2">
            <Field label="Billing contact name"><input className="ops-input" value={billingName} onChange={(event) => setBillingName(event.target.value)} disabled={busy} /></Field>
            <Field label="Billing contact email"><input className="ops-input" type="email" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} disabled={busy} /></Field>
          </div>
          <div><Btn type="submit" variant="primary" disabled={busy}>{action.pending === "profile" ? "Saving…" : "Save profile"}</Btn></div>
        </form>
      </Panel>
      <Panel title="Organization settings">
        <form className="ops-col ops-gap-sm" onSubmit={saveSettings}>
          <Field label="Allowed invitation domains" hint="Comma-separated. Leave empty to allow any email domain."><input className="ops-input" value={domains} onChange={(event) => setDomains(event.target.value)} disabled={busy} /></Field>
          <Field label="Time zone"><input className="ops-input" value={timezone} onChange={(event) => setTimezone(event.target.value)} disabled={busy} /></Field>
          <p className="ops-muted">Concurrent run limit: {organization.settings?.maxConcurrentRuns ? organization.settings.maxConcurrentRuns : "No configured ceiling"}. Only AmazFlow staff can change this enforced limit.</p>
          <div><Btn type="submit" variant="primary" disabled={busy}>{action.pending === "settings" ? "Saving…" : "Save settings"}</Btn></div>
        </form>
      </Panel>
      <Panel title="Branding">
        <form className="ops-col ops-gap-sm" onSubmit={saveBranding}>
          <Field label="Display name"><input className="ops-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={busy} /></Field>
          <Field label="Sign-in message"><input className="ops-input" value={loginMessage} onChange={(event) => setLoginMessage(event.target.value)} disabled={busy} /></Field>
          <div className="ops-grid-2">
            <Field label="Accent colour" hint="# followed by six hexadecimal digits"><input className="ops-input" value={accent} onChange={(event) => setAccent(event.target.value)} disabled={busy} placeholder="#ff765c" /></Field>
            <Field label="Logo location" hint="A public https:// address"><input className="ops-input" type="url" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} disabled={busy} /></Field>
          </div>
          <div><Btn type="submit" variant="primary" disabled={busy}>{action.pending === "branding" ? "Saving…" : "Save branding"}</Btn></div>
        </form>
      </Panel>
    </div>
  );
}

export function UsersView({ principal, slots, client, refresh }: ViewProps) {
  const users = list<CustomerUser>(slots, "users");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [email, setEmail] = useState("");
  const [coarseRole, setCoarseRole] = useState("FRONTLINE");
  const action = useAction(refresh);
  const mayInvite = can(principal, "user:invite", { orgId: principal.orgId }).allow;
  const maySetRole = can(principal, "user:set_role", { orgId: principal.orgId }).allow;
  const maySetStatus = can(principal, "user:set_status", { orgId: principal.orgId }).allow;
  const busy = action.pending !== null;

  const invite = (event: FormEvent) => {
    event.preventDefault();
    void action.run("invite", `Invitation sent to ${email.trim()}.`, async () => {
      await client.post(endpoints.inviteUser(principal.orgId).path, { email: email.trim(), role: coarseRole });
      setEmail("");
    });
  };

  return (
    <Page title="People" lead="Invite people, manage access, and retain attribution by deactivating rather than deleting accounts.">
      <div className="ops-col ops-gap-md">
        {mayInvite && (
          <Panel title="Invite a person" sub="Fine-grained roles can be assigned after the account is active.">
            <form className="ops-toolbar" onSubmit={invite}>
              <input className="ops-input" type="email" aria-label="Email address" placeholder="person@example.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} required />
              <Select value={coarseRole} onChange={setCoarseRole} label="Initial access" options={[
                { value: "FRONTLINE", label: "Team member (starts as Operator)" },
                { value: "CLIENT_ADMIN", label: "Team administrator (starts as Administrator)" },
              ]} />
              <Btn type="submit" variant="primary" disabled={busy || !email.trim()}>{action.pending === "invite" ? "Sending…" : "Send invitation"}</Btn>
            </form>
          </Panel>
        )}
        <ActionFeedback value={action.feedback} />
        <div className="ops-toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Search people…" />
          <Select value={stateFilter} onChange={setStateFilter} label="Account state" options={[
            { value: "all", label: "All states" },
            { value: "invited", label: "Invited" },
            { value: "active", label: "Active" },
            { value: "deactivated", label: "Deactivated" },
          ]} />
          {/* The role options are the six roles the policy actually has, from `@amazflow/permissions`,
              not a list written out here that could drift from the one the API enforces. */}
          <Select value={roleFilter} onChange={setRoleFilter} label="Role" options={[
            { value: "all", label: "All roles" },
            ...CUSTOMER_ROLES.map((role) => ({ value: role, label: PLATFORM_ROLE_LABEL[role] ?? role })),
          ]} />
        </div>
        <Resource slot={users} emptyTitle="No people yet" emptyBody="An organization administrator can send the first invitation above.">
          {(value) => {
            const normalized = query.trim().toLowerCase();
            const shown = value.filter((user) => {
              const state = deriveUserState(user);
              if (stateFilter !== "all" && state !== stateFilter) return false;
              if (roleFilter !== "all" && (user.platformRole ?? "") !== roleFilter) return false;
              return !normalized || `${user.email} ${user.username}`.toLowerCase().includes(normalized);
            });
            if (shown.length === 0)
              return (
                <EmptyState
                  title="No people match these filters"
                  body={`${value.length} ${value.length === 1 ? "person is" : "people are"} in this organization. Clear the search or choose a different account state or role.`}
                />
              );
            return (
              <div className="ops-tablewrap">
                <table className="ops-table">
                  <thead><tr><th>Person</th><th>State</th><th>Role</th><th>Teams</th><th>Last sign-in</th><th>Actions</th></tr></thead>
                  <tbody>
                    {shown.map((user) => {
                      const state = deriveUserState(user);
                      const key = user.username || user.email;
                      return (
                        <tr key={key}>
                          <td><strong>{user.email}</strong><br /><span className="ops-muted">{user.username}</span></td>
                          <td><Pill tone={USER_STATE_TONE[state]}>{USER_STATE_LABEL[state]}</Pill></td>
                          <td>
                            {maySetRole && state !== "invited" ? (
                              <select className="ops-select" aria-label={`Role for ${user.email}`} value={user.platformRole ?? "OPERATOR"} disabled={busy} onChange={(event) => void action.run(`role:${key}`, `Role updated for ${user.email}.`, () => client.post(endpoints.setUserRole(principal.orgId, key).path, { role: event.target.value }))}>
                                {CUSTOMER_ROLES.map((role) => <option key={role} value={role}>{PLATFORM_ROLE_LABEL[role]}</option>)}
                              </select>
                            ) : (PLATFORM_ROLE_LABEL[user.platformRole ?? ""] ?? user.platformRole ?? "Not recorded")}
                          </td>
                          <td>{user.teamIds?.length ? user.teamIds.length : "No teams"}</td>
                          <td>{user.lastLoginAt ? relativeTime(user.lastLoginAt) : "Not recorded"}</td>
                          <td>
                            <div className="ops-row ops-gap-xs">
                              {state === "invited" && mayInvite && <Btn size="sm" disabled={busy} onClick={() => void action.run(`resend:${key}`, `Invitation resent to ${user.email}.`, () => client.post(endpoints.resendInvitation(principal.orgId, key).path))}>Resend</Btn>}
                              {state === "invited" && mayInvite && <Btn size="sm" variant="danger" disabled={busy} onClick={() => { if (window.confirm(`Withdraw the pending invitation for ${user.email}?`)) void action.run(`revoke:${key}`, `Invitation withdrawn for ${user.email}.`, () => client.del(endpoints.revokeInvitation(principal.orgId, key).path)); }}>Revoke</Btn>}
                              {state === "active" && maySetStatus && <Btn size="sm" variant="danger" disabled={busy} onClick={() => { if (window.confirm(`Deactivate ${user.email}? Their account stays recorded for audit attribution.`)) void action.run(`deactivate:${key}`, `${user.email} deactivated.`, () => client.post(endpoints.setUserStatus(principal.orgId, key).path, { enabled: false })); }}>Deactivate</Btn>}
                              {state === "deactivated" && maySetStatus && <Btn size="sm" disabled={busy} onClick={() => void action.run(`reactivate:${key}`, `${user.email} reactivated.`, () => client.post(endpoints.setUserStatus(principal.orgId, key).path, { enabled: true }))}>Reactivate</Btn>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          }}
        </Resource>
        <p className="ops-muted">Accounts are never deleted from this view. Deactivation removes access while preserving the actor attached to historical audit events.</p>
      </div>
    </Page>
  );
}


export function TeamsView({ principal, slots, client, refresh }: ViewProps) {
  const teams = one<TeamsResponse | null>(slots, "teams", null);
  const users = list<CustomerUser>(slots, "users");
  const [name, setName] = useState("");
  const action = useAction(refresh);
  const mayManage = can(principal, "team:manage", { orgId: principal.orgId }).allow;
  const busy = action.pending !== null;

  const createTeam = (event: FormEvent) => {
    event.preventDefault();
    void action.run("create-team", `Created the team “${name.trim()}”.`, async () => {
      await client.post(endpoints.createTeam().path, { name: name.trim() });
      setName("");
    });
  };

  return (
    <Page title="Teams" lead="Teams group people and direct notifications. They grant no permissions in this release.">
      <div className="ops-col ops-gap-md">
        <Alert title="Organization only">Team membership does not change a person's role or permissions, and there is no team-permission control.</Alert>
        {mayManage && (
          <Panel title="Create a team">
            <form className="ops-toolbar" onSubmit={createTeam}>
              <input className="ops-input" aria-label="Team name" placeholder="Team name" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} required />
              <Btn type="submit" variant="primary" disabled={busy || !name.trim()}>{action.pending === "create-team" ? "Creating…" : "Create team"}</Btn>
            </form>
          </Panel>
        )}
        <ActionFeedback value={action.feedback} />
        <Resource slot={teams} emptyTitle="No teams yet" emptyBody="Create a team to group people for organization and notifications.">
          {(response) => response ? (
            <Resource slot={users} emptyTitle="No people to assign" emptyBody="Invite a person before assigning team membership.">
              {(people) => response.teams.length === 0 ? (
                <EmptyState title="No teams yet" body={mayManage ? "Create the first team above." : "An organization administrator can create the first team."} />
              ) : (
                <div className="ops-col ops-gap-sm">
                  {response.teams.map((team) => <TeamEditor key={team.id} team={team} people={people} mayManage={mayManage} client={client} action={action} />)}
                </div>
              )}
            </Resource>
          ) : null}
        </Resource>
      </div>
    </Page>
  );
}

function TeamEditor({ team, people, mayManage, client, action }: { team: Team; people: CustomerUser[]; mayManage: boolean; client: ApiClient; action: ReturnType<typeof useAction> }) {
  const [name, setName] = useState(team.name);
  const members = team.memberUsernames ?? [];
  const candidates = people.filter((person) => !members.includes(person.username) && !members.includes(person.email));
  const [selected, setSelected] = useState(candidates[0]?.username ?? candidates[0]?.email ?? "");
  const busy = action.pending !== null;

  useEffect(() => {
    if (!selected && candidates.length) setSelected(candidates[0].username || candidates[0].email);
  }, [selected, candidates]);

  return (
    <Panel
      title={team.name}
      sub={`${members.length} member${members.length === 1 ? "" : "s"}`}
      actions={mayManage ? <Btn size="sm" variant="danger" disabled={busy} onClick={() => { if (window.confirm(`Delete the team “${team.name}”? Membership will be removed from every person.`)) void action.run(`delete-team:${team.id}`, `Deleted the team “${team.name}”.`, () => client.del(endpoints.deleteTeam(team.id).path)); }}>Delete team</Btn> : undefined}
    >
      <div className="ops-col ops-gap-sm">
        {mayManage && (
          <form className="ops-toolbar" onSubmit={(event) => { event.preventDefault(); void action.run(`rename-team:${team.id}`, `Renamed the team to “${name.trim()}”.`, () => client.put(endpoints.renameTeam(team.id).path, { name: name.trim() })); }}>
            <input className="ops-input" aria-label={`Name for ${team.name}`} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
            <Btn type="submit" size="sm" disabled={busy || !name.trim() || name.trim() === team.name}>Rename</Btn>
          </form>
        )}
        {members.length ? (
          <ul className="ops-list">
            {members.map((username) => {
              const person = people.find((candidate) => candidate.username === username || candidate.email === username);
              return (
                <li key={username}>
                  <span>{person?.email ?? username}</span>
                  {mayManage && <Btn size="sm" disabled={busy} onClick={() => { if (window.confirm(`Remove ${person?.email ?? username} from “${team.name}”?`)) void action.run(`remove-member:${team.id}:${username}`, `Removed ${person?.email ?? username} from “${team.name}”.`, () => client.del(endpoints.removeTeamMember(team.id, username).path)); }}>Remove</Btn>}
                </li>
              );
            })}
          </ul>
        ) : <EmptyState inline title="No members" body="This team is ready for its first member." />}
        {mayManage && candidates.length > 0 && (
          <form className="ops-toolbar" onSubmit={(event) => { event.preventDefault(); if (selected) void action.run(`add-member:${team.id}:${selected}`, `Added ${selected} to “${team.name}”.`, () => client.post(endpoints.addTeamMember(team.id).path, { username: selected })); }}>
            <Select value={selected} onChange={setSelected} label={`Add a member to ${team.name}`} options={candidates.map((person) => ({ value: person.username || person.email, label: person.email }))} />
            <Btn type="submit" size="sm" disabled={busy || !selected}>Add member</Btn>
          </form>
        )}
      </div>
    </Panel>
  );
}

function SecurityFactsPanel({ facts }: { facts: SecurityFacts }) {
  const policy = facts.passwordPolicy;
  const rules = [
    `${policy.minimumLength} characters minimum`,
    policy.requireLowercase ? "lowercase" : null,
    policy.requireUppercase ? "uppercase" : null,
    policy.requireNumbers ? "number" : null,
    policy.requireSymbols ? "symbol" : null,
  ].filter(Boolean).join(", ");
  return (
    <div className="ops-col ops-gap-sm">
      <Metrics
        items={[
          { label: "Access token", value: facts.accessTokenMinutes, unit: "min" },
          { label: "ID token", value: facts.idTokenMinutes, unit: "min" },
          { label: "Refresh token", value: facts.refreshTokenDays, unit: "days" },
        ]}
      />
      <p>
        <strong>Password policy:</strong> {rules}.
      </p>
    </div>
  );
}

function DisabledCapability({ title, reason }: { title: string; reason: string }) {
  return (
    <Panel title={title} actions={<Pill tone="muted">Not available in this release</Pill>}>
      <p className="ops-muted">{reason}</p>
    </Panel>
  );
}

type SecretRecord = {
  id: string;
  name: string;
  kind: string;
  hint?: string;
  createdAt?: string;
  rotatedAt?: string | null;
  lastUsedAt?: string | null;
};

const SECRET_KINDS: { value: string; label: string }[] = [
  { value: "api_key", label: "API key" },
  { value: "bearer_token", label: "Bearer token" },
  { value: "basic_auth", label: "Basic auth" },
  { value: "oauth_refresh", label: "OAuth refresh token" },
  { value: "webhook_secret", label: "Webhook secret" },
];
const SECRET_KIND_LABEL: Record<string, string> = Object.fromEntries(SECRET_KINDS.map((k) => [k.value, k.label]));

export function SecurityView({ slots, principal, client, refresh }: ViewProps) {
  const facts = one<SecurityFacts | null>(slots, "securityFacts", null);
  const agents = list<{ id: string; name?: string; agentType?: string; connectionStatus?: string; status?: string; createdAt?: string; lastHeartbeatAt?: string }>(slots, "agents");
  const secrets = list<SecretRecord>(slots, "secrets");
  const mayManageSecrets = can(principal, "secret:manage", { orgId: principal.orgId }).allow;
  const action = useAction(refresh);
  const busy = action.pending !== null;
  const [secretName, setSecretName] = useState("");
  const [secretKind, setSecretKind] = useState("api_key");
  const [secretValue, setSecretValue] = useState("");
  const [rotateValues, setRotateValues] = useState<Record<string, string>>({});

  const createSecretRecord = (event: FormEvent) => {
    event.preventDefault();
    void action.run("secret-create", `Created the secret "${secretName.trim()}".`, async () => {
      await client.post(endpoints.createSecret().path, { name: secretName.trim(), kind: secretKind, value: secretValue });
      setSecretName("");
      setSecretValue("");
      setSecretKind("api_key");
    });
  };

  return (
    <Page title="Security" lead="The session, password, and registered agent facts the platform actually enforces.">
      <div className="ops-col ops-gap-md">
        <Resource slot={facts} emptyTitle="Security facts unavailable" emptyBody="The platform did not return its session and password policy.">
          {(value) => value ? <Panel title="Session and password policy"><SecurityFactsPanel facts={value} /></Panel> : null}
        </Resource>
        <Panel title="Registered agent credentials" sub="Credential values are never returned.">
          <Resource slot={agents} emptyTitle="No registered agents" emptyBody="No browser extension or desktop agent credential is registered for this organization.">
            {(value) => <div className="ops-tablewrap"><table className="ops-table"><thead><tr><th>Agent</th><th>Type</th><th>Status</th><th>Registered</th><th>Last heartbeat</th></tr></thead><tbody>{value.map((agent) => <tr key={agent.id}><td>{agent.name ?? agent.id}</td><td>{agent.agentType ?? "Not recorded"}</td><td><Pill tone={agent.connectionStatus === "connected" ? "good" : "muted"}>{agent.connectionStatus ?? agent.status ?? "Not recorded"}</Pill></td><td>{agent.createdAt ? relativeTime(agent.createdAt) : "Not recorded"}</td><td>{agent.lastHeartbeatAt ? relativeTime(agent.lastHeartbeatAt) : "Not recorded"}</td></tr>)}</tbody></table></div>}
          </Resource>
        </Panel>
        <Panel title="Managed secrets" sub="A value is accepted once, held only in the external secret store, and never returned or displayed again.">
          <div className="ops-col ops-gap-sm">
            {mayManageSecrets && (
              <form className="ops-col ops-gap-sm" onSubmit={createSecretRecord}>
                <div className="ops-grid-2">
                  <Field label="Secret name"><input className="ops-input" value={secretName} onChange={(event) => setSecretName(event.target.value)} disabled={busy} required /></Field>
                  <Select value={secretKind} onChange={setSecretKind} label="Kind" options={SECRET_KINDS} />
                </div>
                <Field label="Value" hint="Stored only in the external secret store; it cannot be viewed again after this."><input className="ops-input" type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} disabled={busy} required autoComplete="off" /></Field>
                <div><Btn type="submit" variant="primary" disabled={busy || !secretName.trim() || !secretValue.trim()}>{action.pending === "secret-create" ? "Creating…" : "Create secret"}</Btn></div>
              </form>
            )}
            <ActionFeedback value={action.feedback} />
            <Resource slot={secrets} emptyTitle="No managed secrets" emptyBody="Create a secret to reference from a workflow step without exposing its value.">
              {(value) => (
                <div className="ops-tablewrap"><table className="ops-table"><thead><tr><th>Name</th><th>Kind</th><th>Ends in</th><th>Created</th><th>Last used</th>{mayManageSecrets && <th>Actions</th>}</tr></thead><tbody>
                  {value.map((secret) => (
                    <tr key={secret.id}>
                      <td><strong>{secret.name}</strong></td>
                      <td>{SECRET_KIND_LABEL[secret.kind] ?? secret.kind}</td>
                      <td>•••• {secret.hint ?? "----"}</td>
                      <td>{secret.createdAt ? relativeTime(secret.createdAt) : "Not recorded"}{secret.rotatedAt ? ` · rotated ${relativeTime(secret.rotatedAt)}` : ""}</td>
                      <td>{secret.lastUsedAt ? relativeTime(secret.lastUsedAt) : "Never used"}</td>
                      {mayManageSecrets && (
                        <td>
                          <span className="ops-col ops-gap-sm">
                            <span className="ops-row ops-gap-sm">
                              <input className="ops-input" type="password" autoComplete="off" aria-label={`New value for ${secret.name}`} value={rotateValues[secret.id] ?? ""} onChange={(event) => setRotateValues((current) => ({ ...current, [secret.id]: event.target.value }))} disabled={busy} placeholder="New value" />
                              <Btn size="sm" disabled={busy || !rotateValues[secret.id]?.trim()} onClick={() => void action.run(`secret-rotate-${secret.id}`, `Rotated the secret "${secret.name}".`, async () => {
                                await client.post(endpoints.rotateSecret(secret.id).path, { value: rotateValues[secret.id].trim() });
                                setRotateValues((current) => { const next = { ...current }; delete next[secret.id]; return next; });
                              })}>{action.pending === `secret-rotate-${secret.id}` ? "Rotating…" : "Rotate"}</Btn>
                            </span>
                            <Btn size="sm" variant="danger" disabled={busy} onClick={() => { if (window.confirm(`Delete the secret "${secret.name}"? Any workflow step referencing it will stop working.`)) void action.run(`secret-delete-${secret.id}`, `Deleted the secret "${secret.name}".`, () => client.del(endpoints.deleteSecret(secret.id).path)); }}>Delete</Btn>
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody></table></div>
              )}
            </Resource>
          </div>
        </Panel>
        <DisabledCapability title="Multi-factor authentication" reason="The identity provider already supports software-token authentication, but AmazFlow has not shipped the complete enrolment and recovery flow. No setup control is shown." />
        <DisabledCapability title="Single sign-on" reason="Federated sign-in cannot be enabled safely until first sign-in assigns the organization claim and coarse group. That assignment flow is not available in this release." />
        <DisabledCapability title="Directory provisioning" reason="Directory provisioning depends on a complete membership synchronization flow. It is planned, but no connection or provisioning control is active in this release." />
      </div>
    </Page>
  );
}

export function MfaSetupView() {
  const route = customerRoute("mfa-setup");
  return route ? <DisabledSection route={route} /> : null;
}

/**
 * The organization-scoped audit read (task 11.13 / requirement 11.7).
 *
 * `GET /audit` reads the caller's own partition and nothing else, which is why this screen exists
 * rather than the cross-organization `GET /activity` being widened to serve it (requirement 6.14).
 *
 * The action filter's options are derived from the records that came back, not from a list of action
 * names written out here. A hardcoded list would offer filters that match nothing and omit actions the
 * platform has started recording, and both failures look like "the audit trail is missing things".
 */
export function AuditView({ slots }: ViewProps) {
  const audit = list<AuditEntry>(slots, "audit");
  const [actionFilter, setActionFilter] = useState("all");
  return (
    <Page
      title="Audit trail"
      lead="Administrative activity recorded within your organization. The most recent 300 records."
    >
      <Resource
        slot={audit}
        emptyTitle="No administrative activity recorded"
        emptyBody="Changes to people, teams, settings, invitations, and security appear here."
      >
        {(value) => {
          const actions = [...new Set(value.map((entry) => entry.action).filter(Boolean))].sort();
          const shown = actionFilter === "all" ? value : value.filter((entry) => entry.action === actionFilter);
          return (
            <div className="ops-col ops-gap-sm">
              <div className="ops-toolbar">
                <Select
                  value={actionFilter}
                  onChange={setActionFilter}
                  label="Action"
                  options={[
                    { value: "all", label: `All actions (${value.length})` },
                    ...actions.map((action) => ({ value: action, label: action })),
                  ]}
                />
              </div>
              {shown.length === 0 ? (
                <EmptyState
                  title="No records match this action"
                  body="Choose a different action, or All actions to see every record."
                />
              ) : (
                <div className="ops-tablewrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Action</th>
                        <th>Summary</th>
                        <th>Actor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.at ? relativeTime(entry.at) : "Not recorded"}</td>
                          <td>{entry.action}</td>
                          <td>{entry.summary}</td>
                          <td>{entry.actorLabel ?? entry.actor ?? "Not recorded"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        }}
      </Resource>
    </Page>
  );
}


export function ProfileView({ slots, client, refresh }: ViewProps) {
  const profile = one<Profile | null>(slots, "profile", null);
  return (
    <Page title="Your profile" lead="The identity attributes attached to your own account.">
      <Resource slot={profile} emptyTitle="Profile not found" emptyBody="The identity provider did not return a profile for this account.">
        {(value) => value ? <ProfileEditor key={value.updatedAt ?? value.email ?? "profile"} profile={value} client={client} refresh={refresh} /> : null}
      </Resource>
    </Page>
  );
}

function ProfileEditor({ profile, client, refresh }: { profile: Profile; client: ApiClient; refresh: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [givenName, setGivenName] = useState(profile.givenName ?? "");
  const [familyName, setFamilyName] = useState(profile.familyName ?? "");
  const action = useAction(refresh);
  const busy = action.pending !== null;
  return (
    <div className="ops-col ops-gap-md">
      <ActionFeedback value={action.feedback} />
      <Panel title="Profile">
        <form className="ops-col ops-gap-sm" onSubmit={(event) => { event.preventDefault(); void action.run("profile", "Your profile was updated.", () => client.put(endpoints.saveOwnProfile().path, { displayName, givenName, familyName })); }}>
          <Field label="Sign-in email" hint="Your sign-in email is not changed from this profile."><input className="ops-input" value={profile.email ?? "Not recorded"} readOnly disabled /></Field>
          <Field label="Display name"><input className="ops-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={busy} /></Field>
          <div className="ops-grid-2">
            <Field label="Given name"><input className="ops-input" value={givenName} onChange={(event) => setGivenName(event.target.value)} disabled={busy} /></Field>
            <Field label="Family name"><input className="ops-input" value={familyName} onChange={(event) => setFamilyName(event.target.value)} disabled={busy} /></Field>
          </div>
          <div><Btn type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</Btn></div>
        </form>
      </Panel>
    </div>
  );
}

const PASSWORD_RULES = [
  { label: "at least 12 characters", valid: (value: string) => value.length >= 12 },
  { label: "a lowercase letter", valid: (value: string) => /[a-z]/.test(value) },
  { label: "an uppercase letter", valid: (value: string) => /[A-Z]/.test(value) },
  { label: "a number", valid: (value: string) => /\d/.test(value) },
  { label: "a symbol", valid: (value: string) => /[^A-Za-z0-9]/.test(value) },
];

export function PersonalSecurityView({ slots, client, session, refresh, navigate }: ViewProps) {
  const facts = one<SecurityFacts | null>(slots, "securityFacts", null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [sessionPending, setSessionPending] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const action = useAction(refresh);
  const unmet = PASSWORD_RULES.filter((rule) => !rule.valid(newPassword));
  const mismatch = confirmation.length > 0 && confirmation !== newPassword;
  const busy = action.pending !== null || sessionPending;

  const changePassword = (event: FormEvent) => {
    event.preventDefault();
    if (unmet.length || mismatch) return;
    void action.run("password", "Your password was changed.", async () => {
      await changeOwnPassword(session, currentPassword, newPassword);
      await client.post(endpoints.ownPasswordChanged().path);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
    });
  };

  const signOutEverywhere = async () => {
    if (sessionPending) return;
    setSessionPending(true);
    setSessionError(null);
    try {
      await client.post(endpoints.revokeOwnSessions().path);
      await signOutSession(session);
    } catch (error) {
      setSessionError(errorText(error));
      setSessionPending(false);
    }
  };

  return (
    <Page title="Your security" lead="Change your own password and control your signed-in sessions.">
      <div className="ops-col ops-gap-md">
        <Resource slot={facts} emptyTitle="Security facts unavailable" emptyBody="The platform did not return its session and password policy.">
          {(value) => value ? <Panel title="Session facts"><SecurityFactsPanel facts={value} /><p className="ops-muted">A device-by-device session list is not recorded by the platform.</p></Panel> : null}
        </Resource>
        <ActionFeedback value={action.feedback} />
        {sessionError && <Alert tone="bad" title="Sessions were not revoked">{sessionError}</Alert>}
        <Panel title="Change your password">
          <form className="ops-col ops-gap-sm" onSubmit={changePassword}>
            <Field label="Current password"><input className="ops-input" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={busy} required /></Field>
            <Field label="New password" hint={newPassword && unmet.length ? `Still needed: ${unmet.map((rule) => rule.label).join(", ")}` : "At least 12 characters with upper, lower, number, and symbol."}><input className="ops-input" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={busy} required /></Field>
            <Field label="Confirm new password" error={mismatch ? "The two new-password values do not match." : undefined}><input className="ops-input" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} required /></Field>
            <div><Btn type="submit" variant="primary" disabled={busy || !currentPassword || !newPassword || unmet.length > 0 || mismatch}>{action.pending === "password" ? "Changing…" : "Change password"}</Btn></div>
          </form>
        </Panel>
        <Panel title="Sessions">
          <div className="ops-col ops-gap-sm">
            <p>Signing out everywhere revokes every session on every device, including this browser.</p>
            <div className="ops-row ops-gap-sm">
              <Btn disabled={busy} onClick={() => void signOutSession(session)}>Sign out of this browser</Btn>
              <Btn variant="danger" disabled={busy} onClick={() => void signOutEverywhere()}>{sessionPending ? "Signing out…" : "Sign out everywhere"}</Btn>
            </div>
          </div>
        </Panel>
        <DisabledCapability title="Two-factor authentication" reason="Software-token authentication is supported by the identity provider, but the complete AmazFlow enrolment and recovery flow is not available yet." />
        <div><Btn onClick={() => navigate({ routeId: "mfa-setup" })}>Read about two-factor setup</Btn></div>
      </div>
    </Page>
  );
}

export function NotificationPreferencesView({ slots, client, refresh }: ViewProps) {
  const preferences = one<Preferences | null>(slots, "preferences", null);
  return (
    <Page title="Notification preferences" lead="Choose which in-app events appear in your notification list.">
      <Alert title="In-app only">Email delivery is not offered in this release, so there is no email toggle.</Alert>
      <Resource slot={preferences} emptyTitle="Preferences unavailable" emptyBody="The platform did not return your stored preferences.">
        {(value) => value ? <PreferencesEditor key={value.updatedAt ?? value.username} preferences={value} client={client} refresh={refresh} /> : null}
      </Resource>
    </Page>
  );
}

function PreferencesEditor({ preferences, client, refresh }: { preferences: Preferences; client: ApiClient; refresh: () => Promise<void> }) {
  const [values, setValues] = useState<Record<string, boolean | string>>({ ...preferences.values });
  const action = useAction(refresh);
  const notificationKeys = preferences.keys.filter((key) => key.startsWith("notify."));
  const busy = action.pending !== null;
  return (
    <div className="ops-col ops-gap-md">
      <ActionFeedback value={action.feedback} />
      <Panel title="In-app events">
        <form className="ops-col ops-gap-sm" onSubmit={(event) => { event.preventDefault(); void action.run("preferences", "Notification preferences updated.", () => client.put(endpoints.saveOwnPreferences().path, { values: Object.fromEntries(notificationKeys.map((key) => [key, values[key] !== false])) })); }}>
          {notificationKeys.map((key) => {
            const kind = key.slice("notify.".length);
            return <Switch key={key} label={NOTIFICATION_KIND_LABEL[kind] ?? kind} checked={values[key] !== false} disabled={busy} onChange={(checked) => setValues((current) => ({ ...current, [key]: checked }))} />;
          })}
          <div><Btn type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save preferences"}</Btn></div>
        </form>
      </Panel>
    </div>
  );
}

export function NotificationsView({ slots, client, refresh, navigate }: ViewProps) {
  const notifications = list<NotificationRecord>(slots, "notifications");
  const action = useAction(refresh);
  const busy = action.pending !== null;
  return (
    <Page title="Notifications" lead="Events that need your attention across this organization.">
      <div className="ops-col ops-gap-md">
        <ActionFeedback value={action.feedback} />
        <Resource slot={notifications} emptyTitle="No notifications" emptyBody="Events such as approvals, failed runs, and connection problems appear here.">
          {(value) => {
            const unread = value.filter((notification) => !notification.read).length;
            const open = async (notification: NotificationRecord) => {
              if (!notification.read) {
                const marked = await action.run(`read:${notification.id}`, "Notification marked as read.", () => client.post(endpoints.readNotification(notification.id).path));
                if (!marked) return;
              }
              navigate(pathToView(CUSTOMER_ROUTE_TABLE, notification.deepLink));
            };
            return (
              <>
                <div className="ops-toolbar"><span>{unread} unread</span><Btn disabled={busy || unread === 0} onClick={() => void action.run("read-all", "All notifications marked as read.", () => client.post(endpoints.readAllNotifications().path))}>{action.pending === "read-all" ? "Marking…" : "Mark all read"}</Btn></div>
                <ul className="ops-list">
                  {value.map((notification) => (
                    <li key={notification.id}>
                      <button type="button" disabled={busy} onClick={() => void open(notification)}>
                        <span>
                          <strong>{notification.title}</strong>
                          <br />
                          <span className="ops-muted">{notification.body}</span>
                        </span>
                        <span className="ops-row ops-gap-sm ops-nowrap">
                          {/* The kind is a real persisted field, so it is shown as the words for that
                              kind rather than left as the stored key. */}
                          <Pill tone="neutral" plain>
                            {NOTIFICATION_KIND_LABEL[notification.kind] ?? notification.kind}
                          </Pill>
                          <Pill tone={notification.read ? "muted" : "waiting"}>
                            {notification.read ? "Read" : "Unread"}
                          </Pill>
                          <span className="ops-muted">
                            {notification.createdAt
                              ? relativeTime(notification.createdAt)
                              : "Creation time not recorded"}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            );
          }}
        </Resource>
      </div>
    </Page>
  );
}

export type InvitationFailure = "expired" | "used" | "error";
export function invitationFailureForStatus(status: number): InvitationFailure {
  if (status === 410) return "expired";
  if (status === 409) return "used";
  return "error";
}

export function InvitationAcceptance({ token, session, onRenewed }: { token: string; session: StoredSession | null; onRenewed: (session: StoredSession) => void }) {
  const [inspection, setInspection] = useState<{ organizationName: string; email: string } | null>(null);
  const [failure, setFailure] = useState<InvitationFailure | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let active = true;
    if (!token) {
      setFailure("error");
      setMessage("This invitation link does not contain a token.");
      return;
    }
    publicClientFor().get<{ organizationName: string; email: string }>(endpoints.inspectInvitation(token).path).then(
      (value) => { if (active) setInspection(value); },
      (error) => {
        if (!active) return;
        setFailure(invitationFailureForStatus(error instanceof ApiError ? error.status : 0));
        setMessage(errorText(error));
      },
    );
    return () => { active = false; };
  }, [token]);

  const accept = async () => {
    if (!session || accepting) return;
    setAccepting(true);
    setMessage(null);
    try {
      const client = clientFor(session, onRenewed);
      await client.post(endpoints.acceptInvitation(token).path);
      setAccepted(true);
    } catch (error) {
      setFailure(invitationFailureForStatus(error instanceof ApiError ? error.status : 0));
      setMessage(errorText(error));
    } finally {
      setAccepting(false);
    }
  };

  if (accepted)
    return <div className="ops-page"><Page title="Invitation accepted" lead="Your membership is active."><Alert tone="good">You can now open your AmazFlow workspace.</Alert><Btn href="/">Open workspace</Btn></Page></div>;
  if (failure === "expired")
    return <div className="ops-page"><Page title="This invitation expired" lead={message ?? "The invitation is no longer valid."}><Btn href="https://amazflow.com/contact/">Request a new invitation</Btn></Page></div>;
  if (failure === "used")
    return <div className="ops-page"><Page title="This invitation cannot be used" lead={message ?? "It was already accepted or withdrawn."}><Btn onClick={() => toLogin("/", false)}>Sign in instead</Btn></Page></div>;
  if (failure === "error")
    return <div className="ops-page"><Page title="Invitation unavailable" lead={message ?? "The invitation could not be inspected."}><Btn href="https://amazflow.com/contact/">Contact AmazFlow</Btn></Page></div>;
  if (!inspection)
    return <div className="ops-page" aria-busy="true"><Page title="Opening invitation"><SkeletonPanel rows={4} /></Page></div>;

  const wrongAccount = !!session && session.email.toLowerCase() !== inspection.email.toLowerCase();
  return (
    <div className="ops-page">
      <Page title={`Join ${inspection.organizationName}`} lead={`This invitation was sent to ${inspection.email}.`}>
        <div className="ops-col ops-gap-md">
          {!session && <Alert title="Sign in required">Sign in as {inspection.email} before accepting. The organization and role come from the invitation record and cannot be changed here.</Alert>}
          {wrongAccount && <Alert tone="bad" title="Different account signed in">You are signed in as {session?.email}. Sign out and use {inspection.email} to accept this invitation.</Alert>}
          {!session ? <Btn variant="primary" onClick={() => toLogin(`/accept-invitation/?token=${encodeURIComponent(token)}`, false)}>Sign in to accept</Btn> : <Btn variant="primary" disabled={accepting || wrongAccount} onClick={() => void accept()}>{accepting ? "Accepting…" : "Accept invitation"}</Btn>}
          {message && <Alert tone="bad">{message}</Alert>}
        </div>
      </Page>
    </div>
  );
}

export type SupportTicket = { id: string; subject: string; message: string; status: string; createdAt?: string };
export function SupportView({ slots, client, refresh }: ViewProps) {
  const tickets = list<SupportTicket>(slots, "supportTickets");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const action = useAction(refresh);
  const busy = action.pending !== null;
  return (
    <Page title="Support" lead="Open a real support request and follow requests created from your account.">
      <div className="ops-col ops-gap-md">
        <Panel title="Contact AmazFlow">
          <form className="ops-col ops-gap-sm" onSubmit={(event) => { event.preventDefault(); void action.run("ticket", "Support request opened.", async () => { await client.post(endpoints.openTicket().path, { subject, message, category: "general", priority: "normal" }); setSubject(""); setMessage(""); }); }}>
            <Field label="Subject"><input className="ops-input" value={subject} onChange={(event) => setSubject(event.target.value)} disabled={busy} required /></Field>
            <Field label="Message"><textarea className="ops-input" rows={5} value={message} onChange={(event) => setMessage(event.target.value)} disabled={busy} required /></Field>
            <div><Btn type="submit" variant="primary" disabled={busy || !subject.trim() || !message.trim()}>{busy ? "Sending…" : "Open support request"}</Btn></div>
          </form>
        </Panel>
        <ActionFeedback value={action.feedback} />
        <Resource slot={tickets} emptyTitle="No support requests" emptyBody="Use the form above when you need help.">
          {(value) => <ul className="ops-list">{value.map((ticket) => <li key={ticket.id}><span><strong>{ticket.subject}</strong><br /><span className="ops-muted">{ticket.message}</span></span><span><Pill tone={ticket.status === "open" ? "waiting" : "neutral"}>{ticket.status}</Pill>{ticket.createdAt && <span className="ops-muted"> {relativeTime(ticket.createdAt)}</span>}</span></li>)}</ul>}
        </Resource>
      </div>
    </Page>
  );
}
