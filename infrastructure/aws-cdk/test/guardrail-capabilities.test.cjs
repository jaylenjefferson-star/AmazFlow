// Guardrail 2.5 -- capability-aware claiming and execution-surface derivation.
//
// The admission predicate decides what work an agent is even shown. It has five conditions, and all
// five matter for a different reason:
//
//   1. organization   -- an agent never sees another organization's work.
//   2. surface        -- the task's execution target decides which agent TYPE is eligible. A desktop
//                        agent is never offered a browser step, and vice versa. This is not a
//                        nicety: the two surfaces cannot perform each other's actions at all.
//   3. capability     -- the capability list the agent advertised decides whether this particular
//                        BUILD implements the action. An older agent is passed over rather than
//                        claiming work it would fail, which is the difference between a run that
//                        waits and a run that breaks.
//   4. assigned role  -- the agent acts on behalf of the human whose session authorized it, so the
//                        workflow's assigned roles still apply.
//   5. own work only  -- a frontline principal sees only work from runs it started.
//
// Plus: the surfaces a workflow requires are DERIVED from its own steps, never declared. A declared
// list is a second source of truth that drifts.
//
// _Requirements: 31.12, 31.18, 15.10, 15.12_
const assert = require("node:assert");
const { putTenant, asAgent, asUser, seedAgent, iso, reporter } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("GUARDRAIL: capability-aware claiming and surface derivation");

const TENANT = "guardc";
const OTHER = "othertenant";

const browserStep = {
  id: "s_web",
  type: "action",
  provider: "browser",
  operation: "SET_EMPLOYEE_STATUS",
  name: "Disable web access",
  input: { selector: "#status", status: "Inactive", url: "https://cap.example.com/e/1" },
  verify: { path: "result.status", equals: "Inactive" },
  next: "s_desk",
};
const desktopStep = {
  id: "s_desk",
  type: "action",
  provider: "desktop",
  operation: "desktop.open_app",
  name: "Open the records app",
  input: { app: "TextEdit" },
  verify: { path: "result.app", equals: "TextEdit" },
  next: "s_done",
};

const workflows = {
  mixed: {
    id: "wf_mixed",
    tenantId: TENANT,
    name: "Both surfaces",
    version: 1,
    status: "active",
    assignedRoles: ["CLIENT_ADMIN"],
    startAt: "s_web",
    steps: [browserStep, desktopStep, { id: "s_done", type: "end", outcome: "success", name: "Done" }],
  },
  browserOnly: {
    id: "wf_browser",
    tenantId: TENANT,
    name: "Browser only",
    version: 1,
    status: "active",
    assignedRoles: ["CLIENT_ADMIN"],
    startAt: "s_web",
    steps: [{ ...browserStep, next: "s_done" }, { id: "s_done", type: "end", outcome: "success", name: "Done" }],
  },
  desktopOnly: {
    id: "wf_desktop",
    tenantId: TENANT,
    name: "Desktop only",
    version: 1,
    status: "active",
    assignedRoles: ["CLIENT_ADMIN"],
    startAt: "s_desk",
    steps: [{ ...desktopStep, next: "s_done" }, { id: "s_done", type: "end", outcome: "success", name: "Done" }],
  },
  // No action steps at all: an AI decision followed by an end step. It must require NO surface,
  // which is what stops a purely analytical workflow from demanding an agent installation.
  noSurface: {
    id: "wf_nosurface",
    tenantId: TENANT,
    name: "No agent needed",
    version: 1,
    status: "active",
    assignedRoles: ["CLIENT_ADMIN"],
    startAt: "s_ai",
    steps: [
      { id: "s_ai", type: "ai", operation: "classify", name: "Classify", prompt: "x", outputKey: "decision", allowedValues: ["A", "B"], next: "s_done" },
      { id: "s_done", type: "end", outcome: "success", name: "Done" },
    ],
  },
};
for (const workflow of Object.values(workflows)) {
  putTenant(TENANT, "WORKFLOW", workflow);
  putTenant(TENANT, "WORKFLOWVERSION", { ...workflow, id: `${workflow.id}_v000001` });
}

// A full-capability agent on each surface, plus an outdated browser agent, plus one in another
// organization.
const CHROME = seedAgent(
  TENANT,
  { id: "agent_chrome", tenantId: TENANT, name: "Chrome", status: "active", agentType: "CHROME_EXTENSION", capabilities: ["SET_EMPLOYEE_STATUS", "CLICK"], lastSeenAt: iso(-1000) },
  "tok_chrome",
);
const DESKTOP = seedAgent(
  TENANT,
  { id: "agent_desktop", tenantId: TENANT, name: "Mac", status: "active", agentType: "DESKTOP_AGENT", capabilities: ["desktop.open_app", "desktop.type_text"], platform: "darwin", lastSeenAt: iso(-1000) },
  "tok_desktop",
);
const OUTDATED = seedAgent(
  TENANT,
  { id: "agent_old", tenantId: TENANT, name: "Old Chrome", status: "active", agentType: "CHROME_EXTENSION", capabilities: ["CLICK"], lastSeenAt: iso(-1000) },
  "tok_old",
);
const FRONTLINE_AGENT = seedAgent(
  TENANT,
  { id: "agent_frontline", tenantId: TENANT, name: "Frontline Chrome", status: "active", agentType: "CHROME_EXTENSION", capabilities: ["SET_EMPLOYEE_STATUS"], lastSeenAt: iso(-1000) },
  "tok_frontline",
  { userRole: "FRONTLINE", userId: "user_frontline" },
);
const CROSS_ORG = seedAgent(
  OTHER,
  { id: "agent_other", tenantId: OTHER, name: "Other org Chrome", status: "active", agentType: "CHROME_EXTENSION", capabilities: ["SET_EMPLOYEE_STATUS"], lastSeenAt: iso(-1000) },
  "tok_other",
);

