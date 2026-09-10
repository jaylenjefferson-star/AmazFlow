import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalDoc, LegalSectionBlock } from "../legal-components";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description:
    "What customers and their workflows may and may not do with the AmazFlow Service, incorporated into the Master Services Agreement.",
};

const SECTIONS = [
  { id: "prohibited", title: "Prohibited uses" },
  { id: "responsibility", title: "Responsibility for workflow configuration" },
  { id: "enforcement", title: "Enforcement" },
  { id: "reporting", title: "Reporting a violation" },
];

export default function AcceptableUsePage() {
  return (
    <LegalDoc
      title="Acceptable Use Policy"
      updated="September 9, 2026"
      sections={SECTIONS}
      summary={
        <>
          <p>
            <b>In short:</b> use AmazFlow only for work you are authorised to do, put a human approval
            gate in front of high-impact actions, and keep regulated data on approved systems. The full
            list is below.
          </p>
          <p>
            This Policy is incorporated into the Master Services Agreement (&ldquo;MSA&rdquo;) between
            AmazFlow, LLC and Customer. Capitalised terms not defined here have the meaning given in the
            MSA.
          </p>
        </>
      }
    >
      <LegalSectionBlock id="prohibited" n={1} title="Prohibited uses">
        <p>Customer will not, and will not permit any Authorized User or Workflow configuration to:</p>
        <ul>
          <li>
            violate any applicable law, regulation, sanctions program, or export-control restriction;
          </li>
          <li>
            access, modify, or exfiltrate data or systems Customer is not authorised to access,
            including by configuring a Workflow to act using credentials or permissions the underlying
            account holder has not actually authorised;
          </li>
          <li>
            take a high-impact action — including financial transfers or refunds, access grants or
            revocations, deletion of records, healthcare or benefits determinations, legal filings, or
            payroll changes — without a human-approval gate commensurate with that action&rsquo;s risk;
          </li>
          <li>
            process regulated data (including protected health information, payment card data, or
            government identification numbers) through a system, connector, or data classification not
            approved for that category under the applicable Order Form, Data Processing Agreement, or
            Business Associate Agreement;
          </li>
          <li>
            send unsolicited bulk communications, engage in phishing, or otherwise violate the CAN-SPAM
            Act, TCPA, or comparable law;
          </li>
          <li>
            disable, circumvent, or interfere with the Service&rsquo;s approval gates, verification
            steps, audit logging, or other safety and accountability controls;
          </li>
          <li>
            develop a competing product, or benchmark the Service for a competitor&rsquo;s commercial
            purpose, without AmazFlow&rsquo;s written consent;
          </li>
          <li>
            introduce malware, or conduct penetration testing or vulnerability scanning against
            AmazFlow&rsquo;s infrastructure without prior written authorisation (to report a
            vulnerability, see our <Link href="/security">Security</Link> page); or
          </li>
          <li>
            cause material harm to any individual, including configuring an automated action affecting a
            healthcare, benefits, or safety-critical determination without a human-approval gate.
          </li>
        </ul>
        <LegalCallout title="High-impact actions need a human in the loop">
          <p>
            This is the core rule, and the platform is built to support it: approvals, verification, and
            audit exist so that the consequential actions above resolve through a person, not around
            one. Configuring a Workflow to skip that gate for a high-impact action is a violation of this
            Policy even where the platform would technically permit it.
          </p>
        </LegalCallout>
      </LegalSectionBlock>

      <LegalSectionBlock id="responsibility" n={2} title="Responsibility for workflow configuration">
        <p>
          Customer is solely responsible for the Workflows it configures, including determining the
          appropriate approval thresholds, data classifications, and authorised systems for each
          Workflow, consistent with the MSA and the <Link href="/dpa">Data Processing Agreement</Link>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="enforcement" n={3} title="Enforcement">
        <p>
          AmazFlow may investigate suspected violations and may suspend or restrict access to a specific
          Workflow, connector, or account where reasonably necessary to prevent or stop a violation,
          prior to formal termination proceedings under the MSA. AmazFlow will provide notice of such a
          suspension as soon as reasonably practicable, except where notice itself would increase risk
          (for example, an active unauthorised-access situation).
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="reporting" n={4} title="Reporting a violation">
        <p>
          To report a suspected violation of this AUP by another AmazFlow customer, contact{" "}
          <a href="mailto:security@amazflow.com">security@amazflow.com</a>.
        </p>
      </LegalSectionBlock>
    </LegalDoc>
  );
}
