// Gates the build on the committed route inventory (tasks 1.1 and 1.2).
//
// Task 1.1 -- the inventory is the ONLY written-down answer to "what routes does the control plane
// serve". Adding a route to either copy without adding it here fails the build, which is what makes
// every later isolation, authorization and parity task enumerable rather than best-effort. It also
// makes the drift between the two copies a fact in a file instead of folklore: `copies` records
// which copy serves each route, so Phase 0b's convergence work has a target it can be measured
// against, and the day convergence lands every entry reads ["deployed","canonical"].
//
// Task 1.2 -- each entry carries how the caller is authenticated and how the organization is
// decided. Those two answers are what the isolation suite needs in order to probe a route
// correctly: a parameter-scoped route is attacked by naming the other organization in the path, an
// entity-identifier-scoped route by naming the other organization's record id, and a session-scoped
// route by checking the whole returned set. Without the classification the probes are guesses.
//
// This test asserts nothing about whether the routes BEHAVE correctly. It only asserts the
// inventory is complete, accurate about which copy serves what, and fully classified.
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { deployedRoutes, canonicalRoutes } = require("./extract-routes.cjs");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "route-inventory.json"), "utf8"));

const AUTH_MODES = ["unauthenticated", "one-time-code", "cognito-session", "agent-token", "execution-grant"];
// The five organization-scoping modes task 1.2 enumerates.
const ORG_SCOPES = [
  "session-scoped",
  "parameter-scoped",
  "entity-identifier-scoped",
  "unauthenticated",
  "agent-token-authenticated",
];

const deployed = new Set(deployedRoutes());
const canonical = new Set(canonicalRoutes());
const byRoute = new Map(fixture.routes.map((entry) => [entry.route, entry]));

let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log("  PASS  " + name);
  } catch (err) {
    fail++;
    console.log("  FAIL  " + name + "\n        " + (err && err.message));
  }
};

console.log("\nROUTE INVENTORY\n");

check("every route served by the deployed template is in the inventory", () => {
  const absent = [...deployed].filter((route) => !byRoute.has(route));
  assert.deepEqual(absent, [], `add these to route-inventory.json: ${absent.join(", ")}`);
});

check("every route served by the canonical source is in the inventory", () => {
  const absent = [...canonical].filter((route) => !byRoute.has(route));
  assert.deepEqual(absent, [], `add these to route-inventory.json: ${absent.join(", ")}`);
});

check("the inventory names no route that neither copy serves", () => {
  const phantom = fixture.routes
    .map((entry) => entry.route)
    .filter((route) => !deployed.has(route) && !canonical.has(route));
  assert.deepEqual(phantom, [], `remove these from route-inventory.json: ${phantom.join(", ")}`);
});

check("each entry records accurately which copies serve it", () => {
  const wrong = [];
  for (const entry of fixture.routes) {
    const actual = [deployed.has(entry.route) && "deployed", canonical.has(entry.route) && "canonical"]
      .filter(Boolean)
      .sort();
    if (JSON.stringify([...entry.copies].sort()) !== JSON.stringify(actual))
      wrong.push(`${entry.route}: recorded ${entry.copies.join("+") || "(none)"}, actually ${actual.join("+") || "(none)"}`);
  }
  assert.deepEqual(wrong, [], wrong.join("; "));
});

check("every entry is classified by authentication mode", () => {
  const bad = fixture.routes.filter((entry) => !AUTH_MODES.includes(entry.authMode));
  assert.deepEqual(bad.map((e) => `${e.route}: ${e.authMode}`), []);
});

check("every entry is classified by organization-scoping mode", () => {
  const bad = fixture.routes.filter((entry) => !ORG_SCOPES.includes(entry.orgScope));
  assert.deepEqual(bad.map((e) => `${e.route}: ${e.orgScope}`), []);
});

check("an unauthenticated route is not claimed to be session-scoped", () => {
  const contradictory = fixture.routes.filter(
    (entry) => entry.authMode === "unauthenticated" && entry.orgScope === "session-scoped",
  );
  assert.deepEqual(contradictory.map((e) => e.route), []);
});

check("an agent-authenticated route is scoped by its own credential", () => {
  const contradictory = fixture.routes.filter(
    (entry) =>
      (entry.authMode === "agent-token" || entry.authMode === "execution-grant") &&
      entry.orgScope !== "agent-token-authenticated",
  );
  assert.deepEqual(contradictory.map((e) => e.route), []);
});

// The divergence itself, recorded as a number so Phase 0b has something to drive to zero. This is
// deliberately NOT an equality assertion yet: converging the copies is task group 3, and the
// parity test is what will fail on asymmetry once it does (task 3.5). Failing here now would only
// mean the build is red for the whole of Phase 0.
const deployedOnly = [...deployed].filter((route) => !canonical.has(route)).sort();
const canonicalOnly = [...canonical].filter((route) => !deployed.has(route)).sort();
console.log(`\n  ${fixture.routes.length} routes inventoried (${deployed.size} deployed, ${canonical.size} canonical)`);
console.log(`  deployed only  (${deployedOnly.length}): ${deployedOnly.join(", ") || "-"}`);
console.log(`  canonical only (${canonicalOnly.length}): ${canonicalOnly.join(", ") || "-"}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
