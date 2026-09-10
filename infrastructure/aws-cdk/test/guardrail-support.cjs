// Shared scaffolding for the preservation guardrail suites (task group 2).
//
// These suites pin execution semantics that ALREADY work. They land before the control-plane
// convergence work so that a regression introduced while porting routes between the two copies
// fails CI instead of reaching production. They are therefore written to be brittle in exactly one
// direction: any change to a transition, a grant field, a lease outcome or an audit ordering
// property must be a deliberate edit here, not a silent behaviour change.
//
// harness.cjs must be required before the extracted handler, since it patches Module._load to
// serve the in-memory AWS clients.
const { store, crypto } = require("./harness.cjs");
const os = require("node:os");
const path = require("node:path");
const { writeTo } = require("./extract-inline-handler.cjs");
const { handler } = require(writeTo(path.join(os.tmpdir(), `amazflow-inline-${process.pid}.cjs`)));

const now = () => new Date().toISOString();
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

const put = (pk, sk, doc, extra = {}) =>
  store.set(`${pk}|${sk}`, {
    pk: { S: pk },
    sk: { S: sk },
    ...(doc.tenantId ? { tenantId: { S: doc.tenantId } } : {}),
    document: { S: JSON.stringify(doc) },
    updatedAt: { S: now() },
    ...extra,
  });

const putTenant = (tenantId, type, doc) => put(`TENANT#${tenantId}`, `${type}#${doc.id}`, doc);
const load = (pk, sk) => {
  const item = store.get(`${pk}|${sk}`);
  return item ? JSON.parse(item.document.S) : undefined;
};
const loadRun = (tenantId, id) => load(`TENANT#${tenantId}`, `RUN#${id}`);
const loadTask = (tenantId, id) => load(`TENANT#${tenantId}`, `TASK#${id}`);
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

/** Register an agent credential the handler's agentAuth() will accept. */
const seedAgent = (tenantId, agent, token, { userRole = "CLIENT_ADMIN", userId = "user_admin" } = {}) => {
  putTenant(tenantId, "AGENT", agent);
  put("PLATFORM", `AGENTCRED#${hashToken(token)}`, {
    agentId: agent.id,
    tenantId,
    userId,
    userRole,
    tokenHash: hashToken(token),
    status: "active",
  });
  return token;
};

const parseBody = (res) => {
  try {
    return JSON.parse(res.body);
  } catch {
    return res.body;
  }
};

/** Invoke a route as an agent, authenticated by its bearer token and optionally a grant. */
const asAgent = async (token, routeKey, { pathParameters, body, grant } = {}) => {
  const res = await handler({
    routeKey,
    headers: {
      ...(token ? { "x-amazflow-agent-token": token } : {}),
      ...(grant ? { "x-amazflow-execution-grant": grant } : {}),
    },
    pathParameters,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.statusCode, body: parseBody(res), raw: res.body || "" };
};

/** Invoke a route as a signed-in human. */
const asUser = async (
  { userId = "user_admin", tenantId, group = "CLIENT_ADMIN", email },
  routeKey,
  { pathParameters, body } = {},
) => {
  const res = await handler({
    routeKey,
    headers: {},
    pathParameters,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email: email || userId,
            "custom:tenant_id": tenantId,
            "cognito:groups": `[${group}]`,
          },
        },
      },
    },
  });
  return { status: res.statusCode, body: parseBody(res), raw: res.body || "" };
};

/** Run the scheduled sweep. */
const sweep = () => handler({ source: "amazflow.sweep" });

const decodeGrant = (grant) => JSON.parse(Buffer.from(grant.split(".")[1], "base64url").toString());

/**
 * Mint a grant with the same wire format and secret the handler uses. The guardrails need this to
 * assert that each bound field is re-checked against server-loaded records: the only way to prove
 * the handler compares a field is to present a validly SIGNED grant whose field is wrong. A test
 * that could only replay grants the handler itself minted could never distinguish "checked" from
 * "ignored".
 */
const mintGrant = (overrides = {}) => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    version: 1,
    grantId: crypto.randomUUID(),
    runId: null,
    tenantId: null,
    workflowId: null,
    workflowVersion: 1,
    stepId: null,
    allowedTools: ["record_step_result", "agent.report_result"],
    confirmationGranted: false,
    taskId: null,
    agentId: null,
    agentType: null,
    executionTarget: null,
    actionType: null,
    destination: null,
    issuedAt,
    expiresAt: issuedAt + 300,
    ...overrides,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", process.env.EXECUTION_GRANT_SECRET)
    .update(`v1.${encoded}`)
    .digest("base64url");
  return `v1.${encoded}.${signature}`;
};

/** A small pass/fail reporter matching the convention the existing suites use. */
function reporter(title) {
  let pass = 0;
  let fail = 0;
  console.log(`\n${title}\n`);
  const check = async (name, fn) => {
    try {
      await fn();
      pass++;
      console.log("  PASS  " + name);
    } catch (err) {
      fail++;
      console.log("  FAIL  " + name + "\n        " + (err && err.message));
    }
  };
  const section = (name) => console.log(`\n${name}\n`);
  const done = () => {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
  };
  return { check, section, done };
}

module.exports = {
  handler,
  store,
  crypto,
  now,
  iso,
  put,
  putTenant,
  load,
  loadRun,
  loadTask,
  hashToken,
  seedAgent,
  asAgent,
  asUser,
  sweep,
  decodeGrant,
  mintGrant,
  reporter,
};
