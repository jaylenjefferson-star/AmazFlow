# Requirements Document

## Introduction

AmazFlow is a working multi-tenant workflow execution platform — a deterministic engine, signed
single-use execution grants, single-winner task leases, capability-aware agent claiming, independent
verification of agent-reported results, evidence capture, and an audit trail — sitting beneath a
fragmented set of user interfaces. This document specifies the requirements for the **platform
restructure**: three coherent surfaces (public marketing site, one customer application, one
separately-hosted internal staff console) built on the existing engine, database, identity provider,
and hosting; plus the organization, onboarding, CRM, authorization, and honesty work the platform needs.

These requirements are derived from the approved design document (`design.md`) in this directory. The
design records a factual Phase-0 inspection of the repository, and this document does not reintroduce
assumptions that inspection disproved. In particular:

- The frontend is a **static export**, so no client-side route separation is a security boundary. All
  authorization requirements below are stated as **server-side** requirements (design decision D-2).
- Persisted **run status** and **workflow status** values are the source of truth and are not renamed;
  presentation-layer relabelling is specified instead (D-5, D-6).
- **Cognito groups are retained** as the coarse claim, with fine-grained roles layered on top of a new
  membership record rather than migrated into Cognito (D-3).
- Two divergent copies of the control plane exist; convergence is a stated prerequisite rather than an
  assumption (D-1).
- The existing execution semantics are **preserved verbatim**; no requirement below may be satisfied by
  changing them.

Ten questions the design could not resolve without a business or operational decision are recorded in
**Deferred Decisions and Assumptions** at the end of this document. They are not resolved by guessing.
Where a deferred decision affects an acceptance criterion, the criterion is stated under the design's
current conservative assumption and flagged.

---

## Glossary

Terms are defined as the existing code uses them, not as they are colloquially used.

**Platform and tenancy**

- **Organization**: The customer account entity, persisted at `pk = PLATFORM`, `sk = ORG#{slug}`. Carries
  name, slug, execution status, plan, branding, settings, contacts, and lifecycle state.
- **Slug**: The URL-safe organization identifier, constrained to `[a-z0-9-]`. **The slug IS the tenant
  id.** It is the value of every `custom:tenant_id` Cognito claim and the suffix of every `TENANT#`
  partition key. It is immutable; renaming it would orphan a tenant's entire dataset.
- **Tenant / tenantId**: Synonym for the organization's slug when used as a data-partition key
  (`pk = TENANT#{slug}`) or an identity claim.
- **Organization context**: The `orgId` a request operates within. Derived exclusively from the
  authenticated session's `custom:tenant_id` claim, never from a request body, path, or query.
- **Membership**: A new persisted record (`pk = TENANT#{orgId}`, `sk = MEMBERSHIP#{cognitoUsername}`)
  that is the source of truth for a user's fine-grained platform role, team assignments, invitation and
  activation timestamps, and last-login time. Cognito remains authoritative for credentials, the
  enabled/disabled flag, and the coarse group.
- **Team**: An organizational grouping and notification audience within an organization
  (`sk = TEAM#{teamId}`). **Not** a permission boundary in this release.
- **Coarse group**: One of the three Cognito groups — `FRONTLINE`, `CLIENT_ADMIN`, `SUPER_ADMIN`.
  `SUPER_ADMIN` denotes AmazFlow staff and is never a customer-assignable role.
- **Platform role**: One of the six fine-grained customer roles — `ORG_OWNER`, `ORG_ADMIN`,
  `WORKFLOW_BUILDER`, `OPERATOR`, `APPROVER`, `VIEWER` — plus the internal `STAFF_ADMIN`. Each maps to
  exactly one coarse group.
- **Principal**: The server-side authorization subject built from verified JWT claims plus the
  membership record: `{ userId, orgId, group, role, teamIds, isStaff }`.

**Execution**

- **Execution surface**: The class of agent that performs a step's real-world action. Exactly two exist:
  `browser_extension` (agent type `CHROME_EXTENSION`) and `desktop_agent` (agent type `DESKTOP_AGENT`).
  A step's surface is **derived from its provider**, and the set of surfaces a workflow requires is
  derived from its steps, so it cannot drift from the definition.
- **Agent**: A registered installation of an execution surface (`sk = AGENT#{id}`), carrying `agentType`,
  `platform`, `version`, advertised `capabilities`, granted operating-system `permissions` (desktop), and
  `lastSeenAt` / `lastHeartbeatAt`.
- **Heartbeat**: A `POST /agent/heartbeat` call made by a connected agent every two minutes. Agent
  connectivity status is **derived** from heartbeat recency; no independently stored online flag exists.
- **Capability-aware claiming**: The server-side predicate that admits an agent to a task only when the
  tenant matches, the task's target maps to the agent's type, the agent's advertised capabilities include
  the task's operation, the caller's role is in the task's assigned roles, and a `FRONTLINE` caller only
  sees tasks from runs they created.
- **Task lease**: A single-winner claim on an agent task (`pk = TASKCLAIM`,
  `sk = TASKCLAIM#{taskId}`), taken by a conditional write on "no existing lease OR the lease has
  expired". Self-healing: an expired lease may be taken over, and a sweep returns stalled work to the
  pool, so a dead agent never permanently strands a run.
- **Execution grant**: A signed, minutes-lived, single-use-per-tool capability token of the form
  `v1.{payload}.{HMAC-SHA256}` binding run, tenant, workflow, workflow version, step, task, agent, agent
  type, execution target, action type, destination, and confirmation state. Verification re-checks every
  bound field against records loaded server-side and consumes a per-tool replay marker.
- **Independent verification**: The engine re-testing a step's declared verification contract against
  what the agent reported. A self-declared success that does not hold up becomes `VERIFICATION_FAILED`
  and does **not** advance the run.
- **Evidence**: The per-step record of what actually happened —
  `{ taskId, agentId, grantId, claimedAt, reportedAt, page, verified, expected, actual }`.
- **Preflight**: A pre-run readiness check that refuses to start a run whose required execution surface
  is not currently connected, rather than allowing the run to be created and then time out.
- **Run status** (persisted, authoritative): `RUNNING`, `AWAITING_CONFIRMATION`, `WAITING_AGENT`,
  `WAITING_APPROVAL`, `CANCELLED`, `TIMED_OUT`, `COMPLETED`, `FAILED`. The live set used for the
  concurrency ceiling is the positive list `RUNNING`, `WAITING_AGENT`, `WAITING_APPROVAL`,
  `AWAITING_CONFIRMATION`, so an unrecognised status fails open. There is **no** `QUEUED` status: a run
  is `RUNNING` from creation.
- **Workflow status** (persisted, authoritative): `draft`, `testing`, `active`, `archived`, where
  `active` is the wire value meaning **Published** and is the only value the run gate admits. Legacy
  `paused` records display as Archived and are never written again.
- **Exception**: A run in `FAILED` or `TIMED_OUT`, classified by **derived** cause —
  `SYSTEM_FAILURE`, `INTEGRATION_FAILURE`, `MISSING_INFORMATION`, `AMBIGUOUS_RECORD`, `HUMAN_REVIEW`,
  `POLICY_CONFLICT`, `AGENT_UNAVAILABLE`, `CREDENTIAL_PROBLEM`. Never separately stored.
- **Unsafe to retry**: A derived flag set where a side effect could not be ruled out (verification
  failure, action reconciliation required). Such a run may not be offered a retry.

**Organization state**

- **Execution status** (`organization.status`): Customer-visible, three values —
  `active`, `paused`, `suspended`. Answers "may work execute right now?" and is enforced at run creation.
- **Lifecycle status** (`organization.lifecycleStatus`): Internal-only, six values — `prospect`,
  `onboarding`, `trial`, `active`, `suspended`, `canceled`. Answers "where is this account
  commercially?" and is never rendered on a customer surface.
- **Onboarding state**: A normalized platform-owned status —
  `PROSPECT`, `CLOSED_WON`, `SETUP_REQUIRED`, `ONBOARDING`, `CONFIGURATION`, `TESTING`,
  `READY_FOR_LAUNCH`, `ACTIVE`, `PAUSED`, `CHURNED` — held in one onboarding record per organization,
  together with derived milestone timestamps and a checklist.
- **CRM mapping**: The adapter-owned table translating a CRM provider's raw sales-stage **label** into an
  onboarding state. Owned by the CRM adapter, not by the domain, so renaming a CRM board column cannot
  change platform behaviour. An unrecognised label maps to nothing and is logged as unmapped.
- **CRM link**: The one-to-one binding between a CRM item and an AmazFlow organization
  (`pk = CRMLINK`, `sk = CRMLINK#{provider}#{itemId}`), written conditionally so that concurrent or
  repeated processing cannot produce two organizations for one CRM item.
- **Milestone**: An onboarding timestamp derived from a real observed event and written once
  (first-write-wins), never set manually to make progress look better than it is.

**Cross-cutting**

- **Permission**: A named capability string (e.g. `workflow:publish`, `run:cancel`, `internal:*`)
  evaluated by the single centralized policy module. No role string is compared anywhere else.
- **Correlation id**: A per-request identifier propagated into every structured log line, every audit
  event, and every error response, and rendered to users as a support-referenceable error code.
- **Honesty classification**: The mandatory per-page state — **FUNCTIONAL**, **INTENTIONALLY DISABLED**
  (with a stated reason), or **REMOVED**. No page may present a control that does nothing.

---

## Requirements

### Requirement 1: Three-surface restructure and hosting topology

**User Story:** As a platform stakeholder, I want the platform served as three distinct surfaces — a
public marketing site, one cohesive customer application, and a separately-hosted internal staff
console — so that customers and staff use purpose-built interfaces instead of two overlapping consoles.

#### Acceptance Criteria

1. THE Platform SHALL serve public marketing content, the legal document set, the product demo, and the
   authentication pages from the `amazflow.com` origin.
2. THE Platform SHALL serve the customer application from the `app.amazflow.com` origin.
3. THE Platform SHALL serve the internal staff console from the `admin.amazflow.com` origin.
4. THE Platform SHALL build all three surfaces from the single existing monorepo using the existing
   multi-application hosting configuration form.
5. THE Platform SHALL retain static export as the frontend build output for all three surfaces.
6. WHEN a user performs a hard reload or direct navigation to any deep link on any of the three surfaces,
   THE Platform SHALL serve the corresponding application shell and resolve the requested route.
7. THE Platform SHALL store the deep-link rewrite configuration for each surface in version-controlled
   infrastructure files.
8. THE Control_Plane SHALL respond to cross-origin requests with an `access-control-allow-origin` header
   naming exactly one requesting origin drawn from an allowlist of the three surface origins.
9. IF a cross-origin request originates from an origin outside the allowlist, THEN THE Control_Plane
   SHALL omit the requesting origin from the `access-control-allow-origin` response header.
10. THE Control_Plane SHALL accept the `GET`, `POST`, `PUT`, `DELETE`, and `OPTIONS` methods at the API
    gateway for the routes that use them.
11. WHERE a route was reachable on the previous `/app` or `/console` paths, THE Platform SHALL keep that
    route functional until the replacement route on the new surface is live and a deprecation window has
    elapsed.

### Requirement 2: Server-side authorization boundary for the internal surface

**User Story:** As a security owner, I want the internal staff surface protected by the control plane
rather than by which JavaScript bundle a browser downloaded, so that the protection is real rather than
cosmetic.

