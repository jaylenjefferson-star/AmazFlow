// The one place an authorization decision is made.
//
// Before this module, ~50 route branches each compared a role string inline
// (`if (a.role === 'FRONTLINE') return reply(403, ...)`), which had three consequences worth
// naming, because they are what this module exists to end:
//
//   1. A role's capabilities were not enumerable. Answering "what can a team admin do?" meant
//      reading fifty scattered conditions and hoping none had been missed.
//   2. The organization boundary was re-implemented per route -- eleven times as
//      `role !== 'SUPER_ADMIN' && x !== a.tenantId`, and each of those eleven refused with a
//      DIFFERENT status and message. Seven refused with 403, which leaks record existence across
//      the tenancy boundary (see isolation-baseline.md, D-1/D-2).
//   3. The frontend duplicated the rules to decide what to show, so navigation and enforcement
//      could disagree -- and when they did, the visible one won the argument in a user's head.
//
// So: one decision function, one grant table, deny by default, and a fixed evaluation order that is
// itself the security property.
//
// This module is PURE. No I/O, no clock, no mutation, no environment. `can()` is a total function of
// (principal, permission, resource) and nothing else, which is what makes it exhaustively testable
// against the declared matrix in both directions (Property 2).

/* ============================================================================ roles and groups = */

/**
 * The coarse Cognito group. Authoritative for credentials, enabled state, and the staff/tenant
 * boundary; carried in the token as `cognito:groups`.
 *
 * Design decision D-3: these three stay, unmigrated. `SUPER_ADMIN` is AmazFlow staff and is never a
 * tenant role.
 */
export type CoarseGroup = "FRONTLINE" | "CLIENT_ADMIN" | "SUPER_ADMIN";

/** The fine-grained platform role, resolved from the `MEMBERSHIP#` record. */
export type PlatformRole =
  | "ORG_OWNER"
  | "ORG_ADMIN"
  | "WORKFLOW_BUILDER"
  | "OPERATOR"
  | "APPROVER"
  | "VIEWER"
  | "STAFF_ADMIN";

export const CUSTOMER_ROLES = [
  "ORG_OWNER",
  "ORG_ADMIN",
  "WORKFLOW_BUILDER",
  "OPERATOR",
  "APPROVER",
  "VIEWER",
] as const satisfies readonly PlatformRole[];

export const PLATFORM_ROLES = [...CUSTOMER_ROLES, "STAFF_ADMIN"] as const satisfies readonly PlatformRole[];

/**
 * Which coarse group each platform role maps to.
 *
 * This mapping is load-bearing in two places outside this module, which is why it is a single table
 * rather than a convention: `workflow.assignedRoles` is typed as the COARSE role, and
 * `agentMayRunTask` compares the coarse role on an agent credential. Keeping `APPROVER` mapped to
 * `CLIENT_ADMIN` is what lets approvals keep working with no engine or schema change.
 */
export const COARSE_GROUP_FOR_ROLE: Record<PlatformRole, CoarseGroup> = {
  ORG_OWNER: "CLIENT_ADMIN",
  ORG_ADMIN: "CLIENT_ADMIN",
  WORKFLOW_BUILDER: "CLIENT_ADMIN",
  APPROVER: "CLIENT_ADMIN",
  OPERATOR: "FRONTLINE",
  VIEWER: "FRONTLINE",
  STAFF_ADMIN: "SUPER_ADMIN",
};

export const coarseOf = (role: PlatformRole): CoarseGroup => COARSE_GROUP_FOR_ROLE[role];

/**
 * The staff/tenant boundary, as a named predicate.
 *
 * This is deliberately the ONE place the string `"SUPER_ADMIN"` is compared outside the grant
 * tables. Every route that used to ask `a.role !== "SUPER_ADMIN"` was, in effect, re-deciding the
 * staff boundary on its own -- and eleven of those decisions disagreed about what to do next.
 */
export const isStaffGroup = (group: string): boolean => group === "SUPER_ADMIN";

