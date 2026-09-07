import Link from "next/link";
import { MarketingFooter, MarketingNav, WorkflowVisual } from "./site-components";
import "./marketing.css";

const solutions = [
  ["People operations", "Onboarding, offboarding, access changes, HRIS updates, and the trackers around them.", "People", "#ff8c70"],
  ["Healthcare operations", "Administrative workflows across records, portals, spreadsheets, and inboxes—with human control.", "Health", "#b8dfca"],
  ["Customer operations", "Account maintenance, ticket actions, verification, and cross-system follow-through.", "Customer", "#bfcdf8"],
  ["Finance operations", "Reconciliation, document handling, ERP entry, review queues, and exception routing.", "Finance", "#f2d47d"],
  ["IT operations", "Provisioning, deprovisioning, approved access work, tickets, and audit-ready execution.", "IT", "#d9c6f1"],
  ["Business operations", "Spreadsheet execution, data entry, queue management, reporting, and repetitive SOPs.", "BizOps", "#f4b8c3"],
];

export default function MarketingHome() {
  return <div className="marketing-site">
    <MarketingNav />
    <main>
      <section className="hero wrap">
        <div className="hero-copy">
          <div className="kicker"><span /> AI OPERATIONS EXECUTION</div>
          <h1>Your team<br />shouldn’t be<br /><em>the API.</em></h1>
          <p>AmazFlow executes repetitive work across the applications, spreadsheets, websites, inboxes, and systems your team already uses.</p>
          <div className="hero-actions"><Link className="button primary" href="/contact">Find a workflow to automate <b>↗</b></Link><Link className="button quiet" href="/app">See the live product</Link></div>
          <small className="hero-note">Start with one workflow. Prove the value. Expand from there.</small>
        </div>
        <WorkflowVisual />
      </section>

      <section className="proof-strip"><div className="wrap"><p>One execution layer for every operations team</p><div>{["PEOPLE", "HEALTHCARE", "CUSTOMER", "FINANCE", "IT", "BUSINESS OPS"].map((item) => <span key={item}>{item}</span>)}</div></div></section>

      <section className="problem wrap section">
        <div className="section-label">THE BETWEEN-SOFTWARE PROBLEM</div>
        <h2>Somehow, your most expensive people are still <i>copying and pasting.</i></h2>
        <div className="before-after">
          <article className="messy"><div className="mini-title"><span>BEFORE</span> Humans as middleware</div><div className="messy-flow"><b>Sheet</b><i>→</i><strong>Person</strong><i>→</i><b>Portal</b><i>→</i><strong>Person</strong><i>→</i><b>CRM</b></div><p>Tabs. Re-keying. Follow-ups. Broken handoffs. Work nobody was hired to love.</p></article>
          <article className="clean"><div className="mini-title"><span>AFTER</span> AmazFlow in the middle</div><div className="clean-flow"><b>Sheet</b><i>→</i><strong><mark>A</mark> AmazFlow</strong><i>→</i><div><b>Portal</b><b>CRM</b><b>Inbox</b></div><i>→</i><strong>Done ✓</strong></div><p>A configured workflow executes, verifies the result, and asks a person only when judgment is needed.</p></article>
        </div>
      </section>

      <section className="how section"><div className="wrap"><div className="section-label">HOW IT WORKS</div><h2>Show us the work.<br /><i>We’ll handle the repetition.</i></h2><div className="how-grid">
        <article><span>01</span><div className="how-icon connect">⌁</div><h3>Connect</h3><p>Work across browsers, spreadsheets, APIs, inboxes, files, and internal tools.</p></article>
        <article><span>02</span><div className="how-icon build">◇</div><h3>Configure</h3><p>Turn the SOP into governed triggers, decisions, actions, approvals, and exceptions.</p></article>
        <article><span>03</span><div className="how-icon run">↗</div><h3>Execute</h3><p>AmazFlow performs the routine work, verifies completion, and leaves a complete audit trail.</p></article>
      </div><Link className="text-link" href="/product">Explore the execution platform →</Link></div></section>

      <section className="capability section wrap"><div className="section-label">ONE ENGINE. LESS BUSYWORK.</div><div className="cap-head"><h2>Works where your<br />team <i>already works.</i></h2><p>AmazFlow chooses the right execution surface for each configured step while the cloud control plane keeps the workflow governed.</p></div><div className="cap-grid">
        <article className="browser-card"><div className="fake-browser"><div className="browser-top"><i /><i /><i /><span>people.example.com</span></div><div className="browser-body"><div className="search">Sarah Chen</div><div className="profile"><span>SC</span><div><b>Sarah Chen</b><small>Employee E-10042</small></div><mark>ACTIVE</mark></div><button>Disable account</button><div className="cursor">↖</div></div></div><h3>Browser agent</h3><p>Authorized UI execution when a system doesn’t offer the API you need.</p></article>
        <article><div className="cap-graphic sheets"><span>A</span><div>NEW</div><div>RUNNING</div><div>COMPLETE ✓</div></div><h3>Spreadsheets</h3><p>Turn operational trackers into reliable triggers, queues, and destinations.</p></article>
        <article><div className="cap-graphic ai"><span>Input</span><b>✦</b><div><i>Classify</i><i>Extract</i><i>Choose allowed action</i></div></div><h3>Bounded AI</h3><p>Use Amazon Bedrock for structured decisions inside deterministic guardrails.</p></article>
        <article><div className="cap-graphic approval"><small>Approval required</small><strong>$14,750</strong><div><span>Review</span><b>Approve ✓</b></div></div><h3>Human control</h3><p>Decide what runs automatically, what needs approval, and what stays human.</p></article>
      </div></section>

      <section className="solutions section"><div className="wrap"><div className="section-label">ACROSS THE BUSINESS</div><div className="cap-head"><h2>One platform.<br /><i>A lot of workflows.</i></h2><Link className="text-link" href="/solutions">See all solutions →</Link></div><div className="solution-grid">{solutions.map(([title, copy, label, color]) => <article key={title} style={{ "--card-accent": color } as React.CSSProperties}><span>{label}</span><h3>{title}</h3><p>{copy}</p><b>Explore →</b></article>)}</div></div></section>

      <section className="control section wrap"><div className="control-copy"><div className="section-label">CONTROL WITHOUT THE CHAOS</div><h2>Automation.<br /><i>Without the YOLO.</i></h2><p>Every workflow is configured, permissioned, versioned, observed, and verified. AI can recommend or choose among allowed actions—it never gets a blank check to operate your systems.</p><ul><li><span>✓</span> Human approval thresholds</li><li><span>✓</span> Tenant-separated access</li><li><span>✓</span> Immutable execution history</li><li><span>✓</span> Exceptions routed to the right person</li></ul><Link className="button dark" href="/security">Explore security</Link></div><div className="audit-card"><div className="audit-title"><span className="pulse" /> Execution AF-2048 <mark>VERIFIED</mark></div>{[["09:41:02", "Work item received", "SYSTEM"],["09:41:04", "Employee identity matched", "POLICY"],["09:41:08", "Account status changed", "AGENT"],["09:41:09", "Expected state confirmed", "VERIFY"],["09:41:10", "Workflow completed", "AUDIT"]].map(([time,event,actor], i) => <div className="audit-row" key={event}><span>{i === 4 ? "✓" : "·"}</span><time>{time}</time><b>{event}</b><small>{actor}</small></div>)}</div></section>

      <section className="security-banner"><div className="wrap"><div><div className="section-label light">SECURITY-SENSITIVE BY DESIGN</div><h2>Built to do the work.<br /><i>Built to earn the access.</i></h2></div><div className="security-copy"><p>Least privilege, encryption, auditability, tenant isolation, scoped execution, and human controls are part of the architecture—not a layer we plan to add later.</p><div className="security-pills"><span>BAA-supported deployments*</span><span>AWS-native foundation</span><span>SOC 2 readiness program</span></div><small>*Available for eligible HIPAA-regulated workflows. AmazFlow does not claim SOC 2 attestation or blanket HIPAA compliance.</small></div></div></section>

      <section className="pilot section wrap"><div className="pilot-stamp">30<br /><small>DAY</small></div><div><div className="section-label">DESIGN PARTNER PROGRAM</div><h2>Start with the workflow<br />your team <i>hates most.</i></h2><p>We map the process, baseline its cost, configure the execution, run it with your team, and deliver a measured impact report.</p><div className="pilot-steps"><span>01 Map</span><span>02 Build</span><span>03 Run</span><span>04 Prove</span></div></div><div className="pilot-action"><strong>One workflow.<br />Real operating proof.</strong><Link className="button primary" href="/contact">Apply to be a design partner ↗</Link></div></section>

      <section className="final-cta"><div className="wrap"><div className="orbit one">Sheet</div><div className="orbit two">Portal</div><div className="orbit three">Inbox</div><h2>Less busywork.<br /><i>More actual work.</i></h2><p>Your operations team has better things to do than move information between software.</p><div><Link className="button dark" href="/contact">Find a workflow to automate ↗</Link><Link className="button quiet" href="/app">View product demo</Link></div></div></section>
    </main>
    <MarketingFooter />
  </div>;
}
