"use client";

import { useState } from "react";

const API = "https://5jsi2v2k35.execute-api.us-east-1.amazonaws.com";
const SALES = "sales@amazflow.com";

type Status = "idle" | "sending" | "sent" | "error";

export function LeadForm({ source = "contact" }: { source?: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const read = (field: string) => String(values.get(field) ?? "");
    const data = {
      name: read("name"), email: read("email"), company: read("company"), role: read("role"),
      workflow: read("workflow"), volume: read("volume"), message: read("message"), website: read("website"),
    };
    setStatus("sending");
    setError("");
    try {
      const response = await fetch(`${API}/leads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...data, source }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "We couldn't submit that just now.");
      setStatus("sent");
      form.reset();
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    }
  };

  if (status === "sent") {
    return (
      <div className="lead-form lead-done">
        <div className="lead-check">✓</div>
        <h3>Got it — we'll be in touch.</h3>
        <p>Your workflow is with our team. Expect a reply within one business day, usually sooner.</p>
        <button className="lead-again" onClick={() => setStatus("idle")}>Submit another workflow</button>
      </div>
    );
  }

  return (
    <form className="lead-form" onSubmit={submit}>
      <div className="lead-row">
        <label>Name<input name="name" required autoComplete="name" placeholder="Jane Okafor" /></label>
        <label>Work email<input name="email" type="email" required autoComplete="email" placeholder="jane@company.com" /></label>
      </div>
      <div className="lead-row">
        <label>Company<input name="company" autoComplete="organization" placeholder="Northwind Health" /></label>
        <label>Your role<input name="role" autoComplete="organization-title" placeholder="Director of Operations" /></label>
      </div>
      <label>What workflow do you want to stop doing manually?<textarea name="workflow" rows={3} placeholder="Employee offboarding across HRIS, identity, and Slack — about 40 a month, each taking an hour." /></label>
      <div className="lead-row">
        <label>Rough monthly volume<input name="volume" placeholder="40 per month" /></label>
        <label>Anything else<input name="message" placeholder="Optional" /></label>
      </div>
      <input className="lead-trap" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <button className="button primary lead-submit" type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Request a workflow assessment"} <b>↗</b>
      </button>
      {status === "error" && (
        <p className="lead-error">
          {error} You can also email us directly at <a href={`mailto:${SALES}`}>{SALES}</a>.
        </p>
      )}
      <small className="lead-note">We'll only use this to talk about your workflow. No list, no drip campaign.</small>
    </form>
  );
}
