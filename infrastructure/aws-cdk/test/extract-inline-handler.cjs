// amazflow-dev.yaml carries the production control plane as inline Lambda source, so the only
// way to test what is actually deployed is to read it back out of the template. This lifts the
// ZipFile literal block verbatim (dedented, nothing rewritten) into a requireable module, so the
// tests next to it exercise the same characters CloudFormation ships.
const fs = require("fs");
const path = require("path");

const templatePath = path.join(__dirname, "..", "amazflow-dev.yaml");
const INDENT = "          "; // the ZipFile block's own indent inside the template

function extract() {
  const lines = fs.readFileSync(templatePath, "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === "ZipFile: |");
  if (start === -1) throw new Error("No inline ZipFile block found in amazflow-dev.yaml");
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") { body.push(""); continue; }
    if (!line.startsWith(INDENT)) break;
    body.push(line.slice(INDENT.length));
  }
  return body.join("\n");
}

function writeTo(outPath) {
  fs.writeFileSync(outPath, extract(), "utf8");
  return outPath;
}

module.exports = { extract, writeTo, templatePath };

if (require.main === module) process.stdout.write(extract());
