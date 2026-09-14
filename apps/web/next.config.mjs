import { withSentryConfig } from "@sentry/nextjs/config";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true
};

// `tunnelRoute` (the usual recommendation, to route Sentry ingest through a same-origin API
// route so ad-blockers don't drop it) is deliberately omitted: it needs a live Next.js API
// route to proxy through, and this app has no server -- `output: "export"` above is the whole
// reason (see instrumentation-client.ts). Some fraction of client errors will be lost to ad
// blockers as a result; there is no server-side path around that on a static export.
export default withSentryConfig(nextConfig, {
  org: "amazflow",
  project: "javascript-nextjs",

  // Build-time secret, not set yet -- source maps silently do not upload without it. See
  // docs/DEPLOYING.md for where this repo's other CI secrets live.
  authToken: process.env.SENTRY_AUTH_TOKEN,

  widenClientFileUpload: true,
  silent: !process.env.CI,
});
