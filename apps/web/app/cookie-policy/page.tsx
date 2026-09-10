import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalDoc, LegalSectionBlock, LegalTable } from "../legal-components";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description:
    "The cookies and third-party technologies used on amazflow.com, what each one is for, where they do and do not run, and the choices available to you.",
};

const SECTIONS = [
  { id: "what-are-cookies", title: "What cookies are" },
  { id: "what-we-use", title: "What we use, specifically" },
  { id: "analytics", title: "Analytics and session replay" },
  { id: "support", title: "Support messenger" },
  { id: "fonts", title: "Fonts and other assets" },
  { id: "not-used", title: "What we do not use" },
  { id: "choices", title: "Your choices" },
  { id: "eu-uk", title: "EU, UK, and Swiss visitors" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "Contact" },
];

export default function CookiePolicyPage() {
  return (
    <LegalDoc
      title="Cookie Policy"
      effective="September 7, 2026"
      updated="September 9, 2026"
      sections={SECTIONS}
      summary={
        <>
          <p>
            <b>In short:</b> our public website uses first-party product analytics and session replay
            (Amplitude) to understand how the marketing pages are used, plus a support messenger
            (Intercom). It runs no advertising and no cross-site behavioural tracking. Our signed-in
            workspaces — the customer console and the operator console — are deliberately <b>excluded</b>
            {" "}from analytics and session replay, and keep you logged in using local storage rather
            than cookies.
          </p>
          <p>This summary is for orientation. The sections below are the policy.</p>
        </>
      }
    >
      <LegalSectionBlock id="what-are-cookies" n={1} title="What cookies are">
        <p>
          Cookies are small text files a website stores on your device. Related technologies — local
          storage and session storage — do a similar job through a different browser mechanism. This
          Policy covers all of them, because the distinction matters less to you than what the data is
          used for.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="what-we-use" n={2} title="What we use, specifically">
        <p>
          This is the complete list as of the date above. Where a technology is set by a third party
          rather than by us, it says so, and where it is limited to part of the site, it says where.
        </p>
        <LegalTable
          columns={["Name / pattern", "Set by", "Purpose", "Where"]}
          rows={[
            [
              <code key="a">AMP_*</code>,
              "Amplitude",
              "Product analytics: a device and session identifier used to count and group page views and interactions on the public website.",
              "Public website only",
            ],
            [
              <code key="b">AMP_MKTG_*</code>,
              "Amplitude",
              "Records the referring URL and campaign parameters of the visit that brought you to the site, so we can tell which pages draw interest.",
              "Public website only",
            ],
            [
              <code key="c">AMP_SR_*</code>,
              "Amplitude",
              "Session replay: markers that tie a recording of a public-page session to its analytics session. See section 3.",
              "Public website only",
            ],
            [
              <code key="d">intercom-*</code>,
              "Intercom",
              "Keeps a support conversation attached to you across page loads, and remembers whether the messenger is open.",
              "Public site + customer console",
            ],
            [
              <code key="e">amazflow_session</code>,
              "AmazFlow",
              "Keeps you signed in to the customer console or operator workspace. Holds your session tokens.",
              "Signed-in workspaces",
            ],
            [
              <code key="f">amazflow_ops_theme</code>,
              "AmazFlow",
              "Remembers light or dark mode in the operator workspace.",
              "Operator console",
            ],
            [
              <code key="g">amazflow_org_name_*</code>,
              "AmazFlow",
              "Caches your organisation's display name for the browser tab, to avoid re-requesting it.",
              "Signed-in workspaces",
            ],
          ]}
        />
        <p>
          None of the above is used to build an advertising audience or to track you across other
          companies&rsquo; websites.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="analytics" n={3} title="Analytics and session replay">
        <p>
          On our public website we use <b>Amplitude</b> for product analytics and session replay. It
          records which pages are viewed and how visitors move through them, and it captures a replay
          of the on-page session — cursor movement, clicks, scrolling, and page content — so we can
          see where the site is confusing and fix it. Amplitude receives this together with technical
          information such as your IP address, browser, and device type. Amplitude is listed on our{" "}
          <Link href="/subprocessors">Subprocessors</Link> page.
        </p>
        <LegalCallout title="Where session replay does not run">
          <p>
            Analytics and session replay run on the <b>public marketing and sign-in pages only</b>.
            They are switched off in the customer console (<code>/console</code>) and the operator
            console (<code>/app</code>), so the data you and your team work with inside AmazFlow — and
            the records a workflow touches — are never recorded into a third-party tool. This is
            enforced in code, not by policy alone: the analytics component does not initialise on those
            routes.
          </p>
        </LegalCallout>
        <p>
          Session replay applies Amplitude&rsquo;s default masking to form fields, so text typed into
          inputs on the pages where it runs — for example the email and password fields on the sign-in
          page — is masked in the recording rather than captured in the clear. We do not disable that
          masking.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="support" n={4} title="Support messenger">
        <p>
          We use <b>Intercom</b> for the support chat on this site and inside the customer console.
          When the messenger loads it sets its own cookies and receives the technical information
          needed to run the chat, including your IP address and the pages where you interact with it.
          If you are signed in as a customer user, we also pass Intercom your identifier, email,
          organisation, role, and name where we hold one, so the person answering knows who they are
          talking to. If you are not signed in, the messenger is anonymous unless you provide details
          in the conversation. The messenger does <b>not</b> load in the operator console, and is not
          loaded for AmazFlow staff accounts.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="fonts" n={5} title="Fonts and other assets">
        <p>
          All fonts, styles, scripts, and images are served from our own infrastructure. We
          deliberately do not load webfonts from a third-party font service, because that would
          disclose your IP address to that provider on every page view for no functional benefit.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="not-used" n={6} title="What we do not use">
        <p>As of the date above, this site does not use:</p>
        <ul>
          <li>Advertising or marketing cookies, pixels, or conversion tags.</li>
          <li>Cross-site or cross-context behavioural tracking, or data brokers.</li>
          <li>Analytics or session replay inside the signed-in workspaces (see section 3).</li>
          <li>Social media embeds or share widgets that set cookies.</li>
        </ul>
        <p>
          We use analytics and session replay as a first party, to improve our own website — not to
          profile you for anyone else. As stated in our <Link href="/privacy">Privacy Policy</Link>,
          we do not sell personal information and do not share it for cross-context behavioural
          advertising, as those terms are defined under the CCPA/CPRA.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="choices" n={7} title="Your choices">
        <p>
          <b>Browser controls.</b> Most browsers let you block or delete cookies and clear local
          storage. Because the public site does not depend on cookies to be read, blocking them will
          not stop you browsing; it will stop the analytics, session replay, and support messenger from
          working, which is a legitimate way to opt out. You can always reach us at{" "}
          <a href="mailto:support@amazflow.com">support@amazflow.com</a> instead.
        </p>
        <p>
          <b>Signing out.</b> Signing out of a workspace clears the session held in local storage and
          clears the support messenger&rsquo;s record of who you were, so a shared computer does not
          carry your identity or conversation history to the next person.
        </p>
        <p>
          <b>California residents.</b> You may contact{" "}
          <a href="mailto:privacy@amazflow.com">privacy@amazflow.com</a> with questions about cookies or
          tracking. We do not sell personal information or share it for cross-context behavioural
          advertising.
        </p>
        <p>
          <b>Do Not Track.</b> This site does not currently respond to browser &ldquo;Do Not
          Track&rdquo; signals, as no common industry standard for interpreting them has been adopted.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="eu-uk" n={8} title="EU, UK, and Swiss visitors">
        <p>
          AmazFlow&rsquo;s site and marketing are not currently directed at the EU, the UK, or
          Switzerland, and we do not target advertising to those regions.
        </p>
        <LegalCallout tone="warn" title="Consent is required before marketing to those regions">
          <p>
            Analytics cookies, session replay, and the support messenger all load with the page rather
            than on a click, which means they are set before any consent could be collected. Before
            AmazFlow directs its site or marketing at the EU, UK, or Switzerland, that must change: these
            technologies will need to be gated behind a consent-management interface, or deferred until
            a visitor opts in, so that no non-essential cookie is set without prior opt-in consent as
            required by the ePrivacy Directive and GDPR. This Policy will be updated at the same time.
          </p>
        </LegalCallout>
      </LegalSectionBlock>

      <LegalSectionBlock id="changes" n={9} title="Changes to this policy">
        <p>
          We may update this Policy as our practices evolve. Material changes are reflected in the
          &ldquo;Last updated&rdquo; date above. When we introduce a new technology that collects
          information — as we did when adding the analytics and session replay described in section 3 —
          we update this Policy as part of the same change, not afterward.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" n={10} title="Contact">
        <p>
          Questions about this Cookie Policy:{" "}
          <a href="mailto:privacy@amazflow.com">privacy@amazflow.com</a>.
        </p>
      </LegalSectionBlock>
    </LegalDoc>
  );
}
