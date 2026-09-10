"use client";

/**
 * The AmazFlow Control data layer.
 *
 * One provider owns every read against the real control plane, plus the cross-entity indexes
 * that make the console feel connected: from an organization you can reach its workflows,
 * runs, users, connections, approvals, failures and audit trail without another request; from
 * a run you can reach its workflow, tenant, connection and related attempts.
 *
 * Nothing here invents data. Where the control plane has no telemetry for something an
 * operator would reasonably want (connection last-used, retry attempts, per-tenant spend), the
 * gap is represented explicitly as `null`/`unavailable` so views can say so honestly instead
 * of rendering a plausible-looking zero.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { WorkflowDefinition, WorkflowRun } from "@amazflow/workflow-schema";
import { API, type Session } from "../../lib/cognito-auth";
import { EXCEPTION_STATUSES, isException, isLive } from "./terms";

/* ================================================================================== types = */

/**
 * Per-organization settings the control plane actually reads.
 *
 * maxConcurrentRuns and the org's own status gate run creation; allowedEmailDomains gates who
 * can be invited; timezone is what this console formats the org's timestamps in. The server
 * fills defaults on read, so `settings` is only absent on an org that predates the feature.
 */
export type OrgSettings = {
  maxConcurrentRuns: number;
  allowedEmailDomains: string[];
  timezone: string;
};

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  maxConcurrentRuns: 0,
  allowedEmailDomains: [],
  timezone: "UTC",
};

export const orgSettingsOf = (org?: Organization | null): OrgSettings => ({
  ...DEFAULT_ORG_SETTINGS,
  ...(org?.settings ?? {}),
});

export type Organization = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  createdAt: string;
  updatedAt?: string;
  branding?: { displayName?: string; logoUrl?: string; accent?: string; loginMessage?: string };
  settings?: Partial<OrgSettings>;
};

export type Agent = {
  id: string;
  name: string;
  tenantId: string;
  status: string;
  allowedDomains: string[];
  lastSeenAt: string | null;
  version: string | null;
  createdAt: string;
  createdBy?: string;
  // An agent is now one of two surfaces rather than "the browser agent", advertises the actions
  // its build implements, and reports the OS permissions it was granted. The server refuses a
  // claim for anything the agent did not advertise, so this is what explains why a workflow is
  // waiting rather than running.
  agentType?: string;
  installationId?: string;
  capabilities?: string[];
  platform?: string;
  connectionStatus?: "connected" | "offline" | "revoked";
  permissions?: { accessibility?: boolean; screenRecording?: boolean };
  lastHeartbeatAt?: string | null;
};

/** A workflow's readiness to run, per surface. From GET /workflows/{id}/preflight. */
export type PreflightSurface = {
  target: string;
  agentType: string;
  status: string;
  action: string | null;
  requiredActions?: string[];
  agents?: { agentId: string; version?: string; connectionStatus?: string }[];
};

export type Preflight = {
  workflowId: string;
  requiredTargets: string[];
  surfaces: PreflightSurface[];
  ready: boolean;
};

export type AgentTask = {
  id: string;
  runId: string;
  tenantId: string;
  stepId: string;
  provider: string;
  operation: string;
  expiresAt: string;
  status: string;
  workflowId?: string;
  createdBy?: string;
};

export type BrowserConnection = {
  id: string;
  tenantId: string;
  name: string;
  baseUrl: string;
  allowedOrigins: string[];
  preferredMode: "auto" | "managed" | "connected";
  status: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type ActivityEvent = {
  id: string;
  tenantId: string;
  at: string;
  actor: string;
  actorLabel?: string;
  action: string;
  summary: string;
};

export type TicketNote = { id: string; at: string; by: string; text: string; internal: boolean };

export type Ticket = {
  id: string;
  tenantId: string;
  createdBy: string;
  subject: string;
  message: string;
  category: string;
  priority: string;
  status: string;
  runId?: string;
  workflowId?: string;
  notes: TicketNote[];
  createdAt: string;
  updatedAt: string;
};

export type Lead = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  company?: string;
  role?: string;
  workflow?: string;
  volume?: string;
  message?: string;
  source?: string;
  status: string;
  createdAt: string;
};

export type PlatformSettings = {
  taskExpiryMs: number;
  confirmationExpiryMs: number;
  agentCodeExpiryMs: number;
  aiRuntimeLabel: string;
  dataBoundary: string;
};

