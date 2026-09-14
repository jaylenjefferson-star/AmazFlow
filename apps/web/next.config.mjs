/** @type {import('next').NextConfig} */
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig = {
  output: "export",
  trailingSlash: true,
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  silent: !process.env.CI,
});
