// Task 7.11 -- two-organization API-level isolation over every enumerated route.
//
// _Requirements: 34.4, 34.5, 34.6, 34.7, 34.8, 23.18_
//
// The difference between this and isolation-baseline.test.cjs is intent. The baseline suite is a
// RECORD: a fixed probe list, compared against a recorded JSON, whose job is to fail on drift in
// either direction. This suite is an ASSERTION: it walks the route inventory and requires that every
// entity-identifier-scoped and parameter-scoped route in it satisfies the isolation property. A new
// route added to the inventory therefore has to satisfy isolation to land, rather than waiting for
// somebody to remember to write a probe for it.
//
// That inversion is the point. The baseline could only ever cover routes somebody thought about.
require("./harness.cjs");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const { store } = require("./harness.cjs");
const { writeTo } = require("./extract-inline-handler.cjs");
const { handler } = require(writeTo(path.join(os.tmpdir(), `amazflow-inline-isoapi-${process.pid}.cjs`)));
const { seedTwoOrgs, sessionEvent, agentEvent } = require("./seed-two-orgs.cjs");
const { reporter } = require("./guardrail-support.cjs");
const inventory = require("./route-inventory.json");

const { check, section, done } = reporter("TWO-ORGANIZATION API ISOLATION");

const seed = seedTwoOrgs();
const A = seed.a;
const B = seed.b;

const call = async (event) => {
  const res = await handler(event);
  let body = null;
  try {
    body = res.body ? JSON.parse(res.body) : null;
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body };
};

/** Does this response body contain anything identifiably Org B's? */
const leaksOrgB = (body) => {
  const text = JSON.stringify(body ?? null);
  // The organization slug is the cheapest tell, and the seed deliberately gives the two
  // organizations different identifiers so that any appearance is unambiguous.
  return text.includes(B.tenantId) || text.includes(`${B.label}_`);
};

/* ------------------------------------------------------------- entity-identifier-scoped routes -- */

