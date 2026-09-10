"use client";

/**
 * AmazFlow Control — the internal operations console.
 *
 * This route is the AmazFlow Super Admin workspace. It is deliberately separate from the customer
 * console at /console, is never linked from the marketing site, and redirects anyone without the
 * SUPER_ADMIN role.
 *
 * This file is only the auth gate and the view switch. Everything else lives under ./ops:
 * the data layer (real control-plane reads), the shell, the command palette, and one module per
 * operational surface.
 */

import { useEffect, useState } from "react";
import { guardBFCacheRestore, type Session } from "../lib/cognito-auth";
import { enforceSessionAccess, staffSurface } from "../lib/session-gate";
import { CommandPalette } from "./ops/command-palette";
import { Copilot } from "./ops/copilot";
import { OpsDataProvider } from "./ops/data";
import { NavProvider, useNav } from "./ops/nav";
import { ToastProvider } from "./ops/primitives";
import { LoadErrors, Shell } from "./ops/shell";
import { AgentsView, ConnectionDetailView, ConnectionsView } from "./ops/views/connections";
import { AuditView } from "./ops/views/audit";
import { CustomersView, OrgDetailView } from "./ops/views/customers";
import { LeadsView } from "./ops/views/leads";
import { OverviewView } from "./ops/views/overview";
import { RunDetailView } from "./ops/views/run-detail";
import { RunsView } from "./ops/views/runs";
import { SettingsView } from "./ops/views/settings";
import { StudioView } from "./ops/views/studio";
import { SupportView } from "./ops/views/support";
import { UsersView } from "./ops/views/users";
import { WorkflowDetailView, WorkflowsView } from "./ops/views/workflows";
// ops.css is the console design system; workflow-builder.css styles the builder against the
// same tokens, so it themes with the console instead of against it.
import "./ops.css";
import "./workflow-builder.css";

export default function ControlConsole() {
  const [session, setSession] = useState<Session | null>();

  useEffect(() => guardBFCacheRestore(), []);

  useEffect(() => {
    enforceSessionAccess(staffSurface("/app/")).then((allowed) => {
      if (allowed) setSession(allowed);
    });
  }, []);

  // No data-theme on the boot screen: <html> already carries it, applied before first paint,
  // so this renders in the right theme without resolving it a second time here.
  if (!session) {
    return (
      <main className="ops">
        <div className="ops-boot">
          <div className="ops-boot-card">
            <span className="ops-logo" aria-hidden="true">
              A
            </span>
            <div className="ops-spinner" />
            <b>Opening AmazFlow Control</b>
            <p>Verifying your session.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <ToastProvider>
      <NavProvider>
        <OpsDataProvider session={session}>
          <Themed>
            <Shell>
              <div className="ops-page">
                <LoadErrors />
                <Router />
              </div>
            </Shell>
            <Copilot />
            <CommandPalette />
          </Themed>
        </OpsDataProvider>
      </NavProvider>
    </ToastProvider>
  );
}

/** Applies the theme from nav context to the console root. */
function Themed({ children }: { children: React.ReactNode }) {
  const nav = useNav();
  return (
    <main className="ops" data-theme={nav.theme}>
      {children}
    </main>
  );
}

/** Maps the current view to its surface. */
function Router() {
  const { view } = useNav();

  switch (view.section) {
    case "overview":
      return <OverviewView />;

    case "runs":
      return view.entityId ? <RunDetailView runId={view.entityId} /> : <RunsView mode="runs" />;
    case "approvals":
      return view.entityId ? <RunDetailView runId={view.entityId} /> : <RunsView mode="approvals" />;
    case "exceptions":
      return view.entityId ? (
        <RunDetailView runId={view.entityId} />
      ) : (
        <RunsView mode="exceptions" />
      );

    case "workflows":
      return view.entityId ? (
        <WorkflowDetailView workflowId={view.entityId} />
      ) : (
        <WorkflowsView />
      );
    case "studio":
      return <StudioView workflowId={view.entityId} />;

    case "customers":
      return view.entityId ? <OrgDetailView slug={view.entityId} /> : <CustomersView />;
    case "users":
      return <UsersView />;
    case "leads":
      return <LeadsView />;

    case "connections":
      return view.entityId ? (
        <ConnectionDetailView connectionId={view.entityId} />
      ) : (
        <ConnectionsView />
      );
    case "agents":
      return <AgentsView />;

    case "audit":
      return <AuditView />;
    case "support":
      return <SupportView ticketId={view.entityId} />;

    case "settings":
      return <SettingsView />;

    default:
      return <OverviewView />;
  }
}
