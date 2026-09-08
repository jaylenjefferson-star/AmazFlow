"use client";

import { useEffect, useState } from "react";

type Settings = { taskExpiryMs: number; confirmationExpiryMs: number; agentCodeExpiryMs: number; bedrockModel: string; dataBoundary: string };

function msToMinutesLabel(ms: number) {
  return (ms / 60000).toFixed(ms % 60000 === 0 ? 0 : 1);
}

export function SettingsPanel({ request }: { request: (path: string, options?: RequestInit) => Promise<unknown> }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ taskExpiryMinutes: "5", confirmationExpiryMinutes: "60", agentCodeExpirySeconds: "120" });

  const load = () => {
    setLoading(true);
    setError(null);
    request("/settings")
      .then((data) => {
        const s = data as Settings;
        setSettings(s);
        setForm({
          taskExpiryMinutes: msToMinutesLabel(s.taskExpiryMs),
          confirmationExpiryMinutes: msToMinutesLabel(s.confirmationExpiryMs),
          agentCodeExpirySeconds: String(s.agentCodeExpiryMs / 1000),
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const body = {
        taskExpiryMs: Math.round(Number(form.taskExpiryMinutes) * 60000),
        confirmationExpiryMs: Math.round(Number(form.confirmationExpiryMinutes) * 60000),
        agentCodeExpiryMs: Math.round(Number(form.agentCodeExpirySeconds) * 1000),
      };
      const next = (await request("/settings", { method: "POST", body: JSON.stringify(body) })) as Settings;
      setSettings(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="product-empty">Loading settings…</p>;

  return (
    <div className="st-wrap">
      <section className="st-section">
        <p className="product-eyebrow">RUNTIME (READ-ONLY)</p>
        <div className="st-readonly">
          <div>
            <b>AI model</b>
            <span>{settings?.bedrockModel}</span>
          </div>
          <div>
            <b>Data boundary</b>
            <span>{settings?.dataBoundary}</span>
          </div>
        </div>
      </section>

      <section className="st-section">
        <p className="product-eyebrow">EXECUTION TIMEOUTS</p>
        <p className="cx-lede">These control real backend behavior — changing them changes how long a run waits before AmazFlow gives up and marks it timed out.</p>
        <label className="st-field">
          <span>Agent task timeout (minutes)</span>
          <input
            type="number"
            min="0.5"
            max="60"
            step="0.5"
            value={form.taskExpiryMinutes}
            onChange={(e) => setForm((f) => ({ ...f, taskExpiryMinutes: e.target.value }))}
          />
        </label>
        <label className="st-field">
          <span>Confirmation gate timeout (minutes)</span>
          <input
            type="number"
            min="1"
            max="1440"
            step="1"
            value={form.confirmationExpiryMinutes}
            onChange={(e) => setForm((f) => ({ ...f, confirmationExpiryMinutes: e.target.value }))}
          />
        </label>
        <label className="st-field">
          <span>Agent authorization code lifetime (seconds)</span>
          <input
            type="number"
            min="30"
            max="600"
            step="10"
            value={form.agentCodeExpirySeconds}
            onChange={(e) => setForm((f) => ({ ...f, agentCodeExpirySeconds: e.target.value }))}
          />
        </label>
        {error && <p className="au-error">{error}</p>}
        <div className="st-actions">
          <button className="console-btn console-btn-primary" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          {saved && <span className="st-saved">✓ Saved</span>}
        </div>
      </section>
    </div>
  );
}
