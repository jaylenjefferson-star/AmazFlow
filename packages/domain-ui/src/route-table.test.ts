// Tests for the shared route table and permission-filtered navigation (task 9.5).
//
// Two things are asserted that the five-parallel-records arrangement could not express: that a route
// the principal cannot use is ABSENT from navigation rather than present-and-broken, and that a deep
// link resolves to the same route after a hard reload as the one that produced it. The second is the
// property the committed rewrite rules (task 9.9) exist to make true in production.
import test from "node:test";
import assert from "node:assert/strict";
import type { Principal } from "@amazflow/permissions";
import {
  gotoKeys,
  navigation,
  pathToView,
  reachableRoutes,
  routeAllowed,
  sameView,
  viewToPath,
  type RouteTable,
} from "./route-table.ts";

const table: RouteTable = {
  root: "/",
  routes: [
    { id: "home", path: "/", label: "Home", permission: null, group: "Work", key: "h" },
    { id: "runs", path: "/runs/", label: "Runs", permission: "run:read", entity: "run", group: "Work", key: "r" },
    { id: "workflows", path: "/workflows/", label: "Workflows", permission: "workflow:read", entity: "workflow", group: "Work" },
    { id: "users", path: "/admin/users/", label: "Users", permission: "user:read", group: "Admin" },
    { id: "settings", path: "/admin/organization/", label: "Organization", permission: "org:settings", group: "Admin" },
    {
      id: "audit",
      path: "/admin/audit/",
      label: "Audit",
      permission: "audit:read",
      group: "Admin",
      shownWhenDeniedBecause: "Your role cannot read the audit trail. An administrator can.",
    },
    { id: "accept", path: "/accept-invitation/", label: "Accept invitation", permission: null },
  ],
  aliases: { "/console/": "home", "/console/runs/": "runs" },
};

const principal = (over: Partial<Principal> = {}): Principal => ({
  kind: "user",
  userId: "u1",
  orgId: "acme",
  group: "CLIENT_ADMIN",
  role: "ORG_ADMIN",
  teamIds: [],
  isStaff: false,
  ...over,
});

test("a path round-trips through the table", () => {
  const view = { routeId: "runs", entityId: "run-7" };
  const path = viewToPath(table, view);
  assert.equal(path, "/runs/run-7/");
  assert.deepEqual(pathToView(table, path), view);
});

test("the surface root does not swallow a deeper route", () => {
  assert.equal(pathToView(table, "/admin/users/").routeId, "users");
  assert.equal(pathToView(table, "/runs/").routeId, "runs");
  assert.equal(pathToView(table, "/").routeId, "home");
});

test("a deep link resolves the same after a hard reload, entity id and tab included", () => {
  const view = { routeId: "runs", entityId: "run-42", tab: "evidence" };
  const path = viewToPath(table, view);
  // What the browser would hand back on a cold load of that URL.
  const [pathname, search] = path.split("?");
  assert.ok(sameView(pathToView(table, pathname, search), view));
});

test("an unknown path falls back to the first route rather than throwing", () => {
  assert.equal(pathToView(table, "/nothing/here/").routeId, "home");
});

test("legacy paths still resolve, so existing bookmarks are not broken", () => {
  assert.equal(pathToView(table, "/console/").routeId, "home");
  assert.deepEqual(pathToView(table, "/console/runs/run-3/"), { routeId: "runs", entityId: "run-3" });
});

test("an id with a slash or a space survives the round trip", () => {
  const view = { routeId: "workflows", entityId: "wf a/b" };
  assert.deepEqual(pathToView(table, viewToPath(table, view)), view);
});

test("navigation omits a section the role cannot use", () => {
  const operator = principal({ group: "FRONTLINE", role: "OPERATOR" });
  const groups = navigation(table, operator);
  const ids = groups.flatMap((group) => group.items.map((item) => item.route.id));
  assert.ok(ids.includes("runs"), "an operator reads runs");
  assert.ok(!ids.includes("users"), "an operator holds no user:read, so Users is absent entirely");
  assert.ok(!ids.includes("settings"), "and no org:settings");
});

test("an administrator sees the admin group", () => {
  const ids = navigation(table, principal()).flatMap((g) => g.items.map((i) => i.route.id));
  assert.ok(ids.includes("users") && ids.includes("settings") && ids.includes("audit"));
});

test("a route with a stated reason is shown disabled rather than omitted", () => {
  const operator = principal({ group: "FRONTLINE", role: "OPERATOR" });
  const audit = navigation(table, operator)
    .flatMap((group) => group.items)
    .find((item) => item.route.id === "audit");
  assert.ok(audit, "requirement 3.8: omission here would read as a missing feature");
  assert.equal(audit?.enabled, false);
  assert.match(String(audit?.disabledReason), /audit trail/);
});

test("a route outside every group is reachable but not in navigation", () => {
  const ids = navigation(table, principal()).flatMap((g) => g.items.map((i) => i.route.id));
  assert.ok(!ids.includes("accept"));
  assert.ok(reachableRoutes(table, principal()).some((route) => route.id === "accept"));
});

test("navigation and enforcement cannot disagree, because one call decides both", () => {
  for (const role of ["ORG_OWNER", "ORG_ADMIN", "WORKFLOW_BUILDER", "OPERATOR", "APPROVER", "VIEWER"] as const) {
    const p = principal({ role, group: role === "OPERATOR" || role === "VIEWER" ? "FRONTLINE" : "CLIENT_ADMIN" });
    for (const entry of navigation(table, p).flatMap((g) => g.items))
      assert.equal(
        entry.enabled,
        routeAllowed(p, entry.route),
        `${role} saw ${entry.route.id} enabled=${entry.enabled} but the policy says ${routeAllowed(p, entry.route)}`,
      );
  }
});

test("staff hold every route on this table", () => {
  const staff = principal({ group: "SUPER_ADMIN", role: "STAFF_ADMIN", isStaff: true });
  assert.equal(reachableRoutes(table, staff).length, table.routes.length);
});

test("shortcut keys are derived from the table, so no key can point at a missing route", () => {
  const keys = gotoKeys(table);
  assert.deepEqual(keys, { h: "home", r: "runs" });
  for (const routeId of Object.values(keys))
    assert.ok(table.routes.some((route) => route.id === routeId));
});
