// Asserts the shipped build's product contract, against dist/ rather than src/, because dist is
// what Chrome actually loads. These are the properties that kept regressing: the agent used to
// depend on an AmazFlow page staying open to finish connecting, and on a per-site "Enable on this
// site" toggle before it could act. Both are gone, and this fails if either returns.
//
// Run `pnpm --filter @amazflow/browser-agent build` first.
const fs = require("fs");
const path = require("path");
const assert = require("node:assert");

const dist = path.join(__dirname, "..", "dist");
if (!fs.existsSync(path.join(dist, "service-worker.js"))) {
  console.error("dist/ is missing — run `pnpm --filter @amazflow/browser-agent build` first.");
  process.exit(1);
}
const read = (f) => fs.readFileSync(path.join(dist, f), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const sw = read("service-worker.js");
const popup = read("popup.js");
const html = read("popup.html");
const auth = read("auth.js");

// Storage writes are the only way anything leaves memory, so this is the exact question worth
// asking about the password: does any persisted value carry it?
const storageWrites = [...sw.matchAll(/(?:chrome\.storage\.local\.set|(?<![A-Za-z0-9_])set)\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);

const checks = [
  ["the extension is a self-contained app, not a page companion", !sw.includes("agent-authorize") && !popup.includes("agent-authorize")],
  // pendingConnectTabId may still be *named* -- migrateLegacyState deletes it -- but nothing may
  // listen for a tab to hand a credential back.
  ["no tab-watching handshake to finish connecting", !sw.includes("onHistoryStateUpdated") && !sw.includes("webNavigation") && !sw.includes("tabs.onUpdated") && !sw.replace(/const LEGACY_KEYS[\s\S]*?\];/, "").includes("pendingConnectTabId")],
  ["no credential is ever read out of a URL", !sw.includes("searchParams.get")],
  ["host access comes from the manifest, once", JSON.stringify(manifest.host_permissions) === JSON.stringify(["<all_urls>"])],
  ["no optional host permissions to prompt per site", !manifest.optional_host_permissions],
  ["nothing requests a permission at runtime", !sw.includes("permissions.request") && !popup.includes("permissions.request")],
  ["no per-site gate before acting", !sw.includes("hasHostPermission") && !sw.includes("permissions.contains")],
  ["no 'Enable on this site' affordance survives in the UI", !/enable on this site/i.test(html) && !/enableSite/.test(popup)],
  ["the extension owns sign-in against the identity provider", auth.includes("InitiateAuth") && auth.includes("USER_PASSWORD_AUTH")],
  ["the session refreshes rather than forcing re-login", auth.includes("REFRESH_TOKEN_AUTH")],
  ["the password is never persisted", storageWrites.every((w) => !/password/i.test(w))],
  ["the service worker owns polling and claiming, not the popup", sw.includes("amazflow-poll") && sw.includes("/claim") && !popup.includes("/claim")],
  ["the execution grant is presented on the terminal result", sw.includes("X-AmazFlow-Execution-Grant")],
  ["evidence is recorded through the grant-authorized tool", sw.includes("record-step-result")],
  ["the agent only performs allowlisted operations", sw.includes("ALLOWED_OPS")],
  ["one browser keeps one agent record", sw.includes("installationId")],
  ["incompatible older state is cleared exactly once", sw.includes("schemaVersion") && sw.includes("LEGACY_KEYS")],
  ["the extension id is pinned so reloads keep one identity", typeof manifest.key === "string" && manifest.key.length > 300],
];

let fail = 0;
console.log("\nEXTENSION PRODUCT CONTRACT\n");
for (const [name, ok] of checks) {
  if (!ok) fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
}
console.log(`\n${checks.length - fail} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} extension contract check(s) failed`);
