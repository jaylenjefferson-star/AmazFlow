# Implementation Plan: platform-restructure

## Overview

This plan implements the approved design in the order its **Phased Implementation Sequence** prescribes,
in TypeScript, inside the existing pnpm monorepo. Every phase leaves the platform working, deployable,
and no less honest than before.

Three ordering rules bind the whole plan and are visible in the Task Dependency Graph:

1. **Phase 0b (control-plane convergence) gates every later backend task.** Two divergent copies of the
   control plane exist and only one is deployed. Until they expose the same route set and the parity test
   fails on route-set asymmetry, any backend change risks landing in one copy only (design D-1, Risk R-1).
2. **`/app` and `/console` stay live and functional until the cutover.** New surfaces are added alongside
   them. The cutover (task 28.4) is a redirect plus a deprecation window, never a deletion.
3. **Execution semantics are pinned before they are touched.** The preservation guardrail tests (group 2)
   land before convergence so a regression fails CI rather than reaching production.

Deferred decisions Q-1..Q-10 are never a task's precondition. Where one applies, the task ships the
design's conservative assumption as **data** (a permission-matrix entry, a status-set value, a TTL
attribute, a stated-reason label) so the decision later changes a value, not a code path.

---

## Tasks

- [x] 1. Phase 0 — Route inventory and baseline isolation audit (tests only, no behaviour change)

  - [x] 1.1 Extract the control-plane route table into a committed fixture and gate the build on it
    - Mechanically extract every `e.routeKey` from the deployed template's inline handler and from
      `services/control-plane/src/handler.ts` into a checked-in fixture
    - Fail the build when a route exists in either handler that is absent from the fixture
    - _Requirements: 6.15, 27.1_

  - [x] 1.2 Classify every enumerated route by authentication mode and organization-scoping mode
    - Annotate each fixture entry as session-scoped, parameter-scoped, entity-identifier-scoped,
      unauthenticated, or agent-token-authenticated
    - _Requirements: 6.16, 27.1, 27.2, 27.3_

  - [x] 1.3 Build the two-organization seed fixture for the credential-free in-memory harness
    - Extend `test/harness.cjs` usage with Org A and Org B, each carrying users in all six customer roles
      plus staff, workflows, runs in every persisted status, tasks, approvals, agents of both types,
      connections, secrets, notifications, and audit records
    - _Requirements: 34.1, 34.2, 34.3_

  - [x] 1.4 Write the baseline two-organization isolation suite against today's code and record its results
    - Run the suite against unmodified handlers; commit the pass/fail baseline as a numbered defect list
    - Do not fix anything in this task — this is the audit artifact Phase 2 is measured against
    - _Requirements: 6.6, 6.7, 34.4, 34.6_

- [x] 2. Preservation guardrails — pin existing execution semantics so a regression fails CI

  - [x] 2.1 Guardrail tests for the engine state machine and every resume path
    - Assert each `resumeFrom*` guard, terminal-status immutability, and that no transition occurs outside
      the declared transition table
    - _Requirements: 31.1, 31.18_

  - [x] 2.2 Guardrail tests for execution grants
    - Assert every bound field (run, org, workflow, workflow version, step, task, agent, agent type,
      execution target, action type, destination, confirmation state) is re-checked against server-loaded
      records; assert scope mismatch, expiry, and per-tool single use are each refused
    - _Requirements: 31.4, 31.5, 31.6, 31.7, 31.8, 31.18_

  - [x] 2.3 Guardrail tests for single-winner task leases and the scheduled sweep
    - Assert one winner under contention, takeover of an expired lease, and reclamation of stalled leases
    - _Requirements: 31.9, 31.10, 31.11, 31.18_

  - [x] 2.4 Guardrail test for independent verification
    - Assert a self-declared agent success that fails the step's verification contract records
      `VERIFICATION_FAILED` and does not advance the run
    - _Requirements: 31.2, 31.3, 31.18_

  - [x] 2.5 Guardrail tests for capability-aware claiming and surface derivation
    - Assert the admission predicate's five conditions, that a desktop agent is never offered a browser
      step and vice versa, and that required surfaces are derived from a workflow's steps
    - _Requirements: 31.12, 31.18, 15.10, 15.12_

  - [x] 2.6 Guardrail tests for heartbeat-derived status, evidence, and audit append-only ordering
    - Assert heartbeat interval acceptance, status derived from heartbeat recency, the full per-step
      evidence shape, and that run audit entries are appended in non-decreasing time order
    - _Requirements: 31.13, 31.14, 31.17, 28.12, 31.18_

  - [x] 2.7 Guardrail tests for the positive live-run status set and no-retry-on-uncertain-side-effect
    - Assert an unrecognized run status is excluded from the concurrency count (fails open) and that a run
      marked unsafe to retry is never automatically retried
    - _Requirements: 31.15, 31.16, 8.11, 31.18_

- [x] 3. Phase 0b — Converge the two control-plane copies (gates every later backend task)

  - [x] 3.1 Port the preflight route into the canonical control-plane source
    - _Requirements: 32.1, 32.2, 15.18_

  - [x] 3.2 Port the diagnostic executor invocation route into the canonical source, staff-restricted and labelled a diagnostic
    - Applies Q-10's conservative assumption: kept, staff-only, labelled
    - _Requirements: 32.1, 32.2, 7.15, 23.13_

  - [x] 3.3 Port agent snapshot derivation and heartbeat capability/permission handling into the canonical source
    - _Requirements: 32.1, 32.2, 15.9, 15.3_

  - [x] 3.4 Port the browser connection routes into the deployed control-plane template
    - _Requirements: 32.1, 32.3, 20.3_

  - [x] 3.5 Extend the parity test to fail on route-set asymmetry, not only on missing regex invariants
    - A route present in one copy and absent from the other must fail the build
    - _Requirements: 32.4_

  - [x] 3.6 Add a parity invariant for each ported security-relevant behaviour
    - Establish the standing rule that any new security-relevant behaviour adds a matching invariant
    - _Requirements: 32.5, 32.6_

- [x] 4. Checkpoint — convergence complete
  - Ensure all tests pass, ask the user if questions arise.
  - Both copies expose the same route set; the guardrail suites are green. No later backend task starts
    until this checkpoint holds.

- [x] 5. Phase 1 — Authentication and session lifecycle

  - [x] 5.1 Replace the four copy-pasted auth gates with one shared session-gate component
    - Keep the passive session read and the redirecting access check as two distinct operations
    - _Requirements: 3.5, 4.5_

  - [x] 5.2 Remove the organization-claim default and fail visibly instead
    - Make session construction throw when `custom:tenant_id` is absent; make the handler produce no
      usable principal for such a token
    - _Requirements: 4.4, 6.1_

  - [x] 5.3 Implement self-service password change and confirm no operator path can set a customer password
    - `changeOwnPassword()` (access-token + current-password authorized) is now called from
      `/console/account/`, a surface gated on being signed in and nothing else — `anySignedInSurface`,
      no `requireRole` — because a role-gated password form is unreachable for the roles that need it
      most. Linked from both the customer console sidebar and the staff identity menu. The "no
      operator path" half stays asserted against the route inventory and the handler source
    - _Requirements: 4.7, 4.8, 12.2, 12.7_

  - [x] 5.4 Implement disabled-account and single-refresh-then-sign-out handling
    - One refresh attempt on an unauthenticated response, then sign out; account-disabled indication forces
      sign-out; expose the current user's identifier, organization, role, and account status
    - Control-plane half: `GET /me` reports identifier, organization, role and account status, and every
      authenticated route refuses a deactivated account with `ACCOUNT_DISABLED` (closed baseline defect
      D-4). Browser half: all four authenticated surfaces (`/console`, `/console/settings`,
      `/console/support`, `/app` via `ops/data.tsx`) now route every control-plane call through
      `apiCall()`, so the single-refresh latch and the forced sign-out are in effect for real requests.
      A source-level guardrail in auth-session.test.cjs fails if a surface reintroduces a raw
      `fetch(\`${API}…\`)`
    - _Requirements: 4.10, 4.11, 4.12, 4.13, 4.14, 4.15_

  - [x] 5.5 Implement sign-out everywhere and staff-initiated session revocation with audit
    - _Requirements: 4.16, 4.18, 4.19, 12.2_

  - [x] 5.6 Model the sign-in result as a discriminated union carrying a challenge case
    - Architecture only: no multi-factor enrolment control ships; retain the identity provider's existing
      optional software-token configuration untouched
    - _Requirements: 5.1, 5.2, 5.7_

  - [x] 5.7 Add the structured error envelope alongside the existing flat error field
    - Stable machine-readable code, displayable message, correlation identifier; keep the flat field while
      the deployed frontend still reads it
    - _Requirements: 27.12, 27.15, 27.16_

  - [x] 5.8 Auth and session test suite
    - Wrong password message identical for a nonexistent account; no role group refused; no organization
      claim refused; silent refresh; expired refresh redirecting with a reason; tampered token rejected at
      the gateway; disabled account force sign-out; revoked refresh token unusable; back-navigation after
      sign-out forcing a reload; invitation challenge handled in-page
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.9, 4.16, 4.17, 4.20, 4.21_

