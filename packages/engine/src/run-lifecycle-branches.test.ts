// Task 15.10 -- Run lifecycle branch test suite.
//
// _Requirements: 16.1-16.5, 19.5, 19.8, 31.1-31.3_
//
// The rest of the suite (this file's siblings, plus infrastructure/aws-cdk/test/guardrail-*.test.cjs
// and property-run-lifecycle.test.cjs) already covers nearly every branch design.md's Phased
// Implementation Sequence enumerates for the run lifecycle: approval approved/rejected, confirmation
// required/granted, action success/failure with and without a failure branch, managed-service
// success/failure and reconciliation, verification failure, cancellation and terminal immutability,
// and an unrecognized status failing open. This file closes the three that were not reached anywhere
// else:
//
//   * a condition step's FALSE branch. engine.test.ts's data-entry fixture has a real condition step
//     ("confident"), but the fixed input it supplies always extracts with high confidence, so only
//     the TRUE branch (skip approval) is ever exercised, and the CONDITION_EVALUATED audit event
//     itself has no assertion anywhere.
//   * a confirmation's own expiry. `timeout()` accepts AWAITING_CONFIRMATION by name (the same guard
//     that accepts WAITING_AGENT), but every existing timeout test reaches WAITING_AGENT first.
//   * run creation's own preflight refusal is covered separately, at the HTTP route level, in
//     infrastructure/aws-cdk/test/workflow-lifecycle.test.cjs -- POST /workflows/{id}/runs refuses a
//     workflow whose required surface has no connected agent, which is a control-plane gate rather
//     than an engine-level branch.
import test from "node:test";
import assert from "node:assert/strict";
import { DemoAiProvider, WorkflowEngine, type AgentTask, type Store } from "./index.ts";
import { sampleWorkflow, type WorkflowDefinition, type WorkflowRun } from "@amazflow/workflow-schema";

const conditionWorkflow: WorkflowDefinition = {
  id: "condition-branch-test",
  tenantId: "amazflow",
  name: "Condition branch test",
  description: "",
  dataClass: "INTERNAL",
  version: 1,
  status: "active",
  assignedRoles: ["CLIENT_ADMIN"],
  allowedProviders: ["mock"],
  startAt: "check",
  steps: [
    { id: "check", name: "Check flag", type: "condition", path: "input.flag", operator: "equals", value: "yes", whenTrue: "true_end", whenFalse: "false_end" },
    { id: "true_end", name: "True branch", type: "end", outcome: "success" },
    { id: "false_end", name: "False branch", type: "end", outcome: "failed" },
  ],
};

function conditionStore() {
  let run: WorkflowRun | undefined;
  const store: Store = {
    getWorkflow: async () => conditionWorkflow,
    saveRun: async (value) => { run = structuredClone(value); },
    getRun: async () => run,
    saveTask: async () => {},
    saveApproval: async () => {},
    saveConfirmation: async () => {},
  };
  return store;
}

test("a condition step takes whenTrue and records the outcome, when the comparison holds", async () => {
  const engine = new WorkflowEngine(conditionStore(), new DemoAiProvider());
  const run = await engine.start(conditionWorkflow, { flag: "yes" });
  assert.equal(run.status, "COMPLETED");
  assert.equal(run.currentStepId, undefined);
  const event = run.audit.find((entry) => entry.type === "CONDITION_EVALUATED");
  assert.ok(event, "the condition's evaluation is its own audited event");
  assert.equal((event?.details as Record<string, unknown> | undefined)?.outcome, true);
});

test("a condition step takes whenFalse and records the outcome, when the comparison does not hold", async () => {
  const engine = new WorkflowEngine(conditionStore(), new DemoAiProvider());
  const run = await engine.start(conditionWorkflow, { flag: "no" });
  assert.equal(run.status, "FAILED");
  const event = run.audit.find((entry) => entry.type === "CONDITION_EVALUATED");
  assert.ok(event, "the condition's evaluation is its own audited event");
  assert.equal((event?.details as Record<string, unknown> | undefined)?.outcome, false);
});

test("an unanswered confirmation times out through the same shared mechanism as agent work", async () => {
  let run: WorkflowRun | undefined;
  let task: AgentTask | undefined;
  const store: Store = {
    getWorkflow: async () => sampleWorkflow,
    saveRun: async (value) => { run = value; },
    getRun: async () => run,
    saveTask: async (value) => { task = value; },
    saveApproval: async () => {},
    saveConfirmation: async () => {},
  };
  const engine = new WorkflowEngine(store, new DemoAiProvider());
  const waiting = await engine.start(sampleWorkflow, { employee: { id: "E-100" }, request: "DISABLE" });
  assert.equal(waiting.status, "AWAITING_CONFIRMATION");
  assert.equal(task, undefined, "no agent work exists yet -- there is nothing to claim while unconfirmed");

  const timedOut = await engine.timeout(waiting);
  assert.equal(timedOut.status, "TIMED_OUT");
  assert.equal(timedOut.audit.at(-1)?.type, "RUN_TIMED_OUT");
});
