// Guardrail 2.1 -- the run state machine and every resume path.
//
// Pins three properties of the engine that the restructure must not weaken:
//   * each resume path refuses unless the run is in the one status that path resumes from, and the
//     step named is the step the run is actually parked on;
//   * a terminal status is immutable -- no resume, no cancellation, no timeout reopens it;
//   * cancellation is admitted from exactly the four live statuses and refused from every other,
//     including a status the platform does not recognize.
//
// The third is the one worth stating plainly: the cancellable set is a POSITIVE list. An
// unrecognized status is refused rather than treated as cancellable, so a status added later
// without touching this list fails closed.
//
// _Requirements: 31.1, 31.18_
const assert = require("node:assert");
const { putTenant, loadRun, asUser, iso, reporter } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("GUARDRAIL: run state machine and resume paths");

const TENANT = "guard";
const ADMIN = { userId: "user_admin", tenantId: TENANT, group: "CLIENT_ADMIN" };

// One workflow carrying every waitable step type, so each resume path has a real step to resume on.
const workflow = {
  id: "wf_guard",
  tenantId: TENANT,
  name: "Guardrail workflow",
  version: 1,
  status: "active",
  assignedRoles: ["CLIENT_ADMIN"],
  startAt: "s_approve",
  steps: [
    { id: "s_approve", type: "approval", name: "Approve", message: "Approve this", roles: ["CLIENT_ADMIN"], next: "s_gate", onReject: "s_fail" },
    {
      id: "s_gate",
      type: "action",
      provider: "browser",
      operation: "CLICK",
      name: "Gated action",
      requiresConfirmation: true,
      input: { selector: "#go", url: "https://guard.example.com/x" },
      next: "s_act",
    },
    {
      id: "s_act",
      type: "action",
      provider: "browser",
      operation: "SET_EMPLOYEE_STATUS",
      name: "Set status",
      input: { selector: "#status", status: "Inactive", url: "https://guard.example.com/x" },
      verify: { path: "result.status", equals: "Inactive" },
      next: "s_done",
    },
    { id: "s_done", type: "end", outcome: "success", name: "Done" },
    { id: "s_fail", type: "end", outcome: "failure", name: "Rejected" },
  ],
};
putTenant(TENANT, "WORKFLOW", workflow);
putTenant(TENANT, "WORKFLOWVERSION", { ...workflow, id: "wf_guard_v000001" });

let runSeq = 0;
const seedRun = ({ status, currentStepId, confirmedStepIds = [] }) => {
  const id = `run_guard_${++runSeq}`;
  putTenant(TENANT, "RUN", {
    id,
    tenantId: TENANT,
    workflowId: workflow.id,
    workflowVersion: 1,
    status,
    currentStepId,
    createdBy: ADMIN.userId,
    confirmedStepIds,
    stepResults: {},
    context: { input: {}, values: {}, lastAction: null },
    audit: [{ id: "aud_1", at: iso(-60000), type: "RUN_STARTED", message: "started", details: {} }],
    createdAt: iso(-60000),
    updatedAt: iso(-60000),
  });
  return id;
};

const seedTask = (runId, stepId, { status = "PENDING" } = {}) => {
  const id = `task_${runId}_${stepId}`;
  putTenant(TENANT, "TASK", {
    id,
    runId,
    tenantId: TENANT,
    stepId,
    provider: "browser",
    operation: "SET_EMPLOYEE_STATUS",
    executionTarget: "browser_extension",
    input: { selector: "#status", status: "Inactive" },
    expiresAt: iso(300000),
    status,
    workflowId: workflow.id,
    assignedRoles: ["CLIENT_ADMIN"],
    createdBy: ADMIN.userId,
  });
  return id;
};

const approve = (runId, stepId, approved = true) =>
  asUser(ADMIN, "POST /runs/{id}/approvals/{stepId}", { pathParameters: { id: runId, stepId }, body: { approved } });
const confirm = (runId, stepId) =>
  asUser(ADMIN, "POST /runs/{id}/confirmations/{stepId}/confirm", { pathParameters: { id: runId, stepId } });
const resolveTask = (taskId, body) =>
  asUser(ADMIN, "POST /agent-tasks/{id}/result", { pathParameters: { id: taskId }, body });
const cancel = (runId) => asUser(ADMIN, "POST /runs/{id}/cancel", { pathParameters: { id: runId } });

