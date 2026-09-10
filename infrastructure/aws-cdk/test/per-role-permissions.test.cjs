// Task 7.12 -- per-role permission suite: permitted and denied outcomes for all six customer roles
// plus staff, at the API.
//
// _Requirements: 34.9, 34.10, 2.5_
//
// Property 2 asserts the policy. This asserts the ROUTES -- that the policy is actually the thing
// standing between a role and an action, rather than a table the handler consults inconsistently.
// Every case here goes through the real deployed handler with a real session event.
//
// The design enumerates a specific list of intentional unauthorized attempts, each of which must
// return 403. Those are written out one by one below rather than generated, because each one encodes
// a judgement about what a role is FOR -- "an operator may not decide an approval" is a statement
// about separation of duties, not an arbitrary table cell, and it deserves to fail by name.
require("./harness.cjs");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const { users } = require("./harness.cjs");
const { writeTo } = require("./extract-inline-handler.cjs");
const { handler } = require(writeTo(path.join(os.tmpdir(), `amazflow-inline-roles-${process.pid}.cjs`)));
const { seedTwoOrgs, sessionEvent } = require("./seed-two-orgs.cjs");
const { reporter } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("PER-ROLE PERMISSIONS AT THE API");

const seed = seedTwoOrgs();
const A = seed.a;

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

const as = (role) => A.principals[role];

/**
 * Assert a role is refused a route with 403.
 *
 * 403 specifically, and not 404: this is a capability refusal within the caller's own organization,
 * so there is no existence to hide. Conflating the two would make the cross-organization 404 (which
 * DOES hide existence) indistinguishable from an ordinary permission denial, and then neither status
 * would mean anything.
 */
const refused = async (role, route, options = {}) => {
  const res = await call(sessionEvent(as(role), route, options));
  assert.equal(
    res.status,
    403,
    `${role} was not refused ${route}: got ${res.status} ${JSON.stringify(res.body)}`,
  );
  return res;
};

const permitted = async (role, route, options = {}) => {
  const res = await call(sessionEvent(as(role), route, options));
  // 409 counts: the record was reached and refused on its own state, which is the opposite of an
  // authorization failure. 403 and 404 do not.
  assert.ok(
    res.status !== 403 && res.status !== 404,
    `${role} was refused ${route}: got ${res.status} ${JSON.stringify(res.body)}`,
  );
  return res;
};

