# Brief — Sync from dive computer (BLE, Shearwater + Suunto)

> **Status: ACTIVE — steps 0, 1, 1b done; step 2's CODE is written and
> unit-verified but NOT yet live-tested against real hardware (§14).**
> `js/computer-sync.js` (Web Bluetooth transport) + `vendor/libdivecomputer-wasm/`
> (production download module) exist, are wired into the UI, and pass every
> check that doesn't require an actual Bluetooth pairing dialog — which
> needs a human physically present with the Peregrine to click through.
> That live pairing session is the one remaining gate before step 3 (Android).
> Originally scoped 2026-07-03 as a research brief.
> Second revision. The first draft phased this as USB-first-then-BLE; that
> phasing was dropped after segment analysis (§3 records why, so it isn't
> re-litigated). Current direction, per Luke: **BLE only**, and **lean
> Option B** — Web Bluetooth + libdivecomputer-as-WASM, keeping Shoal a
> browser app — with **Option A** (Tauri native) as the fallback and the
> eventual iOS path. The concrete MVP: **a Shearwater Peregrine syncing to
> Shoal on an Android phone** (real test hardware: Luke's partner's
> Peregrine). Several load-bearing questions remain open — consolidated in
> §11 — and the A/B architecture choice is deliberately gated on a
> time-boxed spike (§8, step 1b), not decided on paper.

---

## 1. The job to be done, and the MVP

`BRIEF-dive-profile-import.md` (shipped) removed manual re-typing for anyone
willing to export a `.uddf` file via a third-party app first. This brief
removes the third-party app: **pair the dive computer over Bluetooth LE and
pull dives straight into Shoal.**

The target segment is specific: divers with a *modern* computer (Shearwater
Peregrine/Teric, recent Suunto) whose bundled vendor app syncs wirelessly
with zero effort. They like Shoal's idea but won't accept a manual
multi-step import when the vendor app is one tap. BLE sync is the feature
that meets them where they are.

**MVP definition:** Luke's partner's **Shearwater Peregrine** syncing to
Shoal on **Android**. Under the lead architecture (Option B) that means:
open diveshoal.com in Chrome on the phone, tap Sync, pair, dives land.
Nothing to install.

**File import remains the universal fallback.** UDDF covers all 300+
libdivecomputer-supported devices via whatever desktop tool the diver
already uses; other apps exist that provide the full range of connectors.
Direct sync is a convenience path for the brands worth the investment, not
a replacement.

## 2. Scope

**In:**
- **Bluetooth LE only.** No USB (§3), no Bluetooth Classic (§2a).
- **Shearwater + Suunto BLE-capable models** supported by libdivecomputer.
  Peregrine is the reference device. The authoritative per-model
  transport list is libdivecomputer's `descriptor.c` (each model carries a
  transports bitmask) — consult it before promising any specific model.
- **Android first** (the MVP), desktop Chromium second (it comes nearly for
  free under Option B and is the saner debugging environment — §8 step 2).
- Read-only download of dives; lands in the existing profile pipeline (§9).

**Out:**
- **Garmin — explicitly.** libdivecomputer's Garmin Descent support is via
  USB mass storage (FIT files), not BLE; Garmin's own Bluetooth talks to
  Garmin Connect and is closed to third parties. "Sync my Descent over BLE"
  is not achievable through this stack. The pragmatic Garmin path is a
  future **FIT-file importer** (a sibling of the UDDF importer, no hardware
  involved) or the Garmin Connect API — either is its own small brief, not
  this one. *(Confidence: medium-high; verify in `descriptor.c`.)*
- **Bluetooth Classic (§2a)** — and with it, older Shearwaters (Petrel
  2 era). They fall back to UDDF import.
- **iOS — for the MVP.** Web Bluetooth will never ship in Safari; iOS is
  Option A's job later (§7b), and note iOS has no un-notarized sideload
  path — it forces the $99/yr developer program when its day comes.
- USB (§3), IrDA, legacy serial.
- Tech-diver instrumentation (per-cell PPO₂, multi-tank curves, deco
  ceilings) — same persona exclusion as the UDDF brief.
- Firmware updates and device configuration — read-only posture throughout.

### 2a. Why Bluetooth Classic is out

Older Shearwaters (Petrel 2 generation) use BT Classic, not BLE.
Excluding them is deliberate, not an oversight: Web Bluetooth is BLE-only
(Option B can't reach Classic at all), `btleplug` is BLE-only (Option A
inherits the same limit), and iOS offers no third-party Classic API
whatsoever (MFi program only) — so Classic support would buy a shrinking
legacy segment at the cost of a second, entirely different transport stack
that can never work on half the platforms. Draw the line at BLE.
*(Model-generation split — which Shearwaters are Classic vs BLE — is
medium confidence; `descriptor.c` settles it.)*

## 3. Why USB was dropped (decision record, 2026-07-03)

The first draft used USB as a de-risking Phase 1. Two arguments killed it:

