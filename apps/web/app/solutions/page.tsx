import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, StandardPage } from "../site-components";
import "../marketing.css";

export const metadata: Metadata = { title: "Solutions", description: "Operational workflow execution across People, Healthcare, Customer, Finance, IT, and Business Operations." };
const groups = [
  ["People operations", ["Employee onboarding", "Employee offboarding", "Access changes", "HR tracker updates", "Payroll inputs", "Recruiting administration"]],
  ["Healthcare operations", ["Administrative intake", "Records collection", "Referral coordination", "Provider operations", "Portal updates", "Queue and SLA management"]],
  ["Customer operations", ["Account maintenance", "Ticket-to-action workflows", "Customer verification", "Provisioning", "Renewal administration", "Exception routing"]],
  ["Finance operations", ["Reconciliation", "Invoice processing", "ERP data entry", "Document validation", "Collections follow-up", "Approval workflows"]],
  ["IT operations", ["Identity provisioning", "Deprovisioning", "Access requests", "License recovery", "Ticket execution", "Evidence collection"]],
  ["Business operations", ["Spreadsheet execution", "Data entry", "Reporting workflows", "Queue management", "Cross-system updates", "Back-office SOPs"]],
];

export default function SolutionsPage() { return <StandardPage><PageHero eyebrow="SOLUTIONS" title="Different departments." accent="Same execution engine." copy="AmazFlow is horizontal by design. Start with the repetitive workflow costing one team the most, then expand across the business without replacing the systems already in place." /><section className="subpage-section alt"><div className="wrap subpage-grid">{groups.map(([name, items]) => <article className="subpage-card" key={name as string}><h3>{name as string}</h3><ul>{(items as string[]).map((item) => <li key={item}>{item}</li>)}</ul></article>)}</div></section><section className="subpage-section"><div className="wrap copy-block"><div className="section-label">THE FIRST QUESTION</div><h2>What work does your team do every day that should already be automated?</h2><p>We begin with volume, handling time, systems touched, error and rework rates, approvals, exceptions, and the outcome that proves the workflow is done. That becomes a concrete implementation and ROI case—not an abstract AI project.</p><Link className="button primary" href="/contact">Bring us your workflow ↗</Link></div></section></StandardPage>; }
