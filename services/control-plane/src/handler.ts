// @ts-nocheck
// Packaged production handler extracted from the former CloudFormation ZipFile.
// New behavior belongs in source modules; infrastructure templates no longer own application logic.
const crypto = require("crypto");
const {
  DynamoDBClient,
  ScanCommand,
  QueryCommand,
  PutItemCommand,
  GetItemCommand,
  TransactWriteItemsCommand,
} = require("@aws-sdk/client-dynamodb");
const {
  BedrockRuntimeClient,
  ConverseCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const {
  AgentCoreRuntime,
  AgentCoreAiProvider,
  AgentCoreActionExecutor,
  AgentCoreCopilot,
  AgentCoreMemory,
  AgentCoreBrowserManager,
} = require("./agentcore");
const { validateBrowserConnectionInput } = require("./browser-connections");
const { ExecutionGrantService, WorkflowEngine } = require("@amazflow/engine");
const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2");
const {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const db = new DynamoDBClient({});
const bedrock = new BedrockRuntimeClient({});
const ses = new SESv2Client({});
const cognito = new CognitoIdentityProviderClient({});
const table = process.env.TABLE_NAME;
const agentCoreRuntime = new AgentCoreRuntime();
const useAgentCore = () => process.env.AI_EXECUTION_BACKEND !== "legacy";
const assertLegacyEnabled = () => {
  if (process.env.LEGACY_EXECUTOR_ENABLED !== "true")
    throw new Error("The legacy AI rollback path is disabled");
};
const executionHarnessArn = process.env.AGENTCORE_EXECUTION_HARNESS_ARN;
const operatorHarnessArn = process.env.AGENTCORE_OPERATOR_HARNESS_ARN;
const agentCoreAi = executionHarnessArn
  ? new AgentCoreAiProvider(
      agentCoreRuntime,
      executionHarnessArn,
      process.env.AGENTCORE_FAST_MODEL_ID,
      process.env.AGENTCORE_FAST_MODEL_APPROVED === "true",
    )
  : null;
const agentCoreActions = executionHarnessArn
  ? new AgentCoreActionExecutor(agentCoreRuntime, executionHarnessArn)
  : null;
const agentCoreCopilot = operatorHarnessArn
  ? new AgentCoreCopilot(agentCoreRuntime, operatorHarnessArn)
  : null;
const agentCoreMemory = process.env.AGENTCORE_MEMORY_ID
  ? new AgentCoreMemory(process.env.AGENTCORE_MEMORY_ID)
  : null;
const browserManager = process.env.AGENTCORE_BROWSER_ID
  ? new AgentCoreBrowserManager(process.env.AGENTCORE_BROWSER_ID)
  : null;
const executionGrants = process.env.EXECUTION_GRANT_SECRET
  ? new ExecutionGrantService(process.env.EXECUTION_GRANT_SECRET, 300)
  : null;
const privateResponseFields = new Set([
  "managedProfileId",
  "agentSessionId",
  "browserSessionId",
]);
const reply = (s, b) => ({
  statusCode: s,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  },
  body: JSON.stringify(b, (key, value) =>
    privateResponseFields.has(key) ? undefined : value,
  ),
});
const emitApplicationMetric = (name, value = 1) =>
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: "AmazFlow/AgentCore",
            Dimensions: [[]],
            Metrics: [{ Name: name, Unit: "Count" }],
          },
        ],
      },
      [name]: value,
    }),
  );
// API Gateway's JWT authorizer forwards the cognito:groups claim as the literal
// string "[GROUP1, GROUP2]" (brackets included as characters), not a clean
// comma list and not a real array -- strip the brackets before splitting.
const auth = (e) => {
  const c = e.requestContext?.authorizer?.jwt?.claims || {};
  const groups = String(c["cognito:groups"] || "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((g) => g.trim());
  const role = ["SUPER_ADMIN", "CLIENT_ADMIN", "FRONTLINE"].find((r) =>
    groups.includes(r),
  );
  return { userId: c.sub, tenantId: c["custom:tenant_id"], role };
};
const parse = (i) => JSON.parse(i.document.S);
const now = () => new Date().toISOString();
const legacyAi = async (step, context) => {
  assertLegacyEnabled();
  const allowed = Array.isArray(step.allowedValues)
    ? step.allowedValues.map(String)
    : [];
  const system =
    'You are a bounded operations workflow component. Never choose or invent tools. Return JSON with keys "value" and "confidence" (required, confidence between 0 and 1), plus any other field the instruction below explicitly asks you to extract -- omit fields it does not ask for.';
  const prompt = `Operation: ${step.operation}\nInstruction: ${step.prompt}\nAllowed values: ${allowed.length ? allowed.join(", ") : "not restricted"}\nContext: ${JSON.stringify(context || {})}`;
  const out = await bedrock.send(
    new ConverseCommand({
      modelId: process.env.BEDROCK_MODEL_ID,
      system: [{ text: system }],
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 800, temperature: 0 },
    }),
  );
  let text = out.output?.message?.content?.find((x) => x.text)?.text || "{}";
  text = text.replace(/^```json\s*|\s*```$/g, "");
  const result = JSON.parse(text);
  if (
    typeof result.confidence !== "number" ||
    result.confidence < 0 ||
    result.confidence > 1
  )
    throw new Error("Invalid AI confidence");
  if (allowed.length && !allowed.includes(String(result.value)))
    throw new Error("AI returned value outside allowlist");
  return { result, usage: out.usage, metadata: { executionBackend: "legacy" } };
};
const ai = async (step, context, run) => {
  if (!useAgentCore()) return legacyAi(step, context);
  if (!agentCoreAi)
    throw new Error("Managed AI execution harness is not configured");
  const out = await agentCoreAi.run(step, context, run);
  const { metadata, raw, ...result } = out;
  return { result, usage: raw, metadata };
};
// Baseline SSRF guard for autonomous api-provider actions: block obviously
// internal/metadata targets. Not exhaustive (no DNS-rebinding protection) but a
// reasonable floor given only SUPER_ADMIN authors workflows today.
const isUnsafeUrl = (urlStr) => {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:" && u.protocol !== "http:") return true;
    const host = u.hostname;
    if (/^(127\.|10\.|169\.254\.|192\.168\.|0\.0\.0\.0|localhost)/i.test(host))
      return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
  } catch {
    return true;
  }
};
// Shared shape validation for both the AI-generation path and the hand-edited-JSON
// save path (POST /workflows previously only checked 4 top-level fields and let
// anything through underneath -- a typo'd provider or a dangling step reference
// would silently save). Returns null when valid, or a specific error string.
const VALID_STEP_TYPES = [
  "ai",
  "action",
  "condition",
  "approval",
  "verify",
  "end",
];
const VALID_PROVIDERS = [
  "browser",
  "api",
  "spreadsheet",
  "email",
  "file",
  "mock",
];
const validateWorkflowShape = (draft) => {
  if (!draft || typeof draft !== "object") return "Workflow must be an object";
  if (!draft.id || !draft.tenantId || !draft.name || !draft.startAt)
    return "Missing id, tenantId, name, or startAt";
  if (!Array.isArray(draft.steps) || draft.steps.length === 0)
    return "steps must be a non-empty array";
  const ids = new Set(draft.steps.map((s) => s && s.id));
  if (!ids.has(draft.startAt))
    return `startAt "${draft.startAt}" does not match any step id`;
  for (const step of draft.steps) {
    if (!step || !step.id || !step.type)
      return "Every step needs an id and a type";
    if (!VALID_STEP_TYPES.includes(step.type))
      return `Step "${step.id}" has invalid type "${step.type}" (must be one of ${VALID_STEP_TYPES.join(", ")})`;
    if (step.type === "action" && !VALID_PROVIDERS.includes(step.provider))
      return `Step "${step.id}" has invalid provider "${step.provider}" (must be one of ${VALID_PROVIDERS.join(", ")})`;
    const refs = [
      step.next,
      step.type === "condition" ? step.whenTrue : undefined,
      step.type === "condition" ? step.whenFalse : undefined,
      step.type === "approval" ? step.onReject : undefined,
      step.type === "verify" ? step.onFailure : undefined,
    ].filter(Boolean);
    for (const ref of refs)
      if (!ids.has(ref))
        return `Step "${step.id}" references missing step "${ref}"`;
  }
  return null;
};
const generateWorkflowFromSop = async (sop, tenantId) => {
  const system =
    'You design AmazFlow workflow definitions as JSON. A workflow has: id, tenantId, name, description, version, status, dataClass, assignedRoles (array of FRONTLINE/CLIENT_ADMIN/SUPER_ADMIN), startAt, allowedProviders, steps. Each step has a unique id, name, and type: "ai" (operation, prompt, outputKey, allowedValues?, confidenceThreshold?, next), "condition" (path, operator: equals|notEquals|exists|gt|lt, value, whenTrue, whenFalse), "approval" (message, roles, next, onReject?), "action" (provider: browser|api|spreadsheet|email|file|mock -- ONLY these six exact strings, never invent another provider name, next), "verify" (path, operator, value, next, onFailure?), or "end" (outcome: success|failed). Every step id referenced by next/whenTrue/whenFalse/onReject/onFailure must exist in steps, and every path traced from startAt must reach an end step. Put a human approval step before any high-impact action (access changes, financial actions, deletions, anything hard to undo). Return ONLY the JSON object -- no prose, no markdown fences.';
  const basePrompt = `Design a workflow for this standard operating procedure:\n${sop}\n\nUse tenantId "${tenantId}". Set status to "draft". Use a short kebab-case id starting with "workflow-".`;
  if (useAgentCore()) {
    if (!executionHarnessArn)
      throw new Error("Managed workflow builder is not configured");
    const response = await agentCoreRuntime.invoke({
      harnessArn: executionHarnessArn,
      sessionId: `sop-${crypto.randomUUID()}`,
      prompt: basePrompt,
      systemPrompt: system,
      allowedTools: [],
      maxIterations: 1,
      maxTokens: 3000,
    });
    let draft;
    try {
      draft = JSON.parse(response.text);
    } catch {
      throw new Error("Managed workflow builder returned invalid JSON");
    }
    draft.tenantId = tenantId;
    draft.status = "draft";
    draft.version = 1;
    if (!draft.id) draft.id = `workflow-${Date.now().toString(36)}`;
    const shapeError = validateWorkflowShape(draft);
    if (shapeError)
      throw new Error(`Could not generate a valid workflow: ${shapeError}`);
    return draft;
  }
  assertLegacyEnabled();
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nYour previous attempt was invalid: ${lastError}. Fix that specific problem and return the corrected JSON object.`;
    const out = await bedrock.send(
      new ConverseCommand({
        modelId: process.env.BEDROCK_MODEL_ID,
        system: [{ text: system }],
        messages: [{ role: "user", content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 3000, temperature: 0.2 },
      }),
    );
    let text = out.output?.message?.content?.find((x) => x.text)?.text || "{}";
    text = text.replace(/^```json\s*|\s*```$/g, "").trim();
    let draft;
    try {
      draft = JSON.parse(text);
    } catch {
      lastError = "Response was not valid JSON";
      continue;
    }
    draft.tenantId = tenantId;
    draft.status = "draft";
    draft.version = 1;
    if (!draft.id) draft.id = `workflow-${Date.now().toString(36)}`;
    const shapeError = validateWorkflowShape(draft);
    if (!shapeError) return draft;
    lastError = shapeError;
  }
  throw new Error(`Could not generate a valid workflow: ${lastError}`);
};
const valueAt = (obj, path) => {
  const keys = String(path || "").split(".");
  const read = (root) => keys.reduce((v, k) => v?.[k], root);
  const direct = read(obj);
  return direct === undefined ? read(obj?.values) : direct;
};
const test = (left, op, right) =>
  op === "equals"
    ? left === right
    : op === "notEquals"
      ? left !== right
      : op === "exists"
        ? left !== undefined
        : op === "gt"
          ? left > right
          : op === "lt"
            ? left < right
            : false;
// Resolves {{dotted.path}} placeholders in a step's input against the run's own
// context (customer's original request plus whatever earlier AI/condition steps have
// extracted) before it's ever sent to a browser agent. Without this, an action step's
// input is the same static object no matter what the customer actually asked for or
// what an earlier step observed -- which is also what would make a real strong-
// identifier check (see SET_EMPLOYEE_STATUS in the agent) impossible, since there'd be
// no way to carry a specific record's id from the request into the task the agent runs.
const interpolate = (value, context) => {
  if (typeof value === "string")
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
      const resolved = valueAt(context, path);
      return resolved === undefined ? "" : String(resolved);
    });
  if (Array.isArray(value)) return value.map((v) => interpolate(v, context));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = interpolate(value[k], context);
    return out;
  }
  return value;
};
const scanType = async (type, a) => {
  if (a.role === "SUPER_ADMIN") {
    // Cross-tenant SUPER_ADMIN reads still Scan: there's no cross-tenant GSI yet.
    // Accepted tradeoff at current scale -- add a GSI if the operator's own views get slow.
    const out = await db.send(new ScanCommand({ TableName: table }));
    return (out.Items || [])
      .filter((i) => i.sk?.S?.startsWith(type) && i.document?.S)
      .map(parse);
  }
  const out = await db.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": { S: `TENANT#${a.tenantId}` },
        ":prefix": { S: type },
      },
    }),
  );
  return (out.Items || []).filter((i) => i.document?.S).map(parse);
};
const save = async (type, doc) =>
  db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: `TENANT#${doc.tenantId}` },
        sk: { S: `${type}#${doc.id}` },
        tenantId: { S: doc.tenantId },
        document: { S: JSON.stringify(doc) },
        updatedAt: { S: now() },
      },
    }),
  );
// Organizations (customer tenants) live in a shared PLATFORM partition rather than a
// TENANT# partition, since listing them is a platform-level (SUPER_ADMIN) operation
// across all customers, not a single tenant's own data.
const slugify = (name) =>
  String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
const listOrganizations = async () => {
  const out = await db.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": { S: "PLATFORM" },
        ":prefix": { S: "ORG#" },
      },
    }),
  );
  return (out.Items || []).filter((i) => i.document?.S).map(parse);
};
const getOrganization = async (slug) => {
  const out = await db.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "pk = :pk AND sk = :sk",
      ExpressionAttributeValues: {
        ":pk": { S: "PLATFORM" },
        ":sk": { S: `ORG#${slug}` },
      },
    }),
  );
  const item = (out.Items || [])[0];
  return item && item.document?.S ? parse(item) : null;
};
const saveOrganization = async (org) =>
  db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: "PLATFORM" },
        sk: { S: `ORG#${org.slug}` },
        document: { S: JSON.stringify(org) },
        updatedAt: { S: now() },
      },
    }),
  );
