"use client";

import { useState } from "react";

// Internal QA harness only -- not a marketing page, not linked from nav. Gives the browser
// agent a real DOM to act on (matching the [data-amazflow] selectors the sample workflow and
// content.ts expect) so the full browser-control loop, including the target-identity check, can
// be exercised end to end against something real instead of asserted from code alone.
const EMPLOYEES = [
  { id: "E-10042", name: "Sarah Chen" },
  { id: "E-20099", name: "Alex Kim" },
];

export default function AgentTestHarness() {
  const [selected, setSelected] = useState(EMPLOYEES[0].id);
  // Deliberately uncontrolled: the whole point is that the extension's own script (not React)
  // sets this field's value directly, the same way it would on a real third-party page AmazFlow
  // doesn't own. A controlled input would just fight that write back to whatever React thinks
  // the value should be.
  const statusKey = `status-${selected}`;

  return (
    <main style={{ maxWidth: 480, margin: "60px auto", padding: 24, fontFamily: "system-ui" }}>
      <p style={{ fontSize: 11, letterSpacing: ".08em", color: "#888", textTransform: "uppercase" }}>
        AmazFlow QA harness -- not a real customer system
      </p>
      <h1 style={{ fontSize: 22 }}>Employee record</h1>
      <label style={{ display: "block", marginTop: 16, fontSize: 13, fontWeight: 700 }}>
        Currently viewing
        <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ display: "block", marginTop: 6, padding: 8, width: "100%" }}>
          {EMPLOYEES.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} ({e.id})
            </option>
          ))}
        </select>
      </label>
      <div style={{ marginTop: 20, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
        <div>
          <b>Employee ID:</b> <span data-amazflow="employee-id">{selected}</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <b>Name:</b> {EMPLOYEES.find((e) => e.id === selected)?.name}
        </div>
        <div style={{ marginTop: 8 }}>
          <b>Access status:</b>{" "}
          <input key={statusKey} data-amazflow="employee-status" defaultValue="ENABLED" style={{ fontWeight: 800, border: "1px solid #ccc", padding: "4px 8px" }} />
        </div>
      </div>
      <p style={{ marginTop: 20, fontSize: 12, color: "#888" }}>
        Switch the employee above, then run a workflow addressed to a different employee id to see the
        agent&apos;s target-identity check refuse to act rather than silently editing the wrong record.
      </p>
    </main>
  );
}
