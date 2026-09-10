// Guardrail 2.2 -- execution grants.
//
// The agent's bearer token proves which agent is calling. It is deliberately NOT what authorizes an
// action: it lives in a browser profile and is long-lived. The grant is the authorization boundary,
// and it only works if four properties hold. This suite pins all four.
//
//   1. BINDING     -- the grant names run, organization, workflow, workflow version, step, task,
//                     agent, agent type, execution target, action type, destination and
//                     confirmation state.
//   2. RE-CHECKING -- every one of those is compared against records the server loaded itself, not
//                     against anything the caller re-sends. Proving this needs validly SIGNED
//                     grants with individually wrong fields, which is why mintGrant exists: a test
//                     that could only replay the handler's own grants could never tell "checked"
//                     from "ignored".
//   3. SINGLE USE  -- each tool the grant names is admitted exactly once. One grant carries both
//                     the evidence write and the terminal result, and neither is replayable.
//   4. VALIDITY    -- an expired grant, a tampered signature and a malformed token are all refused.
//
// _Requirements: 31.4, 31.5, 31.6, 31.7, 31.8, 31.18_
const assert = require("node:assert");
const { putTenant, loadRun, asAgent, seedAgent, decodeGrant, mintGrant, iso, reporter } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("GUARDRAIL: execution grants");

const TENANT = "guardg";
const workflow = {
  id: "wf_grant",
  tenantId: TENANT,
  name: "Grant guardrail",
  version: 3, // deliberately not 1, so a workflowVersion mismatch is a real mismatch
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
      input: { selector: "#status", status: "Inactive", url: "https://grant.example.com/e/1" },
      verify: { path: "result.status", equals: "Inactive" },
      next: "s_done",
    },
    { id: "s_done", type: "end", outcome: "success", name: "Done" },
  ],
};
putTenant(TENANT, "WORKFLOW", workflow);
putTenant(TENANT, "WORKFLOWVERSION", { ...workflow, id: "wf_grant_v000003" });

const CHROME = seedAgent(
  TENANT,
  {
    id: "agent_chrome",
    tenantId: TENANT,
    name: "Chrome",
    status: "active",
    agentType: "CHROME_EXTENSION",
    capabilities: ["SET_EMPLOYEE_STATUS"],
    lastSeenAt: iso(-1000),
  },
  "tok_chrome",
);
const DESKTOP = seedAgent(
  TENANT,
  {
    id: "agent_desktop",
    tenantId: TENANT,
    name: "Mac",
    status: "active",
    agentType: "DESKTOP_AGENT",
    capabilities: ["SET_EMPLOYEE_STATUS", "desktop.open_app"],
    lastSeenAt: iso(-1000),
  },
  "tok_desktop",
);

let seq = 0;
/** A fresh run parked on the browser step, with its pending task. */
const freshWork = () => {
  const n = ++seq;
  const runId = `run_grant_${n}`;
  const taskId = `task_grant_${n}`;
  putTenant(TENANT, "RUN", {
    id: runId,
    tenantId: TENANT,
    workflowId: workflow.id,
    workflowVersion: 3,
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
    destination: "https://grant.example.com",
    input: { selector: "#status", status: "Inactive" },
    expiresAt: iso(300000),
    status: "PENDING",
    workflowId: workflow.id,
    assignedRoles: ["CLIENT_ADMIN"],
    createdBy: "user_admin",
  });
  return { runId, taskId };
};

const claim = (taskId, token = CHROME) => asAgent(token, "POST /agent/tasks/{id}/claim", { pathParameters: { id: taskId } });
const submit = (taskId, grant, body, token = CHROME) =>
  asAgent(token, "POST /agent/tasks/{id}/result", { pathParameters: { id: taskId }, grant, body });
const record = (grant, body) => asAgent(null, "POST /agent/tools/record-step-result", { body: { grant, ...body } });

/** The correct expectation set for a given task, from which each single-field mismatch is derived. */
const correctFor = ({ runId, taskId }) => ({
  runId,
  tenantId: TENANT,
  workflowId: workflow.id,
  workflowVersion: 3,
  stepId: "s_act",
  taskId,
  agentId: "agent_chrome",
  agentType: "CHROME_EXTENSION",
  executionTarget: "browser_extension",
  actionType: "SET_EMPLOYEE_STATUS",
  destination: "https://grant.example.com",
});

