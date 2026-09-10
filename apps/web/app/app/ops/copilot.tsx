"use client";

/**
 * AmazFlow Copilot.
 *
 * Same contract as before: real read access to the workspace, and every mutation arrives as a
 * proposal that an operator must apply. Restyled into the Control design language and made
 * context-aware of whichever object is currently open.
 */

import { useEffect, useRef, useState } from "react";
import { useOps } from "./data";
import { useNav } from "./nav";
import { Icon } from "./icons";
import { Alert, Btn, Pill } from "./primitives";

type ChatMessage = { role: "user" | "assistant"; text: string };

type CopilotAction = {
  id: string;
  kind: string;
  summary: string;
  status: string;
  createdAt: string;
  payload: {
    op: string;
    workflow?: Record<string, unknown>;
    org?: Record<string, unknown>;
    before?: Record<string, unknown>;
  };
};

const stripThinking = (value: string) =>
  value.replace(/<thinking>[\s\S]*?<\/thinking>\s*/gi, "").trim();

const HIGH_RISK_KINDS = new Set(["WORKFLOW_STATUS", "WORKFLOW_ROLES"]);

export function Copilot() {
  const ops = useOps();
  const nav = useNav();

  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<CopilotAction[]>([]);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const loadPending = async () => {
    try {
      setPending(await ops.request<CopilotAction[]>("/copilot/actions?status=PENDING"));
    } catch {
      // Chatting still works without the proposal list; a transient failure shouldn't block it.
    }
  };

  const loadConversation = async () => {
    try {
      const conversation = await ops.request<{
        messages?: { role: "user" | "assistant"; content?: { text?: string }[] }[];
      }>("/copilot/conversation");
      setMessages(
        (conversation.messages ?? []).map((message) => ({
          role: message.role,
          text: stripThinking(message.content?.[0]?.text ?? ""),
        })),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    if (open && !loaded) {
      loadConversation();
      loadPending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, pending, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setMessages((current) => [...current, { role: "user", text }]);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const result = await ops.request<{
        reply?: string;
        pendingActions?: { actionId: string }[];
      }>("/copilot/messages", {
        method: "POST",
        body: JSON.stringify({
          message: text,
          context: { section: nav.view.section, entityId: nav.view.entityId },
        }),
      });
      setMessages((current) => [
        ...current,
        { role: "assistant", text: stripThinking(result.reply ?? "") },
      ]);
      if (result.pendingActions?.length) await loadPending();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  };

  const resolve = async (id: string, decision: "apply" | "discard") => {
    setActingOn(id);
    setError(null);
    try {
      await ops.request(`/copilot/actions/${id}/${decision}`, { method: "POST", body: "{}" });
      setPending((current) => current.filter((action) => action.id !== id));
      if (decision === "apply") await ops.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActingOn(null);
    }
  };

  return (
    <>
      <button
        className="ops-copilot-fab"
        data-open={open ? "true" : undefined}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="ops-copilot-fab-glyph" aria-hidden="true">
          <Icon name="sparkle" size={13} />
        </span>
        {open ? "Close" : "Copilot"}
        {pending.length > 0 && !open && <Pill tone="waiting">{pending.length}</Pill>}
      </button>

      {open && (
        <div className="ops-copilot" role="dialog" aria-label="AmazFlow Copilot">
          <header className="ops-copilot-head">
            <span className="ops-copilot-fab-glyph" aria-hidden="true">
              <Icon name="sparkle" size={13} />
            </span>
            <span className="ops-col" style={{ gap: 0, flex: 1 }}>
              <b>AmazFlow Copilot</b>
              <small>Reads your workspace. Every change is proposed, never applied silently.</small>
            </span>
          </header>

          <div className="ops-copilot-body" ref={bodyRef}>
            {!loaded ? (
              <p className="ops-small ops-muted">Loading…</p>
            ) : messages.length === 0 && pending.length === 0 ? (
              <div className="ops-col">
                <p className="ops-small ops-muted" style={{ lineHeight: 1.6 }}>
                  Ask about a workflow, a run, or a customer — or ask for a draft or an edit.
                  I&apos;ll propose changes for you to review.
                </p>
                <div className="ops-col ops-gap-sm">
                  {[
                    "Which workflows failed most this week?",
                    "Draft a workflow for vendor invoice intake",
                    "Why did the last run for this customer fail?",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      className="ops-btn"
                      data-size="sm"
                      onClick={() => setInput(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message, index) => (
                <div className="ops-copilot-msg" data-role={message.role} key={index}>
                  {message.text}
                </div>
              ))
            )}

            {pending.map((action) => (
              <div className="ops-copilot-action" key={action.id}>
                <div className="ops-copilot-action-head">
                  <b>Proposed change</b>
                  {HIGH_RISK_KINDS.has(action.kind) && <Pill tone="bad">high risk</Pill>}
                  <span className="ops-spacer" />
                  <span className="ops-small ops-muted">{action.status}</span>
                </div>
                <p>{action.summary}</p>
                <ActionDiff action={action} />
                <div className="ops-copilot-actions-row">
                  <Btn
                    size="sm"
                    disabled={actingOn === action.id}
                    onClick={() => resolve(action.id, "discard")}
                  >
                    Discard
                  </Btn>
                  <Btn
                    size="sm"
                    variant="primary"
                    disabled={actingOn === action.id}
                    onClick={() => resolve(action.id, "apply")}
                  >
                    {actingOn === action.id ? "Applying…" : "Apply"}
                  </Btn>
                </div>
              </div>
            ))}

            {sending && (
              <div className="ops-copilot-msg ops-copilot-thinking" data-role="assistant">
                Thinking…
              </div>
            )}
            {error && <Alert tone="bad" title="Copilot error">{error}</Alert>}
          </div>

          <div className="ops-copilot-input">
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
            <Btn variant="primary" disabled={sending || !input.trim()} onClick={send}>
              Send
            </Btn>
          </div>
        </div>
      )}
    </>
  );
}

/** Human-readable summary of what a proposed action would change. */
function ActionDiff({ action }: { action: CopilotAction }) {
  const { payload } = action;

  if (payload.op === "SAVE_WORKFLOW") {
    const before = payload.before as Record<string, unknown> | undefined;
    const after = payload.workflow as Record<string, unknown> | undefined;
    if (!after) return null;
    if (!before) {
      return (
        <p className="ops-small ops-muted">
          New workflow &ldquo;{String(after.name)}&rdquo;, version {String(after.version)}, status{" "}
          {String(after.status)}.
        </p>
      );
    }

    const changes: string[] = [];
    if (before.status !== after.status) {
      changes.push(`status ${String(before.status)} becomes ${String(after.status)}`);
    }
    if (before.version !== after.version) {
      changes.push(`version v${String(before.version)} becomes v${String(after.version)}`);
    }
    if (JSON.stringify(before.assignedRoles) !== JSON.stringify(after.assignedRoles)) {
      changes.push(
        `access ${((before.assignedRoles as string[]) ?? []).join(", ")} becomes ${((after.assignedRoles as string[]) ?? []).join(", ")}`,
      );
    }

    const beforeSteps = new Map(
      (((before.steps as { id: string }[]) ?? []) as { id: string }[]).map((step) => [step.id, step]),
    );
    for (const step of ((after.steps as { id: string; type: string }[]) ?? [])) {
      if (!beforeSteps.has(step.id)) changes.push(`+ new step "${step.id}" (${step.type})`);
      else if (JSON.stringify(beforeSteps.get(step.id)) !== JSON.stringify(step)) {
        changes.push(`step "${step.id}" changed`);
      }
    }

    if (changes.length === 0) {
      changes.push("Cloned unchanged — ready to edit further before publishing.");
    }
    return (
      <ul className="ops-copilot-diff">
        {changes.map((change, index) => (
          <li key={index}>{change}</li>
        ))}
      </ul>
    );
  }

  if (payload.op === "SAVE_ORG") {
    const before = ((payload.before?.branding ?? {}) as Record<string, string>) ?? {};
    const after = ((payload.org?.branding ?? {}) as Record<string, string>) ?? {};
    const changes = Object.keys(after)
      .filter((key) => before[key] !== after[key])
      .map((key) => `${key}: "${before[key] ?? ""}" becomes "${after[key] ?? ""}"`);
    if (changes.length === 0) return null;
    return (
      <ul className="ops-copilot-diff">
        {changes.map((change, index) => (
          <li key={index}>{change}</li>
        ))}
      </ul>
    );
  }

  return null;
}
