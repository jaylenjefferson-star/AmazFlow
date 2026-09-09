// A view onto the service worker, never the owner of the connection. Everything shown here is
// read from chrome.storage, which the worker keeps current whether or not this popup is open.
type Status = {
  state: "signed_out" | "connected" | "working" | "error";
  detail?: string;
  lastHeartbeatAt?: string | null;
  lastResult?: { at: string; operation: string; ok: boolean; detail: string; workflowName?: string | null; stepName?: string | null } | null;
};
type Session = { email: string; role: string; tenantId: string };
type AgentRecord = { id: string; name: string; tenantId: string };
// Deliberately nothing about tasks, leases or grants. This is what a person is shown while the
// agent works, and none of that vocabulary belongs in front of them.
type CurrentActivity = { workflowName: string; stepName: string; stepNumber: number | null; stepCount: number | null; where: string | null };
type RunnableWorkflow = { id: string; name: string; summary: string };

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");

const STATE_COPY: Record<Status["state"], { text: string; cls: string }> = {
  signed_out: { text: "Not connected", cls: "off" },
  connected: { text: "Ready", cls: "ok" },
  working: { text: "Working", cls: "work" },
  error: { text: "Needs attention", cls: "bad" },
};

async function render() {
  el<HTMLElement>("version").textContent = `v${chrome.runtime.getManifest().version}`;
  const { session, agent, status, currentActivity } = (await chrome.storage.local.get(["session", "agent", "status", "currentActivity"])) as {
    session?: Session; agent?: AgentRecord; status?: Status; currentActivity?: CurrentActivity;
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

  // What the agent is doing, in the words the person who started it would use.
  const taskCard = el<HTMLElement>("taskCard");
  if (currentActivity) {
    const progress = currentActivity.stepNumber && currentActivity.stepCount
      ? `Step ${currentActivity.stepNumber} of ${currentActivity.stepCount}`
      : "";
    taskCard.style.display = "block";
    taskCard.innerHTML = `<div class="op">${escapeHtml(currentActivity.workflowName)}</div>
      <div class="meta">${escapeHtml(currentActivity.stepName)}${progress ? ` · ${progress}` : ""}</div>
      ${currentActivity.where ? `<div class="meta">on ${escapeHtml(currentActivity.where)}</div>` : ""}`;
  } else {
    taskCard.style.display = "none";
  }

  const resultCard = el<HTMLElement>("resultCard");
  const last = status?.lastResult;
  if (last) {
    resultCard.style.display = "block";
    resultCard.className = `result ${last.ok ? "good" : "bad"}`;
    // Falls back to the raw action only for entries an older build recorded.
    const title = last.workflowName ?? last.operation;
    const detail = last.ok ? (last.stepName ?? "Completed") : last.detail;
    resultCard.innerHTML = `<b>${last.ok ? "✓" : "✕"} ${escapeHtml(title)}</b> · ${clock(last.at)}<div class="meta">${escapeHtml(detail)}</div>`;
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

// --- Entry point: start a workflow from here instead of the web app -----------------------
async function loadWorkflows() {
  const list = el<HTMLElement>("workflowList");
  list.innerHTML = `<p class="empty">Loading your workflows…</p>`;
  const response = await chrome.runtime.sendMessage({ type: "AMAZFLOW_WORKFLOWS" });
  if (!response?.ok) {
    list.innerHTML = `<p class="empty">${escapeHtml(response?.error ?? "Couldn’t load your workflows.")}</p>`;
    return;
  }
  const workflows = response.workflows as RunnableWorkflow[];
  if (!workflows.length) {
    list.innerHTML = `<p class="empty">No workflows are assigned to you yet.</p>`;
    return;
  }
  list.innerHTML = workflows
    .map((w) => `<button class="wf-start" data-id="${escapeHtml(w.id)}"><b>${escapeHtml(w.name)}</b>${w.summary ? `<small>${escapeHtml(w.summary)}</small>` : ""}</button>`)
    .join("");
  for (const button of Array.from(list.querySelectorAll<HTMLButtonElement>(".wf-start"))) {
    button.addEventListener("click", async () => {
      const original = button.innerHTML;
      const banner = el<HTMLElement>("startError");
      button.disabled = true;
      button.innerHTML = "<b>Starting…</b>";
      const started = await chrome.runtime.sendMessage({ type: "AMAZFLOW_START", workflowId: button.dataset.id });
      button.disabled = false;
      if (!started?.ok) {
        button.innerHTML = original;
        // Preflight already translated "which agent is missing" into something actionable.
        banner.textContent = started?.error ?? "Couldn’t start that workflow.";
        banner.style.display = "block";
        return;
      }
      banner.style.display = "none";
      button.innerHTML = "<b>Started ✓</b>";
      setTimeout(() => { button.innerHTML = original; }, 2500);
    });
  }
}

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
void loadWorkflows();
