import type { Metadata } from "next";
import { PageHero, StandardPage } from "../site-components";
import { LeadForm } from "../lead-form";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Contact",
  description: "Bring AmazFlow the operational workflow your team wants to stop doing manually.",
};

export default function ContactPage() {
  return (
    <StandardPage>
      <PageHero
        eyebrow="LET’S FIND THE WORK"
        title="Give us your most"
        accent="annoying workflow."
        copy="We’ll map the process, identify what can safely be executed, estimate the operating value, and define a practical first deployment."
      />
      <section className="subpage-section">
        <div className="wrap contact-card">
          <div className="contact-intro">
            <div className="section-label">A GOOD FIRST WORKFLOW</div>
            <h2>High volume. Repeatable steps. Clear outcome.</h2>
            <p>Tell us the systems involved, monthly volume, average handling time, common exceptions, and what “done” means. We’ll help with the rest.</p>
            <div className="contact-options">
              <a href="mailto:sales@amazflow.com">Email sales directly <span>↗</span></a>
              <a href="mailto:security@amazflow.com">Security and compliance <span>↗</span></a>
              <a href="/app">View the product console <span>↗</span></a>
            </div>
          </div>
          <div className="contact-form-side">
            <div className="section-label">WORKFLOW ASSESSMENT</div>
            <h3 className="contact-form-title">Start here.</h3>
            <LeadForm source="contact" />
          </div>
        </div>
      </section>
    </StandardPage>
  );
}
