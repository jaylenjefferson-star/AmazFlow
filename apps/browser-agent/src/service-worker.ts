import { API, AuthError, refreshSession, revokeRefreshToken, signIn, type Session } from "./auth.js";

type AgentTask = {
  id: string; operation: string; input: Record<string, unknown>; expiresAt: string;
  tenantId?: string; workflowId?: string; assignedRoles?: string[]; createdBy?: string;
  executionTarget?: "browser_extension" | "desktop_agent"; destination?: string | null;
};
type TaskClaim = {
  task: AgentTask; grant: string; grantId: string; runId: string; stepId: string; claimExpiresAt: string;
  // What a person should be shown. Ids, leases and grants stay inside this file.
  display?: { workflowName: string; stepName: string; stepNumber: number | null; stepCount: number | null };
};
type AgentRecord = { id: string; name: string; token: string; tenantId: string };
type Status = {
  state: "signed_out" | "connected" | "working" | "error";
  detail?: string;
  lastHeartbeatAt?: string | null;
  lastResult?: { at: string; operation: string; ok: boolean; detail: string } | null;
};

// What this build can actually carry out. It is sent at registration and on every heartbeat, and
// the server will not offer this agent an action that is not on the list -- so an older extension
// is passed over rather than claiming work it would fail.
const CAPABILITIES = ["NAVIGATE", "READ_TEXT", "CLICK", "TYPE", "SELECT", "CHECK", "SCROLL_TO", "WAIT_FOR", "VERIFY_TEXT", "CAPTURE_EVIDENCE", "SET_EMPLOYEE_STATUS"];
const ALLOWED_OPS = new Set(CAPABILITIES);
// Actions this worker performs against the tab itself rather than inside the page.
const TAB_ACTIONS = new Set(["NAVIGATE", "CAPTURE_EVIDENCE"]);
const VERSION = () => chrome.runtime.getManifest().version;

const get = <T,>(keys: string[]) => chrome.storage.local.get(keys) as unknown as Promise<T>;
const set = (values: Record<string, unknown>) => chrome.storage.local.set(values);

async function setStatus(patch: Partial<Status>) {
  const { status } = await get<{ status?: Status }>(["status"]);
  await set({ status: { ...(status ?? { state: "signed_out" }), ...patch } });
}

// Everything the old build stored belonged to the page-handshake flow: a token obtained by
// watching a tab for a ?code=, plus the tab id it was watching. None of it can be migrated into
// the new model -- those credentials were minted without an installation id, so reusing one
// would register a second agent for this same browser, which is exactly the duplication the
// Agents list already filled up with. Clear it once and let the person sign in.
const LEGACY_KEYS = ["agentToken", "agentId", "agentName", "tenantId", "userId", "userRole", "pendingConnectTabId", "lastConnectionError", "currentTask"];
async function migrateLegacyState() {
  const stored = await chrome.storage.local.get([...LEGACY_KEYS, "schemaVersion"]);
  if (stored.schemaVersion === 2) return;
  await chrome.storage.local.remove(LEGACY_KEYS);
  await set({ schemaVersion: 2 });
  if (stored.agentToken) {
    await setStatus({ state: "signed_out", detail: "This browser was connected with an older AmazFlow agent. Sign in once to reconnect." });
  }
}

// Stable per-installation identifier. The control plane keys agent records on it, so signing in
// again -- after a sign-out, a token expiry, or a browser restart -- reuses this browser's agent
// record instead of creating another one.
async function installationId(): Promise<string> {
  const { installationId: existing } = await get<{ installationId?: string }>(["installationId"]);
  if (existing) return existing;
  const created = crypto.randomUUID();
  await set({ installationId: created });
  return created;
}

async function currentSession(): Promise<Session | null> {
  const { session } = await get<{ session?: Session }>(["session"]);
  if (!session) return null;
  if (session.expiresAt > Date.now() + 60_000) return session;
  if (!session.refreshToken) return null;
  try {
    const refreshed = await refreshSession(session.refreshToken);
    await set({ session: refreshed });
    return refreshed;
  } catch {
    return null;
  }
}

