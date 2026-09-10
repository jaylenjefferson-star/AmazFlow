# Organization settings

Per-organization configuration, on an organization's **Configuration** tab in the operations
console. The set is deliberately small, because the rule is that **every field here is read by
something**. A setting that is stored and never enforced is worse than a missing one: the console
then reports a control that does nothing, which is how `plan` came to look like a limit for months
without ever being one.

## What exists, and what reads it

| Field | Who can set it | What reads it |
| --- | --- | --- |
| `name` | AmazFlow | This console and the customer's sign-in page |
| `status` | AmazFlow | **Run creation.** Not `active` → the run is refused |
| `plan` | AmazFlow | Nothing. Recorded for reporting, and labelled as such in the UI |
| `settings.maxConcurrentRuns` | AmazFlow | **Run creation.** `0` means no limit |
| `settings.allowedEmailDomains` | AmazFlow + customer admin | Team invitations |
| `settings.timezone` | AmazFlow + customer admin | How this org's timestamps are displayed |
| `branding.*` (4 fields) | AmazFlow + customer admin | The sign-in page |

`slug` is **immutable**. It is the tenant identifier, carried in every Cognito claim and every
DynamoDB partition key, so renaming it would orphan the tenant's data. The API rejects any attempt
explicitly rather than ignoring it silently.

## Statuses

| Status | Effect |
| --- | --- |
| `active` | Work runs normally |
| `paused` | No new runs can start. Runs already in flight are left alone |
| `suspended` | Same, and the customer is told to contact AmazFlow |

Pausing never touches in-flight work and never deletes anything. Setting it back to `active`
restores execution immediately.

## Routes

```
GET  /organizations/{slug}            SUPER_ADMIN, or a CLIENT_ADMIN for their own org
PUT  /organizations/{slug}            SUPER_ADMIN only  (name, status, plan)
POST /organizations/{slug}/settings   SUPER_ADMIN, or a CLIENT_ADMIN for their own org
```

`GET` fills defaults, so `settings` is never partially undefined for a caller.

A `CLIENT_ADMIN` may change their own `timezone` and branding but **not** `maxConcurrentRuns` —
a customer who could raise their own ceiling does not have a ceiling. The API returns 403 rather
than silently dropping the field, so a mistaken client gets told.

Both routes write an activity entry (`ORG_UPDATED`, `ORG_SETTINGS_CHANGED`) carrying `before` and
`after`, so a change of commercial state is attributable.

## Validation

- `status` / `plan` — closed sets. Anything else is a 400.
- `maxConcurrentRuns` — integer, 0–1000. Fractions and negatives are refused.
- `allowedEmailDomains` — max 20. Normalised before storage: `@` stripped, lowercased, deduped,
  so `@Acme.com` and `acme.com` are one entry and the invite-time check is plain equality rather
  than a parse.
- `timezone` — validated against the runtime's own tz database via `Intl.DateTimeFormat`, not a
  hardcoded list, so it cannot drift and cannot smuggle arbitrary text into the console.

## The concurrency limit

Counted against a **positive** list of in-flight statuses — `RUNNING`, `WAITING_AGENT`,
`WAITING_APPROVAL`, `AWAITING_CONFIRMATION`. A run status added later is therefore not counted, so
an unrecognised status **fails open** and lets work start rather than blocking a customer over a
vocabulary gap. Terminal runs never count. The limit is per organization; another tenant's traffic
is invisible to it.

An organization with no record at all also fails open. A management row that was never created must
not lock a working tenant out of execution.

## Tests

`infrastructure/aws-cdk/test/org-settings.test.cjs` — 22 checks against the **deployed** template's
inline Lambda, extracted verbatim. The ones that matter are the enforcement cases: a paused org
cannot start work, resuming restores it, the limit refuses the run that would exceed it, terminal
runs don't count, another tenant's runs don't count, `0` means unlimited, and a missing org still
runs.

`source-parity.test.cjs` carries 12 further invariants asserting these exist in **both** control-plane
copies. That matters here specifically because the failure mode is asymmetric: a copy carrying the
settings routes but not the run-creation gates would accept "paused" and keep executing, which is
the exact thing the feature exists to prevent.

## Not deployed yet

These routes are in `infrastructure/aws-cdk/amazflow-dev.yaml` and in the canonical handler, but the
control plane is deployed by hand. Until someone runs `pnpm deploy:control-plane -- --apply` (see
`docs/DEPLOYING.md`), the console's Configuration tab will call routes that 404 in production and
say so in its load-error banner.
