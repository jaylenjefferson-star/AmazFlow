"use client";

/**
 * Platform — settings, system health, and the honest inventory of what this console can and
 * cannot control.
 *
 * The execution timeouts here are real: changing them changes how long a live run waits before
 * the control plane gives up on it.
 */

import { useEffect, useMemo, useState } from "react";
import { useOps } from "../data";
import { modifierKeyLabel } from "../icons";
import { PageHead } from "../shell";
import { useOpsActions } from "../actions";
import {
  Alert,
  Btn,
  CodeBlock,
  Field,
  KeyValue,
  Metrics,
  Panel,
  Pill,
  TechnicalDetail,
  ToolbarSpacer,
} from "../primitives";
import {
  dataBoundaryLabel,
  isException,
  isLive,
  percent,
  relativeTime,
  shortDuration,
} from "../terms";

/** Bounds enforced by the control plane (SETTINGS_BOUNDS). */
const BOUNDS = {
  taskExpiryMs: { min: 30_000, max: 3_600_000 },
  confirmationExpiryMs: { min: 60_000, max: 86_400_000 },
  agentCodeExpiryMs: { min: 30_000, max: 600_000 },
};

export function SettingsView() {
  const ops = useOps();
  const actions = useOpsActions();

  const [modifier, setModifier] = useState("Ctrl");
  const [taskMinutes, setTaskMinutes] = useState("");
  const [confirmMinutes, setConfirmMinutes] = useState("");
  const [codeSeconds, setCodeSeconds] = useState("");

  useEffect(() => setModifier(modifierKeyLabel()), []);

  useEffect(() => {
    if (!ops.settings) return;
    setTaskMinutes(String(ops.settings.taskExpiryMs / 60_000));
    setConfirmMinutes(String(ops.settings.confirmationExpiryMs / 60_000));
    setCodeSeconds(String(ops.settings.agentCodeExpiryMs / 1000));
  }, [ops.settings]);

  const nextValues = {
    taskExpiryMs: Math.round(Number(taskMinutes) * 60_000),
    confirmationExpiryMs: Math.round(Number(confirmMinutes) * 60_000),
    agentCodeExpiryMs: Math.round(Number(codeSeconds) * 1000),
  };

  const invalid =
    !Number.isFinite(nextValues.taskExpiryMs) ||
    nextValues.taskExpiryMs < BOUNDS.taskExpiryMs.min ||
    nextValues.taskExpiryMs > BOUNDS.taskExpiryMs.max ||
    !Number.isFinite(nextValues.confirmationExpiryMs) ||
    nextValues.confirmationExpiryMs < BOUNDS.confirmationExpiryMs.min ||
    nextValues.confirmationExpiryMs > BOUNDS.confirmationExpiryMs.max ||
    !Number.isFinite(nextValues.agentCodeExpiryMs) ||
    nextValues.agentCodeExpiryMs < BOUNDS.agentCodeExpiryMs.min ||
    nextValues.agentCodeExpiryMs > BOUNDS.agentCodeExpiryMs.max;

  const dirty =
    ops.settings !== null &&
    (nextValues.taskExpiryMs !== ops.settings.taskExpiryMs ||
      nextValues.confirmationExpiryMs !== ops.settings.confirmationExpiryMs ||
      nextValues.agentCodeExpiryMs !== ops.settings.agentCodeExpiryMs);

  /* --------------------------------------------------------------------- platform health --- */

  const health = useMemo(() => {
    const decided = ops.runs.filter((run) => run.status === "COMPLETED" || isException(run.status));
    const successRate =
      decided.length > 0
        ? decided.filter((run) => run.status === "COMPLETED").length / decided.length
        : null;
    const stale = ops.runs.filter(
      (run) => isLive(run.status) && Date.now() - new Date(run.updatedAt).getTime() > 3_600_000,
    );
    const expiringTasks = ops.agentTasks.filter(
      (task) => new Date(task.expiresAt).getTime() - Date.now() < 60_000,
    );
    return { successRate, stale, expiringTasks, decided: decided.length };
  }, [ops.runs, ops.agentTasks]);

  return (
    <>
      <PageHead
        title="Platform"
        sub="How the control plane behaves, what it is permitted to process, and what this console can actually change."
      />

      <Metrics
        items={[
          {
            label: "Control plane",
            value: ops.health?.ok ? "Healthy" : ops.errors.health ? "Unreachable" : "Checking…",
            tone: ops.health?.ok ? "good" : ops.errors.health ? "bad" : undefined,
            foot: ops.health?.service ?? "—",
          },
          {
            label: "Platform success rate",
            value: health.successRate === null ? "—" : percent(health.successRate),
            tone:
              health.successRate === null
                ? undefined
                : health.successRate >= 0.95
                  ? "good"
                  : health.successRate >= 0.8
                    ? "waiting"
                    : "bad",
            foot: `${health.decided} decided runs`,
          },
          {
            label: "Stalled runs",
            value: health.stale.length,
            tone: health.stale.length > 0 ? "bad" : "good",
            foot: "In flight over an hour",
          },
          {
            label: "Tasks expiring",
            value: health.expiringTasks.length,
            tone: health.expiringTasks.length > 0 ? "waiting" : undefined,
            foot: "Within a minute",
          },
          {
            label: "Data loaded",
            value: ops.lastLoadedAt ? relativeTime(ops.lastLoadedAt) : "—",
            foot: ops.live ? "Live polling on" : "Live polling paused",
          },
        ]}
      />

      {health.stale.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="waiting" title={`${health.stale.length} run${health.stale.length === 1 ? "" : "s"} have been in flight over an hour`}>
            These are usually runs waiting on a browser task or a human decision that never came.
            The sweep will time them out once their window passes.
          </Alert>
        </div>
      )}

      <div className="ops-section">
        <div className="ops-split">
          <div className="ops-col">
            <Panel
              title="Execution timeouts"
              sub="Real backend behaviour"
              actions={
                <>
                  {dirty && !invalid && <Pill tone="waiting">unsaved</Pill>}
                  <Btn
                    variant="primary"
                    size="sm"
                    disabled={!dirty || invalid || actions.busy === "saveSettings"}
                    onClick={() => actions.saveSettings(nextValues)}
                  >
                    {actions.busy === "saveSettings" ? "Saving…" : "Save"}
                  </Btn>
                </>
              }
            >
              <p className="ops-small ops-muted" style={{ marginBottom: 14 }}>
                These change how long AmazFlow waits before giving up on a step and marking a run
                timed out. They apply platform-wide, to every organization.
              </p>

              <div className="ops-grid" data-cols="2">
                <Field
                  label="Browser task timeout"
                  hint={`Minutes. Between ${BOUNDS.taskExpiryMs.min / 60_000} and ${BOUNDS.taskExpiryMs.max / 60_000}.`}
                >
                  <input
                    className="ops-input"
                    type="number"
                    min={BOUNDS.taskExpiryMs.min / 60_000}
                    max={BOUNDS.taskExpiryMs.max / 60_000}
                    step="0.5"
                    value={taskMinutes}
                    onChange={(event) => setTaskMinutes(event.target.value)}
                  />
                </Field>

                <Field
                  label="Confirmation gate timeout"
                  hint={`Minutes. Between ${BOUNDS.confirmationExpiryMs.min / 60_000} and ${BOUNDS.confirmationExpiryMs.max / 60_000}.`}
                >
                  <input
                    className="ops-input"
                    type="number"
                    min={BOUNDS.confirmationExpiryMs.min / 60_000}
                    max={BOUNDS.confirmationExpiryMs.max / 60_000}
                    step="1"
                    value={confirmMinutes}
                    onChange={(event) => setConfirmMinutes(event.target.value)}
                  />
                </Field>

                <Field
                  label="Agent authorization code lifetime"
                  hint={`Seconds. Between ${BOUNDS.agentCodeExpiryMs.min / 1000} and ${BOUNDS.agentCodeExpiryMs.max / 1000}.`}
                >
                  <input
                    className="ops-input"
                    type="number"
                    min={BOUNDS.agentCodeExpiryMs.min / 1000}
                    max={BOUNDS.agentCodeExpiryMs.max / 1000}
                    step="10"
                    value={codeSeconds}
                    onChange={(event) => setCodeSeconds(event.target.value)}
                  />
                </Field>
              </div>

              {invalid && (
                <div style={{ marginTop: 12 }}>
                  <Alert tone="bad" title="Out of range">
                    The control plane rejects values outside the bounds shown above.
                  </Alert>
                </div>
              )}

              {ops.settings && (
                <div style={{ marginTop: 14 }}>
                  <KeyValue
                    rows={[
                      {
                        label: "Currently live",
                        value: (
                          <>
                            Browser tasks {shortDuration(ops.settings.taskExpiryMs)} · confirmations{" "}
                            {shortDuration(ops.settings.confirmationExpiryMs)} · agent codes{" "}
                            {shortDuration(ops.settings.agentCodeExpiryMs)}
                          </>
                        ),
                      },
                    ]}
                  />
                </div>
              )}
            </Panel>

            <Panel title="What this console cannot change">
              <p className="ops-small ops-muted" style={{ marginBottom: 12 }}>
                Stated explicitly so nobody hunts for a control that does not exist.
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.85 }}>
                <li>
                  <b>Feature flags</b> — no general flag store exists. The real per-organization
                  levers live on an organization&apos;s Config tab: execution status, concurrent run
                  limit, and allowed email domains. Workflow status, assigned roles, and revocation
                  are the rest.
                </li>
                <li>
                  <b>Plan-based limits</b> — a plan is recorded for reporting and enforces nothing.
                  Set an organization&apos;s run limit directly if it needs a ceiling.
                </li>
                <li>
                  <b>Billing</b> — no invoices, rate cards, seats, or metered spend are recorded.
                </li>
                <li>
                  <b>Data boundary</b> — set by control-plane deployment configuration, not at
                  runtime.
                </li>
                <li>
                  <b>AI model selection</b> — fixed by the deployed runtime configuration.
                </li>
                <li>
                  <b>Retry policy enforcement</b> — the schema accepts it; no execution path reads
                  it yet.
                </li>
                <li>
                  <b>User creation and role changes</b> — identity-pool operations with no
                  control-plane route.
                </li>
              </ul>
            </Panel>
          </div>

          <div className="ops-col">
            <Panel title="Runtime">
              <KeyValue
                rows={[
                  {
                    label: "AI runtime",
                    value: ops.settings?.aiRuntimeLabel ?? ops.health?.aiRuntime ?? "—",
                  },
                  {
                    label: "Data boundary",
                    value: (
                      <span className="ops-row ops-gap-sm">
                        <Pill
                          tone={
                            (ops.settings?.dataBoundary ?? "").startsWith("production")
                              ? "good"
                              : "waiting"
                          }
                        >
                          {dataBoundaryLabel(ops.settings?.dataBoundary ?? ops.health?.boundary)}
                        </Pill>
                      </span>
                    ),
                  },
                  {
                    label: "Control plane",
                    value: ops.health?.ok ? (
                      <Pill tone="good">reachable</Pill>
                    ) : (
                      <Pill tone="bad">unreachable</Pill>
                    ),
                  },
                  { label: "Service", value: ops.health?.service ?? "—" },
                ]}
              />
              <div style={{ marginTop: 12 }}>
                <Alert tone="waiting" title="Data boundary">
                  Do not enter health data, payment-card data, secrets, or other regulated data
                  until the matching compliance controls are enabled — regardless of what a
                  workflow&apos;s data class claims.
                </Alert>
              </div>
            </Panel>

            <Panel title="Loaded data">
              <KeyValue
                rows={[
                  { label: "Workflows", value: ops.workflows.length },
                  { label: "Runs", value: ops.runs.length },
                  { label: "Organizations", value: ops.organizations.length },
                  { label: "Connections", value: ops.connections.length },
                  { label: "Chrome Agents", value: ops.agents.length },
                  { label: "Open browser tasks", value: ops.agentTasks.length },
                  { label: "Tickets", value: ops.tickets.length },
                  { label: "Config events", value: ops.activity.length },
                  { label: "Leads", value: ops.leads.length },
                ]}
              />
              <div className="ops-row" style={{ marginTop: 12 }}>
                <span className="ops-small ops-muted">
                  {ops.lastLoadedAt ? `Last read ${relativeTime(ops.lastLoadedAt)}` : "Not loaded yet"}
                </span>
                <ToolbarSpacer />
                <Btn size="sm" onClick={() => ops.refresh()}>
                  Refresh all
                </Btn>
              </div>
              <div style={{ marginTop: 12 }}>
                <p className="ops-small ops-muted">
                  Collections are returned unpaginated, so a very large workspace can be truncated
                  by the control plane before it reaches this console.
                </p>
              </div>
            </Panel>

            <Panel title="Keyboard">
              <KeyValue
                rows={[
                  {
                    label: "Command palette",
                    value: (
                      <>
                        <kbd className="ops-kbd">{modifier}</kbd> <kbd className="ops-kbd">K</kbd>
                      </>
                    ),
                  },
                  { label: "Search", value: <kbd className="ops-kbd">/</kbd> },
                  {
                    label: "Jump to section",
                    value: (
                      <>
                        <kbd className="ops-kbd">g</kbd> then <kbd className="ops-kbd">r</kbd> runs,{" "}
                        <kbd className="ops-kbd">c</kbd> customers, <kbd className="ops-kbd">w</kbd>{" "}
                        workflows, <kbd className="ops-kbd">a</kbd> approvals
                      </>
                    ),
                  },
                  {
                    label: "Move in a table",
                    value: (
                      <>
                        <kbd className="ops-kbd">j</kbd> <kbd className="ops-kbd">k</kbd> then{" "}
                        <kbd className="ops-kbd">enter</kbd>
                      </>
                    ),
                  },
                  { label: "Close overlay", value: <kbd className="ops-kbd">esc</kbd> },
                ]}
              />
            </Panel>

            {ops.settings && (
              <TechnicalDetail label="Raw settings record">
                <CodeBlock value={ops.settings} />
              </TechnicalDetail>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