let seq = 0;
const seedTask = (overrides) => {
  const n = ++seq;
  const id = `task_cap_${n}`;
  const runId = `run_cap_${n}`;
  putTenant(overrides.tenantId || TENANT, "RUN", {
    id: runId,
    tenantId: overrides.tenantId || TENANT,
    workflowId: workflows.mixed.id,
    workflowVersion: 1,
    status: "WAITING_AGENT",
    currentStepId: overrides.stepId || "s_web",
    createdBy: overrides.createdBy || "user_admin",
    confirmedStepIds: [],
    stepResults: {},
    context: { input: {}, values: {}, lastAction: null },
    audit: [{ id: "aud_1", at: iso(-60000), type: "RUN_STARTED", message: "started", details: {} }],
    createdAt: iso(-60000),
    updatedAt: iso(-60000),
  });
  const task = {
    id,
    runId,
    tenantId: TENANT,
    stepId: "s_web",
    provider: "browser",
    operation: "SET_EMPLOYEE_STATUS",
    executionTarget: "browser_extension",
    input: { selector: "#status", status: "Inactive" },
    expiresAt: iso(300000),
    status: "PENDING",
    workflowId: workflows.mixed.id,
    assignedRoles: ["CLIENT_ADMIN"],
    createdBy: "user_admin",
    ...overrides,
  };
  putTenant(task.tenantId, "TASK", task);
  return task;
};

const poll = (token) => asAgent(token, "GET /agent/tasks");
const claim = (token, id) => asAgent(token, "POST /agent/tasks/{id}/claim", { pathParameters: { id } });
const offered = async (token, taskId) => (await poll(token)).body.some((t) => t.id === taskId);
const preflight = (workflowId) =>
  asUser({ userId: "user_admin", tenantId: TENANT, group: "CLIENT_ADMIN" }, "GET /workflows/{id}/preflight", {
    pathParameters: { id: workflowId },
  });

