type AgentTask = { id: string; operation: string; input: Record<string, unknown>; expiresAt: string };

const DEFAULT_API = "https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com";
const allowed = new Set(["READ_TEXT", "CLICK", "TYPE", "SELECT", "VERIFY_TEXT", "SET_EMPLOYEE_STATUS"]);

async function getConfig() {
  const stored = await chrome.storage.local.get(["apiBase", "token"]);
  return { apiBase: (stored.apiBase as string) || DEFAULT_API, token: (stored.token as string) || "" };
}

async function hasHostPermission(origin: string) {
  return chrome.permissions.contains({ origins: [`${origin}/*`] });
}

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("amazflow-poll", { periodInMinutes: 0.25 }));

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "amazflow-poll") return;
  const { apiBase, token } = await getConfig();
  if (!token) return;

  const tasks = await fetch(`${apiBase}/agent-tasks`, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => (r.ok ? (r.json() as Promise<AgentTask[]>) : []))
    .catch(() => [] as AgentTask[]);
  const task = tasks.find((t) => new Date(t.expiresAt).getTime() > Date.now() && allowed.has(t.operation));
  if (!task) return;

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!activeTab?.id || !activeTab.url) return;
  const origin = new URL(activeTab.url).origin;
  if (!(await hasHostPermission(origin))) return;

  await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ["content.js"] }).catch(() => undefined);
  const response = await chrome.tabs.sendMessage(activeTab.id, { type: "AMAZFLOW_TASK", task }).catch((error) => ({ ok: false, error: String(error) }));
  if (response?.ok) {
    await fetch(`${apiBase}/agent-tasks/${task.id}/result`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(response.result),
    });
  }
});
