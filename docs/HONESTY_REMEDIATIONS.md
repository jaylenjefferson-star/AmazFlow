# Honesty remediation record

This is the current replacement for the superseded September 2026 gap analysis. It records the
resolution of each design-review honesty finding without claiming that a pending item is complete.

| Finding | Resolution | Status |
| --- | --- | --- |
| H-1: unverified Intercom identity | The customer messenger now boots anonymous unless a server-signed `user_hash` is available; it never sends authenticated identity fields without one. | Resolved safely; identity endpoint remains deferred. |
| H-2: fabricated dollar savings | The control plane no longer returns `dollarEstimate`; customer and staff surfaces do not render a hardcoded labor-value calculation. Time savings remain explicitly estimated from recorded manual duration. | Resolved. |
| H-3: plan looked enforceable | Every displayed plan is labelled reporting-only. Workflow status, assigned roles, and the explicit concurrent-run limit are the actual enforcement mechanisms. | Resolved. |
| H-4: unrecorded retry counts | Retry configuration and attempt counts are not rendered. No execution path persists or reads a retry counter. | Resolved. |
| H-5: divergent CORS behaviour | The control-plane route and origin parity guardrails cover the closed origin allowlist and all served methods. | Resolved in the prior control-plane convergence work. |
| H-6: execution-grant secret in template | Lambda receives a Secrets Manager identifier and fetches the signing value at runtime. Migration and rotation require zero runs awaiting an agent. | Implemented; deployment remains an approved maintenance-window action. |
| H-7: stale missing-flows document | `MISSING_FLOWS.md` is marked superseded and points here and to the current task plan. | Resolved. |
| H-8: role change unavailable | The scoped user-role route and corresponding customer/staff controls are implemented, with last-owner and staff-role protection. | Resolved in Phase 4 administration work. |