- [x] 6. Checkpoint — auth hardened, both existing consoles unchanged
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Phase 2 — Principal, centralized authorization, tenant scope, membership
  - All 13 sub-tasks complete. 7.5 and 7.6 were the two partials and both were closed by Phase 4 rather
    than by revisiting Phase 2: 7.5 needed the membership WRITE side (role assignment, team assignment,
    `lastLoginAt`), and 7.6 needed requirement 27.11's per-route response allowlist. Each leaf records
    which Phase 4 task closed it

  - [x] 7.1 Create the permissions package: permission union, role grants, decision function, throwing wrapper, navigation visibility
    - `packages/permissions` is the canonical copy; the deployed template carries an inline copy, kept
      honest by 31 new parity invariants **and** by P1.12, which puts the same generated cases to both
      and compares decisions — a regex check cannot catch a grant set that drifted by one entry
    - Evaluate in the design's fixed order: organization boundary, staff scope, internal namespace, role
      grant, own-record narrowing, workflow assignment
    - Represent grants as a keyed collection of permission sets so a new role key needs no change to the
      decision function
    - _Requirements: 7.1, 7.3, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.18_

  - [x] 7.2 Implement the principal type and its construction from verified claims, plus an explicit agent principal
    - Express the agent execution path's privilege elevation as its own principal type, unavailable to
      human-facing routes; reserve a field for an impersonating user
    - _Requirements: 6.11, 23.16, 4.1_

  - [x] 7.3 Implement the single sanctioned tenant-scoped read and the separately named cross-organization read
    - Three named reads, not two: `tenantRead` (organization from the principal), `crossTenantRead`
      (staff or agent, stated reason, audited) and `platformRead` (the sweep and engine internals).
      Keeping the sweep out of `crossTenantRead` is what stops "a staff member looked at another
      organization's data" from drowning in scheduler noise
    - The tenant read takes the organization from the principal, not from an argument; the cross-organization
      read requires a stated reason and records an audit event on every call
    - _Requirements: 6.3, 6.4, 6.10, 6.12, 23.18_

  - [x] 7.4 Replace every inline role comparison in both control-plane copies with one authorization call per route
    - Both copies now compare **zero** role strings for the caller's own role, enforced by a new
      source-parity check rather than trusted. Three things are deliberately outside that rule and
      documented there: `ctx.userRole` in `agentMayRunTask` (requirement 15's claiming predicate on a
      path with no human principal), the check on the role being *granted* at invitation
      (requirement 7.13), and role names inside user-facing strings
    - Move the repeated own-organization guard into the policy; leave no role comparison outside the policy
      module
    - _Requirements: 7.2, 27.4, 27.5, 6.9, 18.4_

  - [x] 7.5 Add membership records with lazy read-triggered creation and a default role derived from the coarse group
    - Backfill happens as a side effect of `principalFor()`, so the migration runs on normal use rather
      than as a batch job. `CLIENT_ADMIN → ORG_ADMIN` (not `ORG_OWNER`: nobody acquires ownership
      transfer by default) and `FRONTLINE → OPERATOR` (not `VIEWER`: that would *remove* access).
      Asserted end to end by the last three cases of the per-role suite, including that a stored role
      its group cannot reach is not believed
    - The write side, deferred here and completed by Phase 4, closes this task: `POST /tenants/{t}/users/{username}/role`
      assigns a fine role and reconciles the coarse group (task 11.5), the team routes write team
      assignment (task 11.8), and `GET /me` stamps `lastLoginAt` (task 11.7). So all three of the
      membership record's own fields are now written by a route rather than only defaulted or seeded
    - The frontend half landed with them and is the part that makes the fine role *visible*:
      `refinePrincipal()` in `apps/customer/app/session.ts` narrows or widens the claims-derived
      principal to the `platformRole` `GET /me` reports, so navigation reflects an assigned APPROVER or
      VIEWER instead of the group's default. It applies the same rule the control plane does — a stored
      role its coarse group cannot reach is NOT believed, and `STAFF_ADMIN` is unreachable from any
      customer group, so no `/me` response can turn the customer surface into a staff console
    - Membership is the source of truth for fine-grained role, team assignments, and activity timestamps;
      the identity provider stays authoritative for credentials, enabled state, and coarse group, and wins
      on disagreement with reconciliation on read — `listTenantUsers` performs that reconciliation as
      part of the read and retains the fine role, teams and timestamps while doing it
    - Existing users retain their current access on day one
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 7.4, 7.14_

  - [x] 7.6 Enforce cross-organization 404 semantics and a per-route response field allowlist
    - 404 semantics: done, and this is what closed D-1 and D-2. One additional leak was found while
      testing and fixed — the `AUTHORIZATION_DENIED` audit record carried the foreign organization's
      identifier in `details`, and `GET /audit` makes that record readable by the customer, so the
      denial audit now records `crossOrganization: true` instead of the id
    - The field allowlist, partial here and completed by Phase 4, closes this task. `RESPONSE_FIELD_GROUPS`
      plus `allowResponseFields()` give every route an explicit top-level response contract, and
      `projectRouteResponse()` applies it in `reply()`. The inversion is the point: the old
      `privateResponseFields` denylist removed three known names, so a newly added database field was
      returned automatically — a new field is now ABSENT until the route that owns it names it
    - It FAILS CLOSED, which is the half that makes it worth having: a successful response from a route
      with no declared contract returns `{}` and logs `response allowlist missing`, rather than falling
      back to returning everything. An error envelope still passes through its own small allowlist,
      because an unrecognised route's error is still useful to the person reading it
    - The nested replacer is retained on top rather than replaced: the allowlist is top-level, so
      `managedProfileId` and the session identifiers stay server-only at every depth
    - Refuse a non-staff body naming another organization; exclude every foreign identifier and field value
      from responses; scope all enumerated entity types to the request's organization
    - _Requirements: 6.5, 6.6, 6.7, 6.8, 27.11, 27.13, 27.14_

  - [x] 7.7 Record an authorization-denied audit event and metric on every denial
    - Carry the permission, resource, and decision code
    - _Requirements: 7.16, 28.6, 28.9_

  - [x] 7.8 Close the two authorization exposures convergence revealed
    - All four: `POST /ai/execute` moved into the internal namespace (it accepted **any** signed-in
      role); new organization-scoped `GET /audit` rather than widening `GET /activity`; the concurrency
      limit refused through `maySetConcurrencyLimit()`; the staff group uninvitable by anyone. Each has
      a named case in the per-role suite
    - Restrict the bounded artificial-intelligence execution diagnostic to staff; add an organization-scoped
      audit read route rather than widening the cross-organization one; refuse a concurrency-limit value
      from any customer role; refuse inviting into the staff group for every caller
    - _Requirements: 7.12, 7.13, 7.15, 6.14, 11.7_

  - [x] 7.9 Property tests for tenant isolation (Property 1) with fast-check plus the in-memory harness
    - **Property 1: Tenant isolation** — no read, write, execute, or inspect crosses an organization
      boundary through any route; cross-organization denial precedes any permission evaluation; a
      tenant-scoped query returns only own-partition items; the agent admission predicate never admits a
      foreign task
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.5, 6.6, 6.7, 6.8, 6.9, 6.11, 6.12, 7.6, 15.10, 22.8**

  - [x] 7.10 Property tests for role-based authorization (Property 2) with fast-check
    - P2.1/P2.2 parse the matrix out of design.md and compare in both directions, rather than restating
      it — a restatement would be a third copy, and three copies drift faster than two
    - **Finding for the design, not fixed here:** the matrix table has rows for `approval:decide`,
      `team:manage` and `secret:manage` but none for their read companions `approval:read`,
      `team:read`, `secret:reference`. Not silently exempted: the exemption list in P2.4 is closed and
      named, so a *new* undocumented grant still fails, and P2.4b asserts the coherence the missing
      rows would have pinned down (a role holding the write form must hold the read form). Adding
      three rows to design.md is a documentation change and is left for task 14.4
    - **Property 2: RBAC, server-enforced** — the decision function agrees with the declared matrix in both
      directions; no customer role reaches an internal permission; a forbidden action is refused at the API
      even where navigation would have offered it; the concurrency limit is unsettable by any customer role;
      the staff group is never invitable; the decision function is pure
    - **Validates: Requirements 2.1, 2.2, 7.2, 7.5, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.15**

  - [x] 7.11 Two-organization API-level isolation suite over every enumerated route
    - `isolation-api.test.cjs`, 53 cases. Distinct from the baseline suite by intent: the baseline is a
      recorded probe list that fails on drift, this walks the route inventory and *requires* every
      id-scoped and parameter-scoped route in it to satisfy isolation — so a new route has to satisfy
      it to land rather than waiting for somebody to write a probe. That completeness check found eight
      routes the first draft had missed
    - Two fixture bugs surfaced and were fixed: the seed stored browser connections under `CONNECTION#`
      while the handler reads `BROWSERCONNECTION#` (so the seeded connection was unreachable by any
      route), and the seed mapped `WORKFLOW_BUILDER` and `APPROVER` to `FRONTLINE` against design.md —
      which would have left `APPROVER` unable to decide an approval, the one thing the role is for
    - Own identifier succeeds; foreign identifier returns 404 with no foreign value in the body; a body
      naming another organization is refused or, for staff, audited; list routes asserted on the complete
      returned set; staff cross-organization read succeeds and produces a cross-tenant read audit event;
      an agent credential from one organization cannot list or claim another's task
    - _Requirements: 34.4, 34.5, 34.6, 34.7, 34.8, 23.18_

  - [x] 7.12 Per-role permission suite asserting permitted and denied outcomes for all six customer roles plus staff
    - `per-role-permissions.test.cjs`, 42 cases, every enumerated unauthorized attempt written out by
      name rather than generated — "an operator may not decide an approval" is a statement about
      separation of duties, and it deserves to fail by name. It caught a real gap:
      `POST /workflows/{id}/runs` was not behind the policy at all, so a VIEWER could start a run
    - Include every intentional unauthorized attempt the design enumerates, each returning 403: operator
      deciding an approval; viewer starting or cancelling a run, inviting a user, revoking an agent;
      workflow builder publishing under the conservative Q-1 assumption and setting the concurrency limit;
      approver editing a workflow; organization administrator setting the concurrency limit, inviting a
      staff role, or calling an internal route; organization owner calling the artificial-intelligence
      diagnostic or the cross-organization audit route; any customer role calling the diagnostic executor
      route; operator reading another user's run or resolving another user's task; a deactivated member
      calling any authenticated route
    - _Requirements: 34.9, 34.10, 2.5_

  - [x] 7.13 Expose the permission matrix as a route so the interface renders the real policy
    - `GET /permissions/matrix` serializes the same `ROLE_GRANTS` the API enforces, reporting `"own"`
      where a role holds only the narrow form — "you can cancel runs" and "you can cancel your own
      runs" are different promises. `GET /me` also now returns `platformRole` and the visible sections
    - The frontend now consumes it: `RolesView` renders the matrix response directly, so `/admin/roles`
      cannot show a policy that is not the policy. It filters out the `internal:` permissions and the
      `STAFF_ADMIN` column — neither is a customer's concern — and renders `"own"` as "Own only" rather
      than collapsing it to a yes (task 11.11)
    - _Requirements: 7.17, 11.4_

- [x] 8. Checkpoint — authorization centralized, behaviour identical for existing users
  - Ensure all tests pass, ask the user if questions arise.
  - Properties 1 and 2, the isolation suite, and the per-role suite are green; the Phase 0 baseline defect
    list is fully accounted for.
  - **Met.** 19 suites green: `aws-cdk` (8/16/24/11/9/14/16/17/25/22/20/20/30, isolation baseline
    28 pass 0 defect 1 by design, isolation-api 53, per-role 42, P1 12, P2 19, parity 128), engine 29,
    control-plane 5, web typecheck + build. The baseline defect count went 14 → 0 and
    `isolation-baseline.json` was re-recorded in the same commit, so the drift check now guards the
    fixed state
  - **Behaviour identical for existing users** rests on the default role mapping, not on inspection:
    every account today carries only a coarse group, `CLIENT_ADMIN → ORG_ADMIN` reproduces exactly
    today's tenant-admin access, and `FRONTLINE → OPERATOR` reproduces today's team-member access. Two
    routes did change for customers, both deliberately and both listed in task 7.8: `POST /ai/execute`
    (previously any signed-in role) and the refusal *status* on cross-organization ids (403 → 404)