// Browser Agent authorization: replaces the DevTools-token-copy flow. A human (signed
// in with a real Cognito JWT) creates the agent record and a short-lived one-time code
// via POST /agent-authorizations; the extension itself never sees that JWT. It opens a
// browser tab to /agent-authorize, and once the human approves, the extension picks up
// the resulting code from the tab URL and exchanges it (POST .../exchange, no auth
// required for that one call, same as how an OAuth authorization code works) for an
// opaque, hashed-at-rest, agent-scoped, tenant-scoped, revocable bearer token -- never
// a copy of anyone's real session. Codes and credentials live in the flat PLATFORM
// partition (like Organizations) since a bare code/token string carries no tenant
// context until looked up.
const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");
const createAgentAndCode = async (
  tenantId,
  name,
  allowedDomains,
  createdBy,
  userRole,
) => {
  const agent = {
    id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId,
    name,
    allowedDomains: Array.isArray(allowedDomains) ? allowedDomains : [],
    status: "active",
    createdBy,
    createdAt: now(),
    updatedAt: now(),
    lastSeenAt: null,
    version: null,
  };
  await save("AGENT", agent);
  const code = crypto.randomBytes(24).toString("hex");
  const settings = await getSettings();
  const codeDoc = {
    code,
    agentId: agent.id,
    tenantId,
    userId: createdBy,
    userRole,
    status: "PENDING",
    createdAt: now(),
    expiresAt: new Date(Date.now() + settings.agentCodeExpiryMs).toISOString(),
  };
  await db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: "PLATFORM" },
        sk: { S: `AGENTCODE#${code}` },
        document: { S: JSON.stringify(codeDoc) },
        updatedAt: { S: now() },
      },
    }),
  );
  return { agent, code };
};
const exchangeAgentCode = async (code) => {
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: { pk: { S: "PLATFORM" }, sk: { S: `AGENTCODE#${code}` } },
    }),
  );
  if (!out.Item || !out.Item.document?.S)
    throw { status: 404, message: "Invalid or expired authorization code" };
  const codeDoc = JSON.parse(out.Item.document.S);
  if (codeDoc.status !== "PENDING")
    throw { status: 409, message: "This code has already been used" };
  if (new Date(codeDoc.expiresAt).getTime() < Date.now())
    throw { status: 409, message: "This code has expired" };
  codeDoc.status = "USED";
  await db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: "PLATFORM" },
        sk: { S: `AGENTCODE#${code}` },
        document: { S: JSON.stringify(codeDoc) },
        updatedAt: { S: now() },
      },
    }),
  );
  const token = crypto.randomBytes(32).toString("hex");
  const cred = {
    agentId: codeDoc.agentId,
    tenantId: codeDoc.tenantId,
    userId: codeDoc.userId,
    userRole: codeDoc.userRole,
    createdAt: now(),
    status: "active",
  };
  await db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: "PLATFORM" },
        sk: { S: `AGENTCRED#${hashToken(token)}` },
        document: { S: JSON.stringify(cred) },
        updatedAt: { S: now() },
      },
    }),
  );
  const agentOut = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: {
        pk: { S: `TENANT#${codeDoc.tenantId}` },
        sk: { S: `AGENT#${codeDoc.agentId}` },
      },
    }),
  );
  const agentName =
    agentOut.Item && agentOut.Item.document?.S
      ? JSON.parse(agentOut.Item.document.S).name
      : null;
  return {
    token,
    agentId: codeDoc.agentId,
    agentName,
    tenantId: codeDoc.tenantId,
    userId: codeDoc.userId,
    userRole: codeDoc.userRole,
  };
};
// Validates the extension's own bearer token (never a Cognito JWT) for the /agent/*
// routes, which run with AuthorizationType NONE at the gateway for exactly this reason.
const agentAuth = async (e) => {
  const token =
    e.headers?.["x-amazflow-agent-token"] ||
    e.headers?.["X-AmazFlow-Agent-Token"];
  if (!token) throw { status: 401, message: "Missing agent token" };
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: {
        pk: { S: "PLATFORM" },
        sk: { S: `AGENTCRED#${hashToken(token)}` },
      },
    }),
  );
  if (!out.Item || !out.Item.document?.S)
    throw { status: 401, message: "Invalid agent token" };
  const cred = JSON.parse(out.Item.document.S);
  if (cred.status !== "active")
    throw { status: 401, message: "This agent credential has been revoked" };
  const agentOut = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: {
        pk: { S: `TENANT#${cred.tenantId}` },
        sk: { S: `AGENT#${cred.agentId}` },
      },
    }),
  );
  if (!agentOut.Item || !agentOut.Item.document?.S)
    throw { status: 401, message: "Agent not found" };
  const agent = JSON.parse(agentOut.Item.document.S);
  if (agent.status !== "active")
    throw { status: 401, message: "This agent has been revoked" };
  if (!cred.userRole)
    throw {
      status: 401,
      message:
        "This agent was authorized before per-user scoping. Reconnect it from the AmazFlow console.",
    };
  return {
    agentId: cred.agentId,
    tenantId: cred.tenantId,
    userId: cred.userId,
    userRole: cred.userRole,
    agent,
  };
};
// Server-side authorization for agent-delivered work. The extension also filters, but
// that is a convenience only -- the agent token lives in the browser, so anything not
// enforced here is not enforced at all. Mirrors the same rules the human-facing routes
// use: super admins see the whole tenant, other roles only see work for workflows
// assigned to their role, and FRONTLINE additionally only sees runs they started.
const agentMayRunTask = (task, ctx) => {
  if (task.tenantId !== ctx.tenantId) return false;
  if (ctx.userRole === "SUPER_ADMIN") return true;
  const assigned = Array.isArray(task.assignedRoles) ? task.assignedRoles : [];
  if (!assigned.includes(ctx.userRole)) return false;
  if (
    ctx.userRole === "FRONTLINE" &&
    task.createdBy &&
    task.createdBy !== ctx.userId
  )
    return false;
  return true;
};
// A task lease. Without one, every connected agent in a tenant polls the same PENDING list and
// acts on the first entry, so two open browsers both perform the same action and the loser only
// finds out when its result is rejected -- after the side effect has happened twice. Claiming is
// a conditional single-winner write on its own lock item, and the lock self-heals: a lease past
// its expiry can be taken over, so an agent that dies mid-step does not strand the run.
const GRANT_TTL_SECONDS = 300;
const acquireTaskLease = async (taskId, agentId, leaseExpiresAtMs) => {
  try {
    await db.send(
      new PutItemCommand({
        TableName: table,
        Item: {
          pk: { S: "TASKCLAIM" },
          sk: { S: `TASKCLAIM#${taskId}` },
          document: { S: JSON.stringify({ taskId, agentId, claimedAt: now() }) },
          leaseExpiresAtMs: { N: String(leaseExpiresAtMs) },
          updatedAt: { S: now() },
          ttl: { N: String(Math.floor(leaseExpiresAtMs / 1000) + 86400) },
        },
        ConditionExpression:
          "attribute_not_exists(pk) OR leaseExpiresAtMs < :nowMs",
        ExpressionAttributeValues: { ":nowMs": { N: String(Date.now()) } },
      }),
    );
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException")
      throw { status: 409, message: "Another agent is already running this task" };
    throw err;
  }
};
// The only place a browser-path execution grant is minted. The agent's bearer token proves which
// agent is calling; it is deliberately NOT what authorizes the action, because that token lives
// in a browser profile and is long-lived. The grant is: bound to this exact run, workflow
// version and step, naming the two tools the agent may call, single-use per tool, minutes-lived.
// Everything it asserts is re-checked on the way back in against records loaded from the
// database, never against anything the agent echoes back.
const claimAgentTask = async (taskId, agentCtx) => {
  if (!executionGrants)
    throw { status: 503, message: "Execution grants are not configured" };
  const allTasks = await scanType("TASK#", { role: "SUPER_ADMIN" });
  const task = allTasks.find((t) => t.id === taskId);
  if (!task || !agentMayRunTask(task, agentCtx))
    throw { status: 404, message: "Task not found" };
  if (!ALLOWED_AGENT_OPS.has(task.operation))
    throw {
      status: 400,
      message: "Operation is not in the allowed agent operation set",
    };
  if (new Date(task.expiresAt).getTime() < Date.now())
    throw { status: 409, message: "This task has expired" };
  if (
    task.status === "CLAIMED" &&
    task.claimExpiresAt &&
    new Date(task.claimExpiresAt).getTime() >= Date.now()
  )
    throw { status: 409, message: "Another agent is already running this task" };
  if (task.status !== "PENDING" && task.status !== "CLAIMED")
    throw { status: 409, message: "Task already resolved" };
  const allRuns = await scanType("RUN#", { role: "SUPER_ADMIN" });
  const run = allRuns.find((r) => r.id === task.runId);
  if (
    !run ||
    run.status !== "WAITING_AGENT" ||
    run.currentStepId !== task.stepId
  )
    throw { status: 409, message: "Run is not waiting for this task" };
  const workflow = await getWorkflowVersion(
    run.tenantId,
    run.workflowId,
    run.workflowVersion,
  );
  if (!workflow) throw { status: 400, message: "Workflow not found for run" };
  const step = (workflow.steps || []).find((s) => s.id === task.stepId);
  if (!step)
    throw {
      status: 409,
      message:
        "Step is no longer part of the workflow version this run started on",
    };
  const leaseExpiresAtMs = Date.now() + GRANT_TTL_SECONDS * 1000;
  await acquireTaskLease(task.id, agentCtx.agentId, leaseExpiresAtMs);
  const grant = executionGrants.issue({
    runId: run.id,
    tenantId: run.tenantId,
    workflowId: run.workflowId,
    workflowVersion: run.workflowVersion,
    stepId: task.stepId,
    allowedTools: ["record_step_result", "agent.report_result"],
    confirmationGranted:
      step.requiresConfirmation !== true ||
      (run.confirmedStepIds || []).includes(task.stepId),
  });
  const grantId = JSON.parse(
    Buffer.from(grant.split(".")[1], "base64url").toString("utf8"),
  ).grantId;
  task.status = "CLAIMED";
  task.claimedBy = agentCtx.agentId;
  task.claimedAt = now();
  task.claimExpiresAt = new Date(leaseExpiresAtMs).toISOString();
  task.grantId = grantId;
  await save("TASK", task);
  const auditStartIdx = run.audit.length;
  run.audit.push({
    id: `aud_${run.audit.length + 1}`,
    at: now(),
    type: "AGENT_TASK_CLAIMED",
    stepId: task.stepId,
    message: `Browser agent claimed ${task.operation} for ${task.stepId}`,
    details: {
      taskId: task.id,
      agentId: agentCtx.agentId,
      grantId,
      expiresAt: task.claimExpiresAt,
    },
  });
  run.updatedAt = now();
  await saveRunWithAudit(run, auditStartIdx);
  return {
    task,
    grant,
    grantId,
    runId: run.id,
    stepId: task.stepId,
    workflowId: run.workflowId,
    claimExpiresAt: task.claimExpiresAt,
    verify: step.verify || null,
  };
};
// Identity and scope come entirely from the verified grant, never from anything the caller
// claims in the body. Deliberately non-destructive: it appends progress to the run's own audit
// trail rather than advancing run state, which stays owned by the engine.
const recordStepResult = async (grantToken, body) => {
  if (!executionGrants)
    throw { status: 503, message: "Execution grants are not configured" };
  const stepId = String(body.stepId || "");
  const status = ["IN_PROGRESS", "SUCCEEDED", "FAILED"].includes(body.status)
    ? body.status
    : null;
  if (!stepId || !status)
    throw {
      status: 400,
      message:
        "stepId and a valid status (IN_PROGRESS, SUCCEEDED, or FAILED) are required",
    };
  let payload;
  try {
    payload = await executionGrants.verify(
      String(grantToken || ""),
      { stepId, tool: "record_step_result" },
      grantReplayStore("record_step_result"),
    );
  } catch (err) {
    throw { status: 403, message: err?.message || "Invalid execution grant" };
  }
  const allRuns = await scanType("RUN#", { role: "SUPER_ADMIN" });
  const run = allRuns.find((r) => r.id === payload.runId);
  if (!run)
    throw { status: 404, message: "Run not found for this execution grant" };
  if (
    run.tenantId !== payload.tenantId ||
    run.workflowId !== payload.workflowId ||
    run.workflowVersion !== payload.workflowVersion
  )
    throw { status: 409, message: "Run no longer matches the execution grant" };
  const note =
    typeof body.note === "string" ? body.note.slice(0, 2000) : undefined;
  const auditStartIdx = run.audit.length;
  run.audit.push({
    id: `aud_${run.audit.length + 1}`,
    at: now(),
    type: "EXECUTOR_PROGRESS",
    stepId,
    message: `AmazFlow Executor reported ${status} for ${stepId}`,
    details: { status, note, grantId: payload.grantId },
  });
  run.updatedAt = now();
  await saveRunWithAudit(run, auditStartIdx);
  return { ok: true, runId: run.id, stepId, status, recordedAt: now() };
};
const touchAgentHeartbeat = async (agentId, tenantId, version) => {
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: { pk: { S: `TENANT#${tenantId}` }, sk: { S: `AGENT#${agentId}` } },
    }),
  );
  if (!out.Item || !out.Item.document?.S) return;
  const agent = JSON.parse(out.Item.document.S);
  agent.lastSeenAt = now();
  if (version) agent.version = version;
  await save("AGENT", agent);
};
const revokeAgent = async (agentId, a) => {
  const allAgents = await scanType("AGENT#", { role: "SUPER_ADMIN" });
  const agent = allAgents.find((x) => x.id === agentId);
  if (!agent) throw { status: 404, message: "Agent not found" };
  if (a.role !== "SUPER_ADMIN" && agent.tenantId !== a.tenantId)
    throw { status: 403, message: "Agent belongs to another tenant" };
  agent.status = "revoked";
  agent.updatedAt = now();
  await save("AGENT", agent);
  await logActivity(agent.tenantId, {
    actor: a.userId,
    actorLabel:
      a.role === "SUPER_ADMIN" ? "AmazFlow super admin" : "Team admin",
    action: "AGENT_REVOKED",
    summary: `Revoked agent "${agent.name}"`,
  });
  return agent;
};
// Every run mutation is committed together with the new audit rows it produced in one
// TransactWriteItems call, so a partial failure never leaves the run's status out of
// sync with its own evidence trail. auditStartIdx is the length run.audit had the last
// time it was durably saved (or 0 for a brand-new run) -- callers capture this right
// after loading the run, before pushing any new entries, and pass it through advance().
const saveRunWithAudit = async (run, auditStartIdx) => {
  const newEntries = run.audit.slice(auditStartIdx || 0);
  const items = [
    {
      Put: {
        TableName: table,
        Item: {
          pk: { S: `TENANT#${run.tenantId}` },
          sk: { S: `RUN#${run.id}` },
          tenantId: { S: run.tenantId },
          document: { S: JSON.stringify(run) },
          updatedAt: { S: now() },
        },
      },
    },
  ];
  newEntries.slice(0, 90).forEach((entry, i) => {
    const seq = String((auditStartIdx || 0) + i).padStart(6, "0");
    items.push({
      Put: {
        TableName: table,
        Item: {
          pk: { S: `TENANT#${run.tenantId}` },
          sk: { S: `AUDIT#${run.id}#${seq}` },
          tenantId: { S: run.tenantId },
          document: { S: JSON.stringify({ ...entry, runId: run.id }) },
          updatedAt: { S: now() },
        },
      },
    });
  });
  await db.send(new TransactWriteItemsCommand({ TransactItems: items }));
};
// Runs snapshot the workflow version they started with (workflowVersion) so that a
// resumed run (after an approval, agent result, or confirmation) keeps executing the
// exact version it began on, even if a SUPER_ADMIN has since edited and republished the
// workflow. Falls back to the current WORKFLOW# doc for runs created before version
// history existed.
const getWorkflowVersion = async (tenantId, workflowId, version) => {
  if (version) {
    const paddedV = String(version).padStart(6, "0");
    const out = await db.send(
      new GetItemCommand({
        TableName: table,
        Key: {
          pk: { S: `TENANT#${tenantId}` },
          sk: { S: `WORKFLOWVERSION#${workflowId}_v${paddedV}` },
        },
      }),
    );
    if (out.Item && out.Item.document?.S) return parse(out.Item);
  }
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: {
        pk: { S: `TENANT#${tenantId}` },
        sk: { S: `WORKFLOW#${workflowId}` },
      },
    }),
  );
  return out.Item && out.Item.document?.S ? parse(out.Item) : null;
};
const ALLOWED_AGENT_OPS = new Set([
  "READ_TEXT",
  "CLICK",
  "TYPE",
  "SELECT",
  "CHECK",
  "SCROLL_TO",
  "WAIT_FOR",
  "VERIFY_TEXT",
  "SET_EMPLOYEE_STATUS",
]);
const advance = async (workflow, run, auditStartIdx) => {
  const settings = await getSettings();
  const audit = (type, message, stepId, details) =>
    run.audit.push({
      id: `aud_${run.audit.length + 1}`,
      at: now(),
      type,
      message,
      stepId,
      details,
    });
  let next = run.currentStepId;
  for (let guard = 0; guard < 30 && next; guard++) {
    const step = workflow.steps.find((s) => s.id === next);
    if (!step) throw new Error(`Missing step ${next}`);
    // Action steps default to NOT requiring a separate confirmation gate, so existing
    // workflows keep behaving exactly as before -- a workflow author opts a specific
    // action step into the gate with requiresConfirmation:true.
    if (
      step.type === "action" &&
      step.requiresConfirmation === true &&
      !(run.confirmedStepIds || []).includes(step.id)
    ) {
      run.status = "AWAITING_CONFIRMATION";
      run.currentStepId = step.id;
      const confirmation = {
        id: `conf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        tenantId: run.tenantId,
        kind: "ACTION_GATE",
        runId: run.id,
        stepId: step.id,
        summary: {
          provider: step.provider,
          operation: step.operation,
          name: step.name,
        },
        status: "PENDING",
        createdAt: now(),
        expiresAt: new Date(
          Date.now() + settings.confirmationExpiryMs,
        ).toISOString(),
      };
      await save("CONFIRMATION", confirmation);
      run.pendingConfirmationId = confirmation.id;
      audit("CONFIRMATION_REQUIRED", `Confirm before: ${step.name}`, step.id, {
        confirmationId: confirmation.id,
      });
      break;
    }
    audit("STEP_STARTED", step.name, step.id);
    if (step.type === "ai") {
      const out = await ai(
        step,
        { input: run.context.input, ...run.context.values },
        run,
      );
      run.context.values[step.outputKey] = out.result;
      if (out.metadata) {
        run.executionBackend = out.metadata.executionBackend;
        run.agentSessionId = out.metadata.agentSessionId || run.agentSessionId;
        run.traceId = out.metadata.traceId || run.traceId;
      }
      audit(
        "AI_COMPLETED",
        "AmazFlow managed AI returned a bounded result",
        step.id,
        { usage: out.usage, traceId: out.metadata?.traceId },
      );
      next = step.next;
    } else if (step.type === "condition") {
      next = test(valueAt(run.context, step.path), step.operator, step.value)
        ? step.whenTrue
        : step.whenFalse;
      audit("CONDITION_EVALUATED", `Condition routed to ${next}`, step.id);
    } else if (step.type === "approval") {
      run.status = "WAITING_APPROVAL";
      run.currentStepId = step.id;
      audit("APPROVAL_REQUIRED", step.message, step.id, { roles: step.roles });
      break;
    } else if (step.type === "action") {
      run.stepResults = run.stepResults || {};
      if (step.provider === "mock") {
        const result = {
          ok: true,
          provider: step.provider,
          operation: step.operation,
          simulated: true,
          status: step.input?.status || "COMPLETED",
        };
        run.context.lastAction = { result };
        run.stepResults[step.id] = {
          stepId: step.id,
          type: "action",
          provider: step.provider,
          operation: step.operation,
          status: "SUCCEEDED",
          resolvedAt: now(),
          actionResult: { ok: true, body: result },
        };
        audit(
          "ACTION_COMPLETED",
          `${step.provider} action completed`,
          step.id,
          result,
        );
        next = step.next;
      } else if (
        step.provider === "browser" &&
        useAgentCore() &&
        step.browserMode !== "connected" &&
        step.connectionId
      ) {
        const connection = await getBrowserConnection(
          run.tenantId,
          step.connectionId,
        );
        if (!connection || connection.status !== "active") {
          if (step.browserMode === "managed") {
            run.status = "FAILED";
            next = step.onFailure;
            audit(
              "ACTION_FAILED",
              "Managed browser connection is unavailable",
              step.id,
              { connectionId: step.connectionId },
            );
            if (next) run.status = "RUNNING";
          } else {
            const task = {
              id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              runId: run.id,
              tenantId: run.tenantId,
              stepId: step.id,
              provider: step.provider,
              operation: step.operation,
              input: interpolate(step.input || {}, run.context),
              expiresAt: new Date(
                Date.now() + settings.taskExpiryMs,
              ).toISOString(),
              status: "PENDING",
              workflowId: workflow.id,
              assignedRoles: workflow.assignedRoles || [],
              createdBy: run.createdBy,
            };
            await save("TASK", task);
            run.status = "WAITING_AGENT";
            run.currentStepId = step.id;
            audit(
              "MANAGED_EXECUTION_FALLBACK",
              "Managed browser was unavailable before acting; offered to a connected browser",
              step.id,
              { taskId: task.id, connectionId: step.connectionId },
            );
            break;
          }
        } else {
          if (!agentCoreActions || !executionGrants)
            throw new Error("Managed action execution is not fully configured");
          const executionGrant = executionGrants.issue({
            runId: run.id,
            tenantId: run.tenantId,
            workflowId: workflow.id,
            workflowVersion: run.workflowVersion,
            stepId: step.id,
            allowedTools: ["browser.execute"],
            confirmationGranted:
              step.requiresConfirmation !== true ||
              (run.confirmedStepIds || []).includes(step.id),
          });
          const outcome = await agentCoreActions.execute({
            workflow,
            run,
            step,
            input: {
              ...interpolate(step.input || {}, run.context),
              connection: {
                id: connection.id,
                baseUrl: connection.baseUrl,
                allowedOrigins: connection.allowedOrigins,
                profileId: connection.managedProfileId,
                path: step.path,
              },
            },
            executionGrant,
          });
          if (outcome.metadata) {
            run.executionBackend = "agentcore";
            run.agentSessionId =
              outcome.metadata.agentSessionId || run.agentSessionId;
            run.browserSessionId =
              outcome.metadata.browserSessionId || run.browserSessionId;
            run.traceId = outcome.metadata.traceId || run.traceId;
          }
          if (
            outcome.status === "FALLBACK" &&
            !outcome.sideEffectObserved &&
            step.browserMode !== "managed"
          ) {
            const task = {
              id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              runId: run.id,
              tenantId: run.tenantId,
              stepId: step.id,
              provider: step.provider,
              operation: step.operation,
              input: interpolate(step.input || {}, run.context),
              expiresAt: new Date(
                Date.now() + settings.taskExpiryMs,
              ).toISOString(),
              status: "PENDING",
              workflowId: workflow.id,
              assignedRoles: workflow.assignedRoles || [],
              createdBy: run.createdBy,
            };
            await save("TASK", task);
            run.status = "WAITING_AGENT";
            run.currentStepId = step.id;
            audit(
              "MANAGED_EXECUTION_FALLBACK",
              outcome.error ||
                "Managed browser requested fallback before acting",
              step.id,
              { taskId: task.id, traceId: outcome.metadata?.traceId },
            );
            break;
          }
          let ok = outcome.status === "SUCCEEDED";
          const result = {
            ok,
            ...(outcome.result || {}),
            error: outcome.error,
          };
          const independentlyVerified =
            !ok ||
            !step.verify ||
            test(
              valueAt({ result }, step.verify.path),
              "equals",
              step.verify.equals,
            );
          if (ok && !independentlyVerified) {
            ok = false;
            result.ok = false;
            result.error = "Independent action verification failed";
          }
          run.context.lastAction = { result };
          run.stepResults[step.id] = {
            stepId: step.id,
            type: "action",
            provider: step.provider,
            operation: step.operation,
            status: ok ? "SUCCEEDED" : "FAILED",
            resolvedAt: now(),
            actionResult: result,
          };
          audit(
            ok
              ? "ACTION_COMPLETED"
              : !independentlyVerified
                ? "VERIFICATION_FAILED"
                : outcome.sideEffectObserved
                  ? "ACTION_RECONCILIATION_REQUIRED"
                  : "ACTION_FAILED",
            ok
              ? "Managed browser action completed"
              : !independentlyVerified
                ? "Independent action verification failed"
                : outcome.error || "Managed browser action failed",
            step.id,
            {
              traceId: outcome.metadata?.traceId,
              sideEffectObserved: !!outcome.sideEffectObserved,
              expected: step.verify?.equals,
              actual: step.verify
                ? valueAt({ result }, step.verify.path)
                : undefined,
            },
          );
          if (ok) next = step.next;
          else if (step.onFailure) next = step.onFailure;
          else {
            run.status = "FAILED";
            next = undefined;
          }
        }
      } else if (step.provider === "api" && useAgentCore()) {
        if (!agentCoreActions || !executionGrants)
          throw new Error("Managed action execution is not fully configured");
        const cfg = step.input || {};
        if (!cfg.url || isUnsafeUrl(cfg.url))
          throw new Error(
            `Action step ${step.id} has an invalid or unsafe url`,
          );
        const executionGrant = executionGrants.issue({
          runId: run.id,
          tenantId: run.tenantId,
          workflowId: workflow.id,
          workflowVersion: run.workflowVersion,
          stepId: step.id,
          allowedTools: ["api.execute"],
          confirmationGranted:
            step.requiresConfirmation !== true ||
            (run.confirmedStepIds || []).includes(step.id),
        });
        const outcome = await agentCoreActions.execute({
          workflow,
          run,
          step,
          input: interpolate(step.input || {}, run.context),
          executionGrant,
        });
        if (outcome.metadata) {
          run.executionBackend = "agentcore";
          run.agentSessionId =
            outcome.metadata.agentSessionId || run.agentSessionId;
          run.traceId = outcome.metadata.traceId || run.traceId;
        }
        let ok = outcome.status === "SUCCEEDED";
        const apiResult = {
          ok,
          ...(outcome.result || {}),
          error: outcome.error,
        };
        const independentlyVerified =
          !ok ||
          !step.verify ||
          test(
            valueAt({ result: apiResult }, step.verify.path),
            "equals",
            step.verify.equals,
          );
        if (ok && !independentlyVerified) {
          ok = false;
          apiResult.ok = false;
          apiResult.error = "Independent action verification failed";
        }
        run.context.lastAction = { result: apiResult };
        run.stepResults[step.id] = {
          stepId: step.id,
          type: "action",
          provider: step.provider,
          operation: step.operation,
          status: ok ? "SUCCEEDED" : "FAILED",
          resolvedAt: now(),
          actionResult: apiResult,
        };
        audit(
          ok
            ? "ACTION_COMPLETED"
            : !independentlyVerified
              ? "VERIFICATION_FAILED"
              : outcome.sideEffectObserved
                ? "ACTION_RECONCILIATION_REQUIRED"
                : "ACTION_FAILED",
          ok
            ? "Managed API action completed"
            : !independentlyVerified
              ? "Independent action verification failed"
              : outcome.error || "Managed API action failed",
          step.id,
          {
            traceId: outcome.metadata?.traceId,
            sideEffectObserved: !!outcome.sideEffectObserved,
            expected: step.verify?.equals,
            actual: step.verify
              ? valueAt({ result: apiResult }, step.verify.path)
              : undefined,
          },
        );
        if (ok) next = step.next;
        else if (step.onFailure) next = step.onFailure;
        else {
          run.status = "FAILED";
          next = undefined;
        }
      } else if (step.provider === "api") {
        // Disabled rollback path. Remove this direct executor and its model/runtime
        // permissions after the 14-day AgentCore recovery window.
        const cfg = step.input || {};
        if (!cfg.url || isUnsafeUrl(cfg.url))
          throw new Error(
            `Action step ${step.id} has an invalid or unsafe url`,
          );
        const method = (cfg.method || "POST").toUpperCase();
        let apiResult;
        try {
          const httpResponse = await fetch(cfg.url, {
            method,
            headers: {
              "content-type": "application/json",
              ...(cfg.headers || {}),
            },
            body:
              method === "GET" || method === "HEAD"
                ? undefined
                : JSON.stringify(cfg.body || {}),
          });
          const bodyText = await httpResponse.text();
          let parsedBody;
          try {
            parsedBody = JSON.parse(bodyText);
          } catch {
            parsedBody = bodyText;
          }
          apiResult = {
            ok: httpResponse.ok,
            status: httpResponse.status,
            body: parsedBody,
          };
        } catch (err) {
          apiResult = { ok: false, status: 0, error: err.message };
        }
        run.context.lastAction = { result: apiResult };
        run.stepResults[step.id] = {
          stepId: step.id,
          type: "action",
          provider: step.provider,
          operation: step.operation,
          status: apiResult.ok ? "SUCCEEDED" : "FAILED",
          resolvedAt: now(),
          actionResult: apiResult,
        };
        audit(
          apiResult.ok ? "ACTION_COMPLETED" : "ACTION_FAILED",
          `api action ${apiResult.ok ? "completed" : "failed"}`,
          step.id,
          { status: apiResult.status, ok: apiResult.ok },
        );
        // A failed action no longer silently advances to step.next -- it routes to the
        // step's own onFailure step if one is configured, or ends the run FAILED.
        if (apiResult.ok) {
          next = step.next;
        } else if (step.onFailure) {
          next = step.onFailure;
        } else {
          run.status = "FAILED";
          audit(
            "FAILED",
            "Action failed with no failure route configured",
            step.id,
          );
          next = undefined;
        }
      } else {
        const task = {
          id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          runId: run.id,
          tenantId: run.tenantId,
          stepId: step.id,
          provider: step.provider,
          operation: step.operation,
          input: interpolate(step.input || {}, run.context),
          expiresAt: new Date(Date.now() + settings.taskExpiryMs).toISOString(),
          status: "PENDING",
          workflowId: workflow.id,
          assignedRoles: workflow.assignedRoles || [],
          createdBy: run.createdBy,
        };
        await save("TASK", task);
        run.status = "WAITING_AGENT";
        run.currentStepId = step.id;
        audit(
          "AGENT_TASK_CREATED",
          `${step.provider}:${step.operation}`,
          step.id,
          { taskId: task.id },
        );
        break;
      }
    } else if (step.type === "verify") {
      const passed = test(
        valueAt(run.context, step.path),
        step.operator,
        step.value,
      );
      run.stepResults = run.stepResults || {};
      run.stepResults[step.id] = {
        stepId: step.id,
        type: "verify",
        status: passed ? "SUCCEEDED" : "FAILED",
        resolvedAt: now(),
        verificationResult: {
          passed,
          expected: step.value,
          actual: valueAt(run.context, step.path),
        },
      };
      audit(
        passed ? "VERIFIED" : "VERIFICATION_FAILED",
        passed ? "Expected state verified" : "Expected state not verified",
        step.id,
        { expected: step.value, actual: valueAt(run.context, step.path) },
      );
      next = passed ? step.next : step.onFailure;
    } else if (step.type === "end") {
      run.status = step.outcome === "success" ? "COMPLETED" : "FAILED";
      audit(run.status, step.name, step.id);
      next = undefined;
    }
    run.currentStepId = next;
    run.updatedAt = now();
  }
  await saveRunWithAudit(run, auditStartIdx);
  return run;
};
// The shared package owns every production graph transition. The large implementation
// above remains reachable only while the explicit 14-day legacy rollback switch is on.
const createProductionEngine = async (loadedRun) => {
  const settings = await getSettings();
  let auditCursor = loadedRun?.audit?.length || 0;
  const store = {
    getWorkflow: async () => undefined,
    getRun: async () => loadedRun,
    saveRun: async (run) => {
      await saveRunWithAudit(run, auditCursor);
      auditCursor = run.audit.length;
    },
    saveTask: async (task) => save("TASK", task),
    // Approval state is authoritative on the run. This hook deliberately avoids a
    // second mutable approval record that could drift from the run status.
    saveApproval: async () => undefined,
    saveConfirmation: async (confirmation) => save("CONFIRMATION", confirmation),
  };
  const actionExecutor = {
    execute: async (args) => {
      const { step, run } = args;
      if (!agentCoreActions)
        return {
          status: "FAILED",
          error: "Managed action execution is not configured",
          sideEffectObserved: false,
        };
      if (step.provider === "browser") {
        const connection = step.connectionId
          ? await getBrowserConnection(run.tenantId, step.connectionId)
          : null;
        if (
          !connection ||
          connection.status !== "active" ||
          !connection.managedProfileId
        ) {
          if (step.browserMode !== "managed") emitApplicationMetric("BrowserFallback");
          return {
            status: step.browserMode === "managed" ? "FAILED" : "FALLBACK",
            error: "Managed browser connection is unavailable before acting",
            sideEffectObserved: false,
          };
        }
        args.input = {
          ...args.input,
          connection: {
            id: connection.id,
            baseUrl: connection.baseUrl,
            allowedOrigins: connection.allowedOrigins,
            profileId: connection.managedProfileId,
            path: step.path,
          },
        };
      } else if (step.provider === "api") {
        if (!args.input.url || isUnsafeUrl(args.input.url))
          return {
            status: "FAILED",
            error: "Pinned API destination is invalid or unsafe",
            sideEffectObserved: false,
          };
      } else {
        return {
          status: "FALLBACK",
          error: "This provider requires a connected execution agent",
          sideEffectObserved: false,
        };
      }
      const outcome = await agentCoreActions.execute(args);
      if (step.provider === "browser" && outcome.status === "FALLBACK")
        emitApplicationMetric("BrowserFallback");
      return outcome;
    },
  };
  const grantIssuer = {
    issue: ({ workflow, run, step }) => {
      if (!executionGrants)
        throw new Error("Execution grants are not configured");
      return executionGrants.issue({
        runId: run.id,
        tenantId: run.tenantId,
        workflowId: workflow.id,
        workflowVersion: run.workflowVersion,
        stepId: step.id,
        allowedTools: [`${step.provider}.execute`],
        confirmationGranted:
          step.requiresConfirmation !== true ||
          (run.confirmedStepIds || []).includes(step.id),
      });
    },
  };
  return new WorkflowEngine(store, agentCoreAi, actionExecutor, grantIssuer, {
    taskExpiryMs: settings.taskExpiryMs,
    confirmationExpiryMs: settings.confirmationExpiryMs,
  });
};
const runWorkflow = async (workflow, input, a) => {
  if (useAgentCore()) {
    if (!agentCoreAi)
      throw new Error("Managed workflow execution is not configured");
    return (await createProductionEngine()).start(workflow, input, a);
  }
  assertLegacyEnabled();
  const run = {
    id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: workflow.tenantId,
    workflowId: workflow.id,
    workflowVersion: workflow.version || 1,
    status: "RUNNING",
    currentStepId: workflow.startAt,
    createdBy: a.userId,
    confirmedStepIds: [],
    stepResults: {},
    context: { input, values: {}, lastAction: null },
    audit: [
      {
        id: "aud_1",
        at: now(),
        type: "RUN_STARTED",
        message: "Workflow execution started",
        details: { actor: a.userId, role: a.role },
      },
    ],
    createdAt: now(),
    updatedAt: now(),
    executionBackend: useAgentCore() ? "agentcore" : "legacy",
  };
  return advance(workflow, run, 0);
};
// grantToken is required on the agent route and omitted for the operator's own
// /agent-tasks/{id}/result console route, which is already Cognito-authenticated and
// role-checked at the gateway.
const resumeAgentTask = async (taskId, result, a, grantToken) => {
  const allTasks = await scanType("TASK#", { role: "SUPER_ADMIN" });
  const task = allTasks.find((t) => t.id === taskId);
  if (!task) throw { status: 404, message: "Task not found" };
  if (a.role !== "SUPER_ADMIN" && task.tenantId !== a.tenantId)
    throw { status: 403, message: "Task belongs to another tenant" };
  if (task.status !== "PENDING" && task.status !== "CLAIMED")
    throw { status: 409, message: "Task already resolved" };
  if (new Date(task.expiresAt).getTime() < Date.now())
    throw {
      status: 409,
      message: "This task expired -- AmazFlow timed the run out already",
    };
  if (!result || typeof result.ok !== "boolean")
    throw { status: 400, message: 'Result must include an "ok" boolean' };
  if (!ALLOWED_AGENT_OPS.has(task.operation))
    throw {
      status: 400,
      message: "Operation is not in the allowed agent operation set",
    };
  const allRuns = await scanType("RUN#", { role: "SUPER_ADMIN" });
  const run = allRuns.find((r) => r.id === task.runId);
  if (
    !run ||
    run.status !== "WAITING_AGENT" ||
    run.currentStepId !== task.stepId
  )
    throw { status: 409, message: "Run is not waiting for this task" };
  const workflow = await getWorkflowVersion(
    run.tenantId,
    run.workflowId,
    run.workflowVersion,
  );
  if (!workflow) throw { status: 400, message: "Workflow not found for run" };
  // Every scope field is compared against the run and task just loaded from the database, and
  // the grant is consumed here -- so a result can be submitted exactly once, by the agent that
  // actually claimed this step, inside the lease window.
  let grantPayload;
  if (grantToken !== undefined) {
    if (!executionGrants)
      throw { status: 503, message: "Execution grants are not configured" };
    try {
      grantPayload = await executionGrants.verify(
        String(grantToken || ""),
        {
          runId: run.id,
          tenantId: run.tenantId,
          workflowId: run.workflowId,
          workflowVersion: run.workflowVersion,
          stepId: task.stepId,
          tool: "agent.report_result",
        },
        grantReplayStore("agent.report_result"),
      );
    } catch (err) {
      throw { status: 403, message: err?.message || "Invalid execution grant" };
    }
  }
  const evidence = {
    taskId: task.id,
    agentId: task.claimedBy || a.userId,
    grantId: grantPayload ? grantPayload.grantId : null,
    claimedAt: task.claimedAt || null,
    reportedAt: now(),
    page: result.evidence || null,
  };
  task.status = "COMPLETED";
  task.resolvedAt = now();
  await save("TASK", task);
  if (useAgentCore())
    return (await createProductionEngine(run)).resumeFromAgent(
      workflow,
      run,
      task.stepId,
      result,
      evidence,
    );
  assertLegacyEnabled();
  const auditStartIdx = run.audit.length;
  run.context.lastAction = { result };
  run.stepResults = run.stepResults || {};
  const step = workflow.steps.find((s) => s.id === task.stepId);
  if (!step)
    throw {
      status: 409,
      message:
        "Step is no longer part of the workflow version this run started on",
    };
  let ok = result.ok === true;
  const independentlyVerified =
    !ok ||
    !step.verify ||
    test(valueAt({ result }, step.verify.path), "equals", step.verify.equals);
  if (ok && !independentlyVerified) {
    ok = false;
    result.ok = false;
    result.error = "Independent action verification failed";
  }
  run.stepResults[task.stepId] = {
    stepId: task.stepId,
    type: "action",
    provider: task.provider,
    operation: task.operation,
    status: ok ? "SUCCEEDED" : "FAILED",
    resolvedAt: now(),
    actionResult: result,
    evidence: {
      ...evidence,
      verified: independentlyVerified,
      expected: step.verify ? step.verify.equals : undefined,
      actual: step.verify
        ? valueAt({ result }, step.verify.path)
        : undefined,
    },
  };
  run.audit.push({
    id: `aud_${run.audit.length + 1}`,
    at: now(),
    type: ok
      ? "AGENT_RESULT"
      : !independentlyVerified
        ? "VERIFICATION_FAILED"
        : "AGENT_RESULT_FAILED",
    stepId: task.stepId,
    message: ok
      ? `Agent completed ${task.stepId}`
      : !independentlyVerified
        ? `Agent reported success for ${task.stepId} but AmazFlow could not verify it`
        : `Agent reported failure for ${task.stepId}`,
    details: { ...result, grantId: evidence.grantId, agentId: evidence.agentId },
  });
  if (ok) {
    run.status = "RUNNING";
    run.currentStepId = step.next;
  } else if (step.onFailure) {
    run.status = "RUNNING";
    run.currentStepId = step.onFailure;
  } else {
    run.status = "FAILED";
    run.currentStepId = undefined;
    run.updatedAt = now();
    await saveRunWithAudit(run, auditStartIdx);
    return run;
  }
  return advance(workflow, run, auditStartIdx);
};
const resumeApproval = async (runId, stepId, approved, a) => {
  const allRuns = await scanType("RUN#", { role: "SUPER_ADMIN" });
  const run = allRuns.find((r) => r.id === runId);
  if (!run) throw { status: 404, message: "Run not found" };
  if (a.role !== "SUPER_ADMIN" && run.tenantId !== a.tenantId)
    throw { status: 403, message: "Run belongs to another tenant" };
  if (run.status !== "WAITING_APPROVAL" || run.currentStepId !== stepId)
    throw { status: 409, message: "Run is not waiting for this approval" };
  const workflow = await getWorkflowVersion(
    run.tenantId,
    run.workflowId,
    run.workflowVersion,
  );
  if (!workflow) throw { status: 400, message: "Workflow not found for run" };
  const step = workflow.steps.find((s) => s.id === stepId);
  if (!step || step.type !== "approval")
    throw { status: 400, message: "Step is not an approval step" };
  if (a.role !== "SUPER_ADMIN" && !(step.roles || []).includes(a.role))
    throw {
      status: 403,
      message: "Your role is not authorized to decide this approval",
    };
  if (useAgentCore())
    return (await createProductionEngine(run)).resumeFromApproval(
      workflow,
      run,
      stepId,
      approved,
      a,
    );
  assertLegacyEnabled();
  const auditStartIdx = run.audit.length;
  run.audit.push({
    id: `aud_${run.audit.length + 1}`,
    at: now(),
    type: approved ? "APPROVED" : "REJECTED",
    stepId,
    message: approved ? "Approval granted" : "Approval rejected",
    details: { by: a.userId, role: a.role },
  });
  run.status = "RUNNING";
  run.currentStepId = approved ? step.next : step.onReject;
  return advance(workflow, run, auditStartIdx);
};
const confirmActionGate = async (runId, stepId, a) => {
  const allRuns = await scanType("RUN#", { role: "SUPER_ADMIN" });
  const run = allRuns.find((r) => r.id === runId);
  if (!run) throw { status: 404, message: "Run not found" };
  if (a.role !== "SUPER_ADMIN" && run.tenantId !== a.tenantId)
    throw { status: 403, message: "Run belongs to another tenant" };
  if (run.status !== "AWAITING_CONFIRMATION" || run.currentStepId !== stepId)
    throw { status: 409, message: "Run is not waiting for this confirmation" };
  if (a.role === "FRONTLINE")
    throw {
      status: 403,
      message: "Only tenant admins confirm protected actions",
    };
  const workflow = await getWorkflowVersion(
    run.tenantId,
    run.workflowId,
    run.workflowVersion,
  );
  if (!workflow) throw { status: 400, message: "Workflow not found for run" };
  if (useAgentCore())
    return (await createProductionEngine(run)).resumeFromConfirmation(
      workflow,
      run,
      stepId,
      a,
    );
  assertLegacyEnabled();
  const auditStartIdx = run.audit.length;
  run.confirmedStepIds = [...(run.confirmedStepIds || []), stepId];
  run.status = "RUNNING";
  run.audit.push({
    id: `aud_${run.audit.length + 1}`,
    at: now(),
    type: "CONFIRMATION_GRANTED",
    stepId,
    message: `Confirmed by ${a.userId}`,
    details: { by: a.userId, role: a.role },
  });
  return advance(workflow, run, auditStartIdx);
};
const cancelRun = async (runId, a) => {
  const allRuns = await scanType("RUN#", { role: "SUPER_ADMIN" });
  const run = allRuns.find((r) => r.id === runId);
  if (!run) throw { status: 404, message: "Run not found" };
  if (a.role !== "SUPER_ADMIN" && run.tenantId !== a.tenantId)
    throw { status: 403, message: "Run belongs to another tenant" };
  if (a.role === "FRONTLINE" && run.createdBy !== a.userId)
    throw { status: 403, message: "You can only cancel your own runs" };
  const cancellable = [
    "RUNNING",
    "WAITING_APPROVAL",
    "WAITING_AGENT",
    "AWAITING_CONFIRMATION",
  ];
  if (!cancellable.includes(run.status))
    throw { status: 409, message: "This run can no longer be cancelled" };
  if (useAgentCore()) {
    const cancelled = await (await createProductionEngine(run)).cancel(run, a);
    const [tasks, confirmations] = await Promise.all([
      scanType("TASK#", { role: "SUPER_ADMIN" }),
      scanType("CONFIRMATION#", { role: "SUPER_ADMIN" }),
    ]);
    for (const item of [...tasks, ...confirmations]) {
      if (item.runId === runId && item.status === "PENDING") {
        item.status = "CANCELLED";
        await save(tasks.includes(item) ? "TASK" : "CONFIRMATION", item);
      }
    }
    return cancelled;
  }
  assertLegacyEnabled();
  const completedSteps = Object.keys(run.stepResults || {}).length;
  const auditStartIdx = run.audit.length;
  run.status = "CANCELLED";
  run.currentStepId = undefined;
  run.audit.push({
    id: `aud_${run.audit.length + 1}`,
    at: now(),
    type: "RUN_CANCEL_REQUESTED",
    message: "Cancellation requested",
    details: { by: a.userId, role: a.role },
  });
  run.audit.push({
    id: `aud_${run.audit.length + 1}`,
    at: now(),
    type: "RUN_CANCELLED",
    message: `Cancelled. ${completedSteps} step(s) completed before cancellation.`,
    details: { completedSteps },
  });
  run.updatedAt = now();
  await saveRunWithAudit(run, auditStartIdx);
  // A cancelled run's own state now blocks resumeAgentTask/resumeApproval from ever
  // applying an undispatched step -- but without this, the TASK#/CONFIRMATION# record
  // itself stays visibly PENDING until its own expiresAt, so an agent still polls it up
  // and a human still sees it queued for a run that's already over. Close both out
  // immediately so cancelled work stops being offered at all, not just stops being
  // honored if claimed.
  const [tasks, confirmations] = await Promise.all([
    scanType("TASK#", { role: "SUPER_ADMIN" }),
    scanType("CONFIRMATION#", { role: "SUPER_ADMIN" }),
  ]);
  for (const task of tasks) {
    if (task.runId === runId && task.status === "PENDING") {
      task.status = "CANCELLED";
      await save("TASK", task);
    }
  }
  for (const confirmation of confirmations) {
    if (confirmation.runId === runId && confirmation.status === "PENDING") {
      confirmation.status = "CANCELLED";
      await save("CONFIRMATION", confirmation);
    }
  }
  return run;
};
// Runs once a minute via an EventBridge schedule (see sweep branch in the handler).
// No cron/scheduled invocation existed before this -- WAITING_AGENT/AWAITING_CONFIRMATION
// runs could sit stuck indefinitely with an already-expired task, since expiresAt was
// previously only ever checked client-side by the Chrome extension.
const sweepExpired = async () => {
  const [tasks, confirmations] = await Promise.all([
    scanType("TASK#", { role: "SUPER_ADMIN" }),
    scanType("CONFIRMATION#", { role: "SUPER_ADMIN" }),
  ]);
  const nowMs = Date.now();
  // A CLAIMED task whose lease ran out but whose own deadline has not is returned to PENDING
  // rather than timed out -- the agent holding it went away (tab closed, browser quit, machine
  // slept) and another connected agent can still finish the step in the time that remains.
  const stalledClaims = tasks.filter(
    (t) =>
      t.status === "CLAIMED" &&
      t.claimExpiresAt &&
      new Date(t.claimExpiresAt).getTime() < nowMs &&
      t.expiresAt &&
      new Date(t.expiresAt).getTime() >= nowMs,
  );
  for (const task of stalledClaims) {
    task.status = "PENDING";
    task.claimedBy = null;
    task.claimedAt = null;
    task.claimExpiresAt = null;
    task.grantId = null;
    await save("TASK", task);
  }
  const expiredTasks = tasks.filter(
    (t) =>
      (t.status === "PENDING" || t.status === "CLAIMED") &&
      t.expiresAt &&
      new Date(t.expiresAt).getTime() < nowMs,
  );
  const expiredConfirmations = confirmations.filter(
    (c) =>
      c.status === "PENDING" &&
      c.expiresAt &&
      new Date(c.expiresAt).getTime() < nowMs,
  );
  const runIdsToTimeout = new Set([
    ...expiredTasks.map((t) => t.runId),
    ...expiredConfirmations.map((c) => c.runId).filter(Boolean),
  ]);
  for (const task of expiredTasks) {
    task.status = "EXPIRED";
    await save("TASK", task);
  }
  for (const confirmation of expiredConfirmations) {
    confirmation.status = "EXPIRED";
    await save("CONFIRMATION", confirmation);
  }
  let timedOutRuns = 0;
  if (runIdsToTimeout.size) {
    const allRuns = await scanType("RUN#", { role: "SUPER_ADMIN" });
    for (const run of allRuns) {
      if (!runIdsToTimeout.has(run.id)) continue;
      if (
        run.status !== "WAITING_AGENT" &&
        run.status !== "AWAITING_CONFIRMATION"
      )
        continue;
      if (useAgentCore()) {
        await (await createProductionEngine(run)).timeout(
          run,
          "AmazFlow could not reach the execution agent in time. No additional actions were taken.",
        );
        timedOutRuns++;
        continue;
      }
      assertLegacyEnabled();
      const auditStartIdx = run.audit.length;
      run.status = "TIMED_OUT";
      run.audit.push({
        id: `aud_${run.audit.length + 1}`,
        at: now(),
        type: "RUN_TIMED_OUT",
        message:
          "AmazFlow could not reach the execution agent in time. No additional actions were taken.",
        details: {},
      });
      run.updatedAt = now();
      await saveRunWithAudit(run, auditStartIdx);
      timedOutRuns++;
    }
  }
  return {
    expiredTasks: expiredTasks.length,
    releasedClaims: stalledClaims.length,
    expiredConfirmations: expiredConfirmations.length,
    timedOutRuns,
  };
};
const BLENDED_HOURLY_RATE = 35; // Placeholder blended rate until per-tenant rates exist.
const listTenantUsers = async (tenantId) => {
  const roleByUsername = {};
  for (const group of ["FRONTLINE", "CLIENT_ADMIN"]) {
    let token;
    do {
      const out = await cognito.send(
        new ListUsersInGroupCommand({
          UserPoolId: process.env.USER_POOL_ID,
          GroupName: group,
          NextToken: token,
        }),
      );
      for (const u of out.Users || []) roleByUsername[u.Username] = group;
      token = out.NextToken;
    } while (token);
  }
  const users = [];
  let token;
  do {
    const out = await cognito.send(
      new ListUsersCommand({
        UserPoolId: process.env.USER_POOL_ID,
        PaginationToken: token,
      }),
    );
    for (const u of out.Users || []) {
      const attrs = Object.fromEntries(
        (u.Attributes || []).map((x) => [x.Name, x.Value]),
      );
      if (attrs["custom:tenant_id"] === tenantId && roleByUsername[u.Username])
        users.push({
          username: u.Username,
          email: attrs.email || u.Username,
          role: roleByUsername[u.Username],
          enabled: !!u.Enabled,
        });
    }
    token = out.PaginationToken;
  } while (token);
  return users;
};
const tenantSummary = async (tenantId) => {
  const scopeArgs = { role: "CLIENT_ADMIN", tenantId };
  const [workflows, runs] = await Promise.all([
    scanType("WORKFLOW#", scopeArgs),
    scanType("RUN#", scopeArgs),
  ]);
  const workflowById = new Map(workflows.map((w) => [w.id, w]));
  let totalMinutesSaved = 0,
    totalRunsCompleted = 0;
  for (const run of runs) {
    if (run.status !== "COMPLETED") continue;
    totalRunsCompleted++;
    const estimate = workflowById.get(run.workflowId)?.manualMinutesEstimate;
    if (typeof estimate !== "number" || estimate <= 0) continue;
    const actualMinutes =
      (new Date(run.updatedAt) - new Date(run.createdAt)) / 60000;
    totalMinutesSaved += Math.max(0, estimate - actualMinutes);
  }
  return {
    totalRunsCompleted,
    totalMinutesSaved: Math.round(totalMinutesSaved),
    dollarEstimate: Math.round((totalMinutesSaved / 60) * BLENDED_HOURLY_RATE),
  };
};

// ---------- Organization branding (Phase 10 whitelabel prep) ----------
// Deliberately narrow: four constrained fields, never arbitrary CSS/HTML. AmazFlow's
// own wordmark and product chrome remain dominant everywhere -- this only lets a
// customer's own sign-in screen show their name/logo/accent alongside it.
const validateBranding = (body) => {
  const out = {};
  if ("displayName" in body)
    out.displayName = String(body.displayName || "")
      .trim()
      .slice(0, 80);
  if ("loginMessage" in body)
    out.loginMessage = String(body.loginMessage || "")
      .trim()
      .slice(0, 240);
  if ("accent" in body) {
    const v = String(body.accent || "").trim();
    if (v && !/^#[0-9a-fA-F]{6}$/.test(v))
      throw {
        status: 400,
        message: "accent must be a 6-digit hex color like #ff765c",
      };
    out.accent = v;
  }
  if ("logoUrl" in body) {
    const v = String(body.logoUrl || "").trim();
    if (v && (!/^https:\/\//i.test(v) || isUnsafeUrl(v)))
      throw { status: 400, message: "logoUrl must be a public https:// URL" };
    out.logoUrl = v;
  }
  return out;
};

// ---------- Activity log ----------
// Separate from a run's own audit[] (what an execution did). This records what an
// ADMIN -- human or via Copilot -- did to the configuration itself, so every
// Copilot-driven change is traceable to a named actor, never anonymous.
const logActivity = async (tenantId, entry) => {
  const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const doc = { id, tenantId, at: now(), ...entry };
  await db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: `TENANT#${tenantId}` },
        sk: { S: `ACTIVITY#${String(Date.now()).padStart(14, "0")}_${id}` },
        tenantId: { S: tenantId },
        document: { S: JSON.stringify(doc) },
        updatedAt: { S: now() },
      },
    }),
  );
  return doc;
};

