const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "intercom.tsx"), "utf8");

assert.match(source, /if \(!user_hash\) \{/);
assert.match(source, /if \(typeof window\.Intercom === "function"\) shutdown\(\);/);
assert.match(source, /Intercom\(\{ app_id: INTERCOM_APP_ID \}\);/);
assert.match(source, /user_hash,/);
assert.doesNotMatch(source, /\.\.\.\(user_hash \? \{ user_hash \} : \{\}\)/);

console.log("INTERCOM SECURITY: authenticated identity is not booted without a server hash");