// For each id-scoped route: the identifier to send, and what Org A's own equivalent is. Written out
// rather than derived, because the id a route wants is route-specific -- but the LIST is checked
// against the inventory below, so nothing can be quietly omitted.
const idScoped = () => [
  { route: "POST /runs/{id}/cancel", own: { id: A.runs.RUNNING.id }, foreign: { id: B.runs.RUNNING.id } },
  { route: "POST /runs/{id}/resume", own: { id: A.runs.FAILED.id }, foreign: { id: B.runs.FAILED.id } },
  {
    route: "POST /runs/{id}/approvals/{stepId}",
    own: { id: A.runs.WAITING_APPROVAL.id, stepId: A.runs.WAITING_APPROVAL.currentStepId },
    foreign: { id: B.runs.WAITING_APPROVAL.id, stepId: B.runs.WAITING_APPROVAL.currentStepId },
    body: { approved: true },
    as: "APPROVER",
  },
  {
    route: "POST /runs/{id}/confirmations/{stepId}/confirm",
    own: { id: A.runs.AWAITING_CONFIRMATION.id, stepId: A.runs.AWAITING_CONFIRMATION.currentStepId },
    foreign: { id: B.runs.AWAITING_CONFIRMATION.id, stepId: B.runs.AWAITING_CONFIRMATION.currentStepId },
  },
    // The DESKTOP agent, deliberately: the browser agent's token is used by the agent-credential
  // probes below, and revoking it here would make those fail for the wrong reason.
  { route: "POST /agents/{id}/revoke", own: { id: A.agents.desktop.id }, foreign: { id: B.agents.desktop.id } },
  {
    route: "POST /agent-tasks/{id}/result",
    own: { id: A.tasks.browser.id },
    foreign: { id: B.tasks.browser.id },
    body: { ok: true, result: { status: "Inactive" } },
  },
  {
    route: "POST /support/tickets/{id}/status",
    own: { id: A.ticket.id },
    foreign: { id: B.ticket.id },
    body: { status: "closed" },
  },
  { route: "GET /workflows/{id}/versions", own: { id: A.workflows.published.id }, foreign: { id: B.workflows.published.id } },
  { route: "GET /workflows/{id}/preflight", own: { id: A.workflows.published.id }, foreign: { id: B.workflows.published.id } },
  {
    route: "POST /notifications/{id}/read",
    own: { id: A.notifications[0].id },
    foreign: { id: B.notifications[0].id },
  },
  // Phase 5's workflow lifecycle. The draft route is the interesting one: the ONLY organization it
  // will write into is the caller's own, and the body deliberately names Org B's tenantId so that a
  // route reading it would land the definition there. Ordered before the transitions because they
  // change the status the transitions then assert on.
  //
  // The first version of this route CREATED whatever identifier was addressed, so a foreign id
  // produced a new workflow in the caller's own organization carrying that id. This probe is what
  // caught it, and the route now only creates under the reserved `new` value.
  {
    route: "POST /workflows/{id}/draft",
    own: { id: A.workflows.draft.id },
    foreign: { id: B.workflows.draft.id },
    body: {
      tenantId: B.tenantId,
      name: "isolation probe draft",
      startAt: "s_end",
      allowedProviders: ["mock"],
      steps: [{ id: "s_end", type: "end", outcome: "success", name: "Done" }],
    },
  },
  {
    route: "POST /workflows/{id}/duplicate",
    own: { id: A.workflows.draft.id },
    foreign: { id: B.workflows.draft.id },
  },
  {
    route: "POST /workflows/{id}/unpublish",
    own: { id: A.workflows.published.id },
    foreign: { id: B.workflows.published.id },
  },
  {
    route: "POST /workflows/{id}/publish",
    own: { id: A.workflows.published.id },
    foreign: { id: B.workflows.published.id },
  },
  // Last of the workflow probes: archiving Org A's own draft makes it unrunnable, and a probe that
  // did that before the ones above would fail them for a reason that has nothing to do with isolation.
  {
    route: "POST /workflows/{id}/archive",
    own: { id: A.workflows.draft.id },
    foreign: { id: B.workflows.draft.id },
  },
  {
    route: "PUT /teams/{id}",
    own: { id: A.teams.primary.id },
    foreign: { id: B.teams.primary.id },
    body: { name: "renamed by probe" },
  },
  {
    // The username in the body is deliberately Org A's own: the foreign case must be refused because
    // the TEAM is another organization's, not because the person named is unknown. A probe that sent
    // Org B's username would pass even if the team lookup were unscoped.
    route: "POST /teams/{id}/members",
    own: { id: A.teams.primary.id },
    foreign: { id: B.teams.primary.id },
    body: { username: A.principals.APPROVER.username },
  },
  {
    route: "DELETE /teams/{id}/members/{username}",
    own: { id: A.teams.primary.id, username: A.principals.APPROVER.username },
    foreign: { id: B.teams.primary.id, username: A.principals.APPROVER.username },
  },
  // Destructive, so last among the team probes: deleting the team the probes above address would
  // make them fail for a reason that has nothing to do with isolation. The SECONDARY team is used
  // for the accepted case so `GET /teams` below still has a row to assert on.
  {
    route: "DELETE /teams/{id}",
    own: { id: A.teams.secondary.id },
    foreign: { id: B.teams.secondary.id },
  },
  {
    route: "POST /workflows/{id}/runs",
    own: { id: A.workflows.published.id },
    foreign: { id: B.workflows.published.id },
    body: { description: "isolation probe" },
  },
  {
    route: "POST /connections/browser/{id}/login-session",
    own: { id: A.connection.id },
    foreign: { id: B.connection.id },
  },
  // Last, and after the login-session probe: revoking the connection is destructive, and a probe
  // that removes the fixture a later probe needs would fail for a reason that has nothing to do
  // with isolation.
  {
    route: "DELETE /connections/browser/{id}",
    own: { id: A.connection.id },
    foreign: { id: B.connection.id },
  },
  // Rotate before delete, for the same reason as the connection probes above: delete is destructive
  // and would make a later rotate probe fail for a reason unrelated to isolation.
  {
    route: "POST /secrets/{id}/rotate",
    own: { id: A.secret.id },
    foreign: { id: B.secret.id },
    body: { value: "isolation-probe-rotated-value" },
  },
  {
    route: "DELETE /secrets/{id}",
    own: { id: A.secret.id },
    foreign: { id: B.secret.id },
  },
];

