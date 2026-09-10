// Guardrail 2.4 -- independent verification.
//
// The single most important honesty property in the platform. The agent is the thing being checked,
// so its own "ok: true" is a claim, not a verdict. When a step declares a verify contract, the
// server re-tests that contract against what the agent actually reported, and a self-declared
// success that does not hold up fails the step instead of advancing the run.
//
// What this pins:
//   * a success the platform cannot substantiate records VERIFICATION_FAILED and does not advance;
//   * the failure is audited DISTINCTLY from an honest agent-reported failure, so the two are
//     distinguishable after the fact -- an agent that lies and an agent that reports a problem are
//     not the same event;
//   * the evidence records the expected and actual values, so the run's own record says what was
//     claimed and what was checked;
//   * an unverifiable success routes to the step's failure branch when one exists, and ends the run
//     FAILED when one does not -- never to the success branch.
//
// _Requirements: 31.2, 31.3, 31.18_
const assert = require("node:assert");
const { putTenant, loadRun, asAgent, seedAgent, iso, reporter } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("GUARDRAIL: independent verification");

const TENANT = "guardv";

// Two workflows: one whose verified step has no failure branch, one that has one. The verification
// outcome must be identical in both; only the routing differs.
const stepFor = (onFailure) => ({
  id: "s_act",
  type: "action",
  provider: "browser",
  operation: "SET_EMPLOYEE_STATUS",
  name: "Set status",
  input: { selector: "#status", status: "Inactive", url: "https://verify.example.com/e/1" },
  verify: { path: "result.status", equals: "Inactive" },
  next: "s_done",
  ...(onFailure ? { onFailure } : {}),
});

const workflows = {
  strict: {
    id: "wf_strict",
    tenantId: TENANT,
    name: "No failure branch",
    version: 1,
    status: "active",
    assignedRoles: ["CLIENT_ADMIN"],
    startAt: "s_act",
    steps: [stepFor(null), { id: "s_done", type: "end", outcome: "success", name: "Done" }],
  },
  branching: {
    id: "wf_branch",
    tenantId: TENANT,
    name: "With failure branch",
    version: 1,
    status: "active",
    assignedRoles: ["CLIENT_ADMIN"],
    startAt: "s_act",
    steps: [
      stepFor("s_recover"),
      { id: "s_done", type: "end", outcome: "success", name: "Done" },
      { id: "s_recover", type: "end", outcome: "failure", name: "Needs a human" },
    ],
  },
  unverified: {
    id: "wf_unverified",
    tenantId: TENANT,
    name: "No verify contract",
    version: 1,
    status: "active",
    assignedRoles: ["CLIENT_ADMIN"],
    startAt: "s_act",
    steps: [
      {
        id: "s_act",
        type: "action",
        provider: "browser",
        operation: "CLICK",
        name: "Click",
        input: { selector: "#go", url: "https://verify.example.com/e/1" },
        next: "s_done",
      },
      { id: "s_done", type: "end", outcome: "success", name: "Done" },
    ],
  },
};
for (const workflow of Object.values(workflows)) {
  putTenant(TENANT, "WORKFLOW", workflow);
  putTenant(TENANT, "WORKFLOWVERSION", { ...workflow, id: `${workflow.id}_v000001` });
}

const TOKEN = seedAgent(
  TENANT,
  {
    id: "agent_v",
    tenantId: TENANT,
    name: "Chrome",
    status: "active",
    agentType: "CHROME_EXTENSION",
    capabilities: ["SET_EMPLOYEE_STATUS", "CLICK"],
    lastSeenAt: iso(-1000),
  },
  "tok_v",
);

let seq = 0;
const freshWork = (workflow) => {
  const n = ++seq;
  const runId = `run_v_${n}`;
  const taskId = `task_v_${n}`;
  const operation = workflow.steps[0].operation;
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
    operation,
    executionTarget: "browser_extension",
    destination: "https://verify.example.com",
    input: { selector: "#status", status: "Inactive" },
    expiresAt: iso(300000),
    status: "PENDING",
    workflowId: workflow.id,
    assignedRoles: ["CLIENT_ADMIN"],
    createdBy: "user_admin",
  });
  return { runId, taskId };
};

/** Claim, then report `body`. Returns the run as persisted. */
const runThrough = async (workflow, body) => {
  const work = freshWork(workflow);
  const claimed = await asAgent(TOKEN, "POST /agent/tasks/{id}/claim", { pathParameters: { id: work.taskId } });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  const res = await asAgent(TOKEN, "POST /agent/tasks/{id}/result", {
    pathParameters: { id: work.taskId },
    grant: claimed.body.grant,
    body,
  });
  return { ...work, res, run: loadRun(TENANT, work.runId) };
};

