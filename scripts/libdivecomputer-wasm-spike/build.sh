#!/usr/bin/env bash
# Step 1b spike (BRIEF-dive-computer-sync.md §13): does libdivecomputer's
# blocking dc_custom_open() I/O survive compiling to WASM, and can its
# callbacks suspend on real JS promises via JSPI (the thing the whole
# Option B / browser-only architecture bet hinges on)? Answer, confirmed
# 2026-07-13: yes. Kept as a reusable regression check, not shipped code —
# the real vendor/libdivecomputer-wasm/ build comes later, once the actual
# BLE transport + parser-export surface is designed.
#
# Requires: emscripten (`brew install emscripten`).
#
# SUSPENSION MECHANISM: -sASYNCIFY, not -sJSPI (changed 2026-07-22).
# JSPI is the faster, smaller mechanism and is what the original spike
# proved — but it is CHROMIUM-ONLY: WebKit only shipped it in Safari 27
# beta (WWDC26, June 2026), so no currently-released WKWebView has it.
# WKWebView is exactly what the Tauri desktop shell renders in, so a JSPI
# build cannot run BLE sync in the shell at all (and could never run on
# iOS). Asyncify is engine-agnostic — it does the stack unwinding in the
# generated code rather than asking the host for it — so ONE build now
# serves browser, desktop shell, and a future iOS shell. Costs: ~1.7x
# binary size (368KB → 615KB) and interpreter overhead that is irrelevant
# here, since a real sync is bounded by ~60ms-per-packet BLE pacing, not
# by CPU. See DECISIONS.md → "Asyncify over JSPI".
#
# -sEXIT_RUNTIME=1 is load-bearing, not incidental: under JSPI the factory
# promise itself resolved when main() finished, so callers could just
# `await factory(...)`. Under Asyncify it resolves as soon as main()
# SUSPENDS — the engine keeps running afterwards — so a caller that awaits
# only the factory sees zero dives and a program still mid-download.
# EXIT_RUNTIME makes emscripten call Module.onExit(code) when main()
# genuinely returns; callers await THAT. (Module.onAbort covers the trap
# case, which JSPI used to surface as a factory rejection.)
#
# Requires (to RUN the compiled output, e.g. run-download-test.mjs): any
# Node that can load an ES module — v22 is fine. The previous JSPI build
# needed Node v26+ for WebAssembly.Suspending; Asyncify removes that
# constraint entirely.
#
# Output (git-ignored, regenerated on demand): spike.wasm + spike.mjs
# (the emcc-generated glue — NOT run-spike.mjs, which is the hand-written
# driver and IS committed).
set -euo pipefail

VERSION="0.9.0"
SHA256="a7b80b9083a2113a43280ee7b51d48d66ea5a779fc3fee57df7c451da0251c65"

ROOT="$(cd "$(dirname "$0")" && pwd)"
WORK="$ROOT/.build"
TARBALL="libdivecomputer-$VERSION.tar.gz"

mkdir -p "$WORK"; cd "$WORK"

if [ ! -f "$TARBALL" ]; then
  echo "downloading $TARBALL …"
  curl -fsSL -o "$TARBALL" "https://www.libdivecomputer.org/releases/$TARBALL"
fi

echo "verifying checksum …"
GOT="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
if [ "$GOT" != "$SHA256" ]; then
  echo "ERROR: checksum mismatch for $TARBALL"
  echo "  expected $SHA256"
  echo "  got      $GOT"
  exit 1
fi

if [ ! -d "libdivecomputer-$VERSION" ]; then
  tar xzf "$TARBALL"
fi
cd "libdivecomputer-$VERSION"

# emscripten's musl headers define TIOCGSERIAL/TIOCSSERIAL but ship no
# linux/serial.h, so serial_posix.c's Linux-only branch needs gating on the
# header too — otherwise it references struct/flag names that were never
# declared. Harmless: no transport in this build ever uses serial I/O.
if ! grep -q "TIOCGSERIAL) && defined(TIOCSSERIAL) && !defined(__ANDROID__) && defined(HAVE_LINUX_SERIAL_H)" src/serial_posix.c; then
  echo "patching src/serial_posix.c (Linux-only serial guard) …"
  sed -i '' \
    's|#if defined(TIOCGSERIAL) && defined(TIOCSSERIAL) && !defined(__ANDROID__)|#if defined(TIOCGSERIAL) \&\& defined(TIOCSSERIAL) \&\& !defined(__ANDROID__) \&\& defined(HAVE_LINUX_SERIAL_H)|g' \
    src/serial_posix.c
fi

if [ ! -f src/.libs/libdivecomputer.a ] || [ "${FORCE:-0}" = "1" ]; then
  echo "configuring for wasm32 …"
  emconfigure ./configure --host=wasm32-unknown-emscripten --disable-shared --enable-static >/dev/null
  echo "building …"
  emmake make -j8 >/dev/null
fi

echo "linking spike.c …"
emcc "$ROOT/spike.c" \
  -I include -L src/.libs -ldivecomputer \
  -sASYNCIFY -sEXIT_RUNTIME=1 -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=node,web -sALLOW_MEMORY_GROWTH \
  -O2 -o "$ROOT/spike.mjs"

echo "linking replay.c …"
emcc "$ROOT/replay.c" \
  -I include -L src/.libs -ldivecomputer \
  -sASYNCIFY -sEXIT_RUNTIME=1 -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=node,web -sALLOW_MEMORY_GROWTH \
  -O2 -o "$ROOT/replay.mjs"

echo "linking download.c …"
emcc "$ROOT/download.c" \
  -I include -L src/.libs -ldivecomputer \
  -sASYNCIFY -sEXIT_RUNTIME=1 -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=node,web -sALLOW_MEMORY_GROWTH \
  -O2 -o "$ROOT/download.mjs"

echo "done — run with: node $ROOT/run-spike.mjs · node $ROOT/run-replay.mjs <transcript.log> <truth.uddf> · node $ROOT/run-download-test.mjs"
