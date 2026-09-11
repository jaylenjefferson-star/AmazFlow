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
  DeleteItemCommand,
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
// The permissions policy. This is the ONLY source of an authorization decision in this file: after
// Phase 2 no route compares a role string, and the staff/tenant boundary is a single named predicate
// rather than eleven copies of `role !== "SUPER_ADMIN" && x !== a.tenantId`.
const {
  can,
  coarseOf,
  defaultRoleForGroup,
  roleIsReachableFromGroup,
  isInternalPermission,
  isStaffGroup,
  maySetConcurrencyLimit,
  isInvitableGroup,
  permissionMatrix,
  visibleSections,
  statusForDecision,
  messageForDecision,
  ROLE_GRANTS,
  STAFF_GRANTS,
  PLATFORM_ROLES,
  CUSTOMER_ROLES,
  PERMISSIONS,
} = require("@amazflow/permissions");
const { ExecutionGrantService, WorkflowEngine } = require("@amazflow/engine");
const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  PutSecretValueCommand,
  DeleteSecretCommand,
} = require("@aws-sdk/client-secrets-manager");
const {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminUserGlobalSignOutCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const db = new DynamoDBClient({});
const bedrock = new BedrockRuntimeClient({});
const ses = new SESv2Client({});
const secrets = new SecretsManagerClient({});
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
// Production receives only the Secrets Manager identifier. The value is fetched after cold start
// and retained solely in this process for grant signing/verification; it is never put into a
// template, response, run, audit record, or log. The direct value fallback keeps local harnesses
// and one-shot development tools usable while deployment uses EXECUTION_GRANT_SECRET_ID only.
let executionGrantsPromise;
const getExecutionGrants = async () => {
  if (!executionGrantsPromise)
    executionGrantsPromise = (async () => {
      let secret = process.env.EXECUTION_GRANT_SECRET;
      if (!secret) {
        const secretId = process.env.EXECUTION_GRANT_SECRET_ID;
        if (!secretId) return null;
        const value = await secrets.send(
          new GetSecretValueCommand({ SecretId: secretId }),
        );
        secret = value.SecretString;
      }
      if (!secret)
        throw new Error("Execution grant secret is empty or unavailable");
      return new ExecutionGrantService(secret, 300);
    })();
  return executionGrantsPromise;
};
const privateResponseFields = new Set([
  "managedProfileId",
  "agentSessionId",
  "browserSessionId",
]);

// Requirement 27.11: every route has an explicit top-level response contract. The previous global
// denylist only removed three known-sensitive names, which meant a newly-added database field was
// returned automatically. These allowlists invert that default: a new field is absent until the route
// that owns it names it here. Nested values are still passed through the private-field replacer below,
// so identifiers such as managedProfileId remain server-only at every depth.
const RESPONSE_FIELD_GROUPS = {
  ack: ["ok", "id", "username", "email", "enabled", "deleted", "read", "revoked", "revokedInvitations", "invitationId", "acceptUrl", "previousRole", "role", "coarseGroup"],
  health: ["ok", "service", "boundary", "aiRuntime"],
  me: ["userId", "tenantId", "organizationId", "organizationName", "email", "role", "platformRole", "teamIds", "sections", "lastLoginAt", "accountStatus"],
  profile: ["email", "displayName", "givenName", "familyName", "updatedAt"],
  security: ["accessTokenMinutes", "idTokenMinutes", "refreshTokenDays", "passwordPolicy", "mfaEnrollmentAvailable", "singleSignOnAvailable", "directoryProvisioningAvailable"],
  organization: ["id", "tenantId", "name", "slug", "status", "plan", "createdAt", "updatedAt", "branding", "settings", "primaryDomain", "primaryContact", "billingContact", "accountOwnerUserId", "crmRecordId", "activatedAt", "onboardingStatus", "lifecycleStatus"],
  onboarding: ["tenantId", "status", "crmReference", "internalOwner", "milestones", "checklist", "internalNotes", "updatedAt"],
  user: ["username", "email", "role", "platformRole", "teamIds", "enabled", "userStatus", "state", "membershipStatus", "invitedAt", "invitedBy", "activatedAt", "lastLoginAt", "createdAt", "updatedAt"],
  team: ["id", "tenantId", "name", "memberUsernames", "createdAt", "updatedAt", "deleted"],
  teams: ["teams", "grantsPermissions", "grantsPermissionsReason"],
  invitation: ["organizationName", "organizationId", "email", "role", "acceptUrl", "invitationId", "username", "enabled", "userStatus", "createdAt"],
  notification: ["id", "tenantId", "audience", "kind", "title", "body", "deepLink", "createdAt", "read", "eventId"],
  preferences: ["username", "values", "updatedAt", "keys"],
  // `allowedProviders`, `dataClass`, `customerSummary` and `trigger` are part of the definition the
  // builder round-trips: the draft route validates `allowedProviders` on save, so a response that
  // stripped it would hand back a definition that fails its own validation on the next save.
  // The lifecycle timestamps are here because a workflow that says "Published" without saying when,
  // or by whom, is asking the reader to take it on trust.
  workflow: ["id", "tenantId", "name", "description", "version", "status", "startAt", "steps", "assignedRoles", "allowedProviders", "dataClass", "customerSummary", "trigger", "inputSchema", "manualMinutesEstimate", "createdBy", "createdAt", "updatedAt", "publishedAt", "publishedBy", "unpublishedAt", "archivedAt", "archivedBy", "duplicatedFromWorkflowId", "duplicatedFromVersion", "generatedFromDescription", "requiredSurfaces", "requiredTargets", "targets", "ready", "checks"],
  // Preflight gets its own contract rather than borrowing the workflow one. It is not a workflow: it
  // is a readiness report, and `surfaces` -- the per-surface status, recovery action and agent list
  // that is the entire point of the route -- was silently stripped while the route reused the
  // workflow group. A route whose response shape differs needs its own entry, or the allowlist
  // quietly turns a useful answer into a shorter one.
  preflight: ["workflowId", "requiredTargets", "surfaces", "ready"],
  // `isTest` marks a run started from a `testing`-status workflow. Returned, not hidden: a person
  // looking at a run needs to know whether it was a rehearsal, and so does anyone reading the list.
  run: ["id", "tenantId", "workflowId", "workflowVersion", "workflowName", "status", "currentStepId", "createdBy", "createdAt", "startedAt", "updatedAt", "completedAt", "input", "context", "audit", "steps", "output", "error", "isTest", "testRun", "resumedFromRunId", "grant", "result", "usage", "traceId", "aiRuntimeLabel", "ok", "runId", "stepId", "recordedAt"],
  // A task an agent is offered has to carry the work: `input` is the action's arguments, `expiresAt`
  // is the deadline the agent honours, and `destination` is the origin or application it is allowed
  // to touch. Without those three the poll response is a list of identifiers an agent cannot act on,
  // which is what the first, narrower version of this group produced.
  task: ["id", "tenantId", "runId", "stepId", "provider", "operation", "input", "status", "executionTarget", "destination", "requiredCapabilities", "assignedRoles", "workflowId", "expiresAt", "createdBy", "createdAt", "updatedAt", "claimedBy", "claimedAt", "claimExpiresAt", "grant", "grantId", "result", "eligibilityReason"],
  // The claim envelope is not a task: it wraps one, alongside the single-use grant, the lease
  // deadline, the verification contract, and the `display` block both agents render instead of
  // showing identifiers to a person. Sharing the task contract stripped every one of those.
  claim: ["task", "grant", "grantId", "runId", "stepId", "workflowId", "claimExpiresAt", "verify", "executionTarget", "destination", "display"],
  // `organizationId` and `lastSeenAt` are both part of the shape `GET /agents` has always returned:
  // the first comes from agentSnapshot, the second is what the existing staff console renders "last
  // seen" from. Omitting them turned a working agent list into one that reported "never connected".
  agent: ["id", "tenantId", "organizationId", "name", "status", "connectionStatus", "agentType", "capabilities", "allowedDomains", "platform", "version", "permissions", "lastSeenAt", "lastHeartbeatAt", "createdBy", "createdAt", "updatedAt", "code", "expiresAt", "installationId", "agent", "token", "agentId", "agentName", "userId", "userRole", "ok"],
  connection: ["id", "tenantId", "name", "baseUrl", "allowedOrigins", "preferredMode", "status", "createdBy", "createdAt", "updatedAt", "loginSessionId", "expiresAt", "ready", "message"],
  // Never `ref` (the Secrets Manager pointer) and never a value -- requirement 20.8. `deleted` is
  // present only in the delete route's ack, matching the `team` group's convention below.
  secret: ["id", "tenantId", "name", "kind", "hint", "createdBy", "createdAt", "rotatedAt", "lastUsedAt", "deleted"],
  audit: ["id", "tenantId", "at", "actor", "actorLabel", "action", "summary", "details", "correlationId"],
  ticket: ["id", "tenantId", "subject", "message", "status", "createdBy", "createdAt", "updatedAt", "category", "priority"],
  lead: ["id", "tenantId", "name", "email", "company", "role", "workflow", "volume", "message", "source", "status", "createdAt"],
  settings: ["taskExpiryMs", "confirmationExpiryMs", "agentCodeExpiryMs", "aiRuntimeLabel", "dataBoundary", "updatedAt"],
  matrix: ["roles", "permissions", "grants"],
  copilot: ["id", "tenantId", "status", "messages", "actions", "role", "content", "createdAt", "updatedAt", "result", "usage", "traceId"],
  // Time saved is an estimate against a customer-supplied manual duration. A dollar figure would
  // imply a labor rate the platform neither stores nor verifies, so it is never returned.
  summary: ["totalRunsCompleted", "totalMinutesSaved"],
};
const RESPONSE_FIELDS_BY_ROUTE = new Map();
const allowResponseFields = (routes, group) => {
  const fields = new Set(RESPONSE_FIELD_GROUPS[group]);
  for (const route of routes) RESPONSE_FIELDS_BY_ROUTE.set(route, fields);
};
allowResponseFields(["GET /health"], "health");
allowResponseFields(["POST /leads", "POST /me/sessions/revoke", "POST /me/password-changed", "POST /notifications/{id}/read", "POST /notifications/read-all", "POST /tenants/{tenantId}/users/{username}/sessions/revoke", "POST /tenants/{tenantId}/users/{username}/status"], "ack");
allowResponseFields(["GET /me"], "me");
allowResponseFields(["GET /me/profile", "PUT /me/profile"], "profile");
allowResponseFields(["GET /security/facts"], "security");
allowResponseFields(["GET /me/preferences", "PUT /me/preferences"], "preferences");
allowResponseFields(["GET /organizations", "POST /organizations", "GET /organizations/{slug}", "PUT /organizations/{slug}", "POST /organizations/{slug}/profile", "POST /organizations/{slug}/settings", "POST /organizations/{slug}/branding", "GET /organizations/{slug}/branding"], "organization");
allowResponseFields(["GET /onboarding", "POST /onboarding/checklist/{step}", "GET /organizations/{slug}/onboarding", "PUT /organizations/{slug}/onboarding"], "onboarding");
allowResponseFields(["GET /tenants/{tenantId}/users"], "user");
allowResponseFields(["POST /tenants/{tenantId}/users/{username}/role", "POST /tenants/{tenantId}/users/{username}/invitation/resend", "DELETE /tenants/{tenantId}/users/{username}/invitation"], "ack");
allowResponseFields(["POST /tenants/{tenantId}/users"], "invitation");
allowResponseFields(["GET /invitations/{token}", "POST /invitations/{token}/accept"], "invitation");
allowResponseFields(["GET /teams"], "teams");
allowResponseFields(["POST /teams", "PUT /teams/{id}", "DELETE /teams/{id}", "POST /teams/{id}/members", "DELETE /teams/{id}/members/{username}"], "team");
allowResponseFields(["GET /notifications"], "notification");
allowResponseFields(["GET /permissions/matrix"], "matrix");
allowResponseFields(["GET /workflows", "POST /workflows", "POST /workflows/generate", "GET /workflows/{id}/versions", "POST /workflows/{id}/draft", "POST /workflows/{id}/publish", "POST /workflows/{id}/unpublish", "POST /workflows/{id}/duplicate", "POST /workflows/{id}/archive"], "workflow");
allowResponseFields(["GET /workflows/{id}/preflight"], "preflight");
allowResponseFields(["GET /runs", "POST /workflows/{id}/runs", "POST /runs/{id}/cancel", "POST /runs/{id}/resume", "POST /runs/{id}/confirmations/{stepId}/confirm", "POST /runs/{id}/approvals/{stepId}", "POST /runs/{id}/executor/invoke", "POST /agent-tasks/{id}/result", "POST /agent/tasks/{id}/result", "POST /agent/tools/record-step-result", "POST /ai/execute"], "run");
allowResponseFields(["GET /agent-tasks", "GET /agent/tasks"], "task");
allowResponseFields(["POST /agent/tasks/{id}/claim"], "claim");
allowResponseFields(["GET /agents", "POST /agent-authorizations", "POST /agent-authorizations/{code}/exchange", "POST /agents/{id}/revoke", "POST /agent/heartbeat"], "agent");
allowResponseFields(["GET /connections/browser", "POST /connections/browser", "POST /connections/browser/{id}/login-session", "POST /connections/browser/{id}/login-session/complete", "DELETE /connections/browser/{id}"], "connection");
allowResponseFields(["GET /secrets", "POST /secrets", "POST /secrets/{id}/rotate", "DELETE /secrets/{id}"], "secret");
allowResponseFields(["GET /audit", "GET /activity"], "audit");
allowResponseFields(["GET /support/tickets", "POST /support/tickets", "POST /support/tickets/{id}/status"], "ticket");
allowResponseFields(["GET /leads"], "lead");
allowResponseFields(["GET /settings", "POST /settings"], "settings");
allowResponseFields(["GET /copilot/actions", "GET /copilot/conversation", "POST /copilot/messages", "POST /copilot/actions/{id}/apply", "POST /copilot/actions/{id}/discard"], "copilot");
allowResponseFields(["GET /tenants/{tenantId}/summary"], "summary");
const ERROR_RESPONSE_FIELDS = new Set([
  "error", "code", "message", "correlationId", "retryAfterSeconds", "allowedEmailDomains",
  "organizationName", "email", "organizationStatus", "limit", "inFlight", "preflight",
]);
let responseRoute = "UNSET";
const projectRouteResponse = (route, status, body) => {
  if (body === null || body === undefined || typeof body !== "object") return body;
  const fields = status >= 400 ? ERROR_RESPONSE_FIELDS : RESPONSE_FIELDS_BY_ROUTE.get(route);
  // Fail closed for a successful response whose route forgot to declare a contract. Error envelopes
  // remain useful even for an unknown route, but success data never leaves under an implicit schema.
  if (!fields) {
    console.error("response allowlist missing", { route, status });
    return {};
  }
  const one = (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => fields.has(key)));
  };
  return Array.isArray(body) ? body.map(one) : one(body);
};
// One correlation identifier per invocation, so a customer reporting "it said forbidden" can be
// matched to the exact log line. Set once at the top of the handler; a Lambda container serves one
// invocation at a time, so module scope is the right lifetime.
let correlationId = null;
// Requirement 26.12: one structured log line per request, carrying route, user, organization,
// status, duration, and the permission last evaluated for it. Same module-scope lifetime as
// correlationId above -- these are read by reply() at the very end of the invocation they describe.
let requestStartedAt = null;
let requestUserId = null;
let requestOrgId = null;
let lastPermissionCheck = null;
let requestTruncated = false;
let requestReadTruncated = false;
let responsePagination = null;
const CODE_FOR_STATUS = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_ERROR",
  502: "UPSTREAM_ERROR",
  503: "UNAVAILABLE",
};
// The structured error envelope, added alongside the flat `error` field rather than replacing it:
// the deployed frontend still reads `error`, so removing it would break every error message in the
// product on the day this shipped. Both shapes are emitted until the frontend has moved over.
//
// `code` is the machine-readable half and must stay stable while prose changes, so it is NEVER
// derived from the message. It is either passed explicitly by the call site (NO_ORGANIZATION,
// SESSION_REVOKED) or falls back to the status's own name, which is stable by construction.
const withErrorEnvelope = (status, body) => {
  if (status < 400 || !body || typeof body !== "object" || typeof body.error !== "string")
    return body;
  return {
    ...body,
    code: body.code || CODE_FOR_STATUS[status] || "ERROR",
    message: body.message || body.error,
    correlationId,
  };
};
// Task 9.10 / requirement 1.8-1.10: the three surfaces, echoed one at a time.
//
// This replaced `access-control-allow-origin: *`. The wildcard was not merely untidy: it told every
// browser on the internet that any page, on any origin, may read this API's responses. Bearer-token
// auth means a drive-by page cannot get a token, so the wildcard was not directly exploitable -- but
// "not exploitable given the current auth scheme" is a property of the auth scheme, not of the header,
// and the header outlives the scheme.
//
// Exactly one origin is echoed, and only if it is on the list. An unknown origin gets NO header at all
// rather than a refusal, which is the correct shape: the browser then refuses the read itself.
// `vary: origin` is required because the response now differs per origin and any cache in front of
// this must not serve one surface's response to another.
const ALLOWED_ORIGINS = [
  "https://amazflow.com",
  "https://www.amazflow.com",
  "https://app.amazflow.com",
  "https://admin.amazflow.com",
];
let requestOrigin = null;
const allowedOriginFor = (e) => {
  const h = (e && e.headers) || {};
  const raw = h.origin || h.Origin;
  return typeof raw === "string" && ALLOWED_ORIGINS.includes(raw) ? raw : null;
};
const corsHeaders = () =>
  requestOrigin ? { "access-control-allow-origin": requestOrigin, vary: "origin" } : {};
// Requirement 26.12: one structured line per request. Deliberately excludes everything the
// requirement names -- secrets, tokens, grant payloads, customer input, run context values,
// evidence bodies, full email addresses -- by construction: it names only the request's shape
// (route, who, which org, outcome, timing, the permission decision), never any request or response
// body content.
const logRequest = (status) => {
  console.log(
    JSON.stringify({
      correlationId,
      routeKey: responseRoute,
      userId: requestUserId,
      orgId: requestOrgId,
      status,
      durationMs: requestStartedAt ? Date.now() - requestStartedAt : null,
      permission: lastPermissionCheck ? lastPermissionCheck.permission : null,
      decision: lastPermissionCheck ? lastPermissionCheck.decision : null,
    }),
  );
};
const reply = (s, b) => {
  const projected = projectRouteResponse(responseRoute, s, withErrorEnvelope(s, b));
  logRequest(s);
  return {
    statusCode: s,
    headers: {
      "content-type": "application/json",
      // Requirement 26.12: returned on every response, not only errors -- the shared API client
      // already reads this header as a fallback (packages/api-client), so a success response
      // carrying it is completing an existing contract, not adding a new one.
      ...(correlationId ? { "x-correlation-id": correlationId } : {}),
      ...(requestTruncated ? { "x-amazflow-list-truncated": "true" } : {}),
      ...(responsePagination
        ? {
            "x-page-size": String(responsePagination.pageSize),
            ...(responsePagination.nextCursor
              ? { "x-next-cursor": responsePagination.nextCursor }
              : {}),
            "x-list-truncated": responsePagination.truncated ? "true" : "false",
          }
        : {}),
      ...corsHeaders(),
    },
    body: JSON.stringify(projected, (key, value) =>
      privateResponseFields.has(key) ? undefined : value,
    ),
  };
};
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
  const matchedRole = ["SUPER_ADMIN", "CLIENT_ADMIN", "FRONTLINE"].find((r) =>
    groups.includes(r),
  );
  const tenantId = c["custom:tenant_id"];
  const hasOrganization = typeof tenantId === "string" && tenantId.trim() !== "";
  // A token with no organization claim yields NO usable principal. `role` is deliberately left
  // undefined in that case rather than being returned alongside a missing tenantId, because every
  // authorization check in this file is written as `a.role === ...` or `a.role !== ...` -- so a
  // principal with no organization fails all of them, including any check somebody adds later
  // without thinking about this. `reason` exists only so the refusal can say which of the two
  // things is missing.
  if (!hasOrganization)
    return {
      userId: c.sub,
      email: c.email,
      tenantId: undefined,
      role: undefined,
      reason: "no_organization",
    };
  return {
    userId: c.sub,
    email: c.email,
    tenantId,
    role: matchedRole,
    reason: matchedRole ? undefined : "no_role",
  };
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
/* ============================== Phase 5: workflows, the status model, and the builder ========= */

// The persisted workflow status set (requirement 13.1, design decision D-5). `active` still means
// published-and-runnable: it is the value this file's run gate, `preflightFor` and the
// managed-connection check all read, so renaming it to `published` would rename the one string the
// execution path depends on in exchange for a word on a screen. The Published label lives in the
// shared label mapping, which is what that module is for.
const WORKFLOW_STATUSES = ["draft", "testing", "active", "archived"];
// `paused` predates that set and still exists in stored records. It stays READABLE and is never
// written again (requirement 13.3): a record that is merely old must not read as a record that is
// corrupt, or the workflow disappears from its owner's list instead of displaying as Archived.
const LEGACY_WORKFLOW_STATUSES = ["paused"];
const READABLE_WORKFLOW_STATUSES = [...WORKFLOW_STATUSES, ...LEGACY_WORKFLOW_STATUSES];
// The only two statuses the run gate admits (requirement 13.4). Everything else is a state conflict.
const RUNNABLE_WORKFLOW_STATUSES = ["active", "testing"];
const isRunnableWorkflowStatus = (status) => RUNNABLE_WORKFLOW_STATUSES.includes(status);
// The reserved path value on POST /workflows/{id}/draft that means "mint an identifier". Every real
// identifier is server-minted (`wf_...`), so this can never collide with one.
const NEW_WORKFLOW_SENTINEL = "new";

// The action vocabulary each execution surface can carry out. These are the same two lists as
// BROWSER_ACTIONS/DESKTOP_ACTIONS in @amazflow/workflow-schema, and they are what makes
// surface-to-action pairing checkable at save time rather than at dispatch time. The previous
// canonical copy carried a hand-written nine-entry subset for claim eligibility, which silently
// refused every desktop action and every NAVIGATE -- so the two control-plane copies disagreed about
// what an agent is allowed to be offered.
const BROWSER_ACTIONS = [
  "NAVIGATE", "READ_TEXT", "CLICK", "TYPE", "SELECT", "CHECK",
  "SCROLL_TO", "WAIT_FOR", "VERIFY_TEXT", "CAPTURE_EVIDENCE", "SET_EMPLOYEE_STATUS",
];
// Deliberately narrow: enough to drive an approved desktop procedure, with no shell, no arbitrary
// code, no filesystem access and no credential surface.
const DESKTOP_ACTIONS = [
  "desktop.open_app", "desktop.focus_window", "desktop.click", "desktop.type_text",
  "desktop.keypress", "desktop.wait_for", "desktop.verify_text", "desktop.capture_evidence",
];
const ACTIONS_BY_SURFACE = {
  browser_extension: BROWSER_ACTIONS,
  desktop_agent: DESKTOP_ACTIONS,
};
// The provider fully determines the surface, so a builder never has to offer an invalid pairing and
// an older workflow gets the right surface without being rewritten. Providers absent from this table
// (api, spreadsheet, email, file, mock) are ones AmazFlow runs itself: nothing is dispatched.
const AGENT_SURFACE_FOR_PROVIDER = { browser: "browser_extension", desktop: "desktop_agent" };
const SURFACE_NAME = { browser_extension: "Chrome Extension", desktop_agent: "Desktop App" };
// Which surfaces a workflow needs installed before it can run, DERIVED from its own steps. Never a
// stored field: a stored list is a second source of truth that drifts from the steps.
const requiredSurfacesFor = (workflow) => [
  ...new Set(
    (workflow.steps || [])
      .filter((step) => step && step.type === "action")
      .map((step) => step.executionTarget || AGENT_SURFACE_FOR_PROVIDER[step.provider])
      .filter(Boolean),
  ),
];

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
// Keep in step with `stepProviderSchema` in @amazflow/workflow-schema and with
// VALID_PROVIDERS in the deployed template. "desktop" belongs here: the builder offers it,
// the shared schema accepts it, and the Desktop Agent executes it -- omitting it rejected
// every desktop workflow at save time with a message blaming the provider.
const VALID_PROVIDERS = [
  "browser",
  "desktop",
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
    // Provider allowlisting (requirement 13.9). `allowedProviders` is the definition's own statement
    // of which providers it may touch, and it is the mechanism by which a workflow reviewed as
    // browser-only cannot silently acquire a desktop step. Enforced only when the field is present,
    // because older stored definitions predate it and rejecting those would make an existing
    // workflow unsavable on its next edit.
    if (
      step.type === "action" &&
      Array.isArray(draft.allowedProviders) &&
      draft.allowedProviders.length > 0 &&
      !draft.allowedProviders.includes(step.provider)
    )
      return `Step "${step.id}" uses the ${step.provider} provider, which this workflow does not allow (allowed: ${draft.allowedProviders.join(", ")})`;
    // Execution surface-to-action pairing (requirement 13.9, 14.2). The provider fully determines the
    // surface, so this is not a second declaration to keep in step -- it is a check that the step's
    // own operation belongs to the vocabulary of the surface its provider implies. Without it a
    // desktop operation can be saved on a browser step, and the failure surfaces much later as an
    // agent that is offered work it has no capability for and simply never claims.
    if (step.type === "action") {
      const surface = AGENT_SURFACE_FOR_PROVIDER[step.provider];
      if (surface && step.executionTarget && step.executionTarget !== surface)
        return `Step "${step.id}" runs on the ${SURFACE_NAME[surface]}, so it cannot target ${step.executionTarget}`;
      if (!surface && step.executionTarget)
        return `Step "${step.id}" uses the ${step.provider} provider, which AmazFlow runs itself and cannot be assigned to an agent`;
      if (surface && !ACTIONS_BY_SURFACE[surface].includes(step.operation))
        return `"${step.operation}" is not an action the ${SURFACE_NAME[surface]} can perform`;
      // Browser connection fields belong to the browser provider alone. A `connectionId` on a
      // spreadsheet step is not harmless clutter: it reads as a dependency the connections view
      // would then report, on a step that will never use it.
      if (step.provider !== "browser" && (step.connectionId || step.browserMode || step.path))
        return `Step "${step.id}" can only use browser connection fields with the browser provider`;
    }
    const refs = [
      step.next,
      step.type === "condition" ? step.whenTrue : undefined,
      step.type === "condition" ? step.whenFalse : undefined,
      step.type === "approval" ? step.onReject : undefined,
      step.type === "verify" ? step.onFailure : undefined,
      step.type === "action" ? step.onFailure : undefined,
    ].filter(Boolean);
    for (const ref of refs)
      if (!ids.has(ref))
        return `Step "${step.id}" references missing step "${ref}"`;
  }
  return null;
};
/**
 * The two ways generation can fail, kept apart on purpose (requirement 14.5).
 *
 * `422` means a candidate was produced and did not satisfy the schema -- a statement about the
 * candidate, which the person can act on by rewording their description. `503` means no candidate was
 * produced at all because the managed service is not configured or did not answer, which is a
 * statement about AmazFlow. Collapsing both into 422 told a customer their description was invalid
 * when the truth was that the generator was switched off.
 */
