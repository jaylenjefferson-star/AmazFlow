# Deploying AmazFlow

Four things ship independently. Only one of them needs a human in the AWS console, and this
document exists so that step stops being tribal knowledge.

| Component | Ships by | Needs AWS access? |
|---|---|---|
| Marketing web app (`apps/web`) — marketing, `/console`, `/app` | Merge to `main` → Amplify Hosting builds from GitHub | No |
| Customer app (`apps/customer`) — `app.amazflow.com` | Merge to `main` → Amplify Hosting builds from GitHub | No |
| Internal app (`apps/internal`) — `admin.amazflow.com` | Merge to `main` → Amplify Hosting builds from GitHub | No |
| Control plane Lambda + API routes (`infrastructure/aws-cdk/amazflow-dev.yaml`) | CloudFormation deploy | **Yes** |
| Chrome extension (`apps/browser-agent`) | Rebuild the zip, commit it, merge → Amplify serves it from `/downloads` | No |
| Desktop Agent (`apps/desktop-agent`) | Signed macOS build attached to a GitHub release | No (needs Apple signing) |

Nothing here deploys `services/control-plane/src/handler.ts` or `infrastructure/aws-cdk/src/app.ts`.
Those are the target architecture and are not built or deployed anywhere — see README.

---

## Before any deploy

```bash
pnpm install
pnpm -r test        # ~1,000 checks, no AWS credentials needed
```

`pnpm --filter @amazflow/aws-cdk test` is the one that matters most before touching the control
plane: `critical-path` runs the template's **own inline Lambda source** against an in-memory
DynamoDB, and `source-parity` plus `provider-parity` assert the deployed template and the
canonical source still agree on every security invariant and on the provider allowlist.

---

## 1. Web app — automatic

Amplify Hosting is connected to this repository and builds the three static Next applications
(`apps/web`, `apps/customer`, and `apps/internal`) per `amplify.yml` on every push to the tracked
branch. Merging is the deploy. There is nothing to run. The build commands invoke each app's
package script rather than calling Next directly, so app-specific checks (including the customer
bundle leak check) cannot be skipped by hosting.

Three Amplify applications serve the three surfaces, all tracking `main`:

| App | App ID | Root | Domain |
|---|---|---|---|
| `AmazFlow` | -- | `apps/web` | amazflow.com, www |
| `AmazFlow-CX` | `d1dm0vemqmi57e` | `apps/customer` | app.amazflow.com |
| `AmazFlow-Internal` | `dryx6sb8fynwu` | `apps/internal` | admin.amazflow.com |

For separate Amplify applications backed by this monorepo, configure each app's
`AMPLIFY_MONOREPO_APP_ROOT` environment variable to match its `appRoot`: `apps/web`,
`apps/customer`, or `apps/internal`.

Two things about creating one of these apps are not obvious:

* **Leave "My app is a monorepo" unchecked.** Ticking it makes the console validate the root
  directory through the GitHub contents API, which the current OAuth grant cannot read -- it
  fails with "Root directory cannot be found". Setting `AMPLIFY_MONOREPO_APP_ROOT` by hand has
  the same effect without needing a new GitHub permission grant. The wizard's auto-detected
  build command always previews the **first** `applications:` entry (`apps/web`) regardless of
  the app root, which is misleading but harmless.
* **DNS for amazflow.com is at Namecheap, not Route 53.** In the add-domain flow this means
  choosing **Manual configuration**. The default "Create hosted zone on Route 53" would build a
  competing zone and require a nameserver cutover, taking the live marketing site down. Keep each app on static hosting with the artifact directory
declared in `amplify.yml`; these applications use Next static export and do not produce
`required-server-files.json`.

Verify a deploy landed:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://amazflow.com/
```

The control plane must allow browser requests from `https://amazflow.com`,
`https://www.amazflow.com`, `https://app.amazflow.com`, and `https://admin.amazflow.com`.
Its CORS preflight must allow `authorization`, `content-type`, and `x-correlation-id`, and expose
`x-correlation-id` so support references can be read by the browser. The canonical CDK source and
the deployed template keep these values in parity; changing the live API requires deploying the
reviewed control-plane template.

