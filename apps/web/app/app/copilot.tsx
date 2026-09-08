"use client";

import { useEffect, useRef, useState } from "react";

type ChatMessage = { role: "user" | "assistant"; text: string };
type CopilotActionSummary = { proposed: true; actionId: string; summary: string; highRisk?: boolean };
type CopilotAction = {
  id: string;
  kind: string;
  summary: string;
  status: string;
  createdAt: string;
  payload: { op: string; workflow?: any; org?: any; before?: any };
};

export function CopilotPanel({
  request,
  context,
}: {
  request: (path: string, options?: RequestInit) => Promise<any>;
  context?: { section: string; entityId?: string };
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingActions, setPendingActions] = useState<CopilotAction[]>([]);
  const [actingOnId, setActingOnId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const loadPending = async () => {
    try {
      const items = (await request("/copilot/actions?status=PENDING")) as CopilotAction[];
      setPendingActions(items);
    } catch {
      // The panel is still usable without the pending list -- a transient load failure
      // shouldn't block chatting.
    }
  };

  const loadConversation = async () => {
    try {
      const conv = await request("/copilot/conversation");
      const msgs: ChatMessage[] = (conv.messages || []).map((m: any) => ({
        role: m.role,
        text: m.content?.[0]?.text || "",
      }));
      setMessages(msgs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    if (open && !loaded) {
      loadConversation();
      loadPending();
    }
  }, [open, loaded]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, pendingActions]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setMessages((current) => [...current, { role: "user", text }]);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const result = await request("/copilot/messages", { method: "POST", body: JSON.stringify({ message: text, context }) });
      setMessages((current) => [...current, { role: "assistant", text: result.reply || "" }]);
      if ((result.pendingActions as CopilotActionSummary[] | undefined)?.length) await loadPending();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const applyAction = async (id: string) => {
    setActingOnId(id);
    setError(null);
    try {
      await request(`/copilot/actions/${id}/apply`, { method: "POST" });
      setPendingActions((current) => current.filter((action) => action.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActingOnId(null);
    }
  };

  const discardAction = async (id: string) => {
    setActingOnId(id);
    setError(null);
    try {
      await request(`/copilot/actions/${id}/discard`, { method: "POST" });
      setPendingActions((current) => current.filter((action) => action.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActingOnId(null);
    }
  };

  return (
    <>
      <button
        className={`copilot-fab ${open ? "open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Close AmazFlow Copilot" : "Open AmazFlow Copilot"}
        aria-expanded={open}
      >
        {open ? "✕" : "✦"}
      </button>
      {open && (
        <div className="copilot-panel" role="dialog" aria-label="AmazFlow Copilot">
          <div className="copilot-head">
            <b>AmazFlow Copilot</b>
            <small>Real read access. Every change is proposed here — nothing applies until you say so.</small>
          </div>
          <div className="copilot-body" ref={bodyRef}>
            {!loaded ? (
              <p className="copilot-empty">Loading…</p>
            ) : messages.length === 0 && pendingActions.length === 0 ? (
              <p className="copilot-empty">
                Ask about a workflow, a run, or an organization — or ask me to draft or edit one. I&apos;ll always
                propose changes for you to review first.
              </p>
            ) : (
              messages.map((message, index) => (
                <div className={`copilot-msg ${message.role}`} key={index}>
                  {message.text}
                </div>
              ))
            )}
            {pendingActions.map((action) => (
              <div className="copilot-action" key={action.id}>
                <div className="copilot-action-head">
                  <b>{action.kind === "WORKFLOW_STATUS" ? "⚠ High-risk proposed change" : "Proposed change"}</b>
                  <span className="copilot-action-status">{action.status}</span>
                </div>
                <p>{action.summary}</p>
                <ActionDiff action={action} />
                <div className="copilot-action-buttons">
                  <button disabled={actingOnId === action.id} onClick={() => discardAction(action.id)}>
                    Discard
                  </button>
                  <button
                    className="copilot-apply"
                    disabled={actingOnId === action.id}
                    onClick={() => applyAction(action.id)}
                  >
                    {actingOnId === action.id ? "Applying…" : "Apply →"}
                  </button>
                </div>
              </div>
            ))}
            {sending && <div className="copilot-msg assistant copilot-thinking">Thinking…</div>}
            {error && <p className="copilot-error">{error}</p>}
          </div>
          <div className="copilot-input">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Ask AmazFlow Copilot…"
              rows={2}
              aria-label="Message AmazFlow Copilot"
            />
            <button disabled={sending || !input.trim()} onClick={send} aria-label="Send message">
              {sending ? "…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ActionDiff({ action }: { action: CopilotAction }) {
  const { payload } = action;
  if (payload.op === "SAVE_WORKFLOW") {
    const before = payload.before;
    const after = payload.workflow;
    if (!before) {
      return (
        <p className="copilot-diff-new">
          New workflow &quot;{after.name}&quot; ({after.id}), version {after.version}, status {after.status}.
        </p>
      );
    }
    const changes: string[] = [];
    if (before.status !== after.status) changes.push(`status: ${before.status} → ${after.status}`);
    if (before.version !== after.version) changes.push(`version: v${before.version} → v${after.version}`);
    if (JSON.stringify(before.assignedRoles) !== JSON.stringify(after.assignedRoles)) {
      changes.push(`assigned roles: ${(before.assignedRoles || []).join(", ")} → ${(after.assignedRoles || []).join(", ")}`);
    }
    const beforeSteps = new Map((before.steps || []).map((step: any) => [step.id, step]));
    const beforeIds = new Set(beforeSteps.keys());
    for (const step of after.steps || []) {
      if (!beforeIds.has(step.id)) {
        changes.push(`+ new step "${step.id}" (${step.type})`);
      } else if (JSON.stringify(beforeSteps.get(step.id)) !== JSON.stringify(step)) {
        changes.push(`step "${step.id}" changed`);
      }
    }
    if (changes.length === 0) changes.push("Cloned unchanged — ready for you to edit further before publishing.");
    return (
      <ul className="copilot-diff">
        {changes.map((change, index) => (
          <li key={index}>{change}</li>
        ))}
      </ul>
    );
  }
  if (payload.op === "SAVE_ORG") {
    const before = payload.before?.branding || {};
    const after = payload.org?.branding || {};
    const changes = Object.keys(after)
      .filter((key) => before[key] !== after[key])
      .map((key) => `${key}: "${before[key] || ""}" → "${after[key] || ""}"`);
    return (
      <ul className="copilot-diff">
        {changes.map((change, index) => (
          <li key={index}>{change}</li>
        ))}
      </ul>
    );
  }
  return null;
}
