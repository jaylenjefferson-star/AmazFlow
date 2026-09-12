import test from "node:test";
import assert from "node:assert/strict";
import type { Principal } from "@amazflow/permissions";
import { workiqIdentityFromPrincipal } from "./principal-bridge.js";
import { resolveTenantId } from "./tenant.js";

const principal: Principal = {
  kind: "user", userId: "user-1", orgId: "tenant-a", group: "CLIENT_ADMIN",
  role: "ORG_ADMIN", teamIds: [], isStaff: false
};

test("workiqIdentityFromPrincipal carries the org-scoped tenant, user, and coarse role", () => {
  const identity = workiqIdentityFromPrincipal(principal);
  assert.deepEqual(identity, { tenantId: "tenant-a", userId: "user-1", role: "CLIENT_ADMIN" });
});

test("the bridged identity works directly with tenant resolution", () => {
  const identity = workiqIdentityFromPrincipal(principal);
  assert.equal(resolveTenantId(identity), "tenant-a");
});

test("a staff principal's own orgId is not mistaken for SUPER_ADMIN cross-tenant reach", () => {
  const staffPrincipal: Principal = { ...principal, isStaff: true, group: "SUPER_ADMIN", role: "STAFF_ADMIN", orgId: "tenant-staff" };
  const identity = workiqIdentityFromPrincipal(staffPrincipal);
  // A SUPER_ADMIN-rooted identity can cross tenants, but only when explicitly asked to -- it is
  // still pinned to its own tenant by default.
  assert.equal(resolveTenantId(identity), "tenant-staff");
  assert.equal(resolveTenantId(identity, "tenant-other"), "tenant-other");
});
