// Behavioural coverage for the browser connection routes ported into the deployed template
// (task 3.4).
//
// source-parity.test.cjs proves these routes EXIST in both copies. That is a presence check on
// source text and says nothing about whether the ported code runs. This exercises it against the
// deployed template's own inline handler: validation, tenant scoping, role gating, and the honest
// 503 the two managed-browser login routes return in a stack that provisions no managed browser.
//
// _Requirements: 32.1, 32.3, 20.3_
const assert = require("node:assert");
const { store, put, putTenant, load, asUser, reporter } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("PORTED ROUTES: browser connections");

const TENANT = "connorg";
const OTHER = "otherorg";
const ADMIN = { userId: "user_admin", tenantId: TENANT, group: "CLIENT_ADMIN" };
const MEMBER = { userId: "user_member", tenantId: TENANT, group: "FRONTLINE" };
const STAFF = { userId: "staff", tenantId: "amazflow", group: "SUPER_ADMIN" };

const list = (as = ADMIN) => asUser(as, "GET /connections/browser");
const create = (body, as = ADMIN) => asUser(as, "POST /connections/browser", { body });
const startLogin = (id, as = ADMIN) =>
  asUser(as, "POST /connections/browser/{id}/login-session", { pathParameters: { id } });
const completeLogin = (id, body, as = ADMIN) =>
  asUser(as, "POST /connections/browser/{id}/login-session/complete", { pathParameters: { id }, body });
const revoke = (id, as = ADMIN) => asUser(as, "DELETE /connections/browser/{id}", { pathParameters: { id } });

const valid = {
  name: "HRIS",
  baseUrl: "https://hris.example.com/",
  allowedOrigins: ["https://hris.example.com"],
  preferredMode: "auto",
};