/* ------------------------------------------------------------------------- staff-only routes ---- */

// Routes no customer role reaches at all. These need a DIFFERENT isolation argument from the ones
// above, and the difference matters: because the refusal does not depend on the organization, it
// cannot be an existence oracle. What must be asserted is exactly that -- the refusal for the
// caller's OWN identifier and for a foreign one must be identical, so a customer cannot use the
// route to learn whether a record exists anywhere.
const staffOnly = () => [
  {
    route: "PUT /organizations/{slug}",
    own: { slug: A.tenantId },
    foreign: { slug: B.tenantId },
    body: { name: "renamed by probe" },
  },
  {
    route: "POST /runs/{id}/executor/invoke",
    own: { id: A.runs.WAITING_AGENT.id },
    foreign: { id: B.runs.WAITING_AGENT.id },
  },
  {
    route: "POST /tenants/{tenantId}/users/{username}/sessions/revoke",
    own: { tenantId: A.tenantId, username: A.principals.OPERATOR.username },
    foreign: { tenantId: B.tenantId, username: B.principals.OPERATOR.username },
  },
  {
    route: "POST /copilot/actions/{id}/apply",
    own: { id: "copilot_action_nonexistent" },
    foreign: { id: "copilot_action_nonexistent_b" },
  },
  {
    route: "POST /copilot/actions/{id}/discard",
    own: { id: "copilot_action_nonexistent" },
    foreign: { id: "copilot_action_nonexistent_b" },
  },
];

/* ------------------------------------------------------- routes with their own isolation story --- */

