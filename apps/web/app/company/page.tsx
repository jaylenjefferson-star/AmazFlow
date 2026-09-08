import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, StandardPage } from "../site-components";
import "../marketing.css";

export const metadata: Metadata = { title: "Company", description: "AmazFlow is building the execution layer for operations." };
export default function CompanyPage() {
  return (
    <StandardPage>
      <PageHero eyebrow="ABOUT AMAZFLOW" title="People shouldn't be" accent="the integration layer." copy="AmazFlow exists because critical operations still depend on people copying, pasting, re-keying, checking, chasing, and updating the software around the real work." />

      <section className="subpage-section alt">
        <div className="wrap copy-block">
          <div className="section-label">OUR THESIS</div>
          <h2>The missing layer isn't another system of record. It's execution.</h2>
          <p>Companies already have an HRIS, CRM, ticketing platform, portals, spreadsheets, inboxes, and internal tools. Yet the work between those systems remains painfully manual. AmazFlow coordinates that work without asking teams to replace everything underneath it.</p>
          <p>We are beginning with design partners who have operations-heavy workflows and want measurable proof: fewer manual touches, faster processing, better verification, visible exceptions, and a trustworthy audit trail.</p>
          <Link className="button primary" href="/contact">Build with AmazFlow ↗</Link>
        </div>
      </section>

      <section className="subpage-section">
        <div className="wrap">
          <div className="section-label">TEAM</div>
          <h2>Who's building this.</h2>
          <div className="team-grid">
            <article className="team-card cms-placeholder">
              <span className="cms-placeholder-tag">CMS placeholder</span>
              <div className="team-avatar" aria-hidden="true" />
              <b>[Founder name]</b>
              <p>[Background and relevant operating experience — operations, automation, or the industry AmazFlow serves first.]</p>
            </article>
          </div>
        </div>
      </section>

      <section className="subpage-section alt">
        <div className="wrap">
          <div className="section-label">DESIGN-PARTNER EVIDENCE</div>
          <h2>Proof, as it happens — not before.</h2>
          <p className="copy-block">We'd rather show one real, measured engagement than describe a hypothetical one. This section fills in as design partners complete their first workflow.</p>
          <div className="subpage-grid">
            <article className="subpage-card cms-placeholder"><span className="cms-placeholder-tag">CMS placeholder</span><p>Design-partner name, workflow, and the measured before/after — added after the first engagement completes.</p></article>
            <article className="subpage-card cms-placeholder"><span className="cms-placeholder-tag">CMS placeholder</span><p>A direct quote from an operations lead who ran the workflow, once we have one to publish.</p></article>
          </div>
        </div>
      </section>

      <section className="subpage-section">
        <div className="wrap subpage-grid">
          <article className="subpage-card"><span className="number">01</span><h3>Practical first</h3><p>We begin with a painful workflow and a measurable result — not a vague transformation program.</p></article>
          <article className="subpage-card"><span className="number">02</span><h3>Humans in control</h3><p>People define policy, approvals, exceptions, and accountability. Automation handles repetition.</p></article>
          <article className="subpage-card"><span className="number">03</span><h3>Built to expand</h3><p>One engine can support People, Healthcare, Customer, Finance, IT, and Business Operations — see <Link href="/solutions">Solutions</Link>.</p></article>
        </div>
      </section>
    </StandardPage>
  );
}
