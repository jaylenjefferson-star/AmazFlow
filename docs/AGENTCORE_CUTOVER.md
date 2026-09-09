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

## Vertical-slice proof (2026-09-09) -- actual path taken so far

The plan above assumes a full `@amazflow/control-plane` + `@amazflow/aws-cdk` deploy. That stack has not been built or deployed (this environment has no Node toolchain to run esbuild/cdk). Instead, the first real grant -> Harness -> Gateway -> backend chain was proven by extending the existing, live, inline-Lambda production stack (`infrastructure/aws-cdk/amazflow-dev.yaml`) directly -- **the production control plane was never replaced**, only given two new narrow routes. `infrastructure/aws-cdk/amazflow-dev.yaml` should NOT be deleted until the full stack above is actually built, deployed, and staging-gated; that has not happened yet.

**What's real and deployed:**
- `POST /runs/{id}/executor/invoke` (JWT, SUPER_ADMIN) and `POST /agent/tools/record-step-result` (grant-authed) added to the live Lambda. Grant format is an inline port of `packages/engine/src/execution-grant.ts` (same v1 wire format, same fields), not a second format.
- CFN parameters `ExecutionGrantSecret` (NoEcho, dev/staging secret baked into the template -- move to Secrets Manager before this carries real customer actions) and `ExecutorHarnessArn`.
- AgentCore Harness `harness_pwphl` (ARN `arn:aws:bedrock-agentcore:us-east-1:398681517793:harness/harness_pwphl-y67Z8PxUwD`), reconfigured this session: model `us.anthropic.claude-sonnet-4-6`, system prompt establishes the bounded-execution-grant contract, one Gateway tool attached.
- AgentCore Gateway `amazflow-executor-gateway` (target `amazflow-tools`), REST API target, inline OpenAPI schema exposing exactly one operation (`record_step_result`) against `POST /agent/tools/record-step-result` on the existing API (`https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com`). Inbound auth: IAM. Outbound auth to the target: none (the target route has no API-Gateway-level auth; authorization is the execution grant, verified inside the Lambda).
- No Policy Engine attached yet -- deliberately deferred; the backend already enforces tenant/workflow/run/step/tool/expiry/single-use deterministically without it.

**Verified live, this session:**
- All 7 negative cases against `/agent/tools/record-step-result` with offline-minted grants (same HMAC secret/algorithm): malformed -> 400, tampered signature -> 401, expired -> 401, tool not in `allowedTools` -> 403, well-formed grant for a nonexistent run -> 404 (and consumes the grant), replay of that same grant -> 409, missing fields -> 400.
- Full chain in the Harness playground: a manually-minted grant in the prompt -> Harness correctly extracted it -> called `record_step_result` via the Gateway with the exact grant/stepId/status/note -> Gateway reached the real Lambda -> Lambda verified the grant and correctly 404'd (run intentionally didn't exist) -> Harness reported the failure honestly rather than claiming success.
- Not yet verified: a real run created through the product, `/runs/{id}/executor/invoke` end to end, and a `record_step_result` call that actually succeeds and is visible in a run's audit trail. Needs a live SUPER_ADMIN session (not available in this environment after credential hygiene cleanup).
