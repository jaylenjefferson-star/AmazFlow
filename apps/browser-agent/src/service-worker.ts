type AgentTask = { id: string; operation: string; input: Record<string, unknown>; expiresAt: string; tenantId?: string; workflowId?: string; assignedRoles?: string[]; createdBy?: string };

const DEFAULT_API = "https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com";
const allowed = new Set(["READ_TEXT", "CLICK", "TYPE", "SELECT", "CHECK", "SCROLL_TO", "WAIT_FOR", "VERIFY_TEXT", "SET_EMPLOYEE_STATUS"]);

async function getConfig() {
  const stored = await chrome.storage.local.get(["apiBase", "agentToken"]);
  return { apiBase: (stored.apiBase as string) || DEFAULT_API, agentToken: (stored.agentToken as string) || "" };
}

async function hasHostPermission(origin: string) {
  return chrome.permissions.contains({ origins: [`${origin}/*`] });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("amazflow-poll", { periodInMinutes: 0.25 });
  chrome.alarms.create("amazflow-heartbeat", { periodInMinutes: 2 });
});

// Completes the "Connect to AmazFlow" flow started from the popup: watches the specific tab it
// opened (not every tab, to avoid ever matching on an unrelated page) for the ?code=... the
// /agent-authorize page pushes into its own URL via history.replaceState once a human approves,
// then exchanges that one-time code server-side for an agent-scoped credential. The popup never
// handles the human's Cognito session at all.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  const { pendingConnectTabId } = await chrome.storage.local.get(["pendingConnectTabId"]);
  if (!pendingConnectTabId || tabId !== pendingConnectTabId || !changeInfo.url) return;
  let code: string | null = null;
  try {
    code = new URL(changeInfo.url).searchParams.get("code");
  } catch {
    return;
  }
  if (!code) return;

  await chrome.storage.local.remove(["pendingConnectTabId"]);
  const { apiBase } = await getConfig();
  try {
    const response = await fetch(`${apiBase}/agent-authorizations/${encodeURIComponent(code)}/exchange`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Exchange failed");
    await chrome.storage.local.set({ 
      agentToken: body.token, 
      agentId: body.agentId, 
      tenantId: body.tenantId,
      userId: body.userId,
      userRole: body.userRole
    });
  } catch (error) {
    console.error("AmazFlow agent connect failed", error);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "amazflow-heartbeat") {
    const { apiBase, agentToken } = await getConfig();
    if (!agentToken) return;
    await fetch(`${apiBase}/agent/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-AmazFlow-Agent-Token": agentToken },
      body: JSON.stringify({ version: chrome.runtime.getManifest().version }),
    }).catch(() => undefined);
    return;
  }

  if (alarm.name !== "amazflow-poll") return;
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
  
  const task = validTasks[0]; // Take first valid task
  if (!task) return;

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!activeTab?.id || !activeTab.url) return;
  const origin = new URL(activeTab.url).origin;
  if (!(await hasHostPermission(origin))) return;

  await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ["content.js"] }).catch(() => undefined);
  const response = await chrome.tabs.sendMessage(activeTab.id, { type: "AMAZFLOW_TASK", task }).catch((error) => ({ ok: false, error: String(error) }));

  // Always report back, success or failure -- the run needs to know either way (it either
  // advances or routes to the step's onFailure/FAILED), rather than silently expiring the task
  // with no evidence of what happened.
  const result = response?.ok ? { ok: true, ...response.result } : { ok: false, error: response?.error || "Unknown error" };
  await fetch(`${apiBase}/agent/tasks/${task.id}/result`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-AmazFlow-Agent-Token": agentToken },
    body: JSON.stringify(result),
  }).catch(() => undefined);
});
