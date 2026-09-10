// The internal console's route bodies and its two data-free shells.
//
// Extracted from `page.tsx` so task 9.13's rendering tests can render them directly: a state that can
// only be reached by mounting a page, running two effects, and waiting for a poll is a state nobody
// tests, and the untested one here would be the access-denied shell — the single most important thing
// on this surface to get right.

import {
  Alert,
  EmptyState,
  Pill,
  SkeletonPanel,
} from "@amazflow/ui";
import type { ResourceSlot } from "@amazflow/domain-ui";
import type { Principal } from "@amazflow/permissions";

/**
 * Which read backs which section. A section absent from this map has no read yet and says so, rather
 * than rendering an empty list that implies AmazFlow looked and found nothing.
 */
export const SECTION_RESOURCE: Record<string, string> = {
  organizations: "organizations",
  runs: "runs",
  workflows: "workflows",
  agents: "agents",
  activity: "activity",
  leads: "leads",
  support: "tickets",
  health: "health",
};

/**
 * The Phase 3 body of each staff section: the real read, with all three states.
 *
 * Task 21.1 ports the fourteen existing `/app` sections here in full. Until it does, `/app` remains
 * the live staff console (Risk R-12), and this surface shows the same data through the shared provider
 * so that the origin, the gate, and the shell are proven before the views move.
 */
export function StaffSection({
  routeId,
  slots,
}: {
  routeId: string;
  slots: Record<string, ResourceSlot<unknown>>;
}) {
  const key = SECTION_RESOURCE[routeId];
  if (!key)
    return (
      <EmptyState
        title="This section moves here in a later phase"
        body="Today's staff console at /app is still the live one, and it stays live until the cutover."
      />
    );

  const slot = slots[key];
  if (!slot || slot.state === "loading")
    return (
      <div aria-busy="true" aria-live="polite">
        <SkeletonPanel rows={4} />
      </div>
    );
  if (slot.state === "unavailable")
    return <EmptyState title="Not available to your role" body="Staff hold no grant for this section." />;
  if (slot.state === "error")
    return (
      <Alert tone="bad" title="This did not load">
        {slot.error}
      </Alert>
    );

  const rows = Array.isArray(slot.value) ? (slot.value as Record<string, unknown>[]) : [];
  if (rows.length === 0)
    return <EmptyState title="Nothing here yet" body="This section is empty, not broken." />;

  return (
    <ul className="ops-list">
      {rows.slice(0, 50).map((row, index) => (
        <li key={String(row.id ?? row.slug ?? index)}>
          <span>{String(row.name ?? row.slug ?? row.id ?? "—")}</span>
          {row.status ? <Pill tone="neutral">{String(row.status)}</Pill> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The access-denied shell: requirement 2.3 and 2.4, and task 9.7's "data-free" is the load-bearing
 * word.
 *
 * There is no table here waiting to be filled, no provider mounted, and no request in flight. A
 * customer who downloads this bundle and opens this origin gets this page and nothing else. It names
 * the principal's own organization — which the person already knows, since it is their own — and names
 * no other, because a message that said "this is for AmazFlow staff, you are org X of Y" would be
 * leaking the shape of the tenancy to make a point about it.
 */
export function AccessDenied({ principal }: { principal: Principal }) {
  return (
    <div className="ops-boot" role="alert">
      <h1>This is the AmazFlow staff console</h1>
      <p>
        Your account is a member of <strong>{principal.orgId}</strong> and does not have access here.
        Nothing on this page is loaded from AmazFlow, and no organization&rsquo;s data has been
        requested.
      </p>
      <p>
        Your own workspace is at <a href="https://app.amazflow.com/">app.amazflow.com</a>.
      </p>
    </div>
  );
}

export function NoOrganizationShell() {
  return (
    <div className="ops-boot" role="alert">
      <h1>This account is not attached to an organization</h1>
      <p>
        The sign-in worked, but the account carries no organization claim, so there is no workspace to
        open. An AmazFlow administrator can attach it.
      </p>
    </div>
  );
}
