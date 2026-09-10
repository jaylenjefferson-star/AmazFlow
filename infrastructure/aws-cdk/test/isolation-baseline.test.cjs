// Baseline two-organization isolation audit (task 1.4).
//
// This suite runs against the UNMODIFIED deployed handler and is deliberately not a pass/fail gate
// on correctness. Phase 0 is an audit: its output is the numbered defect list that Phase 2's
// isolation work is measured against. If this file asserted "every probe must pass", the build
// would be red for the whole of Phase 0 and the defect list would live in a CI log instead of in
// the repository.
//
// So instead: every probe's outcome is compared against the committed baseline in
// isolation-baseline.json. The suite fails ONLY on drift -- a probe whose outcome differs from what
// was recorded. That gives both properties that matter. The defect list is a checked-in artifact
// (isolation-baseline.json, and the readable numbered version in the spec folder), and a change
// that fixes a defect, or silently introduces one, cannot land unnoticed: it fails here until the
// baseline is updated in the same commit.
//
// Probe outcomes:
//   PASS      -- the platform already isolates correctly here
//   DEFECT    -- it does not; the detail says how, and a later phase owns the fix
//   BY_DESIGN -- deliberately cross-organization, documented, and not a defect
//
// Requirements: 6.6, 6.7, 34.4, 34.5, 34.6, 34.7, 34.8
// harness.cjs patches Module._load to serve the in-memory AWS clients, so it has to be required
// before the extracted handler is.
const { store } = require("./harness.cjs");
const assert = require("node:assert");
const fs = require("fs");
const os = require("node:os");
const path = require("node:path");
const { writeTo } = require("./extract-inline-handler.cjs");
const { handler } = require(writeTo(path.join(os.tmpdir(), `amazflow-inline-${process.pid}.cjs`)));
const { seedTwoOrgs, sessionEvent, agentEvent } = require("./seed-two-orgs.cjs");

const seed = seedTwoOrgs();
const A = seed.a;
const B = seed.b;

const call = async (event) => {
  const res = await handler(event);
  let body;
  try {
    body = JSON.parse(res.body);
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body, raw: res.body || "" };
};

/** Any Org B value is recognizable by its label, so a leak needs no field-by-field reasoning. */
const leaksOtherOrg = (raw) => /orgb/i.test(String(raw));

const probes = [];
/**
 * `expectation` states what correct isolation looks like. `run` returns
 * { outcome, detail } describing what the platform actually does today.
 */
const probe = (id, name, requirement, run) => probes.push({ id, name, requirement, run });

/**
 * The shape almost every probe takes: a principal of Org A names a record of Org B. Correct
 * behaviour per requirement 34.4 is status 404 with nothing of Org B's in the body. A refusal that
 * is merely the wrong status code is still a defect -- 403 "belongs to another tenant" confirms the
 * record exists, which is an existence oracle across the tenancy boundary -- but it is a materially
 * smaller one than returning the record, so the two are recorded distinctly.
 */
const crossOrgProbe = (id, name, requirement, event) =>
  probe(id, name, requirement, async () => {
    const res = await call(event);
    const leaked = leaksOtherOrg(res.raw);
    if (res.status === 404 && !leaked) return { outcome: "PASS", detail: "404, no Org B data in body" };
    if (leaked)
      return { outcome: "DEFECT", detail: `status ${res.status} and the body carries Org B data: ${res.raw.slice(0, 200)}` };
    return {
      outcome: "DEFECT",
      detail: `status ${res.status} (expected 404); body carries no Org B data but the status confirms the record exists: ${JSON.stringify(res.body).slice(0, 160)}`,
    };
  });

/* ---------------------------------------------------------------- entity-identifier-scoped ----- */

crossOrgProbe(
  "ISO-01",
  "Org A admin cancelling Org B's run",
  "34.4",
  sessionEvent(A.principals.ORG_ADMIN, "POST /runs/{id}/cancel", { pathParameters: { id: B.runs.RUNNING.id } }),
);

crossOrgProbe(
  "ISO-02",
  "Org A admin deciding an approval on Org B's run",
  "34.4",
  sessionEvent(A.principals.ORG_ADMIN, "POST /runs/{id}/approvals/{stepId}", {
    pathParameters: { id: B.runs.WAITING_APPROVAL.id, stepId: "s_act" },
    body: { approved: true },
  }),
);