#### Acceptance Criteria

1. THE Control_Plane SHALL require a principal whose coarse group is `SUPER_ADMIN` for every internal
   staff route, evaluated server-side on every request.
2. WHEN a principal whose coarse group is not `SUPER_ADMIN` requests any internal staff route, THE
   Control_Plane SHALL respond with status `403`.
3. WHEN a principal whose coarse group is not `SUPER_ADMIN` loads the internal staff application, THE
   Internal_Console SHALL render an access-denied shell containing no organization data and no data from
   any tenant.
4. THE Platform SHALL treat origin separation between the customer application and the internal staff
   console as defence in depth and SHALL NOT rely on it as the authorization control.
5. THE Test_Suite SHALL verify internal-surface protection through control-plane request tests rather
   than through the inability to load a page.

### Requirement 3: Shared application shell, design system, and permission-aware navigation

**User Story:** As a user of either console, I want one consistent interface built from one design
system with navigation that reflects what I can actually do, so that I am not shown controls that refuse
me and the two surfaces do not disagree with each other.

#### Acceptance Criteria

1. THE Platform SHALL provide exactly one shared design system module supplying page headers, cards,
   tables, buttons, form fields, badges, status indicators, modals, drawers, toasts, skeletons, empty
   states, and error states, and both application surfaces SHALL render their interface from it.
2. THE Platform SHALL provide exactly one shared enumeration-to-label mapping module, and no surface
   SHALL define a second mapping for any backend enumeration.
3. THE Platform SHALL provide exactly one shared run-narrative model module, and both the customer run
   view and the staff run view SHALL derive their content from it.
4. THE Platform SHALL provide exactly one declarative route table per surface, and no surface SHALL
   define inline path-to-view mapping alongside it.
5. THE Platform SHALL provide exactly one session-gate component, and every protected route on every
   surface SHALL obtain its client-side gate from that component.
6. THE Application_Shell SHALL build its navigation by filtering the surface's route table through the
   centralized permission policy for the current principal.
7. WHERE the current principal holds no permission for a navigation section, THE Application_Shell SHALL
   omit that section from navigation.
8. WHERE omitting a section would leave a user unable to understand why a known capability is missing,
   THE Application_Shell SHALL display the section with a stated reason instead of omitting it.
9. THE Application_Shell SHALL display the organization's display name, breadcrumbs for the current
   route, a notification indicator, and a user menu in its header.
10. THE Application_Shell SHALL render a usable layout at viewport widths of 1024 pixels and above.
11. THE Customer_App SHALL refresh live data on a 15-second interval, suspend refreshing while the
    browser tab is hidden, and refresh immediately when the tab becomes visible.
12. IF one data resource fails to load, THEN THE Customer_App SHALL render the remaining resources and
    confine the failure to the affected area.


### Requirement 4: Authentication and session lifecycle

**User Story:** As a user, I want sign-in, sign-out, password management, and session handling to behave
predictably and safely across reloads and browser navigation, so that I am never stranded in a broken
session and never left signed in when I believe I have signed out.

#### Acceptance Criteria

1. WHEN a user submits valid credentials, THE Auth_Service SHALL establish a session containing the
   user's identifier, organization context, and coarse group.
2. IF a user submits credentials that do not authenticate, THEN THE Auth_Service SHALL return a message
   that is identical whether or not an account exists for the submitted address.
3. IF an authenticated user belongs to no role group, THEN THE Auth_Service SHALL refuse to establish a
   session and SHALL report the absence of a role.
4. IF an authenticated user's token carries no organization claim, THEN THE Auth_Service SHALL refuse to
   establish a session and SHALL report the absence of an organization, and THE Control_Plane SHALL
   produce no usable principal for that token.
5. THE Auth_Service SHALL support a passive session read that does not redirect and a session access
   check that does redirect, as two distinct operations.
6. WHEN a user requests a password reset, THE Auth_Service SHALL send a reset instruction to the
   account's verified email address and SHALL accept a subsequent reset submission carrying the emailed
   confirmation value.
7. WHEN a signed-in user submits their current password together with a new password, THE Auth_Service
   SHALL change the password for that user's own account.
8. THE Auth_Service SHALL provide no route by which any operator or staff member can set a customer's
   password.
9. WHILE an access token is within its validity period, THE Customer_App SHALL make API requests without
   re-prompting for credentials.
10. WHEN an access token expires and a valid refresh token is present, THE Auth_Service SHALL obtain a
    new access token without displaying a sign-in prompt.
11. IF a refresh attempt fails, THEN THE Auth_Service SHALL clear the stored session and redirect to the
    sign-in page with a reason indicating expiry.
12. IF any API response indicates an unauthenticated caller, THEN THE Customer_App SHALL attempt exactly
    one token refresh and, on failure, sign the user out.
13. IF a request presents a tampered or invalid token, THEN THE Control_Plane SHALL reject the request
    before any handler logic executes.
14. WHEN an account is disabled while a session remains live, THE Control_Plane SHALL return an
    account-disabled indication on the next API call, and THE Customer_App SHALL sign the user out on
    receiving it.
15. THE Auth_Service SHALL expose a route returning the current user's identifier, organization,
    role, and account status.
16. WHEN a user signs out, THE Auth_Service SHALL revoke the refresh token at the identity provider, and
    the revoked token SHALL NOT establish a new session.
17. WHEN a user signs out and then navigates backward in browser history, THE Customer_App SHALL force a
    reload on restoration from the browser's page cache so that no authenticated view is displayed.
18. WHEN a user requests sign-out across all devices, THE Auth_Service SHALL revoke that user's sessions
    at the identity provider.
19. WHEN a staff member revokes a customer user's sessions, THE Auth_Service SHALL revoke that user's
    sessions at the identity provider and SHALL record an audit event.
20. WHEN an invited user follows an invitation link and signs in with the issued temporary credential,
    THE Auth_Service SHALL present the new-password challenge within the AmazFlow interface.
21. THE Auth_Service SHALL display no identity-provider vendor branding on any authentication page.

### Requirement 5: Architecture prepared for multi-factor, federated, and provisioned identity

**User Story:** As a security owner, I want multi-factor authentication, federated sign-in, and directory
provisioning to be architecturally anticipated but not shipped half-built, so that adding them later is
an extension rather than a rewrite and users are not shown controls that do nothing.

#### Acceptance Criteria

1. THE Auth_Service SHALL model its sign-in result as a discriminated union carrying a challenge case, so
   that a multi-factor challenge can be added without changing the result contract.
2. THE Platform SHALL retain the identity provider's existing optional software-token multi-factor
   configuration without exposing an enrolment flow in this release.
3. THE Customer_App SHALL present the multi-factor setup page as intentionally disabled with a stated
   reason describing that the capability is planned and already supported at the identity-provider level.
4. THE Customer_App SHALL present the single-sign-on and directory-provisioning panels of the
   organization security view as intentionally disabled with a stated reason.
5. THE Requirements SHALL record that federated sign-in requires organization-claim and group assignment
   at first federated sign-in, which no component currently performs.
6. THE Requirements SHALL record that directory provisioning depends on the membership record defined in
   Requirement 9 existing first.
7. THE Platform SHALL NOT present any control for multi-factor enrolment, federated sign-in, or directory
   provisioning that accepts input without effect.

### Requirement 6: Multi-tenant isolation derived from the session

**User Story:** As a customer, I want my organization's data to be unreachable by any other
organization's users through any route, so that isolation is a structural property of the platform rather
than a per-route convention.

#### Acceptance Criteria

1. THE Control_Plane SHALL derive the organization context of every authenticated request from the
   authenticated session's organization claim.
2. THE Control_Plane SHALL NOT derive the organization context of a non-staff request from any request
   body, path parameter, or query parameter.
3. THE Control_Plane SHALL provide exactly one sanctioned function for reading tenant-scoped data, and
   that function SHALL take the organization context from the principal rather than from a caller-supplied
   argument.
4. THE Control_Plane SHALL provide a separately named function for cross-organization reads that requires
   a stated reason and records an audit event on every call.
5. THE Control_Plane SHALL scope users, workflows, workflow versions, runs, tasks, approvals, evidence,
   agents, connections, secrets, analytics, audit records, notifications, teams, memberships, and
   onboarding records to the organization context of the request.
6. WHEN a non-staff principal requests an entity belonging to another organization by identifier, THE
   Control_Plane SHALL respond with status `404`.
7. THE Control_Plane SHALL exclude every identifier and field value belonging to another organization
   from every response body returned to a non-staff principal.
8. WHEN a non-staff principal submits a request body naming an organization other than the principal's
   own, THE Control_Plane SHALL refuse the request.
9. WHERE a route legitimately accepts an organization identifier as a parameter, THE Control_Plane SHALL
   admit the request only when the principal is staff or the identifier equals the principal's own
   organization, and SHALL evaluate that condition through the centralized permission policy.
10. WHEN a staff principal performs a cross-organization read, THE Control_Plane SHALL record a
    cross-tenant read audit event carrying the stated reason.
11. THE Control_Plane SHALL express the privilege elevation used on the agent execution path as an
    explicit agent principal type distinct from a staff principal, so that the elevation is visible and
    unavailable to human-facing routes.
12. WHERE an agent-path read spans organizations before filtering, THE Control_Plane SHALL apply the
    capability-aware claiming predicate defined in Requirement 15 as the isolating control and SHALL
    invoke the named cross-organization read function with a stated reason.
13. THE Control_Plane SHALL limit the unauthenticated organization branding route to returning the
    organization's display name and branding values, and SHALL rate-limit that route.
14. THE Control_Plane SHALL provide an organization-scoped audit read route for customer use rather than
    widening the cross-organization audit route.
15. THE Test_Suite SHALL enumerate every control-plane route into a fixture, and THE Build SHALL fail
    when a route exists that is absent from that fixture.
16. THE Test_Suite SHALL classify every enumerated route as session-scoped, parameter-scoped,
    entity-identifier-scoped, unauthenticated, or agent-token-authenticated.

### Requirement 7: Centralized role-based authorization policy

**User Story:** As a security owner, I want every authorization decision to come from one policy module
covering six customer roles, so that a role's capabilities are enumerable, testable as a set, and
changeable in one place.

#### Acceptance Criteria

1. THE Platform SHALL provide exactly one permission policy module exposing a decision function, a
   throwing authorization wrapper, and a navigation-visibility function.
2. THE Control_Plane SHALL obtain every authorization decision from the permission policy module, and no
   other backend or frontend code SHALL compare a role value.
3. THE Permission_Policy SHALL define the customer roles `ORG_OWNER`, `ORG_ADMIN`, `WORKFLOW_BUILDER`,
   `OPERATOR`, `APPROVER`, and `VIEWER`, and the internal role `STAFF_ADMIN`.
4. THE Permission_Policy SHALL map each platform role to exactly one coarse Cognito group and SHALL
   retain the three existing coarse groups without migration.
5. THE Permission_Policy SHALL deny a permission unless an explicit grant exists for the principal's
   role.
6. WHEN the requested resource belongs to an organization other than a non-staff principal's own
   organization, THE Permission_Policy SHALL deny the request before evaluating any permission grant and
   SHALL report a wrong-organization decision code.
7. WHEN a customer role requests a permission in the internal namespace, THE Permission_Policy SHALL deny
   the request.
