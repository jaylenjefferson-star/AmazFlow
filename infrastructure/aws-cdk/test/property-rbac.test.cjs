// Property 2 -- RBAC, server-enforced.
//
// **Property 2: RBAC, server-enforced** -- the decision function agrees with the declared matrix in
// both directions; no customer role reaches an internal permission; a forbidden action is refused at
// the API even where navigation would have offered it; the concurrency limit is unsettable by any
// customer role; the staff group is never invitable; the decision function is pure.
//
// **Validates: Requirements 2.1, 2.2, 7.2, 7.5, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.15**
//
// "In both directions" is the part that does the work. A one-directional check -- every granted
// permission is allowed -- passes trivially for a policy that allows everything. The matrix is
// therefore read out of design.md itself and compared against the code in both directions, so the
// document and the implementation cannot drift apart without failing the build.
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const fc = require("fast-check");

// Required before the inline handler: the harness installs the require hook that stands in for the
// AWS SDK, which is what lets the deployed source run unmodified and credential-free.
require("./harness.cjs");
const { writeTo } = require("./extract-inline-handler.cjs");
const inline = require(writeTo(path.join(os.tmpdir(), `amazflow-inline-p2-${process.pid}.cjs`)));
const { reporter } = require("./guardrail-support.cjs");

const { check, section, done } = reporter("PROPERTY 2 -- RBAC, SERVER-ENFORCED");

const CUSTOMER_ROLES = inline.CUSTOMER_ROLES;
const ALL_PERMISSIONS = inline.PERMISSIONS;
const CUSTOMER_PERMISSIONS = inline.CUSTOMER_PERMISSIONS;

/* --------------------------------------------------- the matrix, read out of the design doc ---- */

// design.md holds the matrix as a markdown table with columns OWNER | ADMIN | BUILDER | OPERATOR |
// APPROVER | VIEWER, cells being "✔", "own", "✔ (assigned)", a cross-reference, or blank. Parsing it
// rather than restating it here is deliberate: a restatement is a third copy of the policy, and three
// copies drift faster than two.
const COLUMN_ROLE = [
  "ORG_OWNER",
  "ORG_ADMIN",
  "WORKFLOW_BUILDER",
  "OPERATOR",
  "APPROVER",
  "VIEWER",
];

function parseDesignMatrix() {
  const designPath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    ".kiro",
    "specs",
    "platform-restructure",
    "design.md",
  );
  const lines = fs.readFileSync(designPath, "utf8").split("\n");
  const start = lines.findIndex((line) => /^\| Permission \| OWNER \| ADMIN \| BUILDER \| OPERATOR \| APPROVER \| VIEWER \|/.test(line));
  assert.ok(start !== -1, "the permission matrix table was not found in design.md");

  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 7) break;
    rows.push(cells);
  }

  /** permission -> role -> true | "own" | false | "deferred" */
  const matrix = {};
  for (const cells of rows) {
    // A row label may name several permissions at once, e.g. "`workflow:create` / `:edit`" or
    // "`run:cancel` / `:confirm`". Expand the shorthand rather than special-casing it.
    const label = cells[0];
    const names = expandPermissionLabel(label);
    for (const name of names) {
      matrix[name] = {};
      COLUMN_ROLE.forEach((role, index) => {
        matrix[name][role] = readCell(cells[index + 1]);
      });
    }
  }
  return matrix;
}

