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

import type { ReactNode } from "react";
import {
  PLATFORM_ROLE_DESCRIPTION,
  PLATFORM_ROLE_LABEL,
  relativeTime,
  runStatus,
  type ResourceSlot,
} from "@amazflow/domain-ui";
import { Alert, EmptyState, Pill, SkeletonPanel } from "@amazflow/ui";
import type { Principal } from "@amazflow/permissions";
import { DisabledSection, type ShellProps } from "./shell";
import { customerRoute } from "./routes";

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

  const empty = Array.isArray(slot.value) && slot.value.length === 0;
  if (empty) return <EmptyState title={emptyTitle} body={emptyBody} />;

  return <>{children(slot.value)}</>;
}

/* ==================================================================================== views = */

export type ViewProps = {
  principal: Principal;
  slots: Record<string, ResourceSlot<unknown>>;
  navigate: ShellProps["navigate"];
};

const list = <T,>(slots: Record<string, ResourceSlot<unknown>>, key: string) =>
  (slots[key] ?? { value: [], state: "loading", error: null, loadedAt: null }) as ResourceSlot<T[]>;

function Page({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <section className="ops-panel">
      <h1 className="ops-panel-title">{title}</h1>
      {lead && <p className="ops-panel-lead">{lead}</p>}
      {children}
    </section>
  );
}

export function HomeView({ slots, navigate }: ViewProps) {
  const runs = list<{ id: string; status: string; startedAt?: string }>(slots, "runs");
  return (
    <Page title="Home" lead="What AmazFlow is doing for you right now.">
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

export function WorkflowsView({ slots, navigate }: ViewProps) {
  const workflows = list<{ id: string; name: string; status: string }>(slots, "workflows");
  return (
    <Page title="Workflows" lead="The work AmazFlow can do for your organization.">
      <Resource
        slot={workflows}
        emptyTitle="No workflows yet"
        emptyBody="Your AmazFlow contact builds these with you. They appear here once published."
      >
        {(value) => (
          <ul className="ops-list">
            {value.map((workflow) => (
              <li key={workflow.id}>
                <button
                  type="button"
                  onClick={() => navigate({ routeId: "workflows", entityId: workflow.id })}
                >
                  <span>{workflow.name}</span>
                  <Pill tone="neutral" plain>
                    {workflow.status}
                  </Pill>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Resource>
    </Page>
  );
}

export function RunsView({ slots, navigate }: ViewProps) {
  const runs = list<{ id: string; status: string; startedAt?: string }>(slots, "runs");
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
                    <span>{run.id}</span>
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

export function TasksView({ slots }: ViewProps) {
  const tasks = list<{ id: string; operation: string; status: string }>(slots, "agentTasks");
  return (
    <Page title="Tasks" lead="Work waiting on an agent or on a person.">
      <Resource slot={tasks} emptyTitle="Nothing waiting" emptyBody="No task is outstanding right now.">
        {(value) => (
          <ul className="ops-list">
            {value.map((task) => (
              <li key={task.id}>
                <span>{task.operation}</span>
                <Pill tone="waiting">{task.status}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Resource>
    </Page>
  );
}

export function ApprovalsView({ slots, navigate }: ViewProps) {
  const runs = list<{ id: string; status: string }>(slots, "runs");
  const waiting = {
    ...runs,
    value: runs.value.filter((run) => run.status === "WAITING_APPROVAL"),
  };
  return (
    <Page title="Approvals" lead="Runs paused until somebody decides.">
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
              </li>
            ))}
          </ul>
        )}
      </Resource>
    </Page>
  );
}

export function ExceptionsView({ slots, navigate }: ViewProps) {
  const runs = list<{ id: string; status: string }>(slots, "runs");
  const failed = {
    ...runs,
    value: runs.value.filter((run) => run.status === "FAILED" || run.status === "TIMED_OUT"),
  };
  return (
    <Page title="Needs attention" lead="Runs that stopped without finishing.">
      <Resource
        slot={failed}
        emptyTitle="Nothing needs attention"
        emptyBody="Every run either finished or is still going."
      >
        {(value) => (
          <ul className="ops-list">
            {value.map((run) => (
              <li key={run.id}>
                <button type="button" onClick={() => navigate({ routeId: "runs", entityId: run.id })}>
                  {run.id}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Resource>
    </Page>
  );
}

export function AgentsView({ slots }: ViewProps) {
  const agents = list<{ id: string; name: string; connectionStatus?: string }>(slots, "agents");
  return (
    <Page title="Agents" lead="The browsers and computers AmazFlow can act through.">
      <Resource
        slot={agents}
        emptyTitle="No agents connected"
        emptyBody="Install the AmazFlow extension or desktop app to let a workflow act on your systems."
      >
        {(value) => (
          <ul className="ops-list">
            {value.map((agent) => (
              <li key={agent.id}>
                <span>{agent.name}</span>
                <Pill tone={agent.connectionStatus === "connected" ? "good" : "bad"}>
                  {agent.connectionStatus ?? "unknown"}
                </Pill>
              </li>
            ))}
          </ul>
        )}
      </Resource>
    </Page>
  );
}

export function ConnectionsView({ slots }: ViewProps) {
  const connections = list<{ id: string; name: string; status: string }>(slots, "connections");
  return (
    <Page title="Connections" lead="The systems a workflow signs in to on your behalf.">
      <Resource
        slot={connections}
        emptyTitle="No connections yet"
        emptyBody="A connection is created when a workflow needs to sign in to one of your systems."
      >
        {(value) => (
          <ul className="ops-list">
            {value.map((connection) => (
              <li key={connection.id}>
                <span>{connection.name}</span>
                <Pill tone={connection.status === "active" ? "good" : "muted"}>{connection.status}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Resource>
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
            <dl className="ops-stats">
              <div>
                <dt>Runs</dt>
                <dd>{total}</dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{completed}</dd>
              </div>
              <div>
                <dt>Stopped without finishing</dt>
                <dd>{failed}</dd>
              </div>
            </dl>
          );
        }}
      </Resource>
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

export function BillingView() {
  const route = customerRoute("admin-billing");
  return route ? <DisabledSection route={route} /> : null;
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
