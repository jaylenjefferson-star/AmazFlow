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
