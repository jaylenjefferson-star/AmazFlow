import type { Metadata } from "next";
import Link from "next/link";
import { StandardPage } from "../site-components";
import { FlagshipDemo } from "../flagship-demo";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Interactive Demo",
  description: "Try a real AmazFlow workflow run — no account needed. See a work item arrive, systems get touched, a bounded AI decision, a human approval, and a verified result.",
};

export default function DemoPage() {
  return (
    <StandardPage>
      <section className="page-hero wrap">
        <div className="kicker"><span aria-hidden="true" /> TRY IT YOURSELF</div>
        <h1>No account.<br /><em>No setup. Just the run.</em></h1>
        <p>This is the same execution flow AmazFlow runs for a real customer — employee offboarding across HRIS, identity, and Slack. Click through it below, including the approval step, at your own pace.</p>
      </section>
      <section className="subpage-section demo-page-section">
        <div className="wrap">
          <FlagshipDemo />
        </div>
      </section>
      <section className="subpage-section alt">
        <div className="wrap demo-endcta">
          <div>
            <h2>Have a workflow like this one?</h2>
            <p>Tell us the systems involved and the volume, and we'll map what a first deployment looks like.</p>
          </div>
          <div className="demo-endcta-actions">
            <Link className="button primary" href="/contact">Talk to sales ↗</Link>
            <Link className="button quiet" href="/pricing">See pricing →</Link>
          </div>
        </div>
      </section>
    </StandardPage>
  );
}
