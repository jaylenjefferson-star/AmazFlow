type Task = { operation:string; input:Record<string,unknown> };

// Visible proof the agent is acting on the record it says it is, for whoever is watching the tab
// -- an outline drawn over the real target rather than any style/class change on the page's own
// element, so it can never collide with the host page's CSS or get read back by a later step.
function flashHighlight(el: HTMLElement) {
  try {
    const rect = el.getBoundingClientRect();
    const box = document.createElement("div");
    box.style.cssText = `position:fixed;left:${rect.left - 3}px;top:${rect.top - 3}px;width:${rect.width + 6}px;height:${rect.height + 6}px;border:3px solid #ff5c3d;border-radius:6px;background:rgba(255,92,61,.12);z-index:2147483647;pointer-events:none;transition:opacity .35s ease;box-sizing:border-box`;
    document.documentElement.appendChild(box);
    setTimeout(() => { box.style.opacity = "0"; }, 550);
    setTimeout(() => box.remove(), 900);
  } catch {
    // Cosmetic only -- never let a highlight failure block the actual automation.
  }
}
const one = (selector: unknown) => {
  if(typeof selector!=="string") throw new Error("A scoped selector is required");
  const nodes=document.querySelectorAll(selector);
  if(nodes.length!==1) throw new Error(`Expected one authorized target, found ${nodes.length}`);
  const el = nodes[0] as HTMLElement;
  flashHighlight(el);
  return el;
};
// Strong-identifier check: before touching a real record, re-reads whatever field the page uses
// to display which record is currently selected and refuses to act if it doesn't match what the
// workflow expects -- catches both a wrong-record mixup and a stale page (the operator navigated
// to a different record after the run started, before this step actually got to run).
function assertTarget(input: Record<string, unknown>) {
  const identifierSelector = input.identifierSelector != null ? String(input.identifierSelector) : null;
  const expectedIdentifier = input.expectedIdentifier != null ? String(input.expectedIdentifier).trim() : "";
  if (!identifierSelector || !expectedIdentifier) return; // no identifier configured for this step -- nothing to check
  const el = one(identifierSelector);
  const actual = (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
      ? el.value
      : el.innerText
  ).toString().trim();
  if (actual !== expectedIdentifier) {
    throw new Error(`Target mismatch: expected record "${expectedIdentifier}" but the page shows "${actual}" -- refusing to act on the wrong record.`);
  }
}
function waitFor(selector: string, timeoutMs: number): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const found = document.querySelector(selector);
    if (found) return resolve(found as HTMLElement);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el as HTMLElement); }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    setTimeout(() => { observer.disconnect(); reject(new Error(`Timed out waiting for "${selector}"`)); }, timeoutMs);
  });
}
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
  if(operation==="CHECK"){const el=one(input.selector) as HTMLInputElement;el.checked=Boolean(input.checked??true);el.dispatchEvent(new Event("change",{bubbles:true}));return {checked:el.checked};}
  if(operation==="SCROLL_TO"){
    const el=one(input.selector);
    el.scrollIntoView({block:"center"});
    // The highlight one() already drew was positioned before the scroll -- redraw it once the
    // element has actually settled at its new on-screen position.
    setTimeout(()=>flashHighlight(el),300);
    return {scrolled:true};
  }
  if(operation==="WAIT_FOR"){await waitFor(String(input.selector),Number(input.timeoutMs)||5000);return {appeared:true};}
  if(operation==="VERIFY_TEXT"){const actual=one(input.selector).innerText.trim();return {verified:actual===String(input.expected),actual};}
  if(operation==="SET_EMPLOYEE_STATUS"){
    assertTarget(input);
    const selector=String(input.selector??'[data-amazflow="employee-status"]');
    const el=one(selector) as HTMLInputElement;
    el.value=String(input.status);
    el.dispatchEvent(new Event("change",{bubbles:true}));
    // Re-observes the field immediately after writing it, rather than assuming the write
    // succeeded -- this is what the workflow's own verify step actually checks downstream.
    return {status:el.value};
  }
  throw new Error(`Operation ${operation} is not supported in this agent build`);
}
