// The internal staff console's route table — one table, one path-to-view mapping (requirement 3.4).
//
// The fourteen sections `/app` serves today carry over unchanged (task 21.1), plus the new internal
// ones from the design: onboarding, customer-relationship-management, system health, feature flags,
// impersonation and internal billing. The last two ship INTENTIONALLY DISABLED with their reason
// stated, which is a decision worth reading rather than a placeholder:
//
//   * Impersonation is not shipped in v1 because the audit story has to come first. The principal type
//     already carries `impersonatorUserId` so that an audit record can name the human behind an
//     impersonated action from the day the feature exists, rather than the feature arriving and the
//     audit trail having nowhere to put them.
//   * Internal billing is disabled for the same reason the customer's is: there is no billing provider,
//     so every control would be a control that accepts input and does nothing.
//
// Every row names the permission the control plane enforces for it. Navigation filters through the
// policy, so even within staff a section whose grant is absent does not appear.

import type { RouteDef, RouteTable } from "@amazflow/domain-ui";

export type InternalRoute = RouteDef & {
  disabledReason?: string;
  disabledDetail?: string;
};

export const INTERNAL_ROUTES: readonly InternalRoute[] = [
  { id: "overview", path: "/", label: "Overview", permission: null, group: "Operate", glyph: "overview", key: "o" },
  { id: "runs", path: "/runs/", label: "Runs", permission: "run:read", entity: "run", group: "Operate", glyph: "runs", count: "live", key: "r" },
  { id: "approvals", path: "/approvals/", label: "Approvals", permission: "approval:read", group: "Operate", glyph: "approvals", count: "approvals", tone: "waiting", key: "a" },
  { id: "exceptions", path: "/exceptions/", label: "Needs attention", permission: "exception:read", group: "Operate", glyph: "attention", count: "exceptions", tone: "bad", key: "e" },

  { id: "organizations", path: "/organizations/", label: "Organizations", breadcrumb: "Customers", permission: "internal:organization_manage", entity: "organization", group: "Customers", glyph: "organizations", key: "c" },
  { id: "users", path: "/users/", label: "Users", permission: "user:read", group: "Customers", glyph: "users", key: "u" },
  { id: "leads", path: "/leads/", label: "Leads", permission: "internal:lead_read", group: "Customers", glyph: "leads", key: "l" },
  { id: "onboarding", path: "/onboarding/", label: "Onboarding", permission: "internal:organization_manage", group: "Customers", glyph: "overview" },
  { id: "crm", path: "/crm/", label: "Deals", permission: "internal:organization_manage", group: "Customers", glyph: "leads" },

  { id: "workflows", path: "/workflows/", label: "Workflows", permission: "workflow:read", entity: "workflow", group: "Build", glyph: "workflows", key: "w" },
  { id: "studio", path: "/studio/", label: "Workflow Studio", permission: "internal:workflow_author", group: "Build", glyph: "studio", key: "s" },
  { id: "connections", path: "/connections/", label: "Connections", permission: "connection:read", entity: "connection", group: "Build", glyph: "connections", key: "n" },
  { id: "agents", path: "/agents/", label: "Agents", permission: "agent:read", group: "Build", glyph: "agents", key: "b" },
  { id: "copilot", path: "/copilot/", label: "Copilot", permission: "internal:copilot", group: "Build", glyph: "studio" },

  { id: "activity", path: "/activity/", label: "Activity", permission: "internal:audit_read_all", group: "Trust", glyph: "audit", key: "d" },
  { id: "support", path: "/support/", label: "Support", permission: "internal:support_manage", group: "Trust", glyph: "support", count: "openTickets", tone: "waiting", key: "t" },
  { id: "health", path: "/health/", label: "System health", permission: "internal:platform_settings", group: "Trust", glyph: "overview" },

  { id: "settings", path: "/settings/", label: "Platform settings", breadcrumb: "Platform", permission: "internal:platform_settings", group: "Platform", glyph: "settings", key: "p" },
  { id: "flags", path: "/flags/", label: "Feature flags", permission: "internal:platform_settings", group: "Platform", glyph: "settings" },
  {
    id: "impersonation",
    path: "/impersonation/",
    label: "Impersonation",
    permission: "internal:platform_settings",
    group: "Platform",
    glyph: "users",
    disabledReason: "Acting as a customer user is not available in this release.",
    disabledDetail:
      "Impersonation is only safe once every action taken while impersonating names the staff member who " +
      "took it. The principal already carries that field, so the audit trail has somewhere to put them, but " +
      "the consent, time-bounding and notification rules are not built. Rather than ship a control that " +
      "would grant a staff member a customer's session without those rules, this page does nothing.",
  },
  {
    id: "billing",
    path: "/billing/",
    label: "Billing",
    permission: "internal:platform_settings",
    group: "Platform",
    glyph: "settings",
    disabledReason: "AmazFlow has no billing provider in this release.",
    disabledDetail:
      "There is no subscription, invoice, or payment record anywhere in the platform. The `plan` field on an " +
      "organization is a stored string that nothing reads or enforces (H-3), and presenting it here as a " +
      "commercial state would repeat exactly the mistake that made it misleading on the customer surface.",
  },
];

/**
 * `/app` was the staff surface. Every path it served resolves here (task 9.12, requirement 1.11), and
 * `/app` itself stays live and functional until task 28.4 — this table is what makes the eventual
 * redirect land on the right section rather than dropping a person on the overview.
 */
export const INTERNAL_ALIASES: Readonly<Record<string, string>> = {
  "/app/": "overview",
  "/app/runs/": "runs",
  "/app/approvals/": "approvals",
  "/app/exceptions/": "exceptions",
  "/app/customers/": "organizations",
  // `/app/clients` became `/app/customers` before this restructure, and both still resolve: a
  // deprecation window that only honours the most recent rename is not a deprecation window.
  "/app/clients/": "organizations",
  "/app/users/": "users",
  "/app/leads/": "leads",
  "/app/workflows/": "workflows",
  "/app/studio/": "studio",
  "/app/connections/": "connections",
  "/app/agents/": "agents",
  "/app/audit/": "activity",
  "/app/support/": "support",
  "/app/settings/": "settings",
};

export const INTERNAL_ROUTE_TABLE: RouteTable = {
  root: "/",
  routes: INTERNAL_ROUTES,
  aliases: INTERNAL_ALIASES,
};

export const internalRoute = (id: string): InternalRoute | undefined =>
  INTERNAL_ROUTES.find((route) => route.id === id);
