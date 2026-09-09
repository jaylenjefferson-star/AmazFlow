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

## AWS path

The included CloudFormation template defines the deployed control plane: a retained, encrypted, pay-per-request DynamoDB table, CloudWatch audit logs, API Gateway, Lambda, Cognito, Amazon Bedrock, and the browser-agent transport. Amplify deploys the frontend from GitHub; control-plane template updates are deployed separately through CloudFormation.
