import { contextBridge, ipcRenderer } from "electron";

// The renderer gets a narrow, named surface and no Node access at all: it can ask the agent to do
// the handful of things the UI offers, and nothing else.
contextBridge.exposeInMainWorld("amazflow", {
  state: () => ipcRenderer.invoke("agent:state"),
  connect: (email: string, password: string, tenantId?: string) => ipcRenderer.invoke("agent:connect", email, password, tenantId),
  disconnect: () => ipcRenderer.invoke("agent:disconnect"),
  workflows: () => ipcRenderer.invoke("agent:workflows"),
  start: (workflowId: string) => ipcRenderer.invoke("agent:start", workflowId),
  reconnect: () => ipcRenderer.invoke("agent:reconnect"),
  toggle: (running: boolean) => ipcRenderer.invoke("agent:toggle", running),
  openPermission: (which: "accessibility" | "screen") => ipcRenderer.invoke("agent:openPermission", which),
  onState: (handler: (snapshot: unknown) => void) => ipcRenderer.on("agent:state", (_e, snapshot) => handler(snapshot)),
});