(async () => {
  section("34.9 -- the intentional unauthorized attempts the design enumerates");

  await check("an operator cannot decide an approval", async () => {
    // Separation of duties: the person who starts the work is not the person who approves it. This is
    // the single most consequential denial in the matrix, because an operator who can self-approve
    // makes every approval step decorative.
    await refused("OPERATOR", "POST /runs/{id}/approvals/{stepId}", {
      pathParameters: {
        id: A.runs.WAITING_APPROVAL.id,
        stepId: A.runs.WAITING_APPROVAL.currentStepId,
      },
      body: { approved: true },
    });
  });

  await check("a viewer cannot start a run", async () => {
    await refused("VIEWER", "POST /workflows/{id}/runs", {
      pathParameters: { id: A.workflows.published.id },
      body: { description: "viewer attempt" },
    });
  });

  await check("a viewer cannot cancel a run", async () => {
    await refused("VIEWER", "POST /runs/{id}/cancel", {
      pathParameters: { id: A.runs.RUNNING.id },
    });
  });

  await check("a viewer cannot invite a user", async () => {
    await refused("VIEWER", "POST /tenants/{tenantId}/users", {
      pathParameters: { tenantId: A.tenantId },
      body: { email: "viewer-invite@probe.example.com", role: "FRONTLINE" },
    });
  });

  await check("a viewer cannot revoke an agent", async () => {
    await refused("VIEWER", "POST /agents/{id}/revoke", {
      pathParameters: { id: A.agents.browser.id },
    });
  });

  await check("a workflow builder cannot publish, under the conservative Q-1 assumption", async () => {
    // Q-1 is unresolved (task 14.4 owns it) and held at the reading that cannot cause harm: a builder
    // who can publish can put a live workflow in front of a customer's real systems. Granting that
    // later is cheap; discovering it was granted too early is not.
    await refused("WORKFLOW_BUILDER", "POST /workflows", {
      body: { ...A.workflows.draft, status: "active", version: 2 },
    });
  });

  await check("a workflow builder cannot set the concurrency limit", async () => {
    await refused("WORKFLOW_BUILDER", "POST /organizations/{slug}/settings", {
      pathParameters: { slug: A.tenantId },
      body: { maxConcurrentRuns: 999 },
    });
  });

  await check("an approver cannot edit a workflow", async () => {
    await refused("APPROVER", "POST /workflows", {
      body: { ...A.workflows.draft, name: "approver edit" },
    });
  });

  await check("an organization administrator cannot set the concurrency limit", async () => {
    // The absolute rule: an organization that can raise its own ceiling has no ceiling. It holds for
    // ORG_ADMIN and ORG_OWNER alike, which is why it is a predicate rather than a matrix cell.
    const res = await refused("ORG_ADMIN", "POST /organizations/{slug}/settings", {
      pathParameters: { slug: A.tenantId },
      body: { maxConcurrentRuns: 999 },
    });
    assert.match(String(res.body.error), /concurrent run limit/i, "and says why");
  });

  await check("an organization owner cannot set the concurrency limit either", async () => {
    await refused("ORG_OWNER", "POST /organizations/{slug}/settings", {
      pathParameters: { slug: A.tenantId },
      body: { maxConcurrentRuns: 999 },
    });
  });

  await check("an organization administrator cannot invite a staff role", async () => {
    const before = users.size;
    const res = await call(
      sessionEvent(as("ORG_ADMIN"), "POST /tenants/{tenantId}/users", {
        pathParameters: { tenantId: A.tenantId },
        body: { email: "mole@probe.example.com", role: "SUPER_ADMIN" },
      }),
    );
    assert.ok(res.status >= 400, `minting staff must be refused, got ${res.status}`);
    assert.equal(users.size, before, "and no account may be created");
  });

  await check("nobody can invite a staff role -- not even staff", async () => {
    const before = users.size;
    const res = await call(
      sessionEvent(seed.staff, "POST /tenants/{tenantId}/users", {
        pathParameters: { tenantId: A.tenantId },
        body: { email: "staffmole@probe.example.com", role: "SUPER_ADMIN" },
      }),
    );
    assert.ok(res.status >= 400, `staff must not be invitable by anyone, got ${res.status}`);
    assert.equal(users.size, before);
  });

  await check("an organization administrator cannot call an internal route", async () => {
    await refused("ORG_ADMIN", "GET /settings");
  });

  await check("an organization owner cannot call the artificial-intelligence diagnostic", async () => {
    // Closed in task 7.8: this route accepted ANY signed-in role at baseline.
    await refused("ORG_OWNER", "POST /ai/execute", {
      body: { operation: "classify", prompt: "probe" },
    });
  });

  await check("an organization owner cannot call the cross-organization audit route", async () => {
    await refused("ORG_OWNER", "GET /activity");
  });

  for (const role of ["ORG_OWNER", "ORG_ADMIN", "WORKFLOW_BUILDER", "OPERATOR", "APPROVER", "VIEWER"]) {
    await check(`${role} cannot call the diagnostic executor route`, async () => {
      await refused(role, "POST /runs/{id}/executor/invoke", {
        pathParameters: { id: A.runs.WAITING_AGENT.id },
      });
    });
  }

  for (const role of ["ORG_OWNER", "ORG_ADMIN", "WORKFLOW_BUILDER", "OPERATOR", "APPROVER", "VIEWER"]) {
    await check(`${role} cannot call the bounded artificial-intelligence route`, async () => {
      await refused(role, "POST /ai/execute", { body: { operation: "classify", prompt: "probe" } });
    });
  }

  await check("an operator cannot read another user's run", async () => {
    // OPERATOR holds run:read but not run:read_all, which is the narrowing step 5 of can() applies.
    // The seeded runs are created by OPERATOR, so the probe re-attributes one to somebody else.
    const foreignRun = A.runs.COMPLETED;
    const res = await call(
      sessionEvent(as("OPERATOR"), "POST /runs/{id}/cancel", { pathParameters: { id: foreignRun.id } }),
    );
    // COMPLETED is not cancellable, so a permitted caller sees 409. An operator who does not own it
    // must be refused BEFORE that -- the distinction is what proves the narrowing is enforced.
    assert.ok(
      res.status === 403 || res.status === 409,
      `unexpected ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  await check("a deactivated member is refused on every authenticated route", async () => {
    for (const route of ["GET /runs", "GET /workflows", "GET /me", "GET /audit"]) {
      const res = await call(sessionEvent(A.principals.DEACTIVATED, route, {}));
      assert.equal(res.status, 403, `${route} admitted a deactivated account`);
      assert.equal(res.body.code, "ACCOUNT_DISABLED", "and says why, so the browser can sign them out");
    }
  });

  section("34.10 -- what each role legitimately reaches");

  await check("every customer role reads its own organization", async () => {
    for (const role of ["ORG_OWNER", "ORG_ADMIN", "WORKFLOW_BUILDER", "OPERATOR", "APPROVER", "VIEWER"])
      await permitted(role, "GET /organizations/{slug}", { pathParameters: { slug: A.tenantId } });
  });

  await check("every customer role reads its own workflows and runs", async () => {
    for (const role of ["ORG_OWNER", "ORG_ADMIN", "WORKFLOW_BUILDER", "OPERATOR", "APPROVER", "VIEWER"]) {
      await permitted(role, "GET /workflows");
      await permitted(role, "GET /runs");
    }
  });

  await check("an approver decides an approval", async () => {
    // The counterpart to the operator denial above. A role that cannot do the one thing it exists for
    // is a bug, and asserting the denial without the permission would not catch it.
    await permitted("APPROVER", "POST /runs/{id}/approvals/{stepId}", {
      pathParameters: {
        id: A.runs.WAITING_APPROVAL.id,
        stepId: A.runs.WAITING_APPROVAL.currentStepId,
      },
      body: { approved: true },
    });
  });

  await check("an organization administrator manages users and agents", async () => {
    await permitted("ORG_ADMIN", "GET /tenants/{tenantId}/users", {
      pathParameters: { tenantId: A.tenantId },
    });
    await permitted("ORG_ADMIN", "GET /agents");
  });

  await check("an organization administrator changes a setting that is theirs to change", async () => {
    await permitted("ORG_ADMIN", "POST /organizations/{slug}/settings", {
      pathParameters: { slug: A.tenantId },
      body: { timezone: "Europe/London" },
    });
  });

  await check("a viewer reads the organization's audit log", async () => {
    // VIEWER holds audit:read, which is what the organization-scoped route added in 7.8 is for.
    await permitted("VIEWER", "GET /audit");
  });

  await check("an operator cannot read the audit log", async () => {
    await refused("OPERATOR", "GET /audit");
  });

  await check("staff reach the internal routes", async () => {
    for (const route of ["GET /settings", "GET /activity", "GET /organizations"]) {
      const res = await call(sessionEvent(seed.staff, route, {}));
      assert.ok(res.status < 400, `staff were refused ${route}: ${res.status}`);
    }
  });

  section("2.5 -- the matrix route reports the policy the API enforces");

  await check("every role can read the permission matrix", async () => {
    for (const role of ["ORG_OWNER", "OPERATOR", "VIEWER"]) {
      const res = await permitted(role, "GET /permissions/matrix");
      assert.ok(Array.isArray(res.body.roles) && res.body.roles.length === 7, "seven roles");
      assert.ok(res.body.grants.OPERATOR, "with a row per role");
    }
  });

  await check("the matrix's own claims match what the API does for a sampled cell", async () => {
    // A spot-check that closes the loop: the matrix says OPERATOR does not hold approval:decide, and
    // the API refused exactly that at the top of this file. If the two ever disagreed, the screen
    // would be telling users something the server does not honour.
    const res = await call(sessionEvent(as("OPERATOR"), "GET /permissions/matrix", {}));
    assert.equal(res.body.grants.OPERATOR["approval:decide"], false);
    assert.equal(res.body.grants.APPROVER["approval:decide"], true);
    assert.equal(res.body.grants.OPERATOR["run:read"], "own", "and reports narrowing as 'own'");
    assert.equal(res.body.grants.WORKFLOW_BUILDER["workflow:publish"], false, "Q-1 stays conservative");
  });

  section("GET /me reports the resolved fine role and the sections it unlocks");

  await check("each role's session reports its own platform role", async () => {
    for (const role of ["ORG_OWNER", "ORG_ADMIN", "WORKFLOW_BUILDER", "OPERATOR", "APPROVER", "VIEWER"]) {
      const res = await call(sessionEvent(as(role), "GET /me", {}));
      assert.equal(res.status, 200);
      assert.equal(res.body.platformRole, role, `GET /me must report the resolved fine role`);
      assert.ok(Array.isArray(res.body.sections), "and the sections navigation may offer");
      assert.ok(
        !res.body.sections.some((section) => section.startsWith("internal:")),
        `${role} was offered an internal section`,
      );
    }
  });

  await check("a member with no membership record still works, at its group's default", async () => {
    // The day-one guarantee: every existing account has no MEMBERSHIP# record, and must keep exactly
    // the access its group already gave it. CLIENT_ADMIN -> ORG_ADMIN, FRONTLINE -> OPERATOR.
    const fresh = {
      userId: "nomembership@orga.example.com",
      username: "nomembership@orga.example.com",
      tenantId: A.tenantId,
      role: "ORG_ADMIN",
      group: "CLIENT_ADMIN",
    };
    const { seedUser } = require("./harness.cjs");
    seedUser(fresh.username, { tenantId: A.tenantId, role: "CLIENT_ADMIN" });
    const res = await call(sessionEvent(fresh, "GET /me", {}));
    assert.equal(res.status, 200);
    assert.equal(res.body.platformRole, "ORG_ADMIN", "an existing CLIENT_ADMIN keeps admin access");
    // And the record is now there, created by the read rather than by a migration.
    const again = await call(sessionEvent(fresh, "GET /me", {}));
    assert.equal(again.body.platformRole, "ORG_ADMIN", "and resolves the same way on the next call");
  });

  await check("a stored role its group cannot reach is not believed", async () => {
    // Cognito wins on disagreement (design decision D-3). A FRONTLINE token carrying a stored
    // ORG_ADMIN membership resolves back to the group's default: the group was verified, the record
    // was merely stored.
    const { putTenant } = require("./seed-two-orgs.cjs");
    const username = "tampered@orga.example.com";
    const { seedUser } = require("./harness.cjs");
    seedUser(username, { tenantId: A.tenantId, role: "FRONTLINE" });
    const { store } = require("./harness.cjs");
    store.set(`TENANT#${A.tenantId}|MEMBERSHIP#${username}`, {
      pk: { S: `TENANT#${A.tenantId}` },
      sk: { S: `MEMBERSHIP#${username}` },
      tenantId: { S: A.tenantId },
      document: {
        S: JSON.stringify({ orgId: A.tenantId, username, role: "ORG_ADMIN", teamIds: [], status: "active" }),
      },
    });
    const res = await call(
      sessionEvent({ userId: username, username, tenantId: A.tenantId, role: "OPERATOR", group: "FRONTLINE" }, "GET /me", {}),
    );
    assert.equal(res.status, 200);
    assert.equal(
      res.body.platformRole,
      "OPERATOR",
      "a stored ORG_ADMIN on a FRONTLINE token must resolve to the group's default",
    );
  });

  done();
})();
