# AmazFlow

A configurable operations execution platform. Workflows are data, not hard-coded product logic.

The control plane supports generic AI, browser, API, spreadsheet, approval, condition, verification, and terminal steps. An execution runs until it completes or reaches a durable wait state such as a browser-agent task or human approval.

## Run locally

```bash
pnpm install
pnpm dev
```

- Marketing site: http://localhost:3000
- Product console: http://localhost:3000/app
- API: http://localhost:4000

The public experience includes the homepage plus Product, Solutions, Security, Pricing, Company, Contact, Privacy, Terms, and Subprocessors pages. The product console is intentionally separated at `/app`; its current public mode is a clearly labeled, interactive synthetic-data demonstration. The three product access levels are Frontline User, Client Operations Admin, and AmazFlow Super Admin.

Local development uses synthetic data and in-memory persistence. AWS hosts the protected control-plane foundation in `us-east-1`; Amplify Hosting builds the web application from the private GitHub repository. When the protected API is unavailable, the web application remains a clearly labeled synthetic product preview rather than failing blank.

Set `BEDROCK_MODEL_ID` and AWS credentials to replace the deterministic local AI provider with bounded Amazon Bedrock inference. The provider enforces JSON output, confidence bounds, and configured allowed values.

The Chrome agent source lives in `apps/browser-agent`. It polls for short-lived tasks and only executes an explicit local operation allowlist. Its host permissions are intentionally limited to the local control plane in this build.

## Core API

- `GET /health`
- `GET/POST /workflows`
- `GET /workflows/:id`
- `POST /workflows/:id/runs`
- `GET /runs`
- `GET /runs/:id`
- `GET /agent-tasks`
- `POST /agent-tasks/:id/result`
- `POST /runs/:id/approvals/:stepId`

Production AI is routed through Amazon Bedrock from the AWS control plane. Direct browser-to-model calls are prohibited: workflow AI steps are bounded by configured operations, structured output, allowlists, confidence thresholds, policy checks, and audit events.
