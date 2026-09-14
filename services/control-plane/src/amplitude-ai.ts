// Amplitude Agent Analytics bootstrap.
//
// `contentMode: 'metadata_only'` -- not the SDK's own example default ('full') -- deliberately.
// The prompts and completions that pass through this file are a customer's own SOP document
// (generateWorkflowFromSop) or an operator's Copilot conversation, both of which are Customer
// Content in the sense apps/web/app/lib/analytics.tsx already uses that term: real prompt/response
// text flowing to Amplitude as a subprocessor is a data-processing decision the Subprocessors page
// does not currently describe, the same reasoning that keeps session replay off the authenticated
// consoles. `metadata_only` records token counts, latency, model, and cost -- never prompt or
// completion text -- so this file's callers also pass short, bounded descriptors rather than raw
// document/conversation content, on purpose and regardless of contentMode: a later change to
// contentMode should not turn a defensive default into an accidental content leak.
//
// Every LLM call this control plane makes goes through Bedrock AgentCore's managed invoke/poll
// surface (services/control-plane/src/agentcore.ts) or, on the `useAgentCore() === false` fallback
// path, a raw bedrock-runtime Converse call -- never a wrapped provider client (OpenAI, Anthropic,
// etc.) `@amplitude/ai` can auto-instrument. Both are the "managed and hosted agent architecture"
// case the SDK's own docs describe: there is nothing for a provider wrapper to intercept, so every
// call site tracks manually with trackUserMessage/trackAiMessage rather than swapping an import.
//
// IMPORTANT -- read this before assuming events are landing from production. The AgentCore branch
// referenced above is the canonical target architecture in this file's caller (handler.ts). The
// deployed inline Lambda (infrastructure/aws-cdk/amazflow-dev.yaml) has never had AgentCore
// mirrored into it: it runs the unconditional bedrock.send() path exclusively, for all three call
// sites, today. That's a pre-existing gap this change did not create.
//
// A second, more fundamental reason this file's tracking is NOT mirrored into the deployed
// template at all: the deployed Lambda is a raw CloudFormation `ZipFile` with no packaging step,
// so its `require(...)` calls only resolve modules the Node 22 Lambda runtime provides natively
// (the AWS SDK v3 clients, which AWS bundles into the runtime image) or Node builtins. `@amplitude/
// ai` is an ordinary npm dependency with no such runtime support -- `require('@amplitude/ai')`
// inside that ZipFile would throw `Cannot find module` at cold start and take the ENTIRE control
// plane down, not just the three AI routes, since it's a top-level require evaluated before any
// handler code runs. Getting real events out of production needs one of: (a) the control plane's
// long-planned migration off ZipFile onto this package's own esbuild-bundled dist/index.js (see
// docs/DEPLOYING.md: "services/control-plane/src/handler.ts is the canonical target... not built
// or deployed anywhere" -- a pre-existing, independent migration, not something to fold into an
// analytics change), or (b) a Lambda Layer built and published to carry `@amplitude/ai` and its
// dependencies, wired into the template's `Layers:` (which does not exist there today). Both are
// real infrastructure decisions with their own cost and review, not something to do silently here.
const { AmplitudeAI, AIConfig } = require("@amplitude/ai");

const amplitudeAi = new AmplitudeAI({
  apiKey: process.env.AMPLITUDE_AI_API_KEY,
  config: new AIConfig({
    contentMode: "metadata_only",
  }),
});

// Module-level singletons -- re-creating ai.agent(...) per request would give every turn a
// different [Agent] Agent ID and break session grouping in Agent Analytics.
export const workflowStepExecutorAgent = amplitudeAi.agent("workflow-step-executor", {
  description:
    "Executes a single \"ai\"-type workflow step (classify/extract/transform/summarize/choose) during a run. Legacy-only in production today; see the file header.",
});
export const workflowGeneratorAgent = amplitudeAi.agent("workflow-generator", {
  description: "Drafts a new AmazFlow workflow definition from a customer's SOP document. One-shot: no ongoing conversation.",
});
export const copilotAgent = amplitudeAi.agent("copilot", {
  description: "AmazFlow Copilot -- the internal assistant for AmazFlow's own SUPER_ADMIN operators.",
});