// ---------- AmazFlow Copilot ----------
// A persistent SUPER_ADMIN assistant with real read access to platform data and a
// strictly draft-first write path: every write tool below only ever proposes a change
// (a COPILOTACTION record) -- it never mutates a live workflow or organization
// directly. A human must call the apply endpoint to actually commit it, at which point
// it's attributed in the activity log to "Jay via AmazFlow Copilot" rather than the
// model silently acting on its own.
const COPILOT_SYSTEM =
  "You are AmazFlow Copilot, an internal assistant for AmazFlow's own SUPER_ADMIN operator (not a customer-facing assistant). You help configure workflows, diagnose runs, and manage the platform.\nRules you must never break:\n- Only state facts you obtained from a tool call in this conversation. If you have not called a tool that would answer the question, call one before answering. Never guess at a run's status, a workflow's steps, or why something failed -- always look it up.\n- You cannot directly change anything. Every write tool only proposes a change for a human to review and apply -- say so plainly when you use one (\"I've prepared this change, review and apply it below\"), and never claim a change is live until the human has applied it.\n- Prefer the smallest change that satisfies the request. When editing a published (active) workflow, always base your edit on its current real content from get_workflow first.\n- Roles must be exactly one of FRONTLINE, CLIENT_ADMIN, SUPER_ADMIN. Providers must be exactly one of browser, api, spreadsheet, email, file, mock. Never invent other values.\n- Be concise. This is an expert operator, not a customer.";

