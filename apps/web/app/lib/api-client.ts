// The sanctioned way to call the control plane from an authenticated surface.
//
// Every surface previously called fetch() directly with `Authorization: Bearer ${session.idToken}`,
// which meant nothing handled the two cases that actually strand a person mid-session:
//
//   * The id token expired between the page's mount-time gate and this particular request. The
//     request 401s and the surface shows "could not load" -- to a person whose session is perfectly
//     refreshable. Requirement 4.12: attempt EXACTLY one refresh, then retry once.
//   * The account was deactivated while the session stayed live. The control plane now answers 403
//     ACCOUNT_DISABLED (requirement 4.14) and the app must sign the person out rather than showing
//     them a permission error they cannot act on.
//
// "Exactly one" is the part worth being precise about. Refreshing in a loop on repeated 401s turns a
// revoked refresh token into an infinite request storm against the identity provider; refreshing zero
// times forces a re-login every hour. So: one attempt, one retry, then sign out.

import {
  API,
  type Session,
  clearSession,
  refreshSession,
  saveSession,
  signOut,
} from "./cognito-auth";

export class ApiError extends Error {
  status: number;
  /** Stable machine-readable code from the control plane's error envelope, when present. */
  code: string | null;
  /** Correlation identifier, so a support conversation can name the exact request. */
  correlationId: string | null;
  constructor(status: number, message: string, code: string | null, correlationId: string | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

export type ApiCallOptions = {
  method?: string;
  body?: unknown;
  /** Called with the renewed session when a refresh happened, so the caller can update its state. */
  onSessionRenewed?: (session: Session) => void;
};

/**
 * Call the control plane with the given session.
 *
 * Resolves to the parsed response body, or throws ApiError. Never returns after signing out: the
 * page is on its way to /signed-out and the caller's promise stays unresolved by design, so no
 * component tries to render data it no longer has a right to.
 */
export async function apiCall<T = unknown>(
  session: Session,
  path: string,
  options: ApiCallOptions = {},
): Promise<T> {
  let active = session;
  let refreshed = false;

  for (;;) {
    const response = await request(active, path, options);

    if (response.status === 401 && !refreshed && active.refreshToken) {
      // Exactly one refresh attempt, then one retry.
      refreshed = true;
      try {
        active = await refreshSession(active.refreshToken, active.tenantId);
      } catch {
        await forceSignOut(active);
        return neverResolves<T>();
      }
      saveSession(active);
      options.onSessionRenewed?.(active);
      continue;
    }

    const parsed = await readBody(response);

    if (response.status === 401) {
      // Either the refresh already happened and the retry still 401'd, or there was no refresh
      // token to try. Either way this session is finished.
      await forceSignOut(active);
      return neverResolves<T>();
    }

    // A deactivated account is not a permission problem the person can do anything about, so it
    // ends the session rather than rendering an error.
    if (response.status === 403 && parsed.code === "ACCOUNT_DISABLED") {
      await forceSignOut(active);
      return neverResolves<T>();
    }

    if (!response.ok) {
      const text = (value: unknown) => (typeof value === "string" && value ? value : null);
      throw new ApiError(
        response.status,
        // Prefer the envelope's displayable message, fall back to the flat field the deployed
        // control plane has always sent, then to something honest about not knowing.
        text(parsed.message) ?? text(parsed.error) ?? `Request failed (${response.status})`,
        text(parsed.code),
        text(parsed.correlationId),
      );
    }

    return parsed.body as T;
  }
}

function request(session: Session, path: string, options: ApiCallOptions) {
  const method = options.method ?? "GET";
  return fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function readBody(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return { body: null } as Record<string, unknown> & { body: unknown };
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return { ...parsed, body: parsed };
  } catch {
    return { body: text, message: text } as Record<string, unknown> & { body: unknown };
  }
}

async function forceSignOut(session: Session) {
  clearSession();
  await signOut(session);
}

// signOut() navigates away. Returning a promise that never settles keeps callers from rendering
// against a session that has just been torn down, rather than handing them a null they would each
// have to remember to check.
function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => {});
}