8. WHERE a role holds a narrow form of a permission but not its broad form, THE Permission_Policy SHALL
   admit the request only for resources the principal owns.
9. WHERE the requested permission is workflow execution and the workflow declares assigned roles, THE
   Permission_Policy SHALL admit the request only when the principal's coarse role appears in the
   workflow's assigned roles, and SHALL report a not-assigned decision code otherwise.
10. THE Permission_Policy SHALL return the same decision for the same principal, permission, and resource
    on every evaluation, and SHALL perform no input or output, read no clock, and mutate no state.
11. THE Permission_Policy SHALL grant exactly the permissions recorded in the design's permission matrix
    for each role, and SHALL deny every permission absent from that role's row.
12. THE Control_Plane SHALL refuse to accept a maximum-concurrent-runs value from any customer role.
13. THE Control_Plane SHALL refuse to invite a user into the `SUPER_ADMIN` coarse group for every caller.
14. WHEN a principal has no membership record, THE Control_Plane SHALL resolve a default platform role
    from the principal's coarse group so that existing users retain their current access.
15. THE Control_Plane SHALL restrict the bounded artificial-intelligence execution diagnostic route to
    staff principals.
16. WHEN the permission policy denies a request, THE Control_Plane SHALL record an authorization-denied
    audit event carrying the permission, the resource, and the decision code.
17. THE Application_Shell SHALL derive navigation visibility from the same permission policy module the
    control plane uses.
18. THE Permission_Policy SHALL represent role grants as a keyed collection of permission sets so that an
    additional role key requires no change to the decision function.
19. THE Customer_App SHALL NOT offer custom role creation in this release.

### Requirement 8: Organization model with separated execution and commercial status

**User Story:** As an AmazFlow staff member, I want an organization record that carries both operational
and commercial state in separate fields, so that a sales stage can never gate execution and an internal
commercial state can never appear on a customer screen.

#### Acceptance Criteria

1. THE Platform SHALL retain the existing organization identifier, name, slug, execution status, plan,
   creation timestamp, update timestamp, branding, and settings fields without modification.
2. THE Platform SHALL extend the organization record with a primary domain, a primary contact, a billing
   contact, an internal account owner, a CRM record reference, an activation timestamp, and a
   denormalized onboarding status.
3. THE Platform SHALL keep the organization's logo location within the branding structure and SHALL NOT
   duplicate it at the top level of the organization record.
4. THE Control_Plane SHALL treat the organization's execution status values `active`, `paused`, and
   `suspended` as the gate on run creation.
5. THE Control_Plane SHALL maintain the organization's commercial lifecycle status as a field distinct
   from the execution status, carrying the values `prospect`, `onboarding`, `trial`, `active`,
   `suspended`, and `canceled`.
6. THE Customer_App SHALL NOT render the commercial lifecycle status on any surface.
7. WHEN an organization's execution status is `paused` or `suspended`, THE Control_Plane SHALL refuse run
   creation for that organization and SHALL state the reason in the response.
8. WHILE an organization's execution status is `paused`, THE Control_Plane SHALL continue to admit
   administrative operations including user invitation.
9. WHEN an organization's execution status returns to `active`, THE Control_Plane SHALL admit run creation
   without further action.
10. WHEN a run creation request would exceed the organization's maximum concurrent live runs, THE
    Control_Plane SHALL respond with status `429` and SHALL include the configured limit and the current
    in-flight count.
11. IF a run carries a status absent from the recognized live-run set, THEN THE Control_Plane SHALL
    exclude it from the concurrency count.
12. WHERE an existing organization record carries no commercial lifecycle status, THE Control_Plane SHALL
    treat that organization as commercially active.
13. THE Internal_Console SHALL label the organization plan field as reporting-only for as long as no
    runtime behaviour reads it.
14. THE Control_Plane SHALL reject any request that changes an existing organization's slug.
15. WHEN the platform creates an organization slug, THE Control_Plane SHALL produce a slug that is unique
    across all organizations and SHALL NOT reuse the slug of any previously existing organization.
16. WHEN an organization's execution status or commercial lifecycle status changes, THE Control_Plane
    SHALL record an audit event carrying the previous and new values.

### Requirement 9: User management and membership records

**User Story:** As an organization administrator, I want to invite, resend, revoke, deactivate,
reactivate, and change the role of the people in my organization, so that I can manage access without
asking AmazFlow staff to intervene.

#### Acceptance Criteria

1. THE Platform SHALL persist a membership record per organization user carrying the user's fine-grained
   platform role, team assignments, membership status, invitation timestamp, inviting user, activation
   timestamp, and last sign-in timestamp.
2. THE Platform SHALL treat the membership record as the source of truth for fine-grained role, team
   assignment, and activity timestamps.
3. THE Platform SHALL treat the identity provider as the source of truth for credentials, the
   enabled state, and the coarse group.
4. IF the membership record and the identity provider disagree about whether a user is active, THEN THE
   Control_Plane SHALL treat the identity provider as authoritative and SHALL reconcile the membership
   record on read.
5. WHEN an organization's user list is first read after this capability ships, THE Control_Plane SHALL
   create a membership record for each user discovered through the identity provider, defaulting the
   platform role from that user's coarse group, without modifying any existing stored record.
6. WHEN an administrator invites a user, THE Control_Plane SHALL create the identity-provider user, stamp
   the organization claim and creation timestamp, add the user to the mapped coarse group, and create a
   membership record with invited status.
7. IF adding an invited user to a coarse group fails after the user was created, THEN THE Control_Plane
   SHALL report the failure with an instruction to retry the invitation.
8. IF an invited email address lies outside the organization's allowed email domains, THEN THE
   Control_Plane SHALL refuse the invitation and SHALL list the permitted domains.
9. IF an invited email address already belongs to the inviting organization, THEN THE Control_Plane SHALL
   refuse the invitation as a duplicate.
10. IF an invited email address already belongs to a different organization, THEN THE Control_Plane SHALL
    refuse the invitation and SHALL state that AmazFlow must move that user.
11. IF the inviting organization's execution status is `suspended`, THEN THE Control_Plane SHALL refuse
    the invitation.
12. WHEN an administrator resends an invitation, THE Control_Plane SHALL reissue the invitation message to
    the invited address.
13. WHERE an invited user has not yet completed the initial password challenge, THE Control_Plane SHALL
    permit an administrator to revoke that pending invitation by disabling the account and marking the
    membership deactivated.
14. WHEN an administrator deactivates a user, THE Control_Plane SHALL disable that user at the identity
    provider.
15. WHEN an administrator reactivates a user, THE Control_Plane SHALL enable that user at the identity
    provider.
16. THE Control_Plane SHALL provide no route that deletes a user, and THE Customer_App SHALL state that
    removal is performed by deactivation so that audit attribution is retained.
17. WHEN an administrator changes a user's role, THE Control_Plane SHALL write the new platform role to
    the membership record and SHALL reconcile the identity-provider coarse group when the mapped group
    differs.
18. IF a role-change request names the `SUPER_ADMIN` group or role, THEN THE Control_Plane SHALL refuse
    the request.
19. IF a role-change request would leave the organization with no `ORG_OWNER`, THEN THE Control_Plane
    SHALL refuse the request.
20. WHEN an administrator assigns a user to teams, THE Control_Plane SHALL write the team assignments to
    that user's membership record.
21. THE Customer_App SHALL derive and display each user's state as invited, active, or deactivated from
    the identity-provider status, the enabled flag, and the membership record.
22. WHERE a user has not signed in since last-sign-in recording began, THE Customer_App SHALL display
    that the last sign-in is not recorded rather than displaying a zero or a placeholder date.
23. WHEN a user signs in successfully, THE Control_Plane SHALL record the sign-in timestamp on that
    user's membership record.
24. WHEN an invitation is sent, resent, revoked, or accepted, or a user's role or status changes, THE
    Control_Plane SHALL record an audit event for that action.

### Requirement 10: Teams

**User Story:** As an organization administrator, I want to group my users into teams, so that I can
organize people and direct notifications without being misled into thinking teams grant permissions.

#### Acceptance Criteria

1. THE Control_Plane SHALL support creating, renaming, and deleting a team within the caller's
   organization.
2. THE Control_Plane SHALL support adding a user to a team and removing a user from a team within the
   caller's organization.
3. THE Control_Plane SHALL scope every team record to the organization that created it.
4. THE Platform SHALL treat a team as an organizational grouping and a notification audience.
5. THE Permission_Policy SHALL accept a team identifier as part of a resource description without any
   role grant depending on it in this release.
6. THE Customer_App SHALL state on the teams view that team membership does not grant permissions in this
   release, and SHALL NOT present any team permission control.
7. WHEN a team is created, updated, deleted, or its membership changes, THE Control_Plane SHALL record an
   audit event.

### Requirement 11: Organization administration views

**User Story:** As an organization administrator, I want views for organization settings, roles,
security, and audit history, plus an honest account of billing, so that I can administer my organization
and can tell what the platform does and does not do.

#### Acceptance Criteria

1. THE Customer_App SHALL provide an organization view that reads and updates the organization profile,
   settings, and branding through the existing organization routes.
2. THE Control_Plane SHALL validate a submitted branding accent colour against a six-digit hexadecimal
   colour format and SHALL reject any other value.
3. THE Control_Plane SHALL accept a branding logo location only over `https` and SHALL reject a location
   that fails the platform's unsafe-location check.
4. THE Customer_App SHALL render the roles view from the permission matrix produced by the centralized
   permission policy.
5. THE Customer_App SHALL present custom role editing on the roles view as intentionally disabled with a
   stated reason.
6. THE Customer_App SHALL display on the security view the platform's actual session lifetime, password
   policy, and registered agent credentials.
7. THE Customer_App SHALL provide an audit view listing the caller's organization's administrative
   activity through the organization-scoped audit route.
8. THE Customer_App SHALL present the billing view as intentionally disabled with a stated reason that no
   billing system exists, and SHALL display the recorded plan value and the contact route for commercial
   changes.
9. THE Customer_App SHALL NOT present any billing control that accepts input.

### Requirement 12: Personal settings

**User Story:** As a user, I want to manage my own profile, security, and notification preferences, so
that I can control my account without an administrator, and so that every setting I change is actually
stored.

#### Acceptance Criteria

1. THE Customer_App SHALL provide a profile view that reads the signed-in user's own attributes and
   submits changes to them.
2. THE Customer_App SHALL provide a security view offering password change, the platform's session
   facts, and sign-out across all devices.
3. THE Customer_App SHALL provide a notification preferences view that reads and writes the signed-in
   user's per-notification-kind preferences.
4. THE Control_Plane SHALL persist every preference the notification preferences view accepts.
5. THE Customer_App SHALL NOT present a setting whose submitted value is not persisted.
6. THE Customer_App SHALL state on the notification preferences view that email delivery is not offered
   in this release, and SHALL NOT present an email delivery toggle.
7. WHEN a user changes their own password, THE Control_Plane SHALL record a password-changed audit event.


### Requirement 13: Workflow management and the single status model

**User Story:** As a workflow builder, I want to find, author, version, and publish workflows through one
unambiguous status model, so that what a workflow's state means is the same in the interface, the
database, and the run gate.

#### Acceptance Criteria

1. THE Platform SHALL define the persisted workflow status set as `draft`, `testing`, `active`, and
   `archived`, where `active` denotes a published and runnable workflow.