const COPILOT_TOOLS = [
  {
    toolSpec: {
      name: "list_workflows",
      description:
        "List every workflow definition across all customer tenants with id, name, version, status, tenantId, assignedRoles.",
      inputSchema: { json: { type: "object", properties: {} } },
    },
  },
  {
    toolSpec: {
      name: "get_workflow",
      description:
        "Get the full definition of one workflow version, including every step. Call this before proposing any edit.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            tenantId: { type: "string" },
            workflowId: { type: "string" },
            version: {
              type: "number",
              description: "Optional. Omit for the current version.",
            },
          },
          required: ["tenantId", "workflowId"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "list_runs",
      description:
        "List recent workflow runs, optionally filtered by tenant, workflow, or status.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            tenantId: { type: "string" },
            workflowId: { type: "string" },
            status: { type: "string" },
          },
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_run",
      description:
        'Get one run in full, including its audit trail and step results. This is the only reliable way to answer "why did this run fail/stop" -- the audit array and stepResults contain the real recorded evidence.',
      inputSchema: {
        json: {
          type: "object",
          properties: { runId: { type: "string" } },
          required: ["runId"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "list_organizations",
      description:
        "List every customer organization with its slug, status, plan, and current branding settings.",
      inputSchema: { json: { type: "object", properties: {} } },
    },
  },
  {
    toolSpec: {
      name: "list_agents",
      description:
        "List browser automation agents, optionally filtered by tenant.",
      inputSchema: {
        json: { type: "object", properties: { tenantId: { type: "string" } } },
      },
    },
  },
  {
    toolSpec: {
      name: "list_activity",
      description:
        "List recent admin/Copilot-driven configuration changes (the activity log), optionally filtered by tenant.",
      inputSchema: {
        json: { type: "object", properties: { tenantId: { type: "string" } } },
      },
    },
  },
  {
    toolSpec: {
      name: "create_draft",
      description:
        "Propose starting a new editable draft version of an existing workflow, cloned unchanged from its current content. Use before proposing edits to a published (active) workflow.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            tenantId: { type: "string" },
            workflowId: { type: "string" },
          },
          required: ["tenantId", "workflowId"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "duplicate_workflow",
      description:
        "Propose copying an existing workflow to a brand-new workflow id as a fresh draft (e.g. for a variant or a different customer).",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            tenantId: { type: "string" },
            workflowId: { type: "string" },
            newTenantId: { type: "string" },
            newWorkflowId: { type: "string" },
            newName: { type: "string" },
          },
          required: ["tenantId", "workflowId", "newWorkflowId", "newName"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "update_step",
      description:
        "Propose changing fields on one step of a workflow (creating a draft automatically if the workflow is currently published). Pass only the fields to change.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            tenantId: { type: "string" },
            workflowId: { type: "string" },
            stepId: { type: "string" },
            patch: {
              type: "object",
              description:
                'Fields to merge into the step, e.g. {"confidenceThreshold":0.9}',
            },
          },
          required: ["tenantId", "workflowId", "stepId", "patch"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "add_step",
      description:
        'Propose adding a new step (commonly type "condition", "approval", or "verify") to a workflow, creating a draft automatically if needed. The step object must include a unique id and a type.',
      inputSchema: {
        json: {
          type: "object",
          properties: {
            tenantId: { type: "string" },
            workflowId: { type: "string" },
            step: { type: "object" },
          },
          required: ["tenantId", "workflowId", "step"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "assign_workflow_roles",
      description:
        "Propose changing which roles (FRONTLINE, CLIENT_ADMIN, SUPER_ADMIN) a workflow is assigned to.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            tenantId: { type: "string" },
            workflowId: { type: "string" },
            assignedRoles: { type: "array", items: { type: "string" } },
          },
          required: ["tenantId", "workflowId", "assignedRoles"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "set_workflow_status",
      description:
        "Propose publishing a draft (status active) or pausing a published workflow (status paused). This changes what customers can actually run, so treat it as high-risk.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            tenantId: { type: "string" },
            workflowId: { type: "string" },
            status: { type: "string", enum: ["active", "paused"] },
          },
          required: ["tenantId", "workflowId", "status"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "update_organization_branding",
      description:
        "Propose updating a customer organization's sign-in branding: displayName, logoUrl (https only), accent (hex color), loginMessage. AmazFlow's own branding always remains dominant regardless of these settings.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            slug: { type: "string" },
            displayName: { type: "string" },
            logoUrl: { type: "string" },
            accent: { type: "string" },
            loginMessage: { type: "string" },
          },
          required: ["slug"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "generate_workflow_draft_from_sop",
      description:
        "Propose a brand-new workflow draft generated from a plain-language standard operating procedure description (the Agent Builder). Use when the operator describes a process rather than exact steps.",
      inputSchema: {
        json: {
          type: "object",
          properties: { tenantId: { type: "string" }, sop: { type: "string" } },
          required: ["tenantId", "sop"],
        },
      },
    },
  },
];

const proposeAction = async (userId, tenantId, kind, summary, payload) => {
  const id = `copact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const action = {
    id,
    userId,
    tenantId,
    kind,
    summary,
    payload,
    status: "PENDING",
    createdAt: now(),
  };
  await db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: "PLATFORM" },
        sk: { S: `COPILOTACTION#${id}` },
        document: { S: JSON.stringify(action) },
        updatedAt: { S: now() },
      },
    }),
  );
  return action;
};

const findWorkflow = async (tenantId, workflowId) => {
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: {
        pk: { S: `TENANT#${tenantId}` },
        sk: { S: `WORKFLOW#${workflowId}` },
      },
    }),
  );
  return out.Item && out.Item.document?.S ? parse(out.Item) : null;
};