(async () => {
  section("the admission predicate's five conditions");

  await check("1. an agent is not offered another organization's task", async () => {
    const task = seedTask({});
    assert.equal(await offered(CHROME, task.id), true, "the owning organization's agent is offered it");
    assert.equal(await offered(CROSS_ORG, task.id), false, "another organization's agent is not");
    const res = await claim(CROSS_ORG, task.id);
    assert.equal(res.status, 404, "and cannot claim it by id either");
  });

  await check("2. an agent is not offered a task for the other surface", async () => {
    const web = seedTask({ executionTarget: "browser_extension", operation: "SET_EMPLOYEE_STATUS", provider: "browser" });
    const desk = seedTask({ executionTarget: "desktop_agent", operation: "desktop.open_app", provider: "desktop", stepId: "s_desk", input: { app: "TextEdit" } });

    assert.equal(await offered(CHROME, web.id), true);
    assert.equal(await offered(CHROME, desk.id), false, "a browser agent must not see desktop work");
    assert.equal(await offered(DESKTOP, desk.id), true);
    assert.equal(await offered(DESKTOP, web.id), false, "a desktop agent must not see browser work");
  });

  await check("2b. neither surface can claim the other's task even by id", async () => {
    const web = seedTask({ executionTarget: "browser_extension" });
    const desk = seedTask({ executionTarget: "desktop_agent", operation: "desktop.open_app", provider: "desktop", stepId: "s_desk", input: { app: "TextEdit" } });
    assert.equal((await claim(DESKTOP, web.id)).status, 404, "a desktop agent cannot claim a browser step");
    assert.equal((await claim(CHROME, desk.id)).status, 404, "a browser agent cannot claim a desktop step");
  });

  await check("3. an agent lacking the advertised capability is passed over, not failed", async () => {
    const task = seedTask({ operation: "SET_EMPLOYEE_STATUS" });
    assert.equal(await offered(OUTDATED, task.id), false, "a build that cannot perform the action is not offered it");
    assert.equal(await offered(CHROME, task.id), true, "a capable build still is");
    // Passed over, not failed: the task stays claimable rather than being resolved as a failure.
    const stillPending = (await poll(CHROME)).body.find((t) => t.id === task.id);
    assert.equal(stillPending.status, "PENDING", "the task remains pending for an agent that can do it");
  });

  await check("3b. an agent advertising no capability list at all is not filtered out", async () => {
    // Agents registered before capability reporting existed advertise nothing. Treating "unknown"
    // as "incapable" would strand every such installation, so the absence of a list is permissive.
    const legacy = seedAgent(
      TENANT,
      { id: "agent_legacy", tenantId: TENANT, name: "Legacy", status: "active", agentType: "CHROME_EXTENSION", lastSeenAt: iso(-1000) },
      "tok_legacy",
    );
    const task = seedTask({});
    assert.equal(await offered(legacy, task.id), true);
  });

  await check("4. an agent whose principal's role is not assigned the workflow is not offered the task", async () => {
    const task = seedTask({ assignedRoles: ["CLIENT_ADMIN"] });
    assert.equal(await offered(FRONTLINE_AGENT, task.id), false, "an unassigned role sees nothing");
    assert.equal(await offered(CHROME, task.id), true);
  });

  await check("5. a frontline principal is offered only work from runs it started", async () => {
    const mine = seedTask({ assignedRoles: ["FRONTLINE"], createdBy: "user_frontline" });
    const theirs = seedTask({ assignedRoles: ["FRONTLINE"], createdBy: "someone_else" });
    assert.equal(await offered(FRONTLINE_AGENT, mine.id), true, "its own work is offered");
    assert.equal(await offered(FRONTLINE_AGENT, theirs.id), false, "another person's work is not");
    assert.equal((await claim(FRONTLINE_AGENT, theirs.id)).status, 404);
  });

  await check("a revoked credential is admitted to nothing", async () => {
    const task = seedTask({});
    const revoked = seedAgent(
      TENANT,
      { id: "agent_revoked", tenantId: TENANT, name: "Revoked", status: "active", agentType: "CHROME_EXTENSION", capabilities: ["SET_EMPLOYEE_STATUS"], lastSeenAt: iso(-1000) },
      "tok_revoked",
    );
    const { put, hashToken } = require("./guardrail-support.cjs");
    put("PLATFORM", `AGENTCRED#${hashToken(revoked)}`, {
      agentId: "agent_revoked",
      tenantId: TENANT,
      userId: "user_admin",
      userRole: "CLIENT_ADMIN",
      tokenHash: hashToken(revoked),
      status: "revoked",
    });
    const res = await poll(revoked);
    assert.ok(res.status >= 400, `a revoked credential must not authenticate, got ${res.status}`);
    assert.equal((await claim(revoked, task.id)).status >= 400, true);
  });

  section("the surfaces a workflow requires are derived from its own steps");

  await check("a mixed workflow reports both surfaces", async () => {
    const res = await preflight(workflows.mixed.id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([...res.body.requiredTargets].sort(), ["browser_extension", "desktop_agent"]);
    assert.equal(res.body.surfaces.length, 2);
  });

  await check("a browser-only workflow never asks for the desktop application", async () => {
    const res = await preflight(workflows.browserOnly.id);
    assert.deepEqual(res.body.requiredTargets, ["browser_extension"]);
    assert.equal(res.body.surfaces.length, 1);
  });

  await check("a desktop-only workflow never asks for the browser extension", async () => {
    const res = await preflight(workflows.desktopOnly.id);
    assert.deepEqual(res.body.requiredTargets, ["desktop_agent"]);
  });

  await check("a workflow with no action steps requires no surface at all", async () => {
    const res = await preflight(workflows.noSurface.id);
    assert.deepEqual(res.body.requiredTargets, [], "an analytical workflow must not demand an agent");
    assert.equal(res.body.ready, true, "and must therefore be ready to run");
  });

  await check("each surface's required actions are derived from the steps that target it", async () => {
    const res = await preflight(workflows.mixed.id);
    const browser = res.body.surfaces.find((s) => s.target === "browser_extension");
    const desktop = res.body.surfaces.find((s) => s.target === "desktop_agent");
    assert.deepEqual(browser.requiredActions, ["SET_EMPLOYEE_STATUS"]);
    assert.deepEqual(desktop.requiredActions, ["desktop.open_app"]);
    assert.equal(browser.agentType, "CHROME_EXTENSION", "each surface names the agent type that serves it");
    assert.equal(desktop.agentType, "DESKTOP_AGENT");
  });

  await check("a surface whose connected agents lack the required action reports outdated, not ready", async () => {
    // Narrow the desktop agent's capabilities so it can no longer perform the step it is needed for.
    const capable = require("./guardrail-support.cjs").load(`TENANT#${TENANT}`, "AGENT#agent_desktop");
    putTenant(TENANT, "AGENT", { ...capable, capabilities: ["desktop.type_text"] });
    const res = await preflight(workflows.desktopOnly.id);
    const desktop = res.body.surfaces.find((s) => s.target === "desktop_agent");
    assert.equal(desktop.status, "outdated");
    assert.equal(desktop.action, "update", "the recovery action tells the person what to actually do");
    assert.equal(res.body.ready, false);
    putTenant(TENANT, "AGENT", capable); // restore
  });

  done();
})();