2. THE Platform SHALL retain `active` as the persisted value denoting Published and SHALL apply the
   Published label at the presentation layer through the shared label mapping module.
3. WHERE a stored workflow carries the legacy status `paused`, THE Customer_App SHALL display it as
   Archived, and THE Control_Plane SHALL NOT write that value again.
4. THE Control_Plane SHALL admit run creation only for a workflow whose persisted status is `active` or
   `testing`, and SHALL respond with a state-conflict status for any other workflow status.
5. WHERE a workflow's persisted status is `testing`, THE Control_Plane SHALL admit run creation only from
   principals holding workflow edit or publish permission, and SHALL tag the resulting run as a test run.
6. THE Customer_App SHALL provide workflow list, text search, and filtering by status, provider, required
   execution surface, and assigned role.
7. THE Control_Plane SHALL reject an unrecognized filter field with status `400` rather than ignoring it.
8. THE Control_Plane SHALL provide a customer-accessible draft write route that writes a workflow
   definition only into the caller's own organization.
9. THE Control_Plane SHALL validate every submitted workflow definition against the existing workflow
   definition schema, including step-reference integrity, provider allowlisting, and execution
   surface-to-action pairing.
10. IF a submitted workflow definition fails schema validation, THEN THE Control_Plane SHALL respond with
    status `422` stating the reason and SHALL NOT persist the definition.
11. THE Control_Plane SHALL refuse to set a workflow's status to `active` through the draft write route.
12. THE Control_Plane SHALL provide a publish route that transitions a workflow to `active` and re-runs
    the managed-connection availability check.
13. IF a publish request names a workflow containing a managed-browser step with no active connection,
    THEN THE Control_Plane SHALL refuse the publish with a state-conflict status.
14. THE Control_Plane SHALL provide an unpublish transition returning a workflow to `draft`, after which
    run creation for that workflow SHALL be refused.
15. THE Control_Plane SHALL support duplicating a workflow, producing a new workflow with a new identifier
    and the status `draft`.
16. THE Control_Plane SHALL support archiving a workflow, after which run creation for that workflow SHALL
    be refused.
17. WHEN a workflow is saved, THE Control_Plane SHALL create an immutable workflow version record.
18. WHEN a run starts, THE Control_Plane SHALL pin the run to the workflow version in effect at that
    moment, and that version SHALL remain readable after the workflow is subsequently edited.
19. THE Customer_App SHALL display a workflow's version history through the existing version list route.
20. THE Customer_App SHALL display the execution surfaces a workflow requires, derived from the workflow's
    steps rather than from a separately stored field.
21. THE Customer_App SHALL display a workflow's readiness to run using the preflight route.
22. WHERE the resolution of deferred decision Q-1 has not been recorded, THE Control_Plane SHALL restrict
    the publish permission to staff principals, and THE Customer_App SHALL state that an AmazFlow contact
    publishes the workflow rather than presenting a publish control to a customer workflow builder.
23. WHEN a workflow is published, unpublished, archived, or duplicated, THE Control_Plane SHALL record an
    audit event.

### Requirement 14: No-code workflow builder with natural-language entry point

**User Story:** As a workflow builder, I want to describe a process in plain language and then refine the
resulting steps in a structured editor, so that authoring is fast without execution ever depending on a
language model's judgement.

#### Acceptance Criteria

1. THE Workflow_Builder SHALL present field-level editing controls for every supported browser action
   type and every supported desktop action type.
2. THE Workflow_Builder SHALL derive each step's execution surface from the step's provider and SHALL
   accept only operations belonging to that surface's action vocabulary.
3. WHEN a builder submits a plain-language process description, THE Control_Plane SHALL request a
   candidate structured workflow definition from the managed artificial-intelligence service.
4. WHEN a candidate workflow definition is produced, THE Control_Plane SHALL validate it against the
   workflow definition schema before persisting it.
5. IF a candidate workflow definition fails validation, THEN THE Control_Plane SHALL respond with status
   `422` stating the reason and SHALL NOT persist the candidate.
6. WHEN a candidate workflow definition passes validation, THE Control_Plane SHALL persist it with the
   status `draft` and SHALL return it in an editable form.
7. THE Customer_App SHALL persist a generated draft immediately so that the draft survives a page reload.
8. THE Workflow_Builder SHALL submit the structured workflow definition rather than the original
   plain-language description when saving a draft.
9. THE Execution_Engine SHALL determine run control flow solely from the persisted structured workflow
   definition and SHALL NOT consult a language model to decide which step executes next.
10. WHEN a workflow is generated from a plain-language description, THE Control_Plane SHALL record an
    audit event identifying the generation.

### Requirement 15: Execution surfaces and agent management

**User Story:** As an operations user, I want to see and manage the agents that perform real-world
actions, with status derived from actual heartbeats and enough diagnostic detail to explain why work is
waiting, so that a stalled run is explainable rather than mysterious.

#### Acceptance Criteria

1. THE Platform SHALL support exactly two execution surfaces: a browser extension surface and a desktop
   agent surface.
2. THE Customer_App SHALL derive each agent's connectivity state from the recency of that agent's last
   heartbeat against the two-minute heartbeat interval and SHALL NOT display a separately stored
   connectivity flag.
3. THE Customer_App SHALL display each agent's type, platform, version, advertised capabilities, and, for
   a desktop agent, the operating-system permissions the agent reports as granted.
4. WHEN an administrator requests agent authorization, THE Control_Plane SHALL issue a single-use
   expiring authorization code scoped to the requesting organization.
5. WHEN an agent presents a valid authorization code, THE Control_Plane SHALL exchange it for a
   credential stored as a hash and SHALL mark the code consumed.
6. WHEN an agent re-registers with a previously seen installation identifier, THE Control_Plane SHALL
   reuse the existing agent record and SHALL supersede the prior credential.
7. IF a superseded or revoked agent credential is presented, THEN THE Control_Plane SHALL refuse the
   request.
8. WHEN an administrator revokes an agent, THE Control_Plane SHALL end that agent's access on the next
   request it makes.
9. WHEN an agent sends a heartbeat, THE Control_Plane SHALL record the heartbeat time and the agent's
   advertised capabilities and permissions.
10. THE Control_Plane SHALL admit an agent to a task only when the task's organization equals the agent's
    organization, the task's execution target maps to the agent's type, the agent's advertised
    capabilities include the task's operation, the caller's role appears in the task's assigned roles,
    and, where the caller's role is the frontline group, the task belongs to a run the caller created.
11. IF an agent's advertised capabilities do not include a pending task's operation, THEN THE
    Control_Plane SHALL leave the task unclaimed and available to another eligible agent.
12. THE Control_Plane SHALL never offer a task whose execution target is the browser surface to a desktop
    agent, and SHALL never offer a task whose execution target is the desktop surface to a browser agent.
13. WHEN two or more eligible agents attempt to claim the same task, THE Control_Plane SHALL grant the
    claim to exactly one agent and SHALL respond to each other agent with a state-conflict status.
14. WHEN a claimed task's lease expires, THE Control_Plane SHALL admit a takeover claim from another
    eligible agent.
15. WHILE a task's lease is unexpired, THE Control_Plane SHALL refuse a claim from any other agent.
16. THE Control_Plane SHALL return stalled leased tasks to the available pool through the scheduled sweep.
17. THE Customer_App SHALL display, for a pending task that no connected agent has claimed, the reason
    the task is not eligible for the available agents, evaluated server-side using the same admission
    predicate the claim route uses.
18. WHEN a run requires an execution surface that has no currently connected agent, THE Control_Plane
    SHALL refuse run creation through the preflight check rather than creating a run that later times out.
19. WHEN an agent is revoked or an agent credential is superseded, THE Control_Plane SHALL record an audit
    event.

### Requirement 16: Runs, status presentation, and evidence

**User Story:** As an operations user, I want to see what a run actually did, in language I understand,
without the interface inventing states the engine does not have, so that I can trust what I am reading.

#### Acceptance Criteria

1. THE Platform SHALL retain the persisted run status values `RUNNING`, `AWAITING_CONFIRMATION`,
   `WAITING_AGENT`, `WAITING_APPROVAL`, `CANCELLED`, `TIMED_OUT`, `COMPLETED`, and `FAILED` without
   renaming any of them.
2. THE Customer_App SHALL map each persisted run status to a customer-facing label through the shared
   label mapping module, displaying `RUNNING` as In Progress and `AWAITING_CONFIRMATION` as awaiting a
   human action.
3. THE Customer_App SHALL NOT display a queued run state, because a run is in the running state from
   creation.
4. THE Customer_App SHALL display the timed-out status with its own distinct label rather than merging it
   with the failed status.
5. THE Label_Mapping SHALL define a label for every persisted run status value.
6. THE Customer_App SHALL list runs with filtering and SHALL restrict the listing to the runs the
   principal is permitted to read.
7. WHERE a principal holds only the own-records form of run read permission, THE Control_Plane SHALL
   return only runs that principal created.
8. THE Customer_App SHALL render run detail from the shared run-narrative model, displaying step
   progression including the projected remaining path, a timeline derived from the run's recorded audit
   entries with elapsed intervals, the tool calls recorded per step, decision records with their
   confidence values against the configured threshold, the gates the run encountered, and the scopes of
   the grants issued.
9. THE Customer_App SHALL display, for each completed step, which agent acted, under which grant
   identifier, on which page or application, and whether the platform independently verified the result.
10. THE Customer_App SHALL render a plain-language explanation of why a run ended in its current state.
11. WHERE no attempt counter is persisted for a step, THE Customer_App SHALL display that retry attempts
    are not recorded rather than displaying a count.
12. WHERE no execution recording exists for a run, THE Customer_App SHALL state that recordings are not
    available rather than presenting an empty player.
13. WHEN a user cancels a run whose status is in the cancellable set, THE Control_Plane SHALL cancel the
    run and record the cancellation in the run's audit entries.
14. IF a cancel request names a run in a terminal status, THEN THE Control_Plane SHALL respond with a
    state-conflict status.
15. WHEN a user grants a pending pre-action confirmation, THE Control_Plane SHALL record the confirmation
    and resume the run.
16. THE Customer_App SHALL make a run's detail view reachable by direct link that survives a hard reload.

### Requirement 17: Tasks

**User Story:** As an operations user, I want to see the tasks awaiting agent execution and report a
result where I am permitted to, so that I can move work forward and understand what is queued.

#### Acceptance Criteria

1. THE Customer_App SHALL list the agent tasks belonging to the caller's organization that the principal
   is permitted to read.
2. WHERE a principal holds only the own-records form of task read permission, THE Control_Plane SHALL
   return only tasks belonging to runs that principal created.
3. THE Customer_App SHALL display for each task the target execution surface, the operation, the
   originating run, and the task's current claim state.
4. WHEN a permitted caller submits a task result, THE Control_Plane SHALL record the result and advance
   the run through the execution engine.
5. IF a task result is submitted for a run whose status is not awaiting an agent on that step, THEN THE
   Control_Plane SHALL respond with a state-conflict status.
6. WHEN a task result is recorded, THE Control_Plane SHALL append the corresponding entry to the run's
   audit entries.

### Requirement 18: Approvals

**User Story:** As an approver, I want to decide the approvals assigned to me with the decision recorded
and attributable, so that a human gate is auditable and cannot be bypassed by the interface.

