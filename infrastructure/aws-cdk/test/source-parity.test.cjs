// Two implementations of the control plane exist: the inline Lambda source in
// amazflow-dev.yaml (what production runs today) and services/control-plane/src/handler.ts plus
// packages/engine (the canonical source a future stack would deploy). They drifted once already
// -- the canonical copy went months without the claim/grant work while the template carried it,
// so deploying it would have silently reopened the hole it was written to close.
//
// This asserts that each security invariant of the browser-agent execution path is present in
// BOTH. It is a guard against regression by omission, not a behavioural test; critical-path
// behaviour is covered by critical-path.test.cjs against the deployed template.
const fs = require("fs");
const path = require("path");
const assert = require("node:assert");
const { extract } = require("./extract-inline-handler.cjs");

const root = path.join(__dirname, "..", "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const deployed = extract();
const canonical =
  read("services/control-plane/src/handler.ts") +
  read("packages/engine/src/index.ts");

// [what it protects, pattern in the deployed template, pattern in the canonical source]
const invariants = [
  ["claim route is exposed", /POST \/agent\/tasks\/\{id\}\/claim/, /POST \/agent\/tasks\/\{id\}\/claim/],
  ["record_step_result route is exposed", /POST \/agent\/tools\/record-step-result/, /POST \/agent\/tools\/record-step-result/],
  ["claiming is a single-winner conditional write", /attribute_not_exists\(pk\) OR leaseExpiresAtMs < :nowMs/, /attribute_not_exists\(pk\) OR leaseExpiresAtMs < :nowMs/],
  ["a claim mints a grant scoped to both agent tools", /allowedTools:\s*\[\s*['"]record_step_result['"],\s*['"]agent\.report_result['"]\s*\]/, /allowedTools:\s*\[\s*['"]record_step_result['"],\s*['"]agent\.report_result['"\s,]*\]/],
  ["grant replay protection is keyed per tool", /GRANT#\$\{payload\.grantId\}#\$\{expected\.tool/, /\$\{grantId\}#\$\{tool/],
  ["a result without a grant is refused", /Results now require the execution grant issued when the task was claimed/, /Results now require the execution grant issued when the task was claimed/],
  ["the terminal result consumes the report_result tool", /tool:\s*['"]agent\.report_result['"]/, /tool:\s*['"]agent\.report_result['"]/],
  ["tenant isolation gates the claim", /agentMayRunTask\(task,\s*agentCtx\)/, /agentMayRunTask\(task,\s*agentCtx\)/],
  ["a stalled lease returns the task to the pool", /status\s*===\s*['"]CLAIMED['"][\s\S]{0,220}claimExpiresAt/, /status\s*===\s*['"]CLAIMED['"][\s\S]{0,260}claimExpiresAt/],
  ["the server re-tests the step's own verify contract", /Independent action verification failed/, /Independent action verification failed/],
  ["a failed verification is audited distinctly", /VERIFICATION_FAILED/, /VERIFICATION_FAILED/],
  ["agent registration is idempotent per browser installation", /a\.installationId === installationId|a\.installationId===installationId/, /a\.installationId === installationId/],
  ["a superseded credential stops authenticating", /status\s*===\s*['"]superseded['"]/, /status === "superseded"/],
  ["a task carries the surface it must run on", /executionTarget:\s*target|executionTarget: executionTargetFor\(step\)/, /executionTarget: executionTargetFor\(step\)/],
  ["claims are restricted to the matching agent type", /AGENT_TYPE_FOR_TARGET\[target\]!==agentType/, /AGENT_TYPE_FOR_TARGET\[target\] !== agentType/],
  ["claims are restricted to advertised capabilities", /capabilities.*!.*includes\(task\.operation\)/, /capabilities.*!.*includes\(task\.operation\)/],
  ["the grant binds agent, surface, action and destination", /agentType:agentCtx\.agent/, /agentType: agentCtx\.agent\?\.agentType/],
  ["the result is rechecked against the reporting agent's surface", /executionTarget:task\.executionTarget/, /executionTarget: task\.executionTarget/],
  ["evidence attributes the result to an agent and grant", /evidence:\s*\{[\s\S]{0,400}grantId/, /grantId: grantPayload \? grantPayload\.grantId : null/],
  ["AI allowlist rejection fails closed with an audit event", /AI_ALLOWLIST_REJECTED/, /AI_ALLOWLIST_REJECTED/],
];

let pass = 0, fail = 0;
console.log("\nCONTROL-PLANE SOURCE PARITY\n");
for (const [name, deployedPattern, canonicalPattern] of invariants) {
  const inDeployed = deployedPattern.test(deployed);
  const inCanonical = canonicalPattern.test(canonical);
  if (inDeployed && inCanonical) { pass++; console.log("  PASS  " + name); }
  else {
    fail++;
    const missing = [!inDeployed && "amazflow-dev.yaml", !inCanonical && "services/control-plane + engine"].filter(Boolean).join(" and ");
    console.log(`  FAIL  ${name}\n        missing from: ${missing}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed\n`);
try { assert.equal(fail, 0); } catch { process.exit(1); }
