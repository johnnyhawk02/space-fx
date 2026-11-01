#!/bin/bash
# Installs Space FX and Space Drive for every DAW on this Mac: copies the VST3s and CLAPs next to
# this script into ~/Library/Audio/Plug-Ins, and clears the "downloaded from the internet" flag,
# since the plugins aren't notarised by Apple. Double-click it, or run it from Terminal.
set -e
cd "$(dirname "$0")"
for name in "Space FX" "Space Drive"; do
  for kind in VST3 CLAP; do
    ext=$(echo "$kind" | tr '[:upper:]' '[:lower:]')
    [ -e "$name.$ext" ] || continue
    dest="$HOME/Library/Audio/Plug-Ins/$kind"
    mkdir -p "$dest"
    rm -rf "$dest/$name.$ext"
    cp -R "$name.$ext" "$dest/"
    xattr -dr com.apple.quarantine "$dest/$name.$ext" 2>/dev/null || true
    echo "Installed $dest/$name.$ext"
  done
done
echo "Done. Rescan plugins in your DAW."
