// Auth and session lifecycle suite (task 5.8), control-plane half.
//
// Covers the acceptance criteria that are actually decided server-side: what a principal is, what
// happens when the claims that define one are missing, what a deactivated account can still do, and
// what the session-revocation routes do. The browser half of Phase 1 (exactly-one-refresh,
// force-sign-out, back-navigation) lives in apps/web and is not reachable from this harness.
//
// The single most important case here is the organization-claim default. A missing
// `custom:tenant_id` used to fall back to "amazflow" -- the STAFF tenant -- so an account created
// without the claim silently became a member of AmazFlow's own organization and was served
// AmazFlow's own data. That is asserted from both directions: no principal is produced, and nothing
// of the staff tenant comes back.
//
// _Requirements: 4.1, 4.3, 4.4, 4.13, 4.14, 4.15, 4.16, 4.18, 4.19, 6.1, 27.12, 27.15, 27.16_
const assert = require("node:assert");
const { store, users, globallySignedOut, seedUser } = require("./harness.cjs");
const os = require("node:os");
const path = require("node:path");
const { writeTo } = require("./extract-inline-handler.cjs");
const { handler } = require(writeTo(path.join(os.tmpdir(), `amazflow-inline-${process.pid}.cjs`)));
const { reporter, put, putTenant, iso } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("AUTH AND SESSION LIFECYCLE");

const TENANT = "authorg";
const OTHER = "otherauthorg";

put("PLATFORM", `ORG#${TENANT}`, {
  id: "org_auth",
  name: "Auth Ltd",
  slug: TENANT,
  status: "active",
  plan: "design_partner",
  createdAt: iso(-86400000),
  updatedAt: iso(),
});
put("PLATFORM", `ORG#${OTHER}`, {
  id: "org_other",
  name: "Other Ltd",
  slug: OTHER,
  status: "active",
  plan: "design_partner",
  createdAt: iso(-86400000),
  updatedAt: iso(),
});

const ADMIN_EMAIL = `admin@${TENANT}.example.com`;
const MEMBER_EMAIL = `member@${TENANT}.example.com`;
const DISABLED_EMAIL = `disabled@${TENANT}.example.com`;
const OTHER_EMAIL = `member@${OTHER}.example.com`;
const STAFF_EMAIL = "staff@amazflow.com";

seedUser(ADMIN_EMAIL, { tenantId: TENANT, role: "CLIENT_ADMIN" });
seedUser(MEMBER_EMAIL, { tenantId: TENANT, role: "FRONTLINE" });
seedUser(DISABLED_EMAIL, { tenantId: TENANT, role: "FRONTLINE", enabled: false });
seedUser(OTHER_EMAIL, { tenantId: OTHER, role: "FRONTLINE" });
seedUser(STAFF_EMAIL, { tenantId: "amazflow", role: "SUPER_ADMIN" });

// Something belonging to the staff tenant, so "did the missing-claim default leak staff data" is a
// question with a real answer rather than an empty list.
putTenant("amazflow", "WORKFLOW", {
  id: "wf_staff_internal",
  tenantId: "amazflow",
  name: "AmazFlow internal workflow",
  version: 1,
  status: "active",
  assignedRoles: ["CLIENT_ADMIN", "FRONTLINE"],
  startAt: "s_end",
  steps: [{ id: "s_end", type: "end", outcome: "success", name: "Done" }],
});
putTenant(TENANT, "WORKFLOW", {
  id: "wf_auth_customer",
  tenantId: TENANT,
  name: "Customer workflow",
  version: 1,
  status: "active",
  assignedRoles: ["CLIENT_ADMIN", "FRONTLINE"],
  startAt: "s_end",
  steps: [{ id: "s_end", type: "end", outcome: "success", name: "Done" }],
});

/** Build claims by hand so a claim can be OMITTED, which is the whole point of several cases. */
const call = async (routeKey, claims, { pathParameters, body } = {}) => {
  const res = await handler({
    routeKey,
    headers: {},
    pathParameters,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: claims === null ? undefined : { authorizer: { jwt: { claims } } },
  });
  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    parsed = res.body;
  }
  return { status: res.statusCode, body: parsed, raw: res.body || "" };
};