class GenerationUnavailable extends Error {
  constructor(message) {
    super(message);
    this.status = 503;
  }
}
class GenerationInvalid extends Error {
  constructor(message) {
    super(message);
    this.status = 422;
  }
}
const generateWorkflowFromSop = async (sop, tenantId) => {
  const system =
    'You design AmazFlow workflow definitions as JSON. A workflow has: id, tenantId, name, description, version, status, dataClass, assignedRoles (array of FRONTLINE/CLIENT_ADMIN/SUPER_ADMIN), startAt, allowedProviders, steps. Each step has a unique id, name, and type: "ai" (operation, prompt, outputKey, allowedValues?, confidenceThreshold?, next), "condition" (path, operator: equals|notEquals|exists|gt|lt, value, whenTrue, whenFalse), "approval" (message, roles, next, onReject?), "action" (provider: browser|api|spreadsheet|email|file|mock -- ONLY these six exact strings, never invent another provider name, next), "verify" (path, operator, value, next, onFailure?), or "end" (outcome: success|failed). Every step id referenced by next/whenTrue/whenFalse/onReject/onFailure must exist in steps, and every path traced from startAt must reach an end step. Put a human approval step before any high-impact action (access changes, financial actions, deletions, anything hard to undo). Return ONLY the JSON object -- no prose, no markdown fences.';
  const basePrompt = `Design a workflow for this standard operating procedure:\n${sop}\n\nUse tenantId "${tenantId}". Set status to "draft". Use a short kebab-case id starting with "workflow-".`;
  if (useAgentCore()) {
    if (!executionHarnessArn)
      throw new GenerationUnavailable(
        "The workflow generator is not configured in this environment, so no draft can be produced from a description. Build the workflow in the editor instead.",
      );
    let response;
    try {
      response = await agentCoreRuntime.invoke({
        harnessArn: executionHarnessArn,
        sessionId: `sop-${crypto.randomUUID()}`,
        prompt: basePrompt,
        systemPrompt: system,
        allowedTools: [],
        maxIterations: 1,
        maxTokens: 3000,
      });
    } catch (err) {
      throw new GenerationUnavailable(
        "The workflow generator did not answer. Try again, or build the workflow in the editor.",
      );
    }
    let draft;
    try {
      draft = JSON.parse(response.text);
    } catch {
      throw new GenerationInvalid("The generator did not return a workflow definition");
    }
    draft.tenantId = tenantId;
    draft.status = "draft";
    draft.version = 1;
    if (!draft.id) draft.id = `workflow-${Date.now().toString(36)}`;
    const shapeError = validateWorkflowShape(draft);
    if (shapeError)
      throw new GenerationInvalid(`Could not generate a valid workflow: ${shapeError}`);
    return draft;
  }
  assertLegacyEnabled();
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nYour previous attempt was invalid: ${lastError}. Fix that specific problem and return the corrected JSON object.`;
    let out;
    try {
      out = await bedrock.send(
        new ConverseCommand({
          modelId: process.env.BEDROCK_MODEL_ID,
          system: [{ text: system }],
          messages: [{ role: "user", content: [{ text: prompt }] }],
          inferenceConfig: { maxTokens: 3000, temperature: 0.2 },
        }),
      );
    } catch (err) {
      throw new GenerationUnavailable(
        "The workflow generator did not answer. Try again, or build the workflow in the editor.",
      );
    }
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
  throw new GenerationInvalid(`Could not generate a valid workflow: ${lastError}`);
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
// DynamoDB caps a Scan/Query page at 1 MB and hands back LastEvaluatedKey for the rest.
// Dropping that key does not read less data -- it silently reads the WRONG data: a by-id
// lookup layered on top starts 404ing at random, and the expiry sweep stops seeing the
// records it exists to expire. Both paths below now drain every page.
//
// PAGE_GUARD bounds a pathological table so a single invocation cannot spin forever; hitting
// it is a real operational signal, not something to swallow.
const PAGE_GUARD = 200;
// The two paged primitives, split out of scanType so that "which partition am I reading?" is a
// property of the CALLER's named function rather than a branch inside a shared helper. The branch was
// correct; the problem was that every reader of a call site had to know what scanType would decide on
// their behalf.
//
// Cross-tenant reads use the indexed projection when deployed. The fallback is retained for
// existing tables during the migration window, but remains paged and advertises truncation.
const crossOrganizationIndex = process.env.CROSS_ORG_INDEX_NAME || "CrossOrganizationIndex";
const pagedScan = async (type) => {
  if (process.env.CROSS_ORG_INDEX_ENABLED === "true")
    return pagedIndexedRead(type);
  const items = [];
  let cursor;
  let pages = 0;
  do {
    const out = await db.send(new ScanCommand({ TableName: table, ExclusiveStartKey: cursor }));
    for (const i of out.Items || []) {
      if (i.sk?.S?.startsWith(type) && i.document?.S) items.push(parse(i));
    }
    cursor = out.LastEvaluatedKey;
  } while (cursor && ++pages < PAGE_GUARD);
  if (cursor) reportTruncation(type, pages);
  return items;
};
const pagedIndexedRead = async (type) => {
  const items = [];
  let cursor;
  let pages = 0;
  do {
    const out = await db.send(new QueryCommand({
      TableName: table,
      IndexName: crossOrganizationIndex,
      KeyConditionExpression: "gsi1pk = :type",
      ExpressionAttributeValues: { ":type": { S: type } },
      ExclusiveStartKey: cursor,
    }));
    for (const i of out.Items || []) if (i.document?.S) items.push(parse(i));
    cursor = out.LastEvaluatedKey;
  } while (cursor && ++pages < PAGE_GUARD);
  if (cursor) reportTruncation(type, pages);
  return items;
};
const pagedQuery = async (pk, type) => {
  const items = [];
  let cursor;
  let pages = 0;
  do {
    const out = await db.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": { S: pk }, ":prefix": { S: type } },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const i of out.Items || []) {
      if (i.document?.S) items.push(parse(i));
    }
    cursor = out.LastEvaluatedKey;
  } while (cursor && ++pages < PAGE_GUARD);
  if (cursor) reportTruncation(type, pages);
  return items;
};
// Truncation means results are incomplete. Say so loudly rather than returning a plausible-looking
// partial list.
const reportTruncation = (type, pages) => {
  requestTruncated = true;
  requestReadTruncated = true;
  console.error(
    JSON.stringify({
      level: "error",
      event: "SCAN_TRUNCATED",
      type,
      pages,
      message: "Paged read hit PAGE_GUARD; results are incomplete",
    }),
  );
  emitApplicationMetric("ScanTruncated");
};
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;
const opaqueCursor = (offset) =>
  Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
const readCursor = (value) => {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!Number.isInteger(parsed.offset) || parsed.offset < 0) throw new Error("invalid");
    return parsed.offset;
  } catch {
    throw { status: 400, message: "The pagination cursor is invalid", code: "INVALID_CURSOR" };
  }
};
const paginateList = (items, query = {}) => {
  const rawSize = query.pageSize ?? query.page_size;
  const pageSize = rawSize === undefined ? PAGE_SIZE_DEFAULT : Number(rawSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE_MAX)
    throw {
      status: 400,
      message: `pageSize must be an integer between 1 and ${PAGE_SIZE_MAX}`,
      code: "INVALID_PAGE_SIZE",
    };
  const offset = readCursor(query.cursor);
  const page = items.slice(offset, offset + pageSize);
  const nextOffset = offset + page.length;
  responsePagination = {
    pageSize,
    nextCursor: nextOffset < items.length ? opaqueCursor(nextOffset) : null,
    truncated: requestReadTruncated,
  };
  return page;
};
// Retained as the compatibility shim for the engine-internal call sites that pass a bare
// { role: "SUPER_ADMIN" } rather than a principal. New code MUST use tenantRead, crossTenantRead or
// platformRead: those name their scope, take the organization from a principal rather than an
// argument, and audit a staff cross-organization read.
const scanType = async (type, a) =>
  isStaffGroup(a.role) ? pagedScan(type) : pagedQuery(`TENANT#${a.tenantId}`, type);
/* ==================================== principal, tenant scope, membership (Phase 2) ========== */

// The fine-grained role lives on a MEMBERSHIP# record (design decision D-3). Cognito stays
// authoritative for credentials, enabled state, and the coarse group, and wins on disagreement: a
// membership naming a role its group cannot reach is stale, and falling back to the group's default
// is the reading that cannot over-grant.
const membershipKey = (username) => `MEMBERSHIP#${username}`;
const readMembership = async (orgId, username) => {
  if (!orgId || !username) return null;
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: { pk: { S: `TENANT#${orgId}` }, sk: { S: membershipKey(username) } },
    }),
  );
  return out.Item && out.Item.document?.S ? JSON.parse(out.Item.document.S) : null;
};
const saveMembership = async (membership) =>
  db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: `TENANT#${membership.orgId}` },
        sk: { S: membershipKey(membership.username) },
        tenantId: { S: membership.orgId },
        document: { S: JSON.stringify(membership) },
        updatedAt: { S: now() },
      },
    }),
  );
// Lazy, read-triggered backfill. Nothing is migrated: the record is created the first time it is
// needed, carrying the role the account's group already implied, so day-one behaviour is identical by
// construction rather than by careful data entry.
const resolveMembership = async (orgId, username, group) => {
  const stored = await readMembership(orgId, username).catch(() => null);
  if (stored && stored.role && roleIsReachableFromGroup(stored.role, group)) return stored;
  const membership = {
    ...(stored || {}),
    orgId,
    username,
    role: defaultRoleForGroup(group),
    teamIds: stored && Array.isArray(stored.teamIds) ? stored.teamIds : [],
    status: (stored && stored.status) || "active",
    createdAt: (stored && stored.createdAt) || now(),
    updatedAt: now(),
    backfilled: !stored,
  };
  // Best effort: a write failure must not refuse the request. The resolved role is correct either
  // way -- persisting it only saves the next read from recomputing it.
  await saveMembership(membership).catch(() => {});
  return membership;
};
const principalFor = async (a) => {
  const group = a.role;
  const membership = await resolveMembership(a.tenantId, a.email || a.userId, group).catch(() => null);
  return {
    kind: "user",
    userId: a.userId,
    email: a.email,
    orgId: a.tenantId,
    tenantId: a.tenantId,
    group,
    role: (membership && membership.role) || defaultRoleForGroup(group),
    teamIds: (membership && membership.teamIds) || [],
    isStaff: isStaffGroup(group),
    membershipStatus: (membership && membership.status) || "active",
  };
};
// The agent execution path's principal. This elevation already existed and was HIDDEN: the agent
// routes synthesized `{ role: "SUPER_ADMIN" }` to read across organizations, so a real privilege
// elevation looked like a staff request in every log and every check. As its own kind it is
// greppable, cannot be handed to a human-facing route, and has to declare that its isolating control
// is the capability-aware claiming predicate rather than a partition key.
const agentPrincipalFor = (agentCtx) => ({
  kind: "agent",
  agentId: agentCtx.agentId,
  orgId: agentCtx.tenantId,
  tenantId: agentCtx.tenantId,
  agentType: agentCtx.agent?.agentType || "CHROME_EXTENSION",
  capabilities: agentCtx.agent?.capabilities || [],
  isStaff: false,
});
// Normalizes the legacy auth object ({ userId, email, tenantId, role: <coarse group> }) into a
// principal, so the tenancy fix could land at every call site without first rewriting the signature
// of every function that takes `a`. The scoping is what leaked, not the parameter shape.
// A list route wants "everything this principal may see": own partition for a customer, every
// organization for staff. One helper, so no route decides that for itself.
const tenantOrStaffRead = async (type, p) =>
  p.isStaff
    ? crossTenantRead(type, p, `staff listing ${type} across organizations`)
    : tenantRead(type, p);
// Cosmetic, but still a role comparison outside the policy -- and nine copies of it is nine chances
// to describe the same principal differently in the audit trail.
const actorLabelFor = (p) =>
  p.isStaff
    ? "AmazFlow super admin"
    : can(p, "user:invite", { orgId: p.orgId }).allow
      ? "Team admin"
      : "Team member";
const asPrincipal = (p) =>
  p && p.kind
    ? p
    : {
        kind: "user",
        userId: p.userId,
        email: p.email,
        orgId: p.tenantId,
        tenantId: p.tenantId,
        group: p.role,
        role: p.platformRole || defaultRoleForGroup(p.role),
        teamIds: [],
        isStaff: isStaffGroup(p.role),
      };

/**
 * The single sanctioned tenant-scoped read.
 *
 * The organization comes from the PRINCIPAL, never from an argument, so a caller cannot pass someone
 * else's. That is the whole difference from the old `scanType(type, a)`, which was correct only
 * because of where the scoping happened to sit.
 */
const tenantScope = (p) => ({ pk: `TENANT#${p.orgId}` });
const tenantRead = async (type, p) => {
  if (!p || !p.orgId)
    throw { status: 403, message: "No organization context", code: "NO_ORGANIZATION" };
  return pagedQuery(tenantScope(p).pk, type);
};
/**
 * The separately named cross-organization read: requires a stated reason and audits every staff call
 * (requirements 6.4 and 6.10; baseline defect D-3). Named so every call site is greppable.
 */
const crossTenantRead = async (type, p, reason) => {
  if (!reason) throw new Error("crossTenantRead requires a stated reason");
  if (!p || (!p.isStaff && p.kind !== "agent"))
    throw {
      status: 403,
      message: "Cross-organization reads are not available to this principal",
      code: "FORBIDDEN",
    };
  const items = await pagedScan(type);
  if (p.isStaff) await recordCrossTenantRead(p, type, reason);
  return items;
};
/**
 * The platform's own machinery -- the expiry sweep, engine internals resolving a run by id on a path
 * with no requesting principal at all. Named separately rather than reusing crossTenantRead so that
 * "a staff member looked at another organization's data" stays a distinct, countable event instead of
 * being drowned in scheduler noise.
 */
const platformRead = async (type, reason) => {
  if (!reason) throw new Error("platformRead requires a stated reason");
  return pagedScan(type);
};
// Reads stay a distinct, countable event from writes: "a staff member looked at another
// organization's data" is the question an audit reviewer actually asks.
const isReadPermission = (permission) => /:(read|read_all)$/.test(String(permission));
const recordCrossTenantAccess = async (p, permission, targetOrgId) => {
  emitApplicationMetric("CrossOrganizationAccess");
  try {
    await logActivity(targetOrgId, {
      actor: p.userId,
      actorLabel: "AmazFlow super admin",
      action: isReadPermission(permission) ? "CROSS_TENANT_READ" : "CROSS_TENANT_WRITE",
      summary: `Staff ${isReadPermission(permission) ? "read" : "change"} in another organization (${permission})`,
      details: { permission, targetOrgId, principalOrgId: p.orgId, principalRole: p.role },
    });
  } catch (err) {
    console.error("cross-tenant access audit failed", err && err.message);
  }
};
const recordCrossTenantRead = async (p, type, reason) => {
  emitApplicationMetric("CrossOrganizationAccess");
  try {
    await logActivity(p.orgId, {
      actor: p.userId,
      actorLabel: "AmazFlow super admin",
      action: "CROSS_TENANT_READ",
      summary: `Read ${type.replace("#", "").toLowerCase()} records across organizations`,
      details: { recordType: type, reason, principalRole: p.role },
    });
  } catch (err) {
    console.error("cross-tenant read audit failed", err && err.message);
  }
};
/**
 * Resolve one entity by bare id under the correct scope for the caller.
 *
 * For a non-staff principal the read itself is partitioned, so another organization's id is simply
 * NOT FOUND -- no comparison, nothing to leak, and no way for a later edit to reintroduce the 403
 * existence oracle. This is the pattern `GET /workflows/{id}/versions` always used.
 */
const resolveEntity = async (type, id, principal, reason) => {
  if (!id) return null;
  const p = asPrincipal(principal);
  const items = p.isStaff
    ? await crossTenantRead(type, p, reason)
    : await tenantRead(type, p);
  return items.find((x) => x.id === id) || null;
};
/**
 * The throwing authorization wrapper, with the denial audit and metric attached.
 *
 * Requirements 7.16 and 28.6: every denial records the permission, the resource, and the decision
 * code, which is what makes every 403 -- and every cross-organization 404 -- attributable.
 */
const authorizeIn = async (p, permission, resource) => {
  const decision = can(p, permission, resource);
  // Requirement 26.12: the structured log line names the permission a route evaluated and the
  // decision it got, alongside the request that made it -- guardIn() is a thin wrapper over this
  // same function, so both call shapes are covered from this one place.
  lastPermissionCheck = { permission, decision: decision.code };
  // A staff principal reaching into another organization is the event requirement 6.10 asks for, and
  // this is the one place that can see it for EVERY route -- including the parameter-scoped ones,
  // which resolve their record from the PLATFORM partition and so never pass through
  // crossTenantRead. Auditing at the authorization point rather than at the read means a route
  // cannot acquire cross-organization reach without also acquiring the audit event.
  if (decision.allow && p.isStaff && resource.orgId && resource.orgId !== p.orgId)
    await recordCrossTenantAccess(p, permission, resource.orgId);
  if (decision.allow) return;
  emitApplicationMetric("AuthorizationDenied");
  try {
    await logActivity(p.orgId, {
      actor: p.userId,
      actorLabel: p.isStaff ? "AmazFlow super admin" : "Team member",
      action: "AUTHORIZATION_DENIED",
      summary: `Refused ${permission} (${decision.code})`,
      details: {
        permission,
        decisionCode: decision.code,
        crossOrganization: decision.code === "WRONG_ORG",
        // NOT resource.orgId on a WRONG_ORG denial: that value IS the other organization's
        // identifier, and this record is readable by the customer through GET /audit. Writing it
        // here would put the leak straight back into the audit trail (requirement 6.7).
        resourceOrgId: decision.code === "WRONG_ORG" ? null : resource.orgId || null,
        resourceOwnerUserId: resource.ownerUserId || null,
        principalRole: p.role,
      },
    });
  } catch (err) {
    console.error("authorization denial audit failed", err && err.message);
  }
  throw {
    status: statusForDecision(decision.code),
    message: messageForDecision(decision),
    code: decision.code === "WRONG_ORG" ? "NOT_FOUND" : decision.code,
  };
};
/** Reply-returning form, for the route chain (which returns replies rather than throwing). */
const guardIn = async (p, permission, resource) => {
  try {
    await authorizeIn(p, permission, resource);
    return null;
  } catch (err) {
    if (err && err.status) return reply(err.status, { error: err.message, code: err.code });
    throw err;
  }
};

