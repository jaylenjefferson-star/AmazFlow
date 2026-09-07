const DEFAULT_API = "https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com";

function el<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }

async function currentTabOrigin(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url) return null;
  try { return new URL(tab.url).origin; } catch { return null; }
}

async function refreshStatus() {
  const { apiBase, token } = await chrome.storage.local.get(["apiBase", "token"]);
  el<HTMLInputElement>("apiBase").value = (apiBase as string) || DEFAULT_API;
  el<HTMLInputElement>("token").value = (token as string) || "";
  el<HTMLElement>("tokenStatus").textContent = token ? "Token saved" : "No token saved yet";

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
}

el<HTMLButtonElement>("save").addEventListener("click", async () => {
  const apiBase = el<HTMLInputElement>("apiBase").value.trim() || DEFAULT_API;
  const token = el<HTMLInputElement>("token").value.trim();
  await chrome.storage.local.set({ apiBase, token });
  await refreshStatus();
});

el<HTMLButtonElement>("enableSite").addEventListener("click", async () => {
  const origin = await currentTabOrigin();
  if (!origin) return;
  await chrome.permissions.request({ origins: [`${origin}/*`] });
  await refreshStatus();
});

refreshStatus();
