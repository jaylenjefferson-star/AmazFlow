# AmazFlow

A configurable operations execution platform. Workflows are data, not hard-coded product logic.

The control plane supports generic AI, browser, API, spreadsheet, approval, condition, verification, and terminal steps. An execution runs until it completes or reaches a durable wait state such as a browser-agent task or human approval.

## Run locally

```bash
pnpm install
pnpm dev:web
```

- Marketing site: http://localhost:3000
- Product console: http://localhost:3000/app
- Customer console: http://localhost:3000/console

The frontend talks directly to the deployed Lambda control plane (see below), not to a local API — `pnpm dev:web` is all you need for frontend work.

`services/api` is a separate, **never-deployed** local reimplementation of the workflow engine, used only to exercise `packages/engine` in isolation (`pnpm dev:engine-sandbox`, http://localhost:4000). It is not connected to AWS and is not what customers use.

The public experience includes the homepage plus Product, Solutions, Security, Pricing, Company, Contact, an ungated interactive demo at `/demo`, and Privacy, Terms, and Subprocessors pages. `/console` is customer sign-in (Frontline User and Client Operations Admin). The authenticated operator/builder workspace is intentionally separated at `/app` (AmazFlow Super Admin) and is never linked from the marketing site or sold as a demo. Cognito enforces three product access levels: Frontline User, Client Operations Admin, and AmazFlow Super Admin.

The deployed workspace persists workflow definitions and execution history in DynamoDB. Every model-driven interaction runs through two isolated Amazon Bedrock AgentCore Harnesses: an Operator Harness for Copilot and authoring, and a memoryless Execution Harness for one approved workflow step at a time. Claude Sonnet 4.6 is the default. The product calls this “AmazFlow managed AI”; vendor details remain disclosed on Security and Subprocessors pages. The production boundary permits live, non-regulated operational data. Do not enter PHI, payment-card data, secrets, or other regulated data until the corresponding compliance and security controls are enabled.

Local engine-sandbox development uses synthetic data and in-memory persistence. AWS hosts the protected control plane in `us-east-1`; Amplify Hosting builds the web application from the private GitHub repository.

`infrastructure/aws-cdk` is the infrastructure source of truth for the packaged control-plane Lambda, two deny-by-default Gateways and policy engines, Harnesses, Memory, managed Browser, encrypted 30-day recordings, API routes, and alarms. It imports the existing DynamoDB table and Cognito pool so workflow and run records are not migrated. The legacy inline template is retained only as the 14-day rollback artifact.

The Chrome agent source lives in `apps/browser-agent` and remains the supported fallback for private/local targets and incompatible authentication. Managed Browser is primary for active, origin-scoped browser connections. The extension polls the control plane for short-lived tenant-scoped tasks, highlights its target, records recent activity locally, and executes only its explicit operation allowlist.

## Load the Chrome agent

1. Build it: `pnpm --filter @amazflow/browser-agent build` (produces `apps/browser-agent/dist`, which is gitignored like any other build output).
2. In Chrome, go to `chrome://extensions`, enable Developer mode, and click "Load unpacked", then select `apps/browser-agent/dist`.
3. Open the extension popup and click **Connect to AmazFlow**. Sign in normally if needed, name the browser agent, and authorize it. The extension exchanges the short-lived authorization code automatically.
4. Open the tab where a workflow's browser action should run and click "Enable on this site" in the popup — Chrome will prompt to confirm the grant. The agent only acts on origins explicitly enabled this way.

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
- `GET/POST /connections/browser`
- `POST /connections/browser/:id/login-session`
- `POST /connections/browser/:id/login-session/complete`
- `DELETE /connections/browser/:id`

Production AI is routed through AgentCore from the control plane. Direct browser-to-model calls are prohibited: workflow AI steps are bounded by configured operations, structured output, allowlists, confidence thresholds, signed execution grants, policy checks, independent verification, and audit events.

In the authenticated Workflow Studio, **Generate from SOP** turns a plain-English procedure into an editable draft and immediately saves it to the workflow library. Drafts survive refreshes and later sessions; publishing remains an explicit admin action.
