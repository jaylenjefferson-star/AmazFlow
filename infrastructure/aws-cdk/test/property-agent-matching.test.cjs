// Task 17.5 -- Property 4: Agent capability and surface matching.
//
// **Property 4**: a claim is granted only when surface, capability, and assignment all match; a
// desktop agent is never handed a browser step and vice versa; exactly one agent wins a contested
// claim; a grant verifies only against its issued scope; each grant tool is consumable exactly
// once; an expired lease is reclaimable and a live one is not.
//
// **Validates: Requirements 15.10, 15.12, 15.13, 15.14, 15.15, 15.18, 31.4-31.10**
//
// The contested-claim, grant-scope, and lease-expiry bullets are already pinned exhaustively by
// guardrail-capabilities.test.cjs, guardrail-grants.test.cjs, guardrail-leases.test.cjs, and
// critical-path.test.cjs. This file adds the one thing a hand-picked example list cannot give:
// `agentMayRunTask` -- the real admission predicate the deployed handler exports, not a
// reimplementation of it -- exercised against generated combinations of tenant, surface,
// capability, role, and ownership, so a drift between the requirement's rule and the code is
// caught regardless of which specific inputs a person thought to write down.
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fc = require("fast-check");
require("./harness.cjs");
const { writeTo } = require("./extract-inline-handler.cjs");
const inline = require(writeTo(path.join(os.tmpdir(), `amazflow-inline-p4-${process.pid}.cjs`)));
const { reporter } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("PROPERTY 4 -- AGENT CAPABILITY AND SURFACE MATCHING");

const { agentMayRunTask } = inline;
assert.equal(typeof agentMayRunTask, "function", "agentMayRunTask must be exported for this property to test the real predicate");

const AGENT_TYPE_FOR_TARGET = { browser_extension: "CHROME_EXTENSION", desktop_agent: "DESKTOP_AGENT" };
const TARGETS = ["browser_extension", "desktop_agent"];
const AGENT_TYPES = ["CHROME_EXTENSION", "DESKTOP_AGENT"];
const ROLES = ["SUPER_ADMIN", "CLIENT_ADMIN", "FRONTLINE"];
const OPERATIONS = ["SET_EMPLOYEE_STATUS", "CLICK", "APPEND_ROW"];

const arbTask = fc.record({
  tenantId: fc.constantFrom("orga", "orgb"),
  executionTarget: fc.constantFrom(...TARGETS),
  operation: fc.constantFrom(...OPERATIONS),
  assignedRoles: fc.uniqueArray(fc.constantFrom("CLIENT_ADMIN", "FRONTLINE"), { minLength: 0, maxLength: 2 }),
  createdBy: fc.constantFrom("user_a", "user_b"),
});
const arbCtx = fc.record({
  tenantId: fc.constantFrom("orga", "orgb"),
  userRole: fc.constantFrom(...ROLES),
  userId: fc.constantFrom("user_a", "user_b"),
  agent: fc.record({
    agentType: fc.constantFrom(...AGENT_TYPES),
    // undefined/empty capabilities means "not advertised" -- every operation is allowed. A
    // non-empty list must include the task's operation to admit it.
    capabilities: fc.oneof(fc.constant(undefined), fc.constant([]), fc.uniqueArray(fc.constantFrom(...OPERATIONS), { minLength: 1, maxLength: 2 })),
  }),
});

// The independent reference: the exact rule requirement 15.10 states, expressed from the inputs
// rather than copied from the function body under test.
function expectedAdmission(task, ctx) {
  if (task.tenantId !== ctx.tenantId) return false;
  if (AGENT_TYPE_FOR_TARGET[task.executionTarget] !== ctx.agent.agentType) return false;
  // No capabilities field at all (undefined) is permissive -- an older or simpler agent that never
  // reported one is not filtered out. An EXPLICIT empty array is a real, if unusual, capability set
  // and matches nothing, same as any other list that omits the operation.
  const capabilities = Array.isArray(ctx.agent.capabilities) ? ctx.agent.capabilities : null;
  if (capabilities && !capabilities.includes(task.operation)) return false;
  if (ctx.userRole === "SUPER_ADMIN") return true;
  if (!task.assignedRoles.includes(ctx.userRole)) return false;
  if (ctx.userRole === "FRONTLINE" && task.createdBy !== ctx.userId) return false;
  return true;
}

(async () => {
  section("the exported admission predicate agrees with the documented rule, for any combination");

  await check("agentMayRunTask matches the independently derived expectation across tenant, surface, capability, role, and ownership", () => {
    fc.assert(
      fc.property(arbTask, arbCtx, (task, ctx) => agentMayRunTask(task, ctx) === expectedAdmission(task, ctx)),
      { numRuns: 300 },
    );
  });

  section("surface matching is absolute, independent of everything else");

  await check("a desktop agent is never admitted to a browser-surface task, for any other field", () => {
    fc.assert(
      fc.property(arbTask, arbCtx, (task, ctx) => {
        if (task.executionTarget !== "browser_extension" || ctx.agent.agentType !== "DESKTOP_AGENT") return true;
        return agentMayRunTask(task, ctx) === false;
      }),
      { numRuns: 200 },
    );
  });

  await check("a browser agent is never admitted to a desktop-surface task, for any other field", () => {
    fc.assert(
      fc.property(arbTask, arbCtx, (task, ctx) => {
        if (task.executionTarget !== "desktop_agent" || ctx.agent.agentType !== "CHROME_EXTENSION") return true;
        return agentMayRunTask(task, ctx) === false;
      }),
      { numRuns: 200 },
    );
  });

  section("an unadvertised capability leaves the task refused for that agent, not granted");

  await check("a non-empty capability list that omits the operation never admits the task", () => {
    fc.assert(
      fc.property(arbTask, arbCtx, (task, ctx) => {
        const capabilities = ctx.agent.capabilities;
        if (!Array.isArray(capabilities) || !capabilities.length || capabilities.includes(task.operation)) return true;
        return agentMayRunTask(task, ctx) === false;
      }),
      { numRuns: 200 },
    );
  });

  section("tenant isolation holds inside the predicate itself, not only at the route layer");

  await check("a mismatched tenant is never admitted, regardless of every other field matching", () => {
    fc.assert(
      fc.property(arbTask, arbCtx, (task, ctx) => {
        if (task.tenantId === ctx.tenantId) return true;
        return agentMayRunTask(task, ctx) === false;
      }),
      { numRuns: 200 },
    );
  });

  done();
})();