- [x] 9. Phase 3 — Shared packages, three surfaces, and hosting infrastructure

  - [x] 9.1 Promote the staff design system into a shared user-interface package
    - Page headers, cards, tables, buttons, form fields, badges, status indicators, modals, drawers, toasts,
      skeletons, empty states, error states — one module, both surfaces render from it
    - `packages/ui` (`@amazflow/ui`) holds `primitives.tsx` and `icons.tsx`, moved with `git mv` rather than
      reimplemented: they already carry the three-state discipline Phase 13's honesty work depends on, and a
      rewrite would have produced a second set of states to keep in agreement
    - `ops/primitives.tsx` and `ops/icons.tsx` are now re-export shims, so all twelve `/app` views and the
      customer console are untouched by the move. Task 28.4 retires the shims with the rest of `/app`
    - Styling stays in `ops.css`, which each surface imports. Named as a real coupling: a surface without the
      stylesheet renders unstyled markup rather than failing the build
    - _Requirements: 3.1_

  - [x] 9.2 Promote the label mapping and the run-narrative model into a shared domain package
    - Exactly one enumeration-to-label mapping and exactly one run-narrative model in the repository; delete
      the duplicate customer status and provider maps once the new surfaces read the shared ones
    - `packages/domain-ui` holds `terms.ts` and `run-model.ts`. The duplicates in `console/copy.ts` are
      **deleted**: its run-status `switch`, its `STAGE_LABELS`, its `roleLabel`, and its
      `PROVIDER_BACKEND_LABELS` are gone
    - The customer *phrasings* are kept, as a second REGISTER of the one enumeration
      (`CUSTOMER_RUN_STATUS_LABEL`, `CUSTOMER_STAGE_LABEL`, `CUSTOMER_ROLE_LABEL`,
      `PROVIDER_BACKEND_LABEL`), because an operator wanting the status and a customer wanting to know what
      is happening to their work are genuinely different needs. Two registers, one enumeration:
      `runStatus(status, "customer")` reads whichever register the surface asks for, so a status added in one
      place cannot go missing from the other. That was not true before — the two maps had already diverged on
      which statuses exist, and the customer's reading is the one that becomes true for them
    - _Requirements: 3.2, 3.3, 16.5_

  - [x] 9.3 Create the typed API client package with session handling and correlation-identifier propagation
    - Applies Q-3's conservative assumption: bearer token in a header, existing storage retained
    - `packages/api-client` never imports Cognito. It takes a `SessionTransport` (`refresh`, `endSession`,
      `persist`) and the surface supplies one, so the refresh-exactly-once and deactivated-account
      behaviours are testable with no network and no user pool — 9 unit tests, including that a second 401
      after the retry ends the session rather than looping
    - Correlation identifier propagates both ways: sent as `x-correlation-id`, read back off the envelope,
      and `supportCode()` derives the six-character `ERR-XXXXXX` form with the ambiguous characters removed
      so a person can read it down a phone line
    - `apps/web/app/lib/api-client.ts` is now the Cognito adapter and keeps `apiCall`'s exact signature, so
      every existing `/app` and `/console` caller is unchanged
    - _Requirements: 27.12, 28.1, 28.2_

  - [x] 9.4 Generalize the shared data provider
    - 15-second refresh, suspended while the tab is hidden, immediate refresh on return, per-resource error
      isolation so one failed resource does not blank a surface
    - `useResources(client, principal, specs)` takes the resource list as a PARAMETER; the rules live in the
      package. A resource whose permission the principal lacks reports `unavailable` rather than being
      requested and refused, so a surface never renders a 403 the person cannot act on
    - A failed refresh keeps the previous value rather than resetting to empty: stale data with a visible
      error beats no data. `Promise.allSettled`, not `all` — `ops/data.tsx` was switched to the same, since
      one rejection aborting the batch is exactly how a single 403 blanks a page
    - _Requirements: 3.11, 3.12, 29.7_

  - [x] 9.5 Generalize the declarative route table and permission-filtered navigation
    - Exactly one route table per surface with no inline path-to-view mapping alongside it; navigation built
      by filtering the route table through the permission policy; a section with no permission is omitted,
      except where omission would be confusing, in which case it is shown with a stated reason
    - One `RouteDef` per route carries path, label, entity, permission, group, glyph, badge and shortcut.
      `ops/router.ts`'s five parallel records (`SECTION_PATH`, `SECTION_LABEL`, `SECTION_ENTITY`,
      `NAV_GROUPS`, `GOTO_KEYS`) are now DERIVED from one table, with their exported shapes unchanged so
      `shell.tsx` and `command-palette.tsx` needed no edit
    - `/app`'s navigation is deliberately not permission-filtered: every principal who reaches it is staff
      holding every internal grant. Its rows carry their permission anyway, which is what task 21.1's port
      to the internal console will read
    - A real bug the tests caught: alias resolution iterated in insertion order, so `/console/` matched
      before `/console/runs/` and every legacy deep link landed on home with the rest of the path mistaken
      for an entity id. Aliases are now matched longest-first, like the routes
    - 13 tests, including that navigation and enforcement cannot disagree for any of the six customer roles
    - _Requirements: 3.4, 3.6, 3.7, 3.8, 7.17_

  - [x] 9.6 Scaffold the customer application shell
    - Organization display name, breadcrumbs, notification indicator, user menu; usable layout at 1024
      pixels and above; the customer route map from the design
    - `apps/customer` at `app.amazflow.com`. `page.tsx` is the gate, the route dispatch, and the data
      wiring and nothing else: the route table is in `routes.ts`, the shell in `shell.tsx`, the route
      modules in `views.tsx`, the polling in `@amazflow/domain-ui`, every authorization decision in
      `@amazflow/permissions`
    - The organization DISPLAY name comes from `GET /me`, with the identifier as the fallback — never the
      slug dressed up as a name. An account with no organization claim renders its own state and names a
      real person to ask, because the alternative shipped for months as a silent default to the staff tenant
    - Ten route modules are wired. The eleven Phase 4+ sections are declared in the table (so navigation is
      complete and deep links resolve) and are named in a test assertion rather than passing silently — 11.4,
      11.6, 11.8, 11.11–11.14 fill them
    - _Requirements: 3.9, 3.10, 1.2_

  - [x] 9.7 Scaffold the internal console shell with a data-free access-denied state
    - A principal outside the staff group renders a shell containing no organization data from any tenant
    - "Data-free" is the load-bearing word, and it is stronger than a filtered view: `AccessDenied` renders
      INSTEAD of the provider, so `useResources` is never mounted, no read is issued, and no tenant record
      is ever in the page's memory. Asserted against the rendered markup, not against the intent
    - The page names the caller's own organization and no other. A message reading "this is for staff, you
      are org X of Y" would leak the shape of the tenancy in order to make a point about it
    - Design decision D-2 is restated in the file: a static bundle is not a security boundary, the control
      plane is. A separate origin is defence in depth and anti-confusion
    - _Requirements: 1.3, 2.3, 2.4_

  - [x] 9.8 Add the three surface entries to the hosting build configuration
    - Marketing plus authentication pages, customer application, internal console, all built from the one
      monorepo, all retaining static export
    - `amplify.yml` now declares three applications. Each build ends in `test -f out/index.html`: a static
      export can fail to emit anything and still exit 0, and deploying an empty artifact takes a surface
      down while reporting success
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 9.9 Commit the deep-link rewrite configuration for each surface as version-controlled infrastructure
    - Currently console-only deployment state and load-bearing for every deep link (Risk R-4); a hard reload
      or direct navigation to any deep link must serve the shell and resolve the route
    - `infrastructure/hosting/{amazflow.com,app.amazflow.com,admin.amazflow.com}.json` plus a README that
      states what each rule is for and how to apply it. Applying is a deliberate command, not a build step:
      a wrong rewrite rule takes a surface down and should not be able to arrive as a side effect of a push
    - The marketing origin gets per-section rules rather than a catch-all, and this is the substantive
      decision. `amazflow.com` serves real exported pages, so a catch-all there would answer 200 with the
      home page for every mistyped URL and dead link — destroying the 404 signal link checkers, search
      engines, and support tickets all rely on. Its rules name `/app` and `/console` and leave the rest alone
    - The asset-extension exclusion is not cosmetic: without it the rewrite swallows `/_next/static/...`
      and the surface renders blank while the network tab shows 200s for everything
    - _Requirements: 1.6, 1.7_

  - [x] 9.10 Replace the permissive cross-origin header with a per-origin allowlist echo and align gateway methods
    - Echo exactly one requesting origin from the three-surface allowlist; omit the origin otherwise; accept
      the methods the routes actually use (remediates H-5)
    - Both halves, because they answer different requests: the gateway's `AllowOrigins` answers the
      preflight, `reply()`'s echo answers the actual request, and `*` from either one is the header
      requirement 1.8 exists to remove. An unlisted origin gets NO header rather than a refusal — the
      browser then refuses the read itself, which is the correct shape
    - `vary: origin` ships with it. The response now differs per origin, and without it a cache in front of
      the API can serve one surface's body to another
    - Stated plainly rather than minimised: `*` was not directly exploitable, because bearer-token auth means
      a drive-by page cannot obtain a token. But that is a property of the auth scheme, and the header
      outlives the scheme
    - `AllowMethods` was already aligned in Phase 0b and the parity suite's CORS-vs-methods check keeps it so
    - _Requirements: 1.8, 1.9, 1.10, 33.8_

  - [x] 9.11 Update identity-provider callback and sign-out locations in the same template change as the new origins
    - Applies Q-9's conservative assumption: the three named origins are the intended domains; a mismatch
      between callbacks and the cross-origin allowlist must not be able to ship separately
    - "Must not be able to" is the requirement, so it is enforced rather than remembered: a new
      ORIGIN ALLOWLIST COHERENCE section in `source-parity.test.cjs` asserts that the gateway's allowlist and
      the handler's `ALLOWED_ORIGINS` are the same set, that every callback and sign-out URL's origin is on
      that list, that all three surfaces have a callback URL at all, and that the legacy `/app` and
      `/console` callbacks are retained until the task 28.4 cutover
    - Each of those three lists is silent about the other two, which is why they drift: a callback URL whose
      origin is not allowlisted authenticates and then cannot call the API, and an allowlisted origin with no
      callback URL cannot sign in. Neither is visible from the side that has it right
    - _Requirements: 1.1, 1.2, 1.3, 1.8_

  - [x] 9.12 Keep the previous surface paths functional with legacy route aliases
    - No previously reachable route is removed until its replacement is live and a deprecation window has
      elapsed
    - `CUSTOMER_ALIASES` maps all six `/console` paths and `INTERNAL_ALIASES` all fifteen `/app` paths onto
      the sections that replaced them, entity id and query string preserved, so a bookmark or an emailed run
      link lands on the right screen. `/app/clients/` resolves as well as `/app/customers/`: a deprecation
      window that only honours the most recent rename is not a deprecation window
    - Both surfaces themselves stay live. This table is what makes the eventual redirect land somewhere
      correct rather than on a home page that loses the person's place
    - _Requirements: 1.11_

  - [x] 9.13* Route-level rendering tests for the new shells
    - Loading, empty, and error states per route module; a section the principal cannot use is absent from
      navigation
    - 19 tests (9 customer, 10 internal) rendering each route module through `react-dom/server`. Driven by
      the module list rather than written per view, so a new view without an error branch fails here instead
      of being noticed in production when a read starts failing
    - `unavailable` is asserted NOT to render as an error. A role restriction shown as a system failure sends
      somebody to support about a working system
    - Navigation and enforcement are asserted unable to disagree for all six customer roles, in both
      directions — and the "nothing is offered" degenerate pass is excluded by requiring a VIEWER to still
      be offered Runs
    - _Requirements: 34.16, 3.7_

- [x] 10. Checkpoint — three surfaces serve, old surfaces still work
  - Ensure all tests pass, ask the user if questions arise.
  - **Met.** `aws-cdk` 19 suites green (524 assertions, 0 failures) including the new ORIGIN ALLOWLIST
    COHERENCE section and 5 new CORS parity invariants; `customer` 9 and `internal` 10 rendering tests;
    typecheck and static export build green for all three surfaces
  - One pre-existing guardrail had to follow its behaviour rather than be deleted: task 9.3 moved the
    single-refresh latch and the `ACCOUNT_DISABLED` handling into `@amazflow/api-client`, so
    `auth-session.test.cjs` was still reading the old location. It now asserts the latch in the shared
    package AND that the web adapter goes through `createApiClient` and issues no `fetch` of its own —
    which is a stronger check than the one it replaced, since it catches a fourth copy as well as a
    missing latch
  - **Old surfaces still work** is not an assumption: `/app` and `/console` keep their Cognito callback
    URLs (asserted), keep their origin on the CORS allowlist, keep their rewrite rules, and every path
    they serve resolves through the alias tables (asserted). The cutover is task 28.4

