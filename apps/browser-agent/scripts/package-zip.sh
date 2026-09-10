#!/usr/bin/env bash
#
# Rewrite the extension zip the web app serves from /downloads.
#
# The extension reaches customers as a committed build product, so a source change that does not
# rebuild this zip ships nothing -- the download keeps serving the previous build. That has
# already happened once. `pnpm --filter @amazflow/browser-agent release` runs the build and the
# contract test before this, and CI diffs the committed zip against a fresh build, so the two
# cannot drift silently again.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd "$HERE/.." && pwd)"
DIST="$EXT_DIR/dist"
OUT="$(cd "$EXT_DIR/../.." && pwd)/apps/web/public/downloads/amazflow-agent.zip"

[[ -d "$DIST" ]] || { echo "dist/ is missing -- run the build first." >&2; exit 1; }
[[ -f "$DIST/manifest.json" ]] || { echo "dist/manifest.json is missing." >&2; exit 1; }
[[ -f "$DIST/service-worker.js" ]] || { echo "dist/service-worker.js is missing." >&2; exit 1; }

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

# Pin every entry to a fixed timestamp before archiving. Build mtimes otherwise change on every
# run, so an unchanged extension would produce a different zip each time and show up as a
# spurious binary diff in review -- which is exactly the noise that lets a genuinely stale zip
# slip through unnoticed.
find "$DIST" -exec touch -t 202001010000.00 {} +

# Contents at the archive root so "Load unpacked" works on the extracted folder directly.
# -X drops platform extra-fields, which are another source of non-determinism.
( cd "$DIST" && find . -type f -not -name '.*' | LC_ALL=C sort | zip -qXD -@ "$OUT" )

echo "Wrote $OUT"
unzip -l "$OUT" | tail -n +4 | head -n -2 | awk '{ printf "  %s\n", $4 }'
