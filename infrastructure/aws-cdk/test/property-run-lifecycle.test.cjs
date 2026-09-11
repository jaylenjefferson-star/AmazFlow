// Task 15.9 -- Property 3: run status transition validity.
//
// **Property 3**: a terminal run never transitions again; every transition is in the declared
// table; cancel is accepted exactly for the cancellable set; an agent result is accepted only
// while awaiting an agent on that exact step; audit is append-only and monotonic in time; an
// unsubstantiated success does not advance the run.
//
// **Validates: Requirements 16.1, 16.5, 16.13, 16.14, 17.5, 19.5, 19.8, 28.12, 31.1, 31.2, 31.3, 31.15, 31.17**
//
// guardrail-state-machine.test.cjs already pins these behaviours with a hand-picked list of
// statuses and step ids. What a property adds is the input space a hand-written list cannot
// enumerate: arbitrary garbage statuses (empty strings, case variants, near-miss spellings) and
// arbitrary step ids, generated and shrunk by fast-check rather than chosen by a person -- so a
// status this file's author never thought of is exercised anyway.
const assert = require("node:assert");
const fc = require("fast-check");
require("./harness.cjs");
const { putTenant, loadRun, asUser, iso, reporter } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("PROPERTY 3 -- RUN STATUS TRANSITION VALIDITY");

const TENANT = "p3org";
const ADMIN = { userId: "user_admin", tenantId: TENANT, group: "CLIENT_ADMIN" };

// Same shape as guardrail-state-machine.test.cjs's fixture: one workflow carrying an approval, a
// confirmation-gated action, a verified action, and both end branches, so every resume path has a
// real step to resume on.
const workflow = {
  id: "wf_p3",
  tenantId: TENANT,
  name: "Property 3 workflow",
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
      input: { selector: "#go", url: "https://p3.example.com/x" },
      next: "s_act",
    },
    {
      id: "s_act",
      type: "action",
      provider: "browser",
      operation: "SET_EMPLOYEE_STATUS",
      name: "Set status",
      input: { selector: "#status", status: "Inactive", url: "https://p3.example.com/x" },
      verify: { path: "result.status", equals: "Inactive" },
      next: "s_done",
    },
    { id: "s_done", type: "end", outcome: "success", name: "Done" },
    { id: "s_fail", type: "end", outcome: "failure", name: "Rejected" },
  ],
};
putTenant(TENANT, "WORKFLOW", workflow);
putTenant(TENANT, "WORKFLOWVERSION", { ...workflow, id: "wf_p3_v000001" });

let runSeq = 0;
const seedRun = ({ status, currentStepId, confirmedStepIds = [] }) => {
  const id = `run_p3_${++runSeq}`;
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

const seedTask = (runId, stepId) => {
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
    status: "PENDING",
    workflowId: workflow.id,
    assignedRoles: ["CLIENT_ADMIN"],
    createdBy: ADMIN.userId,
  });
  return id;
};

const approve = (runId, stepId) =>
  asUser(ADMIN, "POST /runs/{id}/approvals/{stepId}", { pathParameters: { id: runId, stepId }, body: { approved: true } });
const confirm = (runId, stepId) =>
  asUser(ADMIN, "POST /runs/{id}/confirmations/{stepId}/confirm", { pathParameters: { id: runId, stepId } });
const resolveTask = (taskId, body) =>
  asUser(ADMIN, "POST /agent-tasks/{id}/result", { pathParameters: { id: taskId }, body });
const cancel = (runId) => asUser(ADMIN, "POST /runs/{id}/cancel", { pathParameters: { id: runId } });

const CANCELLABLE = ["RUNNING", "WAITING_APPROVAL", "WAITING_AGENT", "AWAITING_CONFIRMATION"];
const TERMINAL = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"];
const KNOWN_STATUSES = [...CANCELLABLE, ...TERMINAL];

// Half the time a real status (exercising the exact boundary of the declared table), half the time
// an arbitrary string (fuzzing everything a hand-picked list cannot enumerate: empty, lowercase,
// near-miss spellings, unicode, Object.prototype member names).
const arbStatus = fc.oneof(
  fc.constantFrom(...KNOWN_STATUSES),
  fc.string({ maxLength: 24 }).filter((s) => !KNOWN_STATUSES.includes(s)),
);
const arbStepId = fc.oneof(
  fc.constant("s_approve"),
  fc.string({ maxLength: 24 }).filter((s) => s !== "s_approve"),
);

const auditUnchanged = (before, after) =>
  after.audit.length === before.audit.length && JSON.stringify(after.audit) === JSON.stringify(before.audit);
const auditGrewMonotonically = (before, after) => {
  if (after.audit.length <= before.audit.length) return false;
  const timestamps = after.audit.map((entry) => Date.parse(entry.at));
  for (let i = 1; i < timestamps.length; i++) if (timestamps[i] < timestamps[i - 1]) return false;
  return true;
};

