"use client";

/**
 * The customer application — one cohesive surface at `app.amazflow.com`.
 *
 * This replaces the three-screen `/console`, which stays live and functional until task 28.4 (Risk
 * R-12: three apps replacing two is a big-bang cutover, so the cutover is a redirect after a
 * deprecation window rather than a deletion now).
 *
 * The file is the gate, the route dispatch, and the data wiring. Everything else is elsewhere: the
 * route table in `routes.ts`, the shell in `shell.tsx`, the route modules in `views.tsx`, the polling
 * discipline in `@amazflow/domain-ui`, and every authorization decision in `@amazflow/permissions`.
 *
 * Because this is a static export, routing is pushState over the one route table, and a committed
 * rewrite rule (`infrastructure/hosting/app.amazflow.com.json`, task 9.9) serves the shell for any
 * deep link so a hard reload resolves rather than 404ing.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  pathToView,
  useResources,
  viewToPath,
  type ResolvedView,
  type ResourceSlot,
  type ResourceSpec,
} from "@amazflow/domain-ui";
import { PrincipalError, type Principal } from "@amazflow/permissions";
import { ToastProvider } from "@amazflow/ui";
import { CUSTOMER_ROUTE_TABLE } from "./routes";
import { Shell } from "./shell";
import {
  AgentsView,
  AnalyticsView,
  ApprovalsView,
  BillingView,
  ConnectionsView,
  ExceptionsView,
  HomeView,
  NotFoundView,
  Resource,
  RolesView,
  RunsView,
  TasksView,
  WorkflowsView,
  type ViewProps,
} from "./views";
import {
  clientFor,
  principalOf,
  readStoredSession,
  toLogin,
  type StoredSession,
} from "./session";
import "@amazflow/ui/ops.css";

/**
 * What this surface reads, and which permission each read needs.
 *
 * The permission is not a security control — the control plane is. It is what stops the surface asking
 * for something it will be refused and then showing the person a 403 they cannot act on. A resource
 * whose permission the role lacks reports `unavailable`, which the views render as "not available to
 * your role" rather than as an error.
 */
const RESOURCES = [
  { key: "me", path: "/me", permission: null, empty: null },
  { key: "workflows", path: "/workflows", permission: "workflow:read", empty: [] },
  { key: "runs", path: "/runs", permission: "run:read", live: true, empty: [] },
  { key: "agentTasks", path: "/agent-tasks", permission: "task:read", live: true, empty: [] },
  { key: "agents", path: "/agents", permission: "agent:read", empty: [] },
  { key: "connections", path: "/connections/browser", permission: "connection:read", empty: [] },
  { key: "notifications", path: "/notifications", permission: "notification:read", live: true, empty: [] },
  { key: "permissionMatrix", path: "/permissions/matrix", permission: null, empty: null },
] as const satisfies readonly ResourceSpec<unknown>[];

export default function CustomerApp() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [gate, setGate] = useState<"checking" | "ready" | "no-organization">("checking");
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [view, setView] = useState<ResolvedView>({ routeId: "home" });

  // The gate. One place decides whether the person in front of this surface may be here, which is the
  // arrangement Phase 1 established after four copies of this effect had already drifted.
  useEffect(() => {
    const stored = readStoredSession();
    const here = `${window.location.pathname}${window.location.search}`;
    if (!stored) {
      toLogin(here, false);
      return;
    }
    if (stored.expiresAt && stored.expiresAt < Date.now() && !stored.refreshToken) {
      toLogin(here, true);
      return;
    }
    try {
      setPrincipal(principalOf(stored.idToken));
      setSession(stored);
      setGate("ready");
    } catch (error) {
      // An account with no organization claim is a real state with a real explanation, and it must not
      // be defaulted to any organization (requirement 4.7).
      if (error instanceof PrincipalError) setGate("no-organization");
      else toLogin(here, false);
    }
  }, []);

  // Route resolution from the URL, both on load and on back/forward. The route table is the only
  // path-to-view mapping on this surface.
  useEffect(() => {
    const resolve = () =>
      setView(pathToView(CUSTOMER_ROUTE_TABLE, window.location.pathname, window.location.search));
    resolve();
    window.addEventListener("popstate", resolve);
    return () => window.removeEventListener("popstate", resolve);
  }, []);

  const navigate = useCallback((next: ResolvedView) => {
    window.history.pushState({}, "", viewToPath(CUSTOMER_ROUTE_TABLE, next));
    setView(next);
    window.scrollTo({ top: 0 });
  }, []);

  if (gate === "no-organization") return <NoOrganization />;
  if (gate !== "ready" || !session || !principal) return <Booting />;

  return (
    <ToastProvider>
      <SignedIn session={session} principal={principal} view={view} navigate={navigate} onRenewed={setSession} />
    </ToastProvider>
  );
}

