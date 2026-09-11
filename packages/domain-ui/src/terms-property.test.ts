// Property test for task 15.9 (Property 3: run status transition validity) -- specifically the
// bullet "the presentation mapping is total": `runStatus` must return a real label and tone for
// ANY string, including one the engine never persists, rather than throwing or rendering blank.
//
// _Validates: Requirements 16.1, 16.5_
//
// The backend half of Property 3 (cancellation exactness, resume-path exactness, terminal
// immutability, audit monotonicity, unsubstantiated success) is covered by
// infrastructure/aws-cdk/test/property-run-lifecycle.test.cjs, against the actual control-plane
// route handlers where those transitions are enforced. This file covers the one bullet that belongs
// to presentation rather than execution.
import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { runStatus } from "./terms.ts";

const KNOWN_STATUSES = [
  "RUNNING",
  "AWAITING_CONFIRMATION",
  "WAITING_AGENT",
  "WAITING_APPROVAL",
  "CANCELLED",
  "TIMED_OUT",
  "COMPLETED",
  "FAILED",
];

test("runStatus never throws and always returns a non-empty label and tone, for any string", () => {
  fc.assert(
    fc.property(fc.string(), (status) => {
      const shown = runStatus(status);
      return typeof shown.label === "string" && shown.label.length > 0 && typeof shown.tone === "string" && shown.tone.length > 0;
    }),
  );
});

test("an unrecognized status is never humanized into one of the real labels", () => {
  fc.assert(
    fc.property(
      fc.string().filter((status) => !KNOWN_STATUSES.includes(status)),
      (status) => {
        // The engine has no queued state -- a run is RUNNING from creation -- so "Queued" is the
        // specific plausible-but-false label this must never invent (requirement 16.1's honesty
        // point). More generally, an unrecognized status must fall back to the explicit unknown
        // label rather than colliding with any real one.
        const shown = runStatus(status);
        return shown.label === "Unknown status";
      },
    ),
  );
});

test("every real persisted status still has its own real label, not the unknown fallback", () => {
  for (const status of KNOWN_STATUSES) {
    assert.notEqual(runStatus(status).label, "Unknown status", `${status} lost its label`);
  }
});
