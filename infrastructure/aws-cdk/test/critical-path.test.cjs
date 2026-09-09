// Critical-path check for the deployed control plane: the browser agent's full
// login -> claim -> act -> record_step_result -> result -> run completion chain,
// plus the authorization properties that chain is supposed to guarantee.
const { store, crypto } = require("./harness.cjs");
const os = require("node:os");
const path = require("node:path");
const { writeTo } = require("./extract-inline-handler.cjs");
const { handler } = require(writeTo(path.join(os.tmpdir(), `amazflow-inline-${process.pid}.cjs`)));
const assert = require("node:assert");

const now = () => new Date().toISOString();
const TENANT = "acme";
const put = (pk, sk, doc, extra = {}) =>
  store.set(`${pk}|${sk}`, { pk: { S: pk }, sk: { S: sk }, document: { S: JSON.stringify(doc) }, updatedAt: { S: now() }, ...extra });

const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");

// --- seed: organization, published workflow, run parked at a browser step, its task, an agent
const workflow = {
  id: "wf_offboard", tenantId: TENANT, name: "Deactivate departing employee", version: 1,
  status: "active", assignedRoles: ["CLIENT_ADMIN"], startAt: "s_set",
  steps: [
    { id: "s_set", type: "action", provider: "browser", operation: "SET_EMPLOYEE_STATUS", name: "Set status to Inactive",
      input: { selector: '[data-amazflow="employee-status"]', status: "Inactive" },
      verify: { path: "result.status", equals: "Inactive" }, next: "s_done" },
    { id: "s_done", type: "end", outcome: "success", name: "Offboarding complete" },
  ],
};
const run = {
  id: "run_1", tenantId: TENANT, workflowId: "wf_offboard", workflowVersion: 1,
  status: "WAITING_AGENT", currentStepId: "s_set", createdBy: "user_admin",
  confirmedStepIds: [], stepResults: {}, context: { input: {}, values: {}, lastAction: null },
  audit: [{ id: "aud_1", at: now(), type: "RUN_STARTED", message: "Workflow execution started", details: {} }],
  createdAt: now(), updatedAt: now(),
};
const task = {
  id: "task_1", runId: "run_1", tenantId: TENANT, stepId: "s_set", provider: "browser",
  operation: "SET_EMPLOYEE_STATUS", input: { selector: '[data-amazflow="employee-status"]', status: "Inactive" },
  expiresAt: new Date(Date.now() + 5 * 60000).toISOString(), status: "PENDING",
  workflowId: "wf_offboard", assignedRoles: ["CLIENT_ADMIN"], createdBy: "user_admin",
};
put(`TENANT#${TENANT}`, "WORKFLOW#wf_offboard", workflow);
put(`TENANT#${TENANT}`, "WORKFLOWVERSION#wf_offboard_v000001", { ...workflow, id: "wf_offboard_v000001" });
put(`TENANT#${TENANT}`, "RUN#run_1", run);
put(`TENANT#${TENANT}`, "TASK#task_1", task);
put(`TENANT#${TENANT}`, "AGENT#agent_a", { id: "agent_a", tenantId: TENANT, name: "Ops laptop", status: "active" });
put(`TENANT#${TENANT}`, "AGENT#agent_b", { id: "agent_b", tenantId: TENANT, name: "Second laptop", status: "active" });
put(`TENANT#other`, "AGENT#agent_x", { id: "agent_x", tenantId: "other", name: "Other tenant", status: "active" });
const TOKEN_A = "tok_a", TOKEN_B = "tok_b", TOKEN_X = "tok_x";
put("PLATFORM", `AGENTCRED#${hashToken(TOKEN_A)}`, { agentId: "agent_a", tenantId: TENANT, userId: "user_admin", userRole: "CLIENT_ADMIN", status: "active" });
put("PLATFORM", `AGENTCRED#${hashToken(TOKEN_B)}`, { agentId: "agent_b", tenantId: TENANT, userId: "user_admin", userRole: "CLIENT_ADMIN", status: "active" });
put("PLATFORM", `AGENTCRED#${hashToken(TOKEN_X)}`, { agentId: "agent_x", tenantId: "other", userId: "u_x", userRole: "CLIENT_ADMIN", status: "active" });

