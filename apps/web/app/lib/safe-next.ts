// Where /login is allowed to send someone after they sign in.
//
// This used to live inline in login/page.tsx and accepted same-origin relative paths only. That
// was correct while every authenticated surface was a path on amazflow.com. It stopped being
// correct the moment the customer and internal apps moved to their own origins: both of them hand
// /login an absolute `next` (apps/customer/app/session.ts, apps/internal/app/session.ts), the
// relative-only guard rejected it as unsafe, and the caller silently fell back to
// loginPathFor(role) -- so anyone bounced through login from app.amazflow.com landed on the legacy
// /app or /console console instead of where they were going, with nothing to indicate the
// destination had been dropped.
//
// The strictness was never the bug; honouring an arbitrary absolute URL here is an open redirect.
// So absolute destinations are matched against an explicit origin allowlist, and everything else
// keeps the original relative-path rule.
//
// These are the same origins the control plane allows in CORS
// (infrastructure/aws-cdk/amazflow-dev.yaml). Adding a fourth surface means adding it in both
// places; they are deliberately short lists rather than a pattern, because a pattern is how
// "app.amazflow.com.evil.test" gets in.
export const RETURN_ORIGINS = ["https://app.amazflow.com", "https://admin.amazflow.com"] as const;

export function isSafeNext(next: string | null): next is string {
  if (!next) return false;

  // A relative path: "/foo" is fine, "//evil.test" is protocol-relative and resolves to another
  // host, and anything carrying a scheme is not the relative path it is pretending to be.
  if (next.startsWith("/")) return !next.startsWith("//") && !next.includes("://");

  // An absolute destination is honoured only when its parsed origin is exactly one of ours.
  // Parsing is load-bearing: a startsWith check against the same list would accept
  // "https://app.amazflow.com.evil.test/" and "https://app.amazflow.com@evil.test/".
  try {
    return (RETURN_ORIGINS as readonly string[]).includes(new URL(next).origin);
  } catch {
    return false;
  }
}
