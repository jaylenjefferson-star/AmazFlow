import test from "node:test";
import assert from "node:assert/strict";
import { buildSendToAmazFlowHandoff, sendToAmazFlowHandoffSchema } from "./handoff.js";

const now = new Date().toISOString();
const approvedOpportunity = {
  id: "opp-1", tenantId: "tenant-a", title: "Automate weekly report",
  summary: "Five reps repeat this every Friday", estimatedMinutesSavedPerWeek: 120, status: "approved"
};

test("an approved opportunity produces a narrow handoff payload", () => {
  const handoff = buildSendToAmazFlowHandoff({ opportunity: approvedOpportunity, requestedByUserId: "user-1", createdAt: now });
  assert.deepEqual(Object.keys(handoff).sort(), [
    "createdAt", "estimatedMinutesSavedPerWeek", "opportunityId", "requestedByUserId",
    "suggestedWorkflowName", "summary", "tenantId", "title"
  ]);
});

test("only an approved opportunity may be sent to AmazFlow", () => {
  assert.throws(
    () => buildSendToAmazFlowHandoff({ opportunity: { ...approvedOpportunity, status: "proposed" }, requestedByUserId: "user-1", createdAt: now }),
    /approved/
  );
});

test("the handoff schema rejects fields outside the narrow contract", () => {
  assert.throws(() =>
    sendToAmazFlowHandoffSchema.parse({
      tenantId: "tenant-a", opportunityId: "opp-1", title: "x", summary: "y",
      estimatedMinutesSavedPerWeek: 1, requestedByUserId: "user-1", createdAt: now,
      classificationInternals: { sampleSize: 500 }
    })
  );
});
