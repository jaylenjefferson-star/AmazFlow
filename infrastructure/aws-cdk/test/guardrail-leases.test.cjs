// Guardrail 2.3 -- single-winner task leases and the scheduled sweep.
//
// This is the guarantee that stops the same click happening twice. Before the lease existed, every
// connected browser in an organization polled the same PENDING list and acted on the first entry;
// two agents both performed the action and the second one to report got a 409 after the side effect
// had already happened. Three properties keep that closed, and all three are pinned here:
//
//   * CONTENTION  -- a contested claim is granted to exactly one agent, through a conditional write
//                    on a separate lock item. Not "usually one" -- exactly one.
//   * SELF-HEALING -- a lease older than its expiry can be taken over, so an agent that crashes
//                    mid-step does not strand the run forever.
//   * RECOVERY    -- the scheduled sweep returns a stalled lease to the pool rather than timing the
//                    run out, while the task's own deadline still has time left.
//
// _Requirements: 31.9, 31.10, 31.11, 31.18_
const assert = require("node:assert");
const { store, putTenant, loadRun, loadTask, asAgent, seedAgent, sweep, iso, reporter } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("GUARDRAIL: task leases and the scheduled sweep");

const TENANT = "guardl";
const workflow = {
  id: "wf_lease",
  tenantId: TENANT,
  name: "Lease guardrail",
  version: 1,
  status: "active",
  assignedRoles: ["CLIENT_ADMIN"],
  startAt: "s_act",
  steps: [
    {
      id: "s_act",
      type: "action",
      provider: "browser",
      operation: "SET_EMPLOYEE_STATUS",
      name: "Set status",
      input: { selector: "#status", status: "Inactive", url: "https://lease.example.com/e/1" },
      verify: { path: "result.status", equals: "Inactive" },
      next: "s_done",
    },
    { id: "s_done", type: "end", outcome: "success", name: "Done" },
  ],
};
putTenant(TENANT, "WORKFLOW", workflow);
putTenant(TENANT, "WORKFLOWVERSION", { ...workflow, id: "wf_lease_v000001" });

// Four agents of the same surface in one organization: the exact situation that used to double-act.
const TOKENS = ["a", "b", "c", "d"].map((suffix) =>
  seedAgent(
    TENANT,
    {
      id: `agent_${suffix}`,
      tenantId: TENANT,
      name: `Agent ${suffix}`,
      status: "active",
      agentType: "CHROME_EXTENSION",
      capabilities: ["SET_EMPLOYEE_STATUS"],
      lastSeenAt: iso(-1000),
    },
    `tok_${suffix}`,
  ),
);

let seq = 0;
const freshWork = (taskOverrides = {}) => {
  const n = ++seq;
  const runId = `run_lease_${n}`;
  const taskId = `task_lease_${n}`;
  putTenant(TENANT, "RUN", {
    id: runId,
    tenantId: TENANT,
    workflowId: workflow.id,
    workflowVersion: 1,
    status: "WAITING_AGENT",
    currentStepId: "s_act",
    createdBy: "user_admin",
    confirmedStepIds: [],
    stepResults: {},
    context: { input: {}, values: {}, lastAction: null },
    audit: [{ id: "aud_1", at: iso(-60000), type: "RUN_STARTED", message: "started", details: {} }],
    createdAt: iso(-60000),
    updatedAt: iso(-60000),
  });
  putTenant(TENANT, "TASK", {
    id: taskId,
    runId,
    tenantId: TENANT,
    stepId: "s_act",
    provider: "browser",
    operation: "SET_EMPLOYEE_STATUS",
    executionTarget: "browser_extension",
    input: { selector: "#status", status: "Inactive" },
    expiresAt: iso(300000),
    status: "PENDING",
    workflowId: workflow.id,
    assignedRoles: ["CLIENT_ADMIN"],
    createdBy: "user_admin",
    ...taskOverrides,
  });
  return { runId, taskId };
};

const claim = (taskId, token) => asAgent(token, "POST /agent/tasks/{id}/claim", { pathParameters: { id: taskId } });
const poll = (token) => asAgent(token, "GET /agent/tasks");
const lockFor = (taskId) => store.get(`PLATFORM|TASKCLAIM#${taskId}`);

