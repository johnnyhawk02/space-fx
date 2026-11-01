#!/bin/bash
# Installs the latest Space FX and Space Drive builds on a Mac, from Terminal:
#   curl -fsSL https://raw.githubusercontent.com/johnnyhawk02/space-fx/main/plugin/install.sh | bash
# Files fetched with curl aren't flagged as "downloaded from the internet", so macOS doesn't
# block the plugins (they're signed ad hoc, not notarised by Apple).
set -euo pipefail
URL="https://github.com/johnnyhawk02/space-fx/releases/download/plugin-latest/Space-FX-macOS.zip"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "Downloading Space FX and Space Drive..."
curl -fsSL "$URL" -o "$tmp/space-fx.zip"
ditto -x -k "$tmp/space-fx.zip" "$tmp"
for name in "Space FX" "Space Drive"; do
  for kind in VST3 CLAP; do
    ext=$(echo "$kind" | tr '[:upper:]' '[:lower:]')
    [ -e "$tmp/Space FX/$name.$ext" ] || continue
    dest="$HOME/Library/Audio/Plug-Ins/$kind"
    mkdir -p "$dest"
    rm -rf "$dest/$name.$ext"
    cp -R "$tmp/Space FX/$name.$ext" "$dest/"
    xattr -dr com.apple.quarantine "$dest/$name.$ext" 2>/dev/null || true
    echo "Installed $dest/$name.$ext"
  done
done
echo "Done. Rescan plugins in your DAW (or restart it)."