/**
 * The role a principal gets when it has no `MEMBERSHIP#` record yet.
 *
 * This is the whole reason the restructure can ship without a migration and without changing what
 * any existing user can do. Every account today is described only by its group, so the default has
 * to reproduce exactly the access that group already had:
 *
 *   CLIENT_ADMIN -> ORG_ADMIN   (today's "tenant admin": users, agents, connections, org settings)
 *   FRONTLINE    -> OPERATOR    (today's "team member": run assigned workflows, own runs and tasks)
 *   SUPER_ADMIN  -> STAFF_ADMIN
 *
 * Deliberately NOT `ORG_OWNER` for CLIENT_ADMIN: ownership transfer is a new capability and nobody
 * should acquire it by default. Deliberately NOT `VIEWER` for FRONTLINE: that would REMOVE access a
 * frontline user has today.
 */
export const DEFAULT_ROLE_FOR_GROUP: Record<CoarseGroup, PlatformRole> = {
  CLIENT_ADMIN: "ORG_ADMIN",
  FRONTLINE: "OPERATOR",
  SUPER_ADMIN: "STAFF_ADMIN",
};

export const defaultRoleForGroup = (group: CoarseGroup): PlatformRole =>
  DEFAULT_ROLE_FOR_GROUP[group];

/**
 * Is this fine role reachable from that coarse group?
 *
 * Cognito wins on disagreement (design decision D-3), so a membership record naming a role whose
 * coarse mapping contradicts the token's group cannot be honoured -- the group is the claim that was
 * actually verified. A `FRONTLINE` token carrying a stored `ORG_ADMIN` membership resolves back to
 * the group's default rather than being believed.
 */
export const roleIsReachableFromGroup = (role: PlatformRole, group: CoarseGroup): boolean =>
  COARSE_GROUP_FOR_ROLE[role] === group;

/* ================================================================================ permissions = */

export type CustomerPermission =
  | "workflow:read"
  | "workflow:create"
  | "workflow:edit"
  | "workflow:publish"
  | "workflow:archive"
  | "workflow:run"
  | "run:read"
  | "run:read_all"
  | "run:cancel"
  | "run:confirm"
  | "task:read"
  | "task:resolve"
  | "approval:read"
  | "approval:decide"
  | "exception:read"
  | "exception:resume"
  | "agent:read"
  | "agent:authorize"
  | "agent:revoke"
  | "connection:read"
  | "connection:manage"
  | "secret:reference"
  | "secret:manage"
  | "org:read"
  | "org:settings"
  | "org:branding"
  | "org:transfer_ownership"
  | "user:read"
  | "user:invite"
  | "user:set_status"
  | "user:set_role"
  | "team:read"
  | "team:manage"
  | "audit:read"
  | "analytics:read"
  | "notification:read"
  | "support:read"
  | "support:create";

/**
 * The internal namespace. Unreachable for every customer role by construction -- step 3 of `can()`
 * refuses anything in this namespace before consulting a grant table, so a future editing mistake
 * that adds an `internal:` string to a customer row still cannot grant it.
 */
export type InternalPermission =
  | "internal:organization_manage"
  | "internal:platform_settings"
  | "internal:copilot"
  | "internal:audit_read_all"
  | "internal:ai_execute"
  | "internal:executor_diagnostic"
  | "internal:lead_read"
  | "internal:workflow_author"
  | "internal:support_manage"
  | "internal:session_revoke"
  | "internal:tenant_summary_any";

export type Permission = CustomerPermission | InternalPermission;

const CUSTOMER_PERMISSIONS: readonly CustomerPermission[] = [
  "workflow:read", "workflow:create", "workflow:edit", "workflow:publish", "workflow:archive",
  "workflow:run",
  "run:read", "run:read_all", "run:cancel", "run:confirm",
  "task:read", "task:resolve",
  "approval:read", "approval:decide",
  "exception:read", "exception:resume",
  "agent:read", "agent:authorize", "agent:revoke",
  "connection:read", "connection:manage",
  "secret:reference", "secret:manage",
  "org:read", "org:settings", "org:branding", "org:transfer_ownership",
  "user:read", "user:invite", "user:set_status", "user:set_role",
  "team:read", "team:manage",
  "audit:read", "analytics:read", "notification:read",
  "support:read", "support:create",
];

const INTERNAL_PERMISSIONS: readonly InternalPermission[] = [
  "internal:organization_manage",
  "internal:platform_settings",
  "internal:copilot",
  "internal:audit_read_all",
  "internal:ai_execute",
  "internal:executor_diagnostic",
  "internal:lead_read",
  "internal:workflow_author",
  "internal:support_manage",
  "internal:session_revoke",
  "internal:tenant_summary_any",
];

