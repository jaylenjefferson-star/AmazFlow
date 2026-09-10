// The internal staff console's session adapter.
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

/** Refresh against Cognito's plain REST API — no SDK, no hosted UI, no AWS branding. */
async function refreshTokens(session: StoredSession): Promise<StoredSession> {
  const response = await fetch(COGNITO_IDP_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: session.refreshToken },
    }),
  });
  if (!response.ok) throw new Error("refresh failed");
  const data = (await response.json()) as {
    AuthenticationResult?: { IdToken?: string; AccessToken?: string; ExpiresIn?: number };
  };
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
    `https://admin.amazflow.com${returnTo}`,
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