(async () => {
  /* ----------------------------------------------------------------------------- contention ---- */
  section("a contested claim is granted to exactly one agent");

  await check("two agents racing for one task produce one winner and one refusal", async () => {
    const work = freshWork();
    const [first, second] = await Promise.all([claim(work.taskId, TOKENS[0]), claim(work.taskId, TOKENS[1])]);
    const outcomes = [first, second];
    const winners = outcomes.filter((r) => r.status === 200);
    const losers = outcomes.filter((r) => r.status === 409);
    assert.equal(winners.length, 1, `exactly one winner, got ${winners.length}: ${JSON.stringify(outcomes.map((o) => o.status))}`);
    assert.equal(losers.length, 1);
    assert.match(losers[0].body.error, /already running/i);
    assert.equal(loadTask(TENANT, work.taskId).status, "CLAIMED");
  });

  await check("four agents racing for one task still produce exactly one winner", async () => {
    const work = freshWork();
    const results = await Promise.all(TOKENS.map((token) => claim(work.taskId, token)));
    const winners = results.filter((r) => r.status === 200);
    assert.equal(winners.length, 1, `exactly one winner, got ${winners.length}`);
    assert.equal(results.filter((r) => r.status === 409).length, 3);
    // Exactly one grant was minted, so only one agent can ever report a result for this step.
    const grants = winners.map((r) => r.body.grant).filter(Boolean);
    assert.equal(grants.length, 1, "exactly one execution grant exists for a contested step");
  });

  await check("the claim is a conditional write on a lock item, not a field on the task", async () => {
    const work = freshWork();
    assert.equal(lockFor(work.taskId), undefined, "no lock exists before the claim");
    const res = await claim(work.taskId, TOKENS[0]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const lock = lockFor(work.taskId);
    assert.ok(lock, "claiming creates a separate lock item");
    assert.ok(lock.leaseExpiresAtMs, "the lock carries its own expiry, so it can self-heal");
    assert.equal(JSON.parse(lock.document.S).agentId, "agent_a");
  });

  await check("a claimed task stops being offered to any other agent", async () => {
    const work = freshWork();
    await claim(work.taskId, TOKENS[0]);
    for (const token of TOKENS.slice(1)) {
      const res = await poll(token);
      assert.ok(!res.body.some((t) => t.id === work.taskId), "a claimed task must not appear in another agent's poll");
    }
  });

  await check("the winner's claim is recorded on the run's own audit trail", async () => {
    const work = freshWork();
    const res = await claim(work.taskId, TOKENS[0]);
    const entry = loadRun(TENANT, work.runId).audit.find((a) => a.type === "AGENT_TASK_CLAIMED");
    assert.ok(entry, "the claim is audited");
    assert.equal(entry.details.agentId, "agent_a");
    assert.equal(entry.details.grantId, res.body.grantId);
    assert.ok(entry.details.expiresAt, "the lease deadline is on the record");
  });

  /* --------------------------------------------------------------------------- self-healing ---- */
  section("an expired lease can be taken over");

  await check("an agent that went away does not hold the task forever", async () => {
    const work = freshWork({
      status: "CLAIMED",
      claimedBy: "agent_gone",
      claimedAt: iso(-600000),
      claimExpiresAt: iso(-300000), // lease ran out five minutes ago
      expiresAt: iso(120000), // the task's own deadline still has time
    });
    const res = await claim(work.taskId, TOKENS[1]);
    assert.equal(res.status, 200, `an expired lease must be takeable: ${res.raw}`);
    assert.equal(loadTask(TENANT, work.taskId).claimedBy, "agent_b");
  });

  await check("a live lease is not takeable", async () => {
    const work = freshWork({
      status: "CLAIMED",
      claimedBy: "agent_busy",
      claimedAt: iso(-1000),
      claimExpiresAt: iso(240000), // still holding
    });
    const res = await claim(work.taskId, TOKENS[1]);
    assert.equal(res.status, 409);
    assert.equal(loadTask(TENANT, work.taskId).claimedBy, "agent_busy", "the holder keeps the task");
  });

  /* -------------------------------------------------------------------------------- recovery ---- */
  section("the scheduled sweep returns stalled leases to the pool");

  await check("a stalled lease is returned to PENDING rather than timing the run out", async () => {
    const work = freshWork({
      status: "CLAIMED",
      claimedBy: "agent_gone",
      claimedAt: iso(-600000),
      claimExpiresAt: iso(-300000),
      expiresAt: iso(120000),
      grantId: "grant-that-went-nowhere",
    });
    const result = await sweep();
    assert.ok(result.releasedClaims >= 1, "the sweep reports the release");
    const task = loadTask(TENANT, work.taskId);
    assert.equal(task.status, "PENDING");
    assert.equal(task.claimedBy, null, "the stale holder is cleared");
    assert.equal(task.claimExpiresAt, null);
    assert.equal(task.grantId, null, "the abandoned grant is not left attached");
    assert.equal(loadRun(TENANT, work.runId).status, "WAITING_AGENT", "the run keeps waiting rather than being timed out");
  });

  await check("a released task is claimable again by a different agent", async () => {
    const work = freshWork({
      status: "CLAIMED",
      claimedBy: "agent_gone",
      claimedAt: iso(-600000),
      claimExpiresAt: iso(-300000),
      expiresAt: iso(120000),
    });
    await sweep();
    const res = await claim(work.taskId, TOKENS[2]);
    assert.equal(res.status, 200, res.raw);
    assert.equal(loadTask(TENANT, work.taskId).claimedBy, "agent_c");
  });

  await check("a task past its own deadline is expired, not released", async () => {
    const work = freshWork({
      status: "CLAIMED",
      claimedBy: "agent_gone",
      claimedAt: iso(-600000),
      claimExpiresAt: iso(-300000),
      expiresAt: iso(-1000), // the task itself is out of time
    });
    await sweep();
    const task = loadTask(TENANT, work.taskId);
    assert.equal(task.status, "EXPIRED", "a task with no time left must not be handed to another agent");
    assert.equal(loadRun(TENANT, work.runId).status, "TIMED_OUT");
    const run = loadRun(TENANT, work.runId);
    assert.ok(
      run.audit.some((a) => a.type === "RUN_TIMED_OUT" && /No additional actions were taken/i.test(a.message)),
      "the timeout states plainly that nothing further was attempted",
    );
  });

  await check("a live lease is left alone by the sweep", async () => {
    const work = freshWork({
      status: "CLAIMED",
      claimedBy: "agent_busy",
      claimedAt: iso(-1000),
      claimExpiresAt: iso(240000),
      expiresAt: iso(300000),
    });
    await sweep();
    const task = loadTask(TENANT, work.taskId);
    assert.equal(task.status, "CLAIMED");
    assert.equal(task.claimedBy, "agent_busy");
  });

  done();
})();