export const PERMISSIONS: readonly Permission[] = [
  ...CUSTOMER_PERMISSIONS,
  ...INTERNAL_PERMISSIONS,
];

export const isInternalPermission = (permission: string): boolean =>
  permission.startsWith("internal:");

/* ===================================================================================== grants = */

/**
 * Role grants as a keyed collection of permission sets (requirement 7.18).
 *
 * The shape is the extensibility story: a custom role is the same shape under a different key, and
 * `can()` does not change to accommodate one. It reads `ROLE_GRANTS[principal.role]` and asks the
 * set a question -- it does not know how many keys exist.
 *
 * This table IS the permission matrix in design.md. It is asserted against that document's rows in
 * both directions by Property 2, so a divergence between the code and the document fails the build
 * rather than becoming folklore.
 */
export const ROLE_GRANTS: Record<PlatformRole, ReadonlySet<Permission>> = {
  // Everything in the organization, plus ownership transfer. The only role holding
  // `org:transfer_ownership`.
  ORG_OWNER: new Set<Permission>([
    "workflow:read", "workflow:create", "workflow:edit", "workflow:publish", "workflow:archive",
    "workflow:run",
    "run:read", "run:read_all", "run:cancel", "run:confirm",
    "task:read", "task:resolve",
    "approval:read", "approval:decide",
    "exception:read", "exception:resume",
    "agent:read", "agent:authorize", "agent:revoke",
    "connection:read", "connection:manage",
    "secret:reference", "secret:manage",
    "org:read", "org:settings", "org:branding", "org:transfer_ownership",
    "user:read", "user:invite", "user:set_status", "user:set_role",
    "team:read", "team:manage",
    "audit:read", "analytics:read", "notification:read",
    "support:read", "support:create",
  ]),

  // ORG_ADMIN is the default for every existing CLIENT_ADMIN account, so its row is exactly
  // ORG_OWNER's minus ownership transfer. Nothing an existing team admin can do today is absent.
  ORG_ADMIN: new Set<Permission>([
    "workflow:read", "workflow:create", "workflow:edit", "workflow:publish", "workflow:archive",
    "workflow:run",
    "run:read", "run:read_all", "run:cancel", "run:confirm",
    "task:read", "task:resolve",
    "approval:read", "approval:decide",
    "exception:read", "exception:resume",
    "agent:read", "agent:authorize", "agent:revoke",
    "connection:read", "connection:manage",
    "secret:reference", "secret:manage",
    "org:read", "org:settings", "org:branding",
    "user:read", "user:invite", "user:set_status", "user:set_role",
    "team:read", "team:manage",
    "audit:read", "analytics:read", "notification:read",
    "support:read", "support:create",
  ]),

  // Authors and edits drafts. NOT `workflow:publish` -- open question Q-1 is held at its
  // conservative answer (publishing stays a staff act) precisely because the reverse is the
  // unrecoverable direction: a builder who can publish can put a live workflow in front of a
  // customer's real systems, and granting that later is cheap while ungranting it is not.
  WORKFLOW_BUILDER: new Set<Permission>([
    "workflow:read", "workflow:create", "workflow:edit", "workflow:archive", "workflow:run",
    "run:read", "run:read_all", "run:cancel", "run:confirm",
    "exception:read", "exception:resume",
    "agent:read",
    "connection:read",
    "secret:reference",
    "org:read",
    "analytics:read", "notification:read",
    "support:read", "support:create",
  ]),

  // The default for every existing FRONTLINE account. Holds the NARROW forms only: `run:read`
  // without `run:read_all`, which is what step 5 reads to narrow it to its own records.
  OPERATOR: new Set<Permission>([
    "workflow:read", "workflow:run",
    "run:read", "run:cancel", "run:confirm",
    "task:read", "task:resolve",
    "exception:read",
    "org:read",
    "notification:read",
    "support:read", "support:create",
  ]),

  // Decides approvals; reads runs in scope. Cannot edit a workflow and cannot start one.
  APPROVER: new Set<Permission>([
    "workflow:read",
    "run:read", "run:read_all",
    "approval:read", "approval:decide",
    "exception:read",
    "org:read",
    "analytics:read", "notification:read",
    "support:read", "support:create",
  ]),

  // Read-only, including audit. Deliberately holds `run:read_all` -- a viewer sees the whole
  // organization's runs, it just cannot act on any of them.
  VIEWER: new Set<Permission>([
    "workflow:read",
    "run:read", "run:read_all",
    "approval:read",
    "exception:read",
    "agent:read",
    "connection:read",
    "org:read",
    "user:read",
    "team:read",
    "audit:read", "analytics:read", "notification:read",
    "support:read", "support:create",
  ]),

  // Staff. Never reached through ROLE_GRANTS in practice -- step 2 of `can()` short-circuits on
  // `isStaff` and consults STAFF_GRANTS instead. The key exists so the table is total over
  // PlatformRole and a lookup can never be undefined.
  STAFF_ADMIN: new Set<Permission>(),
};

