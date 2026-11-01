#!/bin/bash
# Installs Space FX for every DAW on this Mac: copies the VST3 and CLAP next to this script into
# ~/Library/Audio/Plug-Ins, and clears the "downloaded from the internet" flag, since the plugin
# isn't notarised by Apple. Double-click it, or run it from Terminal.
set -e
cd "$(dirname "$0")"
for kind in VST3 CLAP; do
  ext=$(echo "$kind" | tr '[:upper:]' '[:lower:]')
  dest="$HOME/Library/Audio/Plug-Ins/$kind"
  mkdir -p "$dest"
  rm -rf "$dest/Space FX.$ext"
  cp -R "Space FX.$ext" "$dest/"
  xattr -dr com.apple.quarantine "$dest/Space FX.$ext" 2>/dev/null || true
  echo "Installed $dest/Space FX.$ext"
done
echo "Done. Rescan plugins in your DAW."
