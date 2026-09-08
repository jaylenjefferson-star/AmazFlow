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
          <div className="section-label">FOUNDER</div>
          <h2>Who's building this.</h2>
          <div className="founder-spotlight">
            <img className="founder-photo" src="/team/jay-jefferson.jpg" alt="Jay Jefferson, founder of AmazFlow" width={140} height={140} />
            <div>
              <b>Jay Jefferson</b>
              <p>Jay founded AmazFlow after years running healthcare operations from the inside — most recently at Virta Health and Oracle. He watched capable teams get consumed by the work between systems: re-entering the same data across five tools, chasing approvals by hand, closing out queues at the end of every day just to keep operations moving. That firsthand view of the waste is why AmazFlow exists.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="subpage-section alt">
        <div className="wrap">
          <div className="section-label">CUSTOMER FEEDBACK</div>
          <h2>What operations leaders say.</h2>
          <p className="copy-block">Direct feedback from six operations leaders running AmazFlow in their teams today, across people operations, customer experience, and healthcare. We're building toward a fully quantified case study next — for now, here's what they told us.</p>
          <div className="testimonial-grid">
            <article className="testimonial-card">
              <p className="testimonial-quote">"AmazFlow has created meaningful savings for our People Operations team. We're spending far less time coordinating repetitive workflows and more time focused on higher-value initiatives, including employee experience and strategic people programs."</p>
              <div className="testimonial-attribution"><b>Ariana</b><span>VP of People · 1,000-employee organization</span></div>
            </article>
            <article className="testimonial-card">
              <p className="testimonial-quote">"Our CX teams are able to spend more time on the member experience and complex escalations instead of managing work through spreadsheets. We've seen meaningful labor savings, and the team has been able to move away from a lot of manual tracking and coordination."</p>
              <div className="testimonial-attribution"><b>Tom</b><span>Senior Director of Customer Experience · E-commerce company</span></div>
            </article>
            <article className="testimonial-card">
              <p className="testimonial-quote">"What stands out about AmazFlow is that it's solving for the actual operational work, not just adding another layer of software. The opportunity to take repetitive coordination off teams and give that capacity back is significant."</p>
              <div className="testimonial-attribution"><b>Maya</b><span>VP of Operations · Healthcare technology company</span></div>
            </article>
            <article className="testimonial-card">
              <p className="testimonial-quote">"AmazFlow is addressing the kind of workflow bottlenecks that teams often learn to live with. The value is in redesigning the process so people are not constantly working around broken or manual steps."</p>
              <div className="testimonial-attribution"><b>Daniel</b><span>Executive Operations Leader · Healthcare services organization</span></div>
            </article>
            <article className="testimonial-card">
              <p className="testimonial-quote">"The strongest part of the AmazFlow model is the focus on execution. There are a lot of tools that help teams organize work. This is focused on actually moving the work forward."</p>
              <div className="testimonial-attribution"><b>Lauren</b><span>VP of Clinical Operations · Digital health company</span></div>
            </article>
            <article className="testimonial-card">
              <p className="testimonial-quote">"AmazFlow reflects how operators actually think about these problems. It connects workflow, customer experience, ownership, and automation instead of treating each one as a separate issue."</p>
              <div className="testimonial-attribution"><b>Marcus</b><span>Senior Executive · Healthcare operations organization</span></div>
            </article>
          </div>
          <p className="subpage-card cms-placeholder" style={{ marginTop: 16, maxWidth: 480 }}><span className="cms-placeholder-tag">CMS placeholder</span>A fully quantified before/after — hours saved, error reduction, or cycle-time change — added once we can publish exact figures with a named engagement.</p>
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
