import { API, refreshSession, signIn, revokeRefreshToken, type Session } from "./auth.js";
import { DESKTOP_ACTIONS, assertDestination, checkPermissions, executeDesktopAction } from "./executor.js";

export type AgentRecord = { id: string; name: string; token: string; tenantId: string };
export type Status = {
  state: "signed_out" | "connected" | "working" | "paused" | "error";
  detail?: string;
  lastHeartbeatAt: string | null;
  permissions: { accessibility: boolean; screenRecording: boolean } | null;
  currentTask: { action: string; stepId: string; runId: string; destination: string | null; claimExpiresAt: string } | null;
  lastResult: { at: string; action: string; ok: boolean; detail: string } | null;
};

export type Store = {
  read(): Promise<{ session?: Session; agent?: AgentRecord; installationId?: string }>;
  write(patch: { session?: Session | null; agent?: AgentRecord | null; installationId?: string }): Promise<void>;
};

type TaskClaim = {
  task: { id: string; operation: string; input: Record<string, unknown> };
  grant: string; runId: string; stepId: string; claimExpiresAt: string;
  executionTarget: string; destination: string | null;
};

const POLL_MS = 15000;
const HEARTBEAT_MS = 120000;

// The agent's whole lifecycle, deliberately independent of any window. main.ts owns the UI and
// simply observes this; closing the window stops nothing.
export class DesktopAgent {
  private session: Session | null = null;
  private agent: AgentRecord | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private beatTimer: NodeJS.Timeout | null = null;
  private busy = false;
  status: Status = { state: "signed_out", lastHeartbeatAt: null, permissions: null, currentTask: null, lastResult: null };

  constructor(private store: Store, private version: string, private onChange: () => void) {}

  private set(patch: Partial<Status>) {
    this.status = { ...this.status, ...patch };
    this.onChange();
  }

  capabilities(): string[] { return [...DESKTOP_ACTIONS]; }

  async restore() {
    const { session, agent } = await this.store.read();
    this.session = session ?? null;
    this.agent = agent ?? null;
    this.set({ permissions: await checkPermissions() });
    if (this.session && this.agent) {
      this.set({ state: "connected" });
      this.start();
    }
  }

  async connect(email: string, password: string, tenantId?: string) {
    const session = await signIn(email, password);
    this.session = session;
    await this.store.write({ session });
    this.agent = await this.register(session, tenantId || session.tenantId);
    await this.store.write({ agent: this.agent });
    await this.heartbeat();
    this.set({ state: "connected", detail: undefined });
    this.start();
  }

  async reconnect() {
    const session = await this.validSession();
    if (!session) throw new Error("Your AmazFlow session expired. Sign in again.");
    this.agent = await this.register(session, session.tenantId);
    await this.store.write({ agent: this.agent });
    await this.heartbeat();
    this.set({ state: "connected", detail: undefined });
    this.start();
  }

  async disconnect() {
    this.stop();
    await revokeRefreshToken(this.session?.refreshToken);
    this.session = null;
    this.agent = null;
    await this.store.write({ session: null, agent: null });
    this.set({ state: "signed_out", detail: undefined, lastHeartbeatAt: null, currentTask: null, lastResult: null });
  }

  start() {
    if (!this.agent) return;
    if (!this.pollTimer) this.pollTimer = setInterval(() => void this.tick(), POLL_MS);
    if (!this.beatTimer) this.beatTimer = setInterval(() => void this.heartbeat().catch(() => undefined), HEARTBEAT_MS);
    if (this.status.state === "paused") this.set({ state: "connected", detail: undefined });
  }