const call = async (routeKey, { token, grant, body, pathParameters } = {}) => {
  const headers = {};
  if (token) headers["x-amazflow-agent-token"] = token;
  if (grant) headers["x-amazflow-execution-grant"] = grant;
  const res = await handler({ routeKey, headers, pathParameters, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const loadRun = () => JSON.parse(store.get(`TENANT#${TENANT}|RUN#run_1`).document.S);
const loadTask = () => JSON.parse(store.get(`TENANT#${TENANT}|TASK#task_1`).document.S);

let pass = 0, fail = 0;
const check = (name, fn) => fn().then(() => { pass++; console.log("  PASS  " + name); },
  (e) => { fail++; console.log("  FAIL  " + name + "\n        " + (e && e.message)); });

(async () => {
  console.log("\nCRITICAL PATH: browser agent execution\n");

  await check("agent sees only its own tenant's pending task", async () => {
    const mine = await call("GET /agent/tasks", { token: TOKEN_A });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.length, 1);
    assert.equal(mine.body[0].id, "task_1");
    const theirs = await call("GET /agent/tasks", { token: TOKEN_X });
    assert.deepEqual(theirs.body, [], "cross-tenant agent must see nothing");
  });

  await check("result is refused without an execution grant", async () => {
    const res = await call("POST /agent/tasks/{id}/result", { token: TOKEN_A, pathParameters: { id: "task_1" }, body: { ok: true, status: "Inactive" } });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /execution grant/i);
    assert.equal(loadRun().status, "WAITING_AGENT", "run must not have advanced");
  });

  let grant, stepId;
  await check("agent A claims the task and receives a scoped execution grant", async () => {
    const res = await call("POST /agent/tasks/{id}/claim", { token: TOKEN_A, pathParameters: { id: "task_1" } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    grant = res.body.grant; stepId = res.body.stepId;
    assert.ok(grant && grant.startsWith("v1."), "a signed v1 grant is returned");
    assert.equal(res.body.runId, "run_1");
    assert.equal(stepId, "s_set");
    const payload = JSON.parse(Buffer.from(grant.split(".")[1], "base64url").toString());
    assert.deepEqual(payload.allowedTools, ["record_step_result", "agent.report_result"]);
    assert.equal(payload.runId, "run_1");
    assert.equal(payload.tenantId, TENANT);
    assert.equal(payload.workflowVersion, 1);
    assert.equal(payload.stepId, "s_set");
    assert.equal(loadTask().status, "CLAIMED");
    assert.equal(loadTask().claimedBy, "agent_a");
    assert.ok(loadRun().audit.some((a) => a.type === "AGENT_TASK_CLAIMED"), "claim is audited");
  });

  await check("a second agent cannot claim the same task", async () => {
    const res = await call("POST /agent/tasks/{id}/claim", { token: TOKEN_B, pathParameters: { id: "task_1" } });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already running/i);
  });

  await check("a claimed task disappears from the pending poll", async () => {
    const res = await call("GET /agent/tasks", { token: TOKEN_B });
    assert.deepEqual(res.body, []);
  });

  await check("record_step_result writes evidence into the run's audit trail", async () => {
    const res = await call("POST /agent/tools/record-step-result", {
      body: { grant, stepId, status: "SUCCEEDED", note: "SET_EMPLOYEE_STATUS on [data-amazflow=\"employee-status\"] at https://hris.example.com/e/4471" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const entry = loadRun().audit.find((a) => a.type === "EXECUTOR_PROGRESS");
    assert.ok(entry, "an EXECUTOR_PROGRESS entry exists");
    assert.match(entry.details.note, /hris\.example\.com/);
  });

  await check("the same grant cannot be replayed for record_step_result", async () => {
    const res = await call("POST /agent/tools/record-step-result", { body: { grant, stepId, status: "SUCCEEDED", note: "replay" } });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already used/i);
  });

  await check("the terminal result completes the run, with evidence and audit", async () => {
    const res = await call("POST /agent/tasks/{id}/result", {
      token: TOKEN_A, grant, pathParameters: { id: "task_1" },
      body: { ok: true, status: "Inactive", evidence: { url: "https://hris.example.com/e/4471", title: "Employee 4471", observedAt: now() } },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const r = loadRun();
    assert.equal(r.status, "COMPLETED", "run reaches COMPLETED");
    const sr = r.stepResults.s_set;
    assert.equal(sr.status, "SUCCEEDED");
    assert.equal(sr.evidence.agentId, "agent_a");
    assert.equal(sr.evidence.verified, true);
    assert.equal(sr.evidence.page.url, "https://hris.example.com/e/4471");
    assert.ok(sr.evidence.grantId, "the grant that authorized the write is recorded");
    assert.ok(r.audit.some((a) => a.type === "AGENT_RESULT"));
    assert.ok(r.audit.some((a) => a.type === "COMPLETED"));
    assert.equal(loadTask().status, "COMPLETED");
  });

  await check("the result grant cannot be replayed", async () => {
    const res = await call("POST /agent/tasks/{id}/result", { token: TOKEN_A, grant, pathParameters: { id: "task_1" }, body: { ok: true, status: "Inactive" } });
    assert.equal(res.status, 409);
  });

  // --- second run: a browser that lies about success must not advance the workflow
  console.log("\nINDEPENDENT VERIFICATION\n");
  put(`TENANT#${TENANT}`, "RUN#run_2", { ...run, id: "run_2", audit: [{ id: "aud_1", at: now(), type: "RUN_STARTED", message: "started", details: {} }] });
  put(`TENANT#${TENANT}`, "TASK#task_2", { ...task, id: "task_2", runId: "run_2", status: "PENDING" });

  await check("a self-declared success that fails the step's verify contract is rejected", async () => {
    const claim = await call("POST /agent/tasks/{id}/claim", { token: TOKEN_A, pathParameters: { id: "task_2" } });
    assert.equal(claim.status, 200, JSON.stringify(claim.body));
    const res = await call("POST /agent/tasks/{id}/result", {
      token: TOKEN_A, grant: claim.body.grant, pathParameters: { id: "task_2" },
      body: { ok: true, status: "Active" }, // claims success, but the step requires "Inactive"
    });
    assert.equal(res.status, 200);
    const r2 = JSON.parse(store.get(`TENANT#${TENANT}|RUN#run_2`).document.S);
    assert.equal(r2.status, "FAILED", "the run must not complete on an unverifiable success");
    assert.ok(r2.audit.some((a) => a.type === "VERIFICATION_FAILED"), "the failed verification is audited");
    assert.equal(r2.stepResults.s_set.evidence.verified, false);
    assert.equal(r2.stepResults.s_set.evidence.expected, "Inactive");
    assert.equal(r2.stepResults.s_set.evidence.actual, "Active");
  });

  // --- third run: a stalled claim is released back to the pool
  console.log("\nSTALLED CLAIM RECOVERY\n");
  put(`TENANT#${TENANT}`, "RUN#run_3", { ...run, id: "run_3", audit: [{ id: "aud_1", at: now(), type: "RUN_STARTED", message: "started", details: {} }] });
  put(`TENANT#${TENANT}`, "TASK#task_3", {
    ...task, id: "task_3", runId: "run_3", status: "CLAIMED", claimedBy: "agent_gone",
    claimedAt: new Date(Date.now() - 600000).toISOString(),
    claimExpiresAt: new Date(Date.now() - 300000).toISOString(),  // lease expired 5 min ago
    expiresAt: new Date(Date.now() + 120000).toISOString(),        // task itself still has time
  });

  await check("the sweep returns an abandoned claim to PENDING instead of timing the run out", async () => {
    const res = await handler({ source: "amazflow.sweep" });
    assert.equal(res.releasedClaims, 1, "one claim released");
    const t3 = JSON.parse(store.get(`TENANT#${TENANT}|TASK#task_3`).document.S);
    assert.equal(t3.status, "PENDING");
    assert.equal(t3.claimedBy, null);
    const r3 = JSON.parse(store.get(`TENANT#${TENANT}|RUN#run_3`).document.S);
    assert.equal(r3.status, "WAITING_AGENT", "the run keeps waiting rather than being timed out");
  });

  await check("another agent can then pick the released task up", async () => {
    const res = await call("POST /agent/tasks/{id}/claim", { token: TOKEN_B, pathParameters: { id: "task_3" } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(JSON.parse(store.get(`TENANT#${TENANT}|TASK#task_3`).document.S).claimedBy, "agent_b");
  });

  // --- one browser, many sign-ins: the agent record must not multiply
  console.log("\nAGENT REGISTRATION IDEMPOTENCE\n");
  const asAdmin = (body) =>
    handler({
      routeKey: "POST /agent-authorizations",
      requestContext: { authorizer: { jwt: { claims: { sub: "user_admin", "custom:tenant_id": TENANT, "cognito:groups": "[CLIENT_ADMIN]" } } } },
      headers: {},
      body: JSON.stringify(body),
    }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
  const agentsNow = () => [...store.values()].filter((i) => i.sk.S.startsWith("AGENT#")).map((i) => JSON.parse(i.document.S));

  let firstToken;
  await check("signing in twice from one browser reuses its agent record", async () => {
    const before = agentsNow().length;
    const one = await asAdmin({ name: "jaylen · Chrome", installationId: "install-abc" });
    assert.equal(one.status, 201, JSON.stringify(one.body));
    const first = await call("POST /agent-authorizations/{code}/exchange", { pathParameters: { code: one.body.code } });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    firstToken = first.body.token;

    const two = await asAdmin({ name: "jaylen · Chrome", installationId: "install-abc" });
    assert.equal(two.status, 201, JSON.stringify(two.body));
    assert.equal(two.body.agent.id, one.body.agent.id, "same installation must map to the same agent");
    assert.equal(agentsNow().length, before + 1, "exactly one new agent record for the two sign-ins");
  });

  await check("the superseded credential from the earlier sign-in stops working", async () => {
    const res = await call("GET /agent/tasks", { token: firstToken });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /sign in again/i);
  });

  await check("a different browser still gets its own agent", async () => {
    const before = agentsNow().length;
    const other = await asAdmin({ name: "jaylen · Laptop", installationId: "install-xyz" });
    assert.equal(other.status, 201);
    assert.equal(agentsNow().length, before + 1);
    const ids = new Set(agentsNow().filter((a) => a.installationId).map((a) => a.installationId));
    assert.equal(ids.size, 2, "two installations, two agents");
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
