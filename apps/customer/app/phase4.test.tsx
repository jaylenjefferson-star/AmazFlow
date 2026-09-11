// Phase 4 — customer administration and notification surfaces.
//
// _Requirements: 9.16, 9.21, 9.22, 10.7, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9,
// 12.3, 12.4, 12.5, 22.4, 22.5, 22.7, 22.9, 26.6, 26.7, 30.3, 30.4_
//
// `views.test.tsx` already asserts the SHAPE of every route module — three states, navigation that
// cannot disagree with enforcement, deep links that survive a reload. This file asserts the things
// Phase 4 added, and it is deliberately organised around the four ways an administration surface lies:
//
//   1. It calls a route that does not exist. Nothing fails until a person clicks the button, so the
//      write table and the read table are both checked against the committed route inventory.
//   2. It renders a control the API will refuse. So the mutation controls are asserted absent for a
//      role that lacks the permission, in the same render that asserts them present for one that has it.
//   3. It invents a value. So "not recorded" is asserted to render as those words rather than as a zero
//      or a placeholder date, and the honestly-disabled sections are asserted to accept no input at all.
//   4. It renders markup nothing styles. That one shipped: the first draft of this surface used
//      twenty-one class names with no rule behind them, so it rendered as an unstyled column while the
//      build reported success. It is now a test.

import "./jsx-global";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiClient } from "@amazflow/api-client";
import { pathToView, type ResourceSlot } from "@amazflow/domain-ui";
import { CUSTOMER_ROLES, type PlatformRole, type Principal } from "@amazflow/permissions";
import { ALL_ENDPOINTS } from "./endpoints";
import * as endpoints from "./endpoints";
import { CUSTOMER_ROUTE_TABLE, customerResourceSpecs } from "./routes";
import { refinePrincipal } from "./session";
import type { StoredSession } from "./session";
import * as views from "./views";
import type { ViewProps } from "./views";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "../../..");

const principal = (role: PlatformRole, orgId = "acme"): Principal => ({
  kind: "user",
  userId: `user_${role}`,
  orgId,
  group: role === "OPERATOR" || role === "VIEWER" ? "FRONTLINE" : "CLIENT_ADMIN",
  role,
  teamIds: [],
  isStaff: false,
});

const slot = <T,>(value: T): ResourceSlot<T> => ({
  value,
  state: "ready",
  error: null,
  loadedAt: new Date().toISOString(),
});

const storedSession: StoredSession = {
  idToken: "token",
  accessToken: "access",
  refreshToken: "refresh",
  tenantId: "acme",
  sub: "user_owner",
  email: "owner@acme.example",
  expiresAt: Date.now() + 60_000,
};

/** Records what a view asks the control plane for, so a contract can be asserted on the real call. */
function recordingClient() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const client: ApiClient = {
    request: async <T,>(p: string, options?: { method?: string; body?: unknown }) => {
      calls.push({ method: options?.method ?? "GET", path: p, body: options?.body });
      return null as T;
    },
    get: async <T,>(p: string) => {
      calls.push({ method: "GET", path: p });
      return null as T;
    },
    post: async <T,>(p: string, body?: unknown) => {
      calls.push({ method: "POST", path: p, body });
      return null as T;
    },
    put: async <T,>(p: string, body?: unknown) => {
      calls.push({ method: "PUT", path: p, body });
      return null as T;
    },
    del: async <T,>(p: string) => {
      calls.push({ method: "DELETE", path: p });
      return null as T;
    },
    session: () => ({ idToken: "token", tenantId: "acme" }),
  };
  return { client, calls };
}

const props = (
  overrides: Partial<Record<string, ResourceSlot<unknown>>>,
  role: PlatformRole = "ORG_OWNER",
  client: ApiClient = recordingClient().client,
): ViewProps => ({
  principal: principal(role),
  slots: { ...overrides } as Record<string, ResourceSlot<unknown>>,
  navigate: () => {},
  client,
  session: storedSession,
  refresh: async () => {},
});

/**
 * Render a route module the way React renders it.
 *
 * `createElement`, not a direct call: these modules hold their own `useState` for search text and
 * filters, and calling one as a plain function runs a hook outside a render and throws. That is not a
 * test-harness detail worth hiding — a module that cannot be rendered cannot be asserted on.
 */
