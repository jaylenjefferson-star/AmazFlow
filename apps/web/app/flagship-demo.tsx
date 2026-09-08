"use client";

import { useMemo, useState } from "react";

const STAGES = [
  { id: "arrival", label: "Work item arrives" },
  { id: "systems", label: "Systems involved" },
  { id: "automate", label: "Automated steps run" },
  { id: "ai", label: "Bounded AI decision" },
  { id: "approval", label: "Human approval" },
  { id: "verify", label: "Verify final state" },
  { id: "result", label: "Result & audit trail" },
] as const;

type Outcome = "pending" | "approved" | "sent-back";

const SYSTEMS = [
  { label: "HRIS", role: "Source of truth for the offboarding record" },
  { label: "Identity", role: "Revokes login and app access" },
  { label: "Slack", role: "Deactivates workspace membership" },
  { label: "Ops tracker", role: "Keeps the record your team already checks" },
];

const AUTOMATED_STEPS = [
  "Matched the request to employee record E-10042 (Sarah Chen)",
  "Confirmed the requester is authorized to offboard this employee",
  "Read current access state across HRIS, Identity, and Slack",
];

const EXECUTION_ROWS = [
  { system: "HRIS", change: "Employment status → Offboarded" },
  { system: "Identity", change: "Login and app access → Revoked" },
  { system: "Slack", change: "Workspace membership → Deactivated" },
  { system: "Ops tracker", change: "Row updated with completion timestamp" },
];

const AUDIT_LOG = [
  { time: "09:41:02", event: "Work item received", actor: "TRACKER" },
  { time: "09:41:03", event: "Employee record matched", actor: "POLICY" },
  { time: "09:41:05", event: "AI extracted requested action (93% confidence)", actor: "AI" },
  { time: "09:41:06", event: "Routed for manager approval", actor: "POLICY" },
  { time: "09:41:31", event: "Approved by S. Ramirez, Ops Manager", actor: "HUMAN" },
  { time: "09:41:33", event: "Access revoked across 3 systems", actor: "AGENT" },
  { time: "09:41:40", event: "Expected state confirmed on re-read", actor: "VERIFY" },
  { time: "09:41:41", event: "Workflow completed", actor: "AUDIT" },
];

