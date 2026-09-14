"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

// Catches errors in the root layout and otherwise-unhandled React render errors.
//
// This still runs in the deployed static export: it's a client-side React error boundary, not a
// server hook, so it works the same way in the browser regardless of whether a Next.js server
// exists behind it (it doesn't, here -- see instrumentation-client.ts).
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
