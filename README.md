# Shoal

A marine life log for scuba divers — built by a recreational diver who dives
primarily in the UK and Southeast Asia. Every creature you've seen, tagged to
the dive, the site, and the trip, with a full BSAC-format dive log
underneath. Offline-first, no backend, no build step. Optionally syncs to a
local folder or an Obsidian vault, and is being built toward OBIS/Darwin Core
citizen-science export. Runs as an installable PWA (desktop and Android
Chrome/Edge — including folder sync via Android's Storage Access Framework
and BLE dive-computer sync, both verified on real hardware) and as a native
macOS desktop app (Tauri).

The PWA is live at **[app.diveshoal.com](https://app.diveshoal.com)** — a
custom domain on Cloudflare Pages, deployed from this repo.
**[diveshoal.com](https://diveshoal.com)** (root) is a *separate* marketing/
landing deployment built from the same repo (`landing/`, its own Pages
project) — see *Repository map* below. diveshoal.uk's role since the domain
flip is still an open call.

This README is the **onboarding hub** — start here.

---

## Why this exists

Most dive-logging tools force a choice: serious logging with marine life as an
afterthought (Subsurface, MacDive), or a species encyclopedia with a shallow
log bolted on (Seabook, OceanScout). Shoal tries to be both properly — a real
BSAC-format log (conditions, gas, SAC rate, dive-computer profile import) with
a 1,275-species offline database (photos + IUCN conservation status) as a
first-class part of every dive, not a tag.

The other deliberate choice: **no server, no database, no account.** Every
dive is a `.md` file with YAML frontmatter, sitting in a folder you control.
If Shoal disappears tomorrow, your dives don't — you can read them in any text
editor.

---

## Architecture at a glance

`index.html` is a ~1150-line HTML shell — `<head>`, panel/modal markup, and
two small inline `<script>` blocks: a theme/dark-mode boot flag right after
`<meta name="theme-color">` (must run before first paint, so it can't live in
a `<script src>` loaded near the bottom of the document) and a short
post-load init block near the end (`migrateAbundance()`, dive-# autofill,
etc.). Neither is a boot script in the app-state sense — that lives in
`js/app.js`, see *Code map* below. All CSS is in `css/styles.css`; all JS is
in `js/*.js`; the species database is in `data/species-db.js`. Classic
ordered `<script src>` files sharing one global scope, no build step, no npm,
no framework.

There is **no build system, no linter, no framework, and no test suite/CI** —
but see *How to verify a change* below: two real Node scripts do cover real
logic with real assertions, they're just run by hand. The live app runs at
app.diveshoal.com; for local dev, open `index.html` via a local HTTP server
(see below) rather than `file://` — the service worker needs an `http(s)`
origin.

---

## Run it locally

For local dev only — the live app is already running at app.diveshoal.com. A
local server is needed because the service worker requires an `http(s)`
origin (`file://` won't register it):

```bash
cd dive-log
python3 scripts/dev-server.py 8080
# open http://localhost:8080
```

Any static server works; Python is just the zero-dependency default (it's
also what `.claude/launch.json` uses).

## How to verify a change (no test suite, no CI — but not nothing)

There is no build, linter, or test *framework*. There are two real Node
scripts with real assertions, run by hand — everything else is verification
by reading and by hand-testing in a browser:

1. **Syntax-check the JS files** (catches unbalanced braces / template literals):

   ```bash
   # macOS JavaScriptCore — check each extracted JS file:
   for f in js/*.js data/species-db.js; do
     /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc "$f" 2>&1 \
       | grep -i syntaxerror && echo "↑ $f" || true
   done
   # No output = all files parse clean.
   # (Runtime ReferenceErrors for `localStorage`, `dives`, etc. are expected
   #  outside a browser — only SyntaxErrors indicate real breakage.)
   ```

2. **Run the two real test scripts, if you touched footage-matching or video
   refs:**

   ```bash
   node scripts/test-footage-match.mjs   # 22 assertions — ISO-BMFF box walk,
                                          # dive-window matching, timezone independence
   node scripts/test-video-refs.mjs      # 25 assertions — proxy/original ref
                                          # resolution, same-filename-two-folders collision
   ```

   Both load the real source file under test (`js/footage-match.js`) and
   assert against it directly — not a mock rewrite of the logic. Nothing
   else in the repo has this level of coverage; most changes rely on step 3.

3. **Manual testing in a browser**, including a real phone for mobile/PWA
   behaviour and Android-specific paths (folder sync, BLE) — those can only
   be verified on real hardware, not in a desktop browser. Visual changes are
   self-tested by hand. Design changes are prototyped as standalone mockups
   first (see *Design workflow* below).

## Deploy

Edit locally → commit → push → **Cloudflare Pages** auto-redeploys the
`dive-log-55i.pages.dev` origin in ~30 s, which serves **app.diveshoal.com**
(the PWA — see the domain-flip note above). No CLI/CI. **`diveshoal.com`
itself is a separate Pages project** built from `landing/` in this same repo
— pushing to `main` redeploys both, but they're two independent Cloudflare
projects, not one origin serving two domains. Commit subjects describe what
changed, not a bare version number; version numbers live in `CHANGELOG.md`
(see below), stamped on when a batch of `[Unreleased]` work is called done.

**Before each commit:** update `CHANGELOG.md`. The convention (and the
explicit trigger that drives it) is documented in `CLAUDE.md → Changelog
discipline`. In practice: tell the assistant you're ready to commit and it
moves the `[Unreleased]` notes into a dated, version-stamped section.

---

## Repository map

| Path | What it is | Authoritative for |
|---|---|---|
| `index.html` | App shell — `<head>`, panel/modal HTML, modals, mobile nav. No function definitions; app boot lives in `js/app.js`. | HTML structure |
| `css/styles.css` | All styles — `:root` colour tokens + type scale + all component CSS | all styling |
| `data/species-db.js` | The 1,275-species `SPECIES_DB` array | species reference data |
| `js/*.js` | Per-subsystem JS, classic ordered `<script src>`, all functions global. See code map below. | per-feature logic |
| `vendor/leaflet/`, `vendor/scuba-physics/`, `vendor/libdivecomputer-wasm/` | Vendored third-party code (no runtime npm deps) — each has its own `LICENSE`/provenance | map library; surface-interval deco engine; BLE dive-computer protocol parsing (compiled from libdivecomputer, see its own README.md) |
| `src-tauri/` | Tauri shell — **both** the macOS desktop build and the Android build target share this one Rust project. Web build stays the source of truth; differences gated on `isShell()`/`isAndroidShell()`/`isDesktopShell()`. `src/androidfs.rs` (SAF folder sync — pick/read/write/delete on Android content URIs) and `src/ble.rs` (BLE dive-computer sync via `tauri-plugin-blec`) are Android-specific; `src/gdrive.rs` handles Drive OAuth for both platforms via different flows (desktop loopback listener vs. Android deep-link). Bundled app is named "Shoal" (`tauri.conf.json` → `productName`); the bundle
identifier stays `com.brookius.divelog` — that one's invisible to users and
changing it would reset Gatekeeper trust / any signing continuity for
existing installs, so it's deliberately left alone. Proxy generation (ffmpeg) is **parked** — code retained but not bundled or built; see `CLAUDE.md` → "Footage sidecar" | desktop + Android platform code; Admiralty tides (desktop-only) |
| `webdist/` | Generated web-asset copy for the Tauri build (`prepare-web.sh`), git-ignored | — (build output, not source) |
| `sw.js`, `manifest.json` | Real PWA files | offline / install |
| `_headers` | Cloudflare Pages CSP + security headers for the **app** deploy | deployed HTTP headers (app) |
| `landing/` | A **separate** Cloudflare Pages deployment (marketing site + privacy policy) built from the same repo — its own `_headers`, own domain binding (`diveshoal.com`), no shared origin with the app's service worker. `landing/prepare-shared.sh` regenerates `landing/chart-math.js` and `landing/app-tokens.css` from the app's own `js/chart-math.js` and `css/styles.css` `:root` block, so the two deploys can't drift on shared colour tokens/chart maths — re-run it (or wire it as Cloudflare's build command for the landing project) after touching either source | the marketing site, kept in sync with the app's design tokens |
| `scripts/` | Species-DB enrichment/validation (`fetch-iucn.py`, `fetch-photos.py`, `fetch-species-regions.py`, `audit-photo-licenses.py`, `fix-duplicate-aphia-ids.py`, `validate-species-aphia-ids.py`) — run manually, not part of any build step. `test-footage-match.mjs`/`test-video-refs.mjs` are real Node test scripts with real assertions against `js/footage-match.js` (see *How to verify a change*). `scripts/libdivecomputer-wasm-spike/` is the libdivecomputer→WASM build pipeline (`download.c` + `build.sh` compile the vendored `vendor/libdivecomputer-wasm/` module; `run-download-test.mjs` replays a captured transcript for offline validation) | species DB IUCN status / photo enrichment / photo-licence auditing / AphiaID validation; footage-matching + video-ref test coverage; BLE dive-computer protocol module build |
| `.claude/skills/species-batch-expansion/` | Gitignored, local-only skill — the full procedure (+ a bundled merge script) for adding a new regional species batch or reconciling logged free-text species against `data/species-db.js` | reusable process, not app code |
| `robots.txt` | Blocks indexing of the Pages deploy | — |
| `CHANGELOG.md` | Human-readable per-version history | what shipped & when |
| `README.md` | This file — onboarding | how to run / navigate |
| `CLAUDE.md` | Architecture, data model, type scale, built/not-built | data model & conventions |
| `DECISIONS.md` | Every deliberate choice + rejected alternatives | **why** anything is the way it is |
| `CLAUDE colour UI.md` | Colour system v2 (3-class model) | **all colour usage** |
| `ROADMAP.md` | Future direction, parked ideas | what's next |
| `mockups/` | Standalone design prototypes | current design intent |
| `BRIEF-*.md` (repo root) | In-progress feature briefs, written before a non-trivial build starts | design intent for unshipped work |
| `briefs-archive/` | Briefs for features that have since shipped, kept for historical rationale | why a shipped feature looks the way it does |

**Reading order for a newcomer:** this README → `CLAUDE.md` (skim) →
`DECISIONS.md` (skim the headings; read fully before changing anything that
"looks wrong" — it probably isn't) → `CLAUDE colour UI.md` before touching
any colour.

---

## Code map

`index.html` is ~1150 lines: `<head>` with asset links + the theme-boot
`<script>`, `<body>` with the six panel shells
(`log`/`plan`/`history`/`species`/`stats`/`obsidian`) + modals + mobile nav,
and a short post-load inline `<script>` near the end. The caustics-shimmer
SVG filter is gone (feature removed alongside app-wide dark mode). App boot —
`dives[]` from `localStorage`, `acBootstrap()`, service worker registration —
lives in `js/app.js`, not inline in `index.html`. No function definitions
live in the HTML shell itself.

### JS files, in `<script src>` load order (all share one global scope)

| File | What it owns |
|---|---|
| `data/species-db.js` | `SPECIES_DB` — 1,275-entry species array (commonName, scientificName, aphiaId, group, photoUrl, iucnStatus, regions) |
| `js/autocomplete.js` | `acInput`, `acBlur`, `acKey`, `acBootstrap` — autocomplete cache engine for repeated fields |
| `js/map.js` | Leaflet map panel (`loadLeaflet`, `initMap`, `renderMapMarkers`, `destroyMap`) |
| `js/markdown.js` | `parseFrontmatter`, `frontmatterToDive`, `generateFrontmatter` — `.md` ↔ dive-object transforms |
| `js/obsidian.js` | Obsidian REST API sync, folder sync (File System Access API), device import, sidebar status |
| `js/stats.js` | `renderStats`, `calcSAC`, `sacClass`, chart rendering, activity view |
| `js/species.js` | `searchLocalSpecies`, `GROUP_EMOJI`, `BROWSE_GROUPS`, `iucnBadge`, species browse mode, `onSpeciesInput`, `addSighting`, `renderSightings`, `migrateAbundance`; **custom-species registry** (`customRegistry`, `resolveCustomId`, `_backfillRegistry`) for free-text sightings; **`exportUnvalidatedSpecies`** (Settings & data — CSV export of every sighting never matched to `SPECIES_DB`, for reconciliation against the database); **mobile species overlay** (`showMobileSpeciesPicker`, `closeMobileSpeciesPicker`, `_msp*`); form browse panel (`_renderFormPanel`) |
| `js/history.js` | Timeline rendering — trip/depth/country sort views, `renderHistory`, `renderDiveDetail`, species carousel, `ddTab`, trip/flat/country groupers |
| `js/app.js` | App boot, state (`dives[]`, `sightings[]`, `syncMode`), `saveDive` (new-dive + edit-merge branches, armed via `armDelete` — see below), `show()` + hash routing (`goPanel`, `PANEL_HASHES`) + overlay view-stack (`_pushOverlayState`, `closeTopOverlay`, `_closeOverlayDirect`), **edit mode** (`openEdit` prefills the log form in place — no dirty-confirm guard, `_prefillLogFormFromDive`, `_clearEditMode`, `cancelEdit` — replaced the edit modal, v2.83), `deleteDive` (behind the same `armDelete` two-click confirm guardrail — a generic `(btn, action, armedLabel)` helper despite the name, also used by Save), site search (Dive Vibe + Nominatim), GPS capture, mobile nav, folder sync (`setDiveFolder`, `syncFromFolder`, `getWritableFolderHandle`, `reconnectDiveFolder`), `exportAllDives`, `downloadMd`, service worker registration |
| `js/logform.js` | Log-form redesign wiring — dive-type chip grid, segmented toggles, vis/temp dials, weather icons, in-form Leaflet pin map + reverse-geocode, desktop two-column rail, manual coordinate entry (`lfToggleManualCoords`/`lfApplyManualCoords` — reveals lat/lng inputs alongside the live map via `lfSetPin`, distinct from the offline tile-failure fallback), and a mobile full-screen map picker (`lfOpenMapPicker`/`closeMapPickerDirect` — reparents the same `#f-mapbox` node into the overlay-stack, `_lfSetMapInteractive` toggles its drag/zoom handlers between the compact preview and full-screen contexts). Prefix-parameterised (`'f'` = log form; editing reuses this same form via edit mode, v2.83) |
| `js/footage.js` | Footage modal — video card list, stamp edit, species picker (desktop right-column grid + mobile overlay `#footage-mob-picker`), clip management |
| `js/video.js` | Footage sidecar I/O (`.footage.json` read/write, joined on `dive.uid`, never filename), proxy-folder scanning + URL resolution for playback, persistent transcode-progress widget. Proxy **generation** (ffmpeg) is parked — the code is retained here but unreachable from the UI |
| `js/footage-match.js` | Auto-match footage to dives by each video's own capture time (walks the ISO-BMFF `moov`/`mvhd` box tree — GoPro puts `moov` at the end, so a fixed-prefix read misses it), not by folder structure. Assign-only, nothing on disk is moved/renamed. Covered by `scripts/test-footage-match.mjs` |
| `js/chart-math.js` | Pure functions the dive-profile chart needs (`_hexToRgb`/`_hexLerp`/`_ndlColor`/`_smoothPathD`/`_niceStep`) — extracted so `landing/` can share them at build time instead of hand-copying (see `landing/` in *Repository map*) |
| `js/profile.js` | Dive computer profile import — `parseUddf`, physical-signature `matchToLoggedDive`, `.profile.json` sidecar I/O, bulk-add-from-UDDF; depth/time SVG profile chart (`renderProfileChart`) with NDL-headroom colour gradient + legend (`_ndlColor`, live-danger/locked-deco split) and safety/deco stop pills; gas-mix classification (`_gasMixLabel`, shared with `computer-sync.js`) |
| `js/computer-sync.js` | BLE dive-computer sync — Web Bluetooth pairing/transport, drives the vendored `libdivecomputer-wasm` module to stream dives (`syncFromBluetooth`), device-fingerprint incremental sync + cancel-safe salvage, `_assembleDive` (parses the WASM protocol output into the shared dive/profile shape), Bluetooth sync history UI |
| `js/album.js` | Species Album panel — `buildSpeciesIndex`, taxonomy-grouped thumbnails, profile modal, `_esc()` |
| `js/planner.js` | Plan panel — moon-phase tide calendar, location picker, Open-Meteo wind/sea, surface-interval calculator (vendored `scuba-physics`), desktop Admiralty tide times |

### CSS

`css/styles.css` — all styles. `:root` design tokens (colour system v2 + type
scale) at the top; then panel/form/history `.tl-*`/expanded card `.dd2-*`,
`.sp-*` (species), stats `.st-*`, footage modal `.fm-*`/`.vid-*`, species
picker `.sp-grid-*`/`.sp-cell-*`/`.fmp-*`, album `.alb-*`/`.spp-*`, mobile
`@media`. See `CLAUDE colour UI.md` before touching any colour token.

---

## ⚠️ Worktree hazard (read before editing)

Claude Code sometimes checks out a **git worktree** under `.claude/worktrees/`
on a separate branch. **All real work goes to the main repo working tree**,
which is what the local server and Cloudflare serve. Editing files inside a
worktree is a recurring trap — changes there are invisible to the running app
until merged. After pushing `main`, any active worktree can be reconciled with
`git reset --hard main` from inside it.

---

## Design workflow

Non-trivial UI changes are **prototyped as standalone HTML mockups in
`mockups/` first**, reviewed and approved, then integrated into the relevant
`js/`, `css/`, or `index.html` files. The `mockups/` folder contains a mix of
current-intent and superseded explorations — treat `DECISIONS.md` as the
tiebreaker for what actually shipped.

## Android

The PWA works on Android exactly like desktop — visit
[app.diveshoal.com](https://app.diveshoal.com) in Chrome/Edge and "Add to
Home Screen." Folder sync (via Android's Storage Access Framework, including
Google Drive folders) and BLE dive-computer sync both work there too, both
verified end-to-end on real hardware. There's a separate Tauri **Android
build target** in `src-tauri/` (see *Repository map*) sharing the same Rust
project as the macOS desktop shell, but no polished install flow or public
release exists for it yet — see `BRIEF-play-store-readiness.md` for what's
left before a Play Store listing.

## Install on Mac (Shoal desktop app)

A macOS desktop build wraps the same web app in a native Tauri shell, giving
you native folder access (no browser permission dialogs).

### Download

Grab the latest build from [diveshoal.com/downloads/Shoal.dmg](https://diveshoal.com/downloads/Shoal.dmg) —
published by `release.sh` (below), not GitHub Releases, since this repo is
currently private.

### First launch (un-notarized app)

Because the app is not notarized through Apple, macOS Gatekeeper will refuse
to open it with a double-click. One-time workaround:

1. Open `Shoal.dmg` and drag **Shoal.app** into Applications.
2. Try to open it — macOS will block it and show *"cannot be opened because
   the developer cannot be verified"*.
3. Go to **System Settings → Privacy & Security**, scroll down to the blocked
   app notice, and click **"Open Anyway"**.
4. Confirm in the dialog. The app opens and is trusted from that point on.

### Dev / build

**One-time setup, before the first build:** create
`src-tauri/gdrive-client-secret.txt`, containing just the Google Drive OAuth
client secret (Google Cloud Console → APIs & Services → Credentials → the
"Shoal Desktop" client). This is deliberately **not** committed —
`src-tauri/build.rs` reads it at build time and fails with an explicit error
if it's missing, rather than building against a stale or absent value. See
`DECISIONS.md` → "Google Drive OAuth" for why it's handled this way (the
short version: keeping it out of tracked source matters for an eventual
open-source release, independent of the — separately accepted — fact that
it's still embedded in the built binary itself).

```bash
echo 'GOCSPX-...' > src-tauri/gdrive-client-secret.txt
```

**Run in dev mode** (live-reload from the local HTTP server):

```bash
cd dive-log/src-tauri
~/.cargo/bin/cargo tauri dev
```

**Build a release `.dmg`:**

The build's `beforeBuildCommand` just runs `src-tauri/prepare-web.sh` (copies
web assets into `webdist/`) — no ffmpeg step. Proxy video generation was
parked 2026-07-25 (originals play fine in 4K, so the reason proxies existed
no longer held) and `externalBin` no longer bundles an ffmpeg sidecar at all.
The build script (`src-tauri/build-ffmpeg.sh`, compiling an LGPL-only ffmpeg
via Apple VideoToolbox — no GPL/libx264) and the transcode Rust command still
exist and work, deliberately left intact in case proxies are ever un-parked
(cloud hosting would be the reason); they're just not part of a normal build
or release anymore. See `CLAUDE.md` → "Footage sidecar" for the un-park
instructions if you need them.

```bash
cd dive-log
bash src-tauri/release.sh
# output: src-tauri/target/release/bundle/dmg/Shoal_X.X.X_aarch64.dmg
```

`release.sh` builds the Rust binary + bundles the `.app`, then calls
`create-dmg --skip-jenkins` (install once: `brew install create-dmg`).
The `cargo tauri build` dmg step is skipped because the Finder-prettifying
AppleScript it uses requires a GUI session permission grant that the terminal
doesn't have.

It then copies the built `.dmg` to `landing/downloads/Shoal.dmg` and writes
`landing/downloads/latest.json` (`{version, url}`), reading the version
straight from `src-tauri/tauri.conf.json` — bump that version field before
running a release you intend to actually publish. Both files feed the
landing page's Mac download link **and** the desktop app's own in-app update
check (`checkForAppUpdate()`, `js/app.js`) — commit and push
`landing/downloads/` to make a build the one the update check and the
download link both point at.

---

## Working with the sync layer

To exercise Obsidian sync you need Obsidian + the **Local REST API** plugin
(Adam Coddington), HTTP endpoint `http://127.0.0.1:27123` (not HTTPS — see
DECISIONS.md), optional Bearer API key. The plugin is **desktop-only**; on
mobile the workflow is localStorage → `.md` export → Proton Drive → Mac
vault. Full rationale in `CLAUDE.md` / `DECISIONS.md`.

---

## Contributing

Contributions are welcome — see **[CONTRIBUTING.md](CONTRIBUTING.md)** before
opening a PR. The short version: no build step, no tests (verify by hand),
and `DECISIONS.md` is the tiebreaker for anything that looks like it should be
"fixed."

---

## Licence

Shoal is licensed under the **[GNU Affero General Public License v3.0](LICENSE.md)**.
In short: you're free to use, modify, and redistribute this code — including
running a modified version as a network service — as long as you make your
source available under the same licence. See `LICENSE.md` for the full text.

**If you redistribute a build, not just the source:** AGPL §6 means the
binary can't travel without the corresponding source. The published macOS
`.dmg` is built from this repository at the tag matching its version
(`src-tauri/tauri.conf.json` → `version`), so this repo *is* the source
offer — keep it that way if you fork and ship your own builds.

`LICENSE.md` ships inside the app bundle as well as living here, and is
readable in-app at **Settings → About Shoal → Licence** (AGPL §5(d)'s
"Appropriate Legal Notice" for a GUI program).

---

## Credits & data sources

Full attribution for everything bundled — including each licence in full —
is in **`THIRD-PARTY-NOTICES.txt`**, which ships inside the app and is
readable at **Settings → About Shoal → Open-source licences**. That file is
**generated**, never hand-edited: run `python3 scripts/gen-third-party-notices.py`
from the repo root after changing `src-tauri/Cargo.toml`/`Cargo.lock`,
anything under `vendor/`, or the bundled `fonts/`. It derives the crate list
from the real resolved dependency graph, so it can't silently drift.

- **[Leaflet](https://leafletjs.com)** (vendored, `vendor/leaflet/`) — BSD-2-Clause.
- **[scuba-physics](vendor/scuba-physics/)** — vendored Bühlmann ZHL-16C deco
  engine; see its own `README.md`/`LICENSE` for provenance.
- **[libdivecomputer](https://www.libdivecomputer.org/)** (compiled to WASM,
  `vendor/libdivecomputer-wasm/`) — LGPL; see its own `README.md`/`LICENSE`.
- **Species photos** via the [iNaturalist](https://www.inaturalist.org) open
  data bucket — CC-licensed only (`inaturalist-open-data.s3.amazonaws.com`).
- **Taxonomy** (AphiaIDs) from the **[World Register of Marine Species
  (WoRMS)](https://www.marinespecies.org)**; species regional distribution
  data from **[OBIS](https://obis.org)**.
- **Conservation status** from the **[IUCN Red List](https://www.iucnredlist.org)**
  (see [iucnredlist.org/about/cite](https://www.iucnredlist.org/about/cite)
  for their citation format). Personal/non-commercial use of this data is
  free; see IUCN's own terms before any commercial use.
- **Map tiles** from **[OpenStreetMap](https://www.openstreetmap.org/copyright)**
  — © OpenStreetMap contributors, ODbL. Fetched at runtime, not bundled.
- **Fonts** — [Figtree](https://github.com/erikdkennedy/figtree),
  [Literata](https://github.com/googlefonts/literata) and
  [Young Serif](https://github.com/noirblancrouge/YoungSerif), all under the
  SIL Open Font License 1.1 (`fonts/LICENSE-OFL.txt`).
- **Rust/Tauri dependencies** — ~360 crates, overwhelmingly MIT/Apache-2.0;
  enumerated with their copyright notices in `THIRD-PARTY-NOTICES.txt`.
