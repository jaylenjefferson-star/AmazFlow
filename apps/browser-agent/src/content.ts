type Task = { operation:string; input:Record<string,unknown> };
const one = (selector: unknown) => {
  if(typeof selector!=="string") throw new Error("A scoped selector is required");
  const nodes=document.querySelectorAll(selector);
  if(nodes.length!==1) throw new Error(`Expected one authorized target, found ${nodes.length}`);
  return nodes[0] as HTMLElement;
};
chrome.runtime.onMessage.addListener((message,_sender,sendResponse) => {
  if(message?.type!=="AMAZFLOW_TASK") return;
  execute(message.task as Task).then(result=>sendResponse({ok:true,result})).catch(error=>sendResponse({ok:false,error:String(error)}));
  return true;
});
async function execute(task:Task):Promise<Record<string,unknown>> {
  const {operation,input}=task;
  if(operation==="READ_TEXT") return {text:one(input.selector).innerText};
  if(operation==="CLICK"){one(input.selector).click();return {clicked:true};}
  if(operation==="TYPE"){const el=one(input.selector) as HTMLInputElement;el.focus();el.value=String(input.value??"");el.dispatchEvent(new Event("input",{bubbles:true}));return {typed:true};}
  if(operation==="SELECT"){const el=one(input.selector) as HTMLSelectElement;el.value=String(input.value);el.dispatchEvent(new Event("change",{bubbles:true}));return {selected:el.value};}
  if(operation==="VERIFY_TEXT"){const actual=one(input.selector).innerText.trim();return {verified:actual===String(input.expected),actual};}
  if(operation==="SET_EMPLOYEE_STATUS"){const selector=String(input.selector??'[data-amazflow="employee-status"]');const el=one(selector) as HTMLInputElement;el.value=String(input.status);el.dispatchEvent(new Event("change",{bubbles:true}));return {status:el.value};}
  throw new Error(`Operation ${operation} is not supported in this agent build`);
}