- [x] 11. Phase 4 — Organization, users, teams, invitations, personal settings

  - [x] 11.1 Extend the organization record additively
    - Retain existing fields unchanged; add primary domain, primary contact, billing contact, internal
      account owner, customer-relationship-management reference, activation timestamp, denormalized
      onboarding status, and the internal-only commercial lifecycle status; keep the logo location inside
      branding without duplicating it
    - Every field is additive: nothing renames or moves an existing one, and the logo location stays inside
      `branding` rather than being mirrored at the top level, because two places holding the same URL is
      two places to disagree about which one the sign-in screen reads
    - The commercial lifecycle status is a SEPARATE field from the execution status, and that separation is
      the point of requirement 8: a sales stage must never gate execution. `canceled` commercially and
      `active` operationally is a legitimate state — a customer in their notice period is still entitled to
      have their work run
    - `INTERNAL_ORG_FIELDS` are stripped by ENTITY rather than by route (`organizationFor`), so a new route
      reading an organization cannot forget. An organization admin reading their own record must not receive
      AmazFlow's internal note that they are commercially `canceled`, and the frontend half is asserted too:
      a rendering test fails if the organization view emits `lifecycleStatus` or its value
    - Absent commercial lifecycle status reads as commercially active
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.12_

  - [x] 11.2 Enforce slug immutability and slug uniqueness without reuse
    - The slug is the tenant identifier; reject any change; generate unique slugs that never reuse a former
      organization's slug
    - Non-reuse needs a record that OUTLIVES the organization, so `SLUGRESERVED#` entries are written at
      creation and never deleted. Checking the live organizations would let a deleted organization's slug be
      handed to a new one, and every historical audit record, run and token carrying that slug would then
      read as belonging to the new tenant
    - The immutability half is refused with a stated reason rather than silently ignored, and the customer
      surface offers no slug field at all — asserted, since a form that accepts a value the API refuses is
      worse than one that never offered it
    - _Requirements: 8.14, 8.15_

  - [x] 11.3 Wire the execution-status gate, the concurrency ceiling, and lifecycle audit events
    - Paused or suspended refuses run creation with a stated reason while still admitting administration
      including invitation; returning to active restores run creation; exceeding the ceiling responds 429
      with the configured limit and the in-flight count; an unrecognized status is excluded from the count;
      status changes record previous and new values
    - The gate is on run creation only. Administration stays open deliberately: an organization that cannot
      run work can still need to remove somebody's access, and locking them out of that would make a pause
      into an incident. Invitation is the one exception, and only for `suspended`
    - The 429 carries `limit` and `inFlight` because "try again later" without a number is not actionable —
      a person needs to know whether to wait a minute or ask for the ceiling to be raised
    - The customer surface states the ceiling and names it as staff-set, and offers NO control for it:
      `maySetConcurrencyLimit` is staff-only, and an organization that can raise its own ceiling has no
      ceiling. A zero reads as "No configured ceiling" rather than as a limit of zero
    - _Requirements: 8.4, 8.7, 8.8, 8.9, 8.10, 8.11, 8.16_

  - [x] 11.4 Build the organization administration view with branding validation
    - Read and update profile, settings, and branding; validate the accent colour as a six-digit hexadecimal
      value; accept a logo location only over a secure scheme and reject unsafe locations
    - Three separate writes to three separate routes (`/profile`, `/settings`, `/branding`) rather than one
      save button over one merged body. They have different permissions (`org:settings` vs `org:branding`)
      and different failure modes, and a single save that half-succeeds leaves a person unable to tell which
      half
    - Validation is client-side AND server-side, and the client-side half exists to give the reason before
      the round trip, not instead of it: an accent must be `#` plus six hexadecimal digits, and a logo
      location must parse as a URL whose protocol is `https:` — a stated refusal, not a silently dropped field
    - Every stored value is rendered into its field, asserted field by field. A field rendered empty while a
      value is stored is one save away from erasing it, and that is the failure mode a form over a partial
      read has
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 11.5 Add the user role-change, invitation resend, and pending-invitation revoke routes
    - Role change writes the membership role and reconciles the coarse group; refuses the staff group;
      refuses leaving the organization without an owner. Revoke applies only before the initial password
      challenge completes and disables rather than deletes. Preserve the existing invitation guards
      verbatim: allowed email domains, duplicate member, address in another organization, suspended
      organization refused, paused organization allowed, group-add failure reported as retry-the-invitation
    - The two-system write is ordered so that failure is recoverable: the new coarse group is ADDED before
      the old one is removed, and a failed removal rolls the addition back and preserves the fine role. The
      other order leaves a person in no group at all, which means unable to sign in — asserted by a fault
      injection case rather than reasoned about
    - Remediates H-8 (no route existed to change a role)
    - _Requirements: 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13, 9.14, 9.15, 9.16, 9.17, 9.18, 9.19, 9.20, 9.24, 33.11_

  - [x] 11.6 Build the users view with derived states and honest absent values
    - Derive invited, active, or deactivated from identity-provider status, the enabled flag, and membership;
      state that removal is performed by deactivation to retain audit attribution; display that last sign-in
      is not recorded rather than a zero or a placeholder date
    - The control plane already derives the state AND reconciles the membership as part of the read, so the
      surface prefers the server's `state` and keeps its own derivation only as the fallback for a response
      that predates the field. Two places deciding who is deactivated is two places to disagree about whose
      access was removed
    - Search over address and username, plus filters on account state and on role. The role options come
      from `CUSTOMER_ROLES` in `@amazflow/permissions`, not from a list written into the view, so the filter
      cannot offer a role the policy does not have. A filtered-to-empty list says how many people exist
      rather than reading as an empty organization
    - The role control is offered for ACTIVE accounts only: a role assigned before the initial password
      challenge completes is a role on an account that may never exist. Resend and revoke are offered for
      invited accounts only; deactivate and reactivate are mutually exclusive by state
    - Absent last sign-in renders the words "Not recorded". Most accounts genuinely have none, because
      `lastLoginAt` is only written from task 11.7 onward, and a placeholder date is a lie a support
      conversation gets built on. Asserted, along with the absence of any delete control
    - Every mutation control is asserted ABSENT for a VIEWER — which holds `user:read` and nothing else
      about users — in the same render that asserts them present for an administrator. A control the API
      refuses is worse than a missing one: it reads as a broken product rather than as a boundary
    - _Requirements: 9.16, 9.21, 9.22, 29.12_

  - [x] 11.7 Record the sign-in timestamp on the membership record
    - Stamped in `GET /me` rather than on every authenticated route. `/me` is the first call every surface
      makes, and a write per request would make the membership record the hottest key in the table in order
      to record a value nobody reads more precisely than "today"
    - _Requirements: 9.23_

  - [x] 11.8 Add team records, team routes, and the teams view
    - Create, rename, delete, add and remove members, all organization-scoped, all audited; the policy
      accepts a team identifier without any grant depending on it; the view states that team membership
      grants no permissions in this release and presents no team permission control
    - `GET /teams` returns `grantsPermissions: false` and its reason IN THE PAYLOAD, not only in interface
      copy, so any client rendering this cannot present teams as an access control by omission. The view
      states it too, and a test asserts both the statement and the absence of any per-team permission control
    - Team membership is offered from the real people list, so a team cannot be given a member who is not in
      the organization. Delete and remove confirm first, because both silently change what somebody sees
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [x] 11.9 Add the invitation record and the tokenized acceptance entry point
    - High-entropy token stored only as a hash; organization, invited address, granted role, inviting user,
      creation and expiry timestamps, and state persisted; seven-day default expiry; unauthenticated
      inspection returns only the organization display name and invited address, with expired returning 410
      and already-accepted returning a state conflict
    - Inspection is unauthenticated because the recipient has no session yet, which is exactly why its
      response is two fields: the organization's display name and the address it was sent to. Anything more
      turns a leaked link into a directory of who was invited to what
    - 410 rather than 404 for expired, and this distinction is load-bearing on the surface as well as the
      wire: "this existed and has expired" sends a person to ask for a new one, while "no such invitation"
      sends them to hunt for a typo that is not there. The three outcomes render as three different screens
      with three different next actions, asserted
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6, 26.7, 4.20_

  - [x] 11.10 Make acceptance single-use, server-resolved, and rate-limited
    - Verify token hash, state, expiry, and that the authenticated caller's address matches the record;
      transition by conditional write on the pending state so concurrent accepts yield one winner; resolve
      organization and role from the stored record and ignore any supplied in the body; resend issues a new
      token and revokes the previous one; rate-limit inspection and acceptance; audit every transition
    - Server-resolved is visible in the client shape: acceptance is a POST with NO body at all, because
      there is nothing a client could send that the server would believe. The surface also refuses to let a
      signed-in person accept an invitation addressed to somebody else, and says which account to use
    - _Requirements: 26.8, 26.9, 26.10, 26.11, 26.12, 26.13, 26.14, 26.15, 26.16, 26.17, 26.18, 26.19_

  - [x] 11.11 Build the roles view from the real permission matrix, with custom role editing honestly disabled
    - Custom role creation is not offered in this release; the panel states its reason rather than accepting
      input
    - Rendered from `GET /permissions/matrix`, which serializes the same `ROLE_GRANTS` the API enforces, so
      this screen cannot show a policy that is not the policy. `"own"` is rendered as "Own only" rather than
      as a yes: "you can cancel runs" and "you can cancel your own runs" are different promises, and
      collapsing them is how a person discovers the difference by being refused
    - The `internal:` permissions and the `STAFF_ADMIN` column are filtered out — neither is a customer's
      concern, and showing a column nobody in the organization can hold invites the question of who can
    - No input of any kind, asserted. A custom-role form would accept a role nothing enforces
    - _Requirements: 11.4, 11.5, 7.19, 30.3, 30.4_

  - [x] 11.12 Build the security view and ship the honest disabled states for planned identity capabilities
    - Display the platform's actual session lifetime, password policy, and registered agent credentials;
      present the multi-factor setup page and the single-sign-on and directory-provisioning panels as
      intentionally disabled with stated reasons; present no control that accepts input without effect
    - The facts come from `GET /security/facts`, which reports the lifetimes and password rules the platform
      actually enforces rather than the ones a settings page would claim. The registered agent list shows
      what is registered and never a credential value
    - Each disabled capability states a SPECIFIC reason, not "coming soon": multi-factor because the
      identity provider supports software tokens but AmazFlow has not shipped the enrolment and recovery
      flow; single sign-on because federated first sign-in has nowhere to get the organization claim and
      coarse group from; directory provisioning because it depends on a membership synchronisation flow that
      does not exist. A vague reason is indistinguishable from a stalled feature
    - Asserted to render no checkbox at all. A greyed-out toggle still tells a person their input nearly
      counts, which is the impression the `plan` field (H-3) left for months
    - _Requirements: 11.6, 5.3, 5.4, 5.5, 5.6, 5.7, 30.3, 30.4, 30.9_

  - [x] 11.13 Build the organization-scoped audit view and the honestly disabled billing view
    - Audit reads through the organization-scoped route; billing states that no billing system exists,
      displays the recorded plan value and the commercial contact route, and presents no control that
      accepts input
    - Audit reads `GET /audit`, which reads the caller's OWN partition — that route exists so this screen
      never needs the cross-organization `GET /activity` widened to serve it (requirement 6.14). The action
      filter's options are DERIVED from the records that came back, because a hardcoded list offers filters
      matching nothing and omits actions the platform has started recording, and both read as a broken trail
    - Billing shows the recorded plan and the recorded commercial contact, and states plainly that the plan
      value is reporting-only with no runtime limit reading it. An absent plan and an absent contact are
      each stated as absent rather than filled with a plausible default — an invented `billing@` address is
      a dead end somebody sends an invoice query to. No input, asserted
    - _Requirements: 11.7, 11.8, 11.9, 30.3, 30.4, 30.9_

  - [x] 11.14 Build personal settings: profile, security, and notification preferences
    - Every accepted preference is persisted; no setting is presented whose value is not stored; the
      notification view states that email delivery is not offered in this release and presents no email
      toggle
    - Profile writes `PUT /me/profile`, which takes the target account from the verified session. The
      sign-in email is rendered read-only and is not changed from this route
    - Password change goes to the identity provider with the access token and the current password, and only
      then calls the self-scoped `POST /me/password-changed` to record the audit event. That split is
      requirement 4.8 made structural: there is no route on the control plane that sets a customer password,
      so no operator path can exist. The unmet policy rules are named as the person types rather than after
      they submit
    - "Sign out everywhere" revokes every session including this browser and says so before it is used. The
      surface also states that a device-by-device session list is NOT recorded, rather than rendering an
      empty table that reads as "you have no other sessions"
    - Preference toggles are generated from the `keys` the API returns, so the page cannot present a setting
      the platform does not store. There is no email toggle and the absence is stated — asserted as the
      absence of any email control, not as the absence of the word
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 22.9_

  - [x] 11.15 Property tests for invitation single-use and expiry (Property 5) with fast-check
    - **Property 5: Invitation single-use and expiry** — accepted at most once under any interleaving; an
      expired invitation is never accepted; organization and role come from the stored record even when the
      request body claims otherwise; resending invalidates the previous token
    - **Validates: Requirements 26.8, 26.9, 26.10, 26.11, 26.12, 26.13, 26.14, 26.15, 26.17, 34.14**

  - [x] 11.16 Add the time-to-live attribute to notification, customer-relationship-management event, and expired invitation records
    - Applies Q-8's conservative assumption: the attribute exists so a decided retention value needs no
      data-model change; no retention period is asserted
    - The retention values default to 0, which means no time-to-live attribute is written at all. That is the
      conservative direction: a wrong non-zero default silently deletes a customer's audit-adjacent records,
      while a wrong zero costs storage and is reversible by setting one environment variable
    - _Requirements: 22.1, 25.17, 26.2_

