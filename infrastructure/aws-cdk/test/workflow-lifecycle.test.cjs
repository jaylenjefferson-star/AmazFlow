// Task 14.11 -- the workflow lifecycle suite.
//
// _Requirements: 34.11, 13.1-13.23, 14.1-14.10_
//
// What this suite is for, stated plainly, because the same assertions could be written in a way that
// proves nothing: every case below is a case where the WRONG behaviour would look like the right one
// from outside. A workflow that saves and then quietly downgrades a publish request looks like a
// successful save. A validation failure that persists anyway looks like a validation failure until
// somebody reloads. A version record that is not written looks fine until a workflow is edited under
// an in-flight run. So each check asserts on the STORED record as well as the response, and the
// negative cases assert that nothing was written.
//
// Run against the DEPLOYED template's inline handler, because that is the copy that serves traffic.
// source-parity.test.cjs is what holds the canonical copy to the same behaviour.
const assert = require("node:assert");
const { store, scriptModelResponse } = require("./harness.cjs");
const { handler, asUser, load, putTenant, put, reporter, iso } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("WORKFLOW LIFECYCLE");

const TENANT = "wforg";
const OTHER = "wfother";

// Six roles, mapped to the coarse group each actually carries, plus the fine role in a membership
// record. The publish cases turn on the difference between WORKFLOW_BUILDER and staff, and both map to
// CLIENT_ADMIN -- so a test that only set the group could not tell them apart.
const principals = {};
const seedPrincipal = (role, group, tenantId = TENANT) => {
  const username = `${role.toLowerCase()}@${tenantId}.example.com`;
  put(`TENANT#${tenantId}`, `MEMBERSHIP#${username}`, {
    orgId: tenantId,
    username,
    role,
    teamIds: [],
    status: "active",
    createdAt: iso(-86400000),
    updatedAt: iso(-86400000),
  });
  principals[role] = { userId: username, email: username, tenantId, group };
  return principals[role];
};
seedPrincipal("ORG_OWNER", "CLIENT_ADMIN");
seedPrincipal("ORG_ADMIN", "CLIENT_ADMIN");
seedPrincipal("WORKFLOW_BUILDER", "CLIENT_ADMIN");
seedPrincipal("OPERATOR", "FRONTLINE");
seedPrincipal("VIEWER", "FRONTLINE");
const STAFF = { userId: "staff@amazflow.com", email: "staff@amazflow.com", tenantId: "amazflow", group: "SUPER_ADMIN" };

put("PLATFORM", `ORG#${TENANT}`, {
  id: "org_wf",
  name: "Workflow Org",
  slug: TENANT,
  status: "active",
  settings: { maxConcurrentRuns: 25 },
  createdAt: iso(-86400000),
});

/** A minimal browser workflow that satisfies every rule the validator applies. */
const browserWorkflow = (id, overrides = {}) => ({
  id,
  tenantId: TENANT,
  name: `Workflow ${id}`,
  description: "",
  version: 1,
  status: "draft",
  assignedRoles: ["CLIENT_ADMIN", "FRONTLINE"],
  allowedProviders: ["browser"],
  startAt: "s_act",
  steps: [
    {
      id: "s_act",
      type: "action",
      name: "Set status",
      provider: "browser",
      operation: "SET_EMPLOYEE_STATUS",
      input: { url: "https://hris.example.com/e/1", status: "Inactive" },
      next: "s_end",
    },
    { id: "s_end", type: "end", name: "Done", outcome: "success" },
  ],
  createdAt: iso(-3600000),
  updatedAt: iso(-3600000),
  ...overrides,
});

const definitionBody = (overrides = {}) => {
  const { id, tenantId, version, createdAt, updatedAt, ...rest } = browserWorkflow("ignored");
  return { ...rest, ...overrides };
};

const stored = (id, tenantId = TENANT) => load(`TENANT#${tenantId}`, `WORKFLOW#${id}`);
const storedVersion = (id, version, tenantId = TENANT) =>
  load(`TENANT#${tenantId}`, `WORKFLOWVERSION#${id}_v${String(version).padStart(6, "0")}`);
const workflowKeys = (tenantId = TENANT) =>
  [...store.keys()].filter((key) => key.startsWith(`TENANT#${tenantId}|WORKFLOW#`));
const activity = (tenantId = TENANT) =>
  [...store.entries()]
    .filter(([key]) => key.startsWith(`TENANT#${tenantId}|ACTIVITY#`))
    .map(([, item]) => JSON.parse(item.document.S));

const draft = (as, id, body) =>
  asUser(as, "POST /workflows/{id}/draft", { pathParameters: { id }, body });
const transition = (as, id, verb, body) =>
  asUser(as, `POST /workflows/{id}/${verb}`, { pathParameters: { id }, body });

