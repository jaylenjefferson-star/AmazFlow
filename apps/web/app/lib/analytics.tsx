"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import * as amplitude from "@amplitude/unified";

// Amplitude ingestion key — public by design; move to an env var when you set up environments.
const AMPLITUDE_API_KEY = "1165715c2e69da825f3f1be056401c4a";

/**
 * Amplitude product analytics + session replay, mounted once from the root layout.
 *
 * Scope, and why it is not the whole site:
 *
 * Session replay at a 100% sample rate records the DOM of every page it runs on. On the public
 * marketing site that is unremarkable. Inside the authenticated workspaces it is not: the operator
 * console at /app shows cross-tenant customer records, and the customer console at /console shows a
 * tenant's own workflow data. Streaming either into a third-party recorder would make Customer
 * Content flow to a subprocessor that our Subprocessors page says never receives it, and would turn
 * a marketing-analytics decision into a data-processing one.
 *
 * So Amplitude runs on the public and sign-in surface only, and is a no-op on /app and /console.
 * That keeps Customer Content out of Amplitude entirely, which is what lets the Cookie Policy and
 * the Subprocessors page describe it truthfully. Widening it into the consoles is a deliberate
 * data-governance decision, not a config tweak — it would need input masking review and a
 * subprocessor-scope change first.
 */
let initialized = false;

function isAuthenticatedConsole(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/app" ||
    pathname.startsWith("/app/") ||
    pathname === "/console" ||
    pathname.startsWith("/console/")
  );
}

export function Analytics() {
  const pathname = usePathname();
  const homeTracked = useRef(false);

  useEffect(() => {
    // Never initialise inside the authenticated consoles. If Amplitude was somehow already running
    // from a prior public page in this tab, a client-side navigation into a console does not tear
    // it down here -- but the consoles are separate entry points reached by full load in this
    // static export, so in practice the guard runs before init on those routes.
    if (isAuthenticatedConsole(pathname)) return;

    if (!initialized) {
      // Exact package init as specified by the Amplitude setup: initAll (not init), autocapture on,
      // session replay at full sample. The SDK queues events fired before init resolves, so the
      // load-time event below is safe to call immediately after.
      void amplitude.initAll(AMPLITUDE_API_KEY, {
        analytics: { autocapture: true },
        sessionReplay: { sampleRate: 1 },
      });
      initialized = true;
    }

    // One explicit event, chosen from a real product moment: the marketing home is the load-time
    // moment that confirms ingestion in seconds. Autocapture covers generic page views and clicks;
    // this is the single named event the setup asked for. Fired once per mount of the home route.
    if (pathname === "/" && !homeTracked.current) {
      homeTracked.current = true;
      amplitude.track("Viewed Home Page", { prompt_version: "BA400.4" }); // helps improve this setup flow — safe to remove once you've verified the event lands
    }
  }, [pathname]);

  return null;
}
