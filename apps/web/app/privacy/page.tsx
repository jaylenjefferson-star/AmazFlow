import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalDoc, LegalSectionBlock, LegalTable } from "../legal-components";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How AmazFlow collects, uses, and protects information on its website and marketing — and how that differs from Customer Content processed through the Service.",
};

const SECTIONS = [
  { id: "scope", title: "Scope, and what this does not cover" },
  { id: "collect", title: "Information we collect" },
  { id: "analytics", title: "Analytics and session replay" },
  { id: "use", title: "How we use information" },
  { id: "disclosure", title: "Disclosure of information" },
  { id: "rights", title: "Your privacy rights" },
  { id: "retention", title: "Retention schedule" },
  { id: "security", title: "Security" },
  { id: "transfers", title: "International data transfers" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "Contact" },
];

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Policy"
      effective="September 7, 2026"
      updated="September 9, 2026"
      sections={SECTIONS}
      summary={
        <>
          <p>
            <b>In short:</b> this Policy covers information AmazFlow handles as a business — website
            visitors, sales enquiries, support conversations, and product analytics on our public
            site. It does <b>not</b> govern the data your organisation runs through the Service; that
            is Customer Content, and the <Link href="/dpa">Data Processing Agreement</Link> governs it.
          </p>
          <p>We do not sell personal information, and we do not use your data to train AI models.</p>
        </>
      }
    >
      <LegalSectionBlock id="scope" n={1} title="Scope, and what this does not cover">
        <p>
          This Privacy Policy explains how AmazFlow, LLC, a Georgia limited liability company
          (&ldquo;AmazFlow,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;), collects, uses, discloses, and
          protects information when you visit our website, communicate with us, or when your
          organisation uses the AmazFlow Service under a customer agreement.
        </p>
        <LegalCallout title="Customer Content is governed by the DPA, not this Policy">
          <p>
            This Policy does not govern Customer Content processed through the Service on behalf of a
            customer. If you are an individual whose information was processed through the Service by an
            AmazFlow customer — for example, an employee whose offboarding workflow ran through AmazFlow
            — direct privacy requests to that organisation. AmazFlow will support that organisation in
            responding, per the <Link href="/dpa">Data Processing Agreement</Link>.
          </p>
        </LegalCallout>
      </LegalSectionBlock>

      <LegalSectionBlock id="collect" n={2} title="Information we collect">
        <p>
          <b>Information you provide directly:</b> contact information (name, work email, company,
          role) submitted through our website forms, including the workflow-assessment form;
          communications you send us (sales, support, security inquiries); and account and billing
          information if you become a customer.
        </p>
        <p>
          <b>Information collected automatically:</b> standard web log data (IP address, browser type,
          pages visited, referring URL); the product-analytics and session-replay data described in
          section 3; and cookies and similar technologies as described in our{" "}
          <Link href="/cookie-policy">Cookie Policy</Link>.
        </p>
        <p>
          <b>Information we do not intentionally collect:</b> we do not knowingly collect personal
          information from children under 16. AmazFlow is a business-to-business service not directed to
          children.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="analytics" n={3} title="Analytics and session replay">
        <p>
          On our public website we use Amplitude for product analytics and session replay, to
          understand how the marketing pages are used and where they are confusing. This captures page
          views, interactions, and a masked replay of on-page sessions, along with technical
          information such as IP address, browser, and device type.
        </p>
        <p>
          This runs on the public and sign-in pages only. It is switched off inside the customer
          console and the operator console, so it never records the data you or your team work with
          inside AmazFlow. Amplitude is listed on our{" "}
          <Link href="/subprocessors">Subprocessors</Link> page, and the mechanics and your choices are
          in the <Link href="/cookie-policy">Cookie Policy</Link>. We use this analytics as a first
          party to improve our own site; we do not sell it or use it for cross-context behavioural
          advertising.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="use" n={4} title="How we use information">
        <p>
          We use information to respond to inquiries and provide requested information about the
          Service; administer customer accounts, billing, and support; operate, secure, and improve our
          website and Service; send administrative communications about the Service (not marketing,
          unless you have opted in); and comply with legal obligations and enforce our agreements.
        </p>
        <p>
          <b>We do not use your information to train, fine-tune, or improve AI models</b>, and we do not
          permit our providers to do so. We do not sell personal information, and we do not share
          personal information for cross-context behavioural advertising, as those terms are defined
          under the CCPA/CPRA.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="disclosure" n={5} title="Disclosure of information">
        <p>
          We may disclose information to service providers who support our infrastructure,
          communications, analytics, security, and business operations, listed on our{" "}
          <Link href="/subprocessors">Subprocessors</Link> page; to professional advisors as necessary;
          to law enforcement or regulators where required by law or valid legal process; and to a
          successor entity in a merger, acquisition, or asset sale, subject to this Policy or a
          materially equivalent one.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="rights" n={6} title="Your privacy rights">
        <p>
          Depending on your location, you may have rights to know what personal information we hold and
          how it is used; to access or receive a copy of it; to correct it; to delete it, subject to
          legal exceptions; to opt out of the sale or sharing of personal information (which, as stated,
          we do not do); and not to be discriminated against for exercising these rights.
        </p>
        <p>
          <b>California residents</b> may exercise CCPA/CPRA rights by emailing{" "}
          <a href="mailto:privacy@amazflow.com">privacy@amazflow.com</a>; we verify a request using
          information reasonably available before acting, and you may use an authorised agent.{" "}
          <b>Other US state residents</b> (for example Virginia, Colorado, Connecticut, Utah, or a
          similarly enacted state law) may have comparable rights, which we honour consistent with the
          applicable law. <b>EU, UK, and Swiss residents:</b> if applicable data-protection law grants
          you rights of access, rectification, erasure, restriction, portability, or objection, contact{" "}
          <a href="mailto:privacy@amazflow.com">privacy@amazflow.com</a>. Our website and marketing are
          not currently directed at those regions; if that changes, this Policy will be updated to a
          complete Article 13/14 notice reviewed by qualified counsel.
        </p>
        <p>
          We respond within the time required by applicable law — generally 45 days for California
          requests, extendable once with notice.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="retention" n={7} title="Retention schedule">
        <p>
          We keep personal information only as long as needed for the purpose it was collected, then
          delete it or de-identify it. The periods below are our current schedule. Where a legal
          obligation (such as tax law) requires longer, that governs.
        </p>
        <LegalTable
          caption="Retention periods by category of information."
          columns={["Category", "Retention"]}
          rows={[
            [
              "Website enquiry and contact-form data",
              "Duration of an active sales or business relationship, plus up to 24 months, then deleted.",
            ],
            [
              "Customer account data",
              "For the term of the customer agreement, plus 90 days after termination, then deleted.",
            ],
            [
              "Customer Content (workflow and execution data)",
              "For the term. On termination, deleted or returned within 30 days of request, per the DPA. See the note below on backups.",
            ],
            [
              "Support conversations",
              "Duration of the relationship, plus up to 24 months.",
            ],
            [
              "Website analytics and session replay",
              "Retained in Amplitude for up to 24 months from collection, then aged out.",
            ],
            [
              "Security and audit logs",
              "Up to 12 months, retained separately from the application data store.",
            ],
            [
              "Billing and tax records",
              "A minimum of 7 years, as required by tax law.",
            ],
          ]}
        />
        <p>
          <b>Backups.</b> Backups follow their own cycle and are purged within 35 days. Deleting a
          record from the live Service does not immediately remove it from an existing backup; it ages
          out with that backup within this window.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="security" n={8} title="Security">
        <p>
          We apply administrative, technical, and organisational safeguards designed to protect
          personal information, consistent with our <Link href="/security">Security</Link> page. No
          method of transmission or storage is completely secure, and we cannot guarantee absolute
          security.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="transfers" n={9} title="International data transfers">
        <p>
          AmazFlow is based in the United States, and information we collect is generally processed in
          the United States. Where we engage a service provider located outside the United States (see
          our <Link href="/subprocessors">Subprocessors</Link> page), we take reasonable steps to ensure
          an adequate level of protection consistent with applicable law.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="changes" n={10} title="Changes to this policy">
        <p>
          We may update this Policy as our practices, the Service, and legal requirements evolve. We
          post the updated Policy with a new &ldquo;Last updated&rdquo; date and, for material changes,
          provide additional notice where required by law.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" n={11} title="Contact">
        <p>
          Questions or requests regarding this Policy or your personal information:{" "}
          <a href="mailto:privacy@amazflow.com">privacy@amazflow.com</a>.
        </p>
      </LegalSectionBlock>
    </LegalDoc>
  );
}
