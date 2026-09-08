"use client";

import { useState } from "react";
import type { WorkflowDefinition, WorkflowRun } from "@amazflow/workflow-schema";

type Organization = { id: string; name: string; slug: string; status: string; plan: string; createdAt: string; branding?: { displayName?: string; logoUrl?: string; accent?: string; loginMessage?: string } };
type Agent = { id: string; name: string; tenantId: string; status: string; lastSeenAt: string | null };

export function ClientsPanel({
  organizations,
  orgsLoading,
  workflows,
  runs,
  agents,
  newOrgName,
  onNewOrgNameChange,
  creatingOrg,
  onCreateOrganization,
  selectedSlug,
  onSelectOrg,
}: {
  organizations: Organization[];
  orgsLoading: boolean;
  workflows: WorkflowDefinition[];
  runs: WorkflowRun[];
  agents: Agent[];
  newOrgName: string;
  onNewOrgNameChange: (value: string) => void;
  creatingOrg: boolean;
  onCreateOrganization: () => void;
  selectedSlug: string | null;
  onSelectOrg: (slug: string | null) => void;
}) {
  const selected = selectedSlug ? organizations.find((o) => o.slug === selectedSlug) : undefined;

  if (selectedSlug) {
    if (!selected) {
      return (
        <div className="cp-notfound">
          <h2>We couldn&apos;t find that organization.</h2>
          <button className="console-btn console-btn-primary" onClick={() => onSelectOrg(null)}>
            Back to Clients
          </button>
        </div>
      );
    }
    const tenantWorkflows = workflows.filter((w) => w.tenantId === selected.slug || w.tenantId === selected.id);
    const tenantRuns = runs.filter((r) => r.tenantId === selected.slug || r.tenantId === selected.id);
    const tenantAgents = agents.filter((a) => a.tenantId === selected.slug || a.tenantId === selected.id);
    const failing = tenantRuns.filter((r) => r.status === "FAILED" || r.status === "TIMED_OUT");
    const readiness =
      tenantAgents.some((a) => a.status === "active") && tenantWorkflows.some((w) => w.status === "active")
        ? "ready"
        : tenantWorkflows.length === 0
          ? "no-workflows"
          : "not-connected";

    return (
      <div className="cp-detail">
        <button className="rp-back" onClick={() => onSelectOrg(null)}>
          ← Back to Clients
        </button>
        <div className="cp-detail-head">
          <h2>{selected.branding?.displayName || selected.name}</h2>
          <mark className={selected.status === "active" ? "cp-pill-good" : ""}>{selected.status}</mark>
        </div>
        <p className="cp-detail-meta">
          {selected.slug} · {selected.plan} · created {new Date(selected.createdAt).toLocaleDateString()}
        </p>

        <div
          className={`cp-readiness ${readiness === "ready" ? "cp-readiness-good" : readiness === "no-workflows" ? "" : "cp-readiness-warn"}`}
        >
          {readiness === "ready"
            ? "✓ Ready to operate — has an active workflow and a connected agent."
            : readiness === "no-workflows"
              ? "No workflows assigned yet."
              : "Has a workflow, but no agent has connected yet."}
        </div>

        <div className="cp-stats">
          <div>
            <b>{tenantWorkflows.length}</b>
            <span>Workflows</span>
          </div>
          <div>
            <b>{tenantRuns.length}</b>
            <span>Runs</span>
          </div>
          <div>
            <b>{tenantAgents.length}</b>
            <span>Agents</span>
          </div>
          <div className={failing.length ? "cp-stat-bad" : ""}>
            <b>{failing.length}</b>
            <span>Exceptions</span>
          </div>
        </div>

        <section className="cp-section">
          <h3>Workflows</h3>
          {tenantWorkflows.length === 0 ? (
            <p className="ov-empty">No workflows assigned to this customer yet.</p>
          ) : (
            <ul className="ov-list">
              {tenantWorkflows.map((w) => (
                <li key={w.id}>
                  <div className="cp-static-row">
                    <b>{w.name}</b>
                    <small>
                      v{w.version} · {w.status}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cp-section">
          <h3>Recent runs</h3>
          {tenantRuns.length === 0 ? (
            <p className="ov-empty">No runs yet.</p>
          ) : (
            <ul className="ov-list">
              {tenantRuns
                .slice()
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .slice(0, 8)
                .map((r) => (
                  <li key={r.id}>
                    <div className="cp-static-row">
                      <b>{r.workflowId}</b>
                      <small>
                        {r.status.replaceAll("_", " ").toLowerCase()} · {new Date(r.updatedAt).toLocaleString()}
                      </small>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section className="cp-section">
          <h3>Agents</h3>
          {tenantAgents.length === 0 ? (
            <p className="ov-empty">No browser agents authorized for this customer yet.</p>
          ) : (
            <ul className="ov-list">
              {tenantAgents.map((a) => (
                <li key={a.id}>
                  <div className="cp-static-row">
                    <b>{a.name}</b>
                    <small>{a.status === "revoked" ? "Revoked" : a.lastSeenAt ? `Last seen ${new Date(a.lastSeenAt).toLocaleString()}` : "Never connected"}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <>
      <div className="product-neworg">
        <input
          value={newOrgName}
          onChange={(event) => onNewOrgNameChange(event.target.value)}
          placeholder="Organization name (e.g. Acme Corp)"
          onKeyDown={(event) => {
            if (event.key === "Enter") onCreateOrganization();
          }}
        />
        <button disabled={creatingOrg || !newOrgName.trim()} onClick={onCreateOrganization}>
          {creatingOrg ? "Creating…" : "Create organization →"}
        </button>
      </div>
      {orgsLoading ? (
        <p className="product-empty">Loading organizations…</p>
      ) : organizations.length === 0 ? (
        <p className="product-empty">No organizations yet. Create your first customer above.</p>
      ) : (
        organizations.map((org) => (
          <button className="product-orgrow cp-clickable-row" key={org.id} onClick={() => onSelectOrg(org.slug)}>
            <span className="product-glyph">◇</span>
            <div>
              <b>{org.branding?.displayName || org.name}</b>
              <small>
                {org.slug} · {org.plan}
              </small>
            </div>
            <mark>{org.status}</mark>
            <span className="rp-chevron">›</span>
          </button>
        ))
      )}
    </>
  );
}
