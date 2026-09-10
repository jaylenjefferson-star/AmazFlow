// Guardrail 2.6 -- heartbeat-derived status, per-step evidence, and append-only audit ordering.
//
// Three separate guarantees, grouped because they are all about the platform's record of what
// happened rather than about what it decided.
//
//   HEARTBEAT -- an agent's status is DERIVED from how recently it beat, never stored as a state
//                someone has to remember to update. A stored status goes stale the moment a laptop
//                sleeps; a derived one cannot. The grace period tolerates one missed beat.
//   EVIDENCE  -- every resolved step carries the full attribution set: which task, which agent,
//                which grant, when it was claimed, when it reported, what page or application, and
//                the verification verdict with its expected/actual pair. This is what makes a run
//                auditable after the fact rather than merely logged.
//   ORDERING  -- audit entries are append-only and read back in non-decreasing time order. The
//                queryable AUDIT# trail is what evidence tooling reads, so it must not diverge from
//                the run document's own array.
//
// _Requirements: 31.13, 31.14, 31.17, 28.12, 31.18_
const assert = require("node:assert");
const { store, put, putTenant, load, loadRun, asAgent, asUser, seedAgent, iso, reporter } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("GUARDRAIL: heartbeat status, evidence, and audit ordering");

const TENANT = "guardh";
const ADMIN = { userId: "user_admin", tenantId: TENANT, group: "CLIENT_ADMIN" };

// Agents beat every two minutes and stay connected for five, so exactly one missed beat is
// tolerated and two are not. Those are the numbers the guardrail pins.
const HEARTBEAT_INTERVAL_MS = 2 * 60000;
const HEARTBEAT_GRACE_MS = 5 * 60000;

const workflow = {
  id: "wf_h",
  tenantId: TENANT,
  name: "Evidence guardrail",
  version: 1,
  status: "active",
  assignedRoles: ["CLIENT_ADMIN"],
  startAt: "s_act",
  steps: [
    {
      id: "s_act",
      type: "action",
      provider: "browser",
      operation: "SET_EMPLOYEE_STATUS",
      name: "Set status",
      input: { selector: "#status", status: "Inactive", url: "https://h.example.com/e/1" },
      verify: { path: "result.status", equals: "Inactive" },
      next: "s_done",
    },
    { id: "s_done", type: "end", outcome: "success", name: "Done" },
  ],
};
putTenant(TENANT, "WORKFLOW", workflow);
putTenant(TENANT, "WORKFLOWVERSION", { ...workflow, id: "wf_h_v000001" });

const TOKEN = seedAgent(
  TENANT,
  {
    id: "agent_h",
    tenantId: TENANT,
    name: "Chrome",
    status: "active",
    agentType: "CHROME_EXTENSION",
    capabilities: ["SET_EMPLOYEE_STATUS"],
    lastSeenAt: iso(-1000),
    version: "1.0.0",
    createdAt: iso(-86400000),
  },
  "tok_h",
);

const agentRecord = () => load(`TENANT#${TENANT}`, "AGENT#agent_h");
const setLastSeen = (at) => putTenant(TENANT, "AGENT", { ...agentRecord(), lastSeenAt: at });
const snapshotOf = async (agentId = "agent_h") => {
  const res = await asUser(ADMIN, "GET /agents");
  return res.body.find((a) => a.id === agentId);
};
const heartbeat = (body = {}) => asAgent(TOKEN, "POST /agent/heartbeat", { body });

let seq = 0;
const freshWork = () => {
  const n = ++seq;
  const runId = `run_h_${n}`;
  const taskId = `task_h_${n}`;
  putTenant(TENANT, "RUN", {
    id: runId,
    tenantId: TENANT,
    workflowId: workflow.id,
    workflowVersion: 1,
    status: "WAITING_AGENT",
    currentStepId: "s_act",
    createdBy: "user_admin",
    confirmedStepIds: [],
    stepResults: {},
    context: { input: {}, values: {}, lastAction: null },
    audit: [{ id: "aud_1", at: iso(-60000), type: "RUN_STARTED", message: "started", details: {} }],
    createdAt: iso(-60000),
    updatedAt: iso(-60000),
  });
  putTenant(TENANT, "TASK", {
    id: taskId,
    runId,
    tenantId: TENANT,
    stepId: "s_act",
    provider: "browser",
    operation: "SET_EMPLOYEE_STATUS",
    executionTarget: "browser_extension",
    destination: "https://h.example.com",
    input: { selector: "#status", status: "Inactive" },
    expiresAt: iso(300000),
    status: "PENDING",
    workflowId: workflow.id,
    assignedRoles: ["CLIENT_ADMIN"],
    createdBy: "user_admin",
  });
  return { runId, taskId };
};