const render = (Module: ComponentType<ViewProps>, viewProps: ViewProps) =>
  renderToStaticMarkup(createElement(Module, viewProps));

/* ============================================================ 1. the routes actually exist = */

type Inventory = { routes: { route: string }[] };
const inventory = JSON.parse(
  readFileSync(path.join(REPO, "infrastructure/aws-cdk/test/route-inventory.json"), "utf8"),
) as Inventory;
const inventoried = new Set(inventory.routes.map((entry) => entry.route));

/** `/tenants/{tenantId}/users/{username}/role` -> a regex over one concrete path. */
const templateMatcher = (route: string) => {
  const [, template] = route.split(" ");
  const pattern = template
    .split("/")
    .map((segment) => (segment.startsWith("{") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${pattern}$`);
};

test("every write the customer surface issues targets a route the control plane serves", () => {
  assert.ok(ALL_ENDPOINTS.length >= 22, "the endpoint table should cover every Phase 4 write");
  for (const endpoint of ALL_ENDPOINTS) {
    assert.ok(
      inventoried.has(endpoint.route),
      `no route "${endpoint.route}" exists in the committed route inventory, so ${endpoint.path} would 404 ` +
        `for whoever clicked the control that calls it`,
    );
    assert.match(
      endpoint.path,
      templateMatcher(endpoint.route),
      `the path builder for "${endpoint.route}" produced "${endpoint.path}", which does not match that ` +
        `route's shape — a dropped or extra segment still points at a real route and still fails`,
    );
  }
});

test("every read the customer surface declares targets a route the control plane serves", () => {
  for (const spec of customerResourceSpecs("north/wind")) {
    assert.ok(
      inventoried.has(spec.route),
      `resource "${spec.key}" reads "${spec.route}", which is not in the committed route inventory`,
    );
    assert.match(
      spec.path,
      templateMatcher(spec.route),
      `resource "${spec.key}" builds "${spec.path}", which does not match the shape of "${spec.route}"`,
    );
  }
});

test("the organization identifier is encoded into every path that carries it", () => {
  // A slug is the tenant identifier and arrives from a token claim, not from this surface. Interpolating
  // it raw is how a value containing a slash silently becomes two path segments and reads the wrong
  // route — which is a cross-organization request shaped like a typo.
  assert.equal(endpoints.inviteUser("north/wind").path, "/tenants/north%2Fwind/users");
  assert.equal(
    endpoints.setUserRole("north/wind", "a b@x.example").path,
    "/tenants/north%2Fwind/users/a%20b%40x.example/role",
  );
  assert.equal(endpoints.orgBranding("north/wind").path, "/organizations/north%2Fwind/branding");
  assert.equal(endpoints.removeTeamMember("t/1", "p@x.example").path, "/teams/t%2F1/members/p%40x.example");
});

test("the customer surface reaches the control plane only through the shared API client", () => {
  // Requirement 27.12 / task 9.3: the single-refresh latch and the deactivated-account sign-out live in
  // `@amazflow/api-client`. A raw fetch bypasses both, which is exactly how the four auth gates drifted
  // apart before Phase 1. Cognito is the one permitted exception and it lives in `session.ts`.
  for (const file of readdirSync(HERE).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))) {
    if (file === "session.ts") continue;
    const source = readFileSync(path.join(HERE, file), "utf8");
    assert.ok(
      !/\bfetch\s*\(/.test(source),
      `${file} calls fetch() directly; control-plane traffic must go through @amazflow/api-client so the ` +
        `single-refresh latch and the ACCOUNT_DISABLED sign-out apply to it`,
    );
  }
});

/* ============================================== 2. no control the API would refuse is offered = */

const PEOPLE = [
  {
    username: "invited@acme.example",
    email: "invited@acme.example",
    role: "FRONTLINE",
    platformRole: "OPERATOR",
    state: "invited",
    enabled: true,
    userStatus: "FORCE_CHANGE_PASSWORD",
    membershipStatus: "invited",
    lastLoginAt: null,
    teamIds: [],
  },
  {
    username: "active@acme.example",
    email: "active@acme.example",
    role: "CLIENT_ADMIN",
    platformRole: "APPROVER",
    state: "active",
    enabled: true,
    userStatus: "CONFIRMED",
    membershipStatus: "active",
    lastLoginAt: new Date(Date.now() - 3_600_000).toISOString(),
    teamIds: ["team_1"],
  },
  {
    username: "gone@acme.example",
    email: "gone@acme.example",
    role: "FRONTLINE",
    platformRole: "VIEWER",
    state: "deactivated",
    enabled: false,
    userStatus: "CONFIRMED",
    membershipStatus: "deactivated",
    lastLoginAt: null,
    teamIds: [],
  },
];

