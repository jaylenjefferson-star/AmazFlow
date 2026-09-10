"use client";

/**
 * Overview — the operations home.
 *
 * Answers three questions in order: what needs me right now, what is AmazFlow doing this second,
 * and is the platform healthy. Everything is a live link into the object that needs the work.
 */

import { useMemo } from "react";
import { runsByDay, useOps, waitingFor } from "../data";
import { useNav } from "../nav";
import { PageHead } from "../shell";
import { useOpsActions } from "../actions";
import {
  Btn,
  EmptyState,
  Legend,
  Meter,
  Metrics,
  Panel,
  Pill,
  Sparkline,
  StackBar,
  ToolbarSpacer,
  Chevron,
} from "../primitives";
import {
  absoluteTime,
  isException,
  percent,
  relativeTime,
  runStatus,
  shortDuration,
} from "../terms";
import { runDuration } from "../run-model";

export function OverviewView() {
  const ops = useOps();
  const nav = useNav();
  const actions = useOpsActions();

  const stats = useMemo(() => {
    const decided = ops.runs.filter((run) => run.status === "COMPLETED" || isException(run.status));
    const successRate =
      decided.length > 0
        ? decided.filter((run) => run.status === "COMPLETED").length / decided.length
        : null;
    const today = ops.runs.filter((run) => {
      const date = new Date(run.createdAt);
      const now = new Date();
      return (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
      );
    });
    return {
      successRate,
      today: today.length,
      completed: ops.runs.filter((run) => run.status === "COMPLETED").length,
      cancelled: ops.runs.filter((run) => run.status === "CANCELLED").length,
      decided: decided.length,
    };
  }, [ops.runs]);

  /** Everything genuinely demanding a human, oldest first. */
  const inbox = useMemo(() => {
    const items = [
      ...ops.approvals.map((run) => ({ kind: "approval" as const, run })),
      ...ops.confirmations.map((run) => ({ kind: "confirmation" as const, run })),
      ...ops.exceptions.map((run) => ({ kind: "exception" as const, run })),
    ];
    return items.sort((a, b) => waitingFor(b.run) - waitingFor(a.run));
  }, [ops.approvals, ops.confirmations, ops.exceptions]);

  const pendingConnections = ops.connections.filter((connection) => connection.status === "pending");
  const openTickets = ops.tickets.filter(
    (ticket) => ticket.status === "open" || ticket.status === "in_progress",
  );
  const expiringTasks = ops.agentTasks.filter(
    (task) => new Date(task.expiresAt).getTime() - Date.now() < 120_000,
  );

  const orgsNeedingAttention = useMemo(
    () =>
      ops.organizations
        .map((org) => ({ org, health: ops.healthForOrg(org) }))
        .filter((entry) => entry.health.tone === "bad" || entry.health.tone === "waiting")
        .sort((a, b) => a.health.score - b.health.score)
        .slice(0, 6),
    [ops],
  );

  const day = runsByDay(ops.runs, 14);
  const liveNow = ops.liveRuns.slice(0, 10);

  if (ops.loading && ops.runs.length === 0 && ops.organizations.length === 0) {
    return (
      <>
        <PageHead title="Overview" sub="Loading the platform…" />
        <Metrics
          items={[
            { label: "In flight", value: "—" },
            { label: "Needs a decision", value: "—" },
            { label: "Needs attention", value: "—" },
            { label: "Runs today", value: "—" },
            { label: "Success rate", value: "—" },
          ]}
        />
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Overview"
        sub={
          inbox.length === 0
            ? "Nothing is waiting on you. Here is what AmazFlow is doing."
            : `${inbox.length} thing${inbox.length === 1 ? "" : "s"} need your attention.`
        }
        actions={
          <Btn glyph="search" onClick={() => nav.setPaletteOpen(true)}>
            Search everything
          </Btn>
        }
      />

      <Metrics
        items={[
          {
            label: "In flight",
            value: ops.liveRuns.length,
            tone: ops.liveRuns.length > 0 ? "running" : undefined,
            foot: "Running or blocked",
            onClick: () => nav.go({ section: "runs", view: "live" }),
          },
          {
            label: "Needs a decision",
            value: ops.approvals.length + ops.confirmations.length,
            tone: ops.approvals.length + ops.confirmations.length > 0 ? "waiting" : "good",
            foot: "Approvals and confirmations",
            onClick: () => nav.goSection("approvals"),
          },
          {
            label: "Needs attention",
            value: ops.exceptions.length,
            tone: ops.exceptions.length > 0 ? "bad" : "good",
            foot: "Failed or timed out",
            onClick: () => nav.goSection("exceptions"),
          },
          {
            label: "Runs today",
            value: stats.today,
            foot: `${ops.runs.length} all time`,
            onClick: () => nav.goSection("runs"),
          },
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
            foot: `${stats.decided} decided runs`,
          },
          {
            label: "Customers",
            value: ops.organizations.length,
            foot: `${orgsNeedingAttention.length} need a look`,
            onClick: () => nav.goSection("customers"),
          },
        ]}
      />

      <div className="ops-section">
        <div className="ops-split" data-side="wide">
          <div className="ops-col">
            {/* ---------------------------------------------------------------- inbox --- */}
            <Panel
              title="Needs you now"
              sub={inbox.length > 0 ? `${inbox.length}, longest waiting first` : undefined}
              actions={
                inbox.length > 6 ? (
                  <Btn size="sm" variant="ghost" onClick={() => nav.goSection("approvals")}>
                    See all
                  </Btn>
                ) : undefined
              }
            >
              {inbox.length === 0 ? (
                <EmptyState
                  glyph="check"
                  title="Nothing waiting"
                  body="No approvals, no confirmations, nothing failed. AmazFlow is running clean."
                  inline
                />
              ) : (
                <div className="ops-col ops-gap-sm">
                  {inbox.slice(0, 6).map(({ kind, run }) => {
                    const workflow = ops.workflowById(run.workflowId);
                    const status = runStatus(run.status);
                    return (
                      <div className="ops-row" key={run.id}>
                        <Pill tone={status.tone} dot={kind !== "exception"}>
                          {status.label}
                        </Pill>
                        <button
                          className="ops-col"
                          style={{ flex: 1, minWidth: 0, gap: 0, textAlign: "left" }}
                          onClick={() => nav.openRun(run.id)}
                        >
                          <span className="ops-strong ops-truncate">
                            {workflow?.name ?? run.workflowId}
                          </span>
                          <span className="ops-small ops-muted ops-truncate">
                            {ops.orgLabel(run.tenantId)} · waiting {shortDuration(waitingFor(run))}
                          </span>
                        </button>
                        {kind === "approval" && (
                          <Btn
                            size="sm"
                            variant="primary"
                            disabled={actions.busy === `approve_${run.id}`}
                            onClick={() => actions.approve(run)}
                          >
                            Approve
                          </Btn>
                        )}
                        {kind === "confirmation" && (
                          <Btn
                            size="sm"
                            variant="primary"
                            disabled={actions.busy === `confirm_${run.id}`}
                            onClick={() => actions.confirm(run)}
                          >
                            Confirm
                          </Btn>
                        )}
                        {kind === "exception" && (
                          <Btn size="sm" onClick={() => nav.openRun(run.id)}>
                            Investigate
                          </Btn>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            {/* ------------------------------------------------------------ live now --- */}
            <Panel
              title="Happening now"
              sub={ops.live ? "Refreshing every 15 seconds" : "Live updates paused"}
              actions={
                <Btn size="sm" variant="ghost" onClick={() => ops.setLive(!ops.live)}>
                  {ops.live ? "Pause" : "Resume"}
                </Btn>
              }
            >
              {liveNow.length === 0 ? (
                <EmptyState glyph="leads" title="Nothing running" body="No run is in flight right now." inline />
              ) : (
                <div className="ops-col ops-gap-sm">
                  {liveNow.map((run) => {
                    const workflow = ops.workflowById(run.workflowId);
                    const step = workflow?.steps.find(
                      (candidate) => candidate.id === run.currentStepId,
                    );
                    const status = runStatus(run.status);
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
                        <span className="ops-col" style={{ flex: 1, minWidth: 0, gap: 0 }}>
                          <span className="ops-strong ops-truncate">
                            {workflow?.name ?? run.workflowId}
                          </span>
                          <span className="ops-small ops-muted ops-truncate">
                            {ops.orgLabel(run.tenantId)}
                            {step && <> · at {step.name}</>}
                          </span>
                        </span>
                        <span className="ops-small ops-muted ops-nowrap">
                          {shortDuration(runDuration(run))}
                        </span>
                        <Chevron />
                      </button>
                    );
                  })}
                </div>
              )}
            </Panel>

            {/* -------------------------------------------------------- run volume --- */}
            <Panel title="Run volume" sub="Last 14 days">
              <div className="ops-bars">
                {day.map((bucket) => (
                  <span
                    className="ops-bar"
                    key={bucket.key}
                    data-tone={bucket.failed > 0 ? "bad" : bucket.total > 0 ? "good" : undefined}
                    title={`${bucket.label}: ${bucket.total} run${bucket.total === 1 ? "" : "s"}${bucket.failed ? `, ${bucket.failed} needing attention` : ""}`}
                    style={{
                      height: `${Math.max(
                        bucket.total === 0
                          ? 2
                          : (bucket.total / Math.max(...day.map((entry) => entry.total), 1)) * 100,
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
              <div style={{ marginTop: 16 }}>
                <StackBar
                  segments={[
                    { tone: "good", value: stats.completed, label: "Completed" },
                    { tone: "bad", value: ops.exceptions.length, label: "Needing attention" },
                    { tone: "waiting", value: ops.liveRuns.length, label: "In flight" },
                    { tone: "muted", value: stats.cancelled, label: "Cancelled" },
                  ]}
                />
                <div style={{ marginTop: 10 }}>
                  <Legend
                    items={[
                      { tone: "good", label: "Completed", value: stats.completed },
                      { tone: "bad", label: "Attention", value: ops.exceptions.length },
                      { tone: "waiting", label: "In flight", value: ops.liveRuns.length },
                      { tone: "muted", label: "Cancelled", value: stats.cancelled },
                    ]}
                  />
                </div>
              </div>
            </Panel>
          </div>

          {/* ------------------------------------------------------------- right rail --- */}
          <div className="ops-col">
            <Panel
              title="Customers to look at"
              actions={
                <Btn size="sm" variant="ghost" onClick={() => nav.goSection("customers")}>
                  View all
                </Btn>
              }
            >
              {orgsNeedingAttention.length === 0 ? (
                <EmptyState
                  glyph="check"
                  title="All customers healthy"
                  body={
                    ops.organizations.length === 0
                      ? "No organizations created yet."
                      : "Nothing is degraded."
                  }
                  inline
                />
              ) : (
                <div className="ops-col ops-gap-sm">
                  {orgsNeedingAttention.map(({ org, health }) => (
                    <button
                      key={org.id}
                      className="ops-col"
                      style={{ width: "100%", gap: 5, textAlign: "left" }}
                      onClick={() => nav.openOrg(org.slug)}
                    >
                      <span className="ops-row">
                        <span className="ops-strong ops-truncate" style={{ flex: 1 }}>
                          {org.branding?.displayName || org.name}
                        </span>
                        <Pill tone={health.tone}>{health.label}</Pill>
                      </span>
                      <Meter value={health.score} tone={health.tone} />
                      <span className="ops-small ops-muted ops-truncate">
                        {health.reasons.join(" · ")}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Panel>

            {expiringTasks.length > 0 && (
              <Panel title="Browser tasks about to expire" sub={`${expiringTasks.length}`}>
                <div className="ops-col ops-gap-sm">
                  {expiringTasks.map((task) => (
                    <button
                      key={task.id}
                      className="ops-row"
                      style={{ width: "100%" }}
                      onClick={() => nav.openRun(task.runId)}
                    >
                      <Pill tone="bad" dot>
                        {relativeTime(task.expiresAt)}
                      </Pill>
                      <span className="ops-truncate" style={{ flex: 1 }}>
                        {task.operation}
                      </span>
                      <Chevron />
                    </button>
                  ))}
                </div>
              </Panel>
            )}

            {pendingConnections.length > 0 && (
              <Panel
                title="Connections needing sign-in"
                sub={`${pendingConnections.length}`}
                actions={
                  <Btn size="sm" variant="ghost" onClick={() => nav.goSection("connections")}>
                    View all
                  </Btn>
                }
              >
                <div className="ops-col ops-gap-sm">
                  {pendingConnections.slice(0, 5).map((connection) => (
                    <button
                      key={connection.id}
                      className="ops-row"
                      style={{ width: "100%" }}
                      onClick={() => nav.openConnection(connection.id)}
                    >
                      <Pill tone="waiting">Needs sign-in</Pill>
                      <span className="ops-col" style={{ flex: 1, minWidth: 0, gap: 0 }}>
                        <span className="ops-strong ops-truncate">{connection.name}</span>
                        <span className="ops-small ops-muted ops-truncate">
                          {ops.orgLabel(connection.tenantId)}
                        </span>
                      </span>
                      <Chevron />
                    </button>
                  ))}
                </div>
              </Panel>
            )}

            <Panel
              title="Open support"
              actions={
                <Btn size="sm" variant="ghost" onClick={() => nav.goSection("support")}>
                  View all
                </Btn>
              }
            >
              {openTickets.length === 0 ? (
                <EmptyState glyph="check" title="No open tickets" inline />
              ) : (
                <div className="ops-col ops-gap-sm">
                  {openTickets.slice(0, 5).map((ticket) => (
                    <button
                      key={ticket.id}
                      className="ops-row"
                      style={{ width: "100%" }}
                      onClick={() => nav.go({ section: "support", entityId: ticket.id })}
                    >
                      <Pill tone={ticket.priority === "urgent" || ticket.priority === "high" ? "bad" : "waiting"}>
                        {ticket.priority}
                      </Pill>
                      <span className="ops-col" style={{ flex: 1, minWidth: 0, gap: 0 }}>
                        <span className="ops-strong ops-truncate">{ticket.subject}</span>
                        <span className="ops-small ops-muted ops-truncate">
                          {ops.orgLabel(ticket.tenantId)} · {relativeTime(ticket.updatedAt)}
                        </span>
                      </span>
                      <Chevron />
                    </button>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Recent account changes">
              {ops.activity.length === 0 ? (
                <EmptyState glyph="audit" title="Nothing recorded yet" inline />
              ) : (
                <div className="ops-col ops-gap-sm">
                  {ops.activity
                    .slice()
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .slice(0, 6)
                    .map((event) => (
                      <button
                        key={event.id}
                        className="ops-col"
                        style={{ width: "100%", gap: 1, textAlign: "left" }}
                        onClick={() => nav.goSection("audit")}
                      >
                        <span className="ops-truncate" style={{ fontSize: 12.5 }}>
                          {event.summary}
                        </span>
                        <span className="ops-small ops-muted ops-truncate">
                          {ops.orgLabel(event.tenantId)} · {relativeTime(event.at)}
                          {event.actorLabel && <> · {event.actorLabel}</>}
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
