// Property 5 -- invitation single-use and expiry, exercised through the deployed handler routes.
//
// **Validates: Requirements 26.8, 26.9, 26.10, 26.11, 26.12, 26.13, 26.14, 26.15, 26.17, 34.14**
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fc = require("fast-check");
const { store, resetPool } = require("./harness.cjs");
const { writeTo } = require("./extract-inline-handler.cjs");
const { handler } = require(
  writeTo(path.join(os.tmpdir(), `amazflow-property-invitations-${process.pid}.cjs`)),
);

const TENANT = "northwind";
const OTHER = "contoso";
const ADMIN_EMAIL = "administrator@northwind.example";
const now = () => new Date().toISOString();

const put = (pk, sk, document, extra = {}) =>
  store.set(`${pk}|${sk}`, {
    pk: { S: pk },
    sk: { S: sk },
    document: { S: JSON.stringify(document) },
    updatedAt: { S: now() },
    ...extra,
  });

const seed = () => {
  store.clear();
  resetPool();
  put("PLATFORM", `ORG#${TENANT}`, {
    id: "org_northwind",
    name: "Northwind Logistics",
    slug: TENANT,
    status: "active",
    plan: "pilot",
    createdAt: now(),
    updatedAt: now(),
  });
  put("PLATFORM", `ORG#${OTHER}`, {
    id: "org_contoso",
    name: "Contoso",
    slug: OTHER,
    status: "active",
    plan: "pilot",
    createdAt: now(),
    updatedAt: now(),
  });
};

const claims = ({ email, role, tenantId = TENANT }) => ({
  sub: email,
  email,
  "custom:tenant_id": tenantId,
  "cognito:groups": `[${role}]`,
});

