/**
 * AmazFlow Control routing — now ONE table (task 9.5).
 *
 * The console is a static export, so navigation is pushState over a flat section + entity model. A
 * committed rewrite rule maps `/app/<*>` back to `/app/index.html` so deep links survive a hard
 * reload — that rule now lives in `infrastructure/hosting/` rather than only in the console (task
 * 9.9). Every operational object is addressable, which is what makes the command palette and
 * cross-entity links work.
 *
 * What changed: `SECTION_PATH`, `SECTION_LABEL`, `SECTION_ENTITY`, `NAV_GROUPS` and `GOTO_KEYS` were
 * five parallel records keyed by the same union, so adding a section meant editing five places and a
 * section could be reachable without appearing in navigation, or appear in navigation with no path.
 * They are now DERIVED from one `RouteTable` — requirement 3.4's "exactly one route table per
 * surface, with no inline path-to-view mapping alongside it". The exported names are unchanged, so
 * `shell.tsx` and `command-palette.tsx` are untouched.
 *
 * This surface's navigation is deliberately NOT permission-filtered: `/app` is the staff console and
 * every principal who reaches it is staff, holding every internal grant. The customer app and the new
 * internal console filter through `navigation()` from the shared table (requirement 3.6/3.7).
 */

import {
  pathToView as resolveView,
  viewToPath as toPath,
  type RouteDef,
  type RouteTable,
} from "@amazflow/domain-ui";
import type { IconName } from "@amazflow/ui";

export type Section =
  | "overview"
  | "runs"
  | "approvals"
  | "exceptions"
  | "workflows"
  | "studio"
  | "customers"
  | "users"
  | "connections"
  | "agents"
  | "audit"
  | "support"
  | "leads"
  | "settings";

export type View = {
  section: Section;
  /** Slug/id of the focused entity, when the section supports drill-in. */
  entityId?: string;
  /** Saved-view or tab preselection, carried in the query string. */
  view?: string;
  tab?: string;
};

/* ------------------------------------------------------------------ the one table --------- */

/**
 * The staff surface's route table. Every fact about a section lives on its row.
 *
 * `permission` is recorded even though this surface does not filter on it, because it is what task
 * 21.1's port carries over when these sections move to the internal console — a row that already
 * names its permission ports without anyone re-deriving which one it needed.
 */
export const STAFF_ROUTES: readonly RouteDef[] = [
  { id: "overview", path: "/app/", label: "Overview", permission: null, group: "Operate", glyph: "overview", key: "o" },
  { id: "runs", path: "/app/runs/", label: "Runs", permission: "run:read", entity: "run", group: "Operate", glyph: "runs", count: "live", key: "r" },
  { id: "approvals", path: "/app/approvals/", label: "Approvals", permission: "approval:read", group: "Operate", glyph: "approvals", count: "approvals", tone: "waiting", key: "a" },
  { id: "exceptions", path: "/app/exceptions/", label: "Needs attention", permission: "exception:read", group: "Operate", glyph: "attention", count: "exceptions", tone: "bad", key: "e" },
  { id: "customers", path: "/app/customers/", label: "Organizations", breadcrumb: "Customers", permission: "internal:organization_manage", entity: "organization", group: "Customers", glyph: "organizations", key: "c" },
  { id: "users", path: "/app/users/", label: "Users", permission: "user:read", group: "Customers", glyph: "users", key: "u" },
  { id: "leads", path: "/app/leads/", label: "Leads", permission: "internal:lead_read", group: "Customers", glyph: "leads", key: "l" },
  { id: "workflows", path: "/app/workflows/", label: "Workflows", permission: "workflow:read", entity: "workflow", group: "Build", glyph: "workflows", key: "w" },
  { id: "studio", path: "/app/studio/", label: "Workflow Studio", permission: "internal:workflow_author", group: "Build", glyph: "studio", key: "s" },
  { id: "connections", path: "/app/connections/", label: "Connections", permission: "connection:read", entity: "connection", group: "Build", glyph: "connections", count: "pendingConnections", tone: "waiting", key: "n" },
  { id: "agents", path: "/app/agents/", label: "Agents", permission: "agent:read", group: "Build", glyph: "agents", key: "b" },
  { id: "audit", path: "/app/audit/", label: "Audit & security", permission: "internal:audit_read_all", group: "Trust", glyph: "audit", key: "d" },
  { id: "support", path: "/app/support/", label: "Support", permission: "internal:support_manage", group: "Trust", glyph: "support", count: "openTickets", tone: "waiting", key: "t" },
  { id: "settings", path: "/app/settings/", label: "Settings", breadcrumb: "Platform", permission: "internal:platform_settings", group: "Platform", glyph: "settings", key: "p" },
];

