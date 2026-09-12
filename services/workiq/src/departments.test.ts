import test from "node:test";
import assert from "node:assert/strict";
import { departmentSchema, teamSchema } from "./departments.js";

const now = new Date().toISOString();

test("department schema accepts a valid record", () => {
  const value = departmentSchema.parse({
    id: "dept-1", tenantId: "tenant-a", name: "Support", isDemo: false, createdAt: now, updatedAt: now
  });
  assert.equal(value.name, "Support");
});

test("department cannot be its own parent", () => {
  assert.throws(() =>
    departmentSchema.parse({
      id: "dept-1", tenantId: "tenant-a", name: "Support", parentDepartmentId: "dept-1", createdAt: now, updatedAt: now
    })
  );
});

test("department schema rejects unknown fields", () => {
  assert.throws(() =>
    departmentSchema.parse({
      id: "dept-1", tenantId: "tenant-a", name: "Support", createdAt: now, updatedAt: now, notes: "leaked field"
    })
  );
});

test("team schema requires a manager and department", () => {
  const value = teamSchema.parse({
    id: "team-1", tenantId: "tenant-a", departmentId: "dept-1", name: "Onboarding", managerUserId: "user-1",
    createdAt: now, updatedAt: now
  });
  assert.equal(value.managerUserId, "user-1");

  assert.throws(() =>
    teamSchema.parse({ id: "team-1", tenantId: "tenant-a", departmentId: "dept-1", name: "Onboarding", createdAt: now, updatedAt: now })
  );
});
