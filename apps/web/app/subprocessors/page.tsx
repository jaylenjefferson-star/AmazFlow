import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalDoc, LegalSectionBlock, LegalTable } from "../legal-components";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Subprocessors",
  description:
    "The subprocessors AmazFlow engages to provide the Service, what each one processes, where it is located, and its regulated-data status.",
};

const SECTIONS = [
  { id: "list", title: "Current subprocessors" },
  { id: "customer-content", title: "Which ones touch Customer Content" },
  { id: "regulated", title: "Regulated data and BAAs" },
  { id: "notice", title: "Notice of changes" },
  { id: "objection", title: "Objecting to a subprocessor" },
  { id: "contact", title: "Questions" },
];

/**
 * Ordered by how close each vendor sits to Customer Content, because that is the question a
 * reviewer is actually asking. `content` marks whether the vendor processes Customer Content in
 * the ordinary course, as opposed to being infrastructure we run our own business on.
 */
const VENDORS = [
  {
    name: "Amazon Web Services, Inc.",
    location: "United States (us-east-1)",
    purpose:
      "Cloud infrastructure for the entire Service: compute, the control-plane database, object storage, identity, logging, email delivery, and the Amazon Bedrock model runtime used for bounded AI steps.",
    content: "Yes — all Customer Content is stored and processed here",
    regulated: "Business Associate Addendum available; executed before any PHI-eligible workflow goes live",
  },
  {
    name: "Intercom, Inc.",
    location: "United States",
    purpose:
      "Customer support messaging on our website and inside the customer console. Receives the identity of a signed-in user (identifier, email, name where held, organisation identifier, role) and whatever a person chooses to write in a support conversation.",
    content: "Limited — support conversations and user identity, not workflow data",
    regulated:
      "Not authorised for PHI or other regulated data. Customers must not paste regulated records into a support conversation",
  },
  {
    name: "Amplitude, Inc.",
    location: "United States",
    purpose:
      "Product analytics and session replay for the public website only: which marketing pages are viewed, how visitors move through them, and a masked replay of on-page sessions. Runs on the public and sign-in pages and is switched off in both authenticated consoles.",
    content: "No — excluded from /app and /console, so it does not receive workflow data",
    regulated: "Not authorised for PHI or other regulated data; does not process Customer Content",
  },
  {
    name: "AWS Amplify Hosting (Amazon Web Services, Inc.)",
    location: "United States",
    purpose:
      "Static hosting and content delivery for amazflow.com and the browser applications served from it. Processes standard web request metadata such as IP address and user agent.",
    content: "No — serves the application, does not process workflow data",
    regulated: "Covered by the AWS agreement above",
  },
  {
    name: "Google LLC (Google Workspace)",
    location: "United States",
    purpose:
      "Corporate email, documents, and internal collaboration. Used to run AmazFlow as a business, not to operate the Service.",
    content: "Not intended — may incidentally appear in email correspondence",
    regulated:
      "Workspace BAA available if PHI is intentionally routed through covered services; not current practice",
  },
  {
    name: "GitHub, Inc.",
    location: "United States",
    purpose: "Source-code hosting, code review, and software delivery pipelines.",
    content: "No — Customer Content is not stored in source control",
    regulated: "Not authorised for PHI or customer production content by policy",
  },
  {
    name: "Aikido Security",
    location: "European Union",
    purpose:
      "Application, dependency, infrastructure-as-code, and cloud security scanning of our own codebase and infrastructure.",
    content: "No",
    regulated: "Not authorised for PHI; integration scope is contractually confirmed",
  },
];