function SignedIn({
  session,
  principal,
  view,
  navigate,
  onRenewed,
}: {
  session: StoredSession;
  principal: Principal;
  view: ResolvedView;
  navigate: (view: ResolvedView) => void;
  onRenewed: (session: StoredSession) => void;
}) {
  const client = useMemo(() => clientFor(session, onRenewed), [session.idToken, onRenewed]);
  const resources = useResources(client, principal, RESOURCES as readonly ResourceSpec<unknown>[]);

  const slots = useMemo(() => {
    const out: Record<string, ResourceSlot<unknown>> = {};
    for (const spec of RESOURCES) out[spec.key] = resources.read(spec as ResourceSpec<unknown>);
    return out;
  }, [resources]);

  const me = slots.me?.value as { organizationName?: string; organizationId?: string } | null;
  const notifications = (slots.notifications?.value ?? []) as { read?: boolean }[];
  const unread =
    slots.notifications?.state === "ready" ? notifications.filter((n) => !n.read).length : null;

  const props: ViewProps = { principal, slots, navigate };

  return (
    <Shell
      principal={principal}
      organizationName={me?.organizationName ?? me?.organizationId ?? principal.orgId}
      view={view}
      navigate={navigate}
      unread={unread}
      lastLoadedAt={resources.lastLoadedAt}
      signOut={() => {
        window.location.href = "https://amazflow.com/signed-out/";
      }}
    >
      {renderRoute(view, props)}
    </Shell>
  );
}

/**
 * The route dispatch, driven by the table's identifiers.
 *
 * Sections whose full behaviour lands in a later phase render their shell with the same three states
 * as the rest, rather than a placeholder: an empty Teams list is an honest answer to "who is in my
 * teams" even before the team routes are wired to a management screen.
 */
function renderRoute(view: ResolvedView, props: ViewProps) {
  switch (view.routeId) {
    case "home":
      return <HomeView {...props} />;
    case "workflows":
      return <WorkflowsView {...props} />;
    case "runs":
      return <RunsView {...props} />;
    case "tasks":
      return <TasksView {...props} />;
    case "approvals":
      return <ApprovalsView {...props} />;
    case "exceptions":
      return <ExceptionsView {...props} />;
    case "agents":
      return <AgentsView {...props} />;
    case "connections":
      return <ConnectionsView {...props} />;
    case "analytics":
      return <AnalyticsView {...props} />;
    case "admin-roles":
      return <RolesView {...props} />;
    case "admin-billing":
      return <BillingView />;
    default:
      return <NotFoundView />;
  }
}

function Booting() {
  return (
    <div className="ops-boot" role="status" aria-live="polite">
      <p>Opening your workspace…</p>
    </div>
  );
}

/**
 * The honest answer for an account with no organization.
 *
 * This state exists because the alternative shipped for months: a missing `custom:tenant_id` defaulted
 * to `"amazflow"`, and the account was quietly served AmazFlow's own organization. A person seeing this
 * page has a real problem that a real person can fix, and telling them so is the only useful thing this
 * surface can do.
 */
function NoOrganization() {
  return (
    <div className="ops-boot" role="alert">
      <h1>This account is not attached to an organization</h1>
      <p>
        Your sign-in worked, but the account carries no organization, so there is no workspace to open.
        This is not something you can fix from here — ask your AmazFlow contact to attach your account to
        your organization.
      </p>
    </div>
  );
}
