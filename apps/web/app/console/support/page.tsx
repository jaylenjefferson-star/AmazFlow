"use client";

import { useEffect, useState } from "react";
import { LogoMark } from "../../site-components";
import { type Session } from "../../lib/cognito-auth";
import { apiCall } from "../../lib/api-client";
import { customerSurface, enforceSessionAccess } from "../../lib/session-gate";
import { openSupportChat } from "../../lib/intercom";
import "../../auth.css";
import "../console.css";

const CATEGORIES = [
  { value: "workflow_issue", label: "Workflow isn't working" },
  { value: "approval_needed", label: "Need help with an approval" },
  { value: "account_access", label: "Account or access issue" },
  { value: "feature_request", label: "Feature request" },
  { value: "general", label: "General question" },
];

const PRIORITIES = [
  { value: "low", label: "Low - When you have time" },
  { value: "normal", label: "Normal - Regular support" },
  { value: "high", label: "High - Affecting multiple people" },
  { value: "urgent", label: "Urgent - Critical workflow blocked" },
];

type SubmitStatus = "idle" | "submitting" | "success" | "error";

export default function SupportTicketPage() {
  const [session, setSession] = useState<Session | null>();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("normal");
  const [runId, setRunId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);

  useEffect(() => {
    enforceSessionAccess(
      customerSurface("/console/support/", { staffPath: "/app/support/" }),
    ).then((allowed) => {
      if (allowed) setSession(allowed);
    });
  }, []);

  const submit = async () => {
    if (!session || !subject.trim() || !message.trim()) return;

    setStatus("submitting");
    setError(null);

    try {
      const body = await apiCall<{ id: string }>(session, "/support/tickets", {
        method: "POST",
        body: {
          subject: subject.trim(),
          message: message.trim(),
          category,
          priority,
          runId: runId.trim() || undefined,
          workflowId: workflowId.trim() || undefined,
        },
        onSessionRenewed: setSession,
      });

      setTicketId(body.id);
      setStatus("success");
      setSubject("");
      setMessage("");
      setRunId("");
      setWorkflowId("");
      setCategory("general");
      setPriority("normal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStatus("error");
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

  if (status === "success") {
    return (
      <div className="auth-standalone">
        <div className="auth-status-card" style={{ textAlign: "center" }}>
          <div className="auth-success">✓</div>
          <h1>Ticket submitted</h1>
          <p>
            Your support request (<strong>{ticketId}</strong>) is with our team. We'll reply within one business day.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24 }}>
            <a className="console-btn console-btn-primary" href="/console/" style={{ textDecoration: "none" }}>
              Back to Home
            </a>
            <button className="console-btn console-btn-quiet" onClick={() => setStatus("idle")}>
              Submit another
            </button>
            <button
              className="console-btn console-btn-quiet"
              onClick={() => openSupportChat(`About ticket ${ticketId}: `)}
            >
              Chat about it
            </button>
          </div>
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
          AmazFlow Support
        </a>

        <h2>Get help from our team</h2>
        <p className="auth-lede" style={{ marginBottom: 20 }}>
          Chat with us for anything quick. Use the form below when the problem is tied to a
          specific run or workflow, so the details arrive with it.
        </p>

        {/* Live chat first, because most questions are answered faster in a conversation than in
            a ticket. The form stays because it captures run and workflow ids that a chat message
            cannot, and those are what make an issue diagnosable. */}
        <div className="support-chat-card">
          <div>
            <b>Chat with support</b>
            <small>Usually answered the same day. Your workspace details come through with it.</small>
          </div>
          <button
            type="button"
            className="console-btn console-btn-primary"
            onClick={() => openSupportChat()}
          >
            Start a chat
          </button>
        </div>

        <div className="support-or">
          <span>or file a ticket</span>
        </div>

        {error && (
          <div className="auth-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div className="auth-field">
          <label htmlFor="category">What type of help do you need?</label>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={status === "submitting"}
          >
            {CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        <div className="auth-field">
          <label htmlFor="priority">Priority</label>
          <select
            id="priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            disabled={status === "submitting"}
          >
            {PRIORITIES.map((pri) => (
              <option key={pri.value} value={pri.value}>
                {pri.label}
              </option>
            ))}
          </select>
        </div>

        <div className="auth-field">
          <label htmlFor="subject">Subject</label>
          <input
            id="subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Brief description of the issue"
            required
            maxLength={200}
            disabled={status === "submitting"}
          />
        </div>

        <div className="auth-field">
          <label htmlFor="message">Description</label>
          <textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What happened? What were you trying to do? Any error messages?"
            required
            rows={6}
            disabled={status === "submitting"}
            style={{ fontFamily: "inherit", resize: "vertical" }}
          />
        </div>

        <div className="auth-field">
          <label htmlFor="runId">
            Run ID <small style={{ fontWeight: "normal", color: "var(--muted)" }}>(optional)</small>
          </label>
          <input
            id="runId"
            type="text"
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            placeholder="e.g. run-abc123"
            disabled={status === "submitting"}
          />
        </div>

        <div className="auth-field">
          <label htmlFor="workflowId">
            Workflow ID <small style={{ fontWeight: "normal", color: "var(--muted)" }}>(optional)</small>
          </label>
          <input
            id="workflowId"
            type="text"
            value={workflowId}
            onChange={(e) => setWorkflowId(e.target.value)}
            placeholder="e.g. workflow-employee-offboarding"
            disabled={status === "submitting"}
          />
        </div>

        <button
          className="auth-submit"
          onClick={submit}
          disabled={status === "submitting" || !subject.trim() || !message.trim()}
          style={{ marginTop: 8 }}
        >
          {status === "submitting" ? "Submitting..." : "Submit support ticket"}
        </button>

        <div className="auth-links" style={{ justifyContent: "center", marginTop: 20 }}>
          <a href="/console/">← Back to Home</a>
        </div>

        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 20, textAlign: "center" }}>
          For urgent production issues, email{" "}
          <a href="mailto:support@amazflow.com" style={{ fontWeight: 700 }}>
            support@amazflow.com
          </a>{" "}
          directly.
        </p>
      </div>
    </div>
  );
}
