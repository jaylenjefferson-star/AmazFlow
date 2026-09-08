import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, StandardPage } from "../site-components";
import "../marketing.css";

export const metadata: Metadata = { title: "Product", description: "A configurable execution platform for operational workflows across browsers, spreadsheets, APIs, files, and people." };
const layers = [
  ["Observe", "Understand the authorized page, queue, file, message, or event that begins the work."],
  ["Decide", "Apply deterministic policies and bounded AI decisions to choose from allowed next actions."],
  ["Act", "Execute through the browser, a spreadsheet, an API, email, files, or a human task."],
  ["Verify", "Read the resulting state and confirm that the requested outcome actually happened."],
  ["Escalate", "Route ambiguity, policy thresholds, and failures to the right person with context."],
  ["Audit", "Record the who, what, when, why, method, authorization, and result of every material action."],
];

export default function ProductPage() { return <StandardPage><PageHero eyebrow="THE EXECUTION PLATFORM" title="Configure the process." accent="AmazFlow runs it." copy="AmazFlow is the governed execution layer between your people and software: one control plane for workflows, policies, approvals, exceptions, AI decisions, agents, and audit history." /><section className="subpage-section alt"><div className="wrap subpage-grid">{layers.map(([title, copy], index) => <article className="subpage-card" key={title}><span className="number">0{index + 1}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section><section className="subpage-section"><div className="wrap copy-block"><div className="section-label">CONFIGURATION OVER CUSTOM CODE</div><h2>Build the workflow once. Execute it anywhere.</h2><p>Workflows describe the outcome, conditions, approvals, and evidence required. Execution providers determine whether the step runs through an authorized browser session, spreadsheet, API, file, inbox, or human queue. That separation keeps the process reusable as systems change.</p><Link className="button primary" href="/demo">Try the interactive demo ↗</Link></div></section><section className="security-banner"><div className="wrap"><div><div className="section-label light">AMAZFLOW INTELLIGENCE</div><h2>AI is a step.<br /><i>Not the boss.</i></h2></div><div className="security-copy"><p>Amazon Bedrock helps AmazFlow classify, extract, transform, and choose among explicit allowed actions. Policy rules, permissions, approvals, and verification still control execution.</p><div className="security-pills"><span>Structured outputs</span><span>Confidence thresholds</span><span>Allowed actions</span><span>Human review</span></div></div></div></section></StandardPage>; }
