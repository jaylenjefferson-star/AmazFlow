type AgentTask = { id:string; operation:string; input:Record<string,unknown>; expiresAt:string };
const API = "http://localhost:4000";
const allowed = new Set(["READ_TEXT","CLICK","TYPE","SELECT","VERIFY_TEXT","SET_EMPLOYEE_STATUS"]);

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("amazflow-poll",{periodInMinutes:0.25}));
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== "amazflow-poll") return;
  const tasks = await fetch(`${API}/agent-tasks`).then(r=>r.json()) as AgentTask[];
  const task = tasks.find(t => new Date(t.expiresAt).getTime() > Date.now() && allowed.has(t.operation));
  if (!task) return;
  const [activeTab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
  if (!activeTab?.id) return;
  const response = await chrome.tabs.sendMessage(activeTab.id,{type:"AMAZFLOW_TASK",task}).catch(error=>({ok:false,error:String(error)}));
  if (response?.ok) await fetch(`${API}/agent-tasks/${task.id}/result`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(response.result)});
});
