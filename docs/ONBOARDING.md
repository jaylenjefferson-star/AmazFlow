# Customer onboarding

## What used to happen

Getting a customer working took eight steps and **three of them were done by hand in the AWS
console**:

| Step | Before | Now |
| --- | --- | --- |
| 1. Lead captured | `POST /leads` + SES | unchanged |
| 2. Organization created | ops console | unchanged |
| 3. **Cognito user created** | 🚫 manual | ✅ `POST /tenants/{tenantId}/users` |
| 4. **`custom:tenant_id` set** | 🚫 manual | ✅ same call |
| 5. **Added to a role group** | 🚫 manual | ✅ same call |
| 6. Password set | Cognito email + `/login` challenge | unchanged |
| 7. First workflow | AmazFlow staff | unchanged, and the customer is now told so |
| 8. Agent install | one-time code | unchanged, now surfaced in the checklist |

Doing 3–5 by hand is how you get the two failure modes this replaces:

- **A user with no group** cannot sign in at all — `sessionFromAuthResult` refuses a session
  without one of the three role groups.
- **A user with no tenant claim** silently lands in the `amazflow` tenant, because
  `sessionFromAuthResult` defaults `tenantId` when the claim is absent.

Both are now impossible through the invite route, and both are asserted in the tests.

## The route

```
POST /tenants/{tenantId}/users     { email, role }
```

SUPER_ADMIN, or a CLIENT_ADMIN for their own tenant. A FRONTLINE caller is refused.

It creates the Cognito user with `email`, `email_verified: true`, `custom:tenant_id`, and
`custom:created_at`, then adds them to the role group. Cognito emails the temporary password and
`/login` already handles the `NEW_PASSWORD_REQUIRED` challenge in-page, so there is **no separate
acceptance route to build** and the invitee never sees a raw Cognito screen.

### Order matters

The user is created first, then added to a group. That order is not interchangeable. If the second
call fails, the result is somebody who **cannot sign in** rather than somebody sitting in the wrong
tenant with working access. That is the safe direction to fail.

When it does fail, the route returns **502 with "they cannot sign in yet… Retry the invitation"**
and logs the detail. It does not report success. A half-created invitation also does not appear in
the team list, because membership is defined by group and they have no group — so the list stays
honest without special-casing.

### What is refused

| Condition | Response |
| --- | --- |
| `role: "SUPER_ADMIN"` | 403 — staff accounts are not a tenant-scoped concept, for any caller |
| Role outside `CLIENT_ADMIN` / `FRONTLINE` | 400, rather than defaulting |
| Address outside the org's `allowedEmailDomains` | 422, listing the allowed domains |
| Already a member | 409 |
| Address used by another organization | 409, saying to ask AmazFlow to move them |
| Organization `suspended` | 409 |
| Organization `paused` | **allowed** — pausing stops execution, not administration, and a customer mid-onboarding is often paused |

`email_verified` is set because we mailed the invitation to that address; asking the invitee to
verify it as well would prove nothing extra.

`custom:created_at` records their real sign-up date in Unix seconds. Nothing else recorded it, and
the support messenger reads it as account age (`docs/INTERCOM.md`).

## Seeing who has accepted

`GET /tenants/{tenantId}/users` now returns `userStatus` and `createdAt`.
`FORCE_CHANGE_PASSWORD` is an invitation nobody has accepted; `CONFIRMED` is a working account.
Without it the console could not tell "invited last week and ignored it" from "signed in this
morning". Both consoles show an **Invited** pill and a count of who is still outstanding.

## What the customer sees

A brand-new workspace used to say *"Your workspace is ready. Your AmazFlow contact will assign your
first workflow shortly."* — accurate, but a dead end.

It is now a checklist whose rows reflect real state: the account step is already complete, the team
step counts actual members and links to the invite form, the extension step links to the download,
and the workflow step is marked as **waiting on AmazFlow** with "nothing is needed from you" rather
than an empty checkbox implying the customer is behind.

A team admin can now invite their own people. The Team screen used to end with "Need to add someone?
Ask your AmazFlow contact."

## IAM

Added `cognito-idp:AdminCreateUser` and `cognito-idp:AdminGetUser`. `AdminAddUserToGroup` was
already granted — a comment in the template had reserved it for exactly this flow.

Deliberately **not** granted:

- `AdminDeleteUser` — removal is done by disabling, which is reversible and keeps the person's audit
  trail attributable. Hence no delete button anywhere.
- `AdminSetUserPassword` — no operator route should be able to set a customer's password.

## Tests

`infrastructure/aws-cdk/test/onboarding.test.cjs` — 20 checks against the **deployed** template's
inline Lambda. The harness gained a working in-memory user pool rather than a stub that always
answered "no users": invitations exist to mutate the pool, so a stub that cannot hold a user could
only ever assert that the handler did not crash. It can also be told to fail the next
`AdminAddUserToGroup`, which is how the partial-failure path above is actually exercised.

12 further parity invariants assert the tenant claim, the group assignment, the role allowlist, and
the failure reporting exist in **both** control-plane copies.

## Still manual

- **Changing an existing person's role.** No route; it is an identity-pool operation.
- **Password resets** beyond the customer's own `/forgot-password`.
- **Moving someone between organizations.**
- **The first workflow**, by design — AmazFlow staff author workflows.

Both consoles state these plainly rather than leaving someone hunting for a control.

## Not deployed yet

The control plane is deployed by hand. Until `pnpm deploy:control-plane -- --apply` runs (see
`docs/DEPLOYING.md`), the invite button calls a route that 404s in production. The IAM change is
part of the same template, so the deploy covers both.
