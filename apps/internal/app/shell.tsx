"use client";

// The internal console's shell. Same construction as the customer shell and for the same reason: the
// navigation is `navigation(INTERNAL_ROUTE_TABLE, principal)`, so a section cannot appear here that the
// control plane would refuse.
//
// The visible difference from the customer shell is deliberate anti-confusion (requirement 2.1): the
// staff console names itself in the corner and carries no organization branding, because a staff member
// looking at one customer's records must never be in doubt about which console they are in. That
// confusion is a real operational hazard -- it is how somebody makes a change in the wrong place.

import { useMemo, type ReactNode } from "react";
import { navigation, relativeTime, type NavGroup, type ResolvedView } from "@amazflow/domain-ui";
import type { Principal } from "@amazflow/permissions";
import { Icon, Pill, type IconName } from "@amazflow/ui";
import { INTERNAL_ROUTE_TABLE, internalRoute, type InternalRoute } from "./routes";

export function StaffShell({
  principal,
  view,
  navigate,
  lastLoadedAt,
  children,
}: {
  principal: Principal;
  view: ResolvedView;
  navigate: (view: ResolvedView) => void;
  lastLoadedAt: string | null;
  children: ReactNode;
}) {
  const groups: NavGroup[] = useMemo(() => navigation(INTERNAL_ROUTE_TABLE, principal), [principal]);
  const active = internalRoute(view.routeId);

  return (
    <div className="ops-shell">
      <aside className="ops-sidebar">
        <div className="ops-sidebar-brand">
          <span className="ops-brand-mark">AmazFlow Control</span>
          <Pill tone="ai" plain>
            staff
          </Pill>
        </div>
        <nav className="ops-nav" aria-label="Sections">
          {groups.map((group) => (
            <div className="ops-nav-group" key={group.label}>
              <div className="ops-nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const route = item.route as InternalRoute;
                return (
                  <button
                    key={route.id}
                    type="button"
                    className="ops-nav-item"
                    data-active={route.id === view.routeId ? "true" : undefined}
                    disabled={!item.enabled}
                    title={item.enabled ? undefined : item.disabledReason}
                    onClick={() => item.enabled && navigate({ routeId: route.id })}
                  >
                    <Icon name={(route.glyph ?? "overview") as IconName} />
                    <span>{route.label}</span>
                    {/* A section that exists but does nothing yet says so in the sidebar, so a staff
                        member does not click it expecting a feature. */}
                    {route.disabledReason && <span className="ops-nav-note">disabled</span>}
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
            <span className="ops-org-name">AmazFlow Control</span>
            {active && <span className="ops-crumb-sep">/</span>}
            {active && (
              <button type="button" className="ops-crumb" onClick={() => navigate({ routeId: active.id })}>
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
            {lastLoadedAt && <span className="ops-muted">Updated {relativeTime(lastLoadedAt)}</span>}
            <Pill tone="neutral" plain>
              {principal.userId}
            </Pill>
          </div>
        </header>
        <main className="ops-content">{children}</main>
      </div>
    </div>
  );
}
