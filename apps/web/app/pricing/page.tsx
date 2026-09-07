import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, StandardPage } from "../site-components";
import "../marketing.css";

export const metadata: Metadata = { title: "Pricing", description: "Start with one operational workflow, prove the value, and expand with AmazFlow." };
const plans = [
  { name: "Design Partner", price: "From $2,500", suffix: "/ month", setup: "Implementation from $5,000", items: ["One production workflow", "Baseline and ROI measurement", "Founder-led implementation", "Approvals, exceptions, and audit", "Defined execution allowance"], featured: false },
  { name: "Growth", price: "From $5,000", suffix: "/ month", setup: "Implementation from $10,000", items: ["Multiple active workflows", "Cross-system execution", "Client operations administration", "Analytics and expanded controls", "BAA-supported options where eligible"], featured: true },
  { name: "Scale", price: "Custom", suffix: "", setup: "For departments and enterprise teams", items: ["Multi-department programs", "Advanced access and governance", "Custom connectors and volume", "Security and procurement support", "Priority support and service terms"], featured: false },
];

export default function PricingPage() { return <StandardPage><PageHero eyebrow="PRICING" title="Start with one workflow." accent="Earn the expansion." copy="Pricing combines implementation, platform access, and an execution allowance. We price around operational value and usage—not how many employees you invite." /><section className="subpage-section"><div className="wrap price-grid">{plans.map((plan) => <article className={`price-card ${plan.featured ? "featured" : ""}`} key={plan.name}><div className="section-label">{plan.featured ? "MOST POPULAR" : "AMAZFLOW"}</div><h3>{plan.name}</h3><div className="price">{plan.price} <small>{plan.suffix}</small></div><p>{plan.setup}</p><ul>{plan.items.map((item) => <li key={item}>{item}</li>)}</ul><Link className={`button ${plan.featured ? "primary" : "quiet"}`} href="/contact">Talk through a workflow ↗</Link></article>)}</div></section><section className="subpage-section alt"><div className="wrap copy-block"><div className="section-label">WORKFLOW ASSESSMENT</div><h2>Build the business case before the automation.</h2><p>We measure annual volume, handling time, loaded labor cost, rework, exceptions, SLA impact, and the realistic percentage of work AmazFlow can execute. Capacity unlocked stays separate from hard-dollar savings so the ROI conversation remains credible.</p></div></section></StandardPage>; }
