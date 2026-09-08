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

The development workspace persists workflow definitions and execution history in DynamoDB. Workflow AI steps run through Amazon Bedrock Nova Lite. The active boundary remains synthetic-only: do not enter PHI, customer production data, or real credentials.

Local development uses synthetic data and in-memory persistence. AWS hosts the protected control-plane foundation in `us-east-1`; Amplify Hosting builds the web application from the private GitHub repository. When the protected API is unavailable, the web application remains a clearly labeled synthetic product preview rather than failing blank.

Set `BEDROCK_MODEL_ID` and AWS credentials to replace the deterministic local AI provider with bounded Amazon Bedrock inference. The provider enforces JSON output, confidence bounds, and configured allowed values.

The Chrome agent source lives in `apps/browser-agent`. It polls the AWS control plane for short-lived, tenant-scoped agent tasks and only executes an explicit operation allowlist. It has no standing access to any site: it holds a fixed host permission for the AmazFlow API only, and every other origin is an optional permission the operator must explicitly grant per site from the extension popup (via Chrome's own permission prompt) before the agent will inject a content script there. The popup also stores the operator's AmazFlow session token, which authorizes calls to `GET /agent-tasks` and `POST /agent-tasks/:id/result`.

## Load the Chrome agent

1. Build it: `pnpm --filter @amazflow/browser-agent build` (produces `apps/browser-agent/dist`, which is gitignored like any other build output).
2. In Chrome, go to `chrome://extensions`, enable Developer mode, and click "Load unpacked", then select `apps/browser-agent/dist`.
3. Open the extension popup, sign in to AmazFlow in a normal tab, copy `amazflow_session.idToken` from DevTools → Application → Local Storage, and paste it into the popup's token field, then Save.
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

Production AI is routed through Amazon Bedrock from the AWS control plane. Direct browser-to-model calls are prohibited: workflow AI steps are bounded by configured operations, structured output, allowlists, confidence thresholds, policy checks, and audit events.