#### Acceptance Criteria

1. THE Customer_App SHALL list the runs in the caller's organization whose status is awaiting approval and
   that the principal is permitted to read.
2. WHEN a principal holding approval-decision permission approves a pending step, THE Control_Plane SHALL
   record the approval and advance the run along the approved branch.
3. WHEN a principal holding approval-decision permission rejects a pending step, THE Control_Plane SHALL
   record the rejection and advance the run along the rejected branch.
4. THE Control_Plane SHALL verify the caller's authority to decide an approval server-side on every
   approval request.
5. IF a principal without approval-decision permission submits an approval decision, THEN THE
   Control_Plane SHALL respond with status `403`.
6. IF a principal from another organization submits an approval decision, THEN THE Control_Plane SHALL
   respond with status `404`.
7. IF the deciding principal's role is absent from the approval step's permitted roles, THEN THE
   Control_Plane SHALL refuse the decision.
8. IF an approval decision names a run whose status is not awaiting approval, THEN THE Control_Plane SHALL
   respond with a state-conflict status.
9. IF an approval decision names a step that has already been decided, THEN THE Control_Plane SHALL
   respond with a state-conflict status.
10. WHEN an approval decision is recorded, THE Control_Plane SHALL record the deciding user and that
    user's role in the run's audit entries and in the organization's administrative audit record.

### Requirement 19: Exceptions differentiated by cause

**User Story:** As an operations user, I want failed runs grouped by what actually went wrong and offered
recovery only where recovery is safe, so that I fix the right thing and never re-trigger an action whose
effect is uncertain.

#### Acceptance Criteria

1. THE Customer_App SHALL present as exceptions the runs in the caller's organization whose status is
   failed or timed out.
2. THE Control_Plane SHALL derive an exception's cause classification from the run's recorded audit
   entries, step results, and connection state, and SHALL NOT store the classification separately from
   the run.
3. THE Control_Plane SHALL classify an exception as one of system failure, integration failure, missing
   information, ambiguous record, human review, policy conflict, agent unavailable, or credential problem.
4. THE Customer_App SHALL display the classified cause and the recovery action appropriate to that cause
   for each exception.
5. WHERE a run's derived diagnosis marks the run as unsafe to retry, THE Customer_App SHALL present
   reconciliation guidance and SHALL NOT present a retry control.
6. WHEN a permitted principal resumes a recoverable exception, THE Control_Plane SHALL create a new run
   pinned to the same workflow version with the same input.
7. WHEN a run is created by resuming an exception, THE Control_Plane SHALL record an audit event linking
   the new run to the original run.
8. THE Control_Plane SHALL NOT rewind or mutate an existing run's completed steps when resuming an
   exception.

### Requirement 20: Connections, integrations, and secret handling

**User Story:** As an organization administrator, I want to manage the integrations and credentials my
workflows depend on without any secret ever reaching my browser, so that connections are usable and
credentials stay server-side.

#### Acceptance Criteria

1. THE Customer_App SHALL display for each connection its name, base location, permitted origins,
   preferred mode, status, and the workflows that depend on it.
2. THE Control_Plane SHALL derive the set of workflows depending on a connection from the stored workflow
   definitions.
3. THE Control_Plane SHALL support creating a connection, starting a login session, completing a login
   session, testing a connection, reconnecting a connection, and disconnecting a connection.
4. THE Control_Plane SHALL exclude the managed profile identifier and every credential value from every
   connection response.
5. WHERE the connection routes are not present in the deployed control plane, THE Customer_App SHALL
   present the connections view as intentionally disabled with a stated reason.
6. THE Platform SHALL persist secret metadata as a record carrying the secret's name, kind, an external
   store reference, a recognition hint, and usage timestamps.
7. THE Control_Plane SHALL store every secret value in the external secret store and SHALL NOT store any
   secret value in the platform database.
8. THE Control_Plane SHALL NOT return a secret value from any route.
9. THE Control_Plane SHALL NOT write a secret value to any log line, run context, audit entry, or evidence
   record.
10. THE Control_Plane SHALL accept a secret value once on write and pass it directly to the external
    secret store.
11. WHERE a secret has never been used, THE Customer_App SHALL display that the last use is not recorded
    rather than displaying a zero or a date.
12. WHEN a secret is created, rotated, or deleted, THE Control_Plane SHALL record an audit event carrying
    only the secret's identifier and name.
13. THE Platform SHALL hold the execution grant signing secret in the external secret store rather than in
    a deployment template parameter.
14. WHEN the execution grant signing secret is rotated, THE Platform SHALL perform the rotation only while
    no run is awaiting an agent, because rotation invalidates in-flight grants.

### Requirement 21: Analytics from real data only

**User Story:** As an organization administrator, I want analytics that report only what the platform
actually measured, so that I am never shown a fabricated figure I might act on.

#### Acceptance Criteria

1. THE Customer_App SHALL display run counts over time grouped by status, derived from stored run records.
2. THE Customer_App SHALL display the success rate as completed runs divided by decided runs.
3. WHERE no run has reached a decided status, THE Customer_App SHALL display that the success rate is not
   available rather than displaying zero percent.
4. THE Customer_App SHALL display the median run duration derived from the recorded creation and
   completion timestamps of completed runs.
5. THE Customer_App SHALL display the exception count and the breakdown by derived cause.
6. THE Customer_App SHALL display per-workflow run volume and success rate derived from stored run
   records.
7. THE Customer_App SHALL display agent availability derived from recorded heartbeat history.
8. THE Customer_App SHALL NOT display any monetary figure derived from an estimated manual duration
   multiplied by a hardcoded rate.
9. WHERE a time-saved figure is displayed, THE Customer_App SHALL label it as an estimate measured against
   the manual duration recorded by the customer's AmazFlow contact.
10. THE Control_Plane SHALL exclude no run from analytics on the basis of an unrecognized status without
    stating that runs were excluded.

### Requirement 22: Notifications

**User Story:** As a user, I want to be notified about the events that need my attention and to be able to
navigate straight to them, so that I do not have to poll the interface to find work.

#### Acceptance Criteria

1. THE Platform SHALL persist each notification within the organization it concerns, carrying an audience,
   a kind, a title, a body, a deep link, and a creation timestamp.
2. THE Control_Plane SHALL create a notification only at a point where the corresponding platform event is
   also recorded, so that no notification exists for an event that did not occur.
3. THE Control_Plane SHALL support notification kinds for approval required, run failed, run timed out,
   agent offline, connection error, exception raised, invitation accepted, and onboarding step ready.
4. THE Customer_App SHALL display an unread notification count and a list of notifications with each
   notification's creation time and deep link.
5. WHEN a user opens a notification's deep link, THE Customer_App SHALL navigate to the referenced record.
6. THE Control_Plane SHALL record notification read state per user and per notification.
7. THE Control_Plane SHALL support marking a single notification read and marking all of a user's
   notifications read.
8. THE Control_Plane SHALL return to a user only notifications belonging to that user's organization.
9. THE Control_Plane SHALL NOT deliver notifications by email in this release.

### Requirement 23: Internal staff console

**User Story:** As an AmazFlow staff member, I want an internal console covering every organization,
customer, workflow, run, agent, connection, ticket, and system signal, so that I can operate and support
the platform from one place with real data.

#### Acceptance Criteria

1. THE Internal_Console SHALL retain every section of the existing staff console as functional, including
   overview, runs, approvals, exceptions, workflows, workflow studio, customers, users, connections,
   agents, audit, support, leads, and platform settings.
2. THE Internal_Console SHALL provide an organizations view supporting listing, creating, and updating
   organizations including both the execution status and the commercial lifecycle status.
3. THE Internal_Console SHALL provide a per-customer view displaying that organization's usage summary and
   user list.
4. THE Internal_Console SHALL provide a runs view spanning organizations and an exceptions view filtered
   to failed and timed-out runs.
5. THE Internal_Console SHALL provide an agents view and a connections view spanning organizations.
6. THE Internal_Console SHALL provide a support view listing and updating support tickets.
7. THE Internal_Console SHALL provide an audit view spanning organizations.
8. THE Internal_Console SHALL provide a system health view displaying the control plane's health response
   and the platform's published operational metrics.
9. THE Internal_Console SHALL present in the feature flags view only flags that are read by runtime
   behaviour.
10. IF a proposed feature flag is not read by any runtime behaviour, THEN THE Internal_Console SHALL NOT
    present it.
11. THE Internal_Console SHALL provide an onboarding view displaying each organization's onboarding state,
    derived milestones, and checklist.
12. THE Internal_Console SHALL provide a customer relationship management view displaying received CRM
    events, their processing state, and a retry control for failed events.
13. THE Internal_Console SHALL label the diagnostic executor invocation route as a diagnostic and SHALL
    restrict it to staff principals.
14. THE Internal_Console SHALL present the impersonation view as intentionally disabled with a stated
    reason that safe impersonation requires scoped attribution not built in this release.
15. THE Internal_Console SHALL present the internal billing view as intentionally disabled with a stated
    reason that no billing provider is integrated.
16. THE Platform SHALL define the principal type with a field capable of recording an impersonating user,
    so that impersonation can be added later without redefining the principal.
17. THE Internal_Console SHALL display vendor and model identifiers, trace identifiers, harness
    identifiers, and token usage only within explicitly opened technical detail disclosures.
18. WHEN a staff principal reads data belonging to an organization other than the platform's own, THE
    Control_Plane SHALL record a cross-tenant read audit event.
19. THE Control_Plane SHALL replace cross-organization full-table scans for staff list views with indexed
    queries.
20. WHILE the indexed queries are not yet available for a list, THE Control_Plane SHALL retain the
    existing truncation signal and SHALL report when a staff list was truncated rather than presenting a
    partial list as complete.


### Requirement 24: Onboarding state, milestones, and guided checklist

**User Story:** As an AmazFlow staff member, I want a normalized onboarding state per customer with
progress derived from real events and a checklist the customer can follow, so that onboarding progress is
factual and unaffected by how the sales tool labels its columns.

#### Acceptance Criteria

1. THE Platform SHALL persist exactly one onboarding record per organization carrying the onboarding
   status, the CRM reference, the internal owner, the derived milestone timestamps, the checklist state,
   and internal notes.
2. THE Platform SHALL define the onboarding status set as `PROSPECT`, `CLOSED_WON`, `SETUP_REQUIRED`,
   `ONBOARDING`, `CONFIGURATION`, `TESTING`, `READY_FOR_LAUNCH`, `ACTIVE`, `PAUSED`, and `CHURNED`.
3. THE Platform SHALL define the onboarding status set independently of any customer relationship
   management provider's sales-stage labels.
4. THE CRM_Adapter SHALL own the mapping from a provider sales-stage label to an onboarding status.
5. IF a received sales-stage label has no mapping, THEN THE Control_Plane SHALL leave the onboarding status
   unchanged and SHALL log the label as unmapped.
6. THE Control_Plane SHALL derive each onboarding milestone timestamp from an observed platform event.
7. THE Control_Plane SHALL write each milestone timestamp only when that timestamp is currently unset.
8. THE Control_Plane SHALL derive the administrator-invited milestone from the invitation of the first
   organization owner or organization administrator.
9. THE Control_Plane SHALL derive the administrator-activated milestone from that user's first successful
   sign-in.