// Two routes whose isolation argument is neither "404 for a foreign id" nor "staff only", recorded
// here so that the completeness check above cannot be satisfied by silence.
const specialCase = () => [
  {
    route: "GET /organizations/{slug}/onboarding",
    why:
      "Onboarding depth is an internal staff surface. Customer callers receive only an error for " +
      "either tenant, and the response cannot disclose the requested organization's onboarding state.",
    async assertIt() {
      const own = await call({
        ...sessionEvent(A.principals.ORG_OWNER, "GET /organizations/{slug}/onboarding", {
          pathParameters: { slug: A.tenantId },
        }),
      });
      const foreign = await call({
        ...sessionEvent(A.principals.ORG_OWNER, "GET /organizations/{slug}/onboarding", {
          pathParameters: { slug: B.tenantId },
        }),
      });
      assert.ok(own.status >= 400 && foreign.status >= 400, "customer onboarding reads are refused");
      assert.ok(!leaksOrgB(own.body) && !leaksOrgB(foreign.body), "onboarding errors leak no tenant data");
    },
  },
  {
    route: "PUT /organizations/{slug}/onboarding",
    why:
      "Onboarding updates are an internal staff surface. Customer callers cannot update either " +
      "tenant, and the response cannot disclose the requested organization's onboarding state.",
    async assertIt() {
      const own = await call({
        ...sessionEvent(A.principals.ORG_OWNER, "PUT /organizations/{slug}/onboarding", {
          pathParameters: { slug: A.tenantId },
          body: { checklist: {} },
        }),
      });
      const foreign = await call({
        ...sessionEvent(A.principals.ORG_OWNER, "PUT /organizations/{slug}/onboarding", {
          pathParameters: { slug: B.tenantId },
          body: { checklist: {} },
        }),
      });
      assert.ok(own.status >= 400 && foreign.status >= 400, "customer onboarding writes are refused");
      assert.ok(!leaksOrgB(own.body) && !leaksOrgB(foreign.body), "onboarding errors leak no tenant data");
    },
  },
  {
    route: "GET /organizations/{slug}/branding",
    why:
      "Deliberately unauthenticated for any slug (recorded as ISO-28). A sign-in page has to brand " +
      "itself before a session exists. Asserted to return ONLY name and branding -- the isolation " +
      "control here is the response shape, not the caller's organization.",
    async assertIt() {
      const res = await call({ routeKey: "GET /organizations/{slug}/branding", pathParameters: { slug: B.tenantId } });
      assert.equal(res.status, 200, "any caller may read branding");
      assert.deepEqual(
        Object.keys(res.body).sort(),
        ["branding", "name", "slug"],
        "and may read NOTHING else -- no run, user, agent or execution data",
      );
    },
  },
  {
    route: "POST /agent-authorizations/{code}/exchange",
    why:
      "The path parameter is a one-time authorization code, not an entity id. A code is unguessable " +
      "and single-use, so the isolation control is the code itself; what must hold is that a code " +
      "issued in one organization mints a credential for THAT organization only.",
    async assertIt() {
      const res = await call({
        routeKey: "POST /agent-authorizations/{code}/exchange",
        pathParameters: { code: "definitely-not-a-real-code" },
      });
      assert.ok(res.status >= 400, "an unknown code is refused");
      assert.ok(!leaksOrgB(res.body), "and the refusal names no organization");
    },
  },
  {
    route: "POST /invitations/{token}/accept",
    why:
      "The path parameter is a single-use invitation token, not an entity id, and the organization " +
      "and role are resolved SERVER-side from the token rather than read from the caller. There is " +
      "therefore no identifier a caller could substitute; what must hold is that an unknown token is " +
      "refused without naming any organization, and that a known token cannot be redirected by the body.",
    async assertIt() {
      const unknown = await call(
        sessionEvent(A.principals.OPERATOR, "POST /invitations/{token}/accept", {
          pathParameters: { token: "definitely-not-a-real-invitation-token" },
          body: { orgId: B.tenantId, role: "ORG_OWNER" },
        }),
      );
      assert.equal(unknown.status, 404, `an unknown token is Not Found, got ${unknown.status}`);
      assert.ok(!leaksOrgB(unknown.body), "and the refusal names no organization");
      // The body named Org B and an owner role. If either were read, a membership would exist.
      const planted = [...store.keys()].filter((key) =>
        key.startsWith(`TENANT#${B.tenantId}|MEMBERSHIP#${A.principals.OPERATOR.username}`),
      );
      assert.deepEqual(planted, [], "a body naming another organization created nothing there");
    },
  },
  {
    route: "POST /connections/browser/{id}/login-session/complete",
    why:
      "Same id-scoped shape as its sibling, but it requires a login session that the probe above " +
      "consumed. Asserted for the foreign-id case only, which is the isolation claim.",
    async assertIt() {
      const res = await call(
        sessionEvent(A.principals.ORG_ADMIN, "POST /connections/browser/{id}/login-session/complete", {
          pathParameters: { id: B.connection.id },
          body: {},
        }),
      );
      assert.equal(res.status, 404, `expected 404 for another organization's connection, got ${res.status}`);
      assert.ok(!leaksOrgB(res.body), "and nothing of Org B's came back");
    },
  },
];

/* -------------------------------------------------------------------- parameter-scoped routes --- */

