import test from "node:test";
import assert from "node:assert/strict";
import { classificationDisputeSchema } from "./disputes.js";

const now = new Date().toISOString();

test("an open dispute needs no resolution fields", () => {
  const value = classificationDisputeSchema.parse({
    id: "disp-1", tenantId: "tenant-a", classificationId: "cls-1", raisedByUserId: "user-1",
    reason: "This is not accurate for my role", requestedStatus: "dismissed", status: "open", createdAt: now
  });
  assert.equal(value.status, "open");
});

test("a resolved dispute must record who resolved it and when", () => {
  assert.throws(() =>
    classificationDisputeSchema.parse({
      id: "disp-1", tenantId: "tenant-a", classificationId: "cls-1", raisedByUserId: "user-1",
      reason: "This is not accurate for my role", requestedStatus: "dismissed", status: "resolved", createdAt: now
    })
  );

  const value = classificationDisputeSchema.parse({
    id: "disp-1", tenantId: "tenant-a", classificationId: "cls-1", raisedByUserId: "user-1",
    reason: "This is not accurate for my role", requestedStatus: "dismissed", status: "resolved",
    resolution: "Classification dismissed", resolvedByUserId: "user-2", createdAt: now, resolvedAt: now
  });
  assert.equal(value.resolvedByUserId, "user-2");
});
