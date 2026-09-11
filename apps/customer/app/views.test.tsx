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
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiClient } from "@amazflow/api-client";
import {
  CUSTOMER_ROUTES,
  CUSTOMER_ROUTE_TABLE,
  CUSTOMER_ALIASES,
  customerResourceSpecs,
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
import type { StoredSession } from "./session";

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
    "organization",
    "users",
    "teams",
    "securityFacts",
    "audit",
    "profile",
    "preferences",
    "supportTickets",
  ];
  const out: Record<string, ResourceSlot<unknown>> = {};
  for (const key of keys) out[key] = slot(state, [], error);
  return out;
};

const fakeClient: ApiClient = {
  request: async <T,>() => null as T,
  get: async <T,>() => null as T,
  post: async <T,>() => null as T,
  put: async <T,>() => null as T,
  del: async <T,>() => null as T,
  session: () => ({ idToken: "token", tenantId: "acme" }),
};

const storedSession: StoredSession = {
  idToken: "token",
  accessToken: "access",
  refreshToken: "refresh",
  tenantId: "acme",
  sub: "user_owner",
  email: "owner@acme.example",
  expiresAt: Date.now() + 60_000,
};

/**
 * The route modules, keyed by the route table identifier each one serves.
 *
 * Kept as a map rather than a list so the completeness assertion below can name which route has no
 * module — "some view is missing a state" is not an actionable failure.
 */
const MODULES: Record<string, ComponentType<ViewProps>> = {
  home: views.HomeView,
  workflows: views.WorkflowsView,
  runs: views.RunsView,
  tasks: views.TasksView,
  approvals: views.ApprovalsView,
  exceptions: views.ExceptionsView,
  agents: views.AgentsView,
  connections: views.ConnectionsView,
  analytics: views.AnalyticsView,
  "admin-organization": views.OrganizationView,
  "admin-users": views.UsersView,
  "admin-teams": views.TeamsView,
  "admin-roles": views.RolesView,
  "admin-security": views.SecurityView,
  "admin-audit": views.AuditView,
  "admin-billing": views.BillingView,
  "settings-profile": views.ProfileView,
  "settings-security": views.PersonalSecurityView,
  "settings-notifications": views.NotificationPreferencesView,
  notifications: views.NotificationsView,
  support: views.SupportView,
};

