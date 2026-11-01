#!/bin/bash
# Installs the latest Space FX build on a Mac, from Terminal:
#   curl -fsSL https://raw.githubusercontent.com/johnnyhawk02/space-fx/main/plugin/install.sh | bash
# Files fetched with curl aren't flagged as "downloaded from the internet", so macOS doesn't
# block the plugin (it's signed ad hoc, not notarised by Apple).
set -euo pipefail
URL="https://github.com/johnnyhawk02/space-fx/releases/download/plugin-latest/Space-FX-macOS.zip"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "Downloading Space FX..."
curl -fsSL "$URL" -o "$tmp/space-fx.zip"
ditto -x -k "$tmp/space-fx.zip" "$tmp"
for kind in VST3 CLAP; do
  ext=$(echo "$kind" | tr '[:upper:]' '[:lower:]')
  dest="$HOME/Library/Audio/Plug-Ins/$kind"
  mkdir -p "$dest"
  rm -rf "$dest/Space FX.$ext"
  cp -R "$tmp/Space FX/Space FX.$ext" "$dest/"
  xattr -dr com.apple.quarantine "$dest/Space FX.$ext" 2>/dev/null || true
  echo "Installed $dest/Space FX.$ext"
done
echo "Done. Rescan plugins in your DAW (or restart it)."
