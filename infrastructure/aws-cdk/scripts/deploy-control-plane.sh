#!/usr/bin/env bash
#
# Deploy the live AmazFlow control plane.
#
# Previews by default and changes nothing without --apply. The point of this script over a
# console upload is the two gates it puts in front of production: the template must validate and
# the full suite must pass, and you see the exact resource-level changeset before anything is
# applied. A template edit that intends to touch only the Lambda should not be quietly
# replacing the DynamoDB table.
#
#   ./deploy-control-plane.sh            # validate, test, show the changeset, stop
#   ./deploy-control-plane.sh --apply    # the same, then prompt and execute
#
set -euo pipefail

STACK_NAME="${STACK_NAME:-amazflow-dev}"
REGION="${AWS_REGION:-us-east-1}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$HERE/../amazflow-dev.yaml"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"

APPLY=false
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[[ -f "$TEMPLATE" ]] || fail "Template not found: $TEMPLATE"
command -v aws >/dev/null || fail "The AWS CLI is required. See docs/DEPLOYING.md."

say "Who am I deploying as?"
aws sts get-caller-identity --output table 2>/dev/null \
  || fail "No usable AWS credentials. Configure a profile, or use the GitHub Actions deploy."

# ── Gate 1: the template has to be structurally valid ──────────────────────────────────────
say "Validating the template"
aws cloudformation validate-template \
  --template-body "file://$TEMPLATE" \
  --region "$REGION" >/dev/null
echo "Template is valid."

# ── Gate 2: the tests that exercise this template's own inline Lambda source ───────────────
# critical-path extracts the inline handler from the template and runs it against an in-memory
# DynamoDB, so this is a real behavioural check on the artifact being deployed -- not a proxy.
say "Running the control-plane test suite"
if ! (cd "$REPO_ROOT" && pnpm --filter @amazflow/aws-cdk test); then
  fail "Tests failed. Not deploying."
fi

# ── Changeset preview ──────────────────────────────────────────────────────────────────────
# Deliberately no --parameter-overrides: existing parameter values are preserved. This matters
# most for ExecutionGrantSecret, because rotating it invalidates every execution grant in
# flight and strands any run currently waiting on an agent.
CHANGESET="deploy-$(date +%Y%m%d-%H%M%S)"
say "Creating changeset $CHANGESET"
set +e
aws cloudformation deploy \
  --template-file "$TEMPLATE" \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$REGION" \
  --no-execute-changeset \
  --change-set-name "$CHANGESET" >/dev/null 2>&1
CREATE_STATUS=$?
set -e

CS_ARN="$(aws cloudformation list-change-sets \
  --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Summaries[?ChangeSetName=='$CHANGESET'].ChangeSetId | [0]" \
  --output text 2>/dev/null || true)"

if [[ -z "$CS_ARN" || "$CS_ARN" == "None" ]]; then
  if [[ $CREATE_STATUS -eq 0 ]]; then
    say "No changes"
    echo "The deployed stack already matches this template. Nothing to do."
    exit 0
  fi
  fail "Could not create a changeset. Run with AWS_PAGER= and check CloudFormation events."
fi

REASON="$(aws cloudformation describe-change-set \
  --change-set-name "$CS_ARN" --region "$REGION" \
  --query 'StatusReason' --output text 2>/dev/null || true)"
if [[ "$REASON" == *"didn't contain changes"* || "$REASON" == *"No updates"* ]]; then
  say "No changes"
  echo "The deployed stack already matches this template. Nothing to do."
  aws cloudformation delete-change-set --change-set-name "$CS_ARN" --region "$REGION" >/dev/null 2>&1 || true
  exit 0
fi

say "This deploy would change:"
aws cloudformation describe-change-set \
  --change-set-name "$CS_ARN" --region "$REGION" \
  --query 'Changes[].ResourceChange.{Action:Action,Type:ResourceType,Resource:LogicalResourceId,Replace:Replacement}' \
  --output table

# Replacement of a stateful resource is almost never intended. Call it out loudly.
if aws cloudformation describe-change-set \
     --change-set-name "$CS_ARN" --region "$REGION" \
     --query 'Changes[?ResourceChange.Replacement==`True`]' --output text | grep -q .; then
  printf '\n\033[31m%s\033[0m\n' "WARNING: this changeset REPLACES at least one resource."
  echo "The DynamoDB table and Cognito pool are Retain-on-delete, but a replacement still"
  echo "swaps in a new empty resource. Confirm that is genuinely what you intend."
fi

if [[ "$APPLY" != true ]]; then
  say "Preview only — nothing was applied"
  echo "Re-run with --apply to deploy this changeset."
  echo "Discard it with:"
  echo "  aws cloudformation delete-change-set --change-set-name $CS_ARN --region $REGION"
  exit 0
fi

say "Apply this changeset to $STACK_NAME in $REGION?"
read -r -p "Type the stack name to confirm: " CONFIRM
[[ "$CONFIRM" == "$STACK_NAME" ]] || fail "Confirmation did not match. Nothing was applied."

say "Executing"
aws cloudformation execute-change-set --change-set-name "$CS_ARN" --region "$REGION"
aws cloudformation wait stack-update-complete --stack-name "$STACK_NAME" --region "$REGION" \
  || fail "Stack update did not complete. Check CloudFormation events for $STACK_NAME."

say "Deployed. Confirming what is actually live:"
API="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?contains(OutputKey,'Api')].OutputValue | [0]" --output text 2>/dev/null || true)"
[[ -n "$API" && "$API" != "None" ]] || API="https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com"
curl -fsS -m 20 "${API%/}/health" && echo
