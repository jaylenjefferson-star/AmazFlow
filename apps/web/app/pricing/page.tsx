import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, StandardPage } from "../site-components";
import "../marketing.css";

export const metadata: Metadata = { title: "Pricing", description: "Start with one operational workflow, prove the value, and expand with AmazFlow." };

const plans = [
  {
    name: "Design Partner",
    tag: "RECOMMENDED STARTING POINT",
    price: "From $2,500",
    suffix: "/ month",
    setup: "Implementation from $5,000",
    who: "Teams piloting AmazFlow on their first workflow, before expanding.",
    allowance: "Up to 500 executions / month included",
    timing: "30-day guided implementation — see the Design Partner Program below.",
    support: "Founder-led support by email and a shared Slack channel.",
    items: ["One production workflow", "Baseline and ROI measurement", "Founder-led implementation", "Approvals, exceptions, and audit", "Defined execution allowance"],
  },
  {
    name: "Growth",
    tag: null,
    price: "From $5,000",
    suffix: "/ month",
    setup: "Implementation from $10,000",
    who: "Teams running two or more live workflows, ready for admin controls.",
    allowance: "Up to 2,500 executions / month included",
    timing: "4–6 week rollout across multiple workflows and approval routing.",
    support: "Priority email support, same-week response.",
    items: ["Multiple active workflows", "Cross-system execution", "Client operations administration", "Analytics and expanded controls", "BAA-supported options where eligible"],
  },
  {
    name: "Scale",
    tag: null,
    price: "Custom",
    suffix: "",
    setup: "For departments and enterprise teams",
    who: "Multi-department programs and enterprise procurement.",
    allowance: "Custom allowance, sized to your program",
    timing: "Scoped jointly with your security and procurement teams.",
    support: "Priority support with defined service terms.",
    items: ["Multi-department programs", "Advanced access and governance", "Custom connectors and volume", "Security and procurement support", "Priority support and service terms"],
  },
];

const faqs = [
  ["How is pricing structured?", "A monthly platform fee covers your configured workflows up to the plan's execution allowance, plus a one-time implementation fee for the initial build. There's no per-seat charge — we price around the work executed, not how many people you invite."],
  ["What counts as an execution?", "One completed run of a configured workflow, from the trigger to a verified completion or a routed exception. A run that stops at a human approval still counts once it resolves."],
  ["What happens if we go over our execution allowance?", "We flag it before you hit the limit. From there you can move to the next plan or pay a per-execution overage — whichever fits better. We won't cut off a workflow mid-run."],
  ["How long does implementation take?", "Design Partner engagements run our 30-day program: map, build, run, prove. Growth and Scale timelines are scoped with you based on workflow count and how many systems need access."],
  ["Can we pilot before a longer commitment?", "The Design Partner plan is built to be that pilot. Most customers start month-to-month and move to an annual term once the first workflow is proven."],
  ["Where does our data live?", "AWS, us-east-1, in a tenant-isolated control plane. See the full architecture on our Security page."],
  ["Can our security or legal team review the platform first?", "Yes — email security@amazflow.com. Our Security page covers current controls and where we're still building toward formal certification."],
  ["Can we change plans or cancel?", "Plans are month-to-month unless you choose an annual term. You can move up or down as your workflow count changes."],
];

export default function PricingPage() {
  return (
    <StandardPage>
      <PageHero eyebrow="PRICING" title="Start with one workflow." accent="Earn the expansion." copy="Pricing combines a one-time implementation, monthly platform access, and an execution allowance. We price around operational value and usage — not seats." />

      <section className="subpage-section">
        <div className="wrap price-grid">
          {plans.map((plan) => (
            <article className="price-card" key={plan.name}>
              <div className="section-label">{plan.tag ?? "AMAZFLOW"}</div>
              <h3>{plan.name}</h3>
              <div className="price">{plan.price} <small>{plan.suffix}</small></div>
              <p className="price-setup">{plan.setup}</p>
              <p className="price-who"><b>Who it's for:</b> {plan.who}</p>
              <dl className="price-facts">
                <div><dt>Execution allowance</dt><dd>{plan.allowance}</dd></div>
                <div><dt>Implementation</dt><dd>{plan.timing}</dd></div>
                <div><dt>Support</dt><dd>{plan.support}</dd></div>
              </dl>
              <ul>{plan.items.map((item) => <li key={item}>{item}</li>)}</ul>
              <Link className="button quiet" href="/contact">Talk through a workflow ↗</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="subpage-section alt">
        <div className="wrap roi-block">
          <div className="section-label">A REALISTIC ROI EXAMPLE</div>
          <h2>Do the math with your own numbers.</h2>
          <p>This uses the same default assumptions built into the product itself — a 20-minute manual handling time and a $35/hr blended labor rate — applied to a mid-volume version of the flagship offboarding workflow. Your actual volume, rate, and workflow will change the numbers; that's the point of the workflow assessment.</p>
          <div className="roi-grid">
            <div className="roi-card">
              <span>120</span>
              <small>runs / month (illustrative)</small>
            </div>
            <div className="roi-card">
              <span>40 hrs</span>
              <small>manual time recovered / month</small>
            </div>
            <div className="roi-card">
              <span>$1,400</span>
              <small>recovered capacity / month, at $35/hr</small>
            </div>
            <div className="roi-card">
              <span>~215</span>
              <small>runs / month where this workflow alone breaks even on the Design Partner plan</small>
            </div>
          </div>
          <p className="roi-note">Below breakeven volume, a single workflow's direct labor savings may not fully cover the platform fee on their own — that's expected early on. Recovered capacity compounds as you add workflows to the same plan, which is why we start with your highest-volume process first.</p>
        </div>
      </section>

      <section className="subpage-section">
        <div className="wrap copy-block">
          <div className="section-label">WORKFLOW ASSESSMENT</div>
          <h2>Build the business case before the automation.</h2>
          <p>We measure annual volume, handling time, loaded labor cost, rework, exceptions, SLA impact, and the realistic percentage of work AmazFlow can execute. Capacity unlocked stays separate from hard-dollar savings so the ROI conversation remains credible.</p>
        </div>
      </section>

      <section className="subpage-section alt">
        <div className="wrap faq-block">
          <div className="section-label">PROCUREMENT &amp; PRICING FAQ</div>
          <h2>Questions your procurement team will ask.</h2>
          <div className="faq-list">
            {faqs.map(([question, answer]) => (
              <details className="faq-item" key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </StandardPage>
  );
}
