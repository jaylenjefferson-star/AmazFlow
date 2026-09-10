"use client";

/**
 * Support — the internal ticket inbox.
 *
 * Tickets are real, durable control-plane records, tied back to the organization, workflow and
 * run they came from so triage doesn't require hunting.
 */

import { useMemo, useState } from "react";
import { useOps, type Ticket } from "../data";
import { useDetailCrumb, useNav } from "../nav";
import { PageHead } from "../shell";
import { useOpsActions } from "../actions";
import {
  Alert,
  Btn,
  CellStack,
  DataTable,
  Drawer,
  EmptyState,
  IdChip,
  KeyValue,
  Metrics,
  Panel,
  Pill,
  ResultCount,
  SavedViews,
  SearchInput,
  Select,
  Timeline,
  Toolbar,
  ToolbarSpacer,
  type Column,
  Chevron,
} from "../primitives";
import {
  PRIORITY_TONE,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  absoluteTime,
  clockTime,
  relativeTime,
  runStatus,
} from "../terms";

const STATUSES = ["open", "in_progress", "resolved", "closed"];

export function SupportView({ ticketId }: { ticketId?: string }) {
  const ops = useOps();
  const nav = useNav();

  const [view, setView] = useState("open");
  const [search, setSearch] = useState("");
  const [orgFilter, setOrgFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const selected = ticketId ? ops.tickets.find((ticket) => ticket.id === ticketId) : undefined;
  useDetailCrumb(selected?.subject ?? null);

  const counts = useMemo(
    () => ({
      all: ops.tickets.length,
      open: ops.tickets.filter((ticket) => ticket.status === "open").length,
      in_progress: ops.tickets.filter((ticket) => ticket.status === "in_progress").length,
      resolved: ops.tickets.filter((ticket) => ticket.status === "resolved").length,
      closed: ops.tickets.filter((ticket) => ticket.status === "closed").length,
      urgent: ops.tickets.filter(
        (ticket) =>
          (ticket.priority === "urgent" || ticket.priority === "high") &&
          (ticket.status === "open" || ticket.status === "in_progress"),
      ).length,
    }),
    [ops.tickets],
  );

  const filtered = useMemo(() => {
    let list = ops.tickets;
    if (view === "active") {
      list = list.filter((ticket) => ticket.status === "open" || ticket.status === "in_progress");
    } else if (view === "urgent") {
      list = list.filter(
        (ticket) =>
          (ticket.priority === "urgent" || ticket.priority === "high") &&
          (ticket.status === "open" || ticket.status === "in_progress"),
      );
    } else if (view !== "all") {
      list = list.filter((ticket) => ticket.status === view);
    }
    if (orgFilter !== "all") list = list.filter((ticket) => ticket.tenantId === orgFilter);
    if (priorityFilter !== "all") list = list.filter((ticket) => ticket.priority === priorityFilter);
    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (ticket) =>
          ticket.subject.toLowerCase().includes(needle) ||
          ticket.message.toLowerCase().includes(needle) ||
          ops.orgLabel(ticket.tenantId).toLowerCase().includes(needle),
      );
    }
    return list;
  }, [ops, view, orgFilter, priorityFilter, search]);

  const columns: Column<Ticket>[] = [
    {
      key: "status",
      header: "Status",
      width: 122,
      nowrap: true,
      sort: (a, b) => a.status.localeCompare(b.status),
      render: (ticket) => (
        <Pill tone={TICKET_STATUS_TONE[ticket.status] ?? "neutral"}>
          {TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}
        </Pill>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      width: 100,
      sort: (a, b) => a.priority.localeCompare(b.priority),
      render: (ticket) => <Pill tone={PRIORITY_TONE[ticket.priority] ?? "neutral"}>{ticket.priority}</Pill>,
    },
    {
      key: "subject",
      header: "Subject",
      primary: true,
      render: (ticket) => <CellStack top={ticket.subject} bottom={ticket.message} />,
    },
    {
      key: "org",
      header: "Organization",
      sort: (a, b) => ops.orgLabel(a.tenantId).localeCompare(ops.orgLabel(b.tenantId)),
      render: (ticket) => ops.orgLabel(ticket.tenantId),
    },
    {
      key: "links",
      header: "Linked",
      width: 116,
      render: (ticket) => (
        <span className="ops-row ops-gap-sm">
          {ticket.runId && <Pill tone="muted">Run</Pill>}
          {ticket.workflowId && <Pill tone="muted">Workflow</Pill>}
          {!ticket.runId && !ticket.workflowId && <span className="ops-muted">—</span>}
        </span>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      align: "right",
      width: 70,
      render: (ticket) => <span className="ops-cell-num">{ticket.notes.length}</span>,
    },
    {
      key: "updated",
      header: "Updated",
      nowrap: true,
      width: 118,
      sort: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
      render: (ticket) => (
        <span title={absoluteTime(ticket.updatedAt)}>{relativeTime(ticket.updatedAt)}</span>
      ),
    },
    { key: "open", header: "", align: "right", width: 36, render: () => <Chevron /> },
  ];

  return (
    <>
      <PageHead
        title="Support"
        sub="Tickets raised against AmazFlow, with the customer, workflow and run context attached."
      />

      <Metrics
        items={[
          {
            label: "Open",
            value: counts.open,
            tone: counts.open > 0 ? "waiting" : "good",
            onClick: () => setView("open"),
          },
          {
            label: "In progress",
            value: counts.in_progress,
            tone: counts.in_progress > 0 ? "running" : undefined,
            onClick: () => setView("in_progress"),
          },
          {
            label: "High or urgent",
            value: counts.urgent,
            tone: counts.urgent > 0 ? "bad" : "good",
            foot: "Still unresolved",
            onClick: () => setView("urgent"),
          },
          { label: "Resolved", value: counts.resolved, onClick: () => setView("resolved") },
          { label: "All tickets", value: counts.all, onClick: () => setView("all") },
        ]}
      />

      <div className="ops-section">
        <Toolbar>
          <SavedViews
            views={[
              { id: "active", label: "Active", count: counts.open + counts.in_progress, tone: "waiting" },
              { id: "urgent", label: "Urgent", count: counts.urgent, tone: "bad" },
              { id: "open", label: "Open", count: counts.open },
              { id: "in_progress", label: "In progress", count: counts.in_progress },
              { id: "resolved", label: "Resolved", count: counts.resolved },
              { id: "closed", label: "Closed", count: counts.closed },
              { id: "all", label: "All", count: counts.all },
            ]}
            active={view}
            onSelect={setView}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Search tickets…" />
          {ops.allTenantIds.length > 1 && (
            <Select
              label="Organization"
              value={orgFilter}
              onChange={setOrgFilter}
              options={[
                { value: "all", label: "All organizations" },
                ...ops.allTenantIds.map((tenantId) => ({ value: tenantId, label: ops.orgLabel(tenantId) })),
              ]}
            />
          )}
          <Select
            label="Priority"
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={[
              { value: "all", label: "Any priority" },
              { value: "urgent", label: "Urgent" },
              { value: "high", label: "High" },
              { value: "normal", label: "Normal" },
              { value: "low", label: "Low" },
            ]}
          />
          <ToolbarSpacer />
          <ResultCount shown={filtered.length} total={ops.tickets.length} noun="ticket" />
        </Toolbar>

        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(ticket) => ticket.id}
          onRowClick={(ticket) => nav.go({ section: "support", entityId: ticket.id })}
          selectedKey={ticketId ?? null}
          rowTone={(ticket) =>
            ticket.priority === "urgent" && ticket.status === "open" ? "bad" : undefined
          }
          loading={ops.loading && ops.tickets.length === 0}
          defaultSort={{ key: "updated", dir: "desc" }}
          emptyState={
            <EmptyState
              glyph="support"
              title={ops.tickets.length === 0 ? "No support tickets" : "No tickets match"}
              body={
                ops.tickets.length === 0
                  ? "Tickets are durable control-plane records. Any signed-in user can open one, and they appear here immediately."
                  : "Try a different view or clear the search."
              }
            />
          }
        />
      </div>

      {selected && (
        <TicketDrawer ticket={selected} onClose={() => nav.goSection("support")} />
      )}
    </>
  );
}

