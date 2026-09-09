import { useCallback } from "react";
import type { Session } from "../cognito-auth";
import { API } from "../cognito-auth";

/**
 * Custom hook for making authenticated API requests
 */
export function useAPI(session: Session | null | undefined) {
  const request = useCallback(
    async <T = unknown>(path: string, options: RequestInit = {}): Promise<T> => {
      if (!session) {
        throw new Error("Sign in required");
      }

      const response = await fetch(`${API}${path}`, {
        ...options,
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${session.idToken}`,
          ...options.headers,
        },
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.error ?? `Request failed (${response.status})`);
      }

      return body as T;
    },
    [session]
  );

  return { request };
}
