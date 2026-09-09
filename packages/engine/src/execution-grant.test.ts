import assert from "node:assert/strict";
import test from "node:test";
import { ExecutionGrantService } from "./execution-grant.ts";

const secret = "test-secret-that-is-definitely-longer-than-thirty-two-bytes";
const input = {
  runId: "run-1",
  tenantId: "tenant-a",
  workflowId: "workflow-1",
  workflowVersion: 2,
  stepId: "action-1",
  allowedTools: ["browser.execute"],
  confirmationGranted: true
};

test("execution grants bind the tenant, step, and tool", async () => {
  const grants = new ExecutionGrantService(secret);
  const token = grants.issue(input, 1_000_000);
  const payload = await grants.verify(token, { tenantId: "tenant-a", stepId: "action-1", tool: "browser.execute" }, undefined, 1_001_000);
  assert.equal(payload.workflowVersion, 2);
  await assert.rejects(() => grants.verify(token, { tenantId: "tenant-b" }, undefined, 1_001_000), /tenantId mismatch/);
  await assert.rejects(() => grants.verify(token, { tool: "email.send" }, undefined, 1_001_000), /not authorized/);
});

test("execution grants reject tampering, expiration, and replay", async () => {
  const grants = new ExecutionGrantService(secret, 5);
  const token = grants.issue(input, 1_000_000);
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  await assert.rejects(() => grants.verify(tampered, {}, undefined, 1_001_000), /signature/);
  await assert.rejects(() => grants.verify(token, {}, undefined, 1_006_000), /expired/);
  const seen = new Set<string>();
  const replayStore = { consume: async (id: string) => seen.has(id) ? false : (seen.add(id), true) };
  await grants.verify(token, {}, replayStore, 1_001_000);
  await assert.rejects(() => grants.verify(token, {}, replayStore, 1_001_000), /already consumed/);
});
