// Behavioural coverage for the customer-managed secret routes (tasks 20.2 / 20.3).
//
// source-parity.test.cjs and secret-non-leakage.test.cjs prove these routes and their
// non-leakage discipline EXIST in source, symmetrically, in both control-plane copies. This
// exercises the deployed template's own inline handler: validation, tenant scoping, role
// gating, and that a value never survives past the write that accepted it.
//
// _Requirements: 20.6, 20.7, 20.8, 20.9, 20.10, 20.11, 20.12
const assert = require("node:assert");
const { store, putTenant, load, asUser, reporter } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("SECRETS: customer-managed secret routes");

const TENANT = "secretorg";
const OTHER = "otherorg";
const ADMIN = { userId: "user_admin", tenantId: TENANT, group: "CLIENT_ADMIN" };
const MEMBER = { userId: "user_member", tenantId: TENANT, group: "FRONTLINE" };
const STAFF = { userId: "staff", tenantId: "amazflow", group: "SUPER_ADMIN" };

const list = (as = ADMIN) => asUser(as, "GET /secrets");
const create = (body, as = ADMIN) => asUser(as, "POST /secrets", { body });
const rotate = (id, body, as = ADMIN) => asUser(as, "POST /secrets/{id}/rotate", { pathParameters: { id }, body });
const del = (id, as = ADMIN) => asUser(as, "DELETE /secrets/{id}", { pathParameters: { id } });

const valid = { name: "HRIS API key", kind: "api_key", value: "sk_live_abcd1234wxyz" };

