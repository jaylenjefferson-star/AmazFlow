// A view onto the service worker, never the owner of the connection. Everything shown here is
// read from chrome.storage, which the worker keeps current whether or not this popup is open.
type Status = {
  state: "signed_out" | "connected" | "working" | "error";
  detail?: string;
  lastHeartbeatAt?: string | null;
  lastResult?: { at: string; operation: string; ok: boolean; detail: string } | null;
};
type Session = { email: string; role: string; tenantId: string };
type AgentRecord = { id: string; name: string; tenantId: string };
type CurrentTask = { operation: string; stepId: string; runId: string; selector?: string; claimExpiresAt: string; url?: string | null };

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");

const STATE_COPY: Record<Status["state"], { text: string; cls: string }> = {
  signed_out: { text: "Not connected", cls: "off" },
  connected: { text: "Connected · watching for work", cls: "ok" },
  working: { text: "Running a workflow step", cls: "work" },
  error: { text: "Needs attention", cls: "bad" },
};

async function render() {
  el<HTMLElement>("version").textContent = `v${chrome.runtime.getManifest().version}`;
  const { session, agent, status, currentTask } = (await chrome.storage.local.get(["session", "agent", "status", "currentTask"])) as {
    session?: Session; agent?: AgentRecord; status?: Status; currentTask?: CurrentTask;
  };
  const connected = Boolean(session && agent);
  el<HTMLElement>("signedOut").style.display = connected ? "none" : "block";
  el<HTMLElement>("signedIn").style.display = connected ? "block" : "none";

  if (!connected) {
    const detail = status?.detail;
    const banner = el<HTMLElement>("signInError");
    banner.textContent = detail ?? "";
    banner.style.display = detail ? "block" : "none";
    return;
  }

  const state = status?.state === "signed_out" ? "connected" : (status?.state ?? "connected");
  const copy = STATE_COPY[state];
  el<HTMLElement>("stateLine").className = `state ${copy.cls}`;
  el<HTMLElement>("stateText").textContent = copy.text;
  el<HTMLElement>("stateDetail").textContent = status?.detail ?? "";
  el<HTMLElement>("userLabel").textContent = session!.email;
  el<HTMLElement>("orgLabel").textContent = agent!.tenantId;
  el<HTMLElement>("agentLabel").textContent = agent!.name;
  el<HTMLElement>("heartbeatLabel").textContent = clock(status?.lastHeartbeatAt);
  el<HTMLButtonElement>("reconnect").style.display = state === "error" ? "block" : "none";

  const taskCard = el<HTMLElement>("taskCard");
  if (currentTask && new Date(currentTask.claimExpiresAt).getTime() > Date.now()) {
    const left = Math.max(0, Math.round((new Date(currentTask.claimExpiresAt).getTime() - Date.now()) / 1000));
    taskCard.style.display = "block";
    taskCard.innerHTML = `<div class="op">${escapeHtml(currentTask.operation)}</div>
      <div class="meta">Step ${escapeHtml(currentTask.stepId)} · run ${escapeHtml(currentTask.runId)}</div>
      ${currentTask.selector ? `<div class="meta">${escapeHtml(currentTask.selector)}</div>` : ""}
      ${currentTask.url ? `<div class="meta">${escapeHtml(currentTask.url)}</div>` : ""}
      <div class="meta">Lease held by this browser · ${left}s left</div>`;
  } else {
    taskCard.style.display = "none";
  }

  const resultCard = el<HTMLElement>("resultCard");
  const last = status?.lastResult;
  if (last) {
    resultCard.style.display = "block";
    resultCard.className = `result ${last.ok ? "good" : "bad"}`;
    resultCard.innerHTML = `<b>${last.ok ? "✓" : "✕"} ${escapeHtml(last.operation)}</b> · ${clock(last.at)}<div class="meta">${escapeHtml(last.detail)}</div>`;
  } else {
    resultCard.style.display = "none";
  }
}

chrome.storage.onChanged.addListener((_changes, area) => { if (area === "local") void render(); });
// The lease countdown is the one thing that changes with no storage write behind it.
setInterval(() => { void render(); }, 1000);

el<HTMLButtonElement>("connect").addEventListener("click", async () => {
  const button = el<HTMLButtonElement>("connect");
  const banner = el<HTMLElement>("signInError");
  const email = el<HTMLInputElement>("email").value.trim();
  const password = el<HTMLInputElement>("password").value;
  if (!email || !password) {
    banner.textContent = "Enter your AmazFlow email and password.";
    banner.style.display = "block";
    return;
  }
  button.disabled = true;
  button.textContent = "Connecting…";
  banner.style.display = "none";
  const tenant = el<HTMLInputElement>("tenant").value.trim();
  const response = await chrome.runtime.sendMessage({ type: "AMAZFLOW_CONNECT", email, password, tenantId: tenant || undefined });
  // The password only ever existed in this popup's memory and the message to the worker; drop it
  // as soon as the attempt resolves either way.
  el<HTMLInputElement>("password").value = "";
  button.disabled = false;
  button.textContent = "Connect this browser";
  if (!response?.ok) {
    banner.textContent = response?.error || "Could not connect. Try again.";
    banner.style.display = "block";
    return;
  }
  await render();
});

el<HTMLButtonElement>("disconnect").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "AMAZFLOW_DISCONNECT" });
  await render();
});

el<HTMLButtonElement>("reconnect").addEventListener("click", async () => {
  const button = el<HTMLButtonElement>("reconnect");
  button.disabled = true;
  button.textContent = "Reconnecting…";
  const response = await chrome.runtime.sendMessage({ type: "AMAZFLOW_RECONNECT" });
  button.disabled = false;
  button.textContent = "Reconnect this browser";
  if (!response?.ok) {
    const banner = el<HTMLElement>("stateDetail");
    banner.textContent = response?.error || "Could not reconnect.";
  }
  await render();
});

// A super admin can name the organization this browser should act for; everyone else is bound to
// the organization on their own account and never sees the field.
el<HTMLInputElement>("email").addEventListener("blur", () => {
  el<HTMLElement>("orgWrap").style.display = /@amazflow\.com$/i.test(el<HTMLInputElement>("email").value.trim()) ? "block" : "none";
});

void render();
