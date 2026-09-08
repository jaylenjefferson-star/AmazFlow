"use client";

import { useState } from "react";

type Ticket = {
  id: string;
  tenantId: string;
  createdBy: string;
  subject: string;
  message: string;
  category: string;
  priority: string;
  status: string;
  runId?: string;
  workflowId?: string;
  notes: { id: string; at: string; by: string; text: string; internal: boolean }[];
  createdAt: string;
  updatedAt: string;
};

const STATUSES = ["open", "in_progress", "resolved", "closed"];

export function SupportPanel({
  tickets,
  loading,
  onSetStatus,
  onAddNote,
  busyTicketId,
}: {
  tickets: Ticket[];
  loading: boolean;
  onSetStatus: (ticket: Ticket, status: string) => Promise<void>;
  onAddNote: (ticket: Ticket, note: string) => Promise<void>;
  busyTicketId: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  if (loading) return <p className="product-empty">Loading support tickets…</p>;
  if (tickets.length === 0) {
    return (
      <p className="ov-empty">
        No support tickets yet. Note: there is no customer-facing &quot;submit a ticket&quot; surface built yet — this inbox is
        real and durable, but the only way a ticket exists today is via the API directly.
      </p>
    );
  }

  const sorted = tickets.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="au-rows">
      {sorted.map((t) => (
        <div className="au-row" key={t.id}>
          <button className="au-row-main" onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
            <span className={`sp-pill sp-pill-${t.status}`}>{t.status.replace("_", " ")}</span>
            <div>
              <b>{t.subject}</b>
              <small>
                {t.tenantId} · {t.priority} · {new Date(t.updatedAt).toLocaleString()}
              </small>
            </div>
            <span className="rp-chevron">{expandedId === t.id ? "⌄" : "›"}</span>
          </button>
          {expandedId === t.id && (
            <div className="au-expand">
              <p>{t.message}</p>
              {t.notes.length > 0 && (
                <div className="sp-notes">
                  {t.notes.map((n) => (
                    <div className="sp-note" key={n.id}>
                      <small>
                        {new Date(n.at).toLocaleString()} {n.internal ? "· internal" : ""}
                      </small>
                      <p>{n.text}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="sp-actions">
                <select
                  value={t.status}
                  disabled={busyTicketId === t.id}
                  onChange={(e) => onSetStatus(t, e.target.value)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
                <input placeholder="Add a note…" value={expandedId === t.id ? noteDraft : ""} onChange={(e) => setNoteDraft(e.target.value)} />
                <button
                  disabled={busyTicketId === t.id || !noteDraft.trim()}
                  onClick={async () => {
                    await onAddNote(t, noteDraft);
                    setNoteDraft("");
                  }}
                >
                  Add note
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