- [x] 12. Notifications

  - [x] 12.1 Persist notifications and per-user read state within the organization they concern
    - Audience, kind, title, body, deep link, creation timestamp; the eight required kinds; read state per
      user and per notification
    - Read state is a separate `NOTIFREAD#{username}#` record rather than a field on the notification, so a
      notification addressed to a role or a team can be read by one person without being marked read for
      everyone. Audience is a string, not a user id, so one notification can address a person, a role, a
      team, or the whole organization
    - Scoping holds by CONSTRUCTION rather than by a filter somebody has to remember: the list is a
      `tenantRead`, so it is partitioned on the principal's own organization before any filtering happens
    - _Requirements: 22.1, 22.3, 22.6, 22.8_

  - [x] 12.2 Create notifications only where the corresponding platform event is also recorded
    - So no notification can exist for an event that did not occur
    - Enforced as a coupling, not a rule: there is no `notify()` to call on its own. The only way to produce
      a notification is `logActivity(tenantId, entry, notification)`, which writes the audit record first
      and the notification second. The notification is best effort while the audit record is not, and that
      asymmetry is deliberate — an event recorded without its notification is a missed nudge, while a
      notification with no event sends somebody looking for work that never happened
    - _Requirements: 22.2_

  - [x] 12.3 Build the notification indicator, list, and read routes
    - Unread count, creation time, deep link navigation, mark one read, mark all read; no email delivery
    - The indicator renders the count only once it is KNOWN. An unloaded count shown as 0 is a claim that
      nothing is waiting, which is a different statement from "not known yet" — so `null` renders no badge
      at all rather than a zero
    - Opening a notification marks it read and only then follows its deep link, and the link is resolved
      through the one route table, so `/console/runs/{id}/` from an older record still lands on the run
      rather than on Home with the identifier mistaken for something else. Asserted for every deep link shape
    - "Mark all read" is disabled when nothing is unread rather than issuing a write with nothing to write.
      Both states are asserted, since an always-enabled control and an always-disabled one both pass a test
      that only looks for the label
    - No email delivery anywhere, and the preferences page states that rather than offering a dead toggle
    - _Requirements: 22.4, 22.5, 22.7, 22.9_

  - [x] 12.4* Notification scoping and read-state tests
    - READ-STATE (22.6): `phase4-administration.test.cjs` asserts that the list honours audience and
      stored preferences, that every visible notification starts unread, and that mark-all writes a read
      record for exactly the visible, preference-enabled notifications and no others
    - SCOPING (22.8): `GET /notifications` and `GET /teams` are now enumerated in the list-route set in
      `isolation-api.test.cjs`, and the two-organization seed carries teams plus three notifications per
      organization addressed three different ways (everyone, one person, one role). Property 1 covers
      `tenantRead` generally, but that argument only says the CURRENT implementation is partitioned —
      with Org B's records seeded and asserted against, a change that swapped `tenantRead` for a scan
      now fails here. The list probe also asserts each route returned at least one row, so an empty
      list cannot satisfy it vacuously
    - The same completeness guard covers the ten Phase 4 identifier-taking routes that had entered the
      inventory unprobed: the five team routes, the notification read route, the three invitation and
      role routes under `/tenants/{tenantId}/users/{username}`, and `POST /organizations/{slug}/profile`.
      `POST /invitations/{token}/accept` is recorded as a special case with its own isolation argument —
      the path parameter is a single-use secret, not a substitutable identifier — and is asserted to
      refuse an unknown token without naming an organization and to create nothing in an organization
      named only by the request body
    - _Requirements: 22.8, 22.6_

- [x] 13. Checkpoint — organization and user administration complete
  - The complete control-plane suite passes (inventory, seven guardrail suites, nine behaviour suites,
    three property suites, source parity, provider parity), plus the engine, customer, internal,
    domain-ui, api-client and both agent contract suites
  - Closing this checkpoint required fixing four response-allowlist defects that task 7.6 introduced and
    no Phase 4 test could see, because the allowlist fails closed by STRIPPING rather than by refusing.
    Each was a route borrowing another route's field group and silently losing what it did not share:
    `GET /workflows/{id}/preflight` lost `surfaces` (the entire readiness answer); `GET /agent/tasks`
    lost `input`, `expiresAt` and `destination`, so no agent could execute anything it was offered;
    `POST /agent/tasks/{id}/claim` lost `task`, `grantId`, `verify` and `display`, which breaks
    execution and both agent interfaces at once; `GET /agents` lost `organizationId` and `lastSeenAt`,
    reporting a live agent as never connected in the existing staff console. Preflight, the claim
    envelope and the agent snapshot now have their own contracts in both copies, each pinned by a
    source-parity invariant so a narrower one cannot return on one side only

- [x] 14. Phase 5 — Workflows, the single status model, and the builder

  - [x] 14.1 Extend the workflow status set without renaming the published wire value
    - Persisted set becomes draft, testing, active, archived, where active denotes Published and remains the
      value the run gate reads; the Published label lives in the shared label mapping; legacy paused records
      display as Archived and are never written again
    - `active` is deliberately NOT renamed. It is the value the run gate, `preflightFor` and the
      managed-connection check all read, so renaming it to `published` would rename the one string the
      whole execution path depends on in exchange for a word on a screen. `WORKFLOW_STATUSES` in both
      control-plane copies, `workflowDefinitionSchema` and `terms.ts` all carry the same four members
    - `paused` stays PARSEABLE and is never written again. Dropping it from the schema would make every
      stored record carrying it fail validation, so a workflow that is merely old would read as corrupt
      and disappear from its owner's list instead of displaying as Archived. The retired value is now
      refused by name on `POST /workflows` and removed from the Copilot status tool's vocabulary — that
      tool was the last remaining writer of it
    - The display half is wired: `WorkflowsView` renders through `workflowStatus()` rather than printing
      the stored string, so `active` reads as Published and `paused` reads as Archived. Asserted in
      `views.test.tsx` in both directions — the stored value must not reach the screen, and "Paused" must
      not be presented as a state somebody could act on when no control will ever un-pause it
    - _Requirements: 13.1, 13.2, 13.3, 3.2_

  - [x] 14.2 Add the customer draft write route
    - Writes a definition only into the caller's own organization; validates against the existing definition
      schema including step-reference integrity, provider allowlisting, and surface-to-action pairing;
      responds 422 with the reason without persisting on failure; cannot set the published status
    - `POST /workflows/{id}/draft`, `workflow:edit`. The organization comes from the resolved RECORD when
      editing and from the PRINCIPAL when creating — never from `body.tenantId`, which is what
      `POST /workflows` reads because it is staff
    - The first version created whatever identifier was addressed, and the two-organization isolation probe
      caught it: naming another organization's workflow id produced a new workflow carrying that id inside
      the caller's own organization. Nothing crossed the tenancy boundary, but the caller had planted a
      foreign identifier in its own list, and a caller-chosen id is also free to collide with a future
      server-minted one. Creation is now only under the reserved `new` value; any other addressed
      identifier must already exist under the caller's own scope, so a foreign id and an absent one are
      both 404
    - `validateWorkflowShape` gained the two checks requirement 13.9 names and did not have: provider
      allowlisting against the definition's own `allowedProviders`, and surface-to-action pairing (a
      desktop operation on a browser step, or an `executionTarget` contradicting the provider). Without
      the second, a mismatched step saved cleanly and failed much later as an agent that is offered work
      it has no capability for and simply never claims
    - _Requirements: 13.8, 13.9, 13.10, 13.11_

  - [x] 14.3 Add publish, unpublish, duplicate, and archive transitions with their audit events
    - Publish re-runs the managed-connection availability check and refuses with a state conflict when a
      managed-browser step has no active connection; unpublish returns to draft and makes the workflow
      unrunnable; duplicate produces a new draft with a new identifier; archive makes the workflow
      unrunnable
    - The connection check is RE-RUN at publish rather than trusted from the draft, because a connection
      can be revoked between authoring and publishing. A managed-browser step whose connection is gone
      does not fail at publish — it fails at run time, against a customer's real system, having already
      told them the workflow was live. Asserted for all four gap reasons: no connection named, a
      connection that no longer exists, one that is pending, and one revoked after authoring
    - A duplicate arrives as `draft` at version 1 with a new identifier, never as a copy of the publish
      state: a duplicate that arrived published would put an unreviewed copy in front of real systems
    - Each transition records its own audit event carrying the workflow, the version, and the status it
      came from
    - _Requirements: 13.12, 13.13, 13.14, 13.15, 13.16, 13.23_

  - [x] 14.4 Encode the publish permission as a matrix entry and state the current publishing route in the interface
    - Applies Q-1's conservative assumption: publish is staff-only, the builder role holds edit but not
      publish, and the interface states that an AmazFlow contact publishes rather than showing a control
      that refuses. Resolving Q-1 later changes one matrix entry and one label
    - MATRIX HALF DONE: `WORKFLOW_BUILDER` holds `workflow:edit` and `workflow:archive` but not
      `workflow:publish`, and the publish and unpublish routes guard on `workflow:publish`, so a builder
      is refused. `workflow-lifecycle.test.cjs` asserts the builder's refusal and that the workflow stays
      a draft. The `ORG_OWNER` case is asserted against the matrix's actual answer rather than an
      assumption, so if the entry moves the test says so instead of silently passing
    - The customer workflow workspace states that an AmazFlow contact publishes each workflow and
      intentionally renders no publish control for customer roles. The focused rendering suite asserts
      both the stated route and the absence of a control the API would refuse.
    - _Requirements: 13.22, 7.11, 30.4_

  - [x] 14.5 Build workflow list, text search, and filtering with an allowlisted filter field set
    - Filter by status, provider, required execution surface, and assigned role; reject an unrecognized
      filter field with 400 rather than ignoring it
    - CONTROL PLANE DONE: `GET /workflows` accepts `q`, `status`, `provider`, `surface` and
      `assignedRole` from a closed allowlist. An unrecognized FIELD is 400, and so is an unrecognized
      VALUE — `?status=published` is the word a person reaches for, and returning an empty list would
      tell them their organization has no published workflows when it has several. Status is matched
      against the DISPLAY status so the Archived filter also returns the legacy `paused` records the list
      labels Archived; surface is derived from the steps
    - The customer list now submits encoded search and filters to the same route. Its empty state says
      when no workflow matches rather than conflating that result with an organization that has none.
    - _Requirements: 13.6, 13.7, 27.6, 27.7_

  - [x] 14.6 Build workflow detail: version history, derived required surfaces, and preflight readiness
    - Required surfaces are rendered from the workflow's steps, never from a separately stored field
    - `WorkflowWorkspace` loads version history and preflight alongside the definition. Its required
      surfaces are calculated with `requiredTargets(draft)`, never trusted from a stored field, and
      the preflight result states readiness and the recovery action per surface.
    - _Requirements: 13.19, 13.20, 13.21_

  - [x] 14.7 Pin runs to the workflow version in effect and keep that version readable after later edits
    - Immutable version record written on save
    - `saveWorkflowWithVersion` writes `WORKFLOW#` and `WORKFLOWVERSION#{id}_v{padded}` together, and
      every save that changes the definition bumps the version — immutability here is a property of the
      KEY, so reusing a version is what would break it
    - This is what makes a run's pin mean anything: `runWorkflow` stores `workflowVersion` and every later
      read resolves the definition through `getWorkflowVersion(tenantId, workflowId, version)`, which
      falls back to the CURRENT workflow when no version record exists. Without the record an in-flight
      run would silently start following steps that were edited underneath it. Asserted directly: a run is
      started, the workflow is then edited, and the pinned version still says what the run was started
      with
    - _Requirements: 13.17, 13.18_

  - [x] 14.8 Wire the no-code builder for every supported action type on both surfaces
    - Field-level editing for every browser and desktop action; each step's surface derived from its
      provider; only operations in that surface's vocabulary accepted
    - SERVER-SIDE HALF DONE: `ACTIONS_BY_SURFACE` and `AGENT_SURFACE_FOR_PROVIDER` are in both copies and
      the validator refuses any operation outside its surface's vocabulary, in both directions, plus an
      `executionTarget` that contradicts its provider. `ALLOWED_AGENT_OPS` is now derived from those two
      lists rather than a hand-written nine-entry subset, which is a defect fix in its own right: the
      canonical copy silently refused every desktop action and every `NAVIGATE`, so the two control-plane
      copies disagreed about what an agent may be offered
    - The existing field-level, schema-driven builder and its styles are promoted into `apps/customer`.
      The customer wrapper preserves provider-derived targets and the full browser/desktop action
      vocabulary, while restricting its selectable write statuses to draft and testing.
    - _Requirements: 14.1, 14.2_

  - [x] 14.9 Wire the plain-language entry point to a validated draft
    - Request a candidate definition from the managed service, validate before persisting, respond 422 with
      the reason without persisting on failure, persist a passing candidate as a draft returned in editable
      form, persist immediately so the draft survives a reload, submit the structured definition rather than
      the prose when saving, and audit the generation
    - Control flow is never decided by a language model
    - CONTROL PLANE DONE: `POST /workflows/generate` moved from `internal:workflow_author` to
      `workflow:create`, because requirement 14.3 is about the person building the workflow and the
      design's own sequence diagram names that person "Builder (customer or staff)". A customer's target
      organization is its own and `body.tenantId` is not consulted. The candidate is validated, then the
      identity fields are imposed and it is validated AGAIN — the generator validated its own output, but
      what is about to be persisted is a different object. A passing candidate is persisted immediately as
      a draft so it survives a reload, and the generation is its own audit event recording the
      description's LENGTH rather than the description, which is the customer's own process documentation
    - The 422/503 split is new and matters: the previous code answered 422 for an unconfigured generator,
      which told a customer their description was invalid when the truth was that AmazFlow could not ask
    - Control flow is asserted, not assumed: the `advance` implementation is extracted by brace matching
      and checked to read `next`/`whenTrue`/`whenFalse`/`onFailure` out of the persisted definition, with
      no generation or free-form model call anywhere in the step-selection path
    - The customer workspace sends the plain-language description only to generation, then opens the
      returned persisted draft in the builder. Save sends the structured definition to the draft route,
      never the original prose; the focused suite asserts both calls by their distinct payload shapes.
    - _Requirements: 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10_

  - [x] 14.10 Tag runs started from a testing-status workflow as test runs
    - Applies Q-7's conservative assumption: the tag exists so either counting policy can be applied without
      a schema change; no counting or analytics-exclusion policy is asserted. Testing-status runs are
      admitted only from principals holding workflow edit or publish permission
    - `isTest` is stamped at creation rather than patched on afterwards, because a run that has already
      dispatched its first step untagged is a run whose audit trail and dispatched task describe something
      other than a test. Added to `WorkflowEngine.start` as an inert flag the engine never reads
    - Q-7 is held open deliberately, and the suite asserts that: `isTest` must not appear near
      `LIVE_RUN_STATUSES`, `liveNow`, `runLimit` or `maxConcurrentRuns`, so the code cannot have quietly
      answered a question the business has not
    - An operator is refused a testing run. The status exists so a builder can try a workflow against real
      systems before anyone else can, so admitting an operator would defeat the point of it
    - _Requirements: 13.4, 13.5_

  - [x] 14.11 Workflow lifecycle test suite
    - Draft, testing, published, archived; schema rejection of an invalid step graph; refusal to publish a
      managed-browser step with no active connection; an unpublished workflow becoming unrunnable; a pinned
      version readable after later edits; duplication producing a new draft; version list ordering;
      generation producing either a schema-valid draft or a stated validation failure
    - `infrastructure/aws-cdk/test/workflow-lifecycle.test.cjs`, 51 checks, wired into `test:behaviour`.
      Every enumerated case is covered, plus the surface-pairing and provider-allowlist rejections in both
      directions
    - Each negative case asserts on the STORED record as well as the response, because that is where these
      failures hide: a validation failure that persisted anyway looks like a validation failure until
      somebody reloads, and a publish request the draft route silently downgraded looks like a successful
      save
    - The managed model is stood in for the same way DynamoDB and Cognito are — the behaviour under test is
      not the model's, it is what the control plane does with a candidate. The stand-in is a QUEUE because
      the generation path legitimately retries once with the validation error fed back; a single slot would
      have made the second attempt look like an unreachable service
    - _Requirements: 34.11_