/**
 * What staff hold.
 *
 * Enumerated rather than "staff can do anything", because an unenumerated superuser is exactly the
 * thing nobody can review. Staff writes into a customer's organization stay listable, and the
 * omissions are deliberate: staff hold no `org:transfer_ownership` (ownership is the customer's) and
 * no `support:create` (a staff member manages tickets, they do not file them as a customer).
 */
export const STAFF_GRANTS: ReadonlySet<Permission> = new Set<Permission>([
  ...INTERNAL_PERMISSIONS,
  "workflow:read", "workflow:create", "workflow:edit", "workflow:publish", "workflow:archive",
  "workflow:run",
  "run:read", "run:read_all", "run:cancel", "run:confirm",
  "task:read", "task:resolve",
  "approval:read", "approval:decide",
  "exception:read", "exception:resume",
  "agent:read", "agent:authorize", "agent:revoke",
  "connection:read", "connection:manage",
  "secret:reference", "secret:manage",
  "org:read", "org:settings", "org:branding",
  "user:read", "user:invite", "user:set_status", "user:set_role",
  "team:read", "team:manage",
  "audit:read", "analytics:read", "notification:read",
  "support:read",
]);

/**
 * The broad form of a narrowable permission.
 *
 * There is exactly one broad form, and that is not an accident: `run:read_all` means "see records
 * belonging to other people in this organization", and every narrowable permission is narrowable for
 * the same reason -- the role can act, but only on what is its own. OPERATOR is the only role
 * lacking `run:read_all`, which is why OPERATOR is the only "own" column in the matrix.
 */
export const BROAD_FORM: Partial<Record<Permission, Permission>> = {
  "run:read": "run:read_all",
  "run:cancel": "run:read_all",
  "run:confirm": "run:read_all",
  "task:read": "run:read_all",
  "task:resolve": "run:read_all",
  "exception:read": "run:read_all",
};

export const broadForm = (permission: Permission): Permission | undefined =>
  BROAD_FORM[permission];

/**
 * Two rules that hold for every customer role regardless of grants, kept as named predicates so the
 * routes that enforce them read as statements of the rule rather than as role comparisons.
 *
 * `maxConcurrentRuns` is never settable by a customer: an organization that can raise its own
 * ceiling has no ceiling, and the ceiling exists to bound the blast radius of a runaway workflow
 * against a customer's real systems.
 */
export const maySetConcurrencyLimit = (principal: Principal): boolean => principal.isStaff;

/** `SUPER_ADMIN` is never invitable, by anyone, including staff. */
export const INVITABLE_GROUPS: readonly CoarseGroup[] = ["CLIENT_ADMIN", "FRONTLINE"];
export const isInvitableGroup = (group: string): boolean =>
  (INVITABLE_GROUPS as readonly string[]).includes(group);

/* ================================================================================== principal = */

/**
 * Who is asking.
 *
 * `orgId` has exactly one source -- the verified `custom:tenant_id` claim -- and is not optional.
 * A token without it yields no principal at all rather than a principal with a hole in it, because
 * every check here is a positive test and a hole would pass the ones written as `!==`.
 */
export type Principal = {
  kind: "user";
  userId: string;
  orgId: string;
  group: CoarseGroup;
  role: PlatformRole;
  teamIds: string[];
  isStaff: boolean;
  /**
   * Set when a staff member is acting as a customer user. Reserved by requirement 6.11's sibling:
   * the field exists now so that an audit record can name the human behind an impersonated action
   * from the day impersonation ships, rather than the feature arriving and the audit trail not
   * having a place to put them.
   */
  impersonatorUserId?: string;
};