const save = async (type, doc) => {
  const result = await db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: `TENANT#${doc.tenantId}` },
        sk: { S: `${type}#${doc.id}` },
        gsi1pk: { S: `${type}#` },
        gsi1sk: { S: `${doc.tenantId}#${doc.createdAt || now()}#${doc.id}` },
        tenantId: { S: doc.tenantId },
        document: { S: JSON.stringify(doc) },
        updatedAt: { S: now() },
      },
    }),
  );
  if (type === "RUN" && doc.status === "COMPLETED" && !doc.isTest && !doc.testRun)
    await observeOnboarding(doc.tenantId, "firstProductionRun", doc.completedAt || doc.updatedAt || now());
  if (type === "WORKFLOW") {
    await observeOnboarding(doc.tenantId, "workflowCreated", doc.createdAt || now());
    if (doc.status === "active") await observeOnboarding(doc.tenantId, "workflowPublished", doc.publishedAt || doc.updatedAt || now());
  }
  return result;
};
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
// installationId identifies one browser profile. Re-authorizing the same browser -- after a
// sign-out, an expired session, or a restart -- reuses that browser's agent record instead of
// minting another one. Without it every reconnect left another "Never connected" agent behind.
const createAgentAndCode = async (
  tenantId,
  name,
  allowedDomains,
  createdBy,
  userRole,
  installationId,
  profile,
) => {
  let agent = null;
  if (installationId) {
    const existing = await scanType("AGENT#", { role: "SUPER_ADMIN" });
    agent =
      existing.find(
        (a) =>
          a.tenantId === tenantId &&
          a.installationId === installationId &&
          a.createdBy === createdBy,
      ) || null;
  }
  if (agent) {
    // Superseding this browser's own credential: any token previously issued to this agent is
    // retired here, so a reconnect never leaves an extra live credential behind.
    const creds = await scanType("AGENTCRED#", { role: "SUPER_ADMIN" });
    for (const cred of creds) {
      if (cred.agentId !== agent.id || cred.status !== "active" || !cred.tokenHash)
        continue;
      cred.status = "superseded";
      cred.supersededAt = now();
      await db.send(
        new PutItemCommand({
          TableName: table,
          Item: {
            pk: { S: "PLATFORM" },
            sk: { S: `AGENTCRED#${cred.tokenHash}` },
            document: { S: JSON.stringify(cred) },
            updatedAt: { S: now() },
          },
        }),
      );
    }
    agent.name = name || agent.name;
    agent.status = "active";
    agent.updatedAt = now();
  } else {
    agent = {
      id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      name,
      allowedDomains: Array.isArray(allowedDomains) ? allowedDomains : [],
      status: "active",
      createdBy,
      installationId: installationId || null,
      createdAt: now(),
      updatedAt: now(),
      lastSeenAt: null,
      version: null,
    };
  }
  if (profile) {
    agent.agentType = profile.agentType === "DESKTOP_AGENT" ? "DESKTOP_AGENT" : "CHROME_EXTENSION";
    agent.capabilities = Array.isArray(profile.capabilities)
      ? profile.capabilities.filter((c) => typeof c === "string").slice(0, 60)
      : [];
    agent.platform = typeof profile.platform === "string" ? profile.platform.slice(0, 80) : null;
    agent.version = typeof profile.version === "string" ? profile.version.slice(0, 40) : agent.version;
  }
  if (!agent.agentType) agent.agentType = "CHROME_EXTENSION";
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
    tokenHash: hashToken(token),
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
    throw {
      status: 401,
      message:
        cred.status === "superseded"
          ? "This browser was reconnected. Sign in again from the AmazFlow extension."
          : "This agent credential has been revoked",
    };
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
const AGENT_TYPE_FOR_TARGET = {
  browser_extension: "CHROME_EXTENSION",
  desktop_agent: "DESKTOP_AGENT",
};
const executionTargetFor = (step) =>
  step.executionTarget || (step.provider === "desktop" ? "desktop_agent" : "browser_extension");
// What the grant pins the action to: the origin a browser step may act on, or the application a
// desktop step may drive. The agent is refused if it tries to act anywhere else.
const destinationFor = (target, input) => {
  if (target === "desktop_agent")
    return typeof input.app === "string" ? input.app : typeof input.window === "string" ? input.window : null;
  if (typeof input.url === "string") {
    try { return new URL(input.url).origin; } catch { return null; }
  }
  return null;
};
// An agent may only see work its own surface can carry out. The task's execution target decides
// which agent type is eligible, and the capability list the agent advertised at registration
// decides whether this build implements the action -- so an older agent is passed over instead of
// claiming work it would fail, and a desktop agent can never be handed a browser step.
const agentMayRunTask = (task, ctx) => {
  if (task.tenantId !== ctx.tenantId) return false;
  const target = task.executionTarget || "browser_extension";
  const agentType = ctx.agent?.agentType || "CHROME_EXTENSION";
  if (AGENT_TYPE_FOR_TARGET[target] !== agentType) return false;
  const capabilities = Array.isArray(ctx.agent?.capabilities) ? ctx.agent.capabilities : null;
  if (capabilities && !capabilities.includes(task.operation)) return false;
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
  const executionGrants = await getExecutionGrants();
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
    taskId: task.id,
    agentId: agentCtx.agentId,
    agentType: agentCtx.agent?.agentType || "CHROME_EXTENSION",
    executionTarget: task.executionTarget || "browser_extension",
    actionType: task.operation,
    destination: task.destination || null,
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
  // `display` is the contract both agents render: without it they show "A workflow" and
  // "Making a change" instead of the real workflow and step names. The deployed template
  // sends it; this copy had drifted and would have regressed every agent UI on cutover.
  const stepIndex = (workflow.steps || []).findIndex((s) => s.id === task.stepId);
  return {
    task,
    grant,
    grantId,
    runId: run.id,
    stepId: task.stepId,
    workflowId: run.workflowId,
    claimExpiresAt: task.claimExpiresAt,
    verify: step.verify || null,
    executionTarget: task.executionTarget || "browser_extension",
    destination: task.destination || null,
    display: {
      workflowName: workflow.name,
      stepName: step.name,
      stepNumber: stepIndex >= 0 ? stepIndex + 1 : null,
      stepCount: (workflow.steps || []).length || null,
    },
  };
};
// Identity and scope come entirely from the verified grant, never from anything the caller
// claims in the body. Deliberately non-destructive: it appends progress to the run's own audit
// trail rather than advancing run state, which stays owned by the engine.
const recordStepResult = async (grantToken, body) => {
  const executionGrants = await getExecutionGrants();
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
const touchAgentHeartbeat = async (
  agentId,
  tenantId,
  version,
  capabilities,
  permissions,
) => {
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
  // An agent that updates itself reports its new capability set on the next heartbeat, so
  // newly supported actions become claimable without re-registering the installation. Without
  // this, an updated build stays permanently ineligible for the very actions it just learned.
  if (Array.isArray(capabilities))
    agent.capabilities = capabilities
      .filter((c) => typeof c === "string")
      .slice(0, 60);
  if (permissions && typeof permissions === "object")
    agent.permissions = permissions;
  await save("AGENT", agent);
};
// How long after its last heartbeat an agent still counts as connected. Agents beat every two
// minutes, so this tolerates exactly one missed beat before a workflow stops offering to run.
const HEARTBEAT_GRACE_MS = 5 * 60000;
// Connection status is DERIVED from heartbeat recency rather than stored. A stored status goes
// stale the moment a laptop sleeps and nobody is there to update it; a derived one cannot.
// Revocation outranks recency, so a revoked agent never reads as connected.
const agentSnapshot = (agent) => ({
  agentId: agent.id,
  installationId: agent.installationId || null,
  agentType: agent.agentType || "CHROME_EXTENSION",
  name: agent.name,
  version: agent.version || null,
  capabilities: Array.isArray(agent.capabilities) ? agent.capabilities : [],
  organizationId: agent.tenantId,
  platform: agent.platform || null,
  lastHeartbeatAt: agent.lastSeenAt || null,
  permissions: agent.permissions || null,
  connectionStatus:
    agent.status !== "active"
      ? "revoked"
      : agent.lastSeenAt &&
          Date.now() - new Date(agent.lastSeenAt).getTime() < HEARTBEAT_GRACE_MS
        ? "connected"
        : "offline",
});
// What a workflow needs before it can run, DERIVED from its own steps rather than declared
// anywhere. A declared list is a second source of truth that drifts. This is what keeps a run
// from being started only to sit waiting for an agent nobody ever installed, which is how every
// historical run in this account timed out.
const preflightFor = async (workflow, tenantId) => {
  const targets = [
    ...new Set(
      (workflow.steps || [])
        .filter((st) => st.type === "action")
        .map((st) =>
          st.provider === "desktop" || st.executionTarget === "desktop_agent"
            ? "desktop_agent"
            : st.provider === "browser"
              ? "browser_extension"
              : null,
        )
        .filter(Boolean),
    ),
  ];
  const requiredActions = {};
  for (const st of workflow.steps || []) {
    if (st.type !== "action") continue;
    if (st.provider !== "browser" && st.provider !== "desktop") continue;
    const t = executionTargetFor(st);
    (requiredActions[t] = requiredActions[t] || new Set()).add(st.operation);
  }
  const all = await scanType("AGENT#", { role: "SUPER_ADMIN" });
  const mine = all.filter((x) => x.tenantId === tenantId).map(agentSnapshot);
  const surfaces = targets.map((target) => {
    const wanted = AGENT_TYPE_FOR_TARGET[target];
    const candidates = mine.filter(
      (x) => x.agentType === wanted && x.connectionStatus !== "revoked",
    );
    const needed = [...(requiredActions[target] || [])];
    const connected = candidates.filter(
      (x) => x.connectionStatus === "connected",
    );
    const capable = connected.filter(
      (x) =>
        !x.capabilities.length ||
        needed.every((op) => x.capabilities.includes(op)),
    );
    const permissioned = capable.filter(
      (x) =>
        target !== "desktop_agent" ||
        !x.permissions ||
        x.permissions.accessibility !== false,
    );
    // Each state names the recovery action, because "not ready" without one is a dead end for
    // the person looking at it.
    let status = "not_installed";
    let action = "install";
    if (permissioned.length) {
      status = "connected";
      action = null;
    } else if (capable.length) {
      status = "missing_permissions";
      action = "grant_permission";
    } else if (connected.length) {
      status = "outdated";
      action = "update";
    } else if (candidates.length) {
      status = "offline";
      action = target === "desktop_agent" ? "open_app" : "connect";
    }
    return {
      target,
      agentType: wanted,
      status,
      action,
      requiredActions: needed,
      agents: candidates,
    };
  });
  return {
    workflowId: workflow.id,
    requiredTargets: targets,
    surfaces,
    ready: surfaces.every((x) => x.status === "connected"),
  };
};
// Requirement 15.17: for a pending task no agent has claimed, the customer app shows WHY -- computed
// server-side from the same connected/capable/permissioned facts preflightFor derives for a whole
// workflow, scoped here to this one task's own surface and operation. Requirement 15.11 is the
// other half: an unmatched capability just leaves the task pending for another agent, so this is
// read-only diagnosis, never a change to whether the task can still be claimed.
const taskEligibilityReason = async (task) => {
  const target = task.executionTarget || "browser_extension";
  const wanted = AGENT_TYPE_FOR_TARGET[target];
  const all = await scanType("AGENT#", { role: "SUPER_ADMIN" });
  const mine = all.filter((x) => x.tenantId === task.tenantId).map(agentSnapshot);
  const candidates = mine.filter((x) => x.agentType === wanted && x.connectionStatus !== "revoked");
  const connected = candidates.filter((x) => x.connectionStatus === "connected");
  const capable = connected.filter(
    (x) => !x.capabilities.length || x.capabilities.includes(task.operation),
  );
  const permissioned = capable.filter(
    (x) => target !== "desktop_agent" || !x.permissions || x.permissions.accessibility !== false,
  );
  if (permissioned.length) return null;
  const surfaceLabel = target === "desktop_agent" ? "desktop app" : "browser extension";
  if (!candidates.length) return `No ${surfaceLabel} is registered for this organization.`;
  if (!connected.length) return `No connected ${surfaceLabel}. The registered one is offline.`;
  if (!capable.length)
    return `No connected ${surfaceLabel} advertises the "${task.operation}" capability.`;
  return `The connected ${surfaceLabel} has not granted the operating-system permission this action needs.`;
};
// Diagnostic only. This route is an alternative way to push a run that is already parked on an
// agent step: instead of waiting for the extension to poll for that step's task, it mints a grant
// and asks the Executor harness to act. It exists to prove the harness path end to end, and it is
// deliberately kept staff-only and labelled a diagnostic rather than presented as a customer
// feature -- nothing in the product depends on it, and the grant it mints is narrower than a
// claim's (record_step_result only, no terminal result).
//
// Reuses agentCoreRuntime rather than constructing a second AgentCore client, so there is one way
// to invoke a harness in this source rather than two that can drift.
const invokeExecutorDiagnostic = async (run, workflow) => {
  // WAITING_AGENT is the real state a run sits in at an agent action step -- advance() sets that
  // (and creates the task the extension normally polls for) the moment it reaches one. A run
  // essentially never rests at plain RUNNING.
  if (run.status !== "WAITING_AGENT" || !run.currentStepId)
    throw { status: 409, message: "Run is not waiting on an agent step" };
  const executionGrants = await getExecutionGrants();
  if (!executionGrants)
    throw { status: 503, message: "Execution grants are not configured" };
  if (!executionHarnessArn)
    throw { status: 503, message: "The Executor harness is not configured" };
  const stepId = run.currentStepId;
  const confirmationGranted =
    Array.isArray(run.confirmedStepIds) && run.confirmedStepIds.includes(stepId);
  const grant = executionGrants.issue({
    runId: run.id,
    tenantId: run.tenantId,
    workflowId: run.workflowId,
    workflowVersion: run.workflowVersion,
    stepId,
    allowedTools: ["record_step_result"],
    confirmationGranted,
  });
  const grantId = JSON.parse(
    Buffer.from(grant.split(".")[1], "base64url").toString("utf8"),
  ).grantId;
  const step = (workflow.steps || []).find((s) => s.id === stepId);
  const prompt = `Workflow "${workflow.name}", step "${stepId}"${step ? ` (${step.name})` : ""}. Report your progress on this step using the record_step_result tool. Execution grant -- pass this exact token as the tool's "grant" parameter on every call, it is the only thing that authorizes you to act:\n${grant}`;
  try {
    // allowedTools is deliberately not restricted here: the tool's model-visible name is
    // namespaced by the Gateway target rather than being the bare operationId, and the harness's
    // own persistent tool configuration already limits it to exactly this one operation. An
    // invocation-level allowedTools naming the wrong string silently excludes the only real tool
    // instead of erroring, which is what happened on the first live attempt.
    const result = await agentCoreRuntime.invoke({
      harnessArn: executionHarnessArn,
      sessionId: run.id,
      prompt,
      maxIterations: 6,
      maxTokens: 2000,
      timeoutSeconds: 60,
    });
    return {
      diagnostic: true,
      grantIssued: true,
      grantId,
      stepId,
      confirmationGranted,
      harnessInvoked: true,
      harnessText: result.text || null,
    };
  } catch (err) {
    // A failed invocation is reported, not thrown: the grant was already minted and the caller
    // needs to know that plus why the harness did not answer.
    return {
      diagnostic: true,
      grantIssued: true,
      grantId,
      stepId,
      confirmationGranted,
      harnessInvoked: false,
      harnessError: err && err.message ? err.message : String(err),
    };
  }
};
// The account's state in the user pool, which is the only authority on whether the person behind a
// still-valid token is still allowed in. Returns "active", "disabled", or "unknown" when the pool
// could not be consulted -- and "unknown" is treated as allowed by the caller, deliberately: a
// transient pool failure must not sign every customer out at once.
//
// The lookup is by email because email IS the username in this pool (invitations create the account
// with the address as Username), and the sub is not accepted as a Username by AdminGetUser.
const accountStatusFor = async (a) => {
  if (!a.email || !process.env.USER_POOL_ID) return "unknown";
  try {
    const found = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: a.email,
      }),
    );
    return found && found.Enabled === false ? "disabled" : "active";
  } catch (err) {
    // UserNotFoundException included: an account absent from the pool is not evidence that this
    // token's holder was deactivated, and refusing here would break every principal whose
    // username is not its email.
    return "unknown";
  }
};
const revokeAgent = async (agentId, a) => {
  // Scoped read, not a staff scan followed by a comparison: another organization's id is simply
  // not found, so there is no status to leak and nothing for a later edit to undo.
  const agent = await resolveEntity("AGENT#", agentId, a, "staff revoking an agent by id");
  if (!agent) throw { status: 404, message: "Agent not found" };
  agent.status = "revoked";
  agent.updatedAt = now();
  await save("AGENT", agent);
  await logActivity(agent.tenantId, {
    actor: a.userId,
    actorLabel: actorLabelFor(asPrincipal(a)),
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
          gsi1pk: { S: "RUN#" },
          gsi1sk: { S: `${run.tenantId}#${run.createdAt || now()}#${run.id}` },
          tenantId: { S: run.tenantId },
          document: { S: JSON.stringify(run) },
          updatedAt: { S: now() },
        },
      },
    },
  ];
  // A TransactWriteItems call accepts at most 100 items. This used to `slice(0, 90)`, which
  // meant a long run's audit rows past the 90th were dropped with no error and no metric --
  // the queryable AUDIT# trail and the run document's own audit array then disagreed
  // permanently, and the queryable one is what the evidence tooling reads. Chunk instead:
  // the run document plus the first batch go in one transaction (so the run is never
  // committed without its first audit rows), and the remainder follow in further batches.
  const auditItem = (entry, i) => ({
    Put: {
      TableName: table,
      Item: {
        pk: { S: `TENANT#${run.tenantId}` },
        sk: {
          S: `AUDIT#${run.id}#${String((auditStartIdx || 0) + i).padStart(6, "0")}`,
        },
        tenantId: { S: run.tenantId },
        document: { S: JSON.stringify({ ...entry, runId: run.id }) },
        updatedAt: { S: now() },
      },
    },
  });

  const FIRST_BATCH = 99; // 1 slot already taken by the run document
  newEntries.slice(0, FIRST_BATCH).forEach((entry, i) => items.push(auditItem(entry, i)));
  await db.send(new TransactWriteItemsCommand({ TransactItems: items }));

  for (let offset = FIRST_BATCH; offset < newEntries.length; offset += 100) {
    await db.send(
      new TransactWriteItemsCommand({
        TransactItems: newEntries
          .slice(offset, offset + 100)
          .map((entry, i) => auditItem(entry, offset + i)),
      }),
    );
  }
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
const ALLOWED_AGENT_OPS = new Set([...BROWSER_ACTIONS, ...DESKTOP_ACTIONS]);
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
      // Model output is untrusted workflow input. Reject invalid structured output,
      // allowlist violations, and provider failures without losing the run record.
      try {
        const out = await ai(
          step,
          { input: run.context.input, ...run.context.values },
          run,
        );
        run.context.values[step.outputKey] = out.result;
        if (out.metadata) {
          run.executionBackend = out.metadata.executionBackend;
          run.agentSessionId =
            out.metadata.agentSessionId || run.agentSessionId;
          run.traceId = out.metadata.traceId || run.traceId;
        }
        audit(
          "AI_COMPLETED",
          "AmazFlow managed AI returned a bounded result",
          step.id,
          { usage: out.usage, traceId: out.metadata?.traceId },
        );
        next = step.next;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const allowlistRejected = /outside.*allowlist/i.test(message);
        const canRouteToReview =
          allowlistRejected &&
          Array.isArray(step.allowedValues) &&
          step.allowedValues.map(String).includes("REVIEW");
        if (canRouteToReview) {
          run.context.values[step.outputKey] = {
            value: "REVIEW",
            confidence: 0,
          };
          audit(
            "AI_ALLOWLIST_REJECTED",
            `AmazFlow's AI returned a value outside what "${step.name}" allows -- routed to human review and no action was taken`,
            step.id,
            { operation: step.operation, fallback: "REVIEW" },
          );
          next = step.next;
          continue;
        }
        run.status = "FAILED";
        audit(
          allowlistRejected ? "AI_ALLOWLIST_REJECTED" : "AI_FAILED",
          allowlistRejected
            ? `AmazFlow's AI returned a value outside what "${step.name}" allows -- no action was taken`
            : `"${step.name}" could not complete: ${message}`,
          step.id,
          { operation: step.operation },
        );
        next = undefined;
      }
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
          const executionGrants = await getExecutionGrants();
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
        const executionGrants = await getExecutionGrants();
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
          executionTarget: executionTargetFor(step),
          destination: destinationFor(executionTargetFor(step), interpolate(step.input || {}, run.context)),
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
    issue: async ({ workflow, run, step }) => {
      const executionGrants = await getExecutionGrants();
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
/**
 * `flags.isTest` implements Q-7's conservative half (requirement 13.5).
 *
 * The tag is written and nothing else: no counting policy and no analytics exclusion is asserted here,
 * because whether a test run consumes the concurrency ceiling and whether it appears in a customer's
 * numbers are two separate business decisions and neither has been made. Recording the fact now is
 * what lets either be applied later without a schema change or a backfill -- and a run that was a test
 * cannot be identified after the fact from anything else the record holds.
 */
const runWorkflow = async (workflow, input, a, flags = {}) => {
  if (useAgentCore()) {
    if (!agentCoreAi)
      throw new Error("Managed workflow execution is not configured");
    return (await createProductionEngine()).start(workflow, input, a, flags);
  }
  assertLegacyEnabled();
  const run = {
    id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: workflow.tenantId,
    workflowId: workflow.id,
    workflowVersion: workflow.version || 1,
    ...(flags.isTest ? { isTest: true } : {}),
    ...(flags.resumedFromRunId ? { resumedFromRunId: flags.resumedFromRunId } : {}),
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
// Task 18.5 / requirements 19.6-19.8: resuming an exception is a NEW run, never a rewind. It is
// pinned to the same workflow VERSION the original ran on -- not whatever the workflow currently
// is, which may have been edited since -- and carries the same input. The original run's own
// record is never touched; the link is recorded only on the new run and in the audit trail.
const RESUMABLE_EXCEPTION_STATUSES = ["FAILED", "TIMED_OUT"];
const resumeRunFromException = async (runId, a) => {
  const run = await resolveEntity("RUN#", runId, a, "resuming a run from its exception by id");
  if (!run) throw { status: 404, message: "Run not found" };
  await authorizeIn(asPrincipal(a), "exception:resume", {
    orgId: run.tenantId,
    ownerUserId: run.createdBy,
  });
  if (!RESUMABLE_EXCEPTION_STATUSES.includes(run.status))
    throw {
      status: 409,
      message: "Only a failed or timed-out run can be resumed",
    };
  const pinnedWorkflow = await getWorkflowVersion(
    run.tenantId,
    run.workflowId,
    run.workflowVersion,
  );
  if (!pinnedWorkflow)
    throw {
      status: 400,
      message: "The workflow version this run started on is no longer available",
    };
  const newRun = await runWorkflow(pinnedWorkflow, run.context?.input ?? {}, a, {
    resumedFromRunId: run.id,
  });
  await logActivity(run.tenantId, {
    actor: a.userId,
    actorLabel: actorLabelFor(asPrincipal(a)),
    action: "RUN_RESUMED_FROM_EXCEPTION",
    summary: `Resumed run ${run.id} as a new run`,
    details: { originalRunId: run.id, newRunId: newRun.id },
  });
  return newRun;
};
// grantToken is required on the agent route and omitted for the operator's own
// /agent-tasks/{id}/result console route, which is already Cognito-authenticated and
// role-checked at the gateway.
const resumeAgentTask = async (taskId, result, a, grantToken, reportingAgent) => {
  const task = await resolveEntity("TASK#", taskId, a, "resolving an agent task by id");
  if (!task) throw { status: 404, message: "Task not found" };
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
    const executionGrants = await getExecutionGrants();
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
          taskId: task.id,
          agentId: reportingAgent?.agentId,
          agentType: reportingAgent?.agentType,
          executionTarget: task.executionTarget || "browser_extension",
          actionType: task.operation,
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
    agentType: reportingAgent?.agentType || null,
    executionTarget: task.executionTarget || "browser_extension",
    destination: task.destination || null,
    grantId: grantPayload ? grantPayload.grantId : null,
    claimedAt: task.claimedAt || null,
    reportedAt: now(),
    page: result.evidence || null,
  };
  // Resume the run FIRST, then retire the task. The old order committed the task as
  // COMPLETED up front, so a failed resume (transaction conflict, throttle, oversized run
  // document) left the run stuck in WAITING_AGENT with a terminal task: the agent could not
  // resubmit (409 "Task already resolved") and the sweep no longer matched it, because the
  // sweep only considers PENDING/CLAIMED. The run was unrecoverable and nothing said so.
  const retireTask = async () => {
    task.status = "COMPLETED";
    task.resolvedAt = now();
    await save("TASK", task);
  };
  if (useAgentCore()) {
    const resumed = await (
      await createProductionEngine(run)
    ).resumeFromAgent(workflow, run, task.stepId, result, evidence);
    await retireTask();
    return resumed;
  }
  // Guard before retiring: assertLegacyEnabled() throws when the rollback switch is off, and
  // retiring first would consume the task on a request that then failed.
  assertLegacyEnabled();
  await retireTask();
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
  const run = await resolveEntity("RUN#", runId, a, "deciding an approval by run id");
  if (!run) throw { status: 404, message: "Run not found" };
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
  if (!asPrincipal(a).isStaff && !(step.roles || []).includes(asPrincipal(a).group))
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
  const run = await resolveEntity("RUN#", runId, a, "confirming an action gate by run id");
  if (!run) throw { status: 404, message: "Run not found" };
  if (run.status !== "AWAITING_CONFIRMATION" || run.currentStepId !== stepId)
    throw { status: 409, message: "Run is not waiting for this confirmation" };
  await authorizeIn(asPrincipal(a), "run:confirm", {
    orgId: run.tenantId,
    ownerUserId: run.createdBy,
  });
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
  const run = await resolveEntity("RUN#", runId, a, "cancelling a run by id");
  if (!run) throw { status: 404, message: "Run not found" };
  // Own-record narrowing now comes from the policy: OPERATOR holds run:cancel but not run:read_all,
  // which is exactly what step 5 of can() reads to restrict it to its own runs.
  await authorizeIn(asPrincipal(a), "run:cancel", {
    orgId: run.tenantId,
    ownerUserId: run.createdBy,
  });
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
      const group = roleByUsername[u.Username];
      if (attrs["custom:tenant_id"] !== tenantId || !group) continue;
      const email = attrs.email || u.Username;
      let membership = await resolveMembership(tenantId, email, group);
      // Cognito is authoritative for enabled state and completion of the initial challenge. Reconcile
      // the membership as part of this read, while retaining its fine role, teams, and timestamps.
      const state = !u.Enabled
        ? "deactivated"
        : u.UserStatus === "FORCE_CHANGE_PASSWORD"
          ? "invited"
          : "active";
      if (membership.status !== state) {
        const at = now();
        membership = {
          ...membership,
          status: state,
          ...(state === "active" && !membership.activatedAt ? { activatedAt: at } : {}),
          updatedAt: at,
        };
        await saveMembership(membership);
      }
      users.push({
        username: u.Username,
        email,
        role: group,
        platformRole: membership.role,
        teamIds: membership.teamIds || [],
        enabled: !!u.Enabled,
        userStatus: u.UserStatus || null,
        state,
        membershipStatus: membership.status,
        invitedAt: membership.invitedAt || null,
        invitedBy: membership.invitedBy || null,
        activatedAt: membership.activatedAt || null,
        lastLoginAt: membership.lastLoginAt || null,
        createdAt: u.UserCreateDate ? new Date(u.UserCreateDate).toISOString() : membership.createdAt || null,
        updatedAt: membership.updatedAt || null,
      });
    }
    token = out.PaginationToken;
  } while (token);
  return users;
};

// Invite a person into a tenant. This is the step that used to be done by hand in the AWS
// console: create the Cognito user, stamp the tenant claim, put them in a role group.
//
// Ordering matters and is not interchangeable. The user is created first, then added to a group.
// A user who exists but has no group cannot sign in -- sessionFromAuthResult refuses a session
// without one of the three role groups -- so a failure between the two calls leaves someone who
// cannot get in, rather than someone in the wrong tenant with access. That is the safe direction
// to fail, and this reports it plainly instead of pretending the invitation succeeded.
const INVITABLE_ROLES = ["CLIENT_ADMIN", "FRONTLINE"];
const inviteTenantUser = async (tenantId, body, a) => {
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  if (!email) throw { status: 400, message: "An email address is required" };
  // Same shape Cognito itself accepts for a username-as-email pool. Deliberately not a full RFC
  // validator: the authoritative check is Cognito's, this only stops the obviously wrong before
  // spending a call.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw { status: 400, message: `"${email}" is not a valid email address` };
  const role = String(body.role || "FRONTLINE").trim();
  if (!INVITABLE_ROLES.includes(role))
    throw { status: 400, message: `role must be one of ${INVITABLE_ROLES.join(", ")}` };

  // An organization's allowed-domain list is the access boundary its admin agreed to. Checked
  // here rather than in the console so it holds for any caller.
  const org = await getOrganization(tenantId);
  const allowed = orgSettings(org).allowedEmailDomains;
  if (allowed.length) {
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (!allowed.includes(domain))
      throw {
        status: 422,
        message: `${email} is outside this organization's allowed email domains (${allowed.join(", ")})`,
        allowedEmailDomains: allowed,
      };
  }

  const existing = (await listTenantUsers(tenantId)).find((u) => u.email === email);
  if (existing)
    throw { status: 409, message: `${email} is already a member of this organization` };

  let created;
  try {
    created = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: email,
        // Cognito emails the temporary password. /login already handles the
        // NEW_PASSWORD_REQUIRED challenge in-page, so the invitee never sees a raw Cognito
        // screen and never needs a separate acceptance route.
        DesiredDeliveryMediums: ["EMAIL"],
        UserAttributes: [
          { Name: "email", Value: email },
          // Marked verified because we sent the invitation to this address: requiring the
          // invitee to also verify it would add a step that proves nothing extra.
          { Name: "email_verified", Value: "true" },
          { Name: "custom:tenant_id", Value: tenantId },
          // Their real sign-up date, in Unix seconds. Nothing else records this, and the
          // support messenger reads it as the account age.
          { Name: "custom:created_at", Value: String(Math.floor(Date.now() / 1000)) },
        ],
      }),
    );
  } catch (err) {
    if (err && err.name === "UsernameExistsException")
      throw {
        status: 409,
        message: `${email} already has an AmazFlow account. Ask AmazFlow to move them to this organization.`,
      };
    if (err && err.name === "InvalidParameterException")
      throw { status: 400, message: err.message || "Cognito rejected that email address" };
    throw err;
  }

  const username = created?.User?.Username || email;
  try {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: username,
        GroupName: role,
      }),
    );
  } catch (err) {
    console.error("invite: user created but group assignment failed", {
      tenantId,
      username,
      role,
      error: err && err.message,
    });
    throw {
      status: 502,
      message: `${email} was created but could not be given the ${role} role, so they cannot sign in yet. Retry the invitation.`,
    };
  }

  // Requirement 9.6: a membership record with INVITED status, created with the invitation rather than
  // lazily on first read. The lazy backfill in `resolveMembership` exists for accounts that predate
  // this; a new invitation has no excuse to arrive without one, and the users view needs the invited
  // state before the person has ever signed in.
  const invitedRole = defaultRoleForGroup(role);
  await saveMembership({
    orgId: tenantId,
    username: email,
    role: invitedRole,
    teamIds: [],
    status: "invited",
    invitedAt: now(),
    invitedBy: a.userId,
    createdAt: now(),
    updatedAt: now(),
  }).catch((err) => {
    console.error("invite: membership record not written", { tenantId, email, error: err && err.message });
  });
  // Requirements 26.1-26.4: a high-entropy token, only its hash stored, seven-day expiry, and a link
  // to the customer application's acceptance route. Best effort against the invitation RECORD only --
  // the Cognito user already exists and can sign in through the password challenge, so failing the
  // whole invitation here would leave an account nobody was told about.
  let invitationLink = null;
  try {
    const issued = await createInvitationRecord(tenantId, email, invitedRole, a);
    invitationLink = issued.acceptUrl;
  } catch (err) {
    console.error("invite: invitation record not created", { tenantId, email, error: err && err.message });
  }
  await logActivity(tenantId, {
    actor: a.userId,
    actorLabel: actorLabelFor(asPrincipal(a)),
    action: "TEAM_MEMBER_INVITED",
    summary: `Invited ${email} as ${role === "CLIENT_ADMIN" ? "a team admin" : "a team member"}`,
    details: { email, role, platformRole: invitedRole },
  });
  if (role === "CLIENT_ADMIN") await observeOnboarding(tenantId, "administratorInvited");
  return {
    acceptUrl: invitationLink,
    username,
    email,
    role,
    enabled: true,
    userStatus: created?.User?.UserStatus || "FORCE_CHANGE_PASSWORD",
    invited: true,
  };
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

