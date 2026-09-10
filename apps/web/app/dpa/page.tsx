import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalDoc, LegalSectionBlock, LegalTable } from "../legal-components";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Data Processing Agreement",
  description:
    "How AmazFlow processes Customer Personal Data as a processor: instructions, security, subprocessors, data subject requests, breach notification, deletion, and regulated data.",
};

const SECTIONS = [
  { id: "roles", title: "Roles and scope" },
  { id: "instructions", title: "Processing instructions" },
  { id: "categories", title: "Data and data subjects" },
  { id: "confidentiality", title: "Confidentiality and personnel" },
  { id: "security", title: "Security measures" },
  { id: "ai", title: "AI processing and model training" },
  { id: "subprocessors", title: "Subprocessors" },
  { id: "requests", title: "Data subject requests" },
  { id: "breach", title: "Personal data breach notification" },
  { id: "assistance", title: "Assessments and audits" },
  { id: "transfers", title: "International transfers" },
  { id: "regulated", title: "Regulated data" },
  { id: "retention", title: "Retention, return, and deletion" },
  { id: "precedence", title: "Precedence and liability" },
];

export default function DpaPage() {
  return (
    <LegalDoc
      title="Data Processing Agreement"
      effective="September 9, 2026"
      updated="September 9, 2026"
      sections={SECTIONS}
      summary={
        <>
          <p>
            <b>In short:</b> when your organisation uses AmazFlow, you decide what data enters a
            workflow and why. We process it only to run the workflows you configured, on your
            instructions. We do not use your data to train AI models. All Customer Content stays in
            AWS in the United States.
          </p>
          <p>
            This Agreement is incorporated into the Master Services Agreement between AmazFlow, LLC
            and Customer and applies whenever AmazFlow processes Customer Personal Data.
          </p>
        </>
      }
    >
      <LegalSectionBlock id="roles" n={1} title="Roles and scope">
        <p>
          For Customer Personal Data processed through the Service, Customer is the controller (or, if
          Customer is itself a processor for a third party, the processor) and AmazFlow is the
          processor (or subprocessor). AmazFlow processes Customer Personal Data only to provide,
          secure, and support the Service.
        </p>
        <p>
          For AmazFlow&rsquo;s own business data — a customer contact&rsquo;s name and work email, a
          billing record, a support conversation — AmazFlow is the controller, and our{" "}
          <Link href="/privacy">Privacy Policy</Link> governs.
        </p>
        <p>
          This Agreement takes effect when the Service is first made available to Customer and remains
          in effect for as long as AmazFlow processes Customer Personal Data.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="instructions" n={2} title="Processing instructions">
        <p>
          Customer&rsquo;s instructions to AmazFlow consist of the Master Services Agreement, the
          applicable Order Form, this Agreement, and — importantly for this Service — the Workflows
          Customer configures. A configured Workflow is a documented instruction: it defines which
          systems are read, which actions are taken, which decisions require a human approval, and
          what evidence is recorded.
        </p>
        <p>
          AmazFlow will not process Customer Personal Data for any purpose other than performing the
          Service, and will not disclose it except as permitted by this Agreement. If AmazFlow
          believes an instruction infringes applicable data protection law, it will inform Customer
          without undue delay and may suspend performance of that instruction.
        </p>
        <LegalCallout title="Customer controls what enters a workflow">
          <p>
            AmazFlow does not select the data a Workflow touches. Customer is responsible for
            configuring appropriate approval thresholds, data classifications, and authorised systems
            for each Workflow, as set out in our{" "}
            <Link href="/acceptable-use">Acceptable Use Policy</Link>. That responsibility is
            deliberate: the platform enforces the boundaries Customer sets, and cannot infer a
            boundary Customer has not set.
          </p>
        </LegalCallout>
      </LegalSectionBlock>

      <LegalSectionBlock id="categories" n={3} title="Data and data subjects">
        <p>
          The categories below describe what the Service is designed to process. The actual contents
          depend entirely on the Workflows Customer configures.
        </p>
        <LegalTable
          columns={["Category", "Typical contents"]}
          rows={[
            [
              "Data subjects",
              "Customer's employees, contractors, and authorised users; and individuals who are the subject of a Workflow, such as an employee being offboarded or a customer whose request is being processed.",
            ],
            [
              "Personal data",
              "Identifiers and contact details; employment and account attributes; the contents of the request or record a Workflow acts on; approval decisions and the identity of the approver; and execution evidence such as which action ran against which record.",
            ],
            [
              "Special category data",
              "Not processed unless expressly agreed in an Order Form and, where applicable, a Business Associate Agreement. See section 12.",
            ],
            [
              "Processing operations",
              "Storage, retrieval, structuring, automated action against authorised systems, bounded AI classification and extraction, human approval routing, verification, audit logging, deletion.",
            ],
            [
              "Duration",
              "For the term of the Agreement, plus the deletion window in section 13.",
            ],
          ]}
        />
      </LegalSectionBlock>

      <LegalSectionBlock id="confidentiality" n={4} title="Confidentiality and personnel">
        <p>
          AmazFlow limits access to Customer Personal Data to personnel who require it to provide or
          support the Service. Such personnel are bound by written confidentiality obligations that
          survive the end of their engagement.
        </p>
        <p>
          AmazFlow personnel access to a customer environment is role-based, logged, and limited to
          what a support or operational task requires. Where a support question can be answered from
          execution metadata — a run identifier, a step, an outcome — AmazFlow will use that rather
          than the underlying record.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="security" n={5} title="Security measures">
        <p>
          AmazFlow implements and maintains technical and organisational measures appropriate to the
          risk, described on our <Link href="/security">Security</Link> page. As of the effective date
          those measures include, at minimum:
        </p>
        <ul>
          <li>Encryption of Customer Content in transit and at rest.</li>
          <li>
            Tenant isolation enforced server-side on every request, such that a request carrying one
            tenant&rsquo;s identity cannot read another tenant&rsquo;s records even if it presents a
            valid identifier for them.
          </li>
          <li>
            Role-based access control across three fixed tiers, with multi-factor authentication
            available on all accounts.
          </li>
          <li>
            Constrained execution: allowlisted operations, short-lived scoped authorisations rather
            than standing credentials, expiry, verification of the resulting state, and revocation.
          </li>
          <li>
            An execution audit history recording actor, action, authorisation, timing, and outcome for
            material actions, stored separately from the application data store.
          </li>
          <li>
            Secure development practices: infrastructure as code, code review, automated testing,
            dependency and infrastructure security scanning, and vulnerability remediation.
          </li>
        </ul>
        <p>
          AmazFlow may update these measures as the Service evolves, provided the overall level of
          protection is not materially reduced.
        </p>
        <LegalCallout tone="warn" title="What AmazFlow does not currently claim">
          <p>
            AmazFlow does not hold a SOC 2 attestation and does not make blanket &ldquo;HIPAA
            compliant&rdquo; claims. We describe our controls as they are, and we would rather be
            asked a hard question in a security review than have a customer discover the gap
            afterwards. See <Link href="/security">where we stand today</Link>.
          </p>
        </LegalCallout>
      </LegalSectionBlock>

      <LegalSectionBlock id="ai" n={6} title="AI processing and model training">
        <p>
          Some Workflow steps use a large language model to classify, extract, transform, or choose
          among a set of options that Customer has defined. Those steps run against a model hosted in
          AmazFlow&rsquo;s own cloud account.
        </p>
        <p>
          <b>AmazFlow does not use Customer Content to train, fine-tune, or improve any AI model</b>,
          and does not permit its model provider to do so. Customer Content submitted to a model is
          used to produce that step&rsquo;s output and for no other purpose.
        </p>
        <p>
          AI output does not carry authority of its own. A model may select only from actions Customer
          has permitted, its output is validated against an expected structure, results below a
          configured confidence threshold are routed to a human, and any action Customer has marked as
          requiring approval waits for a person regardless of what the model returned.
        </p>
        <h3>Automated decision-making</h3>
        <p>
          Where a Workflow reaches a decision without human involvement, that is a configuration
          Customer has chosen. Customer is responsible for determining whether a given automated
          decision requires a human in the loop under applicable law — including any restriction on
          decisions producing legal effects or similarly significant effects on an individual — and for
          configuring an approval gate accordingly. Our{" "}
          <Link href="/acceptable-use">Acceptable Use Policy</Link> requires an approval gate for
          high-impact actions.
        </p>
        <p>
          To support Customer in responding to an individual&rsquo;s question about an automated
          decision, the Service records for each material action which step ran, which policy or
          decision produced it, what the model returned where one was involved, who approved it if
          approval was required, and what the verified outcome was.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="subprocessors" n={7} title="Subprocessors">
        <p>
          Customer authorises AmazFlow to engage the subprocessors listed on our{" "}
          <Link href="/subprocessors">Subprocessors</Link> page, which forms part of this Agreement.
          AmazFlow imposes data protection obligations on each subprocessor no less protective than
          those in this Agreement, and remains responsible for their performance.
        </p>
        <p>
          AmazFlow will give at least fifteen (15) days&rsquo; notice before adding a subprocessor that
          will process Customer Personal Data. Customer may object on reasonable data-protection
          grounds within that period; the objection process and its consequences are set out on the
          Subprocessors page.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="requests" n={8} title="Data subject requests">
        <p>
          The Service gives Customer administrative access to the Customer Personal Data it holds, so
          that Customer can respond to access, correction, deletion, and portability requests
          directly.
        </p>
        <p>
          Where Customer cannot fulfil a request through the Service, AmazFlow will provide reasonable
          assistance. If AmazFlow receives a request directly from a data subject relating to Customer
          Personal Data, it will not respond substantively, and will instead direct the individual to
          Customer and inform Customer without undue delay.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="breach" n={9} title="Personal data breach notification">
        <p>
          AmazFlow will notify Customer without undue delay, and in any event <b>within
          seventy-two (72) hours</b> of becoming aware of a personal data breach affecting Customer
          Personal Data.
        </p>
        <p>Notification will include, to the extent known at the time and updated as more is learned:</p>
        <ul>
          <li>the nature of the breach and the categories and approximate number of records affected;</li>
          <li>the likely consequences;</li>
          <li>the measures taken or proposed to address it and mitigate its effects; and</li>
          <li>a contact point at AmazFlow for further information.</li>
        </ul>
        <p>
          An initial notification will not be delayed in order to complete an investigation. AmazFlow
          will cooperate with Customer in Customer&rsquo;s own regulatory or individual notification
          obligations. Notifications are sent to the security contact Customer has registered;
          Customer is responsible for keeping that contact current.
        </p>
        <p>
          To report a suspected vulnerability or incident to AmazFlow:{" "}
          <a href="mailto:security@amazflow.com">security@amazflow.com</a>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="assistance" n={10} title="Assessments and audits">
        <p>
          AmazFlow will provide Customer with information reasonably necessary to demonstrate
          compliance with this Agreement and to complete a data protection impact assessment or
          vendor security review, including completed security questionnaires and a description of
          the architecture and controls.
        </p>
        <p>
          Where Customer&rsquo;s audit rights under applicable law cannot be satisfied by that
          information, AmazFlow will cooperate with a reasonable audit, no more than once in any
          twelve-month period except where required by a supervisory authority or following a
          personal data breach, on reasonable prior written notice, during business hours, subject to
          confidentiality, and in a manner that does not compromise the security of other customers.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="transfers" n={11} title="International transfers">
        <p>
          Customer Content is stored and processed in the United States, in the AWS{" "}
          <code>us-east-1</code> region. AmazFlow does not replicate Customer Content to other regions.
        </p>
        <p>
          One subprocessor listed on our Subprocessors page is located in the European Union and
          processes AmazFlow&rsquo;s own code and infrastructure metadata rather than Customer Content.
        </p>
        <p>
          Where a transfer of personal data from the EEA, UK, or Switzerland to AmazFlow occurs and
          requires a transfer mechanism, the parties will enter into the European Commission&rsquo;s
          Standard Contractual Clauses, together with the UK International Data Transfer Addendum
          where applicable, which will be incorporated into this Agreement by reference on execution.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="regulated" n={12} title="Regulated data">
        <p>
          Customer must not submit regulated data — including protected health information, payment
          card data, or government identification numbers — to the Service through a system,
          connector, or data classification that is not approved for that category under the
          applicable Order Form, this Agreement, or a Business Associate Agreement.
        </p>
        <p>
          For eligible deployments, AmazFlow will evaluate and execute an appropriate Business
          Associate Agreement and restrict the regulated workload to approved architecture and
          subprocessors. This is scoped per engagement and is not a standing certification.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="retention" n={13} title="Retention, return, and deletion">
        <p>
          AmazFlow retains Customer Personal Data for the term of the Agreement. On termination or
          expiry, and on Customer&rsquo;s written request at any time, AmazFlow will delete or return
          Customer Personal Data in accordance with the schedule in our{" "}
          <Link href="/privacy#retention">Privacy Policy</Link>.
        </p>
        <p>
          AmazFlow may retain Customer Personal Data where required by applicable law, and will
          continue to protect it under this Agreement for as long as it is retained. Backups are
          purged on their own cycle; deletion of a record from the live Service does not immediately
          remove it from an existing backup, and the backup retention window is stated in the
          Privacy Policy schedule.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="precedence" n={14} title="Precedence and liability">
        <p>
          In the event of a conflict between this Agreement and the Master Services Agreement in
          respect of the processing of Customer Personal Data, this Agreement prevails. Where a
          Business Associate Agreement applies to a workload, it prevails over both in respect of
          protected health information.
        </p>
        <p>
          Each party&rsquo;s liability arising out of this Agreement is subject to the limitations and
          exclusions of liability in the Master Services Agreement.
        </p>
        <p>
          Questions about this Agreement, or to request a signed copy:{" "}
          <a href="mailto:legal@amazflow.com">legal@amazflow.com</a>.
        </p>
      </LegalSectionBlock>
    </LegalDoc>
  );
}