- [ ] 15. Phase 6 — Runs, status presentation, and evidence

  - [x] 15.1 Make the run status label mapping total and honest
    - A label for every persisted status; running displayed as in progress; awaiting confirmation displayed
      as awaiting a human action; timed out given its own label rather than merged with failed; no queued
      state displayed, because a run is running from creation
    - The shared mapping is exhaustive for the eight persisted statuses and renders an unexpected value
      as "Unknown status", never as an invented queue.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x] 15.2 Build the customer run list with permission-scoped rows
    - Own-records form of the read permission returns only runs the principal created
    - The list consumes the policy-scoped run response and renders only returned workflow identity,
      customer status, start time, and test-run markers.
    - _Requirements: 16.6, 16.7_

  - [x] 15.3 Render run detail from the shared run-narrative model
    - Step progression including the projected remaining path, timeline from recorded audit entries with
      elapsed intervals, per-step tool calls, decision records with confidence against the configured
      threshold, gates encountered, and the scopes of issued grants
    - RunWorkspace loads the pinned workflow version and composes progression, timeline, tool calls,
      decisions, gates, and grant scopes exclusively through the shared run model.
    - _Requirements: 16.8_

  - [x] 15.4 Render per-step evidence
    - Which agent acted, under which grant identifier, on which page or application, and whether the
      platform independently verified the result
    - The evidence panel renders the recorded agent, grant identifier, page/application, and independent
      verification outcome per completed step; absent attributes read as "Not recorded".
    - _Requirements: 16.9, 31.13_

  - [x] 15.5 Render a plain-language explanation of why a run ended in its current state
    - The shared diagnosis is rendered first, including reconciliation guidance where retry would be unsafe.
    - _Requirements: 16.10_

  - [x] 15.6 Keep absent execution telemetry honest
    - State that retry attempts are not recorded rather than displaying a count; state that recordings are
      not available rather than presenting an empty player
    - The surface explicitly says retry attempts are not recorded and recordings are not available.
    - _Requirements: 16.11, 16.12, 29.12, 33.7_

  - [x] 15.7 Wire cancellation and pre-action confirmation
    - Cancel a run in the cancellable set and record it in the run's audit entries; respond with a state
      conflict for a terminal run; record a granted confirmation and resume the run
    - Customer controls are permission-filtered and call the inventoried cancellation and confirmation
      routes; the control plane remains authoritative for state conflicts and own-record scope.
    - _Requirements: 16.13, 16.14, 16.15_

  - [x] 15.8 Make run detail reachable by direct link across a hard reload
    - Resolves the shareable-run-link limitation the previous customer console documented
    - The /runs/:id route resolves through the customer route table and the static-hosting deep-link
      rewrite already committed in Phase 3.
    - _Requirements: 16.16, 1.6_

  - [ ] 15.9 Property tests for run status transition validity (Property 3) with fast-check
    - **Property 3: Run status transition validity** — a terminal run never transitions again; every
      transition is in the declared table; cancel is accepted exactly for the cancellable set; an agent
      result is accepted only while awaiting an agent on that exact step; audit is append-only and monotonic
      in time; an unsubstantiated success does not advance the run; the presentation mapping is total
    - **Validates: Requirements 16.1, 16.5, 16.13, 16.14, 17.5, 19.5, 19.8, 28.12, 31.1, 31.2, 31.3, 31.15, 31.17**

  - [ ] 15.10 Run lifecycle branch test suite
    - Every branch the design enumerates: managed-service success and failure; allowlist rejection routed to
      review and failing closed; condition branches; approval approved and rejected; confirmation required,
      granted, and expired; action success and failure with and without a failure branch; verification
      failure; reconciliation required with no automatic retry; cancellation from each cancellable status and
      refusal from each terminal status; timeout; execution status blocking creation; the ceiling returning a
      limit and in-flight count; an unrecognized status failing open; preflight refusing an unconnected surface
    - _Requirements: 34.12_

- [ ] 16. Checkpoint — customer run experience replaces the duplicated one
  - Ensure all tests pass, ask the user if questions arise.
  - The duplicated customer run renderer and status map are deleted only now that the shared ones are live.

- [ ] 17. Phase 7 — Execution surfaces and agents

  - [x] 17.1 Build the agents view on heartbeat-derived status
    - Exactly two execution surfaces; connectivity derived from heartbeat recency against the two-minute
      interval with no separately stored flag; show type, platform, version, advertised capabilities, and
      reported operating-system permissions for desktop agents
    - The customer table now renders the derived connection status, Chrome Extension and Desktop App
      surfaces, platform, version, advertised capabilities, reported permissions, and the last-seen
      time, with absent telemetry stated as "Not recorded".
    - _Requirements: 15.1, 15.2, 15.3_

  - [ ] 17.2 Wire agent authorization, credential exchange, re-registration, and revocation with audit
    - Single-use expiring organization-scoped code; credential stored as a hash with the code marked
      consumed; re-registration reuses the installation record and supersedes the prior credential; a
      superseded or revoked credential is refused; revocation ends access on the agent's next request;
      heartbeat records time, capabilities, and permissions
    - _Requirements: 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.19_

  - [ ] 17.3 Expose the server-side reason a pending task is not eligible for the connected agents
    - Evaluated with the same admission predicate the claim route uses; an unmatched capability leaves the
      task available to another eligible agent
    - _Requirements: 15.10, 15.11, 15.17_

  - [ ] 17.4 Surface preflight and refuse run creation for an unconnected required surface
    - Refuse at creation rather than creating a run that later times out
    - _Requirements: 15.18, 13.21_

  - [ ] 17.5 Property tests for agent capability and surface matching (Property 4) with fast-check
    - **Property 4: Agent capability and surface matching** — a claim is granted only when surface,
      capability, and assignment all match; a desktop agent is never handed a browser step and vice versa;
      exactly one agent wins a contested claim; a grant verifies only against its issued scope; each grant
      tool is consumable exactly once; an expired lease is reclaimable and a live one is not
    - **Validates: Requirements 15.10, 15.12, 15.13, 15.14, 15.15, 15.18, 31.4, 31.5, 31.6, 31.7, 31.8, 31.9, 31.10**

  - [ ] 17.6 Agent behaviour test suite
    - Registration; re-registration reusing the installation record and superseding the credential; refusal
      of a superseded credential; heartbeat recording; offline handling after more than two missed intervals
      including preflight reporting not-ready and run creation refused; capability matching leaving a task
      pending; surface matching; contested claims yielding one winner; stalled lease reclamation by the
      sweep; grant scope mismatch, expiry, and replay; revocation ending access immediately
    - _Requirements: 34.13, 15.16_

- [ ] 18. Phase 8 — Tasks, approvals, and exceptions

  - [ ] 18.1 Build the tasks view and the permitted result submission path
    - List organization tasks the principal may read, narrowed to own runs for the own-records form; display
      target surface, operation, originating run, and claim state; record a submitted result and advance the
      run; respond with a state conflict when the run is not awaiting an agent on that step; append the
      audit entry
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

  - [x] 18.2 Build the approvals view and the server-verified decision path
    - List runs awaiting approval the principal may read; approve and reject advance the correct branch;
      verify authority server-side on every request; 403 without the decision permission, 404 from another
      organization, refusal when the role is absent from the step's permitted roles, state conflict when the
      run is not awaiting approval or the step is already decided; record the deciding user and role in both
      audit records
    - The customer queue now offers approve/reject only to a principal granted approval:decide and sends
      the current recorded step to the existing server-verified route. A rendering test asserts that an
      operator is shown the queue but never controls the API would refuse.
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10_

  - [ ] 18.3 Derive the exception cause classification from recorded data
    - Classify from audit entries, step results, and connection state into the eight causes; never store the
      classification separately from the run
    - _Requirements: 19.1, 19.2, 19.3_

  - [ ] 18.4 Build the exceptions view with cause-appropriate recovery
    - Display the classified cause and its recovery action; where the derived diagnosis marks the run unsafe
      to retry, present reconciliation guidance and no retry control
    - _Requirements: 19.4, 19.5, 31.16_

  - [ ] 18.5 Implement resume as a new run pinned to the same workflow version
    - Same input; audit event linking the new run to the original; no rewinding or mutation of the original
      run's completed steps
    - _Requirements: 19.6, 19.7, 19.8_

  - [ ] 18.6 Approvals test suite
    - Approval and rejection advancing the correct branch; refusal of an unauthorized role, of a caller from
      another organization, and of an approver absent from the step's permitted roles; refusal when the run
      is not awaiting approval; refusal of an already-decided step; recording of the deciding user and role
    - _Requirements: 34.14_

  - [ ] 18.7* Exception classification unit tests
    - One case per derived cause plus the unsafe-to-retry flag
    - _Requirements: 19.2, 19.3, 19.5_

- [ ] 19. Checkpoint — the full operational customer surface is functional
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 20. Phase 9 — Connections, secret handling, and the grant-signing secret migration

  - [ ] 20.1 Build the connections view with derived dependencies and an honest disabled state
    - Name, base location, permitted origins, preferred mode, status, and the workflows that depend on it,
      derived from stored definitions; create, start and complete a login session, test, reconnect,
      disconnect; the managed profile identifier and every credential value excluded from responses; while
      the routes are not present in the deployed control plane the view is intentionally disabled with a
      stated reason
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 30.9_

  - [ ] 20.2 Add secret metadata records backed by the external secret store
    - Name, kind, external store reference, recognition hint, usage timestamps; the value is accepted once on
      write and passed straight to the store; never stored in the database, never returned by any route,
      never written to a log line, run context, audit entry, or evidence record; never-used secrets display
      that last use is not recorded
    - _Requirements: 20.6, 20.7, 20.8, 20.9, 20.10, 20.11_

  - [ ] 20.3 Add secret create, rotate, and delete routes with identifier-and-name-only audit events
    - _Requirements: 20.12_

  - [ ] 20.4 Move the execution grant signing secret out of the deployment template into the external secret store (security work, H-6)
    - Read the secret from the store at runtime; remove it from the template; add a guard and a recorded
      procedure that performs rotation only in a window with zero runs awaiting an agent, because rotation
      invalidates in-flight grants (Risk R-7)
    - _Requirements: 20.13, 20.14, 33.9_

  - [ ] 20.5 Secret non-leakage tests
    - Assert no route returns a value and no log line, run context, audit entry, or evidence record contains
      one
    - _Requirements: 20.8, 20.9, 28.5, 34.17_