crossOrgProbe(
  "ISO-03",
  "Org A admin confirming a protected action on Org B's run",
  "34.4",
  sessionEvent(A.principals.ORG_ADMIN, "POST /runs/{id}/confirmations/{stepId}/confirm", {
    pathParameters: { id: B.runs.AWAITING_CONFIRMATION.id, stepId: "s_act" },
  }),
);

crossOrgProbe(
  "ISO-04",
  "Org A admin revoking Org B's agent",
  "34.4",
  sessionEvent(A.principals.ORG_ADMIN, "POST /agents/{id}/revoke", { pathParameters: { id: B.agents.browser.id } }),
);

crossOrgProbe(
  "ISO-05",
  "Org A admin resolving Org B's agent task",
  "34.4",
  sessionEvent(A.principals.ORG_ADMIN, "POST /agent-tasks/{id}/result", {
    pathParameters: { id: B.tasks.browser.id },
    body: { ok: true, status: "Inactive" },
  }),
);

crossOrgProbe(
  "ISO-06",
  "Org A admin changing the status of Org B's support ticket",
  "34.4",
  sessionEvent(A.principals.ORG_ADMIN, "POST /support/tickets/{id}/status", {
    pathParameters: { id: B.ticket.id },
    body: { status: "closed" },
  }),
);

crossOrgProbe(
  "ISO-07",
  "Org A admin reading Org B's workflow version history",
  "34.4",
  sessionEvent(A.principals.ORG_ADMIN, "GET /workflows/{id}/versions", { pathParameters: { id: B.workflows.published.id } }),
);

crossOrgProbe(
  "ISO-08",
  "Org A admin running preflight on Org B's workflow",
  "34.4",
  sessionEvent(A.principals.ORG_ADMIN, "GET /workflows/{id}/preflight", { pathParameters: { id: B.workflows.published.id } }),
);

crossOrgProbe(
  "ISO-09",
  "Org A admin starting a run of Org B's workflow",
  "34.4",
  sessionEvent(A.principals.ORG_ADMIN, "POST /workflows/{id}/runs", {
    pathParameters: { id: B.workflows.published.id },
    body: {},
  }),
);

/* ------------------------------------------------------------------------ parameter-scoped ----- */

crossOrgProbe(
  "ISO-10",
  "Org A admin reading Org B's organization record",
  "34.4",
  sessionEvent(A.principals.ORG_ADMIN, "GET /organizations/{slug}", { pathParameters: { slug: B.tenantId } }),
);

crossOrgProbe(
  "ISO-11",
  "Org A admin changing Org B's organization settings",
  "34.4",
  sessionEvent(A.principals.ORG_ADMIN, "POST /organizations/{slug}/settings", {
    pathParameters: { slug: B.tenantId },
    body: { maxConcurrentRuns: 1 },
  }),
);

crossOrgProbe(
  "ISO-12",
  "Org A admin changing Org B's branding",
  "34.4",
  sessionEvent(A.principals.ORG_ADMIN, "POST /organizations/{slug}/branding", {
    pathParameters: { slug: B.tenantId },
    body: { logoUrl: "https://evil.example.com/x.png" },
  }),
);

crossOrgProbe(
  "ISO-13",
  "Org A admin reading Org B's tenant summary",
  "34.4",
  sessionEvent(A.principals.ORG_ADMIN, "GET /tenants/{tenantId}/summary", { pathParameters: { tenantId: B.tenantId } }),
);

crossOrgProbe(
  "ISO-14",
  "Org A admin listing Org B's team members",
  "34.4",
  sessionEvent(A.principals.ORG_ADMIN, "GET /tenants/{tenantId}/users", { pathParameters: { tenantId: B.tenantId } }),
);

crossOrgProbe(
  "ISO-15",
  "Org A admin inviting a user into Org B",
  "34.5",
  sessionEvent(A.principals.ORG_ADMIN, "POST /tenants/{tenantId}/users", {
    pathParameters: { tenantId: B.tenantId },
    body: { email: `intruder@${B.label}.example.com`, role: "CLIENT_ADMIN" },
  }),
);

crossOrgProbe(
  "ISO-16",
  "Org A admin disabling a member of Org B",
  "34.5",
  sessionEvent(A.principals.ORG_ADMIN, "POST /tenants/{tenantId}/users/{username}/status", {
    pathParameters: { tenantId: B.tenantId, username: B.principals.OPERATOR.username },
    body: { enabled: false },
  }),
);

