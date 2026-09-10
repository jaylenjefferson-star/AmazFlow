// The typed control-plane client, shared by all three surfaces.
//
// Task 9.3. This is the extraction of `apps/web/app/lib/api-client.ts`, which already owned the two
// cases that actually strand a person mid-session (an id token that expired between the mount-time
// gate and this request; an account deactivated while its session stayed live). The extraction is
// what makes those behaviours available to the customer app and the internal console without a third
// and fourth copy of them -- copies being precisely how the four auth gates got out of step before
// Phase 1.
//
// Two things are deliberately NOT in here:
//
//   * The identity provider. This module never imports Cognito. It takes a `SessionTransport`
//     describing how to refresh and how to end a session, and the surface supplies one. That keeps
//     the client testable with no network and no user pool, and it means swapping the provider is a
//     change in one adapter rather than in every caller.
//   * Any decision about WHERE the token is stored. Open question Q-3 is held at its conservative
//     answer: the bearer token continues to ride in an `Authorization` header and continues to live
//     in whatever storage the surface already uses. Moving it to an httpOnly cookie is a real
//     improvement and a real cross-origin redesign; it is not this restructure's to make, and
//     pretending otherwise would put a session change inside a release that already moves every
//     surface.

/* ==================================================================================== session = */

/**
 * The minimum a session must carry for this client to work.
 *
 * Structural rather than nominal on purpose: `apps/web`'s richer `Session` (with `email`, `role`,
 * `expiresAt`) satisfies it as-is, so the adapter needs no mapping layer.
 */
export type ApiSession = {
  idToken: string;
  refreshToken?: string;
  tenantId: string;
};

/**
 * How a surface renews and ends a session.
 *
 * `refresh` resolving means the retry proceeds; `refresh` throwing means the session is finished.
 * `endSession` is expected to navigate away -- see `neverResolves` below for why that matters.
 */
export type SessionTransport<S extends ApiSession = ApiSession> = {
  refresh: (session: S) => Promise<S>;
  endSession: (session: S) => Promise<void>;
  /** Called with the renewed session so the surface can persist it. */
  persist?: (session: S) => void;
};

/* ====================================================================================== errors = */

export class ApiError extends Error {
  status: number;
  /** Stable machine-readable code from the control plane's error envelope, when present. */
  code: string | null;
  /**
   * Correlation identifier, so a support conversation can name the exact request.
   *
   * Requirement 28.1/28.2: the identifier is propagated in both directions. It is sent on the way
   * out as `x-correlation-id` and read back off the response envelope, which is what lets a person
   * reading an error screen and an engineer reading a log line be looking at the same request.
   */
  correlationId: string | null;
  constructor(status: number, message: string, code: string | null, correlationId: string | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

/**
 * The support-referenceable form of a correlation identifier.
 *
 * Six uppercase base32 characters with the ambiguous ones (I, L, O, U, 0, 1) removed, so a person
 * can read it down a phone line without a spelling alphabet. Derived rather than stored: the same
 * correlation identifier always yields the same code, so support can go from the code a customer
 * read out back to the log line.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

export function supportCode(correlationId: string | null | undefined): string | null {
  if (!correlationId) return null;
  let hash = 0x811c9dc5;
  for (let i = 0; i < correlationId.length; i++) {
    hash ^= correlationId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += CODE_ALPHABET[hash % CODE_ALPHABET.length];
    hash = Math.floor(hash / CODE_ALPHABET.length) + Math.imul(hash, 2654435761) % 97;
    hash = hash >>> 0;
  }
  return `ERR-${out}`;
}

/* ====================================================================================== client = */

export type ApiCallOptions = {
  method?: string;
  body?: unknown;
  /** Correlation identifier to send. One is generated when absent. */
  correlationId?: string;
  signal?: AbortSignal;
};

export type ApiClient = {
  request: <T = unknown>(path: string, options?: ApiCallOptions) => Promise<T>;
  get: <T = unknown>(path: string) => Promise<T>;
  post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  put: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  del: <T = unknown>(path: string) => Promise<T>;
  /** The session the client is currently using, after any renewal. */
  session: () => ApiSession;
};

export function newCorrelationId(): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return random;
}

/**
 * Build a client bound to one session and one transport.
 *
 * The session is held in a mutable cell rather than passed per call, because a renewal has to be
 * visible to the NEXT call: a provider polling every fifteen seconds with a stale token would
 * refresh on every tick and hammer the identity provider once an hour after expiry.
 */
export function createApiClient<S extends ApiSession>(
  baseUrl: string,
  initial: S,
  transport: SessionTransport<S>,
  fetchImpl: typeof fetch = fetch,
): ApiClient {
  let active = initial;

  const request = async <T,>(path: string, options: ApiCallOptions = {}): Promise<T> => {
    let refreshed = false;
    const correlationId = options.correlationId ?? newCorrelationId();

    for (;;) {
      const response = await send(fetchImpl, baseUrl, active, path, options, correlationId);

      if (response.status === 401 && !refreshed && active.refreshToken) {
        // Exactly one refresh attempt, then exactly one retry (requirement 4.12). Refreshing in a
        // loop on repeated 401s turns a revoked refresh token into a request storm; refreshing zero
        // times forces a re-login every hour.
        refreshed = true;
        try {
          active = await transport.refresh(active);
        } catch {
          await transport.endSession(active);
          return neverResolves<T>();
        }
        transport.persist?.(active);
        continue;
      }

      const parsed = await readBody(response);
      const envelopeCorrelation = text(parsed.correlationId) ?? response.headers.get("x-correlation-id") ?? correlationId;

      if (response.status === 401) {
        await transport.endSession(active);
        return neverResolves<T>();
      }

      // A deactivated account is not a permission problem the person can act on, so it ends the
      // session rather than rendering an error they cannot clear (requirement 4.14).
      if (response.status === 403 && parsed.code === "ACCOUNT_DISABLED") {
        await transport.endSession(active);
        return neverResolves<T>();
      }

      if (!response.ok)
        throw new ApiError(
          response.status,
          // Prefer the envelope's displayable message, fall back to the flat `error` field the
          // deployed control plane has always sent, then to something honest about not knowing.
          text(parsed.message) ?? text(parsed.error) ?? `Request failed (${response.status})`,
          text(parsed.code),
          envelopeCorrelation,
        );

      return parsed.body as T;
    }
  };

  return {
    request,
    get: (path) => request(path),
    post: (path, body) => request(path, { method: "POST", body }),
    put: (path, body) => request(path, { method: "PUT", body }),
    del: (path) => request(path, { method: "DELETE" }),
    session: () => active,
  };
}

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

function send(
  fetchImpl: typeof fetch,
  baseUrl: string,
  session: ApiSession,
  path: string,
  options: ApiCallOptions,
  correlationId: string,
) {
  return fetchImpl(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      "x-correlation-id": correlationId,
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
}

async function readBody(response: Response): Promise<Record<string, unknown> & { body: unknown }> {
  const raw = await response.text().catch(() => "");
  if (!raw) return { body: null };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // The control plane sends both the flat legacy fields and the structured envelope
    // (`{ error: { code, message, correlationId } }`), so flatten the envelope's members up to
    // where the caller looks for them.
    const envelope = parsed.error && typeof parsed.error === "object" ? (parsed.error as Record<string, unknown>) : {};
    return { ...envelope, ...parsed, body: parsed };
  } catch {
    return { body: raw, message: raw };
  }
}

// A transport's `endSession` navigates away. Returning a promise that never settles keeps callers
// from rendering against a session that has just been torn down, rather than handing them a null
// every one of them would have to remember to check.
function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => {});
}
