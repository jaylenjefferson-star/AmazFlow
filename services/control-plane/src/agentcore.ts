import { createHash, randomUUID } from "node:crypto";
import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  InvokeHarnessCommand,
  SaveBrowserSessionProfileCommand,
  StartBrowserSessionCommand,
  StopBrowserSessionCommand,
  type HarnessMessage,
  type HarnessModelConfiguration,
} from "@aws-sdk/client-bedrock-agentcore";
import {
  BedrockAgentCoreControlClient,
  CreateBrowserProfileCommand,
  DeleteBrowserProfileCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";
import { z } from "zod";
import type {
  AiProvider,
  ActionExecutor,
  ExecutionMetadata,
} from "@amazflow/engine";

const boundedResultSchema = z
  .object({ value: z.unknown(), confidence: z.number().min(0).max(1) })
  .passthrough();
const actionResultSchema = z.object({
  status: z.enum(["SUCCEEDED", "FAILED", "FALLBACK"]),
  result: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  sideEffectObserved: z.boolean().default(false),
  browserSessionId: z.string().optional(),
});

export type HarnessInvocation = {
  harnessArn: string;
  sessionId: string;
  prompt: string;
  actorId?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  maxIterations?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  modelId?: string;
  baggage?: Record<string, string | number | undefined>;
  bearerToken?: string;
};

export type HarnessResult = {
  text: string;
  metadata: ExecutionMetadata;
  latencyMs?: number;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
};

export class AgentCoreRuntime {
  constructor(
    private readonly client = new BedrockAgentCoreClient({
      region: process.env.AWS_REGION ?? "us-east-1",
    }),
  ) {}

  async invoke(input: HarnessInvocation): Promise<HarnessResult> {
    const traceId = randomUUID().replaceAll("-", "");
    const model: HarnessModelConfiguration | undefined = input.modelId
      ? {
          bedrockModelConfig: {
            modelId: input.modelId,
            maxTokens: input.maxTokens,
            temperature: 0,
          },
        }
      : undefined;
    const client = input.bearerToken
      ? bearerClient(input.bearerToken)
      : this.client;
    const response = await client.send(
      new InvokeHarnessCommand({
        harnessArn: input.harnessArn,
        runtimeSessionId: stableSessionId(input.sessionId),
        runtimeUserId: input.actorId,
        traceId,
        baggage: input.baggage
          ? Object.entries(input.baggage)
              .filter(
                (entry): entry is [string, string | number] =>
                  entry[1] !== undefined,
              )
              .map(
                ([key, value]) =>
                  `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
              )
              .join(",")
          : undefined,
        messages: [
          {
            role: "user",
            content: [{ text: input.prompt }],
          } satisfies HarnessMessage,
        ],
        systemPrompt: input.systemPrompt
          ? [{ text: input.systemPrompt }]
          : undefined,
        allowedTools: input.allowedTools,
        maxIterations: input.maxIterations ?? 6,
        maxTokens: input.maxTokens ?? 2_000,
        timeoutSeconds: input.timeoutSeconds ?? 120,
        model,
      }),
    );
    if (!response.stream)
      throw new Error("AmazFlow managed AI returned no stream");
    let text = "";
    let latencyMs: number | undefined;
    let usage: HarnessResult["usage"];
    for await (const event of response.stream) {
      if (event.contentBlockDelta?.delta?.text)
        text += event.contentBlockDelta.delta.text;
      if (event.metadata?.metrics?.latencyMs !== undefined)
        latencyMs = event.metadata.metrics.latencyMs;
      if (event.metadata?.usage)
        usage = {
          inputTokens: event.metadata.usage.inputTokens ?? 0,
          outputTokens: event.metadata.usage.outputTokens ?? 0,
          totalTokens: event.metadata.usage.totalTokens ?? 0,
        };
      const failure =
        event.internalServerException ??
        event.validationException ??
        event.runtimeClientError;
      if (failure)
        throw new Error(
          failure.message ?? "AmazFlow managed AI invocation failed",
        );
    }
    emitHarnessMetrics(input.harnessArn, latencyMs, usage);
    return {
      text: stripFences(text),
      latencyMs,
      usage,
      metadata: {
        executionBackend: "agentcore",
        agentSessionId: stableSessionId(input.sessionId),
        traceId,
      },
    };
  }
}

function emitHarnessMetrics(
  harnessArn: string,
  latencyMs?: number,
  usage?: HarnessResult["usage"],
) {
  const inputRate = Number(process.env.AI_INPUT_USD_PER_MILLION ?? 0);
  const outputRate = Number(process.env.AI_OUTPUT_USD_PER_MILLION ?? 0);
  const estimatedSpend = usage
    ? (usage.inputTokens * inputRate + usage.outputTokens * outputRate) / 1_000_000
    : 0;
  const runtime = harnessArn === process.env.AGENTCORE_OPERATOR_HARNESS_ARN ? "Operator" : "Execution";
  console.log(JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: "AmazFlow/AgentCore",
        Dimensions: [["Runtime"]],
        Metrics: [
          { Name: "InvocationLatency", Unit: "Milliseconds" },
          { Name: "TokenUsage", Unit: "Count" },
          { Name: "EstimatedSpendUsd", Unit: "None" },
        ],
      }],
    },
    Runtime: runtime,
    InvocationLatency: latencyMs ?? 0,
    TokenUsage: usage?.totalTokens ?? 0,
    EstimatedSpendUsd: estimatedSpend,
  }));
}

export class AgentCoreAiProvider implements AiProvider {
  constructor(
    private readonly runtime: AgentCoreRuntime,
    private readonly harnessArn: string,
    private readonly fastModelId?: string,
    private readonly fastModelApproved = false,
  ) {}

  async run(
    step: Parameters<AiProvider["run"]>[0],
    context: Record<string, unknown>,
    run?: Parameters<AiProvider["run"]>[2],
  ) {
    const allowed = step.allowedValues?.map(String) ?? [];
    const useFastModel =
      this.fastModelApproved &&
      Boolean(this.fastModelId) &&
      ["classify", "extract", "summarize"].includes(step.operation);
    const response = await this.runtime.invoke({
      harnessArn: this.harnessArn,
      sessionId: run?.id ?? `bounded-${randomUUID()}`,
      prompt: [
        `Operation: ${step.operation}`,
        `Instruction: ${step.prompt}`,
        `Allowed values: ${allowed.length ? allowed.join(", ") : "not restricted"}`,
        `Context: ${JSON.stringify(context)}`,
      ].join("\n"),
      systemPrompt:
        "You are a bounded workflow component. Do not call tools. Return only JSON with value and confidence from 0 to 1. Never invent an allowed value.",
      allowedTools: [],
      maxIterations: 1,
      maxTokens: 800,
      modelId: useFastModel ? this.fastModelId : undefined,
      baggage: {
        tenantId: run?.tenantId,
        workflowId: run?.workflowId,
        version: run?.workflowVersion,
        runId: run?.id,
        stepId: step.id,
      },
    });
    const parsed = boundedResultSchema.parse(parseJson(response.text));
    if (allowed.length && !allowed.includes(String(parsed.value)))
      throw new Error(
        "Managed AI returned a value outside the workflow allowlist",
      );
    return {
      value: parsed.value,
      confidence: parsed.confidence,
      raw: { ...parsed, latencyMs: response.latencyMs },
      metadata: response.metadata,
    };
  }
}

export class AgentCoreActionExecutor implements ActionExecutor {
  constructor(
    private readonly runtime: AgentCoreRuntime,
    private readonly harnessArn: string,
  ) {}

  async execute({
    workflow,
    run,
    step,
    input,
    executionGrant,
  }: Parameters<ActionExecutor["execute"]>[0]) {
    if (!executionGrant)
      throw new Error("Managed execution requires a signed execution grant");
    const response = await this.runtime.invoke({
      harnessArn: this.harnessArn,
      sessionId: run.id,
      prompt: JSON.stringify({
        task: "Execute exactly one approved AmazFlow workflow step and report structured evidence.",
        executionGrant,
        workflow: { id: workflow.id, version: workflow.version },
        step: {
          id: step.id,
          provider: step.provider,
          operation: step.operation,
          connectionId: step.connectionId,
          path: step.path,
        },
        input,
      }),
      systemPrompt:
        "Act only through configured tools. Never broaden the requested operation or navigate outside the connection allowlist. Return only JSON: status (SUCCEEDED, FAILED, or FALLBACK), result, error, sideEffectObserved, and browserSessionId. Use FALLBACK only before any side effect.",
      allowedTools: allowedToolsFor(step.provider),
      maxIterations: 12,
      maxTokens: 2_000,
      timeoutSeconds: 300,
      baggage: {
        tenantId: run.tenantId,
        workflowId: workflow.id,
        version: workflow.version,
        runId: run.id,
        stepId: step.id,
      },
    });
    const parsed = actionResultSchema.parse(parseJson(response.text));
    return {
      status: parsed.status,
      result: parsed.result,
      error: parsed.error,
      sideEffectObserved: parsed.sideEffectObserved,
      metadata: {
        ...response.metadata,
        browserSessionId: parsed.browserSessionId,
      },
    };
  }
}

export class AgentCoreCopilot {
  constructor(
    private readonly runtime: AgentCoreRuntime,
    private readonly harnessArn: string,
  ) {}

  async turn(input: {
    userId: string;
    tenantId: string;
    message: string;
    bearerToken: string;
    context?: Record<string, unknown>;
  }) {
    return this.runtime.invoke({
      harnessArn: this.harnessArn,
      sessionId: `copilot-${input.userId}`,
      actorId: `${input.tenantId}:${input.userId}`,
      prompt: `${input.context ? `Visible UI context: ${JSON.stringify(input.context)}\n` : ""}${input.message}`,
      maxIterations: 8,
      maxTokens: 1_500,
      baggage: { tenantId: input.tenantId, actorId: input.userId },
      bearerToken: input.bearerToken,
    });
  }
}

export class AgentCoreMemory {
  constructor(
    private readonly memoryId: string,
    private readonly client = new BedrockAgentCoreClient({
      region: process.env.AWS_REGION ?? "us-east-1",
    }),
  ) {}

  async remember(input: {
    tenantId: string;
    actorId: string;
    sessionId: string;
    role: "USER" | "ASSISTANT";
    text: string;
    approvedPreference?: boolean;
    clientToken?: string;
  }) {
    await this.client.send(
      new CreateEventCommand({
        memoryId: this.memoryId,
        actorId: `${input.tenantId}:${input.actorId}`,
        sessionId: stableSessionId(input.sessionId),
        eventTimestamp: new Date(),
        payload: [
          {
            conversational: { role: input.role, content: { text: input.text } },
          },
        ],
        extractionMode: input.approvedPreference ? undefined : "SKIP",
        extractionConfig: input.approvedPreference
          ? {
              namespaceVariables: {
                tenant: normalizeNamespace(input.tenantId),
              },
            }
          : undefined,
        metadata: { tenant: { stringValue: input.tenantId } },
        clientToken: input.clientToken,
      }),
    );
  }
}

function bearerClient(token: string) {
  if (!token || /[\r\n]/.test(token))
    throw new Error("A valid end-user bearer token is required");
  const client = new BedrockAgentCoreClient({
    region: process.env.AWS_REGION ?? "us-east-1",
  });
  client.middlewareStack.addRelativeTo(
    (next: any) => async (args: any) => {
      const request = args.request as { headers?: Record<string, string> };
      request.headers = {
        ...request.headers,
        authorization: `Bearer ${token}`,
      };
      return next(args);
    },
    {
      relation: "after",
      toMiddleware: "awsAuthMiddleware",
      name: "amazflowBearerIdentityMiddleware",
      override: true,
    },
  );
  return client;
}

export class AgentCoreBrowserManager {
  constructor(
    private readonly browserIdentifier: string,
    private readonly data = new BedrockAgentCoreClient({
      region: process.env.AWS_REGION ?? "us-east-1",
    }),
    private readonly control = new BedrockAgentCoreControlClient({
      region: process.env.AWS_REGION ?? "us-east-1",
    }),
  ) {}

  async startLoginSession(input: {
    connectionId: string;
    tenantId: string;
    profileId?: string;
    timeoutSeconds?: number;
  }) {
    let profileId = input.profileId;
    if (!profileId) {
      const profile = await this.control.send(
        new CreateBrowserProfileCommand({
          name: profileName(input.tenantId, input.connectionId),
          description: "AmazFlow tenant-scoped managed browser connection",
          clientToken: randomUUID(),
          tags: {
            Product: "AmazFlow",
            Tenant: input.tenantId,
            Connection: input.connectionId,
          },
        }),
      );
      profileId = profile.profileId;
    }
    if (!profileId)
      throw new Error("Could not create a managed browser profile");
    const response = await this.data.send(
      new StartBrowserSessionCommand({
        browserIdentifier: this.browserIdentifier,
        name: `login-${input.connectionId}`,
        sessionTimeoutSeconds: Math.min(input.timeoutSeconds ?? 900, 3600),
        profileConfiguration: { profileIdentifier: profileId },
        viewPort: { width: 1456, height: 900 },
        clientToken: randomUUID(),
      }),
    );
    return {
      profileId,
      browserSessionId: response.sessionId,
      liveViewUrl: response.streams?.liveViewStream?.streamEndpoint,
      expiresAt: new Date(
        Date.now() + Math.min(input.timeoutSeconds ?? 900, 3600) * 1_000,
      ).toISOString(),
    };
  }

  async completeLoginSession(input: {
    profileId: string;
    browserSessionId: string;
  }) {
    await this.data.send(
      new SaveBrowserSessionProfileCommand({
        profileIdentifier: input.profileId,
        browserIdentifier: this.browserIdentifier,
        sessionId: input.browserSessionId,
        clientToken: randomUUID(),
      }),
    );
    await this.data.send(
      new StopBrowserSessionCommand({
        browserIdentifier: this.browserIdentifier,
        sessionId: input.browserSessionId,
      }),
    );
  }

  async deleteProfile(profileId: string) {
    await this.control.send(
      new DeleteBrowserProfileCommand({ profileId, clientToken: randomUUID() }),
    );
  }
}

function allowedToolsFor(provider: string) {
  const configured =
    process.env.AGENTCORE_EXECUTION_TOOL_NAMES?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  return configured.filter(
    (name) =>
      name === provider ||
      name.startsWith(`${provider}.`) ||
      name.includes(`___${provider}_`),
  );
}

function stableSessionId(value: string) {
  return `amazflow-${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeNamespace(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .slice(0, 32) || "amazflow"
  );
}

function profileName(tenantId: string, connectionId: string) {
  const base =
    `${normalizeNamespace(tenantId)}_${normalizeNamespace(connectionId)}`
      .replaceAll("-", "_")
      .slice(0, 48);
  return base || `amazflow_${randomUUID().slice(0, 8)}`;
}

function stripFences(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(stripFences(value));
  } catch {
    throw new Error("AmazFlow managed AI returned invalid structured output");
  }
}