/* --------------------------------------------------------------------------- list routes ------ */

const listProbe = (id, routeKey, requirement = "34.6") =>
  probe(id, `${routeKey} returns nothing belonging to another organization`, requirement, async () => {
    const res = await call(sessionEvent(A.principals.ORG_ADMIN, routeKey));
    if (res.status !== 200) return { outcome: "DEFECT", detail: `expected 200 for the caller's own list, got ${res.status}` };
    if (!Array.isArray(res.body)) return { outcome: "DEFECT", detail: "expected an array" };
    if (leaksOtherOrg(res.raw))
      return { outcome: "DEFECT", detail: `the returned set contains Org B data: ${res.raw.slice(0, 200)}` };
    return { outcome: "PASS", detail: `${res.body.length} item(s), all Org A` };
  });

listProbe("ISO-17", "GET /workflows");
listProbe("ISO-18", "GET /runs");
listProbe("ISO-19", "GET /agents");
listProbe("ISO-20", "GET /agent-tasks");
listProbe("ISO-21", "GET /support/tickets");

/* ------------------------------------------------------------------ agent-token isolation ----- */

probe("ISO-22", "an Org A agent credential lists only Org A tasks", "34.8", async () => {
  const res = await call(agentEvent(A.tokens.browser, "GET /agent/tasks"));
  if (res.status !== 200) return { outcome: "DEFECT", detail: `expected 200, got ${res.status}` };
  if (leaksOtherOrg(res.raw)) return { outcome: "DEFECT", detail: `Org B tasks offered to an Org A agent: ${res.raw.slice(0, 200)}` };
  return { outcome: "PASS", detail: `${res.body.length} task(s), all Org A` };
});

probe("ISO-23", "an Org A agent credential cannot claim an Org B task by id", "34.8", async () => {
  const res = await call(agentEvent(A.tokens.browser, "POST /agent/tasks/{id}/claim", { pathParameters: { id: B.tasks.browser.id } }));
  if (res.status === 404 && !leaksOtherOrg(res.raw)) return { outcome: "PASS", detail: "404, no Org B data" };
  return { outcome: "DEFECT", detail: `status ${res.status}: ${res.raw.slice(0, 200)}` };
});

/* ------------------------------------------------------------------------- staff behaviour ----- */

probe("ISO-24", "a staff principal reading another organization's record succeeds", "34.7", async () => {
  const res = await call(sessionEvent(seed.staff, "GET /organizations/{slug}", { pathParameters: { slug: B.tenantId } }));
  if (res.status === 200 && res.body.slug === B.tenantId) return { outcome: "PASS", detail: "staff read succeeds, as intended" };
  return { outcome: "DEFECT", detail: `staff read of another organization returned ${res.status}` };
});

probe("ISO-25", "a staff cross-organization read produces a cross-tenant read audit event", "34.7", async () => {

  const before = [...store.keys()].filter((k) => k.includes("ACTIVITY#") || k.includes("AUDIT#")).length;
  await call(sessionEvent(seed.staff, "GET /organizations/{slug}", { pathParameters: { slug: B.tenantId } }));
  const after = [...store.keys()].filter((k) => k.includes("ACTIVITY#") || k.includes("AUDIT#")).length;
  if (after > before) return { outcome: "PASS", detail: "an audit record was written" };
  return {
    outcome: "DEFECT",
    detail: "a staff principal read another organization's record and no cross-tenant read audit event was recorded",
  };
});

probe("ISO-26", "a staff cross-organization write is recorded as an audit event", "34.5", async () => {

  const activityBefore = [...store.keys()].filter((k) => k.startsWith(`TENANT#${B.tenantId}|ACTIVITY#`)).length;
  const res = await call(
    sessionEvent(seed.staff, "POST /agent-authorizations", { body: { name: "staff-provisioned", tenantId: B.tenantId } }),
  );
  const activityAfter = [...store.keys()].filter((k) => k.startsWith(`TENANT#${B.tenantId}|ACTIVITY#`)).length;
  if (res.status !== 201) return { outcome: "DEFECT", detail: `staff cross-organization write returned ${res.status}` };
  if (activityAfter > activityBefore) return { outcome: "PASS", detail: "the write landed in Org B and was audited there" };
  return { outcome: "DEFECT", detail: "a staff cross-organization write left no audit event" };
});

/* ------------------------------------------------------- body naming the other organization ---- */