- [ ] 21. Phase 10 — Internal staff console

  - [ ] 21.1 Port all fourteen existing staff sections into the internal application unchanged
    - Overview, runs, approvals, exceptions, workflows, workflow studio, customers, users, connections,
      agents, audit, support, leads, platform settings — all remain functional
    - _Requirements: 23.1_

  - [x] 21.2 Build the organizations view covering both status fields
    - List, create, and update organizations including execution status and commercial lifecycle status;
      label the plan field as reporting-only for as long as no runtime behaviour reads it; audit lifecycle
      changes
    - The staff organizations view now uses the real create and update routes, presents execution and
      commercial lifecycle controls independently, explains the explicit churn decision, and labels plan
      as reporting-only. The control plane records lifecycle changes in the organization audit trail.
    - _Requirements: 23.2, 8.13, 8.16, 33.5_

  - [ ] 21.3 Build the cross-organization staff views
    - Per-customer usage summary and user list; runs spanning organizations; exceptions filtered to failed
      and timed out; agents and connections spanning organizations; audit spanning organizations; support
      ticket listing and update
    - _Requirements: 23.3, 23.4, 23.5, 23.6, 23.7_

  - [ ] 21.4 Build the system health view from real signals
    - The control plane's health response and the platform's published operational metrics
    - _Requirements: 23.8_

  - [x] 21.5 Build the feature flags view limited to flags read by runtime behaviour
    - A proposed flag that no runtime behaviour reads is not presented
    - The staff console states that no runtime-backed feature flags exist in this release and offers no
      decorative toggle or write control.
    - _Requirements: 23.9, 23.10, 30.4, 30.5_

  - [x] 21.6 Ship the impersonation view as intentionally disabled with its stated reason
    - Applies Q-6's conservative assumption: not shipped, because safe impersonation requires scoped
      attribution not built in this release; the principal type already reserves the impersonating-user field
      added in task 7.2
    - _Requirements: 23.14, 23.16, 30.3, 30.4, 30.9_

  - [x] 21.7 Ship the internal billing view as intentionally disabled with its stated reason
    - _Requirements: 23.15, 30.3, 30.9_

  - [ ] 21.8 Confine vendor, model, trace, harness, and token detail to opened technical disclosures
    - And label the diagnostic executor route as a diagnostic restricted to staff
    - _Requirements: 23.17, 23.13_

  - [ ] 21.9 Add the cross-organization index and keep truncation reporting until it lands
    - Replace staff cross-organization full-table scans for list views with indexed queries; until a list is
      indexed, retain the truncation signal and report a truncated staff list rather than presenting a
      partial list as complete
    - _Requirements: 23.19, 23.20, 27.9_

  - [ ] 21.10 Internal-surface protection tests at the control-plane level
    - Every internal route requires the staff group server-side on every request; a non-staff principal
      receives 403; protection is verified through request tests, not through the inability to load a page
    - _Requirements: 2.1, 2.2, 2.5_

- [ ] 22. Phase 11 — Onboarding state, milestones, and the guided checklist

  - [ ] 22.1 Persist exactly one onboarding record per organization
    - Status from the ten-value platform-owned set defined independently of any provider's sales-stage
      labels, provider reference, internal owner, derived milestone timestamps, checklist state, internal
      notes
    - _Requirements: 24.1, 24.2, 24.3_

  - [ ] 22.2 Derive every milestone from an observed platform event, written once
    - Administrator invited from the first owner or administrator invitation; administrator activated from
      that user's first successful sign-in; first integration from the first connection reaching active;
      first agent from the first heartbeat; workflow created and published from the corresponding events;
      first production run from the first completed run not tagged as a test run; each written only while
      unset; no manually supplied value accepted for any derived milestone
    - _Requirements: 24.6, 24.7, 24.8, 24.9, 24.10, 24.11, 24.12, 24.13, 24.15_

  - [ ] 22.3 Set the organization's activation timestamp from the first production run milestone
    - _Requirements: 24.14, 8.2_

  - [ ] 22.4 Persist checklist state server-side with skip attribution
    - Progress retained across devices and sessions; a skip records the acting user and time; status and
      checklist transitions are audited
    - _Requirements: 24.19, 24.20, 24.24_

  - [x] 22.5 Render the adaptive checklist on the customer home view
    - Shown to owners and administrators; includes only the steps the organization actually requires, derived
      from the execution surfaces its workflows require; a step awaiting AmazFlow is labelled as requiring
      nothing from the customer
    - The customer home now derives Chrome Extension, Desktop App, and connection steps from saved workflow
      action targets; it is visible only to organization owners and administrators, and clearly identifies
      publishing as an AmazFlow-owned step until the workflow is published.
    - _Requirements: 24.16, 24.17, 24.18_

  - [ ] 22.6 Render the same onboarding record at staff depth with notes and internal owner
    - _Requirements: 24.21, 23.11_

  - [ ] 22.7 Keep commercial onboarding states decoupled from execution
    - Paused and churned do not by themselves change execution status; setting churned prompts staff to set
      the execution status explicitly rather than changing it implicitly
    - _Requirements: 24.22, 24.23, 8.4_

  - [ ] 22.8* Onboarding milestone and checklist tests
    - First-write-wins per milestone; refusal of a manual milestone value; adaptive step selection
    - _Requirements: 24.7, 24.15, 24.17_

- [ ] 23. Checkpoint — internal console and onboarding complete
  - Ensure all tests pass, ask the user if questions arise.
  - The customer-relationship-management webhook does not start until convergence (group 3) and the
    onboarding records (group 22) both hold.

- [ ] 24. Phase 12 — Customer relationship management integration and Closed Won automation

  - [ ] 24.1 Define the provider-agnostic service interface and its no-operation implementation
    - Lookup, creation, update, onboarding status update, organization identifier recording, activation
      recording, and periodic usage summary recording; no method accepts a run, a workflow, or an evidence
      record, so no signature exists through which such data could travel; the no-operation implementation
      performs no network input or output
    - _Requirements: 25.1, 25.3, 25.36_

  - [ ] 24.2 Implement the Monday provider against the interface with its credential in the external secret store
    - No credential in a client bundle or a database record; organization creation and administrator
      invitation succeed when no provider is configured or the configured provider is unreachable
    - _Requirements: 25.2, 25.4, 25.5_

  - [ ] 24.3 Put the sales-stage-label mapping inside the adapter and log unmapped labels
    - An unrecognized label leaves the onboarding status unchanged and is logged as unmapped, so renaming a
      board column cannot change platform behaviour
    - _Requirements: 24.4, 24.5, 25.39_

  - [ ] 24.4 Implement the webhook endpoint's layered authenticity and validation gates
    - High-entropy path secret from the external store compared in constant time with 404 on mismatch;
      verify a supplied authorization header against the stored signing secret with 401 and no state change
      on failure; process on the path secret alone when the header is absent and log that absence; echo a
      subscription challenge with no state change; validate every body against a declared schema with 400
      and no state change on failure; rate-limit per source with a per-provider budget; accept only over a
      transport-secured connection
    - Applies Q-2's conservative assumption: neither provider configuration is presumed, so the endpoint is
      safe in either
    - _Requirements: 25.6, 25.7, 25.8, 25.9, 25.10, 25.11, 25.12, 25.13, 25.14, 25.15, 25.16_

  - [ ] 24.5 Implement conditional-write idempotency for events and the organization link
    - A processing marker per event key written conditionally so exactly one of any number of concurrent
      attempts succeeds; a redelivered completed event responds successfully indicating deduplication with no
      further state change; a redelivered in-flight event responds with a retryable state conflict; the link
      record is written conditionally
    - _Requirements: 25.17, 25.18, 25.19, 25.20_

  - [ ] 24.6 Implement the closed-deal handler
    - Create one organization with a unique slug for an unlinked item and reuse the linked organization
      otherwise; create or update the onboarding record with the setup-required status, the provider
      reference, the resolved internal owner, and the closed-deal timestamp; leave the internal owner unset
      when it cannot be resolved; prepare an administrator invitation for a well-formed permitted contact
      address; where no usable address exists, still create the organization and onboarding record, mark the
      invite step blocked with a reason, and return success; perform invitation delivery as a separately
      retryable step so a delivery failure does not reverse organization creation; record exactly one
      closed-deal-processed audit event per event
    - _Requirements: 25.20, 25.21, 25.22, 25.23, 25.24, 25.25, 25.26, 25.27, 25.28, 25.31_

  - [ ] 24.7 Implement queued reverse synchronization restricted to milestones and aggregates
    - Enqueue rather than await on the request path and retry with backoff; a repeatedly failing call never
      creates a second organization; send only lifecycle milestones and the aggregate usage summary of run
      counts, active workflow count, and active agent count; never send workflow definitions or step content,
      customer input, run context, credentials, secrets, screenshots, recordings, execution evidence, audit
      detail, or protected health information
    - _Requirements: 25.29, 25.30, 25.34, 25.35_

  - [ ] 24.8 Sweep stale processing markers into a failed state and expose a staff retry path
    - A marker incomplete beyond the configured threshold is marked failed and presented in the internal
      retry view; a staff retry reprocesses without creating a duplicate organization
    - _Requirements: 25.32, 25.33, 23.12_

  - [ ] 24.9 Enforce safe webhook logging
    - Never a provider credential, path secret, signing secret, or raw body; always the event identifier,
      item identifier, mapped status, and correlation identifier
    - _Requirements: 25.37, 25.38, 28.5_

  - [ ] 24.10 Property tests for webhook idempotency (Property 6) with fast-check and the in-memory harness
    - **Property 6: CRM webhook idempotency** — N sequential and N concurrent deliveries of the same
      closed-deal event produce exactly one organization, one onboarding record, and one processed audit
      event; a crash at any step leaves the system re-drivable to the same single organization; an invalid or
      failing-signature payload is rejected with the data store byte-identical; the challenge handshake echoes
      and performs no work; no secret and no raw payload reaches a log line; reverse synchronization never
      carries workflow, credential, or evidence data
    - **Validates: Requirements 25.7, 25.8, 25.10, 25.12, 25.14, 25.17, 25.18, 25.19, 25.22, 25.23, 25.31, 25.34, 25.35, 25.37**

  - [ ] 24.11 Webhook case test suite
    - Valid closed-deal event; duplicate delivery; concurrent duplicate deliveries; event missing a contact
      address; invalid payload leaving the store unchanged; incorrect path secret; present but invalid
      signature; absent signature; subscription challenge; retry after an interrupted attempt; unmapped stage
      label; reverse synchronization calls; provider unreachable at organization creation; a churn stage
      change not implicitly changing the execution status
    - _Requirements: 34.15_

