// Shared AmazFlow-branded authentication module, used by /login, /forgot-password,
// /reset-password, and both consoles (/app, /console).
//
// This calls the Cognito Identity Provider service directly over its plain public REST API
// (InitiateAuth / RespondToAuthChallenge / ForgotPassword / ConfirmForgotPassword) rather than
// redirecting through the Cognito Hosted UI -- the customer never leaves an AmazFlow page or
// sees any AWS/Cognito/Amplify branding. This needs no AWS SDK or SRP library: the app client
// has no secret (GenerateSecret: false) and PreventUserExistenceErrors is already enabled on
// the user pool client, so Cognito itself won't reveal whether an email exists.
//
// This does mean using the USER_PASSWORD_AUTH auth flow (password sent directly, over TLS, to
// Cognito) rather than SRP's zero-knowledge exchange -- a real, deliberate tradeoff to avoid
// pulling in a client-side crypto dependency this environment can't build-test locally. Still a
// standard, AWS-supported Cognito flow, not a security downgrade relative to typical practice.

import type { AmazFlowRole } from "@amazflow/workflow-schema";

export const COGNITO_REGION = "us-east-1";
export const COGNITO_IDP_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
export const COGNITO_CLIENT_ID = "4cjp4kpmmofnr9gmd3h90i4i2i";
export const API = "https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com";

export type Session = { idToken: string; refreshToken?: string; sub: string; email: string; role: AmazFlowRole; tenantId: string; expiresAt: number };

export class AuthError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

// Generic, existence-safe message -- Cognito's own PreventUserExistenceErrors setting already
// keeps NotAuthorizedException from distinguishing "wrong password" from "no such user"; this
// mirrors that at the copy layer so nothing downstream accidentally gets more specific.
const GENERIC_CREDENTIALS_ERROR = "That email and password combination doesn’t match our records.";

async function cognito<T = Record<string, unknown>>(action: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(COGNITO_IDP_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String((data as { __type?: string }).__type ?? "UnknownError").split("#").pop() ?? "UnknownError";
    throw new AuthError(mapCognitoError(code, (data as { message?: string }).message), code);
  }
  return data as T;
}

function mapCognitoError(code: string, fallback?: string): string {
  switch (code) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return GENERIC_CREDENTIALS_ERROR;
    case "UserNotConfirmedException":
      return "Your account hasn’t finished being set up yet. Contact your AmazFlow admin.";
    case "PasswordResetRequiredException":
      return "For your security, please reset your password before signing in.";
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many attempts. Wait a moment and try again.";
    case "InvalidPasswordException":
      return fallback ?? "That password doesn’t meet the requirements — use at least 12 characters with a mix of upper/lowercase, numbers, and symbols.";
    case "CodeMismatchException":
      return "That reset code isn’t right. Double-check the email we sent you.";
    case "ExpiredCodeException":
      return "That reset link has expired. Request a new one.";
    default:
      return fallback ?? "Something went wrong. Try again in a moment.";
  }
}

export type SignInResult =
  | { kind: "success"; session: Session }
  | { kind: "new_password_required"; session: string; email: string };

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const data = await cognito<{ AuthenticationResult?: CognitoAuthResult; ChallengeName?: string; Session?: string }>("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  if (data.ChallengeName === "NEW_PASSWORD_REQUIRED" && data.Session) {
    return { kind: "new_password_required", session: data.Session, email };
  }
  if (!data.AuthenticationResult) throw new AuthError(GENERIC_CREDENTIALS_ERROR, "NotAuthorizedException");
  return { kind: "success", session: sessionFromAuthResult(data.AuthenticationResult) };
}

export async function completeNewPassword(email: string, newPassword: string, session: string): Promise<Session> {
  const data = await cognito<{ AuthenticationResult?: CognitoAuthResult }>("RespondToAuthChallenge", {
    ChallengeName: "NEW_PASSWORD_REQUIRED",
    ClientId: COGNITO_CLIENT_ID,
    Session: session,
    ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
  });
  if (!data.AuthenticationResult) throw new AuthError("Could not complete account setup. Try again.", "UnknownError");
  return sessionFromAuthResult(data.AuthenticationResult);
}