---

## 2. Control plane — the one manual step

The live control plane is a single hand-maintained CloudFormation template,
`infrastructure/aws-cdk/amazflow-dev.yaml`, deployed to stack **`amazflow-dev-control-plane`**
in **us-east-1**.

The stack name does **not** match the template filename. Passing `--stack-name amazflow-dev`
creates a second, empty stack rather than updating the live one.

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

Checking the three conditions in step 2, read-only, against the live table:

```bash
REGION=us-east-1
TABLE=$(aws cloudformation describe-stack-resource \
  --stack-name amazflow-dev-control-plane --logical-resource-id ControlPlaneTable \
  --region $REGION --query StackResourceDetail.PhysicalResourceId --output text)
aws dynamodb scan --table-name "$TABLE" --region $REGION --output json > /tmp/s.json
N=$(( $(date +%s) * 1000 )); I=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "waiting: $(jq '[.Items[]|select(.document.S!=null)|.document.S|fromjson?|select(.status=="WAITING_AGENT")]|length' /tmp/s.json)"
echo "leases:  $(jq --argjson n $N '[.Items[]|select(.pk.S=="TASKCLAIM")|select((.leaseExpiresAtMs.N//"0"|tonumber)>$n)]|length' /tmp/s.json)"
echo "grants:  $(jq --arg n "$I" '[.Items[]|select(.document.S!=null)|.document.S|fromjson?|select(.claimExpiresAt!=null and .claimExpiresAt>$n)]|length' /tmp/s.json)"
```

All three must be `0`. The result is a point-in-time snapshot -- re-run it immediately before
deploying, not once at the start of the window.

**Step 4 needs a real agent, and nothing else substitutes for it.** `GET /health`, a CORS
preflight, and a 401 from a protected route all pass whether or not grant signing works, because
none of them mint or verify a grant. Confirming the migration means connecting the Chrome
extension or desktop agent, claiming one task, and watching it poll or report progress. Until
that has happened, the migration is deployed but unverified.

### Option B — raw AWS CLI

```bash
cd infrastructure/aws-cdk
aws cloudformation deploy \
  --template-file amazflow-dev.yaml \
  --stack-name amazflow-dev-control-plane \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1
```

### Option C — the console

Upload `amazflow-dev.yaml` to the `amazflow-dev-control-plane` stack and update. Works, but you
lose the test gate and the changeset preview, so prefer A.

**If you upload the template to CloudShell, verify the checksum before deploying.** CloudShell
keeps its home directory between sessions and refuses to overwrite an existing file, so an
`Upload file` that appears to succeed can leave a months-old template in place. This has already
happened once: the stale copy was 144 KB against the real template's 333 KB, and deploying it
would have **deleted** every resource added since, because CloudFormation removes whatever a
template no longer declares.

```bash
shasum -a 256 infrastructure/aws-cdk/amazflow-dev.yaml   # locally
sha256sum ~/amazflow-dev.yaml                            # in CloudShell -- must match
```

Always build the changeset with `--no-execute-changeset` first and read it. A deploy that only
adds routes shows additions and in-place updates; any `"Replace": "True"`, or any appearance of
`ControlPlaneTable`, means stop.

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
   Gateway, DynamoDB, IAM, Cognito, SES, EventBridge, Logs). Scope it to the
   `amazflow-dev-control-plane` stack rather than granting `*`.
5. In GitHub → Settings → Secrets and variables → Actions, add
   `AWS_DEPLOY_ROLE_ARN` with the role ARN.
6. In GitHub → Settings → Environments, create an environment named `production` and add
   yourself as a required reviewer.

Step 6 is what keeps this safe: the workflow runs the full test suite and creates the changeset
automatically, then **waits for your approval** before applying it. You still decide every
production change; you just stop hand-carrying files into a console to make it happen.

Until the role exists the workflow skips cleanly, and Option A above remains the path.