export type HealthReport = {
  ok: boolean;
  service: string;
  boundary: string;
  aiRuntime: string;
};

export type UserRecord = {
  username: string;
  email: string;
  role: string;
  enabled: boolean;
};

export type TenantSummary = {
  totalRunsCompleted: number;
  totalMinutesSaved: number;
  dollarEstimate: number;
};

/** Async slot for data loaded on demand per entity. */
export type Slot<T> = { state: "idle" | "loading" | "ready" | "error"; data?: T; error?: string };

const idle: Slot<never> = { state: "idle" };

/* ============================================================================ derived types = */

export type WorkflowStats = {
  total: number;
  completed: number;
  failed: number;
  live: number;
  successRate: number | null;
  lastRunAt: string | null;
  medianDurationMs: number | null;
};

export type OrgHealth = {
  /** 0..1 -- composite of run success, exception load, and connection readiness. */
  score: number;
  tone: "good" | "waiting" | "bad" | "muted";
  label: string;
  reasons: string[];
};

/* ================================================================================ context = */

type OpsValue = {
  session: Session;
  request: <T = unknown>(path: string, options?: RequestInit) => Promise<T>;

  /* collections */
  workflows: WorkflowDefinition[];
  runs: WorkflowRun[];
  organizations: Organization[];
  agents: Agent[];
  agentTasks: AgentTask[];
  connections: BrowserConnection[];
  tickets: Ticket[];
  activity: ActivityEvent[];
  leads: Lead[];
  settings: PlatformSettings | null;
  health: HealthReport | null;

  loading: boolean;
  /** Per-resource failures, so one dead endpoint never blanks the whole console. */
  errors: Record<string, string>;
  lastLoadedAt: string | null;

  refresh: () => Promise<void>;
  refreshRuns: () => Promise<void>;

  live: boolean;
  setLive: (value: boolean) => void;

  /* lazily loaded per-entity data */
  users: Record<string, Slot<UserRecord[]>>;
  loadUsers: (tenantId: string) => void;
  summaries: Record<string, Slot<TenantSummary>>;
  loadSummary: (tenantId: string) => void;
  versions: Record<string, Slot<WorkflowDefinition[]>>;
  loadVersions: (workflowId: string) => void;

  /* indexes + derived reads */
  orgByTenant: (tenantId: string) => Organization | undefined;
  orgLabel: (tenantId: string) => string;
  workflowById: (id: string) => WorkflowDefinition | undefined;
  runById: (id: string) => WorkflowRun | undefined;
  tenantKeys: (org: Organization) => string[];
  runsForTenant: (tenantId: string) => WorkflowRun[];
  workflowsForTenant: (tenantId: string) => WorkflowDefinition[];
  connectionsForTenant: (tenantId: string) => BrowserConnection[];
  agentsForTenant: (tenantId: string) => Agent[];
  ticketsForTenant: (tenantId: string) => Ticket[];
  activityForTenant: (tenantId: string) => ActivityEvent[];
  runsForWorkflow: (workflowId: string) => WorkflowRun[];
  workflowsUsingConnection: (connectionId: string) => WorkflowDefinition[];
  statsForWorkflow: (workflowId: string) => WorkflowStats;
  healthForOrg: (org: Organization) => OrgHealth;

  /** All tenant ids seen on real records, including ones with no Organization row. */
  allTenantIds: string[];

  /* queues */
  approvals: WorkflowRun[];
  confirmations: WorkflowRun[];
  exceptions: WorkflowRun[];
  liveRuns: WorkflowRun[];

  /* mutations */
  applyRun: (run: WorkflowRun) => void;
  applyTicket: (ticket: Ticket) => void;
  applyConnections: (connections: BrowserConnection[]) => void;
  applyAgent: (agent: Agent) => void;
  applyOrganization: (org: Organization) => void;
  applySettings: (settings: PlatformSettings) => void;
};

const OpsContext = createContext<OpsValue | null>(null);

export function useOps() {
  const value = useContext(OpsContext);
  if (!value) throw new Error("useOps must be used inside <OpsDataProvider>");
  return value;
}

/* =============================================================================== provider = */

const LIVE_POLL_MS = 15_000;

