import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runStatus } from "@amazflow/domain-ui";

const HERE = path.dirname(new URL(import.meta.url).pathname);

test("the customer run-status mapping is total, honest, and never invents a queued state", () => {
  const statuses = [
    "RUNNING", "AWAITING_CONFIRMATION", "WAITING_AGENT", "WAITING_APPROVAL",
    "CANCELLED", "TIMED_OUT", "COMPLETED", "FAILED",
  ];
  for (const status of statuses) {
    const shown = runStatus(status, "customer");
    assert.ok(shown.label, status + " has no customer label");
  }
  assert.equal(runStatus("RUNNING", "customer").label, "Making the change");
  assert.equal(runStatus("AWAITING_CONFIRMATION", "customer").label, "Waiting for your confirmation");
  assert.equal(runStatus("TIMED_OUT", "customer").label, "Timed out");
  assert.notEqual(runStatus("QUEUED", "customer").label, "Queued");
});

test("run detail is composed entirely from the shared narrative and honest telemetry model", () => {
  const source = readFileSync(path.join(HERE, "run-workspace.tsx"), "utf8");
  for (const model of ["diagnose", "stepProgression", "timeline", "toolCalls", "decisions", "gates", "grantScopes", "retryPolicy"]) {
    assert.match(source, new RegExp("\\b" + model + "\\b"), model + " is missing from run detail");
  }
  assert.match(source, /Retry attempts are not recorded/, "absent retry telemetry must be stated");
  assert.match(source, /recordings are not available/, "the UI must not imply browser recordings exist");
  assert.match(source, /cancelRun\(run\.id\)\.path/, "cancellation must use the inventoried endpoint");
  assert.match(source, /confirmRunAction\(run\.id, pendingConfirmation\.stepId!\)\.path/, "confirmation must use the inventoried endpoint");
});