const paramScoped = () => [
  { route: "GET /organizations/{slug}", key: "slug" },
  { route: "POST /organizations/{slug}/settings", key: "slug", body: { timezone: "UTC" } },
  { route: "POST /organizations/{slug}/branding", key: "slug", body: { displayName: "Probe" } },
  { route: "POST /organizations/{slug}/profile", key: "slug", body: { primaryDomain: "probe.example.com" } },
  { route: "GET /tenants/{tenantId}/summary", key: "tenantId" },
  { route: "GET /tenants/{tenantId}/users", key: "tenantId" },
  { route: "POST /tenants/{tenantId}/users", key: "tenantId", body: { email: "mole@probe.example.com", role: "FRONTLINE" } },
  {
    route: "POST /tenants/{tenantId}/users/{username}/status",
    key: "tenantId",
    extra: (org) => ({ username: org.principals.OPERATOR.username }),
    body: { enabled: false },
  },
  {
    route: "POST /tenants/{tenantId}/users/{username}/role",
    key: "tenantId",
    extra: (org) => ({ username: org.principals.OPERATOR.username }),
    body: { role: "VIEWER" },
  },
  {
    route: "POST /tenants/{tenantId}/users/{username}/invitation/resend",
    key: "tenantId",
    extra: (org) => ({ username: org.principals.OPERATOR.username }),
  },
  {
    route: "DELETE /tenants/{tenantId}/users/{username}/invitation",
    key: "tenantId",
    extra: (org) => ({ username: org.principals.OPERATOR.username }),
  },
];

