// The provider allowlist lives in three places that must agree: the shared zod schema (what the
// builder is written against), the canonical control-plane handler, and the deployed template's
// inline copy. They did NOT agree -- "desktop" was in the schema and the builder but missing from
// both handlers, so every workflow using the Desktop Agent was rejected at save time with a
// message blaming the provider. This test exists so that cannot recur silently.

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { extract } = require("./extract-inline-handler.cjs");

const repoRoot = join(__dirname, "..", "..", "..");
const read = (...parts) => readFileSync(join(repoRoot, ...parts), "utf8");

/** Every provider the shared schema accepts, in schema order. */
function schemaProviders() {
  const source = read("packages", "workflow-schema", "src", "index.ts");
  // `provider: z.enum([...])` on the action step.
  const match = /provider:\s*z\.enum\(\[([^\]]+)\]\)/.exec(source);
  assert.ok(match, "could not locate the action step's provider enum in workflow-schema");
  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function canonicalProviders() {
  const source = read("services", "control-plane", "src", "handler.ts");
  const match = /const VALID_PROVIDERS = \[([^\]]+)\]/.exec(source);
  assert.ok(match, "could not locate VALID_PROVIDERS in the canonical handler");
  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function deployedProviders() {
  const match = /VALID_PROVIDERS=\[([^\]]+)\]/.exec(extract());
  assert.ok(match, "could not locate VALID_PROVIDERS in the deployed template");
  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

test("the shared schema, the canonical handler, and the deployed template accept the same providers", () => {
  const schema = schemaProviders();
  const canonical = canonicalProviders();
  const deployed = deployedProviders();

  assert.deepEqual(
    [...canonical].sort(),
    [...schema].sort(),
    "canonical handler's VALID_PROVIDERS drifted from the shared schema",
  );
  assert.deepEqual(
    [...deployed].sort(),
    [...schema].sort(),
    "deployed template's VALID_PROVIDERS drifted from the shared schema",
  );
});

test("desktop is an accepted provider everywhere the Desktop Agent needs it", () => {
  // The builder offers it, the Desktop Agent executes it, and the schema types it. A handler that
  // rejects it makes the whole desktop execution surface unauthorable.
  assert.ok(schemaProviders().includes("desktop"), "schema must accept the desktop provider");
  assert.ok(canonicalProviders().includes("desktop"), "canonical handler must accept the desktop provider");
  assert.ok(deployedProviders().includes("desktop"), "deployed template must accept the desktop provider");

  const builder = read("apps", "web", "app", "app", "workflow-builder.tsx");
  assert.match(builder, /"desktop"/, "the builder should still offer the desktop provider");
});

test("paged reads drain every page in both handler copies", () => {
  // Discarding LastEvaluatedKey does not read less data, it reads the wrong data: by-id lookups
  // layered on a truncated scan 404 at random, and the expiry sweep stops seeing what it exists
  // to expire.
  const canonical = read("services", "control-plane", "src", "handler.ts");
  const deployed = extract();

  for (const [label, source] of [
    ["canonical handler", canonical],
    ["deployed template", deployed],
  ]) {
    assert.match(source, /ExclusiveStartKey/, `${label} must pass ExclusiveStartKey when paging`);
    assert.match(source, /LastEvaluatedKey/, `${label} must read LastEvaluatedKey to continue paging`);
  }
});

test("audit rows are chunked, never silently truncated", () => {
  // A TransactWriteItems call caps at 100 items. Truncating past that dropped evidence with no
  // error, leaving the queryable AUDIT# trail permanently inconsistent with the run document.
  const canonical = read("services", "control-plane", "src", "handler.ts");
  const deployed = extract();

  for (const [label, source] of [
    ["canonical handler", canonical],
    ["deployed template", deployed],
  ]) {
    // Strip comments so an explanatory mention of the old code doesn't count as the old code.
    const code = source.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(
      code,
      /newEntries\.slice\(0,\s*90\)/,
      `${label} still truncates audit rows at 90 instead of chunking`,
    );
    assert.match(code, /FIRST_BATCH/, `${label} should chunk audit writes`);
  }
});

test("the claim response carries the display contract both agents render", () => {
  // Without `display`, both agents fall back to "A workflow" / "Making a change", undoing the
  // decision to put the product in front of the mechanism.
  const canonical = read("services", "control-plane", "src", "handler.ts");
  const deployed = extract();

  assert.match(canonical, /display:\s*\{[\s\S]{0,200}?workflowName/, "canonical claim response must include display.workflowName");
  assert.match(deployed, /display:\{workflowName/, "deployed claim response must include display.workflowName");

  for (const agent of [
    ["apps", "desktop-agent", "src", "agent.ts"],
    ["apps", "browser-agent", "src", "service-worker.ts"],
  ]) {
    assert.match(read(...agent), /claim\.display\?\./, `${agent.join("/")} should read claim.display`);
  }
});

test("agents check whether the evidence write actually landed", () => {
  // The evidence record is what survives a failed result submission. Swallowing its failure with
  // .catch(() => undefined) and never reading res.ok removed the only signal that the step's
  // evidence was lost -- an expired or already-consumed grant looked exactly like success.
  for (const agent of [
    ["apps", "desktop-agent", "src", "agent.ts"],
    ["apps", "browser-agent", "src", "service-worker.ts"],
  ]) {
    const source = read(...agent);
    const recordCall = source.slice(source.indexOf("record-step-result"));
    const window = recordCall.slice(0, 1200);
    assert.doesNotMatch(
      window,
      /\}\)\s*\.catch\(\(\)\s*=>\s*undefined\)/,
      `${agent.join("/")} must not swallow the evidence write`,
    );
    assert.match(window, /evidenceRecorded/, `${agent.join("/")} must record whether the evidence write landed`);
  }
});