/**
 * Legacy paths from the previous console, kept so existing bookmarks and links resolve (requirement
 * 1.11). `clients` became `customers`.
 */
export const STAFF_ROUTE_TABLE: RouteTable = {
  root: "/app/",
  routes: STAFF_ROUTES,
  aliases: { "/app/clients/": "customers" },
};

/** The section heading a route sits under, in table order. Navigation is derived, never re-listed. */
const GROUP_LABEL: Record<string, string> = {
  Operate: "Operate",
  Customers: "Customers",
  Build: "Build",
  Trust: "Trust",
  Platform: "Platform",
};

/* --------------------------------------------------- the derived records, unchanged in shape --- */

const derive = <T,>(pick: (route: RouteDef) => T): Record<Section, T> =>
  Object.fromEntries(STAFF_ROUTES.map((route) => [route.id, pick(route)])) as Record<Section, T>;

export const SECTION_PATH: Record<Section, string> = derive((route) => route.path);
export const SECTION_LABEL: Record<Section, string> = derive((route) => route.breadcrumb ?? route.label);

/** Sections that render a table of a single entity type and support drill-in. */
export const SECTION_ENTITY: Partial<Record<Section, string>> = Object.fromEntries(
  STAFF_ROUTES.filter((route) => route.entity).map((route) => [route.id, route.entity]),
) as Partial<Record<Section, string>>;

export function viewToPath(view: View): string {
  return toPath(STAFF_ROUTE_TABLE, { routeId: view.section, entityId: view.entityId, view: view.view, tab: view.tab });
}

export function pathToView(pathname: string, search = ""): View {
  const resolved = resolveView(STAFF_ROUTE_TABLE, pathname, search);
  const view: View = { section: (resolved.routeId || "overview") as Section };
  if (resolved.entityId) view.entityId = resolved.entityId;
  if (resolved.view) view.view = resolved.view;
  if (resolved.tab) view.tab = resolved.tab;
  return view;
}

export function sameView(a: View, b: View) {
  return a.section === b.section && a.entityId === b.entityId && a.view === b.view && a.tab === b.tab;
}

/* ------------------------------------------------------------------ navigation groups ----- */

export type NavItem = {
  section: Section;
  label: string;
  glyph: IconName;
  /** Sidebar badge source. */
  count?: "approvals" | "exceptions" | "live" | "openTickets" | "pendingConnections";
  tone?: "bad" | "waiting";
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = Object.values(GROUP_LABEL).map((label) => ({
  label,
  items: STAFF_ROUTES.filter((route) => route.group === label).map((route) => {
    const item: NavItem = { section: route.id as Section, label: route.label, glyph: route.glyph as IconName };
    if (route.count) item.count = route.count as NavItem["count"];
    if (route.tone) item.tone = route.tone;
    return item;
  }),
}));

/** `g` then a letter, Linear-style. Derived from the table's `key` column. */
export const GOTO_KEYS: Record<string, Section> = Object.fromEntries(
  STAFF_ROUTES.filter((route) => route.key).map((route) => [route.key as string, route.id as Section]),
) as Record<string, Section>;