// Registers (or re-registers) this browser as an agent of the signed-in user's organization and
// exchanges the one-time code for the agent credential the /agent/* routes accept. Both calls
// are made by the extension itself; no AmazFlow page is involved and nothing is put in a URL.
async function registerAgent(session: Session, tenantId: string): Promise<AgentRecord> {
  const authorize = await fetch(`${API}/agent-authorizations`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.idToken}` },
    body: JSON.stringify({
      name: `${session.email.split("@")[0]} · Chrome`,
      installationId: await installationId(),
      agentType: "CHROME_EXTENSION",
      capabilities: CAPABILITIES,
      platform: navigator.userAgent.includes("Mac") ? "chrome macOS" : "chrome",
      version: VERSION(),
      ...(session.role === "SUPER_ADMIN" ? { tenantId } : {}),
    }),
  });
  const authorized = await authorize.json();
  if (!authorize.ok) throw new AuthError(authorized.error || `Could not register this browser (${authorize.status})`, "RegisterFailed");
  const exchange = await fetch(`${API}/agent-authorizations/${encodeURIComponent(authorized.code)}/exchange`, { method: "POST" });
  const credential = await exchange.json();
  if (!exchange.ok) throw new AuthError(credential.error || `Could not activate this browser (${exchange.status})`, "ExchangeFailed");
  return { id: credential.agentId, name: credential.agentName || "AmazFlow Agent", token: credential.token, tenantId: credential.tenantId };
}

async function connect(email: string, password: string, tenantId?: string) {
  const session = await signIn(email, password);
  await set({ session });
  const agent = await registerAgent(session, tenantId || session.tenantId);
  await set({ agent });
  await heartbeat(agent);
  await setStatus({ state: "connected", detail: undefined });
  scheduleAlarms();
  return agent;
}

async function disconnect() {
  const { session } = await get<{ session?: Session }>(["session"]);
  await revokeRefreshToken(session?.refreshToken);
  await chrome.storage.local.remove(["session", "agent", "currentTask", "activityLog"]);
  await setStatus({ state: "signed_out", detail: undefined, lastHeartbeatAt: null, lastResult: null });
}

async function heartbeat(agent: AgentRecord) {
  const response = await fetch(`${API}/agent/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-AmazFlow-Agent-Token": agent.token },
    body: JSON.stringify({ version: VERSION(), capabilities: CAPABILITIES }),
  });
  if (!response.ok) throw new Error(`Heartbeat failed (${response.status})`);
  await setStatus({ lastHeartbeatAt: new Date().toISOString() });
}

type ActivityEntry = { at: string; operation: string; selector?: string; ok: boolean; detail: string; workflowName?: string | null; stepName?: string | null };
async function logActivity(entry: ActivityEntry) {
  const { activityLog } = await get<{ activityLog?: ActivityEntry[] }>(["activityLog"]);
  await set({ activityLog: [entry, ...(Array.isArray(activityLog) ? activityLog : [])].slice(0, 20) });
  await setStatus({ lastResult: { at: entry.at, operation: entry.operation, ok: entry.ok, detail: entry.detail } });
}

function scheduleAlarms() {
  chrome.alarms.create("amazflow-poll", { periodInMinutes: 0.25 });
  chrome.alarms.create("amazflow-heartbeat", { periodInMinutes: 2 });
}
chrome.runtime.onInstalled.addListener(() => { void migrateLegacyState().then(scheduleAlarms); });
chrome.runtime.onStartup.addListener(() => { void migrateLegacyState().then(scheduleAlarms); });

// The agent acts on whichever tab the step names, and falls back to the focused tab only when a
// step names no destination. Nothing here consults a per-site grant: host access is granted once
// to the extension by Chrome at install time, and *which* page may be touched is decided by the
// server-signed execution grant, not by a toggle in this popup.
const INJECTABLE = /^https?:/;
async function targetTabFor(task: AgentTask): Promise<chrome.tabs.Tab | null> {
  const wanted = typeof task.input?.url === "string" ? (task.input.url as string) : null;
  const tabs = await chrome.tabs.query({});
  if (wanted) {
    let origin: string;
    try { origin = new URL(wanted).origin; } catch { return null; }
    const exact = tabs.find((t) => t.url === wanted && INJECTABLE.test(t.url ?? ""));
    if (exact) return exact;
    const sameOrigin = tabs.find((t) => t.url?.startsWith(origin));
    if (sameOrigin) return sameOrigin;
    return await chrome.tabs.create({ url: wanted, active: false });
  }
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused?.url && INJECTABLE.test(focused.url)) return focused;
  return tabs.find((t) => INJECTABLE.test(t.url ?? "")) ?? null;
}

async function runTabAction(tabId: number, task: AgentTask): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }> {
  if (task.operation === "NAVIGATE") {
    const url = typeof task.input?.url === "string" ? (task.input.url as string) : "";
    let parsed: URL;
    try { parsed = new URL(url); } catch { return { ok: false, error: "NAVIGATE needs a valid url" }; }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, error: "NAVIGATE only opens http(s) pages" };
    await chrome.tabs.update(tabId, { url });
    // Resolve once the tab has actually finished loading, so the next step doesn't act on the old page.
    await new Promise<void>((resolve) => {
      const done = (id: number, info: chrome.tabs.TabChangeInfo) => {
        if (id === tabId && info.status === "complete") { chrome.tabs.onUpdated.removeListener(done); resolve(); }
      };
      chrome.tabs.onUpdated.addListener(done);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(done); resolve(); }, 20000);
    });
    const tab = await chrome.tabs.get(tabId);
    return { ok: true, result: { url: tab.url ?? url, title: tab.title ?? null } };
  }
  if (task.operation === "CAPTURE_EVIDENCE") {
    const tab = await chrome.tabs.get(tabId);
    // Captures only the tab the step is authorized to act on, never the whole screen or other tabs.
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }).catch(() => null);
    if (!dataUrl) return { ok: false, error: "Could not capture this tab" };
    return { ok: true, result: { captured: true, screenshot: dataUrl } };
  }
  return { ok: false, error: `${task.operation} is not a tab action` };
}

