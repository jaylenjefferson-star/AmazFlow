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

The deployed workspace persists workflow definitions and execution history in DynamoDB. AmazFlow Copilot and workflow generation call Amazon Bedrock directly (Claude Sonnet 4.6, model id `us.anthropic.claude-sonnet-4-6`). A separate, real Amazon Bedrock AgentCore Harness (`harness_pwphl`) is deployed as a narrow, SUPER_ADMIN-triggered diagnostic executor: given a signed, single-use execution grant scoped to one run and step, it can call exactly one Gateway-mediated tool (`record_step_result`) to write a progress note into that run's audit trail. It does not perform browser actions, and the workflow engine never invokes it automatically. The product calls Bedrock usage generally "AmazFlow managed AI"; vendor details remain disclosed on Security and Subprocessors pages. The production boundary permits live, non-regulated operational data. Do not enter PHI, payment-card data, secrets, or other regulated data until the corresponding compliance and security controls are enabled.

Local engine-sandbox development uses synthetic data and in-memory persistence. AWS hosts the protected control plane in `us-east-1`; Amplify Hosting builds the web application from the private GitHub repository.

`infrastructure/aws-cdk/amazflow-dev.yaml` is the live production control plane today: a single, hand-maintained CloudFormation template packaging the control-plane Lambda, all API routes, DynamoDB access, the signed execution-grant implementation, and the AgentCore Harness/Gateway wiring described above. It is deployed manually through the AWS Console. `infrastructure/aws-cdk/src/app.ts` and `services/control-plane` describe a separate, more ambitious CDK stack — deny-by-default Gateways and policy engines, additional Harnesses, Memory, a managed Browser tool, encrypted recordings — that is not built or deployed anywhere. Treat it as the target architecture, not current production, until it is actually built, deployed, and staged.

The Chrome agent source lives in `apps/browser-agent` and is the only mechanism today that performs real browser actions — clicking, typing, reading, and scrolling on a live page. It polls the control plane for short-lived tenant-scoped tasks, highlights its target, records recent activity locally, and executes only its explicit operation allowlist. A cloud-hosted managed Browser tool is part of the CDK stack above but is not deployed; until it ships, the Chrome extension is required for any workflow with a `browser` provider step.

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