let requestSequence = 0;
const call = async (
  routeKey,
  { email, role, tenantId = TENANT, body, pathParameters, sourceIp = "203.0.113.10" },
) => {
  const response = await handler({
    routeKey,
    requestContext: {
      requestId: `property-invitation-${++requestSequence}`,
      http: { sourceIp },
      authorizer: { jwt: { claims: claims({ email, role, tenantId }) } },
    },
    headers: {},
    pathParameters,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.statusCode, body: JSON.parse(response.body) };
};

const platformRoleFor = (coarseRole) =>
  coarseRole === "CLIENT_ADMIN" ? "ORG_ADMIN" : "OPERATOR";

const issueInvitation = async ({ localPart, coarseRole }) => {
  const email = `${localPart}@northwind.example`;
  const response = await call("POST /tenants/{tenantId}/users", {
    email: ADMIN_EMAIL,
    role: "SUPER_ADMIN",
    body: { email, role: coarseRole },
    pathParameters: { tenantId: TENANT },
    sourceIp: "203.0.113.1",
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.ok(response.body.acceptUrl, "the invitation route returned its acceptance link");
  const token = new URL(response.body.acceptUrl).searchParams.get("token");
  assert.ok(token, "the acceptance link carries a token");
  return {
    email,
    coarseRole,
    platformRole: platformRoleFor(coarseRole),
    token,
    acceptUrl: response.body.acceptUrl,
  };
};

const acceptInvitation = (invitation, { token = invitation.token, body, sourceIp = "203.0.113.2" } = {}) =>
  call("POST /invitations/{token}/accept", {
    email: invitation.email,
    role: invitation.coarseRole,
    body,
    pathParameters: { token },
    sourceIp,
  });

const invitationArbitrary = fc.record({
  localPart: fc
    .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"), {
      minLength: 4,
      maxLength: 16,
    })
    .map((characters) => characters.join("")),
  coarseRole: fc.constantFrom("CLIENT_ADMIN", "FRONTLINE"),
});

const tamperedBodyArbitrary = fc.record({
  orgId: fc.constant(OTHER),
  organizationId: fc.constant(OTHER),
  tenantId: fc.constant(OTHER),
  role: fc.constantFrom("SUPER_ADMIN", "ORG_OWNER", "STAFF_ADMIN"),
});

const storedInvitationEntry = () => {
  const entry = [...store.entries()].find(
    ([key]) => key.startsWith(`TENANT#${TENANT}|INVITATION#`),
  );
  assert.ok(entry, "the stored invitation exists");
  return entry;
};

const membershipFor = (orgId, email) => {
  const item = store.get(`TENANT#${orgId}|MEMBERSHIP#${email}`);
  return item && item.document?.S ? JSON.parse(item.document.S) : null;
};

let passed = 0;
let failed = 0;
const check = async (name, property) => {
  try {
    await fc.assert(property);
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${error && error.stack ? error.stack : error}`);
  }
};

(async () => {
  console.log("\nPROPERTY 5 -- INVITATION SINGLE-USE AND EXPIRY\n");

  await check(
    "P5.1 exactly one concurrent acceptance wins under every generated interleaving count",
    fc.asyncProperty(
      invitationArbitrary,
      fc.integer({ min: 2, max: 10 }),
      async (specification, count) => {
        seed();
        const invitation = await issueInvitation(specification);
        const responses = await Promise.all(
          Array.from({ length: count }, () =>
            acceptInvitation(invitation, { sourceIp: "203.0.113.20" }),
          ),
        );
        assert.equal(
          responses.filter((response) => response.status === 200).length,
          1,
          JSON.stringify(responses),
        );
        assert.equal(
          responses.filter((response) => response.status === 409).length,
          count - 1,
          JSON.stringify(responses),
        );
      },
    ),
  );

  await check(
    "P5.2 an invitation past its generated expiry offset is never accepted",
    fc.asyncProperty(
      invitationArbitrary,
      fc.integer({ min: 1, max: 30 * 24 * 60 * 60 * 1000 }),
      async (specification, expiredByMs) => {
        seed();
        const invitation = await issueInvitation(specification);
        const [key, item] = storedInvitationEntry();
        const document = JSON.parse(item.document.S);
        document.expiresAt = new Date(Date.now() - expiredByMs).toISOString();
        put(item.pk.S, item.sk.S, document, {
          tenantId: item.tenantId,
          state: { S: "pending" },
        });
        assert.equal(key, `${item.pk.S}|${item.sk.S}`);

        const response = await acceptInvitation(invitation, {
          sourceIp: "203.0.113.21",
        });
        assert.ok([410, 409].includes(response.status), JSON.stringify(response.body));
        const membership = membershipFor(TENANT, invitation.email);
        assert.equal(membership.status, "invited");
        assert.notEqual(membership.activatedAt, document.expiresAt);
      },
    ),
  );

  await check(
    "P5.3 organization and role always come from the stored invitation, never a tampered body",
    fc.asyncProperty(
      invitationArbitrary,
      tamperedBodyArbitrary,
      async (specification, tamperedBody) => {
        seed();
        const invitation = await issueInvitation(specification);
        const response = await acceptInvitation(invitation, {
          body: tamperedBody,
          sourceIp: "203.0.113.22",
        });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.organizationId, TENANT);
        assert.equal(response.body.role, invitation.platformRole);
        const membership = membershipFor(TENANT, invitation.email);
        assert.equal(membership.orgId, TENANT);
        assert.equal(membership.role, invitation.platformRole);
        assert.equal(membershipFor(OTHER, invitation.email), null);
      },
    ),
  );

  await check(
    "P5.4 resending creates a distinct token and invalidates the previous link",
    fc.asyncProperty(invitationArbitrary, async (specification) => {
      seed();
      const invitation = await issueInvitation(specification);
      const resent = await call(
        "POST /tenants/{tenantId}/users/{username}/invitation/resend",
        {
          email: ADMIN_EMAIL,
          role: "SUPER_ADMIN",
          pathParameters: { tenantId: TENANT, username: invitation.email },
          sourceIp: "203.0.113.23",
        },
      );
      assert.equal(resent.status, 200, JSON.stringify(resent.body));
      const nextToken = new URL(resent.body.acceptUrl).searchParams.get("token");
      assert.ok(nextToken);
      assert.notEqual(nextToken, invitation.token);

      const oldLink = await acceptInvitation(invitation, {
        sourceIp: "203.0.113.24",
      });
      assert.equal(oldLink.status, 409, JSON.stringify(oldLink.body));
      const newLink = await acceptInvitation(invitation, {
        token: nextToken,
        sourceIp: "203.0.113.25",
      });
      assert.equal(newLink.status, 200, JSON.stringify(newLink.body));
      assert.equal(newLink.body.organizationId, TENANT);
      assert.equal(newLink.body.role, invitation.platformRole);
    }),
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
