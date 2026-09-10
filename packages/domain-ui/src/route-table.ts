// The declarative route table and the navigation derived from it (tasks 9.5 and 9.12).
//
// `ops/router.ts` proved the shape: a flat section-plus-entity model, path mapping in one place,
// deep links resolved on a hard reload. What it did not have was a single table -- `SECTION_PATH`,
// `SECTION_LABEL`, `SECTION_ENTITY`, `NAV_GROUPS` and `GOTO_KEYS` were five parallel records keyed by
// the same union, so adding a section meant editing five places and a section could be reachable
// without appearing in navigation, or appear in navigation without a path.
//
// Here one `RouteDef` per route carries everything: its path, its label, whether it drills into an
// entity, which permission it needs, and where it sits in navigation. There is exactly one route
// table per surface and no inline path-to-view mapping alongside it (requirement 3.4).
//
// Navigation is then a FILTER of that table through the permissions policy (requirement 3.6/3.7), not
// a second list that has to be kept in agreement with it. That closes the gap that made the previous
// frontend's copy of the rules dangerous: a section can no longer be offered to someone the API will
// refuse, because the same `can()` decides both.

import { can, type Permission, type Principal } from "@amazflow/permissions";

export type RouteDef = {
  /** Stable identifier, used as the view discriminant. */
  id: string;
  /** Path relative to the surface root, always with a trailing slash to match the static export. */
  path: string;
  label: string;
  /** Permission required to see and use this route. `null` means everyone signed in. */
  permission: Permission | null;
  /** Set when the route drills into a single entity: `/runs/{id}/`. */
  entity?: string;
  /** Navigation group heading. Omit to keep the route reachable but out of navigation. */
  group?: string;
  glyph?: string;
  /** Badge source for the navigation item. */
  count?: string;
  tone?: "bad" | "waiting";
  /**
   * Requirement 3.8's exception. A section normally disappears when the principal cannot use it,
   * because offering a door that does not open is worse than not showing the door. But some
   * omissions are themselves confusing -- a person who has been told their organization has an audit
   * trail and finds no audit entry concludes the product is broken, not that they lack a permission.
   * When this is set the route is shown, disabled, with this text as the stated reason.
   */
  shownWhenDeniedBecause?: string;
  /**
   * The label a breadcrumb uses, when it differs from the navigation label. "Organizations" in the
   * sidebar is "Customers" in a trail, because a sidebar names the thing and a trail names the
   * section it lives in.
   */
  breadcrumb?: string;
  /** `keyboard shortcut` letter, for the `g`-then-letter jump. */
  key?: string;
};

export type RouteTable = {
  /** Surface root, e.g. `/` for the customer app or `/app/` for today's console. */
  root: string;
  routes: readonly RouteDef[];
  /**
   * Previous paths kept working (task 9.12 / requirement 1.11). No previously reachable route is
   * removed until its replacement is live and a deprecation window has elapsed, so every path the
   * old surfaces served resolves here to the route that replaced it.
   */
  aliases?: Readonly<Record<string, string>>;
};

export type ResolvedView = {
  routeId: string;
  entityId?: string;
  /** Saved-view or tab preselection, carried in the query string. */
  view?: string;
  tab?: string;
};

const withTrailingSlash = (path: string) => (path.endsWith("/") ? path : `${path}/`);

