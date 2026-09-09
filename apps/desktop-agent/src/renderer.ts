type Snapshot = {
  email: string | null; organization: string | null; agentName: string | null; agentId: string | null;
  version: string; running: boolean;
  status: {
    state: string; detail?: string; lastHeartbeatAt: string | null;
    permissions: { accessibility: boolean; screenRecording: boolean } | null;
    currentTask: { action: string; stepId: string; runId: string; destination: string | null; claimExpiresAt: string } | null;
    lastResult: { at: string; action: string; ok: boolean; detail: string } | null;
  };
};
type AmazFlowBridge = {
  state(): Promise<Snapshot>;
  connect(email: string, password: string, tenantId?: string): Promise<{ ok: boolean; error?: string }>;
  disconnect(): Promise<unknown>;
  reconnect(): Promise<{ ok: boolean; error?: string }>;
  toggle(running: boolean): Promise<unknown>;
  openPermission(which: "accessibility" | "screen"): Promise<unknown>;
  onState(handler: (snapshot: Snapshot) => void): void;
};
declare global {
  interface Window { amazflow: AmazFlowBridge }
}
export {};

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");

const COPY: Record<string, { text: string; cls: string }> = {
  signed_out: { text: "Not connected", cls: "off" },
  connected: { text: "Connected · watching for work", cls: "ok" },
  working: { text: "Running a workflow step", cls: "work" },
  paused: { text: "Stopped", cls: "off" },
  error: { text: "Needs attention", cls: "bad" },
};

let latest: Snapshot | null = null;

function render(snapshot: Snapshot) {
  latest = snapshot;
  el("version").textContent = `v${snapshot.version} · macOS`;
  const connected = Boolean(snapshot.email && snapshot.agentId);
  el("signedOut").style.display = connected ? "none" : "block";
  el("signedIn").style.display = connected ? "block" : "none";
  if (!connected) return;

  const copy = COPY[snapshot.status.state] ?? COPY.connected;
  el("stateLine").className = `state ${copy.cls}`;
  el("stateText").textContent = copy.text;
  el("stateDetail").textContent = snapshot.status.detail ?? "";
  el("userLabel").textContent = snapshot.email ?? "";
  el("orgLabel").textContent = snapshot.organization ?? "";
  el("agentLabel").textContent = snapshot.agentName ?? "";
  el("heartbeatLabel").textContent = clock(snapshot.status.lastHeartbeatAt);
  el<HTMLButtonElement>("reconnect").style.display = snapshot.status.state === "error" ? "block" : "none";
  el<HTMLButtonElement>("toggle").textContent = snapshot.running ? "Stop agent" : "Start agent";

  const perms = snapshot.status.permissions;
  const ax = el("axState"), sc = el("scState");
  ax.className = perms?.accessibility ? "granted" : "denied";
  ax.textContent = perms?.accessibility ? "Granted" : "Not granted";
  el<HTMLButtonElement>("axFix").style.display = perms?.accessibility ? "none" : "inline-block";
  sc.className = perms?.screenRecording ? "granted" : "denied";
  sc.textContent = perms?.screenRecording ? "Granted" : "Not granted";
  el<HTMLButtonElement>("scFix").style.display = perms?.screenRecording ? "none" : "inline-block";

  const task = snapshot.status.currentTask;
  const card = el("taskCard");
  if (task && new Date(task.claimExpiresAt).getTime() > Date.now()) {
    const left = Math.max(0, Math.round((new Date(task.claimExpiresAt).getTime() - Date.now()) / 1000));
    card.style.display = "block";
    card.innerHTML = `<b>${esc(task.action)}</b>
      <div class="meta">Step ${esc(task.stepId)} · run ${esc(task.runId)}</div>
      ${task.destination ? `<div class="meta">Authorized for ${esc(task.destination)}</div>` : ""}
      <div class="meta">Lease held by this Mac · ${left}s left</div>`;
  } else card.style.display = "none";

  const last = snapshot.status.lastResult;
  const result = el("resultCard");
  if (last) {
    result.style.display = "block";
    result.className = `result ${last.ok ? "good" : "bad"}`;
    result.innerHTML = `<b>${last.ok ? "✓" : "✕"} ${esc(last.action)}</b> · ${clock(last.at)}<div class="meta">${esc(last.detail)}</div>`;
  } else result.style.display = "none";
}

window.amazflow.onState(render);
void window.amazflow.state().then(render);
setInterval(() => { if (latest) render(latest); }, 1000);

el("connect").addEventListener("click", async () => {
  const button = el<HTMLButtonElement>("connect");
  const banner = el("signInError");
  const email = el<HTMLInputElement>("email").value.trim();
  const password = el<HTMLInputElement>("password").value;
  if (!email || !password) { banner.textContent = "Enter your AmazFlow email and password."; banner.style.display = "block"; return; }
  button.disabled = true; button.textContent = "Connecting…"; banner.style.display = "none";
  const tenant = el<HTMLInputElement>("tenant").value.trim();
  const response = await window.amazflow.connect(email, password, tenant || undefined);
  // The password existed only in this field and the one IPC call; clear it either way.
  el<HTMLInputElement>("password").value = "";
  button.disabled = false; button.textContent = "Connect this Mac";
  if (!response.ok) { banner.textContent = response.error ?? "Could not connect."; banner.style.display = "block"; return; }
  render(await window.amazflow.state());
});

el("disconnect").addEventListener("click", async () => { await window.amazflow.disconnect(); render(await window.amazflow.state()); });
el("reconnect").addEventListener("click", async () => { await window.amazflow.reconnect(); render(await window.amazflow.state()); });
el("toggle").addEventListener("click", async () => { await window.amazflow.toggle(!latest?.running); render(await window.amazflow.state()); });
el("axFix").addEventListener("click", () => void window.amazflow.openPermission("accessibility"));
el("scFix").addEventListener("click", () => void window.amazflow.openPermission("screen"));
el("email").addEventListener("blur", () => {
  el("orgWrap").style.display = /@amazflow\.com$/i.test(el<HTMLInputElement>("email").value.trim()) ? "block" : "none";
});
