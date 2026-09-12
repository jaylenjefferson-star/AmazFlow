import { roleSchema, type AmazFlowRole } from "@amazflow/workflow-schema";

// WorkIQ is a separate service/data boundary from the execution control plane (see
// docs/WORKIQ_COMPLIANCE.md). A tenant identifier is always resolved from the authenticated
// identity and server-loaded records -- never trusted from a client-supplied request body -- so
// a caller cannot widen their own view by putting a different tenantId on the wire.

export interface WorkIQIdentity {
  /** The tenant bound to this session by the identity provider, e.g. Cognito custom:tenant_id. */
  tenantId: string;
  userId: string;
  role: AmazFlowRole;
}

export class TenantBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantBoundaryError";
  }
}

function assertIdentityShape(identity: WorkIQIdentity): void {
  if (typeof identity.tenantId !== "string" || identity.tenantId.trim() === "") {
    throw new TenantBoundaryError("Identity is missing a tenantId; WorkIQ cannot resolve a tenant scope for it.");
  }
  roleSchema.parse(identity.role);
}

/**
 * Resolves the tenant a request is allowed to operate against. A caller may only request a
 * tenant other than their own when they hold SUPER_ADMIN, mirroring the staff/tenant boundary
 * used by the control plane. Everyone else is pinned to their own identity's tenantId regardless
 * of what (if anything) was requested.
 */
export function resolveTenantId(identity: WorkIQIdentity, requestedTenantId?: string): string {
  assertIdentityShape(identity);

  if (!requestedTenantId || requestedTenantId === identity.tenantId) {
    return identity.tenantId;
  }

  if (identity.role !== "SUPER_ADMIN") {
    throw new TenantBoundaryError(
      `Identity for tenant "${identity.tenantId}" may not resolve records for tenant "${requestedTenantId}".`
    );
  }

  return requestedTenantId;
}

/**
 * Asserts that a record already loaded from storage belongs to the tenant a request is scoped
 * to. Call this after a lookup by id so a record from another tenant can never be returned just
 * because its id happened to be guessable or reused.
 */
export function assertResourceTenant(
  identity: WorkIQIdentity,
  resourceTenantId: string,
  resourceLabel = "record"
): void {
  assertIdentityShape(identity);

  if (resourceTenantId === identity.tenantId) return;
  if (identity.role === "SUPER_ADMIN") return;

  throw new TenantBoundaryError(
    `Identity for tenant "${identity.tenantId}" may not access ${resourceLabel} owned by tenant "${resourceTenantId}".`
  );
}

/** The floor below which an aggregate population view must be suppressed (see WorkIQ compliance doc). */
export const MIN_AGGREGATE_SAMPLE_SIZE = 5;

/**
 * Returns whether an aggregate of the given sample size is safe to display in a population view.
 * Demo tenants are exempt from suppression but must still be flagged (see the isDemo schema
 * fields) so their aggregates are never mixed into a real tenant's totals.
 */
export function isAggregateDisclosable(sampleSize: number): boolean {
  return Number.isFinite(sampleSize) && sampleSize >= MIN_AGGREGATE_SAMPLE_SIZE;
}