// Copies a workflow's current live content into an unpublished, incrementing-version
// draft -- the only way any Copilot write tool is allowed to touch a published
// workflow. The live WORKFLOW# doc is never modified until a human explicitly applies
// a set_workflow_status publish action.
const draftFrom = (workflow) => ({
  ...workflow,
  version: (workflow.version || 1) + 1,
  status: "draft",
});

const runCopilotTool = async (userId, name, input) => {
  if (name === "list_workflows") {
    const items = await scanType("WORKFLOW#", { role: "SUPER_ADMIN" });
    return items.map((w) => ({
      id: w.id,
      tenantId: w.tenantId,
      name: w.name,
      version: w.version,
      status: w.status,
      assignedRoles: w.assignedRoles,
    }));
  }
  if (name === "get_workflow") {
    if (input.version)
      return await getWorkflowVersion(
        input.tenantId,
        input.workflowId,
        input.version,
      );
    const w = await findWorkflow(input.tenantId, input.workflowId);
    if (!w)
      throw new Error(
        `No workflow ${input.workflowId} in tenant ${input.tenantId}`,
      );
    return w;
  }
  if (name === "list_runs") {
    let items = await scanType("RUN#", { role: "SUPER_ADMIN" });
    if (input.tenantId)
      items = items.filter((r) => r.tenantId === input.tenantId);
    if (input.workflowId)
      items = items.filter((r) => r.workflowId === input.workflowId);
    if (input.status) items = items.filter((r) => r.status === input.status);
    return items
      .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))
      .slice(0, 25)
      .map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        workflowId: r.workflowId,
        status: r.status,
        currentStepId: r.currentStepId,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
  }
  if (name === "get_run") {
    const items = await scanType("RUN#", { role: "SUPER_ADMIN" });
    const run = items.find((r) => r.id === input.runId);
    if (!run) throw new Error(`No run ${input.runId}`);
    return run;
  }
  if (name === "list_organizations") return await listOrganizations();
  if (name === "list_agents") {
    let items = await scanType("AGENT#", { role: "SUPER_ADMIN" });
    if (input.tenantId)
      items = items.filter((x) => x.tenantId === input.tenantId);
    return items;
  }
  if (name === "list_activity") {
    let items = await scanType("ACTIVITY#", { role: "SUPER_ADMIN" });
    if (input.tenantId)
      items = items.filter((x) => x.tenantId === input.tenantId);
    return items
      .sort((x, y) => String(y.at).localeCompare(String(x.at)))
      .slice(0, 25);
  }
  if (name === "create_draft") {
    const w = await findWorkflow(input.tenantId, input.workflowId);
    if (!w)
      throw new Error(
        `No workflow ${input.workflowId} in tenant ${input.tenantId}`,
      );
    const draft = draftFrom(w);
    const action = await proposeAction(
      userId,
      input.tenantId,
      "WORKFLOW_DRAFT",
      `New draft v${draft.version} of "${w.name}", cloned unchanged from v${w.version}`,
      { op: "SAVE_WORKFLOW", workflow: draft, before: w },
    );
    return { proposed: true, actionId: action.id, summary: action.summary };
  }
  if (name === "duplicate_workflow") {
    const w = await findWorkflow(input.tenantId, input.workflowId);
    if (!w)
      throw new Error(
        `No workflow ${input.workflowId} in tenant ${input.tenantId}`,
      );
    const targetTenantId = input.newTenantId || input.tenantId;
    const copy = {
      ...w,
      id: input.newWorkflowId,
      tenantId: targetTenantId,
      name: input.newName,
      version: 1,
      status: "draft",
    };
    const shapeError = validateWorkflowShape(copy);
    if (shapeError) throw new Error(shapeError);
    const action = await proposeAction(
      userId,
      targetTenantId,
      "WORKFLOW_DUPLICATE",
      `New workflow "${input.newName}" (${input.newWorkflowId}) copied from "${w.name}"`,
      { op: "SAVE_WORKFLOW", workflow: copy, before: null },
    );
    return { proposed: true, actionId: action.id, summary: action.summary };
  }
  if (name === "update_step") {
    const w = await findWorkflow(input.tenantId, input.workflowId);
    if (!w)
      throw new Error(
        `No workflow ${input.workflowId} in tenant ${input.tenantId}`,
      );
    const before = JSON.parse(JSON.stringify(w));
    const target = w.status === "draft" ? w : draftFrom(w);
    const stepIndex = target.steps.findIndex((s) => s.id === input.stepId);
    if (stepIndex < 0)
      throw new Error(
        `No step ${input.stepId} on workflow ${input.workflowId}`,
      );
    target.steps = target.steps.map((s, i) =>
      i === stepIndex ? { ...s, ...input.patch } : s,
    );
    const shapeError = validateWorkflowShape(target);
    if (shapeError) throw new Error(shapeError);
    const action = await proposeAction(
      userId,
      input.tenantId,
      "WORKFLOW_STEP_UPDATE",
      `${w.status === "draft" ? "Update" : `New draft v${target.version} updating`} step "${input.stepId}" on "${w.name}"`,
      { op: "SAVE_WORKFLOW", workflow: target, before },
    );
    return { proposed: true, actionId: action.id, summary: action.summary };
  }
  if (name === "add_step") {
    const w = await findWorkflow(input.tenantId, input.workflowId);
    if (!w)
      throw new Error(
        `No workflow ${input.workflowId} in tenant ${input.tenantId}`,
      );
    const before = JSON.parse(JSON.stringify(w));
    const target = w.status === "draft" ? w : draftFrom(w);
    if (target.steps.some((s) => s.id === input.step?.id))
      throw new Error(`Step id "${input.step?.id}" already exists`);
    target.steps = [...target.steps, input.step];
    const shapeError = validateWorkflowShape(target);
    if (shapeError) throw new Error(shapeError);
    const action = await proposeAction(
      userId,
      input.tenantId,
      "WORKFLOW_STEP_ADD",
      `${w.status === "draft" ? "Add" : `New draft v${target.version} adding`} step "${input.step?.id}" (${input.step?.type}) to "${w.name}"`,
      { op: "SAVE_WORKFLOW", workflow: target, before },
    );
    return { proposed: true, actionId: action.id, summary: action.summary };
  }
  if (name === "assign_workflow_roles") {
    const w = await findWorkflow(input.tenantId, input.workflowId);
    if (!w)
      throw new Error(
        `No workflow ${input.workflowId} in tenant ${input.tenantId}`,
      );
    const valid = ["FRONTLINE", "CLIENT_ADMIN", "SUPER_ADMIN"];
    const roles = (input.assignedRoles || []).filter((r) => valid.includes(r));
    if (!roles.length)
      throw new Error(
        "assignedRoles must include at least one of FRONTLINE, CLIENT_ADMIN, SUPER_ADMIN",
      );
    const target = { ...w, assignedRoles: roles };
    const action = await proposeAction(
      userId,
      input.tenantId,
      "WORKFLOW_ROLES",
      `Assign "${w.name}" to roles: ${roles.join(", ")}`,
      { op: "SAVE_WORKFLOW", workflow: target, before: w },
    );
    return { proposed: true, actionId: action.id, summary: action.summary };
  }
  if (name === "set_workflow_status") {
    const w = await findWorkflow(input.tenantId, input.workflowId);
    if (!w)
      throw new Error(
        `No workflow ${input.workflowId} in tenant ${input.tenantId}`,
      );
    if (!["active", "paused"].includes(input.status))
      throw new Error("status must be active or paused");
    const target = { ...w, status: input.status };
    const action = await proposeAction(
      userId,
      input.tenantId,
      "WORKFLOW_STATUS",
      `${input.status === "active" ? "Publish" : "Pause"} "${w.name}" v${w.version} (currently ${w.status})`,
      { op: "SAVE_WORKFLOW", workflow: target, before: w },
    );
    return {
      proposed: true,
      actionId: action.id,
      summary: action.summary,
      highRisk: true,
    };
  }
  if (name === "update_organization_branding") {
    const org = await getOrganization(input.slug);
    if (!org) throw new Error(`No organization with slug ${input.slug}`);
    const patch = validateBranding(input);
    const target = { ...org, branding: { ...(org.branding || {}), ...patch } };
    const action = await proposeAction(
      userId,
      org.slug,
      "ORG_BRANDING",
      `Update sign-in branding for "${org.name}"`,
      { op: "SAVE_ORG", org: target, before: org },
    );
    return { proposed: true, actionId: action.id, summary: action.summary };
  }
  if (name === "generate_workflow_draft_from_sop") {
    const draft = await generateWorkflowFromSop(
      input.sop,
      input.tenantId || "amazflow",
    );
    const action = await proposeAction(
      userId,
      draft.tenantId,
      "WORKFLOW_GENERATED",
      `New workflow draft "${draft.name}" generated from your description`,
      { op: "SAVE_WORKFLOW", workflow: draft, before: null },
    );
    return { proposed: true, actionId: action.id, summary: action.summary };
  }
  throw new Error(`Unknown tool ${name}`);
};