function TicketDrawer({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const ops = useOps();
  const nav = useNav();
  const actions = useOpsActions();
  const [note, setNote] = useState("");
  const [internal, setInternal] = useState(true);

  const run = ticket.runId ? ops.runById(ticket.runId) : undefined;
  const workflow = ticket.workflowId ? ops.workflowById(ticket.workflowId) : undefined;
  const org = ops.orgByTenant(ticket.tenantId);

  return (
    <Drawer
      title={
        <>
          <Pill tone={TICKET_STATUS_TONE[ticket.status] ?? "neutral"}>
            {TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}
          </Pill>
          <span>{ticket.subject}</span>
        </>
      }
      sub={
        <>
          {ops.orgLabel(ticket.tenantId)} · {ticket.category} ·{" "}
          <Pill tone={PRIORITY_TONE[ticket.priority] ?? "neutral"}>{ticket.priority}</Pill> · opened{" "}
          {absoluteTime(ticket.createdAt)}
        </>
      }
      onClose={onClose}
      footer={
        <>
          <select
            className="ops-select"
            value={ticket.status}
            disabled={actions.busy === `ticket_${ticket.id}`}
            onChange={(event) => actions.setTicketStatus(ticket, event.target.value)}
            aria-label="Ticket status"
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {TICKET_STATUS_LABEL[status] ?? status}
              </option>
            ))}
          </select>
          <ToolbarSpacer />
          {org && (
            <Btn
              onClick={() => {
                onClose();
                nav.openOrg(org.slug);
              }}
            >
              Open organization
            </Btn>
          )}
          {run && (
            <Btn
              variant="primary"
              onClick={() => {
                const runId = run.id;
                onClose();
                nav.openRun(runId);
              }}
            >
              Open run
            </Btn>
          )}
        </>
      }
    >
      <Panel title="What the customer said">
        <p style={{ fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{ticket.message}</p>
      </Panel>

      <div style={{ marginTop: 12 }}>
        <Panel title="Context">
          <KeyValue
            rows={[
              { label: "Organization", value: ops.orgLabel(ticket.tenantId) },
              { label: "Raised by", value: ticket.createdBy },
              {
                label: "Workflow",
                value: workflow ? workflow.name : ticket.workflowId ? <code>{ticket.workflowId}</code> : undefined,
                hide: !ticket.workflowId,
              },
              {
                label: "Run",
                value: run ? (
                  <span className="ops-row ops-gap-sm">
                    <Pill tone={runStatus(run.status).tone}>{runStatus(run.status).label}</Pill>
                    <span className="ops-small ops-muted">{relativeTime(run.createdAt)}</span>
                  </span>
                ) : ticket.runId ? (
                  <span className="ops-muted">run {ticket.runId} is not in the loaded set</span>
                ) : undefined,
                hide: !ticket.runId,
              },
              { label: "Opened", value: absoluteTime(ticket.createdAt) },
              { label: "Last update", value: absoluteTime(ticket.updatedAt) },
            ]}
          />
        </Panel>
      </div>

      <div style={{ marginTop: 12 }}>
        <Panel title="Notes" sub={`${ticket.notes.length}`}>
          {ticket.notes.length === 0 ? (
            <p className="ops-small ops-muted">No notes yet.</p>
          ) : (
            <Timeline
              items={ticket.notes
                .slice()
                .sort((a, b) => a.at.localeCompare(b.at))
                .map((entry) => ({
                  id: entry.id,
                  timeLabel: clockTime(entry.at),
                  tone: entry.internal ? "muted" : "running",
                  headline: (
                    <>
                      <b>{entry.by}</b>
                      <Pill tone={entry.internal ? "muted" : "running"}>
                        {entry.internal ? "internal" : "visible to customer"}
                      </Pill>
                    </>
                  ),
                  message: entry.text,
                }))}
            />
          )}

          <div className="ops-col" style={{ marginTop: 12 }}>
            <textarea
              className="ops-textarea"
              value={note}
              placeholder="Add a note…"
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="ops-row">
              <label className="ops-switch">
                <input
                  type="checkbox"
                  checked={internal}
                  onChange={(event) => setInternal(event.target.checked)}
                />
                <span className="ops-switch-track" />
                <span>Internal only</span>
              </label>
              <ToolbarSpacer />
              <Btn
                variant="primary"
                disabled={!note.trim() || actions.busy === `ticketNote_${ticket.id}`}
                onClick={async () => {
                  const updated = await actions.addTicketNote(ticket, note.trim(), internal);
                  if (updated) setNote("");
                }}
              >
                Add note
              </Btn>
            </div>
            {!internal && (
              <Alert tone="waiting" title="Heads up">
                Non-internal notes are returned to the customer&apos;s admins on this ticket.
              </Alert>
            )}
          </div>
        </Panel>
      </div>

      <div style={{ marginTop: 12 }}>
        <KeyValue rows={[{ label: "Ticket id", value: <IdChip value={ticket.id} /> }]} />
      </div>
    </Drawer>
  );
}
