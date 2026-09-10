// Guardrail 2.7a -- the positive live-run status set fails open.
//
// The concurrency ceiling counts runs that are "in flight". How that set is defined decides what
// happens when someone adds a run status later and forgets this line.
//
//   A NEGATIVE set ("everything except COMPLETED, FAILED, ...") would count an unrecognized status
//   as live. A new status would silently consume the customer's ceiling and start refusing real
//   work -- the platform failing CLOSED against its own customer, for a reason no error message
//   could explain.
//
//   A POSITIVE set ("RUNNING, WAITING_AGENT, WAITING_APPROVAL, AWAITING_CONFIRMATION") excludes
//   anything it does not recognize. A forgotten status under-counts, which lets one extra run start.
//   That is the right direction to fail: a bounded over-admission the customer can see, rather than
//   an unexplainable refusal.
//
// This pins the positive-set behaviour, the exact membership of the set, and the response shape the
// ceiling returns.
//
// The companion guardrail for "never retry an action whose side effect could not be ruled out" lives
// in packages/engine/src/guardrail-reconciliation.test.ts, because reconciliation is implemented in
// the shared engine rather than in the deployed template.
//
// _Requirements: 31.15, 31.16, 8.11, 31.18_
const assert = require("node:assert");
const { put, putTenant, asUser, iso, reporter } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("GUARDRAIL: the live-run status set fails open");

const TENANT = "guardr";
const ADMIN = { userId: "user_admin", tenantId: TENANT, group: "CLIENT_ADMIN" };

// The positive set, stated here so a change to the handler's own list fails this test.
const LIVE_RUN_STATUSES = ["RUNNING", "WAITING_AGENT", "WAITING_APPROVAL", "AWAITING_CONFIRMATION"];
// Everything else the platform persists, plus a status it has never heard of.
const NOT_LIVE = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"];
const UNRECOGNIZED = "SOME_STATUS_ADDED_LATER";

// A workflow with no action steps, so preflight is satisfied without any agent installation and the
// only thing standing between a request and a new run is the ceiling itself.
const workflow = {
  id: "wf_limit",
  tenantId: TENANT,
  name: "Ceiling guardrail",
  version: 1,
  status: "active",
  assignedRoles: ["CLIENT_ADMIN"],
  startAt: "s_done",
  steps: [{ id: "s_done", type: "end", outcome: "success", name: "Done" }],
};
putTenant(TENANT, "WORKFLOW", workflow);
putTenant(TENANT, "WORKFLOWVERSION", { ...workflow, id: "wf_limit_v000001" });

const setLimit = (maxConcurrentRuns) =>
  put("PLATFORM", `ORG#${TENANT}`, {
    id: "org_guardr",
    name: "Ceiling Ltd",
    slug: TENANT,
    status: "active",
    plan: "design_partner",
    settings: { maxConcurrentRuns },
    createdAt: iso(-86400000),
    updatedAt: iso(),
  });

let seq = 0;
/** Persist a run in `status` without going through the engine. */
const seedRun = (status, tenantId = TENANT) => {
  const id = `run_limit_${++seq}`;
  putTenant(tenantId, "RUN", {
    id,
    tenantId,
    workflowId: workflow.id,
    workflowVersion: 1,
    status,
    currentStepId: undefined,
    createdBy: "user_admin",
    confirmedStepIds: [],
    stepResults: {},
    context: { input: {}, values: {}, lastAction: null },
    audit: [{ id: "aud_1", at: iso(-60000), type: "RUN_STARTED", message: "started", details: {} }],
    createdAt: iso(-60000),
    updatedAt: iso(-60000),
  });
  return id;
};

/** Remove every run so each case counts only what it seeded. */
const clearRuns = () => {
  const { store } = require("./guardrail-support.cjs");
  for (const key of [...store.keys()]) if (key.includes("|RUN#")) store.delete(key);
};