const loadCopilotConversation = async (userId) => {
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: { pk: { S: "PLATFORM" }, sk: { S: `COPILOTCONV#${userId}` } },
    }),
  );
  if (out.Item && out.Item.document?.S) return JSON.parse(out.Item.document.S);
  return { userId, messages: [] };
};
const saveCopilotConversation = async (conv) =>
  db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: "PLATFORM" },
        sk: { S: `COPILOTCONV#${conv.userId}` },
        document: { S: JSON.stringify(conv) },
        updatedAt: { S: now() },
      },
    }),
  );

// Gateway targets are deployed as separate Lambda functions with a fixed TOOL_NAME.
// A caller cannot select another operation by altering model-provided arguments.
const gatewayInput = (event) => {
  if (event && typeof event.body === "string") {
    try {
      return JSON.parse(event.body);
    } catch {
      return {};
    }
  }
  return event?.arguments || event?.input || event || {};
};
// Single-use is keyed by (grantId, tool) rather than grantId alone: one grant names a set of
// tools and authorizes each of them exactly once. That is what lets a single claim's grant carry
// both the agent's record_step_result evidence write and its one terminal result submission
// while leaving either call unreplayable. A grant naming one tool behaves exactly as before.
const grantReplayStore = (tool) => ({
  consume: (grantId, expiresAt) =>
    consumeExecutionGrant(`${grantId}#${tool || "*"}`, expiresAt),
});
const consumeExecutionGrant = async (grantId, expiresAt) => {
  try {
    await db.send(
      new PutItemCommand({
        TableName: table,
        Item: {
          pk: { S: "GRANT" },
          sk: { S: `GRANT#${grantId}` },
          ttl: { N: String(expiresAt) },
          updatedAt: { S: now() },
        },
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
    return true;
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
};
const executeGatewayApiTool = async (input) => {
  if (!executionGrants) throw new Error("Execution grants are not configured");
  const claims = await executionGrants.verify(
    String(input.executionGrant || ""),
    { tool: "api.execute" },
    grantReplayStore("api.execute"),
  );
  if (!claims.confirmationGranted)
    throw new Error("Action confirmation is required");
  const runOut = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: {
        pk: { S: `TENANT#${claims.tenantId}` },
        sk: { S: `RUN#${claims.runId}` },
      },
    }),
  );
  const run = runOut.Item?.document?.S ? parse(runOut.Item) : null;
  if (
    !run ||
    run.workflowId !== claims.workflowId ||
    run.workflowVersion !== claims.workflowVersion ||
    run.currentStepId !== claims.stepId ||
    run.status !== "RUNNING"
  )
    throw new Error(
      "Execution grant does not match the authoritative run state",
    );
  const workflow = await getWorkflowVersion(
    claims.tenantId,
    claims.workflowId,
    claims.workflowVersion,
  );
  const step = workflow?.steps?.find((item) => item.id === claims.stepId);
  if (!step || step.type !== "action" || step.provider !== "api")
    throw new Error("Pinned workflow step is not an API action");
  const cfg = interpolate(step.input || {}, run.context);
  if (!cfg.url || isUnsafeUrl(cfg.url))
    throw new Error("Pinned API destination is invalid or unsafe");
  const method = String(cfg.method || "POST").toUpperCase();
  const response = await fetch(cfg.url, {
    method,
    headers: { "content-type": "application/json", ...(cfg.headers || {}) },
    body:
      method === "GET" || method === "HEAD"
        ? undefined
        : JSON.stringify(cfg.body || {}),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
    sideEffectObserved: method !== "GET" && method !== "HEAD",
  };
};
exports.gatewayToolHandler = async (event, context) => {
  const visibleName =
    context?.clientContext?.Custom?.bedrockAgentCoreToolName ||
    context?.clientContext?.custom?.bedrockAgentCoreToolName ||
    "";
  const name = process.env.TOOL_NAME || String(visibleName).split("___").at(-1);
  const input = gatewayInput(event);
  if (name === "api_execute") return executeGatewayApiTool(input);
  if (!COPILOT_TOOLS.some((tool) => tool.toolSpec.name === name))
    throw new Error("Tool is not configured");
  return runCopilotTool(
    process.env.OPERATOR_ACTOR_ID || "agentcore-operator",
    name,
    input,
  );
};

// A human-readable label for whatever screen the operator was on when they sent this
// message -- lets Copilot open by acknowledging what's on screen instead of asking
// "which workflow do you mean" when the answer is already visible to the operator.
const SECTION_LABEL = {
  overview: "the Global Overview dashboard",
  workflows: "Workflow Studio",
  clients: "the Clients list",
  runs: "the Runs list",
  approvals: "the Approvals queue",
  exceptions: "the Exceptions triage view",
  connections: "Connections",
  agents: "Agents",
  audit: "Audit & Policy",
  settings: "Platform Settings",
  support: "Support",
};
const describeContext = (context) => {
  if (!context || !context.section) return null;
  const label = SECTION_LABEL[context.section] || context.section;
  return context.entityId
    ? `The operator is currently viewing ${label}, looking at record "${context.entityId}". If that's what they mean by "this" or "here", use it -- otherwise call a tool to confirm.`
    : `The operator is currently viewing ${label}.`;
};
const stripThinking = (value) =>
  String(value || "")
    .replace(/<thinking>[\s\S]*?<\/thinking>\s*/gi, "")
    .trim();
const runCopilotTurn = async (
  userId,
  tenantId,
  userMessage,
  context,
  bearerToken,
) => {
  if (useAgentCore()) {
    if (!agentCoreCopilot)
      throw new Error("AmazFlow Copilot harness is not configured");
    if (!bearerToken)
      throw new Error(
        "A Cognito bearer token is required for AmazFlow Copilot",
      );
    const response = await agentCoreCopilot.turn({
      userId,
      tenantId,
      message: userMessage,
      context,
      bearerToken: bearerToken.replace(/^Bearer\s+/i, ""),
    });
    const text = stripThinking(response.text);
    const conv = await loadCopilotConversation(userId);
    conv.messages = [
      ...(conv.messages || []),
      { role: "user", content: [{ text: userMessage }] },
      { role: "assistant", content: [{ text }] },
    ];
    await saveCopilotConversation(conv);
    if (agentCoreMemory) {
      await Promise.all([
        agentCoreMemory.remember({
          tenantId,
          actorId: userId,
          sessionId: `copilot-${userId}`,
          role: "USER",
          text: userMessage,
        }),
        agentCoreMemory.remember({
          tenantId,
          actorId: userId,
          sessionId: `copilot-${userId}`,
          role: "ASSISTANT",
          text,
        }),
      ]);
    }
    let actions = await scanType("COPILOTACTION#", { role: "SUPER_ADMIN" });
    const pendingActions = actions
      .filter(
        (action) => action.userId === userId && action.status === "PENDING",
      )
      .map((action) => ({
        proposed: true,
        actionId: action.id,
        summary: action.summary,
        highRisk: action.kind === "WORKFLOW_STATUS",
      }));
    return { reply: text, pendingActions, traceId: response.metadata.traceId };
  }
  assertLegacyEnabled();
  const conv = await loadCopilotConversation(userId);
  conv.messages = (conv.messages || []).map((message) => ({
    ...message,
    content: (message.content || []).map((block) =>
      block.text ? { ...block, text: stripThinking(block.text) } : block,
    ),
  }));
  const working = [
    ...conv.messages,
    { role: "user", content: [{ text: userMessage }] },
  ];
  const pendingActions = [];
  const contextNote = describeContext(context);
  const system = contextNote
    ? [{ text: COPILOT_SYSTEM }, { text: contextNote }]
    : [{ text: COPILOT_SYSTEM }];
  for (let guard = 0; guard < 6; guard++) {
    const out = await bedrock.send(
      new ConverseCommand({
        modelId: process.env.BEDROCK_MODEL_ID,
        system,
        messages: working,
        toolConfig: { tools: COPILOT_TOOLS },
        inferenceConfig: { maxTokens: 1500, temperature: 0.2 },
      }),
    );
    const message = out.output?.message;
    if (!message) break;
    working.push(message);
    if (out.stopReason !== "tool_use") {
      const text = stripThinking(
        message.content?.find((c) => c.text)?.text || "",
      );
      conv.messages = [
        ...conv.messages,
        { role: "user", content: [{ text: userMessage }] },
        { role: "assistant", content: [{ text }] },
      ];
      await saveCopilotConversation(conv);
      return { reply: text, pendingActions };
    }
    const toolResults = [];
    for (const block of message.content || []) {
      if (!block.toolUse) continue;
      try {
        const result = await runCopilotTool(
          userId,
          block.toolUse.name,
          block.toolUse.input || {},
        );
        if (result && result.proposed) pendingActions.push(result);
        toolResults.push({
          toolResult: {
            toolUseId: block.toolUse.toolUseId,
            content: [{ json: result }],
          },
        });
      } catch (toolErr) {
        toolResults.push({
          toolResult: {
            toolUseId: block.toolUse.toolUseId,
            content: [{ json: { error: toolErr.message } }],
            status: "error",
          },
        });
      }
    }
    working.push({ role: "user", content: toolResults });
  }
  const fallback =
    "I wasn't able to finish that within my tool-call budget -- try breaking the request into smaller steps.";
  conv.messages = [
    ...conv.messages,
    { role: "user", content: [{ text: userMessage }] },
    { role: "assistant", content: [{ text: fallback }] },
  ];
  await saveCopilotConversation(conv);
  return { reply: fallback, pendingActions };
};

const applyCopilotAction = async (actionId, a) => {
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: { pk: { S: "PLATFORM" }, sk: { S: `COPILOTACTION#${actionId}` } },
    }),
  );
  if (!out.Item || !out.Item.document?.S)
    throw { status: 404, message: "Proposed action not found" };
  const action = JSON.parse(out.Item.document.S);
  if (action.status !== "PENDING")
    throw {
      status: 409,
      message: `This action is already ${action.status.toLowerCase()}`,
    };
  const payload = action.payload;
  if (payload.op === "SAVE_WORKFLOW") {
    const shapeError = validateWorkflowShape(payload.workflow);
    if (shapeError) throw { status: 400, message: shapeError };
    if (payload.workflow.status === "active") {
      for (const step of payload.workflow.steps || []) {
        if (step.type !== "action" || step.provider !== "browser" || step.browserMode !== "managed") continue;
        const connection = await getBrowserConnection(payload.workflow.tenantId, step.connectionId);
        if (!connection || connection.status !== "active" || !connection.managedProfileId)
          throw { status: 409, message: `Managed browser step "${step.id}" must reference an active, authenticated connection` };
      }
    }
    payload.workflow.updatedAt = now();
    await save("WORKFLOW", payload.workflow);
    if (payload.workflow.version) {
      const paddedV = String(payload.workflow.version).padStart(6, "0");
      await save("WORKFLOWVERSION", {
        ...payload.workflow,
        id: `${payload.workflow.id}_v${paddedV}`,
      });
    }
  } else if (payload.op === "SAVE_ORG") {
    payload.org.updatedAt = now();
    await saveOrganization(payload.org);
  } else {
    throw { status: 500, message: `Unknown action payload op ${payload.op}` };
  }
  action.status = "APPLIED";
  action.appliedAt = now();
  action.appliedBy = a.userId;
  await db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: "PLATFORM" },
        sk: { S: `COPILOTACTION#${actionId}` },
        document: { S: JSON.stringify(action) },
        updatedAt: { S: now() },
      },
    }),
  );
  await logActivity(action.tenantId, {
    actor: a.userId,
    actorLabel: "Jay via AmazFlow Copilot",
    action: action.kind,
    summary: action.summary,
  });
  return action;
};
const discardCopilotAction = async (actionId) => {
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: { pk: { S: "PLATFORM" }, sk: { S: `COPILOTACTION#${actionId}` } },
    }),
  );
  if (!out.Item || !out.Item.document?.S)
    throw { status: 404, message: "Proposed action not found" };
  const action = JSON.parse(out.Item.document.S);
  if (action.status !== "PENDING")
    throw {
      status: 409,
      message: `This action is already ${action.status.toLowerCase()}`,
    };
  action.status = "DISCARDED";
  await db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: "PLATFORM" },
        sk: { S: `COPILOTACTION#${actionId}` },
        document: { S: JSON.stringify(action) },
        updatedAt: { S: now() },
      },
    }),
  );
  return action;
};

