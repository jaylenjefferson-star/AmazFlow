// The customer surface's session adapter.
//
// The three surfaces share one client (`@amazflow/api-client`) and one policy
// (`@amazflow/permissions`); what each surface supplies is how IT holds a session. This surface reads
// the same storage key the existing pages use, because open question Q-3 is held at its conservative
// answer: the bearer token stays in a header and stays in the storage it already lives in. Moving to
// an httpOnly cookie is a real improvement and a real cross-origin redesign, and doing it inside a
// release that already moves every surface would put a session change on top of a surface change.
//
// The `custom:tenant_id` claim is read from the id token rather than trusted from storage, and it is
// read for DISPLAY and for building the principal the navigation filter uses. It is never the
// authorization boundary — that is the control plane, which re-derives the same claim from the
// verified token on every request (design decision D-2).

import {
  createApiClient,
  type ApiClient,
  type ApiSession,
} from "@amazflow/api-client";
import {
  COARSE_GROUP_FOR_ROLE,
  PLATFORM_ROLES,
  groupFromClaims,
  principalFromClaims,
  type PlatformRole,
  type Principal,
} from "@amazflow/permissions";

/** Shared with the marketing/auth surface, which is what writes it at sign-in. */
export const STORAGE_KEY = "amazflow_session";
export const API = "https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com";
export const COGNITO_REGION = "us-east-1";
export const COGNITO_CLIENT_ID = "4cjp4kpmmofnr9gmd3h90i4i2i";
const COGNITO_IDP_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;

export type StoredSession = ApiSession & {
  accessToken?: string;
  sub: string;
  email: string;
  expiresAt: number;
};

export function readStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed.idToken ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredSession(session: StoredSession) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* a browser refusing storage is not a reason to end a working session */
  }
}

export function clearStoredSession() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

