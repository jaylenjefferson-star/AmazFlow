const POPUP_DEFAULT_API = "https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com";
const CONNECT_URL = "https://amazflow.com/agent-authorize/";

type PopupActivityEntry = { at: string; operation: string; selector?: string; ok: boolean; detail: string };

function el<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] as string);
}

function renderActivity(log: PopupActivityEntry[]) {
  const container = el<HTMLElement>("activityLog");
  if (!log.length) {
    container.innerHTML = `<p class="activity-empty">Nothing yet -- this fills in as soon as a workflow step runs on a tab you've enabled.</p>`;
    return;
  }
  container.innerHTML = log
    .slice(0, 8)
    .map((entry) => {
      const time = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const selectorLine = entry.selector ? `<div class="sel">${escapeHtml(entry.selector)}</div>` : "";
      return `<div class="activity-row ${entry.ok ? "activity-ok" : "activity-fail"}">
        <div class="op"><b>${entry.ok ? "✓" : "✕"} ${escapeHtml(entry.operation)}</b><span>${time}</span></div>
        ${selectorLine}
        <div class="detail">${escapeHtml(entry.detail)}</div>
      </div>`;
    })
    .join("");
}

async function currentTabOrigin(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url) return null;
  try { return new URL(tab.url).origin; } catch { return null; }
}

async function refreshStatus() {
  const { agentToken, agentName, tenantId, lastConnectionError } = await chrome.storage.local.get(["agentToken", "agentName", "tenantId", "lastConnectionError"]);
  const connected = Boolean(agentToken);

  el<HTMLElement>("disconnectedView").style.display = connected ? "none" : "block";
  el<HTMLElement>("connectedView").style.display = connected ? "block" : "none";

  const connectError = el<HTMLElement>("connectError");
  connectError.textContent = typeof lastConnectionError === "string" ? lastConnectionError : "";
  connectError.style.display = lastConnectionError ? "block" : "none";
  if (!connected) return;

  el<HTMLElement>("agentNameLabel").textContent = (agentName as string) || "Browser Agent";
  el<HTMLElement>("agentTenantLabel").textContent = `Connected · ${tenantId || "unknown org"}`;

  const origin = await currentTabOrigin();
  const siteStatus = el<HTMLElement>("siteStatus");
  const siteButton = el<HTMLButtonElement>("enableSite");
  if (!origin) {
    siteStatus.textContent = "Open a target tab to enable this site.";
    siteButton.disabled = true;
    return;
  }
  const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] });
  siteStatus.textContent = granted ? `Enabled on ${origin}` : `Not enabled on ${origin}`;
  siteButton.disabled = granted;
  siteButton.textContent = granted ? "Enabled" : `Enable on ${origin}`;

  const { activityLog } = await chrome.storage.local.get(["activityLog"]);
  renderActivity(Array.isArray(activityLog) ? (activityLog as PopupActivityEntry[]) : []);
}

// Live-updates the log while the popup is open and a poll happens to land mid-view, instead of
// only reflecting whatever the log looked like at the moment the popup was opened.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.activityLog) refreshStatus();
});

el<HTMLButtonElement>("connect").addEventListener("click", async () => {
  const { apiBase } = await chrome.storage.local.get(["apiBase"]);
  if (!apiBase) await chrome.storage.local.set({ apiBase: POPUP_DEFAULT_API });
  const tab = await chrome.tabs.create({ url: CONNECT_URL });
  if (tab.id) await chrome.storage.local.set({ pendingConnectTabId: tab.id });
  window.close();
});

el<HTMLButtonElement>("disconnect").addEventListener("click", async () => {
  await chrome.storage.local.remove(["agentToken", "agentId", "agentName", "tenantId", "lastConnectionError", "userId", "userRole"]);
  await refreshStatus();
});

el<HTMLButtonElement>("enableSite").addEventListener("click", async () => {
  const origin = await currentTabOrigin();
  if (!origin) return;
  await chrome.permissions.request({ origins: [`${origin}/*`] });
  await refreshStatus();
});

refreshStatus();
