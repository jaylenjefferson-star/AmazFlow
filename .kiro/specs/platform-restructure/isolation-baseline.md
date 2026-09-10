# Baseline two-organization isolation audit

Produced by task 1.4 against the **unmodified** deployed control plane
(`infrastructure/aws-cdk/amazflow-dev.yaml`), using the credential-free in-memory harness and the
two-organization seed fixture. This is the audit artifact Phase 2's isolation work is measured
against. Nothing here was fixed in Phase 0 — that is deliberate.

Reproduce with `node infrastructure/aws-cdk/test/isolation-baseline.test.cjs`. The suite compares
each probe against `infrastructure/aws-cdk/test/isolation-baseline.json` and fails on **drift**, so
a change that fixes or introduces a defect cannot land without updating this baseline in the same
commit.

**Result: 29 probes — 13 pass, 15 defects, 1 deliberate cross-organization behaviour.**

Correct isolation, per requirement 34.4, is: a principal of Org A presenting an identifier
belonging to Org B receives status `404` and a body containing nothing of Org B's.

## Defects

Every defect below is the *same* defect repeated at 15 call sites, with two variants.

### D-1 — Wrong refusal status leaks record existence across the tenancy boundary

These routes load the record with a staff-level scan and then compare tenancy, refusing with `403`
and a message that names the record type. `403 "Run belongs to another tenant"` is an existence
oracle: it distinguishes "this run id exists in another organization" from "this run id does not
exist", which is exactly the distinction `404` is required to hide. No Org B field values appear in
any response body.

| # | Probe | Route | Actual | Required |
|---|-------|-------|--------|----------|
| 1 | ISO-01 | `POST /runs/{id}/cancel` | `403 Run belongs to another tenant` | `404` |
| 2 | ISO-02 | `POST /runs/{id}/approvals/{stepId}` | `403 Run belongs to another tenant` | `404` |
| 3 | ISO-03 | `POST /runs/{id}/confirmations/{stepId}/confirm` | `403 Run belongs to another tenant` | `404` |
| 4 | ISO-04 | `POST /agents/{id}/revoke` | `403 Agent belongs to another tenant` | `404` |
| 5 | ISO-05 | `POST /agent-tasks/{id}/result` | `403 Task belongs to another tenant` | `404` |
| 6 | ISO-06 | `POST /support/tickets/{id}/status` | `403 Ticket belongs to another tenant` | `404` |

### D-2 — Parameter-scoped routes refuse with `403` rather than `404`

The organization identifier arrives in the path and is compared against the session's own tenant
claim before anything is loaded. Weaker than D-1 — nothing is read — but the status code still
distinguishes "another organization's slug" from "no such slug".

| # | Probe | Route | Actual | Required |
|---|-------|-------|--------|----------|
| 7 | ISO-10 | `GET /organizations/{slug}` | `403 You can only read your own organization` | `404` |
| 8 | ISO-11 | `POST /organizations/{slug}/settings` | `403 You can only change your own organization` | `404` |
| 9 | ISO-12 | `POST /organizations/{slug}/branding` | `403 You can only manage your own organization branding` | `404` |
| 10 | ISO-13 | `GET /tenants/{tenantId}/summary` | `403 You can only view your own tenant` | `404` |
| 11 | ISO-14 | `GET /tenants/{tenantId}/users` | `403 You can only view your own tenant` | `404` |
| 12 | ISO-15 | `POST /tenants/{tenantId}/users` | `403 You can only invite into your own organization` | `404` |
| 13 | ISO-16 | `POST /tenants/{tenantId}/users/{username}/status` | `403 You can only manage your own tenant` | `404` |

### D-3 — A staff cross-organization read is not audited

**Probe ISO-25.** A staff principal reads another organization's record successfully (ISO-24, which
is correct and intended). No cross-tenant read audit event is recorded. Requirement 34.7 requires
the read to succeed *and* to produce one. Today the only audit trail for staff activity is on
writes.

### D-4 — A deactivated member still reaches authenticated routes

**Probe ISO-29.** A user disabled in the user pool presents a session and receives `200` from
`GET /runs`. Authorization is derived entirely from the session's own claims; no route re-checks
membership state against the pool or a membership record. The account stays usable until its token
expires.

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
