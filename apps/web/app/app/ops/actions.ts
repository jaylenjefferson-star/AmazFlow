"use client";

/**
 * Operator actions against the real control plane.
 *
 * Each action posts to the route that already exists, folds the returned record straight back
 * into the shared store (the control plane returns the full updated run/ticket/connection), and
 * reports outcome through a toast. Nothing is optimistic -- an operator acting on a customer's
 * production system should see the server's answer, not a guess.
 */

import { useCallback, useState } from "react";
import type { WorkflowDefinition, WorkflowRun } from "@amazflow/workflow-schema";
import {
  useOps,
  type Agent,
  type BrowserConnection,
  type Organization,
  type PlatformSettings,
  type Ticket,
} from "./data";
import { useToast } from "./primitives";

export function useOpsActions() {
  const ops = useOps();
  const toast = useToast();
  /** Key of the action currently in flight, so callers can disable exactly one control. */
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(key: string, work: () => Promise<T>, success?: string): Promise<T | null> => {
      setBusy(key);
      try {
        const result = await work();
        if (success) toast.push(success, "good");
        return result;
      } catch (error) {
        toast.push(error instanceof Error ? error.message : String(error), "bad");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  /* ------------------------------------------------------------------------ run actions --- */

  const approve = useCallback(
    (target: WorkflowRun) =>
      run(
        `approve_${target.id}`,
        async () => {
          const updated = await ops.request<WorkflowRun>(
            `/runs/${target.id}/approvals/${target.currentStepId}`,
            { method: "POST", body: JSON.stringify({ approved: true }) },
          );
          ops.applyRun(updated);
          return updated;
        },
        "Approved — the run is continuing",
      ),
    [ops, run],
  );

  const sendBack = useCallback(
    (target: WorkflowRun) =>
      run(
        `reject_${target.id}`,
        async () => {
          const updated = await ops.request<WorkflowRun>(
            `/runs/${target.id}/approvals/${target.currentStepId}`,
            { method: "POST", body: JSON.stringify({ approved: false }) },
          );
          ops.applyRun(updated);
          return updated;
        },
        "Sent back — nothing was changed on the customer's systems",
      ),
    [ops, run],
  );

  const confirm = useCallback(
    (target: WorkflowRun) =>
      run(
        `confirm_${target.id}`,
        async () => {
          const updated = await ops.request<WorkflowRun>(
            `/runs/${target.id}/confirmations/${target.currentStepId}/confirm`,
            { method: "POST", body: "{}" },
          );
          ops.applyRun(updated);
          return updated;
        },
        "Confirmed — AmazFlow is proceeding",
      ),
    [ops, run],
  );

  const cancel = useCallback(
    (target: WorkflowRun) =>
      run(
        `cancel_${target.id}`,
        async () => {
          const updated = await ops.request<WorkflowRun>(`/runs/${target.id}/cancel`, {
            method: "POST",
            body: "{}",
          });
          ops.applyRun(updated);
          return updated;
        },
        "Run stopped",
      ),
    [ops, run],
  );

  /**
   * "Re-run" rather than "retry": the control plane has no retry primitive, so this starts a
   * genuinely new run from the same input. The distinction matters when a side effect may
   * already have landed, which is why the run detail gates this behind a warning.
   */
  const rerun = useCallback(
    (target: WorkflowRun) =>
      run(
        `rerun_${target.id}`,
        async () => {
          const input = (target.context as { input?: unknown } | undefined)?.input ?? {};
          const created = await ops.request<WorkflowRun>(`/workflows/${target.workflowId}/runs`, {
            method: "POST",
            body: JSON.stringify(input),
          });
          ops.applyRun(created);
          return created;
        },
        "Started a new run with the same input",
      ),
    [ops, run],
  );

  const startRun = useCallback(
    (workflowId: string, input: unknown) =>
      run(
        `start_${workflowId}`,
        async () => {
          const created = await ops.request<WorkflowRun>(`/workflows/${workflowId}/runs`, {
            method: "POST",
            body: JSON.stringify(input),
          });
          ops.applyRun(created);
          return created;
        },
        "Run started",
      ),
    [ops, run],
  );

  /* ------------------------------------------------------------------- workflow actions --- */

  const saveWorkflow = useCallback(
    (workflow: WorkflowDefinition) =>
      run(
        `saveWorkflow_${workflow.id}`,
        async () => {
          const saved = await ops.request<WorkflowDefinition>("/workflows", {
            method: "POST",
            body: JSON.stringify(workflow),
          });
          await ops.refresh();
          return saved;
        },
        "Workflow saved",
      ),
    [ops, run],
  );

  const generateFromSop = useCallback(
    (sop: string, tenantId?: string) =>
      run(`generateSop`, async () => {
        const draft = await ops.request<WorkflowDefinition>("/workflows/generate", {
          method: "POST",
          body: JSON.stringify(tenantId ? { sop, tenantId } : { sop }),
        });
        // The control plane returns a draft; persisting it is a separate explicit save so the
        // draft survives a refresh, matching the documented Studio behaviour.
        await ops.request<WorkflowDefinition>("/workflows", {
          method: "POST",
          body: JSON.stringify(draft),
        });
        await ops.refresh();
        return draft;
      }),
    [ops, run],
  );

  /* --------------------------------------------------------------- organization actions --- */

  const createOrganization = useCallback(
    (name: string, plan?: string) =>
      run(
        "createOrg",
        async () => {
          const org = await ops.request<Organization>("/organizations", {
            method: "POST",
            body: JSON.stringify(plan ? { name, plan } : { name }),
          });
          ops.applyOrganization(org);
          return org;
        },
        "Organization created",
      ),
    [ops, run],
  );

  const saveBranding = useCallback(
    (slug: string, branding: Record<string, string>) =>
      run(
        `branding_${slug}`,
        async () => {
          const org = await ops.request<Organization>(
            `/organizations/${encodeURIComponent(slug)}/branding`,
            { method: "POST", body: JSON.stringify(branding) },
          );
          ops.applyOrganization(org);
          return org;
        },
        "Branding updated",
      ),
    [ops, run],
  );

  const setUserEnabled = useCallback(
    (tenantId: string, username: string, enabled: boolean) =>
      run(
        `user_${username}`,
        async () => {
          await ops.request(
            `/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(username)}/status`,
            { method: "POST", body: JSON.stringify({ enabled }) },
          );
          // The status route returns only {username, enabled}; re-read the directory so the
          // table reflects exactly what Cognito now reports.
          ops.loadUsers(tenantId);
          return true;
        },
        enabled ? "User re-enabled" : "User sign-in disabled",
      ),
    [ops, run],
  );

  /* ------------------------------------------------------------------- support actions --- */

  const setTicketStatus = useCallback(
    (ticket: Ticket, status: string) =>
      run(
        `ticket_${ticket.id}`,
        async () => {
          const updated = await ops.request<Ticket>(`/support/tickets/${ticket.id}/status`, {
            method: "POST",
            body: JSON.stringify({ status }),
          });
          ops.applyTicket(updated);
          return updated;
        },
        "Ticket updated",
      ),
    [ops, run],
  );

  const addTicketNote = useCallback(
    (ticket: Ticket, note: string, internal = true) =>
      run(
        `ticketNote_${ticket.id}`,
        async () => {
          const updated = await ops.request<Ticket>(`/support/tickets/${ticket.id}/status`, {
            method: "POST",
            body: JSON.stringify({ note, internal }),
          });
          ops.applyTicket(updated);
          return updated;
        },
        "Note added",
      ),
    [ops, run],
  );

  /* --------------------------------------------------------------- connection actions --- */

  const reloadConnections = useCallback(async () => {
    const list = await ops.request<BrowserConnection[]>("/connections/browser");
    ops.applyConnections(list);
  }, [ops]);

  const createConnection = useCallback(
    (input: { name: string; baseUrl: string; tenantId: string; preferredMode?: string }) =>
      run(
        "createConnection",
        async () => {
          const created = await ops.request<BrowserConnection>("/connections/browser", {
            method: "POST",
            body: JSON.stringify({ preferredMode: "auto", ...input }),
          });
          await reloadConnections();
          return created;
        },
        "Connection created — sign in to activate it",
      ),
    [ops, run, reloadConnections],
  );

  const beginConnectionLogin = useCallback(
    (connectionId: string) =>
      run(`login_${connectionId}`, async () => {
        const session = await ops.request<{
          loginSessionId: string;
          liveViewUrl?: string;
          expiresAt: string;
        }>(`/connections/browser/${connectionId}/login-session`, { method: "POST", body: "{}" });
        if (session.liveViewUrl) window.open(session.liveViewUrl, "_blank", "noopener,noreferrer");
        return session;
      }),
    [ops, run],
  );

  const completeConnectionLogin = useCallback(
    (connectionId: string, loginSessionId: string) =>
      run(
        `loginDone_${connectionId}`,
        async () => {
          const updated = await ops.request<BrowserConnection>(
            `/connections/browser/${connectionId}/login-session/complete`,
            { method: "POST", body: JSON.stringify({ loginSessionId }) },
          );
          await reloadConnections();
          return updated;
        },
        "Connection signed in",
      ),
    [ops, run, reloadConnections],
  );

  const revokeConnection = useCallback(
    (connectionId: string) =>
      run(
        `revokeConn_${connectionId}`,
        async () => {
          const updated = await ops.request<BrowserConnection>(
            `/connections/browser/${connectionId}`,
            { method: "DELETE" },
          );
          await reloadConnections();
          return updated;
        },
        "Connection revoked",
      ),
    [ops, run, reloadConnections],
  );

  /* -------------------------------------------------------------------- agent actions --- */

  const revokeAgent = useCallback(
    (agentId: string) =>
      run(
        `revokeAgent_${agentId}`,
        async () => {
          const updated = await ops.request<Agent>(`/agents/${agentId}/revoke`, {
            method: "POST",
            body: "{}",
          });
          ops.applyAgent(updated);
          return updated;
        },
        "Chrome Agent revoked",
      ),
    [ops, run],
  );

  const authorizeAgent = useCallback(
    (name: string, tenantId: string, allowedDomains: string[]) =>
      run("authorizeAgent", async () => {
        const created = await ops.request<{ agent: Agent; code: string }>("/agent-authorizations", {
          method: "POST",
          body: JSON.stringify({ name, tenantId, allowedDomains }),
        });
        await ops.refresh();
        return created;
      }),
    [ops, run],
  );

  /* ----------------------------------------------------------------- settings actions --- */

  const saveSettings = useCallback(
    (patch: Partial<Pick<PlatformSettings, "taskExpiryMs" | "confirmationExpiryMs" | "agentCodeExpiryMs">>) =>
      run(
        "saveSettings",
        async () => {
          const updated = await ops.request<PlatformSettings>("/settings", {
            method: "POST",
            body: JSON.stringify(patch),
          });
          ops.applySettings(updated);
          return updated;
        },
        "Platform settings saved",
      ),
    [ops, run],
  );

  return {
    busy,
    approve,
    sendBack,
    confirm,
    cancel,
    rerun,
    startRun,
    saveWorkflow,
    generateFromSop,
    createOrganization,
    saveBranding,
    setUserEnabled,
    setTicketStatus,
    addTicketNote,
    createConnection,
    beginConnectionLogin,
    completeConnectionLogin,
    revokeConnection,
    revokeAgent,
    authorizeAgent,
    saveSettings,
  };
}
