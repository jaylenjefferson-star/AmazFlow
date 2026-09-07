# AmazFlow

A configurable operations execution platform. Workflows are data, not hard-coded product logic.

The control plane supports generic AI, browser, API, spreadsheet, approval, condition, verification, and terminal steps. An execution runs until it completes or reaches a durable wait state such as a browser-agent task or human approval.

## Run locally

```bash
pnpm install
pnpm dev
```

- Console: http://localhost:3000
- API: http://localhost:4000

Local development uses synthetic data and in-memory persistence. The AWS CDK stack provisions the production-shaped control-plane storage and API foundation without deploying it automatically.

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

No production resources are deployed by this repository without an explicit CDK deploy.
