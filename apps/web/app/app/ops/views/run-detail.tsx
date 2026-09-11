"use client";

/**
 * Run detail — the execution operations console.
 *
 * This is the "watch what AmazFlow is doing" surface: run state, step progression, the execution
 * timeline with real gaps, AmazFlow Executor decisions, every tool call with its request and
 * response, browser activity, approval gates, verification outcomes, the execution grant scope
 * that bounded each action, and the customer context around it all.
 *
 * Everything is derived from the run record the control plane returns. Where telemetry does not
 * exist (per-attempt retry counters, browser session recordings) the view says so rather than
 * implying a zero.
 */

import { useMemo, useState } from "react";
import type { WorkflowRun } from "@amazflow/workflow-schema";
import { relatedAttempts, useOps } from "../data";
import { useNav, useDetailCrumb } from "../nav";
import { PageHead } from "../shell";
import { STEP_ICON } from "../icons";
import { useOpsActions } from "../actions";
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
  Meter,
  Metrics,
  Modal,
  Panel,
  Pill,
  SearchInput,
  Select,
  StepStrip,
  Tabs,
  TechnicalDetail,
  Timeline,
  Toolbar,
  ToolbarSpacer,
  type Column,
  type StepChip,
  type TabSpec,
  type TimelineItem,
  Chevron,
} from "../primitives";
import {
  AUDIT_CATEGORY_LABEL,
  CANCELLABLE_STATUSES,
  DATA_CLASS_LABEL,
  STEP_TYPE_LABEL,
  absoluteTime,
  clockTime,
  executorLabel,
  isTerminal,
  percent,
  relativeTime,
  runStatus,
  shortDuration,
  shortId,
  type AuditCategory,
} from "../terms";
import {
  browserActivity,
  contextValues,
  decisions,
  diagnose,
  gates,
  grantScopes,
  runDuration,
  stepProgression,
  timeline,
  toolCalls,
  type ToolCall,
} from "../run-model";

