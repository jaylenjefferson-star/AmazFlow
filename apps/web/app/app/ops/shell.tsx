"use client";

/**
 * The AmazFlow Control shell: persistent sidebar, command/search topbar, breadcrumbs,
 * keyboard navigation, and the identity menu.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { signOut as authSignOut } from "../../lib/cognito-auth";
import { Icon, modifierKeyLabel } from "./icons";
import { useOps } from "./data";
import { useNav } from "./nav";
import { IconBtn, Kbd, Pill } from "./primitives";
import { GOTO_KEYS, NAV_GROUPS, SECTION_LABEL, SECTION_PATH, type Section } from "./router";
import { ROLE_SHORT, collectionLabel, dataBoundaryLabel, relativeTime } from "./terms";

export function Shell({ children }: { children: ReactNode }) {
  const ops = useOps();
  const nav = useNav();
  const [mobileNav, setMobileNav] = useState(false);
  const [modifier, setModifier] = useState("Ctrl");

  useEffect(() => setModifier(modifierKeyLabel()), []);

  const counts: Record<string, { value: number; tone?: "bad" | "waiting" }> = {
    approvals: { value: ops.approvals.length + ops.confirmations.length, tone: "waiting" },
    exceptions: { value: ops.exceptions.length, tone: "bad" },
    live: { value: ops.liveRuns.length },
    openTickets: {
      value: ops.tickets.filter((ticket) => ticket.status === "open" || ticket.status === "in_progress")
        .length,
      tone: "waiting",
    },
    pendingConnections: {
      value: ops.connections.filter((connection) => connection.status === "pending").length,
      tone: "waiting",
    },
  };

  // Global keyboard model: ⌘K / ctrl-K opens the palette, "/" focuses search, "g" then a letter
  // jumps to a section, "?" is reserved for shortcuts help. Never fires while typing.
  useEffect(() => {
    let awaitingGoto = false;
    let gotoTimer: number | undefined;

    const isTyping = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        nav.setPaletteOpen(true);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;

      if (awaitingGoto) {
        const section = GOTO_KEYS[event.key.toLowerCase()];
        awaitingGoto = false;
        if (gotoTimer) window.clearTimeout(gotoTimer);
        if (section) {
          event.preventDefault();
          nav.goSection(section);
        }
        return;
      }

      if (event.key === "g") {
        awaitingGoto = true;
        gotoTimer = window.setTimeout(() => {
          awaitingGoto = false;
        }, 1400);
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        nav.setPaletteOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (gotoTimer) window.clearTimeout(gotoTimer);
    };
  }, [nav]);

  useEffect(() => {
    setMobileNav(false);
  }, [nav.view.section, nav.view.entityId]);

  return (
    <div className="ops-shell" data-mobilenav={mobileNav ? "open" : undefined}>
      <aside className="ops-sidebar">
        <div className="ops-sidebar-head">
          <span className="ops-logo" aria-hidden="true">
            A
          </span>
          <span className="ops-wordmark">
            <b>AmazFlow</b>
            <span>Control</span>
          </span>
        </div>

        <nav className="ops-sidebar-scroll" aria-label="Sections">
          {NAV_GROUPS.map((group) => (
            <div className="ops-navgroup" key={group.label}>
              <div className="ops-navgroup-label">{group.label}</div>
              {group.items.map((item) => {
                const badge = item.count ? counts[item.count] : undefined;
                const current = nav.view.section === item.section;
                return (
                  <a
                    className="ops-navitem"
                    key={item.section}
                    href={SECTION_PATH[item.section]}
                    aria-current={current ? "page" : undefined}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                      event.preventDefault();
                      nav.goSection(item.section);
                    }}
                  >
                    <span className="ops-navitem-glyph" aria-hidden="true">
                      <Icon name={item.glyph} size={14} />
                    </span>
                    <span className="ops-navitem-label">{item.label}</span>
                    {badge && badge.value > 0 && (
                      <span className="ops-navitem-count" data-tone={item.tone}>
                        {badge.value}
                      </span>
                    )}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="ops-sidebar-foot">
          <div className="ops-boundary" title="Data boundary enforced by the control plane">
            <span
              className="ops-boundary-dot"
              data-tone={ops.settings?.dataBoundary?.startsWith("production") ? undefined : "waiting"}
            />
            <span>
              {dataBoundaryLabel(ops.settings?.dataBoundary ?? ops.health?.boundary)}
              <br />
              {ops.settings?.aiRuntimeLabel ?? "AmazFlow managed AI"}
            </span>
          </div>
        </div>
      </aside>

      <div className="ops-main">
        <header className="ops-topbar">
          <button
            className="ops-iconbtn ops-mobilenav-toggle"
            aria-label="Menu"
            onClick={() => setMobileNav((open) => !open)}
          >
            <Icon name="menu" size={15} />
          </button>

          <Breadcrumbs />

          <button className="ops-searchbtn" onClick={() => nav.setPaletteOpen(true)}>
            <Icon name="search" size={13} />
            <span>Search or jump to…</span>
            <Kbd>{modifier}</Kbd>
            <Kbd>K</Kbd>
          </button>

          <div className="ops-topbar-actions">
            <button
              className="ops-live"
              data-state={ops.live ? "on" : "off"}
              onClick={() => ops.setLive(!ops.live)}
              title={
                ops.live
                  ? "Live updates on — runs refresh every 15 seconds. Click to pause."
                  : "Live updates paused. Click to resume."
              }
            >
              <span className="ops-live-dot" />
              {ops.live ? "Live" : "Paused"}
            </button>
            <IconBtn
              glyph="refresh"
              label={
                ops.lastLoadedAt ? `Refresh — last updated ${relativeTime(ops.lastLoadedAt)}` : "Refresh"
              }
              onClick={() => ops.refresh()}
            />
            <IconBtn
              glyph={nav.theme === "dark" ? "sun" : "moon"}
              label={nav.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={nav.toggleTheme}
            />
            <IdentityMenu />
          </div>
        </header>

        {children}
      </div>

      {mobileNav && <div className="ops-scrim" onClick={() => setMobileNav(false)} />}
    </div>
  );
}

/* =========================================================================== breadcrumbs = */