(async () => {
  /* ------------------------------------------------------------------ resume path guards ------ */
  section("each resume path resumes only from its own wait status");

  await check("an approval is refused unless the run is WAITING_APPROVAL", async () => {
    for (const status of ["RUNNING", "WAITING_AGENT", "AWAITING_CONFIRMATION", "COMPLETED", "FAILED"]) {
      const runId = seedRun({ status, currentStepId: "s_approve" });
      const res = await approve(runId, "s_approve");
      assert.equal(res.status, 409, `${status} must not accept an approval (got ${res.status})`);
      assert.equal(loadRun(TENANT, runId).status, status, `${status} must be unchanged`);
    }
  });

  await check("an approval is refused when it names a step the run is not parked on", async () => {
    const runId = seedRun({ status: "WAITING_APPROVAL", currentStepId: "s_approve" });
    const res = await approve(runId, "s_act");
    assert.equal(res.status, 409);
    assert.equal(loadRun(TENANT, runId).status, "WAITING_APPROVAL");
  });

  await check("a confirmation is refused unless the run is AWAITING_CONFIRMATION", async () => {
    for (const status of ["RUNNING", "WAITING_AGENT", "WAITING_APPROVAL", "COMPLETED", "CANCELLED"]) {
      const runId = seedRun({ status, currentStepId: "s_gate" });
      const res = await confirm(runId, "s_gate");
      assert.equal(res.status, 409, `${status} must not accept a confirmation (got ${res.status})`);
      assert.equal(loadRun(TENANT, runId).status, status);
    }
  });

  await check("a confirmation is refused when it names a step the run is not parked on", async () => {
    const runId = seedRun({ status: "AWAITING_CONFIRMATION", currentStepId: "s_gate" });
    const res = await confirm(runId, "s_act");
    assert.equal(res.status, 409);
    assert.equal(loadRun(TENANT, runId).status, "AWAITING_CONFIRMATION");
  });

  await check("an agent result is refused unless the run is WAITING_AGENT", async () => {
    for (const status of ["RUNNING", "WAITING_APPROVAL", "AWAITING_CONFIRMATION", "COMPLETED", "TIMED_OUT"]) {
      const runId = seedRun({ status, currentStepId: "s_act" });
      const taskId = seedTask(runId, "s_act");
      const res = await resolveTask(taskId, { ok: true, status: "Inactive" });
      assert.equal(res.status, 409, `${status} must not accept an agent result (got ${res.status})`);
      assert.equal(loadRun(TENANT, runId).status, status);
    }
  });

  await check("an agent result is refused when the run is parked on a different step", async () => {
    const runId = seedRun({ status: "WAITING_AGENT", currentStepId: "s_gate" });
    const taskId = seedTask(runId, "s_act");
    const res = await resolveTask(taskId, { ok: true, status: "Inactive" });
    assert.equal(res.status, 409);
    assert.equal(loadRun(TENANT, runId).status, "WAITING_AGENT");
  });

  await check("an already-resolved task cannot be resolved a second time", async () => {
    const runId = seedRun({ status: "WAITING_AGENT", currentStepId: "s_act" });
    const taskId = seedTask(runId, "s_act");
    const first = await resolveTask(taskId, { ok: true, status: "Inactive" });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(loadRun(TENANT, runId).status, "COMPLETED");
    const second = await resolveTask(taskId, { ok: true, status: "Inactive" });
    assert.equal(second.status, 409);
  });

  /* --------------------------------------------------------- the happy transitions still hold -- */
  section("each resume path still performs its own transition");

  await check("an approval granted advances to the approval step's next step", async () => {
    const runId = seedRun({ status: "WAITING_APPROVAL", currentStepId: "s_approve" });
    const res = await approve(runId, "s_approve", true);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const run = loadRun(TENANT, runId);
    // s_gate requires confirmation, so the run parks there rather than executing it.
    assert.equal(run.status, "AWAITING_CONFIRMATION");
    assert.equal(run.currentStepId, "s_gate");
    assert.ok(run.audit.some((a) => a.type === "APPROVED"));
    assert.ok(run.audit.some((a) => a.type === "CONFIRMATION_REQUIRED"));
  });

  await check("an approval rejected routes to the approval step's reject branch", async () => {
    const runId = seedRun({ status: "WAITING_APPROVAL", currentStepId: "s_approve" });
    const res = await approve(runId, "s_approve", false);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const run = loadRun(TENANT, runId);
    assert.equal(run.status, "FAILED", "the reject branch ends the run at its failure end step");
    assert.ok(run.audit.some((a) => a.type === "REJECTED"));
  });

  await check("a confirmation granted records the step as confirmed and proceeds", async () => {
    const runId = seedRun({ status: "AWAITING_CONFIRMATION", currentStepId: "s_gate" });
    const res = await confirm(runId, "s_gate");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const run = loadRun(TENANT, runId);
    assert.ok(run.confirmedStepIds.includes("s_gate"), "the granted confirmation is persisted on the run");
    assert.equal(run.status, "WAITING_AGENT", "the confirmed action becomes agent work");
    assert.ok(run.audit.some((a) => a.type === "CONFIRMATION_GRANTED"));
  });

  await check("a confirmation is not re-required once granted", async () => {
    const runId = seedRun({ status: "AWAITING_CONFIRMATION", currentStepId: "s_gate", confirmedStepIds: [] });
    await confirm(runId, "s_gate");
    const run = loadRun(TENANT, runId);
    const required = run.audit.filter((a) => a.type === "CONFIRMATION_REQUIRED" && a.stepId === "s_gate");
    assert.equal(required.length, 0, "the gate must not re-arm for a step already confirmed");
  });

  /* ----------------------------------------------------------- terminal status immutability ---- */
  section("a terminal status is immutable");

  const TERMINAL = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"];

  await check("no terminal run can be cancelled", async () => {
    for (const status of TERMINAL) {
      const runId = seedRun({ status, currentStepId: undefined });
      const res = await cancel(runId);
      assert.equal(res.status, 409, `${status} must refuse cancellation (got ${res.status})`);
      assert.equal(loadRun(TENANT, runId).status, status, `${status} must be unchanged`);
    }
  });

  await check("no terminal run can be resumed by any path", async () => {
    for (const status of TERMINAL) {
      const runId = seedRun({ status, currentStepId: "s_act" });
      const taskId = seedTask(runId, "s_act");
      const outcomes = [
        await approve(runId, "s_approve"),
        await confirm(runId, "s_gate"),
        await resolveTask(taskId, { ok: true, status: "Inactive" }),
      ];
      for (const res of outcomes) assert.ok(res.status >= 400, `${status} must refuse every resume path`);
      assert.equal(loadRun(TENANT, runId).status, status);
    }
  });

  /* ----------------------------------------------------- cancellation is a positive status set -- */
  section("cancellation is admitted from a positive status set");

  await check("every live status is cancellable and lands in CANCELLED", async () => {
    for (const status of ["RUNNING", "WAITING_APPROVAL", "WAITING_AGENT", "AWAITING_CONFIRMATION"]) {
      const runId = seedRun({ status, currentStepId: "s_act" });
      const res = await cancel(runId);
      assert.equal(res.status, 200, `${status} must be cancellable (got ${res.status})`);
      const run = loadRun(TENANT, runId);
      assert.equal(run.status, "CANCELLED");
      assert.equal(run.currentStepId, undefined, "a cancelled run holds no current step");
      assert.deepEqual(
        run.audit.slice(-2).map((a) => a.type),
        ["RUN_CANCEL_REQUESTED", "RUN_CANCELLED"],
        "cancellation records both the request and the outcome",
      );
    }
  });

  await check("a status outside the cancellable set is refused, so an unknown status fails closed", async () => {
    const runId = seedRun({ status: "UNRECOGNIZED_STATUS", currentStepId: "s_act" });
    const res = await cancel(runId);
    assert.equal(res.status, 409, "an unrecognized status must not be treated as cancellable");
    assert.equal(loadRun(TENANT, runId).status, "UNRECOGNIZED_STATUS");
  });

  await check("cancelling a run also closes out its undispatched work", async () => {
    const runId = seedRun({ status: "WAITING_AGENT", currentStepId: "s_act" });
    const taskId = seedTask(runId, "s_act");
    const res = await cancel(runId);
    assert.equal(res.status, 200);
    const task = require("./guardrail-support.cjs").loadTask(TENANT, taskId);
    assert.equal(task.status, "CANCELLED", "a cancelled run's pending task stops being offered");
  });

  done();
})();
