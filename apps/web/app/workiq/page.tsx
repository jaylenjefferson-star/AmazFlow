import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, StandardPage } from "../site-components";
import "../marketing.css";

export const metadata: Metadata = {
  title: "WorkIQ",
  description: "See how work actually happens, find repeatable patterns, and turn the best opportunities into AmazFlow automations.",
};

const signalCards = [
  ["01", "See the week", "An employee-first view of operational sessions, app and domain focus, active time, idle time, and context switches."],
  ["02", "Find the repeat", "WorkIQ surfaces observed-pattern hypotheses with sample size and confidence — never a black-box verdict."],
  ["03", "Make it real", "A confirmed opportunity becomes a reviewable AmazFlow workflow draft, with the evidence and assumptions attached."],
];

export default function WorkIQPage() {
  return (
    <StandardPage>
      <PageHero
        eyebrow="AMAZFLOW WORKIQ"
        title="Turn invisible work"
        accent="into your next advantage."
        copy="WorkIQ is the intelligence layer for AmazFlow. It shows where work actually happens, finds repeatable patterns, and helps your team move from observation to a governed automation in the same week."
      />

      <section className="workiq-hero-card wrap" aria-label="WorkIQ product preview">
        <div className="workiq-preview-head">
          <div>
            <span className="demo-badge">WORKIQ / OPERATIONS OVERVIEW</span>
            <h2>Tuesday, September 8 — your team at work</h2>
          </div>
          <span className="workiq-live">● LIVE METADATA</span>
        </div>
        <div className="workiq-preview-grid">
          <div className="workiq-preview-stat"><strong>42</strong><span>observed sessions</span><small>employee-visible</small></div>
          <div className="workiq-preview-stat"><strong>7</strong><span>repeatable patterns</span><small>hypotheses, not claims</small></div>
          <div className="workiq-preview-stat"><strong>3.4h</strong><span>estimated weekly upside</span><small>range shown in app</small></div>
          <div className="workiq-pattern">
            <span className="workiq-pattern-pill">OBSERVED-PATTERN HYPOTHESIS</span>
            <b>Invoice lookup → CRM update → approval request</b>
            <p>18 sessions · 6 employees · 86% confidence</p>
            <div><span className="workiq-bar"><i /></span><small>Ready for human review</small></div>
          </div>
        </div>
        <div className="workiq-preview-foot"><span>Metadata only. No keystroke content, messages, documents, or screenshots.</span><Link href="/security">Read the trust model →</Link></div>
      </section>

      <section className="section workiq-signal-section">
        <div className="wrap">
          <div className="section-label">THE WORKIQ LOOP</div>
          <h2>Observe the work.<br /><i>Upgrade the way it runs.</i></h2>
          <div className="workiq-signal-grid">
            {signalCards.map(([number, title, copy]) => (
              <article className="workiq-signal-card" key={title}>
                <span className="number">{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="workiq-split-section">
        <div className="wrap workiq-split">
          <div>
            <div className="section-label">BUILT FOR TRUST</div>
            <h2>Employees see themselves first.</h2>
            <p>WorkIQ is designed around visibility, not surveillance. Employees can see their own operational data, disputes change downstream classification, and team aggregates are suppressed when a group is too small to report safely.</p>
            <Link className="text-link" href="/security">Explore the privacy architecture →</Link>
          </div>
          <div className="workiq-trust-list">
            {["Employee-first visibility", "Default five-person aggregate floor", "Human confirmation before automation", "Demo data never mixed with real data"].map((item) => <div key={item}><span>✓</span><b>{item}</b></div>)}
          </div>
        </div>
      </section>

      <section className="final-cta">
        <div className="wrap">
          <h2>See the work.<br /><i>Then improve it.</i></h2>
          <p>WorkIQ is the new intelligence layer inside AmazFlow. Open the product workspace or bring us the process your team wants to upgrade first.</p>
          <div>
            <Link className="button dark" href="https://app.amazflow.com/workiq/">Open WorkIQ ↗</Link>
            <Link className="button quiet" href="/contact">Talk to sales</Link>
          </div>
        </div>
      </section>
    </StandardPage>
  );
}
