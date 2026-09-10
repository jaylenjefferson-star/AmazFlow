"use client";

/**
 * Users — a cross-organization directory.
 *
 * The control plane only exposes users one tenant at a time (`GET /tenants/{id}/users`), so this
 * view fans out across organizations on demand and assembles the directory client-side. That
 * limitation is stated plainly rather than hidden behind a spinner.
 */

import { useMemo, useState } from "react";
import { useOps } from "../data";
import { useNav } from "../nav";
import { PageHead } from "../shell";
import { useOpsActions } from "../actions";
import {
  Alert,
  Btn,
  CellStack,
  DataTable,
  EmptyState,
  Metrics,
  Panel,
  Pill,
  ResultCount,
  SearchInput,
  Select,
  Toolbar,
  ToolbarSpacer,
  type Column,
} from "../primitives";
import { ROLE_LABEL, ROLE_SHORT } from "../terms";

type DirectoryRow = {
  key: string;
  tenantId: string;
  username: string;
  email: string;
  role: string;
  enabled: boolean;
};

export function UsersView() {
  const ops = useOps();
  const nav = useNav();
  const actions = useOpsActions();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [orgFilter, setOrgFilter] = useState("all");

  const tenantIds = useMemo(() => ops.organizations.map((org) => org.slug), [ops.organizations]);

  const loadedCount = tenantIds.filter((tenantId) => ops.users[tenantId]?.state === "ready").length;
  const loadingCount = tenantIds.filter((tenantId) => ops.users[tenantId]?.state === "loading").length;
  const errored = tenantIds.filter((tenantId) => ops.users[tenantId]?.state === "error");

  const rows = useMemo(() => {
    const list: DirectoryRow[] = [];
    for (const tenantId of tenantIds) {
      const slot = ops.users[tenantId];
      if (slot?.state !== "ready" || !slot.data) continue;
      for (const user of slot.data) {
        list.push({
          key: `${tenantId}::${user.username}`,
          tenantId,
          username: user.username,
          email: user.email,
          role: user.role,
          enabled: user.enabled,
        });
      }
    }
    return list;
  }, [ops.users, tenantIds]);

  const filtered = useMemo(() => {
    let list = rows;
    if (roleFilter !== "all") list = list.filter((row) => row.role === roleFilter);
    if (statusFilter !== "all") {
      list = list.filter((row) => (statusFilter === "enabled" ? row.enabled : !row.enabled));
    }
    if (orgFilter !== "all") list = list.filter((row) => row.tenantId === orgFilter);
    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (row) =>
          row.email.toLowerCase().includes(needle) ||
          row.username.toLowerCase().includes(needle) ||
          ops.orgLabel(row.tenantId).toLowerCase().includes(needle),
      );
    }
    return list;
  }, [rows, roleFilter, statusFilter, orgFilter, search, ops]);

  const columns: Column<DirectoryRow>[] = [
    {
      key: "status",
      header: "Access",
      width: 100,
      sort: (a, b) => Number(a.enabled) - Number(b.enabled),
      render: (row) => (row.enabled ? <Pill tone="good">Active</Pill> : <Pill tone="bad">Disabled</Pill>),
    },
    {
      key: "user",
      header: "User",
      primary: true,
      sort: (a, b) => a.email.localeCompare(b.email),
      render: (row) => <CellStack top={row.email || row.username} bottom={row.username} />,
    },
    {
      key: "org",
      header: "Organization",
      sort: (a, b) => a.tenantId.localeCompare(b.tenantId),
      render: (row) => (
        <button
          className="ops-linkbtn"
          onClick={(event) => {
            event.stopPropagation();
            nav.openOrg(row.tenantId, "users");
          }}
        >
          {ops.orgLabel(row.tenantId)}
        </button>
      ),
    },
    {
      key: "role",
      header: "Role",
      width: 200,
      sort: (a, b) => a.role.localeCompare(b.role),
      render: (row) => <Pill tone="muted" title={ROLE_LABEL[row.role]}>{ROLE_SHORT[row.role] ?? row.role}</Pill>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: 128,
      render: (row) => (
        <div className="ops-rowactions" onClick={(event) => event.stopPropagation()}>
          <Btn
            size="sm"
            variant={row.enabled ? "danger" : undefined}
            disabled={actions.busy === `user_${row.username}`}
            onClick={() => actions.setUserEnabled(row.tenantId, row.username, !row.enabled)}
          >
            {row.enabled ? "Disable" : "Enable"}
          </Btn>
        </div>
      ),
    },
  ];

  const allLoaded = tenantIds.length > 0 && loadedCount === tenantIds.length;

  return (
    <>
      <PageHead
        title="Users"
        sub="Everyone with access to a customer organization, assembled across tenants."
        actions={
          <Btn
            variant={allLoaded ? undefined : "primary"}
            disabled={loadingCount > 0}
            onClick={() => tenantIds.forEach((tenantId) => ops.loadUsers(tenantId))}
          >
            {loadingCount > 0
              ? `Loading ${loadingCount}…`
              : allLoaded
                ? "Reload directory"
                : `Load all ${tenantIds.length} organizations`}
          </Btn>
        }
      />

      {tenantIds.length === 0 ? (
        <EmptyState
          glyph="users"
          title="No organizations yet"
          body="Users belong to an organization. Create one first."
          actions={<Btn onClick={() => nav.goSection("customers")}>Go to organizations</Btn>}
        />
      ) : (
        <>
          <Metrics
            items={[
              { label: "Users found", value: rows.length, foot: `Across ${loadedCount} organizations` },
              {
                label: "Active",
                value: rows.filter((row) => row.enabled).length,
                tone: "good",
              },
              {
                label: "Disabled",
                value: rows.filter((row) => !row.enabled).length,
                tone: rows.some((row) => !row.enabled) ? "bad" : undefined,
                onClick: () => setStatusFilter("disabled"),
              },
              {
                label: "Ops admins",
                value: rows.filter((row) => row.role === "CLIENT_ADMIN").length,
                foot: "Can approve and manage",
                onClick: () => setRoleFilter("CLIENT_ADMIN"),
              },
              {
                label: "Not loaded",
                value: tenantIds.length - loadedCount,
                foot: tenantIds.length - loadedCount > 0 ? "Load to include them" : "Directory complete",
              },
            ]}
          />

          {!allLoaded && (
            <div style={{ marginTop: 12 }}>
              <Alert
                tone="waiting"
                title="Partial directory"
                actions={
                  <Btn
                    size="sm"
                    disabled={loadingCount > 0}
                    onClick={() => tenantIds.forEach((tenantId) => ops.loadUsers(tenantId))}
                  >
                    Load all organizations
                  </Btn>
                }
              >
                The control plane has no cross-tenant user endpoint, so this directory is built by
                querying each organization separately. {loadedCount} of {tenantIds.length} loaded.
              </Alert>
            </div>
          )}

          {errored.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Alert tone="bad" title={`Couldn't load ${errored.length} organization${errored.length === 1 ? "" : "s"}`}>
                {errored.map((tenantId) => ops.orgLabel(tenantId)).join(", ")}
              </Alert>
            </div>
          )}

          <div className="ops-section">
            <Toolbar>
              <SearchInput value={search} onChange={setSearch} placeholder="Search by email or username…" />
              <Select
                label="Role"
                value={roleFilter}
                onChange={setRoleFilter}
                options={[
                  { value: "all", label: "All roles" },
                  { value: "CLIENT_ADMIN", label: ROLE_LABEL.CLIENT_ADMIN },
                  { value: "FRONTLINE", label: ROLE_LABEL.FRONTLINE },
                ]}
              />
              <Select
                label="Access"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "all", label: "All access" },
                  { value: "enabled", label: "Active" },
                  { value: "disabled", label: "Disabled" },
                ]}
              />
              <Select
                label="Organization"
                value={orgFilter}
                onChange={setOrgFilter}
                options={[
                  { value: "all", label: "All organizations" },
                  ...ops.organizations.map((org) => ({
                    value: org.slug,
                    label: org.branding?.displayName || org.name,
                  })),
                ]}
              />
              <ToolbarSpacer />
              <ResultCount shown={filtered.length} total={rows.length} noun="user" />
            </Toolbar>

            <DataTable
              rows={filtered}
              columns={columns}
              rowKey={(row) => row.key}
              onRowClick={(row) => nav.openOrg(row.tenantId, "users")}
              loading={loadingCount > 0 && rows.length === 0}
              emptyState={
                <EmptyState
                  glyph="users"
                  title={rows.length === 0 ? "No users loaded yet" : "No users match"}
                  body={
                    rows.length === 0
                      ? "Load the directory to pull each organization's users from the identity pool."
                      : "Try clearing the filters."
                  }
                  actions={
                    rows.length === 0 ? (
                      <Btn
                        variant="primary"
                        onClick={() => tenantIds.forEach((tenantId) => ops.loadUsers(tenantId))}
                      >
                        Load all organizations
                      </Btn>
                    ) : undefined
                  }
                />
              }
            />
          </div>

          <div className="ops-section">
            <Panel title="What can and can't be done here">
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8 }}>
                <li>
                  <b>Works:</b> disabling or re-enabling a user&apos;s sign-in, which takes effect
                  immediately.
                </li>
                <li>
                  <b>Not exposed:</b> creating or inviting users, changing a role, and resetting a
                  password. The control plane has no route for these, so they stay identity-pool
                  operations.
                </li>
                <li>
                  <b>Not listed:</b> AmazFlow Super Admins. The user endpoint enumerates only
                  customer-facing role groups.
                </li>
              </ul>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
