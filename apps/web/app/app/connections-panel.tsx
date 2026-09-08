"use client";

type Agent = { id: string; name: string; tenantId: string; status: string; lastSeenAt: string | null; allowedDomains: string[] };

const PLANNED_CONNECTORS = [
  { name: "Gmail", provider: "email" },
  { name: "Microsoft 365", provider: "email" },
  { name: "HRIS", provider: "api" },
  { name: "Generic spreadsheet", provider: "spreadsheet" },
  { name: "Generic API", provider: "api" },
];

function isRecentlyConnected(agent: Agent) {
  if (!agent.lastSeenAt) return false;
  return Date.now() - new Date(agent.lastSeenAt).getTime() < 10 * 60000;
}

export function ConnectionsPanel({ agents }: { agents: Agent[] }) {
  const live = agents.filter((a) => a.status !== "revoked");
  return (
    <div className="cx-wrap">
      <section className="cx-section">
        <p className="product-eyebrow">REAL, VERIFIABLE CONNECTIONS</p>
        <h2 className="cx-h2">Browser agents</h2>
        <p className="cx-lede">
          The only connection type AmazFlow can currently prove is live: each row&apos;s status comes from that agent&apos;s own
          heartbeat, not a stored flag.
        </p>
        {live.length === 0 ? (
          <p className="ov-empty">No browser agents authorized yet.</p>
        ) : (
          <div className="cx-rows">
            {live.map((a) => {
              const connected = isRecentlyConnected(a);
              return (
                <div className="cx-row" key={a.id}>
                  <span className={`cx-dot ${connected ? "cx-dot-good" : ""}`} />
                  <div>
                    <b>{a.name}</b>
                    <small>
                      {a.tenantId} · {a.allowedDomains.length ? a.allowedDomains.join(", ") : "no domains scoped yet"}
                    </small>
                  </div>
                  <mark className={connected ? "cp-pill-good" : ""}>
                    {connected ? "Connected" : a.lastSeenAt ? `Last seen ${new Date(a.lastSeenAt).toLocaleString()}` : "Never connected"}
                  </mark>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="cx-section cx-planned">
        <p className="product-eyebrow">PLANNED — NOT YET CONNECTABLE</p>
        <h2 className="cx-h2">Other systems</h2>
        <p className="cx-lede">
          AmazFlow&apos;s workflow engine already supports these as step providers, but there is no real OAuth/credential
          integration behind them yet — showing them as &quot;Connected&quot; would be fabricated, so they stay listed as
          roadmap only.
        </p>
        <div className="cx-rows">
          {PLANNED_CONNECTORS.map((c) => (
            <div className="cx-row cx-row-planned" key={c.name}>
              <span className="cx-dot" />
              <div>
                <b>{c.name}</b>
                <small>provider: {c.provider}</small>
              </div>
              <mark>Not yet available</mark>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
