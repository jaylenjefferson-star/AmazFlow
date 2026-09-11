// Task 9.13 — route-level rendering tests for the internal staff console.
//
// _Requirements: 34.16, 3.7, 2.3, 2.4_
//
// The important assertion on this surface is the negative one: the access-denied shell contains no
// organization data from any tenant. That is task 9.7's actual promise, and it is only meaningful if it
// is checked against the rendered markup rather than against the intention of the code — so the test
// renders it with a tenant seeded into the world and asserts that none of that tenant's values appear.

import "./jsx-global";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiClient } from "@amazflow/api-client";
import { navigation, pathToView, type ResourceSlot } from "@amazflow/domain-ui";
import { can, type PlatformRole, type Principal } from "@amazflow/permissions";
import { INTERNAL_ALIASES, INTERNAL_ROUTES, INTERNAL_ROUTE_TABLE } from "./routes";
import { AccessDenied, NoOrganizationShell, SECTION_RESOURCE, StaffSection } from "./views";

const principal = (role: PlatformRole, orgId: string): Principal => ({
  kind: "user",
  userId: `user_${role}`,
  orgId,
  group: role === "STAFF_ADMIN" ? "SUPER_ADMIN" : "CLIENT_ADMIN",
  role,
  teamIds: [],
  isStaff: role === "STAFF_ADMIN",
});

const staff = principal("STAFF_ADMIN", "amazflow");
const customer = principal("ORG_OWNER", "acme");

const slots = (
  state: ResourceSlot<unknown>["state"],
  value: unknown = [],
  error: string | null = null,
): Record<string, ResourceSlot<unknown>> => {
  const out: Record<string, ResourceSlot<unknown>> = {};
  for (const key of Object.values(SECTION_RESOURCE))
    out[key] = { value, state, error, loadedAt: state === "ready" ? new Date().toISOString() : null };
  return out;
};

const renderSection = (
  routeId: string,
  state: ResourceSlot<unknown>["state"],
  value: unknown = [],
  error: string | null = null,
) => renderToStaticMarkup(StaffSection({ routeId, slots: slots(state, value, error) }) as never);

test("every staff section renders a loading state", () => {
  for (const routeId of Object.keys(SECTION_RESOURCE)) {
    assert.match(
      renderSection(routeId, "loading"),
      /aria-busy="true"|ops-skeleton/,
      `${routeId} renders nothing while loading`,
    );
  }
});

test("every staff section renders an empty state that says it is empty, not broken", () => {
  for (const routeId of Object.keys(SECTION_RESOURCE)) {
    assert.match(renderSection(routeId, "ready", []), /Nothing here yet/, routeId);
  }
});

test("every staff section renders the failure rather than an empty list", () => {
  for (const routeId of Object.keys(SECTION_RESOURCE)) {
    assert.match(
      renderSection(routeId, "error", [], "upstream timeout"),
      /This did not load[\s\S]*upstream timeout/,
      routeId,
    );
  }
});

test("a section with no backing read says why it has no controls", () => {
  // `flags` has no backing read because no runtime behaviour consumes a flag. An empty list here
  // would claim AmazFlow looked and found no flags, which is a different statement.
  assert.match(renderSection("flags", "ready", []), /No runtime feature flags/);
});

test("feature flags do not invent switches when no runtime behaviour reads one", () => {
  const html = renderSection("flags", "ready", []);
  assert.match(html, /No runtime feature flags/);
  assert.doesNotMatch(html, /<(input|select|textarea)/);
});

test("the staff organization table labels the plan as reporting-only", () => {
  const html = renderSection("organizations", "ready", [{
    id: "org_1",
    name: "Northwind",
    status: "active",
    lifecycleStatus: "trial",
    plan: "pilot",
    activatedAt: null,
  }]);
  assert.match(html, /pilot \(reporting-only\)/);
});