const startRun = () => asUser(ADMIN, "POST /workflows/{id}/runs", { pathParameters: { id: workflow.id }, body: {} });

(async () => {
  section("each live status counts toward the ceiling");

  for (const status of LIVE_RUN_STATUSES) {
    await check(`a run in ${status} counts as in flight`, async () => {
      clearRuns();
      setLimit(1);
      seedRun(status);
      const res = await startRun();
      assert.equal(res.status, 429, `${status} must consume the ceiling, got ${res.status}`);
      assert.equal(res.body.inFlight, 1);
    });
  }

  section("nothing outside the live set counts");

  for (const status of NOT_LIVE) {
    await check(`a run in ${status} does not count as in flight`, async () => {
      clearRuns();
      setLimit(1);
      seedRun(status);
      const res = await startRun();
      assert.equal(res.status, 201, `${status} must not consume the ceiling, got ${res.status}: ${res.raw}`);
    });
  }

  await check("a status the platform does not recognize is excluded, so the ceiling fails open", async () => {
    clearRuns();
    setLimit(1);
    seedRun(UNRECOGNIZED);
    const res = await startRun();
    assert.equal(
      res.status,
      201,
      `an unrecognized status must be excluded from the count so the ceiling fails open, got ${res.status}: ${res.raw}`,
    );
  });

  await check("several unrecognized statuses still do not block a customer's work", async () => {
    clearRuns();
    setLimit(2);
    for (let i = 0; i < 5; i++) seedRun(UNRECOGNIZED);
    const res = await startRun();
    assert.equal(res.status, 201, "the set is positive, so unknown statuses can never accumulate into a refusal");
  });

  section("the ceiling's response and scope");

  await check("the refusal states the configured limit and the current in-flight count", async () => {
    clearRuns();
    setLimit(2);
    seedRun("RUNNING");
    seedRun("WAITING_AGENT");
    const res = await startRun();
    assert.equal(res.status, 429);
    assert.equal(res.body.limit, 2, "the configured limit is stated");
    assert.equal(res.body.inFlight, 2, "the current count is stated");
    assert.match(res.body.error, /2 of 2/, "the message names both numbers rather than saying 'too many'");
  });

  await check("the count is scoped to the organization, not the whole platform", async () => {
    clearRuns();
    setLimit(1);
    // Another organization saturates its own ceiling. This one must be unaffected.
    for (let i = 0; i < 4; i++) seedRun("RUNNING", "someone-else");
    const res = await startRun();
    assert.equal(res.status, 201, "another organization's live runs must not consume this one's ceiling");
  });

  await check("a limit of zero is treated as no limit rather than as a total block", async () => {
    clearRuns();
    setLimit(0);
    for (let i = 0; i < 3; i++) seedRun("RUNNING");
    const res = await startRun();
    assert.equal(res.status, 201, "0 means unconfigured, not 'refuse everything'");
  });

  await check("a run below the ceiling is admitted", async () => {
    clearRuns();
    setLimit(3);
    seedRun("RUNNING");
    const res = await startRun();
    assert.equal(res.status, 201, res.raw);
  });

  section("the execution status gate is separate from the ceiling");

  for (const status of ["paused", "suspended"]) {
    await check(`an organization whose execution status is ${status} cannot start a run`, async () => {
      clearRuns();
      put("PLATFORM", `ORG#${TENANT}`, {
        id: "org_guardr",
        name: "Ceiling Ltd",
        slug: TENANT,
        status,
        plan: "design_partner",
        settings: { maxConcurrentRuns: 25 },
        createdAt: iso(-86400000),
        updatedAt: iso(),
      });
      const res = await startRun();
      assert.equal(res.status, 409);
      assert.equal(res.body.organizationStatus, status, "the reason is stated rather than implied");
    });
  }

  await check("restoring the execution status to active admits runs again with no further action", async () => {
    clearRuns();
    setLimit(25);
    const res = await startRun();
    assert.equal(res.status, 201, res.raw);
  });

  done();
})();