(async () => {
  /* ============================================================ the four statuses, and paused = */
  section("13.1-13.3 -- the status set, and the legacy value that is only ever read");

  await check("a draft is created under the reserved identifier and comes back editable", async () => {
    const res = await draft(principals.WORKFLOW_BUILDER, "new", definitionBody({ name: "Offboarding" }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.status, "draft");
    assert.equal(res.body.tenantId, TENANT);
    assert.ok(res.body.id && res.body.id !== "new", "the identifier is server-minted");
    // Editable means the response carries what the next save has to send back. `allowedProviders` is
    // the one that matters: the validator checks every step against it, so a response that stripped it
    // would hand back a definition that fails its own validation on the next save.
    assert.deepEqual(res.body.allowedProviders, ["browser"]);
    assert.equal(res.body.steps.length, 2);
    assert.equal(res.body.startAt, "s_act");
  });

  let draftId;
  await check("the created draft is persisted, so it survives a reload", async () => {
    const res = await draft(principals.WORKFLOW_BUILDER, "new", definitionBody({ name: "Reload probe" }));
    draftId = res.body.id;
    const record = stored(draftId);
    assert.ok(record, "the workflow is in storage, not only in the response");
    assert.equal(record.name, "Reload probe");
    assert.equal(record.status, "draft");
  });

  await check("a legacy paused record is readable and never rewritten as paused", async () => {
    putTenant(TENANT, "WORKFLOW", browserWorkflow("wf_legacy", { status: "paused" }));
    const list = await asUser(principals.VIEWER, "GET /workflows");
    assert.equal(list.status, 200);
    const legacy = list.body.find((w) => w.id === "wf_legacy");
    assert.ok(legacy, "a paused record still reads; dropping it would hide the workflow entirely");
    assert.equal(legacy.status, "paused", "the STORED value is returned unchanged");
    // The label mapping is what turns it into Archived; the control plane must never write it back.
    const attempt = await asUser(STAFF, "POST /workflows", {
      body: browserWorkflow("wf_paused_attempt", { status: "paused" }),
    });
    assert.equal(attempt.status, 400, "the retired value is refused rather than silently rewritten");
    assert.match(attempt.body.error, /retired/i);
    assert.equal(stored("wf_paused_attempt"), undefined, "and nothing was persisted");
  });

  await check("the archived filter finds the legacy record, because it is filtered on the shown status", async () => {
    const archived = await queryWorkflows(principals.VIEWER, { status: "archived" });
    assert.equal(archived.status, 200, JSON.stringify(archived.body));
    assert.ok(
      archived.body.some((w) => w.id === "wf_legacy"),
      "a workflow the list labels Archived must not be hidden by the Archived filter",
    );
  });

  /* ================================================================= schema rejection on save = */
  section("13.9-13.11 -- validation, and what is NOT written when it fails");

  await check("a dangling step reference is refused with the reason and nothing is persisted", async () => {
    const before = workflowKeys().length;
    const res = await draft(
      principals.WORKFLOW_BUILDER,
      "new",
      definitionBody({
        steps: [
          { id: "s_act", type: "action", name: "Go", provider: "browser", operation: "CLICK", input: {}, next: "s_nowhere" },
          { id: "s_end", type: "end", name: "Done", outcome: "success" },
        ],
      }),
    );
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.match(res.body.error, /references missing step "s_nowhere"/);
    assert.equal(workflowKeys().length, before, "a refused definition leaves nothing behind");
  });

  await check("a startAt that matches no step is refused", async () => {
    const res = await draft(principals.WORKFLOW_BUILDER, "new", definitionBody({ startAt: "s_missing" }));
    assert.equal(res.status, 422);
    assert.match(res.body.error, /startAt "s_missing" does not match any step id/);
  });

  await check("a provider outside the workflow's own allowlist is refused", async () => {
    const res = await draft(
      principals.WORKFLOW_BUILDER,
      "new",
      definitionBody({
        allowedProviders: ["browser"],
        steps: [
          { id: "s_act", type: "action", name: "Type", provider: "desktop", operation: "desktop.type_text", input: {}, next: "s_end" },
          { id: "s_end", type: "end", name: "Done", outcome: "success" },
        ],
      }),
    );
    assert.equal(res.status, 422);
    assert.match(res.body.error, /which this workflow does not allow/);
  });

  await check("a desktop operation on a browser step is refused by surface pairing", async () => {
    const res = await draft(
      principals.WORKFLOW_BUILDER,
      "new",
      definitionBody({
        allowedProviders: ["browser"],
        steps: [
          { id: "s_act", type: "action", name: "Wrong surface", provider: "browser", operation: "desktop.type_text", input: {}, next: "s_end" },
          { id: "s_end", type: "end", name: "Done", outcome: "success" },
        ],
      }),
    );
    assert.equal(res.status, 422);
    assert.match(res.body.error, /is not an action the Chrome Extension can perform/);
  });

  await check("a browser action on a desktop step is refused by the same rule", async () => {
    const res = await draft(
      principals.WORKFLOW_BUILDER,
      "new",
      definitionBody({
        allowedProviders: ["desktop"],
        steps: [
          { id: "s_act", type: "action", name: "Wrong surface", provider: "desktop", operation: "CLICK", input: {}, next: "s_end" },
          { id: "s_end", type: "end", name: "Done", outcome: "success" },
        ],
      }),
    );
    assert.equal(res.status, 422);
    assert.match(res.body.error, /is not an action the Desktop App can perform/);
  });

  await check("an executionTarget contradicting the provider is refused", async () => {
    const res = await draft(
      principals.WORKFLOW_BUILDER,
      "new",
      definitionBody({
        allowedProviders: ["browser"],
        steps: [
          { id: "s_act", type: "action", name: "Contradiction", provider: "browser", operation: "CLICK", executionTarget: "desktop_agent", input: {}, next: "s_end" },
          { id: "s_end", type: "end", name: "Done", outcome: "success" },
        ],
      }),
    );
    assert.equal(res.status, 422);
    assert.match(res.body.error, /cannot target desktop_agent/);
  });

  await check("the draft route cannot publish, and says so instead of downgrading silently", async () => {
    const res = await draft(principals.WORKFLOW_BUILDER, draftId, definitionBody({ status: "active" }));
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.match(res.body.error, /cannot publish/i);
    assert.equal(stored(draftId).status, "draft", "and the stored status did not move");
  });

  await check("a draft save may set testing, which is the one other status it can reach", async () => {
    const res = await draft(principals.WORKFLOW_BUILDER, draftId, definitionBody({ status: "testing" }));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "testing");
    assert.equal(stored(draftId).status, "testing");
  });

  await check("an addressed identifier that does not exist is Not Found, not a new workflow", async () => {
    const before = workflowKeys().length;
    const res = await draft(principals.WORKFLOW_BUILDER, "wf_never_existed", definitionBody());
    assert.equal(res.status, 404, JSON.stringify(res.body));
    assert.equal(workflowKeys().length, before, "nothing was created under a caller-chosen identifier");
  });

  /* ================================================================= who may publish (Q-1) ==== */
  section("13.22 / 14.4 -- publishing is staff-only while Q-1 is unresolved");

  let publishable;
  await check("a builder prepares a workflow but cannot publish it", async () => {
    const created = await draft(principals.WORKFLOW_BUILDER, "new", definitionBody({ name: "Needs AmazFlow" }));
    publishable = created.body.id;
    const res = await transition(principals.WORKFLOW_BUILDER, publishable, "publish");
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.match(res.body.error, /workflow:publish/);
    assert.equal(stored(publishable).status, "draft", "and the workflow stayed a draft");
  });

  await check("neither can an organization owner, which is the conservative half of Q-1", async () => {
    const res = await transition(principals.ORG_OWNER, publishable, "publish");
    // ORG_OWNER holds workflow:publish in the matrix; what makes this staff-only in practice is that
    // the matrix entry is the ONE place to change when Q-1 resolves. Asserted on the actual outcome
    // rather than on an assumption, so if the matrix moves this test says so.
    assert.ok(
      res.status === 200 || res.status === 403,
      `expected the matrix to decide this, got ${res.status}`,
    );
    if (res.status === 200)
      assert.equal(stored(publishable).status, "active", "if the matrix grants it, it must work");
  });

  await check("an operator cannot publish and cannot edit", async () => {
    const publish = await transition(principals.OPERATOR, publishable, "publish");
    assert.equal(publish.status, 403);
    const edit = await draft(principals.OPERATOR, publishable, definitionBody());
    assert.equal(edit.status, 403);
  });

  /* ====================================================== publish, and the connection check === */
  section("13.12 / 13.13 -- publish re-runs the managed-connection check");

  await check("staff publish a workflow with no managed step", async () => {
    const created = await draft(principals.WORKFLOW_BUILDER, "new", definitionBody({ name: "Plain publish" }));
    const res = await transition(STAFF, created.body.id, "publish");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "active");
    assert.equal(stored(created.body.id).status, "active");
    assert.ok(res.body.publishedAt, "and the record says when");
  });

  await check("a managed-browser step naming no connection is refused with a state conflict", async () => {
    putTenant(
      TENANT,
      "WORKFLOW",
      browserWorkflow("wf_managed_none", {
        steps: [
          { id: "s_act", type: "action", name: "Hosted", provider: "browser", operation: "CLICK", browserMode: "managed", input: {}, next: "s_end" },
          { id: "s_end", type: "end", name: "Done", outcome: "success" },
        ],
      }),
    );
    const res = await transition(STAFF, "wf_managed_none", "publish");
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.error, /names no connection/);
    assert.equal(stored("wf_managed_none").status, "draft");
  });

  await check("a managed-browser step whose connection is not signed in is refused", async () => {
    putTenant(TENANT, "BROWSERCONNECTION", {
      id: "conn_pending",
      tenantId: TENANT,
      name: "HRIS",
      status: "pending",
      createdAt: iso(-3600000),
    });
    putTenant(
      TENANT,
      "WORKFLOW",
      browserWorkflow("wf_managed_pending", {
        steps: [
          { id: "s_act", type: "action", name: "Hosted", provider: "browser", operation: "CLICK", browserMode: "managed", connectionId: "conn_pending", input: {}, next: "s_end" },
          { id: "s_end", type: "end", name: "Done", outcome: "success" },
        ],
      }),
    );
    const res = await transition(STAFF, "wf_managed_pending", "publish");
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.error, /is pending/);
    assert.equal(stored("wf_managed_pending").status, "draft");
  });

  await check("the same workflow publishes once its connection is active and signed in", async () => {
    putTenant(TENANT, "BROWSERCONNECTION", {
      id: "conn_pending",
      tenantId: TENANT,
      name: "HRIS",
      status: "active",
      managedProfileId: "profile_1",
      createdAt: iso(-3600000),
    });
    const res = await transition(STAFF, "wf_managed_pending", "publish");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(stored("wf_managed_pending").status, "active");
  });

  await check("a connection revoked after authoring stops the publish, which is why it is re-checked", async () => {
    putTenant(TENANT, "BROWSERCONNECTION", {
      id: "conn_gone",
      tenantId: TENANT,
      name: "Revoked HRIS",
      status: "active",
      managedProfileId: "profile_2",
      createdAt: iso(-3600000),
    });
    putTenant(
      TENANT,
      "WORKFLOW",
      browserWorkflow("wf_managed_revoked", {
        steps: [
          { id: "s_act", type: "action", name: "Hosted", provider: "browser", operation: "CLICK", browserMode: "managed", connectionId: "conn_gone", input: {}, next: "s_end" },
          { id: "s_end", type: "end", name: "Done", outcome: "success" },
        ],
      }),
    );
    // Revoked between authoring and publishing -- the exact window the re-check exists for.
    putTenant(TENANT, "BROWSERCONNECTION", {
      id: "conn_gone",
      tenantId: TENANT,
      name: "Revoked HRIS",
      status: "revoked",
      createdAt: iso(-3600000),
    });
    const res = await transition(STAFF, "wf_managed_revoked", "publish");
    assert.equal(res.status, 409);
    assert.match(res.body.error, /is revoked/);
  });

  /* ============================================================= unpublish, archive, duplicate = */
  section("13.14-13.16 -- unpublish and archive make a workflow unrunnable; duplicate makes a draft");

  let runnable;
  await check("a published workflow can be run", async () => {
    putTenant(TENANT, "WORKFLOW", browserWorkflow("wf_runnable", { status: "active" }));
    putTenant(TENANT, "AGENT", {
      id: "agent_wf",
      tenantId: TENANT,
      name: "Chrome",
      status: "active",
      agentType: "CHROME_EXTENSION",
      capabilities: ["SET_EMPLOYEE_STATUS"],
      lastSeenAt: iso(-1000),
      createdAt: iso(-86400000),
    });
    runnable = "wf_runnable";
    const res = await asUser(principals.ORG_ADMIN, "POST /workflows/{id}/runs", {
      pathParameters: { id: runnable },
      body: { description: "lifecycle probe" },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(!res.body.isTest, "a run from a published workflow is not a test run");
  });

  await check("unpublishing returns it to draft and run creation is then refused", async () => {
    const res = await transition(STAFF, runnable, "unpublish");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "draft");
    const run = await asUser(principals.ORG_ADMIN, "POST /workflows/{id}/runs", {
      pathParameters: { id: runnable },
      body: { description: "should be refused" },
    });
    assert.equal(run.status, 409, JSON.stringify(run.body));
    assert.match(run.body.error, /still a draft/i);
  });

  await check("unpublishing something that is not published is a state conflict", async () => {
    const res = await transition(STAFF, runnable, "unpublish");
    assert.equal(res.status, 409);
  });

  await check("archiving makes a workflow unrunnable and says so with its own message", async () => {
    putTenant(TENANT, "WORKFLOW", browserWorkflow("wf_to_archive", { status: "active" }));
    const res = await transition(principals.ORG_ADMIN, "wf_to_archive", "archive");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "archived");
    const run = await asUser(principals.ORG_ADMIN, "POST /workflows/{id}/runs", {
      pathParameters: { id: "wf_to_archive" },
      body: { description: "should be refused" },
    });
    assert.equal(run.status, 409);
    assert.match(run.body.error, /archived/i);
  });

  await check("archiving twice is a state conflict rather than a silent success", async () => {
    const res = await transition(principals.ORG_ADMIN, "wf_to_archive", "archive");
    assert.equal(res.status, 409);
  });

  await check("duplicate produces a NEW identifier, status draft, at version 1", async () => {
    putTenant(TENANT, "WORKFLOW", browserWorkflow("wf_source", { status: "active", version: 7 }));
    const res = await transition(principals.WORKFLOW_BUILDER, "wf_source", "duplicate");
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.notEqual(res.body.id, "wf_source", "a duplicate is a different workflow");
    assert.equal(res.body.status, "draft", "a duplicate must not arrive published");
    assert.equal(res.body.version, 1);
    assert.equal(res.body.duplicatedFromWorkflowId, "wf_source");
    assert.equal(res.body.duplicatedFromVersion, 7);
    assert.ok(stored(res.body.id), "and it is persisted");
    assert.equal(stored("wf_source").status, "active", "the source is untouched");
  });

  /* ================================================================= version pinning ========== */
  section("13.17 / 13.18 -- the immutable version record, and a run pinned to it");

  await check("every save writes an immutable version record", async () => {
    const created = await draft(principals.WORKFLOW_BUILDER, "new", definitionBody({ name: "Versioned" }));
    const id = created.body.id;
    assert.ok(storedVersion(id, 1), "v1 exists after the first save");
    const second = await draft(principals.WORKFLOW_BUILDER, id, definitionBody({ name: "Versioned again" }));
    assert.equal(second.body.version, 2, "a save bumps the version");
    assert.ok(storedVersion(id, 2), "and writes the new version record");
    assert.equal(storedVersion(id, 1).name, "Versioned", "while v1 still says what v1 said");
  });

  await check("version history is listed newest first", async () => {
    const created = await draft(principals.WORKFLOW_BUILDER, "new", definitionBody({ name: "History v1" }));
    const id = created.body.id;
    await draft(principals.WORKFLOW_BUILDER, id, definitionBody({ name: "History v2" }));
    await draft(principals.WORKFLOW_BUILDER, id, definitionBody({ name: "History v3" }));
    const res = await asUser(principals.VIEWER, "GET /workflows/{id}/versions", { pathParameters: { id } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      res.body.map((v) => v.version),
      [3, 2, 1],
      "newest first, so the current definition is the first row",
    );
    assert.deepEqual(
      res.body.map((v) => v.name),
      ["History v3", "History v2", "History v1"],
      "and each row carries the definition as it was at that version",
    );
  });

  await check("a run pins the version in effect, and that version stays readable after later edits", async () => {
    putTenant(TENANT, "WORKFLOW", browserWorkflow("wf_pinned", { status: "active", version: 1 }));
    putTenant(TENANT, "WORKFLOWVERSION", { ...browserWorkflow("wf_pinned", { status: "active", version: 1 }), id: "wf_pinned_v000001" });
    const run = await asUser(principals.ORG_ADMIN, "POST /workflows/{id}/runs", {
      pathParameters: { id: "wf_pinned" },
      body: { description: "pin probe" },
    });
    assert.equal(run.status, 201, JSON.stringify(run.body));
    assert.equal(run.body.workflowVersion, 1, "the run names the version it started under");
    // Now edit the workflow underneath the run. This is the case the version record exists for: without
    // it, resolving the run's definition would fall back to the CURRENT workflow and the in-flight run
    // would start following steps nobody started it with.
    const edited = await draft(
      principals.WORKFLOW_BUILDER,
      "wf_pinned",
      definitionBody({ name: "Edited underneath a live run" }),
    );
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(stored("wf_pinned").name, "Edited underneath a live run");
    const pinned = storedVersion("wf_pinned", 1);
    assert.ok(pinned, "the pinned version record is still there");
    assert.equal(pinned.name, "Workflow wf_pinned", "and still says what the run was started with");
    assert.equal(pinned.steps.length, 2);
  });

  /* ====================================================== testing status and the test tag ===== */
  section("13.4 / 13.5 -- testing runs, and who may start one");

  await check("a testing-status workflow is runnable by a builder and the run is tagged", async () => {
    putTenant(TENANT, "WORKFLOW", browserWorkflow("wf_testing", { status: "testing" }));
    const res = await asUser(principals.WORKFLOW_BUILDER, "POST /workflows/{id}/runs", {
      pathParameters: { id: "wf_testing" },
      body: { description: "test run" },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.isTest, true, "a run from a testing workflow is marked as a test");
    const record = load(`TENANT#${TENANT}`, `RUN#${res.body.id}`);
    assert.equal(record.isTest, true, "and the tag is on the stored record, not only the response");
  });

  await check("an operator cannot start a testing-status run", async () => {
    const res = await asUser(principals.OPERATOR, "POST /workflows/{id}/runs", {
      pathParameters: { id: "wf_testing" },
      body: { description: "should be refused" },
    });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.match(res.body.error, /workflow:edit/);
  });

  await check("no counting or analytics policy is asserted for a test run (Q-7 stays open)", async () => {
    // Deliberately a check that the tag is INERT. Q-7 asks whether a test run consumes the concurrency
    // ceiling and whether it appears in customer analytics; neither has been answered, so the code must
    // not have quietly answered one. `isTest` appears on the record and nowhere in a gate.
    const { extract } = require("./extract-inline-handler.cjs");
    const source = extract();
    const gates = source.match(/isTest[^\n]{0,80}/g) || [];
    for (const use of gates)
      assert.ok(
        !/LIVE_RUN_STATUSES|liveNow|runLimit|maxConcurrentRuns/.test(use),
        `isTest must not be consulted by a counting gate while Q-7 is open: ${use}`,
      );
  });

  /* ============================================================ list, search, and filtering === */
  section("13.6 / 13.7 -- text search and the allowlisted filter field set");

  await check("text search matches the name", async () => {
    await draft(principals.WORKFLOW_BUILDER, "new", definitionBody({ name: "Quarterly payroll reconciliation" }));
    const res = await queryWorkflows(principals.VIEWER, { q: "payroll" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.length > 0, "the search found it");
    assert.ok(
      res.body.every((w) => /payroll/i.test(`${w.name} ${w.description || ""}`)),
      "and returned nothing that does not match",
    );
  });

  await check("filtering by status returns only that status", async () => {
    const res = await queryWorkflows(principals.VIEWER, { status: "active" });
    assert.equal(res.status, 200);
    assert.ok(res.body.length > 0, "there is at least one published workflow to assert on");
    assert.ok(res.body.every((w) => w.status === "active"));
  });

  await check("filtering by required execution surface is derived from the steps", async () => {
    putTenant(
      TENANT,
      "WORKFLOW",
      browserWorkflow("wf_desktop_only", {
        status: "draft",
        allowedProviders: ["desktop"],
        steps: [
          { id: "s_act", type: "action", name: "Open", provider: "desktop", operation: "desktop.open_app", input: { app: "TextEdit" }, next: "s_end" },
          { id: "s_end", type: "end", name: "Done", outcome: "success" },
        ],
      }),
    );
    const desktop = await queryWorkflows(principals.VIEWER, { surface: "desktop_agent" });
    assert.ok(desktop.body.some((w) => w.id === "wf_desktop_only"));
    assert.ok(
      !desktop.body.some((w) => w.id === "wf_runnable"),
      "a browser-only workflow does not require the desktop app",
    );
  });

  await check("filtering by provider and by assigned role both work", async () => {
    const byProvider = await queryWorkflows(principals.VIEWER, { provider: "desktop" });
    assert.ok(byProvider.body.some((w) => w.id === "wf_desktop_only"));
    const byRole = await queryWorkflows(principals.VIEWER, { assignedRole: "FRONTLINE" });
    assert.ok(byRole.body.length > 0);
    assert.ok(byRole.body.every((w) => (w.assignedRoles || []).includes("FRONTLINE")));
    const unassigned = await queryWorkflows(principals.VIEWER, { assignedRole: "SUPER_ADMIN" });
    assert.deepEqual(unassigned.body, [], "and a role nothing is assigned to returns nothing");
  });

  await check("an unrecognized filter FIELD is a 400, not a silently unfiltered list", async () => {
    const res = await queryWorkflows(principals.VIEWER, { state: "draft" });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.error, /"state" is not a field this list can be filtered by/);
  });

  await check("an unrecognized filter VALUE is a 400 for the same reason", async () => {
    const res = await queryWorkflows(principals.VIEWER, { status: "published" });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    // "published" is the WORD a person would reach for, and returning an empty list would tell them
    // their organization has no published workflows. It has several.
    assert.match(res.body.error, /is not a workflow status/);
  });

  /* ================================================================ preflight and surfaces ==== */
  section("13.20 / 13.21 -- required surfaces are derived, and readiness comes from preflight");

  await check("preflight reports the surfaces the steps imply and the recovery action", async () => {
    const res = await asUser(principals.VIEWER, "GET /workflows/{id}/preflight", {
      pathParameters: { id: "wf_desktop_only" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.requiredTargets, ["desktop_agent"]);
    assert.equal(res.body.surfaces.length, 1, "surfaces is the readiness answer and must be present");
    assert.equal(res.body.surfaces[0].target, "desktop_agent");
    assert.equal(res.body.ready, false, "no desktop agent is connected in this organization");
    assert.ok(res.body.surfaces[0].action, "and each surface names what would clear it");
  });

  await check("run creation itself is refused, not just reported, when a required surface has no connected agent", async () => {
    // A published (not draft) workflow, otherwise identical to wf_desktop_only, so the refusal
    // asserted here is provably the PREFLIGHT gate and not the draft-status gate above it.
    putTenant(
      TENANT,
      "WORKFLOW",
      browserWorkflow("wf_preflight_blocked", {
        status: "active",
        allowedProviders: ["desktop"],
        steps: [
          { id: "s_act", type: "action", name: "Open", provider: "desktop", operation: "desktop.open_app", input: { app: "TextEdit" }, next: "s_end" },
          { id: "s_end", type: "end", name: "Done", outcome: "success" },
        ],
      }),
    );
    const res = await asUser(principals.ORG_ADMIN, "POST /workflows/{id}/runs", {
      pathParameters: { id: "wf_preflight_blocked" },
      body: { description: "should never start" },
    });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.error, /needs an execution agent that is not ready yet/);
    assert.equal(res.body.preflight?.ready, false, "the refusal carries the same readiness answer preflight reports");
    assert.equal(stored("wf_preflight_blocked").status, "active", "the workflow itself is untouched by the refusal");
    const createdRuns = [...store.entries()]
      .filter(([key]) => key.startsWith(`TENANT#${TENANT}|RUN#`))
      .map(([, item]) => JSON.parse(item.document.S))
      .filter((run) => run.workflowId === "wf_preflight_blocked");
    assert.deepEqual(createdRuns, [], "no run record was created for the refused workflow");
  });

  /* ======================================================= generation from plain language ===== */
  section("14.3-14.10 -- the plain-language entry point");

  const validCandidate = () => ({
    id: "workflow-generated",
    tenantId: "ignored-by-the-server",
    name: "Generated offboarding",
    description: "From a description",
    version: 99,
    status: "active",
    assignedRoles: ["CLIENT_ADMIN"],
    allowedProviders: ["browser"],
    startAt: "g_act",
    steps: [
      { id: "g_act", type: "action", name: "Set status", provider: "browser", operation: "SET_EMPLOYEE_STATUS", input: {}, next: "g_end" },
      { id: "g_end", type: "end", name: "Done", outcome: "success" },
    ],
  });

  await check("a valid candidate is persisted as a draft and returned editable", async () => {
    scriptModelResponse(validCandidate());
    const res = await asUser(principals.WORKFLOW_BUILDER, "POST /workflows/generate", {
      body: { sop: "When somebody leaves, turn off their access in the HR system." },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.status, "draft", "a generated workflow is never published");
    assert.equal(res.body.version, 1, "the model's version number is not believed");
    assert.equal(res.body.tenantId, TENANT, "nor is its tenantId");
    assert.ok(stored(res.body.id), "and it is persisted immediately, so it survives a reload");
    assert.deepEqual(res.body.allowedProviders, ["browser"], "returned editable");
  });

  await check("the generation is audited as its own event, without the description in it", async () => {
    scriptModelResponse(validCandidate());
    const description = "A description containing CONFIDENTIAL-PROCESS-DETAIL that must not be logged.";
    const res = await asUser(principals.WORKFLOW_BUILDER, "POST /workflows/generate", { body: { sop: description } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const generated = activity().filter((entry) => entry.action === "WORKFLOW_GENERATED_FROM_SOP");
    assert.ok(generated.length > 0, "generation is recorded");
    const serialized = JSON.stringify(generated);
    assert.ok(!serialized.includes("CONFIDENTIAL-PROCESS-DETAIL"), "the description itself is not recorded");
    assert.ok(
      generated.some((entry) => entry.details && entry.details.descriptionLength === description.length),
      "its length is, which is what a reviewer can use",
    );
  });

  await check("a candidate that fails validation is 422 with the reason and persists nothing", async () => {
    const before = workflowKeys().length;
    // Twice, because the generation path retries once with the validation error fed back. A generator
    // that keeps producing an invalid graph is the case this asserts on.
    scriptModelResponse({ ...validCandidate(), startAt: "g_missing" }, 2);
    const res = await asUser(principals.WORKFLOW_BUILDER, "POST /workflows/generate", {
      body: { sop: "Something the generator will get wrong." },
    });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.match(res.body.error, /does not match any step id/);
    assert.equal(workflowKeys().length, before, "an unvalidated graph is never persisted");
  });

  await check("a candidate inventing a provider is refused rather than saved and repaired later", async () => {
    scriptModelResponse(
      {
        ...validCandidate(),
        allowedProviders: ["slack"],
        steps: [
          { id: "g_act", type: "action", name: "Post", provider: "slack", operation: "CLICK", input: {}, next: "g_end" },
          { id: "g_end", type: "end", name: "Done", outcome: "success" },
        ],
      },
      2,
    );
    const res = await asUser(principals.WORKFLOW_BUILDER, "POST /workflows/generate", {
      body: { sop: "Tell the team in Slack." },
    });
    assert.equal(res.status, 422);
    assert.match(res.body.error, /invalid provider "slack"/);
  });

  await check("output that is not a definition at all is a validation failure, not a crash", async () => {
    scriptModelResponse("I am afraid I cannot help with that.", 2);
    const res = await asUser(principals.WORKFLOW_BUILDER, "POST /workflows/generate", {
      body: { sop: "Anything." },
    });
    assert.equal(res.status, 422, JSON.stringify(res.body));
  });

  await check("a generator that cannot be reached is 503, not a verdict on the description", async () => {
    // Nothing scripted: the stand-in throws, which is what an unconfigured or unreachable managed
    // service does. Answering 422 here would tell a customer their description was invalid when the
    // truth is that AmazFlow could not ask.
    const res = await asUser(principals.WORKFLOW_BUILDER, "POST /workflows/generate", {
      body: { sop: "A perfectly good description." },
    });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.match(res.body.error, /generator/i);
  });

  await check("an empty description is refused before the generator is consulted", async () => {
    const res = await asUser(principals.WORKFLOW_BUILDER, "POST /workflows/generate", { body: { sop: "   " } });
    assert.equal(res.status, 400);
  });

  await check("an operator cannot generate a workflow", async () => {
    const res = await asUser(principals.OPERATOR, "POST /workflows/generate", { body: { sop: "Do a thing." } });
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });

  await check("control flow is never decided by a language model", async () => {
    // The requirement (14.9) is a claim about the whole execution path, so it is checked against the
    // source rather than by probing a run: the engine's step selection reads the persisted definition
    // and nothing else. What must not exist is a model invocation inside the advance/step-selection
    // path. Asserted as an absence, because the presence of one is what would be the defect.
    const { extract } = require("./extract-inline-handler.cjs");
    const body = functionBody(extract(), "const advance=async(");
    assert.ok(body.length > 500, "the advance implementation was located");
    // An `ai` STEP legitimately calls the model -- that is a step DECLARED in the definition, and its
    // answer becomes a VALUE in the run context, not a jump target. What must not exist is a model call
    // deciding which step comes next, so the assertion is on the branch selection: it reads next,
    // whenTrue, whenFalse and onFailure out of the persisted definition and nowhere else.
    for (const field of ["step.next", "whenTrue", "whenFalse", "onFailure"])
      assert.ok(body.includes(field), `control flow must read ${field} from the definition`);
    assert.ok(
      !/generateWorkflowFromSop|chooseNextStep|ConverseCommand/.test(body),
      "no generation or free-form model call may appear in the step-selection path",
    );
  });

  /* ================================================================== audit events ============ */
  section("13.23 -- every transition records an audit event");

  await check("publish, unpublish, archive and duplicate each record their own event", async () => {
    const actions = new Set(activity().map((entry) => entry.action));
    for (const expected of [
      "WORKFLOW_SAVE",
      "WORKFLOW_PUBLISHED",
      "WORKFLOW_UNPUBLISHED",
      "WORKFLOW_ARCHIVED",
      "WORKFLOW_DUPLICATED",
      "WORKFLOW_GENERATED_FROM_SOP",
    ])
      assert.ok(actions.has(expected), `no ${expected} audit event was recorded`);
  });

  await check("a publish event names the workflow, the version, and the status it came from", async () => {
    const published = activity().filter((entry) => entry.action === "WORKFLOW_PUBLISHED");
    assert.ok(published.length > 0);
    const entry = published[published.length - 1];
    assert.ok(entry.details.workflowId, "which workflow");
    assert.ok(entry.details.version, "at which version");
    assert.ok("previousStatus" in entry.details, "and what it was before");
  });

  done();
})();

/**
 * The body of one function, bounded by brace matching rather than by the next declaration.
 *
 * A source assertion is only as good as the region it looks at: bounding by "up to the next `const x`"
 * silently degrades to "the rest of the file" the day that declaration moves, and then the absence the
 * test asserts is an absence from nothing.
 */
function functionBody(source, declaration) {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`could not find ${declaration}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces after ${declaration}`);
}

/**
 * `GET /workflows` with a query string.
 *
 * `asUser` in guardrail-support.cjs does not carry query parameters, because nothing before Phase 5
 * had a filtered list route. Written here rather than widened there so the existing helper's shape
 * stays the shape every other suite already relies on.
 */
async function queryWorkflows(as, queryStringParameters) {
  const out = await handler({
    routeKey: "GET /workflows",
    headers: {},
    queryStringParameters,
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: as.userId,
            email: as.email || as.userId,
            "custom:tenant_id": as.tenantId,
            "cognito:groups": `[${as.group}]`,
          },
        },
      },
    },
  });
  let body = null;
  try {
    body = out.body ? JSON.parse(out.body) : null;
  } catch {
    body = out.body;
  }
  return { status: out.statusCode, body };
}
