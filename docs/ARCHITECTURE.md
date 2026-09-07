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
- Development is synthetic-data only.

## AWS path

The included CDK stack is intentionally small and is not deployed automatically. It creates a retained, encrypted, pay-per-request DynamoDB control-plane table and retained CloudWatch audit log group. API Gateway, Lambda, Cognito, Bedrock, and the agent transport are added only after the local engine and data contracts are accepted.