(async () => {
  section("cancel is accepted exactly for the cancellable set, for any status");

  await check("cancellation succeeds iff status is cancellable; refusal never mutates the run; success is audited and monotonic", async () => {
    await fc.assert(
      fc.asyncProperty(arbStatus, async (status) => {
        const runId = seedRun({ status, currentStepId: "s_act" });
        const before = loadRun(TENANT, runId);
        const res = await cancel(runId);
        const after = loadRun(TENANT, runId);
        if (CANCELLABLE.includes(status))
          return (
            res.status === 200 &&
            after.status === "CANCELLED" &&
            after.currentStepId === undefined &&
            auditGrewMonotonically(before, after)
          );
        return res.status === 409 && after.status === status && auditUnchanged(before, after);
      }),
      { numRuns: 80 },
    );
  });

  section("each resume path resumes only from its own wait status, for any status");

  await check("an approval is accepted iff the run is WAITING_APPROVAL; every refusal leaves the run untouched", async () => {
    await fc.assert(
      fc.asyncProperty(arbStatus, async (status) => {
        const runId = seedRun({ status, currentStepId: "s_approve" });
        const before = loadRun(TENANT, runId);
        const res = await approve(runId, "s_approve");
        const after = loadRun(TENANT, runId);
        if (status === "WAITING_APPROVAL") return res.status === 200 && auditGrewMonotonically(before, after);
        return res.status === 409 && auditUnchanged(before, after);
      }),
      { numRuns: 60 },
    );
  });

  await check("a confirmation is accepted iff the run is AWAITING_CONFIRMATION; every refusal leaves the run untouched", async () => {
    await fc.assert(
      fc.asyncProperty(arbStatus, async (status) => {
        const runId = seedRun({ status, currentStepId: "s_gate" });
        const before = loadRun(TENANT, runId);
        const res = await confirm(runId, "s_gate");
        const after = loadRun(TENANT, runId);
        if (status === "AWAITING_CONFIRMATION") return res.status === 200 && auditGrewMonotonically(before, after);
        return res.status === 409 && auditUnchanged(before, after);
      }),
      { numRuns: 60 },
    );
  });

  await check("an agent result is accepted iff the run is WAITING_AGENT; every refusal leaves the run untouched", async () => {
    await fc.assert(
      fc.asyncProperty(arbStatus, async (status) => {
        const runId = seedRun({ status, currentStepId: "s_act" });
        const taskId = seedTask(runId, "s_act");
        const before = loadRun(TENANT, runId);
        const res = await resolveTask(taskId, { ok: true, status: "Inactive" });
        const after = loadRun(TENANT, runId);
        if (status === "WAITING_AGENT") return res.status === 200 && auditGrewMonotonically(before, after);
        return res.status === 409 && auditUnchanged(before, after);
      }),
      { numRuns: 60 },
    );
  });

  section("a resume path refused when it names a step the run is not parked on, for any step id");

  await check("an approval naming any step but the one the run is parked on is refused", async () => {
    await fc.assert(
      fc.asyncProperty(arbStepId, async (stepId) => {
        const runId = seedRun({ status: "WAITING_APPROVAL", currentStepId: "s_approve" });
        const before = loadRun(TENANT, runId);
        const res = await approve(runId, stepId);
        const after = loadRun(TENANT, runId);
        if (stepId === "s_approve") return res.status === 200;
        return res.status === 409 && auditUnchanged(before, after);
      }),
      { numRuns: 40 },
    );
  });

  section("a terminal status accepts no resume path and no cancellation, for any terminal status");

  const OPERATIONS = [
    { name: "cancel", run: (runId) => cancel(runId) },
    { name: "approve", run: (runId) => approve(runId, "s_approve") },
    { name: "confirm", run: (runId) => confirm(runId, "s_gate") },
    { name: "resolve", run: (runId) => resolveTask(seedTask(runId, "s_act"), { ok: true, status: "Inactive" }) },
  ];

  await check("every terminal status refuses every operation and stays unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...TERMINAL), fc.constantFrom(...OPERATIONS.map((o) => o.name)), async (status, opName) => {
        const op = OPERATIONS.find((o) => o.name === opName);
        const runId = seedRun({ status, currentStepId: "s_act" });
        const before = loadRun(TENANT, runId);
        const res = await op.run(runId);
        const after = loadRun(TENANT, runId);
        return res.status >= 400 && after.status === status && after.currentStepId === before.currentStepId;
      }),
      { numRuns: 40 },
    );
  });

  section("a run that reports success it cannot substantiate does not advance");

  await check("any value other than the verify contract's expected value is refused into VERIFICATION_FAILED, never COMPLETED", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)).filter((v) => v !== "Inactive"),
        async (wrongValue) => {
          const runId = seedRun({ status: "WAITING_AGENT", currentStepId: "s_act" });
          const taskId = seedTask(runId, "s_act");
          const res = await resolveTask(taskId, { ok: true, status: wrongValue });
          const after = loadRun(TENANT, runId);
          return (
            res.status === 200 &&
            after.status !== "COMPLETED" &&
            after.audit.some((entry) => entry.type === "VERIFICATION_FAILED")
          );
        },
      ),
      { numRuns: 40 },
    );
  });

  done();
})();
