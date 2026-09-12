import test from "node:test";
import assert from "node:assert/strict";
import { parseAggregatedSession, assertNoRestrictedTelemetryFields, aggregatedSessionSchema } from "./sessions.js";

const validSession = {
  id: "sess-1", tenantId: "tenant-a", employeeId: "emp-1", teamId: "team-1",
  applicationOrDomain: "salesforce.com",
  startedAt: "2026-01-01T09:00:00.000Z", endedAt: "2026-01-01T09:30:00.000Z",
  activeMinutes: 25, idleMinutes: 5, switchCount: 3
};

test("aggregated session accepts metadata-only telemetry", () => {
  const value = parseAggregatedSession(validSession);
  assert.equal(value.applicationOrDomain, "salesforce.com");
  assert.equal(value.isDemo, false);
});

test("aggregated session rejects endedAt before startedAt", () => {
  assert.throws(() =>
    aggregatedSessionSchema.parse({ ...validSession, startedAt: "2026-01-01T10:00:00.000Z" })
  );
});

test("restricted telemetry fields are rejected before schema validation, by name", () => {
  assert.throws(() => assertNoRestrictedTelemetryFields({ ...validSession, keystrokes: "abc" }), /keystrokes/);
  assert.throws(() => assertNoRestrictedTelemetryFields({ ...validSession, screenshot: "data:..." }), /screenshot/);
  assert.throws(() => parseAggregatedSession({ ...validSession, password: "hunter2" }), /password/);
});

test("aggregated session schema also rejects unnamed unknown fields via strict()", () => {
  assert.throws(() => parseAggregatedSession({ ...validSession, mysteryField: true }));
});
