// Property 1 -- Tenant isolation.
//
// **Property 1: Tenant isolation** -- no read, write, execute, or inspect crosses an organization
// boundary through any route; cross-organization denial precedes any permission evaluation; a
// tenant-scoped query returns only own-partition items; the agent admission predicate never admits a
// foreign task.
//
// **Validates: Requirements 6.1, 6.2, 6.3, 6.5, 6.6, 6.7, 6.8, 6.9, 6.11, 6.12, 7.6, 15.10, 22.8**
//
// The two-organization suite next door attacks a fixed list of routes with a fixed pair of
// organizations. That catches the routes somebody thought to attack. This asserts the property over
// generated principals, permissions and resources -- including role/permission/organization
// combinations nobody would think to write down -- so the isolation claim is about the POLICY rather
// than about a sample of it.
//
// Both copies of the policy are exercised: the canonical package and the inline copy lifted out of
// the deployed CloudFormation template. A property that holds for one and not the other is a drift
// bug, and it is the deployed one that matters.
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fc = require("fast-check");

const { store, seedUser } = require("./harness.cjs");
const { writeTo } = require("./extract-inline-handler.cjs");
const inline = require(writeTo(path.join(os.tmpdir(), `amazflow-inline-p1-${process.pid}.cjs`)));
const { reporter, put, iso } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("PROPERTY 1 -- TENANT ISOLATION");

// The canonical policy, loaded through tsx-free means: it is plain TypeScript with only type-level
// syntax, so stripping types is not an option -- require it via the already-installed tsx loader.
const canonical = requireCanonicalPolicy();
function requireCanonicalPolicy() {
  const { execFileSync } = require("node:child_process");
  const root = path.join(__dirname, "..", "..", "..");
  // Evaluate the canonical module in a child process with tsx, and bring back a pure-data
  // description of every decision it makes for the generated cases. Doing it as data rather than as
  // a live object keeps this file dependency-free at require time.
  return {
    root,
    decide(cases) {
      const script = `
import { can } from "${path.join(root, "packages/permissions/src/index.ts")}";
const cases = JSON.parse(process.argv[2]);
process.stdout.write(JSON.stringify(cases.map((c) => can(c.principal, c.permission, c.resource))));
`;
      const file = path.join(os.tmpdir(), `amazflow-canon-p1-${process.pid}.mts`);
      require("node:fs").writeFileSync(file, script);
      // pnpm keeps each package's binaries in its own node_modules, so there is no hoisted tsx at
      // the workspace root -- resolve it from this package, which declares it.
      const tsx = path.join(__dirname, "..", "node_modules", ".bin", "tsx");
      const out = execFileSync(tsx, [file, JSON.stringify(cases)], {
        encoding: "utf8",
        cwd: root,
        maxBuffer: 64 * 1024 * 1024,
      });
      return JSON.parse(out);
    },
  };
}

/* ----------------------------------------------------------------------------- generators ----- */

const ORGS = ["orga", "orgb", "orgc"];
const CUSTOMER_ROLES = [
  "ORG_OWNER",
  "ORG_ADMIN",
  "WORKFLOW_BUILDER",
  "OPERATOR",
  "APPROVER",
  "VIEWER",
];
const ALL_PERMISSIONS = inline.PERMISSIONS || [];

// Smart generators: constrained to the real input space rather than to arbitrary strings. A
// principal whose orgId is not one of the three organizations, or whose role is not a real role,
// would exercise the policy's behaviour on inputs the type system already forbids -- and would tell
// us nothing about isolation.
const orgArb = fc.constantFrom(...ORGS);
const customerPrincipalArb = fc.record({
  kind: fc.constant("user"),
  userId: fc.constantFrom("u1", "u2", "u3"),
  orgId: orgArb,
  role: fc.constantFrom(...CUSTOMER_ROLES),
  teamIds: fc.constant([]),
  isStaff: fc.constant(false),
});
const staffPrincipalArb = fc.record({
  kind: fc.constant("user"),
  userId: fc.constantFrom("s1", "s2"),
  orgId: fc.constant("amazflow"),
  role: fc.constant("STAFF_ADMIN"),
  teamIds: fc.constant([]),
  isStaff: fc.constant(true),
});
const permissionArb = fc.constantFrom(...ALL_PERMISSIONS);
const resourceArb = fc.record(
  {
    orgId: orgArb,
    ownerUserId: fc.option(fc.constantFrom("u1", "u2", "u3"), { nil: undefined }),
    assignedRoles: fc.option(
      fc.subarray(["FRONTLINE", "CLIENT_ADMIN", "SUPER_ADMIN"], { minLength: 1 }),
      { nil: undefined },
    ),
  },
  { requiredKeys: ["orgId"] },
);

