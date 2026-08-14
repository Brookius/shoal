#!/usr/bin/env bash
# Build a release .dmg for Shoal (macOS arm64).
# Run from repo root: bash src-tauri/release.sh
#
# Prerequisites: rustup, cargo-tauri CLI, create-dmg (brew install create-dmg)
#
# cargo tauri build compiles the app and bundles the .app correctly, but its
# built-in dmg step uses an AppleScript to prettify the Finder window and that
# requires a GUI session permission not available in the terminal. We skip that
# step and call create-dmg ourselves with --skip-jenkins.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
VERSION="$(grep '"version"' "$SCRIPT_DIR/tauri.conf.json" | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')"
DMG_NAME="Shoal_${VERSION}_aarch64.dmg"
APP_DIR="$SCRIPT_DIR/target/release/bundle/macos"
DMG_DIR="$SCRIPT_DIR/target/release/bundle/dmg"

cd "$REPO_ROOT"

echo "==> Preparing web assets…"
bash src-tauri/prepare-web.sh

echo "==> Building Rust release binary…"
~/.cargo/bin/cargo build --manifest-path src-tauri/Cargo.toml --release

echo "==> Bundling .app…"
~/.cargo/bin/cargo tauri build --no-bundle 2>/dev/null || true
# Manually run the bundler for the .app only
~/.cargo/bin/cargo tauri bundle --bundles app 2>&1 | grep -E 'Info|Error|Compiling|Finished' || true

# If cargo tauri bundle --bundles app isn't supported, fall back to full build
# and ignore the dmg failure
if [ ! -d "$APP_DIR/Shoal.app" ]; then
  echo "==> Falling back to full tauri build (dmg step will fail — that is expected)…"
  ~/.cargo/bin/cargo tauri build 2>&1 | grep -v "bundle_dmg.sh" || true
fi

# Hard gate. Every bundling step above ends in `|| true` or a pipe into grep,
# both of which discard the real exit status — deliberately, because the dmg
# sub-step is EXPECTED to fail (see the header). The cost is that a genuine
# build failure sails straight through and the script "succeeds" having
# produced nothing. This happened for real after the repo folder was renamed:
# Cargo caches absolute paths, 154 stale ones pointed at the old directory,
# the build failed, and release.sh still exited 0. Check for the artefact
# itself rather than trusting an exit code that was thrown away.
if [ ! -d "$APP_DIR/Shoal.app" ]; then
  echo ""
  echo "✗ Build failed — no Shoal.app was produced."
  echo "  Scroll up for the real cargo error."
  echo "  If it names a path that isn't this directory ($REPO_ROOT),"
  echo "  the build cache is stale: run"
  echo "      ~/.cargo/bin/cargo clean --manifest-path src-tauri/Cargo.toml"
  echo "  and re-run this script (expect a slow first rebuild)."
  exit 1
fi

echo "==> Creating .dmg…"
mkdir -p "$DMG_DIR"
rm -f "$DMG_DIR/$DMG_NAME"
# Clean any leftover temp files from failed previous runs
rm -f "$APP_DIR"/rw.*.dmg 2>/dev/null || true

create-dmg \
  --volname "Shoal" \
  --window-pos 200 120 \
  --window-size 600 400 \
  --icon-size 128 \
  --icon "Shoal.app" 175 190 \
  --app-drop-link 425 190 \
  --skip-jenkins \
  "$DMG_DIR/$DMG_NAME" \
  "$APP_DIR/"

if [ ! -f "$DMG_DIR/$DMG_NAME" ]; then
  echo ""
  echo "✗ create-dmg produced no $DMG_NAME — see its output above."
  exit 1
fi

echo ""
echo "✓ Done: $DMG_DIR/$DMG_NAME"

echo "==> Publishing to landing/downloads…"
# Feeds two things at once: the landing page's Mac download link, and the
# desktop app's own update check (js/app.js → checkForAppUpdate(), compares
# its running version against this latest.json). Both read from the same
# VERSION this script already derived from tauri.conf.json, so there's one
# place — that version field — that makes a build "the latest release".
DOWNLOADS_DIR="$REPO_ROOT/landing/downloads"
mkdir -p "$DOWNLOADS_DIR"
cp "$DMG_DIR/$DMG_NAME" "$DOWNLOADS_DIR/Shoal.dmg"

# Cloudflare Pages caps a single deployed asset at 25 MiB (confirmed against
# Cloudflare's own docs, 2026-08-12) — a silent over-limit file would 404 on
# the live site with no local sign anything was wrong. Warn, don't block:
# Luke may still want the local build, and the fix if this ever fires is
# Cloudflare R2 (their own documented recommendation for oversized assets),
# not something this script should decide on its own.
DMG_BYTES=$(stat -f%z "$DOWNLOADS_DIR/Shoal.dmg" 2>/dev/null || stat -c%s "$DOWNLOADS_DIR/Shoal.dmg")
DMG_LIMIT=$((25 * 1024 * 1024))
if [ "$DMG_BYTES" -gt "$DMG_LIMIT" ]; then
  echo ""
  echo "⚠️  Shoal.dmg is $(( DMG_BYTES / 1024 / 1024 ))MiB — over Cloudflare Pages'"
  echo "   25MiB per-asset limit. It will 404 once deployed. Consider Cloudflare R2"
  echo "   for this file instead (see https://developers.cloudflare.com/pages/platform/limits/)."
fi
cat > "$DOWNLOADS_DIR/latest.json" <<EOF
{
  "version": "$VERSION",
  "url": "https://diveshoal.com/downloads/Shoal.dmg"
}
EOF

echo ""
echo "✓ Published: $DOWNLOADS_DIR/Shoal.dmg (v$VERSION)"
echo "  Commit + push landing/downloads/ to publish this as the live download —"
echo "  until that push, the site still serves whatever was published last."