- [ ] 25. Checkpoint — automation lands without duplicate organizations
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 26. Phase 13 — Honesty remediation, error handling, and observability hardening

  - [ ] 26.1 Resolve the unverified support messenger (security work, H-1)
    - Implement the messenger identity endpoint so the messenger boots with a server-signed user verification
      value; while that endpoint is absent, do not boot the messenger with an unverified user identifier on
      authenticated surfaces
    - _Requirements: 33.1, 33.2_

  - [ ] 26.2 Remove the fabricated monetary savings figure (H-2)
    - Delete it from every customer-facing surface and stop returning it from the control plane; keep run
      counts, success rate as completed over decided with not-available when nothing is decided, median
      duration, exception counts by derived cause, per-workflow volume and success, and agent availability
      from heartbeat history; where a time-saved figure is shown, label it as an estimate against the manual
      duration recorded by the customer's AmazFlow contact; state when runs are excluded from analytics
    - _Requirements: 33.3, 33.4, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7, 21.8, 21.9, 21.10_

  - [ ] 26.3 Label the organization plan field as reporting-only wherever it is displayed (H-3)
    - Applies Q-4's conservative assumption: reporting-only, with the concurrency ceiling remaining the only
      enforced limit; no stored value is presented as an enforced limit unless a runtime behaviour reads it
    - _Requirements: 33.5, 8.13, 30.5_

  - [ ] 26.4 Keep per-step retry attempts unrendered until a counter is persisted (H-4)
    - Applies Q-5's conservative assumption: neither implementing retries nor removing the field is presumed;
      no attempt count is displayed while no counter exists
    - _Requirements: 33.6, 33.7, 16.11_

  - [ ] 26.5 Supersede the stale internal document and record every remediation resolution (H-7, H-1..H-8)
    - Remove or mark superseded the document naming an agent authorization page as the highest-priority gap,
      which the self-authenticating extension contradicts; record the resolution of each remediation item in
      a version-controlled artifact
    - _Requirements: 33.10, 33.12_

  - [ ] 26.6 Add error boundaries and the support-referenceable error code
    - One boundary per route module plus an application-level fallback; a throwing view leaves the shell
      rendering and the failure confined; display a code derived from the request's correlation identifier in
      an unambiguous character set; display a control-plane human-readable refusal reason as written
    - _Requirements: 29.1, 29.2, 29.3, 29.4, 29.5_

  - [ ] 26.7 Implement the loading and mutation discipline
    - Skeleton matching the eventual layout on first load; current content retained during background
      refresh with no skeleton; a mutating control disabled until its request settles; a destructive action
      requiring explicit confirmation naming the affected record
    - _Requirements: 29.6, 29.7, 29.8, 29.9_

  - [ ] 26.8 Implement honest empty states and absent-value rendering
    - Distinguish no records, filtered-out, and permission-limited emptiness; offer the next action or state
      who can perform it; render an unrecorded value as not recorded or not available rather than a zero, a
      dash, or a plausible default
    - _Requirements: 29.10, 29.11, 29.12_

  - [ ] 26.9 Record the page classification artifact and keep it current
    - Classify every page on every surface as functional, intentionally disabled with a stated reason, or
      removed; present no control that accepts input without effect; retain the marketing simulation labelled
      as a simulation and the existing content-placeholder labelling; update the classification in the same
      change that changes a page
    - _Requirements: 30.1, 30.2, 30.3, 30.4, 30.7, 30.8, 30.9, 30.10_

  - [ ] 26.10 Remove the unlinked agent test harness page from the public surface
    - _Requirements: 30.6_

  - [ ] 26.11 Add per-route rate limits and pagination discipline
    - Rate-limit the lead route, the unauthenticated branding route restricted to display name and branding
      values, the invitation routes, and the webhook; paginate list routes with a caller-supplied page size
      defaulting to fifty and capped at two hundred plus an opaque cursor; never truncate a list silently;
      apply the declared status-code contract
    - _Requirements: 6.13, 27.8, 27.9, 27.10, 27.11_

  - [ ] 26.12 Complete correlation, structured logging, metrics, and alarms
    - Assign a correlation identifier per request using a supplied one where present, return it in every
      response, include it in every audit event, and emit one structured line per request carrying route key,
      user, organization, status, duration, evaluated permission, and decision; exclude secrets, tokens, grant
      payloads, customer input, run context values, evidence bodies, and full email addresses; publish the
      enumerated operational metrics; alarm on cross-organization access attempts and authorization denials
      and publish a zero for the former so its alarm is never without data; record every enumerated
      administrative and security-relevant audit action with actor, actor label, organization, action, target,
      time, changed values, and correlation identifier, keeping the run and administrative audit records
      distinct and append-only
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7, 28.8, 28.9, 28.10, 28.11, 28.12_

  - [ ] 26.13 Add the bundle content check to the build
    - Fail the build when the customer bundle contains a forbidden vendor or model identifier string or a
      hardcoded secret; retain existing type checking, static export builds, agent contract suites, and the
      published-extension-matches-source check
    - _Requirements: 34.17, 34.18_

- [ ] 27. Phase 14 — Full verification before deployment

  - [ ] 27.1 Run the complete suite as the cutover gate with no skipped tests
    - Two-organization isolation, all six roles, both agent surfaces, all webhook cases, all six correctness
      properties, all preservation guardrails
    - _Requirements: 34.21, 34.1, 34.2_

  - [ ] 27.2 Complete per-page state and navigation-absence tests across both applications
    - _Requirements: 34.16_

  - [ ] 27.3 Record rollback readiness
    - Identify a deployable previous control-plane revision and a promotable previous build per surface
    - _Requirements: 34.20_

- [ ] 28. Phase 15 — Deployment, live verification, and cutover

  - [ ] 28.1 Deploy the control plane with a reviewed changeset and no parameter overrides
    - Confirm the changeset touches only intended resources and that the grant signing secret is not rotated
      outside its window; confirm no runs are awaiting an agent or a confirmation for a deploy that changes
      grant handling
    - _Requirements: 20.14, 32.1, 34.19_

  - [ ] 28.2 Deploy the three surfaces with callbacks and the cross-origin allowlist in the same change
    - The committed rewrite configuration, the identity-provider callback and sign-out locations, and the
      three-origin allowlist all ship together so a mismatch cannot ship silently
    - _Requirements: 1.1, 1.2, 1.3, 1.7, 1.8, 1.9_

  - [ ] 28.3 Execute the live-deployment verification checklist against the deployed product and record the result
    - Control-plane health; principal resolution; refusal of a token with no organization claim; presence of
      every enumerated route; per-origin cross-origin behaviour; a cross-organization probe; refusal of the
      artificial-intelligence diagnostic to a customer token; absence of vendor identifiers from
      customer-reachable responses; deep-link reload on all three surfaces; an access-denied internal shell
      for a customer session; sign-out and history behaviour; a real browser-surface run and a real
      desktop-surface run end to end; single-winner claiming across two live clients; agent termination
      mid-step followed by sweep recovery; a forced verification failure; grant replay refusal; approval and
      confirmation gates; organization pause and resume; the concurrency ceiling; preflight refusal; a real
      invitation acceptance and its reuse refusal; invitation expiry and resend; a real closed-deal event
      delivered twice producing one organization; absence of prohibited data in the provider item;
      correlation-identifier traceability; absence of sensitive values from logs; and the operational metrics
      and alarms
    - _Requirements: 34.19_

  - [ ] 28.4 Cut over the previous surfaces by redirect and retire them only after the deprecation window
    - Every previously reachable route stays functional until its replacement is live and the window has
      elapsed; do not present the undeployed target infrastructure stack as the production architecture, and
      keep the local engine sandbox service undeployed and labelled a development tool
    - _Requirements: 1.11, 32.7, 32.8_

- [ ] 29. Final checkpoint — restructure complete
  - Ensure all tests pass, ask the user if questions arise.
  - Every page is classified, every remediation item has a recorded resolution, and the live verification
    checklist is complete and recorded.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster route to a working product. They are
  supplementary unit and integration tests only.
- **Test tasks are deliberately not all optional.** Requirements 6.15, 6.16, 31.18, 34.4–34.16, 34.17,
  34.18, and 34.21 make specific test artifacts acceptance criteria in their own right, so those tasks are
  core deliverables rather than optional extras. The six correctness properties fall in the same category.
- Deferred decisions Q-1..Q-10 never block a task. Each appears as a conservative default expressed in
  data: a permission-matrix entry (Q-1), layered webhook authenticity (Q-2), the retained token storage
  (Q-3), a reporting-only label (Q-4), an unrendered field (Q-5), a stated-reason disabled view (Q-6), a
  run tag (Q-7), a time-to-live attribute (Q-8), the three named origins (Q-9), and a staff-restricted
  labelled diagnostic (Q-10).
- Honesty defects H-1..H-8 are sequenced as concrete tasks: H-1 in 26.1 and H-6 in 20.4 as security work,
  H-5 in 9.10, H-8 in 11.5, H-2 in 26.2, H-3 in 26.3, H-4 in 26.4, H-7 in 26.5, with 26.5 also recording
  every resolution in a version-controlled artifact.
- Nothing in this plan builds a control that does nothing. Every capability the design classifies as
  intentionally disabled ships as an honest disabled state with its stated reason (11.11, 11.12, 11.13,
  20.1, 21.6, 21.7), never as an input that has no effect.
- Group 2 lands before group 3 on purpose: existing execution semantics are pinned by tests before the two
  control-plane copies are touched.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "2.2"] },
    { "id": 2, "tasks": ["1.4", "2.3", "2.4", "2.5"] },
    { "id": 3, "tasks": ["2.6", "2.7"] },
    { "id": 4, "tasks": ["3.1", "3.2", "3.3"] },
    { "id": 5, "tasks": ["3.4", "3.5"] },
    { "id": 6, "tasks": ["3.6"] },
    { "id": 7, "tasks": ["5.1", "5.2", "5.6"] },
    { "id": 8, "tasks": ["5.3", "5.4", "5.7"] },
    { "id": 9, "tasks": ["5.5", "5.8"] },
    { "id": 10, "tasks": ["7.1", "7.2"] },
    { "id": 11, "tasks": ["7.3", "7.5"] },
    { "id": 12, "tasks": ["7.4", "7.13"] },
    { "id": 13, "tasks": ["7.6", "7.8"] },
    { "id": 14, "tasks": ["7.7", "7.9", "7.10"] },
    { "id": 15, "tasks": ["7.11", "7.12"] },
    { "id": 16, "tasks": ["9.1", "9.2", "9.3"] },
    { "id": 17, "tasks": ["9.4", "9.5"] },
    { "id": 18, "tasks": ["9.6", "9.7"] },
    { "id": 19, "tasks": ["9.8", "9.10"] },
    { "id": 20, "tasks": ["9.9", "9.11", "9.12"] },
    { "id": 21, "tasks": ["9.13", "11.1", "11.2"] },
    { "id": 22, "tasks": ["11.3", "11.5", "11.16"] },
    { "id": 23, "tasks": ["11.4", "11.6", "11.7", "11.8"] },
    { "id": 24, "tasks": ["11.9", "11.11", "11.12"] },
    { "id": 25, "tasks": ["11.10", "11.13", "11.14"] },
    { "id": 26, "tasks": ["11.15", "12.1", "12.2"] },
    { "id": 27, "tasks": ["12.3", "12.4", "14.1"] },
    { "id": 28, "tasks": ["14.2", "14.4", "14.7"] },
    { "id": 29, "tasks": ["14.3", "14.5", "14.10"] },
    { "id": 30, "tasks": ["14.6", "14.8"] },
    { "id": 31, "tasks": ["14.9", "14.11"] },
    { "id": 32, "tasks": ["15.1", "15.2"] },
    { "id": 33, "tasks": ["15.3", "15.7"] },
    { "id": 34, "tasks": ["15.4", "15.5", "15.6", "15.8"] },
    { "id": 35, "tasks": ["15.9", "15.10"] },
    { "id": 36, "tasks": ["17.1", "17.2"] },
    { "id": 37, "tasks": ["17.3", "17.4"] },
    { "id": 38, "tasks": ["17.5", "17.6", "18.1"] },
    { "id": 39, "tasks": ["18.2", "18.3"] },
    { "id": 40, "tasks": ["18.4", "18.5"] },
    { "id": 41, "tasks": ["18.6", "18.7", "20.2"] },
    { "id": 42, "tasks": ["20.1", "20.3"] },
    { "id": 43, "tasks": ["20.4", "20.5", "21.1"] },
    { "id": 44, "tasks": ["21.2", "21.3", "21.9"] },
    { "id": 45, "tasks": ["21.4", "21.5", "21.8"] },
    { "id": 46, "tasks": ["21.6", "21.7", "21.10"] },
    { "id": 47, "tasks": ["22.1", "22.3"] },
    { "id": 48, "tasks": ["22.2", "22.4"] },
    { "id": 49, "tasks": ["22.5", "22.6", "22.7"] },
    { "id": 50, "tasks": ["22.8", "24.1", "24.3"] },
    { "id": 51, "tasks": ["24.2", "24.4"] },
    { "id": 52, "tasks": ["24.5", "24.9"] },
    { "id": 53, "tasks": ["24.6"] },
    { "id": 54, "tasks": ["24.7", "24.8"] },
    { "id": 55, "tasks": ["24.10", "24.11"] },
    { "id": 56, "tasks": ["26.1", "26.2", "26.3", "26.4"] },
    { "id": 57, "tasks": ["26.5", "26.6", "26.10"] },
    { "id": 58, "tasks": ["26.7", "26.8", "26.11"] },
    { "id": 59, "tasks": ["26.9", "26.12"] },
    { "id": 60, "tasks": ["26.13", "27.2", "27.3"] },
    { "id": 61, "tasks": ["27.1"] },
    { "id": 62, "tasks": ["28.1"] },
    { "id": 63, "tasks": ["28.2"] },
    { "id": 64, "tasks": ["28.3"] },
    { "id": 65, "tasks": ["28.4"] }
  ]
}
```