// ---------- Organization profile and settings ----------
// Deliberately small. Every field below is read by something: status and maxConcurrentRuns gate
// run creation, allowedEmailDomains gates who can be invited, timezone is what the operator
// console formats an org's timestamps in. A setting that is stored and never read is worse than
// a missing one, because the console then reports a control that does nothing.

// Counted as "in flight" for the concurrency limit. Deliberately a positive list: a run status
// added later is then not counted, so an unrecognised status fails open and lets work start,
// rather than failing closed and blocking a customer for a vocabulary gap.
const LIVE_RUN_STATUSES = [
  "RUNNING",
  "WAITING_AGENT",
  "WAITING_APPROVAL",
  "AWAITING_CONFIRMATION",
];
const ORG_STATUSES = ["active", "paused", "suspended"];
const ORG_PLANS = ["design_partner", "pilot", "standard", "enterprise"];
const DEFAULT_ORG_SETTINGS = {
  maxConcurrentRuns: 0,
  allowedEmailDomains: [],
  timezone: "UTC",
};
const orgSettings = (org) => ({
  ...DEFAULT_ORG_SETTINGS,
  ...(org && org.settings ? org.settings : {}),
});

// name/status/plan. Slug is immutable: it IS the tenant id, carried in every Cognito claim and
// every partition key, so renaming it would orphan the tenant's data.
const validateOrgProfile = (body) => {
  const out = {};
  if ("name" in body) {
    const v = String(body.name || "").trim();
    if (!v) throw { status: 400, message: "A name is required" };
    out.name = v.slice(0, 120);
  }
  if ("status" in body) {
    const v = String(body.status || "").trim();
    if (!ORG_STATUSES.includes(v))
      throw {
        status: 400,
        message: `status must be one of ${ORG_STATUSES.join(", ")}`,
      };
    out.status = v;
  }
  if ("plan" in body) {
    const v = String(body.plan || "").trim();
    if (!ORG_PLANS.includes(v))
      throw {
        status: 400,
        message: `plan must be one of ${ORG_PLANS.join(", ")}`,
      };
    out.plan = v;
  }
  if ("slug" in body)
    throw {
      status: 400,
      message:
        "An organization slug cannot be changed: it is the tenant identifier",
    };
  return out;
};

const validateOrgSettings = (body) => {
  const out = {};
  if ("maxConcurrentRuns" in body) {
    const v = Number(body.maxConcurrentRuns);
    if (!Number.isInteger(v) || v < 0 || v > 1000)
      throw {
        status: 400,
        message:
          "maxConcurrentRuns must be a whole number between 0 and 1000 (0 means no limit)",
      };
    out.maxConcurrentRuns = v;
  }
  if ("allowedEmailDomains" in body) {
    const raw = Array.isArray(body.allowedEmailDomains)
      ? body.allowedEmailDomains
      : [];
    if (raw.length > 20)
      throw { status: 400, message: "At most 20 email domains" };
    const seen = [];
    for (const entry of raw) {
      // Stored bare and lowercased so comparison at invite time is a plain equality check
      // rather than a parse. Accepts "@acme.com" and "ACME.com" as the same thing.
      const d = String(entry || "")
        .trim()
        .toLowerCase()
        .replace(/^@+/, "");
      if (!d) continue;
      if (
        !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
          d,
        )
      )
        throw { status: 400, message: `"${entry}" is not a valid email domain` };
      if (!seen.includes(d)) seen.push(d);
    }
    out.allowedEmailDomains = seen;
  }
  if ("timezone" in body) {
    const v = String(body.timezone || "").trim() || "UTC";
    // Validated against the runtime's own tz database rather than a hardcoded list, so it
    // cannot drift and cannot be used to smuggle arbitrary text into the console.
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: v });
    } catch (err) {
      throw { status: 400, message: `"${v}" is not a recognized time zone` };
    }
    out.timezone = v;
  }
  return out;
};

// ---------- Activity log ----------
// Separate from a run's own audit[] (what an execution did). This records what an
// ADMIN -- human or via Copilot -- did to the configuration itself, so every
// Copilot-driven change is traceable to a named actor, never anonymous.
const logActivity = async (tenantId, entry, notification) => {
  const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // correlationId last and not spreadable by entry: requirement 26.12 wants it in every audit
  // event, and the real value of a request's own log line, not something a call site can shadow.
  const doc = { id, tenantId, at: now(), ...entry, correlationId };
  await db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: `TENANT#${tenantId}` },
        sk: { S: `ACTIVITY#${String(Date.now()).padStart(14, "0")}_${id}` },
        gsi1pk: { S: "ACTIVITY#" },
        gsi1sk: { S: `${tenantId}#${doc.at}#${id}` },
        tenantId: { S: tenantId },
        document: { S: JSON.stringify(doc) },
        updatedAt: { S: now() },
      },
    }),
  );
  // Requirement 22.2, enforced as a COUPLING rather than as a rule somebody follows: this is the only
  // way to create a notification, and it runs after the audit record is durable. So a notification
  // cannot exist for an event that did not occur -- there is no `notify()` to call on its own.
  //
  // The notification is best effort while the audit record is not. That asymmetry is deliberate: an
  // event recorded without its notification is a missed nudge, while a notification recorded without
  // its event sends somebody looking for work that never happened.
  if (notification) {
    try {
      await saveNotification(buildNotification(tenantId, { ...notification, eventId: id }));
    } catch (err) {
      console.error("notification not created for recorded event", {
        tenantId,
        action: entry.action,
        error: err && err.message,
      });
    }
  }
  return doc;
};

const ONBOARDING_STATUS_SET = [
  "PROSPECT", "CLOSED_WON", "SETUP_REQUIRED", "ONBOARDING", "CONFIGURATION",
  "TESTING", "READY_FOR_LAUNCH", "ACTIVE", "PAUSED", "CHURNED",
];
const ONBOARDING_MILESTONES = [
  "administratorInvited", "administratorActivated", "firstIntegration",
  "firstAgent", "workflowCreated", "workflowPublished", "firstProductionRun",
];
const onboardingKey = (tenantId) => ({
  pk: { S: `TENANT#${tenantId}` },
  sk: { S: "ONBOARDING" },
});
const defaultOnboarding = (tenantId) => ({
  tenantId,
  status: "PROSPECT",
  crmReference: null,
  internalOwner: null,
  milestones: Object.fromEntries(ONBOARDING_MILESTONES.map((key) => [key, null])),
  checklist: {},
  internalNotes: "",
  updatedAt: now(),
});
const readOnboarding = async (tenantId) => {
  const out = await db.send(new GetItemCommand({ TableName: table, Key: onboardingKey(tenantId) }));
  if (out.Item?.document?.S) return JSON.parse(out.Item.document.S);
  const record = defaultOnboarding(tenantId);
  await db.send(new PutItemCommand({
    TableName: table,
    Item: { ...onboardingKey(tenantId), tenantId: { S: tenantId }, document: { S: JSON.stringify(record) }, updatedAt: { S: now() } },
    ConditionExpression: "attribute_not_exists(pk)",
  })).catch((err) => {
    if (err?.name !== "ConditionalCheckFailedException") throw err;
  });
  return record;
};
const saveOnboarding = async (record) => db.send(new PutItemCommand({
  TableName: table,
  Item: { ...onboardingKey(record.tenantId), tenantId: { S: record.tenantId }, document: { S: JSON.stringify(record) }, updatedAt: { S: now() } },
}));
const observeOnboarding = async (tenantId, milestone, at = now()) => {
  if (!tenantId || !ONBOARDING_MILESTONES.includes(milestone)) return;
  const record = await readOnboarding(tenantId);
  if (record.milestones?.[milestone]) return;
  const next = { ...record, milestones: { ...record.milestones, [milestone]: at }, updatedAt: at };
  await saveOnboarding(next);
  await logActivity(tenantId, {
    actor: "system",
    actorLabel: "AmazFlow platform",
    action: "ONBOARDING_MILESTONE_OBSERVED",
    summary: `Observed onboarding milestone ${milestone}`,
    details: { milestone, at },
  });
  if (milestone === "firstProductionRun") {
    const org = await getOrganization(tenantId);
    if (org && !org.activatedAt) await saveOrganization({ ...org, activatedAt: at, updatedAt: at });
  }
};
const onboardingForCustomer = (record) => ({
  tenantId: record.tenantId,
  status: record.status,
  milestones: record.milestones,
  checklist: record.checklist,
  updatedAt: record.updatedAt,
});

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
      // `paused` is gone from this tool's vocabulary (requirement 13.3). It was the one remaining
      // writer of the legacy value, so leaving it here would have kept minting records that the
      // status model only knows how to read.
      description:
        "Propose publishing a draft (status active), returning a published workflow to draft, or archiving it. This changes what customers can actually run, so treat it as high-risk.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            tenantId: { type: "string" },
            workflowId: { type: "string" },
            status: { type: "string", enum: ["draft", "testing", "active", "archived"] },
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
    if (!WORKFLOW_STATUSES.includes(input.status))
      throw new Error(`status must be one of ${WORKFLOW_STATUSES.join(", ")}`);
    const target = { ...w, status: input.status };
    const action = await proposeAction(
      userId,
      input.tenantId,
      "WORKFLOW_STATUS",
      `Set "${w.name}" v${w.version} to ${input.status} (currently ${w.status})`,
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
  const executionGrants = await getExecutionGrants();
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
    actorLabel: actorLabelFor(asPrincipal(a)),
    action: "SUPPORT_TICKET_CREATED",
    summary: `Opened support ticket "${subject}"`,
  });
  return ticket;
};
const updateTicket = async (ticketId, a, body) => {
  const ticket = await resolveEntity("TICKET#", ticketId, a, "updating a support ticket by id");
  if (!ticket) throw { status: 404, message: "Ticket not found" };
  // "Own tickets only" is the same narrowing the policy expresses: a role without run:read_all does
  // not see other people's records in its own organization.
  if (
    !can(asPrincipal(a), "run:read_all", { orgId: ticket.tenantId }).allow &&
    ticket.createdBy !== a.userId
  )
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
        internal: asPrincipal(a).isStaff && !!body.internal,
      },
    ];
  }
  ticket.updatedAt = now();
  await save("TICKET", ticket);
  if (body.status)
    await logActivity(ticket.tenantId, {
      actor: a.userId,
      actorLabel: actorLabelFor(asPrincipal(a)),
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

/* ---------- 14.1 / 14.2 / 14.3 / 14.7 Workflow lifecycle ---------- */

/**
 * Write a workflow and its immutable version record together (requirements 13.17, 13.18).
 *
 * The version record is what makes a run's pin meaningful. `runWorkflow` stores
 * `workflowVersion: workflow.version` and every later read of that run resolves the definition through
 * `getWorkflowVersion(tenantId, workflowId, version)` -- so if no version record were written on save,
 * that lookup would fall back to the CURRENT workflow and an in-flight run would silently start
 * following steps that were edited underneath it.
 *
 * `WORKFLOWVERSION#{id}_v{padded}` is keyed by version, so writing the same version twice overwrites
 * rather than accumulating. That is why every save that changes the definition bumps the version:
 * immutability here is a property of the KEY, and reusing a version is what would break it.
 */
const saveWorkflowWithVersion = async (workflow) => {
  const next = { ...workflow, updatedAt: now() };
  await save("WORKFLOW", next);
  if (next.version)
    await save("WORKFLOWVERSION", {
      ...next,
      id: `${next.id}_v${String(next.version).padStart(6, "0")}`,
    });
  return next;
};

/**
 * The managed-connection availability check, re-run at publish time (requirements 13.12, 13.13).
 *
 * Re-run rather than trusted from the draft, because the connection can be revoked between authoring
 * and publishing, and a managed-browser step whose connection is gone does not fail at publish -- it
 * fails at run time, against a customer's real system, having already told them the workflow was live.
 *
 * Returns the offending step id, or null when every managed step has an active, authenticated
 * connection.
 */
const managedConnectionGapFor = async (workflow) => {
  for (const step of workflow.steps || []) {
    if (!step || step.type !== "action" || step.provider !== "browser") continue;
    if (step.browserMode !== "managed") continue;
    if (!step.connectionId) return { stepId: step.id, reason: "names no connection" };
    const connection = await getBrowserConnection(workflow.tenantId, step.connectionId);
    if (!connection) return { stepId: step.id, reason: "names a connection that no longer exists" };
    if (connection.status !== "active")
      return { stepId: step.id, reason: `names a connection that is ${connection.status}` };
    if (!connection.managedProfileId)
      return { stepId: step.id, reason: "names a connection that has never been signed in" };
  }
  return null;
};

/**
 * Resolve a workflow the caller may address, under the caller's own scope.
 *
 * `resolveEntity` partitions the read for a non-staff principal, so another organization's identifier
 * is simply NOT FOUND -- there is no comparison to get wrong and no 403 existence oracle to
 * reintroduce (requirement 34.4).
 */
const resolveWorkflow = async (id, p, reason) => resolveEntity("WORKFLOW#", id, p, reason);

/** The audit event each transition records (requirement 13.23). One per transition, named for it. */
const WORKFLOW_TRANSITION_AUDIT = {
  active: "WORKFLOW_PUBLISHED",
  draft: "WORKFLOW_UNPUBLISHED",
  archived: "WORKFLOW_ARCHIVED",
  testing: "WORKFLOW_STATUS_CHANGED",
};

/**
 * The allowlisted filter field set for `GET /workflows` (requirements 13.6, 13.7).
 *
 * An unrecognized field is REFUSED rather than ignored. Ignoring it is the dangerous reading: a
 * client asking for `?state=draft` and being handed the unfiltered list has been told, by the shape of
 * a successful response, that every workflow it received is a draft.
 */
const WORKFLOW_FILTER_FIELDS = ["q", "status", "provider", "surface", "assignedRole"];
const workflowMatchesFilters = (workflow, filters) => {
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    const haystack = [workflow.name, workflow.description, workflow.customerSummary]
      .filter((value) => typeof value === "string")
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  // Compared against the DISPLAY status so that filtering for Archived also returns the legacy
  // `paused` records the list shows as Archived. Filtering on the stored value would show a person a
  // workflow labelled Archived that their own Archived filter then hides.
  if (filters.status) {
    const shown = workflow.status === "paused" ? "archived" : workflow.status;
    if (shown !== filters.status) return false;
  }
  if (filters.provider) {
    const providers = new Set(
      (workflow.steps || [])
        .filter((step) => step && step.type === "action" && step.provider)
        .map((step) => step.provider),
    );
    if (!providers.has(filters.provider)) return false;
  }
  // Derived from the steps, never from a stored field, for the same reason the detail view derives it.
  if (filters.surface && !requiredSurfacesFor(workflow).includes(filters.surface)) return false;
  if (filters.assignedRole) {
    const assigned = Array.isArray(workflow.assignedRoles) ? workflow.assignedRoles : [];
    if (!assigned.includes(filters.assignedRole)) return false;
  }
  return true;
};
const readWorkflowFilters = (query) => {
  const params = query || {};
  const unknown = Object.keys(params).filter((key) => !WORKFLOW_FILTER_FIELDS.includes(key));
  if (unknown.length)
    throw {
      status: 400,
      message: `"${unknown[0]}" is not a field this list can be filtered by (available: ${WORKFLOW_FILTER_FIELDS.join(", ")})`,
    };
  const filters = {};
  for (const field of WORKFLOW_FILTER_FIELDS) {
    const raw = params[field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    filters[field] = raw.trim().slice(0, 120);
  }
  // A value outside the closed set is refused for the same reason an unknown FIELD is: silently
  // returning nothing is indistinguishable from "your organization has none of those".
  if (filters.status && !READABLE_WORKFLOW_STATUSES.includes(filters.status))
    throw {
      status: 400,
      message: `"${filters.status}" is not a workflow status (available: ${WORKFLOW_STATUSES.join(", ")})`,
    };
  if (filters.provider && !VALID_PROVIDERS.includes(filters.provider))
    throw {
      status: 400,
      message: `"${filters.provider}" is not a provider (available: ${VALID_PROVIDERS.join(", ")})`,
    };
  if (filters.surface && !Object.keys(ACTIONS_BY_SURFACE).includes(filters.surface))
    throw {
      status: 400,
      message: `"${filters.surface}" is not an execution surface (available: ${Object.keys(ACTIONS_BY_SURFACE).join(", ")})`,
    };
  return filters;
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
const listBrowserConnections = async (a, query) => {
  await authorizeIn(asPrincipal(a), "connection:read", { orgId: a.tenantId });
  return paginateList(
    (await scanType("BROWSERCONNECTION#", a)).map(publicBrowserConnection),
    query,
  );
};
const createBrowserConnection = async (a, body) => {
  await authorizeIn(asPrincipal(a), "connection:manage", { orgId: a.tenantId });
  const tenantId =
    asPrincipal(a).isStaff && body.tenantId ? String(body.tenantId) : a.tenantId;
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
    asPrincipal(a).isStaff && a.requestedTenantId ? a.requestedTenantId : a.tenantId;
  let connection = await getBrowserConnection(tenantId, id);
  if (!connection && isStaffGroup(a.role))
    // Already tenant-partitioned for a customer (getBrowserConnection keys on the caller's own
    // organization), so the only branch that needed changing was the staff widening: it now goes
    // through the named cross-organization read, which audits.
    connection = await resolveEntity(
      "BROWSERCONNECTION#",
      id,
      a,
      "staff resolving a browser connection by id",
    );
  if (!connection)
    throw { status: 404, message: "Browser connection not found" };
  return connection;
};
const startBrowserLogin = async (a, id) => {
  await authorizeIn(asPrincipal(a), "connection:manage", { orgId: a.tenantId });
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
  await authorizeIn(asPrincipal(a), "connection:manage", { orgId: a.tenantId });
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
  await observeOnboarding(connection.tenantId, "firstIntegration", connection.updatedAt);
  await logActivity(connection.tenantId, {
    actor: a.userId,
    actorLabel: actorLabelFor(asPrincipal(a)),
    action: "BROWSER_CONNECTION_AUTHENTICATED",
    summary: `Authenticated browser connection "${connection.name}"`,
  });
  return publicBrowserConnection(connection);
};
const revokeBrowserConnection = async (a, id) => {
  await authorizeIn(asPrincipal(a), "connection:manage", { orgId: a.tenantId });
  const connection = await requireBrowserConnection(a, id);
  if (connection.managedProfileId && browserManager)
    await browserManager.deleteProfile(connection.managedProfileId);
  connection.status = "revoked";
  delete connection.managedProfileId;
  connection.updatedAt = now();
  await save("BROWSERCONNECTION", connection);
  await logActivity(connection.tenantId, {
    actor: a.userId,
    actorLabel: actorLabelFor(asPrincipal(a)),
    action: "BROWSER_CONNECTION_REVOKED",
    summary: `Revoked browser connection "${connection.name}"`,
  });
  return publicBrowserConnection(connection);
};

// ---------- Managed secrets (task 20.2 / 20.3) ----------
// Requirement 20.6-20.10: the record carries name, kind, an external store pointer, a recognition
// hint, and usage timestamps -- never the value. The value is accepted once on write and passed
// straight to Secrets Manager; it never enters this table, a response, a log line, or an audit
// event.
const SECRET_KINDS = ["api_key", "bearer_token", "basic_auth", "oauth_refresh", "webhook_secret"];
const secretHint = (value) => value.slice(-4);
const externalSecretName = (tenantId, id) => `amazflow/customer-secret/${tenantId}/${id}`;
const publicSecret = (secret) => {
  const { ref, ...safe } = secret;
  return safe;
};
const validateSecretInput = (body) => {
  const name = String(body?.name ?? "").trim().slice(0, 120);
  if (!name) throw { status: 400, message: "A secret name is required" };
  const kind = String(body?.kind ?? "");
  if (!SECRET_KINDS.includes(kind))
    throw {
      status: 400,
      message: `"${kind}" is not a secret kind (available: ${SECRET_KINDS.join(", ")})`,
    };
  const value = String(body?.value ?? "");
  if (!value) throw { status: 400, message: "A secret value is required" };
  return { name, kind, value };
};
const listSecrets = async (a, query) => {
  await authorizeIn(asPrincipal(a), "secret:manage", { orgId: a.tenantId });
  return paginateList(
    (await scanType("SECRET#", a)).map(publicSecret),
    query,
  );
};
const requireSecret = async (a, id) => {
  const secret = await resolveEntity("SECRET#", id, a, "staff resolving a secret by id");
  if (!secret) throw { status: 404, message: "Secret not found" };
  return secret;
};
const createSecret = async (a, body) => {
  await authorizeIn(asPrincipal(a), "secret:manage", { orgId: a.tenantId });
  const valid = validateSecretInput(body);
  const id = `secret_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let created;
  try {
    created = await secrets.send(
      new CreateSecretCommand({
        Name: externalSecretName(a.tenantId, id),
        SecretString: valid.value,
      }),
    );
  } catch {
    throw { status: 502, message: "The secret store did not accept this secret" };
  }
  const record = {
    id,
    tenantId: a.tenantId,
    name: valid.name,
    kind: valid.kind,
    ref: { provider: "aws_secretsmanager", arn: created.ARN },
    hint: secretHint(valid.value),
    createdBy: a.userId,
    createdAt: now(),
    rotatedAt: null,
    lastUsedAt: null,
  };
  await save("SECRET", record);
  // Requirement 20.12: the identifier and name only -- never the value, never the store pointer.
  await logActivity(a.tenantId, {
    actor: a.userId,
    actorLabel: actorLabelFor(asPrincipal(a)),
    action: "SECRET_CREATED",
    summary: `Created secret "${record.name}"`,
    details: { secretId: record.id, name: record.name },
  });
  return publicSecret(record);
};
const rotateSecret = async (a, id, body) => {
  await authorizeIn(asPrincipal(a), "secret:manage", { orgId: a.tenantId });
  const secret = await requireSecret(a, id);
  const value = String(body?.value ?? "");
  if (!value) throw { status: 400, message: "A secret value is required" };
  try {
    await secrets.send(new PutSecretValueCommand({ SecretId: secret.ref.arn, SecretString: value }));
  } catch {
    throw { status: 502, message: "The secret store did not accept this rotation" };
  }
  secret.hint = secretHint(value);
  secret.rotatedAt = now();
  await save("SECRET", secret);
  await logActivity(secret.tenantId, {
    actor: a.userId,
    actorLabel: actorLabelFor(asPrincipal(a)),
    action: "SECRET_ROTATED",
    summary: `Rotated secret "${secret.name}"`,
    details: { secretId: secret.id, name: secret.name },
  });
  return publicSecret(secret);
};
const deleteSecret = async (a, id) => {
  await authorizeIn(asPrincipal(a), "secret:manage", { orgId: a.tenantId });
  const secret = await requireSecret(a, id);
  try {
    await secrets.send(new DeleteSecretCommand({ SecretId: secret.ref.arn }));
  } catch (err) {
    // A store that has already forgotten this secret must not block removing our own pointer to it.
    if (!(err && err.name === "ResourceNotFoundException"))
      throw { status: 502, message: "The secret store could not delete this secret" };
  }
  await db.send(
    new DeleteItemCommand({
      TableName: table,
      Key: { pk: { S: `TENANT#${secret.tenantId}` }, sk: { S: `SECRET#${secret.id}` } },
    }),
  );
  await logActivity(secret.tenantId, {
    actor: a.userId,
    actorLabel: actorLabelFor(asPrincipal(a)),
    action: "SECRET_DELETED",
    summary: `Deleted secret "${secret.name}"`,
    details: { secretId: secret.id, name: secret.name },
  });
  return { id: secret.id, deleted: true };
};

/* ============================ Phase 4: organization, users, teams, invitations, notifications = */

// ---------- 11.1 Additive organization fields ----------
//
// Every field below is ADDITIVE. Requirement 8.1 asks that the existing identifier, name, slug,
// execution status, plan, timestamps, branding, and settings be retained without modification, and
// they are: nothing here renames or moves an existing field. In particular the logo location stays
// inside `branding` and is NOT duplicated at the top level (requirement 8.3), because two places
// holding the same URL is two places to disagree about which one the sign-in screen reads.
//
// The commercial lifecycle status is a SEPARATE field from the execution status, and that separation
// is the whole point of requirement 8: a sales stage must never be able to gate execution. `canceled`
// commercially and `active` operationally is a real, legitimate state -- a customer in their notice
// period is still entitled to have their work run.
const COMMERCIAL_STATUSES = [
  "prospect",
  "onboarding",
  "trial",
  "active",
  "suspended",
  "canceled",
];
// Requirement 8.12: an organization with no commercial status recorded reads as commercially active.
// Every organization that exists today is in exactly that position, so the default has to be the
// reading that changes nothing about them.
const lifecycleStatusOf = (org) =>
  org && COMMERCIAL_STATUSES.includes(org.lifecycleStatus) ? org.lifecycleStatus : "active";

// Internal-only fields, never rendered on a customer surface (requirement 8.6). Stripped by
// organization identifier rather than by route, so a new route reading an organization cannot forget.
const INTERNAL_ORG_FIELDS = ["lifecycleStatus", "accountOwnerUserId", "crmRecordId"];

/**
 * The customer's view of an organization.
 *
 * A partial step toward requirement 27.11's per-route response allowlist: this is a per-ENTITY
 * projection rather than a per-route one, which is the honest description of it. It closes the leak
 * that matters here -- an organization admin reading their own organization must not receive
 * AmazFlow's internal note that they are commercially `canceled`.
 */
const organizationFor = (org, p) => {
  if (!org) return org;
  const out = { ...org, settings: orgSettings(org) };
  if (p && p.isStaff) return { ...out, lifecycleStatus: lifecycleStatusOf(org) };
  for (const field of INTERNAL_ORG_FIELDS) delete out[field];
  return out;
};

const validateContact = (label, value) => {
  if (value === null || value === undefined || value === "") return null;
  const contact = typeof value === "object" ? value : { email: String(value) };
  const email = String(contact.email || "").trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw { status: 400, message: `${label} must carry a valid email address` };
  return {
    name: String(contact.name || "").trim().slice(0, 120),
    email,
    phone: String(contact.phone || "").trim().slice(0, 40),
  };
};

// A bare hostname, not a URL. `acme.com`, never `https://acme.com/`: this value is compared against
// the domain half of an email address at invitation time, and a stored scheme would make every
// comparison a parse.
const validatePrimaryDomain = (value) => {
  const v = String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!v) return "";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v))
    throw { status: 400, message: `"${value}" is not a valid domain` };
  return v;
};

