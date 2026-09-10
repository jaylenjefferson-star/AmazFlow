import test from "node:test";
import assert from "node:assert/strict";
import { DemoAiProvider, WorkflowEngine, type AgentTask, type Approval, type Store } from "./index.ts";
import { sampleDataEntryWorkflow, sampleWorkflow, type WorkflowDefinition, type WorkflowRun } from "@amazflow/workflow-schema";

test("a protected browser action confirms before it is offered to a connected agent", async () => {
  let run: WorkflowRun | undefined; let task: AgentTask | undefined;
  const store: Store = { getWorkflow: async()=>sampleWorkflow, saveRun: async v=>{run=v}, getRun: async()=>run, saveTask: async v=>{task=v}, saveApproval: async(_v:Approval)=>{}, saveConfirmation: async()=>{} };
  const engine = new WorkflowEngine(store, new DemoAiProvider());
  const waiting = await engine.start(sampleWorkflow, { employee: { id: "E-100" }, request: "DISABLE" });
  assert.equal(waiting.status, "AWAITING_CONFIRMATION");
  const result = await engine.resumeFromConfirmation(sampleWorkflow, waiting, "execute");
  assert.equal(result.status, "WAITING_AGENT");
  assert.equal(task?.operation, "SET_EMPLOYEE_STATUS");
});

const managedWorkflow: WorkflowDefinition = {
  ...sampleWorkflow,
  id: "managed-browser-test",
  startAt: "execute",
  steps: [
    { id: "execute", name: "Managed action", type: "action", provider: "browser", operation: "CLICK", input: {}, connectionId: "connection-1", browserMode: "auto", next: "done" },
    { id: "done", name: "Done", type: "end", outcome: "success" }
  ]
};

function testStore() {
  let run: WorkflowRun | undefined;
  let task: AgentTask | undefined;
  const store: Store = {
    getWorkflow: async () => managedWorkflow, saveRun: async (value) => { run = value; }, getRun: async () => run,
    saveTask: async (value) => { task = value; }, saveApproval: async () => {}, saveConfirmation: async () => {}
  };
  return { store, getTask: () => task };
}

test("managed browser falls back only before a side effect", async () => {
  const state = testStore();
  const engine = new WorkflowEngine(state.store, new DemoAiProvider(), { execute: async () => ({ status: "FALLBACK", error: "sign-in required", sideEffectObserved: false }) }, { issue: () => "grant" });
  const run = await engine.start(managedWorkflow, {});
  assert.equal(run.status, "WAITING_AGENT");
  assert.ok(state.getTask());
  assert.ok(run.audit.some((event) => event.type === "MANAGED_EXECUTION_FALLBACK"));
});

test("uncertain managed action stops for reconciliation without fallback", async () => {
  const state = testStore();
  const engine = new WorkflowEngine(state.store, new DemoAiProvider(), { execute: async () => ({ status: "FAILED", error: "response lost", sideEffectObserved: true }) }, { issue: () => "grant" });
  const run = await engine.start(managedWorkflow, {});
  assert.equal(run.status, "FAILED");
  assert.equal(state.getTask(), undefined);
  assert.ok(run.audit.some((event) => event.type === "ACTION_RECONCILIATION_REQUIRED"));
});

test("the data-entry fixture preserves its wait, verification, and completion transitions", async () => {
  let run: WorkflowRun | undefined;
  let task: AgentTask | undefined;
  const store: Store = {
    getWorkflow: async () => sampleDataEntryWorkflow,
    saveRun: async value => { run = structuredClone(value); },
    getRun: async () => run,
    saveTask: async value => { task = value; },
    saveApproval: async () => {}
  };
  const engine = new WorkflowEngine(store, new DemoAiProvider());
  const waiting = await engine.start(sampleDataEntryWorkflow, { invoice: "Acme, $45, today" });
  assert.equal(waiting.status, "WAITING_AGENT");
  assert.equal(task?.operation, "APPEND_ROW");
  const completed = await engine.resumeFromAgent(sampleDataEntryWorkflow, waiting, "append", { ok: true, status: "APPENDED" });
  assert.equal(completed.status, "COMPLETED");
  assert.deepEqual(completed.audit.slice(-4).map(event => event.type), ["STEP_STARTED", "VERIFIED", "STEP_STARTED", "COMPLETED"]);
});

test("cancellation is owned by the shared state machine", async () => {
  const state = testStore();
  const engine = new WorkflowEngine(state.store, new DemoAiProvider(), { execute: async () => ({ status: "FALLBACK", sideEffectObserved: false }) }, { issue: () => "grant" });
  const waiting = await engine.start(managedWorkflow, {});
  const cancelled = await engine.cancel(waiting, { userId: "operator", role: "CLIENT_ADMIN" });
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.currentStepId, undefined);
  assert.deepEqual(cancelled.audit.slice(-2).map(event => event.type), ["RUN_CANCEL_REQUESTED", "RUN_CANCELLED"]);
});

test("waiting work times out through the shared state machine", async () => {
  const state = testStore();
  const engine = new WorkflowEngine(state.store, new DemoAiProvider(), { execute: async () => ({ status: "FALLBACK", sideEffectObserved: false }) }, { issue: () => "grant" });
  const waiting = await engine.start(managedWorkflow, {});
  const timedOut = await engine.timeout(waiting);
  assert.equal(timedOut.status, "TIMED_OUT");
  assert.equal(timedOut.audit.at(-1)?.type, "RUN_TIMED_OUT");
});

test("an AI allowlist rejection routes to human review and never reaches an action", async () => {
  let saved: WorkflowRun | undefined;
  let task: AgentTask | undefined;
  const store: Store = {
    getWorkflow: async () => sampleWorkflow,
    saveRun: async (value) => { saved = structuredClone(value); },
    getRun: async () => saved,
    saveTask: async (value) => { task = value; },
    saveApproval: async () => {},
    saveConfirmation: async () => {},
  };
  const engine = new WorkflowEngine(store, {
    run: async () => { throw new Error("Managed AI returned a value outside the workflow allowlist"); },
  });

  const run = await engine.start(sampleWorkflow, { request: "Do something unsupported" });

  assert.equal(run.status, "WAITING_APPROVAL");
  assert.equal(run.currentStepId, "approval");
  assert.equal(saved?.status, "WAITING_APPROVAL");
  assert.equal(task, undefined, "no browser action may be queued");
  assert.ok(run.audit.some((event) => event.type === "AI_ALLOWLIST_REJECTED"));
  assert.equal((run.context.values as Record<string, { value: string }>).decision.value, "REVIEW");
});
