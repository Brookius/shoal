#!/bin/bash
# make-proxies — Dive Log proxy generator
#
# Creates small review proxies (1080p H.264) of every video in the current
# folder, writing them to a sibling ./proxies/ folder.
#
# RE-ENCODE ONLY — LOAD-BEARING INVARIANT: the timeline is never trimmed or
# re-timed, so a timestamp tagged on a proxy is frame-valid on the original
# master. Any change to the ffmpeg command must preserve this.
#
# Requires ffmpeg:  brew install ffmpeg   (macOS)
#
# Usage (recommended — avoids macOS Gatekeeper entirely):
#   cd /path/to/your/trip/folder
#   curl -fsSL https://dive-log-55i.pages.dev/make-proxies.command | bash
#
# (Also runs as a plain file: bash make-proxies.command — operates on the
#  folder the file sits in.)

# Run against the script's own folder when executed as a file;
# when piped via curl | bash, run against the current directory.
case "$0" in
  *make-proxies*) cd "$(dirname "$0")" || exit 1 ;;
esac

# Locate ffmpeg — Homebrew paths first (Finder-launched shells miss the
# .zprofile PATH, so /opt/homebrew/bin is invisible there), then PATH.
FFMPEG=""
for p in /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg; do
  [ -x "$p" ] && FFMPEG="$p" && break
done
[ -n "$FFMPEG" ] || FFMPEG="$(command -v ffmpeg || true)"
[ -n "$FFMPEG" ] || {
  echo "ffmpeg not found — install it with: brew install ffmpeg"
  [ -t 0 ] && read -r -p "Press Enter to close"
  exit 1
}

echo "Using ffmpeg: $FFMPEG"
echo "Making proxies in: $(pwd)"
mkdir -p proxies
shopt -s nullglob nocaseglob
count=0
for f in *.mp4 *.mov *.m4v *.avi *.mkv; do
  out="proxies/${f%.*}.mp4"
  if [ -e "$out" ]; then echo "skip (already done): $f"; continue; fi
  echo "→ $f"
  "$FFMPEG" -nostdin -hide_banner -loglevel warning -stats -i "$f" \
    -vf "scale=-2:1080" -c:v libx264 -preset fast -crf 26 \
    -c:a aac -b:a 96k -movflags +faststart "$out" && count=$((count+1))
done
echo
echo "Done — $count proxies written to: $(pwd)/proxies"
[ -t 0 ] && read -r -p "Press Enter to close"
exit 0