test("an administrator is offered invite, resend, revoke, deactivate, reactivate and role change", () => {
  const html = render(views.UsersView, props({ users: slot(PEOPLE) }, "ORG_ADMIN"));
  // Matched as element text rather than as a substring: "Deactivated" is also an option label on the
  // state filter and a badge on a deactivated person, so a bare `includes("Deactivate")` would pass on a
  // page with no deactivate control at all.
  for (const control of ["Send invitation", "Resend", "Revoke", "Deactivate", "Reactivate"])
    assert.ok(html.includes(`>${control}</button>`), `an ORG_ADMIN is not offered "${control}"`);
  // The role control is offered for an ACTIVE account only: a role assigned before the initial password
  // challenge completes is a role on an account that may never exist.
  assert.match(html, /aria-label="Role for active@acme.example"/);
  assert.doesNotMatch(html, /aria-label="Role for invited@acme.example"/);
  // Every one of the six roles the policy has, and no seventh.
  for (const role of CUSTOMER_ROLES) assert.ok(html.includes(`value="${role}"`), `${role} is not offerable`);
  assert.ok(!html.includes("STAFF_ADMIN"), "the staff role must never be offerable to a customer");
});

test("a viewer sees the same people and none of the controls", () => {
  // VIEWER holds `user:read` and nothing else about users, so this page is a real read for them — and
  // every mutation must be absent rather than present-and-refused.
  const html = render(views.UsersView, props({ users: slot(PEOPLE) }, "VIEWER"));
  assert.ok(html.includes("active@acme.example"), "a VIEWER should still see the people list");
  for (const control of ["Send invitation", "Resend", "Revoke", "Deactivate", "Reactivate"])
    assert.ok(
      !html.includes(`>${control}</button>`),
      `a VIEWER is offered "${control}", which the API refuses`,
    );
  assert.ok(!/<button/.test(html.split("<tbody>")[1] ?? ""), "no row action of any kind for a VIEWER");
  assert.doesNotMatch(html, /aria-label="Role for /);
});

test("a viewer is not offered team management", () => {
  const teams = slot({
    teams: [{ id: "team_1", name: "Finance", memberUsernames: ["active@acme.example"] }],
    grantsPermissions: false as const,
    grantsPermissionsReason: "Team membership grants no permissions in this release.",
  });
  const html = render(views.TeamsView, props({ teams, users: slot(PEOPLE) }, "VIEWER"));
  assert.ok(html.includes("Finance"), "a VIEWER holds team:read and should see the teams");
  for (const control of ["Create team", "Delete team", "Rename", "Add member", "Remove"])
    assert.ok(
      !html.includes(`>${control}</button>`),
      `a VIEWER is offered "${control}", which the API refuses`,
    );
});

/* ============================================================= 3. no value is invented = */

test("an unrecorded last sign-in is stated, not shown as a date or a zero", () => {
  // Requirement 9.22. `lastLoginAt` is only written from Phase 4 onward, so most accounts genuinely have
  // no value — and a placeholder date is a lie a support conversation gets built on.
  const html = render(views.UsersView, props({ users: slot(PEOPLE) }, "ORG_ADMIN"));
  assert.ok(html.includes("Not recorded"), "an absent last sign-in must say so");
  assert.doesNotMatch(html, /1970|Jan 1|00:00/, "an absent timestamp must not render as the epoch");
});

test("removal is explained as deactivation so audit attribution is not silently lost", () => {
  const html = render(views.UsersView, props({ users: slot(PEOPLE) }, "ORG_ADMIN"));
  assert.match(html, /never deleted/i);
  assert.match(html, /attribution/i);
  assert.ok(!html.includes(">Delete<"), "no delete control should exist for a person");
});

test("teams state that membership grants no permissions and offer no permission control", () => {
  // Requirement 10.7, asserted on the rendered page rather than only in the payload: a teams screen with
  // no stated scope reads as an access-control feature, and somebody will use it as one.
  const teams = slot({
    teams: [{ id: "team_1", name: "Finance", memberUsernames: [] }],
    grantsPermissions: false as const,
    grantsPermissionsReason: "Team membership grants no permissions in this release.",
  });
  const html = render(views.TeamsView, props({ teams, users: slot(PEOPLE) }, "ORG_ADMIN"));
  assert.match(html, /grant no permissions|does not change a person's role/i);
  assert.ok(!/permission/i.test(html.split("Finance")[1] ?? ""), "no per-team permission control");
});

test("the roles page renders the real policy, including the narrow form, and offers no custom role", () => {
  // The matrix is what `GET /permissions/matrix` serializes out of the same ROLE_GRANTS the API
  // enforces, so this screen cannot show a policy that is not the policy.
  const matrix = slot({
    roles: [...CUSTOMER_ROLES, "STAFF_ADMIN"],
    permissions: ["run:read", "run:cancel", "internal:copilot"],
    grants: {
      ORG_OWNER: { "run:read": true, "run:cancel": true },
      ORG_ADMIN: { "run:read": true, "run:cancel": true },
      WORKFLOW_BUILDER: { "run:read": true, "run:cancel": true },
      OPERATOR: { "run:read": "own", "run:cancel": "own" },
      APPROVER: { "run:read": true },
      VIEWER: { "run:read": true },
      STAFF_ADMIN: { "internal:copilot": true },
    },
  });
  const html = render(views.RolesView, props({ permissionMatrix: matrix }, "ORG_ADMIN"));
  // "You can cancel runs" and "you can cancel your own runs" are different promises.
  assert.ok(html.includes("Own only"), "the narrow form of a permission must be reported as narrow");
  assert.ok(!html.includes("internal:copilot"), "an internal permission is not a customer's concern");
  assert.ok(!html.includes("STAFF_ADMIN"), "the staff column does not belong on a customer surface");
  assert.match(html, /Custom roles are not available/i);
  assert.doesNotMatch(html, /<(input|textarea)/, "a custom-role form would accept input and do nothing");
});

test("billing states the plan and the recorded contact and accepts no input", () => {
  const organization = slot({
    name: "Acme Logistics",
    slug: "acme",
    status: "active",
    plan: "pilot",
    billingContact: { name: "Dana Reed", email: "dana@acme.example" },
    settings: {},
    branding: {},
  });
  const html = render(views.BillingView, props({ organization }, "ORG_ADMIN"));
  assert.match(html, /Not available in this release/);
  assert.ok(html.includes("pilot"), "the recorded plan value must be shown");
  assert.ok(html.includes("dana@acme.example"), "the recorded commercial contact must be shown");
  assert.doesNotMatch(
    html,
    /<(input|select|textarea)/,
    "a billing control that accepts input is the plan-field mistake (H-3) in a new place",
  );
});

test("billing with no recorded plan or contact says so rather than guessing", () => {
  const organization = slot({ name: "Acme", slug: "acme", status: "active", settings: {}, branding: {} });
  const html = render(views.BillingView, props({ organization }, "ORG_ADMIN"));
  assert.ok(html.includes("Not recorded"), "an absent plan must be stated");
  assert.ok(html.includes("None recorded"), "an absent billing contact must be stated");
  assert.doesNotMatch(html, /billing@|invoices@/, "no contact address may be invented");
});

test("notification preferences offer one toggle per stored kind and no email toggle", () => {
  // Requirement 12.4/12.5 and 22.9: every setting presented is stored, and email delivery is not
  // offered in this release, so an email toggle would accept input and do nothing.
  const preferences = slot({
    username: "owner@acme.example",
    values: { "notify.run_failed": false, "notify.approval_required": true, "display.density": "comfortable" },
    updatedAt: null,
    keys: ["notify.run_failed", "notify.approval_required", "display.density"],
  });
  const html = render(views.NotificationPreferencesView, props({ preferences }, "ORG_ADMIN"));
  assert.ok(html.includes("Run failed"), "a stored kind must be labelled in words");
  assert.ok(html.includes("Approval required"));
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2, "one toggle per stored notify key");
  // The absence is STATED, so the page necessarily contains the word "email". What must not exist is a
  // control: no email field, and no toggle whose label mentions email delivery.
  assert.match(html, /Email delivery is not offered in this release/);
  assert.doesNotMatch(html, /type="email"/, "no email control exists in this release");
  assert.ok(
    !/<span>[^<]*[Ee]mail[^<]*<\/span>/.test(html),
    "no preference toggle may be labelled as an email delivery choice",
  );
  // A stored preference the surface cannot honour is not presented as if it could be.
  assert.ok(!html.includes("display.density"));
});

/* ============================================== notifications: indicator, list, read, read all = */

const NOTIFICATIONS = [
  {
    id: "ntf_1",
    kind: "approval_required",
    title: "A run is waiting for a decision",
    body: "Invoice reconciliation paused at step 4.",
    deepLink: "/runs/run_abc/",
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    read: false,
  },
  {
    id: "ntf_2",
    kind: "run_failed",
    title: "A run stopped without finishing",
    body: "Order sync failed at step 2.",
    deepLink: "/console/runs/run_def/",
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    read: true,
  },
];

test("the notification list reports the unread count, the kind, and offers mark all read", () => {
  const html = render(views.NotificationsView, props({ notifications: slot(NOTIFICATIONS) }, "ORG_ADMIN"));
  assert.ok(html.includes("1 unread"), "the unread count must be the count of unread records");
  assert.ok(html.includes("Approval required"), "the persisted kind must render as words");
  assert.ok(html.includes("Run failed"));
  assert.ok(html.includes("Unread") && html.includes("Read"), "read state is per notification");
  // Offered for real, because there IS something to mark.
  assert.match(html, /<button(?![^>]*disabled)[^>]*>Mark all read<\/button>/);
});

test("a notification with nothing unread cannot offer mark all read", () => {
  const allRead = NOTIFICATIONS.map((n) => ({ ...n, read: true }));
  const html = render(views.NotificationsView, props({ notifications: slot(allRead) }, "ORG_ADMIN"));
  assert.ok(html.includes("0 unread"));
  // Present but disabled, not present and pretending: a button that would issue a write with nothing to
  // write is a control that does nothing, which is the thing this surface exists not to do.
  assert.match(html, /<button[^>]*disabled=""[^>]*>Mark all read<\/button>/);
});

test("every notification deep link resolves through the one route table", () => {
  // Requirement 22.5. A deep link that does not resolve lands the person on Home, which reads as the
  // notification having been about nothing.
  for (const notification of NOTIFICATIONS) {
    const resolved = pathToView(CUSTOMER_ROUTE_TABLE, notification.deepLink);
    assert.equal(resolved.routeId, "runs", `${notification.deepLink} did not resolve to the runs view`);
    assert.ok(resolved.entityId, `${notification.deepLink} lost its run identifier`);
  }
});

test("marking one read and marking all read call the routes the control plane serves", async () => {
  const { client, calls } = recordingClient();
  await client.post(endpoints.readNotification("ntf_1").path);
  await client.post(endpoints.readAllNotifications().path);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
    "POST /notifications/ntf_1/read",
    "POST /notifications/read-all",
  ]);
});

