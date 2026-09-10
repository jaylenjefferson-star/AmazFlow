#!/usr/bin/env bash
# Packages the macOS desktop agent as a signed, installable DMG.
#
# Why this exists rather than a plain `electron-builder --mac dmg`: on Apple silicon every
# executable must carry a valid signature. electron-builder renames Electron's binaries and
# helpers into our product name, which invalidates the signature Electron shipped with, and if
# signing is then skipped the result is a bundle whose signature says it has sealed resources
# while having none. macOS reports that as "'AmazFlow Agent' is damaged and can't be opened" --
# a hard refusal that right-click > Open cannot bypass, and which looks like a corrupt download.
#
# Ad-hoc signing (-) needs no Apple certificate and fixes exactly that: the bundle becomes valid,
# so Gatekeeper falls back to the ordinary unidentified-developer prompt that right-click > Open
# clears. It is not a substitute for notarization; ship a Developer ID build for real distribution.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
APP_DIR="release/mac-arm64"
APP="$APP_DIR/AmazFlow Agent.app"
DMG="release/AmazFlow-Agent-${VERSION}-arm64.dmg"
STAGE="release/dmg-stage"

echo "==> Building TypeScript"
pnpm build

echo "==> Packaging app bundle"
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac dir --arm64

echo "==> Ad-hoc signing, inside out"
# Nested Mach-O has to be valid before the outer bundle is sealed over it.
while IFS= read -r -d '' item; do
  codesign --force --sign - --timestamp=none "$item"
done < <(find "$APP/Contents/Frameworks" -maxdepth 1 -type d \( -name "*.framework" -o -name "*.app" \) -print0)
while IFS= read -r -d '' item; do
  codesign --force --sign - --timestamp=none "$item"
done < <(find "$APP/Contents/Frameworks" -type f \( -name "*.dylib" -o -name "*.node" \) -print0)
codesign --force --deep --sign - --timestamp=none "$APP"

echo "==> Verifying signature"
codesign --verify --deep --strict "$APP"
codesign -dv --verbose=2 "$APP" 2>&1 | grep -E "Identifier=|Sealed Resources"

echo "==> Building DMG"
rm -rf "$STAGE" && mkdir -p "$STAGE"
# ditto, not cp -R: it preserves the extended attributes the signature seals over.
ditto "$APP" "$STAGE/AmazFlow Agent.app"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "AmazFlow Agent" -srcfolder "$STAGE" -ov -format UDZO -quiet "$DMG"
rm -rf "$STAGE"

echo "==> Done: $DMG"
ls -lh "$DMG" | awk '{print $5, $9}'
