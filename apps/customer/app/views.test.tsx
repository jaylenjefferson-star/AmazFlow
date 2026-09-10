// Task 9.13 — route-level rendering tests for the customer application shell.
//
// _Requirements: 34.16, 3.7_
//
// Two things are asserted, and they are different in kind.
//
// The first is that every route module renders all three states. This is a completeness check driven
// by the module list, not a per-view test: a new view added without an error branch has to fail here
// rather than being noticed in production when a read starts failing. The previous customer console is
// exactly the argument for it — it had a loading state on one screen and not the next, so a slow read
// on `/console/team` looked like an organization with no people in it.
//
// The second is that navigation and enforcement cannot disagree. Navigation is a filter of the route
// table through the same `can()` the control plane calls, so a section offered to a role the API will
// refuse is a contradiction rather than a mismatch — and the test says so in those terms.

import "./jsx-global";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CUSTOMER_ROUTES,
  CUSTOMER_ROUTE_TABLE,
  CUSTOMER_ALIASES,
} from "./routes";
import {
  CUSTOMER_ROLES,
  can,
  type PlatformRole,
  type Principal,
} from "@amazflow/permissions";
import { navigation, pathToView, routeAllowed, type ResourceSlot } from "@amazflow/domain-ui";
import * as views from "./views";
import type { ViewProps } from "./views";

const principal = (role: PlatformRole, orgId = "acme"): Principal => ({
  kind: "user",
  userId: `user_${role}`,
  orgId,
  group: role === "ORG_OWNER" || role === "ORG_ADMIN" ? "CLIENT_ADMIN" : "FRONTLINE",
  role,
  teamIds: [],
  isStaff: false,
});

const slot = <T,>(state: ResourceSlot<T>["state"], value: T, error: string | null = null): ResourceSlot<T> => ({
  value,
  state,
  error,
  loadedAt: state === "ready" ? new Date().toISOString() : null,
});

/** Every slot key the views read, in one state, so a view cannot fail on a missing key. */
const slotsIn = (state: ResourceSlot<unknown>["state"], error: string | null = null) => {
  const keys = [
    "me",
    "workflows",
    "runs",
    "agentTasks",
    "agents",
    "connections",
    "notifications",
    "permissionMatrix",
  ];
  const out: Record<string, ResourceSlot<unknown>> = {};
  for (const key of keys) out[key] = slot(state, [], error);
  return out;
};

/**
 * The route modules, keyed by the route table identifier each one serves.
 *
 * Kept as a map rather than a list so the completeness assertion below can name which route has no
 * module — "some view is missing a state" is not an actionable failure.
 */
const MODULES: Record<string, (props: ViewProps) => unknown> = {
  home: views.HomeView,
  workflows: views.WorkflowsView,
  runs: views.RunsView,
  tasks: views.TasksView,
  approvals: views.ApprovalsView,
  exceptions: views.ExceptionsView,
  agents: views.AgentsView,
  connections: views.ConnectionsView,
  analytics: views.AnalyticsView,
  "admin-roles": views.RolesView,
};

const render = (routeId: string, state: ResourceSlot<unknown>["state"], error: string | null = null) => {
  const Module = MODULES[routeId];
  return renderToStaticMarkup(
    Module({
      principal: principal("ORG_OWNER"),
      slots: slotsIn(state, error),
      navigate: () => {},
    }) as never,
  );
};

test("every route module renders a loading state rather than an empty page", () => {
  for (const routeId of Object.keys(MODULES)) {
    const html = render(routeId, "loading");
    assert.match(
      html,
      /aria-busy="true"|ops-skeleton/,
      `${routeId} renders nothing recognisable while loading; a slow read must look like a slow read, ` +
        `not like an organization with no data`,
    );
  }
});

test("every route module renders an honest empty state, not a blank panel", () => {
  for (const routeId of Object.keys(MODULES)) {
    const html = render(routeId, "ready");
    assert.ok(
      html.trim().length > 0,
      `${routeId} rendered nothing at all when its read returned an empty list`,
    );
    // The empty state has to say something. A panel with only a heading is the failure this catches.
    assert.ok(
      /ops-empty|Nothing|nothing|not available|No /.test(html),
      `${routeId} renders an empty read with no explanation of why it is empty`,
    );
  }
});