const render = (routeId: string, state: ResourceSlot<unknown>["state"], error: string | null = null) => {
  const Module = MODULES[routeId];
  return renderToStaticMarkup(
    createElement(Module, {
      principal: principal("ORG_OWNER"),
      slots: slotsIn(state, error),
      navigate: () => {},
      client: fakeClient,
      session: storedSession,
      refresh: async () => {},
    }),
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
    // Invitation inspection is rendered before the signed-in shell because the recipient may not
    // have an account session yet. It is still a real module; it simply is not dispatched here.
    assert.equal(
      route.id,
      "accept-invitation",
      `route "${route.id}" has no signed-in view module and no disabled reason`,
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



test("Phase 4 resources point at the real customer administration APIs", () => {
  const specs = customerResourceSpecs("north/wind");
  const paths = Object.fromEntries(specs.map((spec) => [spec.key, spec.path]));
  assert.equal(paths.organization, "/organizations/north%2Fwind");
  assert.equal(paths.users, "/tenants/north%2Fwind/users");
  assert.equal(paths.teams, "/teams");
  assert.equal(paths.securityFacts, "/security/facts");
  assert.equal(paths.audit, "/audit");
  assert.equal(paths.profile, "/me/profile");
  assert.equal(paths.preferences, "/me/preferences");
  assert.equal(paths.notifications, "/notifications");
  assert.equal(paths.supportTickets, "/support/tickets");
});

test("user state is derived from Cognito and membership facts", () => {
  const base = { username: "person", email: "person@example.com" };
  assert.equal(views.deriveUserState({ ...base, enabled: true, userStatus: "FORCE_CHANGE_PASSWORD", membershipStatus: "invited" }), "invited");
  assert.equal(views.deriveUserState({ ...base, enabled: true, userStatus: "CONFIRMED", membershipStatus: "active" }), "active");
  assert.equal(views.deriveUserState({ ...base, enabled: false, userStatus: "CONFIRMED", membershipStatus: "active" }), "deactivated");
  assert.equal(views.deriveUserState({ ...base, enabled: true, userStatus: "CONFIRMED", membershipStatus: "deactivated" }), "deactivated");
});

test("invitation HTTP states map to distinct expired, used, and error screens", () => {
  assert.equal(views.invitationFailureForStatus(410), "expired");
  assert.equal(views.invitationFailureForStatus(409), "used");
  assert.equal(views.invitationFailureForStatus(404), "error");
  assert.equal(views.invitationFailureForStatus(500), "error");
});

test("the organization view never renders internal commercial lifecycle data", () => {
  const slots = slotsIn("ready");
  slots.organization = slot("ready", {
    name: "Acme Logistics",
    slug: "acme",
    status: "active",
    plan: "pilot",
    lifecycleStatus: "trial",
    settings: { maxConcurrentRuns: 2, allowedEmailDomains: [], timezone: "UTC" },
    branding: {},
  });
  const html = renderToStaticMarkup(views.OrganizationView({
    principal: principal("ORG_OWNER"),
    slots,
    navigate: () => {},
    client: fakeClient,
    session: storedSession,
    refresh: async () => {},
  }) as never);
  assert.match(html, /Acme Logistics/);
  assert.doesNotMatch(html, /trial|lifecycle/i);
});

test("planned identity capabilities are explained without fake controls", () => {
  const slots = slotsIn("ready");
  slots.securityFacts = slot("ready", {
    accessTokenMinutes: 60,
    idTokenMinutes: 60,
    refreshTokenDays: 7,
    passwordPolicy: {
      minimumLength: 12,
      requireLowercase: true,
      requireUppercase: true,
      requireNumbers: true,
      requireSymbols: true,
    },
    mfaEnrollmentAvailable: false,
    singleSignOnAvailable: false,
    directoryProvisioningAvailable: false,
  });
  slots.agents = slot("ready", []);
  const html = renderToStaticMarkup(views.SecurityView({
    principal: principal("ORG_OWNER"),
    slots,
    navigate: () => {},
    client: fakeClient,
    session: storedSession,
    refresh: async () => {},
  }) as never);
  // The real session lifetime, rendered through the shared metric primitive: the value and its unit
  // are separate elements, so this asserts both rather than a string that only held while the panel
  // hand-rolled its own markup.
  assert.match(html, /Access token/);
  assert.match(html, />60<span class="ops-metric-unit">min<\/span>/);
  assert.match(html, /12 characters minimum/);
  assert.match(html, /Single sign-on/);
  assert.match(html, /Directory provisioning/);
  assert.match(html, /Not available in this release/);
  assert.doesNotMatch(html, /type="checkbox"/);
});

test("the MFA setup route is honestly disabled and accepts no input", () => {
  const html = renderToStaticMarkup(views.MfaSetupView() as never);
  assert.match(html, /not available in this release/i);
  assert.match(html, /enrolment and recovery flow/i);
  assert.doesNotMatch(html, /<(input|select|textarea)/);
});

test("legacy account settings now resolve to the live personal security route", () => {
  assert.equal(pathToView(CUSTOMER_ROUTE_TABLE, "/console/account/").routeId, "settings-security");
});


test("workflow statuses render through the shared label mapping, not as stored values", () => {
  // Task 14.1 / requirements 13.2 and 13.3. Two claims, and they fail differently.
  //
  // `active` shown as "active" is a surface speaking the database's language: the product calls that
  // state Published everywhere else, so the person reading the list has to learn a second vocabulary
  // for the same thing.
  //
  // `paused` is worse. It is a RETIRED value that nothing writes any more, so a workflow displaying
  // "Paused" invites somebody to look for the control that un-pauses it. There is none, and there never
  // will be. It has to read as Archived, which is a state they can understand and act on.
  const html = renderToStaticMarkup(
    views.WorkflowsView({
      principal: principal("ORG_ADMIN"),
      navigate: () => {},
      client: fakeClient,
      session: storedSession,
      refresh: async () => {},
      slots: {
        ...slotsIn("ready"),
        workflows: slot("ready", [
          { id: "wf_live", name: "Offboarding", status: "active" },
          { id: "wf_old", name: "Retired process", status: "paused" },
          { id: "wf_try", name: "Being tried out", status: "testing" },
        ]),
      },
    }) as never,
  );
  assert.match(html, /Published/);
  assert.match(html, /Testing/);
  assert.match(html, /Archived/);
  assert.doesNotMatch(html, />active</, "the stored value must not reach the screen");
  assert.doesNotMatch(html, /Paused/, "the retired value must not be presented as an actionable state");
  // And the label is not the whole answer: what the status means for whether work can start is stated
  // alongside it, so nobody has to infer that Draft is not runnable.
  assert.match(html, /It cannot run/);
});
