# WorkIQ compliance and delivery boundary

WorkIQ is a separate AmazFlow product surface and service. It observes operational metadata to
help a team find repeatable work; it is not an employee surveillance product. This document is a
shipping record, not legal advice. Counsel must review jurisdiction-specific notices, works-council
requirements, lawful-basis decisions, and retention schedules before production use.

## Implemented in the MVP foundation

- WorkIQ records are tenant-scoped and stored behind a separate service/data boundary from the
  existing execution control plane.
- The employee-first surface is the primary view. Population views are resource-scoped and
  aggregates are suppressed below the configured minimum (default five).
- Agent/session telemetry is metadata only: application/domain, timestamps, active/idle state, and
  switch counts. The service rejects content-shaped fields rather than silently storing them.
- No WorkIQ code path captures keystroke content, passwords, messages/documents, form values,
  clipboard contents, webcam/microphone data, screenshots, or screen recordings.
- Pattern discovery produces an observed-pattern hypothesis with sample size and confidence; it
  cannot promote an opportunity without human confirmation.
- Disputes are persisted as classification changes and are included in later aggregation.
- Demo tenants and demo records are explicitly flagged and never mixed with real tenant totals.
- Cross-tenant identifiers are resolved from the authenticated identity and server-loaded records,
  not trusted from a client body.
- The standalone service exposes a narrow local API contract for hierarchy, metadata-only sessions,
  opportunities, and the Send-to-AmazFlow handoff; its current reference implementation is
  in-memory and is not a production persistence or retention implementation.

## Not implemented yet

- Written notice and acknowledgement records bound to each employee and jurisdiction.
- Jurisdiction-specific policy documents and organization/region “disabled pending approval” state.
- Data-subject export and deletion workflows for WorkIQ records.
- Server-enforced retention execution for raw telemetry in a production store.
- Counsel-approved GDPR Art. 88, CPRA, New York, Ontario, and works-council workflows.
- Screenshots, screen recording, content inspection, or any disabled/hidden capture mode. These are
  intentionally out of scope and must not be added as a shortcut.

## Delivery and operating notes

WorkIQ telemetry is agent-aggregated into completed sessions and batched; the target is fewer than
1,000 events per employee per day. At 500 seats and an eight-hour day sampled every five seconds,
the raw sampling equivalent is about 2.9 million samples/day, but those samples are not persisted
by WorkIQ. A representative planning envelope for completed-session writes is:

| Seats | Session records/day (planning ceiling) | Cost posture |
|---:|---:|---|
| 100 | 100,000 | low; existing serverless footprint plus bounded object storage |
| 1,000 | 1,000,000 | review batching/compression and retention before enabling production scale |
| 10,000 | 10,000,000 | requires an explicit capacity and paid-infrastructure review |

These are planning envelopes, not measured bills. Actual cost depends on session length, batch size,
storage class, egress, query volume, and the selected WorkIQ deployment. No new paid AWS resource
should be deployed without an updated estimate and approval.

## Known limitations and next gates

The MVP makes a conservative distinction between measured telemetry and estimated savings. It does
not claim that an observed sequence is a canonical business process, and it does not issue punitive
individual alerts. Before broad rollout, implement the legal acknowledgement/data-rights machinery,
replace the reference service's in-memory store with an approved production persistence design,
implement server-side retention deletion, complete a security review, and publish an operational
runbook for tenant export, deletion, and jurisdictional disablement.