10. THE Control_Plane SHALL derive the first-integration milestone from the first connection reaching
    active status.
11. THE Control_Plane SHALL derive the first-agent milestone from the first heartbeat received from any
    agent in the organization.
12. THE Control_Plane SHALL derive the workflow-created and workflow-published milestones from the
    corresponding workflow save and publish events.
13. THE Control_Plane SHALL derive the first-production-run milestone from the first run reaching completed
    status that is not tagged as a test run.
14. THE Control_Plane SHALL set the organization's activation timestamp to the first-production-run
    milestone.
15. THE Control_Plane SHALL NOT accept a manually supplied value for any derived milestone timestamp.
16. THE Customer_App SHALL display the onboarding checklist on the customer home view to principals holding
    organization owner or organization administrator roles.
17. THE Customer_App SHALL include in the checklist only the steps the organization actually requires,
    derived from the execution surfaces its workflows require.
18. WHERE a checklist step is awaiting action by AmazFlow rather than by the customer, THE Customer_App
    SHALL label that step as requiring nothing from the customer.
19. WHEN a user skips a checklist step, THE Control_Plane SHALL record the skipped state together with the
    acting user and the time.
20. THE Control_Plane SHALL persist checklist state server-side so that progress is retained across
    devices and sessions.
21. THE Internal_Console SHALL display the same onboarding record with the internal notes and the internal
    owner.
22. THE Control_Plane SHALL treat the onboarding statuses `PAUSED` and `CHURNED` as commercial states that
    do not by themselves change the organization's execution status.
23. WHEN a staff member sets the onboarding status to `CHURNED`, THE Internal_Console SHALL prompt the
    staff member to also set the organization's execution status rather than changing it implicitly.
24. WHEN an onboarding status changes or a checklist step is completed or skipped, THE Control_Plane SHALL
    record an audit event.

### Requirement 25: Customer relationship management integration and Closed Won automation

**User Story:** As an AmazFlow staff member, I want a closed deal to create the customer's organization and
onboarding record automatically and exactly once, with lifecycle progress flowing back to the sales tool
and nothing sensitive ever leaving the platform, so that onboarding starts itself without risking
duplicate accounts or a data leak.

#### Acceptance Criteria

1. THE Platform SHALL define a provider-agnostic customer relationship management service interface
   covering customer lookup, customer creation, customer update, onboarding status update, organization
   identifier recording, activation recording, and periodic usage summary recording.
2. THE Platform SHALL provide an implementation of that interface for the Monday provider.
3. THE Platform SHALL provide a no-operation implementation of that interface that performs no network
   input or output.
4. WHERE no customer relationship management provider is configured or the configured provider is
   unreachable, THE Control_Plane SHALL complete organization creation and administrator invitation
   successfully.
5. THE Control_Plane SHALL hold every customer relationship management credential in the external secret
   store and SHALL NOT include any such credential in a client bundle or a database record.
6. THE Control_Plane SHALL expose the provider webhook at a route containing a high-entropy secret path
   segment held in the external secret store.
7. WHEN a webhook request arrives, THE Control_Plane SHALL compare the supplied path segment against the
   stored value using a constant-time comparison.
8. IF a webhook request's path segment does not match the stored value, THEN THE Control_Plane SHALL
   respond with status `404`.
9. WHERE a webhook request carries an authorization header, THE Control_Plane SHALL verify that header
   against the stored provider signing secret.
10. IF a webhook request carries an authorization header that fails verification, THEN THE Control_Plane
    SHALL respond with status `401` and SHALL make no state change.
11. WHERE a webhook request carries no authorization header, THE Control_Plane SHALL process the request
    on the strength of the path secret and SHALL log the absence of the header.
12. WHEN a webhook request body carries a subscription challenge value, THE Control_Plane SHALL return that
    value in the response and SHALL make no state change.
13. THE Control_Plane SHALL validate every webhook body against a declared schema.
14. IF a webhook body fails schema validation, THEN THE Control_Plane SHALL respond with status `400` and
    SHALL make no state change.
15. THE Control_Plane SHALL rate-limit the webhook route per source with a per-provider budget.
16. THE Control_Plane SHALL accept the webhook route only over a transport-secured connection.
17. THE Control_Plane SHALL record a processing marker for each webhook event key using a conditional write
    that succeeds for exactly one of any number of concurrent attempts.
18. WHEN a webhook event whose key has already completed processing is redelivered, THE Control_Plane SHALL
    respond successfully indicating deduplication and SHALL make no additional state change.
19. WHEN a webhook event whose key is currently being processed is redelivered, THE Control_Plane SHALL
    respond with a retryable state-conflict status.
20. WHEN a closed-deal event is processed for a customer relationship management item that has no linked
    organization, THE Control_Plane SHALL create one organization with a unique slug and SHALL write the
    link record using a conditional write.
21. WHEN a closed-deal event is processed for a customer relationship management item that already has a
    linked organization, THE Control_Plane SHALL reuse the linked organization.
22. FOR ALL sequences of deliveries of the same closed-deal event, whether sequential or concurrent, THE
    Control_Plane SHALL result in exactly one organization and exactly one onboarding record for that
    customer relationship management item.
23. FOR ALL deliveries of the same closed-deal event, THE Control_Plane SHALL record exactly one
    closed-deal-processed audit event.
24. WHEN a closed-deal event is processed, THE Control_Plane SHALL create or update the organization's
    onboarding record with the setup-required status, the customer relationship management reference, the
    resolved internal owner, and the closed-deal timestamp.
25. WHERE the internal owner cannot be resolved from the event, THE Control_Plane SHALL leave the internal
    owner unset rather than assigning an arbitrary user.
26. WHERE the closed-deal event carries a well-formed contact email address permitted by the
    organization's allowed domains, THE Control_Plane SHALL prepare an administrator invitation for that
    address with the organization administrator role.
27. IF the closed-deal event carries no usable contact email address, THEN THE Control_Plane SHALL create
    the organization and onboarding record, mark the invite checklist step as blocked with a reason, and
    return a successful response.
28. THE Control_Plane SHALL perform invitation delivery as a separately retryable step so that a delivery
    failure does not reverse organization creation.
29. THE Control_Plane SHALL enqueue reverse-synchronization calls rather than awaiting them on the request
    path, and SHALL retry a failed call with backoff.
30. IF a reverse-synchronization call fails repeatedly, THEN THE Control_Plane SHALL NOT create a second
    organization for the same customer relationship management item.
31. IF processing terminates unexpectedly partway through, THEN a subsequent redelivery SHALL drive the
    same event to the same single organization.
32. WHEN a processing marker remains incomplete beyond the configured threshold, THE Control_Plane SHALL
    mark it failed and SHALL present it in the internal console's retry view.
33. WHEN a staff member retries a failed customer relationship management event, THE Control_Plane SHALL
    reprocess it without creating a duplicate organization.
34. THE Control_Plane SHALL send to the customer relationship management provider only the lifecycle
    milestones and the aggregate usage summary consisting of run counts, active workflow count, and active
    agent count.
35. THE Control_Plane SHALL NOT send workflow definitions, workflow step content, customer input, run
    context, credentials, secrets, screenshots, recordings, execution evidence, audit detail, or protected
    health information to any customer relationship management provider.
36. THE CRM_Service SHALL define no method accepting a run, a workflow, or an evidence record, so that no
    signature exists through which such data could be transmitted.
37. THE Control_Plane SHALL NOT write a provider credential, a path secret, a signing secret, or a raw
    webhook body to any log line.
38. THE Control_Plane SHALL include the event identifier, the item identifier, the mapped status, and the
    correlation identifier in its webhook log lines.
39. WHEN a closed-deal event is processed, deduplicated, failed, or carries an unmapped stage, THE
    Control_Plane SHALL record the corresponding audit event.

### Requirement 26: Customer administrator invitation flow

**User Story:** As an organization administrator, I want to invite a colleague with a secure expiring link
whose role and organization I choose, so that the invitee cannot alter what they were granted and a
leaked link cannot be reused.

#### Acceptance Criteria

1. WHEN an administrator creates an invitation, THE Control_Plane SHALL generate a high-entropy token and
   SHALL store only a cryptographic hash of that token.
2. THE Platform SHALL persist each invitation with the organization, the invited address, the granted
   platform role, the inviting user, a creation timestamp, an expiry timestamp, and a state.
3. THE Control_Plane SHALL set an invitation's expiry to seven days after creation by default.
4. THE Control_Plane SHALL deliver the invitation as a link to the customer application's invitation
   acceptance route carrying the token.
5. WHEN an unauthenticated request presents an invitation token for inspection, THE Control_Plane SHALL
   return only the organization's display name and the invited address.
6. IF an inspected invitation has passed its expiry, THEN THE Control_Plane SHALL respond with status `410`
   and THE Customer_App SHALL offer to request a new invitation.
7. IF an inspected invitation has already been accepted, THEN THE Control_Plane SHALL respond with a
   state-conflict status.
8. WHEN an authenticated invitee accepts an invitation, THE Control_Plane SHALL verify the token hash, the
   invitation state, the expiry, and that the authenticated caller's email address matches the invitation
   record.
9. THE Control_Plane SHALL transition an invitation to accepted using a conditional write that requires the
   current state to be pending.
10. WHEN two or more acceptance requests for the same invitation are processed, THE Control_Plane SHALL
    accept exactly one and SHALL respond to each other request with a state-conflict status.
11. FOR ALL invitations, THE Control_Plane SHALL accept the invitation at most once.
12. IF an acceptance request arrives after the invitation's expiry, THEN THE Control_Plane SHALL refuse the
    acceptance.
13. THE Control_Plane SHALL resolve the organization and the granted role from the stored invitation record.
14. THE Control_Plane SHALL ignore any organization identifier or role value supplied in an acceptance
    request body.
15. FOR ALL acceptance requests, the resulting membership's organization and role SHALL equal the
    organization and role recorded on the invitation.
16. WHEN an invitation is accepted, THE Control_Plane SHALL set the membership status to active and SHALL
    stamp the administrator-activated milestone where applicable.
17. WHEN an administrator resends an invitation, THE Control_Plane SHALL issue a new token, revoke the
    previous invitation record, and the previously issued link SHALL no longer be accepted.
18. THE Control_Plane SHALL rate-limit the invitation inspection and acceptance routes.
19. WHEN an invitation is sent, resent, revoked, accepted, or observed expired, THE Control_Plane SHALL
    record an audit event.


### Requirement 27: Application programming interface standards

**User Story:** As a platform engineer, I want every route to declare its authentication, authorization,
scoping, validation, pagination, and audit behaviour in one consistent shape, so that consistency is
structural rather than remembered.

#### Acceptance Criteria

1. THE Control_Plane SHALL describe each route with a declaration naming its route key, its authentication
   mode, its required permission, its organization-scoping mode, its body schema, its query schema, its
   pagination behaviour, its rate limit, and its audit action.
2. THE Control_Plane SHALL require a verified identity-provider token at the gateway for every
   human-facing route.
3. THE Control_Plane SHALL authenticate agent routes with the agent's hashed bearer credential rather than
   an identity-provider token.
4. THE Control_Plane SHALL perform exactly one authorization evaluation per route, using the permission
   named in that route's declaration.
5. THE Control_Plane SHALL contain no role comparison outside the centralized permission policy module.
6. THE Control_Plane SHALL validate every request body and query string against the route's declared
   schema.
