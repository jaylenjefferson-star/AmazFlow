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
import { CUSTOMER_ROUTE_TABLE, customerResourceSpecs } from "./routes";
import { ErrorBoundary } from "./error-boundary";
import { Shell } from "./shell";
import {
  AgentsView,
  AnalyticsView,
  ApprovalsView,
  AuditView,
  BillingView,
  ConnectionsView,
  ExceptionsView,
  HomeView,
  InvitationAcceptance,
  MfaSetupView,
  NotFoundView,
  NotificationPreferencesView,
  NotificationsView,
  OrganizationView,
  PersonalSecurityView,
  ProfileView,
  RolesView,
  RunsView,
  SecurityView,
  SupportView,
  TasksView,
  TeamsView,
  UsersView,
  WorkflowsView,
  WorkIQView,
  type ViewProps,
} from "./views";
import { WorkflowWorkspace } from "./workflow-workspace";
import { RunWorkspace } from "./run-workspace";
import {
  clientFor,
  consumeSessionHandoff,
  principalOf,
  readStoredSession,
  refinePrincipal,
  signOutSession,
  toLogin,
  type MeResponse,
  type StoredSession,
} from "./session";
import "@amazflow/ui/ops.css";
import "./workflow-builder.css";

/**
 * What this surface reads, and which permission each read needs.
 *
 * The permission is not a security control — the control plane is. It is what stops the surface asking
 * for something it will be refused and then showing the person a 403 they cannot act on. A resource
 * whose permission the role lacks reports `unavailable`, which the views render as "not available to
 * your role" rather than as an error.
 */


// The application-level fallback (requirement 29.1): whatever goes wrong above the route dispatch --
// the gate, the shell, the resource wiring -- this is the one thing standing between that and a blank
// tab.
export default function CustomerApp() {
  return (
    <ErrorBoundary variant="application">
      <CustomerAppGate />
    </ErrorBoundary>
  );
}

function CustomerAppGate() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [gate, setGate] = useState<"checking" | "ready" | "no-organization" | "invitation">("checking");
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [view, setView] = useState<ResolvedView>({ routeId: "home" });

  // The gate. One place decides whether the person in front of this surface may be here, which is the
  // arrangement Phase 1 established after four copies of this effect had already drifted.
  useEffect(() => {
    consumeSessionHandoff();
    const here = `${window.location.pathname}${window.location.search}`;
    const requested = pathToView(CUSTOMER_ROUTE_TABLE, window.location.pathname, window.location.search);
    const stored = readStoredSession();

    // Inspection is public by design: the person opening an invitation may not have an AmazFlow
    // session yet. Acceptance itself still uses the authenticated client and is enforced server-side.
    if (requested.routeId === "accept-invitation") {
      setView(requested);
      setSession(stored && (!stored.expiresAt || stored.expiresAt >= Date.now() || !!stored.refreshToken) ? stored : null);
      setGate("invitation");
      return;
    }

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

  if (gate === "invitation") {
    const parameters = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
    const token = parameters?.get("token") ?? parameters?.get("t") ?? "";
    return (
      <ToastProvider>
        <InvitationAcceptance token={token} session={session} onRenewed={setSession} />
      </ToastProvider>
    );
  }
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
  principal: fromClaims,
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
  const specs = useMemo(() => customerResourceSpecs(fromClaims.orgId), [fromClaims.orgId]);
  const [me, setMe] = useState<MeResponse | null>(null);

  /**
   * The principal the surface actually renders from.
   *
   * The token carries only the coarse group, so the gate can do no better than that group's default
   * role. `GET /me` reports the FINE membership role, and Phase 4 is the release in which that role
   * became assignable — so a surface still guessing from the group would show an APPROVER the whole
   * administration section and show a VIEWER controls the API refuses. Refined once `/me` lands, and
   * memoized on the role and team identifiers rather than on the response object so a poll that
   * returns the same facts does not churn the read pass.
   */
  const teamKey = (me?.teamIds ?? []).join(",");
  const principal = useMemo(
    () => refinePrincipal(fromClaims, me),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromClaims, me?.platformRole, teamKey],
  );

  const resources = useResources(client, principal, specs as readonly ResourceSpec<unknown>[]);

  const slots = useMemo(() => {
    const out: Record<string, ResourceSlot<unknown>> = {};
    for (const spec of specs) out[spec.key] = resources.read(spec as ResourceSpec<unknown>);
    return out;
  }, [resources, specs]);

  const meSlot = slots.me;
  useEffect(() => {
    if (meSlot?.state === "ready" && meSlot.value) setMe(meSlot.value as MeResponse);
  }, [meSlot?.state, meSlot?.value]);

  const notifications = (slots.notifications?.value ?? []) as { read?: boolean }[];
  const unread =
    slots.notifications?.state === "ready" ? notifications.filter((n) => !n.read).length : null;

  const props: ViewProps = { principal, slots, navigate, client, session, refresh: resources.refresh };

  return (
    <Shell
      principal={principal}
      organizationName={me?.organizationName ?? me?.organizationId ?? principal.orgId}
      view={view}
      navigate={navigate}
      unread={unread}
      lastLoadedAt={resources.lastLoadedAt}
      refresh={() => {
        void resources.refresh();
      }}
      signOut={() => {
        void signOutSession(session);
      }}
    >
      {/* Requirement 29.1/29.2: one boundary per route module. Keyed on the route so a view that just
          threw is given a fresh mount, not a permanently tripped boundary, the moment the person
          navigates to it again -- including navigating to the same route with a different entity. */}
      <ErrorBoundary variant="route" resetKey={`${view.routeId}:${view.entityId ?? ""}`}>
        {renderRoute(view, props)}
      </ErrorBoundary>
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
      return view.entityId ? <WorkflowWorkspace key={view.entityId} {...props} workflowId={view.entityId} /> : <WorkflowsView {...props} />;
    case "runs":
      return view.entityId ? <RunWorkspace key={view.entityId} {...props} runId={view.entityId} /> : <RunsView {...props} />;
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
    case "workiq":
      return <WorkIQView {...props} />;
    case "admin-organization":
      return <OrganizationView {...props} />;
    case "admin-users":
      return <UsersView {...props} />;
    case "admin-teams":
      return <TeamsView {...props} />;
    case "admin-roles":
      return <RolesView {...props} />;
    case "admin-security":
      return <SecurityView {...props} />;
    case "admin-audit":
      return <AuditView {...props} />;
    case "admin-billing":
      return <BillingView {...props} />;
    case "settings-profile":
      return <ProfileView {...props} />;
    case "settings-security":
      return <PersonalSecurityView {...props} />;
    case "settings-notifications":
      return <NotificationPreferencesView {...props} />;
    case "mfa-setup":
      return <MfaSetupView />;
    case "notifications":
      return <NotificationsView {...props} />;
    case "support":
      return <SupportView {...props} />;
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