function Breadcrumbs() {
  const nav = useNav();
  const { view, detailLabel } = nav;

  const trail: { label: string; section?: Section }[] = [];

  if (view.section === "overview") {
    trail.push({ label: "Overview" });
  } else {
    trail.push({ label: SECTION_LABEL[view.section], section: view.entityId ? view.section : undefined });
    if (view.entityId) {
      trail.push({ label: detailLabel ?? view.entityId });
    }
  }

  return (
    <nav className="ops-crumbs" aria-label="Breadcrumb">
      {trail.map((crumb, index) => {
        const last = index === trail.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="ops-row ops-gap-sm">
            {index > 0 && (
              <span className="ops-crumb-sep" aria-hidden="true">
                /
              </span>
            )}
            {last || !crumb.section ? (
              <span className="ops-crumb" aria-current={last ? "page" : undefined}>
                {crumb.label}
              </span>
            ) : (
              <button className="ops-crumb" onClick={() => nav.goSection(crumb.section as Section)}>
                {crumb.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/* ========================================================================= identity menu = */

function IdentityMenu() {
  const ops = useOps();
  const nav = useNav();
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

  const initials = ops.session.email.slice(0, 2).toUpperCase();

  return (
    <div className="ops-identity" ref={ref}>
      <button
        className="ops-avatar"
        onClick={() => setOpen((value) => !value)}
        aria-label="Account"
        aria-expanded={open}
      >
        {initials}
      </button>
      {open && (
        <div className="ops-identity-menu" role="menu">
          <div className="ops-identity-head">
            <b>{ops.session.email}</b>
            <span>
              {ROLE_SHORT[ops.session.role] ?? ops.session.role} · {ops.session.tenantId}
            </span>
          </div>
          <button
            className="ops-menuitem"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              nav.goSection("settings");
            }}
          >
            <span className="ops-menuitem-glyph"><Icon name="settings" size={13} /></span> Platform settings
          </button>
          <button
            className="ops-menuitem"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              nav.toggleTheme();
            }}
          >
            <span className="ops-menuitem-glyph">
              <Icon name={nav.theme === "dark" ? "sun" : "moon"} size={13} />
            </span>
            {nav.theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          {/* Staff change their own password on the same self-service page customers use -- there
              is one account-security surface, not a staff copy of it. */}
          <a className="ops-menuitem" role="menuitem" href="/console/account/">
            <span className="ops-menuitem-glyph"><Icon name="settings" size={13} /></span> Your account
          </a>
          <a className="ops-menuitem" role="menuitem" href="/console/">
            <span className="ops-menuitem-glyph"><Icon name="console" size={13} /></span> Open customer console
          </a>
          <a className="ops-menuitem" role="menuitem" href="/">
            <span className="ops-menuitem-glyph"><Icon name="external" size={13} /></span> Marketing site
          </a>
          <button
            className="ops-menuitem"
            role="menuitem"
            data-tone="bad"
            onClick={() => authSignOut(ops.session)}
          >
            <span className="ops-menuitem-glyph"><Icon name="power" size={13} /></span> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ============================================================================== page head = */

// Promoted into `@amazflow/ui` so the customer surface renders the same header rather than a second
// one with class names nothing styles. Re-exported here so every `/app` view keeps importing
// `PageHead` from `./shell` unchanged (task 9.1's shim pattern; task 28.4 retires it).
export { PageHead } from "./primitives";

/** Banner shown when a collection failed to load, so a dead endpoint is visible not silent. */
export function LoadErrors() {
  const ops = useOps();
  const entries = Object.entries(ops.errors);
  if (entries.length === 0) return null;
  return (
    <div className="ops-col" style={{ marginBottom: 14 }}>
      {entries.map(([key, message]) => (
        <div className="ops-alert" data-tone="bad" key={key}>
          <span className="ops-alert-glyph">
            <Icon name="warning" size={13} />
          </span>
          <div className="ops-alert-body">
            <b>Couldn&apos;t load {collectionLabel(key)}</b> — {message}
            <div className="ops-alert-actions">
              <button className="ops-btn" data-size="sm" onClick={() => ops.refresh()}>
                Retry
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Unmapped({ tenantId }: { tenantId: string }) {
  return (
    <Pill tone="waiting" title="This tenant has records but no organization row">
      Unmapped tenant {tenantId}
    </Pill>
  );
}