7. IF a request body or query string fails validation, THEN THE Control_Plane SHALL respond with status
   `400` and SHALL make no state change.
8. THE Control_Plane SHALL paginate list routes using a caller-supplied page size defaulting to fifty and
   capped at two hundred, together with an opaque continuation cursor.
9. THE Control_Plane SHALL NOT truncate a list result silently.
10. THE Control_Plane SHALL respond with status `401` for an unauthenticated caller, `403` for an
    authenticated caller lacking permission, `404` for a record that is absent or belongs to another
    organization, `409` for a state conflict, `410` for an expired token, `422` for a semantically invalid
    request, `429` for a rate or concurrency limit, `502` for an upstream failure, and `500` for an
    unexpected failure.
11. THE Control_Plane SHALL respond to a cross-organization record request with `404` rather than `403`, so
    that the response does not confirm the record's existence.
12. THE Control_Plane SHALL include in every error response a stable machine-readable code, a
    human-readable message safe to display, and the request's correlation identifier.
13. THE Control_Plane SHALL exclude stack traces, secret values, internal resource identifiers, and model
    identifiers from every response body.
14. THE Control_Plane SHALL restrict every response body to an allowlist of fields for that route.
15. WHILE the previously deployed frontend remains live, THE Control_Plane SHALL return the existing flat
    error field alongside the structured error object.
16. THE Control_Plane SHALL preserve the existing response shape of every route the deployed frontend
    consumes until that frontend has been replaced.

### Requirement 28: Structured observability and correlation

**User Story:** As an operator, I want every request, log line, metric, and audit entry joined by one
correlation identifier, so that I can trace a reported problem to the exact request that caused it.

#### Acceptance Criteria

1. THE Control_Plane SHALL assign a correlation identifier to every request, using a caller-supplied
   identifier where one is provided and generating one otherwise.
2. THE Control_Plane SHALL include the correlation identifier in every response.
3. THE Control_Plane SHALL emit one structured log line per request carrying the correlation identifier,
   the route key, the user identifier, the organization identifier, the response status, the duration, the
   evaluated permission, and the authorization decision.
4. THE Control_Plane SHALL include the correlation identifier in every audit event it records.
5. THE Control_Plane SHALL exclude secrets, tokens, grant payloads, customer input, run context values,
   evidence bodies, and full email addresses from every log line.
6. THE Control_Plane SHALL publish operational metrics for authorization denials, cross-organization access
   attempts, run failures, run timeouts, verification failures, agent unavailability, task claim
   contention, grant rejections, webhook receipt, webhook deduplication, webhook failure, invitation
   acceptance, and truncated staff list reads.
7. THE Platform SHALL configure an alarm on the cross-organization access attempt metric and on the
   authorization denial metric.
8. THE Platform SHALL publish a zero value for the cross-organization access attempt metric so that its
   alarm is not left without data.
9. THE Control_Plane SHALL record an audit event for every administrative and security-relevant action
   enumerated in the design's audit coverage section, including authentication outcomes, authorization
   denials, user and team changes, workflow lifecycle transitions, run initiation and resumption, agent
   and connection changes, secret operations, organization lifecycle changes, onboarding transitions,
   customer relationship management events, and staff cross-organization reads.
10. THE Control_Plane SHALL record for each audit event the acting user, the acting user's label, the
    organization, the action, the target, the time, the changed values where a value changed, and the
    correlation identifier.
11. THE Control_Plane SHALL retain both the per-run execution audit entries and the administrative activity
    audit records as distinct records serving distinct purposes.
12. THE Control_Plane SHALL append to a run's audit entries without modifying or removing an existing
    entry.

### Requirement 29: Error handling, loading states, and honest empty states

**User Story:** As a user, I want failures explained in language I understand with a code support can
trace, and I want the interface to be clear about whether data is loading, absent, filtered out, or
hidden from me, so that I am never misled by a screen.

#### Acceptance Criteria

1. THE Customer_App SHALL wrap each route module in an error boundary and SHALL provide an
   application-level fallback boundary.
2. IF a view throws during rendering, THEN THE Application_Shell SHALL continue to render and SHALL confine
   the failure to the affected view.
3. WHEN an error is displayed to a user, THE Customer_App SHALL display a support-referenceable error code
   derived from the request's correlation identifier.
4. THE Customer_App SHALL render the error code using an unambiguous character set.
5. WHERE the control plane supplied a human-readable reason for refusing a request, THE Customer_App SHALL
   display that reason as written.
6. WHILE data is loading for the first time, THE Customer_App SHALL display a skeleton matching the
   eventual layout.
7. WHILE data is refreshing in the background, THE Customer_App SHALL continue to display the current
   content and SHALL NOT display a skeleton.
8. WHEN a user submits a mutating action, THE Customer_App SHALL disable that control until the request
   settles, so that the action cannot be submitted twice.
9. WHEN a user initiates a destructive action, THE Customer_App SHALL require an explicit confirmation
   naming the affected record.
10. THE Customer_App SHALL distinguish an empty result caused by no records existing, an empty result caused
    by the active filter, and an empty result caused by the principal's permissions.
11. WHERE a data surface is empty, THE Customer_App SHALL offer the next available action or SHALL state who
    can perform it.
12. WHERE a value is not recorded by the platform, THE Customer_App SHALL state that the value is not
    recorded or not available, and SHALL NOT display a zero, a dash, or a plausible default in its place.

### Requirement 30: Honest page classification

**User Story:** As a customer, I want every screen to either work or tell me plainly that it does not, so
that I never spend time on a control that has no effect.

#### Acceptance Criteria

1. THE Platform SHALL classify every page on every surface as functional, intentionally disabled, or
   removed.
2. THE Platform SHALL record the classification of every page in a version-controlled artifact.
3. WHERE a page is classified intentionally disabled, THE Platform SHALL display a stated reason for the
   disablement on that page.
4. THE Platform SHALL NOT present any control that accepts input without a corresponding effect.
5. THE Platform SHALL NOT present a stored value as an enforced limit unless a runtime behaviour reads that
   value.
6. THE Platform SHALL remove the unlinked agent test harness page from the public surface.
7. THE Platform SHALL retain the marketing simulation page as functional and SHALL label it as a
   simulation.
8. THE Platform SHALL retain the existing content-placeholder labelling on the company page.
9. THE Platform SHALL classify as intentionally disabled, with a stated reason, the multi-factor setup page,
   the single-sign-on and directory-provisioning panels, the customer billing view, the internal billing
   view, the impersonation view, and the connections view while its routes are undeployed.
10. WHEN a page's classification changes, THE Platform SHALL update the recorded classification in the same
    change.

### Requirement 31: Preservation of existing execution semantics

**User Story:** As a platform owner, I want the restructure to leave the execution engine's guarantees
exactly as they are, so that the parts of the platform that already work correctly are not weakened by
interface work.

#### Acceptance Criteria

1. THE Execution_Engine SHALL retain its existing state machine semantics, including every resume path, without
   behavioural change.
2. THE Execution_Engine SHALL continue to re-test each step's declared verification contract against the
   result the agent reported.
3. WHEN an agent reports a success that the platform's own verification does not substantiate, THE
   Execution_Engine SHALL record a verification failure and SHALL NOT advance the run.
4. THE Execution_Engine SHALL continue to issue execution grants that bind the run, organization, workflow,
   workflow version, step, task, agent, agent type, execution target, action type, destination, and
   confirmation state.
5. THE Execution_Engine SHALL continue to verify every bound grant field against records loaded
   server-side rather than against values supplied by the caller.
6. IF a grant is presented against a scope other than the scope it was issued for, THEN THE
   Execution_Engine SHALL refuse it.
7. THE Execution_Engine SHALL admit each grant's permitted tool exactly once and SHALL refuse a second use
   of the same tool under the same grant.
8. IF a grant is presented after its validity period, THEN THE Execution_Engine SHALL refuse it.
9. THE Control_Plane SHALL continue to grant a contested task claim to exactly one agent through a
   conditional write.
10. THE Control_Plane SHALL continue to permit takeover of an expired task lease so that an unavailable
    agent does not permanently strand a run.
11. THE Control_Plane SHALL continue to return stalled leased tasks to the pool through the scheduled sweep.
12. THE Control_Plane SHALL continue to derive the execution surfaces a workflow requires from that
    workflow's steps.
13. THE Control_Plane SHALL continue to record per-step evidence containing the task identifier, agent
    identifier, grant identifier, claim time, report time, page or application, verification outcome,
    expected value, and actual value.
14. THE Control_Plane SHALL continue to accept agent heartbeats at the existing interval and SHALL continue
    to derive agent status from heartbeat recency.
15. THE Control_Plane SHALL retain the existing positive live-run status set for the concurrency ceiling, so
    that an unrecognized run status fails open.
16. THE Control_Plane SHALL NOT retry an action whose side effect could not be ruled out.
17. WHEN a run's audit entries are read, they SHALL appear in non-decreasing time order.
18. THE Test_Suite SHALL assert each preserved guarantee, so that a regression fails the build rather than
    reaching production.

### Requirement 32: Convergence of the two control-plane copies

**User Story:** As a platform engineer, I want the deployed control plane and the canonical control-plane
source to expose the same routes and the same security invariants, so that a future deployment cannot
silently reopen a closed hole.

#### Acceptance Criteria

1. THE Platform SHALL land every backend change in both control-plane copies until the canonical copy is
   the deployed copy.
2. THE Platform SHALL port the preflight route, the diagnostic executor invocation route, the agent
   snapshot derivation, and the heartbeat capability and permission handling into the canonical
   control-plane source.
3. THE Platform SHALL port the browser connection routes into the deployed control-plane template.
4. WHEN a route exists in one control-plane copy and not the other, THE Parity_Test SHALL fail.
5. WHEN a security-relevant behaviour is added to either control-plane copy, THE Platform SHALL add a
   corresponding parity invariant covering it.
6. THE Platform SHALL complete convergence before landing any subsequent backend change that this document
   requires.
7. THE Platform SHALL NOT present the undeployed target infrastructure stack as the production
   architecture in any customer-facing or internal document.
8. THE Platform SHALL retain the local engine sandbox service as a development tool and SHALL NOT deploy
   it.

### Requirement 33: Remediation of identified honesty defects

**User Story:** As a platform owner, I want each specific dishonest or misleading behaviour found during
inspection either fixed or honestly labelled, so that the platform's interface matches what it actually
does.

#### Acceptance Criteria

1. THE Platform SHALL either implement the support-messenger identity endpoint so that the messenger boots
   with a server-signed user verification value, or SHALL disable the support messenger on authenticated
   surfaces until that endpoint exists.
2. IF the support messenger identity endpoint is absent, THEN THE Customer_App SHALL NOT boot the support
   messenger with an unverified user identifier.
3. THE Customer_App SHALL remove the monetary savings figure derived from an estimated manual duration
   multiplied by a hardcoded rate from every customer-facing surface.
4. THE Control_Plane SHALL stop returning a monetary savings estimate to customer-facing surfaces.
5. THE Platform SHALL either wire the organization plan field to an enforced runtime limit or SHALL label it
   as reporting-only wherever it is displayed.
6. THE Platform SHALL either implement per-step retry attempts including a persisted attempt counter, or
   SHALL remove the retry attempt field from the workflow schema.
