import test from "node:test";
import assert from "node:assert/strict";
import { resolveTenantId, assertResourceTenant, isAggregateDisclosable, TenantBoundaryError, type WorkIQIdentity } from "./tenant.js";

const frontline: WorkIQIdentity = { tenantId: "tenant-a", userId: "user-1", role: "FRONTLINE" };
const clientAdmin: WorkIQIdentity = { tenantId: "tenant-a", userId: "user-2", role: "CLIENT_ADMIN" };
const superAdmin: WorkIQIdentity = { tenantId: "tenant-staff", userId: "user-3", role: "SUPER_ADMIN" };

test("resolveTenantId defaults to the identity's own tenant", () => {
  assert.equal(resolveTenantId(frontline), "tenant-a");
  assert.equal(resolveTenantId(frontline, "tenant-a"), "tenant-a");
});

test("resolveTenantId rejects a non-super-admin requesting another tenant", () => {
  assert.throws(() => resolveTenantId(clientAdmin, "tenant-b"), TenantBoundaryError);
});

test("resolveTenantId lets a super admin cross tenants", () => {
  assert.equal(resolveTenantId(superAdmin, "tenant-b"), "tenant-b");
});

test("resolveTenantId rejects an identity without a tenantId", () => {
  assert.throws(() => resolveTenantId({ tenantId: "", userId: "u", role: "FRONTLINE" }), TenantBoundaryError);
});

test("assertResourceTenant blocks cross-tenant access for ordinary roles", () => {
  assert.throws(() => assertResourceTenant(clientAdmin, "tenant-b", "opportunity"), TenantBoundaryError);
  assert.doesNotThrow(() => assertResourceTenant(clientAdmin, "tenant-a", "opportunity"));
});

test("assertResourceTenant allows a super admin regardless of resource tenant", () => {
  assert.doesNotThrow(() => assertResourceTenant(superAdmin, "tenant-b", "opportunity"));
});

test("isAggregateDisclosable enforces the minimum sample-size floor", () => {
  assert.equal(isAggregateDisclosable(4), false);
  assert.equal(isAggregateDisclosable(5), true);
});
