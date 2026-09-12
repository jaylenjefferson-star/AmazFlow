import type { Principal } from "@amazflow/permissions";
import type { WorkIQIdentity } from "./tenant";

// The one conversion point between the control plane's authenticated `Principal` and the
// identity shape WorkIQ's tenant-resolution helpers require. Keeping this in one named function
// (rather than each call site building a `WorkIQIdentity` literal by hand) means a control-plane
// principal can never drift out of sync with what WorkIQ expects: a coarse role and an org-scoped
// tenant id, both already verified server-side, never a client-supplied value.
export function workiqIdentityFromPrincipal(principal: Principal): WorkIQIdentity {
  return {
    tenantId: principal.orgId,
    userId: principal.userId,
    role: principal.group
  };
}
