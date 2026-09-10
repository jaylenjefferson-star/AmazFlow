import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, StandardPage } from "../site-components";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Legal & Trust Center",
  description:
    "AmazFlow's legal documents in one place: privacy, terms, acceptable use, cookies, subprocessors, the data processing agreement, and security.",
};

const DOCS = [
  {
    href: "/privacy",
    label: "Privacy Policy",
    tag: "PRIVACY",
    blurb: "What we collect on our website and how we use it — separate from Customer Content.",
  },
  {
    href: "/dpa",
    label: "Data Processing Agreement",
    tag: "PRIVACY",
    blurb: "How we process Customer Personal Data as a processor: instructions, security, breach notice, deletion.",
  },
  {
    href: "/subprocessors",
    label: "Subprocessors",
    tag: "PRIVACY",
    blurb: "Every vendor we engage, what it processes, and which ones never touch Customer Content.",
  },
  {
    href: "/cookie-policy",
    label: "Cookie Policy",
    tag: "PRIVACY",
    blurb: "The cookies and third-party technologies on our site, and where they do and do not run.",
  },
  {
    href: "/terms",
    label: "Website Terms of Use",
    tag: "TERMS",
    blurb: "The terms governing this website and the interactive demo. Commercial use is governed by the MSA.",
  },
  {
    href: "/acceptable-use",
    label: "Acceptable Use Policy",
    tag: "TERMS",
    blurb: "What customers and their workflows may and may not do with the Service.",
  },
  {
    href: "/security",
    label: "Security",
    tag: "TRUST",
    blurb: "Access, execution safety, encryption, auditability, and where we stand on formal certification.",
  },
];

export default function LegalIndexPage() {
  return (
    <StandardPage>
      <PageHero
        eyebrow="LEGAL & TRUST"
        title="Everything, written plainly."
        accent="Nothing buried."
        copy="Our legal documents in one place. Each one leads with a plain-language summary, then says exactly what it means — the kind of thing a security or procurement team can actually review."
      />
      <section className="subpage-section">
        <div className="wrap">
          <div className="legal-index-grid">
            {DOCS.map((doc) => (
              <Link className="legal-index-card" href={doc.href} key={doc.href}>
                <small>{doc.tag}</small>
                <b>{doc.label}</b>
                <p>{doc.blurb}</p>
              </Link>
            ))}
          </div>
          <p style={{ marginTop: 32, color: "var(--muted)", fontSize: 14 }}>
            Security questions and responsible disclosures:{" "}
            <a href="mailto:security@amazflow.com">security@amazflow.com</a>. Privacy requests:{" "}
            <a href="mailto:privacy@amazflow.com">privacy@amazflow.com</a>. Contract questions:{" "}
            <a href="mailto:legal@amazflow.com">legal@amazflow.com</a>.
          </p>
        </div>
      </section>
    </StandardPage>
  );
}