/** Claims out of the id token. Decoding, not verifying: the control plane verifies. */
export function claimsOf(idToken: string): Record<string, unknown> {
  try {
    const payload = idToken.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Build the principal the navigation filter reads.
 *
 * `principalFromClaims` THROWS when the organization claim is absent, and that is deliberate
 * (requirement 4.7): the previous code defaulted a missing `custom:tenant_id` to `"amazflow"`, the
 * staff tenant, so an account created without the claim silently became a member of AmazFlow's own
 * organization. There is no organization that is a safe guess, so this surface shows the account an
 * explanation instead of a workspace.
 */
export function principalOf(idToken: string, membershipRole?: PlatformRole | null): Principal {
  return principalFromClaims(claimsOf(idToken), membershipRole ?? null);
}

export const groupOf = (idToken: string) => groupFromClaims(claimsOf(idToken));

/** What `GET /me` reports about the signed-in account. */
export type MeResponse = {
  userId?: string;
  email?: string | null;
  tenantId?: string;
  organizationId?: string;
  organizationName?: string | null;
  role?: string;
  /** The fine-grained membership role. Absent for a response that predates task 7.13. */
  platformRole?: string;
  teamIds?: string[];
  sections?: string[];
  lastLoginAt?: string | null;
  accountStatus?: string;
};

/**
 * Narrow or widen the claims-derived principal to the membership role the control plane holds.
 *
 * A Cognito token carries only the COARSE group, so `principalFromClaims` can do no better than the
 * default for that group — `CLIENT_ADMIN → ORG_ADMIN`, `FRONTLINE → OPERATOR`. That was harmless while
 * no fine role could be assigned. Phase 4 ships `POST /tenants/{t}/users/{username}/role`, so a person
 * can genuinely be an APPROVER or a VIEWER now, and a surface that keeps guessing from the group would
 * offer an APPROVER the whole administration section and offer a VIEWER controls the API refuses. That
 * is precisely the navigation-versus-enforcement disagreement task 9.5 exists to make impossible.
 *
 * A stored role its group cannot reach is NOT believed, which is the same rule the control plane
 * applies when it resolves a membership: the group is authoritative because it is the thing the
 * identity provider signed, and a membership record claiming `ORG_OWNER` for a `FRONTLINE` account is
 * a record that disagrees with the token. `STAFF_ADMIN` is unreachable here for the same reason — no
 * customer group maps to it — so no `/me` response can turn this surface into a staff console.
 *
 * None of this is a security control. The control plane re-derives the same claim on every request.
 * It is what stops the surface offering a door the API will not open.
 */
export function refinePrincipal(principal: Principal, me: MeResponse | null | undefined): Principal {
  if (!me) return principal;
  const claimed = me.platformRole;
  const believable =
    !!claimed &&
    (PLATFORM_ROLES as readonly string[]).includes(claimed) &&
    COARSE_GROUP_FOR_ROLE[claimed as PlatformRole] === principal.group;
  const role = believable ? (claimed as PlatformRole) : principal.role;
  const teamIds = Array.isArray(me.teamIds) ? me.teamIds : principal.teamIds;
  const sameTeams =
    teamIds.length === principal.teamIds.length &&
    teamIds.every((id, index) => id === principal.teamIds[index]);
  if (role === principal.role && sameTeams) return principal;
  return { ...principal, role, teamIds };
}

/** Plain identity-provider request. Control-plane traffic always goes through @amazflow/api-client. */
async function cognito<T = unknown>(action: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(COGNITO_IDP_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    __type?: string;
  };
  if (!response.ok) {
    const error = new Error(payload.message || "The identity provider refused the request") as Error & {
      code?: string;
    };
    error.code = payload.__type?.split("#").pop();
    throw error;
  }
  return payload;
}

/** Refresh against Cognito's plain REST API — no SDK, no hosted UI, no AWS branding. */
async function refreshTokens(session: StoredSession): Promise<StoredSession> {
  const data = await cognito<{
    AuthenticationResult?: { IdToken?: string; AccessToken?: string; ExpiresIn?: number };
  }>("InitiateAuth", {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: { REFRESH_TOKEN: session.refreshToken },
  });
  const result = data.AuthenticationResult;
  if (!result?.IdToken) throw new Error("refresh returned no token");
  return {
    ...session,
    idToken: result.IdToken,
    accessToken: result.AccessToken ?? session.accessToken,
    expiresAt: Date.now() + (result.ExpiresIn ?? 3600) * 1000,
  };
}

/** Where an unauthenticated visitor goes, carrying where they were trying to be. */
export function toLogin(returnTo: string, expired: boolean) {
  const reason = expired ? "&reason=expired" : "";
  window.location.href = `https://amazflow.com/login?next=${encodeURIComponent(
    `https://app.amazflow.com${returnTo}`,
  )}${reason}`;
}

export function clientFor(session: StoredSession, onRenewed: (session: StoredSession) => void): ApiClient {
  return createApiClient<StoredSession>(API, session, {
    refresh: refreshTokens,
    endSession: async () => {
      clearStoredSession();
      window.location.href = "https://amazflow.com/signed-out/";
    },
    persist: (renewed) => {
      writeStoredSession(renewed);
      onRenewed(renewed);
    },
  });
}


/** A client for the invitation-inspection route, which is intentionally unauthenticated. */
let publicClient: ApiClient | null = null;
export function publicClientFor(): ApiClient {
  if (publicClient) return publicClient;
  publicClient = createApiClient(
    API,
    { idToken: "public-invitation-inspection", tenantId: "public" },
    {
      refresh: async () => {
        throw new Error("A public request cannot refresh a session");
      },
      endSession: async () => {
        throw new Error("This public request requires authentication");
      },
    },
  );
  return publicClient;
}

/** Change only the signed-in person's password; Cognito validates the current password. */
export async function changeOwnPassword(
  session: StoredSession,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (!session.accessToken)
    throw new Error("Please sign in again before changing your password.");
  await cognito("ChangePassword", {
    AccessToken: session.accessToken,
    PreviousPassword: currentPassword,
    ProposedPassword: newPassword,
  });
}

/** Revoke this browser's refresh token, clear local state, and leave the authenticated surface. */
export async function signOutSession(session: StoredSession): Promise<void> {
  if (session.refreshToken) {
    try {
      await cognito("RevokeToken", {
        ClientId: COGNITO_CLIENT_ID,
        Token: session.refreshToken,
      });
    } catch {
      // Local sign-out still has to complete if the token already expired or was globally revoked.
    }
  }
  clearStoredSession();
  window.location.href = "https://amazflow.com/signed-out/";
}
