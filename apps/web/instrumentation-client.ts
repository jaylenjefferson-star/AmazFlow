import * as Sentry from "@sentry/nextjs";

// Sentry error monitoring + session replay for the marketing/auth surface (amazflow.com).
//
// Client-only, deliberately. `output: "export"` (next.config.mjs) means none of the three
// AmazFlow surfaces run a Next.js server in production -- Amplify serves the static bundle
// directly, and design decision D-2 makes the control plane the authorization boundary instead.
// So `sentry.server.config.ts`, `sentry.edge.config.ts`, and `instrumentation.ts`'s
// `onRequestError` hook -- everything the standard Next.js setup wires up for server/edge
// runtimes -- would never execute against the deployed app; there is no server process for them
// to run in. Only this file, the browser SDK, does anything here.
//
// `instrumentation-client.ts` is the current convention (Next.js replaced the older
// `sentry.client.config.ts` pattern).
Sentry.init({
  dsn: "https://51a9b8273b74c20a19b1c22ef11c7bdb@o4512082843074560.ingest.us.sentry.io/4512082846285824",

  integrations: [Sentry.replayIntegration()],
  // Session Replay
  replaysSessionSampleRate: 0.1, // This sets the sample rate at 10%. You may want to change it to 100% while in development and then sample at a lower rate in production.
  replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.
});

// App Router navigation spans -- no-op without tracesSampleRate set, harmless either way.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
