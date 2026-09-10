// Organization profile and settings, against the control plane that is actually deployed.
//
// The point of these settings is that they are enforced, not stored. Before this existed the
// console could display a plan and a status that no execution path ever read, so "paused" was
// a label rather than a state. Most of what follows is therefore about run creation: the assertions
// that matter are the ones where a run is refused because of an organization-level decision.
const { store, crypto } = require("./harness.cjs");
const os = require("node:os");
const path = require("node:path");
const { writeTo } = require("./extract-inline-handler.cjs");
const { handler } = require(
  writeTo(path.join(os.tmpdir(), `amazflow-orgsettings-${process.pid}.cjs`)),
);
const assert = require("node:assert");

const now = () => new Date().toISOString();
const TENANT = "northwind";
const OTHER = "contoso";

const put = (pk, sk, doc, extra = {}) =>
  store.set(`${pk}|${sk}`, {
    pk: { S: pk },
    sk: { S: sk },
    document: { S: JSON.stringify(doc) },
    updatedAt: { S: now() },
    ...extra,
  });

// A workflow with no agent-executed steps, so preflight cannot be the reason a run is refused.
// Anything that blocks below is an organization decision and nothing else.
const workflow = {
  id: "wf_report",
  tenantId: TENANT,
  name: "Daily reconciliation",
  version: 1,
  status: "active",
  assignedRoles: ["CLIENT_ADMIN", "FRONTLINE"],
  startAt: "s_done",
  steps: [{ id: "s_done", type: "end", outcome: "success", name: "Done" }],
};

const seed = () => {
  store.clear();
  put(`TENANT#${TENANT}`, "WORKFLOW#wf_report", workflow);
  put(
    `TENANT#${TENANT}`,
    "WORKFLOWVERSION#wf_report_v000001",
    { ...workflow, id: "wf_report_v000001" },
  );
  put("PLATFORM", `ORG#${TENANT}`, {
    id: "org_1",
    name: "Northwind Logistics",
    slug: TENANT,
    status: "active",
    plan: "design_partner",
    createdAt: now(),
    updatedAt: now(),
  });
  put("PLATFORM", `ORG#${OTHER}`, {
    id: "org_2",
    name: "Contoso",
    slug: OTHER,
    status: "active",
    plan: "pilot",
    createdAt: now(),
    updatedAt: now(),
  });
};

const claims = (role, tenantId) => ({
  sub: `user_${role.toLowerCase()}`,
  "custom:tenant_id": tenantId,
  "cognito:groups": `[${role}]`,
});

