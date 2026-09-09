import test from "node:test";
import assert from "node:assert/strict";
import { AgentCoreActionExecutor, AgentCoreAiProvider, AgentCoreCopilot, AgentCoreRuntime } from "./agentcore";

const streamClient = (events: unknown[]) => ({ send: async () => ({ stream: (async function* () { for (const event of events) yield event; })() }) });

test("bounded AgentCore results reject values outside the workflow allowlist", async () => {
  const runtime = new AgentCoreRuntime(streamClient([{ contentBlockDelta: { delta: { text: '{"value":"DELETE","confidence":0.99}' } } }]) as never);
  const provider = new AgentCoreAiProvider(runtime, "arn:test");
  await assert.rejects(() => provider.run({ id: "ai", name: "Classify", type: "ai", operation: "classify", prompt: "Classify", outputKey: "result", confidenceThreshold: 0.8, allowedValues: ["ALLOW"], next: "done" }, {}), /outside the workflow allowlist/);
});

test("action results preserve side-effect uncertainty and trace correlation", async () => {
  const runtime = new AgentCoreRuntime(streamClient([
    { contentBlockDelta: { delta: { text: '{"status":"FAILED","error":"response lost","sideEffectObserved":true}' } } },
    { metadata: { metrics: { latencyMs: 42 } } }
  ]) as never);
  const executor = new AgentCoreActionExecutor(runtime, "arn:test");
  const outcome = await executor.execute({
    workflow: { id: "workflow", tenantId: "tenant", name: "Test", description: "Test workflow", version: 1, status: "active", dataClass: "INTERNAL", assignedRoles: ["SUPER_ADMIN"], startAt: "action", allowedProviders: ["api"], steps: [] },
    run: { id: "run", tenantId: "tenant", workflowId: "workflow", workflowVersion: 1, status: "RUNNING", context: {}, audit: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    step: { id: "action", name: "Act", type: "action", provider: "api", operation: "POST", input: {} }, input: {}, executionGrant: "signed"
  });
  assert.equal(outcome.sideEffectObserved, true);
  assert.equal(outcome.metadata?.executionBackend, "agentcore");
  assert.ok(outcome.metadata?.traceId);
});

test("operator turns propagate the authenticated end-user bearer token", async () => {
  let invocation: Record<string, unknown> | undefined;
  const runtime = { invoke: async (input: Record<string, unknown>) => {
    invocation = input;
    return { text: "ok", metadata: { executionBackend: "agentcore" as const } };
  } };
  const copilot = new AgentCoreCopilot(runtime as unknown as AgentCoreRuntime, "arn:test");
  await copilot.turn({ userId: "operator", tenantId: "tenant", message: "hello", bearerToken: "jwt-token" });
  assert.equal(invocation?.bearerToken, "jwt-token");
  assert.equal(invocation?.actorId, "tenant:operator");
});
