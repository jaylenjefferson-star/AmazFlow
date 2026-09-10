// The customer application's route table — the one and only path-to-view mapping for this surface
// (task 9.6, requirement 3.4).
//
// This is the route map from the design's *Customer app — app.amazflow.com* section, written as data.
// Every row names the permission it needs, so navigation is a filter of this table through the same
// policy the control plane enforces (task 9.5) and a section cannot be offered to someone the API
// will refuse.
//
// Three kinds of row are worth telling apart, because conflating them is how the previous surfaces
// ended up presenting controls that did nothing:
//
//   * A FUNCTIONAL row is backed by a route that exists and works today.
//   * A row marked `disabledReason` is INTENTIONALLY DISABLED: the section renders, states plainly
//     why it does nothing yet, and presents no control that accepts input. Billing, single sign-on,
//     and directory provisioning are here. This is requirement 30.3/30.4, and the `plan`-field
//     precedent (H-3) is exactly the failure mode it exists to prevent — a stored value the console
//     presented as a limit for months without it ever being one.
//   * A row with `shownWhenDeniedBecause` is functional but not for this principal, and says so
//     rather than vanishing (requirement 3.8).

import type { RouteDef, RouteTable } from "@amazflow/domain-ui";

/** Rows carry a class so the shell can render the disabled ones honestly rather than per-page. */
export type CustomerRoute = RouteDef & {
  /** Present exactly when the section ships intentionally disabled, and is shown to the person. */
  disabledReason?: string;
  /** Longer explanation rendered in the section body. */
  disabledDetail?: string;
};

export const CUSTOMER_ROUTES: readonly CustomerRoute[] = [
  { id: "home", path: "/", label: "Home", permission: null, group: "Work", glyph: "overview", key: "h" },

  { id: "workflows", path: "/workflows/", label: "Workflows", permission: "workflow:read", entity: "workflow", group: "Work", glyph: "workflows", key: "w" },
  { id: "runs", path: "/runs/", label: "Runs", permission: "run:read", entity: "run", group: "Work", glyph: "runs", count: "live", key: "r" },
  { id: "tasks", path: "/tasks/", label: "Tasks", permission: "task:read", group: "Work", glyph: "runs", key: "k" },
  { id: "approvals", path: "/approvals/", label: "Approvals", permission: "approval:read", group: "Work", glyph: "approvals", count: "approvals", tone: "waiting", key: "a" },
  { id: "exceptions", path: "/exceptions/", label: "Needs attention", permission: "exception:read", group: "Work", glyph: "attention", count: "exceptions", tone: "bad", key: "e" },

  { id: "agents", path: "/agents/", label: "Agents", permission: "agent:read", group: "Connect", glyph: "agents", key: "b" },
  { id: "connections", path: "/connections/", label: "Connections", permission: "connection:read", entity: "connection", group: "Connect", glyph: "connections", key: "n" },
  { id: "analytics", path: "/analytics/", label: "Analytics", permission: "analytics:read", group: "Connect", glyph: "overview" },

  { id: "admin-organization", path: "/admin/organization/", label: "Organization", permission: "org:settings", group: "Administration", glyph: "organizations" },
  { id: "admin-users", path: "/admin/users/", label: "People", permission: "user:read", group: "Administration", glyph: "users", key: "u" },
  { id: "admin-teams", path: "/admin/teams/", label: "Teams", permission: "team:read", group: "Administration", glyph: "users" },
  { id: "admin-roles", path: "/admin/roles/", label: "Roles", permission: "user:read", group: "Administration", glyph: "audit" },
  { id: "admin-security", path: "/admin/security/", label: "Security", permission: "org:settings", group: "Administration", glyph: "audit" },
  {
    id: "admin-audit",
    path: "/admin/audit/",
    label: "Audit trail",
    permission: "audit:read",
    group: "Administration",
    glyph: "audit",
    key: "d",
    // Requirement 3.8's exception. A person who has been told their organization keeps an audit trail
    // and finds no audit section concludes the product does not have one, not that they lack a
    // permission. That misreading is worse than a disabled entry with a reason.
    shownWhenDeniedBecause:
      "Your role cannot read the audit trail. An organization administrator or a viewer can.",
  },
  {
    id: "admin-billing",
    path: "/admin/billing/",
    label: "Billing",
    permission: "org:read",
    group: "Administration",
    glyph: "settings",
    disabledReason: "Billing is managed by your AmazFlow contact.",
    disabledDetail:
      "AmazFlow has no billing system in this release, so there is nothing here that could take a payment " +
      "method, change a plan, or show an invoice. Rather than present controls that would accept input and " +
      "do nothing, this page shows the plan recorded against your organization and how to reach the person " +
      "who can change it.",
  },

  { id: "settings-profile", path: "/settings/profile/", label: "Your profile", permission: null, group: "You", glyph: "users" },
  { id: "settings-security", path: "/settings/security/", label: "Your security", permission: null, group: "You", glyph: "audit" },
  { id: "settings-notifications", path: "/settings/notifications/", label: "Notifications", permission: "notification:read", group: "You", glyph: "attention" },
  { id: "support", path: "/support/", label: "Support", permission: null, group: "You", glyph: "support", key: "t" },

  // Reachable but outside navigation: entered by link, not chosen from a sidebar.
  { id: "accept-invitation", path: "/accept-invitation/", label: "Accept your invitation", permission: null },
  { id: "notifications", path: "/notifications/", label: "Notifications", permission: "notification:read" },
];

/**
 * Task 9.12 / requirement 1.11: no previously reachable route is removed until its replacement is
 * live and a deprecation window has elapsed.
 *
 * `/console` was the customer surface. Every path it served resolves here to the section that
 * replaced it, so a bookmark, an emailed run link, or a link in an old support ticket still lands on
 * the right screen instead of a 404. The old surface itself also stays live and functional until task
 * 28.4 — this table is what makes the eventual redirect land somewhere correct rather than at a home
 * page that loses the person's place.
 */
export const CUSTOMER_ALIASES: Readonly<Record<string, string>> = {
  "/console/": "home",
  "/console/runs/": "runs",
  "/console/team/": "admin-users",
  "/console/settings/": "admin-organization",
  "/console/support/": "support",
  "/console/account/": "settings-profile",
};

export const CUSTOMER_ROUTE_TABLE: RouteTable = {
  root: "/",
  routes: CUSTOMER_ROUTES,
  aliases: CUSTOMER_ALIASES,
};

export const customerRoute = (id: string): CustomerRoute | undefined =>
  CUSTOMER_ROUTES.find((route) => route.id === id);
