"use client";

/**
 * Intercom messenger.
 *
 * Mounted once from the root layout, which is the only global insertion point in this static
 * export. It decides for itself whether to run, so no page has to opt in:
 *
 *   - Never on /app. That console is the internal operations surface -- the people who answer
 *     support are not the people who file it, and booting there would put staff sessions in the
 *     customer inbox.
 *   - Never for a SUPER_ADMIN session, for the same reason, wherever they happen to be.
 *   - Identified for a customer session, with the org attached as an Intercom company so
 *     conversations group by tenant instead of arriving as unrelated individuals.
 *   - Anonymous for everyone else, so a visitor on the marketing site or someone stuck on the
 *     login page can still start a conversation.
 *
 * Identity verification: Intercom cannot tell a real user_id from a forged one on its own, so
 * without a server-signed user_hash anyone could open the console and claim to be another
 * customer. The hash is fetched from the control plane when that endpoint exists and passed at
 * boot; until then the messenger still works, unverified. See docs/INTERCOM.md.
 */

import { useEffect } from "react";
import Intercom, { shutdown } from "@intercom/messenger-js-sdk";
import { API, peekSession, type Session } from "./cognito-auth";

export const INTERCOM_APP_ID = "fitw71yl";

/** Paths that must never boot the messenger. */
function isInternalConsole(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

/** The sign-out landing page, where the previous identity has to be cleared. */
function isSignedOut(pathname: string): boolean {
  return pathname === "/signed-out" || pathname.startsWith("/signed-out/");
}

/**
 * Optional claims the id token may carry. Cognito's pool defines no name attribute today and
 * carries no sign-up date in the token, so both are read opportunistically rather than assumed.
 *
 * created_at is deliberately NOT filled from auth_time: Intercom reads it as the sign-up date,
 * so using the current login would make every customer look like they joined moments ago.
 */
function optionalProfile(idToken: string): { name?: string; created_at?: number } {
  try {
    const [, payload] = idToken.split(".");
    const claims = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    ) as Record<string, unknown>;

    const given = typeof claims.given_name === "string" ? claims.given_name : "";
    const family = typeof claims.family_name === "string" ? claims.family_name : "";
    const name =
      typeof claims.name === "string" && claims.name.trim()
        ? claims.name.trim()
        : `${given} ${family}`.trim() || undefined;

    const seconds = Number(claims["custom:created_at"]);
    const created_at = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : undefined;

    return { name, created_at };
  } catch {
    return {};
  }
}

/**
 * The org's display name, so support sees "Northwind Logistics" rather than a slug. The branding
 * route is public and cheap, and the answer is cached for the tab because it does not change
 * inside a session. A failure here is not worth blocking the messenger over.
 */
async function organizationName(tenantId: string): Promise<string | undefined> {
  const cacheKey = `amazflow_org_name_${tenantId}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return cached;
  } catch {
    // Private browsing -- just skip the cache.
  }
  try {
    const response = await fetch(`${API}/organizations/${encodeURIComponent(tenantId)}/branding`);
    if (!response.ok) return undefined;
    const body = (await response.json()) as {
      name?: string;
      branding?: { displayName?: string };
    };
    const name = body.branding?.displayName || body.name;
    if (!name) return undefined;
    try {
      sessionStorage.setItem(cacheKey, name);
    } catch {
      // Cache is a nicety, not a requirement.
    }
    return name;
  } catch {
    return undefined;
  }
}

/**
 * The server-signed proof that this user_id really is this user. Absent until the control plane
 * ships the endpoint and INTERCOM_IDENTITY_SECRET is set, so a miss is expected rather than an
 * error -- but it is capped, because an unreachable control plane must not stop the messenger
 * from loading.
 */
async function identityHash(session: Session): Promise<string | undefined> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 2000);
  try {
    const response = await fetch(`${API}/support/intercom-identity`, {
      headers: { Authorization: `Bearer ${session.idToken}` },
      signal: abort.signal,
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { userHash?: unknown };
    return typeof body.userHash === "string" && body.userHash ? body.userHash : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export function IntercomMessenger() {
  useEffect(() => {
    const { pathname } = window.location;
    if (isInternalConsole(pathname)) return;

    let cancelled = false;

    // Landing on the sign-out page means the previous identity is still held in Intercom's own
    // storage. Clearing it here keeps the next person to use this browser from inheriting the
    // conversation history of the last one.
    // Guarded on the global rather than called unconditionally: the SDK logs a warning if asked
    // to shut down when it was never booted, and a fresh browser landing here directly is a
    // normal case, not a fault worth putting in the console.
    if (isSignedOut(pathname) && typeof window.Intercom === "function") {
      try {
        shutdown();
      } catch {
        // Already gone.
      }
    }

    // peekSession, not loadSession: this is a passive reader on every page including marketing,
    // and loadSession() clears an expired-but-refreshable session, which would sign the customer
    // out roughly every hour as a side effect of the messenger booting.
    const session = isSignedOut(pathname) ? null : peekSession();

    // Staff use the operations console's own support queue, not the customer inbox.
    if (session?.role === "SUPER_ADMIN") return;

    if (!session) {
      Intercom({ app_id: INTERCOM_APP_ID });
      return;
    }

    void (async () => {
      const [user_hash, companyName] = await Promise.all([
        identityHash(session),
        organizationName(session.tenantId),
      ]);
      if (cancelled) return;

      Intercom({
        app_id: INTERCOM_APP_ID,
        user_id: session.sub,
        email: session.email,
        ...optionalProfile(session.idToken),
        ...(user_hash ? { user_hash } : {}),
        company: {
          company_id: session.tenantId,
          ...(companyName ? { name: companyName } : {}),
        },
        // Custom attributes, so whoever picks up the conversation already knows who they are
        // talking to and what they are allowed to do without asking.
        amazflow_role: session.role,
        amazflow_tenant: session.tenantId,
        amazflow_surface: "customer_console",
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}


/**
 * Opens the messenger on a fresh message. Falls back to email if the messenger never loaded --
 * an ad blocker, a strict network, or a failed script should still leave the customer a way to
 * reach a human rather than a button that silently does nothing.
 */
export function openSupportChat(prefill = ""): void {
  try {
    if (typeof window.Intercom === "function") {
      window.Intercom("showNewMessage", prefill);
      return;
    }
  } catch {
    // Fall through to email.
  }
  window.location.href = "mailto:support@amazflow.com";
}