(async () => {
  section("creating a connection");

  let connectionId;
  await check("an admin can create a connection against a public HTTPS origin", async () => {
    const res = await create(valid);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    connectionId = res.body.id;
    assert.equal(res.body.tenantId, TENANT);
    assert.equal(res.body.status, "pending", "a new connection is not authenticated yet");
    assert.deepEqual(res.body.allowedOrigins, ["https://hris.example.com"]);
    assert.equal(res.body.preferredMode, "auto");
    assert.equal(res.body.createdBy, ADMIN.userId);
  });

  await check("a connection name is required", async () => {
    const res = await create({ ...valid, name: "   " });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /name is required/i);
  });

  await check("a non-HTTPS base URL is refused", async () => {
    const res = await create({ ...valid, baseUrl: "http://hris.example.com" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /baseUrl must be a public HTTPS URL/);
  });

  await check("a private or link-local host is refused", async () => {
    // A managed browser resolving these would resolve them inside AmazFlow's network, not the
    // customer's -- which is a request forgery primitive, not a connection.
    for (const host of [
      "https://localhost",
      "https://127.0.0.1",
      "https://10.0.0.5",
      "https://192.168.1.1",
      "https://169.254.169.254",
      "https://172.16.0.1",
      "https://internal.local",
    ]) {
      const res = await create({ ...valid, baseUrl: host, allowedOrigins: [host] });
      assert.equal(res.status, 400, `${host} must be refused, got ${res.status}`);
      assert.match(res.body.error, /public HTTPS URL/);
    }
  });

  await check("credentials embedded in the URL are refused", async () => {
    const res = await create({ ...valid, baseUrl: "https://user:pass@hris.example.com" });
    assert.equal(res.status, 400);
  });

  await check("an allowed origin carrying a path, query or fragment is refused", async () => {
    for (const origin of [
      "https://hris.example.com/app",
      "https://hris.example.com/?x=1",
      "https://hris.example.com/#top",
    ]) {
      const res = await create({ ...valid, allowedOrigins: [origin] });
      assert.equal(res.status, 400, `${origin} must be refused, got ${res.status}`);
      assert.match(res.body.error, /Allowed origin/);
    }
  });

  await check("the allowed origin list must include the base URL's own origin", async () => {
    const res = await create({ ...valid, allowedOrigins: ["https://elsewhere.example.com"] });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /must include the base URL origin/);
  });

  await check("the allowed origin list is bounded at twenty", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `https://host${i}.example.com`);
    const res = await create({ ...valid, baseUrl: "https://host0.example.com/", allowedOrigins: many });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /at most 20 origins/);
  });

  await check("duplicate allowed origins are collapsed rather than refused", async () => {
    const res = await create({
      ...valid,
      allowedOrigins: ["https://hris.example.com", "https://hris.example.com"],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body.allowedOrigins, ["https://hris.example.com"]);
  });

  await check("an unrecognized preferred mode falls back to auto rather than being accepted", async () => {
    const res = await create({ ...valid, preferredMode: "whatever-i-like" });
    assert.equal(res.status, 201);
    assert.equal(res.body.preferredMode, "auto");
  });

  section("role gating");

  await check("a frontline member cannot list, create or revoke connections", async () => {
    assert.equal((await list(MEMBER)).status, 403);
    assert.equal((await create(valid, MEMBER)).status, 403);
    assert.equal((await revoke(connectionId, MEMBER)).status, 403);
    assert.equal((await startLogin(connectionId, MEMBER)).status, 403);
  });

  section("tenant scoping");

  await check("the list returns only the caller's own organization's connections", async () => {
    putTenant(OTHER, "BROWSERCONNECTION", {
      id: "connection_other",
      tenantId: OTHER,
      name: "Other org HRIS",
      baseUrl: "https://other.example.com/",
      allowedOrigins: ["https://other.example.com"],
      preferredMode: "auto",
      status: "active",
      createdBy: "other_admin",
    });
    const res = await list();
    assert.equal(res.status, 200);
    assert.ok(res.body.length >= 1);
    assert.ok(!res.body.some((c) => c.tenantId === OTHER), "another organization's connection must not appear");
    assert.ok(!/otherorg/i.test(res.raw), "no trace of the other organization in the response");
  });

  await check("another organization's connection cannot be revoked", async () => {
    const res = await revoke("connection_other");
    assert.ok(res.status === 403 || res.status === 404, `expected a refusal, got ${res.status}`);
    const untouched = load(`TENANT#${OTHER}`, "BROWSERCONNECTION#connection_other");
    assert.equal(untouched.status, "active", "the other organization's connection is unchanged");
  });

  await check("a connection that does not exist is a 404", async () => {
    assert.equal((await revoke("connection_nope")).status, 404);
    assert.equal((await startLogin("connection_nope")).status, 404);
  });

  await check("staff can reach another organization's connection", async () => {
    const res = await revoke("connection_other", STAFF);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "revoked");
  });

  section("the managed profile identifier never leaves the server");

  await check("a stored managed profile id is stripped from every response", async () => {
    putTenant(TENANT, "BROWSERCONNECTION", {
      id: "connection_withprofile",
      tenantId: TENANT,
      name: "Authenticated HRIS",
      baseUrl: "https://hris.example.com/",
      allowedOrigins: ["https://hris.example.com"],
      preferredMode: "auto",
      status: "active",
      createdBy: ADMIN.userId,
      managedProfileId: "profile-holding-a-real-session",
    });
    const listed = await list();
    assert.ok(!/profile-holding-a-real-session/.test(listed.raw), "the profile id must not appear in the list");
    const revoked = await revoke("connection_withprofile");
    assert.equal(revoked.status, 200);
    assert.ok(!/profile-holding-a-real-session/.test(revoked.raw), "nor in the revoke response");
    assert.equal(revoked.body.managedProfileId, undefined);
  });

  section("the managed browser is not provisioned in this stack");

  await check("starting a login session reports plainly that a managed browser is not configured", async () => {
    const created = await create({ ...valid, name: "Login target" });
    const res = await startLogin(created.body.id);
    assert.equal(res.status, 503);
    assert.match(res.body.error, /Managed browser is not configured/);
  });

  await check("completing a login session reports the same thing", async () => {
    const created = await create({ ...valid, name: "Login target 2" });
    const res = await completeLogin(created.body.id, { loginSessionId: "login_whatever" });
    assert.equal(res.status, 503);
    assert.match(res.body.error, /Managed browser is not configured/);
  });

  await check("everything checkable is still checked before the 503", async () => {
    // A 503 that skips validation would hide real mistakes behind an infrastructure message, and
    // would answer differently from the canonical copy for the same bad request.
    const created = await create({ ...valid, name: "Validation order" });
    const missingSession = await completeLogin(created.body.id, {});
    assert.equal(missingSession.status, 400, "a missing session id is still a 400");
    assert.match(missingSession.body.error, /loginSessionId is required/);

    const notMine = await completeLogin("connection_nope", { loginSessionId: "x" });
    assert.equal(notMine.status, 404, "a connection that does not exist is still a 404");

    await revoke(created.body.id);
    const afterRevoke = await startLogin(created.body.id);
    assert.equal(afterRevoke.status, 409, "a revoked connection is still a 409");
    assert.match(afterRevoke.body.error, /revoked/i);
  });

  section("revocation");

  await check("revoking a connection marks it revoked and audits it", async () => {
    const created = await create({ ...valid, name: "To be revoked" });
    const before = [...store.keys()].filter((k) => k.startsWith(`TENANT#${TENANT}|ACTIVITY#`)).length;
    const res = await revoke(created.body.id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "revoked");
    const after = [...store.keys()].filter((k) => k.startsWith(`TENANT#${TENANT}|ACTIVITY#`)).length;
    assert.ok(after > before, "revocation is recorded in the activity log");
    assert.equal(load(`TENANT#${TENANT}`, `BROWSERCONNECTION#${created.body.id}`).status, "revoked");
  });

  done();
})();