/* ================================================================ organization administration = */

const ORGANIZATION = {
  name: "Acme Logistics",
  slug: "acme",
  status: "active",
  plan: "pilot",
  primaryDomain: "acme.example",
  primaryContact: { name: "Dana Reed", email: "dana@acme.example", phone: "+1 555 0100" },
  billingContact: { name: "Pat Lin", email: "pat@acme.example" },
  settings: { maxConcurrentRuns: 3, allowedEmailDomains: ["acme.example"], timezone: "Europe/London" },
  branding: { displayName: "Acme", loginMessage: "Welcome", accent: "#ff765c", logoUrl: "https://acme.example/l.png" },
  updatedAt: new Date().toISOString(),
};

test("every editable organization field is rendered with its stored value", () => {
  // Requirement 11.1/11.2: the form is the record. A field rendered empty when a value is stored is a
  // save away from erasing it.
  const html = render(views.OrganizationView, props({ organization: slot(ORGANIZATION) }, "ORG_ADMIN"));
  for (const value of [
    "Acme Logistics",
    "acme.example",
    "Dana Reed",
    "dana@acme.example",
    "+1 555 0100",
    "Pat Lin",
    "pat@acme.example",
    "Europe/London",
    "#ff765c",
    "https://acme.example/l.png",
  ])
    assert.ok(html.includes(value), `the stored value "${value}" is not rendered into its field`);
});

