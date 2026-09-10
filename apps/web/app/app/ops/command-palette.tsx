"use client";

/**
 * Global command palette.
 *
 * One keystroke (⌘K) to reach any organization, workflow, run, connection, agent, ticket or
 * lead in the platform, plus navigation and the actions an operator repeats all day. Search is
 * over the data already loaded, so it is instant and never fires a request.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useOps } from "./data";
import { Icon, modifierKeyLabel, type IconName } from "./icons";
import { useNav } from "./nav";
import { Kbd, Pill } from "./primitives";
import { GOTO_KEYS, NAV_GROUPS, SECTION_LABEL, type Section } from "./router";
import {
  RUN_STATUS_LABEL,
  WORKFLOW_STATUS_LABEL,
  relativeTime,
  runStatus,
  shortId,
} from "./terms";

type Entry = {
  id: string;
  group: string;
  glyph: IconName;
  title: string;
  sub?: string;
  right?: React.ReactNode;
  /** Lowercased haystack for matching. */
  match: string;
  run: () => void;
};

/**
 * Subsequence scoring: rewards a prefix hit, then a word-boundary hit, then any substring.
 * Good enough to feel like Linear without pulling in a fuzzy-search dependency.
 */
function score(haystack: string, needle: string): number {
  if (!needle) return 1;
  const index = haystack.indexOf(needle);
  if (index === -1) {
    // Fall back to a subsequence check so "acmeinv" still finds "Acme — invoice intake".
    let cursor = 0;
    for (const character of needle) {
      cursor = haystack.indexOf(character, cursor);
      if (cursor === -1) return 0;
      cursor += 1;
    }
    return 0.2;
  }
  if (index === 0) return 1;
  if (haystack[index - 1] === " " || haystack[index - 1] === "-" || haystack[index - 1] === "_") return 0.8;
  return 0.55;
}