(async () => {
  section("the route list is complete against the inventory");

  await check("34.8 every id-scoped and parameter-scoped route in the inventory is probed here", () => {
    // The guard that makes this suite an assertion rather than a sample: a new route classified as
    // id-scoped or parameter-scoped fails the build until it is probed.
    const probed = new Set(
      [...idScoped(), ...paramScoped(), ...staffOnly(), ...specialCase()].map((entry) => entry.route),
    );
    const shouldProbe = inventory.routes
      .filter((entry) => ["entity-identifier-scoped", "parameter-scoped"].includes(entry.orgScope))
      .map((entry) => entry.route);
    const missing = shouldProbe.filter((route) => !probed.has(route)).sort();
    assert.deepEqual(
      missing,
      [],
      `these routes take an identifier and are not probed for cross-organization isolation: ${missing.join(", ")}`,
    );
  });

  section("34.4 -- a foreign identifier is indistinguishable from an absent one");

  for (const entry of idScoped()) {
    await check(`${entry.route} -- Org A's own identifier is accepted`, async () => {
      const principal = A.principals[entry.as || "ORG_ADMIN"];
      const res = await call(
        sessionEvent(principal, entry.route, { pathParameters: entry.own, body: entry.body }),
      );
      // A 409 is a legitimate success for this purpose: the record was FOUND and refused on its own
      // state (wrong status for this transition). What must not happen is 404 or 403, either of which
      // would mean the caller cannot reach its own organization's record.
      assert.ok(
        res.status !== 404 && res.status !== 403,
        `own identifier was refused with ${res.status}: ${JSON.stringify(res.body)}`,
      );
    });

    await check(`${entry.route} -- Org B's identifier returns 404 and leaks nothing`, async () => {
      const principal = A.principals[entry.as || "ORG_ADMIN"];
      const res = await call(
        sessionEvent(principal, entry.route, { pathParameters: entry.foreign, body: entry.body }),
      );
      assert.equal(
        res.status,
        404,
        `expected 404 for another organization's identifier, got ${res.status}: ${JSON.stringify(res.body)}`,
      );
      assert.ok(
        !leaksOrgB(res.body),
        `the response carried Org B data: ${JSON.stringify(res.body)}`,
      );
    });
  }

  for (const entry of paramScoped()) {
    await check(`${entry.route} -- Org B's organization identifier returns 404`, async () => {
      const pathParameters = {
        [entry.key]: B.tenantId,
        ...(entry.extra ? entry.extra(B) : {}),
      };
      const res = await call(
        sessionEvent(A.principals.ORG_ADMIN, entry.route, { pathParameters, body: entry.body }),
      );
      assert.equal(
        res.status,
        404,
        `expected 404, got ${res.status}: ${JSON.stringify(res.body)}`,
      );
      assert.ok(!leaksOrgB(res.body), `the response carried Org B data: ${JSON.stringify(res.body)}`);
    });
  }

  section("34.4 -- a staff-only route reveals nothing by the shape of its refusal");

  for (const entry of staffOnly()) {
    await check(`${entry.route} -- a customer is refused identically for its own and a foreign identifier`, async () => {
      const asOwn = await call(
        sessionEvent(A.principals.ORG_OWNER, entry.route, { pathParameters: entry.own, body: entry.body }),
      );
      const asForeign = await call(
        sessionEvent(A.principals.ORG_OWNER, entry.route, { pathParameters: entry.foreign, body: entry.body }),
      );
      assert.equal(asOwn.status, 403, `a customer must not reach ${entry.route}`);
      // Identical status AND identical message: a difference in either would be the oracle.
      assert.equal(
        asForeign.status,
        asOwn.status,
        "the refusal must not vary with the organization named",
      );
      assert.equal(
        asForeign.body.error,
        asOwn.body.error,
        "and the message must not vary either",
      );
      assert.ok(!leaksOrgB(asForeign.body), "and it must name nothing of Org B's");
    });
  }

  section("routes whose isolation argument is their own");

  for (const entry of specialCase()) {
    await check(`${entry.route} -- ${entry.why}`, entry.assertIt);
  }

  section("34.6 -- a body naming another organization is refused, or audited for staff");

  await check("a customer admin cannot redirect an agent authorization into another organization", async () => {
    const before = countAgents(B.tenantId);
    const res = await call(
      sessionEvent(A.principals.ORG_ADMIN, "POST /agent-authorizations", {
        body: { name: "redirect probe", tenantId: B.tenantId },
      }),
    );
    assert.equal(res.status, 201, "the request itself is legitimate; only the tenantId must be ignored");
    assert.equal(countAgents(B.tenantId), before, "nothing landed in Org B");
    assert.ok(!leaksOrgB(res.body), "and the response names only the caller's own organization");
  });

  await check("a staff cross-organization write lands and is audited in the target organization", async () => {
    const before = countActivity(B.tenantId);
    const res = await call(
      sessionEvent(seed.staff, "POST /agent-authorizations", {
        body: { name: "staff provisioned", tenantId: B.tenantId },
      }),
    );
    assert.equal(res.status, 201);
    assert.ok(countActivity(B.tenantId) > before, "the write is audited against Org B");
  });

  section("34.5 -- list routes return nothing belonging to another organization");

  // `GET /notifications` and `GET /teams` are enumerated here (task 12.4) rather than left to
  // Property 1's general `tenantRead` argument. Both organizations are seeded with teams and with
  // notifications addressed three different ways, so if either list were ever rebuilt on a scan the
  // probe below would return Org B's records and fail -- which the structural argument alone cannot
  // detect, because it only says the CURRENT implementation is partitioned.
  for (const route of [
    "GET /workflows",
    "GET /runs",
    "GET /agents",
    "GET /agent-tasks",
    "GET /support/tickets",
    "GET /connections/browser",
    "GET /audit",
    "GET /notifications",
    "GET /teams",
  ]) {
    await check(`${route} -- asserted on the complete returned set`, async () => {
      const res = await call(sessionEvent(A.principals.ORG_ADMIN, route, {}));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      // Most list routes return a bare array; `GET /teams` returns an envelope, because it also has
      // to state that team membership grants no permissions. Unwrapped rather than special-cased at
      // the call site so a route that returned an empty envelope could not pass by returning nothing.
      const items = Array.isArray(res.body)
        ? res.body
        : res.body && Array.isArray(res.body.teams)
          ? res.body.teams
          : [];
      assert.ok(items.length > 0, `${route} returned no rows, so the assertion below is vacuous`);
      // Asserted on EVERY item, not on a sample and not on the count: a leak of one record is the
      // whole defect, and a count assertion would pass a list that swapped one item for another's.
      const foreign = items.filter(
        (item) => item && item.tenantId !== undefined && item.tenantId !== A.tenantId,
      );
      assert.deepEqual(
        foreign.map((item) => item.id),
        [],
        `${route} returned records belonging to another organization`,
      );
      assert.ok(!leaksOrgB(res.body), `${route} leaked an Org B value`);
    });
  }

  section("34.7 / 23.18 -- staff cross-organization reads succeed and are audited");

  await check("a staff read of another organization succeeds", async () => {
    const res = await call(
      sessionEvent(seed.staff, "GET /organizations/{slug}", { pathParameters: { slug: B.tenantId } }),
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.slug, B.tenantId, "staff genuinely see the other organization -- that is intended");
  });

  await check("and it produces a cross-tenant read audit event carrying the reason", async () => {
    const before = activityActions(B.tenantId);
    await call(
      sessionEvent(seed.staff, "GET /organizations/{slug}", { pathParameters: { slug: B.tenantId } }),
    );
    const after = activityActions(B.tenantId);
    assert.ok(
      after.length > before.length,
      "a staff cross-organization read must leave an audit record",
    );
    const recorded = after.filter((entry) => entry.action === "CROSS_TENANT_READ");
    assert.ok(recorded.length > 0, "and it must be recorded AS a cross-tenant read");
    assert.ok(
      recorded.some((entry) => entry.details && entry.details.permission),
      "carrying what was accessed",
    );
  });

  await check("a customer's own organization read produces no cross-tenant audit event", async () => {
    // The other direction: if every read were audited as cross-tenant the event would be worthless.
    const before = activityActions(A.tenantId).filter((e) => e.action === "CROSS_TENANT_READ").length;
    await call(
      sessionEvent(A.principals.ORG_ADMIN, "GET /organizations/{slug}", {
        pathParameters: { slug: A.tenantId },
      }),
    );
    const after = activityActions(A.tenantId).filter((e) => e.action === "CROSS_TENANT_READ").length;
    assert.equal(after, before, "reading your own organization is not a cross-tenant read");
  });

  section("34.8 -- an agent credential is confined to its own organization");

  await check("an Org A agent credential is offered only Org A tasks", async () => {
    const res = await call(agentEvent(A.tokens.browser, "GET /agent/tasks", {}));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const foreign = (res.body || []).filter((task) => task.tenantId !== A.tenantId);
    assert.deepEqual(foreign, [], "an agent was offered another organization's task");
  });

  await check("an Org A agent credential cannot claim an Org B task by identifier", async () => {
    const res = await call(
      agentEvent(A.tokens.browser, "POST /agent/tasks/{id}/claim", {
        pathParameters: { id: B.tasks.browser.id },
      }),
    );
    assert.equal(res.status, 404, `expected 404, got ${res.status}`);
    assert.ok(!leaksOrgB(res.body), "and nothing of Org B's came back");
  });

  await check("an Org A agent credential cannot report a result for an Org B task", async () => {
    const res = await call(
      agentEvent(A.tokens.browser, "POST /agent/tasks/{id}/result", {
        pathParameters: { id: B.tasks.browser.id },
        body: { ok: true, result: {} },
        grant: "not-a-real-grant",
      }),
    );
    assert.ok(res.status === 404 || res.status === 409, `expected 404 or 409, got ${res.status}`);
    assert.ok(!leaksOrgB(res.body), "and nothing of Org B's came back");
  });

  done();
})();

/* ------------------------------------------------------------------------------- store helpers -- */

function countAgents(tenantId) {
  return [...store.keys()].filter((key) => key.startsWith(`TENANT#${tenantId}|AGENT#`)).length;
}
function countActivity(tenantId) {
  return [...store.keys()].filter((key) => key.startsWith(`TENANT#${tenantId}|ACTIVITY#`)).length;
}
function activityActions(tenantId) {
  return [...store.entries()]
    .filter(([key]) => key.startsWith(`TENANT#${tenantId}|ACTIVITY#`))
    .map(([, item]) => JSON.parse(item.document.S));
}
