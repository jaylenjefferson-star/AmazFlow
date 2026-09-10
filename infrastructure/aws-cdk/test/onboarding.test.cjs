// Inviting a person into an organization, against the control plane that is actually deployed.
//
// This is the step that used to be done by hand in the AWS console: create the Cognito user, stamp
// the tenant claim, put them in a role group. Doing it by hand is how you get a user with no group
// (cannot sign in at all) or no tenant claim (silently lands in the AmazFlow tenant, because
// sessionFromAuthResult defaults it). Both of those are asserted against below.
const { store, seedUser, resetPool, users, groups, cognitoFaults } = require("./harness.cjs");
const os = require("node:os");
const path = require("node:path");
const { writeTo } = require("./extract-inline-handler.cjs");
const { handler } = require(
  writeTo(path.join(os.tmpdir(), `amazflow-onboarding-${process.pid}.cjs`)),
);
const assert = require("node:assert");

const now = () => new Date().toISOString();
const TENANT = "northwind";
const OTHER = "contoso";

const put = (pk, sk, doc) =>
  store.set(`${pk}|${sk}`, {
    pk: { S: pk },
    sk: { S: sk },
    document: { S: JSON.stringify(doc) },
    updatedAt: { S: now() },
  });

const org = (overrides = {}) => ({
  id: "org_1",
  name: "Northwind Logistics",
  slug: TENANT,
  status: "active",
  plan: "pilot",
  createdAt: now(),
  ...overrides,
});

