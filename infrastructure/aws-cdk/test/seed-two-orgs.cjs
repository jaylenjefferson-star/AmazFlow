// Two-organization seed fixture for the credential-free in-memory harness (task 1.3).
//
// Isolation cannot be tested with one organization: a handler that ignores tenancy entirely passes
// every single-tenant test ever written. Every probe in the isolation suite is of the form "a
// principal of Org A names a record of Org B", so both organizations have to exist, be fully
// populated, and be populated with DIFFERENT identifiers -- so that any leak is visibly Org B's
// data rather than something that could have been Org A's.
//
// Both organizations get: users in all six customer roles plus staff, workflows (published, draft
// and archived), runs in every persisted status, tasks, approvals/confirmations, agents of both
// surfaces with live credentials, browser connections, secrets, notifications, and audit records.
//
// A note on roles. The deployed control plane today recognizes exactly three groups --
// SUPER_ADMIN, CLIENT_ADMIN and FRONTLINE. The six fine-grained customer roles are a later phase.
// The seed carries all six anyway, as data, because that is what lets the permission-matrix work
// change a table entry later instead of rewriting the fixture. Every seeded principal therefore
// exposes BOTH: `role` (the fine-grained platform role) and `group` (the Cognito group today's
// handler actually reads). Probes that need to reach a handler use `group`; probes that assert on
// the permission policy use `role`.
require("./harness.cjs");
const { store, seedUser } = require("./harness.cjs");

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

const putDoc = (pk, sk, doc, extra = {}) =>
  store.set(`${pk}|${sk}`, {
    pk: { S: pk },
    sk: { S: sk },
    ...(doc.tenantId ? { tenantId: { S: doc.tenantId } } : {}),
    document: { S: JSON.stringify(doc) },
    updatedAt: { S: iso() },
    ...extra,
  });

const putTenant = (tenantId, type, doc) => putDoc(`TENANT#${tenantId}`, `${type}#${doc.id}`, doc);
const putPlatform = (sk, doc) => putDoc("PLATFORM", sk, doc);

// Every run status the platform persists. The concurrency ceiling counts a positive subset of
// these (LIVE_RUN_STATUSES) and must exclude everything else -- including a status it does not
// recognize, which is why UNRECOGNIZED_STATUS is seeded as a real run rather than only asserted on
// in isolation.
const RUN_STATUSES = [
  "RUNNING",
  "WAITING_AGENT",
  "WAITING_APPROVAL",
  "AWAITING_CONFIRMATION",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
];

// The six customer roles plus the internal role, each mapped to the group today's handler reads.
// ORG_OWNER and ORG_ADMIN are customer administrators; the other four are not.
const ROLES = [
  { role: "ORG_OWNER", group: "CLIENT_ADMIN" },
  { role: "ORG_ADMIN", group: "CLIENT_ADMIN" },
  { role: "WORKFLOW_BUILDER", group: "FRONTLINE" },
  { role: "OPERATOR", group: "FRONTLINE" },
  { role: "APPROVER", group: "FRONTLINE" },
  { role: "VIEWER", group: "FRONTLINE" },
];

const workflowFor = (tenantId, suffix, { status, version = 1 }) => ({
  id: `wf_${suffix}`,
  tenantId,
  name: `${tenantId} workflow ${suffix}`,
  version,
  status,
  assignedRoles: ["CLIENT_ADMIN", "FRONTLINE"],
  startAt: "s_act",
  steps: [
    {
      id: "s_act",
      type: "action",
      provider: "browser",
      operation: "SET_EMPLOYEE_STATUS",
      name: "Set status",
      input: { selector: '[data-amazflow="employee-status"]', status: "Inactive", url: `https://${tenantId}.example.com/e/1` },
      verify: { path: "result.status", equals: "Inactive" },
      next: "s_end",
    },
    { id: "s_end", type: "end", outcome: "success", name: "Done" },
  ],
});

/**
 * Seed one organization. `label` is baked into every identifier and every string value, so a leak
 * is unambiguous: an Org A response containing the substring "orgb" is a cross-organization leak,
 * full stop, with no need to reason about which field it came from.
 */
