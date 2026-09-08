"use client";

import { useMemo, useState } from "react";
import type { AmazFlowRole, WorkflowDefinition, WorkflowRun } from "@amazflow/workflow-schema";
import { RunDetailScreen } from "../console/run-detail";

type Mode = "runs" | "approvals" | "exceptions";

const STATUS_LABEL: Record<string, string> = {
  RUNNING: "Running",
  AWAITING_CONFIRMATION: "Awaiting confirmation",
  WAITING_AGENT: "Waiting on agent",
  WAITING_APPROVAL: "Waiting on approval",
  CANCELLED: "Cancelled",
  TIMED_OUT: "Timed out",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

function applyMode(runs: WorkflowRun[], mode: Mode, statusFilter: string) {
  if (mode === "approvals") return runs.filter((r) => r.status === "WAITING_APPROVAL");
  if (mode === "exceptions") return runs.filter((r) => r.status === "FAILED" || r.status === "TIMED_OUT");
  if (statusFilter === "today") {
    const now = new Date();
    return runs.filter((r) => {
      const d = new Date(r.createdAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    });
  }
  if (statusFilter && statusFilter !== "all") return runs.filter((r) => r.status === statusFilter);
  return runs;
}

export function RunsPanel({
  mode,
  runs,
  workflows,
  role,
  currentUserId,
  selectedRunId,
  initialStatusFilter,
  onSelectRun,
  onApprove,
  onSendBack,
  onConfirm,
  onFixRequest,
  onCancelRun,
  onRetry,
  retryingId,
}: {
  mode: Mode;
  runs: WorkflowRun[];
  workflows: WorkflowDefinition[];
  role: AmazFlowRole;
  currentUserId: string;
  selectedRunId: string | null;
  initialStatusFilter?: string;
  onSelectRun: (runId: string | null) => void;
  onApprove: (run: WorkflowRun) => Promise<void>;
  onSendBack: (run: WorkflowRun) => Promise<void>;
  onConfirm: (run: WorkflowRun) => Promise<void>;
  onFixRequest: (run: WorkflowRun) => Promise<void>;
  onCancelRun: (run: WorkflowRun) => Promise<void>;
  onRetry?: (run: WorkflowRun) => Promise<void>;
  retryingId?: string | null;
}) {
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter || "all");
  const [orgFilter, setOrgFilter] = useState("all");
  const [search, setSearch] = useState("");

  const workflowById = useMemo(() => new Map(workflows.map((w) => [w.id, w])), [workflows]);
  const tenants = useMemo(() => [...new Set(runs.map((r) => r.tenantId))].sort(), [runs]);

  const selectedRun = selectedRunId ? runs.find((r) => r.id === selectedRunId) : undefined;
  const selectedWorkflow = selectedRun ? workflowById.get(selectedRun.workflowId) : undefined;

  if (selectedRunId) {
    if (!selectedRun || !selectedWorkflow) {
      return (
        <div className="rp-notfound">
          <h2>We couldn&apos;t find that run.</h2>
          <button className="console-btn console-btn-primary" onClick={() => onSelectRun(null)}>
            Back to {mode === "approvals" ? "approvals" : mode === "exceptions" ? "exceptions" : "runs"}
          </button>
        </div>
      );
    }
    return (
      <div className="rp-detail">
        <button className="rp-back" onClick={() => onSelectRun(null)}>
          ← Back
        </button>
        <RunDetailScreen
          run={selectedRun}
          workflow={selectedWorkflow}
          role={role}
          currentUserId={currentUserId}
          onApprove={() => onApprove(selectedRun)}
          onSendBack={() => onSendBack(selectedRun)}
          onConfirm={() => onConfirm(selectedRun)}
          onFixRequest={() => onFixRequest(selectedRun)}
          onCancelRun={() => onCancelRun(selectedRun)}
        />
      </div>
    );
  }

  let filtered = applyMode(runs, mode, statusFilter);
  if (orgFilter !== "all") filtered = filtered.filter((r) => r.tenantId === orgFilter);
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter((r) => r.id.toLowerCase().includes(q) || r.workflowId.toLowerCase().includes(q) || r.tenantId.toLowerCase().includes(q));
  }
  filtered = filtered.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="rp-wrap">
      <div className="rp-filters">
        <input placeholder="Search by run id, workflow, or org…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {mode === "runs" && (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="today">Today</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )}
        {tenants.length > 1 && (
          <select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
            <option value="all">All organizations</option>
            {tenants.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="rp-empty">
          {mode === "approvals"
            ? "Nothing is waiting on approval."
            : mode === "exceptions"
              ? "No failures or timeouts — nothing to triage."
              : "No runs match this filter."}
        </p>
      ) : (
        <div className="rp-rows">
          {filtered.map((run) => {
            const workflow = workflowById.get(run.workflowId);
            const isException = run.status === "FAILED" || run.status === "TIMED_OUT";
            return (
              <div className={`rp-row ${isException ? "rp-row-bad" : ""}`} key={run.id}>
                <button className="rp-row-main" onClick={() => onSelectRun(run.id)}>
                  <span className={`rp-dot rp-dot-${run.status}`} />
                  <div>
                    <b>{workflow?.name ?? run.workflowId}</b>
                    <small>
                      {run.tenantId} · {new Date(run.createdAt).toLocaleString()}
                    </small>
                  </div>
                  <mark>{STATUS_LABEL[run.status] ?? run.status}</mark>
                  <span className="rp-chevron">›</span>
                </button>
                {mode === "exceptions" && onRetry && (
                  <button className="rp-retry" disabled={retryingId === run.id} onClick={() => onRetry(run)}>
                    {retryingId === run.id ? "Retrying…" : "Retry"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