1. **Segment logic (Luke's):** anyone who has already fetched a cable and
   sat at a laptop has accepted ~90% of the friction — exporting a UDDF
   file from there is marginal. The convenience-sensitive segment this
   feature exists for owns BLE-first devices. Several of those devices
   (all modern Shearwaters, notably the Peregrine and Teric) **have no USB
   data connection at all** — the original "USB phase 1, Shearwater +
   Suunto" scoping was partially incoherent.
2. **The de-risk value was mislocated:** USB would have validated
   libdivecomputer's *built-in* transport (`dc_usbhid_open`) — code the BLE
   path discards entirely in favour of `dc_custom_open()`. The genuinely
   shared layers (build, bindings, protocol parsing, data landing) are
   better validated by the **dump-replay harness** (§8 step 1), which needs
   no transport and no cable at all.

USB stays cheap to add later on desktop if ever wanted (the transport is
built into libdivecomputer); it is not a milestone.

## 4. Prior art

**Primary: Subsurface / Subsurface-mobile** (GPL-2). The richer study, and
under-weighted in the first draft. Same library; solved BLE-custom-io years
ago; ships on both app stores. Specifically valuable:
- Its BLE code is the de-facto reference implementation of
  `dc_custom_open()` over GATT — connection lifecycle, the
  thread-and-blocking-callback pattern (§7 note), error handling.
- `core/btdiscovery.cpp` (and neighbours) document the **vendor GATT
  service/characteristic UUIDs** — Shearwater's proprietary UART-like
  service among them — plus MTU handling and write-with/without-response
  choices. These are protocol facts, not creative expression.
- Its desktop app has a developer option to **save libdivecomputer dump
  files** — directly useful for step 1 (§8).
- Subsurface-mobile on the Apple App Store is the **LGPL-on-App-Store
  existence proof** (§5).

**Secondary: Submersion** (github.com/submersion-app/submersion, GPL-3).
Flutter/Dart (92.4%), five platforms, `packages/libdivecomputer_plugin/`
with per-platform native folders and Pigeon-generated glue; libdivecomputer
vendored in `third_party/` with `patches/`. Confirmed by reading the repo.
Its native BLE glue (`android/`/`ios/` inside the plugin package) has *not*
been read yet — worth a facts-and-approach pass before implementation.

**The GPL boundary, restated:** both prior-art apps are GPL — read for
facts and approach only, never code. Using a GPL *application* as a tool
(e.g. running Subsurface desktop to capture a Peregrine dump) is fine —
no code linkage. libdivecomputer itself is a separate upstream dependency
under a more permissive licence (§5); depending on it directly is not
depending on them.

## 5. Licensing

| Component | Licence | Implication |
|---|---|---|
| Subsurface, Submersion (apps) | GPL-2 / GPL-3 | Facts and approach only; usable as tools |
| **libdivecomputer** (C library) | **LGPL-2.1-or-later** | Same class as Shoal's bundled ffmpeg — workable |
| `btleplug` (Rust BLE crate, Option A's transport) | BSD-3-Clause / MIT / Apache-2.0 | Fully permissive — confirmed 2026-07-21, §20 |
| `tauri-plugin-blec` (Option A's Tauri wrapper around `btleplug`) | MIT OR Apache-2.0 | Fully permissive — confirmed 2026-07-21, §20 |

- **App-store precedent is no longer by-analogy:** Subsurface-mobile links
  libdivecomputer and ships on the Apple App Store. Someone already ran
  this exact gauntlet.
- **Option B's linking story is clean:** a separate `.wasm` module loaded
  at runtime is the dynamic-linking analogue — user-swappable file,
  publish the build script + source offer. The repo already has the
  packaging precedent: `vendor/scuba-physics/` is a compiled-from-source
  vendored artifact with its own provenance README. Follow that pattern.
- **Option A's linking story:** prefer dynamic linking (`.so` on Android,
  dylib/framework on desktop/iOS) — satisfies LGPL's relink requirement
  without the object-file offer that static linking demands.
- Remaining diligence (§11): a real compliance pass against
  LGPL-2.1's exact terms for the chosen packaging, rather than relying on
  precedent — cheap, do it once the architecture is picked.

## 6. The architectural core: transport vs protocol

The single most important technical finding, confirmed from
libdivecomputer's own docs and mailing list: **libdivecomputer contains no
BLE transport.** Its built-in Bluetooth is Classic-only (Windows/Linux).
For BLE it exposes `dc_custom_open()` — the application supplies
read/write/timeout/flush callbacks and libdivecomputer treats that as just
another `dc_iostream_t`, running its full protocol engine on top.

| Layer | Who provides it (BLE) |
|---|---|
| **Transport** — discover, pair, exchange raw bytes over GATT | **The app** (Web Bluetooth in Option B; btleplug/Kotlin in Option A) |
| **Protocol** — bytes → dives (the hard, per-vendor part) | **libdivecomputer**, identical under both options |

This split is what makes the A/B choice a *packaging* decision rather than
a rewrite: the protocol layer is the same C code either way, and the
transport layer is a thin byte pump in either JS or Rust.

## 7. The two architectures

### 7a. Option B — stay in the browser (LEAD)

Web Bluetooth (Chromium) does transport; libdivecomputer compiled to
**WASM** does protocol; `dc_custom_open()` callbacks bridge the two.

```
Chrome (Android/desktop)
  navigator.bluetooth.requestDevice()          ← user-gesture pairing UI
  GATT notifications (RX) / characteristic writes (TX)
        ⇅  JS byte queue
  libdivecomputer.wasm  (dc_custom_open callbacks ⇄ JS)
        ↓
  parsed dive → existing js/profile.js pipeline (§9), source: 'ble'
```

**Why it leads:** it keeps Shoal's identity intact — no app store, no
native codebase, no install step. The MVP becomes "partner opens
diveshoal.com in Chrome and taps Sync." Distribution stays $0. The whole
feature gates on `('bluetooth' in navigator)` the same way folder sync
gates on File System Access — invisible where unsupported.

**Platform reality (consistent with existing constraints):** Chromium-only
— Chrome/Edge on Android and desktop. **Brave disables Web Bluetooth by
default** (as it does File System Access — same caveat list, one more
line). Firefox/Safari: never. iOS: never — that's Option A's job.

**The concentrated risk — blocking C in a non-blocking runtime:**
`dc_custom_open()`'s read callback is synchronous/blocking C; WASM on the
main thread cannot block. Candidate solutions, in preference order:
1. **WebAssembly JSPI** (JavaScript Promise Integration) — the modern
   successor to Asyncify; suspends WASM on a JS promise natively.
   Chromium-only, which costs nothing here since Option B already is.
   *(Believed shipping/stable in Chrome by 2026 — verify current status,
   §11.)*
2. **Emscripten Asyncify** — mature, portable, adds binary size and
   overhead; the proven fallback if JSPI isn't ready.
3. **SharedArrayBuffer + Atomics.wait in a Worker** — rejected unless
   forced: it requires cross-origin isolation (COOP/COEP headers), and
   COEP would break Shoal's cross-origin OSM tiles and iNat images unless
   every such resource sends CORP headers. Not worth the collateral.

**Other Option B specifics:**
- libdivecomputer is autotools; `emconfigure`/`emmake` is the standard
  wrapper path. The protocol layer is OS-independent C; the built-in
  transport files (serial/usbhid/bluetooth) should be excluded or left
  dead. *(Spike detail.)*
- CSP: instantiating WASM under Chromium needs `'wasm-unsafe-eval'` (or
  successor) in `script-src` — `_headers` needs a line. *(Verify exact
  directive, §11.)*
- `sw.js`: the `.wasm` lands in the SHELL list + cache bump — sync should
  work offline-after-first-load like everything else.
- No confirmed precedent found for libdivecomputer-under-WASM. The spike
  (§8 step 1b) exists precisely because this is unproven.

### 7b. Option A — Tauri native (FALLBACK / future iOS phase)

Kept fully scoped so a pivot or a later iOS phase doesn't restart research:

- **Transport:** `btleplug` via `tauri-plugin-blec` (223★, wraps btleplug;
  Windows/macOS/Linux/Android; Android routes through Tauri's mobile
  plugin system; iOS works with manual Info.plist + CoreBluetooth setup).
  **Re-verified 2026-07-21 (§20): licensing is clean and a working
  scan/connect/send/receive example exists — but it's pre-1.0 (v0.12) and
  its own maintainer notes iOS-specific code-signing problems of
  unconfirmed severity.** Not disqualifying, but budget a spike (§20) to
  find out before relying on it.
- **Protocol:** libdivecomputer cross-compiled per target (arm64
  Android/iOS via NDK/Xcode; desktop targets), `bindgen`-generated Rust
  FFI, `dc_custom_open()` bridged to btleplug via a **dedicated OS thread**
  whose C callbacks do blocking reads from a channel fed by the async BLE
  task (`blocking_recv`) — the standard sync-over-async pattern; never
  block a runtime worker thread. This is the same shape Subsurface uses
  with Qt.
- **Mobile shim:** Tauri v2 mobile plugins bundle a Kotlin class (Android)
  and Swift class (iOS) beside the Rust core; Tauri generates the bridge.
  Bluetooth permissions belong to the app bundle — **this can never be a
  sidecar** like ffmpeg.
- **Language decision (recorded):** Rust, not Go. Both existing binding
  projects are one-maintainer and immature (`libdivecomputer-go` archived
  with known leaks; `libdivecomputer-rs` alive but 1★) — fresh `bindgen`
  bindings either way. Rust wins on fit: Tauri's runtime is Rust, bindgen
  is mature, and Go would add a second mobile toolchain (gomobile) plus
  strictly more indirection.
- **Costs Option B avoids:** the Tauri Android app does not exist yet
  (prerequisite project); APK distribution (sideload keeps $0 on Android;
  iOS forces $99/yr + review); a native codebase to maintain.

## 8. The ladder (revised — no USB)

| Step | Proves | Hardware |
|---|---|---|
| **0.** Capture a Peregrine memory dump — run Subsurface desktop (as a tool) on the Mac, BLE-download from the Peregrine, save the libdivecomputer dumpfile | Access to test data; also sanity-checks the Peregrine↔libdivecomputer pairing works at all | Peregrine, once |
| **1.** Dump-replay harness — libdivecomputer parsing the dump headlessly (`dctool` parse mode / `dc_parser_new2`-style API; exact mechanism to verify) | Build + bindings + Shearwater protocol parse → lands in the existing `profile` shape. **CI-able forever after, no hardware** | none (reuses dump) |
| **1b.** **WASM spike (time-boxed; the A/B decision gate)** — same parser under emscripten + JSPI/Asyncify, fed the same dump from JS through `dc_custom_open` callbacks | Whether Option B is real. Fails → lose days, pivot to Option A with prior art waiting | none |
| **2.** Live BLE on desktop Chromium — Web Bluetooth to the Peregrine from Chrome on the Mac (sane debugging: devtools, no adb) | The GATT byte-pump against a live device; MTU, notification, timing realities | Peregrine |
| **3.** **Android — the MVP** — same code path, Chrome on the partner's phone | The actual target scenario, end-to-end | Peregrine |

Note the elegance worth preserving: steps 0–1b need no transport code at
all, step 2→3 under Option B is *the same JavaScript* — the ladder has no
throwaway rungs.

## 9. Data model — no new shape

A BLE-synced dive produces exactly the object `js/profile.js` already
consumes from UDDF parsing:

```javascript
{ maxDepth, duration, startedAt, waypoints, events,
  gpsLat, gpsLng, siteName,   // GPS: expected absent from device sync — no site DB on the computer
  computer }                   // from libdivecomputer's descriptor, e.g. "Shearwater Peregrine"
```

`matchToLoggedDive()`, `_attachProfile()`, `_prefillLogFormFromProfile()`,
the `.profile.json` sidecar, its coordinated-rename coverage — all
source-agnostic already. Under Option B this is even cleaner than the first
draft imagined: the WASM module returns this object **directly into the
same JS runtime** — no IPC at all. Set `source: 'ble'` (currently always
`'uddf'`). The sync UI slots beside the existing "Just dove?" UDDF banner
on the Log page, shown only when `('bluetooth' in navigator)`.

## 10. Files touched (projected, Option B)

| File | Change |
|---|---|
| `vendor/libdivecomputer-wasm/` (new) | The compiled `.wasm` + JS glue, vendored with provenance/licence README — mirror `vendor/scuba-physics/`'s pattern |
| `scripts/build-libdivecomputer-wasm.sh` (new) | Pinned-source emscripten build (dev-time only; the web app stays build-free) |
| `js/computer-sync.js` (new) | Web Bluetooth transport: device chooser, GATT session, byte queue ⇄ WASM callbacks; hands parsed dives to `js/profile.js` |
| `js/profile.js` | Accept `source: 'ble'`; reuse matching/attach unchanged |
| `index.html` | Sync button beside the UDDF banner (capability-gated); `<script src>` for the new file |
| `_headers` | CSP: `'wasm-unsafe-eval'` (verify exact directive) |
| `sw.js` | SHELL += new JS + `.wasm`; cache bump |
| `CLAUDE.md` / `DECISIONS.md` | Transport/protocol split, licensing story, A/B decision record |

## 11. Open questions — consolidated for future pickup

*(Most of the load-bearing ones were answered in the 2026-07-13 session —
see §13. Kept as written for the record.)*

Ordered roughly by how load-bearing they are:

- **The WASM spike itself (step 1b)** — everything hinges on
  libdivecomputer running under emscripten with suspendable I/O. No
  precedent found either way. This is the first real work item.
- **JSPI status** — believed shipping in Chromium by 2026; verify, and
  confirm emscripten's JSPI output path; else Asyncify.
- **Dump-replay mechanics** — exact libdivecomputer API/dctool invocation
  for parsing a saved dump without a device; also confirm Subsurface
  desktop's "save dumpfile" option still exists as the capture tool.
- **Peregrine GATT specifics** — Shearwater's service/characteristic
  UUIDs, MTU negotiation, write mode; documented in Subsurface's
  `btdiscovery.cpp` (facts only).
- **`descriptor.c` audit** — authoritative per-model transport matrix for
  the Shearwater/Suunto models to be claimed as supported; also confirms
  the Garmin-FIT and Classic-generation assertions made above.
- **Web Bluetooth pairing UX on Android** — chooser flow, whether the
  Peregrine needs manual wake into sync mode, re-pairing behaviour across
  sessions, GATT disconnect handling mid-download.
- **CSP directive** for WASM under Shoal's existing `_headers` policy.
- **LGPL compliance pass** for the WASM packaging specifically (runtime
  module ≈ dynamic linking argument — validate once, write down).
- **Suunto scope** — which BLE Suuntos to claim (EON Steel/Core, D5;
  newer models per `descriptor.c`); Suunto BLE may have its own GATT
  quirks distinct from Shearwater's.
- **Option A residuals** (only if the spike fails or when iOS happens):
  Tauri Android app as prerequisite; iOS BLE foreground behaviour.
  **Tauri-mobile maturity partially re-validated 2026-07-21 (§20):** Tauri
  2's iOS support has been stable since v2.0.0 (October 2024) and is
  production-usable per Tauri's own team, though explicitly not
  "first-class" alongside desktop, and not every desktop plugin has an iOS
  port (the existing `ROADMAP.md` caveat was written about the shallower
  `fs` plugin specifically — see §20 for why that one is now believed fine
  too, pending confirmation). `tauri-plugin-blec` itself checked in detail
  — see §20 for the licensing, maturity, and signing-issue findings, and
  the still-open question of whether the noted iOS signing problem is a
  real blocker.

## 12. When to build

Not before the **dive-profile chart (Phase C of
`BRIEF-dive-profile-import.md`)** — the priority-inversion argument stands:
this pipeline's output is currently invisible, and a Peregrine syncing
flawlessly into an unrendered sidecar is a worse demo than a UDDF file
rendering a depth curve. Chart first (days), then let UDDF import prove
itself in real use, then this (weeks).

When it is picked up: steps 0–1b of the ladder are the true beginning —
cheap, hardware-light, and they answer the architecture question before
any UI or transport code exists. If the spike succeeds, Option B proceeds
with no throwaway work; if it fails, Option A's research is already done
(§7b) and the dump harness carries over unchanged.

## 13. Findings — 2026-07-13 session (step 1b spike + §11 answers)

**The A/B gate is decided: Option B works.** All findings below were
verified directly (compiled, executed, or read from source), not researched
from secondary claims.

### The spike itself — PASSED

- **libdivecomputer 0.9.0 compiles under emscripten 6.0.2** with exactly one
  one-line patch: `src/serial_posix.c`'s two
  `#if defined(TIOCGSERIAL) && defined(TIOCSSERIAL) && !defined(__ANDROID__)`
  guards additionally need `&& defined(HAVE_LINUX_SERIAL_H)` — emscripten's
  musl headers define the ioctl constants but ship no `linux/serial.h`.
  Configure line: `emconfigure ./configure --host=wasm32-unknown-emscripten
  --disable-shared --enable-static` (use the release tarball, which has
  `configure` pre-generated; the git clone doesn't). Every transport
  auto-disables except serial (harmless dead code). Result: 2.5 MB `.a`;
  a linked JSPI test binary came out at ~226 KB of `.wasm` after dead-code
  elimination — the real build must keep the parser entry points exported,
  so expect somewhere between.
- **JSPI suspension through `dc_custom_open()` works.** Blocking C
  read/write callbacks (via `EM_ASYNC_JS` + `-sJSPI`) suspended on genuine
  JS promises (`setTimeout` round-trips) and resumed with data intact —
  a loopback write/read of 4 bytes through libdivecomputer's own
  `dc_iostream_write`/`dc_iostream_read` returned the exact bytes. Ran
  under node v26 V8 with no flags. emcc still labels `-sJSPI` experimental;
  the runtime feature itself shipped (below).
- **The real Shearwater protocol engine ran under suspension.**
  `dc_device_open()` on the Peregrine descriptor succeeded against a dumb
  JS mock — notable: Petrel-family open performs no I/O; the handshake is
  lazy (happens at foreach/close). `dc_device_close()` then emitted a real
  SLIP-framed Shearwater packet (`01 00 ff 01 05 00 2e 90 20 00 c0`)
  through the async bridge and returned cleanly. No deadlock, no trap.
- Spike artifacts (`spike.c`, `run-spike.mjs`, build steps) live in session
  scratchpad only — fold into `scripts/build-libdivecomputer-wasm.sh` +
  `vendor/libdivecomputer-wasm/` when implementation starts.

### §11 answers

- **JSPI status:** shipped. W3C-standardized April 2025; on by default in
  Chrome, Firefox 153+, and WebKit dropped its objection late 2025. The
  Chromium-only framing in §7a is now *conservative* — JSPI itself is
  everywhere; Web Bluetooth remains the actual Chromium-only gate.
- **`descriptor.c` audit (from source, 0.9.0):** Peregrine = family
  `SHEARWATER_PETREL`, model 9, `DC_TRANSPORT_BLE` only. BLE-capable
  Shearwaters: Petrel 2, Perdix, Perdix AI, Nerd 2, Teric, Peregrine,
  Petrel 3, Perdix 2, Tern, Tern TX, Peregrine TX. **Correction to §2a:
  Petrel 2 has BLE** (`SERIAL|BLUETOOTH|BLE`) — only the original
  Petrel/Predator/Nerd are Classic-only. Suunto BLE: EON Steel, EON Core,
  D5, EON Steel Black (all `USBHID|BLE`). **Garmin: zero presence in
  libdivecomputer at all** — §2's medium-high confidence is now certain.
- **Dump-replay mechanics — corrected:** the Petrel-family vtable has
  `dump: NULL` (read from `shearwater_petrel.c`) — Shearwaters do
  dive-by-dive download (`foreach`), not memory dumps, so Subsurface's
  "save dumpfile" option may produce nothing useful for a Peregrine. The
  capture that matters from step 0 is the **libdivecomputer logfile**
  (`subsurface.log`, a byte-level transcript — Subsurface's download
  dialog offers both checkboxes; ticking them produces ONLY diagnostics,
  no dives, so capture is a two-pass affair) plus a normal download as
  parsed ground truth. Replay = feed the transcript's device-side bytes
  back through `dc_custom_open` callbacks — the same seam the real BLE
  transport uses, so the harness and production share plumbing. Also:
  `dctool` has no BLE transport on macOS (§6 — BLE was never built in),
  so Subsurface is not just the *convenient* capture tool, it's the only
  one. Installed via `brew install --cask subsurface` (Intel build,
  needs Rosetta 2).
- **CSP:** current `_headers` `script-src` is `'self' 'unsafe-inline'` —
  needs `'wasm-unsafe-eval'` added when this ships.
- **Sample data:** no public Shearwater dump/transcript exists anywhere
  findable (libdivecomputer repo, wrapper projects, web) — step 0 with
  real hardware is genuinely the only source.

### Step 1 — replay harness: PASSED (2026-07-14)

`scripts/libdivecomputer-wasm-spike/replay.c` + `run-replay.mjs`: the FULL
download pipeline (`dc_device_open` → `dc_device_foreach` → `dc_parser_*`)
under WASM/JSPI, driven by the recorded 2026-07-13 Peregrine BLE transcript
(2.1 MB, forced full download, gitignored `research/ble-captures/`) with JS
playing the dive computer. Result against Subsurface's UDDF export of the
same 96 dives: **96/96 downloaded and parsed, 96/96 datetimes exact,
96/96 max depths exact (worst diff 0.00 m)**. Durations differ 3–26 s
one-directionally — a definitional gap (Subsurface counts to the last
sample; DC_FIELD_DIVETIME is the computer's own logged dive time, no
trailing surface seconds), immaterial next to Shoal's ±180 s match
tolerance and minute-level display; gate set to 60 s, histogram printed
per run. This is the standing regression check for any
libdivecomputer/emscripten bump: `./build.sh && node run-replay.mjs`.

**Transport requirement discovered (step 2 MUST honour this):** Shearwater
BLE responses are packetized — long responses span multiple GATT
notifications, each with its own `02 <seq>` sub-header — and
`shearwater_common` relies on **one packet per `dc_iostream_read` call**,
i.e. notification boundaries ARE protocol framing. A byte-stream transport
that coalesces notifications fails instantly with "Invalid packet header"
(observed empirically before the harness's mock was fixed to packet-per-
read). The Web Bluetooth transport must queue each `characteristicvaluechanged`
event as a discrete packet and serve reads from that queue, never a
concatenated buffer.

### Adjacent finding — Shearwater Cloud UDDF (the no-code alternative)

Shearwater's own app (Mac/Win/Android/iOS) downloads the Peregrine over BLE
and **exports UDDF** (plus CSV/DL7/XML/SQLite). Shoal's `parseUddf()` is
UDDF-version-agnostic (checks the root element name only, walks by
localName), so that export should import cleanly today — a zero-new-code
path for getting a Peregrine's dives into Shoal, useful independent of this
brief. Known historical SW Cloud export bugs (feet-vs-metres max depth,
since fixed; missing gas links/temps) all degrade gracefully in Shoal's
parser — worst case is an unmatched profile for manual review, never bad
data attached. Subsurface can also export UDDF after a BLE download, which
covers the same need without any cloud account.

## 14. Step 2 build — 2026-07-14 session

**GATT specifics (§11's last real unknown, resolved).** Subsurface's
`core/qt-ble.cpp` (`serial_service_uuids` table) gives the real BLE service
UUIDs — facts, not code, per the GPL boundary (§5):

| Vendor | Service UUID |
|---|---|
| Shearwater (Perdix/Teric/Peregrine/Tern) | `fe25c237-0ece-443c-b0aa-e02033e7029d` |
| Suunto (EON Steel/Core, G5) | `98ae7120-e62e-11e3-badd-0002a5d5c51b` |

No RX/TX characteristic UUIDs are hardcoded even in Subsurface — it
discovers them at runtime by GATT property flags (`notify` → RX,
`write`/`writeWithoutResponse` → TX) and picks write-with/without-response
based on which the device actually advertises. `js/computer-sync.js` does
the identical thing — more robust than hardcoding values that couldn't be
verified without the hardware in hand anyway.

**Family, not model, is what JS needs to identify.** Confirmed empirically
against the real 2026-07-13 Peregrine capture: even explicitly targeting
`dc_device_open` with the "Peregrine" descriptor, the engine still logged
`Unknown hardware type` and auto-detected the real device from the
handshake. Every BLE model in a Shearwater or Suunto family shares one
protocol driver (`shearwater_petrel_device_vtable` /
`suunto_eonsteel_device_vtable`); the exact model is a runtime detail
libdivecomputer resolves itself. So `js/computer-sync.js` only needs to know
*which service UUID matched* during pairing to pick a representative
descriptor string — never a device name to parse.

**Built, in order:**
1. **`vendor/libdivecomputer-wasm/`** — the real (not spike-quality)
   compiled module. `download.c` promotes `replay.c`'s proven skeleton:
   accepts vendor/product via argv (not hardcoded) and does full waypoint
   extraction (`{t, d, temp?}` per sample via `dc_parser_samples_foreach`,
   flushed one tick at a time — no growable array needed in C) over a
   streamed JSON-line protocol (`dive_start`/`waypoint`/`dive_end`) that JS
   assembles into the exact shape `js/profile.js` already consumes from
   UDDF (§9). **Scoped out for this pass, noted not hidden:**
   `DC_SAMPLE_DECO` (NDL/stop events) and `DC_SAMPLE_GASMIX`/tank data are
   seen by the sample callback and currently ignored — a BLE-synced dive's
   chart will lack the NDL colour cue and stop pills until a follow-up
   pass. Depth/time/temp — enough for a real chart to render — was the
   line proportionate to "prove live sync works," not "match UDDF import's
   full fidelity on the first pass."
   **Re-validated against the same real Peregrine transcript step 1 used**
   (not just re-proving JSPI survives — this time checking actual waypoint
   data): 96/96 dives, **28,112/28,112 waypoints within 0.3m of the UDDF
   ground truth, worst diff 0.00m**. `scripts/libdivecomputer-wasm-spike/run-download-test.mjs`
   is the standing regression check; re-run after any rebuild.
2. **`js/computer-sync.js`** — the actual Web Bluetooth transport.
   `_makePacketQueue()` bridges GATT's async, unpredictable-timing
   notifications to the WASM module's blocking-shaped `read()` callback: a
   `characteristicvaluechanged` listener pushes each notification as one
   discrete packet (the one-packet-per-read rule from §13, non-negotiable —
   a coalescing transport fails instantly), and `read()` either returns an
   already-queued packet or suspends on a promise until one arrives, with a
   15s timeout so a mid-sync disconnect resolves cleanly (empty bytes →
   the C layer's own `DC_STATUS_TIMEOUT` path) instead of hanging forever.
   `gattserverdisconnected` also fails any in-flight read immediately.
   Downloaded dives are routed through the *exact same* matching/landing
   pipeline bulk UDDF import uses (`matchToLoggedDive`, `_attachProfile`,
   `_pendingProfileReview`/review list, `_pendingNewDiveCandidates`/bulk-add
   bar) — no duplicated logic, and it means BLE sync inherits bulk-add's
   "Start at #" numbering for free, exactly as intended when that feature
   was built.
3. **UI + shell wiring:** a capability-gated (`'bluetooth' in navigator`)
   "⚡ Sync" banner beside the existing UDDF banner on the Log page;
   `_headers` gets `'wasm-unsafe-eval'` in `script-src`; `sw.js` cache
   bumped, `js/computer-sync.js` + both vendor WASM files added to
   `SHELL_CRITICAL` (not `SHELL_DEFERRED`, despite ~380KB combined — see
   the comment in `sw.js`: the Literata fonts earned DEFERRED because
   there's a Georgia fallback, but there's no fallback for a Sync tap while
   offline, which is precisely the scenario this feature exists for).
   **Deliberately untouched:** `src-tauri/tauri.conf.json`'s CSP — the
   Tauri shell uses WKWebView (Safari's engine), which has no Web
   Bluetooth at all (§7a), so `bleSyncSupported()` will always be false
   there regardless; nothing to gain from updating a CSP the feature can
   never reach.

**Verified without hardware (unit/integration level, real extracted code —
not rewritten mocks):**
- `run-download-test.mjs`: the actual compiled `download.wasm`, real
  Peregrine transcript, real UDDF diff — 96/96 dives, 28,112/28,112
  waypoints exact.
- `scratchpad/smoke-computer-sync.js` (29 assertions): `_assembleDive`
  field mapping, `_makePacketQueue`'s async suspend/resume/timeout/
  disconnect semantics, and all four `_routeSyncedDives` paths (auto-attach,
  ambiguous-review, single-prefill, bulk-add) against the real functions.

**NOT yet verified — needs Luke + the Peregrine in the room:** an actual
`navigator.bluetooth.requestDevice()` pairing dialog. This is a genuine,
structural limitation, not a shortcut — the native OS Bluetooth chooser is
a security-sensitive surface outside the page's DOM, gated on a live user
gesture, and (like the file-picker permission dialogs this codebase already
works around elsewhere) not something browser automation can click through
even in principle. Everything upstream and downstream of that one dialog
is now built and tested; the dialog itself is the one piece only a human
can drive. When ready: open diveshoal.com in desktop Chrome (step 2 of the
ladder — sane debugging, devtools, no adb), Peregrine → Bluetooth menu, tap
Sync, see what the real GATT session actually does. Likely first failure
modes, ranked by suspicion: MTU/notification size mismatches the transcript
didn't exercise (it only ever saw whatever chunk sizes iOS/macOS's stack
already negotiated), and write-mode selection (`writeValueWithoutResponse`
vs `writeValue`) picking the wrong one if a characteristic advertises both
properties.

## 15. First live test — 2026-07-14, and the bug it found

**Real result, Luke + the actual Peregrine:** pairing and connection both
worked — the chooser found the device, GATT connected, and the download
began exchanging data for roughly a minute. The Peregrine itself then
showed an on-device "error log… quitting" message and dropped out. Shoal's
UI never reflected this: it stayed on "Downloading from Peregrine…"
indefinitely, with no error and no way to do anything about it.

**What this proves, despite the failure:** pairing, GATT connect, service/
characteristic discovery, and real bidirectional data exchange with an
actual Shearwater Peregrine all work — the reported symptom is entirely a
missing-error-handling bug, not a transport failure. Root cause unconfirmed
(no device-side log to inspect), but a real, fixable gap either way: the
transport had a 15s *per-read* timeout but nothing watching the *overall*
operation, and no way for a human to intervene. Two candidate explanations
for a minute-plus stall before any feedback, neither excluding the other:
a genuine mid-protocol stall the per-read timeout should have caught but
didn't get the chance to (browser tabs get backgrounded and Chrome throttles
`setTimeout` heavily in that state — plausible if Luke's attention was on
the Peregrine's own screen when it errored, not the Shoal tab), or a
`gattserverdisconnected` event that fired but produced no distinct message.

**Fixed:** `js/computer-sync.js` now tracks an explicit `_activeSync.reason`
(`null` while running, `'cancelled'` or `'disconnected'`) and:
- **A "✕ Cancel sync" button** appears the moment a sync starts (`#lf-ble-cancel`,
  `_setSyncingUI()`) — a direct user action, immune to any timer-throttling
  question, and the reliable escape hatch the missing-feedback report was
  really asking for regardless of the exact original cause.
- **`gattserverdisconnected` produces an honest, distinct message** —
  previously this fell through to the same code path as a healthy
  connection returning zero dives ("No dives on this computer" — true
  words, false implication). Now: "Connection to your Shearwater Peregrine
  was lost before any dives came through" when nothing was collected yet.
- **Partial progress is kept, not discarded.** If dives were already parsed
  before the drop, they're still routed through the normal review/bulk-add
  pipeline — the message says the sync was incomplete and to reconnect for
  the rest, but nothing already downloaded is thrown away.
- **Deliberately not added:** a fixed overall wall-clock timeout. The one
  real captured full-history download took ~37 minutes (96 dives, no
  fingerprint to skip already-known ones) — a blanket few-minute ceiling
  would incorrectly kill a legitimate first-ever full sync for someone with
  a long dive history. The per-read timeout plus a manual Cancel covers the
  actual failure mode without that risk.

**Verified against the real compiled WASM module** (`vendor/libdivecomputer-wasm/download.wasm`,
not a rewritten stand-in), replaying the real Peregrine transcript with a
mock that genuinely stops responding at a chosen point (the first version
of this test only *flagged* an interruption without actually silencing the
mock, so the full transcript kept racing through underneath — worth noting
since it's the second time this session a mock's fidelity, not the
production code, turned out to be the actual bug): cancel/disconnect with
zero dives collected settle in milliseconds with the correct distinct
message; a disconnect after real dive data was already flowing keeps that
data and reports the sync as incomplete rather than silently dropping it.

**Still open:** the actual root cause of the Peregrine's own "quitting"
error. Worth checking on the next live attempt — the new Cancel button
means an unresponsive sync is now recoverable either way, and the
disconnect message should at least tell us *when* in the exchange it
happened next time.

### §15 addendum — root cause FOUND and fixed (second live test, same day)

The second live test reproduced the failure on demand and pinned it:
~20 seconds into a healthy download the **Peregrine** showed "LOG ERROR:
Timeout" — i.e. *it* was waiting for *us*. Neither §15 candidate
explanation was right. The bug was in `_makePacketQueue`'s read timeout:
every blocked read armed a 15 s `setTimeout`, but a read resolved normally
by an arriving notification **left its timer running**, and the timer's
guard checked `if (waiter)` — *any* waiter, not *its own*. During a real
paced download (reads resolve in milliseconds, but the session runs for
minutes), the very first read's stale timer fired at t≈15 s, saw whichever
read was in flight, and nulled it — orphaning that read's promise forever.
`push()` then saw no waiter and silently queued packets; the orphaned
read's own timer found `waiter` already null and did nothing; `fail()`
(both the Cancel button and `gattserverdisconnected`) also found no waiter
to resolve. One bug, all three observed symptoms: Shoal goes silent at
15 s → Peregrine times out at ~20 s → no disconnect message → dead Cancel
button. The C engine sat JSPI-suspended on a promise nobody could settle.

Fix: the timer clears on normal resolution and only ever clears *its own*
waiter (identity check, `waiter === w`). Verified by a repro that finally
made a mock deadlock exactly like the live session — the missing
ingredient in every earlier mock was **pacing**. They all answered at CPU
speed (whole 96-dive replay: ~400 ms), so no timer ever outlived its own
exchange; adding a realistic per-exchange delay made the stale timer fire
mid-session and hang the real WASM module on the spot, and the fixed queue
then completed all 96 dives across ~50 would-be stale-timer windows.
**Third mock-fidelity lesson this brief has produced: after packet
boundaries and interruption behaviour, TIMING is part of what a transport
mock must reproduce.** The one remaining untested-live question is whether
the next real pairing runs to completion — everything else about the
session (pairing, discovery, handshake, sustained bidirectional transfer)
has now been proven against the actual hardware twice.

**Third live test — identical failure, different cause entirely: the fix
never reached the browser.** Shoal's own service worker had installed on
localhost during an earlier page load and was serving `computer-sync.js`
from its cache; the stale-timer fix landed without a `sw.js` cache bump
("same uncommitted batch" — correct release logic, wrong for a browser
that had already installed the previous version mid-session), so the
retest ran the exact pre-fix bytes and reproduced the freeze perfectly.
Mitigations now in place: `BLE_SYNC_REV` (a revision constant logged to
console at sync start — one glance answers "which code is this browser
actually running"), a warning comment on `sw.js`'s CACHE constant, and the
bump-per-edit-during-live-testing rule added to CLAUDE.md. The same trap
then caught the in-session verification pass a third time in miniature —
same-URL hash navigation doesn't reload the document, so even the checking
tab was briefly running stale JS. PWAs make "is the fix actually in front
of me?" a question that must be answered by evidence, never assumed.

**Progress bar (same session):** `download.c` subscribes to
`DC_EVENT_PROGRESS` (libdivecomputer's own byte-accurate accounting across
manifest + every dive transfer), throttled to whole-percent changes, the
pre-manifest `0xFFFFFFFF` unknown-maximum placeholder filtered at the C
layer. Streams as a fourth JSON-line type; the UI renders a slim bar +
"48% · 42 dives so far" label. Replay-verified: 104 events across the full
real transcript, strictly monotonic, 0→100%. This also turns any future
stall into a visible symptom (a frozen bar with a live percentage beats a
static "Downloading…" line for diagnosis at the dive shop).

**Fourth live test — cancelling mid-sync lost every already-downloaded
dive, with the raw Web Bluetooth error shown to the user.** Reported
verbatim: `Sync failed: Failed to execute 'writeValueWithoutResponse' on
'BluetoothRemoteGATTCharacteristic': GATT Server is disconnected...`.
Root cause: `cancelBluetoothSync()` correctly disconnects the GATT
connection immediately (that's what makes Cancel actually stop a healthy,
still-responding sync rather than hoping the engine notices) — but the
WASM engine can have a write in flight, or attempt one more, in that same
instant. That write throws a real `DOMException` against the now-dead
characteristic, which rejects the WASM module's `factory()` call, which
used to jump straight past every `_activeSync.reason`-based handler
(cancelled/disconnected/success) into a bare "Sync failed: `<raw error>`"
— discarding `parsedDives` entirely, no matter how much had already
downloaded. Fixed by hoisting `parsedDives`/`computer` above the `try`
(previously scoped inside it, unreachable from `catch`) and extracting the
reason-branching into `_finishSync()`, called from **both** the normal
completion path and the catch block — a reason-induced throw is now
handled identically to a reason-induced clean resolve; only a genuinely
reason-less exception shows a raw error (and still salvages/routes
whatever was collected first, rather than discarding it).

**The test suite's fifth mock-fidelity gap, same family as the prior
four:** `test-cancel-final.mjs`'s mock silently no-op'd on `write()` after
its simulated interrupt point instead of throwing — which is not how a
disconnected `BluetoothRemoteGATTCharacteristic` actually behaves — so it
proved the *clean*-resolve cancel path worked while never exercising the
*throwing* path that the live device actually hit. `test-cancel-throws.mjs`
now reproduces the exact live error text via a mock that throws the real
`DOMException`, includes a structural assertion that fails loudly if
`syncFromBluetooth`'s try/catch shape is ever restructured without this
test being updated to match, and covers both an early throw (0 dives,
correctly shows just "Sync cancelled.") and a late throw (dives already
downloaded correctly salvaged and routed to the bulk-add picker).
**Every mock in this brief that simulates a device going away must throw
on the next write, not just stop answering — that's the one Web Bluetooth
actually does, and "stops answering" alone will hide this exact class of
bug again.**

## §16. Incremental sync via device fingerprints (in progress, 2026-07-14)

### The problem

Every sync currently re-downloads the entire dive history from scratch —
fine once, untenable routinely. A first-ever backfill (96 dives) takes
~37 minutes at real BLE speed; a diver who just wants to log two dives
from this morning has no way to get that in under a minute. §14/§15
already fixed cancel-and-resume to not lose data or hang, and the bulk-add
numbering guard (just shipped) makes an interrupted-then-resumed sync
numerically sane — but the *actual* fix for "nobody will wait 30 minutes
routinely" is to make routine syncs fast, which means not re-downloading
what's already known. This section is that fix.

### Verified mechanics (read from source, not assumed)

- **Fingerprint is a fixed 4-byte value**, opaque (device-defined, not a
  timestamp we can construct ourselves), scoped per-device.
  `shearwater_petrel_device_t.fingerprint[4]`, set via
  `dc_device_set_fingerprint()` (validates size is exactly 4, or 0 to
  clear — `src/shearwater_petrel.c:134`).
- **Every downloaded dive already carries its own fingerprint** — the
  `dive_cb` callback (`download.c`'s existing `dive_cb`) receives it as
  the `fingerprint`/`fsize` parameters, currently read but discarded.
  Since delivery is newest-first (confirmed repeatedly this session), the
  fingerprint of the *first* dive processed in a session is the one to
  persist — it identifies "the newest dive as of this sync."
  Source: `data + offset + 4` in the manifest record,
  `shearwater_petrel.c:347` (`callback(buf, len, buf + 12, sizeof(device->fingerprint), userdata)`).
- **The device driver itself, not our code, stops enumeration on a match**
  — `shearwater_petrel_device_foreach`'s manifest-scan loop
  (`shearwater_petrel.c:287-289`) breaks out the instant a manifest
  record's embedded fingerprint bytes equal the one we set. Set correctly,
  a routine sync's manifest phase does the same protocol work as today
  (the manifest itself has no shortcut) but the *dive-by-dive profile
  downloads* — the bulk of the data — never happen for anything already
  known. This is why a "sync my last 2 dives" session should complete in
  well under a minute rather than tens of minutes.
- **Device identity for scoping**: `DC_EVENT_DEVINFO` fires early in every
  `dc_device_foreach` call (right after the serial/firmware/hardware
  handshake, well before manifest scanning — `shearwater_petrel.c:208-211`),
  carrying `{model, firmware, serial}`. `computer` (currently just
  `"${vendor} ${product}"`, e.g. "Shearwater Peregrine") is NOT
  per-physical-device — two people with the same model, or a replaced
  unit, would collide. The fingerprint store must be keyed by serial.

### Design

**Storage.** `localStorage['divelog-ble-fingerprint']`, a JSON object
`{ [serial]: { hex, computer, syncedAt } }` — one entry per physical
device ever synced. Mirrors the existing flat-localStorage-key pattern
(`divelog-ac-cache`, `divelog-shell-vault-path`) rather than inventing a
new persistence mechanism.

**The one correctness rule that matters: only persist a fingerprint after
a session downloads EVERY dive newer than the previously-stored one.**
Fingerprinting is a hard cutoff at the protocol level — the device
literally stops telling us about anything at-or-older than the stored
value. If we stored a fingerprint from an *interrupted* session, dives
between the true newest-known point and wherever the interruption
happened would become permanently unreachable (the device would skip
right past them on every future sync, believing them already known,
because our fingerprint claims to be newer than they actually are). So:
- `reason === null` (clean, uninterrupted completion) → safe to update.
- `reason === 'cancelled'` or `'disconnected'` (§14/§15's existing states,
  regardless of how many dives came through first — could be 0, could be
  90) → **do not update the stored fingerprint**, even though those dives
  still get correctly routed and saved via the existing salvage path. The
  next sync starts from the old fingerprint (or none) and correctly
  re-covers the gap. Slower, never wrong — the tradeoff this whole feature
  exists to eventually shrink (§ "Later, optional" below), not one to
  break correctness for.
- A dive-by-dive streaming update (update the stored fingerprint after
  *each* dive lands, not just at the end) was considered and rejected for
  this pass: it would shrink the "have to re-fetch on interrupt" window,
  but interacts with the numbering-guard warning just shipped (a
  fingerprint that advances mid-session changes what "the batch" even
  means for that warning's date comparison) in a way that needs its own
  design thought. All-or-nothing per session is correct and simple; a
  finer-grained version is a legitimate future improvement, not this pass.

**Escape hatch.** Settings & data needs a "Forget synced dives for this
computer" (or similar) action that clears the stored entry — the recovery
path if a fingerprint is ever suspected wrong, or if a firmware update /
factory reset changes what the device reports.

**C-side (`download.c`) changes:**
1. Accept an optional incoming fingerprint (hex string) via a new argv
   slot; if present, call `dc_device_set_fingerprint()` right after
   `dc_device_open()`, before `dc_device_set_events`/`dc_device_foreach`.
2. Subscribe to `DC_EVENT_DEVINFO` alongside the existing
   `DC_EVENT_PROGRESS` subscription (`event_cb` already exists — extend
   its switch, don't add a second callback); emit `{"type":"devinfo","serial":...,"model":...,"firmware":...}`
   once, early — this is what lets JS key the fingerprint store correctly
   even before deciding whether to persist anything.
3. Capture `fingerprint`/`fsize` on the **first** `dive_cb` invocation of
   the session (newest dive, per delivery order) and emit
   `{"type":"newest_fingerprint","hex":"..."}` once, alongside the
   existing `dive_start`/`waypoint`/`dive_end`/`progress` line types.
4. Rebuild, then **re-run the existing regression suite before touching
   anything else** — `run-download-test.mjs` (96/96 dives, waypoint
   fidelity) must still pass unmodified; this change must be additive to
   the JSON-line protocol, not disruptive to it. Update
   `vendor/libdivecomputer-wasm/` (wasm + mjs + README SHA) and bump
   `sw.js` only once this is verified.

**JS-side (`js/computer-sync.js`) changes:**
1. Before connecting, look up any stored fingerprint for the vendor/family
   about to be paired (can't know the *exact* serial until `devinfo`
   arrives mid-session, but the UUID-matched family — Shearwater vs.
   Suunto — narrows it; the real gate is matching `devinfo.serial` once
   it arrives, not the pre-connection lookup).
2. Pass the stored fingerprint (if any, once serial is confirmed — may
   require restructuring the argv-passing to happen after the first
   `devinfo` event rather than at `factory()` call time, since serial
   isn't known until the WASM module is already running; needs a design
   decision during implementation, not assumed here) into the download.
3. On a **clean** completion (`_activeSync.reason === null` at the point
   `_finishSync` runs), persist `{hex, computer, syncedAt: now}` keyed by
   the confirmed serial. On `'cancelled'`/`'disconnected'`, don't.
4. Status messaging: a fingerprinted sync should say something honest and
   different from a full backfill — e.g. "Checking for new dives…" /
   "2 new dives since your last sync" — not the same "(Cancel if this
   doesn't finish)" framing a 37-minute first sync needs.
5. Settings & data: the "forget this computer" escape hatch.

### Implementation order (the actual TODO, in sequence)

1. C: devinfo + fingerprint emission, incoming-fingerprint acceptance.
   Rebuild, revalidate against the existing real transcript unmodified.
2. A **new** replay fixture proving the cutoff actually works: take the
   real transcript, extract the fingerprint of (say) the 3rd-newest dive
   from the manifest data already in `research/ble-captures/`, feed it
   back in as the incoming fingerprint, and confirm the replay now stops
   after 2 dives instead of 96 — this is the one behaviour that can't be
   inferred from the C source reading above, it has to be proven against
   real protocol bytes the same way steps 1/1b were.
3. JS: storage, the reason-gated persist rule, serial-based lookup timing.
4. JS: status messaging differentiation, Settings escape hatch.
5. Full regression sweep (all existing suites) + a live hardware test —
   sync once fully (or let a cancelled/resumed pair complete), then sync
   again immediately and confirm it finishes in seconds, not minutes.

### Explicitly out of scope for this pass

- Per-dive streaming fingerprint updates (see above — real future
  improvement, not now).
- Multi-computer fingerprint UI beyond the single "forget" action (e.g. a
  list of all previously-synced computers) — build if it turns out to be
  needed, not preemptively.
- Options 1 (progress-bar time estimate + reframing copy) and 3
  (insert-and-shift renumbering on a detected date conflict) from the
  design discussion this section grew out of — separate, independent
  pieces of work, not blocked on this one or by it.

### §16 addendum 1 — fingerprint vs. local reality can diverge (found live, fixed)

Live test, same day: full sync completes cleanly (fingerprint stored),
then dives were deleted from Shoal's history, then resynced — result was
"Already up to date," which is **true of the device and false of the
outcome**. The fingerprint only ever answered "has the device recorded
anything new since X" — it has no way to know, and was never designed to
know, whether the *local* copy is still what it was when X was recorded.
Those are genuinely different questions; treating them as one meant a
locally-deleted dive would stay silently unreachable forever, since the
same device-side cutoff would keep skipping it on every subsequent sync
too.

**Fix:** `_storeFingerprint` now also records `diveCountAtSync` — the
total local `dives.length` at the moment the fingerprint was saved
(captured *after* `_finishSync` resolves, so it reflects whatever that
session actually attached, not a stale pre-sync count). `_guessFingerprintFor`
checks current `dives.length` against that baseline before offering the
fingerprint for a new sync; if the count has dropped, it returns
`{ hex: null, recovering: true }` instead — declining to use the
fingerprint (falls back to a full download, which naturally re-covers
whatever's missing) and giving the UI a distinct, honest status message
rather than a silent generic full sync. A **rise** in count (dives added
elsewhere — manual entries, UDDF import, a different device) is
deliberately *not* treated as suspicious — only a drop is.

This is a coarse signal (any deletion anywhere triggers a recheck, not
just deletions of dives from this specific computer), traded deliberately
for simplicity: the failure mode of over-triggering is just an
unnecessary full resync (slower, never wrong), while under-triggering is
the bug just found (silently, permanently wrong). Same "harmless to guess
wrong" principle the pre-connection fingerprint guess itself already
relies on.

### §16 addendum 2 — the "second gap" (per-dive streaming checkpoints) turned out to be unsafe, not just unbuilt

Recorded as deferred-but-buildable in the original §16 write-up. Working
through the actual design just now, before writing any code, surfaced
that it isn't safely buildable at all with this protocol — worth
recording precisely, so this doesn't get re-proposed and half-built later
without re-deriving why.

**The idea:** an interrupted first sync (say, cancelled after dives 1–40
of 96) currently can't benefit from *any* of that partial progress on
resume — it re-downloads from scratch every time, because a fingerprint
only ever gets persisted after a session reaches the true end. The
proposed fix was to checkpoint progressively: store the fingerprint of
whichever dive was *last* successfully downloaded in an interrupted
session (dive #40's, say), not just the newest dive's, so a resume could
skip re-fetching 1–40 and pick up from there.

**Why it's actually unsafe, not just unbuilt:** the device-side cutoff
(`shearwater_petrel.c`'s manifest loop, §16 above) walks newest-first and
**breaks the instant it finds a match** — meaning it stops offering
*everything from that matched record onward*, i.e. the matched dive
itself plus everything *older*. Fingerprinting dive #40 doesn't mean "I
have dives newer than #40, ask again for the rest" — to the device it
unconditionally means "I have #40 and everything older than #40, don't
ever tell me about any of it again." A resume using that fingerprint
would correctly skip re-fetching 1–39 (genuinely already had), but would
**also silently skip 41–96 forever** — the dives that were never
downloaded at all — because the device has no "partial" or "resume from
here, but keep going past there too" concept. It is a strictly
newest-first, one-directional, all-or-nothing cutoff. There is no
fingerprint value that safely means "known up to here, but there's more
below I still want."

Put differently: the *only* fingerprint that is ever safe to persist is
the newest dive's, and *only* once a session has independently confirmed
it reached the actual end of the manifest — which is exactly the rule
already implemented (§16 above), not a simplification of something better
that could be built. There is no safer intermediate design hiding here;
the protocol's own cutoff semantics rule it out.

**What's left for the interrupted-first-sync experience, given the above
is off the table:** it has to be a UX problem, not a protocol one — this
collapses back into Option 1 from the original three-option design
discussion (progress-bar time estimate, explicit "safe to cancel and
resume, just re-verifies from the start each time" framing) rather than
a distinct "gap" with its own fix. Nothing here makes a resumed partial
first sync faster; it makes the wait for it honest. Still unbuilt,
still independent of everything else in this section.

## §17. NDL + deco/safety-stop extraction — 2026-07-15 session

Closed the fidelity gap flagged since §9/step-2: `download.c`'s sample
callback saw `DC_SAMPLE_DECO` and discarded it, so a BLE-synced dive's
chart had no NDL colour gradient and no safety/deco pills — both present
on a UDDF-imported dive. Not a research task; the vendored header
(`parser.h`) already spells out the exact union shape libdivecomputer
hands back per sample: `{ type: DC_DECO_NDL|SAFETYSTOP|DECOSTOP|DEEPSTOP,
time, depth, tts }`. Purely additive plumbing:

- **NDL** (`DC_DECO_NDL`) rides on the current waypoint tick as an
  optional `ndl` field (minutes, `time/60.0` — same unit + rounding the
  UDDF `<nodecotime>` path already uses), exactly like temperature already
  does.
- **Stops** (`SAFETYSTOP`/`DECOSTOP`/`DEEPSTOP`) are discrete events, not
  a per-tick scalar — each sample emits its own `deco_event` JSON line
  immediately, one per sample, undeduplicated, mirroring exactly how the
  UDDF `<decostop>` parser already does it (js/profile.js). DEEPSTOP folds
  into `"decostop"` — the chart's own grouping-into-pills logic and the
  UDDF parser's own `kind="safety"/"mandatory"` attribute only know that
  binary vocabulary, so folding it in means **zero chart-side changes**
  were needed; the entire change is in `download.c` + two new lines in
  `computer-sync.js`'s `_assembleDive`.

**Validation against real data, not synthetic:** extended
`run-download-test.mjs` (the existing real-transcript regression harness,
§9/step-2) to also cross-check NDL and count deco events, then ran it
against the same real 96-dive Peregrine capture used throughout this
project. Result: all 28,112 real samples carry NDL; spot-checking the
actual sequence for one dive showed physiologically correct behaviour
(99 min cap at shallow depth, falling with time-at-depth, rising again on
ascent — not just "a number appeared"). **Could not cross-check NDL
against the UDDF ground truth**, because that specific export contains
zero `<nodecotime>` elements at all (confirmed by direct `grep` — Subsurface
didn't emit them for this export, not a parsing gap on either side; the
UDDF parser's own comments already flag this as exporter-dependent).
**Zero deco/safety-stop events occurred anywhere in this diver's real
96-dive history** — confirmed genuine, not a bug, by temporarily tracing
every raw `DC_SAMPLE_DECO.type` value across all 28,112 samples: 100% were
`DC_DECO_NDL`, 0% anything else. So the event-emission code path is
logic-verified (the C correctly distinguishes and formats whichever type
arrives) but not exercised by a real occurrence in this transcript — a
live hardware pairing that includes an actual safety stop is the
remaining real-world confirmation, not a data gap in the test itself.

**Node version gotcha, worth not re-discovering:** the JSPI runtime
(`WebAssembly.Suspending`) is not available under Node v22 even with
`--experimental-wasm-jspi` passed explicitly — confirmed working with
*no flags* under Node v26. Multiple Node installs on PATH (`.local/bin`
ahead of `/opt/homebrew/bin` in this case) means the version that
resolves for a bare `node` command is not guaranteed to be the right one;
invoke the v26+ binary explicitly for these test scripts. Documented in
`build.sh`'s header comment so it doesn't cost another debugging pass.

**Still deferred:** gas/tank (`DC_SAMPLE_GASMIX` + `DC_FIELD_TANK`) — the
one remaining fidelity gap vs. a UDDF-imported dive. Same shape of task as
this one (libdivecomputer already parses it, `download.c` just doesn't
extract it yet), not picked up in this pass since it wasn't in scope.

## §18. Primary gas mix extraction — 2026-07-15 session (same-day follow-up)

Prompted by a user question worth recording verbatim, because the
reasoning chain is the actual finding: *"the NDL calc in the computer is
working off the gasmix, which means that gasmix should also be stored per
dive... can we pull that info in?"* — correct inference, and confirmed
directly against `shearwater_predator_parser.c`: the gaschange block sits
two lines above the deco/NDL block already investigated in §17, reading
raw O2/He bytes (`data[offset+pnf+7]`/`+8`) the same way. `DC_FIELD_GASMIX_COUNT`
+ `DC_FIELD_GASMIX` (a per-dive summary query, same pattern already used
for `DC_FIELD_MAXDEPTH`/`DC_FIELD_DIVETIME`) is the right extraction
point — not per-sample gas-change tracking, since a dive object's `gas`
field is inherently single-valued.

**Scope decision — index 0, not "active at t=0":** libdivecomputer's
gas-mix table index 0 is whichever mix the device lists first, which is
the back/start gas for the overwhelming common case and matches the
UDDF parser's own fallback ("first tank, absent explicit switch info").
A genuine multi-gas dive would get whichever mix is listed first, not
strictly the one breathed at the very start — an honest approximation,
not a bug, and moot for this diver's data: zero gas switches occurred
anywhere in the 96-dive history (consistent with zero deco stops, §17).

**Zero new JS logic:** classification from raw `{o2, he}` fractions into
Shoal's fixed vocabulary (Air/Nitrox NN/Trimix) already exists —
`_gasMixLabel()` in `js/profile.js`, built for the UDDF path. `download.c`
emits raw fractions; `_assembleDive` calls the same function UDDF imports
already call. No duplicated classification logic between the two import
paths.

**Validation — this time WITH real independent ground truth:** unlike
NDL (§17), the "All dives.uddf" export genuinely carries gas mix data (6
distinct EANx `<mix>` definitions, linked per-dive via `<tankdata>`) — so
`run-download-test.mjs` could cross-check exactly, not just eyeball
plausibility. Result: **96/96 dives, 100.0% exact o2/he match** against
the UDDF ground truth. Meaningfully stronger confirmation than §17's NDL
validation, and by extension further corroborates that NDL extraction
(read via the structurally identical technique, same file, adjacent
lines) is sound too.

**Still deferred:** tank size/pressure (`DC_FIELD_TANK`) — filling
`tanksize`/`pstart`/`pend`, which the UDDF path derives from the same
`<tankdata>` element gas mix comes from. Same shape of task again; not
picked up here since the user's ask was specifically gas mix.

## §19. Chart-side follow-up — NDL colour legend + live/locked-deco split, 2026-07-16

Not a BLE-sync change (the shared `renderProfileChart` path serves both
BLE and UDDF-imported profiles identically) — recorded here only as a
pointer, since §17 shipped the raw NDL/deco data this work then made
legible. Live-testing the §17 data surfaced three chart issues: a
placeholder NDL=0 on the first pre-depth waypoint was misread as
"entered deco at t=0" on every dive; live-reversible danger (0–10min
NDL) and one-way-locked deco shared one colour, making a real recovery
indistinguishable from a genuine lock; and the curve's colour had no
key anywhere in the UI. Fixed, plus the thresholds recalibrated to
Luke's own stated reference points and a colour-interpolation parsing
bug (silent fallback to black) fixed along the way. Full design record
in DECISIONS.md → "NDL colour legend + live/locked-deco split — v2.9";
shipped design in CLAUDE.md → "Depth/time chart".

## §20. Option A / iOS re-verification — 2026-07-21 session

Triggered by a separate line of work (`BRIEF-ios-sync.md` §12–§14): Phase 3 of
iPhone support reconsidered CloudKit in favour of a native Tauri iOS shell,
which would make this brief's **Option A the live path for BLE sync on
iPhone**, not just a documented fallback. This session re-checked Option A's
transport choice specifically — `tauri-plugin-blec` — against that
possibility. **Nothing here changes Option B or the Android MVP** (§7a/§8
stand exactly as they were); it only firms up what §11 had already flagged as
"residuals."

### Licensing — clean, now recorded in §5

`btleplug` (the Rust crate `tauri-plugin-blec` wraps): BSD-3-Clause / MIT /
Apache-2.0. `tauri-plugin-blec` itself: MIT OR Apache-2.0. Both fully
permissive — checked specifically against the same bar Shoal's ffmpeg
sidecar was held to (no GPL anywhere in the chain, §5). No licensing
obstacle to Option A at all.

### Maturity — real, not yet first-class

Tauri 2's iOS support has been stable since its v2.0.0 release (October
2024); Tauri's own team describes it as production-usable, but explicitly
not marketed as "first-class" alongside desktop, and **not every desktop
plugin has an iOS port yet** — nothing here should be assumed to carry over
from the existing (Android-only, browser-based) Option B work just because
the desktop Tauri shell already works.

`tauri-plugin-blec` itself: a real, working example exists (scans, connects,
sends/receives data — the same basic shape `js/computer-sync.js`'s Web
Bluetooth transport already implements for Option B). Documented iOS setup
matches what §7b already recorded (CoreBluetooth framework in the generated
Xcode project, `NSBluetoothAlwaysUsageDescription` in `Info.plist`). Two
things §7b didn't have on record: it's **pre-1.0** (v0.12, "active
development," not declared stable), and **its own maintainer notes
iOS-specific code-signing problems** — severity unconfirmed from what's
publicly documented. Neither is disqualifying on its own; both are exactly
what a spike should resolve before Option A is trusted for real, rather than
assumed either way.

### A second candidate checked, and rejected as unverifiable

`tauri-plugin-bluetooth` (26F-Studio) surfaced in search results as possibly
"Web Bluetooth API compatible" — which would matter more here than it did for
Option B's own transport question, since it raised the hope of a smaller
adapter layer onto an existing shape. Checked directly: fetching the actual
README turned up essentially no real documentation, just a title.
MIT-licensed, has `ios/`/`android/` directories so iOS support is at least
attempted, but the compatibility claim is unconfirmed and shouldn't be relied
on without reading its source directly — not done this session, out of scope
for a first pass. `tauri-plugin-blec` remains the only credible candidate.

### Confirms, doesn't change, this brief's existing architecture

Worth stating plainly, since out of context this could look like new
information contradicts §6/§7b — **it doesn't.** §6 already established that
Option A means a genuine *native* build of libdivecomputer (via
`bindgen`-generated Rust FFI), not reuse of Option B's WASM module. This
session's finding that `tauri-plugin-blec`'s API is a custom shape
(`connect(address, callback)`, `sendString(uuid, data, mode)`), not
Web-Bluetooth-shaped, would only have mattered if Option A had ever been
assumed to somehow reuse Option B's WASM-plus-Web-Bluetooth-shim
architecture. **It was never designed that way** — §7b's
`dc_custom_open()`-bridged-to-`btleplug`-via-a-dedicated-thread design
already sidesteps this entirely, and needs no revision. The real news this
session is the licensing confirmation, the maturity/signing caveats, and the
second-plugin rejection — not a change of architecture.

### Next step, unchanged in kind from §11, sharper in scope

A small, scoped spike — a bare Tauri-iOS project, `tauri-plugin-blec` wired
in, talking to one real dive computer over BLE (the same Peregrine used
throughout this brief) — would resolve, cheaply and before any larger
commitment: whether the signing issue is real, and whether Option A's
existing native-compile design (§7b) builds and runs on-device as designed.
**Not scheduled** — per §12 ("When to build"), this stays behind the chart,
then UDDF-in-real-use, then Option B's own Android MVP landing first.

## §21. BLE sync built into the Tauri shell — 2026-07-22 session

**Status: built, compiles, protocol path validated against the real
transcript. Not yet run against live hardware in the shell** — that's the
one remaining step, and it needs a Peregrine and a `cargo tauri build`.

Requested directly ("build BLE into the tauri app"). This closes the gap
where Bluetooth sync existed only in Chrome/Edge and the desktop app —
Luke's own primary environment — had the button hidden.

### What this changes about §7a/§7b

The A/B framing in §7 was: Option B is browser-only Web Bluetooth + WASM;
Option A is a native build of libdivecomputer with a native BLE stack. This
session found that the shell needs **neither of those as written**. It needs
Option B's *protocol* engine with Option A's *transport* — which §6 always
implied was possible ("the A/B choice is a packaging decision"), but which
neither §7a nor §7b describes as a shape, because when they were written the
WASM module didn't exist yet and there was nothing to reuse.

So the shell runs a third arrangement:

```
Tauri shell (WKWebView)
  src-tauri/src/ble.rs   ← btleplug: scan / connect / subscribe / write
        ⇅  tauri::ipc::Channel (one notification = one message, ordered)
  js/computer-sync.js    ← same packet queue, same everything downstream
        ⇅  globalThis.dcTransport (unchanged contract)
  libdivecomputer.wasm   ← same module, now Asyncify instead of JSPI
```

**§7b is not superseded** — it remains the design for a genuine native
libdivecomputer build, which is still the right answer if the WASM module
ever needs to leave the webview entirely. It is now much less likely to be
needed: the reason §7b existed for the iOS phase was the assumption that a
native shell implies a native protocol build, and that assumption turned out
to be false.

### The blocker was JSPI, not Bluetooth

`vendor/libdivecomputer-wasm/` was built with `-sJSPI`, which is
Chromium-only — WebKit shipped it in Safari 27 **beta** (WWDC26, June 2026),
so no released WKWebView has it. Rebuilt with `-sASYNCIFY` (§7a's own named
fallback), which is engine-agnostic. Full rationale, the three options
weighed, and the two contract changes Asyncify forced are in DECISIONS.md →
"BLE sync in the Tauri shell". The short version:

- **368KB → 616KB**, CPU overhead irrelevant against ~60ms-per-packet BLE.
- **Re-validated, not assumed:** 96/96 dives, 28,112/28,112 waypoints within
  0.3m (worst diff 0.00m), gas mix 96/96 exact, fingerprint cutoff 3/3 —
  identical to the JSPI build's recorded numbers.
- **Awaiting `factory()` is no longer the completion signal.** Under
  Asyncify it resolves when `main()` first *suspends*. Callers await
  `Module.onExit` (via `-sEXIT_RUNTIME=1`) instead. The first run after the
  switch reported "0 dives" with a perfectly working engine — a silent
  failure that looks exactly like a parsing regression.
- **A rejected write can no longer reach the WASM boundary.** Under Asyncify
  it would suspend the C stack forever instead of propagating. The write
  wrapper swallows failures and fails the packet queue, converting a cancel
  into the `DC_STATUS_TIMEOUT` path. New regression test —
  `run-cancel-salvage-test.mjs` — because §15 already lost dives on cancel
  once.
- **Bonus:** the harnesses no longer need Node v26 for
  `WebAssembly.Suspending`. Stock Node runs them.

### Transport: btleplug directly, revising §20's recommendation

§20 recommended a spike on `tauri-plugin-blec` before trusting it, flagging
it as pre-1.0 with maintainer-reported iOS signing issues. That spike is
moot: the plugin is a thin wrapper over `btleplug`, and using `btleplug`
directly removes both the pre-1.0 dependency and its signing question from
the critical path at no extra cost. It also matches how this repo already
calls ffmpeg — from its own Rust command, not through a plugin from JS.
§5's licensing clearance is unaffected (btleplug is BSD-3/MIT/Apache-2.0).

`ble.rs` is ~250 lines of pure async byte-pumping. **None of §7b's
sync-over-async machinery is required** — no dedicated OS thread, no
blocking channel reads — because the blocking C never left WASM.

Details worth not rediscovering:

- **`tauri::ipc::Channel`, not `app.emit()`.** Notification boundaries are
  protocol framing (§13/§14). Channels preserve boundaries and ordering.
- **RX/TX picked by GATT property flags**, not hardcoded characteristic
  UUIDs — same rule as the browser path, same reason (Subsurface's
  `qt-ble.cpp` hardcodes none either).
- **The service UUID list stays in `js/computer-sync.js`** and is passed
  into `ble_scan`. Rust holds no second copy to drift.
- **`ScanFilter` results are re-checked in Rust.** CoreBluetooth returns
  peripherals it already knows from other apps' scans, so without the
  re-check a pair of AirPods can land in a dive-computer picker.
- **No OS chooser exists natively.** One device auto-connects; several
  render an inline picker in the existing status area — deliberately not a
  modal, matching the profile-review list's own reasoning (§ "Two entry
  points"), and a path one diver with one computer never sees.
- **`NSBluetoothAlwaysUsageDescription` is mandatory**, not polish: macOS
  11+ *kills* an app that touches CoreBluetooth without it, with no prompt.
- **`tauri.conf.json` needed `'wasm-unsafe-eval'`** in `script-src`. The web
  `_headers` had it; the shell's separate policy had been missed, and would
  have blocked the module in the packaged app only — dev unaffected, the
  same class of trap as the CSP-nonce one already recorded in DECISIONS.md.
- **The capability gate calls `ble_available`**, which probes for a real
  adapter — Bluetooth switched off hides the button rather than offering a
  tap that fails. `isShell()` alone would have been wrong.

### What's verified, and what isn't

| Verified | How |
|---|---|
| Asyncify parses identically to JSPI | Full harness vs. real 96-dive transcript |
| Cancel still salvages downloaded dives | New `run-cancel-salvage-test.mjs` |
| Fingerprint cutoff still engages | `run-fingerprint-cutoff-test.mjs`, 3/3 |
| Rust builds and links against CoreBluetooth | `cargo build`, clean |
| JS parses, no stale Web-Bluetooth identifiers | `node --check` + scan |

| NOT verified | Needs |
|---|---|
| Live pairing/download in the shell | A Peregrine + `cargo tauri build` |
| macOS Bluetooth permission prompt copy | First run of a packaged build |
| Multi-device inline picker | Two advertising computers |
| Chrome/Edge web path still works end-to-end | A browser regression pass — the transport refactor touched shared code |

The last row matters most: the web path was refactored, not left alone, so
it needs a live re-test even though nothing about its behaviour was meant to
change.
