// The Cognito adapter for the shared control-plane client.
//
// The retry, refresh-once, and deactivated-account behaviours moved to `@amazflow/api-client` in
// task 9.3 so that the customer app and the internal console get them without a third and fourth
// copy. What stays here is the only part that is genuinely this surface's: how a session is
// refreshed and ended against Cognito.
//
// `apiCall` keeps its original signature, so every existing caller on `/app` and `/console` is
// unchanged by the extraction.

import { createApiClient, ApiError, supportCode, type ApiSession } from "@amazflow/api-client";
import {
  API,
  type Session,
  clearSession,
  refreshSession,
  saveSession,
  signOut,
} from "./cognito-auth";

export { ApiError, supportCode };

export type ApiCallOptions = {
  method?: string;
  body?: unknown;
  /** Called with the renewed session when a refresh happened, so the caller can update its state. */
  onSessionRenewed?: (session: Session) => void;
};

/** How this surface renews and ends a session. The only Cognito-aware part of the client. */
export function cognitoTransport(onSessionRenewed?: (session: Session) => void) {
  return {
    refresh: (session: Session) => refreshSession(session.refreshToken!, session.tenantId),
    endSession: async (session: Session) => {
      clearSession();
      await signOut(session);
    },
    persist: (session: Session) => {
      saveSession(session);
      onSessionRenewed?.(session);
    },
  };
}

/**
 * Call the control plane with the given session.
 *
 * Resolves to the parsed response body, or throws ApiError. Never returns after signing out: the
 * page is on its way to /signed-out and the caller's promise stays unresolved by design, so no
 * component tries to render data it no longer has a right to.
 */
export function apiCall<T = unknown>(
  session: Session,
  path: string,
  options: ApiCallOptions = {},
): Promise<T> {
  const client = createApiClient<Session>(API, session, cognitoTransport(options.onSessionRenewed));
  return client.request<T>(path, { method: options.method, body: options.body });
}

/** The long-lived form: one client per session, so a renewal is visible to the next call. */
export function apiClientFor(session: Session, onSessionRenewed?: (session: Session) => void) {
  return createApiClient<Session>(API, session, cognitoTransport(onSessionRenewed));
}

export type { ApiSession };
