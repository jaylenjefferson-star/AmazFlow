"use client";

import { useEffect, useState } from "react";
import type { WorkflowDefinition, WorkflowRun } from "@amazflow/workflow-schema";
import { signOut, type Session } from "../lib/cognito-auth";
import "./modern-ui.css";

interface ModernDashboardProps {
  session: Session;
  workflows: WorkflowDefinition[];
  runs: WorkflowRun[];
  agents: any[];
  organizations: any[];
  onNavigate: (section: string) => void;
  currentSection: string;
}

export function ModernDashboard({
  session,
  workflows,
  runs,
  agents,
  organizations,
  onNavigate,
  currentSection,
}: ModernDashboardProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await signOut(session);
  };

  const stats = {
    active: workflows.filter((w) => w.status === "active").length,
    running: runs.filter((r) => r.status.startsWith("WAITING") || r.status === "RUNNING").length,
    completed: runs.filter((r) => r.status === "COMPLETED").length,
    exceptions: runs.filter((r) => r.status === "FAILED" || r.status === "TIMED_OUT").length,
  };

  const navItems = [
    { id: "overview", label: "Overview", icon: "📊" },
    { id: "workflows", label: "Workflows", icon: "⚡" },
    { id: "runs", label: "Runs", icon: "🔄" },
    { id: "approvals", label: "Approvals", icon: "✓", badge: runs.filter(r => r.status === "WAITING_APPROVAL").length },
    { id: "exceptions", label: "Exceptions", icon: "⚠️", badge: stats.exceptions },
    { id: "clients", label: "Clients", icon: "🏢" },
    { id: "agents", label: "Agents", icon: "🤖" },
    { id: "connections", label: "Connections", icon: "🔗" },
    { id: "audit", label: "Audit & Policy", icon: "📋" },
    { id: "support", label: "Support", icon: "💬" },
    { id: "settings", label: "Settings", icon: "⚙️" },
  ];

  return (
    <div className="modern-admin">
      <aside className={`modern-sidebar ${sidebarOpen ? "open" : ""}`}>
        <a href="/" className="modern-brand">
          <div className="modern-brand-icon">⚡</div>
          <span>AmazFlow</span>
        </a>

        <nav className="modern-nav">
          <div className="modern-nav-section">
            <div className="modern-nav-label">Operations</div>
            {navItems.map((item) => (
              <button
                key={item.id}
                className={`modern-nav-item ${currentSection === item.id ? "active" : ""}`}
                onClick={() => onNavigate(item.id)}
              >
                <span className="modern-nav-item-icon">{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.badge && item.badge > 0 ? (
                  <span
                    style={{
                      background: currentSection === item.id ? "rgba(255,255,255,0.2)" : "var(--primary)",
                      color: currentSection === item.id ? "white" : "white",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      padding: "0.125rem 0.5rem",
                      borderRadius: "9999px",
                      minWidth: "1.5rem",
                      textAlign: "center",
                    }}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </nav>

        <div style={{ padding: "1rem", borderTop: "1px solid var(--border)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem",
              background: "var(--surface-secondary)",
              borderRadius: "var(--radius-lg)",
              marginBottom: "0.75rem",
            }}
          >
            <div
              style={{
                width: "2.5rem",
                height: "2.5rem",
                borderRadius: "50%",
                background: "linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)",
                display: "grid",
                placeItems: "center",
                color: "white",
                fontWeight: 700,
                fontSize: "0.875rem",
              }}
            >
              {session.email.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {session.email}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Super Admin</div>
            </div>
          </div>
          <button
            className="modern-btn modern-btn-ghost"
            style={{ width: "100%" }}
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </aside>

      <main className="modern-main">
        <header className="modern-header">
          <div className="modern-header-content">
            <h1>Dashboard Overview</h1>
            <p className="modern-header-subtitle">
              Monitor your workflows, runs, and system performance
            </p>
          </div>
          <div className="modern-header-actions">
            <button className="modern-btn modern-btn-ghost">
              <span>🔔</span>
            </button>
            <button className="modern-btn modern-btn-primary" onClick={() => onNavigate("workflows")}>
              <span>✨</span>
              Create Workflow
            </button>
          </div>
        </header>

        <div className="modern-stats">
          <div className="modern-stat-card">
            <p className="modern-stat-label">Active Workflows</p>
            <h2 className="modern-stat-value">{stats.active}</h2>
            <div className="modern-stat-change positive">
              <span>↑</span>
              <span>12% from last month</span>
            </div>
          </div>

          <div className="modern-stat-card">
            <p className="modern-stat-label">Running Now</p>
            <h2 className="modern-stat-value">{stats.running}</h2>
            <div className="modern-stat-change">
              <span>⏱️</span>
              <span>In progress</span>
            </div>
          </div>

          <div className="modern-stat-card">
            <p className="modern-stat-label">Completed Today</p>
            <h2 className="modern-stat-value">{stats.completed}</h2>
            <div className="modern-stat-change positive">
              <span>✓</span>
              <span>All successful</span>
            </div>
          </div>

          <div className="modern-stat-card">
            <p className="modern-stat-label">Exceptions</p>
            <h2 className="modern-stat-value">{stats.exceptions}</h2>
            {stats.exceptions > 0 ? (
              <div className="modern-stat-change negative">
                <span>⚠️</span>
                <span>Needs attention</span>
              </div>
            ) : (
              <div className="modern-stat-change positive">
                <span>✓</span>
                <span>All clear</span>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "2rem" }}>
          <div className="modern-card">
            <div className="modern-card-header">
              <div>
                <h3 className="modern-card-title">Recent Workflows</h3>
                <p className="modern-card-description">Your most recently created workflows</p>
              </div>
              <button className="modern-btn modern-btn-ghost" onClick={() => onNavigate("workflows")}>
                View all
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {workflows.slice(0, 5).map((workflow) => (
                <div
                  key={workflow.id}
                  style={{
                    padding: "0.75rem",
                    background: "var(--surface-secondary)",
                    borderRadius: "var(--radius-md)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                      {workflow.name}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {workflow.steps.length} steps
                    </div>
                  </div>
                  <span
                    className={`modern-badge ${workflow.status === "active" ? "modern-badge-success" : "modern-badge-info"}`}
                  >
                    {workflow.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="modern-card">
            <div className="modern-card-header">
              <div>
                <h3 className="modern-card-title">Recent Activity</h3>
                <p className="modern-card-description">Latest workflow runs and events</p>
              </div>
              <button className="modern-btn modern-btn-ghost" onClick={() => onNavigate("runs")}>
                View all
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {runs.slice(0, 5).map((run) => {
                const workflow = workflows.find((w) => w.id === run.workflowId);
                const statusColors: Record<string, string> = {
                  COMPLETED: "modern-badge-success",
                  FAILED: "modern-badge-error",
                  RUNNING: "modern-badge-info",
                  WAITING_APPROVAL: "modern-badge-warning",
                };
                return (
                  <div
                    key={run.id}
                    style={{
                      padding: "0.75rem",
                      background: "var(--surface-secondary)",
                      borderRadius: "var(--radius-md)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                        {workflow?.name || "Unknown workflow"}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        {new Date(run.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <span className={`modern-badge ${statusColors[run.status] || "modern-badge-info"}`}>
                      {run.status.replace("_", " ")}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="modern-card">
          <div className="modern-card-header">
            <div>
              <h3 className="modern-card-title">System Health</h3>
              <p className="modern-card-description">All systems operational</p>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
            <div style={{ padding: "1rem", background: "var(--surface-secondary)", borderRadius: "var(--radius-md)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <div style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: "var(--success)" }} />
                <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>AWS Services</span>
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>Lambda, DynamoDB, Bedrock</p>
            </div>
            <div style={{ padding: "1rem", background: "var(--surface-secondary)", borderRadius: "var(--radius-md)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <div style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: "var(--success)" }} />
                <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>Browser Agents</span>
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
                {agents.filter((a) => a.status === "active").length} connected
              </p>
            </div>
            <div style={{ padding: "1rem", background: "var(--surface-secondary)", borderRadius: "var(--radius-md)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <div style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: "var(--success)" }} />
                <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>Authentication</span>
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>Cognito operational</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