const seed = (orgOverrides = {}) => {
  store.clear();
  resetPool();
  put("PLATFORM", `ORG#${TENANT}`, org(orgOverrides));
  put("PLATFORM", `ORG#${OTHER}`, { ...org(), id: "org_2", name: "Contoso", slug: OTHER });
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

const invite = (body, opts = {}) =>
  call("POST /tenants/{tenantId}/users", {
    pathParameters: { tenantId: TENANT },
    body,
    ...opts,
  });

const attrsOf = (username) =>
  Object.fromEntries((users.get(username).Attributes || []).map((a) => [a.Name, a.Value]));
const groupsOf = (username) =>
  [...groups.entries()].filter(([, m]) => m.has(username)).map(([g]) => g);
const activityFor = (tenantId) =>
  [...store.values()]
    .filter((i) => i.pk.S === `TENANT#${tenantId}` && i.sk.S.startsWith("ACTIVITY#"))
    .map((i) => JSON.parse(i.document.S));

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
  console.log("\nCUSTOMER ONBOARDING: INVITATIONS\n");

  // ------------------------------------------------------------ the happy path -------------

  await check("an invitation creates a user with the tenant claim AND a role group", async () => {
    seed();
    const res = await invite({ email: "dana@northwind.com", role: "CLIENT_ADMIN" });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const attrs = attrsOf("dana@northwind.com");
    // Both of these were the manual steps. Neither is optional: without the claim the user lands
    // in the AmazFlow tenant, without the group they cannot obtain a session at all.
    assert.equal(attrs["custom:tenant_id"], TENANT, "the tenant claim must be stamped");
    assert.deepEqual(groupsOf("dana@northwind.com"), ["CLIENT_ADMIN"], "must be in a role group");
    assert.equal(attrs.email, "dana@northwind.com");
    assert.equal(attrs.email_verified, "true", "we mailed the invitation, so the address is proven");
  });

  await check("the invitee's real sign-up date is recorded", async () => {
    seed();
    const before = Math.floor(Date.now() / 1000);
    await invite({ email: "dana@northwind.com" });
    const stamped = Number(attrsOf("dana@northwind.com")["custom:created_at"]);
    assert.ok(Number.isFinite(stamped), "custom:created_at is set");
    assert.ok(stamped >= before - 5 && stamped <= before + 5, "and it is now, in seconds");
  });

  await check("the new member is immediately visible to the team list", async () => {
    seed();
    await invite({ email: "dana@northwind.com", role: "FRONTLINE" });
    const list = await call("GET /tenants/{tenantId}/users", {
      pathParameters: { tenantId: TENANT },
    });
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].email, "dana@northwind.com");
    assert.equal(list.body[0].role, "FRONTLINE");
  });

  await check("an unaccepted invitation is distinguishable from a working account", async () => {
    seed();
    await invite({ email: "dana@northwind.com" });
    seedUser("existing@northwind.com", { tenantId: TENANT, role: "CLIENT_ADMIN", status: "CONFIRMED" });
    const list = await call("GET /tenants/{tenantId}/users", {
      pathParameters: { tenantId: TENANT },
    });
    const byEmail = Object.fromEntries(list.body.map((u) => [u.email, u]));
    assert.equal(byEmail["dana@northwind.com"].userStatus, "FORCE_CHANGE_PASSWORD");
    assert.equal(byEmail["existing@northwind.com"].userStatus, "CONFIRMED");
  });

  await check("the invitation is audited against the organization", async () => {
    seed();
    await invite({ email: "dana@northwind.com", role: "CLIENT_ADMIN" });
    const entry = activityFor(TENANT).find((x) => x.action === "TEAM_MEMBER_INVITED");
    assert.ok(entry, "a TEAM_MEMBER_INVITED entry is written");
    assert.equal(entry.details.email, "dana@northwind.com");
    assert.equal(entry.details.role, "CLIENT_ADMIN");
    assert.match(entry.summary, /team admin/i);
  });

  await check("a customer admin invites into their own organization", async () => {
    seed();
    const res = await invite(
      { email: "sam@northwind.com", role: "FRONTLINE" },
      { role: "CLIENT_ADMIN" },
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(groupsOf("sam@northwind.com"), ["FRONTLINE"]);
  });

  // ------------------------------------------------------------- authorization -------------

  await check("a frontline user cannot invite anyone", async () => {
    seed();
    const res = await invite({ email: "sam@northwind.com" }, { role: "FRONTLINE" });
    assert.equal(res.status, 403);
    assert.equal(users.size, 0, "nothing was created");
  });

  await check("a customer admin cannot invite into another organization", async () => {
    seed();
    const res = await call("POST /tenants/{tenantId}/users", {
      role: "CLIENT_ADMIN",
      tenantId: TENANT,
      pathParameters: { tenantId: OTHER },
      body: { email: "mole@contoso.com" },
    });
    assert.equal(res.status, 403);
    assert.equal(users.size, 0);
  });

  await check("nobody can mint an AmazFlow staff account through this route", async () => {
    seed();
    const asCustomer = await invite(
      { email: "sam@northwind.com", role: "SUPER_ADMIN" },
      { role: "CLIENT_ADMIN" },
    );
    assert.equal(asCustomer.status, 403);
    // Refused even for a super admin: staff accounts are not a tenant-scoped concept.
    const asStaff = await invite({ email: "sam@northwind.com", role: "SUPER_ADMIN" });
    assert.equal(asStaff.status, 403);
    assert.equal(users.size, 0);
    assert.equal(groups.size, 0, "no SUPER_ADMIN group membership was created");
  });

  await check("an unknown role is refused rather than defaulted", async () => {
    seed();
    const res = await invite({ email: "sam@northwind.com", role: "OWNER" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /role must be one of/);
    assert.equal(users.size, 0);
  });

  // ------------------------------------------------- organization-level gating ------------

  await check("the allowed email domain list is enforced", async () => {
    seed({ settings: { allowedEmailDomains: ["northwind.com", "partner.co.uk"] } });
    const outside = await invite({ email: "someone@gmail.com" });
    assert.equal(outside.status, 422, JSON.stringify(outside.body));
    assert.match(outside.body.error, /outside this organization's allowed email domains/);
    assert.deepEqual(outside.body.allowedEmailDomains, ["northwind.com", "partner.co.uk"]);
    assert.equal(users.size, 0);

    const inside = await invite({ email: "sam@partner.co.uk" });
    assert.equal(inside.status, 201, "a listed domain is accepted");
  });

  await check("an empty domain list allows any address", async () => {
    seed({ settings: { allowedEmailDomains: [] } });
    const res = await invite({ email: "anyone@example.org" });
    assert.equal(res.status, 201);
  });

  await check("the domain check is case-insensitive on the address", async () => {
    seed({ settings: { allowedEmailDomains: ["northwind.com"] } });
    const res = await invite({ email: "Dana@NorthWind.com" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(users.has("dana@northwind.com"), "stored lowercased");
  });

  await check("a suspended organization cannot add people", async () => {
    seed({ status: "suspended" });
    const res = await invite({ email: "dana@northwind.com" });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /suspended/i);
    assert.equal(users.size, 0);
  });

  await check("a paused organization can still add people", async () => {
    // Pausing stops execution, not administration. A customer mid-onboarding is often paused.
    seed({ status: "paused" });
    const res = await invite({ email: "dana@northwind.com" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  // ------------------------------------------------------------- bad input ----------------

  await check("a missing or malformed email is refused", async () => {
    seed();
    for (const email of ["", "   ", "not-an-email", "no@domain", "two@@at.com"]) {
      const res = await invite({ email });
      assert.equal(res.status, 400, `${JSON.stringify(email)} must be refused`);
    }
    assert.equal(users.size, 0);
  });

  await check("inviting an existing member is refused, not duplicated", async () => {
    seed();
    seedUser("dana@northwind.com", { tenantId: TENANT, role: "FRONTLINE" });
    const res = await invite({ email: "dana@northwind.com", role: "CLIENT_ADMIN" });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already a member/i);
    assert.deepEqual(groupsOf("dana@northwind.com"), ["FRONTLINE"], "role was not changed");
  });

  await check("an address already used by another organization is refused clearly", async () => {
    seed();
    seedUser("shared@example.com", { tenantId: OTHER, role: "FRONTLINE" });
    const res = await invite({ email: "shared@example.com" });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already has an AmazFlow account/i);
    // The other tenant's user is untouched.
    assert.equal(attrsOf("shared@example.com")["custom:tenant_id"], OTHER);
  });

  // -------------------------------------------------------- partial failure ---------------

  await check("a user created without a group reports failure rather than success", async () => {
    seed();
    cognitoFaults.failNextAddToGroup = true;
    const res = await invite({ email: "dana@northwind.com" });
    assert.equal(res.status, 502, JSON.stringify(res.body));
    assert.match(res.body.error, /cannot sign in yet/i);
    assert.match(res.body.error, /Retry the invitation/i);
    // The user exists but has no group. That is the safe direction -- they cannot get in --
    // and the caller is told, rather than being shown a success for an account that cannot
    // be used.
    assert.ok(users.has("dana@northwind.com"));
    assert.deepEqual(groupsOf("dana@northwind.com"), []);
  });

  await check("a half-created invitation does not appear as a team member", async () => {
    seed();
    cognitoFaults.failNextAddToGroup = true;
    await invite({ email: "dana@northwind.com" });
    const list = await call("GET /tenants/{tenantId}/users", {
      pathParameters: { tenantId: TENANT },
    });
    assert.deepEqual(list.body, [], "no group means not a member, so the list stays honest");
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