// ---------- Platform settings ----------
// A single PLATFORM/SETTINGS record backs the operator-configurable timeouts that used
// to be hardcoded constants. Reading it costs one GetItem per call site; the defaults
// below are exactly the values that were hardcoded before, so behavior is unchanged
// until a SUPER_ADMIN actually saves a change.
const DEFAULT_SETTINGS = {
  taskExpiryMs: 5 * 60000,
  confirmationExpiryMs: 3600000,
  agentCodeExpiryMs: 2 * 60000,
};
const SETTINGS_BOUNDS = {
  taskExpiryMs: [30000, 3600000],
  confirmationExpiryMs: [60000, 86400000],
  agentCodeExpiryMs: [30000, 600000],
};
const getSettings = async () => {
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: { pk: { S: "PLATFORM" }, sk: { S: "SETTINGS" } },
    }),
  );
  if (out.Item && out.Item.document?.S)
    return { ...DEFAULT_SETTINGS, ...JSON.parse(out.Item.document.S) };
  return { ...DEFAULT_SETTINGS };
};
const saveSettings = async (patch) => {
  const current = await getSettings();
  const next = { ...current };
  for (const key of Object.keys(SETTINGS_BOUNDS)) {
    if (!(key in patch)) continue;
    const value = Number(patch[key]);
    const [min, max] = SETTINGS_BOUNDS[key];
    if (!Number.isFinite(value) || value < min || value > max)
      throw {
        status: 400,
        message: `${key} must be a number between ${min} and ${max}`,
      };
    next[key] = value;
  }
  await db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: "PLATFORM" },
        sk: { S: "SETTINGS" },
        document: { S: JSON.stringify(next) },
        updatedAt: { S: now() },
      },
    }),
  );
  return next;
};

// ---------- Support tickets ----------
// Minimal but genuinely durable: every ticket is a real DynamoDB record any role can
// create, SUPER_ADMIN can triage across tenants, and CLIENT_ADMIN/FRONTLINE can see
// within the rules the rest of this file already applies to tenant-scoped data.
const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"];
const createTicket = async (a, body) => {
  const subject = String(body.subject || "")
    .trim()
    .slice(0, 200);
  const message = String(body.message || "")
    .trim()
    .slice(0, 4000);
  if (!subject || !message)
    throw { status: 400, message: "A subject and message are required" };
  const ticket = {
    id: `ticket_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: a.tenantId,
    createdBy: a.userId,
    subject,
    message,
    category: String(body.category || "general").slice(0, 40),
    priority: ["low", "normal", "high", "urgent"].includes(body.priority)
      ? body.priority
      : "normal",
    runId: body.runId ? String(body.runId).slice(0, 120) : undefined,
    workflowId: body.workflowId
      ? String(body.workflowId).slice(0, 120)
      : undefined,
    status: "open",
    notes: [],
    createdAt: now(),
    updatedAt: now(),
  };
  await save("TICKET", ticket);
  await logActivity(a.tenantId, {
    actor: a.userId,
    actorLabel:
      a.role === "SUPER_ADMIN"
        ? "AmazFlow super admin"
        : a.role === "CLIENT_ADMIN"
          ? "Team admin"
          : "Team member",
    action: "SUPPORT_TICKET_CREATED",
    summary: `Opened support ticket "${subject}"`,
  });
  return ticket;
};
const updateTicket = async (ticketId, a, body) => {
  const items = await scanType("TICKET#", { role: "SUPER_ADMIN" });
  const ticket = items.find((t) => t.id === ticketId);
  if (!ticket) throw { status: 404, message: "Ticket not found" };
  if (a.role !== "SUPER_ADMIN" && ticket.tenantId !== a.tenantId)
    throw { status: 403, message: "Ticket belongs to another tenant" };
  if (a.role === "FRONTLINE" && ticket.createdBy !== a.userId)
    throw { status: 403, message: "You can only update your own tickets" };
  if (body.status) {
    if (!TICKET_STATUSES.includes(body.status))
      throw {
        status: 400,
        message: `status must be one of ${TICKET_STATUSES.join(", ")}`,
      };
    ticket.status = body.status;
  }
  if (body.note) {
    ticket.notes = [
      ...(ticket.notes || []),
      {
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        at: now(),
        by: a.userId,
        text: String(body.note).slice(0, 2000),
        internal: a.role === "SUPER_ADMIN" && !!body.internal,
      },
    ];
  }
  ticket.updatedAt = now();
  await save("TICKET", ticket);
  if (body.status)
    await logActivity(ticket.tenantId, {
      actor: a.userId,
      actorLabel:
        a.role === "SUPER_ADMIN" ? "AmazFlow super admin" : "Team admin",
      action: "SUPPORT_TICKET_STATUS",
      summary: `Ticket "${ticket.subject}" set to ${ticket.status}`,
    });
  return ticket;
};

// ---------- Workflow version history ----------
const listWorkflowVersions = async (tenantId, workflowId) => {
  const out = await db.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": { S: `TENANT#${tenantId}` },
        ":prefix": { S: `WORKFLOWVERSION#${workflowId}_v` },
      },
    }),
  );
  return (out.Items || [])
    .filter((i) => i.document?.S)
    .map(parse)
    .sort((a, b) => (b.version || 0) - (a.version || 0));
};

// ---------- Managed browser connections ----------
// Provider profile/session identifiers stay server-side. API responses expose only the
// connection identity and a short-lived live-view URL needed for the interactive login.
const getBrowserConnection = async (tenantId, id) => {
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: {
        pk: { S: `TENANT#${tenantId}` },
        sk: { S: `BROWSERCONNECTION#${id}` },
      },
    }),
  );
  return out.Item?.document?.S ? parse(out.Item) : null;
};
const publicBrowserConnection = (connection) => {
  const { managedProfileId, ...safe } = connection;
  return safe;
};
const listBrowserConnections = async (a) => {
  if (a.role === "FRONTLINE")
    throw {
      status: 403,
      message: "Only tenant admins view browser connections",
    };
  return (await scanType("BROWSERCONNECTION#", a)).map(publicBrowserConnection);
};
const createBrowserConnection = async (a, body) => {
  if (a.role === "FRONTLINE")
    throw {
      status: 403,
      message: "Only tenant admins create browser connections",
    };
  const tenantId =
    a.role === "SUPER_ADMIN" && body.tenantId
      ? String(body.tenantId)
      : a.tenantId;
  let valid;
  try {
    valid = validateBrowserConnectionInput(body);
  } catch (err) {
    throw { status: 400, message: err.message };
  }
  const connection = {
    id: `connection_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId,
    ...valid,
    status: "pending",
    createdBy: a.userId,
    createdAt: now(),
    updatedAt: now(),
  };
  await save("BROWSERCONNECTION", connection);
  return publicBrowserConnection(connection);
};
const requireBrowserConnection = async (a, id) => {
  const tenantId =
    a.role === "SUPER_ADMIN" && a.requestedTenantId
      ? a.requestedTenantId
      : a.tenantId;
  let connection = await getBrowserConnection(tenantId, id);
  if (!connection && a.role === "SUPER_ADMIN")
    connection = (
      await scanType("BROWSERCONNECTION#", { role: "SUPER_ADMIN" })
    ).find((item) => item.id === id);
  if (!connection)
    throw { status: 404, message: "Browser connection not found" };
  if (a.role !== "SUPER_ADMIN" && connection.tenantId !== a.tenantId)
    throw {
      status: 403,
      message: "Browser connection belongs to another tenant",
    };
  return connection;
};
const startBrowserLogin = async (a, id) => {
  if (a.role === "FRONTLINE")
    throw {
      status: 403,
      message: "Only tenant admins authenticate browser connections",
    };
  if (!browserManager)
    throw { status: 503, message: "Managed browser is not configured" };
  const connection = await requireBrowserConnection(a, id);
  if (connection.status === "revoked")
    throw { status: 409, message: "This connection has been revoked" };
  const login = await browserManager.startLoginSession({
    connectionId: connection.id,
    tenantId: connection.tenantId,
    profileId: connection.managedProfileId,
  });
  connection.managedProfileId = login.profileId;
  connection.updatedAt = now();
  await save("BROWSERCONNECTION", connection);
  const loginSessionId = `login_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id: loginSessionId,
    tenantId: connection.tenantId,
    connectionId: connection.id,
    profileId: login.profileId,
    browserSessionId: login.browserSessionId,
    status: "PENDING",
    expiresAt: login.expiresAt,
    createdAt: now(),
  };
  await save("BROWSERLOGIN", record);
  return {
    connectionId: connection.id,
    loginSessionId,
    liveViewUrl: login.liveViewUrl,
    expiresAt: login.expiresAt,
  };
};
const completeBrowserLogin = async (a, id, body) => {
  if (a.role === "FRONTLINE")
    throw {
      status: 403,
      message: "Only tenant admins authenticate browser connections",
    };
  if (!browserManager)
    throw { status: 503, message: "Managed browser is not configured" };
  const connection = await requireBrowserConnection(a, id);
  const sessionId = String(body.loginSessionId || "");
  if (!sessionId) throw { status: 400, message: "loginSessionId is required" };
  const loginOut = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: {
        pk: { S: `TENANT#${connection.tenantId}` },
        sk: { S: `BROWSERLOGIN#${sessionId}` },
      },
    }),
  );
  const login = loginOut.Item?.document?.S ? parse(loginOut.Item) : null;
  if (
    !login ||
    login.connectionId !== connection.id ||
    login.status !== "PENDING"
  )
    throw {
      status: 409,
      message: "Login session is not active for this connection",
    };
  if (new Date(login.expiresAt).getTime() < Date.now())
    throw { status: 409, message: "Login session expired" };
  await browserManager.completeLoginSession({
    profileId: login.profileId,
    browserSessionId: login.browserSessionId,
  });
  login.status = "COMPLETED";
  connection.status = "active";
  connection.updatedAt = now();
  await Promise.all([
    save("BROWSERLOGIN", login),
    save("BROWSERCONNECTION", connection),
  ]);
  await logActivity(connection.tenantId, {
    actor: a.userId,
    actorLabel:
      a.role === "SUPER_ADMIN" ? "AmazFlow super admin" : "Team admin",
    action: "BROWSER_CONNECTION_AUTHENTICATED",
    summary: `Authenticated browser connection "${connection.name}"`,
  });
  return publicBrowserConnection(connection);
};
const revokeBrowserConnection = async (a, id) => {
  if (a.role === "FRONTLINE")
    throw {
      status: 403,
      message: "Only tenant admins revoke browser connections",
    };
  const connection = await requireBrowserConnection(a, id);
  if (connection.managedProfileId && browserManager)
    await browserManager.deleteProfile(connection.managedProfileId);
  connection.status = "revoked";
  delete connection.managedProfileId;
  connection.updatedAt = now();
  await save("BROWSERCONNECTION", connection);
  await logActivity(connection.tenantId, {
    actor: a.userId,
    actorLabel:
      a.role === "SUPER_ADMIN" ? "AmazFlow super admin" : "Team admin",
    action: "BROWSER_CONNECTION_REVOKED",
    summary: `Revoked browser connection "${connection.name}"`,
  });
  return publicBrowserConnection(connection);
};