/* ----------------------------------------------------------------------------- the property ---- */

(async () => {
  section("the organization boundary");

  await check("P1.1 no customer principal is ever allowed a resource in another organization", () => {
    fc.assert(
      fc.property(customerPrincipalArb, permissionArb, resourceArb, (principal, permission, resource) => {
        if (resource.orgId === principal.orgId) return true; // not the case under test
        const decision = inline.can(principal, permission, resource);
        // The claim is unconditional: no permission, no role, no resource shape admits it. This is
        // the property that makes the whole restructure safe to build on -- everything else in the
        // policy is a question about capability, and this one is a question about reachability.
        assert.equal(
          decision.allow,
          false,
          `${principal.role} was allowed ${permission} on ${resource.orgId} while belonging to ${principal.orgId}`,
        );
        assert.equal(decision.code, "WRONG_ORG", "and the reason must be the boundary, not the grant");
        return true;
      }),
      { numRuns: 2000 },
    );
  });

  await check("P1.2 cross-organization denial precedes any permission evaluation", () => {
    // Operationally: the decision for a foreign resource does not depend on the permission at all.
    // If the boundary were checked after the grant lookup, a permission the role lacks would produce
    // FORBIDDEN and one it holds would produce WRONG_ORG -- so the codes would vary with the
    // permission. They must not.
    fc.assert(
      fc.property(customerPrincipalArb, resourceArb, (principal, resource) => {
        if (resource.orgId === principal.orgId) return true;
        const codes = new Set(
          ALL_PERMISSIONS.map((permission) => inline.can(principal, permission, resource).code),
        );
        assert.deepEqual(
          [...codes],
          ["WRONG_ORG"],
          "a foreign resource must produce exactly one decision code, independent of the permission",
        );
        return true;
      }),
      { numRuns: 500 },
    );
  });

  await check("P1.3 a wrong-organization denial answers 404 and names nothing", () => {
    fc.assert(
      fc.property(customerPrincipalArb, permissionArb, resourceArb, (principal, permission, resource) => {
        if (resource.orgId === principal.orgId) return true;
        const decision = inline.can(principal, permission, resource);
        assert.equal(inline.statusForDecision(decision.code), 404, "404, not 403");
        const message = inline.messageForDecision(decision);
        // The message must not carry the other organization's identifier, and must not name the
        // record type either: both are the existence oracle in a different costume.
        assert.ok(
          !message.includes(resource.orgId),
          `the refusal echoed the foreign organization id: ${message}`,
        );
        assert.equal(message, "Not found");
        return true;
      }),
      { numRuns: 1000 },
    );
  });

  await check("P1.4 staff cross-organization access is allowed but never silent", () => {
    // Staff crossing the boundary is intended (ISO-24). What must hold is that the ALLOW is
    // conditional on an enumerated staff grant rather than on being staff -- an unenumerated
    // superuser is the thing nobody can review.
    fc.assert(
      fc.property(staffPrincipalArb, permissionArb, resourceArb, (principal, permission, resource) => {
        const decision = inline.can(principal, permission, resource);
        assert.equal(
          decision.allow,
          inline.STAFF_GRANTS.has(permission),
          `staff decision for ${permission} must follow STAFF_GRANTS exactly`,
        );
        return true;
      }),
      { numRuns: 1000 },
    );
  });

  await check("P1.5 ownership transfer and ticket filing are never staff capabilities", () => {
    // Two deliberate omissions from STAFF_GRANTS, asserted so a future "staff can do anything"
    // edit fails rather than quietly widening.
    for (const permission of ["org:transfer_ownership", "support:create"]) {
      assert.equal(
        inline.STAFF_GRANTS.has(permission),
        false,
        `staff must not hold ${permission}`,
      );
    }
  });

  section("the tenant-scoped read");

  await check("P1.6 a tenant-scoped query returns only own-partition items", async () => {
    // Exercised against the real paged read through the harness store rather than against a mock, so
    // this is a claim about the query the control plane actually issues.
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          fc.record({ org: orgArb, id: fc.hexaString({ minLength: 4, maxLength: 8 }) }),
          { minLength: 1, maxLength: 25, selector: (r) => r.id },
        ),
        orgArb,
        async (records, readerOrg) => {
          store.clear();
          for (const record of records)
            put(`TENANT#${record.org}`, `RUN#${record.id}`, {
              id: record.id,
              tenantId: record.org,
              status: "RUNNING",
              createdAt: iso(),
            });
          const items = await inline.tenantRead("RUN#", {
            kind: "user",
            userId: "u1",
            orgId: readerOrg,
            role: "ORG_ADMIN",
            isStaff: false,
          });
          const foreign = items.filter((item) => item.tenantId !== readerOrg);
          assert.deepEqual(foreign, [], "a tenant read returned another organization's records");
          // And it is complete for its own partition: under-returning would hide a customer's own
          // data, which is a different bug but just as real.
          assert.equal(
            items.length,
            records.filter((r) => r.org === readerOrg).length,
            "a tenant read must return ALL of its own partition",
          );
          return true;
        },
      ),
      { numRuns: 120 },
    );
    store.clear();
  });

  await check("P1.7 the tenant-scoped read takes the organization from the principal only", () => {
    // There is no argument to pass someone else's organization in. Asserted on the function's own
    // shape, because this is a claim about the interface rather than about a run of it.
    assert.equal(inline.tenantRead.length, 2, "tenantRead(type, principal) and nothing more");
    assert.deepEqual(inline.tenantScope({ orgId: "orgb" }), { pk: "TENANT#orgb" });
  });

  await check("P1.8 a cross-organization read is refused without a stated reason", async () => {
    const staff = { kind: "user", userId: "s1", orgId: "amazflow", role: "STAFF_ADMIN", isStaff: true };
    await assert.rejects(
      () => inline.crossTenantRead("RUN#", staff, ""),
      /requires a stated reason/,
      "an unexplained cross-organization read must not be possible",
    );
  });

  await check("P1.9 a customer principal cannot invoke the cross-organization read at all", async () => {
    await fc.assert(
      fc.asyncProperty(customerPrincipalArb, async (principal) => {
        await assert.rejects(
          () => inline.crossTenantRead("RUN#", principal, "a plausible-sounding reason"),
          (err) => err && err.status === 403,
          "the named cross-organization read is not reachable by a customer principal",
        );
        return true;
      }),
      { numRuns: 60 },
    );
  });

  section("the agent execution path");

  await check("P1.10 an agent principal is never staff and never crosses its own organization", () => {
    fc.assert(
      fc.property(orgArb, fc.constantFrom("CHROME_EXTENSION", "DESKTOP_AGENT"), (org, agentType) => {
        const agent = inline.agentPrincipalFor({
          agentId: "agent_1",
          tenantId: org,
          agent: { agentType, capabilities: ["READ_TEXT"] },
        });
        assert.equal(agent.isStaff, false, "the agent elevation must not present as staff");
        assert.equal(agent.kind, "agent", "and must be its own principal kind");
        assert.equal(agent.orgId, org);
        return true;
      }),
      { numRuns: 200 },
    );
  });

  await check("P1.11 the agent admission predicate never admits a foreign task", () => {
    // agentMayRunTask is the isolating control on the agent path (requirement 6.12): the read spans
    // organizations before filtering, so the filter is what has to be total.
    fc.assert(
      fc.property(
        orgArb,
        orgArb,
        fc.constantFrom("CHROME_EXTENSION", "DESKTOP_AGENT"),
        fc.constantFrom("browser_extension", "desktop_agent"),
        fc.constantFrom("READ_TEXT", "CLICK", "SET_EMPLOYEE_STATUS"),
        (agentOrg, taskOrg, agentType, executionTarget, operation) => {
          const admitted = inline.agentMayRunTask(
            { tenantId: taskOrg, executionTarget, operation, status: "PENDING" },
            {
              agentId: "agent_1",
              tenantId: agentOrg,
              agent: { agentType, capabilities: ["READ_TEXT", "CLICK", "SET_EMPLOYEE_STATUS"] },
            },
          );
          if (taskOrg !== agentOrg)
            assert.equal(admitted, false, "an agent was offered a task from another organization");
          return true;
        },
      ),
      { numRuns: 2000 },
    );
  });

  section("both copies of the policy agree");

  await check("P1.12 the deployed policy and the canonical package decide identically", () => {
    // A regex parity check cannot catch a grant set that drifted by one entry. This can: the same
    // generated cases are put to both implementations and the decisions must match exactly.
    const cases = fc.sample(
      fc.record({
        principal: fc.oneof(customerPrincipalArb, staffPrincipalArb),
        permission: permissionArb,
        resource: resourceArb,
      }),
      600,
    );
    const canonicalDecisions = canonical.decide(cases);
    cases.forEach((c, index) => {
      const mine = inline.can(c.principal, c.permission, c.resource);
      const theirs = canonicalDecisions[index];
      assert.equal(
        mine.allow,
        theirs.allow,
        `drift: ${c.principal.role} / ${c.permission} / ${c.resource.orgId} -- deployed says ${mine.allow}, canonical says ${theirs.allow}`,
      );
      if (!mine.allow) assert.equal(mine.code, theirs.code, `drift in decision code for ${c.permission}`);
    });
  });

  done();
})();
