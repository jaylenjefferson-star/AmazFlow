/**
 * AmazFlow Control routing.
 *
 * The console is a static export, so navigation is pushState over a flat section + entity
 * model (an Amplify rewrite maps /app/<*> back to /app/index.html so deep links survive a hard
 * reload). Every operational object is addressable, which is what makes the command palette
 * and cross-entity links work.
 */

import type { IconName } from "./icons";

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

export const SECTION_PATH: Record<Section, string> = {
  overview: "/app/",
  runs: "/app/runs/",
  approvals: "/app/approvals/",
  exceptions: "/app/exceptions/",
  workflows: "/app/workflows/",
  studio: "/app/studio/",
  customers: "/app/customers/",
  users: "/app/users/",
  connections: "/app/connections/",
  agents: "/app/agents/",
  audit: "/app/audit/",
  support: "/app/support/",
  leads: "/app/leads/",
  settings: "/app/settings/",
};

export const SECTION_LABEL: Record<Section, string> = {
  overview: "Overview",
  runs: "Runs",
  approvals: "Approvals",
  exceptions: "Needs attention",
  workflows: "Workflows",
  studio: "Workflow Studio",
  customers: "Customers",
  users: "Users",
  connections: "Connections",
  agents: "Chrome Agents",
  audit: "Audit & security",
  support: "Support",
  leads: "Leads",
  settings: "Platform",
};

/** Sections that render a table of a single entity type and support drill-in. */
export const SECTION_ENTITY: Partial<Record<Section, string>> = {
  runs: "run",
  workflows: "workflow",
  customers: "organization",
  connections: "connection",
};

/**
 * Legacy paths from the previous console, kept so existing bookmarks and links resolve.
 * `clients` became `customers`; `audit & policy` kept its path.
 */
const LEGACY_PREFIX: Record<string, Section> = {
  "/app/clients/": "customers",
};

export function viewToPath(view: View): string {
  const base = SECTION_PATH[view.section];
  const path = view.entityId ? `${base}${encodeURIComponent(view.entityId)}/` : base;
  const params = new URLSearchParams();
  if (view.view) params.set("view", view.view);
  if (view.tab) params.set("tab", view.tab);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function pathToView(pathname: string, search = ""): View {
  const params = new URLSearchParams(search);
  const extras: Pick<View, "view" | "tab"> = {};
  const savedView = params.get("view");
  const tab = params.get("tab");
  if (savedView) extras.view = savedView;
  if (tab) extras.tab = tab;

  const normalized = pathname.endsWith("/") ? pathname : `${pathname}/`;

  for (const [legacy, section] of Object.entries(LEGACY_PREFIX)) {
    if (normalized === legacy) return { section, ...extras };
    if (normalized.startsWith(legacy)) {
      return {
        section,
        entityId: decodeURIComponent(normalized.slice(legacy.length).replace(/\/$/, "")),
        ...extras,
      };
    }
  }

  // Longest prefix first so /app/ (the overview) never swallows a deeper section.
  const entries = (Object.entries(SECTION_PATH) as [Section, string][])
    .filter(([section]) => section !== "overview")
    .sort((a, b) => b[1].length - a[1].length);

  for (const [section, base] of entries) {
    if (normalized === base) return { section, ...extras };
    if (normalized.startsWith(base)) {
      const rest = normalized.slice(base.length).replace(/\/$/, "");
      if (rest) return { section, entityId: decodeURIComponent(rest), ...extras };
    }
  }

  return { section: "overview", ...extras };
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

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operate",
    items: [
      { section: "overview", label: "Overview", glyph: "overview" },
      { section: "runs", label: "Runs", glyph: "runs", count: "live" },
      { section: "approvals", label: "Approvals", glyph: "approvals", count: "approvals", tone: "waiting" },
      { section: "exceptions", label: "Needs attention", glyph: "attention", count: "exceptions", tone: "bad" },
    ],
  },
  {
    label: "Customers",
    items: [
      { section: "customers", label: "Organizations", glyph: "organizations" },
      { section: "users", label: "Users", glyph: "users" },
      { section: "leads", label: "Leads", glyph: "leads" },
    ],
  },
  {
    label: "Build",
    items: [
      { section: "workflows", label: "Workflows", glyph: "workflows" },
      { section: "studio", label: "Workflow Studio", glyph: "studio" },
      { section: "connections", label: "Connections", glyph: "connections", count: "pendingConnections", tone: "waiting" },
      { section: "agents", label: "Chrome Agents", glyph: "agents" },
    ],
  },
  {
    label: "Trust",
    items: [
      { section: "audit", label: "Audit & security", glyph: "audit" },
      { section: "support", label: "Support", glyph: "support", count: "openTickets", tone: "waiting" },
    ],
  },
  {
    label: "Platform",
    items: [{ section: "settings", label: "Settings", glyph: "settings" }],
  },
];

/** `g` then a letter, Linear-style. */
export const GOTO_KEYS: Record<string, Section> = {
  o: "overview",
  r: "runs",
  a: "approvals",
  e: "exceptions",
  w: "workflows",
  s: "studio",
  c: "customers",
  u: "users",
  n: "connections",
  b: "agents",
  d: "audit",
  t: "support",
  l: "leads",
  p: "settings",
};
