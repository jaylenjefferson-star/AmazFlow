# AmazFlow V0.1 architecture

## Product boundary

AmazFlow is a general-purpose operations control plane. It stores versioned workflow definitions and executes a generic graph of bounded steps.

```text
Configured trigger
  -> workflow version
  -> AI / condition / approval / action / verification
  -> browser, API, spreadsheet, email, file, or human provider
  -> durable result + immutable audit events
  -> continue, retry, exception, or complete
```

## Safety invariants

- Every object is tenant-scoped.
- A workflow allowlists its execution providers.
- AI output is structured and confidence-gated.
- AI never receives unrestricted tool authority.
- External actions pause behind durable tasks.
- Completion requires explicit verification where configured.
- Human approvals are first-class wait states.
- Local engine-sandbox development is synthetic-data only.
- Production is limited to non-regulated operational data until additional compliance controls are enabled.

## AgentCore-first path

The packaged TypeScript control plane is deployed from CDK. DynamoDB remains authoritative for tenants, pinned workflow versions, runs, approvals, confirmations, verification results, billing-facing records, and audit evidence.

The Operator Harness owns Copilot and workflow/SOP authoring and can access only proposal-oriented Gateway tools. The Execution Harness owns bounded AI and one approved action at a time. Its Gateway tools require an expiring, signed, single-use grant bound to the tenant, run, pinned workflow version, step, tool, and confirmation state. AgentCore session state and Memory are never workflow truth.

Managed Browser is the primary browser executor. Connections bind a tenant to a public HTTPS base URL, explicit origin allowlist, and encrypted browser profile. Sessions run in private subnets with controlled egress and encrypted recordings that expire after 30 days. Connected Chrome execution remains the explicit or pre-action fallback; an uncertain side effect always stops for reconciliation.

`infrastructure/aws-cdk/amazflow-dev.yaml` is the temporary rollback artifact. It is not the forward infrastructure source of truth and must be deleted with its direct-model IAM permission after the 14-day recovery window.