/**
 * The agent execution path's principal.
 *
 * This is the honest name for something that already existed and was hidden: the agent routes
 * synthesize `{ role: 'SUPER_ADMIN', tenantId: agentCtx.tenantId }` to read across organizations
 * before filtering. That is a real privilege elevation, and writing it as a staff user principal
 * made it invisible -- it looked like a staff request in every log and every check.
 *
 * As its own type it is (a) greppable, (b) impossible to pass to a human-facing route that expects a
 * `Principal`, and (c) forced to declare that its isolating control is the capability-aware claiming
 * predicate rather than a partition key.
 */
export type AgentPrincipal = {
  kind: "agent";
  agentId: string;
  orgId: string;
  agentType: string;
  capabilities: string[];
  /** Never true. Present so a check written as `p.isStaff` cannot accidentally admit an agent. */
  isStaff: false;
};

export const isAgentPrincipal = (p: Principal | AgentPrincipal): p is AgentPrincipal =>
  p.kind === "agent";

export const isUserPrincipal = (p: Principal | AgentPrincipal): p is Principal =>
  p.kind === "user";

/**
 * Build a principal from VERIFIED claims. Throws rather than defaulting.
 *
 * The throwing is the point. The previous behaviour defaulted a missing `custom:tenant_id` to
 * `"amazflow"` -- the staff tenant -- so an account created without the claim silently became a
 * member of AmazFlow's own organization and was served AmazFlow's own data. A default here cannot be
 * safe, because there is no organization that is a safe guess.
 *
 * @param claims the JWT authorizer's already-verified claim bag
 * @param membershipRole the role from the `MEMBERSHIP#` record, when one exists
 */
export function principalFromClaims(
  claims: Record<string, unknown>,
  membershipRole?: PlatformRole | null,
): Principal {
  const orgId = typeof claims["custom:tenant_id"] === "string" ? claims["custom:tenant_id"].trim() : "";
  if (!orgId)
    throw new PrincipalError(
      "This account is not attached to an organization.",
      "NO_ORGANIZATION",
    );

  const group = groupFromClaims(claims);
  if (!group) throw new PrincipalError("Role required", "NO_ROLE");

  // Cognito wins on disagreement (design decision D-3): the group was verified, the membership
  // record was merely stored. A membership naming a role that its group cannot reach is stale or
  // wrong, and falling back to the group's default is the reading that cannot over-grant.
  const role =
    membershipRole && roleIsReachableFromGroup(membershipRole, group)
      ? membershipRole
      : defaultRoleForGroup(group);

  return {
    kind: "user",
    userId: typeof claims.sub === "string" ? claims.sub : "",
    orgId,
    group,
    role,
    teamIds: [],
    isStaff: group === "SUPER_ADMIN",
  };
}

export class PrincipalError extends Error {
  code: "NO_ORGANIZATION" | "NO_ROLE";
  constructor(message: string, code: "NO_ORGANIZATION" | "NO_ROLE") {
    super(message);
    this.code = code;
  }
}

/**
 * API Gateway's JWT authorizer forwards `cognito:groups` as the literal string "[A, B]" -- brackets
 * as characters, not a JSON array and not a clean comma list. Parsed in one place so the next reader
 * of this claim does not have to rediscover that.
 */
