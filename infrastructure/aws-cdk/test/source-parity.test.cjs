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

const { deployedRoutes, canonicalRoutes } = require("./extract-routes.cjs");

const root = path.join(__dirname, "..", "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const deployed = extract();
// The canonical copy is split across modules, so the comparison text has to include all of them.
// The deployed template is one inline file, so a behaviour that lives in a separate module on the
// canonical side must still be found SOMEWHERE on the deployed side -- which is the whole point.
const canonical =
  read("services/control-plane/src/handler.ts") +
  read("services/control-plane/src/browser-connections.ts") +
  read("packages/engine/src/index.ts") +
  // Phase 2: the canonical copy imports its policy from a real package, while the deployed template
  // has to carry the policy inline. Both texts must therefore be searched, or every policy invariant
  // would read as "missing from the canonical side" purely because it lives one module over.
  read("packages/permissions/src/index.ts");

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

  // Organization profile and settings. These matter to parity specifically because they are
  // enforcement points: a copy that carried the settings routes but not the run-creation gates
  // would accept "paused" and keep executing, which is the failure mode the whole feature exists
  // to prevent.
  ["the org profile route is exposed", /PUT \/organizations\/\{slug\}/, /PUT \/organizations\/\{slug\}/],
  ["the org settings route is exposed", /POST \/organizations\/\{slug\}\/settings/, /POST \/organizations\/\{slug\}\/settings/],
  ["a single org is readable by its own admin", /GET \/organizations\/\{slug\}'/, /GET \/organizations\/\{slug\}"/],
  ["org status is a closed set", /ORG_STATUSES=\['active','paused','suspended'\]/, /ORG_STATUSES = \[\s*"active",\s*"paused",\s*"suspended",?\s*\]/],
  ["a non-active org cannot start a run", /runOrg\.status!=='active'/, /runOrg\.status !== "active"/],
  ["the concurrency limit is enforced at run creation", /liveNow>=runLimit/, /liveNow >= runLimit/],
  ["in-flight is a positive status list, so unknown statuses fail open", /LIVE_RUN_STATUSES=\[/, /LIVE_RUN_STATUSES = \[/],
  ["the run limit is counted per organization", /r\.tenantId===workflow\.tenantId&&LIVE_RUN_STATUSES/, /r\.tenantId === workflow\.tenantId &&\s*LIVE_RUN_STATUSES/],
  ["the tenant identifier cannot be renamed", /An organization slug cannot be changed/, /An organization slug cannot be changed/],
  ["a customer admin cannot raise their own run limit", /Only AmazFlow administrators change the concurrent run limit/, /Only AmazFlow administrators change the concurrent run limit/],
  ["org changes are audited", /ORG_SETTINGS_CHANGED/, /ORG_SETTINGS_CHANGED/],
  ["email domains are normalised before storage", /replace\(\/\^@\+\/,''\)/, /replace\(\/\^@\+\/, ""\)/],

  // Invitations. The asymmetric risk here is a copy that creates the Cognito user but skips the
  // tenant claim or the group, either of which produces an account that silently misbehaves
  // rather than one that visibly fails.
  ["the invite route is exposed", /POST \/tenants\/\{tenantId\}\/users'/, /POST \/tenants\/\{tenantId\}\/users"/],
  ["an invitation stamps the tenant claim", /Name:'custom:tenant_id',Value:tenantId/, /Name: "custom:tenant_id", Value: tenantId/],
  ["an invitation records the real sign-up date", /Name:'custom:created_at'/, /Name: "custom:created_at"/],
  ["an invitation puts the person in a role group", /AdminAddUserToGroupCommand/, /AdminAddUserToGroupCommand/],
  ["only non-staff roles are invitable", /INVITABLE_ROLES=\['CLIENT_ADMIN','FRONTLINE'\]/, /INVITABLE_ROLES = \["CLIENT_ADMIN", "FRONTLINE"\]/],
  ["staff accounts are refused explicitly", /AmazFlow staff accounts are not created through this route/, /AmazFlow staff accounts are not created through this route/],
  ["the allowed-domain list gates invitations", /outside this organization's allowed email domains/, /outside this organization's allowed email domains/],
  ["a duplicate address is refused", /already has an AmazFlow account/, /already has an AmazFlow account/],
  ["a group failure is reported, not swallowed", /they cannot sign in yet/, /they cannot sign in yet/],
  ["a suspended organization cannot add people", /Contact AmazFlow before adding people/, /Contact AmazFlow before adding people/],
  ["invitations are audited", /TEAM_MEMBER_INVITED/, /TEAM_MEMBER_INVITED/],
  ["the team list distinguishes an unaccepted invitation", /userStatus:u\.UserStatus/, /userStatus: u\.UserStatus/],

  // Phase 0b (task 3.6): one invariant per behaviour ported between the copies. The standing rule
  // this establishes -- any security-relevant behaviour added to either copy adds a matching
  // invariant here -- is what stops the next port from being a one-way trip.
  //
  // Preflight (3.1). The gate matters more than the route: a copy carrying the route but not the
  // run-creation check would report "not ready" on a screen and then start the run anyway.
  ["the preflight route is exposed", /GET \/workflows\/\{id\}\/preflight/, /GET \/workflows\/\{id\}\/preflight/],
  ["required surfaces are derived from the workflow's own steps", /requiredTargets:targets/, /requiredTargets: targets/],
  ["a run is refused up front when its surface is not ready", /needs an execution agent that is not ready yet/, /needs an execution agent that is not ready yet/],
  ["preflight names a recovery action per surface, not just a status", /action=target==='desktop_agent'\?'open_app':'connect'/, /action = target === "desktop_agent" \? "open_app" : "connect"/],

  // Agent snapshot and heartbeat (3.3). Derived status is the point: a stored one goes stale the
  // moment a laptop sleeps.
  ["connection status is derived from heartbeat recency", /HEARTBEAT_GRACE_MS/, /HEARTBEAT_GRACE_MS/],
  ["revocation outranks heartbeat recency", /agent\.status!=='active'\?'revoked'/, /agent\.status !== "active"\s*\?\s*"revoked"/],
  ["the agent list returns the derived snapshot", /\.\.\.agentSnapshot\(x\)/, /\.\.\.agentSnapshot\(x\)/],
  ["a heartbeat updates the advertised capability set", /if\(Array\.isArray\(capabilities\)\) agent\.capabilities=capabilities/, /if \(Array\.isArray\(capabilities\)\)\s*agent\.capabilities = capabilities/],
  ["a heartbeat records reported permissions", /if\(permissions&&typeof permissions==='object'\) agent\.permissions=permissions/, /if \(permissions && typeof permissions === "object"\)\s*agent\.permissions = permissions/],

  // Diagnostic executor invocation (3.2). Staff-only and labelled a diagnostic in both copies, and
  // narrower than a claim's grant -- it may report progress, never submit a terminal result.
  ["the diagnostic executor route is exposed", /POST \/runs\/\{id\}\/executor\/invoke/, /POST \/runs\/\{id\}\/executor\/invoke/],
  ["the diagnostic executor route is staff-only", /Only AmazFlow administrators can invoke the Executor directly/, /Only AmazFlow administrators can invoke the Executor directly/],
  ["the diagnostic executor route is labelled a diagnostic rather than a feature", /invoke the Executor directly \((proof-of-concept|diagnostic) route\)/, /invoke the Executor directly \(diagnostic route\)/],
  ["the diagnostic grant cannot submit a terminal result", /allowedTools:\['record_step_result'\]/, /allowedTools: \["record_step_result"\]/],
  ["the diagnostic route refuses a run that is not waiting on an agent", /Run is not waiting on an agent step/, /Run is not waiting on an agent step/],

  // Browser connections (3.4).
  ["the browser connection list route is exposed", /GET \/connections\/browser'/, /GET \/connections\/browser"/],
  ["the browser connection create route is exposed", /POST \/connections\/browser'/, /POST \/connections\/browser"/],
  ["the browser connection revoke route is exposed", /DELETE \/connections\/browser\/\{id\}/, /DELETE \/connections\/browser\/\{id\}/],
  ["a connection may only target a public HTTPS origin", /must be a public HTTPS URL/, /must be a public HTTPS URL/],
  ["private and link-local hosts are refused", /169\\\.254\|192\\\.168/, /169\\\.254\|192\\\.168/],
  ["an allowed origin may carry no path, query or fragment", /without a path, query, or fragment/, /without a path, query, or fragment/],
  ["the allowed origin list must include the base URL's own origin", /Allowed origins must include the base URL origin/, /Allowed origins must include the base URL origin/],
  ["the allowed origin list is bounded", /at most 20 origins/, /at most 20 origins/],
  ["the managed profile identifier never leaves the server", /const \{managedProfileId,\.\.\.safe\}=connection/, /const \{ managedProfileId, \.\.\.safe \} = connection/],
  ["browser connections are admin-only", /Only tenant admins view browser connections/, /Only tenant admins view browser connections/],
  ["a revoked connection cannot start a login session", /This connection has been revoked/, /This connection has been revoked/],
  ["an unconfigured managed browser is reported plainly", /Managed browser is not configured/, /Managed browser is not configured/],
  ["revoking a browser connection is audited", /BROWSER_CONNECTION_REVOKED/, /BROWSER_CONNECTION_REVOKED/],

  // Phase 1 -- authentication and session lifecycle. Same standing rule as above: each
  // security-relevant behaviour gets an invariant in both copies.
  //
  // The organization-claim default was the sharpest of these: a missing claim used to fall back to
  // "amazflow", which is the STAFF tenant, so an account created without the claim silently became a
  // member of AmazFlow's own organization.
  ["a token with no organization claim yields no usable principal", /reason:'no_organization'/, /reason: "no_organization"/],
  ["the organization claim is not defaulted", /typeof tenantId!=='string'\|\|tenantId\.trim\(\)===''/, /typeof tenantId === "string" && tenantId\.trim\(\) !== ""/],
  ["a missing organization is reported distinctly from a missing role", /code:'NO_ORGANIZATION'/, /code: "NO_ORGANIZATION"/],
  ["a disabled account is refused on its next call", /code:'ACCOUNT_DISABLED'/, /code: "ACCOUNT_DISABLED"/],
  ["the account-status lookup fails open rather than signing everyone out", /return 'unknown';/, /return "unknown";/],
  ["the current-user route reports organization, role and account status", /organizationId:a\.tenantId,role:a\.role,[\s\S]{0,120}accountStatus/, /organizationId: a\.tenantId,\s*role: a\.role,[\s\S]{0,200}accountStatus/],
  ["sign-out-everywhere is exposed", /POST \/me\/sessions\/revoke/, /POST \/me\/sessions\/revoke/],
  ["sign-out-everywhere revokes at the identity provider", /AdminUserGlobalSignOutCommand/, /AdminUserGlobalSignOutCommand/],
  ["sign-out-everywhere is audited", /SESSIONS_REVOKED_SELF/, /SESSIONS_REVOKED_SELF/],
  ["staff session revocation is exposed", /POST \/tenants\/\{tenantId\}\/users\/\{username\}\/sessions\/revoke/, /POST \/tenants\/\{tenantId\}\/users\/\{username\}\/sessions\/revoke/],
  ["staff session revocation is staff-only", /Only AmazFlow administrators revoke another user's sessions/, /Only AmazFlow administrators revoke another user's sessions/],
  ["staff session revocation is audited against the target's organization", /SESSIONS_REVOKED_BY_STAFF/, /SESSIONS_REVOKED_BY_STAFF/],
  ["the structured error envelope rides alongside the flat error field", /const withErrorEnvelope=/, /const withErrorEnvelope = /],
  ["the error code is stable rather than derived from prose", /CODE_FOR_STATUS/, /CODE_FOR_STATUS/],
  ["every error carries a correlation identifier", /correlationId/, /correlationId/],

  // Phase 2 -- the permissions policy, the principal, and the tenant scope. Same standing rule: each
  // security-relevant behaviour gets an invariant in BOTH copies.
  //
  // The sharpest of these is the refusal status. Thirteen routes answered 403 with a message naming
  // the record type when an id belonged to another organization, which is an existence oracle: it
  // distinguishes "exists elsewhere" from "does not exist". Both copies must answer 404.
  ["a wrong-organization decision answers 404, not 403", /code==='WRONG_ORG'\?404:403/, /code === "WRONG_ORG" \? 404 : 403/],
  ["a wrong-organization refusal does not name the record", /code==='WRONG_ORG'\?'Not found'/, /code === "WRONG_ORG" \? "Not found"/],
  ["no route still refuses a foreign id with a record-naming 403", /^(?!.*belongs to another tenant)[\s\S]*$/, /^(?!.*belongs to another tenant)[\s\S]*$/],
  ["the organization boundary is evaluated before any grant lookup", /if\(!principal\.isStaff&&resource\.orgId!==principal\.orgId\)/, /if \(!principal\.isStaff && resource\.orgId !== principal\.orgId\)/],
  ["the internal namespace is unreachable for a customer role", /if\(isInternalPermission\(permission\)\) return \{allow:false/, /if \(isInternalPermission\(permission\)\)\s*return deny\("FORBIDDEN"/],
  ["grants are a keyed collection of permission sets", /const ROLE_GRANTS=\{/, /ROLE_GRANTS: Record<PlatformRole, ReadonlySet<Permission>>/],
  ["deny by default: absence of a grant is a denial", /if\(!grants\|\|!grants\.has\(permission\)\)/, /if \(!grants \|\| !grants\.has\(permission\)\)/],
  ["own-record narrowing is driven by the broad form", /BROAD_FORM=\{'run:read':'run:read_all'/, /"run:read": "run:read_all"/],
  ["workflow assignment preserves the coarse-role rule", /permission==='workflow:run'&&resource\.assignedRoles/, /permission === "workflow:run" &&\s*resource\.assignedRoles/],
  ["the six customer roles are defined", /CUSTOMER_ROLES=\['ORG_OWNER','ORG_ADMIN','WORKFLOW_BUILDER','OPERATOR','APPROVER','VIEWER'\]/, /"ORG_OWNER",\s*"ORG_ADMIN",\s*"WORKFLOW_BUILDER",\s*"OPERATOR",\s*"APPROVER",\s*"VIEWER",/],
  ["publishing is withheld from WORKFLOW_BUILDER under Q-1", /WORKFLOW_BUILDER:new Set\(\['workflow:read','workflow:create','workflow:edit','workflow:archive'/, /WORKFLOW_BUILDER: new Set<Permission>\(\[\s*"workflow:read", "workflow:create", "workflow:edit", "workflow:archive"/],
  ["an existing CLIENT_ADMIN defaults to ORG_ADMIN so access is unchanged", /CLIENT_ADMIN:'ORG_ADMIN'/, /CLIENT_ADMIN: "ORG_ADMIN"/],
  ["an existing FRONTLINE defaults to OPERATOR so access is unchanged", /FRONTLINE:'OPERATOR'/, /FRONTLINE: "OPERATOR"/],
  ["the coarse group wins over a stored membership role", /roleIsReachableFromGroup/, /roleIsReachableFromGroup/],
  ["the fine role lives on a MEMBERSHIP record", /MEMBERSHIP#\$\{username\}/, /MEMBERSHIP#\$\{username\}/],
  ["membership backfill is lazy and read-triggered", /backfilled:!stored/, /backfilled: !stored/],
  ["the tenant-scoped read takes the organization from the principal", /const tenantScope=p=>\(\{pk:`TENANT#\$\{p\.orgId\}`\}\)/, /const tenantScope = \(p\) => \(\{ pk: `TENANT#\$\{p\.orgId\}` \}\)/],
  ["the cross-organization read is separately named and demands a reason", /crossTenantRead requires a stated reason/, /crossTenantRead requires a stated reason/],
  ["a staff cross-organization read is audited", /CROSS_TENANT_READ/, /CROSS_TENANT_READ/],
  ["platform machinery reads are named distinctly from staff reads", /platformRead requires a stated reason/, /platformRead requires a stated reason/],
  ["an entity is resolved under the caller's own scope, so a foreign id is not found", /const resolveEntity=async\(type,id,principal,reason\)/, /const resolveEntity = async \(type, id, principal, reason\)/],
  ["the agent elevation is an explicit agent principal", /kind:'agent'/, /kind: "agent"/],
  ["an agent principal is never staff", /agentType:agentCtx\.agent&&agentCtx\.agent\.agentType\?agentCtx\.agent\.agentType:'CHROME_EXTENSION',capabilities:\(agentCtx\.agent&&agentCtx\.agent\.capabilities\)\|\|\[\],isStaff:false/, /isStaff: false/],
  ["every denial is audited with the permission and decision code", /AUTHORIZATION_DENIED/, /AUTHORIZATION_DENIED/],
  ["every denial emits a metric", /emitApplicationMetric\('AuthorizationDenied'\)/, /emitApplicationMetric\("AuthorizationDenied"\)/],
  ["the bounded AI diagnostic is staff-only", /internal:ai_execute/, /internal:ai_execute/],
  ["an organization-scoped audit read exists rather than a widened cross-organization one", /GET \/audit/, /GET \/audit/],
  ["the concurrency limit is refused for every customer role through the policy", /maySetConcurrencyLimit/, /maySetConcurrencyLimit/],
  ["the staff group is never invitable", /INVITABLE_ROLES=\['CLIENT_ADMIN','FRONTLINE'\]/, /INVITABLE_ROLES = \["CLIENT_ADMIN", "FRONTLINE"\]/],
  ["the permission matrix is exposed as a route", /GET \/permissions\/matrix/, /GET \/permissions\/matrix/],
  ["navigation is derived from the same policy the API enforces", /const visibleSections=/, /export function visibleSections/],
];

let pass = 0, fail = 0;

// ---------------------------------------------------------------------- route-set symmetry -----
//
// The invariant list below is a presence check on individual behaviours, which only catches drift
// in behaviours somebody thought to add a pattern for. It cannot catch a whole ROUTE existing in one
// copy and not the other -- and that is exactly how these two copies drifted: the canonical copy
// went months without the claim/grant work while the template carried it, and the template never had
// the browser connection routes the canonical copy did.
//
// So the route set is compared as a set, in both directions, and any asymmetry fails the build.
// Phase 0b converged the two; this is what keeps them converged.
console.log("\nCONTROL-PLANE ROUTE-SET SYMMETRY\n");
{
  const deployedSet = new Set(deployedRoutes());
  const canonicalSet = new Set(canonicalRoutes());
  const deployedOnly = [...deployedSet].filter((r) => !canonicalSet.has(r)).sort();
  const canonicalOnly = [...canonicalSet].filter((r) => !deployedSet.has(r)).sort();

  if (deployedOnly.length === 0 && canonicalOnly.length === 0) {
    pass++;
    console.log(`  PASS  both copies serve the same ${deployedSet.size} routes`);
  } else {
    fail++;
    console.log("  FAIL  the two control-plane copies do not serve the same route set");
    if (deployedOnly.length)
      console.log(
        "        only in amazflow-dev.yaml (deploying the canonical copy would LOSE these):\n" +
          deployedOnly.map((r) => "          " + r).join("\n"),
      );
    if (canonicalOnly.length)
      console.log(
        "        only in services/control-plane (these are written but not deployed):\n" +
          canonicalOnly.map((r) => "          " + r).join("\n"),
      );
    console.log(
      "        Port the missing routes rather than deleting the inventory entry. If a route is\n" +
        "        genuinely being retired, remove it from BOTH copies in the same change.",
    );
  }
}

// A route the Lambda serves but the gateway does not declare is unreachable in production -- the
// quieter half of the same defect, and one the handler-to-handler comparison above cannot see.
console.log("\nGATEWAY ROUTE COVERAGE\n");
{
  const template = read("infrastructure/aws-cdk/amazflow-dev.yaml");
  const declared = new Set(
    [...template.matchAll(/RouteKey:\s*'([^']+)'/g)].map((match) => match[1]),
  );
  const served = deployedRoutes();
  const unreachable = served.filter((route) => !declared.has(route)).sort();
  const orphaned = [...declared].filter((route) => !served.includes(route)).sort();

  if (unreachable.length === 0) {
    pass++;
    console.log(`  PASS  every one of the ${served.length} handled routes is declared at the gateway`);
  } else {
    fail++;
    console.log(
      "  FAIL  these routes are handled by the Lambda but not declared at the gateway, so they\n" +
        "        cannot be called at all:\n" +
        unreachable.map((r) => "          " + r).join("\n"),
    );
  }

  if (orphaned.length === 0) {
    pass++;
    console.log("  PASS  the gateway declares no route the handler does not serve");
  } else {
    fail++;
    console.log(
      "  FAIL  the gateway declares these routes but the handler has no branch for them, so they\n" +
        "        answer 404 from inside the Lambda:\n" +
        orphaned.map((r) => "          " + r).join("\n"),
    );
  }

  // CORS is part of reachability: a method missing from AllowMethods is refused at the preflight,
  // before the request the route would have served is ever made.
  const allowMethods = (template.match(/AllowMethods:\s*\[([^\]]+)\]/) || [, ""])[1]
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const methodsUsed = [...new Set(served.map((route) => route.split(" ")[0]))].sort();
  const notAllowed = methodsUsed.filter((method) => !allowMethods.includes(method));
  if (notAllowed.length === 0) {
    pass++;
    console.log(`  PASS  every method the routes use (${methodsUsed.join(", ")}) is permitted by CORS`);
  } else {
    fail++;
    console.log(
      `  FAIL  the routes use ${notAllowed.join(", ")} but CORS permits only ${allowMethods.join(", ")};\n` +
        "        a browser's preflight is refused before the request is made",
    );
  }
}

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