(async () => {
  /* ------------------------------------------------------------------------------ binding ----- */
  section("a claim mints a grant that binds every field");

  await check("the grant binds run, organization, workflow, version, step, task, agent, surface, action, destination and confirmation state", async () => {
    const work = freshWork();
    const res = await claim(work.taskId);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const payload = decodeGrant(res.body.grant);
    const expected = correctFor(work);
    for (const [field, value] of Object.entries(expected))
      assert.equal(payload[field], value, `grant must bind ${field} as ${value}, got ${payload[field]}`);
    assert.equal(payload.confirmationGranted, false, "confirmation state is bound");
    assert.deepEqual(payload.allowedTools, ["record_step_result", "agent.report_result"]);
    assert.ok(payload.grantId, "the grant is individually identified");
    assert.ok(payload.expiresAt > payload.issuedAt, "the grant carries a validity period");
  });

  await check("a granted confirmation is carried on the grant rather than re-asserted by the agent", async () => {
    const work = freshWork();
    const run = loadRun(TENANT, work.runId);
    run.confirmedStepIds = ["s_act"];
    putTenant(TENANT, "RUN", run);
    const res = await claim(work.taskId);
    assert.equal(decodeGrant(res.body.grant).confirmationGranted, true);
  });

  /* --------------------------------------------------------------------------- re-checking ----- */
  section("every bound field is re-checked against server-loaded records");

  // Each case presents a validly signed grant whose single named field disagrees with the record
  // the server loads for itself. A field the handler did not check would let the submission through.
  const MISMATCHES = {
    runId: "run_somewhere_else",
    tenantId: "another-org",
    workflowId: "wf_other",
    workflowVersion: 1,
    stepId: "s_done",
    taskId: "task_other",
    agentId: "agent_desktop",
    agentType: "DESKTOP_AGENT",
    executionTarget: "desktop_agent",
    actionType: "CLICK",
  };

  for (const [field, wrongValue] of Object.entries(MISMATCHES)) {
    await check(`a grant whose ${field} disagrees with the loaded records is refused`, async () => {
      const work = freshWork();
      await claim(work.taskId);
      const grant = mintGrant({ ...correctFor(work), [field]: wrongValue });
      const res = await submit(work.taskId, grant, { ok: true, status: "Inactive" });
      assert.ok(res.status === 403 || res.status === 404, `expected a refusal, got ${res.status}: ${res.raw}`);
      assert.notEqual(loadRun(TENANT, work.runId).status, "COMPLETED", "the run must not have advanced");
    });
  }

  // KNOWN GAP against requirement 31.5. `destination` is the twelfth bound field -- the origin a
  // browser step may act on, or the application a desktop step may drive -- and requirement 31.4 is
  // satisfied: the claim mints it onto the grant, and the agent honours it. But it is absent from
  // the re-check loop in ALL THREE copies of the verifier (the deployed template, the canonical
  // handler, and packages/engine/src/execution-grant.ts), so a validly signed grant naming a
  // different destination is accepted on the way back in.
  //
  // Practically the exposure is narrow: the destination is derived from the step's own input, and
  // the agent that received the grant is the only party holding it. It matters because it is the
  // one bound field whose enforcement lives entirely agent-side, and agent-side is exactly where
  // this platform's threat model says not to put an authorization decision.
  //
  // This is pinned rather than asserted-as-fixed, deliberately: Phase 0 is not allowed to change
  // behaviour, and a red build for the whole phase would bury the finding rather than surface it.
  // The assertion locks in today's behaviour, so the day the field is added to the loop this test
  // fails and forces this comment to be deleted in the same commit.
  await check("KNOWN GAP (req 31.5): destination is bound but not re-checked server-side", async () => {
    const work = freshWork();
    await claim(work.taskId);
    const grant = mintGrant({ ...correctFor(work), destination: "https://somewhere-the-server-never-named.example.com" });
    const res = await submit(work.taskId, grant, { ok: true, status: "Inactive" });
    assert.equal(
      res.status,
      200,
      "if this now refuses, destination has been added to the re-check loop -- delete this guardrail and move it up into the MISMATCHES table",
    );
    console.log("        NOTE: a grant naming an unrelated destination was accepted. Requirement 31.5 is not yet met for this field.");
  });

  await check("a grant naming a tool it does not authorize is refused", async () => {
    const work = freshWork();
    await claim(work.taskId);
    // Authorizes only the evidence write, then is presented for the terminal result.
    const grant = mintGrant({ ...correctFor(work), allowedTools: ["record_step_result"] });
    const res = await submit(work.taskId, grant, { ok: true, status: "Inactive" });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /not authorized/i);
    assert.notEqual(loadRun(TENANT, work.runId).status, "COMPLETED");
  });

  await check("a result presented with no grant at all is refused", async () => {
    const work = freshWork();
    await claim(work.taskId);
    const res = await submit(work.taskId, undefined, { ok: true, status: "Inactive" });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /execution grant/i);
    assert.equal(loadRun(TENANT, work.runId).status, "WAITING_AGENT");
  });

  /* ------------------------------------------------------------------------- scope mismatch ---- */
  section("a grant is refused against a scope other than the one it was issued for");

  await check("a grant issued for one task cannot be presented against another", async () => {
    const first = freshWork();
    const second = freshWork();
    const claimed = await claim(first.taskId);
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    await claim(second.taskId);
    const res = await submit(second.taskId, claimed.body.grant, { ok: true, status: "Inactive" });
    assert.ok(res.status >= 400, `a cross-task grant must be refused, got ${res.status}`);
    assert.notEqual(loadRun(TENANT, second.runId).status, "COMPLETED");
  });

  await check("a grant issued to one agent cannot be used by another", async () => {
    const work = freshWork();
    const claimed = await claim(work.taskId, CHROME);
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    const res = await submit(work.taskId, claimed.body.grant, { ok: true, status: "Inactive" }, DESKTOP);
    assert.ok(res.status >= 400, `a grant must not travel between agents, got ${res.status}`);
    assert.notEqual(loadRun(TENANT, work.runId).status, "COMPLETED");
  });

  /* ----------------------------------------------------------------------------- single use ---- */
  section("each tool a grant names is admitted exactly once");

  await check("one grant admits the evidence write once and the terminal result once", async () => {
    const work = freshWork();
    const claimed = await claim(work.taskId);
    const grant = claimed.body.grant;

    const evidence = await record(grant, { stepId: "s_act", status: "SUCCEEDED", note: "observed at https://grant.example.com/e/1" });
    assert.equal(evidence.status, 200, JSON.stringify(evidence.body));

    const result = await submit(work.taskId, grant, { ok: true, status: "Inactive" });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(loadRun(TENANT, work.runId).status, "COMPLETED");
  });

  await check("the evidence write cannot be replayed under the same grant", async () => {
    const work = freshWork();
    const claimed = await claim(work.taskId);
    await record(claimed.body.grant, { stepId: "s_act", status: "SUCCEEDED", note: "first" });
    const replay = await record(claimed.body.grant, { stepId: "s_act", status: "SUCCEEDED", note: "second" });
    assert.equal(replay.status, 409);
    assert.match(replay.body.error, /already used/i);
  });

  await check("the terminal result cannot be replayed under the same grant", async () => {
    const work = freshWork();
    const claimed = await claim(work.taskId);
    const first = await submit(work.taskId, claimed.body.grant, { ok: true, status: "Inactive" });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const replay = await submit(work.taskId, claimed.body.grant, { ok: true, status: "Inactive" });
    assert.equal(replay.status, 409);
  });

  /* ------------------------------------------------------------------------------- validity ---- */
  section("validity period, signature and format");

  await check("a grant presented after its validity period is refused", async () => {
    const work = freshWork();
    await claim(work.taskId);
    const issuedAt = Math.floor(Date.now() / 1000) - 3600;
    const expired = mintGrant({ ...correctFor(work), issuedAt, expiresAt: issuedAt + 300 });
    const res = await submit(work.taskId, expired, { ok: true, status: "Inactive" });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /expired/i);
    assert.equal(loadRun(TENANT, work.runId).status, "WAITING_AGENT");
  });

  await check("a grant expiring exactly now is refused rather than admitted", async () => {
    const work = freshWork();
    await claim(work.taskId);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const res = await submit(work.taskId, mintGrant({ ...correctFor(work), expiresAt: nowSeconds }), { ok: true, status: "Inactive" });
    assert.equal(res.status, 401, "the boundary is exclusive: an expiry of now is already past");
  });

  await check("a grant with a tampered payload is refused on signature", async () => {
    const work = freshWork();
    const claimed = await claim(work.taskId);
    const [version, encoded, signature] = claimed.body.grant.split(".");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
    payload.tenantId = "another-org";
    const forged = `${version}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${signature}`;
    const res = await submit(work.taskId, forged, { ok: true, status: "Inactive" });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /signature/i);
  });

  await check("a malformed grant is refused before anything is loaded", async () => {
    const work = freshWork();
    await claim(work.taskId);
    for (const bad of ["", "not-a-grant", "v2.abc.def", "v1.abc", "v1.abc.def.ghi"]) {
      const res = await submit(work.taskId, bad, { ok: true, status: "Inactive" });
      assert.ok(res.status >= 400, `"${bad}" must be refused, got ${res.status}`);
    }
    assert.equal(loadRun(TENANT, work.runId).status, "WAITING_AGENT");
  });

  done();
})();
