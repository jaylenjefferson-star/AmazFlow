// Mechanical route extraction from BOTH control-plane copies.
//
// Two implementations exist and only one is deployed: the inline Lambda source in
// amazflow-dev.yaml (production today) and services/control-plane/src/handler.ts (canonical,
// undeployed). They have drifted before. Nothing in the build noticed, because "which routes
// exist" was never written down anywhere a test could read.
//
// Both copies dispatch identically -- one long chain of `route === '<METHOD> /<path>'` against
// e.routeKey -- so the route set is mechanically recoverable from the source text. This module
// does exactly that and nothing else: it does not classify, judge, or compare. route-inventory
// fixture + test do that on top.
const fs = require("fs");
const path = require("path");
const { extract } = require("./extract-inline-handler.cjs");

const root = path.join(__dirname, "..", "..", "..");

// Anchored on the comparison itself rather than on "any string that looks like a route", so a
// route name mentioned in a comment, an error message, or a client-side list is not mistaken for
// a route the handler actually serves.
const ROUTE_COMPARISON =
  /route\s*===\s*(['"`])((?:GET|POST|PUT|PATCH|DELETE|OPTIONS|ANY) \/[^'"`]*)\1/g;

const routesIn = (source) => {
  const found = new Set();
  let match;
  ROUTE_COMPARISON.lastIndex = 0;
  while ((match = ROUTE_COMPARISON.exec(source))) found.add(match[2]);
  return [...found].sort();
};

/** The deployed copy: the inline ZipFile handler lifted verbatim out of the CloudFormation template. */
const deployedRoutes = () => routesIn(extract());

/** The canonical copy: the TypeScript handler a future stack would deploy. */
const canonicalRoutes = () =>
  routesIn(fs.readFileSync(path.join(root, "services/control-plane/src/handler.ts"), "utf8"));

/** Every route either copy serves, with which copies serve it. */
const allRoutes = () => {
  const deployed = new Set(deployedRoutes());
  const canonical = new Set(canonicalRoutes());
  return [...new Set([...deployed, ...canonical])].sort().map((route) => ({
    route,
    copies: [deployed.has(route) && "deployed", canonical.has(route) && "canonical"].filter(Boolean),
  }));
};

module.exports = { deployedRoutes, canonicalRoutes, allRoutes, routesIn };

if (require.main === module) process.stdout.write(JSON.stringify(allRoutes(), null, 2) + "\n");