const call = async (routeKey, { role = "SUPER_ADMIN", tenantId = TENANT, body, pathParameters } = {}) => {
  const res = await handler({
    routeKey,
    requestContext: { authorizer: { jwt: { claims: claims(role, tenantId) } } },
    headers: {},
    pathParameters,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

const loadOrg = (slug = TENANT) =>
  JSON.parse(store.get(`PLATFORM|ORG#${slug}`).document.S);
const activityFor = (slug) =>
  [...store.values()]
    .filter((i) => i.pk.S === `TENANT#${slug}` && i.sk.S.startsWith("ACTIVITY#"))
    .map((i) => JSON.parse(i.document.S));
const startRun = (opts = {}) =>
  call("POST /workflows/{id}/runs", {
    role: "CLIENT_ADMIN",
    pathParameters: { id: "wf_report" },
    body: {},
    ...opts,
  });

let pass = 0,
  fail = 0;
const check = (name, fn) =>
  fn().then(
    () => {
      pass++;
      console.log("  PASS  " + name);
    },
    (e) => {
      fail++;
      console.log("  FAIL  " + name + "\n        " + (e && e.message));
    },
  );

(async () => {
  console.log("\nORGANIZATION PROFILE AND SETTINGS\n");

  // ---------------------------------------------------------------- reading ----------------

  await check("an org reads back with defaults filled in, not undefined", async () => {
    seed();
    const res = await call("GET /organizations/{slug}", { pathParameters: { slug: TENANT } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.settings, {
      maxConcurrentRuns: 0,
      allowedEmailDomains: [],
      timezone: "UTC",
    });
  });

  await check("a customer admin reads their own org but not another's", async () => {
    seed();
    const mine = await call("GET /organizations/{slug}", {
      role: "CLIENT_ADMIN",
      tenantId: TENANT,
      pathParameters: { slug: TENANT },
    });
    assert.equal(mine.status, 200);
    const theirs = await call("GET /organizations/{slug}", {
      role: "CLIENT_ADMIN",
      tenantId: TENANT,
      pathParameters: { slug: OTHER },
    });
    // 404, not 403 (Phase 2, baseline defect D-2). A 403 here confirmed that the slug exists in
    // some other organization, which is exactly what the tenancy boundary is supposed to hide.
    assert.equal(theirs.status, 404, "cross-tenant org read must be indistinguishable from absent");
    assert.ok(
      !JSON.stringify(theirs.body).includes(OTHER),
      "and the refusal must not echo the other organization's slug back",
    );
  });

  // ---------------------------------------------------------------- profile ----------------

  await check("a super admin renames an org and the change is audited with before/after", async () => {
    seed();
    const res = await call("PUT /organizations/{slug}", {
      pathParameters: { slug: TENANT },
      body: { name: "Northwind Logistics EU" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(loadOrg().name, "Northwind Logistics EU");
    const entry = activityFor(TENANT).find((x) => x.action === "ORG_UPDATED");
    assert.ok(entry, "an ORG_UPDATED activity entry is written");
    assert.equal(entry.details.before.name, "Northwind Logistics");
    assert.equal(entry.details.after.name, "Northwind Logistics EU");
  });

  await check("the slug cannot be changed, because it is the tenant id", async () => {
    seed();
    const res = await call("PUT /organizations/{slug}", {
      pathParameters: { slug: TENANT },
      body: { slug: "something-else" },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /cannot be changed/i);
    assert.equal(loadOrg().slug, TENANT);
  });

  await check("an unknown status or plan is refused rather than stored", async () => {
    seed();
    const badStatus = await call("PUT /organizations/{slug}", {
      pathParameters: { slug: TENANT },
      body: { status: "deleted" },
    });
    assert.equal(badStatus.status, 400);
    assert.match(badStatus.body.error, /status must be one of/);
    const badPlan = await call("PUT /organizations/{slug}", {
      pathParameters: { slug: TENANT },
      body: { plan: "free-forever" },
    });
    assert.equal(badPlan.status, 400);
    assert.equal(loadOrg().status, "active", "nothing was written");
    assert.equal(loadOrg().plan, "design_partner");
  });

  await check("a customer admin cannot change their own status or plan", async () => {
    seed();
    const res = await call("PUT /organizations/{slug}", {
      role: "CLIENT_ADMIN",
      pathParameters: { slug: TENANT },
      body: { status: "active", plan: "enterprise" },
    });
    assert.equal(res.status, 403);
    assert.equal(loadOrg().plan, "design_partner");
  });

  // ---------------------------------------------------------------- settings ---------------

  await check("email domains are normalised: @ stripped, lowercased, deduped", async () => {
    seed();
    const res = await call("POST /organizations/{slug}/settings", {
      pathParameters: { slug: TENANT },
      body: { allowedEmailDomains: ["@Northwind.com", "northwind.com", "PARTNER.co.uk"] },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.settings.allowedEmailDomains, [
      "northwind.com",
      "partner.co.uk",
    ]);
  });

  await check("a malformed domain or time zone is refused", async () => {
    seed();
    const badDomain = await call("POST /organizations/{slug}/settings", {
      pathParameters: { slug: TENANT },
      body: { allowedEmailDomains: ["not a domain"] },
    });
    assert.equal(badDomain.status, 400);
    assert.match(badDomain.body.error, /not a valid email domain/);
    const badTz = await call("POST /organizations/{slug}/settings", {
      pathParameters: { slug: TENANT },
      body: { timezone: "Mars/Olympus_Mons" },
    });
    assert.equal(badTz.status, 400);
    assert.match(badTz.body.error, /not a recognized time zone/);
    assert.equal(loadOrg().settings, undefined, "nothing was persisted");
  });

  await check("a real time zone is accepted", async () => {
    seed();
    const res = await call("POST /organizations/{slug}/settings", {
      pathParameters: { slug: TENANT },
      body: { timezone: "Europe/Amsterdam" },
    });
    assert.equal(res.status, 200);
    assert.equal(loadOrg().settings.timezone, "Europe/Amsterdam");
  });

  await check("maxConcurrentRuns rejects fractions, negatives and absurd values", async () => {
    seed();
    for (const value of [1.5, -1, 1001, "many"]) {
      const res = await call("POST /organizations/{slug}/settings", {
        pathParameters: { slug: TENANT },
        body: { maxConcurrentRuns: value },
      });
      assert.equal(res.status, 400, `${value} must be refused`);
    }
  });

  await check("a customer admin sets their own timezone but cannot raise their run limit", async () => {
    seed();
    const allowed = await call("POST /organizations/{slug}/settings", {
      role: "CLIENT_ADMIN",
      pathParameters: { slug: TENANT },
      body: { timezone: "America/Chicago" },
    });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    const refused = await call("POST /organizations/{slug}/settings", {
      role: "CLIENT_ADMIN",
      pathParameters: { slug: TENANT },
      body: { maxConcurrentRuns: 999 },
    });
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /concurrent run limit/i);
    // The successful timezone write materialises the defaults, so the limit is present and 0.
    // What matters is that the refused request did not move it.
    assert.equal(loadOrg().settings.maxConcurrentRuns, 0);
    assert.equal(loadOrg().settings.timezone, "America/Chicago");
  });

  await check("a frontline user changes nothing", async () => {
    seed();
    const res = await call("POST /organizations/{slug}/settings", {
      role: "FRONTLINE",
      pathParameters: { slug: TENANT },
      body: { timezone: "UTC" },
    });
    assert.equal(res.status, 403);
  });

  await check("settings changes are audited with before and after", async () => {
    seed();
    await call("POST /organizations/{slug}/settings", {
      pathParameters: { slug: TENANT },
      body: { maxConcurrentRuns: 5 },
    });
    const entry = activityFor(TENANT).find((x) => x.action === "ORG_SETTINGS_CHANGED");
    assert.ok(entry, "an ORG_SETTINGS_CHANGED entry is written");
    assert.equal(entry.details.before.maxConcurrentRuns, 0);
    assert.equal(entry.details.after.maxConcurrentRuns, 5);
    assert.match(entry.summary, /maxConcurrentRuns/);
  });

  // -------------------------------------------------- the settings actually bite ------------

  await check("baseline: a run starts when the org is active and unlimited", async () => {
    seed();
    const res = await startRun();
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  await check("a paused organization cannot start new work", async () => {
    seed();
    await call("PUT /organizations/{slug}", {
      pathParameters: { slug: TENANT },
      body: { status: "paused" },
    });
    const res = await startRun();
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.error, /paused/i);
    assert.equal(res.body.organizationStatus, "paused");
  });

  await check("a suspended organization is told to contact AmazFlow", async () => {
    seed();
    await call("PUT /organizations/{slug}", {
      pathParameters: { slug: TENANT },
      body: { status: "suspended" },
    });
    const res = await startRun();
    assert.equal(res.status, 409);
    assert.match(res.body.error, /suspended/i);
  });

  await check("resuming an organization lets work start again", async () => {
    seed();
    await call("PUT /organizations/{slug}", {
      pathParameters: { slug: TENANT },
      body: { status: "paused" },
    });
    assert.equal((await startRun()).status, 409);
    await call("PUT /organizations/{slug}", {
      pathParameters: { slug: TENANT },
      body: { status: "active" },
    });
    assert.equal((await startRun()).status, 201, "run allowed once active again");
  });

  await check("the concurrent run limit refuses the run that would exceed it", async () => {
    seed();
    await call("POST /organizations/{slug}/settings", {
      pathParameters: { slug: TENANT },
      body: { maxConcurrentRuns: 2 },
    });
    put(`TENANT#${TENANT}`, "RUN#r1", {
      id: "r1", tenantId: TENANT, workflowId: "wf_report", status: "RUNNING",
    });
    put(`TENANT#${TENANT}`, "RUN#r2", {
      id: "r2", tenantId: TENANT, workflowId: "wf_report", status: "WAITING_AGENT",
    });
    const res = await startRun();
    assert.equal(res.status, 429, JSON.stringify(res.body));
    assert.equal(res.body.limit, 2);
    assert.equal(res.body.inFlight, 2);
  });

  await check("finished runs do not count against the limit", async () => {
    seed();
    await call("POST /organizations/{slug}/settings", {
      pathParameters: { slug: TENANT },
      body: { maxConcurrentRuns: 2 },
    });
    for (const [id, status] of [
      ["r1", "COMPLETED"],
      ["r2", "FAILED"],
      ["r3", "CANCELLED"],
      ["r4", "TIMED_OUT"],
    ]) {
      put(`TENANT#${TENANT}`, `RUN#${id}`, {
        id, tenantId: TENANT, workflowId: "wf_report", status,
      });
    }
    const res = await startRun();
    assert.equal(res.status, 201, "four terminal runs must not block a fifth");
  });

  await check("another tenant's in-flight runs do not count against this one", async () => {
    seed();
    await call("POST /organizations/{slug}/settings", {
      pathParameters: { slug: TENANT },
      body: { maxConcurrentRuns: 1 },
    });
    put(`TENANT#${OTHER}`, "RUN#other1", {
      id: "other1", tenantId: OTHER, workflowId: "wf_other", status: "RUNNING",
    });
    const res = await startRun();
    assert.equal(res.status, 201, "the limit is per organization");
  });

  await check("a limit of zero means no limit, not no runs", async () => {
    seed();
    await call("POST /organizations/{slug}/settings", {
      pathParameters: { slug: TENANT },
      body: { maxConcurrentRuns: 0 },
    });
    for (const id of ["r1", "r2", "r3", "r4", "r5"]) {
      put(`TENANT#${TENANT}`, `RUN#${id}`, {
        id, tenantId: TENANT, workflowId: "wf_report", status: "RUNNING",
      });
    }
    const res = await startRun();
    assert.equal(res.status, 201);
  });

  await check("an organization with no record at all still runs", async () => {
    seed();
    store.delete(`PLATFORM|ORG#${TENANT}`);
    const res = await startRun();
    assert.equal(res.status, 201, "a missing org must fail open, not lock the tenant out");
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
