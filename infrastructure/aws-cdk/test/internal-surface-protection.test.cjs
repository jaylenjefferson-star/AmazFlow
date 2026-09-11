// Phase 10 / task 21.10: authorization is enforced by the control plane, not by the
// existence of the admin bundle or its navigation.
require("./harness.cjs");
const assert = require("node:assert/strict");
const test = require("node:test");
const { asUser } = require("./guardrail-support.cjs");

const INTERNAL_ROUTES = [
  "GET /organizations",
  "GET /leads",
  "GET /activity",
  "GET /settings",
  "POST /runs/{id}/executor/invoke",
];

test("customer principals receive 403 on every internal staff route", async () => {
  for (const routeKey of INTERNAL_ROUTES) {
    const result = await asUser(
      { userId: "customer", tenantId: "acme", group: "CLIENT_ADMIN" },
      routeKey,
      { pathParameters: { id: "run_missing" } },
    );
    assert.equal(result.status, 403, routeKey);
    assert.equal(result.body.code, "FORBIDDEN", routeKey);
  }
});

test("the same request is available to a staff principal", async () => {
  const result = await asUser(
    { userId: "staff", tenantId: "amazflow", group: "SUPER_ADMIN" },
    "GET /organizations",
  );
  assert.equal(result.status, 200);
});
