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

// Tasks 20.2/20.3 -- customer-managed secrets (requirements 20.7-20.10): the plaintext value is
// never persisted, never returned, and never logged, in either copy.
assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\([^\n]*valid\.value/);
assert.doesNotMatch(canonical, /console\.(?:log|info|warn|error)\([^\n]*valid\.value/);
assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\([^\n]*body\?\.value/);
assert.doesNotMatch(canonical, /console\.(?:log|info|warn|error)\([^\n]*body\?\.value/);
// `ref` (the Secrets Manager pointer) is stripped from every response in both copies -- the same
// discipline `managedProfileId` gets for browser connections.
assert.match(source, /const publicSecret=\(secret\)=>\{\s*const \{ref,\.\.\.safe\}=secret;\s*return safe;\s*\};/);
assert.match(canonical, /const publicSecret = \(secret\) => \{\s*const \{ ref, \.\.\.safe \} = secret;\s*return safe;\s*\};/);
// A secret's value is accepted once and passed straight to Secrets Manager -- it is never written
// into the DynamoDB record itself (only `ref`, the pointer, is).
assert.doesNotMatch(source, /record=\{[^}]*value:valid\.value/);
assert.doesNotMatch(canonical, /record = \{[^}]*value: valid\.value/);
// Every create/rotate/delete audit event carries the identifier and name only (requirement 20.12).
for (const action of ["SECRET_CREATED", "SECRET_ROTATED", "SECRET_DELETED"]) {
  const detailsPattern = new RegExp(`action:'${action}'[\\s\\S]{0,120}details:\\{secretId:[a-zA-Z.]+\\.id,name:[a-zA-Z.]+\\.name\\}`);
  assert.match(source, detailsPattern, `${action} audit details must carry only secretId and name (deployed)`);
  const canonicalPattern = new RegExp(`action: "${action}"[\\s\\S]{0,160}details: \\{ secretId: [a-zA-Z.]+\\.id, name: [a-zA-Z.]+\\.name \\}`);
  assert.match(canonical, canonicalPattern, `${action} audit details must carry only secretId and name (canonical)`);
}
// The Lambda role can create, rotate and delete a customer secret, but was deliberately never
// granted GetSecretValue over that namespace -- no route ever reads a value back (requirement 20.8),
// so the permission that would let one is simply absent rather than merely unused.
const customerSecretIamBlock = template.match(/Action: \[secretsmanager:CreateSecret[^\]]*\]\s*\n\s*Resource:[^\n]*customer-secret/);
assert.ok(customerSecretIamBlock, "expected a scoped IAM statement for customer-managed secrets");
assert.doesNotMatch(customerSecretIamBlock[0], /GetSecretValue/);
const customerSecretCdkBlock = cdkApp.match(/actions: \["secretsmanager:CreateSecret"[^\]]*\][^)]*customer-secret/);
assert.ok(customerSecretCdkBlock, "expected the CDK stack to grant the same scoped customer-secret actions");
assert.doesNotMatch(customerSecretCdkBlock[0], /GetSecretValue/);

console.log("SECRET NON-LEAKAGE: runtime retrieval, no template value, and no secret logging verified");
