# libdivecomputer (vendored, compiled to WASM)

Dive-computer protocol engine — parses raw dive data from BLE dive
computers. Used by the computer-sync feature (`js/computer-sync.js`) to
turn a paired Bluetooth dive computer's raw byte stream into structured
dives, the same way it turns a saved memory dump into one on desktop tools
like Subsurface.

- **Source:** [libdivecomputer/libdivecomputer](https://github.com/libdivecomputer/libdivecomputer), release `0.9.0`
- **License:** LGPL-2.1-or-later — see `LICENSE` in this folder (copied
  verbatim from source). Same licence class as the bundled ffmpeg sidecar
  (`src-tauri/build-ffmpeg.sh`) — the relevant precedent is Subsurface-mobile,
  which links this exact library and ships on the Apple App Store.
- **Linking model:** a separately-loaded `.wasm` module is the dynamic-linking
  analogue for the browser — the file is swappable at runtime, and this
  README + `scripts/libdivecomputer-wasm-spike/build.sh` is the source offer.
  No object files are statically linked into the app itself.
- **SHA-256 of `download.wasm`:** `d3398f884cb6a2ef14f8543963ec57f13c2e9115280f6f5b9e46d4098669dc04`

Not published on npm — this is a C library compiled to WASM manually via
emscripten. Build recipe: `scripts/libdivecomputer-wasm-spike/build.sh`
(downloads the pinned, checksum-verified 0.9.0 source, patches one
Linux-only serial-driver guard that doesn't compile under emscripten's musl
headers, configures for `wasm32-unknown-emscripten`, links `download.c`
against it with `-sASYNCIFY -sEXIT_RUNTIME=1` for suspendable blocking I/O).
Re-run that script against a newer version's tarball + updated SHA-256 to
update this vendored copy.

**Asyncify, not JSPI (changed 2026-07-22).** The original build used
`-sJSPI`, which is smaller and faster but **Chromium-only** — WebKit shipped
JSPI in Safari 27 beta (WWDC26) and no released WKWebView has it. Since the
Tauri desktop shell renders in WKWebView, a JSPI build cannot run BLE sync
in the shell at all, and could never run on iOS. Asyncify does the stack
unwinding inside the generated code instead of asking the host engine for
it, so this one build serves the browser, the desktop shell, and a future
iOS shell. Cost: 368KB → 616KB and interpreter overhead that doesn't matter
here (a real sync is bounded by ~60ms-per-packet BLE pacing, not CPU).
Verified equivalent, not assumed — the full validation below was re-run
against the Asyncify build with byte-identical results.

**Calling contract — await `onExit`, not the factory.** Under JSPI the
factory promise resolved when `main()` returned. Under Asyncify it resolves
the moment `main()` first *suspends*, while the engine keeps running in the
background, so awaiting only the factory reports zero dives against a
download that hasn't started. `-sEXIT_RUNTIME=1` makes emscripten call
`Module.onExit(code)` on genuine return; callers pass an `onExit` hook and
await that (plus `onAbort`, which covers the WASM-trap case JSPI used to
surface as a factory rejection). `scripts/libdivecomputer-wasm-spike/run-module.mjs`
is the shared helper for the test harnesses; `js/computer-sync.js` does the
same inline, since it's a classic script and can't import an ES module.

**What `download.c` does, and what it deliberately doesn't (yet):**
the full download pipeline (`dc_device_open` → `dc_device_foreach` →
`dc_parser_*`) for whichever BLE-capable device family is paired, emitting
one JSON line per dive/waypoint/event over a streamed protocol
(`dive_start`, `waypoint`, `deco_event`, `dive_end`) that
`js/computer-sync.js` assembles into the same `{ maxDepth, duration,
startedAt, waypoints, events, computer }` shape `js/profile.js` already
consumes from UDDF imports (see `BRIEF-dive-computer-sync.md` §9).
Waypoints carry depth + time + (when available) temperature and NDL
(`DC_SAMPLE_DECO` with `type == DC_DECO_NDL`, converted seconds→minutes
in C to match the UDDF `<nodecotime>` path's own unit) — enough for the
real depth/time chart's NDL-headroom colour gradient, not just a plain
curve. Safety/deco/deep stops (the other `DC_SAMPLE_DECO` types) emit as
`deco_event` lines, one per sample, undeduplicated — exactly mirroring how
the UDDF `<decostop>` parser does it, since the chart's own
grouping-into-pills logic already expects that shape; deep stops fold into
`decostop`, the only vocabulary the chart and UDDF's own kind attribute
already know. A further line type, `progress` (`{current, maximum}`,
bytes, from libdivecomputer's own `DC_EVENT_PROGRESS` accounting,
throttled to whole-percent changes and suppressed while the maximum is
still the pre-manifest 0xFFFFFFFF placeholder), drives the sync progress
bar. Two more (brief §16, incremental sync): `devinfo` (`{model, firmware,
serial}`, from `DC_EVENT_DEVINFO`, fires once early — before manifest
scanning, so it survives an interrupted session) identifies the physical
device for fingerprint scoping; `newest_fingerprint` (`{hex}`) is the
newest downloaded dive's device-assigned fingerprint, emitted once per
session (delivery is newest-first, so this is always the first
`dive_start`'s dive). An optional 3rd argv slot accepts a fingerprint hex
string to set via `dc_device_set_fingerprint()` before
`dc_device_foreach()` — the device driver itself then stops enumerating
the manifest at the matching dive, so a routine "sync my 2 new dives"
session does real protocol work only for those 2, not a full re-download.
The dive's primary gas mix (`DC_FIELD_GASMIX_COUNT`/`DC_FIELD_GASMIX`,
index 0 — the back/start gas, same "first tank, absent explicit switch
info" fallback `js/profile.js`'s UDDF parser already uses) rides on the
`dive_start` line as raw `o2`/`he` fractions; JS-side classification into
Shoal's fixed gas vocabulary (Air/Nitrox NN/Trimix) reuses the existing
`_gasMixLabel()` the UDDF path already has, not a second implementation.
Tank size/pressure (`DC_FIELD_TANK`) is **still not extracted** — that's
the one remaining fidelity gap vs. a UDDF-imported dive. Read-only
throughout: the compiled callback table wires up `read` / `write` /
`sleep` / `close` only — `set_dtr`, `set_rts`, `configure`, `ioctl` are
never implemented, so there's no code path capable of writing to or
reconfiguring the paired device, regardless of what any caller asks for.

**Validated against real hardware, not synthetic data:** a captured BLE
session transcript from a real Shearwater Peregrine (`research/ble-captures/`,
gitignored — personal dive data) is replayed through this exact compiled
module in `scripts/libdivecomputer-wasm-spike/run-download-test.mjs`,
diffed against an independent UDDF export of the same 96 dives from
Subsurface: 96/96 dives, 28,112/28,112 waypoints within 0.3 m of the
reference (worst diff 0.00 m). Re-run that script after ever rebuilding
this module — it now also validates NDL and deco/safety-stop extraction:
all 28,112 real samples carry NDL, values track physiologically correctly
(rising on ascent, falling with time-at-depth, capping at 99 min) — but
NOT independently cross-checked against the UDDF, because that particular
export contains zero `<nodecotime>`/`<decostop>` elements at all (confirmed
by direct inspection — not every exporter emits them, same caveat
`js/profile.js`'s UDDF parser already documents). Deco/safety-stop events:
the code path was verified separately by temporarily tracing every raw
`DC_SAMPLE_DECO.type` value across all 28,112 samples — 100% were
`DC_DECO_NDL`; this diver's real 96-dive history never once triggered a
logged SAFETYSTOP/DECOSTOP/DEEPSTOP sample, so the event-emission branch
is exercised by test-harness logic and a live hardware pairing check, not
by a real occurrence in this transcript. Gas mix, unlike NDL, **was**
independently cross-checked against the UDDF ground truth — that export
does carry real `<mix>`/`<tankdata>` data (6 distinct EANx blends across
this diver's history) — and matched exactly: 96/96 dives, 100.0% exact
o2/he agreement, not just "plausible values." `run-fingerprint-cutoff-test.mjs`
separately proves the fingerprint cutoff itself engages (not just that a
fingerprint can be set): feeding dive #3's own fingerprint back in stops
the session at exactly the 2 dives newer than it, against the same real
transcript.

**Any Node that loads ES modules can run the above test scripts** (v22
confirmed). The JSPI build needed Node v26+ for `WebAssembly.Suspending`;
the Asyncify switch removed that constraint, so these harnesses are now
runnable on a stock Node.

**Two BLE-capable protocol families, one shared driver each:** the exact
model string passed to `dc_device_open` barely matters — all Shearwater
Petrel-family BLE models (Petrel 2, Perdix, Perdix AI, Nerd 2, Teric,
Peregrine, Petrel 3, Perdix 2, Tern, Tern TX, Peregrine TX) share one
protocol driver and the hardware auto-detects at handshake time (confirmed
empirically: targeting "Peregrine" against a real Peregrine still logged
"Unknown hardware type" and auto-detected correctly regardless). Same for
Suunto's EON Steel family. `js/computer-sync.js` only needs to know which
BLE **service UUID** matched during pairing to pick a representative
descriptor string for that family — never a specific model name.
