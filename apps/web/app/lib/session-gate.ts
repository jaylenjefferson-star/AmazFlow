// The one place an authenticated surface decides whether the person in front of it may be here.
//
// Four surfaces (/app, /console, /console/settings, /console/support) each carried their own copy of
// the same mount effect: resolve the session, redirect to /login if there isn't one, redirect
// somewhere else if the role is wrong, otherwise store it in state. Four copies of an authorization
// decision is four chances for one of them to drift -- and they had already drifted, in the detail
// that matters most: only /app remembered to distinguish "your session expired" from "you were never
// signed in", so the other three sent people to a bare /login with no explanation of why they had
// been kicked out.
//
// Requirement 4.5 asks for two DISTINCT operations, and that distinction is the reason this file
// exists rather than a single do-everything helper:
//
//   peekSession()           -- a passive read. Never redirects, never clears, never refreshes. For
//                              anything that merely wants to know who this browser belongs to (a
//                              marketing page deciding whether to say "Open console"). Lives in
//                              cognito-auth.ts next to the storage it reads.
//   enforceSessionAccess()  -- an access check. Refreshes if it can, redirects if it cannot, and
//                              resolves to a session only when the caller may proceed.
//
// Conflating them is how a bystander signs someone out: loadSession() deletes an expired session,
// which is right for a gate and wrong for a reader.

import { type Session, resolveSession } from "./cognito-auth";
import type { AmazFlowRole } from "@amazflow/workflow-schema";

const STORAGE_KEY = "amazflow_session";

export type SessionGateOptions = {
  /** Where to return after signing in. The surface's own path, e.g. "/console/settings/". */
  returnTo: string;
  /** May this session be here? */
  allow: (session: Session) => boolean;
  /**
   * Where an authenticated session that is NOT allowed here should go instead. This is a
   * redirect, not a refusal: a staff member landing on /console belongs on /app, and telling them
   * "forbidden" would be both unhelpful and untrue.
   */
  elsewhere: (session: Session) => string;
};

/**
 * The redirecting access check.
 *
 * Resolves to the session when the caller may proceed, or to null when a redirect has been started
 * -- in which case the caller must render nothing and change no state, because the page is on its
 * way out. Returning null rather than throwing keeps the call site a plain `if (!session) return`.
 */
export async function enforceSessionAccess(options: SessionGateOptions): Promise<Session | null> {
  // Read before resolving: resolveSession() clears storage when a refresh fails, so asking
  // afterwards can no longer tell "expired" from "never signed in". That distinction is the whole
  // difference between "Your session expired, sign in again" and an unexplained login page.
  const hadStoredSession = hasStoredSession();
  const session = await resolveSession();

  if (!session) {
    const reason = hadStoredSession ? "&reason=expired" : "";
    redirect(`/login?next=${encodeURIComponent(options.returnTo)}${reason}`);
    return null;
  }
  if (!options.allow(session)) {
    redirect(options.elsewhere(session));
    return null;
  }
  return session;
}

function hasStoredSession(): boolean {
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

// assign() rather than replace() for the login redirect would leave the gated page in history, so
// Back returns to a surface the person is not allowed on. replace() drops it.
function redirect(path: string) {
  window.location.replace(path);
}

/* --------------------------------------------------------------------- surface definitions ----- */

// Which surface serves which role, in one place. The old arrangement spread this across four files
// and encoded the /app-vs-/console split three times with slightly different wording.
export const isStaff = (session: Session) => session.role === "SUPER_ADMIN";
export const isCustomer = (session: Session) => !isStaff(session);

/**
 * The internal console at /app. Staff only; a customer is sent to their own console rather than
 * being told they are forbidden.
 */
export const staffSurface = (returnTo: string, customerPath = "/console/"): SessionGateOptions => ({
  returnTo,
  allow: isStaff,
  elsewhere: () => customerPath,
});

/**
 * A surface every authenticated role reaches, staff and customer alike.
 *
 * This exists for account self-service. Changing your own password is not a capability that some
 * roles have and others do not -- it is the one thing every account holder must be able to do
 * without asking an administrator, and routing a FRONTLINE user to a CLIENT_ADMIN-gated settings
 * page to find it would mean they simply never could. So: signed in is the only requirement, and
 * there is no `elsewhere` worth computing, because nobody signed in is in the wrong place here.
 */
export const anySignedInSurface = (returnTo: string): SessionGateOptions => ({
  returnTo,
  allow: () => true,
  elsewhere: () => returnTo,
});

/**
 * A customer surface. Staff are sent to the matching internal path; customers whose role does not
 * reach this particular surface are sent back to their console home.
 */
export const customerSurface = (
  returnTo: string,
  options: { staffPath: string; requireRole?: AmazFlowRole; fallbackPath?: string } = { staffPath: "/app/" },
): SessionGateOptions => ({
  returnTo,
  allow: (session) =>
    isCustomer(session) && (!options.requireRole || session.role === options.requireRole),
  elsewhere: (session) =>
    isStaff(session) ? options.staffPath : (options.fallbackPath ?? "/console/"),
});
