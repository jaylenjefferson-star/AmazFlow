import Link from "next/link";
import { MarketingFooter, MarketingNav, SkipLink, WorkflowVisual } from "./site-components";
import { FlagshipDemo } from "./flagship-demo";
import "./marketing.css";

const expansions = [
  ["Healthcare operations", "/solutions#healthcare-operations"],
  ["Customer operations", "/solutions#customer-operations"],
  ["Finance operations", "/solutions#finance-operations"],
  ["IT operations", "/solutions#it-operations"],
  ["Business operations", "/solutions#business-operations"],
] as const;

const howItWorks = [
  ["01", "Connect", "Work across browsers, spreadsheets, APIs, inboxes, files, and internal tools."],
  ["02", "Configure", "Turn the SOP into governed triggers, decisions, actions, approvals, and exceptions."],
  ["03", "Execute", "AmazFlow performs the routine work, verifies completion, and leaves a complete audit trail."],
] as const;

export default function MarketingHome() {
  return (
    <div className="marketing-site">
      <SkipLink />
      <MarketingNav />
      <main id="main">
        <section className="hero wrap">
          <div className="hero-copy">
            <div className="kicker"><span aria-hidden="true" /> AI OPERATIONS EXECUTION</div>
            <h1>Your team<br />shouldn't be<br /><em>the API.</em></h1>
            <p>AmazFlow executes the repetitive work between your systems — reading a request, acting across spreadsheets, portals, and inboxes, and verifying it's actually done — while a person stays in control of every judgment call.</p>
            <div className="hero-actions">
              <Link className="button primary" href="/demo">Try the interactive demo <b>↗</b></Link>
              <Link className="button quiet" href="/contact">Talk to sales</Link>
            </div>
            <small className="hero-note">No account needed — see a full run in about two minutes.</small>
          </div>
          <WorkflowVisual />
        </section>

        <section className="proof-strip">
          <div className="wrap">
            <p>Built first for people operations. Expanding across the business.</p>
          </div>
        </section>

        <section className="flagship section" id="flagship-demo">
          <div className="wrap">
            <div className="section-label">SEE IT RUN</div>
            <h2>One workflow, start to finish.<br /><i>Every step, on the record.</i></h2>
            <p className="flagship-lede">Employee offboarding sounds simple until it touches five systems and outlives the person who started it. This is exactly what changes when AmazFlow runs it — click through the real steps below, including the approval.</p>
            <FlagshipDemo />
            <div className="expansion-row">
              <span>Built first for People Operations. It expands to:</span>
              <div className="expansion-chips">
                {expansions.map(([label, href]) => (
                  <Link className="expansion-chip" href={href} key={label}>{label} →</Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="credibility section">
          <div className="wrap">
            <div className="section-label">WHERE WE ARE TODAY</div>
            <h2>Early. Honest.<br /><i>Measured, not marketed.</i></h2>
            <div className="credibility-grid">
              <article className="credibility-card">
                <img className="founder-avatar" src="/team/jay-jefferson.jpg" alt="Jay Jefferson, founder of AmazFlow" width={44} height={44} />
                <b>Founded by an operator</b>
                <p>Jay Jefferson spent his career inside healthcare operations at Virta Health and Oracle, and built AmazFlow after seeing the busywork firsthand. <Link href="/company">More about Jay →</Link></p>
              </article>
              <article className="credibility-card">
                <b>Design-partner stage</b>
                <p>We're onboarding a small number of design partners and building the proof case with each one, in the open.</p>
              </article>
              <article className="credibility-card">
                <b>AWS-native from day one</b>
                <p>Tenant-isolated control plane, encrypted storage, and an immutable audit log — not something bolted on later. See <Link href="/security">how it's built</Link>.</p>
              </article>
              <article className="credibility-card cms-placeholder">
                <span className="cms-placeholder-tag">CMS placeholder</span>
                <p>First measured design-partner outcome — hours saved, error reduction, or cycle-time change — goes here once an engagement completes.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="how section">
          <div className="wrap">
            <div className="section-label">HOW IT WORKS</div>
            <h2>Show us the work.<br /><i>We'll handle the repetition.</i></h2>
            <div className="how-grid">
              {howItWorks.map(([n, title, copy]) => (
                <article key={title}>
                  <span aria-hidden="true">{n}</span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
            <Link className="text-link" href="/product">Explore the execution model →</Link>
          </div>
        </section>

        <section className="control-security section">
          <div className="wrap">
            <div className="section-label light">PRODUCT CONTROL &amp; SECURITY</div>
            <h2>Automation with boundaries.<br /><i>Never a blank check.</i></h2>
            <div className="control-grid">
              <div className="control-copy">
                <p>Every workflow is configured, permissioned, versioned, observed, and verified. AI can recommend or choose among allowed actions — it never gets standing authority to operate your systems on its own.</p>
                <ul>
                  <li><span aria-hidden="true">✓</span> Human approval thresholds</li>
                  <li><span aria-hidden="true">✓</span> Tenant-separated access</li>
                  <li><span aria-hidden="true">✓</span> Immutable execution history</li>
                  <li><span aria-hidden="true">✓</span> Exceptions routed to the right person</li>
                </ul>
                <Link className="button quiet on-dark" href="/security">Explore security →</Link>
              </div>
              <div className="audit-card">
                <div className="audit-title"><span className="pulse" aria-hidden="true" /> Example execution AF-2048 <mark>SYNTHETIC DATA</mark></div>
                {[["09:41:02", "Work item received", "SYSTEM"], ["09:41:04", "Employee identity matched", "POLICY"], ["09:41:08", "Account status changed", "AGENT"], ["09:41:09", "Expected state confirmed", "VERIFY"], ["09:41:10", "Workflow completed", "AUDIT"]].map(([time, event, actor], i) => (
                  <div className="audit-row" key={event}>
                    <span aria-hidden="true">{i === 4 ? "✓" : "·"}</span><time>{time}</time><b>{event}</b><small>{actor}</small>
                  </div>
                ))}
              </div>
            </div>
            <div className="security-pills">
              <span>BAA-supported deployments*</span>
              <span>AWS-native foundation</span>
              <span>SOC 2 readiness program</span>
            </div>
            <small className="security-footnote">*Available for eligible HIPAA-regulated workflows. AmazFlow does not claim SOC 2 attestation or blanket HIPAA compliance — see <Link href="/security">where we stand today</Link>.</small>
          </div>
        </section>

        <section className="pilot section wrap">
          <div className="pilot-stamp">30<br /><small>DAY</small></div>
          <div>
            <div className="section-label">DESIGN PARTNER PROGRAM</div>
            <h2>Start with the workflow<br />your team <i>hates most.</i></h2>
            <p>We map the process, baseline its cost, configure the execution, run it with your team, and deliver a measured impact report.</p>
            <div className="pilot-steps">
              <span>01 Map</span><span>02 Build</span><span>03 Run</span><span>04 Prove</span>
            </div>
          </div>
          <div className="pilot-action">
            <strong>One workflow.<br />Real operating proof.</strong>
            <Link className="button primary" href="/contact">Apply to be a design partner ↗</Link>
          </div>
        </section>

        <section className="final-cta">
          <div className="wrap">
            <h2>Less busywork.<br /><i>More actual work.</i></h2>
            <p>Your operations team has better things to do than move information between software.</p>
            <div>
              <Link className="button dark" href="/demo">Try the interactive demo ↗</Link>
              <Link className="button quiet" href="/contact">Talk to sales</Link>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
