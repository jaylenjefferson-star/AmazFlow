// Asserts the desktop agent's security shape against the built output. The whole risk of a native
// agent is scope creep in what it can be made to do, so these are the properties that must hold no
// matter how the executor grows.
const fs = require("fs");
const path = require("path");
const assert = require("node:assert");

const dist = path.join(__dirname, "..", "dist");
if (!fs.existsSync(path.join(dist, "executor.js"))) {
  console.error("dist/ is missing — run `pnpm --filter @amazflow/desktop-agent build` first.");
  process.exit(1);
}
const read = (f) => fs.readFileSync(path.join(dist, f), "utf8");
// Comments explain the very attacks these checks look for, so scanning them produces confident
// nonsense. Every pattern below runs against code with comments removed.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/.*$/gm, "$1");
const executor = stripComments(read("executor.js"));
const agent = stripComments(read("agent.js"));
const main = stripComments(read("main.js"));

// The AppleScript sources themselves -- the only strings where an interpolated step value would
// actually be dangerous. Error messages and log lines are not script text.
const scriptLiterals = [...executor.matchAll(/osa\(\s*(`[\s\S]*?`|'[^']*'|"[^"]*")/g)].map((m) => m[1]);
const { DESKTOP_ACTIONS, assertDestination } = require(path.join(dist, "executor.js"));

const checks = [
  ["the action set is exactly the approved eight", DESKTOP_ACTIONS.length === 8 && DESKTOP_ACTIONS.every((a) => a.startsWith("desktop."))],
  ["there is no shell or arbitrary code execution", !/\bexec\(|execSync|spawn\(|do shell script|osascript -e "\$/.test(executor)],
  ["only osascript, open and screencapture are ever invoked", ["osascript", "open", "screencapture"].every((b) => executor.includes(`"${b}"`)) && (executor.match(/run\("([a-z]+)"/g) ?? []).every((m) => /osascript|open|screencapture/.test(m))],
  // Only ${using} may appear in script text, and it is built from an allowlist of four modifier
  // names -- every step-supplied value reaches AppleScript through argv instead.
  ["step values are passed as argv, never interpolated into script text",
    executor.includes("item 1 of argv") &&
    scriptLiterals.length > 0 &&
    scriptLiterals.every((lit) => (lit.match(/\$\{[^}]*\}/g) ?? []).every((x) => x === "${using}"))],
  ["the grant's destination is enforced before acting", agent.includes("assertDestination") && executor.includes("only authorizes")],
  ["a task for the other surface is refused", agent.includes('executionTarget !== "desktop_agent"')],
  ["evidence capture is limited to the target window", executor.includes("AXWindowNumber") && !executor.includes('"-R", "0,0,99999')],
  ["screen capture is skipped unless permitted", executor.includes("captureAllowed") && executor.includes("SCREEN_RECORDING_DENIED")],
  ["credentials are stored through the OS keychain", main.includes("safeStorage") && main.includes("encryptString")],
  // The password is a parameter forwarded straight to the agent; what matters is that it never
  // reaches the encrypted state file.
  ["the password is never written to disk",
    !/password/i.test(main.slice(main.indexOf("const store"), main.indexOf("const publish"))) &&
    !/write\([^)]*password/i.test(main)],
  ["polling survives the window being closed", main.includes("window-all-closed") && main.includes("preventDefault")],
  ["the renderer gets no Node access", main.includes("contextIsolation: true") && main.includes("nodeIntegration: false")],
  ["the agent advertises its type and capabilities", agent.includes('agentType: "DESKTOP_AGENT"') && agent.includes("capabilities")],
  ["the execution grant is presented on the terminal result", agent.includes("X-AmazFlow-Execution-Grant")],
];

// assertDestination is the guard that keeps a step from redirecting the agent to another app.
let refused = false;
try { assertDestination("desktop.open_app", { app: "Terminal" }, "TextEdit"); } catch { refused = true; }
checks.push(["a step naming a different app than the grant is refused", refused]);
let allowed = true;
try { assertDestination("desktop.open_app", { app: "TextEdit" }, "TextEdit"); } catch { allowed = false; }
checks.push(["a step matching the grant's destination is allowed", allowed]);


// The customer-facing vocabulary rule. A person starting a workflow should never have to learn
// that a pending-agent task, a lease, an execution grant or record_step_result exists -- those are
// how the control plane coordinates work, not what the work is. The mechanism stays in the worker
// or agent process; the UI shows the workflow, the step, and what happened.
const MECHANISM = /\b(lease|execution grant|grantId|claimed|claiming|pending[- ]agent|agent task|record[_ -]step[_ -]result|taskId|runId|stepId)\b/i;
function mechanismLeaks(source) {
  // Only strings a person can actually read.
  const literals = [...source.matchAll(/`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g)].map((m) => m[0]);
  return literals.filter((lit) => MECHANISM.test(lit) && !lit.includes("AMAZFLOW_") && !lit.startsWith('"agent:'));
}

const renderer = stripComments(read("renderer.js")) + read(path.join("renderer", "index.html"));
const rendererLeaks = mechanismLeaks(renderer);
checks.push(["the app window never shows leases, grants, claims or task ids", rendererLeaks.length === 0 || (console.log("        leaked:", rendererLeaks.slice(0, 4).join(" | ")), false)]);
checks.push(["a person can start a workflow from the app", renderer.includes("loadWorkflows") && agent.includes("startWorkflow")]);
checks.push(["a blocked start says which app to open", /Install the |Open the /.test(agent)]);

let fail = 0;
console.log("\nDESKTOP AGENT CONTRACT\n");
for (const [name, ok] of checks) {
  if (!ok) fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
}
console.log(`\n${checks.length - fail} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} desktop agent contract check(s) failed`);
