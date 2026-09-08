"use client";

import type { WorkflowDefinition, WorkflowRun } from "@amazflow/workflow-schema";

type Organization = { id: string; name: string; slug: string; status: string; plan: string; createdAt: string };
type Agent = { id: string; name: string; tenantId: string; status: string; lastSeenAt: string | null };

function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isRecentlyConnected(agent: Agent) {
  if (!agent.lastSeenAt) return false;
  return Date.now() - new Date(agent.lastSeenAt).getTime() < 10 * 60000;
}

export function Overview({
  workflows,
  runs,
  agents,
  organizations,
  onOpenRuns,
  onOpenExceptions,
  onOpenApprovals,
  onOpenAgents,
  onOpenClients,
}: {
  workflows: WorkflowDefinition[];
  runs: WorkflowRun[];
  agents: Agent[];
  organizations: Organization[];
  onOpenRuns: (filter?: string) => void;
  onOpenExceptions: () => void;
  onOpenApprovals: () => void;
  onOpenAgents: () => void;
  onOpenClients: () => void;
}) {
  const runsToday = runs.filter((r) => isToday(r.createdAt));
  const completed = runs.filter((r) => r.status === "COMPLETED");
  const failed = runs.filter((r) => r.status === "FAILED");
  const timedOut = runs.filter((r) => r.status === "TIMED_OUT");
  const waitingApproval = runs.filter((r) => r.status === "WAITING_APPROVAL");
  const waitingAgent = runs.filter((r) => r.status === "WAITING_AGENT");
  const connectedAgents = agents.filter((a) => a.status === "active" && isRecentlyConnected(a));
  const activeWorkflows = workflows.filter((w) => w.status === "active");

  const exceptions = [...failed, ...timedOut].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);

  const workflowsNeedingAttention = activeWorkflows.filter((w) =>
    runs.some((r) => r.workflowId === w.id && (r.status === "FAILED" || r.status === "TIMED_OUT"))
  );

  const recentActivity = runs
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6);

  return (
    <div className="ov-wrap">
      <div className="ov-grid">
        <button className="ov-tile" onClick={() => onOpenClients()}>
          <span className="ov-n">{organizations.length}</span>
          <span className="ov-l">Customers</span>
        </button>
        <button className="ov-tile" onClick={() => onOpenRuns()}>
          <span className="ov-n">{activeWorkflows.length}</span>
          <span className="ov-l">Active workflows</span>
        </button>
        <button className="ov-tile" onClick={() => onOpenRuns("today")}>
          <span className="ov-n">{runsToday.length}</span>
          <span className="ov-l">Runs today</span>
        </button>
        <button className="ov-tile ov-good" onClick={() => onOpenRuns("COMPLETED")}>
          <span className="ov-n">{completed.length}</span>
          <span className="ov-l">Successful runs</span>
        </button>
        <button className="ov-tile ov-bad" onClick={onOpenExceptions}>
          <span className="ov-n">{failed.length + timedOut.length}</span>
          <span className="ov-l">Failed / timed out</span>
        </button>
        <button className="ov-tile ov-warn" onClick={onOpenApprovals}>
          <span className="ov-n">{waitingApproval.length}</span>
          <span className="ov-l">Waiting on approval</span>
        </button>
        <button className="ov-tile ov-warn" onClick={() => onOpenRuns("WAITING_AGENT")}>
          <span className="ov-n">{waitingAgent.length}</span>
          <span className="ov-l">Waiting on an agent</span>
        </button>
        <button className="ov-tile" onClick={onOpenAgents}>
          <span className="ov-n">{connectedAgents.length}</span>
          <span className="ov-l">Agents connected now</span>
        </button>
      </div>

      <div className="ov-cols">
        <section className="ov-panel">
          <h3>Workflows needing attention</h3>
          {workflowsNeedingAttention.length === 0 ? (
            <p className="ov-empty">Nothing needs attention right now.</p>
          ) : (
            <ul className="ov-list">
              {workflowsNeedingAttention.map((w) => (
                <li key={w.id}>
                  <button onClick={onOpenExceptions}>
                    <b>{w.name}</b>
                    <small>has recent failures or timeouts</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ov-panel">
          <h3>Recent exceptions</h3>
          {exceptions.length === 0 ? (
            <p className="ov-empty">No failures or timeouts recently — good sign.</p>
          ) : (
            <ul className="ov-list">
              {exceptions.map((r) => (
                <li key={r.id}>
                  <button onClick={onOpenExceptions}>
                    <b>{r.workflowId}</b>
                    <small>
                      {r.status.replaceAll("_", " ").toLowerCase()} · {new Date(r.updatedAt).toLocaleString()}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ov-panel">
          <h3>Recent activity</h3>
          {recentActivity.length === 0 ? (
            <p className="ov-empty">Runs will appear here once a customer starts one.</p>
          ) : (
            <ul className="ov-list">
              {recentActivity.map((r) => (
                <li key={r.id}>
                  <button onClick={() => onOpenRuns()}>
                    <b>{r.workflowId}</b>
                    <small>
                      {r.status.replaceAll("_", " ").toLowerCase()} · {new Date(r.updatedAt).toLocaleString()}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
