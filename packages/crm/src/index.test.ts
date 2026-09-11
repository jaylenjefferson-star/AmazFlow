import { createHmac } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryCrmHarness, NullCrmService } from "./index.ts";

const event = (extra: Record<string, unknown> = {}) => ({
  provider: "monday", eventId: "evt-1", itemId: "item-1", customerName: "Acme",
  stageLabel: "Closed Won", occurredAt: "2026-01-01T00:00:00.000Z",
  primaryContact: { email: "admin@acme.example" }, ...extra
});

test("duplicate closed-won deliveries create one organization and audit event", async () => {
  const harness = new InMemoryCrmHarness({ pathSecret: "path-secret" });
  const first = await harness.handle({ secure: true, pathSecret: "path-secret", body: event() });
  const second = await harness.handle({ secure: true, pathSecret: "path-secret", body: event() });
  assert.equal(first.status, 200);
  assert.deepEqual(second.body?.deduped, true);
  assert.equal(harness.store.organizations.size, 1);
  assert.equal(harness.store.onboarding.size, 1);
  assert.equal(harness.store.audits.length, 1);
});

test("concurrent duplicate deliveries and a deterministic property loop remain idempotent", async () => {
  for (let count = 1; count <= 25; count++) {
    const harness = new InMemoryCrmHarness({ pathSecret: "path-secret" });
    await Promise.all(Array.from({ length: count }, () => harness.handle({ secure: true, pathSecret: "path-secret", body: event() })));
    assert.equal(harness.store.organizations.size, 1);
    assert.equal(harness.store.onboarding.size, 1);
    assert.equal(harness.store.audits.length, 1);
  }
});

test("auth, validation, and challenge gates do no work", async () => {
  const harness = new InMemoryCrmHarness({ pathSecret: "path-secret", signingSecret: "signing-secret" });
  assert.equal((await harness.handle({ secure: true, pathSecret: "wrong", body: event() })).status, 404);
  assert.equal((await harness.handle({ secure: true, pathSecret: "path-secret", authorization: "invalid", body: event() })).status, 401);
  assert.equal((await harness.handle({ secure: true, pathSecret: "path-secret", body: { challenge: "abc" } })).body?.challenge, "abc");
  assert.equal((await harness.handle({ secure: true, pathSecret: "path-secret", body: { itemId: "missing" } })).status, 400);
  assert.equal(harness.store.organizations.size, 0);
});

test("missing contact blocks invitation without blocking onboarding", async () => {
  const harness = new InMemoryCrmHarness({ pathSecret: "path-secret" });
  await harness.handle({ secure: true, pathSecret: "path-secret", body: event({ primaryContact: undefined }) });
  assert.equal([...harness.store.onboarding.values()][0].invite.state, "blocked");
});

test("invitation requires an allowed email domain and unresolved owners stay unset", async () => {
  const harness = new InMemoryCrmHarness({
    pathSecret: "path-secret",
    allowedEmailDomains: ["customer.example"],
    resolveInternalOwner: () => undefined
  });
  await harness.handle({
    secure: true, pathSecret: "path-secret",
    body: event({ primaryContact: { email: "admin@untrusted.example" }, ownerEmail: "staff@amazflow.example" })
  });
  const onboarding = [...harness.store.onboarding.values()][0];
  assert.equal(onboarding.invite.state, "blocked");
  assert.equal(onboarding.internalOwnerUserId, undefined);
});

test("unmapped stages are accepted without state changes and reverse sync is queued", async () => {
  const harness = new InMemoryCrmHarness({ pathSecret: "path-secret" });
  assert.equal((await harness.handle({ secure: true, pathSecret: "path-secret", body: event({ stageLabel: "Future Stage" }) })).status, 202);
  assert.equal(harness.store.organizations.size, 0);
  await harness.handle({ secure: true, pathSecret: "path-secret", body: event() });
  const crm = new NullCrmService();
  await harness.drainReverseSync(crm);
  assert.deepEqual(crm.calls.map((call) => call.method), ["recordOrganizationId", "updateOnboardingStatus"]);
});

test("stale processing markers can be retried without duplicating the organization", async () => {
  let now = new Date("2026-01-01T00:00:00.000Z");
  const harness = new InMemoryCrmHarness({ pathSecret: "path-secret", now: () => now, staleAfterMs: 1000 });
  await harness.handle({ secure: true, pathSecret: "path-secret", body: event() });
  const marker = harness.store.events.get("monday:evt-1")!;
  marker.state = "PROCESSING";
  marker.firstSeenAt = now.toISOString();
  now = new Date("2026-01-01T00:01:00.000Z");
  harness.sweepStale();
  assert.equal(marker.state, "FAILED");
  const retried = await harness.retry("monday:evt-1");
  assert.equal(retried && retried.status, 200);
  assert.equal(harness.store.organizations.size, 1);
  assert.equal(harness.store.audits.length, 1);
});

test("retry preserves the original authorization header semantics", async () => {
  const signingSecret = "signing-secret";
  const tokenBody = "header.payload";
  const authorization = `Bearer ${tokenBody}.${createHmac("sha256", signingSecret).update(tokenBody).digest("base64url")}`;
  const harness = new InMemoryCrmHarness({ pathSecret: "path-secret", signingSecret });
  await harness.handle({ secure: true, pathSecret: "path-secret", authorization, body: event() });
  const marker = harness.store.events.get("monday:evt-1")!;
  marker.state = "FAILED";
  const retried = await harness.retry("monday:evt-1");
  assert.equal(retried && retried.status, 200);
});

test("reverse sync retains failed work for retry and sends only the allowlisted methods", async () => {
  const harness = new InMemoryCrmHarness({ pathSecret: "path-secret" });
  await harness.handle({ secure: true, pathSecret: "path-secret", body: event() });
  let failures = 1;
  const crm = new NullCrmService();
  const original = crm.recordOrganizationId.bind(crm);
  crm.recordOrganizationId = async (...args) => { if (failures--) throw new Error("provider unavailable"); return original(...args); };
  await harness.drainReverseSync(crm);
  assert.equal(harness.store.queue.length, 1);
  await harness.drainReverseSync(crm);
  assert.equal(harness.store.queue.length, 0);
  assert.deepEqual(new Set(crm.calls.map((call) => call.method)), new Set(["recordOrganizationId", "updateOnboardingStatus"]));
});

test("safe logs contain identifiers but no secrets or raw payload", async () => {
  const secret = "path-secret-value";
  const raw = JSON.stringify(event({ primaryContact: { email: "private@example.com" } }));
  const harness = new InMemoryCrmHarness({ pathSecret: secret, signingSecret: "signing-secret" });
  await harness.handle({ secure: true, pathSecret: secret, body: event() });
  const logs = JSON.stringify(harness.store.logs);
  assert.match(logs, /evt-1/);
  assert.doesNotMatch(logs, new RegExp(secret));
  assert.doesNotMatch(logs, new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
