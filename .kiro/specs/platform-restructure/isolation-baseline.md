# Baseline two-organization isolation audit

Produced by task 1.4 against the **unmodified** deployed control plane
(`infrastructure/aws-cdk/amazflow-dev.yaml`), using the credential-free in-memory harness and the
two-organization seed fixture. This is the audit artifact Phase 2's isolation work is measured
against. Nothing here was fixed in Phase 0 — that is deliberate.

Reproduce with `node infrastructure/aws-cdk/test/isolation-baseline.test.cjs`. The suite compares
each probe against `infrastructure/aws-cdk/test/isolation-baseline.json` and fails on **drift**, so
a change that fixes or introduces a defect cannot land without updating this baseline in the same
commit.

**Result at baseline: 29 probes — 13 pass, 15 defects, 1 deliberate cross-organization behaviour.**

**Current (after Phase 2): 28 pass, 0 defects, 1 by design.** Every defect recorded here is closed.
The entries are kept, marked fixed, because this document is the record Phase 2 is measured against
and deleting closed items would make the numbers meaningless. `isolation-baseline.json` was
re-recorded in the same commit as the fixes, so the drift check now guards the FIXED state: a
regression that reintroduces any of these fails the build.

| Defect | Probes | Closed by |
|---|---|---|
| D-1 — 403 existence oracle on entity-id routes | ISO-01 … ISO-06 | Task 7.3 / 7.6 — `resolveEntity()` reads under the caller's own scope |
| D-2 — 403 rather than 404 on parameter-scoped routes | ISO-10 … ISO-16 | Task 7.4 / 7.6 — `guardIn()`, whose `WRONG_ORG` decision answers 404 |
| D-3 — staff cross-organization read not audited | ISO-25 | Task 7.3 / 7.7 — `recordCrossTenantAccess()` at the authorization point |
| D-4 — deactivated member reached authenticated routes | ISO-29 | Task 5.4 (Phase 1) — `ACCOUNT_DISABLED` on every authenticated route |

Correct isolation, per requirement 34.4, is: a principal of Org A presenting an identifier
belonging to Org B receives status `404` and a body containing nothing of Org B's.

## Defects — all closed in Phase 2

Every defect below was the *same* defect repeated at 15 call sites, with two variants. All are now
fixed; the tables are retained as the record.

### D-1 — Wrong refusal status leaks record existence across the tenancy boundary — FIXED in Phase 2 (tasks 7.3, 7.6)

These routes loaded the record with a staff-level scan and then compared tenancy, refusing with `403`
and a message that named the record type. `403 "Run belongs to another tenant"` is an existence
oracle: it distinguishes "this run id exists in another organization" from "this run id does not
exist", which is exactly the distinction `404` is required to hide. No Org B field values appeared in
any response body.

**How it was closed.** The comparison is gone rather than corrected. Each of these six now resolves
its record through `resolveEntity(type, id, principal, reason)`, which reads the caller's OWN
partition for a non-staff principal — so another organization's id is simply not found, and there is
no tenancy comparison left for a later edit to get wrong. A staff caller goes through
`crossTenantRead()`, which succeeds and audits. This is the pattern
`GET /workflows/{id}/versions` always used.

| # | Probe | Route | Actual | Required |
|---|-------|-------|--------|----------|
| 1 | ISO-01 | `POST /runs/{id}/cancel` | `403 Run belongs to another tenant` | `404` |
| 2 | ISO-02 | `POST /runs/{id}/approvals/{stepId}` | `403 Run belongs to another tenant` | `404` |
| 3 | ISO-03 | `POST /runs/{id}/confirmations/{stepId}/confirm` | `403 Run belongs to another tenant` | `404` |
| 4 | ISO-04 | `POST /agents/{id}/revoke` | `403 Agent belongs to another tenant` | `404` |
| 5 | ISO-05 | `POST /agent-tasks/{id}/result` | `403 Task belongs to another tenant` | `404` |
| 6 | ISO-06 | `POST /support/tickets/{id}/status` | `403 Ticket belongs to another tenant` | `404` |

### D-2 — Parameter-scoped routes refuse with `403` rather than `404` — FIXED in Phase 2 (tasks 7.4, 7.6)

The organization identifier arrives in the path and was compared against the session's own tenant
claim before anything was loaded. Weaker than D-1 — nothing was read — but the status code still
distinguished "another organization's slug" from "no such slug".

