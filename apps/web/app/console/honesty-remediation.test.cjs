const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const home = read("console", "home.tsx");
const copy = read("console", "copy.ts");
const operations = read("app", "ops", "views", "customers.tsx");
const runDetail = read("app", "ops", "views", "run-detail.tsx");
const workflows = read("app", "ops", "views", "workflows.tsx");

for (const source of [home, copy, operations]) {
  assert.doesNotMatch(source, /Value saved|Estimated value|dollarEstimate|BLENDED_HOURLY_RATE|\$35\/hr/);
}
assert.doesNotMatch(runDetail, /max \$\{entry\.maxAttempts\} attempts configured/);
assert.doesNotMatch(workflows, /max \{step\.retry\.maxAttempts\} attempts/);
assert.match(runDetail, /per-attempt retry counters, browser session recordings/);

console.log("HONESTY REMEDIATION: no fabricated money or unrecorded retry counts are rendered");