probe("ISO-27", "a customer admin cannot redirect an agent authorization into another organization", "34.5", async () => {
  const res = await call(
    sessionEvent(A.principals.ORG_ADMIN, "POST /agent-authorizations", { body: { name: "redirect attempt", tenantId: B.tenantId } }),
  );
  if (res.status !== 201) return { outcome: "PASS", detail: `refused with ${res.status}` };
  if (res.body.agent && res.body.agent.tenantId === A.tenantId)
    return { outcome: "PASS", detail: "the body's tenantId was ignored; the agent landed in the caller's own organization" };
  return { outcome: "DEFECT", detail: `the agent was created in ${res.body.agent && res.body.agent.tenantId}` };
});

/* --------------------------------------------------------------- deliberate cross-org reads ---- */

probe("ISO-28", "organization branding is readable without authentication", "6.6", async () => {
  const res = await call({ routeKey: "GET /organizations/{slug}/branding", headers: {}, pathParameters: { slug: B.tenantId } });
  if (res.status === 200)
    return {
      outcome: "BY_DESIGN",
      detail:
        "name and branding are served unauthenticated for any slug, so a sign-in page can brand itself before a session exists. No run, user or execution data is exposed. Recorded so the decision is visible rather than assumed.",
    };
  return { outcome: "PASS", detail: `not readable unauthenticated (${res.status})` };
});

/* ------------------------------------------------------------------- membership enforcement ---- */

probe("ISO-29", "a deactivated member is refused on an authenticated route", "34.10", async () => {
  const res = await call(sessionEvent(A.principals.DEACTIVATED, "GET /runs"));
  if (res.status === 403 || res.status === 401) return { outcome: "PASS", detail: `refused with ${res.status}` };
  return {
    outcome: "DEFECT",
    detail: `a member disabled in the user pool still reached the route and received ${res.status}. Authorization is derived entirely from the session's own claims; no route re-checks membership state.`,
  };
});

/* ---------------------------------------------------------------------------------- runner ----- */

(async () => {
  console.log("\nBASELINE TWO-ORGANIZATION ISOLATION AUDIT (against unmodified handlers)\n");
  const results = [];
  for (const p of probes) {
    let outcome;
    let detail;
    try {
      ({ outcome, detail } = await p.run());
    } catch (err) {
      outcome = "DEFECT";
      detail = `probe threw: ${err && err.message}`;
    }
    results.push({ id: p.id, name: p.name, requirement: p.requirement, outcome, detail });
    const mark = outcome === "PASS" ? "PASS  " : outcome === "BY_DESIGN" ? "NOTE  " : "DEFECT";
    console.log(`  ${mark}  ${p.id}  ${p.name}\n          ${detail}`);
  }

  const counts = results.reduce((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] || 0) + 1 }), {});
  console.log(
    `\n  ${results.length} probes: ${counts.PASS || 0} pass, ${counts.DEFECT || 0} defect, ${counts.BY_DESIGN || 0} by design\n`,
  );

  const baselinePath = path.join(__dirname, "isolation-baseline.json");
  const record = { probes: results.map(({ id, name, requirement, outcome }) => ({ id, name, requirement, outcome })) };

  if (process.env.RECORD_ISOLATION_BASELINE === "1") {
    fs.writeFileSync(baselinePath, JSON.stringify({ ...record, details: results }, null, 2) + "\n");
    console.log("  baseline recorded to isolation-baseline.json\n");
    process.exit(0);
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const expected = new Map(baseline.probes.map((p) => [p.id, p.outcome]));
  const drift = [];
  for (const r of results) {
    if (!expected.has(r.id)) drift.push(`${r.id} is not in the recorded baseline (add it)`);
    else if (expected.get(r.id) !== r.outcome)
      drift.push(`${r.id} was ${expected.get(r.id)} at baseline and is now ${r.outcome} -- ${r.detail}`);
  }
  for (const p of baseline.probes) if (!results.some((r) => r.id === p.id)) drift.push(`${p.id} is in the baseline but no longer probed`);

  if (drift.length) {
    console.log("ISOLATION BASELINE DRIFT\n");
    for (const line of drift) console.log("  " + line);
    console.log(
      "\nIf a defect was intentionally fixed, re-record with RECORD_ISOLATION_BASELINE=1 in the same commit.\n",
    );
  }
  try {
    assert.deepEqual(drift, []);
  } catch {
    process.exit(1);
  }
  console.log("  baseline matches: no isolation drift\n");
})();
