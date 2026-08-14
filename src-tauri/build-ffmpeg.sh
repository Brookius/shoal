#!/usr/bin/env bash
# Build a self-contained, LGPL ffmpeg sidecar from official source.
#
# Why from source: a Homebrew ffmpeg is GPL (it bundles libx264/libx265), which
# is incompatible with the Mac App Store and carries source-offer obligations.
# This builds ffmpeg WITHOUT the GPL encoders and uses Apple's VideoToolbox for
# H.264 instead — the result is LGPL, App-Store-clean, and (being static) a
# single portable file with no dylibs to bundle.
#
# Output (git-ignored, regenerated on demand):
#   src-tauri/binaries/ffmpeg-aarch64-apple-darwin
#
# Runs in Tauri's beforeBuildCommand. It's a no-op when the binary already
# exists, so normal `cargo tauri build`s stay fast — delete the binary (or run
# with FORCE=1) to rebuild, e.g. for a new ffmpeg version.
set -euo pipefail

VERSION="8.1.1"
# SHA-256 of ffmpeg-8.1.1.tar.xz — cross-verified against Homebrew's pinned
# checksum for the same upstream release (2026-06).
SHA256="b6863adde98898f42602017462871b5f6333e65aec803fdd7a6308639c52edf3"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/src-tauri/binaries/ffmpeg-aarch64-apple-darwin"

if [ -f "$BIN" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "ffmpeg sidecar already present ($BIN) — skipping build (FORCE=1 to rebuild)."
  exit 0
fi

WORK="$ROOT/src-tauri/.ffmpeg-build"
TARBALL="ffmpeg-$VERSION.tar.xz"
mkdir -p "$WORK"; cd "$WORK"

if [ ! -f "$TARBALL" ]; then
  echo "downloading $TARBALL …"
  curl -fsSL -o "$TARBALL" "https://ffmpeg.org/releases/$TARBALL"
fi

echo "verifying checksum …"
GOT="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
if [ "$GOT" != "$SHA256" ]; then
  echo "ERROR: checksum mismatch for $TARBALL"
  echo "  expected $SHA256"
  echo "  got      $GOT"
  exit 1
fi

rm -rf "ffmpeg-$VERSION"
tar xf "$TARBALL"
cd "ffmpeg-$VERSION"

# LGPL only: no --enable-gpl, no --enable-libx264/x265. VideoToolbox provides
# H.264 (h264_videotoolbox); the native LGPL aac encoder handles audio. Static
# in-tree libs → the binary links only system frameworks (fully portable).
echo "configuring (LGPL, VideoToolbox) …"
./configure \
  --disable-gpl --disable-nonfree \
  --disable-doc --disable-debug --disable-ffplay \
  --enable-videotoolbox --enable-audiotoolbox >/dev/null

echo "compiling …"
make -j"$(sysctl -n hw.ncpu)" ffmpeg >/dev/null

# Sanity: refuse to ship anything that isn't LGPL-clean.
if ./ffmpeg -hide_banner -version | grep -q -- "--enable-gpl"; then
  echo "ERROR: built ffmpeg reports --enable-gpl — aborting"; exit 1
fi

mkdir -p "$ROOT/src-tauri/binaries"
rm -f "$BIN"
cp ffmpeg "$BIN"
chmod 755 "$BIN"
codesign -f -s - "$BIN" >/dev/null 2>&1 || true   # ad-hoc sign for Gatekeeper

echo "✓ LGPL ffmpeg $VERSION built → $BIN"
otool -L "$BIN" | tail -n +2 | grep -v "/usr/lib/\|/System/" >/dev/null \
  && echo "WARNING: non-system dylib deps present (not fully portable)" \
  || echo "✓ portable: only system frameworks linked"