const ONBOARDING_STATUSES = ["not_started", "in_progress", "blocked", "complete"];

/**
 * The additive half of the organization profile, split by who may write it.
 *
 * `scope: "internal"` accepts the three internal-only fields; `scope: "customer"` refuses them by
 * name rather than ignoring them. Silently dropping a field a caller sent is how a control that does
 * nothing gets shipped: the request succeeds, the screen shows the old value, and nobody can tell
 * whether the write or the read is wrong.
 */
const validateOrgExtendedProfile = (body, scope) => {
  const out = {};
  if ("primaryDomain" in body) out.primaryDomain = validatePrimaryDomain(body.primaryDomain);
  if ("primaryContact" in body)
    out.primaryContact = validateContact("primaryContact", body.primaryContact);
  if ("billingContact" in body)
    out.billingContact = validateContact("billingContact", body.billingContact);
  if ("onboardingStatus" in body) {
    const v = String(body.onboardingStatus || "").trim();
    if (!ONBOARDING_STATUSES.includes(v))
      throw {
        status: 400,
        message: `onboardingStatus must be one of ${ONBOARDING_STATUSES.join(", ")}`,
      };
    out.onboardingStatus = v;
  }
  for (const field of INTERNAL_ORG_FIELDS) {
    if (!(field in body)) continue;
    if (scope !== "internal")
      throw {
        status: 403,
        message: `${field} is an internal AmazFlow field and cannot be set by an organization`,
      };
    if (field === "lifecycleStatus") {
      const v = String(body.lifecycleStatus || "").trim();
      if (!COMMERCIAL_STATUSES.includes(v))
        throw {
          status: 400,
          message: `lifecycleStatus must be one of ${COMMERCIAL_STATUSES.join(", ")}`,
        };
      out.lifecycleStatus = v;
    } else out[field] = String(body[field] || "").trim().slice(0, 200);
  }
  if ("activatedAt" in body)
    throw {
      status: 400,
      message: "activatedAt is derived from the first completed production run and cannot be supplied",
    };
  return out;
};

/**
 * Requirement 8.16: an execution-status or commercial-status change records previous and new values.
 *
 * Emitted as its own action rather than folded into ORG_UPDATED, because "who paused us, and when"
 * is a question asked on its own and answering it should not require reading every profile edit.
 * `activatedAt` is deliberately untouched here: requirement 24.14 derives it from the first
 * completed production run, not from an administrative status change.
 */
const recordOrgLifecycle = async (before, after, actor) => {
  const changes = [];
  if (String(before.status || "") !== String(after.status || ""))
    changes.push(["executionStatus", before.status || null, after.status || null]);
  if (lifecycleStatusOf(before) !== lifecycleStatusOf(after))
    changes.push(["lifecycleStatus", lifecycleStatusOf(before), lifecycleStatusOf(after)]);
  if (!changes.length) return after;
  for (const [field, previous, next] of changes)
    await logActivity(after.slug, {
      actor: actor.userId,
      actorLabel: actorLabelFor(asPrincipal(actor)),
      action: "ORG_STATUS_CHANGED",
      summary: `${field} changed from ${previous} to ${next}`,
      details: { field, previous, next },
    });
  return after;
};

// ---------- 11.2 Slug uniqueness without reuse ----------
//
// Immutability is already enforced by validateOrgProfile: the slug IS the tenant identifier, carried
// in every Cognito claim and every partition key, so renaming it would orphan the tenant's data.
//
// Requirement 8.15's second half is the harder one: a slug must never be REUSED, including by a
// former organization. So a reservation record is written at creation and never deleted. Checking
// only `getOrganization(slug)` would let a deleted organization's slug come back around, and the new
// tenant would then inherit every stale ACTIVITY# and RUN# record still sitting under
// `TENANT#<slug>` -- one organization silently reading another's history, which is precisely the
// class of defect Phase 2 spent itself closing.
const slugReservationKey = (slug) => `SLUGRESERVED#${slug}`;
const slugIsReserved = async (slug) => {
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: { pk: { S: "PLATFORM" }, sk: { S: slugReservationKey(slug) } },
    }),
  );
  return !!out.Item;
};
const reserveSlug = async (slug, reason) =>
  db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: "PLATFORM" },
        sk: { S: slugReservationKey(slug) },
        document: { S: JSON.stringify({ slug, reservedAt: now(), reason }) },
        updatedAt: { S: now() },
      },
      ConditionExpression: "attribute_not_exists(pk)",
    }),
  );
/**
 * Derive and atomically reserve a slug, appending an ordinal when another creator wins a race.
 */
const uniqueSlugFrom = async (base, reason = "generated organization slug") => {
  const root = slugify(base);
  if (!root) return null;
  for (let n = 1; n <= 50; n += 1) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    if (await getOrganization(candidate)) continue;
    try {
      await reserveSlug(candidate, reason);
      return candidate;
    } catch (err) {
      if (!err || err.name !== "ConditionalCheckFailedException") throw err;
    }
  }
  return null;
};

// ---------- 11.16 Retention attribute ----------
//
// Q-8's conservative assumption, as data. No retention period is asserted anywhere: what ships is the
// ATTRIBUTE, so that a decided value later changes a number rather than a data model. `ttl` is left
// UNSET when no period is configured, because a table with time-to-live enabled deletes anything
// carrying a past timestamp -- writing a default here would be choosing a retention policy by
// accident, which is the opposite of what Q-8 asks for.
const RETENTION_DAYS = {
  notification: Number(process.env.NOTIFICATION_RETENTION_DAYS || 0),
  crmEvent: Number(process.env.CRM_EVENT_RETENTION_DAYS || 0),
  invitation: Number(process.env.INVITATION_RETENTION_DAYS || 0),
};
const retentionTtl = (kind, fromIso) => {
  const days = RETENTION_DAYS[kind];
  if (!Number.isFinite(days) || days <= 0) return undefined;
  const base = fromIso ? Date.parse(fromIso) : Date.now();
  return Math.floor((base + days * 86400000) / 1000);
};
const withTtl = (item, ttl) => (ttl ? { ...item, ttl: { N: String(ttl) } } : item);

// ---------- 12.1 / 12.2 Notifications ----------
//
// Requirement 22.2 is the interesting one, and it is a coupling rather than a check: a notification
// may only be created at a point where the corresponding platform event is also recorded. Enforced
// structurally -- `notify()` does not exist. The only way to produce a notification is
// `logActivity(tenantId, entry, notification)`, which writes the audit record FIRST and the
// notification second, so a notification cannot exist for an event that did not occur. A "you have an
// approval waiting" that no audit trail corroborates is worse than no notification at all: the person
// goes looking for work that was never there.
const NOTIFICATION_KINDS = [
  "approval_required",
  "run_failed",
  "run_timed_out",
  "agent_offline",
  "connection_error",
  "exception_raised",
  "invitation_accepted",
  "onboarding_step_ready",
];
// Audience is a string rather than a user id so a notification can address a role, a team, or the
// whole organization. "everyone" is the default because most of these concern the organization's work
// rather than one person's inbox.
const saveNotification = async (notification) => {
  const ttl = retentionTtl("notification", notification.createdAt);
  await db.send(
    new PutItemCommand({
      TableName: table,
      Item: withTtl(
        {
          pk: { S: `TENANT#${notification.tenantId}` },
          sk: { S: `NOTIFICATION#${String(Date.now()).padStart(14, "0")}_${notification.id}` },
          tenantId: { S: notification.tenantId },
          document: { S: JSON.stringify(notification) },
          updatedAt: { S: now() },
        },
        ttl,
      ),
    }),
  );
  return notification;
};
const buildNotification = (tenantId, spec) => {
  if (!NOTIFICATION_KINDS.includes(spec.kind))
    throw new Error(`unknown notification kind ${spec.kind}`);
  return {
    id: `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId,
    audience: spec.audience || "everyone",
    kind: spec.kind,
    title: String(spec.title || "").slice(0, 160),
    body: String(spec.body || "").slice(0, 600),
    // The deep link is a path on the customer application, not an absolute URL: the surface that
    // renders it knows its own origin, and storing one would bake today's domain into every record.
    deepLink: String(spec.deepLink || "/"),
    eventId: spec.eventId || null,
    createdAt: now(),
  };
};
// Read state is per user AND per notification (requirement 22.6), so it cannot live on the
// notification: two people reading the same organization-wide notification must not overwrite each
// other's inbox.
const notificationReadKey = (username, notificationId) =>
  `NOTIFREAD#${username}#${notificationId}`;
const markNotificationRead = async (tenantId, username, notificationId) =>
  db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: `TENANT#${tenantId}` },
        sk: { S: notificationReadKey(username, notificationId) },
        tenantId: { S: tenantId },
        document: {
          S: JSON.stringify({ username, notificationId, readAt: now() }),
        },
        updatedAt: { S: now() },
      },
    }),
  );
const notificationsFor = async (p, username) => {
  // tenantRead, so requirement 22.8 holds by construction rather than by a filter somebody has to
  // remember: the query is partitioned on the principal's own organization.
  const [items, readRecords, preferences] = await Promise.all([
    tenantRead("NOTIFICATION#", p),
    tenantRead(`NOTIFREAD#${username}#`, p),
    readPreferences(p.orgId, username),
  ]);
  const read = new Set(readRecords.map((r) => r.notificationId));
  const audienceMatches = (audience) =>
    !audience ||
    audience === "everyone" ||
    audience === username ||
    audience === `user:${username}` ||
    audience === p.role ||
    audience === `role:${p.role}` ||
    (Array.isArray(p.teamIds) && p.teamIds.some((id) => audience === id || audience === `team:${id}`));
  return items
    .filter((n) => audienceMatches(n.audience))
    .filter((n) => preferences.values[`notify.${n.kind}`] !== false)
    .map((n) => ({ ...n, read: read.has(n.id) }))
    .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
};

// ---------- 11.14 Personal preferences ----------
//
// Requirement 12.4/12.5: every preference the view accepts is persisted, and no setting is presented
// whose value is not stored. The allowlist below is the contract in both directions -- a key absent
// from it is refused rather than dropped, and the surface renders only keys it can read back.
//
// There is deliberately NO email toggle. Requirement 22.9 says email delivery is not offered in this
// release, so a per-kind email preference would be a control that accepts input and does nothing --
// exactly the `plan`-field mistake (H-3) in a new place.
const PREFERENCE_KEYS = [
  ...NOTIFICATION_KINDS.map((kind) => `notify.${kind}`),
  "display.timezone",
  "display.density",
];
const preferencesKey = (username) => `PREFERENCES#${username}`;
const readPreferences = async (orgId, username) => {
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: { pk: { S: `TENANT#${orgId}` }, sk: { S: preferencesKey(username) } },
    }),
  );
  const stored = out.Item && out.Item.document?.S ? JSON.parse(out.Item.document.S) : {};
  const values = {};
  for (const key of PREFERENCE_KEYS)
    values[key] = key in (stored.values || {}) ? stored.values[key] : defaultPreference(key);
  return { username, values, updatedAt: stored.updatedAt || null, keys: PREFERENCE_KEYS };
};
// In-app notification of everything is the honest default: the platform records these events either
// way, so defaulting to off would hide work a person is accountable for.
const defaultPreference = (key) =>
  key.startsWith("notify.") ? true : key === "display.density" ? "comfortable" : "";
const savePreferences = async (orgId, username, patch) => {
  const current = await readPreferences(orgId, username);
  const values = { ...current.values };
  for (const [key, value] of Object.entries(patch)) {
    if (!PREFERENCE_KEYS.includes(key))
      throw { status: 400, message: `"${key}" is not a preference this platform stores` };
    values[key] = key.startsWith("notify.")
      ? !!value
      : String(value || "").trim().slice(0, 60);
  }
  const doc = { username, values, updatedAt: now() };
  await db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: `TENANT#${orgId}` },
        sk: { S: preferencesKey(username) },
        tenantId: { S: orgId },
        document: { S: JSON.stringify(doc) },
        updatedAt: { S: now() },
      },
    }),
  );
  return { ...doc, keys: PREFERENCE_KEYS };
};

// ---------- 11.7 Sign-in timestamp ----------
//
// Requirement 9.23. Written on `GET /me`, which is the first authenticated call every surface makes,
// rather than on every request: a write per request would triple the cost of a page load to record a
// value nothing reads more precisely than "today".
//
// Recorded ABSENT rather than zero when it has never happened (requirement 9.22). `null` is what the
// users view renders as "not recorded", and a placeholder date would be a lie a support conversation
// would eventually be built on.
const touchMembershipLogin = async (p) => {
  if (!p || !p.orgId || !p.userId) return;
  const username = p.email || p.userId;
  const membership = await readMembership(p.orgId, username).catch(() => null);
  if (!membership) return;
  const at = now();
  // Coarse to the minute: a sign-in timestamp is not telemetry, and rewriting the record on every
  // /me poll would make the membership record the hottest key in the table.
  if (membership.lastLoginAt && at.slice(0, 16) === String(membership.lastLoginAt).slice(0, 16))
    return;
  await saveMembership({ ...membership, lastLoginAt: at, updatedAt: at }).catch(() => {});
};

// ---------- 11.5 Role change ----------
//
// Remediates H-8: no route existed to change a role at all, so a fine role could only be defaulted
// from the coarse group or seeded. This closes the write side of task 7.5.
const membershipsFor = async (p) => tenantRead("MEMBERSHIP#", p);
/**
 * Requirement 9.19: a role change must not leave the organization with no owner.
 *
 * Evaluated against the STORED memberships, not against the request, and it deliberately counts
 * owners other than the target rather than counting owners after the change. Those differ when the
 * target is being *given* ownership, and getting it wrong the other way would refuse the very change
 * that fixes an ownerless organization.
 *
 * An organization with zero owners today (every organization, until an owner is assigned) is not
 * blocked: there is nothing to preserve.
 */
const wouldOrphanOwnership = (memberships, username, nextRole) => {
  if (nextRole === "ORG_OWNER") return false;
  const owners = memberships.filter((m) => m.role === "ORG_OWNER");
  if (!owners.length) return false;
  const target = owners.find((m) => m.username === username);
  if (!target) return false;
  return owners.length === 1;
};
const changeMemberRole = async (tenantId, username, nextRole, actor, p) => {
  if (!PLATFORM_ROLES.includes(nextRole))
    throw { status: 400, message: `role must be one of ${CUSTOMER_ROLES.join(", ")}` };
  // Requirement 9.18. Checked on the role being GRANTED, which is not an authorization decision
  // about the caller -- the caller already passed `user:set_role`. Nobody grants staff through a
  // customer route, including a staff member, because the audit story for that is
  // "AmazFlow gave a customer account staff access" and it should require touching the user pool.
  if (nextRole === "STAFF_ADMIN" || !isInvitableGroup(coarseOf(nextRole)))
    throw {
      status: 403,
      message: "AmazFlow staff access is not granted through this route",
    };
  const users = await listTenantUsers(tenantId);
  const target = users.find((u) => u.username === username || u.email === username);
  if (!target) throw { status: 404, message: "Not found" };
  const memberships = await membershipsFor({ ...p, orgId: tenantId });
  if (wouldOrphanOwnership(memberships, target.email, nextRole))
    throw {
      status: 409,
      message:
        "This is the organization's only owner. Make somebody else an owner first, so the organization is never left without one.",
    };
  const previous =
    (memberships.find((m) => m.username === target.email) || {}).role ||
    defaultRoleForGroup(target.role);
  const nextGroup = coarseOf(nextRole);
  // Requirement 9.17: reconcile the coarse group when the mapped group differs. Order matters --
  // ADD before REMOVE, so a failure between the two leaves the person in two groups (over-broad for
  // a moment, still able to sign in) rather than in none (locked out). `auth()` picks the first
  // matching group, so the transient state resolves deterministically rather than randomly.
  if (nextGroup !== target.role) {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: target.username,
        GroupName: nextGroup,
      }),
    );
    try {
      await cognito.send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: process.env.USER_POOL_ID,
          Username: target.username,
          GroupName: target.role,
        }),
      );
    } catch (err) {
      // Roll back the newly-added group when possible. Persisting the fine role while Cognito still
      // reports the old coarse group would make the next read discard the requested role.
      await cognito
        .send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: process.env.USER_POOL_ID,
            Username: target.username,
            GroupName: nextGroup,
          }),
        )
        .catch(() => {});
      console.error("role change: coarse-group reconciliation failed", {
        tenantId,
        username: target.username,
        from: target.role,
        to: nextGroup,
        error: err && err.message,
      });
      throw {
        status: 502,
        message: "The role could not be reconciled at the identity provider. No membership change was saved; retry the role change.",
      };
    }
  }
  const membership = {
    ...(memberships.find((m) => m.username === target.email) || {}),
    orgId: tenantId,
    username: target.email,
    role: nextRole,
    teamIds: (memberships.find((m) => m.username === target.email) || {}).teamIds || [],
    status: "active",
    createdAt:
      (memberships.find((m) => m.username === target.email) || {}).createdAt || now(),
    updatedAt: now(),
  };
  await saveMembership(membership);
  await logActivity(tenantId, {
    actor: actor.userId,
    actorLabel: actorLabelFor(asPrincipal(actor)),
    action: "TEAM_MEMBER_ROLE_CHANGED",
    summary: `Changed ${target.email} from ${previous} to ${nextRole}`,
    details: { username: target.email, previousRole: previous, role: nextRole, coarseGroup: nextGroup },
  });
  return { username: target.email, role: nextRole, previousRole: previous, coarseGroup: nextGroup };
};

// ---------- 11.9 / 11.10 Invitations ----------
//
// The token is high-entropy and only its hash is stored (requirement 26.1). That is the difference
// between a leaked database and a leaked set of working invitation links: an attacker with the table
// has hashes, and a hash cannot be presented to the acceptance route.
const INVITATION_TTL_DAYS = 7;
const newInvitationToken = () => crypto.randomBytes(32).toString("base64url");
// The token index lives in the flat PLATFORM partition because the inspection route is
// UNAUTHENTICATED: a bare token carries no organization until it is looked up, so there is no tenant
// partition to query. The index holds the organization and invitation id and nothing else -- no
// email, no role, no name -- so the unauthenticated lookup cannot become a disclosure by itself.
const invitationIndexKey = (tokenHash) => `INVITETOKEN#${tokenHash}`;
const saveInvitationIndex = async (tokenHash, orgId, invitationId, expiresAt) =>
  db.send(
    new PutItemCommand({
      TableName: table,
      Item: withTtl(
        {
          pk: { S: "PLATFORM" },
          sk: { S: invitationIndexKey(tokenHash) },
          document: { S: JSON.stringify({ orgId, invitationId }) },
          updatedAt: { S: now() },
        },
        retentionTtl("invitation", expiresAt),
      ),
    }),
  );
const readInvitationIndex = async (tokenHash) => {
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: { pk: { S: "PLATFORM" }, sk: { S: invitationIndexKey(tokenHash) } },
    }),
  );
  return out.Item && out.Item.document?.S ? JSON.parse(out.Item.document.S) : null;
};
const invitationSk = (id) => `INVITATION#${id}`;
const readInvitation = async (orgId, id) => {
  const out = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: { pk: { S: `TENANT#${orgId}` }, sk: { S: invitationSk(id) } },
    }),
  );
  return out.Item && out.Item.document?.S ? JSON.parse(out.Item.document.S) : null;
};
const saveInvitation = async (invitation, condition) => {
  const input = {
    TableName: table,
    Item: withTtl(
      {
        pk: { S: `TENANT#${invitation.orgId}` },
        sk: { S: invitationSk(invitation.id) },
        tenantId: { S: invitation.orgId },
        document: { S: JSON.stringify(invitation) },
        state: { S: invitation.state },
        updatedAt: { S: now() },
      },
      // Requirement 26.2 with Q-8: an EXPIRED invitation carries the retention attribute. A pending
      // one does not -- expiring the record out from under a live invitation would turn a valid link
      // into "no such invitation" rather than "this expired", and those read very differently to the
      // person holding the link.
      invitation.state === "expired" || invitation.state === "revoked"
        ? retentionTtl("invitation", invitation.expiresAt)
        : undefined,
    ),
  };
  if (condition) {
    input.ConditionExpression = condition.expression;
    input.ExpressionAttributeNames = condition.names;
    input.ExpressionAttributeValues = condition.values;
  }
  await db.send(new PutItemCommand(input));
  return invitation;
};
const createInvitationRecord = async (orgId, email, role, actor) => {
  const token = newInvitationToken();
  const createdAt = now();
  const invitation = {
    id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    orgId,
    tenantId: orgId,
    email,
    role,
    invitedBy: actor.userId,
    invitedByEmail: actor.email || null,
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + INVITATION_TTL_DAYS * 86400000).toISOString(),
    state: "pending",
    tokenHash: hashToken(token),
  };
  await saveInvitation(invitation);
  await saveInvitationIndex(invitation.tokenHash, orgId, invitation.id, invitation.expiresAt);
  // Requirement 26.4: the link points at the customer application's acceptance route. Returned to the
  // caller rather than stored, so the only copy of the plaintext token is the one in flight.
  return { invitation, token, acceptUrl: `${CUSTOMER_APP_ORIGIN}/accept-invitation/?token=${token}` };
};
const CUSTOMER_APP_ORIGIN = "https://app.amazflow.com";
// Expiry is OBSERVED rather than swept: a record is marked expired the first time somebody looks at
// it after its expiry. A sweep would be a second place that decides what expired means, and the two
// would eventually disagree about the boundary second.
const invitationExpired = (invitation) =>
  !!invitation.expiresAt && Date.parse(invitation.expiresAt) <= Date.now();
const observeInvitationExpiry = async (invitation, actor) => {
  if (invitation.state !== "pending" || !invitationExpired(invitation)) return invitation;
  const expired = { ...invitation, state: "expired", expiredAt: now() };
  await saveInvitation(expired).catch(() => {});
  await logActivity(invitation.orgId, {
    actor: (actor && actor.userId) || "system",
    actorLabel: "AmazFlow platform",
    action: "INVITATION_EXPIRED",
    summary: `Invitation for ${invitation.email} was observed expired`,
    details: { invitationId: invitation.id, email: invitation.email },
  }).catch(() => {});
  return expired;
};

/**
 * Requirement 26.18: the inspection and acceptance routes are rate-limited.
 *
 * Both are reachable with a token and no session, which makes them the only guessing surface on the
 * platform. The counter is keyed on the caller's address rather than the token, because a token-keyed
 * limit is no limit at all against somebody trying a different token every time -- which is the
 * attack.
 */
const RATE_LIMITS = {
  invitation_inspect: { limit: 30, windowMs: 300000 },
  invitation_accept: { limit: 10, windowMs: 300000 },
  // Requirement 26.11: both are unauthenticated and reachable from the public marketing site, so the
  // caller's address is the only subject a rate limit has to key on.
  lead_create: { limit: 5, windowMs: 300000 },
  branding_read: { limit: 60, windowMs: 300000 },
};
const rateLimitKey = (bucket, subject, windowStart) =>
  `RATELIMIT#${bucket}#${subject}#${windowStart}`;