(async () => {
  section("creating a secret");

  let secretId;
  await check("an admin can create a secret", async () => {
    const res = await create(valid);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    secretId = res.body.id;
    assert.equal(res.body.tenantId, TENANT);
    assert.equal(res.body.name, "HRIS API key");
    assert.equal(res.body.kind, "api_key");
    assert.equal(res.body.hint, "wxyz", "the hint is the last four characters of the value");
    assert.equal(res.body.createdBy, ADMIN.userId);
    assert.equal(res.body.rotatedAt, null);
    assert.equal(res.body.lastUsedAt, null, "a never-used secret reports null, not zero or a date");
  });

  await check("a secret name is required", async () => {
    const res = await create({ ...valid, name: "   " });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /name is required/i);
  });

  await check("an unrecognized kind is refused", async () => {
    const res = await create({ ...valid, kind: "carrier_pigeon" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /is not a secret kind/);
  });

  await check("a secret value is required", async () => {
    const res = await create({ ...valid, value: "" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /value is required/i);
  });

  section("the value and the store pointer never leave the server");

  await check("the created secret's value and store reference never appear in the response", async () => {
    const res = await create({ ...valid, name: "Never leaked", value: "top-secret-value-xyz" });
    assert.equal(res.status, 201);
    assert.equal(res.body.value, undefined);
    assert.equal(res.body.ref, undefined);
    assert.ok(!/top-secret-value-xyz/.test(res.raw), "the raw response carries no trace of the value");
  });

  await check("the value never lands in the stored record either", async () => {
    const res = await create({ ...valid, name: "Not persisted", value: "should-not-be-stored" });
    const stored = load(`TENANT#${TENANT}`, `SECRET#${res.body.id}`);
    assert.equal(stored.value, undefined);
    assert.ok(stored.ref && stored.ref.arn, "only the external store pointer is persisted");
  });

  section("role gating");

  await check("a frontline member cannot list, create, rotate or delete secrets", async () => {
    assert.equal((await list(MEMBER)).status, 403);
    assert.equal((await create(valid, MEMBER)).status, 403);
    assert.equal((await rotate(secretId, { value: "x" }, MEMBER)).status, 403);
    assert.equal((await del(secretId, MEMBER)).status, 403);
  });

  section("tenant scoping");

  await check("the list returns only the caller's own organization's secrets", async () => {
    putTenant(OTHER, "SECRET", {
      id: "secret_other",
      tenantId: OTHER,
      name: "Other org secret",
      kind: "api_key",
      ref: { provider: "aws_secretsmanager", arn: "arn:aws:secretsmanager:us-east-1:000000000000:secret:amazflow/customer-secret/otherorg/secret_other" },
      hint: "zzzz",
      createdBy: "other_admin",
      createdAt: new Date().toISOString(),
      rotatedAt: null,
      lastUsedAt: null,
    });
    const res = await list();
    assert.equal(res.status, 200);
    assert.ok(!res.body.some((s) => s.tenantId === OTHER), "another organization's secret must not appear");
    assert.ok(!/otherorg/i.test(res.raw), "no trace of the other organization in the response");
  });

  await check("another organization's secret cannot be rotated or deleted", async () => {
    const rotated = await rotate("secret_other", { value: "x" });
    assert.equal(rotated.status, 404, `expected 404, got ${rotated.status}`);
    const deleted = await del("secret_other");
    assert.equal(deleted.status, 404, `expected 404, got ${deleted.status}`);
    const untouched = load(`TENANT#${OTHER}`, "SECRET#secret_other");
    assert.equal(untouched.hint, "zzzz", "the other organization's secret is unchanged");
  });

  await check("a secret that does not exist is a 404", async () => {
    assert.equal((await rotate("secret_nope", { value: "x" })).status, 404);
    assert.equal((await del("secret_nope")).status, 404);
  });

  await check("staff can reach another organization's secret", async () => {
    const res = await del("secret_other", STAFF);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.deleted, true);
  });

  section("rotation");

  await check("rotating a secret updates the hint and rotation timestamp, and audits it", async () => {
    const before = [...store.keys()].filter((k) => k.startsWith(`TENANT#${TENANT}|ACTIVITY#`)).length;
    const res = await rotate(secretId, { value: "brand-new-value-4321" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.hint, "4321");
    assert.ok(res.body.rotatedAt, "rotatedAt is stamped");
    assert.equal(res.body.value, undefined);
    const after = [...store.keys()].filter((k) => k.startsWith(`TENANT#${TENANT}|ACTIVITY#`)).length;
    assert.ok(after > before, "rotation is recorded in the activity log");
  });

  await check("rotation requires a value", async () => {
    const res = await rotate(secretId, {});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /value is required/i);
  });

  section("audit events carry the identifier and name only");

  await check("a create/rotate/delete audit event never carries the secret value", async () => {
    const created = await create({ ...valid, name: "Audited secret", value: "audit-me-not-1234" });
    const activity = [...store.entries()]
      .filter(([k]) => k.startsWith(`TENANT#${TENANT}|ACTIVITY#`))
      .map(([, v]) => JSON.parse(v.document.S));
    const createdEvent = activity.find((entry) => entry.action === "SECRET_CREATED" && entry.details?.secretId === created.body.id);
    assert.ok(createdEvent, "a SECRET_CREATED event was recorded");
    assert.deepEqual(Object.keys(createdEvent.details).sort(), ["name", "secretId"]);
    assert.ok(!/audit-me-not-1234/.test(JSON.stringify(activity)), "no audit record carries the value");

    await rotate(created.body.id, { value: "second-value-5678" });
    const deleted = await del(created.body.id);
    assert.equal(deleted.status, 200);
    const allActivity = [...store.entries()]
      .filter(([k]) => k.startsWith(`TENANT#${TENANT}|ACTIVITY#`))
      .map(([, v]) => JSON.parse(v.document.S));
    assert.ok(!/second-value-5678/.test(JSON.stringify(allActivity)), "the rotated value is not audited either");
    const rotatedEvent = allActivity.find((entry) => entry.action === "SECRET_ROTATED" && entry.details?.secretId === created.body.id);
    const deletedEvent = allActivity.find((entry) => entry.action === "SECRET_DELETED" && entry.details?.secretId === created.body.id);
    assert.deepEqual(Object.keys(rotatedEvent.details).sort(), ["name", "secretId"]);
    assert.deepEqual(Object.keys(deletedEvent.details).sort(), ["name", "secretId"]);
  });

  section("deletion");

  await check("deleting a secret removes it from the store", async () => {
    const created = await create({ ...valid, name: "To be deleted" });
    const res = await del(created.body.id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { id: created.body.id, deleted: true });
    assert.equal(load(`TENANT#${TENANT}`, `SECRET#${created.body.id}`), undefined);
    const listed = await list();
    assert.ok(!listed.body.some((s) => s.id === created.body.id), "a deleted secret is not listed");
  });

  done();
})();