async function runOnce(agent: AgentRecord) {
  const tasks: AgentTask[] = await fetch(`${API}/agent/tasks`, { headers: { "X-AmazFlow-Agent-Token": agent.token } })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);

  // The server already scopes this list to the agent's organization, role, and ownership. These
  // are cheap local checks so the agent never claims work this build could not carry out.
  const candidate = tasks.find(
    (t) =>
      ALLOWED_OPS.has(t.operation) &&
      // The server already scopes the list to this surface; this refuses anything that somehow
      // reaches a browser agent but belongs on the desktop.
      (t.executionTarget ?? "browser_extension") === "browser_extension" &&
      new Date(t.expiresAt).getTime() > Date.now() &&
      (!t.tenantId || t.tenantId === agent.tenantId),
  );
  if (!candidate) return;

  const tab = await targetTabFor(candidate);
  const selector = typeof candidate.input?.selector === "string" ? (candidate.input.selector as string) : undefined;
  if (!tab?.id) {
    await logActivity({ at: new Date().toISOString(), operation: candidate.operation, selector, ok: false, detail: "No page available to act on — open the target site in a tab." });
    return;
  }

  // Claim before touching the page: exactly one agent wins the lease, so two browsers signed into
  // the same organization can never both perform the same action.
  let claim: TaskClaim;
  try {
    const response = await fetch(`${API}/agent/tasks/${candidate.id}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-AmazFlow-Agent-Token": agent.token },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Claim failed (${response.status})`);
    claim = body as TaskClaim;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already/i.test(message)) {
      await logActivity({ at: new Date().toISOString(), operation: candidate.operation, selector, ok: false, detail: `Couldn’t claim the task — ${message}` });
    }
    return;
  }

  const task = claim.task || candidate;
  await set({ currentTask: { operation: task.operation, stepId: claim.stepId, runId: claim.runId, selector, claimExpiresAt: claim.claimExpiresAt, url: tab.url ?? null } });
  await setStatus({ state: "working", detail: `${task.operation} · step ${claim.stepId}` });

  // NAVIGATE and CAPTURE_EVIDENCE are properties of the tab, not of the document, so they are
  // performed here rather than injected into the page.
  let response: { ok: boolean; result?: Record<string, unknown>; error?: string };
  if (TAB_ACTIONS.has(task.operation)) {
    response = await runTabAction(tab.id, task).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  } else {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => undefined);
    response = await chrome.tabs.sendMessage(tab.id, { type: "AMAZFLOW_TASK", task }).catch((error) => ({ ok: false, error: String(error) }));
  }

  const evidence = { url: tab.url ?? null, title: tab.title ?? null, observedAt: new Date().toISOString() };
  const result = response?.ok ? { ok: true, ...response.result, evidence } : { ok: false, error: response?.error || "Unknown error", evidence };

  // Evidence first, then the terminal result: if reporting the result fails, the run still holds a
  // durable record of what this browser did and where, instead of the step looking like it never ran.
  //
  // That guarantee only holds if the evidence write is actually checked. This used to end in
  // `.catch(() => undefined)` and never look at `res.ok`, so an expired grant, an
  // already-consumed grant, or a 404 on the run was indistinguishable from success -- the very
  // failure mode the evidence record exists to catch, swallowed by the call that writes it.
  const evidenceNote = `${task.operation}${selector ? ` on ${selector}` : ""} at ${evidence.url}${result.ok ? "" : ` — ${String(result.error)}`}`;
  let evidenceRecorded = false;
  let evidenceError: string | undefined;
  try {
    const evidenceResponse = await fetch(`${API}/agent/tools/record-step-result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant: claim.grant,
        stepId: claim.stepId,
        status: result.ok ? "SUCCEEDED" : "FAILED",
        note: evidenceNote,
      }),
    });
    evidenceRecorded = evidenceResponse.ok;
    if (!evidenceResponse.ok) {
      evidenceError = `AmazFlow did not record what this browser did (${evidenceResponse.status})`;
    }
  } catch (error) {
    evidenceError = error instanceof Error ? error.message : String(error);
  }
  if (!evidenceRecorded) {
    console.warn("[AmazFlow] evidence write failed:", evidenceError);
  }

  let reported = false;
  let reportError: string | undefined;
  for (let attempt = 0; attempt < 3 && !reported; attempt++) {
    try {
      const res = await fetch(`${API}/agent/tasks/${task.id}/result`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-AmazFlow-Agent-Token": agent.token, "X-AmazFlow-Execution-Grant": claim.grant },
        body: JSON.stringify(result),
      });
      if (res.ok) { reported = true; break; }
      reportError = `AmazFlow rejected the result (${res.status})`;
      break;
    } catch (error) {
      reportError = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  await chrome.storage.local.remove(["currentTask"]);
  await setStatus({ state: "connected", detail: undefined });
  await logActivity({
    at: new Date().toISOString(),
    operation: task.operation,
    selector,
    ok: Boolean(result.ok) && reported,
    workflowName: claim.display?.workflowName ?? null,
    stepName: claim.display?.stepName ?? null,
    detail: !result.ok ? String(result.error || "Failed") : reported ? "Completed" : `Ran, but AmazFlow didn’t record it — ${reportError}`,
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const { agent } = await get<{ agent?: AgentRecord }>(["agent"]);
  if (!agent) return;
  if (alarm.name === "amazflow-heartbeat") {
    await heartbeat(agent).catch(async (error) => {
      // A revoked or deleted agent is the one failure the person has to act on; everything else
      // is transient and the next tick retries.
      await setStatus({ state: "error", detail: error instanceof Error ? error.message : String(error) });
    });
    return;
  }
  if (alarm.name !== "amazflow-poll") return;
  await runOnce(agent).catch(async (error) => {
    await setStatus({ state: "error", detail: error instanceof Error ? error.message : String(error) });
  });
});

// --- Entry point: starting work from the extension itself -------------------------------------
// A signed-in person can start any workflow AmazFlow has approved for them without opening the web
// app. The control plane still decides what is runnable and whether it can run right now.
async function runnableWorkflows() {
  const session = await currentSession();
  if (!session) throw new Error("Your AmazFlow session expired. Sign in again.");
  const response = await fetch(`${API}/workflows`, { headers: { authorization: `Bearer ${session.idToken}` } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load your workflows");
  return (body as { id: string; name: string; status: string; customerSummary?: string }[])
    .filter((w) => w.status === "active")
    .map((w) => ({ id: w.id, name: w.name, summary: w.customerSummary ?? "" }));
}

// Preflight comes back as machine detail. A person needs to be told which app to open, not which
// surface reported which status.
function readyMessage(preflight: { surfaces?: { target: string; status: string }[] } | undefined) {
  const blocked = (preflight?.surfaces ?? []).filter((s) => s.status !== "connected");
  if (!blocked.length) return "This workflow can’t start right now.";
  return blocked
    .map((s) => {
      const app = s.target === "desktop_agent" ? "AmazFlow Desktop App" : "AmazFlow browser extension";
      if (s.status === "not_installed") return `Part of this workflow runs on your Mac. Install the ${app} and sign in.`;
      if (s.status === "offline") return `Open the ${app} and sign in — it isn’t connected right now.`;
      if (s.status === "missing_permissions") return `The ${app} needs macOS Accessibility permission before it can run this.`;
      return `The ${app} needs updating before it can run this.`;
    })
    .join(" ");
}

async function startWorkflow(workflowId: string) {
  const session = await currentSession();
  if (!session) throw new Error("Your AmazFlow session expired. Sign in again.");
  const response = await fetch(`${API}/workflows/${encodeURIComponent(workflowId)}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.idToken}` },
    body: JSON.stringify({}),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(response.status === 409 && body.preflight ? readyMessage(body.preflight) : body.error || "Could not start that workflow");
  return { started: true };
}

// The popup is a view onto this worker, never the owner of the connection: it can start a
// sign-in, start a workflow, read state, or disconnect, and closing it changes nothing about
// polling or execution.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "AMAZFLOW_CONNECT") {
    connect(message.email, message.password, message.tenantId)
      .then((agent) => sendResponse({ ok: true, agent: { id: agent.id, name: agent.name, tenantId: agent.tenantId } }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === "AMAZFLOW_DISCONNECT") {
    disconnect().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "AMAZFLOW_WORKFLOWS") {
    runnableWorkflows()
      .then((workflows) => sendResponse({ ok: true, workflows }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === "AMAZFLOW_START") {
    startWorkflow(message.workflowId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === "AMAZFLOW_RECONNECT") {
    (async () => {
      const session = await currentSession();
      if (!session) throw new AuthError("Your AmazFlow session expired. Sign in again.", "Expired");
      const agent = await registerAgent(session, session.tenantId);
      await set({ agent });
      await heartbeat(agent);
      await setStatus({ state: "connected", detail: undefined });
      scheduleAlarms();
    })()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  return undefined;
});

void migrateLegacyState().then(scheduleAlarms);