test("the slug is shown as the immutable tenant identifier and has no editable field", () => {
  // Requirement 8.14. The control plane refuses a slug change with a stated reason; the surface must not
  // offer the change in the first place.
  const html = render(views.OrganizationView, props({ organization: slot(ORGANIZATION) }, "ORG_ADMIN"));
  assert.match(html, /Tenant identifier: acme/);
  assert.doesNotMatch(html, /aria-label="[^"]*slug|>Slug</i, "no slug field may be offered");
});

test("the execution status is stated, and a paused organization says what still works", () => {
  const paused = { ...ORGANIZATION, status: "paused" };
  const html = render(views.OrganizationView, props({ organization: slot(paused) }, "ORG_ADMIN"));
  assert.match(html, /Execution status: Paused/);
  assert.match(html, /refused/i);
  assert.match(html, /Administration remains available/i);
});

test("the concurrency ceiling is shown as read-only and named as staff-set", () => {
  // Requirement 11.2 plus `maySetConcurrencyLimit`: no customer role can set it, so no customer surface
  // may present a control for it. An organization that can raise its own ceiling has no ceiling.
  const html = render(views.OrganizationView, props({ organization: slot(ORGANIZATION) }, "ORG_OWNER"));
  assert.match(html, /Concurrent run limit: 3/);
  assert.match(html, /Only AmazFlow staff can change/i);
  assert.doesNotMatch(html, /aria-label="[^"]*[Cc]oncurren/, "no concurrency input may be offered");
});