test("every route module surfaces the control plane's error rather than blanking", () => {
  for (const routeId of Object.keys(MODULES)) {
    const html = render(routeId, "error", "The control plane could not be reached");
    assert.match(
      html,
      /This did not load|could not be reached/,
      `${routeId} swallows a failed read; a person seeing an empty screen concludes there is no work`,
    );
  }
});

test("a resource the role cannot read says so instead of showing an error", () => {
  // "unavailable" is not an error: the read was never made, because the person's role does not include
  // it. Rendering it as a failure would tell somebody to contact support about a working system.
  for (const routeId of Object.keys(MODULES)) {
    const html = render(routeId, "unavailable");
    assert.ok(
      !/This did not load/.test(html),
      `${routeId} renders a role restriction as a system error`,
    );
  }
});

test("every navigable route in the table has a module or an honest disabled reason", () => {
  for (const route of CUSTOMER_ROUTES) {
    if (MODULES[route.id]) continue;
    if ((route as { disabledReason?: string }).disabledReason) continue;
    // The remaining rows are Phase 4+ surfaces. They must be declared in the table (so navigation is
    // complete and deep links resolve) and are wired to their views as those phases land. This
    // assertion exists to make that list VISIBLE rather than to pass silently.
    assert.ok(
      [
        "admin-organization",
        "admin-users",
        "admin-teams",
        "admin-security",
        "admin-audit",
        "admin-billing",
        "settings-profile",
        "settings-security",
        "settings-notifications",
        "support",
        "accept-invitation",
        "notifications",
      ].includes(route.id),
      `route "${route.id}" has no view module, no disabled reason, and is not a known later-phase ` +
        `section — it would render as Not found`,
    );
  }
});

test("navigation offers no section the API would refuse, for any of the six customer roles", () => {
  for (const role of CUSTOMER_ROLES) {
    const p = principal(role);
    for (const group of navigation(CUSTOMER_ROUTE_TABLE, p)) {
      for (const entry of group.items) {
        if (!entry.enabled) {
          assert.ok(
            entry.disabledReason,
            `${role} sees "${entry.route.label}" disabled with no reason given`,
          );
          continue;
        }
        assert.ok(
          entry.route.permission === null ||
            can(p, entry.route.permission, { orgId: p.orgId }).allow,
          `navigation offers "${entry.route.label}" to ${role} but the policy refuses it`,
        );
      }
    }
  }
});

test("a section the principal cannot use is absent from navigation unless it states a reason", () => {
  const viewer = principal("VIEWER");
  const labels = navigation(CUSTOMER_ROUTE_TABLE, viewer).flatMap((g) =>
    g.items.filter((i) => i.enabled).map((i) => i.route.id),
  );
  for (const route of CUSTOMER_ROUTES) {
    if (!route.group) continue;
    if (routeAllowed(viewer, route)) continue;
    assert.ok(
      !labels.includes(route.id),
      `"${route.label}" is offered to a VIEWER as usable although the policy refuses it`,
    );
  }
  // And the converse, so the assertion above cannot pass by navigation being empty.
  assert.ok(labels.includes("runs"), "a VIEWER should still be offered Runs");
});

test("every legacy /console path resolves to a route that exists", () => {
  for (const [legacy, routeId] of Object.entries(CUSTOMER_ALIASES)) {
    assert.ok(
      CUSTOMER_ROUTES.some((r) => r.id === routeId),
      `alias ${legacy} points at "${routeId}", which is not in the route table`,
    );
    assert.equal(pathToView(CUSTOMER_ROUTE_TABLE, legacy).routeId, routeId);
  }
});

test("a deep link with an entity identifier survives a hard reload", () => {
  // The static export serves the shell for any path (task 9.9), so resolution happens here. If this
  // ever regresses, every shared run link lands on Home with the run id mistaken for something else.
  const resolved = pathToView(CUSTOMER_ROUTE_TABLE, "/runs/run_abc123/");
  assert.equal(resolved.routeId, "runs");
  assert.equal(resolved.entityId, "run_abc123");
  assert.equal(pathToView(CUSTOMER_ROUTE_TABLE, "/console/runs/run_abc123/").routeId, "runs");
  assert.equal(pathToView(CUSTOMER_ROUTE_TABLE, "/console/runs/run_abc123/").entityId, "run_abc123");
});