export default function SubprocessorsPage() {
  return (
    <LegalDoc
      title="Subprocessors"
      updated="September 9, 2026"
      sections={SECTIONS}
      summary={
        <>
          <p>
            <b>In short:</b> all Customer Content lives in AWS in the United States. Every other
            vendor below either supports our own operations or, in Intercom&rsquo;s case, handles
            support conversations. No subprocessor is authorised to process regulated data without a
            specific agreement covering both that vendor and that workload.
          </p>
        </>
      }
      footer={
        <p>
          This page is referenced by our <Link href="/dpa">Data Processing Agreement</Link> and forms
          part of it.
        </p>
      }
    >
      <LegalSectionBlock id="list" n={1} title="Current subprocessors">
        <p>
          This is the complete list of subprocessors AmazFlow engages to provide or support the
          Service as of the date above.
        </p>
        <LegalTable
          columns={["Subprocessor", "Location", "What it does", "Customer Content?"]}
          rows={VENDORS.map((vendor) => [
            vendor.name,
            vendor.location,
            vendor.purpose,
            vendor.content,
          ])}
        />
      </LegalSectionBlock>

      <LegalSectionBlock id="customer-content" n={2} title="Which ones touch Customer Content">
        <p>
          Most vendors on this list never see Customer Content. Stating which do is more useful than
          a flat list, because it is the distinction that matters in a security review:
        </p>
        <ul>
          <li>
            <b>AWS</b> processes all Customer Content. Workflow definitions, execution records,
            approvals, and audit history are stored in a dedicated, encrypted database in{" "}
            <code>us-east-1</code>, and bounded AI steps run against a model in the same account.
          </li>
          <li>
            <b>Intercom</b> processes support conversations and the identity of the person in them. It
            does not receive workflow definitions, execution records, or audit history.
          </li>
          <li>
            <b>Amplitude</b> receives public-website analytics and session replay. It is switched off
            in both authenticated consoles, so it never receives workflow definitions, execution
            records, or audit history.
          </li>
          <li>
            <b>Everyone else</b> supports AmazFlow&rsquo;s own operations — hosting, email, source
            control, security scanning — and is not a path for Customer Content by design or by policy.
          </li>
        </ul>
      </LegalSectionBlock>

      <LegalSectionBlock id="regulated" n={3} title="Regulated data and BAAs">
        <p>
          A vendor&rsquo;s inclusion on this list authorises it for the purpose described. It does not,
          by itself, authorise that vendor to process protected health information, payment card data,
          or other regulated data.
        </p>
        <LegalTable
          caption="Regulated-data status by subprocessor."
          columns={["Subprocessor", "Regulated-data status"]}
          rows={VENDORS.map((vendor) => [vendor.name, vendor.regulated])}
        />
        <LegalCallout tone="warn" title="Support conversations are not a channel for regulated data">
          <p>
            Because Intercom is not authorised for regulated data, customers and their users must not
            paste protected health information, payment card data, government identification numbers,
            or credentials into a support conversation. If a support issue concerns a specific record,
            reference the run or workflow identifier instead — our{" "}
            <Link href="/security">audit history</Link> lets us find it without the record itself
            crossing into a support tool.
          </p>
        </LegalCallout>
      </LegalSectionBlock>

      <LegalSectionBlock id="notice" n={4} title="Notice of changes">
        <p>
          AmazFlow will provide at least fifteen (15) days&rsquo; notice before adding a new
          subprocessor that will process Customer Personal Data. Notice is given by updating this page
          and, where the customer&rsquo;s agreement requires it, by direct written notice to the
          customer&rsquo;s designated contact.
        </p>
        <p>
          Customers who wish to receive direct notice of subprocessor changes may register a contact
          address by emailing <a href="mailto:privacy@amazflow.com">privacy@amazflow.com</a>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="objection" n={5} title="Objecting to a subprocessor">
        <p>
          A customer may object, on reasonable data-protection grounds, to the appointment of a new
          subprocessor within the notice period. If we cannot resolve the objection by offering a
          commercially reasonable alternative, the customer may terminate the affected part of the
          Service without penalty for the remainder of the then-current term, as set out in the{" "}
          <Link href="/dpa">Data Processing Agreement</Link>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" n={6} title="Questions">
        <p>
          Questions or change requests:{" "}
          <a href="mailto:privacy@amazflow.com">privacy@amazflow.com</a>. Contractual notice
          commitments are governed by the customer&rsquo;s agreement and the Data Processing
          Agreement.
        </p>
      </LegalSectionBlock>
    </LegalDoc>
  );
}