const claimsFor = (email, tenantId, group) => ({
  sub: email,
  email,
  "custom:tenant_id": tenantId,
  "cognito:groups": `[${group}]`,
});

const ADMIN = claimsFor(ADMIN_EMAIL, TENANT, "CLIENT_ADMIN");
const MEMBER = claimsFor(MEMBER_EMAIL, TENANT, "FRONTLINE");
const DISABLED = claimsFor(DISABLED_EMAIL, TENANT, "FRONTLINE");
const STAFF = claimsFor(STAFF_EMAIL, "amazflow", "SUPER_ADMIN");

(async () => {
  /* ------------------------------------------------------------------- what a principal is ----- */
  section("a session is a user, an organization, and a role");

  await check("the current-user route reports identifier, organization, role and account status", async () => {
    const res = await call("GET /me", ADMIN);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.userId, ADMIN_EMAIL);
    assert.equal(res.body.tenantId, TENANT);
    assert.equal(res.body.organizationId, TENANT, "the organization is named as such, not only as a tenant");
    assert.equal(res.body.role, "CLIENT_ADMIN");
    assert.equal(res.body.accountStatus, "active");
  });

  /* --------------------------------------------------------------------------- missing role ----- */
  section("no role group means no session");

  await check("a token in no role group produces no principal", async () => {
    const res = await call("GET /me", {
      sub: "nobody@example.com",
      email: "nobody@example.com",
      "custom:tenant_id": TENANT,
      "cognito:groups": "[]",
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "NO_ROLE", "the refusal says which thing is missing");
  });

  await check("a token in an unrecognized group is not admitted on the strength of having one", async () => {
    const res = await call("GET /me", {
      sub: "future@example.com",
      email: "future@example.com",
      "custom:tenant_id": TENANT,
      "cognito:groups": "[SOME_FUTURE_ROLE]",
    });
    assert.equal(res.status, 403, "an unknown group is not a role");
    assert.equal(res.body.code, "NO_ROLE");
  });

  /* ------------------------------------------------------------------- missing organization ----- */
  section("no organization claim means no session, and no staff data");

  await check("a token with no organization claim produces no usable principal", async () => {
    const res = await call("GET /me", {
      sub: ADMIN_EMAIL,
      email: ADMIN_EMAIL,
      "cognito:groups": "[CLIENT_ADMIN]",
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "NO_ORGANIZATION", "reported as a missing organization, not a missing role");
  });

  await check("an empty or whitespace organization claim is treated as absent", async () => {
    for (const tenantId of ["", "   "]) {
      const res = await call("GET /me", {
        sub: ADMIN_EMAIL,
        email: ADMIN_EMAIL,
        "custom:tenant_id": tenantId,
        "cognito:groups": "[CLIENT_ADMIN]",
      });
      assert.equal(res.status, 403, `${JSON.stringify(tenantId)} must not establish a session`);
      assert.equal(res.body.code, "NO_ORGANIZATION");
    }
  });

  await check("a claimless token is refused on every authenticated route, not just the identity route", async () => {
    const noOrg = { sub: ADMIN_EMAIL, email: ADMIN_EMAIL, "cognito:groups": "[CLIENT_ADMIN]" };
    for (const [routeKey, options] of [
      ["GET /workflows", {}],
      ["GET /runs", {}],
      ["GET /agents", {}],
      ["GET /organizations/{slug}", { pathParameters: { slug: TENANT } }],
      ["GET /tenants/{tenantId}/users", { pathParameters: { tenantId: TENANT } }],
      ["POST /support/tickets", { body: { subject: "s", message: "m" } }],
    ]) {
      const res = await call(routeKey, noOrg, options);
      assert.equal(res.status, 403, `${routeKey} must refuse a principal with no organization, got ${res.status}`);
    }
  });

  await check("the missing-claim default no longer places the account in the staff organization", async () => {
    // The regression this exists to prevent: "amazflow" is AmazFlow's own tenant, so defaulting to
    // it handed a claimless account the staff organization's workflows.
    const res = await call("GET /workflows", {
      sub: "claimless@example.com",
      email: "claimless@example.com",
      "cognito:groups": "[CLIENT_ADMIN]",
    });
    assert.equal(res.status, 403);
    assert.ok(!/wf_staff_internal/.test(res.raw), "no staff-tenant data may come back");
    assert.ok(!/AmazFlow internal workflow/.test(res.raw));
  });

  await check("a token with no claims at all is refused", async () => {
    assert.equal((await call("GET /me", {})).status, 403);
    assert.equal((await call("GET /me", null)).status, 403);
  });

  /* --------------------------------------------------------------------- disabled accounts ----- */
  section("a deactivated account stops working on its next call");

  await check("a disabled account is refused with a distinct code", async () => {
    const res = await call("GET /runs", DISABLED);
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "ACCOUNT_DISABLED");
    assert.match(res.body.error, /deactivated/i);
  });

  await check("a disabled account is refused on every authenticated route", async () => {
    for (const [routeKey, options] of [
      ["GET /me", {}],
      ["GET /workflows", {}],
      ["GET /runs", {}],
      ["POST /support/tickets", { body: { subject: "s", message: "m" } }],
    ]) {
      const res = await call(routeKey, DISABLED, options);
      assert.equal(res.status, 403, `${routeKey} must refuse a disabled account, got ${res.status}`);
      assert.equal(res.body.code, "ACCOUNT_DISABLED");
    }
  });

  await check("an enabled account in the same organization is unaffected", async () => {
    const res = await call("GET /runs", MEMBER);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  await check("reactivating the account restores access with no further action", async () => {
    const record = users.get(DISABLED_EMAIL);
    record.Enabled = true;
    const res = await call("GET /me", DISABLED);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.accountStatus, "active");
    record.Enabled = false; // restore for later cases
  });

  await check("an account absent from the pool is allowed rather than presumed deactivated", async () => {
    // Fails open by design: a principal whose username is not its email, or a transient pool
    // failure, must not sign everyone out. Only a definite Enabled === false refuses.
    const res = await call("GET /me", claimsFor("not-in-the-pool@example.com", TENANT, "CLIENT_ADMIN"));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.accountStatus, "unknown", "and it says so rather than claiming to know");
  });

  /* ------------------------------------------------------------------- session revocation ----- */
  section("sign out everywhere");

  await check("a user can revoke all of their own sessions", async () => {
    globallySignedOut.delete(ADMIN_EMAIL);
    const res = await call("POST /me/sessions/revoke", ADMIN);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.revoked, "all_sessions");
    assert.ok(globallySignedOut.has(ADMIN_EMAIL), "the revocation reached the identity provider");
  });

  await check("revoking your own sessions is audited", async () => {
    globallySignedOut.delete(MEMBER_EMAIL);
    const before = [...store.keys()].filter((k) => k.startsWith(`TENANT#${TENANT}|ACTIVITY#`)).length;
    const res = await call("POST /me/sessions/revoke", MEMBER);
    assert.equal(res.status, 200);
    const after = [...store.keys()].filter((k) => k.startsWith(`TENANT#${TENANT}|ACTIVITY#`)).length;
    assert.ok(after > before, "an activity record was written");
  });

  await check("revoking your own sessions needs no privilege beyond having a session", async () => {
    globallySignedOut.delete(MEMBER_EMAIL);
    const res = await call("POST /me/sessions/revoke", MEMBER);
    assert.equal(res.status, 200, "ending your own sessions is never a privileged act");
  });

  section("staff-initiated session revocation");

  await check("staff can revoke a customer user's sessions, and it is audited", async () => {
    globallySignedOut.delete(MEMBER_EMAIL);
    const before = [...store.keys()].filter((k) => k.startsWith(`TENANT#${TENANT}|ACTIVITY#`)).length;
    const res = await call("POST /tenants/{tenantId}/users/{username}/sessions/revoke", STAFF, {
      pathParameters: { tenantId: TENANT, username: MEMBER_EMAIL },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(globallySignedOut.has(MEMBER_EMAIL), "the revocation reached the identity provider");
    const after = [...store.keys()].filter((k) => k.startsWith(`TENANT#${TENANT}|ACTIVITY#`)).length;
    assert.ok(after > before, "the revocation is audited against the target's organization");
  });

  await check("a customer admin cannot revoke another user's sessions", async () => {
    globallySignedOut.delete(MEMBER_EMAIL);
    const res = await call("POST /tenants/{tenantId}/users/{username}/sessions/revoke", ADMIN, {
      pathParameters: { tenantId: TENANT, username: MEMBER_EMAIL },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "STAFF_ONLY");
    assert.ok(!globallySignedOut.has(MEMBER_EMAIL), "nothing was revoked");
  });

  await check("a user of another organization is not found rather than revoked", async () => {
    globallySignedOut.delete(OTHER_EMAIL);
    const res = await call("POST /tenants/{tenantId}/users/{username}/sessions/revoke", STAFF, {
      pathParameters: { tenantId: TENANT, username: OTHER_EMAIL },
    });
    assert.equal(res.status, 404, "resolved through the named tenant's own member list");
    assert.ok(!globallySignedOut.has(OTHER_EMAIL), "no cross-organization revocation");
  });

  await check("a username that does not exist is a 404", async () => {
    const res = await call("POST /tenants/{tenantId}/users/{username}/sessions/revoke", STAFF, {
      pathParameters: { tenantId: TENANT, username: "ghost@example.com" },
    });
    assert.equal(res.status, 404);
  });

  /* -------------------------------------------------------------------- no operator password --- */
  section("no operator path can set a customer's password");

  await check("no route accepts a password for another user", async () => {
    // Requirement 4.8 is a claim about the whole route surface, so it is checked against the route
    // inventory rather than by probing a list of routes somebody remembered to think of. Staff can
    // disable an account and revoke its sessions; they cannot become the customer.
    const inventory = require("./route-inventory.json");
    const suspicious = inventory.routes
      .map((entry) => entry.route)
      .filter((route) => /password|credential/i.test(route));
    assert.deepEqual(suspicious, [], `no route may exist for setting a password: ${suspicious.join(", ")}`);

    const { extract } = require("./extract-inline-handler.cjs");
    const source = extract();
    for (const forbidden of [
      "AdminSetUserPasswordCommand",
      "AdminSetUserPassword",
      "AdminInitiateAuthCommand",
    ])
      assert.ok(
        !source.includes(forbidden),
        `the control plane must not use ${forbidden} -- it would let an operator set or assume a customer's credentials`,
      );
  });

  /* ------------------------------------------------------- the browser half is actually wired --- */
  // Tasks 5.3 and 5.4 both had the same failure mode before this: the capability existed in a
  // library module and nothing called it, so the requirement was satisfied on paper and not in the
  // product. These two checks are source-level on purpose -- they assert the WIRING, which is
  // exactly the part that was missing, and they fail if a future surface reintroduces a raw fetch().
  section("the browser half of the session lifecycle is wired into real surfaces");

  const fs = require("node:fs");
  const root = path.join(__dirname, "..", "..", "..");
  const webApp = path.join(root, "apps", "web", "app");
  const readWeb = (relative) => fs.readFileSync(path.join(webApp, relative), "utf8");

  await check("a signed-in person of any role can reach a password-change form", () => {
    const page = readWeb(path.join("console", "account", "page.tsx"));
    assert.ok(
      page.includes("changeOwnPassword"),
      "the account page must call changeOwnPassword, not merely exist",
    );
    assert.ok(
      page.includes("anySignedInSurface"),
      "the page must be gated on being signed in only -- a role-gated password form is unreachable for the roles that need it most",
    );
    assert.ok(
      !/requireRole/.test(page),
      "no role requirement may narrow the account page",
    );
    // And it has to be findable: a page nothing links to is a page nobody uses.
    assert.ok(
      readWeb(path.join("console", "page.tsx")).includes("/console/account/"),
      "the customer console links to it",
    );
    assert.ok(
      readWeb(path.join("app", "ops", "shell.tsx")).includes("/console/account/"),
      "the staff console links to it",
    );
  });

  await check("every authenticated surface calls the control plane through apiCall()", () => {
    // The refresh-once-then-sign-out and ACCOUNT_DISABLED handling live in apiCall(). A surface
    // that calls fetch() directly opts out of both, silently.
    const surfaces = [
      path.join("console", "page.tsx"),
      path.join("console", "settings", "page.tsx"),
      path.join("console", "support", "page.tsx"),
      path.join("app", "ops", "data.tsx"),
    ];
    for (const relative of surfaces) {
      const source = readWeb(relative);
      assert.ok(source.includes("apiCall"), `${relative} must call the control plane via apiCall()`);
      assert.ok(
        !/fetch\(`\$\{API\}/.test(source),
        `${relative} must not call fetch(\`\${API}...\`) directly -- that bypasses the session lifecycle`,
      );
    }
  });

  await check("apiCall refreshes at most once and force-signs-out a disabled account", () => {
    // Task 9.3 moved the latch and the deactivated-account handling into @amazflow/api-client so the
    // customer app and the internal console inherit them rather than growing a third and fourth copy.
    // This check FOLLOWS the behaviour rather than being deleted: what matters is that the single
    // refresh and the forced sign-out still exist and that the web surface still goes through them.
    const shared = fs.readFileSync(path.join(root, "packages", "api-client", "src", "index.ts"), "utf8");
    assert.ok(shared.includes("ACCOUNT_DISABLED"), "the disabled-account code is handled");
    assert.ok(
      /refreshed = true/.test(shared) && /!refreshed/.test(shared),
      "the single-refresh latch is present",
    );
    const adapter = readWeb(path.join("lib", "api-client.ts"));
    assert.ok(
      /createApiClient</.test(adapter),
      "apps/web must call the control plane through the shared client, not a fourth copy of it",
    );
    assert.ok(
      !/fetch\(/.test(adapter),
      "the web adapter must not issue its own fetch -- that would bypass the shared lifecycle",
    );
  });

  /* --------------------------------------------------------------------- the error envelope ---- */
  section("the structured error envelope");

  await check("an error carries a stable code, a displayable message, and a correlation identifier", async () => {
    const res = await call("GET /organizations/{slug}", MEMBER, { pathParameters: { slug: OTHER } });
    assert.ok(res.status >= 400);
    assert.ok(typeof res.body.code === "string" && res.body.code, "a machine-readable code");
    assert.ok(typeof res.body.message === "string" && res.body.message, "a displayable message");
    assert.ok(typeof res.body.correlationId === "string" && res.body.correlationId, "a correlation identifier");
  });

  await check("the flat error field is kept, because the deployed frontend still reads it", async () => {
    const res = await call("GET /organizations/{slug}", MEMBER, { pathParameters: { slug: OTHER } });
    assert.ok(typeof res.body.error === "string" && res.body.error, "the flat field is still present");
    assert.equal(res.body.message, res.body.error, "and says the same thing as the envelope's message");
  });

  await check("the code is derived from the status, not from the prose", async () => {
    const notFound = await call("POST /runs/{id}/cancel", ADMIN, { pathParameters: { id: "run_nope" } });
    assert.equal(notFound.status, 404);
    assert.equal(notFound.body.code, "NOT_FOUND");
  });

  await check("an explicit code takes precedence over the status default", async () => {
    const res = await call("GET /me", {
      sub: ADMIN_EMAIL,
      email: ADMIN_EMAIL,
      "cognito:groups": "[CLIENT_ADMIN]",
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "NO_ORGANIZATION", "not the generic FORBIDDEN");
  });

  await check("a successful response carries no error envelope", async () => {
    const res = await call("GET /me", MEMBER);
    assert.equal(res.status, 200);
    assert.equal(res.body.code, undefined);
    assert.equal(res.body.correlationId, undefined);
  });

  await check("each request gets its own correlation identifier", async () => {
    const first = await call("POST /runs/{id}/cancel", ADMIN, { pathParameters: { id: "run_nope" } });
    const second = await call("POST /runs/{id}/cancel", ADMIN, { pathParameters: { id: "run_nope" } });
    assert.notEqual(first.body.correlationId, second.body.correlationId);
  });

  done();
})();
