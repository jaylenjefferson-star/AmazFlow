import test from "node:test";
import assert from "node:assert/strict";
import { opportunitySchema } from "./opportunities.js";

const now = new Date().toISOString();
const base = {
  id: "opp-1", tenantId: "tenant-a", classificationId: "cls-1", title: "Automate weekly report",
  summary: "Five reps repeat this every Friday", estimatedMinutesSavedPerWeek: 120,
  confirmedByUserId: "user-1", confirmedAt: now, createdAt: now, updatedAt: now
};

test("a proposed opportunity requires a human confirmation on the record", () => {
  const value = opportunitySchema.parse({ ...base, status: "proposed" });
  assert.equal(value.confirmedByUserId, "user-1");
});

test("an opportunity cannot be created without confirmedByUserId at all", () => {
  const { confirmedByUserId, ...withoutConfirmation } = base;
  assert.throws(() => opportunitySchema.parse({ ...withoutConfirmation, status: "proposed" }));
});

test("approved opportunities still require a non-empty confirmedByUserId", () => {
  assert.throws(() => opportunitySchema.parse({ ...base, confirmedByUserId: "", status: "approved" }));
});