// Access/id tokens are only valid 60 minutes (TokenValidityUnits in the CFN template); the
// refresh token lives 7 days. Rather than forcing a full re-login every hour, silently mint a
// fresh session from the stored refresh token -- callers fall back to /login only when this
// itself fails (refresh token expired/revoked).
export async function refreshSession(refreshToken: string, tenantId: string): Promise<Session> {
  const data = await cognito<{ AuthenticationResult?: Omit<CognitoAuthResult, "RefreshToken"> }>("InitiateAuth", {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });
  if (!data.AuthenticationResult) throw new AuthError("Session expired", "NotAuthorizedException");
  const session = sessionFromAuthResult({ ...data.AuthenticationResult, RefreshToken: refreshToken });
  if (session.tenantId !== tenantId) throw new AuthError("Session expired", "TenantMismatch");
  return session;
}

export async function requestPasswordReset(email: string): Promise<void> {
  await cognito("ForgotPassword", { ClientId: COGNITO_CLIENT_ID, Username: email });
}

export async function confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void> {
  await cognito("ConfirmForgotPassword", { ClientId: COGNITO_CLIENT_ID, Username: email, ConfirmationCode: code, Password: newPassword });
}

type CognitoAuthResult = { IdToken: string; RefreshToken?: string; ExpiresIn: number };

function sessionFromAuthResult(result: CognitoAuthResult): Session {
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(result.IdToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0))));
  const groups = (claims["cognito:groups"] ?? []) as string[];
  const role = (["SUPER_ADMIN", "CLIENT_ADMIN", "FRONTLINE"] as AmazFlowRole[]).find((candidate) => groups.includes(candidate));
  if (!role) throw new AuthError("This account does not have an AmazFlow access role. Contact your AmazFlow admin.", "NoRole");
  return {
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
    sub: claims.sub,
    email: claims.email,
    role,
    tenantId: claims["custom:tenant_id"] ?? "amazflow",
    expiresAt: Date.now() + result.ExpiresIn * 1000,
  };
}

const STORAGE_KEY = "amazflow_session";

export function saveSession(session: Session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (error) {
    console.error("Failed to save session:", error);
  }
}

export function loadSession(): Session | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    
    const parsed = JSON.parse(stored) as Session;
    
    // Check if session is expired
    if (!parsed.expiresAt || parsed.expiresAt < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    
    // Validate session has required fields
    if (!parsed.idToken || !parsed.email || !parsed.role || !parsed.sub) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    
    return parsed;
  } catch (error) {
    console.error("Failed to load session:", error);
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

// The console/app entry points call this instead of the plain loadSession() sync check: it
// gives an expired-but-refreshable session (id/access token past its 60-minute validity, but
// the 7-day refresh token still good) a chance to silently renew before falling back to a full
// /login redirect, instead of forcing a re-login every hour.
export async function resolveSession(): Promise<Session | null> {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  let parsed: Session;
  try {
    parsed = JSON.parse(stored) as Session;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  if (parsed.expiresAt && parsed.expiresAt > Date.now()) return parsed;
  if (!parsed.refreshToken) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  try {
    const refreshed = await refreshSession(parsed.refreshToken, parsed.tenantId);
    saveSession(refreshed);
    return refreshed;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    // Also clear any cached data that might cause loops
    sessionStorage.clear();
  } catch (error) {
    console.error("Failed to clear session:", error);
  }
}

// True sign-out: revoking the refresh token stops it from minting new access/id tokens even
// though we never redirect through Cognito's own hosted logout page.
export async function revokeRefreshToken(refreshToken: string | undefined) {
  if (!refreshToken) return;
  try {
    await cognito("RevokeToken", { ClientId: COGNITO_CLIENT_ID, Token: refreshToken });
  } catch (error) {
    // Best-effort -- local session is cleared regardless.
    console.warn("Failed to revoke refresh token:", error);
  }
}

// Complete sign out - clears everything and prevents loops
export async function signOut(session: Session | null | undefined) {
  // Revoke the token first if we have it
  if (session?.refreshToken) {
    await revokeRefreshToken(session.refreshToken);
  }
  
  // Clear all storage
  clearSession();
  
  // Small delay to ensure storage is cleared before redirect
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Redirect to signed out page (will never loop back)
  window.location.replace("/signed-out");
}

export function loginPathFor(role: AmazFlowRole | null): string {
  return role === "SUPER_ADMIN" ? "/app/" : "/console/";
}

// Chrome/Safari can restore a page from the back-forward cache instead of re-running its mount
// effects, which would let a signed-out browser flash the last authenticated screen it had in
// memory before any auth check re-runs. Forcing a real reload on a bfcache restore guarantees
// the session check in the page's own mount effect always runs against current localStorage.
export function guardBFCacheRestore() {
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) window.location.reload();
  };
  window.addEventListener("pageshow", onPageShow);
  return () => window.removeEventListener("pageshow", onPageShow);
}
