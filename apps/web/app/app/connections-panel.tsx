"use client";

import { useEffect, useState } from "react";

type Agent = { id: string; name: string; tenantId: string; status: string; lastSeenAt: string | null; allowedDomains: string[] };
type Organization = { slug: string; name: string };
type BrowserConnection = { id: string; tenantId: string; name: string; baseUrl: string; allowedOrigins: string[]; preferredMode: "auto" | "managed" | "connected"; status: string; updatedAt: string };
type LoginSession = { loginSessionId: string; liveViewUrl?: string; expiresAt: string };
type Request = (path: string, options?: RequestInit) => Promise<unknown>;

const PLANNED_CONNECTORS = [
  { name: "Gmail", provider: "email" }, { name: "Microsoft 365", provider: "email" },
  { name: "HRIS", provider: "api" }, { name: "Generic spreadsheet", provider: "spreadsheet" }, { name: "Generic API", provider: "api" },
];

function isRecentlyConnected(agent: Agent) {
  return Boolean(agent.lastSeenAt && Date.now() - new Date(agent.lastSeenAt).getTime() < 10 * 60000);
}

export function ConnectionsPanel({ agents, request, organizations }: { agents: Agent[]; request: Request; organizations: Organization[] }) {
  const [connections, setConnections] = useState<BrowserConnection[]>([]);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [tenantId, setTenantId] = useState(organizations[0]?.slug ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState<Record<string, LoginSession>>({});
  const live = agents.filter((agent) => agent.status !== "revoked");

  const load = () => request("/connections/browser").then((data) => setConnections(data as BrowserConnection[]));
  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, []);

  const create = async () => {
    setBusy("create"); setError(null);
    try {
      await request("/connections/browser", { method: "POST", body: JSON.stringify({ name, baseUrl, tenantId, preferredMode: "auto" }) });
      setName(""); setBaseUrl(""); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };
  const beginLogin = async (id: string) => {
    setBusy(id); setError(null);
    try {
      const session = await request(`/connections/browser/${id}/login-session`, { method: "POST" }) as LoginSession;
      setLogin((current) => ({ ...current, [id]: session }));
      if (session.liveViewUrl) window.open(session.liveViewUrl, "_blank", "noopener,noreferrer");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };
  const finishLogin = async (id: string) => {
    const session = login[id]; if (!session) return;
    setBusy(id); setError(null);
    try {
      await request(`/connections/browser/${id}/login-session/complete`, { method: "POST", body: JSON.stringify({ loginSessionId: session.loginSessionId }) });
      setLogin((current) => { const next = { ...current }; delete next[id]; return next; }); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };
  const revoke = async (id: string) => {
    setBusy(id); setError(null);
    try { await request(`/connections/browser/${id}`, { method: "DELETE" }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };

  return <div className="cx-wrap">
    <section className="cx-section">
      <p className="product-eyebrow">MANAGED BROWSER</p><h2 className="cx-h2">Browser connections</h2>
      <p className="cx-lede">Create an origin-scoped connection, sign in through its isolated live session, then reference it from a managed browser step.</p>
      <div className="st-actions" style={{ alignItems: "end", flexWrap: "wrap" }}>
        <label className="st-field"><span>Connection name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="HR portal" /></label>
        <label className="st-field"><span>Base URL</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://portal.example.com" /></label>
        {organizations.length > 0 && <label className="st-field"><span>Organization</span><select value={tenantId} onChange={(event) => setTenantId(event.target.value)}>{organizations.map((org) => <option key={org.slug} value={org.slug}>{org.name}</option>)}</select></label>}
        <button className="console-btn console-btn-primary" disabled={busy === "create" || !name.trim() || !baseUrl.trim() || !tenantId} onClick={create}>{busy === "create" ? "Creating…" : "Create connection"}</button>
      </div>
      {error && <p className="au-error">{error}</p>}
      <div className="cx-rows">{connections.map((connection) => <div className="cx-row" key={connection.id}>
        <span className={`cx-dot ${connection.status === "active" ? "cx-dot-good" : ""}`} />
        <div><b>{connection.name}</b><small>{connection.tenantId} · {connection.baseUrl}</small></div>
        {login[connection.id] ? <button disabled={busy === connection.id} onClick={() => finishLogin(connection.id)}>Finish sign-in</button> : connection.status !== "revoked" ? <button disabled={busy === connection.id} onClick={() => beginLogin(connection.id)}>{connection.status === "active" ? "Refresh sign-in" : "Sign in"}</button> : null}
        {connection.status !== "revoked" && <button disabled={busy === connection.id} onClick={() => revoke(connection.id)}>Revoke</button>}
        <mark className={connection.status === "active" ? "cp-pill-good" : ""}>{connection.status}</mark>
      </div>)}</div>
    </section>
    <section className="cx-section"><p className="product-eyebrow">CONNECTED BROWSER FALLBACK</p><h2 className="cx-h2">Chrome agents</h2>
      <p className="cx-lede">Used when a workflow explicitly requests a connected browser or needs local access, device-bound authentication, or incompatible sign-in.</p>
      {live.length === 0 ? <p className="ov-empty">No Chrome agents authorized yet.</p> : <div className="cx-rows">{live.map((agent) => { const connected = isRecentlyConnected(agent); return <div className="cx-row" key={agent.id}><span className={`cx-dot ${connected ? "cx-dot-good" : ""}`} /><div><b>{agent.name}</b><small>{agent.tenantId} · {agent.allowedDomains.join(", ") || "no domains scoped yet"}</small></div><mark className={connected ? "cp-pill-good" : ""}>{connected ? "Connected" : "Offline"}</mark></div>; })}</div>}
    </section>
    <section className="cx-section cx-planned"><p className="product-eyebrow">CONNECTOR FOUNDATION</p><h2 className="cx-h2">Other systems</h2><p className="cx-lede">Credential-provider infrastructure is prepared, but new SaaS integrations are intentionally outside this parity cutover.</p><div className="cx-rows">{PLANNED_CONNECTORS.map((connector) => <div className="cx-row cx-row-planned" key={connector.name}><span className="cx-dot" /><div><b>{connector.name}</b><small>provider: {connector.provider}</small></div><mark>Not yet available</mark></div>)}</div></section>
  </div>;
}
