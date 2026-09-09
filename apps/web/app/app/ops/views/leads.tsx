"use client";

/**
 * Leads — inbound pipeline.
 *
 * The marketing site writes leads straight to the control plane, but nothing has ever read them
 * back in a UI. This surfaces the real `GET /leads` record so inbound demand is visible in the
 * same console as everything else.
 */

import { useMemo, useState } from "react";
import { useOps, type Lead } from "../data";
import { PageHead } from "../shell";
import {
  Btn,
  CellStack,
  CodeBlock,
  DataTable,
  Drawer,
  EmptyState,
  KeyValue,
  Metrics,
  Panel,
  Pill,
  ResultCount,
  SearchInput,
  Select,
  TechnicalDetail,
  Toolbar,
  ToolbarSpacer,
  type Column,
  Chevron,
} from "../primitives";
import { absoluteTime, humanize, relativeTime } from "../terms";

export function LeadsView() {
  const ops = useOps();
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [range, setRange] = useState("all");
  const [open, setOpen] = useState<Lead | null>(null);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const lead of ops.leads) if (lead.source) set.add(lead.source);
    return [...set].sort();
  }, [ops.leads]);

  const filtered = useMemo(() => {
    let list = ops.leads;
    if (sourceFilter !== "all") list = list.filter((lead) => lead.source === sourceFilter);
    if (range !== "all") {
      const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
      const cutoff = Date.now() - days * 86_400_000;
      list = list.filter((lead) => new Date(lead.createdAt).getTime() >= cutoff);
    }
    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (lead) =>
          lead.name.toLowerCase().includes(needle) ||
          lead.email.toLowerCase().includes(needle) ||
          (lead.company ?? "").toLowerCase().includes(needle) ||
          (lead.message ?? "").toLowerCase().includes(needle),
      );
    }
    return list;
  }, [ops.leads, sourceFilter, range, search]);

  /** Leads whose company name already matches an organization — likely converted. */
  const converted = useMemo(() => {
    const names = new Set(
      ops.organizations.flatMap((org) => [
        org.name.toLowerCase(),
        (org.branding?.displayName ?? "").toLowerCase(),
      ]),
    );
    return ops.leads.filter((lead) => lead.company && names.has(lead.company.toLowerCase()));
  }, [ops.leads, ops.organizations]);

  const last30 = ops.leads.filter(
    (lead) => new Date(lead.createdAt).getTime() >= Date.now() - 30 * 86_400_000,
  );

  const columns: Column<Lead>[] = [
    {
      key: "created",
      header: "Received",
      width: 132,
      nowrap: true,
      sort: (a, b) => a.createdAt.localeCompare(b.createdAt),
      render: (lead) => <span title={absoluteTime(lead.createdAt)}>{relativeTime(lead.createdAt)}</span>,
    },
    {
      key: "who",
      header: "Contact",
      primary: true,
      sort: (a, b) => a.name.localeCompare(b.name),
      render: (lead) => <CellStack top={lead.name} bottom={lead.email} />,
    },
    {
      key: "company",
      header: "Company",
      sort: (a, b) => (a.company ?? "").localeCompare(b.company ?? ""),
      render: (lead) => (
        <span className="ops-row ops-gap-sm">
          {lead.company || <span className="ops-muted">—</span>}
          {lead.company &&
            ops.organizations.some(
              (org) =>
                org.name.toLowerCase() === lead.company?.toLowerCase() ||
                org.branding?.displayName?.toLowerCase() === lead.company?.toLowerCase(),
            ) && <Pill tone="good">customer</Pill>}
        </span>
      ),
    },
    { key: "role", header: "Role", render: (lead) => lead.role || <span className="ops-muted">—</span> },
    {
      key: "workflow",
      header: "Interested in",
      render: (lead) => <span className="ops-truncate">{lead.workflow || "—"}</span>,
    },
    {
      key: "volume",
      header: "Volume",
      width: 110,
      render: (lead) => lead.volume || <span className="ops-muted">—</span>,
    },
    {
      key: "source",
      header: "Source",
      width: 118,
      render: (lead) => (lead.source ? <Pill tone="muted">{humanize(lead.source)}</Pill> : <span className="ops-muted">—</span>),
    },
    { key: "open", header: "", align: "right", width: 36, render: () => <Chevron /> },
  ];

  return (
    <>
      <PageHead
        title="Leads"
        sub="Inbound enquiries captured by the marketing site, straight from the control plane."
      />

      <Metrics
        items={[
          { label: "Total leads", value: ops.leads.length },
          { label: "Last 30 days", value: last30.length, tone: last30.length > 0 ? "good" : undefined },
          {
            label: "Matched to a customer",
            value: converted.length,
            tone: converted.length > 0 ? "good" : undefined,
            foot: "Company name matches an organization",
          },
          {
            label: "Newest",
            value: ops.leads.length
              ? relativeTime(
                  ops.leads.reduce((latest, lead) => (lead.createdAt > latest ? lead.createdAt : latest), ops.leads[0].createdAt),
                )
              : "—",
          },
        ]}
      />

      <div className="ops-section">
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, email, company…" />
          {sources.length > 1 && (
            <Select
              label="Source"
              value={sourceFilter}
              onChange={setSourceFilter}
              options={[
                { value: "all", label: "All sources" },
                ...sources.map((source) => ({ value: source, label: humanize(source) })),
              ]}
            />
          )}
          <Select
            label="Received"
            value={range}
            onChange={setRange}
            options={[
              { value: "all", label: "All time" },
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
              { value: "90d", label: "Last 90 days" },
            ]}
          />
          <ToolbarSpacer />
          <ResultCount shown={filtered.length} total={ops.leads.length} noun="lead" />
        </Toolbar>

        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(lead) => lead.id}
          onRowClick={setOpen}
          loading={ops.loading && ops.leads.length === 0}
          defaultSort={{ key: "created", dir: "desc" }}
          emptyState={
            <EmptyState
              glyph="leads"
              title={ops.leads.length === 0 ? "No leads yet" : "No leads match"}
              body={
                ops.leads.length === 0
                  ? "Enquiries submitted on the marketing site land here."
                  : "Try widening the date range."
              }
            />
          }
        />
      </div>

      <div className="ops-section">
        <Panel title="Pipeline status">
          <p className="ops-small ops-muted">
            Leads are captured with a fixed <code>new</code> status — the control plane has no
            pipeline stages, owner assignment, or notes for them. Treat this as an inbox: work a
            lead, then create the organization when they convert.
          </p>
        </Panel>
      </div>

      {open && (
        <Drawer
          title={open.company || open.name}
          sub={
            <>
              {open.email} · received {absoluteTime(open.createdAt)}
            </>
          }
          onClose={() => setOpen(null)}
          footer={
            <Btn variant="primary" href={`mailto:${open.email}?subject=AmazFlow`}>
              Reply by email
            </Btn>
          }
        >
          <Panel title="Enquiry">
            <KeyValue
              rows={[
                { label: "Name", value: open.name },
                { label: "Email", value: <a className="ops-linkbtn" href={`mailto:${open.email}`}>{open.email}</a> },
                { label: "Company", value: open.company || undefined, hide: !open.company },
                { label: "Role", value: open.role || undefined, hide: !open.role },
                { label: "Interested in", value: open.workflow || undefined, hide: !open.workflow },
                { label: "Volume", value: open.volume || undefined, hide: !open.volume },
                { label: "Source", value: open.source ? humanize(open.source) : undefined, hide: !open.source },
                { label: "Status", value: <Pill tone="muted">{open.status}</Pill> },
              ]}
            />
          </Panel>

          {open.message && (
            <div style={{ marginTop: 12 }}>
              <Panel title="Message">
                <p style={{ fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{open.message}</p>
              </Panel>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <TechnicalDetail label="Raw lead record">
              <CodeBlock value={open} />
            </TechnicalDetail>
          </div>
        </Drawer>
      )}
    </>
  );
}
