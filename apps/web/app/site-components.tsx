"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <img
      src="/brand/amazflow-icon.png"
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      style={{ width: size, height: size, display: "block" }}
    />
  );
}

export function Logo() {
  return (
    <Link className="site-logo" href="/" aria-label="AmazFlow home">
      <span><LogoMark /></span>
      <b>Amaz<span className="brand-flow">Flow</span></b>
    </Link>
  );
}

export function SkipLink() {
  return <a className="skip-link" href="#main">Skip to content</a>;
}

const NAV_LINKS = [
  { href: "/product", label: "Product" },
  { href: "/solutions", label: "Solutions" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
  { href: "/company", label: "Company" },
];

export function MarketingNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <header className="site-nav">
        <div className="wrap nav-inner">
          <Logo />

          <nav className="nav-desktop" aria-label="Primary">
            {NAV_LINKS.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
          </nav>

          <div className="nav-actions">
            <Link className="nav-signin" href="/login">Sign in</Link>
            <Link className="button quiet nav-demo" href="/demo">Try the demo</Link>
            <Link className="button nav-cta" href="/contact">Talk to sales</Link>
          </div>

          <button
            type="button"
            className="nav-toggle"
            aria-expanded={open}
            aria-controls="mobile-nav-panel"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="nav-toggle-bars" aria-hidden="true"><i /><i /><i /></span>
          </button>
        </div>
      </header>

      {/* Rendered as siblings of <header>, not children -- .site-nav's backdrop-filter
          creates a CSS containing block for position:fixed descendants, which clipped this
          panel to the header's own ~140px height instead of the viewport when it lived
          inside it. */}
      {open && <button type="button" className="nav-overlay" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />}

      <div id="mobile-nav-panel" className={`nav-mobile-panel ${open ? "open" : ""}`}>
        <nav aria-label="Mobile">
          {NAV_LINKS.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}
        </nav>
        <div className="nav-mobile-actions">
          <Link className="button quiet" href="/login" onClick={() => setOpen(false)}>Sign in</Link>
          <Link className="button quiet" href="/demo" onClick={() => setOpen(false)}>Try the interactive demo</Link>
          <Link className="button primary" href="/contact" onClick={() => setOpen(false)}>Talk to sales</Link>
        </div>
      </div>
    </>
  );
}

export function MarketingFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div>
          <Logo />
          <p>Automate the work between your systems.</p>
          <small>© 2026 AmazFlow. All rights reserved.</small>
        </div>
        <div>
          <b>Platform</b>
          <Link href="/product">Product</Link>
          <Link href="/solutions">Solutions</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/demo">Try the interactive demo</Link>
          <Link href="/login">Sign in</Link>
        </div>
        <div>
          <b>Trust</b>
          <Link href="/security">Security</Link>
          <Link href="/legal">Legal &amp; Trust Center</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/dpa">Data Processing</Link>
          <Link href="/subprocessors">Subprocessors</Link>
          <Link href="/cookie-policy">Cookie Policy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/acceptable-use">Acceptable Use</Link>
        </div>
        <div>
          <b>Company</b>
          <Link href="/company">About</Link>
          <Link href="/contact">Contact</Link>
          <a href="mailto:sales@amazflow.com">sales@amazflow.com</a>
          <a href="mailto:security@amazflow.com">security@amazflow.com</a>
        </div>
      </div>
    </footer>
  );
}

export function WorkflowVisual() {
  return (
    <div className="workflow-visual" aria-label="Example AmazFlow employee offboarding workflow">
      <div className="visual-top"><span className="live-dot" aria-hidden="true" /> EXAMPLE EXECUTION <b>AF-2048</b></div>
      <div className="source-row">
        <div><small>EMPLOYEE</small><b>Sarah Chen</b></div>
        <div><small>ACTION</small><b>Offboard</b></div>
        <mark>COMPLETE</mark>
      </div>
      <div className="route" aria-hidden="true">
        <div className="route-line" />
        <Node icon="▦" label="Sheet" done />
        <Node icon={<LogoMark size={18} />} label="AmazFlow" core />
        <Node icon="H" label="HRIS" done />
        <Node icon="◎" label="Identity" done />
        <Node icon="#" label="Slack" done />
      </div>
      <div className="visual-result">
        <div><span>4</span><small>systems updated</small></div>
        <div><span>0</span><small>manual handoffs</small></div>
        <div><span>41s</span><small>total time</small></div>
        <mark>VERIFIED ✓</mark>
      </div>
    </div>
  );
}

function Node({ icon, label, done, core }: { icon: React.ReactNode; label: string; done?: boolean; core?: boolean }) {
  return (
    <div className={`route-node ${core ? "core" : ""}`}>
      <span>{icon}</span>
      <b>{label}</b>
      {done && <i>✓</i>}
    </div>
  );
}

export function PageHero({ eyebrow, title, accent, copy }: { eyebrow: string; title: string; accent: string; copy: string }) {
  return (
    <section className="page-hero wrap">
      <div className="kicker"><span aria-hidden="true" /> {eyebrow}</div>
      <h1>{title}<br /><em>{accent}</em></h1>
      <p>{copy}</p>
    </section>
  );
}

export function StandardPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-site">
      <SkipLink />
      <MarketingNav />
      <main id="main">{children}</main>
      <MarketingFooter />
    </div>
  );
}
