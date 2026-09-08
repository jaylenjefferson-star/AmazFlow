"use client";

import { useMemo, useState } from "react";
import type { WorkflowRun } from "@amazflow/workflow-schema";

type ActivityEvent = { id: string; tenantId: string; at: string; actor: string; actorLabel?: string; action: string; summary: string };

type UnifiedEvent = {
  id: string;
  at: string;
  tenantId: string;
  source: "config" | "run";
  action: string;
  summary: string;
  actorLabel?: string;
  runId?: string;
  details?: unknown;
};

function unify(activity: ActivityEvent[], runs: WorkflowRun[]): UnifiedEvent[] {
  const fromActivity: UnifiedEvent[] = activity.map((a) => ({
    id: `activity_${a.id}`,
    at: a.at,
    tenantId: a.tenantId,
    source: "config",
    action: a.action,
    summary: a.summary,
    actorLabel: a.actorLabel,
  }));
  const fromRuns: UnifiedEvent[] = runs.flatMap((run) =>
    run.audit.map((entry) => ({
      id: `run_${run.id}_${entry.id}`,
      at: entry.at,
      tenantId: run.tenantId,
      source: "run" as const,
      action: entry.type,
      summary: entry.message,
      runId: run.id,
      details: entry.details,
    }))
  );
  return [...fromActivity, ...fromRuns].sort((a, b) => b.at.localeCompare(a.at));
}

export function AuditPanel({
  activity,
  loading,
  runs,
  onOpenRun,
}: {
  activity: ActivityEvent[];
  loading: boolean;
  runs: WorkflowRun[];
  onOpenRun: (runId: string) => void;
}) {
  const [tenantFilter, setTenantFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "config" | "run">("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const events = useMemo(() => unify(activity, runs), [activity, runs]);
  const tenants = useMemo(() => [...new Set(events.map((e) => e.tenantId))].sort(), [events]);

  let filtered = events;
  if (tenantFilter !== "all") filtered = filtered.filter((e) => e.tenantId === tenantFilter);
  if (sourceFilter !== "all") filtered = filtered.filter((e) => e.source === sourceFilter);
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter((e) => e.summary.toLowerCase().includes(q) || e.action.toLowerCase().includes(q) || (e.actorLabel || "").toLowerCase().includes(q));
  }

  return (
    <div className="au-wrap">
      <div className="rp-filters">
        <input placeholder="Search events…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as "all" | "config" | "run")}>
          <option value="all">All event types</option>
          <option value="config">Configuration & admin</option>
          <option value="run">Run activity</option>
        </select>
        {tenants.length > 1 && (
          <select value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
            <option value="all">All organizations</option>
            {tenants.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <p className="product-empty">Loading audit history…</p>
      ) : filtered.length === 0 ? (
        <p className="ov-empty">No events match this filter.</p>
      ) : (
        <div className="au-rows">
          {filtered.slice(0, 200).map((e) => (
            <div className="au-row" key={e.id}>
              <button className="au-row-main" onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}>
                <span className={`au-badge au-badge-${e.source}`}>{e.source === "config" ? "Config" : "Run"}</span>
                <div>
                  <b>{e.summary}</b>
                  <small>
                    {e.tenantId} · {e.actorLabel ? `${e.actorLabel} · ` : ""}
                    {new Date(e.at).toLocaleString()}
                  </small>
                </div>
                <span className="rp-chevron">{expandedId === e.id ? "⌄" : "›"}</span>
              </button>
              {expandedId === e.id && (
                <div className="au-expand">
                  <p>
                    <b>Event type:</b> <code>{e.action}</code>
                  </p>
                  {e.runId && (
                    <p>
                      <button className="console-btn-text" onClick={() => onOpenRun(e.runId!)}>
                        Open this run →
                      </button>
                    </p>
                  )}
                  {e.details != null && (
                    <pre className="au-json">{JSON.stringify(e.details, null, 2)}</pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
