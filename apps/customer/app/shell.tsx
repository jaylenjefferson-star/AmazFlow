"use client";

// The customer application shell (task 9.6), carrying the Phase 4 notification indicator (task 12.3).
//
// One shell for the whole customer surface: organization display name, breadcrumbs, a notification
// indicator, and a user menu. Requirement 3.9. The layout is usable from 1024 pixels up
// (requirement 3.10) — the sidebar width is a stylesheet variable and below that width the sidebar
// becomes an overlay rather than the page reflowing into something unusable.
//
// The shell renders NAVIGATION FROM THE POLICY, not from a list of its own. That is the whole point
// of task 9.5's route table: the sidebar you see is `navigation(CUSTOMER_ROUTE_TABLE, principal)`, so
// there is no arrangement in which a section appears here and the control plane refuses it.
//
// Every class name here comes from the shared stylesheet in `@amazflow/ui`. That is not a detail: the
// first draft of this shell invented `ops-nav-item`, `ops-topbar-right`, `ops-user-menu` and sixteen
// more names that no rule matched, so the customer surface rendered as an unstyled column of buttons
// while the build reported success. Task 9.1 names this coupling explicitly — a surface renders
// unstyled markup rather than failing — which means agreeing with the stylesheet is a thing to
// assert, and `shell.test.tsx` now does.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  PLATFORM_ROLE_LABEL,
  navigation,
  relativeTime,
  type NavGroup,
  type ResolvedView,
} from "@amazflow/domain-ui";
import type { Principal } from "@amazflow/permissions";
import { Icon, IconBtn, Pill, type IconName } from "@amazflow/ui";
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
  /** Re-read every resource. The topbar's refresh control, so a person is never stuck on stale data. */
  refresh?: () => void;
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
  refresh,
  signOut,
  children,
}: ShellProps) {
  const groups: NavGroup[] = useMemo(() => navigation(CUSTOMER_ROUTE_TABLE, principal), [principal]);
  const active = customerRoute(view.routeId);
  const [mobileNav, setMobileNav] = useState(false);

  const go = useCallback(
    (routeId: string) => {
      setMobileNav(false);
      navigate({ routeId });
    },
    [navigate],
  );

  useEffect(() => {
    setMobileNav(false);
  }, [view.routeId, view.entityId]);

  return (
    <div className="ops-shell" data-mobilenav={mobileNav ? "open" : undefined}>
      <aside className="ops-sidebar">
        <div className="ops-sidebar-head">
          <span className="ops-logo" aria-hidden="true">
            <img src="/brand/amazflow-icon.png" alt="" />
          </span>
          <span className="ops-wordmark">
            <b>AmazFlow</b>
            <span>{organizationName}</span>
          </span>
        </div>

        <nav className="ops-sidebar-scroll" aria-label="Sections">
          {groups.map((group) => (
            <div className="ops-navgroup" key={group.label}>
              <div className="ops-navgroup-label">{group.label}</div>
              {group.items.map((item) => {
                const route = item.route as CustomerRoute;
                const current = route.id === view.routeId;
                return (
                  <button
                    key={route.id}
                    type="button"
                    className="ops-navitem"
                    // A section the principal cannot use is normally absent. When it is present it is
                    // present BECAUSE omission would mislead, so it must not be clickable — offering a
                    // door that does not open is the thing being avoided, not reproduced.
                    disabled={!item.enabled}
                    title={item.enabled ? undefined : item.disabledReason}
                    aria-current={current ? "page" : undefined}
                    onClick={() => item.enabled && go(route.id)}
                  >
                    <span className="ops-navitem-glyph" aria-hidden="true">
                      <Icon name={(route.glyph ?? "overview") as IconName} size={14} />
                    </span>
                    <span className="ops-navitem-label">{route.label}</span>
                    {!item.enabled && <span className="ops-small ops-muted">restricted</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="ops-main">
        <header className="ops-topbar">
          <button
            type="button"
            className="ops-iconbtn ops-mobilenav-toggle"
            aria-label="Menu"
            onClick={() => setMobileNav((open) => !open)}
          >
            <Icon name="menu" size={15} />
          </button>

          <nav className="ops-crumbs" aria-label="Breadcrumb">
            <span className="ops-crumb ops-strong">{organizationName}</span>
            {active && (
              <>
                <span className="ops-crumb-sep" aria-hidden="true">
                  /
                </span>
                {view.entityId ? (
                  <button type="button" className="ops-crumb" onClick={() => go(active.id)}>
                    {active.breadcrumb ?? active.label}
                  </button>
                ) : (
                  <span className="ops-crumb" aria-current="page">
                    {active.breadcrumb ?? active.label}
                  </span>
                )}
              </>
            )}
            {view.entityId && (
              <>
                <span className="ops-crumb-sep" aria-hidden="true">
                  /
                </span>
                <span className="ops-crumb" aria-current="page">
                  {view.entityId}
                </span>
              </>
            )}
          </nav>

          <div className="ops-topbar-actions">
            {/* Task 12.3's indicator. The count is only rendered once it is known: an unloaded count
                shown as 0 is a claim that nothing is waiting, which is a different statement from
                "not known yet". */}
            <button
              type="button"
              className="ops-iconbtn"
              aria-label={unread === null ? "Notifications" : `Notifications: ${unread} unread`}
              title={unread === null ? "Notifications" : `${unread} unread`}
              onClick={() => navigate({ routeId: "notifications" })}
            >
              <Icon name="attention" size={15} />
            </button>
            {unread !== null && unread > 0 && (
              <Pill tone="waiting" title={`${unread} unread notifications`}>
                {unread}
              </Pill>
            )}

            {refresh && (
              <IconBtn
                glyph="refresh"
                label={lastLoadedAt ? `Refresh — last updated ${relativeTime(lastLoadedAt)}` : "Refresh"}
                onClick={refresh}
              />
            )}

            <IdentityMenu principal={principal} go={go} signOut={signOut} />
          </div>
        </header>

        <div className="ops-page">{children}</div>
      </div>

      {mobileNav && <div className="ops-scrim" onClick={() => setMobileNav(false)} />}
    </div>
  );
}

function IdentityMenu({
  principal,
  go,
  signOut,
}: {
  principal: Principal;
  go: (routeId: string) => void;
  signOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = (routeId: string, label: string, glyph: IconName) => (
    <button
      type="button"
      className="ops-menuitem"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        go(routeId);
      }}
    >
      <span className="ops-menuitem-glyph">
        <Icon name={glyph} size={13} />
      </span>
      {label}
    </button>
  );

  return (
    <div className="ops-identity" ref={ref}>
      <button
        type="button"
        className="ops-avatar"
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {principal.userId.slice(0, 2).toUpperCase()}
      </button>
      {open && (
        <div className="ops-identity-menu" role="menu">
          <div className="ops-identity-head">
            <b>{principal.userId}</b>
            {/* The role LABEL, not the stored key. "ORG_ADMIN" is a database value; a person reading
                their own account wants the words the roles page uses for the same thing. */}
            <span>
              {PLATFORM_ROLE_LABEL[principal.role] ?? principal.role} · {principal.orgId}
            </span>
          </div>
          {item("settings-profile", "Your profile", "users")}
          {item("settings-security", "Your security", "audit")}
          {item("settings-notifications", "Notification preferences", "attention")}
          {item("support", "Support", "support")}
          <button
            type="button"
            className="ops-menuitem"
            role="menuitem"
            data-tone="bad"
            onClick={signOut}
          >
            <span className="ops-menuitem-glyph">
              <Icon name="power" size={13} />
            </span>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The body of an intentionally disabled section (requirement 30.3/30.4).
 *
 * It states what does not exist and why, and it renders NO control that accepts input. That last part
 * is the whole discipline: a disabled section with a greyed-out form still tells a person the feature
 * is nearly here and their input nearly counts, which is the impression the `plan` field (H-3) left
 * for months.
 */
export function DisabledSection({ route, children }: { route: CustomerRoute; children?: ReactNode }) {
  return (
    <section aria-labelledby={`disabled-${route.id}`}>
      <div className="ops-pagehead">
        <div className="ops-pagehead-text">
          <div className="ops-pagetitle">
            <h1 id={`disabled-${route.id}`}>{route.label}</h1>
            <Pill tone="muted">Not available in this release</Pill>
          </div>
          <p className="ops-pagesub">{route.disabledReason}</p>
        </div>
      </div>
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
