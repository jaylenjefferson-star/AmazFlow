// The extension's own Cognito client. Deliberately mirrors apps/web/app/lib/cognito-auth.ts
// rather than reusing it: that module is bound to localStorage and to the web app's routing, and
// the extension needs the same identity provider with none of the page lifecycle.
//
// This is the whole reason the agent no longer bounces through a web page. The pool's app client
// has ALLOW_USER_PASSWORD_AUTH enabled and no client secret, so the extension can authenticate
// directly against Cognito's public REST API over TLS. There is no hosted login screen to open,
// no redirect to catch, and no tab that has to stay alive -- which is what the old
// /agent-authorize handshake depended on, and what kept breaking.

export const COGNITO_REGION = "us-east-1";
export const COGNITO_IDP_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
export const COGNITO_CLIENT_ID = "4cjp4kpmmofnr9gmd3h90i4i2i";
export const API = "https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com";

export type AmazFlowRole = "SUPER_ADMIN" | "CLIENT_ADMIN" | "FRONTLINE";
export type Session = {
  idToken: string;
  refreshToken?: string;
  sub: string;
  email: string;
  role: AmazFlowRole;
  tenantId: string;
  expiresAt: number;
};

export class AuthError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

const GENERIC_CREDENTIALS_ERROR = "That email and password combination doesn’t match our records.";

async function cognito<T = Record<string, unknown>>(action: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(COGNITO_IDP_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(data.__type || "UnknownError").split("#").pop() as string;
    throw new AuthError(mapCognitoError(code), code);
  }
  return data as T;
}

function mapCognitoError(code: string): string {
  switch (code) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return GENERIC_CREDENTIALS_ERROR;
    case "PasswordResetRequiredException":
      return "Reset your password in AmazFlow, then sign in here again.";
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many attempts. Wait a moment and try again.";
    case "UserNotConfirmedException":
      return "This account isn’t confirmed yet. Contact your AmazFlow admin.";
    default:
      return "Couldn’t reach AmazFlow sign-in. Check your connection and try again.";
  }
}

function claimsOf(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))));
}

function sessionFrom(result: { IdToken: string; RefreshToken?: string; ExpiresIn: number }): Session {
  const claims = claimsOf(result.IdToken);
  const groups = (claims["cognito:groups"] ?? []) as string[];
  const role = (["SUPER_ADMIN", "CLIENT_ADMIN", "FRONTLINE"] as AmazFlowRole[]).find((r) => groups.includes(r));
  if (!role) throw new AuthError("This account has no AmazFlow access role. Contact your AmazFlow admin.", "NoRole");
  return {
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
    sub: String(claims.sub),
    email: String(claims.email ?? ""),
    role,
    tenantId: String(claims["custom:tenant_id"] ?? "amazflow"),
    expiresAt: Date.now() + (result.ExpiresIn ?? 3600) * 1000,
  };
}

export async function signIn(email: string, password: string): Promise<Session> {
  const data = await cognito<{ AuthenticationResult?: { IdToken: string; RefreshToken?: string; ExpiresIn: number }; ChallengeName?: string }>("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  // A first-login or MFA challenge needs a screen this popup deliberately doesn't have. Send the
  // person to the full AmazFlow login once, rather than half-implementing a challenge flow here.
  if (data.ChallengeName) {
    throw new AuthError("This account needs to finish setup at amazflow.com/login, then sign in here.", data.ChallengeName);
  }
  if (!data.AuthenticationResult) throw new AuthError(GENERIC_CREDENTIALS_ERROR, "NotAuthorizedException");
  return sessionFrom(data.AuthenticationResult);
}

// Id tokens last 60 minutes and the refresh token 7 days, so a browser left open overnight comes
// back connected instead of asking for a password again.
export async function refreshSession(refreshToken: string): Promise<Session> {
  const data = await cognito<{ AuthenticationResult?: { IdToken: string; ExpiresIn: number } }>("InitiateAuth", {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });
  if (!data.AuthenticationResult) throw new AuthError("Your AmazFlow session expired. Sign in again.", "NotAuthorizedException");
  return sessionFrom({ ...data.AuthenticationResult, RefreshToken: refreshToken });
}

export async function revokeRefreshToken(refreshToken: string | undefined) {
  if (!refreshToken) return;
  await cognito("RevokeToken", { ClientId: COGNITO_CLIENT_ID, Token: refreshToken }).catch(() => undefined);
}
