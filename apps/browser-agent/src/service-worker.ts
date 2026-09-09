type AgentTask = { id: string; operation: string; input: Record<string, unknown>; expiresAt: string; tenantId?: string; workflowId?: string; assignedRoles?: string[]; createdBy?: string };

// What POST /agent/tasks/{id}/claim returns. The grant -- not this agent's long-lived bearer
// token -- is what actually authorizes the two calls that follow, and AmazFlow binds it to one
// run, workflow version and step, accepts each of its tools exactly once, and expires it in
// minutes. Nothing here is worth persisting: a grant that outlives the step it was minted for is
// useless, so it stays in this one function's scope and is never written to chrome.storage.
type TaskClaim = {
  task: AgentTask;
  grant: string;
  grantId: string;
  runId: string;
  stepId: string;
  claimExpiresAt: string;
};

const DEFAULT_API = "https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com";
const allowed = new Set(["READ_TEXT", "CLICK", "TYPE", "SELECT", "CHECK", "SCROLL_TO", "WAIT_FOR", "VERIFY_TEXT", "SET_EMPLOYEE_STATUS"]);

async function getConfig() {
  const stored = await chrome.storage.local.get(["apiBase", "agentToken"]);
  return { apiBase: (stored.apiBase as string) || DEFAULT_API, agentToken: (stored.agentToken as string) || "" };
}

async function hasHostPermission(origin: string) {
  return chrome.permissions.contains({ origins: [`${origin}/*`] });
}

type ActivityEntry = { at: string; operation: string; selector?: string; ok: boolean; detail: string };

// Feeds the popup's "Recent activity" list -- the only place a person watching the extension
// (rather than the tab it's acting on, which they may not be looking at the instant it runs) can
// see what the agent actually did. Capped so this never grows into a real log store.
async function logActivity(entry: ActivityEntry) {
  const { activityLog } = await chrome.storage.local.get(["activityLog"]);
  const next = [entry, ...(Array.isArray(activityLog) ? activityLog : [])].slice(0, 20);
  await chrome.storage.local.set({ activityLog: next });
}

function scheduleAlarms() {
  chrome.alarms.create("amazflow-poll", { periodInMinutes: 0.25 });
  chrome.alarms.create("amazflow-heartbeat", { periodInMinutes: 2 });
}