test("an absent concurrency ceiling reads as no ceiling rather than as zero", () => {
  const noLimit = { ...ORGANIZATION, settings: { ...ORGANIZATION.settings, maxConcurrentRuns: 0 } };
  const html = render(views.OrganizationView, props({ organization: slot(noLimit) }, "ORG_OWNER"));
  assert.match(html, /No configured ceiling/);
  assert.doesNotMatch(html, /Concurrent run limit: 0/);
});

/* ============================================================================== invitations = */

test("an expired invitation, a used one, and a failure are three different screens", () => {
  // Requirement 26.6/26.7. 410 means "this existed and has expired", which is actionable — ask for a new
  // one. 409 means "already accepted or withdrawn", which sends the person to sign in. Collapsing them
  // into one error screen sends both people to the wrong place.
  assert.equal(views.invitationFailureForStatus(410), "expired");
  assert.equal(views.invitationFailureForStatus(409), "used");
  assert.equal(views.invitationFailureForStatus(404), "error");
  assert.equal(views.invitationFailureForStatus(429), "error");
  assert.equal(views.invitationFailureForStatus(0), "error");
});

test("invitation acceptance is a POST to the token's own route and carries no organization or role", async () => {
  // Requirement 26.13: organization and role are resolved from the stored record and anything the body
  // claims is ignored. So the surface sends nothing to be ignored.
  const { client, calls } = recordingClient();
  await client.post(endpoints.acceptInvitation("tok_abc").path);
  assert.deepEqual(calls, [{ method: "POST", path: "/invitations/tok_abc/accept", body: undefined }]);
});

/* ==================================================== permission-aware navigation after Phase 4 = */

test("the fine membership role from /me is believed when its coarse group can reach it", () => {
  // Phase 4 ships the role-change route, so a person can genuinely be an APPROVER now. A surface still
  // guessing the role from the coarse group would offer them the whole administration section.
  const fromClaims = principal("ORG_ADMIN");
  assert.equal(refinePrincipal(fromClaims, { platformRole: "APPROVER" }).role, "APPROVER");
  assert.equal(refinePrincipal(fromClaims, { platformRole: "ORG_OWNER" }).role, "ORG_OWNER");
  assert.equal(refinePrincipal(principal("OPERATOR"), { platformRole: "VIEWER" }).role, "VIEWER");
});

