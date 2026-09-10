"use client";

import { useEffect, useState } from "react";
import { LogoMark } from "../../site-components";
import { API, type Session, resolveSession } from "../../lib/cognito-auth";
// This page is built from the auth card primitives (auth-standalone, auth-card, auth-field,
// auth-submit) but only ever imported console.css, so every one of those eight classes resolved
// to nothing and the form rendered unstyled. /console/support imports both for the same reason.
import "../../auth.css";
import "../console.css";

type Organization = {
  id: string;
  name: string;
  slug: string;
  status: string;
  branding?: {
    displayName?: string;
    logoUrl?: string;
    // The stored field is `accent`. This type said `primaryColor` while the code read and wrote
    // `accent`, so the declaration described a field that has never existed.
    accent?: string;
    loginMessage?: string;
  };
  settings?: {
    maxConcurrentRuns?: number;
    allowedEmailDomains?: string[];
    timezone?: string;
  };
};

const TIMEZONES = (() => {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (supported && supported.length) return supported;
  } catch {
    // Fall through.
  }
  return ["UTC", "America/Los_Angeles", "America/New_York", "Europe/London", "Asia/Tokyo"];
})();

export default function SettingsPage() {
  const [session, setSession] = useState<Session | null>();
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [loginMessage, setLoginMessage] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [savedTimezone, setSavedTimezone] = useState("UTC");

  useEffect(() => {
    resolveSession().then((restored) => {
      if (!restored) {
        window.location.assign(`/login?next=${encodeURIComponent("/console/settings/")}`);
        return;
      }
      if (restored.role === "SUPER_ADMIN") {
        window.location.assign("/app/settings/");
        return;
      }
      if (restored.role !== "CLIENT_ADMIN") {
        window.location.assign("/console/");
        return;
      }
      setSession(restored);
      loadOrg(restored);
    });
  }, []);

  const loadOrg = async (currentSession: Session) => {
    setLoading(true);
    setError(null);
    try {
      // The full organization rather than the public branding subset, so this page can show the
      // limits actually in force alongside what the customer is allowed to change.
      const response = await fetch(`${API}/organizations/${encodeURIComponent(currentSession.tenantId)}`, {
        headers: { Authorization: `Bearer ${currentSession.idToken}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Failed to load organization settings");

      setOrg(body);
      setDisplayName(body.branding?.displayName || body.name);
      setLogoUrl(body.branding?.logoUrl || "");
      setPrimaryColor(body.branding?.accent || "#ff765c");
      setLoginMessage(body.branding?.loginMessage || "");
      const zone = body.settings?.timezone || "UTC";
      setTimezone(zone);
      setSavedTimezone(zone);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!session || !org) return;

    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch(`${API}/organizations/${encodeURIComponent(session.tenantId)}/branding`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${session.idToken}`,
        },
        body: JSON.stringify({
          displayName: displayName.trim() || org.name,
          logoUrl: logoUrl.trim() || undefined,
          accent: primaryColor.trim() || "#ff765c",
          loginMessage: loginMessage.trim() || undefined,
        }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Failed to save settings");
      let latest = body;

      // Branding and settings are separate routes because they carry different authority: a
      // customer admin owns their presentation, but not their own execution limits.
      if (timezone !== savedTimezone) {
        const zoneResponse = await fetch(
          `${API}/organizations/${encodeURIComponent(session.tenantId)}/settings`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              Authorization: `Bearer ${session.idToken}`,
            },
            body: JSON.stringify({ timezone }),
          },
        );
        const zoneBody = await zoneResponse.json().catch(() => ({}));
        if (!zoneResponse.ok) throw new Error(zoneBody.error ?? "Failed to save the time zone");
        latest = zoneBody;
        setSavedTimezone(timezone);
      }

      setOrg(latest);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!session) {
    return (
      <div className="auth-standalone">
        <div className="console-loading">
          <div className="console-signin-logo" style={{ margin: "0 auto 18px" }}>
            <LogoMark size={24} />
          </div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="auth-standalone">
        <div className="console-loading">
          <div className="console-signin-logo" style={{ margin: "0 auto 18px" }}>
            <LogoMark size={24} />
          </div>
          <p>Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-standalone">
      <div className="auth-card" style={{ maxWidth: 640 }}>
        <a className="auth-card-mobile-brand" href="/console/" style={{ display: "flex", marginBottom: 20 }}>
          <span>
            <LogoMark size={16} />
          </span>
          Organization Settings
        </a>

        <h2>Branding & Customization</h2>
        <p className="auth-lede" style={{ marginBottom: 24 }}>
          Customize how AmazFlow appears for your team.
        </p>

        {error && (
          <div className="auth-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        {saved && (
          <div className="auth-success" style={{ marginBottom: 16 }}>
            ✓ Settings saved successfully
          </div>
        )}

        <div className="auth-field">
          <label htmlFor="displayName">Organization Display Name</label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={org?.name || "Your Organization"}
            disabled={saving}
          />
          <small style={{ color: "var(--muted)", fontSize: 12, marginTop: 4, display: "block" }}>
            How your organization name appears in the console
          </small>
        </div>

        <div className="auth-field">
          <label htmlFor="logoUrl">
            Logo URL <small style={{ fontWeight: "normal", color: "var(--muted)" }}>(optional)</small>
          </label>
          <input
            id="logoUrl"
            type="url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://example.com/logo.png"
            disabled={saving}
          />
          <small style={{ color: "var(--muted)", fontSize: 12, marginTop: 4, display: "block" }}>
            Square image, recommended minimum 128×128px
          </small>
        </div>

        <div className="auth-field">
          <label htmlFor="primaryColor">Primary Accent Color</label>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <input
              id="primaryColor"
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              disabled={saving}
              style={{ width: 60, height: 42, cursor: "pointer", borderRadius: 8 }}
            />
            <input
              type="text"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              placeholder="#ff765c"
              disabled={saving}
              style={{ flex: 1 }}
            />
          </div>
          <small style={{ color: "var(--muted)", fontSize: 12, marginTop: 4, display: "block" }}>
            Used for buttons and accents throughout the console
          </small>
        </div>

        <div className="auth-field">
          <label htmlFor="loginMessage">
            Welcome Message <small style={{ fontWeight: "normal", color: "var(--muted)" }}>(optional)</small>
          </label>
          <textarea
            id="loginMessage"
            value={loginMessage}
            onChange={(e) => setLoginMessage(e.target.value)}
            placeholder="Welcome to your AmazFlow workspace"
            disabled={saving}
            rows={3}
            style={{ fontFamily: "inherit", resize: "vertical" }}
          />
          <small style={{ color: "var(--muted)", fontSize: 12, marginTop: 4, display: "block" }}>
            Shown to your team on the sign-in page
          </small>
        </div>

        <div className="support-or" style={{ margin: "26px 0 18px" }}>
          <span>workspace</span>
        </div>

        <div className="auth-field">
          <label htmlFor="timezone">Time zone</label>
          <select
            id="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={saving}
          >
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <small style={{ color: "var(--muted)", fontSize: 12, marginTop: 4, display: "block" }}>
            How dates and times are shown for your workspace
          </small>
        </div>

        {/* Read-only on purpose: these are set by AmazFlow, and the control plane refuses a change
            from a customer admin. Showing them without an input is more honest than hiding them
            and leaving a limit to be discovered when a run is refused. */}
        <div className="support-chat-card" style={{ display: "block", marginTop: 4 }}>
          <b>Set by AmazFlow</b>
          <small style={{ maxWidth: "none" }}>
            Runs at a time:{" "}
            <strong>
              {org?.settings?.maxConcurrentRuns
                ? `${org.settings.maxConcurrentRuns} at a time`
                : "No limit"}
            </strong>
            {" · "}
            Sign-in domains:{" "}
            <strong>
              {org?.settings?.allowedEmailDomains?.length
                ? org.settings.allowedEmailDomains.join(", ")
                : "Any"}
            </strong>
            <br />
            Ask your AmazFlow contact if either of these needs to change.
          </small>
        </div>

        <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
          <button className="auth-submit" onClick={save} disabled={saving} style={{ flex: 1 }}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <a
            href="/console/"
            className="console-btn console-btn-quiet"
            style={{
              display: "grid",
              placeItems: "center",
              textDecoration: "none",
              padding: "0 20px",
              border: "1.5px solid var(--line)",
              borderRadius: 11,
              fontWeight: 800,
            }}
          >
            Cancel
          </a>
        </div>

        <div style={{ marginTop: 32, padding: "16px 20px", background: "#f7f4eb", borderRadius: 12 }}>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            <strong>Note:</strong> Changes may take a few minutes to appear for all team members. Ask them to refresh their browser if they don't see updates immediately.
          </p>
        </div>
      </div>
    </div>
  );
}