export function viewToPath(table: RouteTable, view: ResolvedView): string {
  const route = table.routes.find((r) => r.id === view.routeId);
  if (!route) return table.root;
  const base = withTrailingSlash(route.path);
  const path = view.entityId ? `${base}${encodeURIComponent(view.entityId)}/` : base;
  const params = new URLSearchParams();
  if (view.view) params.set("view", view.view);
  if (view.tab) params.set("tab", view.tab);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Resolve a path to a view.
 *
 * Longest prefix first, so the surface root never swallows a deeper route -- the bug this ordering
 * exists to prevent is `/` matching before `/runs/` and every deep link landing on the home view.
 */
export function pathToView(table: RouteTable, pathname: string, search = ""): ResolvedView {
  const params = new URLSearchParams(search);
  const extras: Pick<ResolvedView, "view" | "tab"> = {};
  const savedView = params.get("view");
  const tab = params.get("tab");
  if (savedView) extras.view = savedView;
  if (tab) extras.tab = tab;

  const normalized = withTrailingSlash(pathname);

  // Longest alias first, for the same reason the routes below are sorted that way: a short alias that
  // is a prefix of a longer one would otherwise swallow it, and `/console/` is a prefix of
  // `/console/runs/`. Getting this wrong sends every legacy deep link to the home view with the rest
  // of the path mistaken for an entity id -- which is precisely what the test caught.
  const aliases = Object.entries(table.aliases ?? {}).sort((a, b) => b[0].length - a[0].length);
  for (const [legacy, routeId] of aliases) {
    const alias = withTrailingSlash(legacy);
    if (normalized === alias) return { routeId, ...extras };
    if (normalized.startsWith(alias))
      return {
        routeId,
        entityId: decodeURIComponent(normalized.slice(alias.length).replace(/\/$/, "")),
        ...extras,
      };
  }

  const home = table.routes[0];
  const ordered = [...table.routes]
    .filter((route) => withTrailingSlash(route.path) !== withTrailingSlash(table.root))
    .sort((a, b) => b.path.length - a.path.length);

  for (const route of ordered) {
    const base = withTrailingSlash(route.path);
    if (normalized === base) return { routeId: route.id, ...extras };
    if (normalized.startsWith(base)) {
      const rest = normalized.slice(base.length).replace(/\/$/, "");
      if (rest && route.entity)
        return { routeId: route.id, entityId: decodeURIComponent(rest), ...extras };
      if (rest) return { routeId: route.id, ...extras };
    }
  }

  return { routeId: home ? home.id : "", ...extras };
}

export const sameView = (a: ResolvedView, b: ResolvedView) =>
  a.routeId === b.routeId && a.entityId === b.entityId && a.view === b.view && a.tab === b.tab;

/* ================================================================================ navigation = */

export type NavEntry = {
  route: RouteDef;
  /** False when the principal lacks the permission but requirement 3.8 says to show it anyway. */
  enabled: boolean;
  /** Present exactly when `enabled` is false. */
  disabledReason?: string;
};

export type NavGroup = { label: string; items: NavEntry[] };

/** Does this principal hold what the route needs, in their own organization? */
export function routeAllowed(principal: Principal, route: RouteDef): boolean {
  if (route.permission === null) return true;
  return can(principal, route.permission, { orgId: principal.orgId }).allow;
}

/**
 * Navigation, derived from the route table by filtering through the policy.
 *
 * A route the principal cannot use is omitted, which is the default because a visible door that
 * does not open reads as a broken product. The one exception is `shownWhenDeniedBecause`: some
 * omissions are more confusing than a disabled entry with a reason, and where that is true the
 * reason is stated rather than the entry silently vanishing (requirement 3.8).
 */
export function navigation(table: RouteTable, principal: Principal): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const route of table.routes) {
    if (!route.group) continue;
    const allowed = routeAllowed(principal, route);
    if (!allowed && !route.shownWhenDeniedBecause) continue;
    let group = groups.find((g) => g.label === route.group);
    if (!group) {
      group = { label: route.group, items: [] };
      groups.push(group);
    }
    group.items.push(
      allowed
        ? { route, enabled: true }
        : { route, enabled: false, disabledReason: route.shownWhenDeniedBecause },
    );
  }
  return groups;
}

/** Every route the principal may open, navigation entry or not. */
export function reachableRoutes(table: RouteTable, principal: Principal): RouteDef[] {
  return table.routes.filter((route) => routeAllowed(principal, route));
}

/** `g` then a letter, Linear-style, built from the table rather than a parallel record. */
export function gotoKeys(table: RouteTable): Record<string, string> {
  const out: Record<string, string> = {};
  for (const route of table.routes) if (route.key) out[route.key] = route.id;
  return out;
}
