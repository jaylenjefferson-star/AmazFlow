# Deploying AmazFlow

Four things ship independently. Only one of them needs a human in the AWS console, and this
document exists so that step stops being tribal knowledge.

| Component | Ships by | Needs AWS access? |
|---|---|---|
| Web app (`apps/web`) — marketing, `/console`, `/app` | Merge to `main` → Amplify Hosting builds from GitHub | No |
| Control plane Lambda + API routes (`infrastructure/aws-cdk/amazflow-dev.yaml`) | CloudFormation deploy | **Yes** |
| Chrome extension (`apps/browser-agent`) | Rebuild the zip, commit it, merge → Amplify serves it from `/downloads` | No |
| Desktop Agent (`apps/desktop-agent`) | Signed macOS build attached to a GitHub release | No (needs Apple signing) |

Nothing here deploys `services/control-plane/src/handler.ts` or `infrastructure/aws-cdk/src/app.ts`.
Those are the target architecture and are not built or deployed anywhere — see README.

---

## Before any deploy

```bash
pnpm install
pnpm -r test        # 108 checks, no AWS credentials needed
```

`pnpm --filter @amazflow/aws-cdk test` is the one that matters most before touching the control
plane: `critical-path` runs the template's **own inline Lambda source** against an in-memory
DynamoDB, and `source-parity` plus `provider-parity` assert the deployed template and the
canonical source still agree on every security invariant and on the provider allowlist.

---

## 1. Web app — automatic

Amplify Hosting is connected to this repository and builds `apps/web` per `amplify.yml` on every
push to the tracked branch. Merging is the deploy. There is nothing to run.

Verify a deploy landed:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://amazflow.com/
```

---

## 2. Control plane — the one manual step

The live control plane is a single hand-maintained CloudFormation template,
`infrastructure/aws-cdk/amazflow-dev.yaml`, deployed to stack **`amazflow-dev`** in
**us-east-1**.

### Option A — the script (preferred)

```bash
pnpm deploy:control-plane            # preview only, changes nothing
pnpm deploy:control-plane -- --apply # prompts for confirmation, then deploys
```

The script refuses to proceed unless the template validates and the full test suite passes, then
creates a **changeset and prints exactly what would change** before anything is applied. That
preview is the point: it is the difference between "deploy and hope" and knowing that a template
edit touches only the Lambda function and not, say, the DynamoDB table.

The template creates an `AWS::SecretsManager::Secret` for execution-grant signing and passes only
its identifier to Lambda. Lambda fetches the value at runtime and never writes it to a response,
record, log, or environment variable. The initial migration from the older template parameter
creates a new signing secret, so it has the same effect as a rotation: outstanding grants stop
verifying.

### Execution-grant secret migration and rotation procedure

Only perform the first migration or a later rotation in an approved maintenance window:

1. Stop admitting new workflow runs and connected-agent claims.
2. Confirm there are **zero** runs in `WAITING_AGENT` and no active task leases or unexpired grants.
3. Deploy the reviewed change (or rotate the Secrets Manager value) and force fresh Lambda
   environments before reopening admission, so every signer and verifier reads the same value.
4. Re-enable admission, then verify a newly minted grant can make one read-only/progress call.

Do not rotate while a run awaits an agent. Rotation invalidates all grants issued with the prior
key; reconciling an uncertain side effect always takes priority over retrying it.

### Option B — raw AWS CLI

```bash
cd infrastructure/aws-cdk
aws cloudformation deploy \
  --template-file amazflow-dev.yaml \
  --stack-name amazflow-dev \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1
```

### Option C — the console

Upload `amazflow-dev.yaml` to the `amazflow-dev` stack and update. Works, but you lose the test
gate and the changeset preview, so prefer A.

### Confirming it worked

```bash
curl -s https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com/health
```

`GET /health` is public and read-only. It reports the data boundary and AI runtime the deployed
build is actually running, which is the fastest way to tell which code is live.

---

## 3. Chrome extension

The extension is served to customers as a zip from the web app, so its build product is
committed. **A source change to `apps/browser-agent` does not reach anyone until the zip is
rebuilt** — this has silently shipped a stale extension before.

```bash
pnpm --filter @amazflow/browser-agent release
```

That builds `dist/`, runs the contract test against it, and rewrites
`apps/web/public/downloads/amazflow-agent.zip`. Commit the zip with the source change; CI fails
the build if they drift.

---

## 4. Desktop Agent

```bash
pnpm --filter @amazflow/desktop-agent package:mac
```

Output lands in `apps/desktop-agent/release/` (gitignored). Attach the DMG to a GitHub release.
The current build is ad-hoc signed but **not notarized**, so a downloaded copy is blocked on
first launch; see README for the macOS 15+ path. Ship a Developer ID signed and notarized build
before distributing outside the team.

---

## Automating the control-plane deploy

`.github/workflows/deploy-control-plane.yml` deploys the stack on merge to `main` using GitHub's
OIDC provider, so no long-lived AWS keys are stored anywhere. It is **inert until an IAM role
exists**, which is a one-time setup in the AWS console:

1. IAM → Identity providers → Add provider → OpenID Connect
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
2. IAM → Roles → Create role → Web identity → that provider, audience `sts.amazonaws.com`
3. Restrict the trust policy to this repository:

   ```json
   {
     "Condition": {
       "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
       "StringLike": {
         "token.actions.githubusercontent.com:sub": "repo:jaylenjefferson-star/AmazFlow:ref:refs/heads/main"
       }
     }
   }
   ```

4. Attach permissions for CloudFormation plus the services the template manages (Lambda, API
   Gateway, DynamoDB, IAM, Cognito, SES, EventBridge, Logs). Scope it to the `amazflow-dev`
   stack rather than granting `*`.
5. In GitHub → Settings → Secrets and variables → Actions, add
   `AWS_DEPLOY_ROLE_ARN` with the role ARN.
6. In GitHub → Settings → Environments, create an environment named `production` and add
   yourself as a required reviewer.

Step 6 is what keeps this safe: the workflow runs the full test suite and creates the changeset
automatically, then **waits for your approval** before applying it. You still decide every
production change; you just stop hand-carrying files into a console to make it happen.

Until the role exists the workflow skips cleanly, and Option A above remains the path.
