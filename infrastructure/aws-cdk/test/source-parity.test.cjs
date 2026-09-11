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
  // Phase 2 turned this message-based guard into a permission. The invariant follows it rather than
  // being deleted: what matters is that the restriction still exists in both copies, not that it is
  // still phrased as prose.
  ["browser connections are admin-only", /authorizeIn\(asPrincipal\(a\),'connection:read'/, /authorizeIn\(asPrincipal\(a\), "connection:read"/],
  ["managing a browser connection needs the manage permission", /authorizeIn\(asPrincipal\(a\),'connection:manage'/, /authorizeIn\(asPrincipal\(a\), "connection:manage"/],
  ["a revoked connection cannot start a login session", /This connection has been revoked/, /This connection has been revoked/],
  ["an unconfigured managed browser is reported plainly", /Managed browser is not configured/, /Managed browser is not configured/],
  ["revoking a browser connection is audited", /BROWSER_CONNECTION_REVOKED/, /BROWSER_CONNECTION_REVOKED/],

  // Customer-managed secrets (20.2/20.3).
  ["the secrets list route is exposed", /GET \/secrets'/, /GET \/secrets"/],
  ["the secret create route is exposed", /POST \/secrets'/, /POST \/secrets"/],
  ["the secret rotate route is exposed", /POST \/secrets\/\{id\}\/rotate/, /POST \/secrets\/\{id\}\/rotate/],
  ["the secret delete route is exposed", /DELETE \/secrets\/\{id\}/, /DELETE \/secrets\/\{id\}/],
  ["a secret name is required", /A secret name is required/, /A secret name is required/],
  ["a secret kind must be one of the recognized kinds", /is not a secret kind \(available:/, /is not a secret kind \(available:/],
  ["the external store pointer never leaves the server", /const \{ref,\.\.\.safe\}=secret/, /const \{ ref, \.\.\.safe \} = secret/],
  ["managing a secret needs the manage permission", /authorizeIn\(asPrincipal\(a\),'secret:manage'/, /authorizeIn\(asPrincipal\(a\), "secret:manage"/],
  ["creating a secret is audited", /SECRET_CREATED/, /SECRET_CREATED/],
  ["rotating a secret is audited", /SECRET_ROTATED/, /SECRET_ROTATED/],
  ["deleting a secret is audited", /SECRET_DELETED/, /SECRET_DELETED/],

  // Task eligibility diagnosis (17.3 / requirement 15.17).
  ["a pending task's eligibility reason is computed server-side", /taskEligibilityReason=async\(task\)=>\{/, /taskEligibilityReason = async \(task\) => \{/],
  ["an eligible task's reason is null, not a false explanation", /if\(permissioned\.length\) return null;/, /if \(permissioned\.length\) return null;/],

  // Resume from an exception (18.5).
  ["the resume route is exposed", /POST \/runs\/\{id\}\/resume/, /POST \/runs\/\{id\}\/resume/],
  ["resume is admitted only from the two exception statuses", /RESUMABLE_EXCEPTION_STATUSES=\['FAILED','TIMED_OUT'\]/, /RESUMABLE_EXCEPTION_STATUSES = \["FAILED", "TIMED_OUT"\]/],
  ["resume pins the new run to the original's own workflow version", /getWorkflowVersion\(run\.tenantId,run\.workflowId,run\.workflowVersion\)/, /getWorkflowVersion\(\s*run\.tenantId,\s*run\.workflowId,\s*run\.workflowVersion,\s*\)/],
  ["resuming a run is audited", /RUN_RESUMED_FROM_EXCEPTION/, /RUN_RESUMED_FROM_EXCEPTION/],

  // Correlation, structured logging, and audit (26.12).
  ["a supplied correlation identifier is used where present", /e\.headers\?\.\['x-correlation-id'\]/, /e\.headers\?\.\["x-correlation-id"\]/],
  ["the correlation identifier is returned on every response, not only errors", /'x-correlation-id':correlationId/, /"x-correlation-id": correlationId/],
  ["every request emits one structured log line", /const logRequest=\(status\)=>/, /const logRequest = \(status\) => /],
  ["the structured line never carries a request or response body, only its shape", /routeKey:responseRoute,userId:requestUserId,orgId:requestOrgId,status,durationMs/, /routeKey: responseRoute,\s*userId: requestUserId,\s*orgId: requestOrgId,\s*status,\s*durationMs/],
  ["every audit event carries its request's correlation identifier", /doc=\{id,tenantId,at:now\(\),\.\.\.entry,correlationId\}/, /doc = \{ id, tenantId, at: now\(\), \.\.\.entry, correlationId \}/],

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
  ["the current-user route reports organization, role and account status", /organizationId:a\.tenantId,(organizationName:[^,]+,)?role:a\.role,[\s\S]{0,200}accountStatus/, /organizationId: a\.tenantId,[\s\S]{0,400}role: a\.role,[\s\S]{0,700}accountStatus/],
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
  ["staff lists use bounded cursor pagination", /paginateList=.*pageSize.*200/, /const paginateList[\s\S]*PAGE_SIZE_MAX/],
  ["cross-organization access emits an alarm metric", /CrossOrganizationAccess/, /CrossOrganizationAccess/],
  ["cross-organization access publishes a zero heartbeat", /CrossOrganizationAccess',0/, /CrossOrganizationAccess", 0/],
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
  ["own-record list narrowing is driven by the permission, not by the group", /!can\(p,'run:read_all',\{orgId:p\.orgId\}\)\.allow/, /!can\(p, "run:read_all", \{ orgId: p\.orgId \}\)\.allow/],
  ["the audit actor label comes from the policy rather than a role comparison", /const actorLabelFor=/, /const actorLabelFor = /],
  ["a list route does not decide its own scope", /const tenantOrStaffRead=/, /const tenantOrStaffRead = /],

  // Phase 3 -- the three surfaces. Same standing rule.
  //
  // The wildcard cross-origin header is the one worth spelling out. `*` told every browser on the
  // internet that any page may read this API's responses. Bearer-token auth meant a drive-by page
  // could not obtain a token, so it was not directly exploitable -- but that is a property of the auth
  // scheme, and the header outlives the scheme.
  ["exactly one origin is echoed from a closed allowlist", /const ALLOWED_ORIGINS=\['https:\/\/amazflow\.com','https:\/\/www\.amazflow\.com','https:\/\/app\.amazflow\.com','https:\/\/admin\.amazflow\.com'\]/, /const ALLOWED_ORIGINS = \[\s*"https:\/\/amazflow\.com",\s*"https:\/\/www\.amazflow\.com",\s*"https:\/\/app\.amazflow\.com",\s*"https:\/\/admin\.amazflow\.com",?\s*\]/],
  ["an unlisted origin receives no cross-origin header at all", /const corsHeaders=\(\)=>requestOrigin\?\{'access-control-allow-origin':requestOrigin,'vary':'origin'\}:\{\}/, /requestOrigin \? \{ "access-control-allow-origin": requestOrigin, vary: "origin" \} : \{\}/],
  ["the response varies by origin, so no cache serves one surface another's body", /'vary':'origin'/, /vary: "origin"/],
  ["the requesting origin is resolved once per invocation", /requestOrigin=allowedOriginFor\(e\)/, /requestOrigin = allowedOriginFor\(e\)/],
  ["the permissive wildcard cross-origin header is gone", /^(?![\s\S]*access-control-allow-origin':'\*')[\s\S]*$/, /^(?![\s\S]*"access-control-allow-origin": "\*")[\s\S]*$/],

  // Phase 4 -- organization, users, teams, invitations, notifications, personal settings. Same
  // standing rule.
  //
  // The invitation half is where the asymmetric risk lives. A copy that carried the acceptance route
  // but not its conditional write would accept the same invitation twice under concurrency; a copy
  // that read the organization out of the request body would let a token holder join any tenant they
  // could name. Neither failure is visible from the outside until it has already happened.
  ["the commercial lifecycle status is separate from the execution status", /const COMMERCIAL_STATUSES=/, /const COMMERCIAL_STATUSES = /],
  ["no recorded commercial status reads as commercially active", /const lifecycleStatusOf=/, /const lifecycleStatusOf = /],
  ["internal-only organization fields never reach a customer surface", /const INTERNAL_ORG_FIELDS=\['lifecycleStatus','accountOwnerUserId','crmRecordId'\]/, /const INTERNAL_ORG_FIELDS = \["lifecycleStatus", "accountOwnerUserId", "crmRecordId"\]/],
  ["the organization projection strips internal fields before a customer response", /const organizationFor=/, /const organizationFor = /],
  ["every successful route response has an explicit allowlist", /const RESPONSE_FIELDS_BY_ROUTE=new Map/, /const RESPONSE_FIELDS_BY_ROUTE = new Map/],
  ["a missing successful response contract fails closed", /response allowlist missing/, /response allowlist missing/],
  ["private response fields are stripped at every nesting depth", /privateResponseFields\.has\(key\)/, /privateResponseFields\.has\(key\)/],
  // A fail-closed allowlist has a second failure mode besides leaking: a route that borrows another
  // route's contract quietly loses the fields it does not share. Preflight borrowed the workflow
  // contract and lost `surfaces` -- the per-surface status, recovery action and agent list that is
  // the entire answer the route exists to give. Pinned in both copies so the narrower contract
  // cannot come back on one side only.
  ["the preflight readiness report has its own response contract rather than the workflow one", /allowResponseFields\(\['GET \/workflows\/\{id\}\/preflight'\],'preflight'\)/, /allowResponseFields\(\["GET \/workflows\/\{id\}\/preflight"\], "preflight"\)/],
  ["the preflight contract carries the per-surface readiness detail", /preflight:\['workflowId','requiredTargets','surfaces','ready'\]/, /preflight: \["workflowId", "requiredTargets", "surfaces", "ready"\]/],
  ["a connection response names who provisioned it, so the write stays attributable", /'preferredMode','status','createdBy'/, /"preferredMode", "status", "createdBy"/],
  // The same failure mode on the agent path, where it is worse: an agent that receives a task with
  // no `input`, `expiresAt` or `destination` cannot carry it out, and a claim envelope with no
  // `task`, `grant`, `verify` or `display` breaks execution and both agent interfaces at once.
  // Neither is visible from the control plane's own tests, which assert on identifiers.
  ["an offered task carries the arguments, deadline and destination the agent acts on", /task:\['id','tenantId','runId','stepId','provider','operation','input','status','executionTarget','destination'/, /"provider", "operation", "input", "status", "executionTarget", "destination"/],
  ["the claim envelope has its own response contract rather than the task one", /allowResponseFields\(\['POST \/agent\/tasks\/\{id\}\/claim'\],'claim'\)/, /allowResponseFields\(\["POST \/agent\/tasks\/\{id\}\/claim"\], "claim"\)/],
  ["the claim envelope carries the grant, the verification contract and the display block", /claim:\['task','grant','grantId','runId','stepId','workflowId','claimExpiresAt','verify','executionTarget','destination','display'\]/, /claim: \["task", "grant", "grantId", "runId", "stepId", "workflowId", "claimExpiresAt", "verify", "executionTarget", "destination", "display"\]/],
  ["the agent list keeps the derived organization and the raw last-seen timestamp", /'organizationId','name','status','connectionStatus'/, /"organizationId", "name", "status", "connectionStatus"/],
  ["a customer cannot set its own execution status or plan", /is set by AmazFlow, not from this route/, /is set by AmazFlow, not from this route/],
  ["an internal field is refused by name rather than dropped", /is an internal AmazFlow field and cannot be set by an organization/, /is an internal AmazFlow field and cannot be set by an organization/],
  ["the activation timestamp is derived and never caller-supplied", /activatedAt is derived from the first completed production run/, /activatedAt is derived from the first completed production run/],
  ["a status change is its own audit event carrying previous and new values", /ORG_STATUS_CHANGED/, /ORG_STATUS_CHANGED/],
  ["a slug is reserved permanently, so it is never reused by a later organization", /const slugReservationKey=slug=>`SLUGRESERVED#\$\{slug\}`/, /const slugReservationKey = \(slug\) => `SLUGRESERVED#\$\{slug\}`/],
  ["slug reservation is atomic under concurrent organization creation", /ConditionExpression:'attribute_not_exists\(pk\)'/, /ConditionExpression: "attribute_not_exists\(pk\)"/],
  ["a derived slug is disambiguated against live and retired slugs", /const uniqueSlugFrom=/, /const uniqueSlugFrom = /],
  ["a derived slug retries after losing a concurrent reservation race", /err\.name!=='ConditionalCheckFailedException'/, /err\.name !== "ConditionalCheckFailedException"/],
  ["an explicitly requested slug that is taken is an error rather than a silent rename", /is not available/, /is not available/],

  // 7.5/11.5 -- membership write-side and the role-change route (H-8).
  ["the user list reconciles identity-provider state into membership state", /const state=!u\.Enabled\?'deactivated'/, /const state = !u\.Enabled/],
  ["the user list returns the stored fine-grained role", /platformRole:membership\.role/, /platformRole: membership\.role/],
  ["the user list returns membership team assignments", /teamIds:membership\.teamIds\|\|\[\]/, /teamIds: membership\.teamIds \|\| \[\]/],
  ["the user list reports absent last sign-in honestly", /lastLoginAt:membership\.lastLoginAt\|\|null/, /lastLoginAt: membership\.lastLoginAt \|\| null/],
  ["status changes reconcile the membership record", /status:body\.enabled\?'active':'deactivated'/, /status: body\.enabled \? "active" : "deactivated"/],
  ["the role-change route is exposed", /POST \/tenants\/\{tenantId\}\/users\/\{username\}\/role/, /POST \/tenants\/\{tenantId\}\/users\/\{username\}\/role/],
  ["a role change reconciles the coarse group", /AdminRemoveUserFromGroupCommand/, /AdminRemoveUserFromGroupCommand/],
  ["a role change refuses the staff group", /AmazFlow staff access is not granted through this route/, /AmazFlow staff access is not granted through this route/],
  ["a role change refuses to leave the organization without an owner", /const wouldOrphanOwnership=/, /const wouldOrphanOwnership = /],
  ["a role change is audited with the previous and new role", /TEAM_MEMBER_ROLE_CHANGED/, /TEAM_MEMBER_ROLE_CHANGED/],
  ["the invitation resend route is exposed", /POST \/tenants\/\{tenantId\}\/users\/\{username\}\/invitation\/resend/, /POST \/tenants\/\{tenantId\}\/users\/\{username\}\/invitation\/resend/],
  ["the invitation revoke route is exposed", /DELETE \/tenants\/\{tenantId\}\/users\/\{username\}\/invitation/, /DELETE \/tenants\/\{tenantId\}\/users\/\{username\}\/invitation/],
  ["revoke applies only before the initial password challenge completes", /has already signed in, so this is no longer a pending invitation/, /has already signed in, so this is no longer a pending invitation/],
  ["revoke disables rather than deletes", /INVITATION_REVOKED/, /INVITATION_REVOKED/],

  // 11.9/11.10 -- the invitation record and its single-use acceptance.
  ["only the invitation token's hash is stored", /tokenHash:hashToken\(token\)/, /tokenHash: hashToken\(token\)/],
  ["the invitation token is high-entropy", /crypto\.randomBytes\(32\)\.toString\('base64url'\)/, /crypto\.randomBytes\(32\)\.toString\("base64url"\)/],
  ["the invitation expiry default is seven days", /const INVITATION_TTL_DAYS=7/, /const INVITATION_TTL_DAYS = 7/],
  ["unauthenticated inspection is exposed", /GET \/invitations\/\{token\}/, /GET \/invitations\/\{token\}/],
  ["an expired invitation answers 410 rather than 404", /This invitation has expired\. Ask your AmazFlow contact/, /This invitation has expired/],
  ["an already-accepted invitation answers a state conflict", /already been accepted/, /already been accepted/],
  ["acceptance is exposed", /POST \/invitations\/\{token\}\/accept/, /POST \/invitations\/\{token\}\/accept/],
  ["acceptance is a conditional write on the pending state, so concurrent accepts yield one winner", /attribute_exists\(pk\) AND #state = :pending/, /attribute_exists\(pk\) AND #state = :pending/],
  ["the conditional state alias is supplied to the database", /ExpressionAttributeNames=condition\.names/, /ExpressionAttributeNames = condition\.names/],
  ["the caller's own address must match the invited address", /This invitation was sent to a different email address/, /This invitation was sent to a different email address/],
  ["the accepted membership takes its organization and role from the stored record", /role:invitation\.role/, /role: invitation\.role/],
  ["a resend invalidates the previously issued token", /superseded_by_resend/, /superseded_by_resend/],
  ["invitation inspection and acceptance are rate-limited", /const RATE_LIMITS=\{invitation_inspect/, /const RATE_LIMITS = \{\s*invitation_inspect/],
  ["the rate limit is keyed on the caller rather than on the token", /const callerAddress=/, /const callerAddress = /],
  ["every invitation transition is audited", /INVITATION_ACCEPTED/, /INVITATION_ACCEPTED/],

  // 11.8 -- teams, and the constraint that they grant nothing.
  ["the team routes are exposed", /GET \/teams['"]/, /GET \/teams"/],
  ["team membership is written to the membership record", /const syncTeamMembership=/, /const syncTeamMembership = /],
  ["no grant anywhere depends on a team identifier", /^(?![\s\S]*resource\.teamId)[\s\S]*$/, /^(?![\s\S]*resource\.teamId)[\s\S]*$/],
  ["team changes are audited", /TEAM_CREATED/, /TEAM_CREATED/],

  // 12.1/12.2 -- notifications, and the coupling that keeps them honest.
  ["the eight notification kinds are a closed set", /const NOTIFICATION_KINDS=\['approval_required','run_failed','run_timed_out','agent_offline','connection_error','exception_raised','invitation_accepted','onboarding_step_ready'\]/, /const NOTIFICATION_KINDS = \[\s*"approval_required",\s*"run_failed",\s*"run_timed_out",\s*"agent_offline",\s*"connection_error",\s*"exception_raised",\s*"invitation_accepted",\s*"onboarding_step_ready",?\s*\]/],
  ["a notification can only be created alongside a recorded event", /const logActivity=async\(tenantId,entry,notification\)/, /const logActivity = async \(tenantId, entry, notification\)/],
  ["a notification links back to the event that created it", /eventId:id/, /eventId: id/],
  ["read state is per user and per notification", /const notificationReadKey=\(username,notificationId\)/, /const notificationReadKey = \(username, notificationId\)/],
  ["the notification read is partitioned on the principal's own organization", /tenantRead\('NOTIFICATION#',p\)/, /tenantRead\("NOTIFICATION#", p\)/],
  ["notification delivery filters by user, role, or team audience", /const audienceMatches=audience=>/, /const audienceMatches = \(audience\) =>/],
  ["disabled notification kinds are omitted using stored preferences", /preferences\.values\[`notify\.\$\{n\.kind\}`\]!==false/, /preferences\.values\[`notify\.\$\{n\.kind\}`\] !== false/],
  ["mark-all applies only to notifications visible to that principal", /const items=await notificationsFor\(p,username\)/, /const items = await notificationsFor\(p, username\)/],
  ["the notification routes are exposed", /GET \/notifications['"]/, /GET \/notifications"/],
  ["no email delivery path exists", /^(?![\s\S]*SendEmailCommand[\s\S]{0,200}notification)[\s\S]*$/, /^(?![\s\S]*SendEmailCommand[\s\S]{0,200}notification)[\s\S]*$/],

  // 11.14 -- personal preferences, and 11.16's retention attribute.
  ["the preference key set is an allowlist", /const PREFERENCE_KEYS=/, /const PREFERENCE_KEYS = /],
  ["an unknown preference key is refused rather than dropped", /is not a preference this platform stores/, /is not a preference this platform stores/],
  ["the personal preference routes are exposed", /GET \/me\/preferences/, /GET \/me\/preferences/],
  ["the retention attribute exists without asserting a retention period", /const RETENTION_DAYS=/, /const RETENTION_DAYS = /],
  ["no retention period is asserted by default", /if\(!Number\.isFinite\(days\)\|\|days<=0\)return undefined/, /if \(!Number\.isFinite\(days\) \|\| days <= 0\) return undefined/],

  // 11.7 -- the sign-in timestamp, and 9.22's honest absence.
  ["the sign-in timestamp is recorded on the membership record", /const touchMembershipLogin=/, /const touchMembershipLogin = /],
  ["an unrecorded sign-in is reported as absent rather than as a date", /lastLoginAt:\(meMembership&&meMembership\.lastLoginAt\)\|\|null/, /lastLoginAt: \(meMembership && meMembership\.lastLoginAt\) \|\| null/],

  // Phase 5 -- workflows, the single status model, and the builder. Same standing rule, and the
  // asymmetric risks are worth naming: a copy that admitted `testing` without the edit-or-publish
  // check would let any operator run an unreviewed workflow against real systems; a copy whose publish
  // route did not re-run the connection check would publish a workflow that fails at run time instead
  // of at publish time; and a copy whose draft route still created under a caller-chosen identifier
  // would let a builder plant another organization's workflow id inside its own list. None of the three
  // is visible from the outside until it has already happened.
  ["the workflow status set is a closed four-member enumeration", /const WORKFLOW_STATUSES=\['draft','testing','active','archived'\]/, /const WORKFLOW_STATUSES = \["draft", "testing", "active", "archived"\]/],
  ["the retired status stays readable and is never written again", /const LEGACY_WORKFLOW_STATUSES=\['paused'\]/, /const LEGACY_WORKFLOW_STATUSES = \["paused"\]/],
  ["only active and testing are runnable", /const RUNNABLE_WORKFLOW_STATUSES=\['active','testing'\]/, /const RUNNABLE_WORKFLOW_STATUSES = \["active", "testing"\]/],
  ["the run gate reads the runnable set rather than comparing to one status", /if\(!isRunnableWorkflowStatus\(workflow\.status\)\)/, /if \(!isRunnableWorkflowStatus\(workflow\.status\)\)/],
  ["a testing run is admitted only from a principal who can edit or publish", /const isTestRun=workflow\.status==='testing';/, /const isTestRun = workflow\.status === "testing";/],
  ["a testing run is tagged at creation rather than patched afterwards", /\.\.\.\(flags\.isTest\?\{isTest:true\}:\{\}\)/, /\.\.\.\(flags\.isTest \? \{ isTest: true \} : \{\}\)/],
  ["the retired status is refused by name on the staff write route", /The status "paused" has been retired/, /The status "paused" has been retired/],
  ["the copilot can no longer propose the retired status", /^(?![\s\S]*enum:\['active','paused'\])[\s\S]*$/, /^(?![\s\S]*enum: \["active", "paused"\])[\s\S]*$/],
  ["the draft write route is exposed", /POST \/workflows\/\{id\}\/draft/, /POST \/workflows\/\{id\}\/draft/],
  ["the draft route creates only under a reserved sentinel, never a caller-chosen identifier", /const NEW_WORKFLOW_SENTINEL='new'/, /const NEW_WORKFLOW_SENTINEL = "new"/],
  ["an addressed workflow that is not the caller's own is Not Found", /if\(!creating&&!existing\)return reply\(404,\{error:'Not found'\}\)/, /if \(!creating && !existing\) return reply\(404, \{ error: "Not found" \}\)/],
  ["the draft route cannot publish", /A draft save cannot publish a workflow/, /A draft save cannot publish a workflow/],
  ["a draft is validated before anything is persisted", /const shapeError=validateWorkflowShape\(candidate\);if\(shapeError\)return reply\(422,\{error:shapeError\}\)/, /const shapeError = validateWorkflowShape\(candidate\);\s*if \(shapeError\) return reply\(422, \{ error: shapeError \}\)/],
  ["provider allowlisting is enforced against the definition's own list", /which this workflow does not allow/, /which this workflow does not allow/],
  ["surface-to-action pairing is enforced at save time", /is not an action the \$\{SURFACE_NAME\[surface\]\} can perform/, /is not an action the \$\{SURFACE_NAME\[surface\]\} can perform/],
  ["browser connection fields are refused on a non-browser provider", /can only use browser connection fields with the browser provider/, /can only use browser connection fields with the browser provider/],
  ["the publish route is exposed", /POST \/workflows\/\{id\}\/publish/, /POST \/workflows\/\{id\}\/publish/],
  ["publish re-runs the managed-connection availability check", /const gap=await managedConnectionGapFor\(workflow\)/, /const gap = await managedConnectionGapFor\(workflow\)/],
  ["a managed step with no live connection is refused with a state conflict", /Sign that connection in before publishing/, /Sign that connection in before publishing/],
  ["the unpublish route is exposed and returns the workflow to draft", /POST \/workflows\/\{id\}\/unpublish/, /POST \/workflows\/\{id\}\/unpublish/],
  ["the duplicate route is exposed and produces a draft", /POST \/workflows\/\{id\}\/duplicate/, /POST \/workflows\/\{id\}\/duplicate/],
  ["the archive route is exposed", /POST \/workflows\/\{id\}\/archive/, /POST \/workflows\/\{id\}\/archive/],
  ["every lifecycle transition has its own audit event", /const WORKFLOW_TRANSITION_AUDIT=\{active:'WORKFLOW_PUBLISHED',draft:'WORKFLOW_UNPUBLISHED',archived:'WORKFLOW_ARCHIVED'/, /const WORKFLOW_TRANSITION_AUDIT = \{\s*active: "WORKFLOW_PUBLISHED",\s*draft: "WORKFLOW_UNPUBLISHED",\s*archived: "WORKFLOW_ARCHIVED"/],
  ["a duplication is audited", /WORKFLOW_DUPLICATED/, /WORKFLOW_DUPLICATED/],
  ["every save writes an immutable version record", /const saveWorkflowWithVersion=async workflow=>/, /const saveWorkflowWithVersion = async \(workflow\) =>/],
  ["the version record is keyed by version, so a run's pin stays resolvable", /id:`\$\{next\.id\}_v\$\{String\(next\.version\)\.padStart\(6,'0'\)\}`/, /id: `\$\{next\.id\}_v\$\{String\(next\.version\)\.padStart\(6, "0"\)\}`/],
  ["the filter field set is an allowlist", /const WORKFLOW_FILTER_FIELDS=\['q','status','provider','surface','assignedRole'\]/, /const WORKFLOW_FILTER_FIELDS = \["q", "status", "provider", "surface", "assignedRole"\]/],
  ["an unrecognized filter field is refused rather than ignored", /is not a field this list can be filtered by/, /is not a field this list can be filtered by/],
  ["required execution surfaces are derived from the steps", /const requiredSurfacesFor=workflow=>/, /const requiredSurfacesFor = \(workflow\) =>/],
  ["generation and validation failures are distinguishable", /class GenerationUnavailable extends Error/, /class GenerationUnavailable extends Error/],
  ["an unreachable generator is not reported as an invalid description", /err&&err\.status===503\?503:422/, /err && err\.status === 503 \? 503 : 422/],
  ["a generated candidate is validated again after its identity is imposed", /generatedFromDescription:true/, /generatedFromDescription: true/],
  ["a generated draft is persisted immediately, so it survives a reload", /const saved=await saveWorkflowWithVersion\(candidate\)/, /const saved = await saveWorkflowWithVersion\(candidate\)/],
  ["the generation is audited without recording the description itself", /descriptionLength:body\.sop\.trim\(\)\.length/, /descriptionLength: body\.sop\.trim\(\)\.length/],
  ["generation writes only into the caller's own organization unless the caller is staff", /const targetOrg=p\.isStaff\?String\(body\.tenantId\|\|a\.tenantId\|\|'amazflow'\):p\.orgId/, /const targetOrg = p\.isStaff \? String\(body\.tenantId \|\| a\.tenantId \|\| "amazflow"\) : p\.orgId/],
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

// ------------------------------------------------------------------ origin allowlist coherence ---
//
// Task 9.11's actual requirement, which is not "update the callback URLs" but "a mismatch between the
// callbacks and the cross-origin allowlist must not be able to ship separately". Three lists have to
// agree for a surface to work at all, and each one is silent about the other two:
//
//   * the gateway's CorsConfiguration.AllowOrigins  -- answers the preflight
//   * the handler's ALLOWED_ORIGINS                 -- answers the actual request
//   * the user pool client's CallbackURLs           -- lets the surface sign in
//
// A callback URL whose origin is not allowlisted authenticates and then cannot call the API. An
// allowlisted origin with no callback URL cannot sign in. Neither is visible from the side that has it
// right, so the agreement is asserted here rather than remembered.
console.log("\nORIGIN ALLOWLIST COHERENCE\n");
{
  const template = read("infrastructure/aws-cdk/amazflow-dev.yaml");
  const yamlList = (label) => {
    const block = template.match(new RegExp(`${label}:\\s*\\n((?:\\s*-\\s*'[^']*'\\s*\\n)+)`));
    if (block) return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const inline = template.match(new RegExp(`${label}:\\s*\\[([^\\]]*)\\]`));
    return inline ? [...inline[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  };

  const gatewayOrigins = yamlList("AllowOrigins");
  const handlerOrigins = [
    ...(deployed.match(/const ALLOWED_ORIGINS=\[([^\]]*)\]/) || [, ""])[1].matchAll(/'([^']+)'/g),
  ].map((m) => m[1]);
  const originOf = (url) => {
    try {
      return new URL(url).origin;
    } catch {
      return url;
    }
  };
  const callbackOrigins = [...new Set(yamlList("CallbackURLs").map(originOf))];
  const logoutOrigins = [...new Set(yamlList("LogoutURLs").map(originOf))];

  const same = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

  if (gatewayOrigins.length && same(gatewayOrigins, handlerOrigins)) {
    pass++;
    console.log(
      `  PASS  the gateway and the handler allow the same ${gatewayOrigins.length} origins`,
    );
  } else {
    fail++;
    console.log(
      "  FAIL  the gateway's AllowOrigins and the handler's ALLOWED_ORIGINS disagree\n" +
        `        gateway: ${gatewayOrigins.join(", ") || "(none found)"}\n` +
        `        handler: ${handlerOrigins.join(", ") || "(none found)"}\n` +
        "        The gateway answers the preflight and the handler answers the request. A surface\n" +
        "        present in one and absent from the other fails in a way neither side can see.",
    );
  }

  for (const [label, origins] of [
    ["callback", callbackOrigins],
    ["sign-out", logoutOrigins],
  ]) {
    const stray = origins.filter((origin) => !gatewayOrigins.includes(origin));
    if (stray.length === 0) {
      pass++;
      console.log(
        `  PASS  every ${label} URL's origin is on the cross-origin allowlist (${origins.join(", ")})`,
      );
    } else {
      fail++;
      console.log(
        `  FAIL  these ${label} origins are not on the cross-origin allowlist: ${stray.join(", ")}\n` +
          "        A person would authenticate there and then be unable to call the API. Change the\n" +
          "        callback URLs and the allowlist in the SAME edit (task 9.11 / requirement 1.8).",
      );
    }
  }

  // The three surfaces the design names must each be able to sign in. Otherwise "we added the origin"
  // can pass the checks above while a surface still has no callback URL.
  const surfaces = ["https://app.amazflow.com", "https://admin.amazflow.com", "https://amazflow.com"];
  const missing = surfaces.filter((origin) => !callbackOrigins.includes(origin));
  if (missing.length === 0) {
    pass++;
    console.log("  PASS  all three surfaces have a sign-in callback URL");
  } else {
    fail++;
    console.log(
      `  FAIL  these surfaces have no callback URL, so nobody can sign in to them: ${missing.join(", ")}`,
    );
  }

  // Task 9.12 / requirement 1.11: the legacy paths stay reachable through the deprecation window, and
  // "reachable" includes being able to complete a sign-in redirect. Dropping them from the callback
  // list would sign out everyone mid-session on the old surfaces the day this shipped.
  const legacy = ["https://amazflow.com/app/", "https://amazflow.com/console/"];
  const droppedLegacy = legacy.filter((url) => !yamlList("CallbackURLs").includes(url));
  if (droppedLegacy.length === 0) {
    pass++;
    console.log("  PASS  the legacy /app and /console callback URLs are retained until the cutover");
  } else {
    fail++;
    console.log(
      `  FAIL  these legacy callback URLs were removed before the task 28.4 cutover: ${droppedLegacy.join(", ")}`,
    );
  }
}

// ------------------------------------------------------- no role comparison outside the policy ---
//
// Task 7.4's standing rule, enforced rather than trusted. Every authorization decision comes from the
// permissions policy, so a role string compared anywhere in a handler is by definition a second
// policy -- and a second policy is how the first one becomes wrong. The permissions module itself is
// exempt: comparing a role is precisely its job.
console.log("\nNO ROLE COMPARISON OUTSIDE THE POLICY\n");
{
  // Scoped to the CALLER's own role, which is what the rule is about. Three things deliberately fall
  // outside it, and each is a different kind of not-an-authorization-decision:
  //
  //   * `ctx.userRole` in agentMayRunTask -- the AGENT CREDENTIAL's coarse role. That is requirement
  //     15's capability-aware claiming predicate, the isolating control on a path that has no human
  //     principal at all. It is not the permission policy and must not be routed through it.
  //   * `inviteBody.role === "SUPER_ADMIN"` -- a check on the role being GRANTED, not the role
  //     holding it. Requirement 7.13 asks for exactly this refusal, for every caller.
  //   * a role name inside a user-facing string ("Invited X as a team admin").
  //
  // Hence `\.role` preceded by a principal-ish receiver: that is the caller, and the caller's role is
  // the policy's business alone.
  const ROLE_COMPARISON =
    /\b(?:a|p|principal|session|auth|ctx)\.role\s*(?:!==|===)\s*['"](?:SUPER_ADMIN|CLIENT_ADMIN|FRONTLINE|ORG_OWNER|ORG_ADMIN|WORKFLOW_BUILDER|OPERATOR|APPROVER|VIEWER|STAFF_ADMIN)['"]|['"](?:SUPER_ADMIN|CLIENT_ADMIN|FRONTLINE)['"]\s*(?:!==|===)\s*\b(?:a|p|principal|session)\.role\b/g;
  const handlerOnly = [
    ["amazflow-dev.yaml", deployed],
    ["services/control-plane/src/handler.ts", read("services/control-plane/src/handler.ts")],
    ["services/control-plane/src/browser-connections.ts", read("services/control-plane/src/browser-connections.ts")],
  ];
  for (const [name, source] of handlerOnly) {
    // The policy block is inlined into the deployed template, so its own comparisons live in the same
    // file. Strip the block before checking, using the markers that delimit it.
    const body =
      name === "amazflow-dev.yaml"
        ? source.slice(source.indexOf("const parse=i=>JSON.parse"))
        : source;
    const found = [...body.matchAll(ROLE_COMPARISON)].map((match) => match[0]);
    if (found.length === 0) {
      pass++;
      console.log(`  PASS  ${name} compares no role string`);
    } else {
      fail++;
      console.log(
        `  FAIL  ${name} still compares a role string ${found.length} time(s): ${[...new Set(found)].join(", ")}\n` +
          "        Every authorization decision must come from the permissions policy. Use\n" +
          "        authorizeIn/guardIn with a permission, or a named predicate from the policy module.",
      );
    }
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
