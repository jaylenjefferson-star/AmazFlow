// Guardrail 2.7b -- an action whose side effect could not be ruled out is never retried.
//
// This is the guarantee that keeps a lost response from becoming a duplicated real-world action.
// When the executor reports FAILED with sideEffectObserved, the platform does not know whether the
// action landed. Retrying could disable an employee twice, submit a form twice, send a payment
// twice. So it does not retry, and it does not quietly fall back to a connected agent either --
// falling back IS a retry, just by a different route. It stops and says a human has to reconcile.
//
// engine.test.ts already asserts the reconciliation event is recorded. What is pinned here is the
// stronger property that event exists to guarantee: the action is attempted exactly ONCE. That is
// asserted by counting executor invocations, which is the only way to distinguish "recorded a
// reconciliation event" from "recorded a reconciliation event and then tried again anyway".
//
// _Requirements: 31.16, 8.11, 31.18_
import test from "node:test";
import assert from "node:assert/strict";
import { DemoAiProvider, WorkflowEngine, type ActionExecutionResult, type AgentTask, type Store } from "./index.ts";
import { type WorkflowDefinition, type WorkflowRun } from "@amazflow/workflow-schema";

const managedStep = {
  id: "execute",
  name: "Managed action",
  type: "action" as const,
  provider: "browser" as const,
  operation: "CLICK",
  input: {},
  connectionId: "connection-1",
  browserMode: "auto" as const,
  next: "done",
};

const workflowWith = (extra: Record<string, unknown> = {}, tail: unknown[] = []): WorkflowDefinition =>
  ({
    id: "wf-reconcile-guardrail",
    tenantId: "guard",
    name: "Reconciliation guardrail",
    version: 1,
    status: "active",
    assignedRoles: ["CLIENT_ADMIN"],
    startAt: "execute",
    steps: [{ ...managedStep, ...extra }, { id: "done", name: "Done", type: "end", outcome: "success" }, ...tail],
  }) as WorkflowDefinition;

/** Counts how many times the executor was asked to act, and how many agent tasks were queued. */
function harness(outcome: ActionExecutionResult) {
  let run: WorkflowRun | undefined;
  const tasks: AgentTask[] = [];
  let attempts = 0;
  const store: Store = {
    getWorkflow: async () => workflowWith(),
    saveRun: async (value) => { run = structuredClone(value); },
    getRun: async () => run,
    saveTask: async (value) => { tasks.push(value); },
    saveApproval: async () => {},
    saveConfirmation: async () => {},
  };
  const engine = new WorkflowEngine(
    store,
    new DemoAiProvider(),
    { execute: async () => { attempts++; return outcome; } },
    { issue: () => "grant" },
  );
  return { engine, tasks, attempts: () => attempts, saved: () => run };
}

const UNCERTAIN: ActionExecutionResult = { status: "FAILED", error: "response lost after submit", sideEffectObserved: true };
const CLEAN_FAILURE: ActionExecutionResult = { status: "FAILED", error: "element not found", sideEffectObserved: false };
const FALLBACK_BEFORE_ACTING: ActionExecutionResult = { status: "FALLBACK", error: "sign-in required", sideEffectObserved: false };

test("an action with an unruled-out side effect is attempted exactly once", async () => {
  const workflow = workflowWith();
  const h = harness(UNCERTAIN);
  const run = await h.engine.start(workflow, {});
  assert.equal(h.attempts(), 1, "the action must not be attempted a second time");
  assert.equal(run.status, "FAILED");
  assert.ok(run.audit.some((event) => event.type === "ACTION_RECONCILIATION_REQUIRED"));
});

test("an unruled-out side effect does not fall back to a connected agent, because falling back is a retry", async () => {
  const workflow = workflowWith();
  const h = harness(UNCERTAIN);
  await h.engine.start(workflow, {});
  assert.equal(h.tasks.length, 0, "no agent task may be queued -- an agent performing it would be the second attempt");
  assert.equal(h.attempts(), 1);
});

test("the reconciliation event names the uncertainty rather than reporting a plain failure", async () => {
  const workflow = workflowWith();
  const h = harness(UNCERTAIN);
  const run = await h.engine.start(workflow, {});
  const event = run.audit.find((entry) => entry.type === "ACTION_RECONCILIATION_REQUIRED");
  assert.ok(event, "the run says a human has to reconcile");
  assert.equal(event?.details?.sideEffectObserved, true, "and says why: the side effect could not be ruled out");
  assert.ok(!run.audit.some((entry) => entry.type === "ACTION_FAILED"), "it must not be recorded as an ordinary failure");
});

test("an unruled-out side effect is still not retried when the step has a failure branch", async () => {
  // A failure branch routes the run onward for handling. It must not re-run the uncertain action.
  const workflow = workflowWith({ onFailure: "needs-human" }, [
    { id: "needs-human", name: "Needs a human", type: "end", outcome: "failure" },
  ]);
  const h = harness(UNCERTAIN);
  const run = await h.engine.start(workflow, {});
  assert.equal(h.attempts(), 1, "routing to a failure branch is not permission to try again");
  assert.equal(h.tasks.length, 0);
  assert.ok(run.audit.some((entry) => entry.type === "ACTION_RECONCILIATION_REQUIRED"));
  assert.equal(run.status, "FAILED");
});

test("a failure with the side effect ruled out is recorded as an ordinary failure, not a reconciliation", async () => {
  const workflow = workflowWith();
  const h = harness(CLEAN_FAILURE);
  const run = await h.engine.start(workflow, {});
  assert.equal(h.attempts(), 1);
  assert.ok(run.audit.some((entry) => entry.type === "ACTION_FAILED"));
  assert.ok(
    !run.audit.some((entry) => entry.type === "ACTION_RECONCILIATION_REQUIRED"),
    "a known-clean failure must not be escalated to a human reconciliation",
  );
});

test("a fallback before any side effect does hand the step to a connected agent", async () => {
  // The contrast case. Falling back is safe precisely BECAUSE nothing happened yet, which is what
  // makes sideEffectObserved the deciding field rather than the status.
  const workflow = workflowWith();
  const h = harness(FALLBACK_BEFORE_ACTING);
  const run = await h.engine.start(workflow, {});
  assert.equal(run.status, "WAITING_AGENT");
  assert.equal(h.tasks.length, 1, "the step is handed over exactly once");
  assert.ok(run.audit.some((entry) => entry.type === "MANAGED_EXECUTION_FALLBACK"));
  assert.ok(!run.audit.some((entry) => entry.type === "ACTION_RECONCILIATION_REQUIRED"));
});

test("a fallback is refused for a step pinned to managed execution, and is not retried either", async () => {
  // browserMode "managed" says this step may only run on the managed surface. A fallback there is
  // not silently converted into agent work, and the action is not attempted again.
  const workflow = workflowWith({ browserMode: "managed" });
  const h = harness(FALLBACK_BEFORE_ACTING);
  const run = await h.engine.start(workflow, {});
  assert.equal(h.tasks.length, 0, "a managed-only step must not be handed to a connected agent");
  assert.equal(h.attempts(), 1);
  assert.equal(run.status, "FAILED");
});

test("the failed step's stored result says it failed rather than leaving it unresolved", async () => {
  const workflow = workflowWith();
  const h = harness(UNCERTAIN);
  const run = await h.engine.start(workflow, {});
  const stepResult = run.stepResults?.execute;
  assert.ok(stepResult, "the step is resolved on the record rather than left blank");
  assert.equal(stepResult?.status, "FAILED");
  assert.equal(stepResult?.actionResult?.ok, false);
  assert.match(String(stepResult?.actionResult?.error), /response lost/);
});
