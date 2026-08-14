#!/usr/bin/env bash
# Copies web assets to webdist/ for cargo tauri build.
# Runs from repo root (Tauri's CWD for beforeBuildCommand).
set -euo pipefail
DEST="webdist"
rm -rf "$DEST"
mkdir -p "$DEST"
for dir in css js data vendor fonts; do
  [ -d "$dir" ] && cp -r "$dir" "$DEST/"
done
for file in index.html manifest.json sw.js robots.txt _headers LICENSE.md THIRD-PARTY-NOTICES.txt favicon-32.png favicon-192.png favicon-512.png apple-touch-icon.png; do
  [ -f "$file" ] && cp "$file" "$DEST/"
done
