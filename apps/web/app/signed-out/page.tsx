"use client";

import { LogoMark } from "../site-components";
import "../auth.css";

export default function SignedOutPage() {
  return (
    <div className="auth-standalone">
      <div className="auth-status-card">
        <div className="auth-status-icon">
          <LogoMark size={24} />
        </div>
        <h1>You’ve signed out</h1>
        <p>Come back anytime — your workflows and history will be right where you left them.</p>
        <a className="auth-submit" href="/login" style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>
          Sign in again →
        </a>
      </div>
    </div>
  );
}