  stop() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.beatTimer) { clearInterval(this.beatTimer); this.beatTimer = null; }
    if (this.agent) this.set({ state: "paused", detail: "Agent stopped — it will not claim work until you start it again." });
  }

  running() { return this.pollTimer !== null; }
  snapshot() {
    return {
      email: this.session?.email ?? null,
      organization: this.agent?.tenantId ?? this.session?.tenantId ?? null,
      agentName: this.agent?.name ?? null,
      agentId: this.agent?.id ?? null,
      version: this.version,
      running: this.running(),
      status: this.status,
    };
  }

  private async validSession(): Promise<Session | null> {
    if (!this.session) return null;
    if (this.session.expiresAt > Date.now() + 60000) return this.session;
    if (!this.session.refreshToken) return null;
    try {
      this.session = await refreshSession(this.session.refreshToken);
      await this.store.write({ session: this.session });
      return this.session;
    } catch {
      return null;
    }
  }

  private async register(session: Session, tenantId: string): Promise<AgentRecord> {
    const { installationId: existing } = await this.store.read();
    const installationId = existing ?? crypto.randomUUID();
    if (!existing) await this.store.write({ installationId });
    const authorize = await fetch(`${API}/agent-authorizations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.idToken}` },
      body: JSON.stringify({
        name: `${session.email.split("@")[0]} · Mac`,
        installationId,
        agentType: "DESKTOP_AGENT",
        capabilities: this.capabilities(),
        platform: `darwin ${process.arch}`,
        version: this.version,
        ...(session.role === "SUPER_ADMIN" ? { tenantId } : {}),
      }),
    });
    const authorized = await authorize.json();
    if (!authorize.ok) throw new Error(authorized.error || `Could not register this Mac (${authorize.status})`);
    const exchange = await fetch(`${API}/agent-authorizations/${encodeURIComponent(authorized.code)}/exchange`, { method: "POST" });
    const credential = await exchange.json();
    if (!exchange.ok) throw new Error(credential.error || `Could not activate this Mac (${exchange.status})`);
    return { id: credential.agentId, name: credential.agentName || "AmazFlow Agent", token: credential.token, tenantId: credential.tenantId };
  }

  private async heartbeat() {
    if (!this.agent) return;
    const permissions = await checkPermissions();
    const response = await fetch(`${API}/agent/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-AmazFlow-Agent-Token": this.agent.token },
      body: JSON.stringify({ version: this.version, capabilities: this.capabilities(), permissions }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      this.set({ state: "error", detail: body.error || `Heartbeat failed (${response.status})`, permissions });
      return;
    }
    this.set({ lastHeartbeatAt: new Date().toISOString(), permissions, state: this.status.state === "error" ? "connected" : this.status.state });
  }

  private async tick() {
    if (this.busy || !this.agent) return;
    this.busy = true;
    try {
      const tasks: TaskClaim["task"][] = await fetch(`${API}/agent/tasks`, {
        headers: { "X-AmazFlow-Agent-Token": this.agent.token },
      }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
      // The server already restricts this list to this organization and to desktop work this build
      // advertised; this only guards against acting on an action a newer server introduced.
      const candidate = tasks.find((t) => (DESKTOP_ACTIONS as readonly string[]).includes(t.operation));
      if (!candidate) return;
      await this.runTask(candidate.id);
    } finally {
      this.busy = false;
    }
  }

  private async runTask(taskId: string) {
    if (!this.agent) return;
    const claimResponse = await fetch(`${API}/agent/tasks/${taskId}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-AmazFlow-Agent-Token": this.agent.token },
    });
    const claimBody = await claimResponse.json();
    if (!claimResponse.ok) {
      if (!/already/i.test(claimBody.error ?? "")) this.set({ state: "error", detail: claimBody.error ?? "Could not claim the task" });
      return;
    }
    const claim = claimBody as TaskClaim;
    // Belt and braces against a task that does not belong on this surface at all.
    if (claim.executionTarget !== "desktop_agent") {
      this.set({ state: "error", detail: "Refused a task that is not a desktop step." });
      return;
    }
    this.set({
      state: "working",
      currentTask: { action: claim.task.operation, stepId: claim.stepId, runId: claim.runId, destination: claim.destination, claimExpiresAt: claim.claimExpiresAt },
    });

    let outcome;
    try {
      assertDestination(claim.task.operation, claim.task.input ?? {}, claim.destination);
      const permissions = await checkPermissions();
      outcome = await executeDesktopAction(claim.task.operation, claim.task.input ?? {}, { captureAllowed: permissions.screenRecording });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome = {
        ok: false,
        error: message === "ACCESSIBILITY_DENIED" ? "AmazFlow Agent needs Accessibility permission to act on this Mac." : message,
        evidence: { observedAt: new Date().toISOString() },
      };
    }

    await fetch(`${API}/agent/tools/record-step-result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant: claim.grant,
        stepId: claim.stepId,
        status: outcome.ok ? "SUCCEEDED" : "FAILED",
        note: `${claim.task.operation}${claim.destination ? ` on ${claim.destination}` : ""}${outcome.ok ? "" : ` — ${String(outcome.error)}`}`,
      }),
    }).catch(() => undefined);

    let reported = false;
    let reportError: string | undefined;
    for (let attempt = 0; attempt < 3 && !reported; attempt++) {
      try {
        const res = await fetch(`${API}/agent/tasks/${claim.task.id}/result`, {
          method: "POST",
          headers: { "content-type": "application/json", "X-AmazFlow-Agent-Token": this.agent.token, "X-AmazFlow-Execution-Grant": claim.grant },
          body: JSON.stringify(outcome),
        });
        if (res.ok) { reported = true; break; }
        reportError = `AmazFlow rejected the result (${res.status})`;
        break;
      } catch (error) {
        reportError = error instanceof Error ? error.message : String(error);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }

    this.set({
      state: "connected",
      currentTask: null,
      detail: undefined,
      lastResult: {
        at: new Date().toISOString(),
        action: claim.task.operation,
        ok: Boolean(outcome.ok) && reported,
        detail: !outcome.ok ? String(outcome.error ?? "Failed") : reported ? "Completed" : `Ran, but AmazFlow didn’t record it — ${reportError}`,
      },
    });
  }
}
