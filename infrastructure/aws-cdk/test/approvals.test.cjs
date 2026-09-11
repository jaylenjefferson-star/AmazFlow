// Task 18.6 -- Approvals test suite.
//
// _Requirements: 34.14_
//
// Cross-organization refusal (a caller from another organization) and the exhaustive per-status
// refusal sweep (every non-WAITING_APPROVAL status) are already owned elsewhere --
// isolation-api.test.cjs and guardrail-state-machine.test.cjs respectively -- and are not repeated
// here. This suite is the one place the remaining approval-specific behaviour is pinned together:
// which branch a decision advances to, the two INDEPENDENT ways a decision can be refused (the
// platform permission, and the step's own permitted-roles list -- a principal can hold the first
// and still fail the second), refusal of a step already decided, and that the deciding user and
// role are recorded rather than just the outcome.
const assert = require("node:assert");
const { put, putTenant, loadRun, asUser, iso, reporter } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("APPROVALS");

const TENANT = "apprvorg";

const seedPrincipal = (role, group) => {
  const username = `${role.toLowerCase()}@${TENANT}.example.com`;
  put(`TENANT#${TENANT}`, `MEMBERSHIP#${username}`, {
    orgId: TENANT,
    username,
    role,
    teamIds: [],
    status: "active",
    createdAt: iso(-86400000),
    updatedAt: iso(-86400000),
  });
  return { userId: username, email: username, tenantId: TENANT, group };
};

// step.roles is checked against the caller's COARSE group (a Phase-1-era mechanism the fine-role
// permission layer sits in front of, not behind). Every fine role that holds approval:decide
// (ORG_OWNER, ORG_ADMIN, WORKFLOW_BUILDER, APPROVER) maps to the CLIENT_ADMIN group -- there is no
// real principal holding the permission whose group is FRONTLINE -- so the step-roles refusal below
// is demonstrated the way it actually occurs: the SAME permitted principal, refused by a step whose
// own roles list happens not to include their group, on a step that does.
const ADMIN_APPROVER = seedPrincipal("APPROVER", "CLIENT_ADMIN");
const OPERATOR = seedPrincipal("OPERATOR", "FRONTLINE");

const workflow = {
  id: "wf_apprv",
  tenantId: TENANT,
  name: "Approvals suite workflow",
  version: 1,
  status: "active",
  assignedRoles: ["CLIENT_ADMIN", "FRONTLINE"],
  startAt: "s_approve",
  steps: [
    { id: "s_approve", type: "approval", name: "Approve", message: "Approve this", roles: ["CLIENT_ADMIN"], next: "s_done", onReject: "s_fail" },
    { id: "s_approve_frontline", type: "approval", name: "Approve (frontline)", message: "Approve this too", roles: ["FRONTLINE"], next: "s_done", onReject: "s_fail" },
    { id: "s_done", type: "end", outcome: "success", name: "Done" },
    { id: "s_fail", type: "end", outcome: "failure", name: "Rejected" },
  ],
};
putTenant(TENANT, "WORKFLOW", workflow);
putTenant(TENANT, "WORKFLOWVERSION", { ...workflow, id: "wf_apprv_v000001" });

let runSeq = 0;
const seedRun = (currentStepId) => {
  const id = `run_apprv_${++runSeq}`;
  putTenant(TENANT, "RUN", {
    id,
    tenantId: TENANT,
    workflowId: workflow.id,
    workflowVersion: 1,
    status: "WAITING_APPROVAL",
    currentStepId,
    createdBy: ADMIN_APPROVER.userId,
    confirmedStepIds: [],
    stepResults: {},
    context: { input: {}, values: {}, lastAction: null },
    audit: [{ id: "aud_1", at: iso(-60000), type: "RUN_STARTED", message: "started", details: {} }],
    createdAt: iso(-60000),
    updatedAt: iso(-60000),
  });
  return id;
};

const decide = (as, runId, stepId, approved) =>
  asUser(as, "POST /runs/{id}/approvals/{stepId}", { pathParameters: { id: runId, stepId }, body: { approved } });

(async () => {
  section("a decision advances the correct branch");

  await check("approved advances to the step's next step", async () => {
    const runId = seedRun("s_approve");
    const res = await decide(ADMIN_APPROVER, runId, "s_approve", true);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(loadRun(TENANT, runId).status, "COMPLETED");
  });

  await check("rejected routes to the step's onReject branch", async () => {
    const runId = seedRun("s_approve");
    const res = await decide(ADMIN_APPROVER, runId, "s_approve", false);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(loadRun(TENANT, runId).status, "FAILED");
  });

  section("two independent ways a decision is refused");

  await check("a role lacking the platform permission is refused, even naming the step's own roles", async () => {
    const runId = seedRun("s_approve");
    const res = await decide(OPERATOR, runId, "s_approve", true);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(loadRun(TENANT, runId).status, "WAITING_APPROVAL", "the run is untouched by the refused attempt");
  });

  await check("a principal holding the platform permission is still refused when THIS step's own roles do not include their group", async () => {
    const runId = seedRun("s_approve_frontline"); // roles: ["FRONTLINE"] -- ADMIN_APPROVER's group is not on it
    const res = await decide(ADMIN_APPROVER, runId, "s_approve_frontline", true);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.match(res.body.error, /not authorized to decide this approval/i);
    assert.equal(loadRun(TENANT, runId).status, "WAITING_APPROVAL");
  });

  await check("the same principal succeeds on a step whose roles do include their group", async () => {
    const runId = seedRun("s_approve"); // roles: ["CLIENT_ADMIN"]
    const res = await decide(ADMIN_APPROVER, runId, "s_approve", true);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(loadRun(TENANT, runId).status, "COMPLETED");
  });

  section("a step already decided cannot be decided again");

  await check("deciding a step a second time is refused, not silently accepted or re-recorded", async () => {
    const runId = seedRun("s_approve");
    const first = await decide(ADMIN_APPROVER, runId, "s_approve", true);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const auditLengthAfterFirst = loadRun(TENANT, runId).audit.length;
    const second = await decide(ADMIN_APPROVER, runId, "s_approve", true);
    assert.equal(second.status, 409, `a decided step must refuse a second decision, got ${second.status}`);
    assert.equal(loadRun(TENANT, runId).audit.length, auditLengthAfterFirst, "the second attempt is not audited as a decision");
  });

  section("the deciding user and role are recorded, not just the outcome");

  await check("an approval's audit event names who decided it and in what role", async () => {
    const runId = seedRun("s_approve");
    await decide(ADMIN_APPROVER, runId, "s_approve", true);
    const decision = loadRun(TENANT, runId).audit.find((entry) => entry.type === "APPROVED");
    assert.ok(decision, "the approval is its own audited event");
    assert.equal(decision.details?.by, ADMIN_APPROVER.userId);
    assert.ok(decision.details?.role, "the deciding role is recorded alongside the deciding user");
  });

  await check("a rejection's audit event names who decided it and in what role", async () => {
    const runId = seedRun("s_approve");
    await decide(ADMIN_APPROVER, runId, "s_approve", false);
    const decision = loadRun(TENANT, runId).audit.find((entry) => entry.type === "REJECTED");
    assert.ok(decision, "the rejection is its own audited event");
    assert.equal(decision.details?.by, ADMIN_APPROVER.userId);
    assert.ok(decision.details?.role, "the deciding role is recorded alongside the deciding user");
  });

  done();
})();
