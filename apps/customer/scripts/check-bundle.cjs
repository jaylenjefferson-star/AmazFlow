#!/usr/bin/env node
// Task 26.13 / requirement 34.17: fail the build if the customer application bundle contains a
// forbidden vendor or model identifier string, or a hardcoded secret.
//
// This runs as a postbuild step (see package.json) against the static export in `out/` -- the exact
// bytes a customer's browser downloads. Grepping source is not equivalent: a string can be built
// entirely from source-level pieces that individually look innocuous (a concatenated ARN, a label
// assembled at import time) and still land whole in the shipped bundle. Only the built output is the
// thing this requirement is actually about.
//
// requirement 17's rule is that the customer surface speaks only in AmazFlow's own vocabulary --
// "AmazFlow managed AI", never the vendor, harness, or model behind it (packages/domain-ui/src/terms.ts
// is the translation boundary that is supposed to guarantee this). These patterns are the leaks that
// rule is meant to prevent.
const fs = require("node:fs");
const path = require("node:path");

const outDir = path.join(__dirname, "..", "out");

const FORBIDDEN_STRINGS = [
  { name: "AWS Bedrock", pattern: /bedrock/i },
  { name: "Anthropic", pattern: /anthropic/i },
  { name: "Claude (model vendor)", pattern: /\bclaude\b/i },
  { name: "AgentCore (execution harness)", pattern: /agentcore/i },
  { name: "Bedrock AgentCore harness ARN", pattern: /arn:aws:bedrock-agentcore:/i },
];

const SECRET_PATTERNS = [
  { name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "PEM private key header", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  // A bearer-style vendor API key, distinct from the Cognito bearer JWT this app legitimately holds
  // (a JWT is three dot-separated base64url segments, never this literal prefix).
  { name: "vendor API key prefix", pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(js|html|json|css|txt|map)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function main() {
  if (!fs.existsSync(outDir)) {
    console.error(`check-bundle: ${outDir} does not exist. Run "next build" first.`);
    process.exit(1);
  }

  const files = walk(outDir);
  const findings = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const relative = path.relative(outDir, file);
    for (const { name, pattern } of [...FORBIDDEN_STRINGS, ...SECRET_PATTERNS]) {
      const match = content.match(pattern);
      if (match) findings.push({ file: relative, name, match: match[0] });
    }
  }

  if (findings.length) {
    console.error(`check-bundle: the customer bundle contains ${findings.length} forbidden string(s):\n`);
    for (const finding of findings) console.error(`  ${finding.file}: ${finding.name} ("${finding.match}")`);
    console.error(
      "\nThe customer surface must speak only in AmazFlow's own vocabulary (packages/domain-ui/src/terms.ts) " +
        "and must never carry a hardcoded secret. Remove the leak, or verify the match is a false positive " +
        "(e.g. inside a code comment that never reaches production) before adjusting this check.",
    );
    process.exit(1);
  }

  console.log(`check-bundle: scanned ${files.length} files in out/, no forbidden vendor string or hardcoded secret found.`);
}

main();