/** Every audit row persisted for a run, in stored key order -- what the evidence tooling reads. */
const auditRowsFor = (runId) =>
  [...store.entries()]
    .filter(([key]) => key.startsWith(`TENANT#${TENANT}|AUDIT#${runId}#`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, item]) => JSON.parse(item.document.S));

(async () => {
  /* ------------------------------------------------------------------------------ heartbeat ---- */
  section("agent status is derived from heartbeat recency");

  await check("a heartbeat at the normal interval is accepted and recorded", async () => {
    setLastSeen(iso(-HEARTBEAT_INTERVAL_MS));
    const before = agentRecord().lastSeenAt;
    const res = await heartbeat({ version: "1.1.0" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const after = agentRecord();
    assert.notEqual(after.lastSeenAt, before, "the heartbeat moves the last-seen time forward");
    assert.ok(new Date(after.lastSeenAt).getTime() > new Date(before).getTime());
    assert.equal(after.version, "1.1.0", "the reported build is recorded");
  });

  await check("a fresh heartbeat derives connected", async () => {
    setLastSeen(iso(-1000));
    assert.equal((await snapshotOf()).connectionStatus, "connected");
  });

  await check("one missed interval is tolerated -- still connected", async () => {
    setLastSeen(iso(-(HEARTBEAT_INTERVAL_MS * 2 - 1000)));
    assert.equal((await snapshotOf()).connectionStatus, "connected", "a single missed beat must not report offline");
  });

  await check("more than the grace period without a beat derives offline", async () => {
    setLastSeen(iso(-(HEARTBEAT_GRACE_MS + 1000)));
    assert.equal((await snapshotOf()).connectionStatus, "offline");
  });

  await check("an agent that never beat at all derives offline, not connected", async () => {
    putTenant(TENANT, "AGENT", { ...agentRecord(), lastSeenAt: null });
    assert.equal((await snapshotOf()).connectionStatus, "offline", "absence of a heartbeat is not evidence of presence");
  });

  await check("a revoked agent derives revoked regardless of how recently it beat", async () => {
    putTenant(TENANT, "AGENT", { ...agentRecord(), status: "revoked", lastSeenAt: iso(-1000) });
    assert.equal((await snapshotOf()).connectionStatus, "revoked", "revocation outranks recency");
    putTenant(TENANT, "AGENT", { ...agentRecord(), status: "active", lastSeenAt: iso(-1000) });
  });

  await check("a heartbeat updates the advertised capability set, so a self-updating agent becomes eligible", async () => {
    await heartbeat({ version: "1.2.0", capabilities: ["SET_EMPLOYEE_STATUS", "CLICK", "TYPE"] });
    assert.deepEqual(agentRecord().capabilities, ["SET_EMPLOYEE_STATUS", "CLICK", "TYPE"]);
    const snapshot = await snapshotOf();
    assert.deepEqual(snapshot.capabilities, ["SET_EMPLOYEE_STATUS", "CLICK", "TYPE"]);
  });

  await check("a heartbeat records reported permissions", async () => {
    await heartbeat({ permissions: { accessibility: true, screenRecording: false } });
    assert.deepEqual(agentRecord().permissions, { accessibility: true, screenRecording: false });
    assert.deepEqual((await snapshotOf()).permissions, { accessibility: true, screenRecording: false });
  });

  await check("the snapshot exposes the full derived shape rather than raw storage", async () => {
    setLastSeen(iso(-1000));
    const snapshot = await snapshotOf();
    for (const field of [
      "agentId",
      "installationId",
      "agentType",
      "name",
      "version",
      "capabilities",
      "organizationId",
      "platform",
      "lastHeartbeatAt",
      "permissions",
      "connectionStatus",
    ])
      assert.ok(field in snapshot, `the agent snapshot must expose ${field}`);
    assert.equal(snapshot.organizationId, TENANT);
  });

  /* ------------------------------------------------------------------------------- evidence ---- */
  section("per-step evidence carries the full attribution set");

  await check("a resolved step records task, agent, grant, claim time, report time, page, and verdict", async () => {
    const work = freshWork();
    const claimed = await asAgent(TOKEN, "POST /agent/tasks/{id}/claim", { pathParameters: { id: work.taskId } });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    const observedAt = iso();
    const res = await asAgent(TOKEN, "POST /agent/tasks/{id}/result", {
      pathParameters: { id: work.taskId },
      grant: claimed.body.grant,
      body: {
        ok: true,
        status: "Inactive",
        evidence: { url: "https://h.example.com/e/1", title: "Employee 1", observedAt },
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const evidence = loadRun(TENANT, work.runId).stepResults.s_act.evidence;
    assert.equal(evidence.taskId, work.taskId, "which task");
    assert.equal(evidence.agentId, "agent_h", "which agent");
    assert.equal(evidence.agentType, "CHROME_EXTENSION");
    assert.equal(evidence.grantId, claimed.body.grantId, "which grant authorized the write");
    assert.equal(evidence.executionTarget, "browser_extension");
    assert.equal(evidence.destination, "https://h.example.com");
    assert.ok(evidence.claimedAt, "when it was claimed");
    assert.ok(evidence.reportedAt, "when it reported");
    assert.ok(new Date(evidence.reportedAt).getTime() >= new Date(evidence.claimedAt).getTime(), "reported no earlier than claimed");
    assert.equal(evidence.page.url, "https://h.example.com/e/1", "what page or application");
    assert.equal(evidence.verified, true, "the verification verdict");
    assert.equal(evidence.expected, "Inactive");
    assert.equal(evidence.actual, "Inactive");
  });

  await check("the expected/actual pair is recorded even when the two disagree", async () => {
    const work = freshWork();
    const claimed = await asAgent(TOKEN, "POST /agent/tasks/{id}/claim", { pathParameters: { id: work.taskId } });
    await asAgent(TOKEN, "POST /agent/tasks/{id}/result", {
      pathParameters: { id: work.taskId },
      grant: claimed.body.grant,
      body: { ok: true, status: "Active" },
    });
    const evidence = loadRun(TENANT, work.runId).stepResults.s_act.evidence;
    assert.equal(evidence.verified, false);
    assert.equal(evidence.expected, "Inactive");
    assert.equal(evidence.actual, "Active");
    assert.equal(evidence.grantId, claimed.body.grantId, "a failed verification is still attributed to its grant");
  });

  /* -------------------------------------------------------------------------------- ordering ---- */
  section("the audit trail is append-only and time-ordered");

  await check("run audit entries are read back in non-decreasing time order", async () => {
    const work = freshWork();
    const claimed = await asAgent(TOKEN, "POST /agent/tasks/{id}/claim", { pathParameters: { id: work.taskId } });
    await asAgent(null, "POST /agent/tools/record-step-result", {
      body: { grant: claimed.body.grant, stepId: "s_act", status: "IN_PROGRESS", note: "working" },
    });
    await asAgent(TOKEN, "POST /agent/tasks/{id}/result", {
      pathParameters: { id: work.taskId },
      grant: claimed.body.grant,
      body: { ok: true, status: "Inactive" },
    });

    const entries = loadRun(TENANT, work.runId).audit;
    assert.ok(entries.length >= 4, `expected several entries, got ${entries.length}`);
    for (let i = 1; i < entries.length; i++) {
      const previous = new Date(entries[i - 1].at).getTime();
      const current = new Date(entries[i].at).getTime();
      assert.ok(current >= previous, `entry ${i} (${entries[i].type}) is timestamped before entry ${i - 1} (${entries[i - 1].type})`);
    }
  });

  await check("the queryable audit trail matches the run's own array, entry for entry", async () => {
    const work = freshWork();
    const claimed = await asAgent(TOKEN, "POST /agent/tasks/{id}/claim", { pathParameters: { id: work.taskId } });
    await asAgent(TOKEN, "POST /agent/tasks/{id}/result", {
      pathParameters: { id: work.taskId },
      grant: claimed.body.grant,
      body: { ok: true, status: "Inactive" },
    });

    const runEntries = loadRun(TENANT, work.runId).audit;
    const rows = auditRowsFor(work.runId);
    // The seeded RUN_STARTED entry predates the queryable trail (it was written directly by the
    // fixture, not through the engine), so compare the entries the engine itself appended.
    const appended = runEntries.slice(runEntries.length - rows.length);
    assert.equal(rows.length, appended.length, "every appended entry has a queryable row");
    assert.deepEqual(
      rows.map((r) => r.type),
      appended.map((e) => e.type),
      "the queryable trail must not diverge from the run document's own array",
    );
    for (const row of rows) assert.equal(row.runId, work.runId, "each row names its run");
  });

  await check("the queryable rows are ordered non-decreasing in time under their key order", async () => {
    const work = freshWork();
    const claimed = await asAgent(TOKEN, "POST /agent/tasks/{id}/claim", { pathParameters: { id: work.taskId } });
    await asAgent(null, "POST /agent/tools/record-step-result", {
      body: { grant: claimed.body.grant, stepId: "s_act", status: "IN_PROGRESS", note: "step one" },
    });
    await asAgent(TOKEN, "POST /agent/tasks/{id}/result", {
      pathParameters: { id: work.taskId },
      grant: claimed.body.grant,
      body: { ok: true, status: "Inactive" },
    });
    const rows = auditRowsFor(work.runId);
    assert.ok(rows.length >= 3);
    for (let i = 1; i < rows.length; i++)
      assert.ok(
        new Date(rows[i].at).getTime() >= new Date(rows[i - 1].at).getTime(),
        `row ${i} (${rows[i].type}) is timestamped before row ${i - 1} (${rows[i - 1].type})`,
      );
  });

  await check("existing audit entries are never rewritten, only appended to", async () => {
    const work = freshWork();
    const claimed = await asAgent(TOKEN, "POST /agent/tasks/{id}/claim", { pathParameters: { id: work.taskId } });
    const afterClaim = loadRun(TENANT, work.runId).audit.map((e) => JSON.stringify(e));

    await asAgent(TOKEN, "POST /agent/tasks/{id}/result", {
      pathParameters: { id: work.taskId },
      grant: claimed.body.grant,
      body: { ok: true, status: "Inactive" },
    });
    const afterResult = loadRun(TENANT, work.runId).audit.map((e) => JSON.stringify(e));

    assert.ok(afterResult.length > afterClaim.length, "the trail grew");
    assert.deepEqual(afterResult.slice(0, afterClaim.length), afterClaim, "no earlier entry was modified or reordered");
  });

  await check("a step's evidence write and its terminal result both appear on the trail", async () => {
    const work = freshWork();
    const claimed = await asAgent(TOKEN, "POST /agent/tasks/{id}/claim", { pathParameters: { id: work.taskId } });
    await asAgent(null, "POST /agent/tools/record-step-result", {
      body: { grant: claimed.body.grant, stepId: "s_act", status: "SUCCEEDED", note: "observed at https://h.example.com/e/1" },
    });
    await asAgent(TOKEN, "POST /agent/tasks/{id}/result", {
      pathParameters: { id: work.taskId },
      grant: claimed.body.grant,
      body: { ok: true, status: "Inactive" },
    });
    const types = loadRun(TENANT, work.runId).audit.map((e) => e.type);
    for (const expected of ["AGENT_TASK_CLAIMED", "EXECUTOR_PROGRESS", "AGENT_RESULT", "COMPLETED"])
      assert.ok(types.includes(expected), `the trail must include ${expected}, got ${types.join(", ")}`);
  });

  done();
})();
