import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalDoc, LegalSectionBlock } from "../legal-components";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Website Terms of Use",
  description:
    "The terms governing amazflow.com and its interactive demo. Commercial use of the platform is governed by the Master Services Agreement, not these terms.",
};

const SECTIONS = [
  { id: "permitted", title: "Permitted use" },
  { id: "demo", title: "The product demonstration environment" },
  { id: "ip", title: "Intellectual property" },
  { id: "links", title: "Third-party links" },
  { id: "disclaimers", title: "Disclaimers" },
  { id: "liability", title: "Limitation of liability" },
  { id: "law", title: "Governing law" },
  { id: "changes", title: "Changes to these terms" },
  { id: "contact", title: "Contact" },
];

export default function TermsPage() {
  return (
    <LegalDoc
      title="Website Terms of Use"
      effective="September 7, 2026"
      updated="September 9, 2026"
      sections={SECTIONS}
      summary={
        <>
          <p>
            <b>In short:</b> these terms cover browsing this website and trying the demo. Everything on
            the demo is synthetic — never put real or sensitive data into it.
          </p>
          <LegalCallout title="These terms do not govern commercial use">
            <p>
              If your organisation has signed a Master Services Agreement and Order Form, your use of
              the Service is governed by those agreements and the{" "}
              <Link href="/dpa">Data Processing Agreement</Link> — not by these website terms.
            </p>
          </LegalCallout>
        </>
      }
    >
      <LegalSectionBlock id="permitted" n={1} title="Permitted use">
        <p>
          You may access this website (the &ldquo;Site&rdquo;), operated by AmazFlow, LLC, a Georgia
          limited liability company, for legitimate informational and business-evaluation purposes. You
          may not: disrupt, overload, or interfere with the Site&rsquo;s normal operation; probe, scan,
          or test the vulnerability of the Site, the demonstration environment, or any connected system
          without authorisation; reverse engineer or attempt to extract source code from the Site or
          demonstration environment, except to the extent that restriction is prohibited by law;
          attempt unauthorised access to any account, system, or data; use automated means to access
          the Site beyond what a human could reasonably produce in the same period, except standard
          search-engine indexing; or use the Site to violate any law or a third party&rsquo;s rights.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="demo" n={2} title="The product demonstration environment">
        <p>
          The demonstration environment linked from the Site (the &ldquo;Demo&rdquo;) uses synthetic,
          fictional data created for illustration. Any names, employee records, execution identifiers,
          or system labels shown in the Demo — including on the public marketing pages — are synthetic
          and do not represent real individuals, real customer data, or real production systems.
        </p>
        <LegalCallout tone="warn" title="Do not put real data into the Demo">
          <p>
            The Demo may change without notice, does not reflect a guaranteed feature set of the
            commercial Service, and must not be used to submit real patient information, protected
            health information, payment card data, credentials, confidential business information, or
            other sensitive records.
          </p>
        </LegalCallout>
      </LegalSectionBlock>

      <LegalSectionBlock id="ip" n={3} title="Intellectual property">
        <p>
          AmazFlow and its licensors retain all right, title, and interest in the Site, the Service,
          our software, product designs, trademarks (including &ldquo;AmazFlow&rdquo; and our logo), and
          all related materials. Nothing in these Terms grants you any right or licence except the
          limited right to access the Site for its intended purpose.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="links" n={4} title="Third-party links">
        <p>
          The Site may link to third-party websites we do not control. We are not responsible for the
          content or practices of any linked site.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="disclaimers" n={5} title="Disclaimers">
        <p>
          The Site and Demo are provided &ldquo;as available&rdquo; and &ldquo;as is&rdquo; for
          evaluation and informational purposes only. To the extent permitted by law, AmazFlow
          disclaims all warranties not expressly stated in a signed commercial agreement, including
          warranties of merchantability, fitness for a particular purpose, and non-infringement.
          Statements on this Site describing security controls, compliance posture, or capabilities are
          descriptive of our program as of the date published and do not constitute a contractual
          commitment absent a signed agreement incorporating them.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="liability" n={6} title="Limitation of liability">
        <p>
          To the extent permitted by law, AmazFlow will not be liable for any indirect, incidental, or
          consequential damages arising from your use of the Site or Demo. AmazFlow&rsquo;s total
          liability arising from your use of the Site or Demo will not exceed one hundred dollars
          ($100).
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="law" n={7} title="Governing law">
        <p>
          These Terms are governed by the laws of the State of Georgia, without regard to
          conflict-of-laws principles, and any dispute will be subject to the exclusive jurisdiction of
          the state and federal courts located in Georgia.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="changes" n={8} title="Changes to these terms">
        <p>
          We may update these Terms from time to time. Continued use of the Site after an update
          constitutes acceptance of the revised Terms.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" n={9} title="Contact">
        <p>
          Questions about these Terms: <a href="mailto:legal@amazflow.com">legal@amazflow.com</a>.
        </p>
      </LegalSectionBlock>
    </LegalDoc>
  );
}