function seedOrg({ tenantId, label }) {
  const org = {
    id: `org_${label}`,
    name: `${label} Industries`,
    slug: tenantId,
    status: "active",
    plan: "design_partner",
    // Q-noted: plan is reporting-only today; carried as data so the enforcement work later
    // changes a value, not this fixture.
    settings: { maxConcurrentRuns: 25, taskExpiryMs: 300000, confirmationExpiryMs: 600000 },
    branding: { logoUrl: `https://cdn.example.com/${label}.png` },
    allowedEmailDomains: [`${label}.example.com`],
    createdAt: iso(-86400000),
    updatedAt: iso(),
  };
  putPlatform(`ORG#${tenantId}`, org);

  const principals = {};
  for (const { role, group } of ROLES) {
    const username = `${role.toLowerCase()}@${label}.example.com`;
    seedUser(username, { tenantId, role: group });
    principals[role] = { userId: username, username, tenantId, role, group };
  }
  // A deactivated member: present in the pool, disabled. Every authenticated route must refuse it.
  const deactivated = `deactivated@${label}.example.com`;
  seedUser(deactivated, { tenantId, role: "FRONTLINE", enabled: false });
  principals.DEACTIVATED = { userId: deactivated, username: deactivated, tenantId, role: "VIEWER", group: "FRONTLINE", enabled: false };

  const workflows = {
    published: workflowFor(tenantId, `${label}_published`, { status: "active" }),
    draft: workflowFor(tenantId, `${label}_draft`, { status: "draft" }),
    archived: workflowFor(tenantId, `${label}_archived`, { status: "archived" }),
  };
  for (const workflow of Object.values(workflows)) {
    putTenant(tenantId, "WORKFLOW", workflow);
    putTenant(tenantId, "WORKFLOWVERSION", { ...workflow, id: `${workflow.id}_v000001` });
  }

  // One run per persisted status, plus one carrying a status the platform does not recognize.
  const runs = {};
  for (const status of [...RUN_STATUSES, "UNRECOGNIZED_STATUS"]) {
    const id = `run_${label}_${status.toLowerCase()}`;
    const run = {
      id,
      tenantId,
      workflowId: workflows.published.id,
      workflowVersion: 1,
      status,
      currentStepId: ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(status) ? undefined : "s_act",
      createdBy: principals.OPERATOR.userId,
      confirmedStepIds: [],
      stepResults: {},
      context: { input: { note: `${label} only` }, values: {}, lastAction: null },
      audit: [{ id: "aud_1", at: iso(-60000), type: "RUN_STARTED", message: "Workflow execution started", details: {} }],
      createdAt: iso(-60000),
      updatedAt: iso(-60000),
    };
    putTenant(tenantId, "RUN", run);
    putTenant(tenantId, "AUDIT", { id: `${id}#000000`, tenantId, runId: id, type: "RUN_STARTED", at: iso(-60000) });
    runs[status] = run;
  }

  // A pending browser task on the WAITING_AGENT run, and a desktop task, so surface-matching and
  // claim isolation are both probeable.
  const tasks = {
    browser: {
      id: `task_${label}_browser`,
      runId: runs.WAITING_AGENT.id,
      tenantId,
      stepId: "s_act",
      provider: "browser",
      operation: "SET_EMPLOYEE_STATUS",
      executionTarget: "browser_extension",
      destination: `https://${label}.example.com`,
      input: { selector: '[data-amazflow="employee-status"]', status: "Inactive" },
      expiresAt: iso(300000),
      status: "PENDING",
      workflowId: workflows.published.id,
      assignedRoles: ["CLIENT_ADMIN", "FRONTLINE"],
      createdBy: principals.OPERATOR.userId,
    },
    desktop: {
      id: `task_${label}_desktop`,
      runId: runs.RUNNING.id,
      tenantId,
      stepId: "s_act",
      provider: "desktop",
      operation: "desktop.open_app",
      executionTarget: "desktop_agent",
      destination: "TextEdit",
      input: { app: "TextEdit" },
      expiresAt: iso(300000),
      status: "PENDING",
      workflowId: workflows.published.id,
      assignedRoles: ["CLIENT_ADMIN", "FRONTLINE"],
      createdBy: principals.OPERATOR.userId,
    },
  };
  for (const task of Object.values(tasks)) putTenant(tenantId, "TASK", task);

  const approval = {
    id: `appr_${label}`,
    tenantId,
    runId: runs.WAITING_APPROVAL.id,
    stepId: "s_act",
    message: `${label} approval`,
    roles: ["CLIENT_ADMIN"],
    status: "PENDING",
  };
  putTenant(tenantId, "APPROVAL", approval);

  const confirmation = {
    id: `conf_${label}`,
    tenantId,
    kind: "ACTION_GATE",
    runId: runs.AWAITING_CONFIRMATION.id,
    stepId: "s_act",
    summary: { provider: "browser", operation: "SET_EMPLOYEE_STATUS", name: "Set status" },
    status: "PENDING",
    createdAt: iso(-1000),
    expiresAt: iso(600000),
  };
  putTenant(tenantId, "CONFIRMATION", confirmation);

  // Both agent surfaces, connected (a fresh heartbeat) and carrying the capability their task
  // needs, so preflight reports ready and a claim is possible.
  const agents = {
    browser: {
      id: `agent_${label}_chrome`,
      tenantId,
      name: `${label} Chrome`,
      status: "active",
      agentType: "CHROME_EXTENSION",
      capabilities: ["SET_EMPLOYEE_STATUS", "CLICK", "TYPE", "NAVIGATE"],
      installationId: `install_${label}_chrome`,
      createdBy: principals.ORG_ADMIN.userId,
      lastSeenAt: iso(-1000),
      version: "1.0.0",
      createdAt: iso(-86400000),
    },
    desktop: {
      id: `agent_${label}_desktop`,
      tenantId,
      name: `${label} Mac`,
      status: "active",
      agentType: "DESKTOP_AGENT",
      capabilities: ["desktop.open_app", "desktop.type_text"],
      installationId: `install_${label}_desktop`,
      createdBy: principals.ORG_ADMIN.userId,
      platform: "darwin",
      lastSeenAt: iso(-1000),
      version: "1.0.0",
      createdAt: iso(-86400000),
    },
  };
  for (const agent of Object.values(agents)) putTenant(tenantId, "AGENT", agent);

  const tokens = {};
  for (const [surface, agent] of Object.entries(agents)) {
    const token = `tok_${label}_${surface}`;
    tokens[surface] = token;
    putPlatform(`AGENTCRED#${require("node:crypto").createHash("sha256").update(token).digest("hex")}`, {
      agentId: agent.id,
      tenantId,
      userId: principals.ORG_ADMIN.userId,
      userRole: "CLIENT_ADMIN",
      tokenHash: require("node:crypto").createHash("sha256").update(token).digest("hex"),
      status: "active",
    });
  }

  const connection = {
    id: `conn_${label}`,
    tenantId,
    name: `${label} HRIS`,
    origin: `https://${label}.example.com`,
    status: "active",
    createdBy: principals.ORG_ADMIN.userId,
    createdAt: iso(-86400000),
  };
  putTenant(tenantId, "CONNECTION", connection);

  const secret = {
    id: `secret_${label}`,
    tenantId,
    name: `${label} api key`,
    reference: `arn:aws:secretsmanager:us-east-1:000000000000:secret:${label}`,
    createdAt: iso(-86400000),
  };
  putTenant(tenantId, "SECRET", secret);

  const notification = {
    id: `notif_${label}`,
    tenantId,
    userId: principals.OPERATOR.userId,
    kind: "APPROVAL_REQUIRED",
    message: `${label} needs an approval`,
    read: false,
    createdAt: iso(-1000),
  };
  putTenant(tenantId, "NOTIFICATION", notification);

  const ticket = {
    id: `ticket_${label}`,
    tenantId,
    createdBy: principals.OPERATOR.userId,
    subject: `${label} cannot sign in`,
    message: `${label} internal detail`,
    category: "general",
    priority: "normal",
    status: "open",
    notes: [],
    createdAt: iso(-1000),
    updatedAt: iso(-1000),
  };
  putTenant(tenantId, "TICKET", ticket);

  putTenant(tenantId, "ACTIVITY", {
    id: `act_${label}`,
    tenantId,
    actor: principals.ORG_OWNER.userId,
    action: "ORG_CREATED",
    summary: `Created ${label}`,
    at: iso(-86400000),
  });

  return { org, tenantId, label, principals, workflows, runs, tasks, approval, confirmation, agents, tokens, connection, secret, notification, ticket };
}