export function OpsDataProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [connections, setConnections] = useState<BrowserConnection[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);

  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const [live, setLive] = useState(true);

  const [users, setUsers] = useState<Record<string, Slot<UserRecord[]>>>({});
  const [summaries, setSummaries] = useState<Record<string, Slot<TenantSummary>>>({});
  const [versions, setVersions] = useState<Record<string, Slot<WorkflowDefinition[]>>>({});

  const tokenRef = useRef(session.idToken);
  tokenRef.current = session.idToken;

  const request = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${tokenRef.current}`,
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        (body as { error?: string }).error ?? `Request failed (${response.status})`,
      );
    }
    return body as T;
  }, []);

  /** Load one collection, recording its failure without aborting the others. */
  const loadInto = useCallback(
    async <T,>(key: string, path: string, apply: (value: T) => void) => {
      try {
        const value = await request<T>(path);
        apply(value);
        setErrors((current) => {
          if (!current[key]) return current;
          const next = { ...current };
          delete next[key];
          return next;
        });
      } catch (error) {
        setErrors((current) => ({
          ...current,
          [key]: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [request],
  );

  const refresh = useCallback(async () => {
    await Promise.all([
      loadInto<WorkflowDefinition[]>("workflows", "/workflows", setWorkflows),
      loadInto<WorkflowRun[]>("runs", "/runs", setRuns),
      loadInto<Organization[]>("organizations", "/organizations", setOrganizations),
      loadInto<Agent[]>("agents", "/agents", setAgents),
      loadInto<AgentTask[]>("agentTasks", "/agent-tasks", setAgentTasks),
      loadInto<BrowserConnection[]>("connections", "/connections/browser", setConnections),
      loadInto<Ticket[]>("tickets", "/support/tickets", setTickets),
      loadInto<ActivityEvent[]>("activity", "/activity", setActivity),
      loadInto<Lead[]>("leads", "/leads", setLeads),
      loadInto<PlatformSettings>("settings", "/settings", setSettings),
      loadInto<HealthReport>("health", "/health", setHealth),
    ]);
    setLastLoadedAt(new Date().toISOString());
    setLoading(false);
  }, [loadInto]);

  /** Cheap refresh for the live views -- runs plus the two queues that move with them. */
  const refreshRuns = useCallback(async () => {
    await Promise.all([
      loadInto<WorkflowRun[]>("runs", "/runs", setRuns),
      loadInto<AgentTask[]>("agentTasks", "/agent-tasks", setAgentTasks),
    ]);
    setLastLoadedAt(new Date().toISOString());
  }, [loadInto]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live polling. Pauses while the tab is hidden so a backgrounded console stops spending
  // requests, and resumes with an immediate refresh when the operator comes back.
  useEffect(() => {
    if (!live) return;
    let timer: number | undefined;
    const tick = () => {
      if (!document.hidden) refreshRuns();
      timer = window.setTimeout(tick, LIVE_POLL_MS);
    };
    timer = window.setTimeout(tick, LIVE_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) refreshRuns();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, refreshRuns]);

  /* ---------------------------------------------------------------------- lazy loaders --- */

  const loadUsers = useCallback(
    (tenantId: string) => {
      setUsers((current) => {
        if (current[tenantId] && current[tenantId].state !== "idle") return current;
        return { ...current, [tenantId]: { state: "loading" } };
      });
      request<UserRecord[]>(`/tenants/${encodeURIComponent(tenantId)}/users`)
        .then((data) => setUsers((current) => ({ ...current, [tenantId]: { state: "ready", data } })))
        .catch((error: unknown) =>
          setUsers((current) => ({
            ...current,
            [tenantId]: { state: "error", error: error instanceof Error ? error.message : String(error) },
          })),
        );
    },
    [request],
  );

  const loadSummary = useCallback(
    (tenantId: string) => {
      setSummaries((current) => {
        if (current[tenantId] && current[tenantId].state !== "idle") return current;
        return { ...current, [tenantId]: { state: "loading" } };
      });
      request<TenantSummary>(`/tenants/${encodeURIComponent(tenantId)}/summary`)
        .then((data) => setSummaries((current) => ({ ...current, [tenantId]: { state: "ready", data } })))
        .catch((error: unknown) =>
          setSummaries((current) => ({
            ...current,
            [tenantId]: { state: "error", error: error instanceof Error ? error.message : String(error) },
          })),
        );
    },
    [request],
  );

  const loadVersions = useCallback(
    (workflowId: string) => {
      setVersions((current) => {
        if (current[workflowId] && current[workflowId].state !== "idle") return current;
        return { ...current, [workflowId]: { state: "loading" } };
      });
      request<WorkflowDefinition[]>(`/workflows/${encodeURIComponent(workflowId)}/versions`)
        .then((data) => setVersions((current) => ({ ...current, [workflowId]: { state: "ready", data } })))
        .catch((error: unknown) =>
          setVersions((current) => ({
            ...current,
            [workflowId]: { state: "error", error: error instanceof Error ? error.message : String(error) },
          })),
        );
    },
    [request],
  );

  /* -------------------------------------------------------------------------- indexes --- */

  // An organization is addressable by slug or by id, and run/workflow records in the wild use
  // either. Every tenant lookup goes through this map so both resolve to the same org.
  const orgIndex = useMemo(() => {
    const map = new Map<string, Organization>();
    for (const org of organizations) {
      map.set(org.slug, org);
      map.set(org.id, org);
    }
    return map;
  }, [organizations]);

  const workflowIndex = useMemo(
    () => new Map(workflows.map((workflow) => [workflow.id, workflow])),
    [workflows],
  );

  const runIndex = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);

  const runsByTenant = useMemo(() => {
    const map = new Map<string, WorkflowRun[]>();
    for (const run of runs) {
      const list = map.get(run.tenantId);
      if (list) list.push(run);
      else map.set(run.tenantId, [run]);
    }
    return map;
  }, [runs]);

  const runsByWorkflow = useMemo(() => {
    const map = new Map<string, WorkflowRun[]>();
    for (const run of runs) {
      const list = map.get(run.workflowId);
      if (list) list.push(run);
      else map.set(run.workflowId, [run]);
    }
    return map;
  }, [runs]);

  const allTenantIds = useMemo(() => {
    const seen = new Set<string>();
    for (const org of organizations) seen.add(org.slug);
    for (const run of runs) seen.add(run.tenantId);
    for (const workflow of workflows) seen.add(workflow.tenantId);
    for (const connection of connections) seen.add(connection.tenantId);
    for (const agent of agents) seen.add(agent.tenantId);
    for (const ticket of tickets) seen.add(ticket.tenantId);
    return [...seen].sort();
  }, [organizations, runs, workflows, connections, agents, tickets]);

  const orgByTenant = useCallback((tenantId: string) => orgIndex.get(tenantId), [orgIndex]);

  const orgLabel = useCallback(
    (tenantId: string) => {
      const org = orgIndex.get(tenantId);
      if (!org) return tenantId;
      return org.branding?.displayName || org.name;
    },
    [orgIndex],
  );

  const tenantKeys = useCallback((org: Organization) => [org.slug, org.id], []);

  const forTenant = useCallback(
    <T extends { tenantId: string }>(items: T[], tenantId: string): T[] => {
      const org = orgIndex.get(tenantId);
      const keys = org ? new Set([org.slug, org.id]) : new Set([tenantId]);
      return items.filter((item) => keys.has(item.tenantId));
    },
    [orgIndex],
  );

  const runsForTenant = useCallback(
    (tenantId: string) => {
      const org = orgIndex.get(tenantId);
      if (!org) return runsByTenant.get(tenantId) ?? [];
      return [...(runsByTenant.get(org.slug) ?? []), ...(org.id !== org.slug ? (runsByTenant.get(org.id) ?? []) : [])];
    },
    [orgIndex, runsByTenant],
  );

  const workflowsForTenant = useCallback(
    (tenantId: string) => forTenant(workflows, tenantId),
    [forTenant, workflows],
  );
  const connectionsForTenant = useCallback(
    (tenantId: string) => forTenant(connections, tenantId),
    [forTenant, connections],
  );
  const agentsForTenant = useCallback(
    (tenantId: string) => forTenant(agents, tenantId),
    [forTenant, agents],
  );
  const ticketsForTenant = useCallback(
    (tenantId: string) => forTenant(tickets, tenantId),
    [forTenant, tickets],
  );
  const activityForTenant = useCallback(
    (tenantId: string) => forTenant(activity, tenantId),
    [forTenant, activity],
  );

  const runsForWorkflow = useCallback(
    (workflowId: string) => runsByWorkflow.get(workflowId) ?? [],
    [runsByWorkflow],
  );

  /**
   * Which workflows depend on a connection. Derived from the workflow definition -- a step
   * either names the connection explicitly, or is a managed browser step in the same tenant,
   * which the control plane will resolve to that tenant's active connection at run time.
   */
  const workflowsUsingConnection = useCallback(
    (connectionId: string) => {
      const connection = connections.find((candidate) => candidate.id === connectionId);
      if (!connection) return [];
      return workflows.filter((workflow) =>
        workflow.steps.some((step) => {
          if (step.type !== "action") return false;
          if (step.connectionId === connectionId) return true;
          return (
            step.provider === "browser" &&
            step.browserMode !== "connected" &&
            !step.connectionId &&
            workflow.tenantId === connection.tenantId
          );
        }),
      );
    },
    [connections, workflows],
  );

  const statsForWorkflow = useCallback(
    (workflowId: string): WorkflowStats => {
      const list = runsForWorkflow(workflowId);
      const completed = list.filter((run) => run.status === "COMPLETED").length;
      const failed = list.filter((run) => isException(run.status)).length;
      const liveCount = list.filter((run) => isLive(run.status)).length;
      const decided = completed + failed;
      const durations = list
        .filter((run) => run.status === "COMPLETED")
        .map((run) => new Date(run.updatedAt).getTime() - new Date(run.createdAt).getTime())
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((a, b) => a - b);
      const lastRunAt = list.reduce<string | null>(
        (latest, run) => (!latest || run.createdAt > latest ? run.createdAt : latest),
        null,
      );
      return {
        total: list.length,
        completed,
        failed,
        live: liveCount,
        successRate: decided > 0 ? completed / decided : null,
        lastRunAt,
        medianDurationMs: durations.length ? durations[Math.floor(durations.length / 2)] : null,
      };
    },
    [runsForWorkflow],
  );

  /**
   * Composite organization health. Deliberately explainable: every deduction carries a reason
   * an operator can act on, and an org with no runs is "muted", not "healthy".
   */
  const healthForOrg = useCallback(
    (org: Organization): OrgHealth => {
      const tenantRuns = runsForTenant(org.slug);
      const tenantWorkflows = workflowsForTenant(org.slug);
      const tenantConnections = connectionsForTenant(org.slug);
      const reasons: string[] = [];

      const published = tenantWorkflows.filter((workflow) => workflow.status === "active");
      const failures = tenantRuns.filter((run) => isException(run.status));
      const stuck = tenantRuns.filter((run) => isLive(run.status));
      const decided = tenantRuns.filter(
        (run) => run.status === "COMPLETED" || isException(run.status),
      );
      const successRate =
        decided.length > 0
          ? decided.filter((run) => run.status === "COMPLETED").length / decided.length
          : null;

      if (tenantWorkflows.length === 0) reasons.push("No workflows configured");
      else if (published.length === 0) reasons.push("No published workflow");
      if (tenantConnections.length > 0 && !tenantConnections.some((c) => c.status === "active")) {
        reasons.push("No connection is signed in");
      }
      if (failures.length > 0) {
        reasons.push(`${failures.length} run${failures.length === 1 ? "" : "s"} need attention`);
      }
      if (successRate !== null && successRate < 0.8) {
        reasons.push(`Success rate ${(successRate * 100).toFixed(0)}%`);
      }

      if (tenantRuns.length === 0) {
        return {
          score: 0,
          tone: "muted",
          label: tenantWorkflows.length === 0 ? "Not set up" : "No activity yet",
          reasons,
        };
      }

      let score = successRate ?? 0.75;
      if (published.length === 0) score -= 0.25;
      if (tenantConnections.length > 0 && !tenantConnections.some((c) => c.status === "active")) {
        score -= 0.2;
      }
      score = Math.max(0, Math.min(1, score));

      const tone = score >= 0.9 && failures.length === 0 ? "good" : score >= 0.65 ? "waiting" : "bad";
      const label =
        tone === "good" ? "Healthy" : tone === "waiting" ? "Needs a look" : "At risk";
      return { score, tone, label, reasons: reasons.length ? reasons : [`${stuck.length} in flight`] };
    },
    [runsForTenant, workflowsForTenant, connectionsForTenant],
  );

  /* ---------------------------------------------------------------------------- queues --- */

  const approvals = useMemo(
    () =>
      runs
        .filter((run) => run.status === "WAITING_APPROVAL")
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
    [runs],
  );

  const confirmations = useMemo(
    () =>
      runs
        .filter((run) => run.status === "AWAITING_CONFIRMATION")
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
    [runs],
  );

  const exceptions = useMemo(
    () =>
      runs
        .filter((run) => EXCEPTION_STATUSES.includes(run.status))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [runs],
  );

  const liveRuns = useMemo(
    () => runs.filter((run) => isLive(run.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [runs],
  );

  /* ------------------------------------------------------------------ local mutations --- */

  const applyRun = useCallback((run: WorkflowRun) => {
    setRuns((current) => {
      const index = current.findIndex((candidate) => candidate.id === run.id);
      if (index === -1) return [run, ...current];
      const next = current.slice();
      next[index] = run;
      return next;
    });
  }, []);

  const applyTicket = useCallback((ticket: Ticket) => {
    setTickets((current) => {
      const index = current.findIndex((candidate) => candidate.id === ticket.id);
      if (index === -1) return [ticket, ...current];
      const next = current.slice();
      next[index] = ticket;
      return next;
    });
  }, []);

  const applyAgent = useCallback((agent: Agent) => {
    setAgents((current) => current.map((item) => (item.id === agent.id ? agent : item)));
  }, []);

  const applyOrganization = useCallback((org: Organization) => {
    setOrganizations((current) => {
      const index = current.findIndex((candidate) => candidate.id === org.id);
      if (index === -1) return [...current, org];
      const next = current.slice();
      next[index] = org;
      return next;
    });
  }, []);

  const value: OpsValue = {
    session,
    request,
    workflows,
    runs,
    organizations,
    agents,
    agentTasks,
    connections,
    tickets,
    activity,
    leads,
    settings,
    health,
    loading,
    errors,
    lastLoadedAt,
    refresh,
    refreshRuns,
    live,
    setLive,
    users,
    loadUsers,
    summaries,
    loadSummary,
    versions,
    loadVersions,
    orgByTenant,
    orgLabel,
    workflowById: useCallback((id: string) => workflowIndex.get(id), [workflowIndex]),
    runById: useCallback((id: string) => runIndex.get(id), [runIndex]),
    tenantKeys,
    runsForTenant,
    workflowsForTenant,
    connectionsForTenant,
    agentsForTenant,
    ticketsForTenant,
    activityForTenant,
    runsForWorkflow,
    workflowsUsingConnection,
    statsForWorkflow,
    healthForOrg,
    allTenantIds,
    approvals,
    confirmations,
    exceptions,
    liveRuns,
    applyRun,
    applyTicket,
    applyConnections: setConnections,
    applyAgent,
    applyOrganization,
    applySettings: setSettings,
  };

  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>;
}

/* ================================================================================ helpers = */

export { idle };

/** Bucket runs into per-day counts for the trailing `days` window, oldest first. */
export function runsByDay(runs: WorkflowRun[], days = 14) {
  const buckets: { key: string; label: string; total: number; failed: number; completed: number }[] = [];
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now);
    day.setDate(day.getDate() - offset);
    buckets.push({
      key: day.toISOString().slice(0, 10),
      label: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      total: 0,
      failed: 0,
      completed: 0,
    });
  }
  const index = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const run of runs) {
    const bucket = index.get(run.createdAt.slice(0, 10));
    if (!bucket) continue;
    bucket.total += 1;
    if (isException(run.status)) bucket.failed += 1;
    if (run.status === "COMPLETED") bucket.completed += 1;
  }
  return buckets;
}

/** How long a run has been sitting in its current state. */
export function waitingFor(run: WorkflowRun): number {
  return Date.now() - new Date(run.updatedAt).getTime();
}

/**
 * Other runs of the same workflow started from an equivalent input -- the closest thing to a
 * retry chain the control plane records, since nothing increments a retry counter today.
 */
export function relatedAttempts(run: WorkflowRun, runs: WorkflowRun[]): WorkflowRun[] {
  const fingerprint = JSON.stringify((run.context as { input?: unknown })?.input ?? {});
  return runs.filter(
    (candidate) =>
      candidate.id !== run.id &&
      candidate.workflowId === run.workflowId &&
      candidate.tenantId === run.tenantId &&
      JSON.stringify((candidate.context as { input?: unknown })?.input ?? {}) === fingerprint,
  );
}


/**
 * The control plane stamps `updatedAt` onto a saved workflow, but the shared workflow schema
 * doesn't declare it. Read it through this accessor rather than casting at every call site.
 */
export function workflowUpdatedAt(workflow: WorkflowDefinition): string | undefined {
  return (workflow as WorkflowDefinition & { updatedAt?: string }).updatedAt;
}
