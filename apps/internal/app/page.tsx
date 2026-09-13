"use client";

/**
 * The internal staff console — `admin.amazflow.com`.
 *
 * Requirement 1.3 asks that customers never reach this surface by URL manipulation. That has to be
 * stated precisely, because this is a static export and there is no frontend server here:
 *
 * > **Design decision D-2 — a static bundle is not a security boundary.** The authorization boundary
 * > is, and only is, the control plane: API Gateway's JWT authorizer plus the permissions policy's
 * > staff check on every internal route. Serving this bundle from a separate origin is defence in depth
 * > and anti-confusion, not the control.
 *
 * So what this file guarantees is the thing a frontend actually can guarantee, and it is the thing task
 * 9.7 asks for: a principal outside the staff group renders a shell containing **no organization data
 * from any tenant**. Not a filtered view, not an empty table that would have been filled — the data
 * layer is never constructed at all. There is no request to refuse and nothing in memory to leak,
 * which is a stronger statement than "the requests came back 403".
 *
 * The full fourteen staff sections port here in task 21.1. This phase establishes the origin, the
 * gate, and the deny state.
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
import { PageHead, Pill, ToastProvider } from "@amazflow/ui";
import { INTERNAL_ROUTE_TABLE, internalRoute } from "./routes";
import { StaffShell } from "./shell";
import { clientFor, consumeSessionHandoff, principalOf, readStoredSession, toLogin, type StoredSession } from "./session";
import { AccessDenied, NoOrganizationShell, StaffSection } from "./views";
import "@amazflow/ui/ops.css";

/**
 * What the staff console reads. Every one of these is cross-organization by nature, which is exactly
 * why the gate below runs before this list is ever handed to a provider.
 */
const RESOURCES = [
  { key: "me", path: "/me", permission: null, empty: null },
  { key: "organizations", path: "/organizations", permission: "internal:organization_manage", empty: [] },
  { key: "runs", path: "/runs", permission: "run:read", live: true, empty: [] },
  { key: "workflows", path: "/workflows", permission: "workflow:read", empty: [] },
  { key: "agents", path: "/agents", permission: "agent:read", empty: [] },
  { key: "connections", path: "/connections/browser", permission: "connection:read", empty: [] },
  { key: "activity", path: "/activity", permission: "internal:audit_read_all", empty: [] },
  { key: "leads", path: "/leads", permission: "internal:lead_read", empty: [] },
  { key: "tickets", path: "/support/tickets", permission: "internal:support_manage", empty: [] },
  // The public liveness endpoint remains available for probes; the staff view is still policy
  // protected so a customer cannot turn this surface into a platform-information oracle.
  { key: "health", path: "/health", permission: "internal:platform_settings", empty: null },
  { key: "settings", path: "/settings", permission: "internal:platform_settings", empty: null },
] as const satisfies readonly ResourceSpec<unknown>[];

type Gate =
  | { state: "checking" }
  | { state: "signed-out" }
  | { state: "no-organization" }
  | { state: "denied"; principal: Principal }
  | { state: "staff"; principal: Principal; session: StoredSession };

export default function InternalConsole() {
  const [gate, setGate] = useState<Gate>({ state: "checking" });
  const [view, setView] = useState<ResolvedView>({ routeId: "overview" });

  useEffect(() => {
    consumeSessionHandoff();
    const stored = readStoredSession();
    const here = `${window.location.pathname}${window.location.search}`;
    if (!stored) {
      setGate({ state: "signed-out" });
      toLogin(here, false);
      return;
    }
    let principal: Principal;
    try {
      principal = principalOf(stored.idToken);
    } catch (error) {
      if (error instanceof PrincipalError) setGate({ state: "no-organization" });
      else toLogin(here, false);
      return;
    }
    // The one branch that matters on this surface. `isStaff` comes from the verified `cognito:groups`
    // claim by way of the shared policy -- this file does not compare a role string, because a second
    // place that decides the staff boundary is a second policy, and eleven of those disagreed before
    // Phase 2 centralized it.
    setGate(principal.isStaff ? { state: "staff", principal, session: stored } : { state: "denied", principal });
  }, []);

  useEffect(() => {
    const resolve = () =>
      setView(pathToView(INTERNAL_ROUTE_TABLE, window.location.pathname, window.location.search));
    resolve();
    window.addEventListener("popstate", resolve);
    return () => window.removeEventListener("popstate", resolve);
  }, []);

  const navigate = useCallback((next: ResolvedView) => {
    window.history.pushState({}, "", viewToPath(INTERNAL_ROUTE_TABLE, next));
    setView(next);
    window.scrollTo({ top: 0 });
  }, []);

  if (gate.state === "checking" || gate.state === "signed-out")
    return (
      <div className="ops-boot" role="status" aria-live="polite">
        <p>Checking your access…</p>
      </div>
    );

  if (gate.state === "no-organization") return <NoOrganizationShell />;

  // Rendered INSTEAD of the data layer, not alongside it. `StaffData` is not mounted, so no
  // control-plane read is issued and no tenant record is ever in this page's memory.
  if (gate.state === "denied") return <AccessDenied principal={gate.principal} />;

  return (
    <ToastProvider>
      <StaffData principal={gate.principal} session={gate.session} view={view} navigate={navigate} />
    </ToastProvider>
  );
}

function StaffData({
  principal,
  session,
  view,
  navigate,
}: {
  principal: Principal;
  session: StoredSession;
  view: ResolvedView;
  navigate: (view: ResolvedView) => void;
}) {
  const [active, setActive] = useState(session);
  const client = useMemo(() => clientFor(active, setActive), [active.idToken]);
  const resources = useResources(client, principal, RESOURCES as readonly ResourceSpec<unknown>[]);

  const slots = useMemo(() => {
    const out: Record<string, ResourceSlot<unknown>> = {};
    for (const spec of RESOURCES) out[spec.key] = resources.read(spec as ResourceSpec<unknown>);
    return out;
  }, [resources]);

  const route = internalRoute(view.routeId);

  return (
    <StaffShell
      principal={principal}
      view={view}
      navigate={navigate}
      lastLoadedAt={resources.lastLoadedAt}
    >
      <section className="ops-col ops-gap-md">
        <PageHead title={route?.label ?? "Overview"} />
        {route?.disabledReason ? (
          <>
            <Pill tone="muted">Not available in this release</Pill>
            <p className="ops-panel-lead">{route.disabledReason}</p>
            {route.disabledDetail && <p className="ops-muted">{route.disabledDetail}</p>}
          </>
        ) : (
          <StaffSection routeId={view.routeId} slots={slots} client={client} refresh={resources.refresh} />
        )}
      </section>
    </StaffShell>
  );
}