/** Staff (internal) principal. Belongs to no customer organization. */
const staff = { userId: "staff@amazflow.com", username: "staff@amazflow.com", tenantId: "amazflow", role: "STAFF_ADMIN", group: "SUPER_ADMIN" };

function seedTwoOrgs() {
  seedUser(staff.username, { tenantId: staff.tenantId, role: "SUPER_ADMIN" });
  const a = seedOrg({ tenantId: "orga", label: "orga" });
  const b = seedOrg({ tenantId: "orgb", label: "orgb" });
  return { a, b, staff, RUN_STATUSES, ROLES };
}

/**
 * Build a Lambda event for a session principal. `group` is what today's handler reads out of
 * cognito:groups; the fine-grained role rides along so a probe can report which role it used.
 */
const sessionEvent = (principal, routeKey, { pathParameters, body, queryStringParameters } = {}) => ({
  routeKey,
  headers: {},
  pathParameters,
  queryStringParameters,
  body: body === undefined ? undefined : JSON.stringify(body),
  requestContext: {
    authorizer: {
      jwt: {
        claims: {
          sub: principal.userId,
          // A real Cognito id token carries the email claim, and the gateway forwards it. The
          // account-status check needs it, because email is the username in this pool.
          email: principal.username || principal.userId,
          "custom:tenant_id": principal.tenantId,
          "cognito:groups": `[${principal.group}]`,
        },
      },
    },
  },
});

/** Build a Lambda event for an agent principal, authenticated by its opaque bearer token. */
const agentEvent = (token, routeKey, { pathParameters, body, grant } = {}) => ({
  routeKey,
  headers: {
    "x-amazflow-agent-token": token,
    ...(grant ? { "x-amazflow-execution-grant": grant } : {}),
  },
  pathParameters,
  body: body === undefined ? undefined : JSON.stringify(body),
});

module.exports = { seedTwoOrgs, seedOrg, sessionEvent, agentEvent, RUN_STATUSES, ROLES, staff, putTenant, putPlatform, iso };
