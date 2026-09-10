import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, safeStorage } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DesktopAgent, type Store } from "./agent.js";

const VERSION = app.getVersion();
let win: BrowserWindow | null = null;
let tray: Tray | null = null;

// Credentials live in a file that only this machine's login keychain can decrypt (Electron's
// safeStorage is Keychain-backed on macOS). The password is never part of what is written -- only
// the refresh token and the agent credential, which is what a restart needs to come back online.
const statePath = () => join(app.getPath("userData"), "agent-state.bin");

const store: Store = {
  async read() {
    try {
      const raw = await readFile(statePath());
      if (!safeStorage.isEncryptionAvailable()) return {};
      return JSON.parse(safeStorage.decryptString(raw));
    } catch {
      return {};
    }
  },
  async write(patch) {
    const current = await store.read();
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key];
      else if (value !== undefined) next[key] = value;
    }
    await mkdir(app.getPath("userData"), { recursive: true });
    if (!safeStorage.isEncryptionAvailable()) throw new Error("This Mac's keychain is unavailable, so AmazFlow can't store your session securely.");
    await writeFile(statePath(), safeStorage.encryptString(JSON.stringify(next)), { mode: 0o600 });
  },
};

const publish = () => {
  const snapshot = agent.snapshot();
  win?.webContents.send("agent:state", snapshot);
  if (tray) {
    const s = snapshot.status.state;
    tray.setToolTip(`AmazFlow Agent — ${s === "connected" ? "connected" : s === "working" ? "running a step" : s}`);
    tray.setContextMenu(buildTrayMenu(snapshot));
  }
};

const agent = new DesktopAgent(store, VERSION, publish);

function buildTrayMenu(snapshot: ReturnType<DesktopAgent["snapshot"]>) {
  return Menu.buildFromTemplate([
    { label: snapshot.email ? `${snapshot.email} · ${snapshot.organization ?? ""}` : "Not signed in", enabled: false },
    { label: `Status: ${snapshot.status.state}`, enabled: false },
    { type: "separator" },
    { label: "Open AmazFlow Agent", click: () => showWindow() },
    snapshot.running
      ? { label: "Stop agent", click: () => { agent.stop(); publish(); } }
      : { label: "Start agent", enabled: Boolean(snapshot.agentId), click: () => { agent.start(); publish(); } },
    { type: "separator" },
    { label: "Quit", click: () => { agent.stop(); app.exit(0); } },
  ]);
}

function showWindow() {
  if (win) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 420, height: 720, resizable: false, title: "AmazFlow Agent",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(join(__dirname, "renderer", "index.html"));
  win.on("closed", () => { win = null; });
  win.webContents.on("did-finish-load", publish);
}

// A 22x22 PNG, inlined so there is no icon asset to ship or keep in sync. It has to be a raster
// format: macOS nativeImage does not decode SVG, so createFromDataURL on an SVG returns an EMPTY
// image and `new Tray(empty)` throws. That threw inside app.whenReady before the window was ever
// created, leaving the process running with no window and no tray -- an app that looked like it
// had launched and then done nothing at all.
const TRAY_PNG = "iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAA00lEQVR4nN2UMQ7DIAxFfYIOEQdhyIGYWHOIXAL1DllYs7Fyl+ydWlv6kRAqKIqwVPVLbzH2jzEEon/WAwzRzCxMYDYQEJvvdifFiXkxmYkgI5aQc3kXkrgyB4w8YxkDLGIROetV8wUFT5i0ZJFzoKYrmVtCNz3T0jyipjtz+bLMz1fxiXFgqtY8arpdy4nnqlsx2pk32Ctzi5rQMpUDkOskWzNF3BWmJ65YN6jZqHGIasZESqMQqR2e2nUjUvpBRGq/9Gk+/BEqNfzZ/KahD/3v6QNNKFgNkj+aSgAAAABJRU5ErkJggg==";
function trayImage() {
  const image = nativeImage.createFromBuffer(Buffer.from(TRAY_PNG, "base64"));
  image.setTemplateImage(true);
  return image;
}

app.whenReady().then(async () => {
  app.setName("AmazFlow Agent");
  if (process.platform === "darwin") app.dock?.hide();
  // The window comes up first and unconditionally. Restoring the session probes macOS permissions,
  // and a denied permission does not fail fast -- it blocks on a TCC prompt until the timeout -- so
  // awaiting it here left the app invisible for seconds, with no dock icon to explain why.
  showWindow();
  // The tray is a convenience; if it cannot be created the app must still be usable.
  try {
    tray = new Tray(trayImage());
  } catch (error) {
    console.error("tray unavailable:", error instanceof Error ? error.message : error);
  }
  publish();
  try {
    await agent.restore();
  } catch (error) {
    console.error("restore failed:", error instanceof Error ? error.message : error);
  }
  publish();
});

// Closing the window is not quitting: polling, claiming and execution continue from the tray.
app.on("window-all-closed", (...args: unknown[]) => (args[0] as Event | undefined)?.preventDefault());
app.on("activate", () => showWindow());

ipcMain.handle("agent:state", () => agent.snapshot());
ipcMain.handle("agent:connect", async (_e, email: string, password: string, tenantId?: string) => {
  try { await agent.connect(email, password, tenantId); return { ok: true }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
});
ipcMain.handle("agent:disconnect", async () => { await agent.disconnect(); return { ok: true }; });
ipcMain.handle("agent:workflows", async () => {
  try { return { ok: true, workflows: await agent.workflows() }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
});
ipcMain.handle("agent:start", async (_e, workflowId: string) => {
  try { await agent.startWorkflow(workflowId); return { ok: true }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
});
ipcMain.handle("agent:reconnect", async () => {
  try { await agent.reconnect(); return { ok: true }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
});
ipcMain.handle("agent:toggle", async (_e, running: boolean) => { if (running) agent.start(); else agent.stop(); publish(); return { ok: true }; });
// Deep links straight to the exact panes a person needs; a missing permission should be one click
// from being fixed, not a paragraph of instructions.
ipcMain.handle("agent:openPermission", async (_e, which: "accessibility" | "screen") => {
  const pane = which === "accessibility"
    ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    : "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
  await shell.openExternal(pane);
  return { ok: true };
});