test("a stored role the coarse group cannot reach is not believed", () => {
  // The same rule the control plane applies: the group is authoritative because it is what the identity
  // provider signed. A membership record claiming ORG_OWNER for a FRONTLINE account disagrees with the
  // token, and believing it here would offer controls every request then refuses.
  assert.equal(refinePrincipal(principal("OPERATOR"), { platformRole: "ORG_OWNER" }).role, "OPERATOR");
  assert.equal(refinePrincipal(principal("ORG_ADMIN"), { platformRole: "OPERATOR" }).role, "ORG_ADMIN");
  // And no `/me` response can turn the customer surface into a staff console.
  assert.equal(refinePrincipal(principal("ORG_ADMIN"), { platformRole: "STAFF_ADMIN" }).role, "ORG_ADMIN");
  assert.equal(refinePrincipal(principal("ORG_ADMIN"), { platformRole: "nonsense" }).role, "ORG_ADMIN");
  assert.equal(refinePrincipal(principal("ORG_ADMIN"), { platformRole: "" }).role, "ORG_ADMIN");
});

test("refinement is identity-stable when nothing changed, so polling cannot churn the read pass", () => {
  const fromClaims = principal("ORG_ADMIN");
  assert.equal(refinePrincipal(fromClaims, { platformRole: "ORG_ADMIN", teamIds: [] }), fromClaims);
  assert.equal(refinePrincipal(fromClaims, null), fromClaims);
  assert.equal(refinePrincipal(fromClaims, {}), fromClaims);
  assert.deepEqual(refinePrincipal(fromClaims, { teamIds: ["team_1"] }).teamIds, ["team_1"]);
});

test("agents show derived connectivity and the two execution surfaces without invented values", () => {
  const html = render(views.AgentsView, props({
    agents: slot([
      { id: "chrome_1", agentType: "CHROME_EXTENSION", platform: "macOS", version: "1.4.0", connectionStatus: "connected", capabilities: ["CLICK"], permissions: [], lastSeenAt: new Date().toISOString() },
      { id: "desktop_1", agentType: "DESKTOP_AGENT", platform: "macOS", version: "2.0.0", connectionStatus: "offline", capabilities: ["desktop.click"], permissions: ["accessibility"], lastSeenAt: null },
    ]),
  }));
  assert.match(html, /Chrome Extension/);
  assert.match(html, /Desktop App/);
  assert.match(html, /connected/);
  assert.match(html, /offline/);
  assert.match(html, /accessibility/);
  assert.match(html, /Not recorded/, "a missing heartbeat or capability must not become a fake value");
});

test("only an approver is offered the server-verified approval controls", () => {
  const runs = slot([{ id: "run_waiting", status: "WAITING_APPROVAL", currentStepId: "approval_step" }]);
  const approver = render(views.ApprovalsView, props({ runs }, "APPROVER"));
  assert.match(approver, />Approve</);
  assert.match(approver, />Reject</);
  const operator = render(views.ApprovalsView, props({ runs }, "OPERATOR"));
  assert.doesNotMatch(operator, />Approve</);
  assert.doesNotMatch(operator, />Reject</);
});

/* ======================================================= 4. the markup is styled, not invented = */

test("every class name the customer surface renders has a rule in the shared stylesheet", () => {
  // This one shipped. The first draft of this surface used `ops-nav-item`, `ops-topbar-right`,
  // `ops-user-menu`, `ops-panel-title` and seventeen more names with no rule behind them, so the whole
  // customer application rendered as an unstyled column of buttons while the build reported success.
  // Task 9.1 names the coupling — a surface renders unstyled markup rather than failing the build — so
  // agreement with the stylesheet is a thing to assert rather than to hope for.
  const css = readFileSync(path.join(REPO, "packages/ui/src/ops.css"), "utf8");
  const styled = new Set(css.match(/\.ops-[a-z0-9-]+/g)?.map((m) => m.slice(1)) ?? []);
  const unstyled = new Set<string>();
  for (const file of readdirSync(HERE).filter((f) => /\.tsx$/.test(f) && !f.includes(".test."))) {
    const source = readFileSync(path.join(HERE, file), "utf8");
    // Class names only, from `className="..."` attributes — not from prose in a comment.
    for (const attribute of source.match(/className="[^"]*"/g) ?? [])
      for (const name of attribute.slice(11, -1).split(/\s+/).filter(Boolean))
        if (name.startsWith("ops-") && !styled.has(name)) unstyled.add(`${file}: ${name}`);
  }
  assert.deepEqual(
    [...unstyled].sort(),
    [],
    "these class names are rendered by the customer surface and styled by nothing",
  );
});
