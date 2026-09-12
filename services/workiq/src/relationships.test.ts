import test from "node:test";
import assert from "node:assert/strict";
import { managerReportRelationshipSchema } from "./relationships.js";

test("manager/report relationship accepts a valid, open-ended record", () => {
  const value = managerReportRelationshipSchema.parse({
    id: "rel-1", tenantId: "tenant-a", managerUserId: "user-1", reportUserId: "user-2",
    startedAt: "2026-01-01T00:00:00.000Z"
  });
  assert.equal(value.managerUserId, "user-1");
});

test("a user cannot manage themselves", () => {
  assert.throws(() =>
    managerReportRelationshipSchema.parse({
      id: "rel-1", tenantId: "tenant-a", managerUserId: "user-1", reportUserId: "user-1",
      startedAt: "2026-01-01T00:00:00.000Z"
    })
  );
});

test("endedAt cannot precede startedAt", () => {
  assert.throws(() =>
    managerReportRelationshipSchema.parse({
      id: "rel-1", tenantId: "tenant-a", managerUserId: "user-1", reportUserId: "user-2",
      startedAt: "2026-02-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:00.000Z"
    })
  );
});
