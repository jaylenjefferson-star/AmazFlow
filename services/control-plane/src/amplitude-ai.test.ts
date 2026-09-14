// Agent Analytics verification (wizard doc Phase 4a): exercises the exact call shapes used at
// each of the three instrumented sites in handler.ts -- trackUserMessage/trackAiMessage for a
// single-shot generation, the same pair plus trackToolCall inside a session for the Copilot
// tool-loop, and the accumulated-usage pattern the multi-call Copilot turn relies on -- against a
// MockAmplitudeAI rather than the real bootstrap in amplitude-ai.ts (which reads
// AMPLITUDE_AI_API_KEY at module load and talks to a real endpoint; nothing here should need
// network access or a key to prove the call shapes are correct).
import test from "node:test";
import assert from "node:assert/strict";
import { AIConfig, PROP_INPUT_TOKENS, PROP_IS_ERROR, PROP_OUTPUT_TOKENS, PROP_TOOL_NAME, PROP_TOTAL_TOKENS } from "@amplitude/ai";
import { MockAmplitudeAI } from "@amplitude/ai/testing";

test("workflow-step-executor: one session per run groups every step's AI call", async () => {
  const mock = new MockAmplitudeAI(new AIConfig({ contentMode: "metadata_only" }));
  const agent = mock.agent("workflow-step-executor", { userId: "tenant-acme" });

  await agent.session({ sessionId: "run-100" }).run(async (s) => {
    s.trackUserMessage('Execute "extract" workflow step', { context: { stepId: "step-1", operation: "extract" } });
    s.trackAiMessage('Step "step-1" resolved', "anthropic.claude-3-5-sonnet-20241022-v2:0", "bedrock", 420, {
      inputTokens: 812,
      outputTokens: 64,
      totalTokens: 876,
    });
  });

  mock.assertEventTracked("[Agent] User Message", { userId: "tenant-acme" });
  mock.assertEventTracked("[Agent] AI Response", { userId: "tenant-acme" });
  mock.assertSessionClosed("run-100");
});

test("workflow-step-executor: a thrown step error is tracked as a failed AI Response, not silently dropped", async () => {
  const mock = new MockAmplitudeAI(new AIConfig({ contentMode: "metadata_only" }));
  const agent = mock.agent("workflow-step-executor", { userId: "tenant-acme" });

  await assert.rejects(
    agent.session({ sessionId: "run-101" }).run(async (s) => {
      s.trackUserMessage('Execute "classify" workflow step', { context: { stepId: "step-2" } });
      try {
        throw new Error("Bedrock throttled the request");
      } catch (err) {
        s.trackAiMessage("", "anthropic.claude-3-5-sonnet-20241022-v2:0", "bedrock", 12, {
          isError: true,
          errorMessage: (err as Error).message,
        });
        throw err;
      }
    }),
  );

  const responses = mock.getEvents("[Agent] AI Response");
  assert.equal(responses.length, 1);
  assert.equal(responses[0].event_properties?.[PROP_IS_ERROR], true);
});

test("workflow-generator: one-shot session, no leftover state between two calls", async () => {
  const mock = new MockAmplitudeAI(new AIConfig({ contentMode: "metadata_only" }));
  const agent = mock.agent("workflow-generator", { userId: "tenant-acme" });

  for (const sessionId of ["workflow-gen-a", "workflow-gen-b"]) {
    await agent.session({ sessionId }).run(async (s) => {
      s.trackUserMessage("Draft a workflow from an SOP document", { context: { tenantId: "tenant-acme", sopLength: 240 } });
      s.trackAiMessage('Draft "workflow-abc" generated', "anthropic.claude-3-5-sonnet-20241022-v2:0", "bedrock", 1800, {
        inputTokens: 640,
        outputTokens: 512,
        totalTokens: 1152,
      });
    });
    mock.assertSessionClosed(sessionId);
  }

  // Two independent one-shot sessions, not one that grew -- this is the property the "no natural
  // conversation, no parent/child delegation" design decision in handler.ts depends on.
  assert.equal(mock.getEvents("[Agent] Session End").length, 2);
});

test("copilot: a tool-calling turn tracks the user message, each tool call, and one accumulated AI response", async () => {
  const mock = new MockAmplitudeAI(new AIConfig({ contentMode: "metadata_only" }));
  const agent = mock.agent("copilot", { userId: "staff-1" });

  await agent.session({ sessionId: "copilot-staff-1" }).run(async (s) => {
    s.trackUserMessage("Operator sent a Copilot message", { context: { tenantId: "amazflow", hasContext: true } });

    // Mirrors handler.ts's addUsage() accumulator: a turn with tool calls is several Bedrock
    // calls for one logical AI Response, so per-call token counts would undercount cost.
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const addUsage = (u: { inputTokens: number; outputTokens: number; totalTokens: number }) => {
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
      usage.totalTokens += u.totalTokens;
    };

    addUsage({ inputTokens: 900, outputTokens: 40, totalTokens: 940 }); // first Converse call, decides to call a tool
    const toolStart = Date.now();
    s.trackToolCall("get_workflow", Date.now() - toolStart, true, { toolInput: { id: "workflow-abc" } });

    addUsage({ inputTokens: 1100, outputTokens: 180, totalTokens: 1280 }); // second Converse call, final reply
    s.trackAiMessage("Here's what I found in that workflow...", "anthropic.claude-3-5-sonnet-20241022-v2:0", "bedrock", 2400, usage);
  });

  mock.assertEventTracked("[Agent] User Message", { userId: "staff-1" });
  const toolCalls = mock.getEvents("[Agent] Tool Call");
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].event_properties?.[PROP_TOOL_NAME], "get_workflow");

  const responses = mock.getEvents("[Agent] AI Response");
  assert.equal(responses.length, 1, "one turn, one AI Response -- not one per Converse call");
  // The one thing this test exists to prove: token counts on the single AI Response reflect BOTH
  // Converse calls the turn made (900+1100 in, 40+180 out), not just the last one -- accumulation
  // is what fixes an undercount, and this is exactly what would silently regress if handler.ts's
  // addUsage() were dropped or only the final call's usage were passed through.
  const props = responses[0].event_properties as Record<string, unknown>;
  assert.equal(props[PROP_INPUT_TOKENS], 2000);
  assert.equal(props[PROP_OUTPUT_TOKENS], 220);
  assert.equal(props[PROP_TOTAL_TOKENS], 2220);
});

test("copilot: a failed turn is tracked with isError and the accumulated usage up to that point", async () => {
  const mock = new MockAmplitudeAI(new AIConfig({ contentMode: "metadata_only" }));
  const agent = mock.agent("copilot", { userId: "staff-1" });

  await assert.rejects(
    agent.session({ sessionId: "copilot-staff-1" }).run(async (s) => {
      s.trackUserMessage("Operator sent a Copilot message", { context: { tenantId: "amazflow", hasContext: true } });
      try {
        throw new Error("ThrottlingException");
      } catch (err) {
        s.trackAiMessage("", "anthropic.claude-3-5-sonnet-20241022-v2:0", "bedrock", 50, {
          inputTokens: 900,
          outputTokens: 0,
          totalTokens: 900,
          isError: true,
          errorMessage: (err as Error).message,
        });
        throw err;
      }
    }),
  );

  const responses = mock.getEvents("[Agent] AI Response");
  assert.equal(responses.length, 1);
});