async function sendHeartbeat(apiBase: string, agentToken: string) {
  const response = await fetch(`${apiBase}/agent/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-AmazFlow-Agent-Token": agentToken },
    body: JSON.stringify({ version: chrome.runtime.getManifest().version }),
  });
  if (!response.ok) throw new Error(`Heartbeat failed (${response.status})`);
}

chrome.runtime.onInstalled.addListener(scheduleAlarms);
chrome.runtime.onStartup.addListener(scheduleAlarms);

const exchangingCodes = new Set<string>();

async function exchangeAuthorizationCode(tabId: number, url: string) {
  const { pendingConnectTabId } = await chrome.storage.local.get(["pendingConnectTabId"]);
  if (!pendingConnectTabId || tabId !== pendingConnectTabId) return;
  let code: string | null = null;
  try {
    code = new URL(url).searchParams.get("code");
  } catch {
    return;
  }
  if (!code || exchangingCodes.has(code)) return;

  exchangingCodes.add(code);
  const { apiBase } = await getConfig();
  try {
    const response = await fetch(`${apiBase}/agent-authorizations/${encodeURIComponent(code)}/exchange`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Exchange failed");
    await chrome.storage.local.set({
      agentToken: body.token,
      agentId: body.agentId,
      agentName: body.agentName || "AmazFlow Browser Agent",
      tenantId: body.tenantId,
      userId: body.userId,
      userRole: body.userRole,
    });
    await chrome.storage.local.remove(["pendingConnectTabId", "lastConnectionError"]);
    await sendHeartbeat(apiBase, body.token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await chrome.storage.local.set({ lastConnectionError: `Connection failed: ${message}` });
    console.error("AmazFlow agent connect failed", error);
  } finally {
    exchangingCodes.delete(code);
  }
}

// Completes the "Connect to AmazFlow" flow started from the popup: watches the specific tab it
// opened (not every tab, to avoid ever matching on an unrelated page) for the ?code=... the
// /agent-authorize page pushes into its own URL via history.replaceState once a human approves,
// then exchanges that one-time code server-side for an agent-scoped credential. The popup never
// handles the human's Cognito session at all.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url) await exchangeAuthorizationCode(tabId, changeInfo.url);
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  void exchangeAuthorizationCode(details.tabId, details.url);
}, { url: [{ hostEquals: "amazflow.com", pathPrefix: "/agent-authorize" }] });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "amazflow-heartbeat") {
    const { apiBase, agentToken } = await getConfig();
    if (!agentToken) return;
    await sendHeartbeat(apiBase, agentToken).catch(() => undefined);
    return;
  }

  if (alarm.name !== "amazflow-poll") return;

  // Fallback for the one-time "Connect to AmazFlow" handshake. chrome.tabs.onUpdated and
  // webNavigation.onHistoryStateUpdated are supposed to catch the ?code=... the authorize page
  // pushes via history.replaceState once a human approves, but this is a pure client-side URL
  // change (no navigation, no network request) and this MV3 service worker can be asleep at
  // that exact moment -- Chrome does not reliably wake it for that specific event. This alarm is
  // already running every 15s regardless, so it also just directly checks the pending connect
  // tab's current URL, which needs no event to have fired at all.
  const { pendingConnectTabId } = await chrome.storage.local.get(["pendingConnectTabId"]);
  if (pendingConnectTabId) {
    try {
      const tab = await chrome.tabs.get(pendingConnectTabId);
      if (tab.url) await exchangeAuthorizationCode(pendingConnectTabId, tab.url);
    } catch {
      // The tab was closed before authorizing -- stop polling for it.
      await chrome.storage.local.remove(["pendingConnectTabId"]);
    }
  }

  const { apiBase, agentToken } = await getConfig();
  if (!agentToken) return;

  const tasks = await fetch(`${apiBase}/agent/tasks`, { headers: { "X-AmazFlow-Agent-Token": agentToken } })
    .then((r) => (r.ok ? (r.json() as Promise<AgentTask[]>) : []))
    .catch(() => [] as AgentTask[]);
  
  // Security: Get agent's tenant and user role to ensure proper filtering
  const { tenantId: myTenantId, userRole } = await chrome.storage.local.get(["tenantId", "userRole"]);
  
  // Filter tasks to only those the user is authorized to execute
  const validTasks = tasks.filter((t) => {
    // Must be from our tenant (prevent cross-tenant leakage)
    if (myTenantId && t.tenantId && t.tenantId !== myTenantId) return false;
    
    // Must be an allowed operation
    if (!allowed.has(t.operation)) return false;
    
    // Must not be expired
    if (new Date(t.expiresAt).getTime() <= Date.now()) return false;
    
    // Permission check: workflow must be assigned to user's role
    // SUPER_ADMIN can execute anything, others must have their role in assignedRoles
    if (userRole !== "SUPER_ADMIN" && t.assignedRoles && t.assignedRoles.length > 0) {
      if (!t.assignedRoles.includes(userRole)) return false;
    }
    
    return true;
  });
  
  const candidate = validTasks[0]; // Take first valid task
  if (!candidate) return;

  // Resolve the target tab and its permission grant BEFORE claiming. Claiming takes a lease that
  // blocks every other connected agent from the step for minutes, so it must not be taken for a
  // task this browser was never going to be able to run.
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!activeTab?.id || !activeTab.url) return;
  const origin = new URL(activeTab.url).origin;
  if (!(await hasHostPermission(origin))) return;

  // Claim it. Exactly one agent wins; anyone else gets a 409 and simply waits for the next tick.
  // This is what replaced "every agent in the tenant sees the same pending task and all of them
  // act on it" -- previously two open browsers performed the same click and the loser only found
  // out when its result was rejected, after the side effect had already happened twice.
  const selector = typeof candidate.input?.selector === "string" ? (candidate.input.selector as string) : undefined;
  let claim: TaskClaim;
  try {
    const claimResponse = await fetch(`${apiBase}/agent/tasks/${candidate.id}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-AmazFlow-Agent-Token": agentToken },
    });
    const claimBody = await claimResponse.json();
    if (!claimResponse.ok) throw new Error(claimBody.error || `Claim failed (${claimResponse.status})`);
    claim = claimBody as TaskClaim;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A lost race is the normal, uninteresting case and shouldn't fill the operator's activity
    // list; anything else is worth showing, because it means this agent can't take work at all.
    if (!/already/i.test(message)) {
      await logActivity({ at: new Date().toISOString(), operation: candidate.operation, selector, ok: false, detail: `Couldn't claim the task -- ${message}` });
    }
    return;
  }

  const task = claim.task || candidate;
  const grant = claim.grant;

  await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ["content.js"] }).catch(() => undefined);
  const response = await chrome.tabs.sendMessage(activeTab.id, { type: "AMAZFLOW_TASK", task }).catch((error) => ({ ok: false, error: String(error) }));

  // Always report back, success or failure -- the run needs to know either way (it either
  // advances or routes to the step's onFailure/FAILED), rather than silently expiring the task
  // with no evidence of what happened.
  const evidence = { url: activeTab.url, title: activeTab.title || null, origin, observedAt: new Date().toISOString() };
  const result = response?.ok
    ? { ok: true, ...response.result, evidence }
    : { ok: false, error: response?.error || "Unknown error", evidence };

  // Write the evidence note into the run's own audit trail before submitting the terminal
  // result. It is the same Gateway-mediated record_step_result tool the managed executor uses,
  // authorized by the same grant, and it is deliberately separate from the result submission:
  // if reporting the result then fails, the run still carries a durable record of what this
  // browser did and on which page, instead of the step looking like it never ran.
  await fetch(`${apiBase}/agent/tools/record-step-result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant,
      stepId: claim.stepId,
      status: result.ok ? "SUCCEEDED" : "FAILED",
      note: `${task.operation}${selector ? ` on ${selector}` : ""} at ${evidence.url}${result.ok ? "" : ` -- ${String(result.error)}`}`,
    }),
  }).catch(() => undefined);

  // Report back to the control plane before logging anything locally as "Completed" -- the
  // browser action can succeed while this call still fails (network blip, the task already
  // expired server-side, or the claim lease ran out), and the operator's activity log should
  // reflect whether the run actually resumed, not just whether the DOM action worked. A
  // rejected/expired result won't succeed on retry, so only network failures get retried.
  let reported = false;
  let reportError: string | undefined;
  for (let attempt = 0; attempt < 3 && !reported; attempt++) {
    try {
      const res = await fetch(`${apiBase}/agent/tasks/${task.id}/result`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-AmazFlow-Agent-Token": agentToken, "X-AmazFlow-Execution-Grant": grant },
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

  await logActivity({
    at: new Date().toISOString(),
    operation: task.operation,
    selector,
    ok: Boolean(result.ok) && reported,
    detail: !result.ok ? String(result.error || "Failed") : reported ? "Completed" : `Ran, but AmazFlow didn't record it -- ${reportError}`,
  });
});
