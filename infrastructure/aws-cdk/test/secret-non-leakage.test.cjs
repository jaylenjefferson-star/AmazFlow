// Tasks 20.4/20.5 -- keep the execution-grant signing material out of the deployment surface.
// This intentionally tests the shipped inline Lambda, not just the newer CDK stack.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { extract } = require("./extract-inline-handler.cjs");

const root = path.join(__dirname, "..");
const template = fs.readFileSync(path.join(root, "amazflow-dev.yaml"), "utf8");
const source = extract();
const canonical = fs.readFileSync(
  path.join(root, "..", "..", "services", "control-plane", "src", "handler.ts"),
  "utf8",
);
const cdkApp = fs.readFileSync(path.join(root, "src", "app.ts"), "utf8");

assert.doesNotMatch(template, /ExecutionGrantSecret:\n\s+Type: String\n\s+NoEcho:/);
assert.doesNotMatch(template, /EXECUTION_GRANT_SECRET:\s*!Ref/);
assert.match(template, /Type: AWS::SecretsManager::Secret/);
assert.match(template, /EXECUTION_GRANT_SECRET_ID:\s*!Ref ExecutionGrantSecret/);
assert.match(template, /Action: \[secretsmanager:GetSecretValue\]/);
assert.match(source, /new GetSecretValueCommand\(\{SecretId:process\.env\.EXECUTION_GRANT_SECRET_ID\}\)/);
assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\([^\n]*EXECUTION_GRANT_SECRET/);
assert.doesNotMatch(canonical, /console\.(?:log|info|warn|error)\([^\n]*EXECUTION_GRANT_SECRET/);
assert.doesNotMatch(cdkApp, /EXECUTION_GRANT_SECRET:\s*grantSecret\.secretValue/);
assert.match(cdkApp, /EXECUTION_GRANT_SECRET_ID:\s*grantSecret\.secretArn/);

console.log("SECRET NON-LEAKAGE: runtime retrieval, no template value, and no secret logging verified");