function expandPermissionLabel(label) {
  const parts = label.split("/").map((part) => part.trim());
  const names = [];
  let namespace = null;
  for (const part of parts) {
    const match = part.match(/`([^`]+)`/);
    if (!match) continue;
    let name = match[1];
    if (name.startsWith(":")) {
      // ":edit" continues the previous entry's namespace.
      if (!namespace) continue;
      name = `${namespace}${name}`;
    } else {
      namespace = name.split(":")[0];
    }
    names.push(name);
  }
  return names;
}

function readCell(cell) {
  const text = String(cell || "").trim();
  if (text === "") return false;
  if (/^own$/i.test(text)) return "own";
  // "✔ (assigned)" is a grant plus the workflow-assignment rule, which step 6 handles separately.
  if (text.startsWith("✔")) return true;
  // "see *Workflows and the status model*" -- a deferred cell (open question Q-1). Not asserted
  // here; task 14.4 owns resolving it, and the conservative reading is asserted explicitly below.
  return "deferred";
}

const DESIGN_MATRIX = parseDesignMatrix();

/* ----------------------------------------------------------------------------- generators ----- */

const customerPrincipal = (role, orgId = "orga", userId = "u1") => ({
  kind: "user",
  userId,
  orgId,
  role,
  teamIds: [],
  isStaff: false,
});
const roleArb = fc.constantFrom(...CUSTOMER_ROLES);
const permissionArb = fc.constantFrom(...ALL_PERMISSIONS);
const internalPermissionArb = fc.constantFrom(...inline.INTERNAL_PERMISSIONS);

(async () => {
  section("the decision function agrees with the declared matrix, in both directions");

  await check("P2.1 every cell the design grants is allowed by the code", () => {
    let asserted = 0;
    for (const [permission, row] of Object.entries(DESIGN_MATRIX)) {
      if (!ALL_PERMISSIONS.includes(permission)) continue;
      for (const [role, expected] of Object.entries(row)) {
        if (expected === "deferred" || expected === false) continue;
        const principal = customerPrincipal(role);
        // Own-record cells are asserted against the principal's OWN record: "own" means allowed
        // there and refused elsewhere, and the second half is P2.3.
        const resource =
          expected === "own" ? { orgId: "orga", ownerUserId: principal.userId } : { orgId: "orga" };
        const decision = inline.can(principal, permission, resource);
        assert.equal(
          decision.allow,
          true,
          `design.md grants ${role} ${permission} (${expected}) but the code refused it: ${decision.reason}`,
        );
        asserted++;
      }
    }
    assert.ok(asserted > 60, `expected the matrix to cover many cells, asserted only ${asserted}`);
  });

  await check("P2.2 every cell the design leaves blank is denied by the code", () => {
    let asserted = 0;
    for (const [permission, row] of Object.entries(DESIGN_MATRIX)) {
      if (!ALL_PERMISSIONS.includes(permission)) continue;
      for (const [role, expected] of Object.entries(row)) {
        if (expected !== false) continue;
        const decision = inline.can(customerPrincipal(role), permission, { orgId: "orga" });
        assert.equal(
          decision.allow,
          false,
          `design.md denies ${role} ${permission} but the code allowed it -- the code is broader than the document`,
        );
        asserted++;
      }
    }
    assert.ok(asserted > 40, `expected many denied cells, asserted only ${asserted}`);
  });

  await check("P2.3 an 'own' cell is allowed on the principal's own record and refused on another's", () => {
    fc.assert(
      fc.property(roleArb, permissionArb, (role, permission) => {
        const expected = DESIGN_MATRIX[permission]?.[role];
        if (expected !== "own") return true;
        const principal = customerPrincipal(role);
        assert.equal(
          inline.can(principal, permission, { orgId: "orga", ownerUserId: principal.userId }).allow,
          true,
          `${role} must reach ${permission} on its own record`,
        );
        assert.equal(
          inline.can(principal, permission, { orgId: "orga", ownerUserId: "someone-else" }).allow,
          false,
          `${role} must NOT reach ${permission} on another person's record`,
        );
        return true;
      }),
      { numRuns: 600 },
    );
  });

  // Permissions the code grants that the design's matrix table has no row for.
  //
  // This list is a FINDING, not an exemption granted for convenience. The matrix documents
  // `approval:decide`, `team:manage` and `secret:manage` but not their read companions, and
  // `support:*` / `notification:read` belong to requirements 20 and 21 rather than to the matrix
  // table. Enumerating them here is what keeps the gap visible: the list is closed, so a NEW
  // undocumented grant still fails P2.4, and the coherence property that the matrix would have
  // pinned down is asserted directly in P2.4b instead.
  //
  // Resolving this belongs to the design, not to this suite -- adding three rows to the matrix table
  // is a documentation change, and this file must not be the place a policy decision gets made.
  const UNDOCUMENTED_BY_DESIGN = {
    "approval:read": "the matrix documents approval:decide but has no approval:read row",
    "team:read": "the matrix documents team:manage but has no team:read row",
    "secret:reference": "the matrix documents secret:manage but has no secret:reference row",
    "support:read": "the support surface is requirement 20, not the matrix table",
    "support:create": "the support surface is requirement 20, not the matrix table",
    "notification:read": "notifications are requirement 21, not the matrix table",
  };

  await check("P2.4 the code grants no permission absent from the design's matrix rows", () => {
    // The reverse direction of P2.2, applied to the GRANT TABLE rather than to sampled decisions: a
    // permission the code grants a role but the document has no row for is a capability nobody
    // reviewed.
    const documented = new Set(Object.keys(DESIGN_MATRIX));
    const undocumented = [];
    for (const role of CUSTOMER_ROLES) {
      for (const permission of inline.ROLE_GRANTS[role]) {
        if (documented.has(permission)) continue;
        if (permission in UNDOCUMENTED_BY_DESIGN) continue;
        undocumented.push(`${role} -> ${permission}`);
      }
    }
    assert.deepEqual(undocumented, [], `granted but undocumented: ${undocumented.join(", ")}`);
  });

  await check("P2.4b the undocumented read companions are coherent with their documented siblings", () => {
    // What the missing matrix rows would have said, asserted directly: you cannot act on what you
    // cannot see, so a role holding the write form must hold the read form. The converse is NOT
    // required -- VIEWER holds approval:read and team:read precisely because read-only is the point.
    const COMPANION = {
      "approval:decide": "approval:read",
      "team:manage": "team:read",
      "secret:manage": "secret:reference",
    };
    for (const role of CUSTOMER_ROLES) {
      for (const [write, read] of Object.entries(COMPANION)) {
        if (!inline.ROLE_GRANTS[role].has(write)) continue;
        assert.equal(
          inline.ROLE_GRANTS[role].has(read),
          true,
          `${role} holds ${write} but not ${read} -- it could act on something it cannot read`,
        );
      }
    }
    // And the list above is closed: every entry must still be a permission the code knows about, so
    // a renamed permission cannot leave a stale exemption behind.
    for (const permission of Object.keys(UNDOCUMENTED_BY_DESIGN))
      assert.ok(
        ALL_PERMISSIONS.includes(permission),
        `${permission} is exempted from P2.4 but is no longer a real permission -- remove the entry`,
      );
  });

  section("the internal namespace");

  await check("P2.5 no customer role reaches any internal permission, for any resource", () => {
    fc.assert(
      fc.property(
        roleArb,
        internalPermissionArb,
        fc.constantFrom("orga", "orgb"),
        fc.option(fc.constantFrom("u1", "u2"), { nil: undefined }),
        (role, permission, resourceOrg, ownerUserId) => {
          const decision = inline.can(customerPrincipal(role), permission, {
            orgId: resourceOrg,
            ownerUserId,
          });
          assert.equal(
            decision.allow,
            false,
            `${role} reached ${permission} -- the internal namespace must be unreachable`,
          );
          return true;
        },
      ),
      { numRuns: 2000 },
    );
  });

  await check("P2.6 the internal namespace is closed even against a mis-edited grant table", () => {
    // Step 3 runs BEFORE the grant lookup, which is what makes this survivable. Simulated by asking
    // the decision function about a principal whose role has been handed an internal permission.
    const tampered = { ...inline.ROLE_GRANTS };
    const original = new Set(tampered.ORG_ADMIN);
    try {
      tampered.ORG_ADMIN.add("internal:platform_settings");
      const decision = inline.can(customerPrincipal("ORG_ADMIN"), "internal:platform_settings", {
        orgId: "orga",
      });
      assert.equal(
        decision.allow,
        false,
        "an internal permission added to a customer row must still be refused",
      );
    } finally {
      inline.ROLE_GRANTS.ORG_ADMIN.clear();
      for (const permission of original) inline.ROLE_GRANTS.ORG_ADMIN.add(permission);
    }
  });

  await check("P2.7 the bounded AI diagnostic is in the internal namespace", () => {
    assert.ok(
      inline.isInternalPermission("internal:ai_execute"),
      "the diagnostic must not be a customer-namespace permission",
    );
    for (const role of CUSTOMER_ROLES)
      assert.equal(
        inline.can(customerPrincipal(role), "internal:ai_execute", { orgId: "orga" }).allow,
        false,
      );
  });

  section("navigation is never more permissive than enforcement");

  await check("P2.8 every section navigation offers is one the policy would allow", () => {
    fc.assert(
      fc.property(roleArb, (role) => {
        const principal = customerPrincipal(role);
        for (const section of inline.visibleSections(principal)) {
          const permission = inline.SECTION_PERMISSION[section];
          if (permission === null) continue;
          assert.equal(
            inline.can(principal, permission, { orgId: principal.orgId }).allow,
            true,
            `navigation offered ${section} to ${role} but the API would refuse ${permission}`,
          );
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  await check("P2.9 no customer role is offered an internal section", () => {
    for (const role of CUSTOMER_ROLES) {
      const internal = inline
        .visibleSections(customerPrincipal(role))
        .filter((section) => section.startsWith("internal:"));
      assert.deepEqual(internal, [], `${role} was offered ${internal.join(", ")}`);
    }
  });

  await check("P2.10 a forbidden action stays forbidden even where navigation would have offered it", () => {
    // The asymmetry that matters: navigation may be NARROWER than the policy (a section hidden for
    // clarity), but never broader. Enforcement is the authority, and this asserts the direction.
    fc.assert(
      fc.property(roleArb, permissionArb, (role, permission) => {
        const principal = customerPrincipal(role);
        if (inline.can(principal, permission, { orgId: "orga" }).allow) return true;
        const offeringSection = Object.entries(inline.SECTION_PERMISSION).find(
          ([, sectionPermission]) => sectionPermission === permission,
        );
        if (!offeringSection) return true;
        assert.ok(
          !inline.visibleSections(principal).includes(offeringSection[0]),
          `${role} is offered ${offeringSection[0]} but refused ${permission}`,
        );
        return true;
      }),
      { numRuns: 1200 },
    );
  });

  section("the two absolute rules");

  await check("P2.11 the concurrency limit is unsettable by every customer role", () => {
    for (const role of CUSTOMER_ROLES)
      assert.equal(
        inline.maySetConcurrencyLimit(customerPrincipal(role)),
        false,
        `${role} must not be able to raise its own ceiling`,
      );
    assert.equal(
      inline.maySetConcurrencyLimit({ isStaff: true }),
      true,
      "staff set the limit, which is what makes it a limit",
    );
  });

  await check("P2.12 the staff group is never invitable", () => {
    assert.equal(inline.isInvitableGroup("SUPER_ADMIN"), false);
    for (const group of ["CLIENT_ADMIN", "FRONTLINE"]) assert.equal(inline.isInvitableGroup(group), true);
    // And no fine role that maps to the staff group is reachable from a customer group either.
    for (const role of CUSTOMER_ROLES)
      assert.notEqual(inline.coarseOf(role), "SUPER_ADMIN", `${role} must not map to the staff group`);
  });

  section("the decision function is pure");

  await check("P2.13 the same inputs produce the same decision, every time", () => {
    fc.assert(
      fc.property(roleArb, permissionArb, fc.constantFrom("orga", "orgb"), (role, permission, org) => {
        const principal = customerPrincipal(role);
        const resource = { orgId: org };
        const first = inline.can(principal, permission, resource);
        for (let attempt = 0; attempt < 5; attempt++) {
          const again = inline.can(principal, permission, resource);
          assert.deepEqual(again, first, "the decision changed between identical evaluations");
        }
        return true;
      }),
      { numRuns: 800 },
    );
  });

  await check("P2.14 the decision function mutates neither its principal nor its resource", () => {
    fc.assert(
      fc.property(roleArb, permissionArb, (role, permission) => {
        const principal = customerPrincipal(role);
        const resource = { orgId: "orga", ownerUserId: "u2", assignedRoles: ["CLIENT_ADMIN"] };
        const principalBefore = JSON.stringify(principal);
        const resourceBefore = JSON.stringify(resource);
        inline.can(principal, permission, resource);
        assert.equal(JSON.stringify(principal), principalBefore, "the principal was mutated");
        assert.equal(JSON.stringify(resource), resourceBefore, "the resource was mutated");
        return true;
      }),
      { numRuns: 600 },
    );
  });

  await check("P2.15 a role with no grant entry is denied rather than crashing", () => {
    // Totality: `can` must be defined for every input, including a role key that does not exist.
    // Returning a denial is the only safe reading of "I do not know what this role is".
    const decision = inline.can(
      { ...customerPrincipal("ORG_ADMIN"), role: "SOMETHING_INVENTED" },
      "workflow:read",
      { orgId: "orga" },
    );
    assert.equal(decision.allow, false);
    assert.equal(decision.code, "FORBIDDEN");
  });

  section("workflow assignment preserves the engine's rule");

  await check("P2.16 workflow:run honours assignedRoles against the coarse role", () => {
    fc.assert(
      fc.property(
        roleArb,
        fc.subarray(["FRONTLINE", "CLIENT_ADMIN", "SUPER_ADMIN"], { minLength: 1 }),
        (role, assignedRoles) => {
          const principal = customerPrincipal(role);
          const decision = inline.can(principal, "workflow:run", { orgId: "orga", assignedRoles });
          const holdsRun = inline.ROLE_GRANTS[role].has("workflow:run");
          if (!holdsRun) {
            assert.equal(decision.allow, false, `${role} does not hold workflow:run`);
            return true;
          }
          const assigned = assignedRoles.includes(inline.coarseOf(role));
          assert.equal(
            decision.allow,
            assigned,
            `${role} (coarse ${inline.coarseOf(role)}) vs assignedRoles ${assignedRoles.join(",")}`,
          );
          if (!assigned) assert.equal(decision.code, "NOT_ASSIGNED", "and the code says why");
          return true;
        },
      ),
      { numRuns: 1500 },
    );
  });

  section("Q-1 is held at its conservative answer");

  await check("P2.17 WORKFLOW_BUILDER holds edit but not publish", () => {
    // Recorded as an assertion rather than a comment so that resolving Q-1 (task 14.4) has to change
    // a test deliberately, instead of a grant quietly widening and nobody noticing.
    assert.equal(inline.ROLE_GRANTS.WORKFLOW_BUILDER.has("workflow:edit"), true);
    assert.equal(inline.ROLE_GRANTS.WORKFLOW_BUILDER.has("workflow:create"), true);
    assert.equal(
      inline.ROLE_GRANTS.WORKFLOW_BUILDER.has("workflow:publish"),
      false,
      "Q-1 stays conservative: publishing is not a builder capability in this release",
    );
  });

  section("the exposed matrix is the enforced matrix");

  await check("P2.18 GET /permissions/matrix reports exactly what can() decides", () => {
    const exposed = inline.permissionMatrix();
    for (const role of CUSTOMER_ROLES) {
      for (const permission of ALL_PERMISSIONS) {
        const cell = exposed.grants[role][permission];
        const own = { orgId: "orga", ownerUserId: "u1" };
        const other = { orgId: "orga", ownerUserId: "u2" };
        const principal = customerPrincipal(role);
        if (cell === false) {
          assert.equal(
            inline.can(principal, permission, { orgId: "orga" }).allow,
            false,
            `the matrix reports ${role}/${permission} denied but the policy allows it`,
          );
        } else if (cell === "own") {
          assert.equal(inline.can(principal, permission, own).allow, true);
          assert.equal(inline.can(principal, permission, other).allow, false);
        } else {
          assert.equal(
            inline.can(principal, permission, { orgId: "orga" }).allow,
            true,
            `the matrix reports ${role}/${permission} granted but the policy refuses it`,
          );
        }
      }
    }
  });

  done();
})();