7. WHILE a persisted retry attempt counter does not exist, THE Customer_App SHALL NOT display a retry
   attempt count.
8. THE Control_Plane SHALL replace the permissive cross-origin response header with a per-origin allowlist
   echo, and SHALL align the gateway's permitted methods with the methods the routes actually use.
9. THE Platform SHALL move the execution grant signing secret out of the deployment template into the
   external secret store.
10. THE Platform SHALL remove or supersede the stale internal document that identifies an agent
    authorization page as the highest-priority gap, because the extension now authenticates itself.
11. THE Control_Plane SHALL provide a route that changes an existing user's platform role, so that role
    changes no longer require manual intervention.
12. THE Platform SHALL record the resolution of each remediation item in a version-controlled artifact.

### Requirement 34: Testing and live-deployment verification

**User Story:** As a platform engineer, I want isolation, authorization, lifecycle, agent, approval, and
customer relationship management behaviour proven by automated tests and confirmed against the deployed
system, so that correctness is demonstrated rather than asserted.

#### Acceptance Criteria

1. THE Test_Suite SHALL extend the existing test suites rather than introducing a parallel test stack.
2. THE Test_Suite SHALL execute backend behavioural tests against the existing in-memory database and
   in-memory user-pool harness without requiring cloud credentials.
3. THE Test_Suite SHALL seed two organizations, each with users in every role, workflows, runs in every
   status, tasks, approvals, agents of both types, connections, secrets, notifications, and audit records.
4. FOR ALL enumerated routes, THE Test_Suite SHALL assert that a principal of the first organization
   presenting an identifier belonging to the second organization receives status `404` and a response body
   containing no identifier or field value from the second organization.
5. FOR ALL enumerated routes, THE Test_Suite SHALL assert that a principal of the first organization
   submitting a body naming the second organization is refused, or, where the principal is staff, that the
   cross-organization write is recorded as an audit event.
6. FOR ALL enumerated list routes, THE Test_Suite SHALL assert on the complete returned set that no item
   belongs to another organization.
7. THE Test_Suite SHALL assert that a staff principal reading another organization's record succeeds and
   produces a cross-tenant read audit event.
8. THE Test_Suite SHALL assert that an agent credential belonging to the first organization cannot list or
   claim a task belonging to the second organization.
9. FOR ALL combinations of the six customer roles and the enumerated routes, THE Test_Suite SHALL assert
   that the route's outcome matches the centralized permission policy's decision.
10. THE Test_Suite SHALL include intentional unauthorized attempts that must each be refused with status
    `403`, covering an operator deciding an approval, a viewer starting a run, cancelling a run, inviting a
    user, and revoking an agent, a workflow builder publishing while deferred decision Q-1 is unresolved
    and setting the concurrency limit, an approver editing a workflow, an organization administrator
    setting the concurrency limit, inviting a staff role, and calling an internal route, an organization
    owner calling the artificial-intelligence execution diagnostic and the cross-organization audit route,
    any customer role calling the diagnostic executor invocation route, an operator reading another user's
    run or resolving another user's task, and a deactivated member calling any authenticated route.
11. THE Test_Suite SHALL cover the workflow lifecycle across draft, testing, published, and archived,
    including schema rejection of an invalid step graph, refusal to publish a managed-browser step with no
    active connection, an unpublished workflow becoming unrunnable, a pinned version remaining readable
    after subsequent edits, duplication producing a new draft, version list ordering, and generation from a
    plain-language description producing either a schema-valid draft or a stated validation failure.
12. THE Test_Suite SHALL cover every branch of the run state machine, including artificial-intelligence
    success and failure, allowlist rejection routed to review and allowlist rejection failing closed,
    condition branches, approval approved and rejected, confirmation required, granted, and expired, action
    success and failure with and without a failure branch, verification failure, reconciliation required
    with no automatic retry, cancellation from each cancellable status, refusal from each terminal status,
    timeout, organization execution status blocking creation, the concurrency ceiling returning a limit and
    in-flight count, an unrecognized status failing open for the ceiling, and preflight refusing a run whose
    surface is unconnected.
13. THE Test_Suite SHALL cover agent registration, re-registration reusing the installation record and
    superseding the prior credential, refusal of a superseded credential, heartbeat recording, offline
    handling after more than two missed heartbeat intervals including preflight reporting not-ready and run
    creation being refused, capability matching leaving an unmatched task pending, execution surface
    matching, contested claims yielding one winner, stalled lease reclamation by the sweep, grant scope
    mismatch, grant expiry, grant replay, and revocation ending access immediately.
14. THE Test_Suite SHALL cover approvals including approval and rejection advancing the correct branch,
    refusal of an unauthorized role, refusal of a caller from another organization, refusal of an approver
    absent from the step's permitted roles, refusal when the run is not awaiting approval, refusal of an
    already-decided step, and recording of the deciding user and role.
15. THE Test_Suite SHALL cover customer relationship management webhook handling including a valid
    closed-deal event, a duplicate delivery, concurrent duplicate deliveries, an event missing a contact
    address, an invalid payload leaving the data store unchanged, an incorrect path secret, a present but
    invalid signature, an absent signature, the subscription challenge, retry after an interrupted
    processing attempt, an unmapped stage label, reverse synchronization calls, provider unreachability at
    organization creation, and a churn stage change not implicitly changing the execution status.
16. THE Test_Suite SHALL assert per page the loading, empty, and error states, and that a section the
    principal cannot use is absent from navigation.
17. THE Build SHALL fail if the customer application bundle contains a forbidden vendor or model identifier
    string or a hardcoded secret.
18. THE Build SHALL retain the existing type checking, static export build, agent contract suites, and the
    check that the published extension archive matches its source.
19. THE Platform SHALL execute a recorded live verification checklist against the deployed system after each
    control-plane deployment and after the surface cutover, covering control-plane health, principal
    resolution, refusal of a token without an organization claim, presence of every enumerated route,
    per-origin cross-origin behaviour, a cross-organization probe, refusal of the artificial-intelligence
    diagnostic to a customer token, absence of vendor identifiers from customer-reachable responses, deep
    link reload on all three surfaces, an access-denied internal shell for a customer session, sign-out and
    history behaviour, a real browser-surface run end to end, a real desktop-surface run end to end,
    single-winner claiming across two live clients, agent termination mid-step followed by sweep recovery,
    a forced verification failure, grant replay refusal, approval and confirmation gates, organization pause
    and resume, the concurrency ceiling, preflight refusal, a real invitation acceptance and its reuse
    refusal, invitation expiry and resend, a real closed-deal event delivered twice producing one
    organization, absence of prohibited data in the customer relationship management item, correlation
    identifier traceability, absence of sensitive values from logs, and the operational metrics and alarms.
20. THE Platform SHALL identify a deployable previous control-plane revision and a promotable previous
    build per surface before each deployment.
21. THE Test_Suite SHALL report no skipped test in the verification run that gates the cutover.


---

## Deferred Decisions and Assumptions

These ten questions are carried forward from the approved design. Each requires a business or operational
decision that cannot be derived from the codebase, so none is resolved here. Where a question affects an
acceptance criterion above, the criterion is stated under the conservative assumption recorded below and
cross-referenced.

| # | Deferred decision | Conservative assumption applied in this document | Affected criteria | Needed by |
|---|---|---|---|---|
| **Q-1** | May a customer Workflow Builder **publish** a workflow, or does publishing remain with AmazFlow staff? The repository documents staff authorship by design and the create route is staff-only, while the restructure asks for a customer builder role. | Publishing remains staff-only. The Workflow Builder role holds workflow edit permission but not publish permission, and the interface states that an AmazFlow contact publishes. | 13.22, 7.11, 24.16, 34.10 | Workflow phase |
| **Q-2** | Which provider webhook configuration will be used — a signed integration app, or a board webhook created with an API token that may send no signature? | Neither is assumed. Authenticity is layered so the endpoint is safe in either configuration: the unguessable path secret is always required, and a signature is verified whenever one is present. | 25.6–25.11 | Before enabling the webhook in production |
| **Q-3** | Keep bearer tokens in browser local storage, or move to cookie-based sessions? | Local storage is retained, as it is what exists. The tradeoff is recorded rather than presented as having both properties: this choice is immune to cross-site request forgery and exposed to cross-site scripting. | 4.9–4.12, 29.x mitigations, 34.17 | Before the shared client is finalized |
| **Q-4** | Does the organization plan field gain real enforcement, or stay reporting-only? | Reporting-only, labelled as such. Maximum concurrent runs remains the only enforced limit. | 8.13, 33.5, 30.5 | Honesty hardening phase |
| **Q-5** | Implement per-step retry attempts, or remove the field from the schema? | Neither is assumed. The field is not rendered and no attempt count is displayed until a counter is actually persisted. | 16.11, 33.6, 33.7 | Honesty hardening phase |
| **Q-6** | Is staff impersonation required in this release? | Not shipped. The view is intentionally disabled with a stated reason, and the principal type reserves a field for an impersonating user so that adding it later is not a redefinition. | 23.14, 23.16, 30.9 | Internal console phase |
| **Q-7** | Do runs started from a workflow in the testing status count against the concurrency ceiling and appear in customer analytics? | Test runs are tagged so that either policy can be applied without a schema change; no counting or exclusion policy is asserted here. | 13.5, 24.13, 8.10 | Workflow phase |
| **Q-8** | What retention applies to notification records, customer relationship management event records, and expired invitation records? | No retention period is asserted. Each record type carries a time-to-live attribute so that a decided value can be applied without a data-model change. | 22.1, 25.17, 26.2 | User administration phase |
| **Q-9** | Are the production surface domains confirmed as the customer and administrator subdomains, given that identity-provider callback locations and the cross-origin allowlist must change in the same deployment? | The three origins named in Requirement 1 are treated as the intended domains. The requirement that callbacks and the allowlist change together is stated so a mismatch cannot ship silently. | 1.1–1.3, 1.8, 1.9 | Surface phase |
| **Q-10** | Is the diagnostic executor invocation route kept as a permanent staff diagnostic, or removed once the agent runtime work concludes? | Kept, restricted to staff, and labelled a diagnostic. | 23.13, 32.2, 34.10 | Internal console phase |

### Additional recorded constraints carried from the design

These are not open questions but environmental facts that bound several requirements above, recorded so
that a later reader does not mistake them for oversights.

1. Outbound transactional email beyond the identity provider's own messages cannot be delivered while the
   email service remains in sandbox mode with a single verified identity. Requirement 22.9 and Requirement
   12.6 are stated accordingly.
2. Rotating the execution grant signing secret invalidates in-flight grants, so Requirement 20.14 confines
   rotation to a window with no run awaiting an agent.
3. The deep-link rewrite configuration is currently console-only deployment state and is load-bearing for
   every deep link, which is why Requirement 1.7 requires it to be version-controlled.
4. Staff cross-organization list reads can currently be truncated, which is why Requirement 23.19 and
   Requirement 23.20 require indexed queries and, until then, an explicit truncation report.
5. The organization slug is the tenant identifier, which is why Requirement 8.14 and Requirement 8.15
   forbid renaming and reuse.
6. Every data-model change required by this document is additive to the existing single table: new sort-key
   prefixes, new document fields, one additional index, and lazy read-triggered creation of membership
   records. No requirement above authorizes a key rewrite, a record deletion, or a destructive migration.
