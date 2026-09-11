# Intercom

Customer support runs through the Intercom messenger. Workspace app id: `fitw71yl`.

Everything lives in `apps/web/app/lib/intercom.tsx`, mounted once from the root layout
(`apps/web/app/layout.tsx`). No page opts in; the component decides for itself whether to boot.

## Where it boots

| Surface | Behaviour | Why |
| --- | --- | --- |
| Marketing pages, `/login`, `/forgot-password` | Anonymous | A prospect or someone locked out still needs a way to reach a human |
| `/console` (customer app) | Identified, with company | The customer surface |
| `/signed-out` | `shutdown()`, then anonymous | Otherwise the next person on this browser inherits the previous conversation |
| `/app` (operations console) | **Never boots** | Staff answer support; they should not appear in the customer inbox |
| Any `SUPER_ADMIN` session, anywhere | **Never boots** | Same reason, independent of path |

## What support sees

Identified boots send `user_id` (the Cognito `sub`), `email`, and:

- `name` and `created_at`, read from the id token **only if present**. `created_at` is never
  filled from `auth_time` — Intercom reads it as the sign-up date, so using the login time would
  make every customer look like they joined moments ago. It comes from a `custom:created_at`
  claim, which nothing sets yet.
- `company: { company_id: <tenantId>, name }` so conversations group by organisation instead of
  arriving as unrelated individuals. The name comes from the public
  `GET /organizations/{slug}/branding` route, cached per tab.
- `amazflow_role`, `amazflow_tenant`, `amazflow_surface` as custom attributes, so whoever picks
  up a conversation already knows who they are talking to and what they can do.

## Identity verification fails closed until the endpoint is enabled

Intercom cannot distinguish a real `user_id` from a forged one. Without a server-signed
`user_hash`, someone could open the console, set another customer's id, and impersonate them.

The client calls `GET /support/intercom-identity` and passes `userHash` at boot time, capped at
2 seconds so an unreachable control plane cannot stop support from loading. That endpoint **does
not exist yet**, so the messenger intentionally clears any prior identified session and boots
anonymous. It never sends a signed-in user's `user_id`, email, organization, role, or custom
attributes until the hash is available.

To enable it:

1. Copy the identity verification secret from Intercom (Settings → Security).
2. Store it for the control plane as `INTERCOM_IDENTITY_SECRET`.
3. Add `GET /support/intercom-identity`, returning
   `{ userHash: hmacSha256(secret, <caller's sub>) }` — keyed on the authenticated `sub` from the
   JWT, never on anything from the request body.
4. Deploy the control plane (`docs/DEPLOYING.md`), then confirm `whoami()` in Intercom reports the
   user as verified.

Until then, support sees an anonymous conversation only. Do not use it to disclose anything that
requires the customer's account context.

## Sessions

The component reads identity with `peekSession()`, not `loadSession()`.

`loadSession()` deletes an expired session as a side effect, which is correct for an access gate
and wrong for a passive reader. An id token past its 60 minutes is normally still refreshable, so
booting the messenger on a marketing page with `loadSession()` would delete a usable session and
sign the customer out roughly every hour.

## Relationship to in-app tickets

The messenger did not replace `/support/tickets`. Both exist, deliberately:

- **Chat** handles most questions faster than a ticket, and now leads on `/console/support`.
- **Tickets** remain the system of record and are the only path that captures a `runId` or
  `workflowId`, which is what makes an issue diagnosable. They are what the operations console's
  Support queue reads, and they carry the audit trail.

The two are presented as a choice, not a hierarchy.
