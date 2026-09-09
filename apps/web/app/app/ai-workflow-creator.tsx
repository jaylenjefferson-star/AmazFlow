"use client";

import { useState } from "react";
import type { WorkflowDefinition } from "@amazflow/workflow-schema";

type CreationStep = "describe" | "preview" | "refine";

interface AIWorkflowCreatorProps {
  onSave: (workflow: WorkflowDefinition) => Promise<void>;
  onCancel: () => void;
  initialDescription?: string;
}

export function AIWorkflowCreator({ onSave, onCancel, initialDescription = "" }: AIWorkflowCreatorProps) {
  const [step, setStep] = useState<CreationStep>("describe");
  const [description, setDescription] = useState(initialDescription);
  const [generating, setGenerating] = useState(false);
  const [generatedWorkflow, setGeneratedWorkflow] = useState<WorkflowDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refinementPrompt, setRefinementPrompt] = useState("");
  const [refining, setRefining] = useState(false);

  const generateWorkflow = async () => {
    if (!description.trim()) return;
    
    setGenerating(true);
    setError(null);

    try {
      const response = await fetch("/api/workflows/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sop: description.trim() }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Generation failed");

      setGeneratedWorkflow(body as WorkflowDefinition);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setGenerating(false);
    }
  };

  const refineWorkflow = async () => {
    if (!refinementPrompt.trim() || !generatedWorkflow) return;

    setRefining(true);
    setError(null);

    try {
      const response = await fetch("/api/workflows/refine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workflow: generatedWorkflow,
          refinement: refinementPrompt.trim(),
        }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Refinement failed");

      setGeneratedWorkflow(body as WorkflowDefinition);
      setRefinementPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRefining(false);
    }
  };

  const handleSave = async () => {
    if (!generatedWorkflow) return;
    await onSave(generatedWorkflow);
  };

  return (
    <div className="ai-workflow-creator">
      {step === "describe" && (
        <div className="ai-creator-step">
          <div className="ai-creator-header">
            <div>
              <p className="product-eyebrow">AI WORKFLOW DESIGNER</p>
              <h2 style={{ font: "800 32px var(--font-display)", margin: "8px 0" }}>
                Describe what you need done
              </h2>
              <p style={{ color: "var(--muted)", fontSize: 16, lineHeight: 1.6, maxWidth: 600 }}>
                Tell me about the workflow in plain English. I'll turn it into a complete, working workflow with
                steps, decision points, and approvals.
              </p>
            </div>
          </div>

          <div className="ai-creator-body">
            <div className="ai-prompt-examples">
              <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Examples:</p>
              <button
                className="ai-example-chip"
                onClick={() =>
                  setDescription(
                    "When a new vendor invoice arrives by email, extract the vendor name, amount, and due date. If the amount is over $5,000, require manager approval. Then record it in our AP spreadsheet and verify it was saved correctly."
                  )
                }
              >
                Invoice processing
              </button>
              <button
                className="ai-example-chip"
                onClick={() =>
                  setDescription(
                    "When an employee leaves, disable their account in our HRIS, revoke their SSO access, remove them from all Slack channels, and send a confirmation email to their manager. Require HR approval before any changes."
                  )
                }
              >
                Employee offboarding
              </button>
              <button
                className="ai-example-chip"
                onClick={() =>
                  setDescription(
                    "When a customer submits a refund request, check if the order is within 30 days. If yes, check if the amount is under $100. Small refunds are auto-approved, large ones need manager review. Then process the refund in Stripe and send a confirmation email."
                  )
                }
              >
                Refund automation
              </button>
            </div>

            <label htmlFor="workflow-description" style={{ fontSize: 14, fontWeight: 700, display: "block", marginBottom: 8 }}>
              Your workflow description
            </label>
            <textarea
              id="workflow-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Example: When someone submits a time-off request, check if they have enough PTO balance. If yes, route to their manager for approval. If approved, update the HRIS and send a calendar invite..."
              rows={12}
              style={{
                width: "100%",
                fontFamily: "var(--font-body)",
                fontSize: 15,
                lineHeight: 1.7,
                padding: 16,
                border: "1.5px solid var(--line)",
                borderRadius: 12,
                background: "var(--paper)",
                resize: "vertical",
              }}
            />

            {error && (
              <div
                style={{
                  background: "#fff0eb",
                  border: "1px solid var(--coral)",
                  borderRadius: 12,
                  padding: "12px 16px",
                  marginTop: 16,
                  fontSize: 14,
                  color: "var(--ink)",
                }}
              >
                {error}
              </div>
            )}

            <div className="ai-creator-actions">
              <button className="console-btn console-btn-quiet" onClick={onCancel} disabled={generating}>
                Cancel
              </button>
              <button
                className="console-btn console-btn-primary"
                onClick={generateWorkflow}
                disabled={!description.trim() || generating}
              >
                {generating ? "Designing workflow..." : "Generate workflow →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "preview" && generatedWorkflow && (
        <div className="ai-creator-step">
          <div className="ai-creator-header">
            <div>
              <p className="product-eyebrow">AI-GENERATED WORKFLOW</p>
              <h2 style={{ font: "800 32px var(--font-display)", margin: "8px 0" }}>
                {generatedWorkflow.name}
              </h2>
              <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>
                {generatedWorkflow.description}
              </p>
            </div>
          </div>

          <div className="ai-creator-body">
            <div className="ai-workflow-preview">
              <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 16 }}>
                Steps ({generatedWorkflow.steps.length})
              </h3>
              <div className="ai-step-list">
                {generatedWorkflow.steps.map((step, index) => (
                  <div key={step.id} className="ai-step-card">
                    <div className="ai-step-number">{index + 1}</div>
                    <div className="ai-step-content">
                      <div className="ai-step-header">
                        <b>{step.name}</b>
                        <span className="ai-step-type">{step.type}</span>
                      </div>
                      {step.type === "ai" && (
                        <p>
                          <strong>AI Operation:</strong> {step.operation}
                          {step.allowedValues && step.allowedValues.length > 0 && (
                            <>
                              {" "}
                              · <strong>Options:</strong> {step.allowedValues.join(", ")}
                            </>
                          )}
                        </p>
                      )}
                      {step.type === "action" && (
                        <p>
                          <strong>Action:</strong> {step.provider} · {step.operation}
                        </p>
                      )}
                      {step.type === "condition" && (
                        <p>
                          <strong>Check:</strong> {step.path} {step.operator} {String(step.value ?? "")}
                        </p>
                      )}
                      {step.type === "approval" && (
                        <p>
                          <strong>Requires approval from:</strong> {step.roles.join(", ")}
                        </p>
                      )}
                      {step.type === "verify" && (
                        <p>
                          <strong>Verify:</strong> {step.path} {step.operator} {String(step.value ?? "")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="ai-refinement-section">
              <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Want to change something?</h3>
              <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
                Tell me what to adjust and I'll update the workflow for you.
              </p>
              <textarea
                value={refinementPrompt}
                onChange={(e) => setRefinementPrompt(e.target.value)}
                placeholder="Example: Add a step to send a Slack notification after the approval..."
                rows={3}
                style={{
                  width: "100%",
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                  lineHeight: 1.6,
                  padding: 12,
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  background: "var(--paper)",
                  resize: "vertical",
                  marginBottom: 12,
                }}
              />
              <button
                className="console-btn console-btn-quiet"
                onClick={refineWorkflow}
                disabled={!refinementPrompt.trim() || refining}
                style={{ marginBottom: 20 }}
              >
                {refining ? "Refining..." : "Refine workflow"}
              </button>
            </div>

            {error && (
              <div
                style={{
                  background: "#fff0eb",
                  border: "1px solid var(--coral)",
                  borderRadius: 12,
                  padding: "12px 16px",
                  marginBottom: 16,
                  fontSize: 14,
                  color: "var(--ink)",
                }}
              >
                {error}
              </div>
            )}

            <div className="ai-creator-actions">
              <button className="console-btn console-btn-quiet" onClick={() => setStep("describe")}>
                ← Start over
              </button>
              <button className="console-btn console-btn-primary" onClick={handleSave}>
                Save workflow
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .ai-workflow-creator {
          max-width: 900px;
          margin: 0 auto;
        }
        .ai-creator-header {
          margin-bottom: 32px;
        }
        .ai-creator-body {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .ai-creator-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          padding-top: 24px;
          border-top: 1px solid var(--line);
        }
        .ai-prompt-examples {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 16px;
          background: #f7f4eb;
          border-radius: 12px;
          margin-bottom: 20px;
        }
        .ai-example-chip {
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 20px;
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        .ai-example-chip:hover {
          border-color: var(--coral);
          background: #fff0eb;
        }
        .ai-step-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .ai-step-card {
          display: flex;
          gap: 16px;
          padding: 16px;
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 12px;
        }
        .ai-step-number {
          width: 32px;
          height: 32px;
          display: grid;
          place-items: center;
          background: var(--mint);
          border-radius: 50%;
          font-weight: 800;
          flex-shrink: 0;
        }
        .ai-step-content {
          flex: 1;
        }
        .ai-step-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .ai-step-header b {
          font-size: 15px;
        }
        .ai-step-type {
          background: #efe9d9;
          color: var(--muted);
          padding: 4px 10px;
          border-radius: 99px;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
        }
        .ai-step-content p {
          color: var(--muted);
          font-size: 13px;
          line-height: 1.6;
          margin: 0;
        }
        .ai-refinement-section {
          background: #faf8f1;
          border: 1px dashed #cfc8b8;
          border-radius: 12px;
          padding: 20px;
          margin-top: 24px;
        }
        .ai-workflow-preview {
          background: white;
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 24px;
        }
      `}</style>
    </div>
  );
}