export function RunDetailView({ runId }: { runId: string }) {
  const ops = useOps();
  const nav = useNav();
  const actions = useOpsActions();

  const run = ops.runById(runId);
  const workflow = run ? ops.workflowById(run.workflowId) : undefined;

  useDetailCrumb(workflow?.name ?? (run ? shortId(run.id) : runId));

  const [tab, setTab] = useState(nav.view.tab ?? "timeline");
  const [openCall, setOpenCall] = useState<ToolCall | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRerun, setConfirmRerun] = useState(false);

  if (!run) {
    return (
      <EmptyState
        glyph="runs"
        title="That run isn't in this workspace"
        body={
          ops.loading
            ? "Still loading runs from the control plane…"
            : "The run id may be from another environment, or the run list may have been truncated. Runs are returned unpaginated, so very large workspaces can cut off."
        }
        actions={<Btn onClick={() => nav.goSection("runs")}>Back to runs</Btn>}
      />
    );
  }

  if (!workflow) {
    return (
      <>
        <PageHead
          title={run.workflowId}
          pills={<Pill tone={runStatus(run.status).tone}>{runStatus(run.status).label}</Pill>}
          sub="This run references a workflow that is no longer in the library, so its steps can't be resolved."
        />
        <Alert tone="waiting" title="Workflow definition unavailable">
          The run record is intact — its audit trail and results are below — but without the pinned
          workflow version AmazFlow can't label the steps.
        </Alert>
        <div className="ops-section">
          <Panel title="Audit trail">
            <RawTimeline run={run} />
          </Panel>
        </div>
      </>
    );
  }

  /* --------------------------------------------------------------------- derived model --- */

  const progression = useMemo(() => stepProgression(workflow, run), [workflow, run]);
  const calls = useMemo(() => toolCalls(workflow, run), [workflow, run]);
  const decided = useMemo(() => decisions(workflow, run), [workflow, run]);
  const browser = useMemo(() => browserActivity(run), [run]);
  const gateList = useMemo(() => gates(workflow, run), [workflow, run]);
  const grants = useMemo(() => grantScopes(workflow, run), [workflow, run]);
  const events = useMemo(() => timeline(workflow, run), [workflow, run]);
  const verdict = useMemo(() => diagnose(workflow, run), [workflow, run]);
  const related = useMemo(() => relatedAttempts(run, ops.runs), [run, ops.runs]);
  const data = useMemo(() => contextValues(run), [run]);

  const org = ops.orgByTenant(run.tenantId);
  const pendingTasks = ops.agentTasks.filter((task) => task.runId === run.id);
  const linkedTickets = ops.tickets.filter((ticket) => ticket.runId === run.id);

  const status = runStatus(run.status);
  const doneCount = progression.filter((entry) => entry.state === "done").length;
  const canCancel = CANCELLABLE_STATUSES.includes(run.status);

  const currentStep = run.currentStepId
    ? workflow.steps.find((step) => step.id === run.currentStepId)
    : undefined;
  const approvalStep = currentStep?.type === "approval" ? currentStep : undefined;

  const tabs: TabSpec[] = [
    { id: "timeline", label: "Timeline", count: events.length },
    { id: "calls", label: "Tool calls", count: calls.length },
    { id: "decisions", label: "Decisions", count: decided.length },
    { id: "browser", label: "Browser", count: browser.length + pendingTasks.length },
    { id: "gates", label: "Approvals", count: gateList.length },
    { id: "data", label: "Data" },
    { id: "related", label: "Related", count: related.length + linkedTickets.length },
    { id: "technical", label: "Technical" },
  ];

  return (
    <>
      <PageHead
        title={workflow.name}
        pills={
          <>
            <Pill tone={status.tone} dot>
              {status.label}
            </Pill>
            <Pill tone="muted">v{run.workflowVersion}</Pill>
            {workflow.dataClass && workflow.dataClass !== "INTERNAL" && (
              <Pill tone="muted">{DATA_CLASS_LABEL[workflow.dataClass] ?? workflow.dataClass}</Pill>
            )}
          </>
        }
        sub={
          <>
            {ops.orgLabel(run.tenantId)} · started {absoluteTime(run.createdAt)} ·{" "}
            {shortDuration(runDuration(run))}
            {!isTerminal(run.status) && " and counting"}
          </>
        }
        actions={
          <>
            {run.status === "WAITING_APPROVAL" && (
              <>
                <Btn
                  variant="primary"
                  disabled={actions.busy === `approve_${run.id}`}
                  onClick={() => actions.approve(run)}
                >
                  Approve
                </Btn>
                <Btn
                  disabled={actions.busy === `reject_${run.id}`}
                  onClick={() => actions.sendBack(run)}
                >
                  Send back
                </Btn>
              </>
            )}
            {run.status === "AWAITING_CONFIRMATION" && (
              <Btn
                variant="primary"
                disabled={actions.busy === `confirm_${run.id}`}
                onClick={() => actions.confirm(run)}
              >
                Confirm and proceed
              </Btn>
            )}
            {isTerminal(run.status) && run.status !== "COMPLETED" && (
              <Btn onClick={() => (verdict.unsafeToRetry ? setConfirmRerun(true) : actions.rerun(run))}>
                Re-run
              </Btn>
            )}
            {canCancel && (
              <Btn variant="danger" onClick={() => setConfirmCancel(true)}>
                Stop run
              </Btn>
            )}
          </>
        }
      />

      {/* The single most important sentence on the page: what happened. */}
      <Alert
        tone={verdict.tone}
        title={verdict.headline}
        actions={
          verdict.stepName ? (
            <span className="ops-small ops-muted">
              At step <b className="ops-strong">{verdict.stepName}</b>
              {verdict.suggestion && <> — {verdict.suggestion}</>}
            </span>
          ) : verdict.suggestion ? (
            <span className="ops-small ops-muted">{verdict.suggestion}</span>
          ) : undefined
        }
      >
        {verdict.detail}
      </Alert>

      {verdict.unsafeToRetry && (
        <div style={{ marginTop: 8 }}>
          <Alert tone="bad" title="Do not re-run without checking first">
            AmazFlow could not rule out that the action partly landed on the customer&apos;s system.
            Re-running may duplicate it.
          </Alert>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Metrics
          items={[
            {
              label: "Elapsed",
              value: shortDuration(runDuration(run)),
              foot: isTerminal(run.status) ? `Ended ${relativeTime(run.updatedAt)}` : "Still running",
            },
            {
              label: "Steps",
              value: `${doneCount}/${progression.length}`,
              foot: currentStep ? `At ${currentStep.name}` : "Complete",
            },
            {
              label: "Tool calls",
              value: calls.length,
              tone: calls.some((call) => call.status === "FAILED" || call.status === "UNCERTAIN")
                ? "bad"
                : undefined,
              foot: `${calls.filter((call) => call.status === "SUCCEEDED").length} succeeded`,
            },
            {
              label: "Decisions",
              value: decided.length,
              tone: decided.some((entry) => entry.belowThreshold) ? "waiting" : undefined,
              foot: decided.length
                ? `${decided.filter((entry) => entry.belowThreshold).length} below threshold`
                : "No AI steps ran",
            },
            {
              label: "Executed by",
              value: <span style={{ fontSize: 14 }}>{executorLabel(run.executionBackend)}</span>,
              foot: run.traceId ? `Trace ${shortId(run.traceId, 8)}` : "No trace recorded",
            },
          ]}
        />
      </div>

      {/* Step progression */}
      <div className="ops-section">
        <Panel
          title="Step progression"
          sub={`${progression.length} step${progression.length === 1 ? "" : "s"} on this path`}
        >
          <StepStrip
            steps={progression.map<StepChip>((entry) => ({
              id: entry.step.id,
              type: STEP_TYPE_LABEL[entry.step.type] ?? entry.step.type,
              glyph: STEP_ICON[entry.step.type] ?? "action",
              name: entry.step.name,
              meta:
                entry.durationMs !== undefined
                  ? `${entry.executedBy} · ${shortDuration(entry.durationMs)}`
                  : entry.executedBy,
              state: entry.state,
            }))}
          />
        </Panel>
      </div>

      {/* Blocked-state action panels */}
      {approvalStep && run.status === "WAITING_APPROVAL" && (
        <div className="ops-section">
          <Panel title="Waiting on approval">
            <p style={{ fontSize: 13, marginBottom: 10 }}>{approvalStep.message}</p>
            <KeyValue
              rows={[
                { label: "Roles that can decide", value: approvalStep.roles.join(", ") },
                { label: "Waiting since", value: `${absoluteTime(run.updatedAt)} (${relativeTime(run.updatedAt)})` },
              ]}
            />
            <div className="ops-row" style={{ marginTop: 12 }}>
              <Btn
                variant="primary"
                disabled={actions.busy === `approve_${run.id}`}
                onClick={() => actions.approve(run)}
              >
                Approve
              </Btn>
              <Btn disabled={actions.busy === `reject_${run.id}`} onClick={() => actions.sendBack(run)}>
                Send back
              </Btn>
            </div>
          </Panel>
        </div>
      )}

      {run.status === "AWAITING_CONFIRMATION" && (
        <div className="ops-section">
          <Panel title="Holding for confirmation before it acts">
            <p style={{ fontSize: 13, marginBottom: 10 }}>
              AmazFlow has prepared this action and will not touch the customer&apos;s system until
              it is confirmed.
            </p>
            {currentStep?.type === "action" && (
              <KeyValue
                rows={[
                  { label: "Step", value: currentStep.name },
                  { label: "Executed by", value: executorFor(currentStep) },
                  { label: "Operation", value: <code>{currentStep.operation}</code> },
                  {
                    label: "Input",
                    value: <CodeBlock value={currentStep.input} />,
                  },
                ]}
              />
            )}
            <div className="ops-row" style={{ marginTop: 12 }}>
              <Btn
                variant="primary"
                disabled={actions.busy === `confirm_${run.id}`}
                onClick={() => actions.confirm(run)}
              >
                Confirm and proceed
              </Btn>
              <Btn variant="danger" onClick={() => setConfirmCancel(true)}>
                Stop instead
              </Btn>
            </div>
          </Panel>
        </div>
      )}

      {/* Main split: detail tabs + persistent context rail */}
      <div className="ops-section">
        <div className="ops-split" data-side="wide">
          <div>
            <Tabs tabs={tabs} active={tab} onSelect={setTab} />
            <div className="ops-tabpanel">
              {tab === "timeline" && <TimelineTab events={events} run={run} />}
              {tab === "calls" && <CallsTab calls={calls} onOpen={setOpenCall} />}
              {tab === "decisions" && <DecisionsTab decided={decided} />}
              {tab === "browser" && <BrowserTab browser={browser} pending={pendingTasks} />}
              {tab === "gates" && <GatesTab gateList={gateList} />}
              {tab === "data" && <DataTab data={data} />}
              {tab === "related" && (
                <RelatedTab run={run} related={related} tickets={linkedTickets} />
              )}
              {tab === "technical" && (
                <TechnicalTab run={run} grants={grants} />
              )}
            </div>
          </div>

          <ContextRail run={run} workflowName={workflow.name} />
        </div>
      </div>

      {openCall && <CallDrawer call={openCall} onClose={() => setOpenCall(null)} />}

      {confirmCancel && (
        <Modal
          title="Stop this run?"
          onClose={() => setConfirmCancel(false)}
          footer={
            <>
              <Btn onClick={() => setConfirmCancel(false)}>Keep running</Btn>
              <Btn
                variant="danger"
                disabled={actions.busy === `cancel_${run.id}`}
                onClick={async () => {
                  await actions.cancel(run);
                  setConfirmCancel(false);
                }}
              >
                Stop run
              </Btn>
            </>
          }
        >
          <p style={{ fontSize: 13 }}>
            AmazFlow will stop before starting anything further. Steps that already completed are
            <b> not</b> rolled back — {doneCount} step{doneCount === 1 ? " has" : "s have"} already
            run.
          </p>
        </Modal>
      )}

      {confirmRerun && (
        <Modal
          title="Re-run despite an unconfirmed outcome?"
          onClose={() => setConfirmRerun(false)}
          footer={
            <>
              <Btn onClick={() => setConfirmRerun(false)}>Cancel</Btn>
              <Btn
                variant="danger"
                disabled={actions.busy === `rerun_${run.id}`}
                onClick={async () => {
                  await actions.rerun(run);
                  setConfirmRerun(false);
                }}
              >
                Start a new run anyway
              </Btn>
            </>
          }
        >
          <p style={{ fontSize: 13 }}>
            This run could not confirm whether its action took effect. Starting another run with the
            same input may perform the action twice. Check the target system first.
          </p>
        </Modal>
      )}
    </>
  );
}

/* ============================================================================ context rail = */

function ContextRail({ run, workflowName }: { run: WorkflowRun; workflowName: string }) {
  const ops = useOps();
  const nav = useNav();
  const org = ops.orgByTenant(run.tenantId);
  const health = org ? ops.healthForOrg(org) : null;
  const orgRuns = ops.runsForTenant(run.tenantId);
  const orgFailures = orgRuns.filter((candidate) => candidate.status === "FAILED").length;

  return (
    <div className="ops-col">
      <Panel
        title="Customer"
        actions={
          org ? (
            <Btn size="sm" variant="ghost" onClick={() => nav.openOrg(org.slug)}>
              Open
            </Btn>
          ) : undefined
        }
      >
        {org ? (
          <>
            <div className="ops-row" style={{ marginBottom: 10 }}>
              <b className="ops-strong" style={{ fontSize: 13 }}>
                {org.branding?.displayName || org.name}
              </b>
              {health && <Pill tone={health.tone}>{health.label}</Pill>}
            </div>
            <KeyValue
              rows={[
                { label: "Plan", value: org.plan.replace(/_/g, " ") },
                { label: "Runs", value: orgRuns.length },
                {
                  label: "Needing attention",
                  value:
                    orgFailures > 0 ? (
                      <span className="ops-tone-bad ops-strong">{orgFailures}</span>
                    ) : (
                      0
                    ),
                },
                { label: "Customer since", value: new Date(org.createdAt).toLocaleDateString() },
              ]}
            />
          </>
        ) : (
          <p className="ops-small ops-muted">
            This run&apos;s tenant <code>{run.tenantId}</code> has no organization record. It still
            executes normally — organizations are a management layer, not a requirement for a run.
          </p>
        )}
      </Panel>

      <Panel
        title="Workflow"
        actions={
          <Btn size="sm" variant="ghost" onClick={() => nav.openWorkflow(run.workflowId)}>
            Open
          </Btn>
        }
      >
        <KeyValue
          rows={[
            { label: "Name", value: workflowName },
            { label: "Version run", value: `v${run.workflowVersion}` },
            {
              label: "Runs of this",
              value: ops.runsForWorkflow(run.workflowId).length,
            },
            {
              label: "Success rate",
              value: (() => {
                const stats = ops.statsForWorkflow(run.workflowId);
                return stats.successRate === null ? "—" : percent(stats.successRate);
              })(),
            },
          ]}
        />
      </Panel>

      <Panel title="Execution">
        <KeyValue
          rows={[
            { label: "Executor", value: executorLabel(run.executionBackend) },
            { label: "Started by", value: run.createdBy ?? "—" },
            { label: "Started", value: absoluteTime(run.createdAt) },
            { label: "Last update", value: `${absoluteTime(run.updatedAt)}` },
            {
              label: "Trace",
              value: run.traceId ? (
                <IdChip value={run.traceId} label={shortId(run.traceId, 12)} />
              ) : (
                <span className="ops-muted">not recorded</span>
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}

/* ================================================================================ timeline = */

function TimelineTab({
  events,
  run,
}: {
  events: ReturnType<typeof timeline>;
  run: WorkflowRun;
}) {
  const [category, setCategory] = useState<"all" | AuditCategory>("all");

  const categories = useMemo(() => {
    const counts = new Map<AuditCategory, number>();
    for (const entry of events) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
    return [...counts.entries()];
  }, [events]);

  const filtered = category === "all" ? events : events.filter((entry) => entry.category === category);

  if (events.length === 0) {
    return (
      <EmptyState glyph="audit" title="No audit events yet" body="Events appear as the run progresses." inline />
    );
  }

  const items: TimelineItem[] = filtered.map((entry) => ({
    id: entry.event.id,
    timeLabel: clockTime(entry.event.at),
    tone: entry.tone,
    current: entry.event.stepId !== undefined && entry.event.stepId === run.currentStepId,
    headline: (
      <>
        <b>{entry.label}</b>
        {entry.stepName && <Pill tone="muted">{entry.stepName}</Pill>}
        <span className="ops-small ops-muted">+{shortDuration(entry.offsetMs)}</span>
        {entry.gapMs > 60_000 && (
          <Pill tone="waiting" title="Time spent waiting before this event">
            waited {shortDuration(entry.gapMs)}
          </Pill>
        )}
      </>
    ),
    message: entry.event.message,
    facts: factsFor(entry.event.details),
    extra:
      entry.event.details && Object.keys(entry.event.details).length > 0 ? (
        <div style={{ marginTop: 7 }}>
          <TechnicalDetail label="Event payload">
            <CodeBlock value={entry.event.details} />
          </TechnicalDetail>
        </div>
      ) : undefined,
  }));

  return (
    <>
      <Toolbar>
        <div className="ops-views">
          <button
            className="ops-view"
            aria-pressed={category === "all"}
            onClick={() => setCategory("all")}
          >
            All
            <span className="ops-view-count">{events.length}</span>
          </button>
          {categories.map(([key, count]) => (
            <button
              className="ops-view"
              key={key}
              aria-pressed={category === key}
              onClick={() => setCategory(key)}
            >
              {AUDIT_CATEGORY_LABEL[key]}
              <span className="ops-view-count">{count}</span>
            </button>
          ))}
        </div>
        <ToolbarSpacer />
        <span className="ops-toolbar-count">
          Total elapsed {shortDuration(runDuration(run))}
        </span>
      </Toolbar>
      <Panel>
        <Timeline items={items} />
      </Panel>
    </>
  );
}

/** Renders the human-meaningful subset of an audit event's details as inline facts. */
function factsFor(details?: Record<string, unknown>) {
  if (!details) return undefined;
  const facts: { label: string; value: React.ReactNode }[] = [];
  if (typeof details.confidence === "number") {
    facts.push({ label: "Confidence", value: percent(details.confidence, 1) });
  }
  if (typeof details.outcome === "string") facts.push({ label: "Outcome", value: details.outcome });
  if (typeof details.by === "string") facts.push({ label: "By", value: details.by });
  if (typeof details.role === "string") facts.push({ label: "Role", value: details.role });
  if (Array.isArray(details.roles)) {
    facts.push({ label: "Roles", value: (details.roles as string[]).join(", ") });
  }
  if (details.expected !== undefined) {
    facts.push({ label: "Expected", value: JSON.stringify(details.expected) });
  }
  if (details.actual !== undefined) {
    facts.push({ label: "Observed", value: JSON.stringify(details.actual) });
  }
  if (details.sideEffectObserved === true) {
    facts.push({ label: "Side effect", value: "could not be ruled out" });
  }
  if (typeof details.completedSteps === "number") {
    facts.push({ label: "Steps completed", value: details.completedSteps });
  }
  return facts.length ? facts : undefined;
}

/** Fallback timeline when the workflow definition can't be resolved. */
function RawTimeline({ run }: { run: WorkflowRun }) {
  return (
    <Timeline
      items={run.audit
        .slice()
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((event) => ({
          id: event.id,
          timeLabel: clockTime(event.at),
          headline: <b>{event.type}</b>,
          message: event.message,
        }))}
    />
  );
}

/* ============================================================================== tool calls = */

const CALL_TONE = {
  SUCCEEDED: "good",
  FAILED: "bad",
  UNCERTAIN: "bad",
  PENDING: "waiting",
} as const;

const CALL_LABEL = {
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  UNCERTAIN: "Unconfirmed",
  PENDING: "In flight",
} as const;

function CallsTab({ calls, onOpen }: { calls: ToolCall[]; onOpen: (call: ToolCall) => void }) {
  const columns: Column<ToolCall>[] = [
    {
      key: "status",
      header: "Result",
      width: 132,
      nowrap: true,
      render: (call) => (
        <Pill tone={CALL_TONE[call.status]} dot={call.status === "PENDING"}>
          {CALL_LABEL[call.status]}
        </Pill>
      ),
    },
    {
      key: "step",
      header: "Step",
      primary: true,
      render: (call) => <CellStack top={call.stepName} bottom={call.operation} />,
    },
    {
      key: "tool",
      header: "Tool",
      render: (call) => call.tool,
    },
    {
      key: "at",
      header: "When",
      nowrap: true,
      width: 108,
      sort: (a, b) => (a.at ?? "").localeCompare(b.at ?? ""),
      render: (call) => (call.at ? <span title={absoluteTime(call.at)}>{clockTime(call.at)}</span> : "—"),
    },
    {
      key: "duration",
      header: "Took",
      align: "right",
      nowrap: true,
      width: 80,
      render: (call) =>
        call.durationMs === undefined ? (
          <span className="ops-muted">—</span>
        ) : (
          <span className="ops-cell-num">{shortDuration(call.durationMs)}</span>
        ),
    },
    {
      key: "verify",
      header: "Verified",
      width: 96,
      render: (call) =>
        call.verification === undefined ? (
          <span className="ops-muted">—</span>
        ) : call.verification.passed ? (
          <Pill tone="good">Passed</Pill>
        ) : (
          <Pill tone="bad">Failed</Pill>
        ),
    },
    {
      key: "open",
      header: "",
      align: "right",
      width: 40,
      render: () => <Chevron />,
    },
  ];

  return (
    <DataTable
      rows={calls}
      columns={columns}
      rowKey={(call) => call.id}
      onRowClick={onOpen}
      rowTone={(call) => (call.status === "FAILED" || call.status === "UNCERTAIN" ? "bad" : undefined)}
      emptyState={
        <EmptyState
          glyph="action"
          title="No tool calls yet"
          body="A tool call is recorded each time AmazFlow acts on an external system. Decision and approval steps don't produce one."
          inline
        />
      }
    />
  );
}

function CallDrawer({ call, onClose }: { call: ToolCall; onClose: () => void }) {
  return (
    <Drawer
      title={
        <>
          <Pill tone={CALL_TONE[call.status]}>{CALL_LABEL[call.status]}</Pill>
          <span>{call.stepName}</span>
        </>
      }
      sub={
        <>
          {call.tool} · <code>{call.operation}</code>
          {call.at && <> · {absoluteTime(call.at)}</>}
        </>
      }
      onClose={onClose}
    >
      {call.status === "UNCERTAIN" && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="bad" title="Outcome unconfirmed">
            AmazFlow observed that a side effect may have occurred but could not verify the result.
            It deliberately stopped instead of retrying.
          </Alert>
        </div>
      )}

      <Panel title="Call">
        <KeyValue
          rows={[
            { label: "Executed by", value: call.tool },
            { label: "Operation", value: <code>{call.operation}</code> },
            { label: "Result", value: CALL_LABEL[call.status] },
            {
              label: "Response status",
              value: call.httpStatus ?? <span className="ops-muted">not recorded</span>,
            },
            {
              label: "Duration",
              value:
                call.durationMs === undefined ? (
                  <span className="ops-muted">not recorded</span>
                ) : (
                  shortDuration(call.durationMs)
                ),
            },
            {
              label: "Side effect",
              value: call.sideEffectObserved ? (
                <span className="ops-tone-bad">could not be ruled out</span>
              ) : (
                "none observed"
              ),
            },
            {
              label: "Error",
              value: call.error ? <span className="ops-tone-bad">{call.error}</span> : undefined,
              hide: !call.error,
            },
          ]}
        />
      </Panel>

      {call.verification && (
        <div style={{ marginTop: 12 }}>
          <Panel title="Independent verification">
            <KeyValue
              rows={[
                {
                  label: "Result",
                  value: call.verification.passed ? (
                    <Pill tone="good">Passed</Pill>
                  ) : (
                    <Pill tone="bad">Failed</Pill>
                  ),
                },
                { label: "Expected", value: <code>{JSON.stringify(call.verification.expected)}</code> },
                { label: "Observed", value: <code>{JSON.stringify(call.verification.actual)}</code> },
              ]}
            />
          </Panel>
        </div>
      )}

      <div style={{ marginTop: 12 }} className="ops-col">
        {call.request !== undefined && (
          <Panel title="Request sent">
            <CodeBlock value={call.request} />
          </Panel>
        )}
        {call.response !== undefined && (
          <Panel title="Response received">
            <CodeBlock value={call.response} />
          </Panel>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <TechnicalDetail>
          <KeyValue
            rows={[
              { label: "Step id", value: <code>{call.stepId}</code> },
              {
                label: "Trace id",
                value: call.traceId ? <IdChip value={call.traceId} /> : <span className="ops-muted">—</span>,
              },
              {
                label: "Connection id",
                value: call.connectionId ? (
                  <IdChip value={call.connectionId} />
                ) : (
                  <span className="ops-muted">resolved at run time</span>
                ),
              },
            ]}
          />
        </TechnicalDetail>
      </div>
    </Drawer>
  );
}

/* =============================================================================== decisions = */

function DecisionsTab({ decided }: { decided: ReturnType<typeof decisions> }) {
  if (decided.length === 0) {
    return (
      <EmptyState
        glyph="decision"
        title="No decisions in this run"
        body="Decision steps are where AmazFlow classifies, extracts, or chooses. This run's path didn't include one."
        inline
      />
    );
  }

  return (
    <div className="ops-col">
      {decided.map((entry) => (
        <Panel
          key={entry.id}
          title={entry.stepName}
          sub={entry.operation}
          actions={
            entry.confidence !== undefined ? (
              <Pill tone={entry.belowThreshold ? "waiting" : "ai"}>
                {percent(entry.confidence, 1)} confident
              </Pill>
            ) : undefined
          }
        >
          {entry.belowThreshold && (
            <div style={{ marginBottom: 10 }}>
              <Alert tone="waiting" title="Below the configured threshold">
                This decision scored under the workflow&apos;s {percent(entry.threshold ?? 0)}{" "}
                confidence floor, so AmazFlow would not act on it unattended.
              </Alert>
            </div>
          )}

          <KeyValue
            rows={[
              {
                label: "Result",
                value:
                  entry.value === undefined ? (
                    <span className="ops-muted">not retained in run context</span>
                  ) : (
                    <code>{JSON.stringify(entry.value)}</code>
                  ),
              },
              { label: "Stored as", value: entry.outputKey ? <code>{entry.outputKey}</code> : "—" },
              {
                label: "Allowed values",
                value: entry.allowedValues?.length ? entry.allowedValues.join(", ") : undefined,
                hide: !entry.allowedValues?.length,
              },
              { label: "Decided", value: entry.at ? absoluteTime(entry.at) : "—" },
            ]}
          />

          {entry.confidence !== undefined && entry.threshold !== undefined && (
            <div style={{ marginTop: 12 }}>
              <Meter
                value={entry.confidence}
                tone={entry.belowThreshold ? "waiting" : "good"}
                label={
                  <>
                    Confidence {percent(entry.confidence, 1)} · threshold {percent(entry.threshold)}
                  </>
                }
              />
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <TechnicalDetail label="Prompt and usage">
              <KeyValue
                rows={[
                  {
                    label: "Prompt",
                    value: entry.prompt ? <CodeBlock value={entry.prompt} /> : "—",
                  },
                  {
                    label: "Token usage",
                    value: entry.usage ? (
                      <CodeBlock value={entry.usage} />
                    ) : (
                      <span className="ops-muted">not returned for this step</span>
                    ),
                  },
                  {
                    label: "Trace id",
                    value: entry.traceId ? <IdChip value={entry.traceId} /> : <span className="ops-muted">—</span>,
                  },
                ]}
              />
            </TechnicalDetail>
          </div>
        </Panel>
      ))}
    </div>
  );
}

/* ================================================================================= browser = */

function BrowserTab({
  browser,
  pending,
}: {
  browser: ReturnType<typeof browserActivity>;
  pending: { id: string; stepId: string; operation: string; provider: string; expiresAt: string; status: string }[];
}) {
  if (browser.length === 0 && pending.length === 0) {
    return (
      <EmptyState
        glyph="agents"
        title="No browser activity"
        body="This run didn't need AmazFlow Browser or a Chrome Agent."
        inline
      />
    );
  }

  const toneFor = (kind: string) =>
    kind === "failed" ? "bad" : kind === "returned" ? "good" : kind === "handoff" ? "waiting" : "waiting";

  return (
    <div className="ops-col">
      {pending.length > 0 && (
        <Panel title="Open browser task" sub="AmazFlow is waiting on this now">
          {pending.map((task) => (
            <KeyValue
              key={task.id}
              rows={[
                { label: "Operation", value: <code>{task.operation}</code> },
                { label: "Step", value: <code>{task.stepId}</code> },
                { label: "Status", value: <Pill tone="waiting" dot>{task.status}</Pill> },
                {
                  label: "Expires",
                  value: `${absoluteTime(task.expiresAt)} (${relativeTime(task.expiresAt)})`,
                },
              ]}
            />
          ))}
        </Panel>
      )}

      <Panel title="Browser activity">
        <Timeline
          items={browser.map((event) => ({
            id: event.id,
            timeLabel: clockTime(event.at),
            tone: toneFor(event.kind),
            headline: <b>{event.label}</b>,
            message: event.message,
            facts: [
              ...(event.taskId ? [{ label: "Task", value: shortId(event.taskId) }] : []),
              ...(event.connectionId
                ? [{ label: "Connection", value: shortId(event.connectionId) }]
                : []),
            ],
          }))}
        />
      </Panel>

      <Alert tone="neutral" title="Session recordings">
        AmazFlow Browser sessions are recorded and encrypted for 30 days, but recordings are not
        retrievable from this console today — there is no playback route on the control plane.
      </Alert>
    </div>
  );
}

/* =================================================================================== gates = */

function GatesTab({ gateList }: { gateList: ReturnType<typeof gates> }) {
  if (gateList.length === 0) {
    return (
      <EmptyState
        glyph="approvals"
        title="No approval gates"
        body="This run's path had no human approval or pre-action confirmation step."
        inline
      />
    );
  }

  return (
    <Panel title="Approval and confirmation history">
      <Timeline
        items={gateList.map((gate) => ({
          id: gate.id,
          timeLabel: clockTime(gate.at),
          tone: gate.state === "granted" ? "good" : gate.state === "rejected" ? "bad" : "waiting",
          current: gate.state === "pending",
          headline: (
            <>
              <b>
                {gate.kind === "approval" ? "Approval" : "Confirmation"}{" "}
                {gate.state === "pending" ? "requested" : gate.state === "granted" ? "granted" : "declined"}
              </b>
              {gate.stepName && <Pill tone="muted">{gate.stepName}</Pill>}
            </>
          ),
          message: gate.message,
          facts: [
            ...(gate.roles ? [{ label: "Roles", value: gate.roles.join(", ") }] : []),
            ...(gate.decidedBy ? [{ label: "By", value: gate.decidedBy }] : []),
            ...(gate.decidedRole ? [{ label: "Role", value: gate.decidedRole }] : []),
          ],
        }))}
      />
    </Panel>
  );
}

/* ==================================================================================== data = */

function DataTab({ data }: { data: ReturnType<typeof contextValues> }) {
  const values = Object.entries(data.values);
  return (
    <div className="ops-col">
      <Panel title="Input the run started with">
        <CodeBlock value={data.input} />
      </Panel>

      <Panel title="Values AmazFlow derived" sub={`${values.length}`}>
        {values.length === 0 ? (
          <p className="ops-small ops-muted">No derived values yet.</p>
        ) : (
          <KeyValue
            rows={values.map(([key, entry]) => ({
              label: key,
              value: (
                <span className="ops-row">
                  <code>{JSON.stringify(entry.value)}</code>
                  {typeof entry.confidence === "number" && (
                    <Pill tone="ai">{percent(entry.confidence, 1)}</Pill>
                  )}
                </span>
              ),
            }))}
          />
        )}
      </Panel>

      <Panel title="Last action result">
        {data.lastAction === null ? (
          <p className="ops-small ops-muted">No action has completed yet.</p>
        ) : (
          <CodeBlock value={data.lastAction} />
        )}
      </Panel>
    </div>
  );
}

/* ================================================================================= related = */

function RelatedTab({
  run,
  related,
  tickets,
}: {
  run: WorkflowRun;
  related: WorkflowRun[];
  tickets: { id: string; subject: string; status: string; priority: string; updatedAt: string }[];
}) {
  const ops = useOps();
  const nav = useNav();

  const siblings = useMemo(
    () =>
      ops
        .runsForWorkflow(run.workflowId)
        .filter((candidate) => candidate.id !== run.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 12),
    [ops, run],
  );

  return (
    <div className="ops-col">
      <Panel
        title="Runs from the same input"
        sub={
          related.length === 0
            ? "None"
            : `${related.length} — the closest thing to a retry chain AmazFlow records`
        }
      >
        {related.length === 0 ? (
          <p className="ops-small ops-muted">
            No other run of this workflow started from an equivalent input.
          </p>
        ) : (
          <RunMiniTable runs={related} onOpen={(id) => nav.openRun(id)} />
        )}
      </Panel>

      <Panel title="Recent runs of this workflow" sub={`${siblings.length}`}>
        {siblings.length === 0 ? (
          <p className="ops-small ops-muted">This is the only run of this workflow.</p>
        ) : (
          <RunMiniTable runs={siblings} onOpen={(id) => nav.openRun(id)} />
        )}
      </Panel>

      <Panel title="Support tickets referencing this run" sub={`${tickets.length}`}>
        {tickets.length === 0 ? (
          <p className="ops-small ops-muted">No tickets link to this run.</p>
        ) : (
          <div className="ops-col ops-gap-sm">
            {tickets.map((ticket) => (
              <button
                key={ticket.id}
                className="ops-row"
                onClick={() => nav.go({ section: "support", entityId: ticket.id })}
              >
                <Pill tone={ticket.status === "open" ? "waiting" : "muted"}>
                  {ticket.status.replace("_", " ")}
                </Pill>
                <span className="ops-strong">{ticket.subject}</span>
                <ToolbarSpacer />
                <span className="ops-small ops-muted">{relativeTime(ticket.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function RunMiniTable({ runs, onOpen }: { runs: WorkflowRun[]; onOpen: (id: string) => void }) {
  return (
    <div className="ops-col ops-gap-sm">
      {runs.map((run) => {
        const status = runStatus(run.status);
        return (
          <button key={run.id} className="ops-row" style={{ width: "100%" }} onClick={() => onOpen(run.id)}>
            <span style={{ width: 150, flexShrink: 0 }}>
              <Pill tone={status.tone}>{status.label}</Pill>
            </span>
            <span className="ops-small mono ops-muted">{shortId(run.id, 10)}</span>
            <ToolbarSpacer />
            <span className="ops-small ops-muted ops-nowrap">
              {relativeTime(run.createdAt)} · {shortDuration(runDuration(run))}
            </span>
            <Chevron />
          </button>
        );
      })}
    </div>
  );
}

/* =============================================================================== technical = */

function TechnicalTab({
  run,
  grants,
}: {
  run: WorkflowRun;
  grants: ReturnType<typeof grantScopes>;
}) {
  return (
    <div className="ops-col">
      <Panel
        title="Execution grant scope"
        sub="What each action was authorised to do"
      >
        <p className="ops-small ops-muted" style={{ marginBottom: 10 }}>
          Every action step runs under a signed, single-use grant bound to this tenant, this run,
          this pinned workflow version, that one step, and one tool. Grants expire in minutes and
          only a replay marker is retained, so there is no grant history to read back — but the
          binding below is exactly what any grant for this run could have authorised.
        </p>
        {grants.length === 0 ? (
          <p className="ops-small ops-muted">This run has not reached an action step.</p>
        ) : (
          <div className="ops-col ops-gap-sm">
            {grants.map((grant) => (
              <div key={grant.stepId} className="ops-row ops-row-wrap">
                <span className="ops-strong" style={{ minWidth: 180 }}>
                  {grant.stepName}
                </span>
                <Pill tone="muted">{grant.tool}</Pill>
                {grant.allowedTools.map((tool) => (
                  <code key={tool} className="ops-tag">
                    {tool}
                  </code>
                ))}
                {grant.confirmationGranted ? (
                  <Pill tone="good">confirmation granted</Pill>
                ) : (
                  <Pill tone="muted">no confirmation required</Pill>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Identifiers">
        <KeyValue
          rows={[
            { label: "Run id", value: <IdChip value={run.id} /> },
            { label: "Tenant", value: <IdChip value={run.tenantId} /> },
            { label: "Workflow id", value: <IdChip value={run.workflowId} /> },
            { label: "Workflow version", value: run.workflowVersion },
            { label: "Current step", value: run.currentStepId ? <code>{run.currentStepId}</code> : "—" },
            {
              label: "Confirmed steps",
              value: run.confirmedStepIds?.length ? run.confirmedStepIds.join(", ") : "none",
            },
            { label: "Execution backend", value: <code>{run.executionBackend ?? "unknown"}</code> },
            {
              label: "Trace id",
              value: run.traceId ? <IdChip value={run.traceId} /> : <span className="ops-muted">—</span>,
            },
          ]}
        />
        <div style={{ marginTop: 10 }}>
          <p className="ops-small ops-muted">
            Executor and browser session identifiers are intentionally stripped from every API
            response by the control plane and are not available here.
          </p>
        </div>
      </Panel>

      <Panel title="Raw run record">
        <TechnicalDetail label="Show the full JSON the control plane returned">
          <CodeBlock value={run} />
        </TechnicalDetail>
      </Panel>
    </div>
  );
}

function executorFor(step: { type: string; provider?: string; browserMode?: string }) {
  if (step.type !== "action") return "Control plane";
  return step.provider === "browser"
    ? step.browserMode === "connected"
      ? "Chrome Agent"
      : "AmazFlow Browser"
    : step.provider === "api"
      ? "Connected API"
      : (step.provider ?? "—");
}