**How it was closed.** All seven now call `guardIn(principal, permission, { orgId: <path param> })`.
Step 1 of `can()` returns `WRONG_ORG`, and `statusForDecision()` maps that to `404` with the message
`"Not found"` — one mapping, in the policy, instead of seven independently-chosen refusals. The
FRONTLINE checks these routes also carried are now the permission itself (`user:read`,
`user:invite`, `user:set_status`, `org:settings`, `org:branding`), which an OPERATOR does not hold.

| # | Probe | Route | Actual | Required |
|---|-------|-------|--------|----------|
| 7 | ISO-10 | `GET /organizations/{slug}` | `403 You can only read your own organization` | `404` |
| 8 | ISO-11 | `POST /organizations/{slug}/settings` | `403 You can only change your own organization` | `404` |
| 9 | ISO-12 | `POST /organizations/{slug}/branding` | `403 You can only manage your own organization branding` | `404` |
| 10 | ISO-13 | `GET /tenants/{tenantId}/summary` | `403 You can only view your own tenant` | `404` |
| 11 | ISO-14 | `GET /tenants/{tenantId}/users` | `403 You can only view your own tenant` | `404` |
| 12 | ISO-15 | `POST /tenants/{tenantId}/users` | `403 You can only invite into your own organization` | `404` |
| 13 | ISO-16 | `POST /tenants/{tenantId}/users/{username}/status` | `403 You can only manage your own tenant` | `404` |

### D-3 — A staff cross-organization read is not audited — FIXED in Phase 2 (tasks 7.3, 7.7)

**Probe ISO-25.** A staff principal reads another organization's record successfully (ISO-24, which
is correct and intended). No cross-tenant read audit event is recorded. Requirement 34.7 requires
the read to succeed *and* to produce one. At baseline the only audit trail for staff activity was on
writes.

**How it was closed.** The audit fires at the AUTHORIZATION point, not at the read:
`authorizeIn()` emits `CROSS_TENANT_READ` (or `CROSS_TENANT_WRITE`) whenever it ALLOWS a staff
principal against a `resource.orgId` other than its own. That placement matters — the
parameter-scoped routes resolve their record from the `PLATFORM` partition and never pass through
`crossTenantRead()`, so auditing inside the read would have missed exactly the route ISO-25 probes.
A route cannot now acquire cross-organization reach without also acquiring the audit event.

### D-4 — A deactivated member still reaches authenticated routes — FIXED in Phase 1 (task 5.4)

**Probe ISO-29.** At baseline, a user disabled in the user pool presented a session and received
`200` from `GET /runs`. Authorization was derived entirely from the session's own claims; no route
re-checked membership state, so the account stayed usable until its token expired.

Now every authenticated route consults the user pool and refuses a disabled account with `403`
`ACCOUNT_DISABLED` on its next call. The lookup fails **open** on a pool error and closed only on a
definite `Enabled === false`, so a transient identity-provider failure cannot sign the whole customer
base out at once.

## Deliberate cross-organization behaviour

**ISO-28 — `GET /organizations/{slug}/branding` is unauthenticated for any slug.** A sign-in page
has to brand itself before a session exists, so this returns any organization's name and branding
to any caller. It exposes no run, user, agent or execution data. Recorded here so the decision is
visible rather than assumed, not because it needs changing.

## What already isolates correctly

- **Entity lookups that scope the read itself** (ISO-07, ISO-08, ISO-09). `GET /workflows/{id}/versions`,
  `GET /workflows/{id}/preflight` and `POST /workflows/{id}/runs` resolve the workflow through a
  tenant-partitioned query, so another organization's id is simply not found: `404`, no leak. This is
  the pattern the D-1 routes should adopt.
- **Every list route** (ISO-17 … ISO-21). `GET /workflows`, `/runs`, `/agents`, `/agent-tasks` and
  `/support/tickets` were each asserted on the *complete* returned set. No item belonged to another
  organization.
- **Agent credentials** (ISO-22, ISO-23). An Org A agent token is offered only Org A tasks — and only
  the tasks matching its own surface — and claiming an Org B task by id returns `404`.
- **Staff reads succeed** (ISO-24), which is intended; only the missing audit event (D-3) is a defect.
- **Staff cross-organization writes are audited** (ISO-26) in the target organization's activity log.
- **A customer admin cannot redirect a write into another organization** (ISO-27). `POST
  /agent-authorizations` honours `body.tenantId` only for staff; for everyone else the caller's own
  tenant claim wins.
