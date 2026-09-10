// Guardrail 2.1 (engine side) -- the shared state machine's resume paths.
//
// guardrail-state-machine.test.cjs pins these through the deployed control plane. This pins the same
// guarantees in the shared engine, which is the copy a future stack deploys. Both are needed: the
// convergence work in Phase 0b moves behaviour between the two, and a guarantee proven in only one
// of them is a guarantee that can be lost in transit.
//
// _Requirements: 31.1, 31.18_
import test from "node:test";
import assert from "node:assert/strict";
import { DemoAiProvider, WorkflowEngine, type AgentTask, type Approval, type Confirmation, type Store } from "./index.ts";
import { type WorkflowDefinition, type WorkflowRun } from "@amazflow/workflow-schema";

// One workflow carrying an approval, a confirmation-gated action, and a verified agent action, so
// every resume path has a real step to resume on.
const workflow: WorkflowDefinition = {
  id: "wf-resume-guardrail",
  tenantId: "guard",
  name: "Resume guardrail",
  version: 1,
  status: "active",
  assignedRoles: ["CLIENT_ADMIN"],
  startAt: "approve",
  steps: [
    { id: "approve", name: "Approve", type: "approval", message: "Approve this", roles: ["CLIENT_ADMIN"], next: "gate", onReject: "rejected" },
    { id: "gate", name: "Gated action", type: "action", provider: "browser", operation: "CLICK", input: {}, requiresConfirmation: true, next: "act" },
    { id: "act", name: "Set status", type: "action", provider: "browser", operation: "SET_EMPLOYEE_STATUS", input: {}, verify: { path: "result.status", equals: "Inactive" }, next: "done" },
    { id: "done", name: "Done", type: "end", outcome: "success" },
    { id: "rejected", name: "Rejected", type: "end", outcome: "failure" },
  ],
} as WorkflowDefinition;

function harness() {
  let run: WorkflowRun | undefined;
  const tasks: AgentTask[] = [];
  const confirmations: Confirmation[] = [];
  const store: Store = {
    getWorkflow: async () => workflow,
    saveRun: async (value) => { run = structuredClone(value); },
    getRun: async () => run,
    saveTask: async (value) => { tasks.push(value); },
    saveApproval: async (_value: Approval) => {},
    saveConfirmation: async (value) => { confirmations.push(value); },
  };
  return { store, engine: new WorkflowEngine(store, new DemoAiProvider()), tasks, confirmations, saved: () => run };
}

