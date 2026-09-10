"use client";

// The customer application shell (task 9.6).
//
// One shell for the whole customer surface: organization display name, breadcrumbs, a notification
// indicator, and a user menu. Requirement 3.9. The layout is usable from 1024 pixels up
// (requirement 3.10) — a single stylesheet variable governs the sidebar, and below that width the
// sidebar collapses to its glyph rail rather than the page reflowing into something unusable.
//
// The shell renders NAVIGATION FROM THE POLICY, not from a list of its own. That is the whole point
// of task 9.5's route table: the sidebar you see is `navigation(CUSTOMER_ROUTE_TABLE, principal)`, so
// there is no arrangement in which a section appears here and the control plane refuses it.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  navigation,
  relativeTime,
  type NavGroup,
  type ResolvedView,
} from "@amazflow/domain-ui";
import type { Principal } from "@amazflow/permissions";
import { Icon, Pill, type IconName } from "@amazflow/ui";
import { CUSTOMER_ROUTE_TABLE, customerRoute, type CustomerRoute } from "./routes";

export type ShellProps = {
  principal: Principal;
  /** The organization's display name, from its branding record. Falls back to its identifier. */
  organizationName: string;
  view: ResolvedView;
  navigate: (view: ResolvedView) => void;
  /** Unread notification count. `null` while it has not loaded — never rendered as a zero. */
  unread: number | null;
  lastLoadedAt: string | null;
  signOut: () => void;
  children: ReactNode;
};

export function Shell({
  principal,
  organizationName,
  view,
  navigate,
  unread,
  lastLoadedAt,
  signOut,
  children,
}: ShellProps) {
  const groups: NavGroup[] = useMemo(() => navigation(CUSTOMER_ROUTE_TABLE, principal), [principal]);
  const active = customerRoute(view.routeId);
  const [menuOpen, setMenuOpen] = useState(false);

  const go = useCallback(
    (routeId: string) => {
      setMenuOpen(false);
      navigate({ routeId });
    },
    [navigate],
  );

  return (
    <div className="ops-shell">
      <aside className="ops-sidebar">
        <div className="ops-sidebar-brand">
          <span className="ops-brand-mark">AmazFlow</span>
        </div>
        <nav className="ops-nav" aria-label="Sections">
          {groups.map((group) => (
            <div className="ops-nav-group" key={group.label}>
              <div className="ops-nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const route = item.route as CustomerRoute;
                const current = route.id === view.routeId;
                return (
                  <button
                    key={route.id}
                    type="button"
                    className="ops-nav-item"
                    data-active={current ? "true" : undefined}
                    // A section the principal cannot use is normally absent. When it is present it is
                    // present BECAUSE omission would mislead, so it must not be clickable — offering a
                    // door that does not open is the thing being avoided, not reproduced.
                    disabled={!item.enabled}
                    title={item.enabled ? undefined : item.disabledReason}
                    aria-current={current ? "page" : undefined}
                    onClick={() => item.enabled && go(route.id)}
                  >
                    <Icon name={(route.glyph ?? "overview") as IconName} />
                    <span>{route.label}</span>
                    {!item.enabled && <span className="ops-nav-note">restricted</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="ops-main">
        <header className="ops-topbar">
          <div className="ops-breadcrumbs" aria-label="Breadcrumb">
            <span className="ops-org-name">{organizationName}</span>
            {active && <span className="ops-crumb-sep">/</span>}
            {active && (
              <button type="button" className="ops-crumb" onClick={() => go(active.id)}>
                {active.breadcrumb ?? active.label}
              </button>
            )}
            {view.entityId && (
              <>
                <span className="ops-crumb-sep">/</span>
                <span className="ops-crumb-current">{view.entityId}</span>
              </>
            )}
          </div>

          <div className="ops-topbar-right">
            {/* The count is only rendered once it is known. An unloaded count shown as 0 is a claim
                that there is nothing waiting, which is a different statement from "not known yet". */}
            <button
              type="button"
              className="ops-icon-button"
              aria-label={unread === null ? "Notifications" : `Notifications: ${unread} unread`}
              onClick={() => navigate({ routeId: "notifications" })}
            >
              <Icon name="attention" />
              {unread !== null && unread > 0 && <span className="ops-badge">{unread}</span>}
            </button>

            {lastLoadedAt && <span className="ops-muted">Updated {relativeTime(lastLoadedAt)}</span>}

            <div className="ops-user-menu">
              <button
                type="button"
                className="ops-user-button"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <span>{principal.userId}</span>
                <Pill tone="neutral" plain>
                  {principal.role}
                </Pill>
              </button>
              {menuOpen && (
                <div className="ops-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => go("settings-profile")}>
                    Your profile
                  </button>
                  <button type="button" role="menuitem" onClick={() => go("settings-security")}>
                    Your security
                  </button>
                  <button type="button" role="menuitem" onClick={() => go("support")}>
                    Support
                  </button>
                  <button type="button" role="menuitem" onClick={signOut}>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="ops-content">{children}</main>
      </div>
    </div>
  );
}

/**
 * The body of an intentionally disabled section (requirement 30.3/30.4).
 *
 * It states what does not exist and why, and it renders NO control. That last part is the whole
 * discipline: a disabled section with a greyed-out form still tells a person the feature is nearly
 * here and their input nearly counts, which is the impression the `plan` field (H-3) left for months.
 */
export function DisabledSection({ route, children }: { route: CustomerRoute; children?: ReactNode }) {
  return (
    <section className="ops-panel" aria-labelledby={`disabled-${route.id}`}>
      <h1 id={`disabled-${route.id}`} className="ops-panel-title">
        {route.label}
      </h1>
      <Pill tone="muted">Not available in this release</Pill>
      <p className="ops-panel-lead">{route.disabledReason}</p>
      {route.disabledDetail && <p className="ops-muted">{route.disabledDetail}</p>}
      {children}
    </section>
  );
}

/** Used by the shell's own effects; exported so a route module can reuse the same title discipline. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    if (typeof document !== "undefined") document.title = `${title} · AmazFlow`;
  }, [title]);
}
