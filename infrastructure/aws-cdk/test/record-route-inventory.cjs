// Regenerates route-inventory.json's `copies` field from the two control-plane copies, preserving
// the hand-written authMode/orgScope classifications.
//
// `copies` is a mechanical fact about the source, so it should never be hand-edited: run this. The
// classifications are a judgement about each route and are NOT derivable, so a route this script has
// never seen is reported rather than guessed at -- an unclassified entry would silently weaken the
// isolation suite, which reads orgScope to decide how to probe a route.
//
// Usage: node test/record-route-inventory.cjs
const fs = require("fs");
const path = require("path");
const { allRoutes } = require("./extract-routes.cjs");

const fixturePath = path.join(__dirname, "route-inventory.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const classified = new Map(fixture.routes.map((entry) => [entry.route, entry]));

const live = allRoutes();
const unclassified = live.filter((entry) => !classified.has(entry.route)).map((entry) => entry.route);
if (unclassified.length) {
  console.error(
    "These routes have no classification. Add an authMode and an orgScope for each by hand, then\n" +
      "re-run. Do not guess: the isolation suite reads orgScope to decide how to attack a route.\n\n" +
      unclassified.map((route) => "  " + route).join("\n"),
  );
  process.exit(1);
}

const removed = fixture.routes.filter((entry) => !live.some((r) => r.route === entry.route)).map((e) => e.route);

const next = {
  ...fixture,
  routes: live.map((entry) => ({
    route: entry.route,
    copies: entry.copies,
    authMode: classified.get(entry.route).authMode,
    orgScope: classified.get(entry.route).orgScope,
  })),
};
fs.writeFileSync(fixturePath, JSON.stringify(next, null, 2) + "\n");

const both = next.routes.filter((r) => r.copies.length === 2).length;
console.log(`route-inventory.json updated: ${next.routes.length} routes, ${both} served by both copies`);
if (removed.length) console.log("no longer served by either copy (removed): " + removed.join(", "));