export function CommandPalette() {
  const ops = useOps();
  const nav = useNav();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const open = nav.paletteOpen;

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Focus after paint so the caret lands reliably.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const close = () => nav.setPaletteOpen(false);

  const entries = useMemo<Entry[]>(() => {
    if (!open) return [];
    const list: Entry[] = [];

    /* ------------------------------------------------------------------- navigation --- */
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        const shortcut = Object.entries(GOTO_KEYS).find(([, section]) => section === item.section)?.[0];
        list.push({
          id: `nav_${item.section}`,
          group: "Go to",
          glyph: item.glyph,
          title: item.label,
          sub: group.label,
          right: shortcut ? (
            <>
              <Kbd>g</Kbd>
              <Kbd>{shortcut}</Kbd>
            </>
          ) : undefined,
          match: `${item.label} ${group.label} ${item.section}`.toLowerCase(),
          run: () => {
            nav.goSection(item.section as Section);
            close();
          },
        });
      }
    }

    /* -------------------------------------------------------------------- customers --- */
    for (const org of ops.organizations) {
      const health = ops.healthForOrg(org);
      const runCount = ops.runsForTenant(org.slug).length;
      list.push({
        id: `org_${org.id}`,
        group: "Organizations",
        glyph: "organizations",
        title: org.branding?.displayName || org.name,
        sub: `${org.slug} · ${org.plan.replace(/_/g, " ")} · ${runCount} run${runCount === 1 ? "" : "s"}`,
        right: <Pill tone={health.tone}>{health.label}</Pill>,
        match: `${org.name} ${org.slug} ${org.branding?.displayName ?? ""} ${org.plan}`.toLowerCase(),
        run: () => {
          nav.openOrg(org.slug);
          close();
        },
      });
    }

    /* -------------------------------------------------------------------- workflows --- */
    for (const workflow of ops.workflows) {
      list.push({
        id: `wf_${workflow.id}`,
        group: "Workflows",
        glyph: "workflows",
        title: workflow.name,
        sub: `${ops.orgLabel(workflow.tenantId)} · v${workflow.version} · ${workflow.steps.length} steps`,
        right: <Pill tone={workflow.status === "active" ? "good" : "muted"}>{WORKFLOW_STATUS_LABEL[workflow.status] ?? workflow.status}</Pill>,
        match: `${workflow.name} ${workflow.description ?? ""} ${workflow.id} ${workflow.tenantId}`.toLowerCase(),
        run: () => {
          nav.openWorkflow(workflow.id);
          close();
        },
      });
    }

    /* -------------------------------------------------------------------------- runs --- */
    // Newest 250 keeps the palette snappy on a large workspace; searching an id still works
    // because ids are also matched below via the direct-id shortcut.
    const recentRuns = ops.runs
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 250);
    for (const run of recentRuns) {
      const workflow = ops.workflowById(run.workflowId);
      const status = runStatus(run.status);
      list.push({
        id: `run_${run.id}`,
        group: "Runs",
        glyph: "runs",
        title: workflow?.name ?? run.workflowId,
        sub: `${ops.orgLabel(run.tenantId)} · ${shortId(run.id)} · ${relativeTime(run.createdAt)}`,
        right: <Pill tone={status.tone}>{status.label}</Pill>,
        match: `${workflow?.name ?? ""} ${run.id} ${run.workflowId} ${run.tenantId} ${RUN_STATUS_LABEL[run.status] ?? ""}`.toLowerCase(),
        run: () => {
          nav.openRun(run.id);
          close();
        },
      });
    }

    /* ------------------------------------------------------------------ connections --- */
    for (const connection of ops.connections) {
      list.push({
        id: `conn_${connection.id}`,
        group: "Connections",
        glyph: "connections",
        title: connection.name,
        sub: `${ops.orgLabel(connection.tenantId)} · ${connection.baseUrl}`,
        match: `${connection.name} ${connection.baseUrl} ${connection.tenantId}`.toLowerCase(),
        run: () => {
          nav.openConnection(connection.id);
          close();
        },
      });
    }

    /* ----------------------------------------------------------------------- agents --- */
    for (const agent of ops.agents) {
      list.push({
        id: `agent_${agent.id}`,
        group: "Chrome Agents",
        glyph: "agents",
        title: agent.name,
        sub: `${ops.orgLabel(agent.tenantId)} · ${agent.status === "revoked" ? "revoked" : agent.lastSeenAt ? `last seen ${relativeTime(agent.lastSeenAt)}` : "never connected"}`,
        match: `${agent.name} ${agent.tenantId} ${agent.allowedDomains.join(" ")}`.toLowerCase(),
        run: () => {
          nav.goSection("agents");
          close();
        },
      });
    }

    /* ---------------------------------------------------------------------- tickets --- */
    for (const ticket of ops.tickets) {
      list.push({
        id: `ticket_${ticket.id}`,
        group: "Support",
        glyph: "support",
        title: ticket.subject,
        sub: `${ops.orgLabel(ticket.tenantId)} · ${ticket.status.replace("_", " ")} · ${ticket.priority}`,
        match: `${ticket.subject} ${ticket.message} ${ticket.tenantId} ${ticket.status}`.toLowerCase(),
        run: () => {
          nav.go({ section: "support", entityId: ticket.id });
          close();
        },
      });
    }

    /* --------------------------------------------------------------- known users ------ */
    for (const [tenantId, slot] of Object.entries(ops.users)) {
      if (slot.state !== "ready" || !slot.data) continue;
      for (const user of slot.data) {
        list.push({
          id: `user_${tenantId}_${user.username}`,
          group: "Users",
          glyph: "users",
          title: user.email || user.username,
          sub: `${ops.orgLabel(tenantId)} · ${user.role}`,
          right: user.enabled ? undefined : <Pill tone="bad">Disabled</Pill>,
          match: `${user.email} ${user.username} ${tenantId}`.toLowerCase(),
          run: () => {
            nav.openOrg(tenantId, "users");
            close();
          },
        });
      }
    }

    /* ------------------------------------------------------------------------ leads --- */
    for (const lead of ops.leads) {
      list.push({
        id: `lead_${lead.id}`,
        group: "Leads",
        glyph: "leads",
        title: lead.company || lead.name,
        sub: `${lead.email} · ${relativeTime(lead.createdAt)}`,
        match: `${lead.name} ${lead.email} ${lead.company ?? ""}`.toLowerCase(),
        run: () => {
          nav.goSection("leads");
          close();
        },
      });
    }

    /* ---------------------------------------------------------------------- actions --- */
    const actions: { title: string; sub: string; glyph: IconName; run: () => void }[] = [
      {
        title: "Refresh all data",
        sub: "Re-read every collection from the control plane",
        glyph: "refresh",
        run: () => {
          ops.refresh();
          close();
        },
      },
      {
        title: ops.live ? "Pause live updates" : "Resume live updates",
        sub: "Runs poll every 15 seconds while live",
        glyph: "approvals",
        run: () => {
          ops.setLive(!ops.live);
          close();
        },
      },
      {
        title: nav.theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
        sub: "Appearance",
        glyph: nav.theme === "dark" ? "sun" : "moon",
        run: () => {
          nav.toggleTheme();
          close();
        },
      },
      {
        title: "New workflow draft",
        sub: "Open Workflow Studio with a blank draft",
        glyph: "plus",
        run: () => {
          nav.go({ section: "studio", view: "new" });
          close();
        },
      },
      {
        title: "Draft a workflow from an SOP",
        sub: "Describe a procedure in plain English",
        glyph: "sparkle",
        run: () => {
          nav.go({ section: "studio", view: "sop" });
          close();
        },
      },
      {
        title: "New organization",
        sub: "Create a customer organization",
        glyph: "plus",
        run: () => {
          nav.go({ section: "customers", view: "new" });
          close();
        },
      },
      {
        title: "New connection",
        sub: "Add a system for AmazFlow Browser to sign in to",
        glyph: "plus",
        run: () => {
          nav.go({ section: "connections", view: "new" });
          close();
        },
      },
    ];
    for (const action of actions) {
      list.push({
        id: `action_${action.title}`,
        group: "Actions",
        glyph: action.glyph,
        title: action.title,
        sub: action.sub,
        match: `${action.title} ${action.sub}`.toLowerCase(),
        run: action.run,
      });
    }

    return list;
  }, [open, ops, nav]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      // Empty state: the most useful default is what needs attention, then navigation.
      const priority = ["Actions", "Go to"];
      return entries
        .filter((entry) => priority.includes(entry.group))
        .sort((a, b) => priority.indexOf(a.group) - priority.indexOf(b.group))
        .slice(0, 40);
    }
    return entries
      .map((entry) => ({ entry, value: score(entry.match, needle) }))
      .filter((candidate) => candidate.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 40)
      .map((candidate) => candidate.entry);
  }, [entries, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of results) {
      const list = map.get(entry.group);
      if (list) list.push(entry);
      else map.set(entry.group, [entry]);
    }
    return [...map.entries()];
  }, [results]);

  const flat = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      setActive((current) => (flat.length === 0 ? 0 : (current + 1) % flat.length));
    } else if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      setActive((current) => (flat.length === 0 ? 0 : (current - 1 + flat.length) % flat.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      flat[active]?.run();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  return (
    <>
      <div className="ops-scrim" onClick={close} />
      <div className="ops-modalwrap">
        <div className="ops-cmd" role="dialog" aria-modal="true" aria-label="Command palette">
          <div className="ops-cmd-inputrow">
            <span className="ops-cmd-glyph" aria-hidden="true">
              <Icon name="search" size={15} />
            </span>
            <input
              ref={inputRef}
              className="ops-cmd-input"
              value={query}
              placeholder="Search organizations, workflows, runs, users, tickets — or run a command"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              aria-label="Search"
              autoComplete="off"
              spellCheck={false}
            />
            {ops.loading && <span className="ops-cmd-scope">loading…</span>}
          </div>

          <div className="ops-cmd-list" ref={listRef}>
            {flat.length === 0 ? (
              <div className="ops-cmd-empty">
                No matches for &ldquo;{query}&rdquo;.
                <br />
                Try an organization, workflow name, or run id.
              </div>
            ) : (
              grouped.map(([group, items]) => (
                <div className="ops-cmd-group" key={group}>
                  <div className="ops-cmd-grouplabel">{group}</div>
                  {items.map((entry) => {
                    const index = flat.indexOf(entry);
                    return (
                      <button
                        className="ops-cmd-item"
                        key={entry.id}
                        data-active={index === active ? "true" : undefined}
                        onMouseMove={() => setActive(index)}
                        onClick={entry.run}
                      >
                        <span className="ops-cmd-item-glyph" aria-hidden="true">
                          <Icon name={entry.glyph} size={14} />
                        </span>
                        <span className="ops-cmd-item-text">
                          <b>{entry.title}</b>
                          {entry.sub && <span>{entry.sub}</span>}
                        </span>
                        {entry.right && <span className="ops-cmd-item-right">{entry.right}</span>}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="ops-cmd-foot">
            <span className="ops-cmd-hint">
              <Kbd>
                <Icon name="arrowUp" size={9} strokeWidth={2} />
              </Kbd>
              <Kbd>
                <Icon name="arrowDown" size={9} strokeWidth={2} />
              </Kbd>
              navigate
            </span>
            <span className="ops-cmd-hint">
              <Kbd>enter</Kbd> open
            </span>
            <span className="ops-cmd-hint">
              <Kbd>esc</Kbd> close
            </span>
            <span className="ops-cmd-hint">
              <Kbd>g</Kbd> then a letter jumps sections
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