const consumeRateLimit = async (bucket, subject) => {
  const config = RATE_LIMITS[bucket];
  if (!config || !subject) return { allowed: true };
  const windowStart = Math.floor(Date.now() / config.windowMs) * config.windowMs;
  const sk = rateLimitKey(bucket, subject, windowStart);
  const existing = await db
    .send(new GetItemCommand({ TableName: table, Key: { pk: { S: "PLATFORM" }, sk: { S: sk } } }))
    .catch(() => ({}));
  const count = existing.Item && existing.Item.document?.S ? JSON.parse(existing.Item.document.S).count : 0;
  if (count >= config.limit)
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((windowStart + config.windowMs - Date.now()) / 1000),
    };
  await db
    .send(
      new PutItemCommand({
        TableName: table,
        Item: withTtl(
          {
            pk: { S: "PLATFORM" },
            sk: { S: sk },
            document: { S: JSON.stringify({ bucket, subject, windowStart, count: count + 1 }) },
            updatedAt: { S: now() },
          },
          Math.floor((windowStart + config.windowMs * 2) / 1000),
        ),
      }),
    )
    .catch(() => {});
  return { allowed: true };
};
const callerAddress = (e) =>
  (e.requestContext && e.requestContext.http && e.requestContext.http.sourceIp) ||
  (e.headers && (e.headers["x-forwarded-for"] || e.headers["X-Forwarded-For"])) ||
  "unknown";

/**
 * Accept an invitation. Requirements 26.8 through 26.16.
 *
 * The two things that make this correct rather than merely working:
 *
 *   * The organization and role come from the STORED record and the body is not consulted at all
 *     (requirements 26.13/26.14). Not "validated against" -- not read. A body that claims
 *     `{"orgId":"someone-else","role":"ORG_OWNER"}` cannot influence the outcome, because there is no
 *     code path in which it is looked at.
 *   * The transition is a conditional write requiring the current state to be `pending`
 *     (requirement 26.9), so two simultaneous accepts produce exactly one winner and the loser gets a
 *     state conflict. A read-then-write would let both succeed under any real interleaving.
 */
const acceptInvitation = async (token, a) => {
  const index = await readInvitationIndex(hashToken(token));
  if (!index) throw { status: 404, message: "Not found" };
  let invitation = await readInvitation(index.orgId, index.invitationId);
  if (!invitation) throw { status: 404, message: "Not found" };
  invitation = await observeInvitationExpiry(invitation, a);
  if (invitation.state === "accepted")
    throw { status: 409, message: "This invitation has already been accepted", code: "CONFLICT" };
  if (invitation.state === "revoked")
    throw { status: 409, message: "This invitation was withdrawn", code: "CONFLICT" };
  if (invitation.state === "expired" || invitationExpired(invitation))
    throw { status: 410, message: "This invitation has expired", code: "GONE" };
  // Requirement 26.8: the authenticated caller's address must match the invitation. Without this a
  // signed-in person who obtained somebody else's link would join in the invitee's place.
  const callerEmail = String(a.email || "").trim().toLowerCase();
  if (!callerEmail || callerEmail !== invitation.email)
    throw {
      status: 403,
      message: "This invitation was sent to a different email address. Sign in as that address to accept it.",
      code: "FORBIDDEN",
    };
  const accepted = { ...invitation, state: "accepted", acceptedAt: now(), acceptedBy: a.userId };
  try {
    await saveInvitation(accepted, {
      expression: "attribute_exists(pk) AND #state = :pending",
      names: { "#state": "state" },
      values: { ":pending": { S: "pending" } },
    });
  } catch (err) {
    if (err && err.name === "ConditionalCheckFailedException")
      throw { status: 409, message: "This invitation has already been accepted", code: "CONFLICT" };
    throw err;
  }
  // Requirement 26.15/26.16: the membership's organization and role EQUAL the invitation's.
  await saveMembership({
    orgId: invitation.orgId,
    username: invitation.email,
    role: invitation.role,
    teamIds: [],
    status: "active",
    invitedAt: invitation.createdAt,
    invitedBy: invitation.invitedBy,
    activatedAt: accepted.acceptedAt,
    createdAt: invitation.createdAt,
    updatedAt: accepted.acceptedAt,
  });
  await logActivity(
    invitation.orgId,
    {
      actor: a.userId,
      actorLabel: "Team member",
      action: "INVITATION_ACCEPTED",
      summary: `${invitation.email} accepted their invitation as ${invitation.role}`,
      details: { invitationId: invitation.id, email: invitation.email, role: invitation.role },
    },
    {
      kind: "invitation_accepted",
      title: `${invitation.email} joined`,
      body: `${invitation.email} accepted their invitation and is now active as ${invitation.role}.`,
      deepLink: "/admin/users/",
    },
  );
  return { organizationId: invitation.orgId, role: invitation.role, email: invitation.email };
};

// Requirement 26.17: a resend issues a NEW token and revokes the previous record, so the previously
// issued link stops working. Two live links for one invitation is one link too many -- the old one is
// the one that leaked.
const resendInvitation = async (tenantId, username, actor, p) => {
  const users = await listTenantUsers(tenantId);
  const target = users.find((u) => u.username === username || u.email === username);
  if (!target) throw { status: 404, message: "Not found" };
  if (target.userStatus !== "FORCE_CHANGE_PASSWORD")
    throw {
      status: 409,
      message: `${target.email} has already signed in, so there is no pending invitation to resend.`,
    };
  const existing = (await tenantRead("INVITATION#", { ...p, orgId: tenantId })).filter(
    (i) => i.email === target.email && i.state === "pending",
  );
  for (const invitation of existing)
    await saveInvitation({ ...invitation, state: "revoked", revokedAt: now(), revokedReason: "superseded_by_resend" });
  const role =
    (existing[0] && existing[0].role) ||
    defaultRoleForGroup(target.role);
  const { invitation, acceptUrl } = await createInvitationRecord(
    tenantId,
    target.email,
    role,
    actor,
  );
  // Cognito owns the credential half: RESEND reissues the temporary password to the same address.
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: target.username,
        MessageAction: "RESEND",
        DesiredDeliveryMediums: ["EMAIL"],
      }),
    );
  } catch (err) {
    console.error("invitation resend: cognito message not reissued", {
      tenantId,
      username: target.username,
      error: err && err.message,
    });
    throw {
      status: 502,
      message: "The invitation message could not be reissued. Retry the invitation.",
    };
  }
  await logActivity(tenantId, {
    actor: actor.userId,
    actorLabel: actorLabelFor(asPrincipal(actor)),
    action: "INVITATION_RESENT",
    summary: `Resent the invitation for ${target.email}`,
    details: { email: target.email, invitationId: invitation.id, supersededCount: existing.length },
  });
  return { email: target.email, invitationId: invitation.id, acceptUrl };
};

// Requirement 9.13 / 26.19: revoke applies only BEFORE the initial password challenge completes, and
// disables rather than deletes. Requirement 9.16 has no delete route anywhere, because a deleted user
// takes their audit attribution with them -- every "who approved this" becomes "somebody who no
// longer exists".
const revokeInvitation = async (tenantId, username, actor, p) => {
  const users = await listTenantUsers(tenantId);
  const target = users.find((u) => u.username === username || u.email === username);
  if (!target) throw { status: 404, message: "Not found" };
  if (target.userStatus !== "FORCE_CHANGE_PASSWORD")
    throw {
      status: 409,
      message: `${target.email} has already signed in, so this is no longer a pending invitation. Deactivate the account instead.`,
    };
  await cognito.send(
    new AdminDisableUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: target.username }),
  );
  const pending = (await tenantRead("INVITATION#", { ...p, orgId: tenantId })).filter(
    (i) => i.email === target.email && i.state === "pending",
  );
  for (const invitation of pending)
    await saveInvitation({ ...invitation, state: "revoked", revokedAt: now(), revokedReason: "revoked_by_admin" });
  const membership = await readMembership(tenantId, target.email).catch(() => null);
  if (membership)
    await saveMembership({ ...membership, status: "deactivated", updatedAt: now() }).catch(() => {});
  await logActivity(tenantId, {
    actor: actor.userId,
    actorLabel: actorLabelFor(asPrincipal(actor)),
    action: "INVITATION_REVOKED",
    summary: `Revoked the pending invitation for ${target.email}`,
    details: { email: target.email, revokedInvitations: pending.length },
  });
  return { email: target.email, enabled: false, revokedInvitations: pending.length };
};

// ---------- 11.8 Teams ----------
//
// Requirement 10.6 is a constraint on what teams may NOT do, and it is enforced by absence: no grant
// anywhere depends on a team identifier. The policy accepts a `teamIds` field on a principal and no
// branch of `can()` reads it. That is what lets requirement 10.7's statement -- "team membership
// grants no permissions in this release" -- be true rather than aspirational, and it is why the teams
// view presents no permission control at all.
const teamsFor = async (p) => tenantRead("TEAM#", p);
const validateTeamName = (value) => {
  const name = String(value || "").trim();
  if (!name) throw { status: 400, message: "A team name is required" };
  return name.slice(0, 80);
};
const saveTeam = async (team) => save("TEAM", team);
const syncTeamMembership = async (orgId, username, teamId, present) => {
  const membership = await readMembership(orgId, username).catch(() => null);
  if (!membership) return;
  const current = Array.isArray(membership.teamIds) ? membership.teamIds : [];
  const next = present
    ? current.includes(teamId)
      ? current
      : [...current, teamId]
    : current.filter((id) => id !== teamId);
  if (next.length === current.length && present) return;
  // Requirement 9.20: team assignments are written to the membership record, which is the source of
  // truth for them. The team record's own member list is the denormalized read side.
  await saveMembership({ ...membership, teamIds: next, updatedAt: now() }).catch(() => {});
};

// ---------- 11.14 Personal profile and security facts ----------
// Cognito remains the source of truth for identity attributes. These routes are self-scoped: the
// username is derived from the verified principal and never accepted from a path or request body.
const profileFromCognito = (user, fallbackEmail) => {
  const attrs = Object.fromEntries(
    ((user && (user.UserAttributes || user.Attributes)) || []).map((x) => [x.Name, x.Value]),
  );
  return {
    email: attrs.email || fallbackEmail || null,
    displayName: attrs.name || "",
    givenName: attrs.given_name || "",
    familyName: attrs.family_name || "",
    updatedAt: user && user.UserLastModifiedDate
      ? new Date(user.UserLastModifiedDate).toISOString()
      : null,
  };
};
const readOwnProfile = async (a) => {
  const username = a.email || a.userId;
  const user = await cognito.send(
    new AdminGetUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: username }),
  );
  return profileFromCognito(user, a.email);
};
const cleanProfileValue = (label, value) => {
  const text = String(value == null ? "" : value).trim();
  if (text.length > 100) throw { status: 400, message: `${label} must be 100 characters or fewer` };
  if (/[\u0000-\u001f\u007f]/.test(text))
    throw { status: 400, message: `${label} contains unsupported control characters` };
  return text;
};
const updateOwnProfile = async (a, body) => {
  const accepted = [
    ["displayName", "name"],
    ["givenName", "given_name"],
    ["familyName", "family_name"],
  ];
  const updates = accepted
    .filter(([input]) => Object.prototype.hasOwnProperty.call(body, input))
    .map(([input, attribute]) => ({ Name: attribute, Value: cleanProfileValue(input, body[input]) }));
  if (!updates.length) throw { status: 400, message: "Nothing to change" };
  if (Object.prototype.hasOwnProperty.call(body, "email"))
    throw { status: 400, message: "The sign-in email is not changed from the profile route" };
  const username = a.email || a.userId;
  await cognito.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: process.env.USER_POOL_ID,
      Username: username,
      UserAttributes: updates,
    }),
  );
  await logActivity(a.tenantId, {
    actor: a.userId,
    actorLabel: actorLabelFor(asPrincipal(a)),
    action: "PROFILE_UPDATED",
    summary: "Updated personal profile",
    details: { fields: updates.map((x) => x.Name) },
  });
  return { ...(await readOwnProfile(a)), updatedAt: now() };
};
const SECURITY_FACTS = Object.freeze({
  accessTokenMinutes: 60,
  idTokenMinutes: 60,
  refreshTokenDays: 7,
  passwordPolicy: {
    minimumLength: 12,
    requireLowercase: true,
    requireUppercase: true,
    requireNumbers: true,
    requireSymbols: true,
  },
  // Planned identity capabilities are explicitly false so the customer surface can state the
  // disabled reason without rendering a control that implies the capability exists.
  mfaEnrollmentAvailable: false,
  singleSignOnAvailable: false,
  directoryProvisioningAvailable: false,
});

// The customer-writable half of the organization profile. Execution status and plan are AmazFlow's to
// set and are refused here BY NAME: an organization that could set its own status to `active` would
// be able to lift its own suspension, and a plan field a customer can write is a plan field that
// means nothing (H-3, again).
const validateOrgProfileForCustomer = (body) => {
  const out = {};
  if ("name" in body) {
    const v = String(body.name || "").trim();
    if (!v) throw { status: 400, message: "A name is required" };
    out.name = v.slice(0, 120);
  }
  if ("slug" in body)
    throw {
      status: 400,
      message: "An organization slug cannot be changed: it is the tenant identifier",
    };
  for (const field of ["status", "plan"])
    if (field in body)
      throw {
        status: 403,
        message: `An organization's ${field === "status" ? "execution status" : "plan"} is set by AmazFlow, not from this route`,
      };
  return out;
};