/** A run forced into `status` at `stepId`, without going through the transitions that produce it. */
const parked = (status: WorkflowRun["status"], currentStepId: string | undefined, extra: Partial<WorkflowRun> = {}): WorkflowRun =>
  ({
    id: "run-guard",
    tenantId: "guard",
    workflowId: workflow.id,
    workflowVersion: 1,
    status,
    currentStepId,
    createdBy: "operator",
    confirmedStepIds: [],
    stepResults: {},
    context: { input: {}, values: {}, lastAction: null },
    audit: [{ id: "aud-1", at: new Date().toISOString(), type: "RUN_STARTED", message: "started", details: {} }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  }) as WorkflowRun;

const TERMINAL: WorkflowRun["status"][] = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"];
const NON_AGENT: WorkflowRun["status"][] = ["RUNNING", "WAITING_APPROVAL", "AWAITING_CONFIRMATION", ...TERMINAL];
const NON_APPROVAL: WorkflowRun["status"][] = ["RUNNING", "WAITING_AGENT", "AWAITING_CONFIRMATION", ...TERMINAL];
const NON_CONFIRMATION: WorkflowRun["status"][] = ["RUNNING", "WAITING_AGENT", "WAITING_APPROVAL", ...TERMINAL];

test("an agent result is refused unless the run is WAITING_AGENT on that step", async () => {
  for (const status of NON_AGENT) {
    const { engine } = harness();
    await assert.rejects(
      () => engine.resumeFromAgent(workflow, parked(status, "act"), "act", { ok: true, status: "Inactive" }),
      /not waiting for this agent result/i,
      `${status} must refuse an agent result`,
    );
  }
});

test("an agent result is refused when it names a step the run is not parked on", async () => {
  const { engine } = harness();
  await assert.rejects(
    () => engine.resumeFromAgent(workflow, parked("WAITING_AGENT", "gate"), "act", { ok: true, status: "Inactive" }),
    /not waiting for this agent result/i,
  );
});

test("an approval is refused unless the run is WAITING_APPROVAL", async () => {
  for (const status of NON_APPROVAL) {
    const { engine } = harness();
    await assert.rejects(
      () => engine.resumeFromApproval(workflow, parked(status, "approve"), "approve", true),
      /not waiting for this approval/i,
      `${status} must refuse an approval`,
    );
  }
});

test("an approval is refused when the step named is not an approval step", async () => {
  const { engine } = harness();
  await assert.rejects(
    () => engine.resumeFromApproval(workflow, parked("WAITING_APPROVAL", "act"), "act", true),
    /not waiting for this approval/i,
  );
});

test("a confirmation is refused unless the run is AWAITING_CONFIRMATION on that step", async () => {
  for (const status of NON_CONFIRMATION) {
    const { engine } = harness();
    await assert.rejects(
      () => engine.resumeFromConfirmation(workflow, parked(status, "gate"), "gate"),
      /not waiting for this confirmation/i,
      `${status} must refuse a confirmation`,
    );
  }
});

test("a confirmation is refused when it names a step the run is not parked on", async () => {
  const { engine } = harness();
  await assert.rejects(
    () => engine.resumeFromConfirmation(workflow, parked("AWAITING_CONFIRMATION", "gate"), "act"),
    /not waiting for this confirmation/i,
  );
});

test("a terminal run cannot be cancelled", async () => {
  for (const status of TERMINAL) {
    const { engine } = harness();
    await assert.rejects(() => engine.cancel(parked(status, undefined)), /no longer be cancelled/i, `${status} must refuse cancellation`);
  }
});

test("cancellation is admitted from exactly the live statuses", async () => {
  for (const status of ["RUNNING", "WAITING_APPROVAL", "WAITING_AGENT", "AWAITING_CONFIRMATION"] as WorkflowRun["status"][]) {
    const { engine } = harness();
    const cancelled = await engine.cancel(parked(status, "act"), { userId: "operator", role: "CLIENT_ADMIN" });
    assert.equal(cancelled.status, "CANCELLED", `${status} must be cancellable`);
    assert.equal(cancelled.currentStepId, undefined);
  }
});

test("an unrecognized status is not cancellable, so the cancellable set fails closed", async () => {
  const { engine } = harness();
  await assert.rejects(
    () => engine.cancel(parked("SOME_STATUS_ADDED_LATER" as WorkflowRun["status"], "act")),
    /no longer be cancelled/i,
  );
});

test("a timeout is admitted only from a status that waits on expirable work", async () => {
  for (const status of ["WAITING_AGENT", "AWAITING_CONFIRMATION"] as WorkflowRun["status"][]) {
    const { engine } = harness();
    const timedOut = await engine.timeout(parked(status, "act"));
    assert.equal(timedOut.status, "TIMED_OUT", `${status} is expirable`);
  }
  for (const status of ["RUNNING", "WAITING_APPROVAL", ...TERMINAL] as WorkflowRun["status"][]) {
    const { engine } = harness();
    await assert.rejects(() => engine.timeout(parked(status, "act")), /not waiting on expirable work/i, `${status} must not time out`);
  }
});

test("a resumed run continues on the workflow version it started on", async () => {
  // The engine is handed the workflow definition to resume against, so a run pinned to version 1
  // executes version 1's step graph even if the caller holds a later definition. This asserts the
  // engine never silently substitutes its own idea of the workflow.
  const { engine } = harness();
  const run = parked("WAITING_AGENT", "act", { workflowVersion: 1 });
  const resumed = await engine.resumeFromAgent(workflow, run, "act", { ok: true, status: "Inactive" });
  assert.equal(resumed.workflowVersion, 1, "the pinned version is not rewritten by resuming");
  assert.equal(resumed.status, "COMPLETED");
});

test("each resume path records its own audit event and appends rather than rewrites", async () => {
  const { engine } = harness();
  const before = parked("WAITING_APPROVAL", "approve");
  const beforeEntries = before.audit.map((entry) => JSON.stringify(entry));
  const after = await engine.resumeFromApproval(workflow, before, "approve", true, { userId: "operator", role: "CLIENT_ADMIN" });
  assert.deepEqual(
    after.audit.map((entry) => JSON.stringify(entry)).slice(0, beforeEntries.length),
    beforeEntries,
    "no earlier entry was modified",
  );
  assert.ok(after.audit.some((entry) => entry.type === "APPROVED"));
});
