// Focused Phase 4 administration tests against the control-plane source embedded in the deployable
// template. These exercise the deployed copy rather than a restatement of its helpers.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const {
  store,
  seedUser,
  resetPool,
  groups,
  users,
  cognitoFaults,
} = require("./harness.cjs");
const { writeTo } = require("./extract-inline-handler.cjs");
const { handler } = require(
  writeTo(path.join(os.tmpdir(), `amazflow-phase4-administration-${process.pid}.cjs`)),
);

const TENANT = "northwind";
const OTHER = "contoso";
const ADMIN_EMAIL = "owner@northwind.example";
const MEMBER_EMAIL = "member@northwind.example";
const now = () => new Date().toISOString();

const put = (pk, sk, document, extra = {}) =>
  store.set(`${pk}|${sk}`, {
    pk: { S: pk },
    sk: { S: sk },
    document: { S: JSON.stringify(document) },
    updatedAt: { S: now() },
    ...extra,
  });

const seedOrganization = (overrides = {}) => {
  const organization = {
    id: "org_northwind",
    name: "Northwind Logistics",
    slug: TENANT,
    status: "active",
    plan: "pilot",
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
  put("PLATFORM", `ORG#${TENANT}`, organization);
  return organization;
};

const seedMembership = (email, overrides = {}) => {
  const membership = {
    orgId: TENANT,
    username: email,
    role: "OPERATOR",
    teamIds: [],
    status: "active",
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
  put(`TENANT#${TENANT}`, `MEMBERSHIP#${email}`, membership, { tenantId: { S: TENANT } });
  return membership;
};

const load = (pk, sk) => {
  const item = store.get(`${pk}|${sk}`);
  return item && item.document?.S ? JSON.parse(item.document.S) : null;
};

const reset = () => {
  store.clear();
  resetPool();
};

const claims = ({
  role = "SUPER_ADMIN",
  tenantId = TENANT,
  email = role === "SUPER_ADMIN" ? "staff@amazflow.example" : ADMIN_EMAIL,
} = {}) => ({
  sub: email,
  email,
  "custom:tenant_id": tenantId,
  "cognito:groups": `[${role}]`,
});

let requestSequence = 0;
const call = async (routeKey, { as = {}, body, pathParameters } = {}) => {
  const response = await handler({
    routeKey,
    requestContext: {
      requestId: `phase4-${++requestSequence}`,
      http: { sourceIp: `198.51.100.${(requestSequence % 200) + 1}` },
      authorizer: { jwt: { claims: claims(as) } },
    },
    headers: {},
    pathParameters,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.statusCode, body: JSON.parse(response.body) };
};

const groupsOf = (username) =>
  [...groups.entries()]
    .filter(([, members]) => members.has(username))
    .map(([group]) => group)
    .sort();

let passed = 0;
let failed = 0;
const check = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(
      () => {
        passed += 1;
        console.log(`  PASS  ${name}`);
      },
      (error) => {
        failed += 1;
        console.log(`  FAIL  ${name}\n        ${error && error.stack ? error.stack : error}`);
      },
    );

(async () => {
  console.log("\nPHASE 4 ADMINISTRATION\n");

  await check("concurrent organization creation atomically reserves distinct slugs", async () => {
    reset();
    const responses = await Promise.all([
      call("POST /organizations", { body: { name: "Parallel Parcel" } }),
      call("POST /organizations", { body: { name: "Parallel Parcel" } }),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [201, 201]);
    const slugs = responses.map((response) => response.body.slug);
    assert.equal(new Set(slugs).size, 2, JSON.stringify(responses));
    assert.deepEqual(new Set(slugs), new Set(["parallel-parcel", "parallel-parcel-2"]));
    for (const slug of slugs) {
      assert.ok(store.has(`PLATFORM|ORG#${slug}`), `${slug} organization was persisted`);
      assert.ok(store.has(`PLATFORM|SLUGRESERVED#${slug}`), `${slug} was permanently reserved`);
    }
  });

  await check("organization projections hide internal lifecycle and CRM fields from customers", async () => {
    reset();
    seedOrganization({
      lifecycleStatus: "trial",
      accountOwnerUserId: "staff_account_owner",
      crmRecordId: "crm_123",
      primaryDomain: "northwind.example",
    });
    seedUser(ADMIN_EMAIL, { tenantId: TENANT, role: "CLIENT_ADMIN" });
    seedMembership(ADMIN_EMAIL, { role: "ORG_ADMIN" });

    const customer = await call("GET /organizations/{slug}", {
      as: { role: "CLIENT_ADMIN", email: ADMIN_EMAIL },
      pathParameters: { slug: TENANT },
    });
    assert.equal(customer.status, 200, JSON.stringify(customer.body));
    assert.equal(customer.body.primaryDomain, "northwind.example");
    for (const field of ["lifecycleStatus", "accountOwnerUserId", "crmRecordId"])
      assert.ok(!(field in customer.body), `${field} leaked to a customer response`);

    const staff = await call("GET /organizations/{slug}", {
      pathParameters: { slug: TENANT },
    });
    assert.equal(staff.status, 200, JSON.stringify(staff.body));
    assert.equal(staff.body.lifecycleStatus, "trial");
    assert.equal(staff.body.accountOwnerUserId, "staff_account_owner");
    assert.equal(staff.body.crmRecordId, "crm_123");

    const changed = await call("PUT /organizations/{slug}", {
      pathParameters: { slug: TENANT },
      body: { status: "paused", lifecycleStatus: "active" },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.ok(!("activatedAt" in load("PLATFORM", `ORG#${TENANT}`)), "activation is not inferred from an administrative status change");
    const lifecycleEvents = [...store.values()]
      .filter((item) => item.pk.S === `TENANT#${TENANT}` && item.sk.S.startsWith("ACTIVITY#"))
      .map((item) => JSON.parse(item.document.S))
      .filter((entry) => entry.action === "ORG_STATUS_CHANGED");
    assert.deepEqual(new Set(lifecycleEvents.map((entry) => entry.details.field)), new Set(["executionStatus", "lifecycleStatus"]));
  });

  await check("the user list reconciles account state without losing fine role, teams, or login history", async () => {
    reset();
    seedOrganization();
    seedUser(MEMBER_EMAIL, { tenantId: TENANT, role: "CLIENT_ADMIN", status: "CONFIRMED" });
    const recordedLogin = "2026-01-02T03:04:05.000Z";
    seedMembership(MEMBER_EMAIL, {
      role: "ORG_OWNER",
      teamIds: ["team_dispatch"],
      status: "invited",
      invitedAt: "2025-12-01T00:00:00.000Z",
      lastLoginAt: recordedLogin,
    });

    const response = await call("GET /tenants/{tenantId}/users", {
      pathParameters: { tenantId: TENANT },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].platformRole, "ORG_OWNER");
    assert.deepEqual(response.body[0].teamIds, ["team_dispatch"]);
    assert.equal(response.body[0].membershipStatus, "active");
    assert.equal(response.body[0].lastLoginAt, recordedLogin);
    const stored = load(`TENANT#${TENANT}`, `MEMBERSHIP#${MEMBER_EMAIL}`);
    assert.equal(stored.status, "active");
    assert.equal(stored.role, "ORG_OWNER");
    assert.deepEqual(stored.teamIds, ["team_dispatch"]);
    assert.equal(stored.lastLoginAt, recordedLogin);
  });

  await check("the only organization owner cannot be demoted", async () => {
    reset();
    seedOrganization();
    seedUser(MEMBER_EMAIL, { tenantId: TENANT, role: "CLIENT_ADMIN" });
    seedMembership(MEMBER_EMAIL, { role: "ORG_OWNER" });

    const response = await call("POST /tenants/{tenantId}/users/{username}/role", {
      pathParameters: { tenantId: TENANT, username: MEMBER_EMAIL },
      body: { role: "OPERATOR" },
    });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.match(response.body.error, /only owner/i);
    assert.equal(load(`TENANT#${TENANT}`, `MEMBERSHIP#${MEMBER_EMAIL}`).role, "ORG_OWNER");
    assert.deepEqual(groupsOf(MEMBER_EMAIL), ["CLIENT_ADMIN"]);
  });

  await check("role and team changes reconcile Cognito and the membership source of truth", async () => {
    reset();
    seedOrganization();
    seedUser(MEMBER_EMAIL, { tenantId: TENANT, role: "CLIENT_ADMIN", status: "CONFIRMED" });
    seedMembership(MEMBER_EMAIL, { role: "ORG_ADMIN" });

    const roleResponse = await call("POST /tenants/{tenantId}/users/{username}/role", {
      pathParameters: { tenantId: TENANT, username: MEMBER_EMAIL },
      body: { role: "VIEWER" },
    });
    assert.equal(roleResponse.status, 200, JSON.stringify(roleResponse.body));
    assert.deepEqual(roleResponse.body, {
      username: MEMBER_EMAIL,
      previousRole: "ORG_ADMIN",
      role: "VIEWER",
      coarseGroup: "FRONTLINE",
    });
    assert.deepEqual(groupsOf(MEMBER_EMAIL), ["FRONTLINE"]);
    assert.equal(load(`TENANT#${TENANT}`, `MEMBERSHIP#${MEMBER_EMAIL}`).role, "VIEWER");

    const teamResponse = await call("POST /teams", { body: { name: "Dispatch" } });
    assert.equal(teamResponse.status, 201, JSON.stringify(teamResponse.body));
    const addResponse = await call("POST /teams/{id}/members", {
      pathParameters: { id: teamResponse.body.id },
      body: { username: MEMBER_EMAIL },
    });
    assert.equal(addResponse.status, 200, JSON.stringify(addResponse.body));
    assert.deepEqual(
      load(`TENANT#${TENANT}`, `MEMBERSHIP#${MEMBER_EMAIL}`).teamIds,
      [teamResponse.body.id],
    );
  });

  await check("a failed coarse-group removal rolls back the added group and preserves the fine role", async () => {
    reset();
    seedOrganization();
    seedUser(MEMBER_EMAIL, { tenantId: TENANT, role: "CLIENT_ADMIN", status: "CONFIRMED" });
    seedMembership(MEMBER_EMAIL, { role: "ORG_ADMIN" });
    cognitoFaults.failNextRemoveFromGroup = true;

    const response = await call("POST /tenants/{tenantId}/users/{username}/role", {
      pathParameters: { tenantId: TENANT, username: MEMBER_EMAIL },
      body: { role: "VIEWER" },
    });
    assert.equal(response.status, 502, JSON.stringify(response.body));
    assert.deepEqual(groupsOf(MEMBER_EMAIL), ["CLIENT_ADMIN"]);
    assert.equal(load(`TENANT#${TENANT}`, `MEMBERSHIP#${MEMBER_EMAIL}`).role, "ORG_ADMIN");
  });

  await check("inspection exposes only safe invitation fields and revocation disables the pending account", async () => {
    reset();
    seedOrganization();
    const invited = await call("POST /tenants/{tenantId}/users", {
      pathParameters: { tenantId: TENANT },
      body: { email: MEMBER_EMAIL, role: "FRONTLINE" },
    });
    assert.equal(invited.status, 201, JSON.stringify(invited.body));
    const token = new URL(invited.body.acceptUrl).searchParams.get("token");
    assert.ok(token);
    assert.ok(
      ![...store.values()].some((item) => item.document?.S?.includes(token)),
      "the plaintext invitation token is never stored",
    );

    const inspected = await call("GET /invitations/{token}", {
      pathParameters: { token },
    });
    assert.equal(inspected.status, 200, JSON.stringify(inspected.body));
    assert.deepEqual(inspected.body, {
      organizationName: "Northwind Logistics",
      email: MEMBER_EMAIL,
    });

    const revoked = await call("DELETE /tenants/{tenantId}/users/{username}/invitation", {
      pathParameters: { tenantId: TENANT, username: MEMBER_EMAIL },
    });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.equal(revoked.body.enabled, false);
    assert.equal(users.get(MEMBER_EMAIL).Enabled, false);
    assert.equal(load(`TENANT#${TENANT}`, `MEMBERSHIP#${MEMBER_EMAIL}`).status, "deactivated");
    const invitationRecords = [...store.values()]
      .filter((item) => item.pk.S === `TENANT#${TENANT}` && item.sk.S.startsWith("INVITATION#"))
      .map((item) => JSON.parse(item.document.S));
    assert.equal(invitationRecords.length, 1);
    assert.equal(invitationRecords[0].state, "revoked");

    const oldLink = await call("GET /invitations/{token}", {
      pathParameters: { token },
    });
    assert.equal(oldLink.status, 409, JSON.stringify(oldLink.body));
  });

  await check("personal profile routes persist real identity attributes and GET /me records login time", async () => {
    reset();
    seedOrganization();
    seedUser(MEMBER_EMAIL, { tenantId: TENANT, role: "FRONTLINE", status: "CONFIRMED" });
    seedMembership(MEMBER_EMAIL, { role: "OPERATOR", lastLoginAt: null });
    const asMember = { role: "FRONTLINE", email: MEMBER_EMAIL };

    const updated = await call("PUT /me/profile", {
      as: asMember,
      body: { displayName: "Morgan Driver", givenName: "Morgan", familyName: "Driver" },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.displayName, "Morgan Driver");
    const attributes = Object.fromEntries(users.get(MEMBER_EMAIL).Attributes.map((attribute) => [attribute.Name, attribute.Value]));
    assert.equal(attributes.name, "Morgan Driver");
    assert.equal(attributes.given_name, "Morgan");
    assert.equal(attributes.family_name, "Driver");

    const me = await call("GET /me", { as: asMember });
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.ok(me.body.lastLoginAt, "GET /me returns the recorded sign-in time");
    assert.equal(
      load(`TENANT#${TENANT}`, `MEMBERSHIP#${MEMBER_EMAIL}`).lastLoginAt,
      me.body.lastLoginAt,
    );

    const security = await call("GET /security/facts", { as: asMember });
    assert.equal(security.status, 200, JSON.stringify(security.body));
    assert.equal(security.body.passwordPolicy.minimumLength, 12);
    assert.equal(security.body.mfaEnrollmentAvailable, false);
  });

  await check("notification reads honor audience and stored preferences, including mark-all", async () => {
    reset();
    seedOrganization();
    seedUser(MEMBER_EMAIL, { tenantId: TENANT, role: "CLIENT_ADMIN", status: "CONFIRMED" });
    seedMembership(MEMBER_EMAIL, { role: "APPROVER", teamIds: ["team_dispatch"] });
    const createdAt = now();
    const notifications = [
      { id: "all", audience: "everyone", kind: "approval_required" },
      { id: "user", audience: `user:${MEMBER_EMAIL}`, kind: "exception_raised" },
      { id: "role", audience: "role:APPROVER", kind: "agent_offline" },
      { id: "team", audience: "team:team_dispatch", kind: "connection_error" },
      { id: "other-role", audience: "role:ORG_OWNER", kind: "onboarding_step_ready" },
      { id: "disabled-kind", audience: "everyone", kind: "run_failed" },
    ];
    notifications.forEach((notification, index) =>
      put(
        `TENANT#${TENANT}`,
        `NOTIFICATION#${String(index).padStart(3, "0")}_${notification.id}`,
        {
          tenantId: TENANT,
          title: notification.id,
          body: notification.id,
          deepLink: "/",
          createdAt,
          ...notification,
        },
        { tenantId: { S: TENANT } },
      ),
    );
    put(
      `TENANT#${TENANT}`,
      `PREFERENCES#${MEMBER_EMAIL}`,
      { username: MEMBER_EMAIL, values: { "notify.run_failed": false }, updatedAt: createdAt },
      { tenantId: { S: TENANT } },
    );

    const asMember = { role: "CLIENT_ADMIN", email: MEMBER_EMAIL };
    const listed = await call("GET /notifications", { as: asMember });
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.deepEqual(
      new Set(listed.body.map((notification) => notification.id)),
      new Set(["all", "user", "role", "team"]),
    );
    assert.ok(listed.body.every((notification) => notification.read === false));

    const marked = await call("POST /notifications/read-all", { as: asMember });
    assert.equal(marked.status, 200, JSON.stringify(marked.body));
    assert.equal(marked.body.read, 4);
    const readKeys = [...store.keys()].filter((entry) =>
      entry.startsWith(`TENANT#${TENANT}|NOTIFREAD#${MEMBER_EMAIL}#`),
    );
    assert.equal(readKeys.length, 4, "only visible, enabled notifications were marked read");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