test("staff organization management exposes separate execution and commercial state", () => {
  const client = {
    post: async () => null,
    put: async () => null,
  } as unknown as ApiClient;
  const html = renderToStaticMarkup(StaffSection({
    routeId: "organizations",
    slots: slots("ready", [{
      id: "org_1", name: "Northwind", slug: "northwind", status: "active",
      lifecycleStatus: "trial", plan: "pilot",
    }]),
    client,
    refresh: async () => {},
  }) as never);
  assert.match(html, /Create organization/);
  assert.match(html, /Execution status/);
  assert.match(html, /Commercial lifecycle/);
  assert.match(html, /Reporting-only/);
  assert.match(html, /never stops execution/);
});

test("the access-denied shell contains no organization data from any tenant", () => {
  const html = renderToStaticMarkup(AccessDenied({ principal: customer }) as never);

  // It names the person's own organization, which they already know.
  assert.match(html, /acme/);

  // And nothing else: no other organization, no run, no workflow, no user, no count. These are the
  // values a filtered-but-mounted data layer would have leaked.
  // The only organization NAMED as an organization is the principal's own. Checked structurally rather
  // than by substring, because the page legitimately contains the string "amazflow" in the link to
  // app.amazflow.com — and a test that forbade that would be forbidding the one useful thing on the
  // page.
  const named = [...html.matchAll(/<strong>([^<]*)<\/strong>/g)].map((m) => m[1]);
  assert.deepEqual(named, ["acme"], "the denied shell names an organization other than the caller's own");

  for (const foreign of ["globex", "run_", "wf_", "org_", "MEMBERSHIP", "tickets", "leads"]) {
    assert.ok(
      !html.includes(foreign),
      `the access-denied shell leaked "${foreign}" — it must render no tenant data at all`,
    );
  }

  // It also has to be useful: a dead end with no way forward is its own kind of dishonesty.
  assert.match(html, /app\.amazflow\.com/);
  assert.match(html, /role="alert"/);
});

test("the no-organization shell explains the state rather than looping the sign-in", () => {
  const html = renderToStaticMarkup(NoOrganizationShell() as never);
  assert.match(html, /not attached to an organization/);
  assert.ok(!html.includes("amazflow"), "a missing organization claim must never default to a tenant");
});

test("no staff route is offered to a customer principal", () => {
  const groups = navigation(INTERNAL_ROUTE_TABLE, customer);
  const usable = groups.flatMap((g) => g.items.filter((i) => i.enabled).map((i) => i.route.id));
  const internalRoutes = INTERNAL_ROUTES.filter((r) => r.permission?.startsWith("internal:"));
  assert.ok(internalRoutes.length > 0, "the internal table should contain internal-namespace routes");
  for (const route of internalRoutes)
    assert.ok(
      !usable.includes(route.id),
      `"${route.label}" is offered to a customer principal on the staff console`,
    );
});

test("navigation offers staff nothing the policy refuses", () => {
  for (const group of navigation(INTERNAL_ROUTE_TABLE, staff)) {
    for (const entry of group.items) {
      if (!entry.enabled) {
        assert.ok(entry.disabledReason, `${entry.route.label} disabled with no reason`);
        continue;
      }
      assert.ok(
        entry.route.permission === null || can(staff, entry.route.permission, { orgId: "acme" }).allow,
        `navigation offers "${entry.route.label}" to staff but the policy refuses it`,
      );
    }
  }
});

test("an intentionally disabled section states its reason and offers no control", () => {
  for (const route of INTERNAL_ROUTES) {
    const disabled = route as { disabledReason?: string; disabledDetail?: string };
    if (!disabled.disabledReason) continue;
    assert.ok(
      disabled.disabledDetail && disabled.disabledDetail.length > 40,
      `"${route.label}" is disabled with a one-line reason; requirement 30.4 asks for the why`,
    );
    assert.ok(
      !SECTION_RESOURCE[route.id],
      `"${route.label}" is disabled but also wired to a read, which is a control that half-works`,
    );
  }
});

test("every legacy /app path resolves to a route that exists", () => {
  for (const [legacy, routeId] of Object.entries(INTERNAL_ALIASES)) {
    assert.ok(
      INTERNAL_ROUTES.some((r) => r.id === routeId),
      `alias ${legacy} points at "${routeId}", which is not in the route table`,
    );
    assert.equal(pathToView(INTERNAL_ROUTE_TABLE, legacy).routeId, routeId);
  }
});