export function groupFromClaims(claims: Record<string, unknown>): CoarseGroup | null {
  const raw = String(claims["cognito:groups"] ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((value) => value.trim());
  // Ordered most-privileged-first so a token in several groups resolves deterministically, which
  // matters because the group decides the staff/tenant boundary.
  return (["SUPER_ADMIN", "CLIENT_ADMIN", "FRONTLINE"] as const).find((g) => raw.includes(g)) ?? null;
}

/* =================================================================================== decision = */

export type Resource = {
  /** Always from a record loaded server-side, never from the request body. */
  orgId: string;
  /** For own-record narrowing. */
  ownerUserId?: string;
  /** Coarse roles a workflow is assigned to, preserving the engine's existing rule. */
  assignedRoles?: string[];
  teamId?: string;
};

export type DecisionCode = "FORBIDDEN" | "WRONG_ORG" | "NOT_ASSIGNED";

/**
 * A wrong-organization denial answers 404, not 403.
 *
 * The single most consequential mapping in the module. `403 "Run belongs to another tenant"` is an
 * existence oracle: it distinguishes "this id exists in another organization" from "this id does not
 * exist", which is exactly the distinction the tenancy boundary exists to hide. Thirteen routes
 * leaked that (isolation-baseline.md D-1 and D-2), each having independently chosen 403 because "not
 * allowed" felt like the honest answer. It is the wrong kind of honest.
 */
export const statusForDecision = (code: DecisionCode): number => (code === "WRONG_ORG" ? 404 : 403);

/** And the message must not name the record type either, for the same reason. */
export const messageForDecision = (decision: { code: DecisionCode; reason: string }): string =>
  decision.code === "WRONG_ORG" ? "Not found" : decision.reason;

export type Decision =
  | { allow: true }
  | { allow: false; reason: string; code: DecisionCode };

const ALLOW: Decision = { allow: true };
const deny = (code: DecisionCode, reason: string): Decision => ({ allow: false, reason, code });

/**
 * The single authorization entry point, used by the API and by navigation.
 *
 * Preconditions:
 *   - `principal` was built by `principalFromClaims` from a verified JWT.
 *   - `resource.orgId` came from a record loaded server-side, never from the request body.
 * Postconditions:
 *   - Deny unless an explicit grant exists.
 *   - Cross-organization is denied for every non-staff principal regardless of permission.
 *   - `internal:*` is unreachable for every customer role.
 *   - Pure and total: same inputs, same decision, always.
 *
 * The ORDER of the six steps below is a security property, not a style choice. Step 1 runs before
 * every grant lookup so that no grant -- present, future, or mistakenly added -- can be consulted
 * for a resource outside the principal's own organization. Inverting steps 1 and 4 would produce a
 * policy that is correct for today's table and silently wrong for tomorrow's.
 */
export function can(principal: Principal, permission: Permission, resource: Resource): Decision {
  // 1. Organization boundary. Nothing below can override it for a non-staff principal.
  if (!principal.isStaff && resource.orgId !== principal.orgId)
    return deny("WRONG_ORG", "That belongs to another organization");

  // 2. Staff scope, enumerated rather than absolute.
  if (principal.isStaff)
    return STAFF_GRANTS.has(permission)
      ? ALLOW
      : deny("FORBIDDEN", `Staff hold no ${permission}`);

  // 3. The internal namespace is unreachable for any customer role, by construction -- checked
  //    before the grant table so a mis-edited customer row still cannot open it.
  if (isInternalPermission(permission))
    return deny("FORBIDDEN", "That is an AmazFlow-internal capability");

  // 4. Role grant. Deny by default: absence of a grant is a denial, not a question.
  const grants = ROLE_GRANTS[principal.role];
  if (!grants || !grants.has(permission))
    return deny("FORBIDDEN", `Your role does not include ${permission}`);

  // 5. Own-record narrowing: a role holding the narrow form but not the broad one may only touch
  //    what is its own.
  if (resource.ownerUserId !== undefined) {
    const broad = broadForm(permission);
    if (broad && !grants.has(broad) && resource.ownerUserId !== principal.userId)
      return deny("FORBIDDEN", "That record belongs to someone else");
  }

  // 6. Workflow assignment, preserving the engine's existing rule exactly.
  if (
    permission === "workflow:run" &&
    resource.assignedRoles !== undefined &&
    !resource.assignedRoles.includes(coarseOf(principal.role))
  )
    return deny("NOT_ASSIGNED", "This workflow is not assigned to your role");

  return ALLOW;
}

/**
 * Throwing wrapper for route handlers.
 *
 * Throws a shape the handler's existing `catch` already understands (`{ status, message, code }`),
 * so adopting it does not require rewriting error handling. `onDeny` is how the
 * `AUTHORIZATION_DENIED` audit event and metric get emitted without this module doing I/O -- the
 * caller supplies the effect, the policy stays pure.
 */
export function authorize(
  principal: Principal,
  permission: Permission,
  resource: Resource,
  onDeny?: (info: { permission: Permission; resource: Resource; code: DecisionCode; reason: string }) => void,
): void {
  const decision = can(principal, permission, resource);
  if (decision.allow) return;
  onDeny?.({ permission, resource, code: decision.code, reason: decision.reason });
  throw new AuthorizationError(decision.code, decision.reason, permission);
}

export class AuthorizationError extends Error {
  code: DecisionCode;
  permission: Permission;
  /**
   * A wrong-organization denial answers 404, not 403.
   *
   * This is the single most consequential line in the module. `403 "Run belongs to another tenant"`
   * is an existence oracle: it distinguishes "this id exists in another organization" from "this id
   * does not exist", which is exactly the distinction the tenancy boundary is supposed to hide. Seven
   * routes leaked that (isolation-baseline.md D-1/D-2), each having independently chosen 403 because
   * "not allowed" felt like the honest answer. It is the wrong kind of honest.
   */
  status: number;
  constructor(code: DecisionCode, reason: string, permission: Permission) {
    super(code === "WRONG_ORG" ? "Not found" : reason);
    this.code = code;
    this.permission = permission;
    this.status = code === "WRONG_ORG" ? 404 : 403;
  }
}

/* ================================================================================= navigation = */

export type SectionId =
  | "home"
  | "workflows"
  | "runs"
  | "tasks"
  | "approvals"
  | "exceptions"
  | "agents"
  | "connections"
  | "team"
  | "audit"
  | "analytics"
  | "settings"
  | "support"
  | "account"
  | "internal:organizations"
  | "internal:customers"
  | "internal:studio"
  | "internal:copilot"
  | "internal:activity"
  | "internal:platform_settings"
  | "internal:leads";

/**
 * Which permission each navigation section requires.
 *
 * Navigation is derived from the same table the API enforces (requirement 7.17), which closes the
 * gap that made the frontend's copy of the rules dangerous: a section can no longer be offered to
 * someone the API will refuse, because the same `can()` call decides both. `home`, `support` and
 * `account` require nothing -- everyone signed in has a home, can ask for help, and has an account.
 */
export const SECTION_PERMISSION: Record<SectionId, Permission | null> = {
  home: null,
  support: null,
  account: null,
  workflows: "workflow:read",
  runs: "run:read",
  tasks: "task:read",
  approvals: "approval:read",
  exceptions: "exception:read",
  agents: "agent:read",
  connections: "connection:read",
  team: "user:read",
  audit: "audit:read",
  analytics: "analytics:read",
  settings: "org:settings",
  "internal:organizations": "internal:organization_manage",
  "internal:customers": "internal:organization_manage",
  "internal:studio": "internal:workflow_author",
  "internal:copilot": "internal:copilot",
  "internal:activity": "internal:audit_read_all",
  "internal:platform_settings": "internal:platform_settings",
  "internal:leads": "internal:lead_read",
};

const SECTION_ORDER = Object.keys(SECTION_PERMISSION) as SectionId[];

/**
 * Drives the sidebar. Same policy, no duplicated frontend logic.
 *
 * Evaluated against the principal's OWN organization, because navigation is a question about what
 * this person can do in their own workspace. Own-record narrowing does not apply -- a section is
 * visible when the role could act on something, and which somethings is the API's answer to give.
 */
export function visibleSections(principal: Principal): SectionId[] {
  const ownOrg: Resource = { orgId: principal.orgId };
  return SECTION_ORDER.filter((section) => {
    const permission = SECTION_PERMISSION[section];
    if (permission === null) return true;
    return can(principal, permission, ownOrg).allow;
  });
}

/**
 * The matrix as data, for `GET /permissions/matrix` and the `/admin/roles` screen (task 7.13).
 *
 * Serialized from the same `ROLE_GRANTS` the API enforces, so the screen cannot show a policy that
 * is not the policy. `"own"` is reported rather than a bare `true` where the role holds the narrow
 * form only, because "you can cancel runs" and "you can cancel your own runs" are different
 * promises to make to a user.
 */
export function permissionMatrix(): {
  roles: PlatformRole[];
  permissions: Permission[];
  grants: Record<string, Record<string, boolean | "own">>;
} {
  const grants: Record<string, Record<string, boolean | "own">> = {};
  for (const role of PLATFORM_ROLES) {
    const held = role === "STAFF_ADMIN" ? STAFF_GRANTS : ROLE_GRANTS[role];
    const row: Record<string, boolean | "own">= {};
    for (const permission of PERMISSIONS) {
      if (!held.has(permission)) {
        row[permission] = false;
        continue;
      }
      const broad = broadForm(permission);
      row[permission] = broad && !held.has(broad) ? "own" : true;
    }
    grants[role] = row;
  }
  return { roles: [...PLATFORM_ROLES], permissions: [...PERMISSIONS], grants };
}