exports.handler = async (e) => {
  try {
    if (e.source === "amazflow.sweep") {
      const result = await sweepExpired();
      return { ok: true, ...result };
    }
    const route = e.routeKey || "";
    if (route === "GET /health")
      return reply(200, {
        ok: true,
        service: "amazflow-control-plane",
        boundary: process.env.DATA_BOUNDARY,
        aiRuntime: useAgentCore() ? "managed" : "legacy",
      });
    if (route === "POST /leads") {
      const b = JSON.parse(e.body || "{}");
      const clean = (v) =>
        String(v == null ? "" : v)
          .slice(0, 2000)
          .trim();
      const email = clean(b.email);
      const name = clean(b.name);
      if (clean(b.website)) return reply(201, { ok: true });
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        return reply(400, {
          error: "A name and a valid work email are required",
        });
      const lead = {
        id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        tenantId: "amazflow",
        name,
        email,
        company: clean(b.company),
        role: clean(b.role),
        workflow: clean(b.workflow),
        volume: clean(b.volume),
        message: clean(b.message),
        source: clean(b.source) || "website",
        status: "new",
        createdAt: now(),
      };
      await save("LEAD", lead);
      try {
        const text = [
          "New AmazFlow lead",
          "",
          "Name: " + lead.name,
          "Email: " + lead.email,
          "Company: " + lead.company,
          "Role: " + lead.role,
          "Workflow to automate: " + lead.workflow,
          "Monthly volume: " + lead.volume,
          "Notes: " + lead.message,
          "",
          "Source: " + lead.source,
          "Received: " + lead.createdAt,
          "Lead ID: " + lead.id,
        ].join("\n");
        await ses.send(
          new SendEmailCommand({
            FromEmailAddress: process.env.LEAD_FROM,
            Destination: { ToAddresses: [process.env.LEAD_TO] },
            ReplyToAddresses: [lead.email],
            Content: {
              Simple: {
                Subject: {
                  Data:
                    "New lead: " +
                    lead.name +
                    (lead.company ? " - " + lead.company : ""),
                },
                Body: { Text: { Data: text } },
              },
            },
          }),
        );
      } catch (mailErr) {
        console.error("lead email failed", mailErr.message);
      }
      return reply(201, { ok: true, id: lead.id });
    }
    if (route === "POST /agent-authorizations/{code}/exchange") {
      try {
        const result = await exchangeAgentCode(e.pathParameters?.code);
        return reply(200, result);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "GET /agent/tasks") {
      try {
        const agentCtx = await agentAuth(e);
        const items = await scanType("TASK#", { role: "SUPER_ADMIN" });
        const pending = items.filter(
          (t) => t.status === "PENDING" && agentMayRunTask(t, agentCtx),
        );
        return reply(200, pending);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /agent/tasks/{id}/claim") {
      try {
        const agentCtx = await agentAuth(e);
        const claim = await claimAgentTask(e.pathParameters?.id, agentCtx);
        return reply(200, claim);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /agent/tools/record-step-result") {
      try {
        const body = JSON.parse(e.body || "{}");
        const grantToken =
          e.headers?.["x-amazflow-execution-grant"] ||
          e.headers?.["X-AmazFlow-Execution-Grant"] ||
          body.grant;
        return reply(200, await recordStepResult(grantToken, body));
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /agent/tasks/{id}/result") {
      try {
        const agentCtx = await agentAuth(e);
        const body = JSON.parse(e.body || "{}");
        const grantToken =
          e.headers?.["x-amazflow-execution-grant"] ||
          e.headers?.["X-AmazFlow-Execution-Grant"];
        if (!grantToken)
          return reply(409, {
            error:
              "Results now require the execution grant issued when the task was claimed. Update the AmazFlow browser agent to the current build and reconnect it.",
          });
        const allTasks = await scanType("TASK#", { role: "SUPER_ADMIN" });
        const task = allTasks.find((t) => t.id === e.pathParameters?.id);
        if (!task || !agentMayRunTask(task, agentCtx))
          return reply(404, { error: "Task not found" });
        if (task.claimedBy && task.claimedBy !== agentCtx.agentId)
          return reply(409, {
            error: "This task is claimed by a different agent",
          });
        const run = await resumeAgentTask(
          task.id,
          body,
          {
            role: "SUPER_ADMIN",
            userId: agentCtx.agentId,
            tenantId: agentCtx.tenantId,
          },
          grantToken,
        );
        return reply(200, run);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /agent/heartbeat") {
      try {
        const agentCtx = await agentAuth(e);
        const body = JSON.parse(e.body || "{}");
        await touchAgentHeartbeat(
          agentCtx.agentId,
          agentCtx.tenantId,
          body.version,
        );
        return reply(200, { ok: true });
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "GET /organizations/{slug}/branding") {
      const org = await getOrganization(e.pathParameters?.slug);
      if (!org) return reply(404, { error: "Organization not found" });
      return reply(200, {
        slug: org.slug,
        name: org.name,
        branding: org.branding || {},
      });
    }
    const a = auth(e);
    if (!a.role) return reply(403, { error: "Role required" });
    if (route === "GET /me") return reply(200, a);
    if (route === "GET /workflows") {
      const items = await scanType("WORKFLOW#", a);
      return reply(
        200,
        items.sort((x, y) =>
          String(y.version).localeCompare(String(x.version)),
        ),
      );
    }
    if (route === "POST /workflows") {
      if (a.role !== "SUPER_ADMIN")
        return reply(403, {
          error: "Only AmazFlow super admins configure workflows",
        });
      const body = JSON.parse(e.body || "{}");
      const shapeError = validateWorkflowShape(body);
      if (shapeError) return reply(400, { error: shapeError });
      if (body.status === "active") {
        for (const step of body.steps || []) {
          if (step.type !== "action" || step.provider !== "browser" || step.browserMode !== "managed") continue;
          const connection = await getBrowserConnection(body.tenantId, step.connectionId);
          if (!connection || connection.status !== "active" || !connection.managedProfileId)
            return reply(409, { error: `Managed browser step "${step.id}" must reference an active, authenticated connection` });
        }
      }
      body.updatedAt = now();
      await save("WORKFLOW", body);
      if (body.version) {
        const paddedV = String(body.version).padStart(6, "0");
        await save("WORKFLOWVERSION", {
          ...body,
          id: `${body.id}_v${paddedV}`,
        });
      }
      await logActivity(body.tenantId, {
        actor: a.userId,
        actorLabel: "AmazFlow super admin",
        action: "WORKFLOW_SAVE",
        summary: `Saved "${body.name}" v${body.version} (${body.status})`,
      });
      return reply(201, body);
    }
    if (route === "GET /workflows/{id}/versions") {
      const id = e.pathParameters?.id;
      const workflows = await scanType("WORKFLOW#", a);
      const workflow = workflows.find((w) => w.id === id);
      if (!workflow) return reply(404, { error: "Workflow not found" });
      return reply(200, await listWorkflowVersions(workflow.tenantId, id));
    }
    if (route === "GET /organizations") {
      if (a.role !== "SUPER_ADMIN")
        return reply(403, {
          error: "Only AmazFlow administrators view organizations",
        });
      const orgs = await listOrganizations();
      return reply(
        200,
        orgs.sort((x, y) =>
          String(x.createdAt).localeCompare(String(y.createdAt)),
        ),
      );
    }
    if (route === "POST /organizations") {
      if (a.role !== "SUPER_ADMIN")
        return reply(403, {
          error: "Only AmazFlow administrators create organizations",
        });
      const body = JSON.parse(e.body || "{}");
      const name = String(body.name || "").trim();
      if (!name) return reply(400, { error: "A name is required" });
      const slug = slugify(body.slug || name);
      if (!slug)
        return reply(400, {
          error: "Could not derive a usable slug from that name",
        });
      if (await getOrganization(slug))
        return reply(409, {
          error: `An organization with slug "${slug}" already exists`,
        });
      const org = {
        id: `org_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        slug,
        status: "active",
        plan: body.plan || "design_partner",
        createdAt: now(),
        updatedAt: now(),
      };
      await saveOrganization(org);
      await logActivity(slug, {
        actor: a.userId,
        actorLabel: "AmazFlow super admin",
        action: "ORG_CREATED",
        summary: `Created organization "${name}"`,
      });
      return reply(201, org);
    }
    if (route === "POST /workflows/generate") {
      if (a.role !== "SUPER_ADMIN")
        return reply(403, {
          error: "Only AmazFlow super admins generate workflows",
        });
      const body = JSON.parse(e.body || "{}");
      if (!body.sop || typeof body.sop !== "string")
        return reply(400, { error: "A sop description is required" });
      try {
        const draft = await generateWorkflowFromSop(
          body.sop,
          body.tenantId || a.tenantId || "amazflow",
        );
        return reply(200, draft);
      } catch (err) {
        return reply(422, {
          error:
            err.message ||
            "Could not generate a workflow from that description",
        });
      }
    }
    if (route === "GET /leads") {
      if (a.role !== "SUPER_ADMIN")
        return reply(403, { error: "Only AmazFlow super admins view leads" });
      const items = await scanType("LEAD#", a);
      return reply(
        200,
        items.sort((x, y) =>
          String(y.createdAt).localeCompare(String(x.createdAt)),
        ),
      );
    }
    if (route === "GET /runs") {
      let items = await scanType("RUN#", a);
      if (a.role === "FRONTLINE")
        items = items.filter((r) => r.createdBy === a.userId);
      return reply(
        200,
        items.sort((x, y) =>
          String(y.createdAt).localeCompare(String(x.createdAt)),
        ),
      );
    }
    if (route === "POST /workflows/{id}/runs") {
      const id = e.pathParameters?.id;
      const workflows = await scanType("WORKFLOW#", a);
      const workflow = workflows.find((w) => w.id === id);
      if (!workflow) return reply(404, { error: "Workflow not found" });
      if (
        a.role !== "SUPER_ADMIN" &&
        !(workflow.assignedRoles || []).includes(a.role)
      )
        return reply(403, {
          error: "This workflow is not assigned to your role",
        });
      if (workflow.status !== "active")
        return reply(409, {
          error: "This workflow is not published for execution",
        });
      const body = JSON.parse(e.body || "{}");
      if ("description" in body && !String(body.description || "").trim())
        return reply(400, {
          error: "Tell us what you need done before starting.",
        });
      return reply(201, await runWorkflow(workflow, body, a));
    }
    if (route === "POST /runs/{id}/cancel") {
      try {
        const run = await cancelRun(e.pathParameters?.id, a);
        return reply(200, run);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /runs/{id}/confirmations/{stepId}/confirm") {
      try {
        const run = await confirmActionGate(
          e.pathParameters?.id,
          e.pathParameters?.stepId,
          a,
        );
        return reply(200, run);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "GET /agents") {
      if (a.role === "FRONTLINE")
        return reply(403, { error: "Only tenant admins view agents" });
      const items = await scanType("AGENT#", a);
      return reply(
        200,
        items.sort((x, y) =>
          String(y.createdAt).localeCompare(String(x.createdAt)),
        ),
      );
    }
    if (route === "POST /agent-authorizations") {
      if (a.role === "FRONTLINE")
        return reply(403, { error: "Only tenant admins create agents" });
      const body = JSON.parse(e.body || "{}");
      const name = String(body.name || "").trim();
      if (!name) return reply(400, { error: "A name is required" });
      const targetTenantId =
        a.role === "SUPER_ADMIN" && body.tenantId ? body.tenantId : a.tenantId;
      const result = await createAgentAndCode(
        targetTenantId,
        name,
        body.allowedDomains,
        a.userId,
        a.role,
      );
      await logActivity(targetTenantId, {
        actor: a.userId,
        actorLabel:
          a.role === "SUPER_ADMIN" ? "AmazFlow super admin" : "Team admin",
        action: "AGENT_CREATED",
        summary: `Authorized a new agent "${name}"`,
      });
      return reply(201, result);
    }
    if (route === "POST /agents/{id}/revoke") {
      if (a.role === "FRONTLINE")
        return reply(403, { error: "Only tenant admins revoke agents" });
      try {
        const agent = await revokeAgent(e.pathParameters?.id, a);
        return reply(200, agent);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "GET /agent-tasks") {
      if (a.role === "FRONTLINE")
        return reply(403, { error: "Only tenant admins view agent tasks" });
      const items = await scanType("TASK#", a);
      return reply(
        200,
        items.filter((t) => t.status === "PENDING"),
      );
    }
    if (route === "POST /agent-tasks/{id}/result") {
      if (a.role === "FRONTLINE")
        return reply(403, { error: "Only tenant admins resolve agent tasks" });
      try {
        const body = JSON.parse(e.body || "{}");
        const run = await resumeAgentTask(e.pathParameters?.id, body, a);
        return reply(200, run);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /runs/{id}/approvals/{stepId}") {
      if (a.role === "FRONTLINE")
        return reply(403, { error: "Only tenant admins decide approvals" });
      try {
        const body = JSON.parse(e.body || "{}");
        const run = await resumeApproval(
          e.pathParameters?.id,
          e.pathParameters?.stepId,
          !!body.approved,
          a,
        );
        return reply(200, run);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /ai/execute") {
      const body = JSON.parse(e.body || "{}");
      const allowedOps = [
        "classify",
        "extract",
        "transform",
        "summarize",
        "choose",
      ];
      if (
        !allowedOps.includes(body.operation) ||
        typeof body.prompt !== "string"
      )
        return reply(400, { error: "Invalid bounded AI request" });
      const out = await ai(body, body.context || {});
      return reply(200, {
        aiRuntimeLabel: "AmazFlow managed AI",
        result: out.result,
        usage: out.usage,
        traceId: out.metadata?.traceId,
      });
    }
    if (route === "GET /tenants/{tenantId}/summary") {
      const tenantId = e.pathParameters?.tenantId;
      if (a.role !== "SUPER_ADMIN" && tenantId !== a.tenantId)
        return reply(403, { error: "You can only view your own tenant" });
      return reply(200, await tenantSummary(tenantId));
    }
    if (route === "GET /tenants/{tenantId}/users") {
      if (a.role === "FRONTLINE")
        return reply(403, { error: "Only tenant admins view team members" });
      const tenantId = e.pathParameters?.tenantId;
      if (a.role !== "SUPER_ADMIN" && tenantId !== a.tenantId)
        return reply(403, { error: "You can only view your own tenant" });
      return reply(200, await listTenantUsers(tenantId));
    }
    if (route === "POST /tenants/{tenantId}/users/{username}/status") {
      if (a.role === "FRONTLINE")
        return reply(403, { error: "Only tenant admins manage team members" });
      const tenantId = e.pathParameters?.tenantId;
      if (a.role !== "SUPER_ADMIN" && tenantId !== a.tenantId)
        return reply(403, { error: "You can only manage your own tenant" });
      const username = e.pathParameters?.username;
      const users = await listTenantUsers(tenantId);
      if (!users.find((u) => u.username === username))
        return reply(404, { error: "User not found in this tenant" });
      const body = JSON.parse(e.body || "{}");
      const Command = body.enabled
        ? AdminEnableUserCommand
        : AdminDisableUserCommand;
      await cognito.send(
        new Command({
          UserPoolId: process.env.USER_POOL_ID,
          Username: username,
        }),
      );
      const targetUser = users.find((u) => u.username === username);
      await logActivity(tenantId, {
        actor: a.userId,
        actorLabel:
          a.role === "SUPER_ADMIN" ? "AmazFlow super admin" : "Team admin",
        action: "TEAM_MEMBER_STATUS",
        summary: `${body.enabled ? "Reactivated" : "Deactivated"} ${targetUser ? targetUser.email : username}`,
      });
      return reply(200, { username, enabled: !!body.enabled });
    }
    if (route === "POST /organizations/{slug}/branding") {
      const brandingSlug = e.pathParameters?.slug;
      if (
        a.role === "FRONTLINE" ||
        (a.role !== "SUPER_ADMIN" && brandingSlug !== a.tenantId)
      )
        return reply(403, {
          error: "You can only manage your own organization branding",
        });
      const org = await getOrganization(e.pathParameters?.slug);
      if (!org) return reply(404, { error: "Organization not found" });
      let patch;
      try {
        patch = validateBranding(JSON.parse(e.body || "{}"));
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
      org.branding = { ...(org.branding || {}), ...patch };
      org.updatedAt = now();
      await saveOrganization(org);
      return reply(200, org);
    }
    if (route === "GET /copilot/actions") {
      if (a.role !== "SUPER_ADMIN")
        return reply(403, {
          error:
            "AmazFlow Copilot is only available to AmazFlow administrators",
        });
      let items = await scanType("COPILOTACTION#", { role: "SUPER_ADMIN" });
      const status = e.queryStringParameters?.status;
      if (status) items = items.filter((x) => x.status === status);
      return reply(
        200,
        items.sort((x, y) =>
          String(y.createdAt).localeCompare(String(x.createdAt)),
        ),
      );
    }
    if (route === "GET /copilot/conversation") {
      if (a.role !== "SUPER_ADMIN")
        return reply(403, {
          error:
            "AmazFlow Copilot is only available to AmazFlow administrators",
        });
      return reply(200, await loadCopilotConversation(a.userId));
    }
    if (route === "POST /copilot/messages") {
      if (a.role !== "SUPER_ADMIN")
        return reply(403, {
          error:
            "AmazFlow Copilot is only available to AmazFlow administrators",
        });
      const body = JSON.parse(e.body || "{}");
      const message = String(body.message || "").trim();
      if (!message) return reply(400, { error: "A message is required" });
      try {
        const result = await runCopilotTurn(
          a.userId,
          a.tenantId || "amazflow",
          message,
          body.context,
          e.headers?.authorization || e.headers?.Authorization,
        );
        return reply(200, result);
      } catch (err) {
        console.error("copilot turn failed", err);
        emitApplicationMetric("AgentFailure");
        return reply(502, {
          error: "AmazFlow Copilot could not complete that request",
        });
      }
    }
    if (route === "POST /copilot/actions/{id}/apply") {
      if (a.role !== "SUPER_ADMIN")
        return reply(403, {
          error:
            "AmazFlow Copilot is only available to AmazFlow administrators",
        });
      try {
        const action = await applyCopilotAction(e.pathParameters?.id, a);
        return reply(200, action);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /copilot/actions/{id}/discard") {
      if (a.role !== "SUPER_ADMIN")
        return reply(403, {
          error:
            "AmazFlow Copilot is only available to AmazFlow administrators",
        });
      try {
        const action = await discardCopilotAction(e.pathParameters?.id);
        return reply(200, action);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "GET /activity") {
      if (a.role !== "SUPER_ADMIN")
        return reply(403, {
          error: "Only AmazFlow administrators view the activity log",
        });
      let items = await scanType("ACTIVITY#", { role: "SUPER_ADMIN" });
      const tenantId = e.queryStringParameters?.tenantId;
      const action = e.queryStringParameters?.action;
      if (tenantId) items = items.filter((x) => x.tenantId === tenantId);
      if (action) items = items.filter((x) => x.action === action);
      return reply(
        200,
        items
          .sort((x, y) => String(y.at).localeCompare(String(x.at)))
          .slice(0, 300),
      );
    }
    if (route === "GET /settings") {
      if (a.role !== "SUPER_ADMIN")
        return reply(403, {
          error: "Only AmazFlow administrators view platform settings",
        });
      const settings = await getSettings();
      return reply(200, {
        ...settings,
        aiRuntimeLabel: "AmazFlow managed AI",
        dataBoundary: process.env.DATA_BOUNDARY,
      });
    }
    if (route === "POST /settings") {
      if (a.role !== "SUPER_ADMIN")
        return reply(403, {
          error: "Only AmazFlow administrators change platform settings",
        });
      try {
        const body = JSON.parse(e.body || "{}");
        const next = await saveSettings(body);
        await logActivity("amazflow", {
          actor: a.userId,
          actorLabel: "AmazFlow super admin",
          action: "SETTINGS_CHANGED",
          summary: "Updated platform timeout settings",
        });
        return reply(200, next);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /support/tickets") {
      try {
        const ticket = await createTicket(a, JSON.parse(e.body || "{}"));
        return reply(201, ticket);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "GET /support/tickets") {
      let items = await scanType("TICKET#", a);
      if (a.role === "FRONTLINE")
        items = items.filter((t) => t.createdBy === a.userId);
      return reply(
        200,
        items.sort((x, y) =>
          String(y.createdAt).localeCompare(String(x.createdAt)),
        ),
      );
    }
    if (route === "POST /support/tickets/{id}/status") {
      try {
        const ticket = await updateTicket(
          e.pathParameters?.id,
          a,
          JSON.parse(e.body || "{}"),
        );
        return reply(200, ticket);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "GET /connections/browser") {
      try {
        return reply(200, await listBrowserConnections(a));
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /connections/browser") {
      try {
        return reply(
          201,
          await createBrowserConnection(a, JSON.parse(e.body || "{}")),
        );
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /connections/browser/{id}/login-session") {
      try {
        return reply(201, await startBrowserLogin(a, e.pathParameters?.id));
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /connections/browser/{id}/login-session/complete") {
      try {
        return reply(
          200,
          await completeBrowserLogin(
            a,
            e.pathParameters?.id,
            JSON.parse(e.body || "{}"),
          ),
        );
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "DELETE /connections/browser/{id}") {
      try {
        return reply(
          200,
          await revokeBrowserConnection(a, e.pathParameters?.id),
        );
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    return reply(404, { error: "Route not found" });
  } catch (err) {
    console.error(err);
    if (useAgentCore()) emitApplicationMetric("AgentFailure");
    return reply(500, { error: err.message || "Control plane error" });
  }
};
