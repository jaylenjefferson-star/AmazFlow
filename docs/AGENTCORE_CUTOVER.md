# AgentCore cutover runbook

## Required inputs

- Existing DynamoDB control-plane table name.
- Existing Cognito user pool and web client IDs.
- Private subnet IDs and security groups whose outbound rules allow only the approved proxy/endpoints used by managed browser connections.
- AWS credentials permitted to deploy the CDK stack in `us-east-1`.
- Current contracted input/output token rates for spend telemetry; authoritative billing remains in AWS Cost Explorer/CUR.

Build `@amazflow/control-plane`, synthesize `@amazflow/aws-cdk`, and deploy `AmazFlowAgentCore` with those parameters. CDK imports the table and Cognito resources; it does not copy workflows or historical runs.

After the memory resource exists, run `pnpm --filter @amazflow/control-plane migrate:copilot-memory` with `TABLE_NAME`, `AGENTCORE_MEMORY_ID`, and optionally `DEFAULT_OPERATOR_TENANT_ID`. The importer is idempotent, scrubs likely credentials, and marks historical events `SKIP` so they cannot become long-term memory. Only new, explicitly approved preferences may use long-term extraction.

## Staging gates

1. Replay every workflow fixture against `packages/engine` and compare every status transition, confirmation, approval, verification result, and audit type.
2. Exercise every existing HTTP route and the complete browser-connection lifecycle.
3. Run negative cases: cross-tenant identifiers, forged tool arguments, wrong role, expired/replayed grants, unconfirmed actions, disallowed origins, prompt injection, and direct mutation requests.
4. Run the browser suite three times, including profile reuse, selector changes, verification failure, live takeover/CAPTCHA, and connected-browser fallback.
5. Verify CloudWatch trace correlation and redaction; no raw customer input may be emitted as a metric dimension.
6. Keep the lower-cost model disabled until its evaluation set is within one percentage point of Sonnet task success with zero schema, policy, or tenant-isolation failures.

## Coordinated cutover

1. Freeze workflow publishing briefly and finish in-flight approval/confirmation writes.
2. Deploy the AgentCore stack with `AI_EXECUTION_BACKEND=agentcore` and `LEGACY_EXECUTOR_ENABLED=false`.
3. Point the web API setting to the new HTTP API endpoint and run smoke tests for Copilot, SOP generation, bounded AI, approval, confirmation, API action, managed browser, verification, cancellation, and timeout.
4. Unfreeze publishing. Watch policy denials, agent failures, fallback rate, p95 latency, token usage, and spend.

## Immediate rollback criteria

Rollback on any cross-tenant access, unconfirmed side effect, policy bypass, or sustained material failure-rate increase. Repoint the API to the retained stack, set its global backend to `legacy`, and set `LEGACY_EXECUTOR_ENABLED=true`. Do not retry an action whose side effect is uncertain; reconcile it first.

## Day 14 cleanup

If no rollback criterion was met, remove the direct-model permission and legacy `ConverseCommand` code, delete `infrastructure/aws-cdk/amazflow-dev.yaml`, and record the cleanup in the immutable operator activity log. No DynamoDB migration is required.