export function FlagshipDemo() {
  const [stepIndex, setStepIndex] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>("pending");

  const stage = STAGES[stepIndex].id;
  const stopped = outcome === "sent-back";
  const progressPct = useMemo(() => Math.round((stepIndex / (STAGES.length - 1)) * 100), [stepIndex]);

  const goNext = () => setStepIndex((index) => Math.min(index + 1, STAGES.length - 1));
  const goBack = () => setStepIndex((index) => Math.max(index - 1, 0));
  const approve = () => { setOutcome("approved"); goNext(); };
  const sendBack = () => setOutcome("sent-back");
  const reconsider = () => setOutcome("pending");
  const replay = () => { setStepIndex(0); setOutcome("pending"); };

  return (
    <div className="demo" aria-label="Interactive AmazFlow workflow demo: employee offboarding" aria-live="polite">
      <div className="demo-head">
        <div>
          <p className="demo-badge">INTERACTIVE DEMO · SYNTHETIC DATA · NO ACCOUNT NEEDED</p>
          <h3>{stopped ? "Sent back for review" : STAGES[stepIndex].label}</h3>
        </div>
        <p className="demo-step-count">Step {stepIndex + 1} of {STAGES.length}</p>
      </div>

      <div className="demo-progress" aria-hidden="true"><span style={{ width: `${stopped ? 100 : progressPct}%` }} /></div>

      <div className="demo-body">
        {stopped ? (
          <div className="demo-outcome">
            <p>AmazFlow made <b>no changes to any system</b>. The request stays open until it's re-reviewed — nothing was disabled, revoked, or deactivated.</p>
            <div className="demo-controls">
              <button type="button" className="demo-btn" onClick={reconsider}>Back to the approval</button>
              <button type="button" className="demo-btn demo-btn-quiet" onClick={replay}>Replay from the start</button>
            </div>
          </div>
        ) : (
          <>
            {stage === "arrival" && (
              <div className="demo-ticket">
                <div className="demo-ticket-row"><small>SOURCE</small><b>Ops tracker · row 214</b></div>
                <div className="demo-ticket-row"><small>EMPLOYEE</small><b>Sarah Chen · E-10042</b></div>
                <div className="demo-ticket-row"><small>REQUEST</small><b>Offboard — last day is today</b></div>
                <div className="demo-ticket-row"><small>RECEIVED</small><b>Today, 9:41 AM</b></div>
              </div>
            )}

            {stage === "systems" && (
              <div className="demo-systems">
                {SYSTEMS.map((system) => (
                  <div className="demo-system" key={system.label}>
                    <b>{system.label}</b>
                    <p>{system.role}</p>
                  </div>
                ))}
              </div>
            )}

            {stage === "automate" && (
              <ul className="demo-checklist">
                {AUTOMATED_STEPS.map((step) => (
                  <li key={step}><span aria-hidden="true">✓</span>{step}</li>
                ))}
              </ul>
            )}

            {stage === "ai" && (
              <div className="demo-ai-card">
                <div className="demo-ai-row"><small>REQUESTED ACTION</small><b>DISABLE</b></div>
                <div className="demo-ai-row"><small>CONFIDENCE</small><b>93%</b></div>
                <div className="demo-ai-row"><small>ALLOWED OUTCOMES</small><b>DISABLE · REVIEW</b></div>
                <p>AmazFlow's AI can only choose from these two configured outcomes for this step — never an arbitrary action. Because this action revokes access, the workflow still routes to a person before anything changes.</p>
              </div>
            )}

            {stage === "approval" && (
              <div className="demo-approval-card">
                <p>Revoke Sarah Chen's access across HRIS, Identity, and Slack?</p>
                <div className="demo-controls">
                  <button type="button" className="demo-btn" onClick={approve}>Approve →</button>
                  <button type="button" className="demo-btn demo-btn-quiet" onClick={sendBack}>Send back</button>
                </div>
                <small>This is a real branch — try both. Approving continues the run below; sending it back stops the workflow with nothing changed.</small>
              </div>
            )}

            {stage === "verify" && (
              <>
                <ul className="demo-exec-list">
                  {EXECUTION_ROWS.map((row) => (
                    <li key={row.system}><span aria-hidden="true">✓</span><b>{row.system}</b>{row.change}</li>
                  ))}
                </ul>
                <div className="demo-verify-card">
                  <p>AmazFlow re-read each system after making the change and confirmed the expected state — Sarah Chen's account status is now <b>Offboarded</b>.</p>
                </div>
              </>
            )}

            {stage === "result" && (
              <>
                <div className="demo-stats">
                  <div className="demo-stat"><span>41s</span><small>total execution time</small></div>
                  <div className="demo-stat"><span>4</span><small>systems updated automatically</small></div>
                  <div className="demo-stat"><span>0</span><small>manual handoffs</small></div>
                  <div className="demo-stat"><span>{AUDIT_LOG.length}</span><small>audit events recorded</small></div>
                </div>
                <div className="demo-audit">
                  {AUDIT_LOG.map((row) => (
                    <div className="demo-audit-row" key={row.event}>
                      <time>{row.time}</time><b>{row.event}</b><small>{row.actor}</small>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {!stopped && (
        <div className="demo-nav">
          <button type="button" className="demo-nav-btn" onClick={goBack} disabled={stepIndex === 0}>← Back</button>
          {stage === "result" ? (
            <button type="button" className="demo-nav-btn" onClick={replay}>Replay demo ↺</button>
          ) : stage !== "approval" ? (
            <button type="button" className="demo-nav-btn demo-nav-btn-primary" onClick={goNext}>Next →</button>
          ) : (
            <span className="demo-nav-hint">Use the buttons above to continue</span>
          )}
        </div>
      )}
    </div>
  );
}