exports.handler = async (e) => {
  // Requirement 26.12: use the caller's own correlation identifier where it supplied one -- the
  // shared API client always sends x-correlation-id -- so a customer's own network trace and this
  // request's server-side log line are looking at the same value, rather than two different ones
  // that both happen to be present.
  correlationId =
    e.headers?.["x-correlation-id"] ||
    e.headers?.["X-Correlation-Id"] ||
    e.requestContext?.requestId ||
    `local_${crypto.randomUUID()}`;
  responseRoute = e.routeKey || (e.source === "amazflow.sweep" ? "SWEEP" : "UNKNOWN");
  requestOrigin = allowedOriginFor(e);
  requestStartedAt = Date.now();
  requestUserId = null;
  requestOrgId = null;
  lastPermissionCheck = null;
  requestTruncated = false;
  requestReadTruncated = false;
  responsePagination = null;
  emitApplicationMetric("CrossOrganizationAccess", 0);
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
      const leadGate = await consumeRateLimit("lead_create", callerAddress(e));
      if (!leadGate.allowed)
        return reply(429, {
          error: "Too many submissions. Wait a moment and try again.",
          retryAfterSeconds: leadGate.retryAfterSeconds,
        });
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
          { agentId: agentCtx.agentId, agentType: agentCtx.agent?.agentType || "CHROME_EXTENSION" },
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
          body.capabilities,
          body.permissions,
        );
        await observeOnboarding(agentCtx.tenantId, "firstAgent");
        return reply(200, { ok: true });
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "GET /organizations/{slug}/branding") {
      const brandingGate = await consumeRateLimit("branding_read", callerAddress(e));
      if (!brandingGate.allowed)
        return reply(429, {
          error: "Too many requests. Wait a moment and try again.",
          retryAfterSeconds: brandingGate.retryAfterSeconds,
        });
      const org = await getOrganization(e.pathParameters?.slug);
      if (!org) return reply(404, { error: "Organization not found" });
      return reply(200, {
        slug: org.slug,
        name: org.name,
        branding: org.branding || {},
      });
    }
    // 11.9 -- unauthenticated invitation inspection. Deliberately placed here, above the session gate:
    // the invitee has no account yet, so requiring one would make the invitation unopenable by the only
    // person it is for.
    //
    // The response is exactly two fields (requirement 26.5). Not the role, not the inviting user, not
    // the organization slug -- a token holder should learn who invited them and to what address, and
    // nothing that helps them enumerate the tenancy.
    if (route === "GET /invitations/{token}") {
      const gate = await consumeRateLimit("invitation_inspect", callerAddress(e));
      if (!gate.allowed)
        return reply(429, {
          error: "Too many invitation lookups. Wait a moment and try again.",
          retryAfterSeconds: gate.retryAfterSeconds,
        });
      const index = await readInvitationIndex(hashToken(String(e.pathParameters?.token || "")));
      if (!index) return reply(404, { error: "Not found" });
      let invitation = await readInvitation(index.orgId, index.invitationId);
      if (!invitation) return reply(404, { error: "Not found" });
      invitation = await observeInvitationExpiry(invitation, {});
      const inviteOrgRecord = await getOrganization(invitation.orgId).catch(() => null);
      const visible = {
        organizationName: (inviteOrgRecord && inviteOrgRecord.name) || invitation.orgId,
        email: invitation.email,
      };
      // 410 Gone, not 404: "this existed and has expired" is actionable -- the person asks for a new
      // one -- while "no such invitation" sends them to check the link for a typo that is not there.
      if (invitation.state === "expired" || invitationExpired(invitation))
        return reply(410, {
          error: "This invitation has expired. Ask your AmazFlow contact to send a new one.",
          code: "GONE",
          ...visible,
        });
      if (invitation.state === "accepted")
        return reply(409, {
          error: "This invitation has already been accepted. Sign in instead.",
          code: "CONFLICT",
          ...visible,
        });
      if (invitation.state === "revoked")
        return reply(409, {
          error: "This invitation was withdrawn. Ask your AmazFlow contact to send a new one.",
          code: "CONFLICT",
          ...visible,
        });
      return reply(200, visible);
    }
    const a = auth(e);
    // Requirement 26.12: the structured log line's user/organization fields. userId is a Cognito
    // sub, an opaque identifier -- never a.email, which the requirement names explicitly as
    // something logs must exclude.
    requestUserId = a.userId || null;
    requestOrgId = a.tenantId || null;
    if (!a.role)
      return reply(
        403,
        a.reason === "no_organization"
          ? {
              error: "This account is not attached to an organization.",
              code: "NO_ORGANIZATION",
            }
          : { error: "Role required", code: "NO_ROLE" },
      );
    // An account disabled while a session is still live must stop working on the NEXT call, not
    // whenever the token happens to expire. Nothing here re-checked membership before, so a
    // deactivated person kept full access for the remaining life of their token.
    //
    // This fails OPEN on a lookup error and CLOSED only on a definite Enabled === false. An
    // inability to reach the user pool must not sign the whole customer base out; a pool that
    // clearly says "disabled" must be honoured.
    const accountStatus = await accountStatusFor(a);
    if (accountStatus === "disabled")
      return reply(403, {
        error: "This account has been deactivated. Contact your AmazFlow admin.",
        code: "ACCOUNT_DISABLED",
      });
    // One principal per request. Constructing it is also what lazily backfills the MEMBERSHIP#
    // record (task 7.5), so the migration happens as a side effect of normal use rather than as a
    // batch job somebody has to remember to run.
    const p = await principalFor(a);
    if (route === "GET /onboarding") {
      const denied = await guardIn(p, "org:read", { orgId: a.tenantId });
      if (denied) return denied;
      return reply(200, onboardingForCustomer(await readOnboarding(a.tenantId)));
    }
    if (route === "POST /onboarding/checklist/{step}") {
      const denied = await guardIn(p, "org:settings", { orgId: a.tenantId });
      if (denied) return denied;
      const step = String(e.pathParameters?.step || "").trim();
      const body = JSON.parse(e.body || "{}");
      const state = body.state === "skipped" ? "skipped" : body.state === "complete" ? "complete" : "";
      if (!step || !state) return reply(400, { error: "checklist step and state (complete or skipped) are required" });
      const record = await readOnboarding(a.tenantId);
      const at = now();
      const next = {
        ...record,
        checklist: { ...record.checklist, [step]: { state, actor: a.userId, at } },
        updatedAt: at,
      };
      await saveOnboarding(next);
      await logActivity(a.tenantId, {
        actor: a.userId,
        actorLabel: actorLabelFor(p),
        action: state === "skipped" ? "ONBOARDING_CHECKLIST_SKIPPED" : "ONBOARDING_CHECKLIST_COMPLETED",
        summary: `${state === "skipped" ? "Skipped" : "Completed"} onboarding step "${step}"`,
        details: { step, state, at },
      });
      return reply(200, onboardingForCustomer(next));
    }
    if (route === "GET /organizations/{slug}/onboarding") {
      const slug = String(e.pathParameters?.slug || "");
      const denied = await guardIn(p, "internal:organization_manage", { orgId: slug });
      if (denied) return denied;
      const record = await readOnboarding(slug);
      return reply(200, record);
    }
    if (route === "PUT /organizations/{slug}/onboarding") {
      const slug = String(e.pathParameters?.slug || "");
      const denied = await guardIn(p, "internal:organization_manage", { orgId: slug });
      if (denied) return denied;
      if (!(await getOrganization(slug))) return reply(404, { error: "Organization not found" });
      const body = JSON.parse(e.body || "{}");
      const record = await readOnboarding(slug);
      const nextStatus = body.status === undefined ? record.status : String(body.status);
      if (!ONBOARDING_STATUS_SET.includes(nextStatus))
        return reply(400, { error: `status must be one of ${ONBOARDING_STATUS_SET.join(", ")}` });
      for (const key of ONBOARDING_MILESTONES)
        if ((body.milestones && key in body.milestones) || key in body) return reply(400, { error: "Milestones are derived from observed platform events and cannot be supplied" });
      const next = {
        ...record,
        status: nextStatus,
        ...(body.crmReference !== undefined ? { crmReference: String(body.crmReference).slice(0, 200) } : {}),
        ...(body.internalOwner !== undefined ? { internalOwner: String(body.internalOwner).slice(0, 200) } : {}),
        ...(body.internalNotes !== undefined ? { internalNotes: String(body.internalNotes).slice(0, 4000) } : {}),
        updatedAt: now(),
      };
      await saveOnboarding(next);
      if (record.status !== next.status)
        await logActivity(slug, { actor: a.userId, actorLabel: actorLabelFor(p), action: "ONBOARDING_STATUS_CHANGED", summary: `Onboarding status changed from ${record.status} to ${next.status}`, details: { previous: record.status, next: next.status } });
      return reply(200, next);
    }
    if (route === "GET /me") {
      // Requirement 9.23 (task 11.7). Stamped here rather than on every authenticated route: /me is
      // the first call every surface makes, and a write per request would make the membership record
      // the hottest key in the table to record a value nobody reads more precisely than "today".
      await touchMembershipLogin(p);
      if (["ORG_ADMIN", "ORG_OWNER"].includes(p.role))
        await observeOnboarding(a.tenantId, "administratorActivated");
      const meOrg = await getOrganization(a.tenantId).catch(() => null);
      const meMembership = await readMembership(a.tenantId, a.email || a.userId).catch(() => null);
      return reply(200, {
        userId: a.userId,
        email: a.email || null,
        tenantId: a.tenantId,
        organizationId: a.tenantId,
        // The DISPLAY name, so a surface renders "Acme Logistics" rather than "acme-logistics". Null
        // rather than the slug dressed up as a name when no organization record exists.
        organizationName: (meOrg && meOrg.name) || null,
        role: a.role,
        platformRole: p.role,
        teamIds: p.teamIds,
        sections: visibleSections(p),
        // Requirement 9.22: absent, not zero and not a placeholder date. `null` is what the users view
        // renders as "not recorded", and a fake date is a lie a support conversation gets built on.
        lastLoginAt: (meMembership && meMembership.lastLoginAt) || null,
        accountStatus,
      });
    }
    // The matrix as data, so /admin/roles renders the REAL policy rather than a frontend copy of it
    // that can disagree with enforcement (requirement 7.17, task 7.13).
    if (route === "GET /permissions/matrix") return reply(200, permissionMatrix());
    if (route === "GET /workflows") {
      // 14.5 — text search and the allowlisted filter field set. Applied server-side so the answer a
      // surface renders is the answer the control plane stands behind, and an unrecognized field is
      // refused rather than ignored (requirement 13.7).
      let filters;
      try {
        filters = readWorkflowFilters(e.queryStringParameters);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
      const items = await scanType("WORKFLOW#", a);
      return reply(
        200,
        paginateList(
          items
            .filter((workflow) => workflowMatchesFilters(workflow, filters))
            .sort((x, y) =>
              String(y.version).localeCompare(String(x.version)),
            ),
          e.queryStringParameters,
        ),
      );
    }
    if (route === "POST /workflows") {
      {
        const denied = await guardIn(p, "internal:workflow_author", { orgId: a.tenantId });
        if (denied) return reply(denied.statusCode, { error: "Only AmazFlow super admins configure workflows", code: "FORBIDDEN" });
      }
      const body = JSON.parse(e.body || "{}");
      const shapeError = validateWorkflowShape(body);
      if (shapeError) return reply(400, { error: shapeError });
      // 13.3 — the legacy `paused` value is never written again, including by staff. Refused by name
      // so a caller still sending it learns that rather than having it silently rewritten.
      if (body.status !== undefined && !WORKFLOW_STATUSES.includes(body.status))
        return reply(400, {
          error:
            body.status === "paused"
              ? 'The status "paused" has been retired. Use "archived", which is how existing paused records already display.'
              : `status must be one of ${WORKFLOW_STATUSES.join(", ")}`,
        });
      if (body.status === "active") {
        const gap = await managedConnectionGapFor(body);
        if (gap)
          return reply(409, {
            error: `Managed browser step "${gap.stepId}" ${gap.reason} -- it must reference an active, authenticated connection`,
          });
      }
      const saved = await saveWorkflowWithVersion(body);
      await logActivity(saved.tenantId, {
        actor: a.userId,
        actorLabel: "AmazFlow super admin",
        action: "WORKFLOW_SAVE",
        summary: `Saved "${saved.name}" v${saved.version} (${saved.status})`,
      });
      return reply(201, saved);
    }
    if (route === "GET /workflows/{id}/versions") {
      const id = e.pathParameters?.id;
      const workflows = await scanType("WORKFLOW#", a);
      const workflow = workflows.find((w) => w.id === id);
      if (!workflow) return reply(404, { error: "Workflow not found" });
      return reply(
        200,
        paginateList(
          await listWorkflowVersions(workflow.tenantId, id),
          e.queryStringParameters,
        ),
      );
    }

    /* ------------------------------------------- 14.2 the customer draft write route ---------- */
    //
    // The split design.md's *Workflows and the status model* argues for, rather than loosening
    // `POST /workflows`. That route is staff, takes `body.tenantId`, and can write any status into any
    // organization. This one holds `workflow:edit`, writes ONLY into the caller's own organization,
    // and cannot set `active` at all -- publishing is a separate transition with its own permission
    // and its own connection check.
    if (route === "POST /workflows/{id}/draft") {
      const addressed = String(e.pathParameters?.id || "").trim();
      if (!addressed) return reply(400, { error: "A workflow identifier is required" });
      // `new` is the reserved value that means "mint one", and it is the ONLY way this route creates.
      //
      // The first version of this route created whatever identifier the caller named, which the
      // two-organization isolation probe caught immediately: naming another organization's workflow id
      // produced a brand-new workflow carrying that id inside the caller's own organization. Nothing
      // crossed the tenancy boundary, but the caller had planted a foreign identifier in its own list
      // and every later comparison of "is this ours" had to be made against a record that looked like
      // someone else's. A caller-chosen identifier is also free to collide with a future server-minted
      // one, and to encode meaning the server then stores forever.
      //
      // So: an addressed identifier must ALREADY exist under the caller's own scope, and a foreign one
      // is indistinguishable from an absent one -- both 404, which is the property requirement 34.4
      // asks for.
      const creating = addressed === NEW_WORKFLOW_SENTINEL;
      const existing = creating
        ? null
        : await resolveWorkflow(addressed, p, "staff editing a workflow draft");
      if (!creating && !existing) return reply(404, { error: "Not found" });
      // The organization comes from the RECORD when editing and from the PRINCIPAL when creating.
      // Never from the body: `POST /workflows` reads `body.tenantId` because it is staff, and a
      // customer route that did the same would let a builder write into any organization it could name.
      const orgId = existing ? existing.tenantId : p.orgId;
      const id = existing
        ? existing.id
        : `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      {
        const denied = await guardIn(p, "workflow:edit", { orgId });
        if (denied) return denied;
      }
      // Creating a workflow is a different act from editing one, so it is a different permission.
      // Every role holding edit today also holds create, so this changes no outcome now -- it is what
      // keeps a future edit-only role from being able to create.
      if (creating) {
        const denied = await guardIn(p, "workflow:create", { orgId });
        if (denied) return denied;
      }
      let body;
      try {
        body = JSON.parse(e.body || "{}");
      } catch {
        return reply(400, { error: "The request body is not valid JSON" });
      }
      // 13.11 — the draft route cannot publish. Refused by name rather than silently downgraded: a
      // caller who asked to publish and got a 200 back would reasonably believe it published.
      const requested = typeof body.status === "string" ? body.status : "draft";
      if (requested === "active")
        return reply(422, {
          error:
            "A draft save cannot publish a workflow. Publishing is a separate step that re-checks every managed connection.",
        });
      if (!["draft", "testing"].includes(requested))
        return reply(422, {
          error: `A draft save can set the status to draft or testing, not "${requested}".`,
        });
      // The definition is assembled from the submitted body but its identity is NOT taken from it:
      // id comes from the path, tenantId from the resolved organization, and version is derived.
      const candidate = {
        ...body,
        id,
        tenantId: orgId,
        status: requested,
        version: existing ? (Number(existing.version) || 0) + 1 : 1,
        createdAt: existing ? existing.createdAt || now() : now(),
        createdBy: existing ? existing.createdBy || a.userId : a.userId,
        updatedAt: now(),
      };
      // 13.10 — validated BEFORE anything is written, and the reason is returned. Nothing is
      // persisted on failure, which is why the validation happens here and not inside the save.
      const shapeError = validateWorkflowShape(candidate);
      if (shapeError) return reply(422, { error: shapeError });
      const saved = await saveWorkflowWithVersion(candidate);
      await logActivity(orgId, {
        actor: a.userId,
        actorLabel: actorLabelFor(p),
        action: "WORKFLOW_SAVE",
        summary: `Saved "${saved.name}" v${saved.version} as ${saved.status}`,
        details: {
          workflowId: saved.id,
          version: saved.version,
          status: saved.status,
          requiredSurfaces: requiredSurfacesFor(saved),
        },
      });
      return reply(existing ? 200 : 201, saved);
    }

    /* --------------------------------- 14.3 publish, unpublish, duplicate, archive ------------ */
    if (route === "POST /workflows/{id}/publish") {
      const workflow = await resolveWorkflow(e.pathParameters?.id, p, "staff publishing a workflow");
      // Resolved before the guard so the refusal for another organization's identifier is a 404 from
      // the read rather than a 403 that would confirm the identifier exists somewhere.
      if (!workflow) return reply(404, { error: "Not found" });
      {
        // Q-1 held at its conservative answer: `workflow:publish` is staff-only in ROLE_GRANTS, so a
        // customer WORKFLOW_BUILDER is refused here and the interface says an AmazFlow contact
        // publishes rather than offering a control that 403s. Resolving Q-1 the other way changes one
        // matrix entry and one label, not this route.
        const denied = await guardIn(p, "workflow:publish", { orgId: workflow.tenantId });
        if (denied) return denied;
      }
      if (workflow.status === "active")
        return reply(409, { error: "This workflow is already published" });
      // 13.12/13.13 — the connection check is RE-RUN here rather than trusted from the draft, because
      // a connection can be revoked between authoring and publishing.
      const gap = await managedConnectionGapFor(workflow);
      if (gap)
        return reply(409, {
          error: `Step "${gap.stepId}" runs in the AmazFlow-hosted browser and ${gap.reason}. Sign that connection in before publishing.`,
        });
      const previous = workflow.status;
      const saved = await saveWorkflowWithVersion({
        ...workflow,
        status: "active",
        version: (Number(workflow.version) || 0) + 1,
        publishedAt: now(),
        publishedBy: a.userId,
      });
      await logActivity(workflow.tenantId, {
        actor: a.userId,
        actorLabel: actorLabelFor(p),
        action: WORKFLOW_TRANSITION_AUDIT.active,
        summary: `Published "${saved.name}" v${saved.version}`,
        details: { workflowId: saved.id, version: saved.version, previousStatus: previous },
      });
      return reply(200, saved);
    }
    if (route === "POST /workflows/{id}/unpublish") {
      const workflow = await resolveWorkflow(e.pathParameters?.id, p, "staff unpublishing a workflow");
      if (!workflow) return reply(404, { error: "Not found" });
      {
        // Unpublishing is the same authority as publishing: whoever decides a workflow may run against
        // a customer's real systems is whoever decides it may stop.
        const denied = await guardIn(p, "workflow:publish", { orgId: workflow.tenantId });
        if (denied) return denied;
      }
      if (workflow.status !== "active")
        return reply(409, { error: "This workflow is not published, so there is nothing to unpublish" });
      const saved = await saveWorkflowWithVersion({
        ...workflow,
        status: "draft",
        version: (Number(workflow.version) || 0) + 1,
        unpublishedAt: now(),
      });
      await logActivity(workflow.tenantId, {
        actor: a.userId,
        actorLabel: actorLabelFor(p),
        action: WORKFLOW_TRANSITION_AUDIT.draft,
        summary: `Returned "${saved.name}" to draft, so it can no longer run`,
        details: { workflowId: saved.id, version: saved.version },
      });
      return reply(200, saved);
    }
    if (route === "POST /workflows/{id}/duplicate") {
      const workflow = await resolveWorkflow(e.pathParameters?.id, p, "staff duplicating a workflow");
      if (!workflow) return reply(404, { error: "Not found" });
      {
        const denied = await guardIn(p, "workflow:create", { orgId: workflow.tenantId });
        if (denied) return denied;
      }
      // 13.15 — a NEW identifier and status draft. Deliberately not a copy of the publish state: a
      // duplicate that arrived published would put an unreviewed copy in front of real systems.
      const copy = {
        ...workflow,
        id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: `${workflow.name} (copy)`,
        status: "draft",
        version: 1,
        createdAt: now(),
        createdBy: a.userId,
        updatedAt: now(),
        duplicatedFromWorkflowId: workflow.id,
        duplicatedFromVersion: workflow.version || null,
      };
      delete copy.publishedAt;
      delete copy.publishedBy;
      delete copy.unpublishedAt;
      const shapeError = validateWorkflowShape(copy);
      if (shapeError) return reply(422, { error: shapeError });
      const saved = await saveWorkflowWithVersion(copy);
      await logActivity(workflow.tenantId, {
        actor: a.userId,
        actorLabel: actorLabelFor(p),
        action: "WORKFLOW_DUPLICATED",
        summary: `Duplicated "${workflow.name}" as a new draft`,
        details: { workflowId: saved.id, sourceWorkflowId: workflow.id, sourceVersion: workflow.version || null },
      });
      return reply(201, saved);
    }
    if (route === "POST /workflows/{id}/archive") {
      const workflow = await resolveWorkflow(e.pathParameters?.id, p, "staff archiving a workflow");
      if (!workflow) return reply(404, { error: "Not found" });
      {
        const denied = await guardIn(p, "workflow:archive", { orgId: workflow.tenantId });
        if (denied) return denied;
      }
      if (workflow.status === "archived")
        return reply(409, { error: "This workflow is already archived" });
      const previous = workflow.status;
      const saved = await saveWorkflowWithVersion({
        ...workflow,
        status: "archived",
        version: (Number(workflow.version) || 0) + 1,
        archivedAt: now(),
        archivedBy: a.userId,
      });
      await logActivity(workflow.tenantId, {
        actor: a.userId,
        actorLabel: actorLabelFor(p),
        action: WORKFLOW_TRANSITION_AUDIT.archived,
        summary: `Archived "${saved.name}", so it can no longer run`,
        details: { workflowId: saved.id, version: saved.version, previousStatus: previous },
      });
      return reply(200, saved);
    }
    if (route === "GET /organizations") {
      {
        const denied = await guardIn(p, "internal:organization_manage", { orgId: a.tenantId });
        if (denied) return reply(denied.statusCode, { error: "Only AmazFlow administrators view organizations", code: "FORBIDDEN" });
      }
      const orgs = await listOrganizations();
      return reply(
        200,
        paginateList(
          orgs.sort((x, y) =>
            String(x.createdAt).localeCompare(String(y.createdAt)),
          ),
          e.queryStringParameters,
        ),
      );
    }
    if (route === "POST /organizations") {
      {
        const denied = await guardIn(p, "internal:organization_manage", { orgId: a.tenantId });
        if (denied) return reply(denied.statusCode, { error: "Only AmazFlow administrators create organizations", code: "FORBIDDEN" });
      }
      const body = JSON.parse(e.body || "{}");
      const name = String(body.name || "").trim();
      if (!name) return reply(400, { error: "A name is required" });
      let creationProfile;
      try {
        const withoutSlug = { ...body };
        delete withoutSlug.slug;
        creationProfile = {
          ...validateOrgProfile(withoutSlug),
          ...validateOrgExtendedProfile(withoutSlug, "internal"),
        };
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
      // Requirement 8.15 (task 11.2). An explicitly requested slug that is taken is an ERROR --
      // silently handing back `acme-2` when the caller asked for `acme` would have them wire the wrong
      // tenant id into a Cognito claim. A slug DERIVED from the name is disambiguated instead, because
      // two customers legitimately called "Acme" is not a mistake anybody made.
      const requestedSlug = String(body.slug || "").trim();
      const rootSlug = slugify(requestedSlug || name);
      if (!rootSlug)
        return reply(400, {
          error: "Could not derive a usable slug from that name",
        });
      const orgId = `org_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let slug;
      if (requestedSlug) {
        if (await getOrganization(rootSlug))
          return reply(409, {
            // Deliberately does not distinguish "exists now" from "existed once". Both mean the
            // same thing to the caller, and the difference is nobody's business.
            error: `The slug "${rootSlug}" is not available`,
          });
        try {
          await reserveSlug(rootSlug, `organization ${orgId}`);
          slug = rootSlug;
        } catch (err) {
          if (!err || err.name !== "ConditionalCheckFailedException") throw err;
          return reply(409, { error: `The slug "${rootSlug}" is not available` });
        }
      } else {
        slug = await uniqueSlugFrom(name, `organization ${orgId}`);
      }
      if (!slug)
        return reply(409, {
          error: "Could not derive an available slug from that name. Supply one explicitly.",
        });
      const org = {
        id: orgId,
        name,
        slug,
        status: creationProfile.status || "active",
        plan: creationProfile.plan || "design_partner",
        createdAt: now(),
        updatedAt: now(),
        // Activation is derived later from the first completed production run (requirement 24.14),
        // so a newly-created or merely re-enabled organization does not claim it has gone live.
        onboardingStatus: creationProfile.onboardingStatus || "not_started",
        ...creationProfile,
        name,
      };
      await saveOrganization(org);
      await logActivity(slug, {
        actor: a.userId,
        actorLabel: "AmazFlow super admin",
        action: "ORG_CREATED",
        summary: `Created organization "${name}"`,
      });
      return reply(201, organizationFor(org, p));
    }
    if (route === "GET /organizations/{slug}") {
      const slug = e.pathParameters?.slug;
      {
        const denied = await guardIn(p, "org:read", { orgId: slug });
        if (denied) return denied;
      }
      const org = await getOrganization(slug);
      if (!org) return reply(404, { error: "Organization not found" });
      // Requirement 8.6: the commercial lifecycle status, the internal account owner, and the CRM
      // reference never reach a customer surface. Projected by entity rather than by route, so a new
      // route that reads an organization cannot forget to strip them.
      return reply(200, organizationFor(org, p));
    }
    if (route === "PUT /organizations/{slug}") {
      {
        const denied = await guardIn(p, "internal:organization_manage", { orgId: a.tenantId });
        if (denied) return reply(denied.statusCode, { error: "Only AmazFlow administrators change an organization profile", code: "FORBIDDEN" });
      }
      const slug = e.pathParameters?.slug;
      const org = await getOrganization(slug);
      if (!org) return reply(404, { error: "Organization not found" });
      let patch;
      try {
        const orgBody = JSON.parse(e.body || "{}");
        patch = {
          ...validateOrgProfile(orgBody),
          // Staff hold the internal scope, so the account owner, the CRM reference, and the commercial
          // lifecycle status are writable here and nowhere else.
          ...validateOrgExtendedProfile(orgBody, "internal"),
        };
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
      if (Object.keys(patch).length === 0)
        return reply(400, { error: "Nothing to change" });
      const before = { name: org.name, status: org.status, plan: org.plan };
      let next = { ...org, ...patch, updatedAt: now() };
      // Requirement 8.16: an execution- or commercial-status change is its own audit event carrying
      // the previous and new values. Activation remains derived from the first production run.
      next = await recordOrgLifecycle(org, next, a);
      await saveOrganization(next);
      const changed = Object.keys(patch).filter((k) => before[k] !== patch[k]);
      await logActivity(slug, {
        actor: a.userId,
        actorLabel: "AmazFlow super admin",
        action: "ORG_UPDATED",
        summary: changed.length
          ? `Changed ${changed.join(", ")} on "${next.name}"`
          : `Saved "${next.name}"`,
        details: {
          before,
          after: { name: next.name, status: next.status, plan: next.plan },
        },
      });
      return reply(200, organizationFor(next, p));
    }
    if (route === "POST /organizations/{slug}/settings") {
      const slug = e.pathParameters?.slug;
      {
        const denied = await guardIn(p, "org:settings", { orgId: slug });
        if (denied) return denied;
      }
      const org = await getOrganization(slug);
      if (!org) return reply(404, { error: "Organization not found" });
      const body = JSON.parse(e.body || "{}");
      // A customer admin owns presentation, not their own execution ceiling: letting a
      // CLIENT_ADMIN raise maxConcurrentRuns would make the limit advisory.
      if (!maySetConcurrencyLimit(p) && "maxConcurrentRuns" in body)
        return reply(403, {
          error:
            "Only AmazFlow administrators change the concurrent run limit",
        });
      let patch;
      try {
        patch = validateOrgSettings(body);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
      if (Object.keys(patch).length === 0)
        return reply(400, { error: "Nothing to change" });
      const before = orgSettings(org);
      const settings = { ...before, ...patch };
      const next = { ...org, settings, updatedAt: now() };
      await saveOrganization(next);
      const changed = Object.keys(patch).filter(
        (k) => JSON.stringify(before[k]) !== JSON.stringify(settings[k]),
      );
      await logActivity(slug, {
        actor: a.userId,
        actorLabel: asPrincipal(a).isStaff ? "AmazFlow super admin" : "Customer administrator",
        action: "ORG_SETTINGS_CHANGED",
        summary: changed.length
          ? `Changed ${changed.join(", ")}`
          : "Saved organization settings",
        details: { before, after: settings },
      });
      return reply(200, organizationFor(next, p));
    }
    /* --------------------------------------- 14.9 the plain-language entry point -------------- */
    //
    // Opened to a customer builder (`workflow:create`) rather than staying `internal:workflow_author`,
    // because requirement 14.3 is about the person building the workflow and design.md's own sequence
    // diagram names that person "Builder (customer or staff)". What did NOT change is the rule the
    // requirement actually turns on: generation produces a DEFINITION, the definition is validated
    // against the same schema every other write uses, and execution is the deterministic state machine
    // in packages/engine. No run consults a model for control flow, here or anywhere.
    if (route === "POST /workflows/generate") {
      let body;
      try {
        body = JSON.parse(e.body || "{}");
      } catch {
        return reply(400, { error: "The request body is not valid JSON" });
      }
      // Staff may target another organization explicitly; a customer's target is its OWN organization
      // and `body.tenantId` is not consulted at all. This is the same asymmetry as POST /workflows,
      // written out rather than left to the reader.
      const targetOrg = p.isStaff ? String(body.tenantId || a.tenantId || "amazflow") : p.orgId;
      {
        const denied = await guardIn(p, "workflow:create", { orgId: targetOrg });
        if (denied) return denied;
      }
      if (!body.sop || typeof body.sop !== "string" || !body.sop.trim())
        return reply(400, { error: "Describe the process you want, in your own words" });
      let candidate;
      try {
        candidate = await generateWorkflowFromSop(body.sop, targetOrg);
      } catch (err) {
        // 14.5 — a candidate that failed validation is 422 with the reason and NOTHING persisted. A
        // generator that could not be reached is 503, which is a statement about AmazFlow rather than
        // about the description the person wrote.
        return reply(err && err.status === 503 ? 503 : 422, {
          error: (err && err.message) || "Could not generate a workflow from that description",
        });
      }
      // Identity is imposed rather than taken from the model's output: a generated definition naming
      // another organization's tenantId would otherwise be persisted into it.
      candidate = {
        ...candidate,
        tenantId: targetOrg,
        status: "draft",
        version: 1,
        createdAt: now(),
        createdBy: a.userId,
        generatedFromDescription: true,
      };
      // Validated a second time, after the identity fields were imposed. The generator already
      // validated its own output, but what is about to be PERSISTED is this object, not that one.
      const shapeError = validateWorkflowShape(candidate);
      if (shapeError) return reply(422, { error: shapeError });
      // 14.6/14.7 — persisted immediately as a draft and returned editable, so the draft survives a
      // reload. A generated definition held only in the browser is lost by the first refresh, and the
      // person has no way to know that until it happens.
      const saved = await saveWorkflowWithVersion(candidate);
      // 14.10 — the generation is its own audit event, distinct from the save. "This workflow was
      // drafted from a description" is a fact a reviewer needs and cannot recover from a WORKFLOW_SAVE.
      await logActivity(targetOrg, {
        actor: a.userId,
        actorLabel: actorLabelFor(p),
        action: "WORKFLOW_GENERATED_FROM_SOP",
        summary: `Drafted "${saved.name}" from a plain-language description`,
        details: {
          workflowId: saved.id,
          version: saved.version,
          // The description's LENGTH, not the description. It is the customer's own process
          // documentation and does not belong in an audit summary that other people read.
          descriptionLength: body.sop.trim().length,
          steps: (saved.steps || []).length,
        },
      });
      return reply(201, saved);
    }
    if (route === "GET /leads") {
      {
        const denied = await guardIn(p, "internal:lead_read", { orgId: a.tenantId });
        if (denied) return reply(denied.statusCode, { error: "Only AmazFlow super admins view leads", code: "FORBIDDEN" });
      }
      const items = await scanType("LEAD#", a);
      return reply(
        200,
        paginateList(
          items.sort((x, y) =>
            String(y.createdAt).localeCompare(String(x.createdAt)),
          ),
          e.queryStringParameters,
        ),
      );
    }
    if (route === "GET /runs") {
      let items = await tenantOrStaffRead("RUN#", p);
      if (!can(p, "run:read_all", { orgId: p.orgId }).allow)
        items = items.filter((r) => r.createdBy === a.userId);
      return reply(
        200,
        paginateList(
          items.sort((x, y) =>
            String(y.createdAt).localeCompare(String(x.createdAt)),
          ),
          e.queryStringParameters,
        ),
      );
    }
    if (route === "GET /workflows/{id}/preflight") {
      const id = e.pathParameters?.id;
      const workflows = await scanType("WORKFLOW#", a);
      const workflow = workflows.find((w) => w.id === id);
      if (!workflow) return reply(404, { error: "Workflow not found" });
      return reply(200, await preflightFor(workflow, workflow.tenantId));
    }
    if (route === "POST /workflows/{id}/runs") {
      const id = e.pathParameters?.id;
      const workflows = await scanType("WORKFLOW#", a);
      const workflow = workflows.find((w) => w.id === id);
      if (!workflow) return reply(404, { error: "Workflow not found" });
      // Assignment is now step 6 of can(), applied by the workflow:run guard below. This copy
      // compared the COARSE group against assignedRoles, which a fine role cannot satisfy.
      //
      // 13.4 — `active` and `testing` are the two runnable statuses. Everything else is a state
      // conflict, and the message names the status so the person is not left guessing which of draft,
      // archived or a legacy `paused` record they are looking at.
      if (!isRunnableWorkflowStatus(workflow.status))
        return reply(409, {
          error:
            workflow.status === "draft"
              ? "This workflow is still a draft, so it cannot run yet."
              : "This workflow is archived, so it can no longer run.",
        });
      // 13.5 — a testing-status workflow is runnable ONLY by someone who can edit or publish it. It
      // exists so a builder can try a workflow against real systems before anyone else can, so
      // admitting an operator would defeat the whole point of the status.
      const isTestRun = workflow.status === "testing";
      if (
        isTestRun &&
        !can(p, "workflow:edit", { orgId: workflow.tenantId }).allow &&
        !can(p, "workflow:publish", { orgId: workflow.tenantId }).allow
      ) {
        const denied = await guardIn(p, "workflow:edit", { orgId: workflow.tenantId });
        if (denied) return denied;
      }
      // Organization-level gates, checked before anything else because being paused is not a
      // problem an operator can fix by plugging in an agent.
      // Starting a run is a permission, and it carries the engine's assignment rule with it: step 6
      // of can() refuses a role the workflow is not assigned to, which is the same check the engine
      // already made -- now made once, before any organization or preflight gate spends work on a
      // request that was never going to be allowed.
      {
        const denied = await guardIn(p, "workflow:run", {
          orgId: workflow.tenantId,
          assignedRoles: Array.isArray(workflow.assignedRoles) ? workflow.assignedRoles : undefined,
        });
        if (denied) return denied;
      }
      const runOrg = await getOrganization(workflow.tenantId);
      if (runOrg && runOrg.status && runOrg.status !== "active")
        return reply(409, {
          error:
            runOrg.status === "suspended"
              ? "This organization is suspended. Contact AmazFlow to restore execution."
              : "This organization is paused, so no new work can start.",
          organizationStatus: runOrg.status,
        });
      const runLimit = orgSettings(runOrg).maxConcurrentRuns;
      if (runLimit > 0) {
        const liveNow = (await scanType("RUN#", { role: "SUPER_ADMIN" })).filter(
          (r) =>
            r.tenantId === workflow.tenantId &&
            LIVE_RUN_STATUSES.includes(r.status),
        ).length;
        if (liveNow >= runLimit)
          return reply(429, {
            error: `This organization already has ${liveNow} of ${runLimit} runs in flight. Wait for one to finish, or ask AmazFlow to raise the limit.`,
            limit: runLimit,
            inFlight: liveNow,
          });
      }
      // Refuse up front rather than creating a run that can only sit and time out. This is
      // checked after the organization gates because being paused is not something plugging in
      // an agent would fix.
      const preflight = await preflightFor(workflow, workflow.tenantId);
      if (!preflight.ready)
        return reply(409, {
          error: "This workflow needs an execution agent that is not ready yet.",
          preflight,
        });
      const body = JSON.parse(e.body || "{}");
      if ("description" in body && !String(body.description || "").trim())
        return reply(400, {
          error: "Tell us what you need done before starting.",
        });
      return reply(201, await runWorkflow(workflow, body, a, { isTest: isTestRun }));
    }
    // Sign out everywhere: revokes every session this user holds at the identity provider, not
    // just the one that made the call. Self-service, so no role check beyond having a session --
    // ending your own sessions is never a privileged act.
    if (route === "POST /me/sessions/revoke") {
      if (!a.email)
        return reply(400, {
          error: "This session carries no email claim, so its sessions cannot be revoked.",
          code: "NO_EMAIL_CLAIM",
        });
      try {
        await cognito.send(
          new AdminUserGlobalSignOutCommand({
            UserPoolId: process.env.USER_POOL_ID,
            Username: a.email,
          }),
        );
      } catch (err) {
        return reply(502, {
          error: "Could not revoke your sessions. Try again in a moment.",
          code: "SESSION_REVOKE_FAILED",
        });
      }
      await logActivity(a.tenantId, {
        actor: a.userId,
        actorLabel: actorLabelFor(asPrincipal(a)),
        action: "SESSIONS_REVOKED_SELF",
        summary: "Signed out of all devices",
      });
      return reply(200, { ok: true, revoked: "all_sessions" });
    }
    // Staff-initiated revocation of a customer user's sessions. Separate from the self-service
    // route above because this one IS privileged, is audited against the target's organization
    // rather than the actor's, and is the operational answer to "that laptop was stolen".
    if (route === "POST /tenants/{tenantId}/users/{username}/sessions/revoke") {
      {
        // Own organization, not the path parameter: an internal route is staff-only regardless of
        // which organization is named, so evaluating against the argument would answer 403 for the
        // caller's own organization and 404 for another's -- a difference that tells the caller
        // something about the argument. Staff cross-organization use is audited as
        // SESSIONS_REVOKED_BY_STAFF against the target organization.
        const denied = await guardIn(p, "internal:session_revoke", { orgId: a.tenantId });
        if (denied)
          return reply(denied.statusCode, {
            error: "Only AmazFlow administrators revoke another user's sessions",
            code: "STAFF_ONLY",
          });
      }
      const tenantId = e.pathParameters?.tenantId;
      const username = e.pathParameters?.username;
      // Resolved through the tenant's own member list, so a username from another organization is
      // simply not found rather than being revoked across a tenancy boundary.
      const members = await listTenantUsers(tenantId);
      const target = members.find((u) => u.username === username);
      if (!target)
        return reply(404, { error: "User not found in this tenant", code: "NOT_FOUND" });
      try {
        await cognito.send(
          new AdminUserGlobalSignOutCommand({
            UserPoolId: process.env.USER_POOL_ID,
            Username: username,
          }),
        );
      } catch (err) {
        return reply(502, {
          error: "Could not revoke that user's sessions. Try again in a moment.",
          code: "SESSION_REVOKE_FAILED",
        });
      }
      await logActivity(tenantId, {
        actor: a.userId,
        actorLabel: "AmazFlow super admin",
        action: "SESSIONS_REVOKED_BY_STAFF",
        summary: `Revoked all sessions for ${target.email || username}`,
        details: { targetUsername: username, targetEmail: target.email || null },
      });
      return reply(200, { ok: true, username, revoked: "all_sessions" });
    }
    if (route === "POST /runs/{id}/executor/invoke") {
      {
        const denied = await guardIn(p, "internal:executor_diagnostic", { orgId: a.tenantId });
        if (denied)
          return reply(denied.statusCode, {
            error:
              "Only AmazFlow administrators can invoke the Executor directly (diagnostic route)",
            code: "FORBIDDEN",
          });
      }
      try {
        const allRuns = await scanType("RUN#", a);
        const run = allRuns.find((r) => r.id === e.pathParameters?.id);
        if (!run) return reply(404, { error: "Run not found" });
        const workflow = await getWorkflowVersion(
          run.tenantId,
          run.workflowId,
          run.workflowVersion,
        );
        if (!workflow) return reply(400, { error: "Workflow not found for run" });
        return reply(200, await invokeExecutorDiagnostic(run, workflow));
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
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
    if (route === "POST /runs/{id}/resume") {
      try {
        const run = await resumeRunFromException(e.pathParameters?.id, a);
        return reply(201, run);
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
      {
        const denied = await guardIn(p, "agent:read", { orgId: a.tenantId });
        if (denied) return denied;
      }
      const items = await scanType("AGENT#", a);
      return reply(
        200,
        paginateList(
          items
            .sort((x, y) =>
              String(y.createdAt).localeCompare(String(x.createdAt)),
            )
            .map((x) => ({ ...x, ...agentSnapshot(x) })),
          e.queryStringParameters,
        ),
      );
    }
    if (route === "POST /agent-authorizations") {
      {
        const denied = await guardIn(p, "agent:authorize", { orgId: a.tenantId });
        if (denied) return denied;
      }
      const body = JSON.parse(e.body || "{}");
      const name = String(body.name || "").trim();
      if (!name) return reply(400, { error: "A name is required" });
      const targetTenantId = p.isStaff && body.tenantId ? body.tenantId : a.tenantId;
      const result = await createAgentAndCode(
        targetTenantId,
        name,
        body.allowedDomains,
        a.userId,
        a.role,
        typeof body.installationId === "string"
          ? body.installationId.slice(0, 200)
          : null,
        {
          agentType: body.agentType,
          capabilities: body.capabilities,
          platform: body.platform,
          version: body.version,
        },
      );
      await logActivity(targetTenantId, {
        actor: a.userId,
        actorLabel: actorLabelFor(asPrincipal(a)),
        action: "AGENT_CREATED",
        summary: `Authorized a new agent "${name}"`,
      });
      return reply(201, result);
    }
    if (route === "POST /agents/{id}/revoke") {
      {
        const denied = await guardIn(p, "agent:revoke", { orgId: a.tenantId });
        if (denied) return denied;
      }
      try {
        const agent = await revokeAgent(e.pathParameters?.id, a);
        return reply(200, agent);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "GET /agent-tasks") {
      {
        const denied = await guardIn(p, "task:read", { orgId: a.tenantId });
        if (denied) return denied;
      }
      const items = await scanType("TASK#", a);
      const pendingTasks = items.filter((t) => t.status === "PENDING");
      const withEligibility = await Promise.all(
        pendingTasks.map(async (t) => ({
          ...t,
          eligibilityReason: await taskEligibilityReason(t),
        })),
      );
      return reply(200, paginateList(withEligibility, e.queryStringParameters));
    }
    if (route === "POST /agent-tasks/{id}/result") {
      {
        const denied = await guardIn(p, "task:resolve", { orgId: a.tenantId });
        if (denied) return denied;
      }
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
      {
        const denied = await guardIn(p, "approval:decide", { orgId: a.tenantId });
        if (denied) return denied;
      }
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
      {
        const denied = await guardIn(p, "internal:ai_execute", { orgId: a.tenantId });
        if (denied) return denied;
      }
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
      {
        const denied = await guardIn(p, "org:read", { orgId: tenantId });
        if (denied) return denied;
      }
      return reply(200, await tenantSummary(tenantId));
    }
    if (route === "GET /tenants/{tenantId}/users") {
      const tenantId = e.pathParameters?.tenantId;
      {
        const denied = await guardIn(p, "user:read", { orgId: tenantId });
        if (denied) return denied;
      }
      return reply(200, paginateList(await listTenantUsers(tenantId), e.queryStringParameters));
    }
    if (route === "POST /tenants/{tenantId}/users") {
      const tenantId = e.pathParameters?.tenantId;
      {
        const denied = await guardIn(p, "user:invite", { orgId: tenantId });
        if (denied) return denied;
      }
      const inviteBody = JSON.parse(e.body || "{}");
      // A customer admin must not be able to mint AmazFlow staff. INVITABLE_ROLES already
      // excludes SUPER_ADMIN for every caller, so this is defence in depth rather than the only
      // check, but the message is worth being specific about.
      if (String(inviteBody.role || "").trim() === "SUPER_ADMIN")
        return reply(403, {
          error: "AmazFlow staff accounts are not created through this route",
        });
      // An organization that cannot run work should not be growing its team either.
      const inviteOrg = await getOrganization(tenantId);
      if (inviteOrg && inviteOrg.status === "suspended")
        return reply(409, {
          error: "This organization is suspended. Contact AmazFlow before adding people.",
        });
      try {
        const invited = await inviteTenantUser(tenantId, inviteBody, a);
        return reply(201, invited);
      } catch (err) {
        if (err && err.status)
          return reply(err.status, {
            error: err.message,
            ...(err.allowedEmailDomains
              ? { allowedEmailDomains: err.allowedEmailDomains }
              : {}),
          });
        throw err;
      }
    }
    if (route === "POST /tenants/{tenantId}/users/{username}/status") {
      const tenantId = e.pathParameters?.tenantId;
      {
        const denied = await guardIn(p, "user:set_status", { orgId: tenantId });
        if (denied) return denied;
      }
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
      const membership = targetUser
        ? await readMembership(tenantId, targetUser.email).catch(() => null)
        : null;
      if (membership) {
        const at = now();
        await saveMembership({
          ...membership,
          status: body.enabled ? "active" : "deactivated",
          ...(body.enabled && !membership.activatedAt ? { activatedAt: at } : {}),
          updatedAt: at,
        });
      }
      await logActivity(tenantId, {
        actor: a.userId,
        actorLabel: actorLabelFor(asPrincipal(a)),
        action: "TEAM_MEMBER_STATUS",
        summary: `${body.enabled ? "Reactivated" : "Deactivated"} ${targetUser ? targetUser.email : username}`,
      });
      return reply(200, { username, enabled: !!body.enabled });
    }
    if (route === "POST /organizations/{slug}/branding") {
      const brandingSlug = e.pathParameters?.slug;
      {
        const denied = await guardIn(p, "org:branding", { orgId: brandingSlug });
        if (denied) return denied;
      }
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
      return reply(200, organizationFor(org, p));
    }
    if (route === "GET /copilot/actions") {
      {
        const denied = await guardIn(p, "internal:copilot", { orgId: a.tenantId });
        if (denied) return reply(denied.statusCode, { error: "AmazFlow Copilot is only available to AmazFlow administrators", code: "FORBIDDEN" });
      }
      let items = await scanType("COPILOTACTION#", { role: "SUPER_ADMIN" });
      const status = e.queryStringParameters?.status;
      if (status) items = items.filter((x) => x.status === status);
      return reply(
        200,
        paginateList(
          items.sort((x, y) =>
            String(y.createdAt).localeCompare(String(x.createdAt)),
          ),
          e.queryStringParameters,
        ),
      );
    }
    if (route === "GET /copilot/conversation") {
      {
        const denied = await guardIn(p, "internal:copilot", { orgId: a.tenantId });
        if (denied) return reply(denied.statusCode, { error: "AmazFlow Copilot is only available to AmazFlow administrators", code: "FORBIDDEN" });
      }
      return reply(200, await loadCopilotConversation(a.userId));
    }
    if (route === "POST /copilot/messages") {
      {
        const denied = await guardIn(p, "internal:copilot", { orgId: a.tenantId });
        if (denied) return reply(denied.statusCode, { error: "AmazFlow Copilot is only available to AmazFlow administrators", code: "FORBIDDEN" });
      }
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
      {
        const denied = await guardIn(p, "internal:copilot", { orgId: a.tenantId });
        if (denied) return reply(denied.statusCode, { error: "AmazFlow Copilot is only available to AmazFlow administrators", code: "FORBIDDEN" });
      }
      try {
        const action = await applyCopilotAction(e.pathParameters?.id, a);
        return reply(200, action);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /copilot/actions/{id}/discard") {
      {
        const denied = await guardIn(p, "internal:copilot", { orgId: a.tenantId });
        if (denied) return reply(denied.statusCode, { error: "AmazFlow Copilot is only available to AmazFlow administrators", code: "FORBIDDEN" });
      }
      try {
        const action = await discardCopilotAction(e.pathParameters?.id);
        return reply(200, action);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    // An organization-scoped audit read, so /admin/audit does not need the cross-organization route
    // widened to serve it (requirement 6.14). Reads the caller's OWN partition and nothing else.
    if (route === "GET /audit") {
      {
        const denied = await guardIn(p, "audit:read", { orgId: a.tenantId });
        if (denied) return denied;
      }
      const own = await tenantRead("ACTIVITY#", p);
      const action = e.queryStringParameters?.action;
      return reply(
        200,
        paginateList(
          (action ? own.filter((x) => x.action === action) : own).sort((x, y) =>
            String(y.at).localeCompare(String(x.at)),
          ),
          e.queryStringParameters,
        ),
      );
    }
    if (route === "GET /activity") {
      {
        const denied = await guardIn(p, "internal:audit_read_all", { orgId: a.tenantId });
        if (denied) return denied;
      }
      let items = await scanType("ACTIVITY#", { role: "SUPER_ADMIN" });
      const tenantId = e.queryStringParameters?.tenantId;
      const action = e.queryStringParameters?.action;
      if (tenantId) items = items.filter((x) => x.tenantId === tenantId);
      if (action) items = items.filter((x) => x.action === action);
      return reply(
        200,
        paginateList(
          items.sort((x, y) => String(y.at).localeCompare(String(x.at))),
          e.queryStringParameters,
        ),
      );
    }
    if (route === "GET /settings") {
      {
        const denied = await guardIn(p, "internal:platform_settings", { orgId: a.tenantId });
        if (denied) return reply(denied.statusCode, { error: "Only AmazFlow administrators view platform settings", code: "FORBIDDEN" });
      }
      const settings = await getSettings();
      return reply(200, {
        ...settings,
        aiRuntimeLabel: "AmazFlow managed AI",
        dataBoundary: process.env.DATA_BOUNDARY,
      });
    }
    if (route === "POST /settings") {
      {
        const denied = await guardIn(p, "internal:platform_settings", { orgId: a.tenantId });
        if (denied) return reply(denied.statusCode, { error: "Only AmazFlow administrators change platform settings", code: "FORBIDDEN" });
      }
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
      let items = await tenantOrStaffRead("TICKET#", p);
      if (!can(p, "run:read_all", { orgId: p.orgId }).allow)
        items = items.filter((t) => t.createdBy === a.userId);
      return reply(
        200,
        paginateList(
          items.sort((x, y) =>
            String(y.createdAt).localeCompare(String(x.createdAt)),
          ),
          e.queryStringParameters,
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
        return reply(200, await listBrowserConnections(a, e.queryStringParameters));
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
    if (route === "GET /secrets") {
      try {
        return reply(200, await listSecrets(a, e.queryStringParameters));
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /secrets") {
      try {
        return reply(201, await createSecret(a, JSON.parse(e.body || "{}")));
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "POST /secrets/{id}/rotate") {
      try {
        return reply(
          200,
          await rotateSecret(a, e.pathParameters?.id, JSON.parse(e.body || "{}")),
        );
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "DELETE /secrets/{id}") {
      try {
        return reply(200, await deleteSecret(a, e.pathParameters?.id));
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    /* ------------------------------------------- Phase 4: organization, users, teams, teams --- */

    // 11.4 — the customer's own organization profile. `PUT /organizations/{slug}` is staff-only and
    // stays that way; this is the half an organization administrator may write, and it refuses the
    // three internal fields by name rather than dropping them (requirement 11.1, 8.2).
    if (route === "POST /organizations/{slug}/profile") {
      const slug = e.pathParameters?.slug;
      {
        const denied = await guardIn(p, "org:settings", { orgId: slug });
        if (denied) return denied;
      }
      const org = await getOrganization(slug);
      if (!org) return reply(404, { error: "Not found" });
      let patch;
      try {
        const body = JSON.parse(e.body || "{}");
        patch = {
          ...validateOrgProfileForCustomer(body),
          ...validateOrgExtendedProfile(body, p.isStaff ? "internal" : "customer"),
        };
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
      if (Object.keys(patch).length === 0) return reply(400, { error: "Nothing to change" });
      const next = { ...org, ...patch, updatedAt: now() };
      await saveOrganization(next);
      await logActivity(slug, {
        actor: a.userId,
        actorLabel: actorLabelFor(p),
        action: "ORG_UPDATED",
        summary: `Changed ${Object.keys(patch).join(", ")}`,
        details: { fields: Object.keys(patch) },
      });
      return reply(200, organizationFor(next, p));
    }

    // 11.5 — role change. Remediates H-8 and closes the write side of task 7.5.
    if (route === "POST /tenants/{tenantId}/users/{username}/role") {
      const tenantId = e.pathParameters?.tenantId;
      {
        const denied = await guardIn(p, "user:set_role", { orgId: tenantId });
        if (denied) return denied;
      }
      try {
        const body = JSON.parse(e.body || "{}");
        const result = await changeMemberRole(
          tenantId,
          e.pathParameters?.username,
          String(body.role || "").trim(),
          a,
          p,
        );
        return reply(200, result);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }

    // 11.5 — resend. A new token, and the previous one stops working (requirement 26.17).
    if (route === "POST /tenants/{tenantId}/users/{username}/invitation/resend") {
      const tenantId = e.pathParameters?.tenantId;
      {
        const denied = await guardIn(p, "user:invite", { orgId: tenantId });
        if (denied) return denied;
      }
      // Requirement 9.11: a suspended organization cannot grow its team, and that includes reissuing
      // an invitation it already sent.
      const resendOrg = await getOrganization(tenantId);
      if (resendOrg && resendOrg.status === "suspended")
        return reply(409, {
          error: "This organization is suspended. Contact AmazFlow before adding people.",
        });
      try {
        return reply(200, await resendInvitation(tenantId, e.pathParameters?.username, a, p));
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }

    // 11.5 — revoke a pending invitation. Disables, never deletes (requirement 9.13, 9.16).
    if (route === "DELETE /tenants/{tenantId}/users/{username}/invitation") {
      const tenantId = e.pathParameters?.tenantId;
      {
        const denied = await guardIn(p, "user:invite", { orgId: tenantId });
        if (denied) return denied;
      }
      try {
        return reply(200, await revokeInvitation(tenantId, e.pathParameters?.username, a, p));
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }

    // 11.10 — acceptance. Authenticated, single-use, server-resolved, rate-limited.
    if (route === "POST /invitations/{token}/accept") {
      const gate = await consumeRateLimit("invitation_accept", callerAddress(e));
      if (!gate.allowed)
        return reply(429, {
          error: "Too many invitation attempts. Wait a moment and try again.",
          retryAfterSeconds: gate.retryAfterSeconds,
        });
      try {
        return reply(200, await acceptInvitation(String(e.pathParameters?.token || ""), a));
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message, code: err.code });
        throw err;
      }
    }

    // 11.8 — teams. Organization-scoped, audited, and granting nothing.
    if (route === "GET /teams") {
      {
        const denied = await guardIn(p, "team:read", { orgId: p.orgId });
        if (denied) return denied;
      }
      const teams = await teamsFor(p);
      return reply(200, {
        teams: teams.sort((x, y) => String(x.name).localeCompare(String(y.name))),
        // Stated in the payload, not only in the interface copy, so any client that renders this
        // cannot present teams as an access control by omission (requirement 10.7).
        grantsPermissions: false,
        grantsPermissionsReason:
          "Team membership groups people and directs notifications. It grants no permissions in this release.",
      });
    }
    if (route === "POST /teams") {
      {
        const denied = await guardIn(p, "team:manage", { orgId: p.orgId });
        if (denied) return denied;
      }
      let name;
      try {
        name = validateTeamName(JSON.parse(e.body || "{}").name);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
      const team = {
        id: `team_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        tenantId: p.orgId,
        name,
        memberUsernames: [],
        createdAt: now(),
        updatedAt: now(),
      };
      await saveTeam(team);
      await logActivity(p.orgId, {
        actor: a.userId,
        actorLabel: actorLabelFor(p),
        action: "TEAM_CREATED",
        summary: `Created the team "${name}"`,
        details: { teamId: team.id, name },
      });
      return reply(201, team);
    }
    if (route === "PUT /teams/{id}") {
      {
        const denied = await guardIn(p, "team:manage", { orgId: p.orgId });
        if (denied) return denied;
      }
      const team = await resolveEntity("TEAM#", e.pathParameters?.id, p, "staff renaming a team");
      if (!team) return reply(404, { error: "Not found" });
      let name;
      try {
        name = validateTeamName(JSON.parse(e.body || "{}").name);
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
      const previous = team.name;
      const next = { ...team, name, updatedAt: now() };
      await saveTeam(next);
      await logActivity(team.tenantId, {
        actor: a.userId,
        actorLabel: actorLabelFor(p),
        action: "TEAM_RENAMED",
        summary: `Renamed the team "${previous}" to "${name}"`,
        details: { teamId: team.id, previous, name },
      });
      return reply(200, next);
    }
    if (route === "DELETE /teams/{id}") {
      {
        const denied = await guardIn(p, "team:manage", { orgId: p.orgId });
        if (denied) return denied;
      }
      const team = await resolveEntity("TEAM#", e.pathParameters?.id, p, "staff deleting a team");
      if (!team) return reply(404, { error: "Not found" });
      for (const username of team.memberUsernames || [])
        await syncTeamMembership(team.tenantId, username, team.id, false);
      await db.send(
        new DeleteItemCommand({
          TableName: table,
          Key: { pk: { S: `TENANT#${team.tenantId}` }, sk: { S: `TEAM#${team.id}` } },
        }),
      );
      await logActivity(team.tenantId, {
        actor: a.userId,
        actorLabel: actorLabelFor(p),
        action: "TEAM_DELETED",
        summary: `Deleted the team "${team.name}"`,
        details: { teamId: team.id, name: team.name, members: (team.memberUsernames || []).length },
      });
      return reply(200, { id: team.id, deleted: true });
    }
    if (route === "POST /teams/{id}/members") {
      {
        const denied = await guardIn(p, "team:manage", { orgId: p.orgId });
        if (denied) return denied;
      }
      const team = await resolveEntity("TEAM#", e.pathParameters?.id, p, "staff changing team membership");
      if (!team) return reply(404, { error: "Not found" });
      const username = String(JSON.parse(e.body || "{}").username || "").trim().toLowerCase();
      if (!username) return reply(400, { error: "A username is required" });
      // The person has to be a member of this organization. Without this a team could name an address
      // from another organization and the team list would then read as a cross-tenant roster.
      const members = await listTenantUsers(team.tenantId);
      if (!members.find((u) => u.email === username || u.username === username))
        return reply(404, { error: "Not found" });
      const memberUsernames = (team.memberUsernames || []).includes(username)
        ? team.memberUsernames
        : [...(team.memberUsernames || []), username];
      const next = { ...team, memberUsernames, updatedAt: now() };
      await saveTeam(next);
      await syncTeamMembership(team.tenantId, username, team.id, true);
      await logActivity(team.tenantId, {
        actor: a.userId,
        actorLabel: actorLabelFor(p),
        action: "TEAM_MEMBER_ADDED",
        summary: `Added ${username} to "${team.name}"`,
        details: { teamId: team.id, username },
      });
      return reply(200, next);
    }
    if (route === "DELETE /teams/{id}/members/{username}") {
      {
        const denied = await guardIn(p, "team:manage", { orgId: p.orgId });
        if (denied) return denied;
      }
      const team = await resolveEntity("TEAM#", e.pathParameters?.id, p, "staff changing team membership");
      if (!team) return reply(404, { error: "Not found" });
      const username = String(e.pathParameters?.username || "").trim().toLowerCase();
      const next = {
        ...team,
        memberUsernames: (team.memberUsernames || []).filter((u) => u !== username),
        updatedAt: now(),
      };
      await saveTeam(next);
      await syncTeamMembership(team.tenantId, username, team.id, false);
      await logActivity(team.tenantId, {
        actor: a.userId,
        actorLabel: actorLabelFor(p),
        action: "TEAM_MEMBER_REMOVED",
        summary: `Removed ${username} from "${team.name}"`,
        details: { teamId: team.id, username },
      });
      return reply(200, next);
    }

    // 12.3 — notifications. Unread count, list, mark one read, mark all read. No email delivery
    // anywhere in this file (requirement 22.9).
    if (route === "GET /notifications") {
      {
        const denied = await guardIn(p, "notification:read", { orgId: p.orgId });
        if (denied) return denied;
      }
      const username = a.email || a.userId;
      const items = await notificationsFor(p, username);
      return reply(200, paginateList(items, e.queryStringParameters));
    }
    if (route === "POST /notifications/{id}/read") {
      {
        const denied = await guardIn(p, "notification:read", { orgId: p.orgId });
        if (denied) return denied;
      }
      const notification = await resolveEntity(
        "NOTIFICATION#",
        e.pathParameters?.id,
        p,
        "staff reading a notification",
      );
      if (!notification) return reply(404, { error: "Not found" });
      const username = a.email || a.userId;
      await markNotificationRead(notification.tenantId, username, notification.id);
      return reply(200, { id: notification.id, read: true });
    }
    if (route === "POST /notifications/read-all") {
      {
        const denied = await guardIn(p, "notification:read", { orgId: p.orgId });
        if (denied) return denied;
      }
      const username = a.email || a.userId;
      const items = await notificationsFor(p, username);
      for (const notification of items)
        await markNotificationRead(p.orgId, username, notification.id);
      return reply(200, { read: items.length });
    }

    // 11.14 — personal profile. The target username always comes from the verified session.
    if (route === "GET /me/profile") {
      try {
        return reply(200, await readOwnProfile(a));
      } catch (err) {
        if (err && err.name === "UserNotFoundException")
          return reply(404, { error: "Profile not found" });
        throw err;
      }
    }
    if (route === "PUT /me/profile") {
      try {
        return reply(200, await updateOwnProfile(a, JSON.parse(e.body || "{}")));
      } catch (err) {
        if (err && err.status) return reply(err.status, { error: err.message });
        throw err;
      }
    }
    if (route === "GET /security/facts") return reply(200, SECURITY_FACTS);

    // Cognito verifies the current password and performs the change directly from the customer
    // surface. This self-scoped acknowledgement is called only after that succeeds, giving the
    // control plane the required administrative audit event without exposing an operator password
    // setter (requirements 4.8 and 12.7).
    if (route === "POST /me/password-changed") {
      await logActivity(a.tenantId, {
        actor: a.userId,
        actorLabel: actorLabelFor(p),
        action: "PASSWORD_CHANGED",
        summary: "Changed own password",
      });
      return reply(200, { ok: true });
    }

    // 11.14 — personal preferences. Every accepted key is stored, and an unknown key is refused
    // rather than dropped (requirements 12.4, 12.5).
    if (route === "GET /me/preferences")
      return reply(200, await readPreferences(p.orgId, a.email || a.userId));
    if (route === "PUT /me/preferences") {
      try {
        const body = JSON.parse(e.body || "{}");
        return reply(
          200,
          await savePreferences(p.orgId, a.email || a.userId, body.values || body),
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