(async () => {
  section("a success the platform cannot substantiate does not advance the run");

  await check("an agent claiming success against a contract it fails records VERIFICATION_FAILED", async () => {
    // The agent says it succeeded, and reports a status the step's contract does not accept.
    const { res, run } = await runThrough(workflows.strict, { ok: true, status: "Active" });
    assert.equal(res.status, 200, "the report is accepted for recording; the verdict is the server's");
    assert.equal(run.status, "FAILED", "the run must not complete on an unverifiable success");
    assert.notEqual(run.currentStepId, "s_done", "the success branch must not be taken");
    assert.ok(run.audit.some((a) => a.type === "VERIFICATION_FAILED"), "the failed verification is audited");
    assert.equal(run.stepResults.s_act.status, "FAILED");
  });

  await check("the verification failure is audited distinctly from an honest reported failure", async () => {
    const lied = await runThrough(workflows.strict, { ok: true, status: "Active" });
    const honest = await runThrough(workflows.strict, { ok: false, error: "the field was not editable" });

    const lieTypes = lied.run.audit.map((a) => a.type);
    const honestTypes = honest.run.audit.map((a) => a.type);
    assert.ok(lieTypes.includes("VERIFICATION_FAILED"), "an unsubstantiated success is VERIFICATION_FAILED");
    assert.ok(honestTypes.includes("AGENT_RESULT_FAILED"), "a reported failure is AGENT_RESULT_FAILED");
    assert.ok(!lieTypes.includes("AGENT_RESULT_FAILED"), "the two must not collapse into one event type");
    assert.ok(!honestTypes.includes("VERIFICATION_FAILED"), "an honest failure is not accused of lying");
    assert.ok(!lieTypes.includes("AGENT_RESULT"), "an unsubstantiated success is never recorded as a success");
  });

  await check("the evidence records what was expected and what was actually reported", async () => {
    const { run } = await runThrough(workflows.strict, { ok: true, status: "Active" });
    const evidence = run.stepResults.s_act.evidence;
    assert.equal(evidence.verified, false, "the evidence states the claim was not substantiated");
    assert.equal(evidence.expected, "Inactive");
    assert.equal(evidence.actual, "Active");
    const entry = run.audit.find((a) => a.type === "VERIFICATION_FAILED");
    assert.equal(entry.details.expected, "Inactive", "the audit entry carries the same pair");
    assert.equal(entry.details.actual, "Active");
    assert.match(entry.message, /could not verify/i, "the message says plainly that AmazFlow could not verify it");
  });

  await check("the agent's own result object is corrected rather than left claiming success", async () => {
    const { run } = await runThrough(workflows.strict, { ok: true, status: "Active" });
    const actionResult = run.stepResults.s_act.actionResult;
    assert.equal(actionResult.ok, false, "the stored result must not say ok:true");
    assert.match(actionResult.error, /Independent action verification failed/);
  });

  section("routing after a failed verification");

  await check("an unverifiable success routes to the step's failure branch when one exists", async () => {
    const { run } = await runThrough(workflows.branching, { ok: true, status: "Active" });
    assert.ok(run.audit.some((a) => a.type === "VERIFICATION_FAILED"), "the verification outcome is unchanged by routing");
    assert.equal(run.status, "FAILED", "the failure branch ends this workflow at its failure end step");
    assert.ok(
      run.audit.some((a) => a.stepId === "s_recover"),
      "the run actually entered the recovery branch rather than stopping where it was",
    );
    assert.ok(!run.audit.some((a) => a.stepId === "s_done"), "the success branch was never entered");
  });

  await check("an unverifiable success ends the run FAILED when no failure branch exists", async () => {
    const { run } = await runThrough(workflows.strict, { ok: true, status: "Active" });
    assert.equal(run.status, "FAILED");
    assert.equal(run.currentStepId, undefined);
  });

  section("verification does not interfere with honest outcomes");

  await check("a success that does satisfy the contract advances and is marked verified", async () => {
    const { run } = await runThrough(workflows.strict, {
      ok: true,
      status: "Inactive",
      evidence: { url: "https://verify.example.com/e/1", observedAt: iso() },
    });
    assert.equal(run.status, "COMPLETED");
    assert.equal(run.stepResults.s_act.status, "SUCCEEDED");
    assert.equal(run.stepResults.s_act.evidence.verified, true);
    assert.ok(run.audit.some((a) => a.type === "AGENT_RESULT"));
    assert.ok(!run.audit.some((a) => a.type === "VERIFICATION_FAILED"));
  });

  await check("a step with no verify contract is not failed for lack of one", async () => {
    const { run } = await runThrough(workflows.unverified, { ok: true });
    assert.equal(run.status, "COMPLETED", "absence of a contract is not a failed contract");
    assert.equal(run.stepResults.s_act.evidence.verified, true);
  });

  await check("a reported failure is not relabelled as a verification failure", async () => {
    const { run } = await runThrough(workflows.branching, { ok: false, error: "element not found" });
    assert.ok(run.audit.some((a) => a.type === "AGENT_RESULT_FAILED"));
    assert.ok(!run.audit.some((a) => a.type === "VERIFICATION_FAILED"));
    assert.equal(run.stepResults.s_act.status, "FAILED");
    assert.equal(run.stepResults.s_act.evidence.verified, true, "verification was never in question -- the agent said it failed");
  });

  done();
})();
