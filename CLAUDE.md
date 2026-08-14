# Shoal — Project Brief

## What this is

**Shoal** — a BSAC-format scuba dive logging PWA built by Luke, a recreational diver who dives primarily in the UK, or Southeast Asia. It started as a single HTML file and is now a modular app served from a custom domain.

The app has three purposes:
1. **Field logging** — log dives on a phone (Android PWA) without internet
2. **Data management** — sync logged dives to a local folder or an Obsidian vault (see "Data layer" below — folder sync is Luke's actual day-to-day path now)
3. **Citizen science** — export marine life sightings in OBIS/Darwin Core format for submission to ocean biodiversity databases

---

## Current architecture

The modular migration is largely complete. `index.html` is now a ~650-line HTML shell + inline boot script. All CSS, JS, and data live in separate files. For the full repo map and how-to-run instructions see **`README.md`**. For colour system details see **`CLAUDE colour UI.md`** (v2).

### Folder structure (actual)
```
dive-log/
  index.html          — HTML shell (~650 lines) + inline boot script
  css/
    styles.css        — all styles; :root tokens at top
  js/
    autocomplete.js   — AC cache + dropdown engine
    map.js            — Leaflet map (loadLeaflet, initMap, renderMapMarkers, destroyMap)
    markdown.js       — parseFrontmatter, frontmatterToDive, generateFrontmatter
    obsidian.js       — Obsidian REST API sync + device import + sidebar status
    stats.js          — stats panel + chart rendering, SAC calculation
    species.js        — species search/browse, sighting list, IUCN badges
    history.js        — history/timeline rendering, sort state, renderDiveDetail
    app.js            — core state + boot sequence + show() + edit/delete/save
    logform.js        — log-form redesign wiring: dive-type chip grid,
                         segmented toggles, vis/temp dials, weather icons, the in-form
                         Leaflet pin map + reverse-geocode, desktop two-column rail.
                         Prefix-parameterised ('f' = the log form — the only prefix
                         left since the edit modal retired in v2.83)
    footage.js        — video footage modal
    album.js          — Species Album: index, panel, thumbnails, profile modal, map, search
    video.js          — footage proxy generation (browser one-liner / Tauri ffmpeg sidecar)
    footage-match.js  — auto-match footage to dives by the video's own capture
                         time (ISO-BMFF moov/mvhd box walk), Settings & data
    planner.js        — Plan panel: moon-phase tide calendar, Open-Meteo wind/sea,
                         surface-interval calculator, desktop Admiralty tide times
  data/
    species-db.js     — 1,275-species SPECIES_DB array
  vendor/
    leaflet/          — map library, vendored (no runtime third-party code)
    scuba-physics/    — Bühlmann ZHL-16C engine, vendored (see its own README.md
                         for provenance/licence — not on npm, compiled from source)
  manifest.json
  sw.js               — service worker (cache version bumped whenever a shell
                         file changes — see "Adding a new JS file" below)
  robots.txt
  src-tauri/          — macOS desktop shell (Tauri) — see "Known constraints" below
```

All JS files use classic `<script src>` tags — **no ES modules**. Functions are global; inline `onclick` handlers work unchanged. Load order matters: each file can call globals defined in files loaded after it only at call-time (not at parse-time).

### Data layer
- **Primary store:** `.md` files with YAML frontmatter, written by whichever sync backend is active — **Folder sync (File System Access API / native Tauri `fs`) is Luke's actual day-to-day path** (as of 2026-07); Obsidian's Local REST API sync is kept available as an alternative but is rarely used in practice now that folder sync is reliable. Both write the identical file format, so nothing about the data model itself depends on which one is active.
- **Local cache:** `localStorage` — used as fallback when the active sync backend is offline; **primary store on mobile**
- **No server, no database, no backend** — browser-only, must stay that way

### Folder sync (the primary path in practice)
The mechanism behind "Folder" mode in Settings & data. Two implementations
behind the same UI, gated on `isShell()`:
- **Browser / Android (Chromium M132+):** File System Access API. A picked
  `FileSystemDirectoryHandle` is persisted in IndexedDB (`saveFolderHandle`/
  `loadFolderHandle`/`_folderHandleCache`, `js/app.js`); `getWritableFolderHandle()`
  re-requests write permission on every use since it isn't guaranteed to
  survive a reload. See "Known constraints" below for the full permission-
  reversion story and the "Folder sync disconnected" → `reconnectDiveFolder()`
  recovery flow.
- **Tauri desktop shell:** native Rust `fs` commands, with the folder path
  itself stored in `localStorage['divelog-shell-vault-path']`. The picker
  (`setDiveFolder()` → `invoke('pick_folder', ...)`) passes that existing
  path as `default_path` when one is already set — the shared native folder
  dialog has no per-purpose isolation, so without this a `.uddf` file picked
  from Downloads (a totally unrelated `<input type=file>` dialog) can leave
  the *next* folder-picker invocation defaulting to Downloads too, silently
  repointing sync at the wrong folder. See DECISIONS.md → "Tauri folder
  pickers need an explicit `default_path`".

**Sidecar loading is listing-first on SAF, never per-dive probing (2026-08-01).**
`loadAllSidecars` (`js/video.js`) and `loadAllProfileSidecars` (`js/profile.js`)
both used to ask the backend for `<basename>.footage.json` /
`.profile.json` once per dive and treat a failure as "no sidecar". On a local
folder that's free. On a **Drive-backed** SAF folder it is pathological: every
probe is a network request through Google's DocumentsProvider, a **miss costs
exactly as much as a hit**, and most dives have neither sidecar — so a 94-dive
vault spent ~190 round trips discovering nothing. Measured on hardware:
**119.5 s before, 62.5 s after (−48%)**. Both loaders now call `android_list_filenames`
(`src-tauri/src/androidfs.rs`) once and read only names that are actually
present — the same strategy the Obsidian branch of both functions has always
used, which is why the fix was a port rather than an invention. A failed
listing falls back to the old probing rather than returning early: slow beats
silently loading no footage. **Any new per-dive backend read on Android wants
this shape** — assume the folder is remote, because it usually is.

**`android_list_md_files` is now incremental (2026-08-01), for the same
reason the sidecar fix above was needed.** It used to read all 94 `.md`
files' content sequentially on *every* sync, including the one fired at every
boot — so a launch re-downloaded the entire vault from Drive to learn what it
almost always already knew, measured at 62.5 s of the 119.5 s baseline even
after the sidecar fix. It now accepts an optional `since_ms` cursor and skips
the `read_to_string` call entirely for any file whose SAF-reported
`last_modified` isn't newer than it — a routine "nothing changed" sync
becomes zero content reads. The cursor is the newest `last_modified` the call
itself observed, never `Date.now()`, so it's immune to clock skew between the
phone and whatever clock the SAF provider stamps files with — the comparison
never crosses clocks. JS keys the stored cursor on the folder's own `uri`
(`_androidFolderSyncCursor`, `js/app.js`), not a bare timestamp, so picking a
*different* folder can't compare against a stale cursor from another one —
no reset logic needed elsewhere; a mismatched `uri` just reads back as no
cursor and `syncFromFolder` does a full read, exactly like a first sync.
Reconnecting to the *same* folder after a lapsed grant keeps its cursor warm
on purpose, since nothing about the files changed, only the app's permission
to see them.

**Measured on hardware (2026-08-01): a "nothing changed" sync — the
overwhelmingly common case, including the one at every boot — dropped to
~400 ms, from 62.5 s.** Correctness was verified directly, not just inferred
from timing: one dive's `.md` was rewritten with identical content (bumping
only its `last_modified`) and a direct call to `android_list_md_files` with
the prior cursor came back with exactly that one file and none of the other
93. A sync of a **genuinely** changed file, through the full pipeline
(sidecar + profile listing, `importDivesFromFiles`, etc.), took 44.75 s on
one run — slow, but not because content-reading scaled with file count (the
isolated test above proves only the touched file's content was ever read);
the other pipeline steps hit Drive's own variable per-call latency, which
pre-dates this fix and isn't something `since_ms` filtering touches. The
overwhelming majority of syncs are the near-instant case, since most launches
find nothing changed at all.

**Google Drive's `last_modified` is eventually consistent — found live during
the correctness test above.** A `read_dir` call moments after a write can
still report the file's OLD mtime; the same call ~15 s later correctly showed
the new one. This can delay a very-recent edit by one sync cycle (the file
simply isn't newer than the cursor *yet*), never lose it — the next sync
observes the true mtime, which is still newer than whatever stale value the
cursor advanced to, so it gets picked up then. Worth knowing before treating
any single incremental sync as a guarantee that "everything current is now
local" on a Drive-backed folder specifically.

`writeToFolder(dive)` and `syncFromFolder()` are the read/write entry points,
mirroring `pushToObsidian`/`syncFromObsidian` in shape. `_cleanupOldDiveFiles`
(sidecar filename hygiene, below) and the footage/profile sidecar I/O all
work identically regardless of which backend is active.

### Obsidian integration
- Plugin: **Local REST API** by Adam Coddington
- Endpoint: `http://127.0.0.1:27123` (HTTP, not HTTPS — Brave blocks self-signed certs)
- Authentication: optional API key via Bearer token header
- `obsAvailable` boolean tracks connection state
- Sync is **manual-only** or **on app load** — never triggered automatically on panel navigation (race condition — see DECISIONS.md)
- Each dive is a `.md` file with YAML frontmatter + human-readable markdown body
- **Mobile limitation:** The Local REST API plugin does not support Android. Obsidian sync is a Mac-only feature. On mobile, the Obsidian panel should be hidden or replaced with the mobile import flow (see below).

### Proton Drive sync
Luke stores his Obsidian vault in Proton Drive. Files written to the vault folder are synced automatically. There is no Proton Drive API integration — files land there via Obsidian.

### Mobile data flow
Two paths, depending on browser:

**A. Folder sync — Android Chrome/Edge (Chromium M132+), recommended.** Set "Local folder" to a folder in the phone's Files app, *including a Google Drive folder*. Android's SAF makes Drive a writable provider, so every save writes a live `.md` (+ footage sidecar) straight into Drive → syncs to the cloud and onward to the Mac vault; reading the folder pulls back dives logged elsewhere. The OS does the cloud sync — no Drive API or OAuth.

> **Two things about Drive that this claim hid until it was tested on hardware
> (2026-08-01) — both user-visible, neither obvious from the API:**
>
> 1. **The Drive root refuses selection.** Tapping Drive in the picker lands on
>    a screen that rejects "use this folder" with *"Can't use this folder — to
>    protect privacy, choose another folder"*, and creating a folder there
>    fails too. You must open **My Drive** and go *inside* a folder first.
>    Android blocks tree grants at the root of a provider; it is not a Shoal
>    error and not something the app can route around
>    (`resolve_public_storage_initial_location` only addresses local public
>    storage, so the picker can't be pre-positioned inside Drive). Both the
>    first-dive prompt and Settings say this outright — see
>    `_applyAndroidSyncUI` (`js/app.js`).
> 2. **Every read is a network round trip.** A Drive-backed folder is not a
>    filesystem. A 94-dive vault took **119 s** to sync, almost all of it
>    per-dive sidecar probes that found nothing — see "Sidecar loading is
>    listing-first on SAF" below.



**B. Download-then-move — any browser, or Proton Drive.** Log → `localStorage` → "Save to device" downloads the `.md` → move it into a cloud app by hand → it syncs to the Mac vault → Obsidian reads it. Brave / Firefox / Safari and **Proton Drive** must use this path (Proton's E2E provider hides cloud-only files from folder sync).

For viewing full dive history on the phone (including dives logged on the Mac), an **"Import from device"** feature is needed — see the not-yet-built section below.

### PWA
- `sw.js` and `manifest.json` are real files in the repo root, referenced from `index.html`
- Live deployment: **`app.diveshoal.com`** — custom domain on Cloudflare Pages; the Pages project (`dive-log-55i.pages.dev`) is the origin. (`diveshoal.uk`'s role after the flip below is still an open call — see BRIEF-play-store-readiness.md.)
- **The marketing/landing site (`landing/`) is a SEPARATE Cloudflare Pages
  deployment** — its own `_headers`, own domain binding, no shared origin with
  the PWA's service worker. **Flipped 2026-07-30**: `diveshoal.com` (root) now
  serves the landing page (and the privacy policy), `app.diveshoal.com` now
  serves the PWA — the reverse of the original, backwards pairing. Pure
  Cloudflare custom-domain rebind, no code change required for the flip
  itself (each project's own `robots.txt` posture — app blocked, landing
  crawlable — travelled with it automatically). `landing/index.html`'s two
  "Try Shoal" CTAs are repointed to `https://app.diveshoal.com`.
- **Landing shares CSS tokens and chart maths with the app at BUILD time, not
  by hand-copying (v2.99).** `js/chart-math.js` holds the five pure functions
  `renderProfileChart` needs (`_hexToRgb`/`_hexLerp`/`_ndlColor`/
  `_smoothPathD`/`_niceStep`) — previously duplicated verbatim inside
  `landing/script.js`, which had already drifted onto a stale `--warn` value
  by the time this was caught. `landing/prepare-shared.sh` (same pattern as
  `src-tauri/prepare-web.sh`'s Tauri build) regenerates `landing/chart-math.js`
  (verbatim copy) and `landing/app-tokens.css` (the `:root` block extracted
  from `css/styles.css` — not the whole 5000-line file, since landing's own
  layout doesn't use the app's component classes) every time it runs.
  `landing/style.css` consumes the generated file via `@import` — **must
  stay the first rule in the file, `@font-face` included, or browsers
  silently ignore it** (this exact ordering mistake happened once while
  building this, caught by re-reading the CSS spec, not by testing). Both
  generated files are committed to git (not `.gitignore`d) so landing works
  even before the step below is configured; regenerate by re-running the
  script, or set Cloudflare's **landing** Pages project's Build command to
  `bash landing/prepare-shared.sh` so every push refreshes them automatically
  — **that one dashboard setting is still outstanding, not something this
  repo's contents can configure.**
- GitHub repo: **`Brookius/dive-log`** (private)
- Must work fully offline after first load
- Primary target: Android Chrome. iOS has PWA quirks, not a priority.

---

## Data model

### Dive object (in-memory / localStorage)
```javascript
{
  id: 1234567890,          // Date.now() for in-app dives, FILENAME-HASH for synced/imported
                           // ones — NOT stable across renames. Use for in-memory/DOM keying only.
  uid: 'dl_k9f3a2x',       // THE stable identifier (v2.38) — minted once, never derived,
                           // stored in YAML frontmatter. Cross-file references (footage
                           // sidecar) join on uid; renames can't break it.
  divenum: 128,            // user-assigned dive number
  date: '2026-05-06',
  site: 'Batu Balong',
  trip: 'Naga Biru May 2026', // trip grouping label — free text; stored in YAML frontmatter only
                           // groups consecutive dives from the same trip/liveaboard
                           // non-trip dives: leave empty — history groups by region as proxy
  region: 'Komodo',        // free text — e.g. "Komodo", "Gili Islands"
  location: 'Indonesia',   // country — dropdown (focuses the map) ⇄ pin reverse-geocode
  gps_lat: null,           // decimal degrees — map pin / "use my location" / manual
  gps_lng: null,           // decimal degrees
  watertype: 'Salt',       // Salt|Fresh|Brackish — segmented control
  vis: 15,                 // visibility in metres (dial, 0–30)
  temp: 28,                // water temp °C (dial, 0–35)
  current: 'Moderate',     // ''(None)|Slight|Moderate|Strong — segmented control
  weather: 'Sunny',        // enum at input (Sunny|Cloudy|Rain) but STORED as a free
                           // string — legacy free-text values ("Sunny, calm") still
                           // read/save; the icon picker just constrains NEW input
  depth: 20.5,             // max depth metres
  avgdepth: 12,
  time: 55,                // bottom time minutes
  entrytime: '09:15',
  exittime: '10:10',       // auto-calculated from entry + bottom time
  entry: 'Boat',           // dive type: Boat|Shore|Drift|Night|Cave|Wreck|Reef|Wall|Pinnacle|Muck
  liveaboard: 'Naga Biru', // operator name
  pstart: 200,             // start pressure bar
  pend: 50,                // end pressure bar
  gas: 'Nitrox 32',        // Air|Nitrox 29-35|Trimix|Other
  suit: '3mm',
  weight: 5,
  tanktype: 'Steel',       // Aluminium|Steel
  tanksize: 12,            // litres — used for SAC calculation
  buddy: 'Yasmine',
  title: '',               // optional short headline (max 50 chars); stored in YAML frontmatter; shown as glimpse in timeline
  notes: '',
  signoff: '',             // instructor/divemaster name
  certnum: '',             // instructor cert number
  safety_stop_depth: 5,   // metres — pre-filled default 5 m; null if not logged
  safety_stop_time: 3,    // minutes — pre-filled default 3 min; null if not logged
  deco_stop_depth: null,  // metres — deco stop depth; null = no-deco dive
  deco_stop_time: null,   // minutes — time at deco stop; null = no-deco dive
  marine: [                // array of sighting objects
    {
      scientificName: 'Chelonia mydas',
      commonName: 'Green sea turtle',
      aphiaId: 137205,
      group: 'Reptile',
      abundance: 'R',      // R (1-2) | O (a few) | C (many) — Seasearch R/O/C scale
                           // OBIS eMoF: R→1, O→5, C→20 as organismQuantity
      validated: true,     // matched against WoRMS via local DB
      customId: 'cs_k2a9'  // FREE-TEXT species only — stable key from the
                           // custom-species registry (custom-species.json +
                           // localStorage). Clip join key = scientificName || customId.
      // clips[] may appear in memory (merged from the footage sidecar at load,
      // legacy MD fallback) — but video data is NEVER written to the .md anymore.
    }
  ],
  videos: [ /* { file, modified, size, reviewed } — lives in the SIDECAR */ ],
  // profile: { source: 'uddf', computer, startedAt, waypoints: [{t,d,temp?}],
  //   events: [{t,type,depth?}], imported } — lives in the SIDECAR (.profile.json),
  // never in memory on the dive object itself; join is dive.uid via _profiles
  // Map (js/profile.js). See "Dive computer profile import" below.
  _filename: 'dive-128-batu-balong.md'  // set after first sync push — kept in sync
                           // with the canonical name (canonicalFilename(), app.js)
                           // on every subsequent save; a mismatch triggers a
                           // coordinated rename (see "Sidecar filename hygiene" below)
}
```

### Footage sidecar (v2.38 — video data lives OUTSIDE the dive .md)
One `<dive-basename>.footage.json` per dive with footage, beside the `.md` in the
vault/folder. Joined on `uid` (never filename). Holds `videos[]` and `clips`
keyed by `scientificName || customId`; each clip has `{time, note, sources[]}`
where sources are `{role: proxy|original, kind: local, ref}` behind the
`resolveVideoUrl()` seam (cloud kinds reserved). The nested-YAML clip parser in
`markdown.js` is FROZEN as read-fallback for legacy files; writes go
sidecar-only. `deleteDive` removes the sidecar too.

**Proxies: PARKED 2026-07-25 — generation removed from the app, code retained.**
Originals play fine in 4K, so the decode premise that justified proxies was
falsified (DECISIONS.md). The "Generate proxies…"/"📋 script" buttons are gone
and `binaries/ffmpeg` is no longer in `tauri.conf.json`'s `externalBin` (so the
shell stopped bundling a 21 MB encoder and compiling one at build time), but
`transcodeProxies()`, the Rust `run_transcode`, `build-ffmpeg.sh` and
`make-proxies.command` all still exist and work — see the parked header in
`js/video.js` for how to un-park. Cloud hosting is what would justify them again.
When they existed, proxies were 1080p re-encodes (identical timeline) landing in
a `proxies/` folder per trip. Video folders are pooled across
**all** connected folders: the shell remembers an **array** of folders
(`divelog-shell-proxy-paths`; "Connect" *adds*, never replaces), the browser uses
a single File System Access handle.

**Refs are root-qualified relative paths (v2.982)** — `Komodo-2026/dive-142/
GX010128.MP4`, where the first segment is the connected folder's own name (added
in JS; the Rust `scan_proxy_folder` strips the scan root entirely, so without
this two connected trip folders each holding `dive-1/GX010128.MP4` would still
collide). Resolution is two maps in `js/video.js`: `_proxyPathUrls` (relative
path → url) is primary; `_proxyUrls` (stem → url, **proxy-wins tie-break**) is
the fallback for legacy bare-filename refs and is still what answers "how many
videos can we see". `_resolveLocalUrl` tries path, then stem — so an exact path
resolves to that exact file, while a bare ref still finds a video's proxy (which
shares only its stem, not its path). `dive.videos[].path` holds the ref;
`dive.videos[].file` is unchanged and remains the join key for clips
(`sources[].ref`), dedup, the reviewed toggle and the video-list label.
Write-forward, no migration: `buildSidecarData` upgrades a clip's `ref` once the
path is known, and `_videoForRef` matches by path → filename → stem so old
sidecars keep resolving. Bare refs stay permanently valid — drag-and-dropped
files have no folder context and still produce them, and those remain ambiguous
by design (last scan wins). Covered by `scripts/test-video-refs.mjs`.
See BRIEF-footage-cloud-hosting.md §2.3.1 — this was the prerequisite for cloud
hosting, since a relative path means the same thing locally and in Drive.

### Sidecar filename hygiene (v2.76 — coordinated canonical renaming)
Sidecar **discovery** derives the expected `.footage.json`/`.profile.json`
name from the dive's `.md` filename (`_filename`), even though the *logical*
join is `uid`. So `.md` and its sidecars must always share a basename, or
discovery silently can't find the sidecar. `canonicalFilename(dive)`
(`js/app.js`) is the single source of truth for "what should this dive's
filename be right now" — `dive-${divenum}-${slugify(site)}.md`, collision-safe
(a `uid` suffix if another dive already holds that exact name). `writeToFolder`
and `pushToObsidian` compare it against the dive's recorded `_filename` on
**every** save (not just at creation): a mismatch — divenum or site changed —
triggers `_cleanupOldDiveFiles()`, which writes the full new set (`.md` +
sidecar, if one exists) under the new name, confirms it landed, **then** deletes
the old set. Never the reverse order, so a crash mid-rename leaves a harmless
duplicate (deduped by `uid` on next load), never an orphan. `_deleteBackendFile()`
is the shared three-backend (Obsidian REST / Tauri shell / browser File System
Access) delete primitive behind both this and `deleteDive`. See
`briefs-archive/v2.76-BRIEF-sidecar-filename-hygiene.md` for the full design
(including the optional, deliberately-unbuilt one-time repair pass for dives
that drifted before this landed, and the deeper uid-scan discovery guardrail).

### Dive computer profile import (v2.76 — UDDF, `js/profile.js`)
Never touches hardware/BLE — a third-party tool (Dive Exporter, Subsurface,
MacDive, or a vendor app) already did that and exported a **`.uddf`** file;
Settings & data → "Dive computer import" is where the user drops it in.
`parseUddf()` is namespace-agnostic (walks by `localName`, since some
exporters declare a default `xmlns` and some don't) and written directly from
the UDDF 3.2 spec, not a reference implementation. `<greatestdepth>` /
`<diveduration>` are read when present and otherwise derived from the
waypoints — these are the **primary match keys**, deliberately independent of
the file's own `<datetime>`, because a computer's clock can drift or reset
between charges while depth/time stay accurate. `matchToLoggedDive()` scores
every logged dive on depth+time (0.4 each) plus a small date-corroboration
bonus (0.2, added only if it agrees, never subtracted if it doesn't) and
auto-attaches on a clear winner — the exact bar depends on whether there's a
plausible runner-up at all (`AUTO_ATTACH_SCORE_SOLO` vs. `AUTO_ATTACH_SCORE`
+ `AUTO_ATTACH_MARGIN`; see the comment above `matchToLoggedDive` — this
asymmetry was found empirically via a synthetic-file test harness, not
guessed). Anything ambiguous renders as a lean inline pick-list (`#profile-review-list`
in Settings and/or `#lf-uddf-review` on the Log page — `_renderProfileReviewList()`
targets whichever exists in the DOM), not a modal — deliberately not wired
into the overlay view-stack, since it's a rarely-used flow that doesn't need
back-button integration. The profile sidecar (`.profile.json`) mirrors the
footage sidecar exactly — same three-backend I/O, same `_cleanupOldDiveFiles`
coordinated-rename coverage, same `deleteDive` cleanup.

**Two entry points, one matching engine.** Settings & data → "Add profiles to
dives you've already logged" only ever *attaches* a profile to a dive already
in history — a no-match dive is just skipped (with a hint to use the other
entry point). The Log-a-dive page banner ("Just dove?") runs the identical
match pass first (so re-importing never creates a duplicate), and only for
whatever has no existing match at all does it fall through to pre-filling the
log form as a new entry — `_prefillLogFormFromProfile()` sets date/entry
time (exit time via the existing `calcExitTime()`), depth, a time-weighted
avg depth, and avg water temp (both derived from the waypoints, not literal
UDDF fields), then focuses the Site field. The parsed profile is held in
`_pendingNewDiveProfile` and attached automatically once the dive is actually
saved — `saveDive()` is patched once (mirroring the `show()` wrapper pattern)
to consume it, re-checking `_matchScore()` against the dive *as saved* so a
changed-your-mind edit before saving doesn't attach the profile to the wrong
dive.

**Bulk-add (v2.85) — the no-match pile becomes a batch, not N form
round-trips.** When a UDDF import's no-match candidates number more than
one, `_renderNewDivePicker()` leads with an "Add all N as new dives" card
(`_bulkAddNewDives()`) instead of only the one-at-a-time pick list — the
persona this serves is a diver whose whole history lives on the computer,
not someone attaching profiles to an existing log. One editable "Most
recent dive #" field numbers the batch in true chronological order (sorted
by `startedAt`, independent of file order — Shearwater manifests arrive
newest-first), counting *backward* from it — the field asks for the newest
dive number **within the batch itself** (2026-07-15, corrected from an
initial "last dive before this batch, then +1" framing: a diver knows "that
was my hundredth dive" as a concrete fact about a dive they just did, not
"the dive before my most recent batch," which isn't a number anyone
actually holds in their head). A live "→ #98–#100" preview beside the field
makes the backward count explicit. This covers both "I got this computer on
dive 45" and switching computers mid-history (each import batch gets its
own anchor). Prefill priority: the file's own `<divenumber>` when present
(parsed alongside `<greatestdepth>`/`<diveduration>`, same opportunistic
treatment) → `highest logged divenum + n` → `n` — each expressed as the
batch's end, not its start, so the displayed default always matches what
the field is actually asking for. Created dives are
skeletons — only what the profile actually knows (date/times via the same
derivation as the single-candidate path, depth, avg depth, duration, avg
temp, gas/tank/pressures, GPS+site when present) — pushed to the active
sync backend and profile-sidecar-attached sequentially (not parallel — SAF
write storms, see the folder-sync caveat below), left for ✎ edit mode to
complete (site, buddy, sightings). No trip label on the batch — deliberate;
one dive computer commonly spans many trips, so a batch-level label would
mislabel more often than it'd help. Dedup is inherited free: these
candidates only exist because the same match pass already found no
existing dive, so re-importing the same file matches the newly-created
dives instead of duplicating them. This is also the landing shape BLE
computer sync (`BRIEF-dive-computer-sync.md`) will hand its own batches
to — same review list, same bulk-add bar.

**GPS is opportunistic, not guaranteed.** UDDF supports coordinates via a
top-level `<divesite><site id="…"><geography><latitude>/<longitude>`, linked
from a dive's `<informationbeforedive><link ref="…">` — `_parseSiteLookup()`
resolves this by checking each `ref` against known site IDs (the same
generic `<link>` element also carries buddy references, so position can't be
assumed). Most recreational dive computers have no GPS hardware, so this
typically depends on the exporting software's own site database being
populated — commonly absent, and the parser no-ops cleanly when it is. When
present, `_prefillLogFormFromProfile()` calls `lfSetPin('f', lat, lng, true)`
— the exact same call the map itself makes on a tap/drag — so the pin drops
and Country/Region get reverse-geocode-suggested identically to manual entry.

**Depth/time chart (v2.8, `js/profile.js` → `renderProfileChart`):** an SVG
curve replacing the dive-file's floating stat band whenever a dive has a
profile (DECISIONS.md — "the floating stat band is replaced, not
duplicated"). Depth on an inverted Y (0 at top), a water-column fill with
its own top-to-bottom gradient (lighter at the surface, deepening with
depth — echoing the app's existing depth-gradient background), and a single
colour mechanic: the curve tints from a muted calm blue toward danger-red as
NDL headroom runs out, forward-filled across any gap where a file stops
reporting `<nodecotime>` once a dive commits to deco (some computers do —
found empirically, see DECISIONS.md), with a thin vertical marker at the
moment NDL actually hits zero (falling back to the first `<decostop>`
event's own timestamp when the raw data never logs a literal zero) — gated
on the dive having passed 3m depth first, since the first waypoint or two
before the wet sensor trips deep enough can report a placeholder NDL of 0,
which was otherwise read as "entered deco at t=0" on every dive with NDL
data at all (v2.9). Ascent-rate colour coding was explored and deliberately
cut — one colour signal, not two. Thresholds (calm above 25min, full danger
at 10min, "that's when I start thinking about ascending") are Luke's own
stated reference points, not arbitrary round numbers (`_ndlColor`,
`js/profile.js`). Live danger (0–10min, still reversible on ascent) and
locked deco (once NDL has genuinely crossed zero — or, for computers that
stop reporting NDL once in deco, the first `<decostop>`/deco-sample event —
locked for the rest of the dive regardless of what NDL does afterward) are
deliberately different, darker shades of the same colour rather than one
hex wearing two meanings — found necessary live-testing real dive data: a
dive that spent a long stretch hovering near-but-above zero (still live,
correctly tracking) looked identical to a dive that had genuinely committed
to deco, and the marker line marking the lock moment had no colour change
to confirm it against an already-dark backdrop. A gradient-bar legend
(`.df-pc-legend`, between the chart and the stat strip, shown only when a
dive has NDL data) explains the curve's colour coding, built from the same
thresholds `_ndlColor` itself uses so it can't visually drift from what the
curve's live per-sample colour does. Safety/deco stop events group into lean pills ("SAFETY · 5M · 3MIN"
or, for a real multi-level ascent, "DECO · 22→0M · 90MIN") sitting in the
open water below the curve rather than the shaded fill above it. Entry/exit
dots are labelled with the dive's actual clock times, not the words "entry"/
"exit" — which is what lets the dive-file's separate Profile bubble
(In/Stop/Out) disappear entirely once a chart exists, alongside Gas &
equipment's Gas/Pressure/SAC rate/Cylinder rows (all already in the chart's
own stat strip and gas-bar text, which now includes tank type too). No
on-curve temperature indication (dropped in favour of the existing "min °c"
stat, which already covers it) and no user-facing Smoothing/Curve-weight
control (fixed, corner-rounding-only behaviour). Taller on narrow phones
(`H` picked at render time, not via CSS, so the SVG viewBox and the
HTML-overlay tick-label percentages can never drift out of sync with each
other).

### Security baseline (v2.39x)
All user/imported/external strings are HTML-escaped at render via `esc()`
(app.js) — use it for ANY new innerHTML interpolation. Imported frontmatter is
shape-coerced in `frontmatterToDive` (numerics/date/times/uid). `_headers`
carries CSP + security headers (script-src needs 'unsafe-inline' — escaping is
the primary XSS defence). Leaflet is vendored at `vendor/leaflet/` — no runtime
CDN. The deployed site sits behind Cloudflare Access; the SW only caches
verified same-origin 200s (login-redirect poisoning guard).

**Native commands must not trust the webview for scope (2026-08-10).** The
Rust↔JS boundary is a real trust boundary — treat anything crossing it as
attacker-controlled, exactly as you would a request arriving at a server.
Desktop already did this via `authorize()` (`lib.rs`), which resolves a path
lexically and rejects anything outside the roots recorded app-side (roots are
deliberately NOT kept in `localStorage`, which the webview can forge). A
security review found the Android SAF backend had the mirror-image gap: it
took its folder handle as opaque JSON straight from JS, and `android_write_uri`
took a bare URI string, neither validated. `FsUri` derives `Deserialize` with
public fields and accepts **both** `content://` and `file://`; the plugin
routes `file://` to bare `java.io.File` access with no SAF grant consulted —
so a forged handle was an unscoped read/write/delete/enumerate primitive.
Closed by `require_content_scheme` (`androidfs.rs`), which every folder-scoped
command reaches via `as_uri` and `android_write_uri` calls directly.
**The lesson worth carrying, not just the fix:** "the platform sandboxes this
for us" is a claim about a *specific* handle type, and the wire format usually
can't prove which type arrived. Establish that first, then rely on the
sandbox. The old header comment here asserted the opposite ("must not be
added"), which is precisely what kept the gap open — a confident-sounding
rationale is worth re-deriving, not inheriting.

### Markdown file format (Obsidian vault)
Each dive generates one `.md` file. Structure:
1. YAML frontmatter block (all structured fields including `species:` list and `trip:` field)
2. Human-readable markdown body (tables for conditions, profile, equipment, marine life)

The YAML frontmatter is the queryable layer for Dataview. The body is for human reading. Both are always generated together.

**Critical:** species must be inside the YAML block, not after the closing `---`. Old files may have species outside the block — the parser handles both formats.

### Trip field
- `trip:` is stored in YAML frontmatter per-dive `.md` file — no separate trip entity
- Grouping key and display name are the same value (whatever the user typed)
- Autocomplete surfaces previously-used trip names for quick re-entry
- History view groups by `trip` → `region` → `location` → "Ungrouped" (precedence order)
- Dives with no `trip` value group under their `region` label in the trip timeline

### OBIS compatibility
The app is being built toward OBIS (Ocean Biodiversity Information System) submission using Darwin Core Archive format:
- **Event table** = dives (eventID = dive ID)
- **Occurrence table** = marine sightings (linked by eventID)
- **eMoF table** = counts and measurements

Each species has a WoRMS `aphiaId` for taxonomy validation. Export for OBIS is a planned future feature — not yet built.

---

## Species database

- 1,275 species in `SPECIES_DB` array (1,010 tropical/SE-Asia + a 100-species UK coastal batch added 2026-06 + a 145-species UK batch added 2026-07, OBIS-checklist-sourced — see `scripts/fetch-iucn.py`/`fetch-photos.py`/`audit-photo-licenses.py` for the enrichment pipeline)
- Format: `[commonName, scientificName, aphiaId, group, photoUrl, iucnStatus, regions]` — uniform 7-tuple; `photoUrl`, `iucnStatus`, and `regions` may be empty strings
- `scientificName` is the universal join key (search dedup, photo/IUCN maps, footage-sidecar clip keys) — must be WoRMS-canonical and unique
- 15 groups: Fish, Shark, Ray, Eel, Cephalopod, Crustacean, Echinoderm, Mollusc, Coral, Sponge, Jellyfish, Reptile, Mammal, Worm, Tunicate — a new row's `group` MUST be one of these (browse-mode tabs are a fixed list); anemones/soft corals file under Coral by convention
- `photoUrl` must be on `inaturalist-open-data.s3.amazonaws.com` — that bucket mirrors CC-licensed photos exclusively, so any URL on it is safe by construction. **Never `static.inaturalist.org`**, which serves photos regardless of licence — CSP `img-src` happens to allow loading that host too, but licence-safety is the real rule, not CSP. `scripts/audit-photo-licenses.py` is a periodic safety-net re-check across the whole DB; this has regressed once already (a stale resumable-cache entry from before this rule existed got silently trusted and reintroduced 23 bad-host URLs — see DECISIONS.md)
- `regions` (added 2026-07-20, `scripts/fetch-species-regions.py`) — a `|`-joined string of up to 8 ocean/coastal codes (`ip`, `sea`, `rs`, `med`, `na`, `car`, `ep`, `au`) built from OBIS `/checklist` membership per species. Surfaces as the Species Album's "Found in" line and the log-form Country pre-filter — see "Built" below and ROADMAP.md → "Species Distribution Data" for an open concern that `au` currently matches 75% of the DB and may need a narrower representative area. Re-run the script (clearing `scripts/species-regions.json` first) whenever AphiaIDs or the species list change — the cache is keyed by region, not species, so a stale cache silently serves membership data computed against old aphiaIds.
- Search is local-only — no API calls at logging time
- Search priority: common name starts-with → common name contains → scientific name contains
- WoRMS REST API was rejected for *runtime* lookups (see DECISIONS.md) — but it is the right tool for **build-time** AphiaID/photo enrichment when growing the DB (CSP only governs the deployed app, not dev-time scripts)
- AphiaIDs are baked in for future OBIS export. **Audited 2026-07-20** (`scripts/validate-species-aphia-ids.py`) — 806 of the then-1,279 entries had a wrong aphiaId (colliding with or silently borrowing another species' id), 6 were renamed to their current WoRMS name, 4 had no WoRMS match at all and were deleted. See DECISIONS.md → "Species database AphiaID audit" for the full story, including the two follow-up scripts (`fetch-species-regions.py`'s sanity check found it; `fix-duplicate-aphia-ids.py` was the narrower first pass) and why 7 remaining duplicate aphiaIds are intentional (genuine WoRMS synonyms, not bugs).
- **When adding species:** dedup on `scientificName`, keep the 7-tuple shape + known group, then bump the `sw.js` cache version (`data/species-db.js` is in the SHELL list) and update the count references in this file + README

---

## Key features

### Species sighting stats
- Stats count **dives where a species was seen** (1 per dive), not total individuals
- This prevents a shoal of 500 fish skewing frequency charts
- Abundance (R/O/C) is preserved for records and OBIS export

### SAC rate calculation
- Formula: `(bar_used × cyl_vol) / bottom_time / ((avg_depth / 10) + 1)`
- **Accuracy gate (`calcSAC`):** returns `null` (SAC hidden) unless ALL of `pstart−pend`, `bottom_time`, `avgdepth`, and logged `tanksize` are present and non-zero. No assumed defaults — a missing avg depth gives an un-normalised figure and an assumed 12 L tank can be ~20% off on a 15 L cylinder, so SAC only shows when genuinely trustworthy. (Superseded the earlier "defaults to 12 L" behaviour, May 2026.)
- Grouped by dive type for meaningful comparison (drift vs boat vs shore)
- Colour-coded: green < 18 L/min, amber 18–25, red > 25

### Autocomplete cache
- Keys: `suit`, `weight`, `tanksize`, `liveaboard`, `buddy`, `instructor`, `region`, `trip`
- Stored in `localStorage` under key `divelog-ac-cache`
- Bootstrapped from existing dives on load
- Updated on every save and edit

### Exit time auto-calculation
- Fires when either entry time or bottom time changes
- Handles midnight crossover
- Works on the log form in both new-dive and edit mode (same fields)

### History view: trip-grouped timeline
- Default sort groups dives under sticky trip headers
- Trip header format: `[Trip name · where · month]  ........  [N dives · N sp. · N days]`
- Timeline row format: `[#num] [site 📍 / type · ↓depth · ⏱time · 👁vis · 🐟sp] [day]`
- Dive type word is the legend — colour-coded (boat, night, drift, shore each have distinct colours), no separate key needed. **Only true where the word sits on the swatch** (timeline spine, log-form chip, dive-file hero pill, and the Stats bars' own `.st-lbl`). The **map pins** are the one surface where it isn't — a pin carries colour and no word — which is why the map ships its own legend; see `CLAUDE colour UI.md` → "Map pins".
- Non-default sorts (depth, country) render as a flat list with no trip grouping
- See DECISIONS.md for full design rationale

---

## Panels / navigation

Six panels: `log`, `plan`, `history`, `species`, `stats`, `obsidian` (titled
"Settings & data" — sync backends, import/export, the Admiralty key).

`obsidian` isn't in the primary tab row — it's reached via a Settings cog
(⚙), not a nav-bar label, since it's visited rarely compared to the other
five. Desktop: sidebar nav + the cog in the sidebar footer. Mobile (< 600px):
bottom tab bar (`log`/`plan`/`history`/`species`/`stats`) + a floating fixed
cog button (deliberately not a full top bar — that overlapped History
content; the floating button reserves no layout space).

The map is **not a panel** — it's a view toggle inside History. A "Map" button in the History sort toolbar switches to a full-panel Leaflet map; "← List" returns to the timeline.

Navigation is handled by `show(name, btn)` — a base function patched once by the unified show() wrapper which handles mobile nav sync and Obsidian panel population.

**Do not add more patches to show().** If more panel-switch behaviour is needed, add it inside the single unified patch.

### Hash routing seam (v2.66)

`PANEL_HASHES` maps each panel name to a `#fragment` string. `goPanel(name)`
calls `show(name)` then pushes a `{ panel: name }` history entry via
`history.pushState`. The `popstate` handler in `app.js` reads `e.state.panel`
and calls `show()` to restore the panel on back/forward navigation — giving
Android's swipe-back gesture meaningful panel navigation instead of exiting
the app.

`_showFromPopstate` is a boolean set to `true` immediately before any
`show()` call that originates from `popstate`, and reset to `false` right
after. The unified `show()` patch checks it to suppress the `goPanel()` call
(which would push a duplicate history entry).

A boot IIFE in `app.js` reads `location.hash` on first load and routes to
the matching panel, so fragment URLs are deep-linkable.

Nav order: **History / Species / Log / Plan / Stats**, and History is the
default landing panel (was Log) — live-testing with new users found them
staring at the blank log form for ages rather than seeing what the app is
for. The desktop sidebar's "Log" group label was dropped in the same pass
(a group now led by History/Species/Plan no longer fit under that heading);
"Analyse" → Stats is unchanged.

**Every nav control goes through `navTo(name, btn)`, not `show()` directly**
(sidebar links, bottom-bar tabs, the mobile settings cog). `navTo` sets a
`_navTapToTop` flag that makes the switch land at the **top** of the panel
instead of restoring its saved scroll — the panel title is the "you've
arrived somewhere new" cue, and restoring a mid-page position hid it, which
is a large part of why testers didn't realise the tabs changed page at all.
Scoped to nav taps only: back-gesture/popstate returns still restore, which
is what keeps the dive-file round trip working (`goBackToHistory` doesn't
call `show()` at all, so it's unaffected either way). Tapping the tab you're
already on is deliberately not a no-op — it re-renders and scrolls to top, so
the bar always visibly responds.

**The mobile bar's icons are inline SVG, never emoji** — an emoji glyph
renders in its own fixed colours and cannot inherit `color`, so the old
`.mobile-nav-btn.active { color: … }` rule tinted nothing but the 12px label,
leaving the selected tab measurably *dimmer* (3.94:1) than the unselected
ones (5.31:1). Its top edge is a wave (`.mobile-nav-wave`, an SVG at
`bottom:100%`) over a shallow→abyss gradient continuing the page's own depth
gradient; the irregular silhouette is what stops the bar reading as browser/OS
chrome. Active colour is `--accent-on-dark` (`#97C6E2`, a dedicated `:root`
token — dark-mode `--accent` lightened 25% toward white), NOT `var(--accent)`
directly — the bar is dark in both themes, and light-mode `--accent`
measures 2.44:1 against the top of the gradient. See DECISIONS.md →
"Mobile nav wasn't perceived as navigation at all".

**Desktop sidebar picked up the same gradient and icon set, but not the
wave** — a full-height, logo-topped, labelled sidebar was never at
risk of being mistaken for OS chrome the way a slim bottom bar pinned to the
viewport edge is, so the wave's specific job doesn't apply here; the gradient
and SVG icons (byte-identical path data to the mobile bar, plus a settings
gear) carry the visual consistency instead. `--accent-on-dark` — already a
shared token, also used by the dark-surface `:focus-visible` override — is
what it's built on, and picking up the gradient surfaced the exact same bug
class a second time: `.logo-mark` and `.nav-link.active` both hardcoded
light-mode `--accent`, which is why the token got its general name instead of
staying `--mobile-nav-active`. The one genuinely new piece is `#nav-current`
(`js/app.js` → `_updateNavIndicator`) — a single lit bar that *travels* to
the active nav-link via a CSS `top`/`height` transition, rather than a
per-item indicator that could only fade in place at a fixed position. Scoped
to the 5 primary nav-links inside `.nav-section`; Settings sits in
`.sidebar-footer`, a different positioned-ancestor context the indicator
can't reach, and lands there as a deliberate fade-out rather than a stale
position — mirroring how Settings is already a separate control on mobile
(`.mobile-cog`, outside the 5-tab bar). See DECISIONS.md → "Desktop sidebar:
which parts of the mobile nav redesign actually apply".

### Overlay view-stack (v2.67)

Full-screen overlays — dive file, species profile, footage modal — each push
a state-only `history` entry. Back gesture and Escape both close the top
overlay via the same path. (The edit modal was an overlay too until v2.83 —
editing now happens on the Log panel as a mode, not an overlay; see "Edit
mode" below.)

**Primitives (all in `app.js`):**

| Function | Role |
|---|---|
| `_pushOverlayState(spec)` | Pushes `{ panel, overlay: spec }` and appends `spec` to `_openOverlays` |
| `closeTopOverlay()` | Calls `history.back()` if `_openOverlays` is non-empty |
| `_lockScroll()` | Increments `_scrollLockCount`; sets `body.style.overflow = 'hidden'` on first lock |
| `_unlockScroll()` | Decrements counter; clears overflow on last unlock |

`_openOverlays` is a JS-side mirror of the history overlay stack. The `popstate`
handler pops it and dispatches to the correct `*Direct()` teardown:

| `spec.type` | Direct teardown | Scroll unlock? |
|---|---|---|
| `diveFile` | `closeDiveFileDirect()` | no (dive file doesn't lock scroll) |
| `speciesProfile` | `closeSpeciesProfileDirect()` | yes |
| `footage` | `closeFootageDirect()` | yes |

**The dive file also needs its own explicit `.mobile-cog` visibility toggle — the other two overlays don't (found live, 2026-08-03).** `speciesProfile`/`footage` are real `position:fixed` modals at `z-index: 900+`, well above the cog's `150`, so they correctly cover it just by rendering on top. The dive file isn't a positioned overlay at all — `openDiveFile`/`closeDiveFileDirect`/`goBackToHistory` just toggle `display` on `#dive-file-view` vs `#history-content` in-place inside `.main`'s own normal flow (consistent with the "doesn't lock scroll" row above — it was never treated as a true modal), so the persistent, always-rendered cog stayed on top of it by default instead of being covered. All three functions now also toggle `#mobile-cog`'s `display` alongside the view swap they already do — `'none'` on open, `''` (falls back to the CSS media query) on every close path. Confirmed live via all three entry/exit paths (open, the explicit back button, and the popstate/back-gesture teardown), not just one.

The `*Direct()` functions do the actual DOM teardown and are called **only from
the popstate handler**. The public `closeDiveFile()`, etc. just call
`closeTopOverlay()`. This keeps the history stack and DOM in sync.

After closing an overlay, if `state.panel` differs from the currently active DOM
panel, the popstate handler calls `show(state.panel)` with `_showFromPopstate = true`
to restore the correct panel without pushing a new history entry.

A single `keydown` listener on `document` (app.js) fires `closeTopOverlay()` on
Escape when `_openOverlays` is non-empty. Removed: individual Escape handlers
that previously existed in `album.js` and `footage.js`.

### Per-panel scroll restoration (v2.69)

`_panelScrollY` is a plain object keyed by panel name. The unified `show()` patch:
1. Saves `window.scrollY` for the leaving panel before calling `_origShow()`.
2. After `_origShow()` returns, calls `window.scrollTo({ top: _panelScrollY[name] || 0, behavior: 'instant' })`.

Modal overlays are handled automatically — `_lockScroll()` freezes `window.scrollY`
while they are open. Dive file has its own `_diveFileScrollY` (saved/restored in
`openDiveFile` / `closeDiveFileDirect`). The `_panelScrollY` map covers the five
main panels only.

### Species profile link affordances (v2.68)

- **Sighting rows** (`.sp-sighting-row--link`) navigate to the dive file via
  `goToDiveFromSpecies(diveId)` — lateral navigation that closes the species
  profile directly (no `history.back()`), switches to History with
  `_showFromPopstate = true`, then calls `openDiveFile(diveId)`.
- **Clip rows** (`.sp-video-ref--watch`, Tauri only — gated on `isShell()`) call
  `openFootage(diveId, { mode: 'watch', expandKey })`. `expandKey = entry.scientificName || key`
  normalises the free-text species key mismatch between album's `customId`-first
  indexing and footage's `scientificName || customId` match order.

**Map popup rows** (`js/map.js`, v2.12) are the third lateral-navigation entry
point: `goToDiveFromMap(diveId)`. Unlike the two above it **branches**, because
the two map surfaces tear down differently and getting it wrong either leaks a
live Leaflet instance or corrupts the history stack:
- **History Map view** is a *view mode*, not an overlay — it must go through
  `setHistoryView('list')`, which is what calls `destroyMap()`.
- **Trip full-screen map** *is* on the overlay stack (`openTripMapView` pushes
  `{ type: 'tripMap' }`), so it needs the `goToDiveFromSpecies` unwind:
  pop `_openOverlays`, `closeTripMapViewDirect()`, then `show('history')` with
  `_showFromPopstate = true`.

It detects which by inspecting the top of `_openOverlays`. Both paths verified
live, including that `_mapInstance` is null afterwards.

---

## Type scale

Three sizes only. Always use the CSS variables — never write a raw `font-size` value in pixels.

| Variable | Value | Use |
|----------|-------|-----|
| `var(--font-size-xs)` | 12px | Mono labels, metadata, keys, badges, secondary mono |
| `var(--font-size-sm)` | 14px | Secondary text, card meta lines, table values |
| `var(--font-size-base)` | 16px | Body text, inputs, buttons, primary content |

Off-scale sizes (9, 10, 11, 13, 15, 17px) are forbidden. The exception is intentional display/hero numbers (38px, 40px, 56px for stat figures) — those use raw px and are clearly labelled in the CSS.

### History timeline visual hierarchy (Direction-D card, v2.2)

Each timeline entry is a **Direction-D card** (`.dD-card`): a coloured type spine
on the left and a content grid (identity | measurements, then a marine row). On
≥900px it unfolds into a horizontal strip (`.dh-*` cells). Visual weight maps to
this priority order:

| Priority | Element | CSS class | Treatment |
|---|---|---|---|
| 1 | Trip name (sticky header) | `.tl-trip-name` | `--font-size-base` / 700 / `--text` |
| 1 | Trip stats | `.tl-trip-stats` | `--font-size-sm` / `--text-muted` |
| 2 | Site name | `.dD-site` | 18px / 700 / `--text` |
| 3 | Measurements (depth·time) | `.dD-mn` | 16px / 700 — vis demoted by colour, not size (`.dD-mn.vis`) |
| 4 | Date | `.dD-date` | `--font-size-xs` / `--text-muted` mono |
| ref | Dive number | `.dD-dnum` | `--font-size-sm` / `--text` mono |
| anchor | Rarest species thumb + count | `.dD-thumb` / `.dD-spcount` | 64px image / `--font-size-xs` |

The dive type lives in the **spine** (`.dD-spine`, vertical mono caps coloured by
`--type-*`), not an inline word. The rarest species (by IUCN rank) anchors the
marine row. Tapping the card opens the full-view dive file; the ✎ quick-edit and
(desktop) 🎬/🗑 buttons `stopPropagation` so they don't trigger the open.

### History panel width

`#panel-history` is capped at `max-width: 860px` — slightly wider than the form panel (780px) to accommodate the leader dots and trip stats, but constrained for reading comfort. Do not remove this cap.

---

## Never name and shame a product or company in public-facing text

**The line is between a *category* and a *maker*.**

**Fine:** observing that a general-purpose tool, format or habit does a poor
job of a specific task — a paper logbook, a camera roll, a spreadsheet, a
folder of photos. That's describing how people currently try to solve the
problem, and why it doesn't hold up. `README.md` → "Why this exists" is the
reference example: the paper log can't answer the question, and a camera roll
hands you a scroll of AI-guessed "Octopus" results that aren't a record. Both
are formats being used for a job they weren't built for.

**Not fine:** naming a specific product or company unfavourably, in the
landing page, app copy, `README.md`, or any tracked doc in the public repo.
Not because the criticism would be wrong, but because it isn't the
positioning Shoal has chosen — and that choice hasn't been made
consciously, so nothing should drift into it by accident.

Comparative research on named products is genuinely useful and should keep
happening — it lives in `research/` (gitignored) and informs *what Shoal
builds*. It just never becomes the public argument for using it.

Two reasons the line sits there. Practically, the repo is public and AGPL:
anything written here is quotable, permanent, and attached to one named
author. Substantively, **specific products were designed the way they were
for reasons** — a different user, a different era, a constraint invisible
from outside. "They neglected X" is nearly always a worse read than "they
optimised for Y." A category has no such defence to make; a company does.

Naming a product neutrally is unaffected — `index.html` tells users they can
export a `.uddf` from Subsurface or MacDive, which is help, not comparison.

---

## Which doc does this go in?

Four docs, four questions. Content drifts between them unless the split is
explicit — `ROADMAP.md` had accumulated a third of its length restating
shipped work and explaining decisions before this was written down (2026-08-13).

| Doc | Answers |
|---|---|
| `CHANGELOG.md` | What shipped, and when |
| `CLAUDE.md` → "Built" | What exists now |
| `DECISIONS.md` | Why, and what was rejected |
| `ROADMAP.md` | What isn't built, and what's blocking it |

**A shipped ROADMAP item collapses to a pointer, it doesn't get deleted** —
"what's left" is meaningless without knowing what came before it. But the
pointer is one or two lines to `CHANGELOG.md`/the brief, never a re-telling.
**Check a shipped block for live content before collapsing it**: the Species
Distribution "done" sections had an unresolved open concern buried in them
(OBIS's `au` region matching 75% of the species DB), which a naive cut would
have thrown away.

`BRIEF-*.md` files are a fifth kind — a full design record for one feature,
written before/while building it. They stay as-is once shipped; archive to
`briefs-archive/` when the feature is done and the brief is no longer the
working reference.

---

## Changelog discipline

`CHANGELOG.md` (repo root, [Keep a Changelog](https://keepachangelog.com)
format) is the human-readable record of what shipped per version. It is
**maintained on an explicit trigger**, not automatically:

- When Luke says he is **ready to commit / push** (or explicitly "update the
  changelog"), Claude **must** update `CHANGELOG.md` before/with the commit:
  review what changed since the last baseline (uncommitted diff + this
  session's work), and add grouped bullets (**Added / Changed / Fixed /
  Removed / Security**) under the `## [Unreleased]` block.
- Keep a permanent `## [Unreleased]` block at the top. On a version
  bump/push, rename it to `## [<version>] – <YYYY-MM-DD>` (the version from
  `src-tauri/tauri.conf.json`, below) and open a fresh empty
  `## [Unreleased]`.
- Log only **notable** changes (features, redesigns, behaviour changes,
  removals, security/data-loss fixes). Skip pure refactors, whitespace,
  typos.
- Write entries *as the work happens within a session*, so the push-time
  update is a review/stamp, not a from-scratch reconstruction.
- The push summary Claude already produces on request **is** the changelog
  entry — route it into `CHANGELOG.md`, don't let it evaporate into a commit
  body.

A stale changelog is worse than none. If unsure whether something is
notable, err toward one terse line.

**Versioning, `1.0.0` onward: plain semver, and `src-tauri/tauri.conf.json`
→ `version` is the single source of truth.** (Everything before `1.0.0` was
informal per-commit numbering — see the note at the top of `CHANGELOG.md`;
it isn't comparable to `1.0.0` and never appears in a published build.)
`release.sh` derives the DMG filename and `landing/downloads/latest.json`
from this one field, and the desktop app's own update check
(`checkForAppUpdate()`, `js/app.js`) does a numeric component-wise compare
against it — so "bump the version" has to mean **this field**, not a vibe in
a commit subject, or the update check silently breaks.

- **MAJOR** — a change an older install can't cope with (a `.md`/frontmatter
  format an old build would misread), or a deliberate milestone.
- **MINOR** — a new user-facing feature.
- **PATCH** — fixes and polish, no new feature.

Bump the field *before* running `release.sh` for a build meant to actually
publish — the version in a shipped `.dmg`/`latest.json` is whatever that
field said at build time, not whatever CHANGELOG.md's heading says.

---

## Known constraints

- **Any element near the top edge of a full-screen mobile surface needs `env(safe-area-inset-top)`, or it risks the front camera cutout.** Found on real hardware (Galaxy S10) — `.mobile-cog` sits exactly where that device's hole-punch camera is. Confirmed again on an emulated Pixel 9 Pro with a simulated cutout, which is what turned this from a one-off fix into a full sweep: **seven sites total**, found across three separate passes, not one. Individually-positioned buttons: `.mobile-cog`, `.df-hero-close` (inside `.df-hero-fullscreen`, `position:fixed;inset:0` below 899px), `.sp-mh`/`.sp-close` (inside `#species-profile-modal .modal`, which reaches `height:100vh` on mobile — genuinely ignoring `.modal-overlay`'s own padding, since `vh` units don't respect an ancestor's padding at all). Header bars spanning the top of a full-screen overlay, found in a second and third pass after the first sweep only checked individually-positioned elements and missed these: `.main`'s own mobile top padding (a flat `1rem`, affecting every panel's heading — History, Species, … — not one button), `.map-modal-head` (shared by the log-form pin picker and the trip-map full-screen view — the one a user screenshot specifically caught, since the close button itself isn't absolutely positioned the way the others are, which is exactly why it was missed the first time), `#sp-mob-overlay .fmp-topbar` (the log form's mobile species picker, deliberately "anchored at top" per its own design), and `.fm-dialog-head` (the footage-tagging modal, `width:100vw;height:100vh`). All seven fixed identically: add `env(safe-area-inset-top, 0px)` to the existing top offset/padding — a no-op in a normal browser (the inset defaults to 0), only relevant on a device that actually reports a cutout. **Deliberately left alone**: `#android-folder-required`, `.confirm-overlay`, and `.numscroll-overlay` — all centered or bottom-anchored, not top-edge-anchored, so they don't share the mechanism (checked, not assumed). **Check any new full-screen mobile surface's own top edge against this same class of bug** — bottom-edge elements already do this consistently (the nav wave, save bar, toast stack all use `env(safe-area-inset-bottom)`), and a header bar with no individually-positioned close button is just as exposed as one that has it, which is the specific thing that let three of these seven slip past the first two passes.
- Served over HTTP/HTTPS only — locally via `python3 scripts/dev-server.py 8080` (a plain `python3 -m http.server` sends no `Cache-Control`, so browsers — WKWebView especially — heuristically cache assets and keep serving stale CSS/JS across app restarts; the dev server disables caching and suppresses 304s), in production via Cloudflare Pages. The Android PWA **always** loads from the Cloudflare URL. `file://` is a **non-goal** (dropped after v1, never used on mobile) — do not reintroduce it as a constraint or let it shape routing/API choices.
- Must work offline after first load (service worker caches shell + all JS/CSS/data files)
- iOS has PWA quirks — primary target is Android Chrome/Brave
- Brave on macOS blocks self-signed certs — always use HTTP port 27123, never HTTPS 27124
- `localStorage` is the **primary in-app store on mobile** (the app reads/writes it directly); one-off `.md` downloads are point-in-time exports. **But folder sync now writes a live `.md` (+ footage sidecar) on every save on Android too** — see the folder-sync constraint below.
- **Folder sync works on Android Chrome/Edge (Chromium M132+, shipped late 2024)** — `showDirectoryPicker` + `createWritable()` are supported, including **cloud-backed folders (e.g. Google Drive) via Android's Storage Access Framework**, which syncs the writes to the cloud transparently — **no Drive API / OAuth / CSP change needed; the OS does the sync**. The picked `FileSystemDirectoryHandle` is persisted in IndexedDB (`js/app.js` — `saveFolderHandle`/`loadFolderHandle`/`_folderHandleCache`, awaited via `_folderHandleReady` so early callers can't race the load) so the folder is never re-picked across reloads, but **write permission on that handle is not guaranteed to survive one**: `requestPermission()` can only show its dialog during a live user gesture, so if the browser has reverted the grant to `'prompt'`, an automatic re-check finds this out silently (no error, no dialog). `getWritableFolderHandle()` still always calls `requestPermission` (not `queryPermission` — on Android, `queryPermission` can lie and report `'granted'` after the SAF handle has actually lost write access, so it can't be trusted as the source of truth); what changed is that a non-granted result now sets `_folderNeedsReconnect` and calls `renderSyncStatus()`, which shows a "Folder sync disconnected" banner with a one-click "Reconnect" button (`reconnectDiveFolder()`) instead of the previous silent no-op — this is what was causing `loadAllSidecars`/`loadAllProfileSidecars` to come back empty after a reload with zero visible sign. Folder mode's boot sequence (`index.html`) now also calls `syncFromFolder(false)` on every load — the `verbose=false` arg suppresses its normal "No folder set" `alert()` — bringing it to parity with Obsidian mode's existing `syncFromObsidian(false)` boot call; this re-derives `dives[]` (and sidecars) from the vault/folder on every launch instead of trusting whatever `localStorage` happened to still have, which is what was causing Stats charts to come up empty on every fresh launch of the Tauri shell until "Sync from folder" was clicked by hand. Other caveats: Android content-URIs have **no atomic writes or renames**, so `createWritable()` can intermittently throw `NoModificationAllowedError` on a just-created file — `writeFileInDir` (app.js) already retries this with backoff; very large folders can hang the picker; **Chromium-only** (not Firefox Android, **not Brave**, not iOS Safari), so `downloadMd()` stays the universal fallback. Proton Drive's end-to-end provider exposes cloud-only files the browser can't read — Proton stays download-then-move; use **Google Drive** (or a device-synced folder) for the live-folder path on mobile.
- No build tools, no npm, no bundler for the **web** app (until explicitly decided otherwise)
- **macOS desktop shell (Tauri, v2.5) — built; `src-tauri/`.** The web build stays the source of truth; the shell wraps it. Web-vs-shell differences go through `isShell()` (app.js) only. Build inputs are generated, not committed: `prepare-web.sh` copies web assets to `webdist/` (add new top-level assets to its list); `build-ffmpeg.sh` compiles an **LGPL** ffmpeg from pinned source (no GPL/libx264 — H.264 via Apple VideoToolbox), a static single-file sidecar (git-ignored, built on demand). No GPL anywhere → App-Store-eligible. **`src-tauri/gdrive-client-secret.txt` (git-ignored, hand-created, not generated) is a THIRD required-but-uncommitted build input** — the Google Drive OAuth client secret, read by `build.rs` at build time and compiled in via `env!("GDRIVE_CLIENT_SECRET")` (`src/gdrive.rs`). Unlike the other two, there's no script to produce it: a fresh checkout needs it created by hand (value from Google Cloud Console → Credentials → "Shoal Desktop"; see README.md → "Dev / build") before `cargo build`/`cargo tauri dev` will succeed at all — `build.rs` fails loudly with that exact instruction if it's missing, deliberately with no fallback. See DECISIONS.md → "Google Drive OAuth" for why it's kept out of tracked source specifically (an open-source release is under consideration) while still being compiled into the binary itself (a separate, already-accepted tradeoff that this doesn't change). ffmpeg args are hard-locked in the Rust `run_transcode` command (`h264_videotoolbox`; no free-form args from JS). **Do not remove `dangerousDisableAssetCspModification` from `tauri.conf.json`** — it keeps `'unsafe-inline'` effective so the ~130 inline handlers work in the packaged app (without it the built app renders but is unclickable; dev is unaffected, so it's an easy trap). **The shell's CSP is a separate policy from the web build's `_headers`** and does not inherit from it — `'wasm-unsafe-eval'` had to be added to `tauri.conf.json` independently for the libdivecomputer WASM module, and a miss there breaks the packaged app only. **`src-tauri/Info.plist` is merged into the bundle** — `NSBluetoothAlwaysUsageDescription` lives there and is mandatory for BLE sync, since macOS 11+ *kills* an app that touches CoreBluetooth without it instead of prompting. Folder-sync footage sidecars use Rust fs commands in the shell, gated on `isShell()`. **`downloadBlob()`'s `<a download>` + blob-URL trick silently no-ops in WKWebView** (the native webview Tauri uses on macOS) instead of erroring — confirmed 2026-07-09 when a CSV export reported success but produced no file at all in the shell. Any new single-file export needs an `isShell()` branch through the native `save_file_dialog` Rust command (returns a path via a real "Save As" dialog) + the existing `write_text_file`, mirroring `exportUnvalidatedSpecies` in `js/species.js` — don't assume `downloadBlob()` works universally just because it works in every browser. Full record: `briefs-archive/v2.5-BRIEF-desktop-tauri.md` §9 + DECISIONS.md.
- **Admiralty UK Tidal API (Plan panel, desktop-only, v2.6) — UK/Ireland/Channel Islands only, and never cached.** Discovery tier has no data outside those waters, so `fetchPlanTide()` (`planner.js`) checks a UK bounding box *before* calling `invoke()` — a Southeast Asia location costs zero API calls, not a wasted one against the 10k/month quota. `fetch_tide_events` (Rust) also rejects on actual distance to the nearest station, as a backstop. Per Admiralty's own FAQ, the free Discovery tier prohibits caching/storing the data ("a breach of Copyright law") — `fetchPlanTide()` deliberately never skips a fetch because a previous one is still around; do not reintroduce a cache keyed by location.
- **`THIRD-PARTY-NOTICES.txt` is GENERATED — re-run `python3 scripts/gen-third-party-notices.py` (from the repo root) whenever any of these change: `src-tauri/Cargo.toml` (or `Cargo.lock`), anything under `vendor/`, or the bundled `fonts/`.** Never hand-edit the file. Distributing the `.dmg` is what triggers the obligation — MIT/Apache/BSD all require reproducing the copyright notice and licence text *with the distribution*, OFL requires its text to travel with the fonts, and MPL-2.0 (5 crates, via Tauri's CSS parsing) requires the covered source to stay available. The script derives the crate list from the real resolved dependency graph (`cargo metadata --filter-platform aarch64-apple-darwin`, normal + build deps, **dev-dependencies excluded** since they never reach the binary), so it can't silently drift the way a hand-maintained list would. It also **inlines** the vendored/font licence texts, not just references them: the standalone files (`vendor/*/LICENSE`, `fonts/LICENSE-OFL.txt`) do satisfy the licences on their own, but they live inside the `.app` bundle where a normal macOS user can't reach them, so the in-app viewer has to be self-contained to be genuinely readable. Deliberately not `cargo-about` — that needs a separate toolchain install and a config file to produce nothing this doesn't already get from `cargo metadata` plus the registry's own licence files; switch to it only if the licence story outgrows "list every crate, reproduce each distinct licence once". Surfaced in-app at Settings → About Shoal, lazy-loaded on first expand (`loadLegalText`, `js/app.js`) and cached via `SHELL_DEFERRED`.
- **Shoal itself is AGPL-3.0 (`LICENSE.md`), and that has distribution consequences beyond GitHub.** §6 ("Conveying Non-Source Forms") means **you cannot distribute a binary while keeping the source unavailable to recipients** — publishing `landing/downloads/Shoal.dmg` from a private repo does not satisfy it. §5(d) wants an interactive program to show an Appropriate Legal Notice, which is what Settings → About Shoal → Licence is for; `LICENSE.md` therefore ships inside the app bundle (`prepare-web.sh`) as well as sitting in the repo root. Two knock-on effects worth knowing before relying on either. **The Apple App Store one is real but NOT a blocker for Luke, and it's easy to overstate** (this doc did, briefly): Apple hosts open source freely — permissive licences (MIT/BSD/Apache-2.0/MPL-2.0, i.e. the whole Rust stack here) raise nothing at all, and LGPL works in practice, with Subsurface-mobile shipping this exact libdivecomputer on the App Store as the precedent already recorded in `vendor/libdivecomputer-wasm/README.md`. The genuine conflict is GPL-family-specific — Apple's end-user terms add device/redistribution restrictions that GPL's "no further restrictions" clause forbids, and GPLv3/AGPLv3 additionally require Installation Information for modified builds, which a locked iOS device can't allow (this is what got VLC, then GPLv2, pulled in 2011 until VideoLAN relicensed to LGPL). **But that conflict is only ever enforceable by a copyright holder, and Luke is Shoal's sole author** — so it constrains other people redistributing Shoal, not him. If the App Store ever matters he can dual-license, add an App-Store exception to the AGPL grant, or relicense, with nobody's permission needed. What *would* genuinely block it is bundling GPL code he doesn't own, which is precisely why the "No GPL anywhere" rule for **dependencies** (under the Tauri constraint below) stays correct and worth keeping. Second effect: because Shoal is local-first with no server, AGPL's distinctive §13 network clause has almost nothing to bite on here, while its GPL core still lets any recipient redistribute the binary freely. The dependency stack is compatible either way (Apache-2.0 is one-way compatible with AGPL-3.0; libdivecomputer being LGPL-2.1-**or-later** is what makes it fit — an LGPL-2.1-only dependency would not have).
- **Adding a new JS file requires updating `sw.js` `SHELL_CRITICAL` array** so it gets cached — bump the cache version too. (Large decorative-only assets go in `SHELL_DEFERRED` instead — best-effort, doesn't gate offline-readiness; see DECISIONS.md.) **During live local testing, bump on every shell-file edit, not once per batch** — the tester's browser installs the SW on first load and serves shell files from that cache; an edit without a bump never reaches them regardless of what the dev server has (this burned two real dive-computer hardware sessions on 2026-07-14 — see BRIEF-dive-computer-sync.md §15).
- **Testing a change in a BROWSER needs two reloads, or the service worker will show you the previous version's bytes.** `sw.js`'s fetch handler is cache-first: navigations serve `caches.match('/')` and only revalidate in the background, and static JS/CSS serve `cached || fetch(...)` with **no** revalidation at all — so the reload that fetches your edit is not the reload that renders it. A cache-version bump doesn't dodge this either: the new SW installs on reload 1 and only controls the page from reload 2. Symptom is the confusing part — the page renders markup that no longer exists in the file you're editing, while `fetch('/', {cache:'no-store'})` in the console correctly returns the new HTML. That mismatch is the tell. Cost real time twice on 2026-08-02, the second time serving a `divelog-v209` cache (months stale) on a *fresh* localhost port. Fastest reliable fix while iterating: `(await caches.keys()).forEach(k => caches.delete(k))` then reload — cheaper and more predictable than `registration.unregister()`, which hung when called against a worker actively controlling the calling page. **None of this applies to `cargo tauri dev`**: the shell doesn't register the SW at all (`!isShell()`, `js/app.js`) and loads straight from the dev server, so a single reload there is genuinely enough.
- **`.main`'s padding had three overlapping `@media (max-width: …)` breakpoints fighting over the same property (found 2026-08-03, fixed).** `max-width` queries are ceilings, not ranges — `(max-width:720px)` stays true all the way down through 0, so a rule meant for one width tier keeps firing underneath every narrower one too. Three separate blocks (720px, 600px — the actively-documented mobile-nav one, and 480px) all set `.main`'s padding, and since none but `margin-left` carried `!important`, plain source order decided the winner: the 720px block's plain `padding: 1.5rem` (a leftover from before the bottom-nav redesign, with no mention in this file's own "Panels / navigation" section) was silently winning at *every* phone width — confirmed live, not assumed: a 500px window computed `24px` all round, not the 600px block's carefully safe-area-aware value at all, meaning that value — the one the nav-wave-clearance comment right next to it describes — had likely never actually applied on a real phone since whatever point the 720/480 blocks were left behind. Fixed by adding `!important` to the 600px block's padding too (mirroring `margin-left`'s existing guard in the same rule) so it wins unconditionally within its own domain regardless of what a wider, unrelated ceiling query also tries to set — and by deleting the 480px block outright, since once the 600px rule is `!important` its three lines (`.sidebar`, `.main`, `.grid-3`) were all provably unreachable, not merely redundant. The 720px block itself (sidebar-stays-visible-but-fixed-position for a 601–720px tier) was deliberately left alone — untouched, unaudited, out of scope; the fix only stops it from leaking into the ≤600px phone tier it was never meant to reach. **Any future edit to `.main`'s mobile padding needs the same live check** — reading the 600px block in isolation gives the wrong answer for what a real phone actually renders.
- **`/index.html` must NEVER be a service-worker cache key or shell-list entry — `'/'` is the canonical shell key.** Cloudflare Pages 308-redirects `/index.html` → `/` (clean URLs), and `cacheable()` rejects all redirected responses (the Access login-page guard), so fetching `/index.html` fails **deterministically in production only** — local dev servers serve it as a plain 200, so no local test catches it. This silently killed every production SW install for a month (2.394 → 2.831; phones showed stale ancient versions or Android's native offline screen). When touching `sw.js`, test against a server that reproduces the redirect (see DECISIONS.md for the verification pattern), not just `python3 -m http.server`.
- **Leaflet's default marker icon needs `L.Icon.Default.imagePath` set explicitly (`loadLeaflet()`, `js/map.js`) — never let it auto-detect, and never also override `iconUrl`/`iconRetinaUrl`/`shadowUrl` on top of that.** Two related traps, both found live (v2.93→2.931): (1) Leaflet's own auto-detection reads a *computed* CSS `background-image` from `leaflet.css`, so any marker created before that stylesheet has actually applied gets a permanently broken icon for the rest of the page's life — `loadLeaflet()` must await both the script's and the stylesheet's `onload`, not just the script's. (2) `L.Icon.Default._getIconUrl()` *always* prepends `imagePath` to `iconUrl`/etc., even when you've set them yourself — supplying full paths for those on top of a working `imagePath` double-prefixes the URL (`.../images/.../images/marker-icon.png`) instead of fixing anything. The one correct fix is `L.Icon.Default.imagePath = 'vendor/leaflet/images/'` alone, leaving the filename options as Leaflet's own bare-filename defaults.

---

## What's been built, what hasn't

### Built
- **CSS primitives — tab strip (`.tab-strip`/`.tab`, `css/styles.css`, 2026-08-04), first of the brief's 6 (step 7).** Consolidates 3 of the 9 classes the UI audit filed under "tab strips" — `.browse-tab`, `.species-browse-tab`, `.sp-picker-tab` — which turned out to be near-pixel-identical category-filter chip rows that had drifted into real inconsistencies: three different container paddings (`7px 10px 5px` / `8px 10px` / `7px 10px 6px`) for the same visual row, and `.species-browse-tab`'s active border pointing at `--accent` (the ink token) while its two siblings correctly used `--accent-fill` — caught only by diffing all three side by side, not visible from any one of them alone. The other 6 of the 9 were investigated and correctly excluded, not overlooked: `.fm-mob-tab` was confirmed genuinely dead (no markup anywhere ever creates one — deleted, along with the dead `querySelectorAll` loop that read it in `switchFootageTab()`, `js/footage.js`); `.fmp-tabs` is a pure container that already reuses `.sp-picker-tab`, not a fourth family; `.lf-seg-opt` and `.dm-side-tab` aren't tabs at all on inspection (`role="group"`/`aria-pressed` toggle group and an `aria-expanded` disclosure control respectively, despite the naming); `.df-seg-btn` (dive-file) and `.mode-toggle` (footage Tag/Watch) are tab-shaped but **deliberately** not folded in — both are already-documented, intentionally different visual patterns ("folder-tab join, not a pill switcher" for `.df-seg`; a segmented pill group for `.mode-toggle`), and merging them would be a category error, the same reasoning that already keeps MD3's primary/secondary/tertiary out of this app's semantic colours.
  The 3 old class names stay as working aliases, grouped into the same rule rather than renamed at their call sites — nothing in `js/species.js` or `js/footage.js` needed to change; `.tab-strip`/`.tab` is simply now also directly available for any future feature needing this shape. `border-radius: var(--radius-full)` replaces the `14px` every family hardcoded — verified live, not just asserted: `border-radius` clamps to 50% of a box's shorter dimension once the requested value exceeds it, so `14px` and `999px` render the identical pill on a chip this short, and `--radius-full` is the correctly-named, already-existing token for exactly this ("999px is the pill idiom," per the radius-scale comment). One genuinely free rename: `.sp-picker-tab-cnt`, a count-badge class scoped to just one of the three families, became the same `.tab-count` the other two already used, updated directly at its 3 real call sites (found by grep, not assumed to be the 1 the initial pass reported) rather than kept as a second alias — it's simple, single-purpose, and low-risk enough that consolidating it outright was safer than leaving two names for one thing. Confirmed live: computed styles on a real rendered `.sp-picker-tab` (the mobile species picker's category row) match the design exactly — `border-radius: 999px`, active fill `#407DA0` (`--accent-fill`), inactive text `#726557` (`--text-muted`), container padding `7px 10px 6px`. **Remaining for step 7:** `.btn` (the two large deferred families), the spacing scale, and ~130 non-exact `border-radius` sites still needing a visual judgement call each — `.chip` is done, see below.
- **CSS primitives — button-family census, dead-code sweep, and 3 small consolidations (`css/styles.css`, 2026-08-05), first pass at step 7's `.btn`.** A full census (every `cursor:pointer` rule with a real box, not a bare link or a tab/chip/toggle already covered) found **~65 button-shaped rules across 13 shape-families** — roughly double the brief's original "~30" estimate, which was an eyeball count of the UI audit's own sample list, not a real inventory. Given the true scope, this pass deliberately did NOT attempt one unifying `.btn` — it did the parts that were safely, individually verifiable, and left the two largest families (a "solid accent-fill CTA" family of 9 members and an 18-member "ghost/outline mono rect" family already anchored by a real, working `.btn-ghost`/`.btn-primary`) for the next pass.
  **Dead code, each independently re-verified by grep (not trusted from the census alone) before deletion:** `.tags-wrap`/`.tag`/`.tag-remove` (a whole free-text-tag feature no `js/*.js` file ever renders), `.md-btn`, `.pg-info`/`.pg-arrows`/`.pg-arrow` (the `.history-pagination` containers exist in `index.html` but are force-hidden by `renderHistory()` with the comment "no pagination in timeline views" — real, still-hidden containers, but no JS anywhere builds the prev/next arrows that would go inside them), `.btn-save-device` (the audit's own sample list named this class as evidence of the button problem, yet it was dead — its companion `document.getElementById('save-device-btn')` in `js/app.js` was a permanent no-op, since no element with that id exists in `index.html`; both removed together), and the "Bulk import"/"Unlinked sightings" footage-modal sub-feature (`.fm-import*`, `.fm-unlinked`, `.fm-ul-*`) — superseded by the still-live `.sp-card.unlinked` inline attach-form (`.fm-attach-form`/`.fm-attach-sel`, confirmed live and left untouched).
  **One near-miss, caught before deleting:** `.proxy-script` and the per-row `.tc-name`/`.tc-bar`/`.tc-fill`/`.tc-cancel`/`.tc-done` looked identically dead to `#tc-widget`/`.tcw-*` by the same zero-references test, but `js/video.js`'s own header comment ("PARKED 2026-07-25, code retained... Everything below still works and is deliberately left intact") says the opposite for the widget family — `transcodeProxies()` still builds `#tc-widget`/`.tcw-cancel` even though no button calls the function anymore. Read the function body directly rather than trusting the grep-zero-refs signal alone: `.tcw-*` is deliberately-retained parked code and was left untouched; `.proxy-script` and the per-row family are a genuinely different, older UI that `transcodeProxies()` itself never references (superseded by the widget before the parking even happened) and were the ones actually deleted.
  **Three small, high-confidence merges**, same grouped-selector aliasing technique as tab-strip (canonical name + legacy names in one rule, so no JS/HTML call site needed to change): a new `.jump-pill` primitive absorbs `.m-jump`/`.watch-clips-n`/`.watch-jump`, which were byte-identical in both their base rule and `:hover` rule in three separate places (`js/footage.js`); new `.btn-confirm-ok`/`.btn-confirm-cancel` absorb `.tl-rename-ok`/`.tl-rename-cancel` and `.sp-dive-ok`/`.sp-dive-cancel` (`js/history.js`, `js/planner.js`), also byte-identical across both pairs; and `.hist-map-btn`/`.hist-back-btn` (History toolbar's "open Map" / "← List" pair) were merged into one shared base rule after confirming they were a near-byte-identical duplicate, catching one real drift in the process — `.hist-back-btn:hover` was missing the `background: var(--accent-dim)` tint its twin already had, same class of unintentional-divergence bug the tab-strip pass found in `.species-browse-tab`'s wrong active-border token.
  **`.confirm-ok`/`.confirm-cancel` (the dialog-level pair, `#confirm-overlay`) is the same colour idiom at a deliberately different, larger scale — not merged, documented instead.** It's already sized to the 44px WCAG AAA/Android touch-target floor because it's an *isolated* control; `.tl-rename-*`/`.sp-dive-*` stay at the smaller 28px because they're *packed* rows, and the file's own pre-existing touch-target comment (search "PACKED rows" in `css/styles.css`) already names both of these classes explicitly as deliberately not resized without a live device check first. Read that comment before touching either family's dimensions.
  **The 11-member "icon-only square/rect action button" family (`.sp-btn`, `.dh-abtn`, `.df-action-btn`, `.dD-edit`, `.gsec-arr`, `.tcw-cancel`, `.tp-btn`, `.plan-nav`, `.roc-btn`, `.vrow-del`) was investigated and deliberately NOT merged, unlike tab-strip's analogous find.** It looks like the same shape of bug at first glance — 7 different pixel sizes (22–34px) and 3 different `border-radius` conventions for what reads as one shape everywhere — but reading every rule directly (not just the sizes) found real, likely-intentional variance underneath: backgrounds split three ways (`var(--bg)`/`var(--surface2)`/`var(--surface)`/none) and borders two ways (`var(--border-mid)` vs `var(--border)`) depending on what each button sits on top of (a list row vs. a hero card vs. a bare calendar grid), and `.tp-btn`'s hover recipe (`surface2`/text, a media-transport control) and `.roc-btn`'s (an `.active`-state toggle, already correctly excluded from tab-strip as a selection control, not an action) are genuinely different mechanisms, not drift. Forcing these into one identical rule would risk a real, unverified visual regression across ~6 separate views for uncertain benefit — the opposite of tab-strip's find, where the padding/token differences were confirmably accidental. Left as-is; a future pass could still extract the two or three genuinely-identical members (`.dD-edit`/`.df-action-btn` look closest) but that needs the same live, on-device confirmation the touch-target comment above already asks for, not another CSS-only read.
  **Remaining for `.btn` proper:** the ~9-member solid accent-fill CTA family and the ~18-member ghost/outline family (anchored by the already-real `.btn-ghost`/`.btn-primary`) are the two biggest pieces left, plus the spacing scale and the ~130 non-exact `border-radius` sites.
- **CSS primitives — second `.btn` pass: 2 more near-duplicate merges found inside the two large deferred families (`css/styles.css`, 2026-08-05).** Went back through the 9-member solid-CTA family and the 18-member ghost/outline family individually (not re-running the census — reading each rule directly) to check whether any pair was as clean a merge as the icon-square family's members weren't. Two were: `.numscroll-set` (the number-scroll-wheel picker's "Set" button) and `.afr-card .afr-go` (the Android first-dive folder prompt's CTA, already carrying its own comment explaining why it's "Deliberately NOT `.btn-primary`" — a structural reason, `.btn-primary` being `display:none` at the mobile breakpoint this prompt always renders at, unrelated to its visual recipe) turned out identical but for a 1px padding accident (11px vs 12px) — merged into a shared base with each keeping its own padding/width as a small override, so neither one's rendering changes. `.vid-del` (✕ in a footage-modal video row) and `.vid-stamp-btn` (✏/✕ in a stamp row) were a second near-duplicate, catching two real bugs in the process: `.vid-del`'s danger hover had a `background` tint `.vid-stamp-btn.danger:hover` lacked — the same missing-state drift class the `.hist-map-btn`/`.hist-back-btn` merge already found, fixed by sharing the hover rule between them — and `.vid-del` used `--text-dim` for its resting colour, a token `CLAUDE colour UI.md` documents as decorative-only/non-passing (2.16:1), where `--text-muted` is what every other interactive-but-secondary icon in the app already uses (same fix class as the log-form wheel-button icon colour correction). Confirmed the app's `.theme-harbour` dark-mode override (`.theme-harbour .vid-del:hover, .theme-harbour .vid-stamp-btn.danger:hover`, near the top of `css/styles.css`) still resolves correctly against the merged rule before shipping — its selector specificity (two classes + pseudo) is unconditionally higher than the new shared rule's, so it wins regardless of source order. **Verified live:** the number-scroller's "Set" button opens and renders correctly from the Gas & equipment section's pressure-wheel trigger; the `.vid-del`/`.vid-stamp-btn` merge could not be exercised live since the footage-tagging modal is Tauri-shell-only (`openFootage()`'s own `if (!isShell()) return`) — verified instead by the same careful source cross-check, including the dark-theme override compatibility above. Everything else re-checked in both families held up as real, deliberate variance (different font register — mono technical vs. sans general, e.g. `.sync-btn`; different hover semantics — neutral-darken vs. accent-tint vs. danger; a semantically-reserved colour — `.lf-geo-confirm`'s `--success` fill; or an intentionally larger scale — `.mobile-save-bar button`'s floating prominent CTA) and were left alone rather than forced.
- **CSS primitives — `.pill`, the second of the brief's 6 not-yet-built primitives (`css/styles.css`, 2026-08-06).** Investigated the "chip" candidate list the earlier button census surfaced — `.cat-pill`, `.sp-country-pill`, `.pdc-loc-pill`, `.lf-type-chip`, `.fm-tag`, `.fm-vid-chip`, `.df-type-pill`, `.df-pc-pill` — the same way tab-strip's 9 candidates were: read every rule directly rather than assumed from the name. Only one genuine pair survived: `.cat-pill` (the Species Album's category jump-nav) and `.sp-country-pill` (the country filter bar) share an identical base box — `font-family: var(--mono)`, `padding: 6px 12px`, `border-radius: var(--radius-full)`, `border-mid`, `--surface` background, `--text-muted`, `letter-spacing: 0.02em` — byte-for-byte, down to the padding. Their *state* styling is a different matter and is **explicitly documented in the code as deliberately different**: the comment above `.sp-country-bar` says outright that a filter's `.is-active` state reuses the segmented-toggle "selected" language (solid `--accent-fill`) specifically *so a filter row doesn't read as another jump-nav* like `cat-pill`'s neutral/hover-accent look. So only the shared geometry moved into a new `.pill` base (grouped alongside both legacy names, same aliasing technique as every primitive so far); `.cat-pill`'s and `.sp-country-pill`'s own hover/active rules are untouched. **Verified live:** both pills render pixel-identical to before on the Species panel — the country bar's "All"/"Indonesia" toggle still swaps to solid accent-fill correctly, and clicking a category pill still jumps to that section (`#cat-ray` in the URL) exactly as before.
  **The other 6 candidates were investigated and correctly excluded — a smaller yield than tab-strip's, and worth recording why, since it's the same "read every rule, don't assume from the name" method turning up a *different* answer.** `.pdc-loc-pill` (the Plan panel's saved-location pill) uses a different font register entirely (`font-family: inherit`, i.e. sans, not mono) and different tokens (`--surface2`/plain `--border`/`--text`, not `--surface`/`--border-mid`/`--text-muted`) — a softer, sans-serif register than the two mono "tech readout" pills, not accidental drift. `.lf-type-chip` and `.df-type-pill` both belong to the reserved dive-type colour ramp (`var(--tc)`, the per-type CSS variable) — the same category of exclusion that already keeps this ramp out of every other primitive in the app, since a chip whose entire job is encoding *which* dive type via colour can't share a neutral base with one that doesn't. `.fm-tag` isn't a chip at all — plain text with no border/background/padding, a coincidental name match (see the `.tag`/`tags-wrap` dead-code removal earlier in this same effort for why that coincidence is worth double-checking every time it comes up). `.fm-vid-chip` and `.df-pc-pill` are both non-interactive informational badges (no `cursor: pointer`) rather than clickable pills, and don't match each other either — different backgrounds, radii and accent-vs-neutral colouring for two different jobs (a permanent "this sighting has a linked video" tag vs. a chart-overlay safety/deco stop label). Cross-checked against every other `border-radius: var(--radius-full)` site in the file (`grep`, not sampling) to make sure no candidate was missed outside the original chip list — the other 5 hits all belong to already-built primitives (`.tab-strip`/`.tab`, `.lf-loc-btn`) or, in one case (`.shimmer-slider`'s track), a feature removed entirely two days later — see the dark-mode entry below.
  **A whole dead media query, found the same session by asking whether the one dead class nearby implied more.** `.fm-mob-tab`'s deletion above still left `@media (max-width:600px) { #footage-modal .modal-body {...}; .fm-split {...}; .fm-col-head {...}; .fm-col-left {...}; .fm-col-scroll {...}; ... }` in place — a block that never actually depended on `.fm-mob-tab` itself, so it wasn't provably dead by the same evidence. Checked rather than assumed either way: `openFootage()` (`js/footage.js`) opens `#footage-modal` under two hard guards — `if (!isShell()) return` (the web/PWA build, mobile included, never reaches this feature at all) and `if (window.innerWidth < 900) return` ("Desktop-only — footage player not supported below 900px", its own comment's words). Since `600 < 900`, a viewport narrow enough to trigger this media query could never simultaneously have the modal open — the two conditions are mutually exclusive **by construction**, not by observation, so the whole block was removable with the same confidence as the one class already known dead. Also settles the narrower question this was originally raised to answer: there's no mobile-sightings-access gap to worry about, because there's no mobile access to this feature *at all* — `.dm-side-tab` doesn't need to be "the mobile solution" for something that was never reachable on mobile in the first place.
- **CSS primitives — labelled field, the third of the brief's 6 not-yet-built primitives (`css/styles.css`, 2026-08-07).** `.field` (the wrapper: flex-column, 5px gap, `--font-size-xs`/mono/`--text-muted`/`0.04em` label typography, already the codebase's own "good case" per the original UI audit) was never itself the gap — a full census of every label+input pairing app-wide (82 real form controls, 39 `<label>` elements, 9 distinct families for one nominal job) found what was actually missing was consolidating the families *around* it. Two were genuine duplicates, found the same way tab-strip's and `.pill`'s were — read every rule directly, not assumed from the name: `.lf-numcol`/`.lf-numlbl` (the log form's compact number-with-unit rows — Bottom time, Max depth, Start/End pressure, Weight, …, ~10 call sites) turned out to be `.field`'s wrapper and label rules typed out a second time, same four declarations, same values, just reordered; `.lf-site-label` (the Site name field, 1 call site) matches `.field label`'s typography value-for-value but reaches the label→input gap through different plumbing — a `margin-bottom` rather than a flex `gap`, since `.lf-site-row` is a padded/bordered list row, not a flex column — so only the typography merged in, its own `display:block; margin-bottom:5px` layout stayed a separate rule. Both merged via the same grouped-selector-plus-alias technique every primitive here has used: old class names untouched at every call site, CSS deduplicated underneath them. A new `.form-label` class extends the same typography to labels with no wrapper at all, and immediately picked up its first 2 real consumers: `js/footage-match.js`'s camera-clock-offset field and `js/profile.js`'s bulk-add "most recent dive #" field, both previously ad hoc `style="font-size:var(--font-size-sm)"` one-offs that predated the primitive and didn't match its typography (`sm` not `xs`, no mono, no muted colour, no letter-spacing).
  **5 more candidates were investigated and correctly excluded**, each for a different, genuine reason rather than a blanket "don't touch buttons/toggles" rule: `.tx-lbl` (this week's own new Settings dive-type-texture toggle label) is a horizontal row pairing a two-tier bold-title-plus-muted-description block with a switch, not a vertical label-above-input shape at all. `.af-lbl` (the footage-tagging Timestamp/Species/Abundance/Note form, `js/footage.js`) is a horizontal layout with typography that's drifted, not matching: `letter-spacing:0.05em` vs `.field label`'s `0.04em`, plus `text-transform:uppercase`, which `.field label` never sets. `.lf-dial-name` (the Visibility/Water temp dial headings) is bold, `--font-size-sm` not `xs`, full-strength `--text` not muted, no mono — visually a small heading for a custom drag control, not a caption. `.stop-type` (the Safety/Deco stop rows) is deliberately `aria-hidden`, honest markup for a 3-column grid row where each real input already carries its own full `aria-label` — a different accessibility strategy than a visible label, not an oversight. `.pdc-loc-search-label` (Plan panel's "Add location" caption) only renders once saved-location pills already exist and reads as a section heading, not a per-field caption; when the search field is genuinely empty it has no label at all, relying on its placeholder alone.
  **A real accessibility gap surfaced by the same census, fixed alongside it rather than only flagged: the Plan panel's inline add/edit dive-timeline row had zero labels of any kind.** 8 inputs (`.sp-add-input`, `js/planner.js` — 4 in the "+ Add dive" row, 4 in the per-row ✎ edit form: depth, time, entry time, gas mix) were identified purely by placeholder text, which disappears the instant a value is typed and isn't announced by every screen reader the way a real label is — the single weakest-labelled surface found in the app. Added `aria-label`s to all 8 (`"Planned depth in metres"`, `"Planned bottom time in minutes"`, `"Planned entry time"`/`"…, optional"`, `"Planned gas mix"`), the same "field too cramped for a visible caption" pattern the earlier accessibility pass already established elsewhere (the GPS coordinate fields, the vis/temp dial range inputs). **Verified live in both themes:** every merged site (log-form number rows, Site name, Settings) renders pixel-identical to before, the two `.form-label` sites render with correct xs/mono/muted typography (confirmed via a synthetic DOM check for the two flows that need real imported data to reach live), and the Plan panel's 8 `aria-label`s read back correctly via `getAttribute`. Console clean throughout.
- **CSS primitives — `.chip`, the sixth and last of the brief's originally-planned 6 (`css/styles.css`, 2026-08-08).** A dedicated census — every `border-radius: var(--radius-full)` site plus a broad sweep for anything named or shaped like a chip/tag/token — targeted the 3 candidates never actually ruled on by the earlier `.pill` pass (`.ulchip`, `.tp-tag`, `.roc-btn`) and looked past the original 12-item audit list for anything else. Only one genuine chip-shaped candidate turned up: **`.ulchip`** (`js/footage.js` — the "already-logged sighting" quick-link chips in the footage-tagging modal's right panel, one per marine sighting already on the current dive, tapped to link the video's current timestamp to it). It's a close-but-not-identical twin of `.pill`: same `font-family: mono`, `border: 1px solid var(--border-mid)`, `background: var(--surface)` — and its own hardcoded `20px` border-radius resolves pixel-identical to `--radius-full` at this box height, the same clamping behaviour already relied on for the tab-strip primitive — but genuinely different on `color` (`--text`, not `--text-muted` — this chip acts on tap, `.pill`'s muted ink reads as more passive), vertical padding (`4px 12px` vs `6px 12px`, since this is a dense horizontally-scrolling row of many chips rather than a single-line filter bar), letter-spacing (none vs `0.02em`), its own hover state, and a `::before { content: '+ ' }` prefix signalling "link," not "select/filter." Rather than force the real differences into uniformity, only the shared geometry moved into `.pill`'s existing base rule (now `.pill, .chip, .cat-pill, .sp-country-pill, .ulchip`), with `.ulchip`'s colour/padding kept as a small separate override and its hover/`::before` untouched — the identical "shared box, different state" technique the `.pill` pass already used for `.cat-pill`/`.sp-country-pill`.
  **`.chip` itself is a deliberately bare alias, not a second geometric shape** — the census found no evidence anywhere in the app of a "chip" job genuinely distinct from "pill" (removable-tag vs. filter/jump-nav, the usual Material distinction), and inventing one without evidence would be exactly the kind of unforced distinction this whole primitive-consolidation effort has been checking for and rejecting at every other step (e.g. `.cat-pill`'s/`.sp-country-pill`'s active-state difference was *kept* separate because the code already documented it as deliberate — the opposite finding from here, where nothing documents `.ulchip`'s drift as intentional). `.chip` is added purely so a future call site has the generic name the original brief asked for, sharing `.pill`'s exact rule — it has zero real call sites of its own yet, same as how `.tab-strip` shipped "directly available for any future feature needing this shape" before anything new used it.
  **`.tp-tag` and `.roc-btn` were investigated and excluded as the wrong shape, not merely different state.** `.tp-tag` (footage player's "＋ Tag here" button, `js/footage.js`) is solid `--accent-fill`, `border-radius: var(--radius-md)`, no border — already the 9-member solid-CTA button family the `.btn` census deliberately deferred, not a chip at all despite the name. `.roc-btn` (the R/O/C Seasearch-abundance selector, `js/species.js`) is a fixed 30×30 square with `border-radius: var(--radius-sm)` and a solid-fill `.active` state — the same "selected = solid fill, not neutral hover" segmented-toggle language the `.pill` pass already excluded from merging for `.sp-country-bar`'s own active state; a source comment elsewhere in the file (near line 6114) independently already filed `.roc-btn` alongside icon-square buttons like `.dh-abtn`, not pills.
  **Two things the census surfaced that are real but explicitly out of `.chip`'s scope, flagged rather than fixed here:** a non-interactive "abundance badge" (a read-only R/O/C letter, `border-radius: 5px` — the app's own badge register, not the chip/pill radius token) exists as **three separate, near-byte-identical rules** — `.sp-ab` (`js/history.js`), `.sp-sighting-row .ab` (`js/album.js`), `.vid-stamp-ab` (`js/footage.js`) — a genuine duplicate the original 12-item chip/pill audit never listed, since it's a badge shape, not a chip. Separately, a *second*, fully independent R/O/C **picker** exists (`.af-ab span`, footage-tagging add-sighting form, `js/footage.js`) doing the identical job as `.roc-btn` with a different implementation — a plain `<span onmousedown>` with no `role`, `aria-pressed`, or `aria-label`, unlike `.roc-btn`'s real `<button aria-pressed>` — an accessibility gap, not a visual one. Both are real findings worth a future pass but belong to a badge primitive and an accessibility fix respectively, not this chip primitive.
  **Verified live:** the Species panel's category (`.cat-pill`) and country-filter (`.sp-country-pill`) pills render pixel-identical to before — confirmed via `getComputedStyle` (padding `6px 12px`, radius `999px`, letter-spacing `0.24px` at 12px, matching `0.02em`) as well as visually. `.ulchip` sits behind `openFootage()`'s `if (!isShell()) return` guard (Tauri-shell-only, unreachable in a plain browser) — verified instead by injecting its real markup into a live page and reading computed styles: `999px` radius, its own `4px 12px` padding and `--text` colour preserved, `::before` content `"+ "` intact. Console clean throughout.
- **Triple-duplicate read-only abundance badge merged (`css/styles.css`, 2026-08-08) — a real duplicate the `.chip` census found but correctly left unmerged there, since it's a badge shape, not a chip.** The R/O/C letter shown next to a logged marine sighting was three separate, near-byte-identical CSS rules: `.sp-ab` (`js/history.js:132,160` — the dive-file sightings list), `.sp-sighting-row .ab` (`js/album.js:511`, nested inside `.sp-sighting-row` — the Species Album's per-species "Dive log" list), and `.vid-stamp-ab` (`js/footage.js:571` — the footage-tagging modal's stamp rows, whose own comment literally already called it "Abundance pill inside stamp rows"). All three shared `font-family: mono`, `font-size: xs`, `color: text-muted`, `background: rgba(139,123,106,0.1)`, `border: 1px solid var(--border)`, `border-radius: 5px` — this app's own badge-radius register (`--radius-xs`'s token comment: "small badges, tags, tight controls"), distinct from `.pill`/`.chip`'s `--radius-full`, which is exactly why this was flagged as out of scope for that primitive rather than folded into it. Two genuine differences survived as small separate overrides rather than being forced into the shared rule: `.sp-ab`/`.sp-sighting-row .ab` carry `font-weight: 700` that `.vid-stamp-ab` lacks, and `.vid-stamp-ab` carries its own `flex-shrink: 0` (it sits in a flex row the other two don't) — same "shared box, real differences kept separate" technique as every merge in this whole primitive-consolidation effort. `.sp-sighting-row .ab`'s now-empty standalone rule was deleted outright rather than left as an empty alias, since nothing remained for it to add once its typography moved into the shared rule.
  **Verified live:** opened a real dive file and confirmed `.sp-ab` ("R" next to Green sea turtle) renders with `font-weight: 700`, `border-radius: 5px`, and unchanged padding/colour/background via `getComputedStyle`; opened the Species Album's Giant manta profile and confirmed `.sp-sighting-row .ab` ("O") matches identically. `.vid-stamp-ab` (Tauri-shell-only, unreachable in a plain browser) verified by injecting its real markup: confirmed it correctly keeps its own `flex-shrink: 0` and correctly does *not* pick up the bold weight, matching its pre-merge appearance exactly rather than accidentally inheriting a property it never had. Console clean throughout.
- **App-wide dark mode (2026-08-06).** The prior design pass (`mockups/mockup-dark-tokens.html` + five screen mockups, `CLAUDE colour UI.md` → "Themes (dark mode)") locked a full palette but shipped nothing beyond `.theme-harbour` scoped to the footage modal and the transcode widget, both permanently-dark rather than tied to any preference. This pass wires it app-wide: a **System / Light / Dark** control in Settings → Appearance (`.theme-seg`/`.theme-seg-opt`, deliberately its own class rather than reusing `.lf-seg`/`.lf-seg-opt` — `js/logform.js`'s `lfWireSegments(root)` defaults to `document`-wide when called with no root, so a same-named control outside the log form risks silent mis-wiring if that's ever invoked broadly). Defaults to System (`prefers-color-scheme: dark`, live via a `matchMedia` change listener), explicit choice persisted to `localStorage['divelog-theme']`, applied to **`<html>`** (not `<body>` — `<html>` is parseable from the very first byte, and only one selector in the whole pass, `body::before`'s dark override, needs to know which; `CHANGELOG.md`'s original "app-wide dark mode is the same class on `<body>`" line from the footage-modal work is corrected in place, not left to drift). Boot-time application is an inline `<script>` in `index.html`'s `<head>`, immediately after the `theme-color` meta tag — every `<script src>` in this app loads near line 1010 of an 1153-line document, far too late to avoid a flash of light theme.
  **The shipped `.theme-harbour` token block was stale relative to the locked design and got fully replaced, not patched** — old `--danger` (`#D26A4D`, the pre-correction value), no `--accent-text` at all (silently inheriting the light value, which fails at 2.11–3.61:1 on every dark rung — a live bug in the *previously shipped* modal-scoped dark mode, not just a future risk), only 4 of 8 IUCN ranks with values that didn't match the locked design (shipped CR `rgba(169,139,214,0.22)` measured 3.74:1; the locked `rgba(9,16,16,0.55)` measures 6.16:1 — "on dark, emphasis inverts direction: a *deeper* fill reads as stronger, not a brighter one"), no dive-type ramp, no profile-chart tokens. The replacement carries the full locked set — 5-rung surface ladder, complete `on-*` pairing (`--on-accent`/`--on-danger`/`--on-success`/`--on-warn` all flip to `#091010` deep ink on dark, since the shipped light `#FFFFFF` values drop to 2.35–3.01:1 against the lifted fills), 7 lifted dive-type ramp members (Shore/Drift/Reef deliberately not restated — matching values would be "the first step toward the four-contradictory-copies history this ramp already has"), and the 5 `--profile-*` dive-chart tokens (`--profile-deco`/`--profile-fill-top`/`--profile-fill-bottom` all invert their light-mode derivation direction on dark — "darkened toward black" and "lightened toward white" both become the wrong move once the canvas itself is dark).
  **A new `--on-type` pair** (`#FFFFFF` light / `#091010` dark, added to light `:root` too, which didn't have it) replaces hardcoded white ink on the dive-type categorical ramp in three places — `.lf-type-chip.sel` (log form's selected type chip) and `.dD-spine span` (history timeline's vertical type spine) were already flagged by the design pass; **`.df-type-pill`** (the dive-file's own type badge) was found live during this implementation and wasn't in the original list — white on a lifted dark member like Boat (`#2A8B9C`) measured ~3.98:1, under AA for its 12px bold label. (Known, disclosed gap the token doesn't fix: white-on-ramp already fails in *light* mode today for Shore/Drift/Reef, 3.21/2.84/3.30:1 — recorded by the design pass, not solved by this token, since light `--on-type` stays `#FFFFFF`.)
  **Real component bugs, not token copies, found live testing beyond the design pass's original modal-only scope:** `.dD-select-box.checked`'s checkmark now fills with `--accent-fill`/`--on-accent` (both theme-constant) instead of `--accent`, which lifts to a lighter blue on dark and dropped the tick to 2.29:1. The tank pressure gauge (`_dfTankHtml`, `js/history.js`) had its fill token changed from `--accent` to `--accent-fill` (small, deliberate light-mode shift too, `#4A90B8`→`#407DA0`) and gained a `startOnFill` predicate mirroring the existing `endOnFill` one — previously only the end number ever got the "is it on the fill" check, a pre-existing light-mode bug (a near-full tank swallows its own start number) independent of dark mode, closed as part of the same fix. **`.mobile-cog`'s background moved from `var(--text)` to a fixed literal** (`#1C3030`, matching the sidebar/mobile-nav's own permanently-dark gradient) — found live: `--text` flips light on dark, and the floating Settings gear (which sits on the page's own light-or-dark background, not on already-dark chrome) was rendering as a near-invisible near-white circle with a near-white icon on it.
  **Two hardcoded-literal fixes with the largest visual footprint:** the page-wide depth gradient (`body::before`, behind every screen — hardcoded `rgba(250,246,241,…)`/`rgba(28,48,48,…)`, which would not have changed at all under the new theme) and the static sun-on-water mesh (journal/welcome/settings cards) both gained `.theme-harbour` overrides. The depth gradient's dark value is taken **verbatim** from the design pass's own five screen mockups, which independently carry the identical `linear-gradient(180deg, #182827 0%, #111E1D 42%, #0B1616 100%)` — a genuinely different gradient *shape* than light's (opaque 3-stop hex vs. 4-stop rgba-alpha), not a value substitution, confirmed intentional by its unanimous repetition across five separately-authored files. Four "darken slightly on hover" sites (`.btn-ghost`, `.sort-btn`, `.sync-btn`, `.df-seg-btn:active`) swapped a hardcoded near-black `rgba(28,48,48,0.06)` — invisible on an already-dark surface — for `var(--taupe-dim)`, an existing token that already carries correct values in both themes.
  **IUCN fallback redesign, fixing a real cross-theme bug, not just adding dark values.** `.iucn-VU` moves off gold onto full neutral ink (`var(--text)` on a stronger tint) in **both** themes — the shipped gold treatment measured 3.33:1, a live AA failure in light mode already, not a hygiene issue. The neutral treatment for NT/LC/DD (previously three duplicate per-rank rules) now lives on the **base** `.iucn`/`.iucn-badge` classes instead, closing a real fallthrough: `album.js` builds the IUCN class as `'iucn-' + code` with no validation, and two species in the DB carry legacy invalid codes (`LR/nt`, `NA`) that fell through to bare, unstyled text in *either* theme before this. `.iucn-EX`/`.iucn-EW` deleted outright (0 of 1,275 species-DB rows carry either status, confirmed against the data, not assumed).
  **A dive file with a profile chart left open across a theme change now repaints correctly.** `renderProfileChart` (`js/profile.js`) only reads its colour tokens via `getComputedStyle` at render time, so it wouldn't otherwise notice a theme change — and this is reachable with zero navigation, since a System-mode `matchMedia` listener can fire while the dive file is already on-screen. `_dfRerenderProfileIfOpen()` (`js/history.js`) checks whether `#dive-file-view` is the active view via the overlay stack, and if so re-renders it in place (innerHTML rebuild + hero-map/species-panel re-init, mirroring `openDiveFile`'s own setup minus the history-push and scroll reset) — wired into `applyTheme()` so every toggle path (explicit pick, System-mode OS flip) triggers it automatically.
  `<meta name="theme-color">` updates alongside the class on every toggle — and, found missing during verification, also on a plain page load with no explicit user action: the boot `<script>` only had reason to set the class before first paint (the meta tag isn't parsed yet that early), so `applyTheme()` is called once more from `js/app.js` at normal script-load time specifically to sync the tag against whatever the boot script already decided.
  **Deliberately deferred, not silently dropped:** ~53 sites across the file duplicate `--warn`/`--danger`/`--success`/`--accent` as raw `rgba()` literals instead of tokens (some of which, `--warn-dim`/`--danger-dim`, don't exist yet) — these render a slightly off-hue tint in dark mode, not illegible/broken UI, so they're flagged as a follow-up pass rather than folded into this one. Also out of scope at the time: `mockups/mockup-type-patterns.html` (a colourblind texture channel, explicitly a separate/later feature per its own header comment — since implemented, see "Dive-type texture channel" below) and Tauri desktop window chrome (native title-bar theming — a Rust-side concern this web-layer pass doesn't touch).
  **Removed in the same pass**: the caustics shimmer feature (the "Off…Lively" dial in Settings → Appearance) — the animated SVG-turbulence texture on stat cards/dive-file band/the Settings card itself, plus its slider. Rarely used, didn't read well, and would otherwise have been the single hardest piece of this pass to get right on dark — its SVG filter (`feComponentTransfer`) hardcodes a warm-cream output range regardless of what's underneath, so a CSS-only background swap could never have fixed it; a second `<filter>` definition would have been needed for parity, which wasn't worth building for a feature already on its way out. Depth gradient and the static sun-on-water mesh — the other two members of the app's "3-layer background texture" system — are unaffected; the "3 layers" comment in `css/styles.css` is now "2." `.form-section--shimmer` and the `#caustic-light` SVG filter definition are also gone.
  **Verified live** (Settings toggle across all three states, persistence + re-sync across reload, boot-flash absence, `<meta name="theme-color">` in both directions, History spine legibility on both a lifted and a kept dive type, the tank gauge at both a near-empty and a near-full fill, IUCN fallback on an unrecognized-code species, Stats/Log-form/Species panels, console clean throughout) — except the profile-chart repaint scenario (no test dive with an imported profile available in this session) and the two always-dark Tauri-shell-only surfaces (footage modal, transcode widget), both verified by source review instead and flagged as such rather than claimed.
  **Four real bugs slipped through that same verification pass and were caught live by the user immediately after — two in a first round, two more (including a correction to one already "fixed") in a second, plus a third-round design-quality follow-up on the same dial, all same-day.**
  *Round 1:* IUCN rank colours (CR/EN/VU) rendered as the neutral fallback for *every* badge, not just NT/LC/DD — a specificity bug, not a values bug: the dark theme's colour rules boosted specificity for `class="iucn iucn-CR"` (`js/album.js`'s pattern) but not the equally-real `class="iucn-badge iucn-CR"` (`js/species.js`'s pattern, which is what the Marine Life IUCN key legend uses) — at equal specificity the neutral fallback won by sitting later in source, for every badge built the second way. The live verification pass had only checked an LC badge (correctly neutral either way, so it never exercised the actual bug) rather than a coloured rank. Fixed by adding the missing `.iucn-badge.iucn-X` boosted selector alongside the existing `.iucn.iucn-X` one. Separately, the visibility/water-temp dial's dark end visually merged into the dark card behind it, despite its existing `border: 1px solid var(--border-mid)` — this exact failure mode was anticipated by the original mockup (`mockups/mockup-dark-log-form.html`'s `box-shadow: 0 0 0 1px var(--border-mid)` fix) but never made it from research notes into the actual implementation plan. Added, scoped to `.theme-harbour`, on `.dial` and its two duplicate copies (`.df-vbar-track`, `.df-ov-gaugebar`).
  *Round 2, reported after Round 1 shipped:* the dial fix above was real but incomplete — "it should look lighter on the right, it still looks dark." The boundary ring fixed the dark LEFT end merging into the card; it did nothing for the RIGHT end, because `.dial-vis`'s gradient fades to full transparency (`rgba(74,144,184,0)`) at its "clear" end — a value that was always secretly relying on the page behind it being light (so "transparent" reads as "pale"). On a dark page the identical transparent pixels read as dark, exactly backwards from the murky→clear metaphor, and no boundary ring can fix a problem in the fill itself. Fixed with genuine dark-mode gradient overrides on all three baked-literal sites: `.dial-vis`'s tail replaced verbatim with the mockup's own dark version (which had independently made the same real-pale-stop call); `.dial-temp`'s single broken transparent COLD stop replaced with a solid blue, deliberately keeping the real, designed hot-red end intact rather than adopting the mockup's own dark-temp gradient wholesale, since that one drops the hot end entirely with no clear evidence it's a deliberate choice rather than an authoring shortcut. Separately: the sidebar logo (`.logo-name`) and the dive count (`.dive-count strong`) rendered dark-on-dark against the permanently-dark sidebar — both use `var(--on-inverse)`, a token whose whole design was "flip opposite `--text` for elements using `var(--text)` as their own background," which the sidebar has never been (it's a fixed gradient). The derivation resolved correctly in light mode by pure coincidence and inverted once `--text` itself flipped light in dark mode. Confirmed nothing in the app still needs the flip behaviour — the one site that ever did, `.mobile-cog`'s background, was already fixed to a constant literal earlier the same day (Round 1 of this whole exercise, `.mobile-cog` — see above) — before pinning `--on-inverse` itself to a constant `#FAF6F1`, no `.theme-harbour` override at all, exactly matching how `--accent-on-dark` already works for the same always-dark-chrome job. And the Plan panel's springs/mid/neaps calendar-cell distinction "doesn't make as much sense now" — `.plan-day.spring` used a hardcoded `rgba(139,123,106,…)` (the pre-2026-07 `--text-muted` value) as a 15%-alpha overlay, calibrated as a subtle tint against a light page; the identical overlay against an already-dark cell barely registers, while `.mid`/`.neap` (`--bg`/`--surface`, both properly theme-reactive) stayed correctly distinct. Fixed by continuing that same ladder progression onto its next real rung, `--surface2`, instead of the ad-hoc literal — carries the distinction correctly in either theme rather than only the one it was tuned for. All four re-verified live, including zoomed screenshots confirming the dial's right end is now visibly pale (not just bounded), the sidebar logo/count are legible, and the calendar shows a genuine three-way tonal step.
  *Round 3, a design-quality follow-up rather than a fresh bug report:* "pretty flat," needing to be "much brighter on the right," and — more pointedly — "I don't see why we can't just keep it the same for light and dark." Round 2's fix was technically correct (no more transparency-reveals-background) but a poor gradient in its own right: its dark-only stops were bunched into the first quarter of the bar, so most of the width barely changed tone. Rather than tune the dark override further, the per-theme split was removed outright — `.dial-vis`/`.dial-temp` and their duplicate copies (`.df-vbar-track`, `.df-ov-gaugebar-temp`) are now each a single non-transparent gradient, stops spread across the full width, with the same colour values used in both themes. `.dial-vis` ends on a genuinely bright, near-white pale blue (`#F0FBFE`); `.dial-temp` starts on a real solid cold blue (`#234876`), keeping its already-correct hot-red end untouched. Only the boundary ring from Round 1 stays `.theme-harbour`-scoped — there is no longer any dark-mode colour override to maintain for either gradient. Verified live in both directions: screenshotted in dark, then toggled to light with the same dial on-screen via `setThemePreference('light')`, confirming pixel-identical rendering either way — directly satisfying the user's own stated principle rather than merely fixing the reported symptom.
- **Dive-type texture channel (2026-08-07) — the colourblind-assist design from `mockups/mockup-type-patterns.html`/`CLAUDE colour UI.md` → "Dive-type texture channel", implemented.** Two nested Settings toggles, both off by default and living in their own "Dive-type textures" `.form-section` right below Appearance: **"Distinguish dive types by pattern"** (primary) textures the wordless `--type-*` render sites — the Stats dive-type bars (`stBar()`, `js/stats.js`, extended with an optional `tex` param), and, since 2026-08-12, the **map pins and their legend swatches** (`js/map.js`; the pin also grows 18px → 22px on the same reasoning) — the bar's track/fill likewise bumps 9px → 14px while on so the pattern has room; **"Also on labelled tags"** (secondary, `disabled` until the primary is checked) additionally applies a `-webkit-text-stroke` + `paint-order: stroke fill` halo — never a plate, which the design doc found reads as a bandaid behind a word — to the three worded sites: the timeline spine (`renderTlRow`, `js/history.js`), the log-form chip (`lfBuildTypeGrid`, `js/logform.js` — the `.sel` state only, since an unselected chip is just a thin `--tc` border stripe, not a real swatch), and the dive-file hero pill (both call sites in `js/history.js`). `TYPE_TEXTURE` (`js/app.js`) is the one table every consumer reads — Boat/Reef solid, Shore/Night dots, Drift arcs, Cave/Muck horizontal, Wall vertical, Wreck diagR, Pinnacle diagL — a graph-colouring assignment where every texture-sharing pair is independently confirmed far apart in colour under both protanopia and deuteranopia simulation. `_texTypesOn()`/`_texLabelsStored()`/`_texLabelsOn()` (js/app.js) are the shared read API; `_texLabelsOn()` is AND-gated on the primary so every consumer can call one function rather than re-deriving the dependency, and turning the primary off only suppresses the secondary's *effect* — its own stored preference survives, so re-enabling the primary brings it straight back without needing to re-check the box. The switch itself (`.tx-switch`/`.tx-row`) is a new primitive — checked first, and confirmed nothing like a binary on/off control existed anywhere in the app to reuse (every existing Settings-style control is a segmented group like `.theme-seg`); built as a real `<button role="switch" aria-checked>`, matching the app's existing ARIA-first toggle conventions rather than a styled checkbox.
  **A real bug found live during implementation, not anticipated by the design doc: the CSS `background` shorthand silently deletes `background-image`.** All four consumer sites originally set their `--type-*` fill via `background: var(--type-X)` (three as CSS class rules, one as an inline style built in JS) — and per spec, the shorthand form resets every sub-property it doesn't mention, `background-image` included, back to its initial value. That clobbered the `[data-tex]` texture layer at all four sites simultaneously, for two different reasons: at the three CSS-rule sites (`.st-fil`, `.dD-spine`'s base and per-type rules, `.lf-type-chip`'s base and `.sel` rules) the fill rule and the `[data-tex="X"]` rule are equal specificity, so whichever sits later in source wins — and the fill rules, written long before this feature, all sit after the new texture block; at the fourth (the hero pill's inline `style="background:…"`, `js/history.js`) an inline style beats any stylesheet rule regardless of specificity, so it clobbered unconditionally. First caught on the Stats bars (`getComputedStyle` showing `backgroundImage: 'none'` despite a correctly-set `data-tex="arcs"` attribute), which looked like a one-site fix until the same `getComputedStyle` check on the spine turned up a second, source-order-only instance of the identical bug in `.dD-spine`'s own *base* (no-type) rule — worth the reminder that fixing the obvious call site doesn't mean checking whether an ancestor/base rule shares the same shorthand is unnecessary. Fixed by switching all four origin points from `background` to `background-color`, which only ever touches the fill colour and leaves any external `background-image` declaration free to apply — verified live afterward at all four sites (a visible ripple texture on a Drift stat bar and timeline spine, a visible dot-halo on a selected Night chip), in both themes, with both toggle states including the dependent-disable/re-enable round trip, and a clean console throughout.
- **Plan panel (`js/planner.js`, v2.6):** tide calendar (moon-phase spring/neap, offline, any date), location picker, Open-Meteo wind/sea forecast with a Diveable/Marginal/Too windy verdict on gust (the surface-feel threshold, not sustained speed), and a surface-interval calculator (vendored MIT `scuba-physics`, Bühlmann ZHL-16C — see `vendor/scuba-physics/README.md`). Add planned dives (depth/time/gas/optional entry time); drag or ▲▼ to reorder, ✎ to edit one in place; shows per-dive NDL, the chained minimum surface interval, and — with entry times — an actual clock-time "earliest re-entry". Standard (GF 100/100 — the raw ceiling, no added margin) / Conservative (GF 40/85, what Standard used to be) presets — GF 100/100 as Standard is a deliberate, knowing override of an earlier "never loosen this" rule (DECISIONS.md → "GF 100/100 as Standard"), and is a hard floor: nothing looser exists within this model. **Deco-stop planning (2026-07):** a dive that exceeds NDL is never hard-blocked — it shows a real stop schedule (depth + minutes, `_planExtractStops()` reading segments `BuhlmannAlgorithm.decompression()` was already computing for tissue-chaining) instead of "exceeds no-stop limit", styled `--warn` not `--danger` (advisory, not an error — see `CLAUDE colour UI.md`). A real surface interval (both dives' entry times set) now overrides the prescriptive recommended minimum for the actual NDL/stop calculation — going in sooner than recommended is shown, never blocked. See DECISIONS.md → "Deco-stop planning: advise, never enforce" for the full design, including why multi-level intra-dive profiles were considered first and dropped (BSAC/PADI tables use the same square-profile assumption this tool does; their simplicity comes from replacing a refusal with a stop, not from multi-level credit). Desktop additionally gets real UK tide times (Admiralty Discovery API via the Tauri Rust seam) — see "Known constraints" below for the UK-only scope and no-cache rule.
- **Full BSAC dive logging form** organised as a 7-section exclusive accordion (Dive, Dive profile, Conditions, Gas & equipment, Marine life, Notes, Buddy & sign-off). One section open at a time; tapping the open section collapses it (all-closed is valid for pre-save summary scan). Each section shows a 3-state summary chip when collapsed: "Expand" (empty), partial data, or green ✓ (complete). Form opens with only the Dive section expanded (Marine life instead when entering edit mode).
- **Log-form redesign (`js/logform.js`).** The form's data-entry controls are visual, not native dropdowns: dive type is a colour-chip grid (History `--type-*` ramp), water type / current / tank type are segmented toggles, weather is a 3-icon enum picker (Sunny/Cloudy/Rain), visibility & water-temp are gradient dials paired with number inputs, and numerics sit in compact inline-unit rows. **Key invariant:** every visual control writes into the *same* canonical hidden input the rest of the app already reads (`f-entry`, `f-watertype`, `f-current`, `f-tanktype`, `f-weather`, …) — save/markdown generation are unchanged. `logform.js` is **prefix-parameterised**; only `'f'` (the log form) exists since the edit modal retired in v2.83, but the parameterisation stays so a second form context could be wired without duplicating the file.
  - **Location is a map-pin card.** An in-form Leaflet map (the relocatable `#f-mapbox`) replaces manual lat/lng entry for most cases: tap/drag the pin → coords; "⊕ Use my location". A "✎ Enter coordinates" toggle (`lfToggleManualCoords`) reveals the same lat/lng number inputs alongside the still-live map, for exact-coordinate entry or tweaking a roughly-dropped pin — distinct from the **offline fallback** (`lfShowOffline`), which shows the same inputs but hides the map entirely when tiles genuinely fail to load (see DECISIONS.md → "Manual coordinate entry on the log-form map"). The pin reverse-geocodes (Nominatim) to *suggest* Country + Region behind a "Confirm". **Country/Region flow both ways**: the Country `<select>` focuses the map (`fitBounds` on the Nominatim bbox), free-text Region is the user's label, and picking a Dive Vibe/OSM site also drops the pin (`lfSetPin`).
  - **Mobile map picker (v2.91).** Below the 1024px rail breakpoint, the compact in-form map is a non-interactive preview (`_ms(p).compactMode`) — dragging/tap-to-place/zoom are disabled and its zoom control hidden, since real-user testing found the compact map plus an open on-screen keyboard left almost no usable area to pinch/pan a potentially-global map. Any tap reparents the SAME `#f-mapbox` node (same technique the desktop rail already uses to relocate it — no second Leaflet instance) into a full-viewport picker (`lfOpenMapPicker`/`closeMapPickerDirect`, `js/logform.js`), which is wired into the standard overlay-stack (`_pushOverlayState`/`_closeOverlayDirect`, `js/app.js`) so back-gesture and Escape close it exactly like the dive file, species profile, and footage modal. `_lfSetMapInteractive()` re-enables the map/marker drag and zoom handlers for the duration the same instance sits in the modal, then disables them again on close. Confirming the reverse-geocoded place while the picker is open auto-closes it back to the form after a brief pause — confirming the place *is* "I'm done," so Done doesn't need to be a second required tap.
  - **Desktop (≥1024px) is two columns** (`.lf-layout`): form left (50%), a sticky right rail (`#log-rail`) showing the **map** by default and swapping to the **species photo grid** when Marine life is active. The map node and `#species-dropdown` physically relocate between inline slots and the rail on resize/section-change (`lfLayout` / `lfSetRailContext`). Mobile keeps the single-column form with the map inline and the existing full-screen species picker. `#panel-log`'s 780px cap is lifted at ≥1024px.
  - **Date/Entry/Exit time — custom trigger + native `showPicker()`, touch-primary devices only (2026-08-02).** `type="date"`/`type="time"` are the two fields this redesign hadn't reached — still full-width native inputs, and on Android/mobile WebView they're tap-only (no typing path exists at all, unlike desktop's typeable digit segments), so they looked like every other text field while behaving nothing like one. Two earlier attempts at restyling the native input directly both failed on real hardware/browsers: a `background-image` icon painted across it repeated once per internal segment (month/day/year, or hour/minute) on **both** WKWebView and Chromium, since neither renders these types as a single flat box — and the initial `max-width` gate for "mobile" also inherited the treatment onto a merely-narrow **desktop** window (`cargo tauri dev`), since a resized window and a touchscreen aren't the same thing. Checking Material Web's own reference implementation afterward confirmed this wasn't specific to Shoal's approach: `date`/`time`/`datetime-local` are explicitly typed as `UnsupportedTextFieldType` in their text field component, and the only thing they build on top of a date/time input is `showPicker()` — a thin passthrough to the browser's own native picker, no attempt at a leading icon over the input itself.
    The shipped date/time version (`js/logform.js` — `lfShowPicker`/`lfSyncPickerDisplay`/`lfInitPickerInputs`) doesn't restyle the native input at all: a plain `<button class="lf-picker-trigger">` (icon + formatted value, fully own markup, zero native-rendering surprises) calls the real input's `.showPicker()` on click — the same primitive Material Web's own component relies on. The real `<input>` stays the sole source of truth for `.value`; every existing reader (`saveDive`, `calcExitTime`, UDDF prefill, `openEdit`) is unchanged. Gated on `@media (pointer: coarse)`, not a width breakpoint — the actual question ("is the primary input a touchscreen") a resized desktop window can never satisfy regardless of how narrow it gets. `tabindex`/`aria-hidden` on the real input are set by JS (`lfInitPickerInputs`, called from the unified `show()` patch whenever the Log panel is entered), never static HTML, since the same input must stay the primary tabbable control on fine-pointer devices where the trigger is hidden and never shown. Three sync points needed finding *live*, not by inspection, since none of them fire a normal `input` event: `calcExitTime()` and `_afterSaveReset()`/`_resetLogFormFull()` all set these fields' `.value` by direct assignment, which a `oninput`-based sync never sees — each now explicitly re-syncs the affected trigger(s) at the point of assignment.
  - **Dive profile is grouped Time / Depth, one row each (2026-08-02).** Was a single "Time & depth" row cramming bottom time, max depth and avg depth together (distinguished only by unit suffixes — "m max" / "m avg"), with Entry/Exit time in a separate row below, which read as one undifferentiated block. Now two labelled groups: **Time** → Bottom · Entry · Exit, **Depth** → Max · Average, each field carrying its own `.lf-numlbl` so the unit suffix drops back to a plain "m". Their empty state is an em-dash rather than "Select time": in a 3-column row the explicit Entry/Exit label already says what a longer prompt would, and the pill shape + clock icon carry the tappable affordance on their own.
    **Layout (`.lf-pgroup`/`.lf-pfields`) deliberately mirrors the `.stops-group` block directly below it**, which had already solved this exact problem — a mono row label in a fixed left gutter, fields to its right — so the whole section reads as one system instead of three unrelated layouts. Two things fix the wasted space the first attempt still had: the group name moves out of its own full-width line into the gutter (so it reads as "everything right of this is Time"), and at `@media (min-width: 600px)` the field columns are **capped** at 132px rather than stretched to `1fr` — a 2–3 digit depth in a 400px-wide box left the value and its unit stranded at opposite ends, which is what made it look unbalanced. Both rows share that one 3-column 132px track at desktop widths, so Depth's two fields align under Time's first two (measured: identical `x` at 335/477 on a 900px window) — that shared alignment is the symmetry.
    **Depth's gutter is unconditional — no `@media(min-width:600px)` gate (2026-08-03).** Depth is only 2 plain number fields, which fit fine with a gutter carved out of the width at any size (measured live: 121px per field at a 360px viewport) — so `.lf-pgroup-compact` gives it the gutter at every width instead of stacking the label above, matching Stops beside it at all sizes, not just desktop. Found live: a first pass left Depth stacked on mobile despite clearly having the room, since the original rule made no distinction between "can't fit a gutter" and "just hadn't been given one."
    **Time got the same gutter shortly after, but needed real width surgery first — an initial "Time can't afford it" conclusion turned out to be about the ROW, not the gutter.** The blocker was never the 54px gutter itself; it was that Bottom, Entry and Exit were splitting the row into three EQUAL columns when their content wasn't remotely equal — Bottom needs `~76px` (a 3-digit number + "min"), while Entry/Exit's pills (icon + time text) measure `~94px` unsquashable content. An equal three-way split starved the pills no matter how the leftover width was allocated. `.lf-pfields-time` fixes the actual cause — an explicit `76px minmax(0,1fr) minmax(0,1fr)` template, so Bottom takes only what it needs and Entry/Exit split the rest — and only *then* did the gutter (`.lf-pgroup-compact`, shared with Depth) have anywhere to come from.
    Getting from "doesn't fit" to "fits" needed two rounds of measurement, not one, because the first check asked the wrong question. `.lf-pfields`'s columns use `minmax(0, 1fr)` — the explicit `0` overrides the grid default that would otherwise refuse to shrink a track below its content's natural size — so a squeezed pill doesn't make its GRID CONTAINER overflow (nothing to catch via `scrollWidth > clientWidth` on `.lf-pfields`); it makes the pill's own **text** spill silently past its own box edge, since every level here is `overflow: visible`. Checking the outer grid said "fits" at 390px and above; checking the text node's own `getBoundingClientRect().right` against the pill's showed real overflow all the way up to 375px (0px margin) before this pass, worse at each width below that (8px over at 360px, 28px over at 320px). Three small trims closed it: the pill's own horizontal padding (14px → 10px per side), the icon-to-text gap (8px → 6px), and `.lf-pfields`'s inter-column gap (8px → 6px, shared with Depth — harmless there, which already has room to spare) — plus Bottom's template width down to the confirmed-safe 76px floor (a live sweep from 96px down: still uncut at 76px with a worst-case 3-digit value, first showing real input clipping at 70px). Net result, checked against the same real widths: **375px+ comfortable (−11px), 360px real but thin (−4px), 320px (pre-2016 iPhone SE era) still genuinely overflows** — a disclosed gap on hardware this app isn't targeting, not a silently-accepted one. Luke's own test device (Galaxy S10+, 412px) clears with the same margin as 375px+.
    **`.lf-pfields-time` shipped gated on width alone, and that was a real bug, not a hypothetical one — found live within the same session, from a screenshot showing "45" cramped next to two huge native time inputs.** The 76px-Bottom template had no pointer condition of its own; it only ever "worked" on desktop because the `>=600px` equal-columns rule happened to come later in source and win there — which holds on a genuinely wide window, but not on a narrowED desktop Chrome window under 600px (mouse, so the native input renders, not the pill) — exactly the same "narrow window ≠ mobile" trap the date/time trigger's own `(pointer: coarse)` gate exists to avoid, just not yet applied to this newer rule. A resized desktop window matched the width condition, got Bottom's tiny 76px share anyway, and dumped every leftover pixel onto Entry/Exit's *native* inputs (`.lf-picker-native`, uncapped at `width:100%`) with nothing there needing it — the exact lopsided screenshot this was found from. Now wrapped in `@media (pointer: coarse)`, so a fine-pointer window at any width falls back to the base `.lf-pfields`'s equal thirds (or the desktop 132px cap) — correct, since a typeable native input has no pill-width squeeze to accommodate in the first place. Confirmed live at the exact window/width that broke before (500px, fine pointer): columns went from a 76/144/144 split back to an even ~121px each.
    **`.lf-picker-native` needed explicit fine-pointer styling as part of this.** Moving these fields into `.lf-numcol` took them out of `.field`, which had been silently supplying their box — on desktop, where the trigger is hidden and the real input is what you interact with, Entry/Exit rendered with a different radius and padding to the Bottom/Max/Average cells on the same row. Caught from a screenshot, not by inspection.
    **Depth wrongly inherited Time's 3-column `1fr` template on mobile too (found from a screenshot, fixed 2026-08-03).** Below 600px there's no cap — `.lf-pfields` is `repeat(3, minmax(0,1fr))` so each column claims a full third of the row *regardless of whether a grid item actually occupies it*. Depth only has 2 fields, so it was rendering inside that same 3-column template with the third column sitting empty — Max/Average stuck at 2/3 the width they could have, which is what made the row look thin and unbalanced next to Time's. `.lf-pfields-2` (added to the Depth row's markup only) overrides just the base, unconditioned rule to `repeat(2, minmax(0,1fr))`; no `@media (min-width:600px)` counterpart is needed for it, because at that width the existing `.lf-pfields{repeat(3, minmax(0,132px))}` rule — same specificity, declared later in the file — wins on source order and puts Depth right back on the shared desktop-aligned template, unchanged. Measured live at a real 380px width: Max/Average grew from 131px to 167px each, no overflow.
    **The page's outer horizontal margin was also reduced the same pass** (`.main`'s mobile padding, 10px → 6px each side) — see Known Constraints → "`.main`'s padding had three overlapping breakpoints" for the source-order bug this uncovered and fixed along the way (a much older, undocumented ≤720px tier was silently winning this property on every phone width, which is *also* why the nav-wave-clearance bottom padding described elsewhere in this file had likely never actually taken effect on a real phone before this fix).
  - **Tap-to-scroll number wheel on cylinder pressure and weight (`lfOpenNumScroller`, `js/logform.js`).** Start/End pressure and weight are values you *fine-tune around a known figure* (~200 bar in, ~50 out, single-digit kg) rather than enter freely, so a scroll-to-value wheel beats a keypad. **Deliberately NOT on max/average depth** — those are precise, arbitrary readings off a computer, where hunting a wheel is slower than typing. Strictly **additive**: the number input stays fully typeable on every device (so there's no pointer-type gate here, unlike the date/time pickers above — nothing is taken away), and the trigger is a separate small button on the *label* row. That placement isn't cosmetic: a first attempt put it inside the `.lf-num` box and it took exactly its own 33px out of the input, collapsing a 96px 4-column cell's field to 33px and clipping the "200"/"50" placeholders to "2"/"5" — the label row has free width at every breakpoint and gives the button a ≥24px target. **The wheel never writes a value on its own**: opening it on an empty field centres the typical figure purely as a starting point, and only "Set" commits — Cancel, Escape, back-gesture and backdrop-tap all leave the field exactly as it was, so an unrecorded pressure is never silently invented as 200/50. Values are built by index (`min + i * step`, rounded), not by accumulating `v += step`, since weight's 0.5 step drifts under repeated float addition and would otherwise put `6.000000000000001` into a saved dive. Commit dispatches a real `input` event so it's indistinguishable from typing to any listener. On the standard overlay view-stack (`_pushOverlayState`/`_closeOverlayDirect` → `closeNumScrollerDirect`), and the track is a real `role="listbox"` with arrow/PageUp/PageDown/Home/End/Enter keyboard support.
  - **Tank type defaults to Steel, not Aluminium (2026-08-02).** Changed in all four places that set it — the hidden input's markup default, `_resetLogFormFull`, `_afterSaveReset`'s carry-forward fallback, and `openEdit`'s fallback for an old dive that recorded no tank type at all. That last one necessarily invents a value either way; keeping it equal to the form's own default avoids the app having two different "defaults" depending on which path you came in through.
  - **Gas & equipment regrouped by what each field actually describes, not by input type (2026-08-03).** Start/End pressure, Weight and Suit used to sit in one undifferentiated 4-column row (Size/Gas mix/Tank type trailing below), so Weight and Suit — neither of them a cylinder attribute — read as part of "Cylinder & pressure" simply by proximity, while Size and Tank type didn't. Now **Cylinder & pressure** covers Start/End, Size/Gas mix, and Tank type as one block (three rows, matching what's physically true of a single cylinder), and a new **Weight & suit** label holds the two personal-gear fields at the end. Pure reorder — every input keeps its existing id, autocomplete wiring, and wheel button, so `saveDive`/`openEdit`/the section-summary chip needed no changes (confirmed live: the summary still reads pressure/gas/size correctly). Also fixed in the process: the two new 2-item rows use `.lf-numrow-2`, not the old `.lf-numrow-4` — reusing the 4-column template for a row that now only has 2 real fields would have reproduced the exact phantom-empty-column bug the Depth row fix (above) had just found and fixed, just worse (2 fields sharing 2 of 4 columns instead of 2 of 3).
    **Start/End/Size/Weight no longer stretch to fill their grid column, and their wheel-scroll trigger moved off the label row to sit beside the field (2026-08-03).** The reorder above put these fields in dedicated 2-column rows for the first time, and `.lf-num`'s default behaviour — stretching to fill whatever width its grid column gives it — meant a 3-digit pressure value was rendering in a box roughly twice as wide as it needs, found live once Start/End had a whole half-row to stretch into instead of sharing a cramped 4-column cell. `.lf-num-compact` caps these four fields at a fixed 96px (input + unit) instead, and the freed space is exactly where `.lf-num-wheel` now sits, in a `.lf-num-wrap` flex row beside the field — the original reason the button lived on the label row was that a 96px *4-column* cell had no spare width for it without clipping the input; once these fields moved to dedicated 2-column rows that constraint no longer holds, so the button moved to the more discoverable, more conventional position beside the value it controls. Added a fourth scroller: **Size (tank volume)** now gets the same wheel as Start/End/Weight, `min:3 max:18 step:0.5 typical:12` (`LF_SCROLLERS`, `js/logform.js`) — matching its existing `value="12"` static default, so the common case never needs the scroller opened at all. Gas mix and Suit are deliberately untouched — a native `<select>`/free-text field, not a "fine-tune around a known figure" numeric input, so neither fits the pattern the wheel exists for.
    **`.lf-num-wheel`'s icon colour was also wrong, independent of its position — `--text-dim` measures 2.16:1 and `CLAUDE colour UI.md` marks that token "decorative only... cannot pass, by design."** Fine for a passive label, wrong for a button someone needs to notice is tappable — reported live as "very hard to see." Switched to `--text-muted` (4.52–5.48:1), the same token every other secondary-but-interactive icon in the app already uses.
- **Notes title field & journal read-back (v2.72/2.73).** Optional short headline (`title`) per dive stored in YAML frontmatter. History timeline shows a "glimpse" (title → first-sentence snippet → empty; species-name fallback removed — rarest species already shown as thumbnail on timeline card). Notes rendered in serif with title/hr header as a full-width journal block at the bottom of the desktop dive file.
- **Desktop dive file redesign (v2.72.2).** Full-bleed ambient Leaflet map hero (GPS-gated, bleeds edge-to-edge via negative margin). Data ribbon replaced by floating CSS-circle bubbles (`aspect-ratio: 1 / border-radius: 50%`, independent bob animation) showing depth, time, gas, and a chronological profile timeline (IN ↓ / Stop / Out ↑). Marine section is a fixed-height 2-column grid (carousel left, scrollable sightings list right) — design language borrowed from the footage modal. `df-body` capped at 1130 px; `#panel-history` uncapped, `#history-content` capped at 900 px.
  **Mobile's ambient hero got the same full-bleed treatment (2026-08-03) — it had never actually been built there, not a regression.** The negative-margin technique above was written inside the `>=900px` desktop block only; below that, `.df-hero-map`'s base rule (rounded corners, no margin) just sat inside `.main`'s own padded content area, which is what a screenshot caught. Mobile's version cancels `.main`'s own mobile padding (`6px` sides, the safe-area-aware top value from the cutout fixes above) rather than desktop's `2.5rem`/`3rem`, and only in the *ambient* state — `.df-hero-fullscreen` (the tap-to-expand view) needed an explicit `margin: 0 !important` added alongside its other overrides, since without it the ambient state's negative margin would otherwise carry into a `position:fixed;inset:0` element and push it past the viewport instead of resizing it. `.df-hero-content` is bottom-anchored (`justify-content: flex-end`) within the hero, so extending the top edge upward doesn't move the title/badge text — only the decorative map above it grows into space nothing else was using. Verified live in both states: the ambient hero reaches the true top/left/right edges with square corners, and toggling to/from fullscreen produces no horizontal overflow either way.
- **Dive file: joined mobile tab strip + unified visual Overview, mobile and desktop (v2.96).** The Marine/Overview/Journal segmented control (`.df-seg`, mobile only) is a folder-tab construction, not a pill switcher: the trough sits in `--surface2` (same recessed tone as the log form's marine search bar) holding only the unselected tabs; the active tab keeps `--surface` white and overlaps the seam into the panel below it (`margin-bottom: -1px`) so tab and panel read as one continuous white object, with a fine `--accent` underline right at the seam doubling as the selection marker. See DECISIONS.md → "Mobile dive-file tab strip: folder-tab join, not a pill switcher".
  Overview itself (`js/history.js` — `_dfTempTileHtml`/`_dfCurrentTileHtml`/`_dfWeatherTileHtml`/`_dfTankHtml`/`_dfSpecRow`, built once as `overviewContent` and rendered unchanged in *two* places — see desktop paragraph below) replaces the old uniform-weight bubble grid with a hierarchy matched to what each field actually is: temperature gets a full-width gradient bar reusing the log form's exact `.dial-temp` stops (0–35 °C) with a ticker at the logged value; current is 3 SVG chevrons growing 15→20→26px, filled by intensity (None/Slight/Moderate/Strong); weather fuzzy-matches the same three concepts the log form's icon picker uses (`sun`/`cloud`/`rain` substring match on the free-text field, falling back to plain text with no icon — `weather` isn't a strict enum, legacy values like `"Sunny, calm"` still round-trip); gas pressure is a horizontal cylinder gauge (`_dfTankHtml`) drawn as a real tank silhouette (valve/neck/rounded body/domed end, not a rounded rect) with the start-pressure number fixed at the far left and the end-pressure number fixed at the far right — colour is constant per position (start always dark, end always white) rather than adapting to the fill, which only works because dark text passes contrast on both the empty body and the fill (11.1:1 / 3.9:1) while white only passes on the fill (1.16:1 on the empty body is measured-invisible, not just low-contrast) — SAC rate sits in the tank's footer, reusing `sacClass`'s existing colour thresholds. All icons are inline SVG (`_dfIcon`/`DF_ICONS`), not emoji — device-inconsistent glyph weight/colour, and emoji can't inherit `--text-muted`. Everything else (safety stop, suit/weight, buddy, operator/trip, sign-off) is a plain icon spec row. Visibility deliberately has no tile of its own — it lives only in the hero stat band (`.df-band`), with a small `--surface`-on-gradient ticker (`_dfVisBarHtml`, shared with `.df-pc-stats`) under the number, at the same 0–30 m scale as the log form's vis dial; showing it a second time in Overview was tried and dropped as duplication. The hero band's avg-depth cell now also appears on mobile (previously desktop-only) but only when the dive actually has the data — no `—` placeholder taking a slot (`.df-band-has-avg`/`.df-pc-stats.df-band-has-avg` modifier, 3-vs-4 columns).
  The profile chart's own stat strip (`js/profile.js` — `renderProfileChart`) lost its SAC-rate-plus-gas-bar cell (now redundant with the Overview tank) and its "min °c" cell — min temp no longer needs a display of its own because `_computeMinTemp` (previously only used for that cell) now feeds the *logged* temp at dive-computer import time instead (`_prefillLogFormFromProfile`, `_bulkAddNewDives` — both switched from `_computeAvgTemp`, since deleted, to `_computeMinTemp(...).value`): most divers only care about the coldest point of a dive, not a computed average, and this way there's one temperature shown per dive, not two potentially-different ones. Existing already-logged dives keep whatever avg-derived temp they were imported with — this only changes what gets pre-filled on *new* imports going forward.
  **Desktop (≥900px)** retired its own separate representation of this data entirely — the four circular "bubble" `<dl>` cards (Conditions/Profile/Gas & equipment/Sign-off, `.df-data-strip`/`.df-data-col`) are gone. In their place, `.df-desk-journal-row` is a 2fr:1fr grid: the journal (narrowed from full-body-width) on the left, and a *second, unchanged* rendering of `overviewContent` on the right — the 1fr column lands at ~369px on the 1130px-capped `.df-body`, close enough to a phone's own width that the mobile tiles/tank/rows needed zero desktop-specific styling. The journal is now **always shown on desktop, even empty** (`_notesBlockHtml(d, true)`) — a dashed, clickable placeholder ("tap to add a title or notes", → `openEdit(id)`) rather than hiding the block, on the theory that permanent, spacious real estate invites filling it in rather than needing an apology for being blank. Mobile's Journal tab is unchanged and still only exists when there's something to show. See DECISIONS.md → "Mobile dive-file Overview" and "Desktop dive-file journal/overview row" for the full design story, including the two real bugs the tank's fixed-position numbers went through (fallback direction pushing numbers off-canvas/onto the valve; a fill boundary landing mid-number leaving its leading digits unreadable) and the SAC/gas/pressure data that had briefly gone missing on desktop entirely for profile-chart dives as a knock-on of an earlier change, caught and fixed as part of this pass.
- **3-layer background texture system (v2.72.2).** Depth gradient on every page (`body::before`, fixed). Caustics shimmer (`::after` GPU `transform` animation) on stat bubbles and timeline cards. Static sun-on-water mesh on text surfaces (journal, welcome card, settings). Single `--shimmer` (0–1) dial derives both opacity and drift speed via `calc()` in `:root`; user-facing slider in Settings → Appearance persisted to `localStorage`. See DECISIONS.md → "Background texture system".
- Species search with 1,275-species local database (`data/species-db.js`)
- **Species browse mode:** category tabs (taxonomically ordered) with alphabetical listing — fallback when search field is empty
- Marine life sighting cards with abundance (R/O/C Seasearch scale)
- **Species Album (`js/album.js`):** per-species index over logged dives; taxonomy-grouped thumbnail strips with iNat reference photos; species profile modal (medium photo hero, GPS map of sighting sites, "Dive log" sightings list with 📍 pins, a "Found in" region line below the IUCN badge when the species has `regions` data — omitted entirely otherwise, never shown blank); live search filter
- **Log-form Country pre-filter (v2.93+, `js/species.js`/`js/logform.js`):** selecting a Country narrows the Marine life species picker (desktop photo-grid panel and mobile full-screen picker alike) to species with at least one matching `regions` code, via a dismissible "Showing species recorded near X — Show all" banner (full-sentence form in the static Marine life section, compact stacked form in the mobile picker's topbar). Free-text/custom sightings are always exempt. See ROADMAP.md → "Species browser pre-filter" for the design story, including two real bugs caught only by live-testing on a real device: category-tab counts not respecting the active filter, and a flex-sizing bug where the search input silently stole space from a capped region pill instead of the pill eliding long names.
- History browser with sort (dive no, depth, country); trip-grouped sticky-header timeline
- **Rename trip:** ✎ on trip headers — renames `trip` across the group (also names region/country proxy groups as a trip), re-pushes affected `.md` files to the active backend. ✓/✕ buttons; Enter commits, Escape/blur cancels
- **Bulk selection + trip-assign (v2.89, `js/history.js`).** Rename trip only ever operates on a whole existing group — no help for a 90+ dive bulk-add/BLE-sync batch that lands entirely in one "Ungrouped" bucket with no trip label to rename yet. "Select" (own row above the sort toolbar, Select left/Map right — sharing that row with the three sort buttons was found crowded/confusing on mobile) turns each card into a tappable checkbox: tap a dive, tap another to select the inclusive range between them in current on-screen order (`_historyDomOrder()` reads live DOM order rather than re-deriving sort/group logic, so it's correct under any sort/grouping with no duplicated rules) — no shift-key needed, works identically on touch and mouse. Anchor stays fixed across taps (mirrors shift-click); tapping an already-selected dive deselects just that one and drops the anchor, so the next tap starts a fresh range. A bulk action bar (autocomplete-backed trip-name input + Apply) assigns the trip to the whole selection at once; Apply clears the selection but stays in selection mode so the next batch can be picked immediately ("tackle one trip at a time"). `_applyTripToDiveList(diveList, newName)` is the persist/re-push logic shared with `commitTripRename` above — same function, two callers (a whole group derived by key vs. an arbitrary checkbox selection), extracted rather than duplicated. The checkbox is a `position:absolute` overlay on the `.dD-spine` column (not a new grid column, which would've had to be threaded through both the mobile 2-col template and every desktop `.dh-*` column count) — first tried top-right of the card, but that collided with the mobile layout's `.dD-meas` depth/time stats, found live-testing at 500px width.
- **Map view inside History:** "Map" button (in the Select/Map actions row above the sort toolbar, v2.89) → full-panel Leaflet map of GPS-tagged dives; "← List" returns to timeline
- **Dive-type colour-coded map pins, one per site, with tap-through to the dive file (v2.993, `js/map.js`).** Pins previously ignored dive type entirely — Leaflet's stock blue teardrop for every dive — so the map was the one surface in the app that threw away the one thing every other `--type-*` site (spine, chip, hero pill, Stats bars) already encodes. Pins now carry the ramp colour via `_typePinIcon()`, built as an `L.divIcon` rather than an `L.circleMarker` specifically because an SVG shape can't take `background-image`, which would forfeit the colourblind texture channel — real HTML gets both live CSS-var theming and `[data-tex]` for free, verified live: a theme flip re-colours an already-open map with no re-render, the same class of correctness `_dfRerenderProfileIfOpen` exists for elsewhere.
  **One pin per site, not per dive** — coordinate-grouped on the same 4dp rounding `js/album.js` uses to dedup sighting sites, coloured by the site's *majority* type (`_majorityType`). This is load-bearing, not cosmetic: once a pin is a navigation target, a stack of same-site dives under the old one-pin-per-dive model would leave all but the topmost unreachable. The popup (`_sitePopupHtml`) lists every dive at the site as its own row — number, type, date, depth — each calling `goToDiveFromMap(diveId)` (see "Species profile link affordances" above for why that function branches on which map surface it's called from). A legend (`_addTypeLegend`, an `L.Control` at `topright`) lists only the types actually present with their dive counts, summing to `#map-subtitle`'s figure — required rather than decorative, since a map pin is the app's first surface where colour is the *only* per-item encoding; see `CLAUDE colour UI.md` → "Map pins" for the full design reasoning (including the three separate run-ins with Leaflet's stylesheet winning same-specificity ties against this file's own CSS).
  Also replaced the dive-file hero map's hardcoded `#4A90B8` circleMarker (light-mode `--accent` inlined, stayed pale blue in Harbour Night, invisible to the token system) with the same shared pin helper. The trip ambient banner (`.tl-trip-map`, below) is deliberately left uncoloured — a 5px non-interactive dot, under the texture channel's legibility floor, with no room for a legend.
- **Trip-map full-screen view (v2.93).** The trip-grouped timeline's ambient recognition map (`.tl-trip-map`, ~120px, ~90px mobile) is deliberately non-interactive — `_buildTripMap` disables every Leaflet handler at creation, "recognition, not navigation." Real-user testing found people tapped it expecting to pinch/zoom directly regardless, so the whole card is now a tap target (`openTripMapView`, `js/history.js`) that opens the same pins full-screen in a *fresh* Leaflet instance with real pan/pinch-zoom — not the ambient map reparented, since that one's interaction handlers were disabled at construction. Reuses `renderMapMarkers()` (`js/map.js`, generalised to take an optional `(mapInstance, diveList)` instead of always targeting the full History Map view's own globals) for the actual pins, so the colours, legend and popups are byte-identical to the History Map view's — not a simplified stand-in — which is also what let the v2.993 dive-type colouring above land here with no code written specifically for this view. `_tripMapHtml` now emits a `data-uids` attribute (each mapped dive's stable `uid`) alongside the ambient banner's existing `data-coords`, so the full-screen view can look up the real dive objects rather than bare position dots. Shares the `.map-modal` shell (generalised from `.lf-mapmodal-*`, the log form's pin picker) and the standard overlay-stack (`_pushOverlayState`/`_closeOverlayDirect`) — back-gesture and Escape close it exactly like every other full-screen surface in the app. View-only by design: no pin placement, no dragging, no editing.
- **GPS coordinates per dive:** stored as `gps_lat`/`gps_lng`; 📍 shown inline in history list and species sighting rows
- **Site search:** dual-source autocomplete — Dive Vibe Community (primary, with siteType → dive type auto-fill) + OpenStreetMap Nominatim (fallback)
- **Dive type:** Boat, Shore, Drift, Night, Cave, Wreck, Reef, Wall, Pinnacle, Muck
- **Stats hero (v2.96).** The six headline stat cards (total dives, bottom time, deepest, avg depth, sites, species logged) are floating circular bubbles with a gentle independent bob, at every breakpoint (3-col desktop, 2-col mobile — the grid itself unchanged, only the card shape/motion). Ported from the dive-file's own bubble motif the same week that motif was retired there (see "Dive file" above) — `@keyframes df-bob` moved to global CSS scope so `.stat-card` can use it on mobile too, not just the desktop-only context `.df-data-col` originally had it in. One shared `.stat-value` font size across all six, sized to the widest real value ("118h 6m"), not per-card — a circle punishes a wide string harder than a rounded rect does, so the six needed to agree on one size rather than each finding its own.
- Charts: depth, country, species frequency, dives by country, top species by country, activity by year/month, dive type breakdown, SAC by dive type
- **Edit mode (v2.83, replaced the edit modal)** — ✎ anywhere (timeline row, dive file) prefills the *actual log form* from the dive and flips `#panel-log` into edit mode: accent-tinted `.editing` section-card borders (persists as a signal past the banner while scrolling — DECISIONS.md), hides UDDF import + confirm bar + intro subtitles, "Edit a dive" title, an `✎ Editing dive #N — Site` banner with Cancel, save buttons relabelled "Save changes". `saveDive()`'s edit branch merges `{ ...existing, ...fields }` so off-form data (uid, videos, `_filename`) survives; save/cancel/back-gesture all land on History and leaving the Log panel for any reason disarms edit mode (one line in the unified `show()` patch). **No dirty-confirm guard on entry** — ✎ always jumps straight into edit, silently discarding any unsaved Log-page draft, matching how switching to Stats/Species already treats one; a guard was built and pulled after twice missing real content fields in testing. A pending UDDF profile is still discarded on entry + gated in profile.js's `saveDive` patch so it can never attach via an edit save. Opens with Marine life expanded (most common edit target). See `briefs-archive/v2.83-BRIEF-edit-in-place.md`.
- **"View dive →"** in the post-save confirm bar jumps straight to the just-saved dive's read view (History → dive file) — one tap to check a save, ✎ is right there if it needs fixing.
- **Manual coordinate entry (`lfToggleManualCoords`/`lfApplyManualCoords`, `js/logform.js`)** — "✎ Enter coordinates" on the log-form map reveals lat/lng inputs without hiding the live map (distinct from the offline tile-failure fallback, which still hides it); a "Set pin →" button applies them via the same `lfSetPin` the map/search/geolocate paths already use.
- Delete (removes from Obsidian vault too)
- **Video footage modal (`js/footage.js`):** full-screen workspace — player on the left, and a right-hand stack of sightings (top, ~3/4) over the video list (bottom, ~1/4), each scrolling independently (was three columns with videos in a narrow left rail until 2026-07-25). Link video filenames + timestamps to sightings; shown as passive ▶ rows in history card and species profile. Species search uses a right-column photo-grid transformation on desktop and a full-screen bottom-first overlay (`#footage-mob-picker`) on mobile.
- **Auto-match footage to dives (`js/footage-match.js`, Settings & data):** point at a folder of dive videos and each file is assigned to the dive it was shot on, by reading the video's *own* capture time — no need to sort footage into per-dive folders first. Reads `moov > mvhd` `creation_time` by **walking** the ISO-BMFF box tree (GoPro puts `moov` at the *end* of the file, so a fixed-prefix read finds nothing on exactly the hardware this serves), falling back to filesystem mtime, which is flagged in the UI as the weaker source. Capture time is interpreted as **wall clock, not a UTC instant** — cameras write local time despite the spec, and it also makes matching independent of which timezone the app is running in (see DECISIONS.md). Window is `[entry − 10min, exit + 10min]`, symmetric and deliberately tighter than the photo-matching precedent it's derived from. Missing dive times degrade in steps (entry+exit → entry+bottom-time → entry-only with an assumed length → date-only *suggestion* needing confirmation → excluded), and whatever couldn't be matched is always reported rather than silently dropped. A camera-clock offset is **suggested, never applied silently**, and only when most videos matched nothing. **Assign-only — nothing on disk is created, moved or renamed**; physically organising footage into per-dive folders is a deliberate follow-up (`BRIEF-footage-cloud-hosting.md` §6). Runs against the **same connected video folder playback resolves from**, so a matched video is playable immediately and stays playable across restarts — one folder, not two mechanisms (an earlier cut used a separate `webkitdirectory` picker and left matched videos as unplayable filenames). That unification is why the shell's `scan_proxy_folder` is now **recursive** (one connected trip folder must cover per-dive subfolders; symlinks are skipped via `entry.file_type()` so a link can't walk out of the authorised root) and why `read_file_range` exists (once the folder comes from a native picker the shell has only a path, and WKWebView has no `File` to slice; scoped through the same `authorize()` guard, 1 MB cap). **Proxies are excluded from matching but preferred for playback** — an ffmpeg re-encode stamps the proxy's `mvhd` with the *encode* time, so matching off one would file every dive on the day proxies were generated; one scan therefore produces two views, the full `_proxyEntries` list (originals, for matching) and the resolution maps used for playback (see "Refs are root-qualified relative paths" above). Matched videos are recorded with a relative-path `dive.videos[].path`, which is what makes a match unambiguous across two trips that reuse a filename. Covered by `scripts/test-footage-match.mjs` (22 assertions incl. timezone stability across three zones) and `scripts/test-video-refs.mjs` (25, incl. the same-filename-two-folders collision).
- **Mobile species picker overlay:** full-screen `position: fixed` overlay (`#sp-mob-overlay`) used by the log-dive form (including edit mode) on mobile (≤600px). `showMobileSpeciesPicker(onSelect, tag, ctx)` in `species.js` is context-agnostic. Footage modal has its own equivalent overlay (`#footage-mob-picker`) with shared CSS classes.
  - **Keyboard-aware layout (v2.92).** Originally a "thumb-priority" stack (results at top; category tabs + search + context footer all anchored near the bottom) — real-user mobile testing found this nearly unusable once the on-screen keyboard opened: search and the footer both sat right next to the keyboard, fighting it for space, while tabs stayed visible until 2 characters were typed even while the field was focused. `#sp-mob-overlay` no longer auto-focuses the search field on open (browsing photos, arguably the more common path for someone without a name in mind, no longer forces the keyboard open uninvited), and its structure changed to: a single `.fmp-topbar` row (tag + search + ✕) **anchored at the top** — it never moves when the keyboard does open, unlike the old bottom-anchored search row — then the scrollable results grid, then category tabs **at the bottom**, which now hide the instant the field is *focused* (`_mspSyncTabsVisibility()`, checked on focus/blur/every keystroke) rather than waiting for 2 typed characters, so tabs and the keyboard are never both competing for space at once. The old "+ Free text" button is gone — a zero-match search (2+ characters, no results) renders an inline `.sp-cell-addfree` row directly in the results grid instead (`_mspEmptyStateHtml`), styled like a result but visually distinct (dashed border, accent tint, "+" mark), landing the affordance exactly where the failure happens rather than in a disconnected control. **Deliberately scoped to `#sp-mob-overlay` only** — `#footage-mob-picker` (`js/footage.js`) keeps the original three-band layout; it's a different, untested surface (footage tagging, not the log form) and bringing it to parity is a separate future pass. The two overlays still share CSS class names (`.fmp-results`, `.fmp-tabs`, `.sp-grid-1col`, …) for the parts that didn't change; the new topbar/empty-state rules are scoped with an `#sp-mob-overlay` prefix so they can't leak onto the footage picker.
- **Dual sync backends (mutually exclusive):**
  - Obsidian two-way sync via Local REST API (Mac/desktop only)
  - Local folder sync (File System Access API — Chrome/Edge on desktop **and Android (Chromium M132+)**, incl. cloud-backed folders like Google Drive via Android SAF; blocked in Brave, unsupported on Firefox/Safari)
- Save to device, import `.md` files, export all dives (folder picker on Chrome/Edge; single-zip download fallback on Brave/Safari — both paths include footage sidecars)
- PWA (`sw.js` + `manifest.json`), mobile responsive layout with bottom nav
- Autocomplete on repeated fields (`suit`, `weight`, `tanksize`, `liveaboard`, `buddy`, `instructor`, `region`, `trip`)
- `robots.txt` blocking search engine indexing
- **Sidecar filename hygiene (`js/app.js`):** coordinated canonical renaming — see "Sidecar filename hygiene" above.
- **Dive computer profile import (`js/profile.js`):** UDDF file import, physical-signature dive matching, `.profile.json` sidecar storage, **and the depth/time chart (Phase C, v2.8)** — see "Dive computer profile import" above for the full design.
- **BLE dive-computer sync (v2.86–2.89, `js/computer-sync.js` + `vendor/libdivecomputer-wasm/`; native shell transport v2.98, `src-tauri/src/ble.rs`):** pair a Shearwater or Suunto dive computer over Bluetooth (capability-gated, sits beside the UDDF banner on the Log page) and pull dives straight in, landing in the same match/review/bulk-add pipeline UDDF import uses. Live-verified against real hardware (a Shearwater Peregrine) across multiple sessions: pairing, full download, cancel-mid-sync (dives already collected are salvaged, never lost), and incremental sync via device fingerprints — a routine "check for new dives" sync does real protocol work only for what's actually new (seconds, not the ~37 minutes a full first sync takes), with a byte-accurate progress bar and a staleness guard that detects when locally-deleted dives make a stored fingerprint untrustworthy and falls back to a full re-sync automatically. Settings & data has a "Bluetooth sync history" list with a per-device Forget action. NDL and deco/safety-stop extraction (v2.89) closed most of the chart-fidelity gap with UDDF import: `download.c`'s sample callback now reads `DC_SAMPLE_DECO` (previously discarded) and emits NDL as an optional per-waypoint field plus deco/safety-stop samples as discrete events, feeding `renderProfileChart`'s NDL colour gradient and stop pills — the shape matches what the UDDF path already produces, so BLE sync needed no changes of its own on the chart side (the chart itself gained a colour legend, a live/locked-deco colour split, and a startup-artifact fix the same week, but as improvements to the shared rendering path, not anything BLE-sync-specific — see "Depth/time chart" above). Primary gas mix (`DC_FIELD_GASMIX`, the back/start gas) followed the same day — raw o2/he fractions classified via the existing `_gasMixLabel()` (js/profile.js), no duplicated logic. Validated against a real 96-dive Peregrine transcript, not synthetic data: 28,112/28,112 waypoint samples for NDL, and gas mix cross-checked exactly against independent UDDF ground truth (96/96 dives, 100.0% o2/he match) — see `BRIEF-dive-computer-sync.md` §17–§18, including why deco-event coverage rests on code-path verification (this diver's real history never triggered one) rather than an observed occurrence, and why NDL couldn't be cross-checked the same way gas mix was (that UDDF export has zero `<nodecotime>` elements — a gap in Subsurface's own exporter, confirmed by reading its XSLT source, not a parsing issue on either side). Tank size/pressure is the one remaining fidelity gap vs. UDDF import.
  **Two transports, one protocol engine (v2.98, `BRIEF-dive-computer-sync.md` §21).** The browser uses Web Bluetooth (Chrome/Edge — not Brave, not Firefox/Safari); the Tauri shell can't (WKWebView has no `navigator.bluetooth`) and goes through native Rust `btleplug` commands instead — `btleplug` directly, not `tauri-plugin-blec`, matching the same call this repo made for ffmpeg. Everything downstream of `_openTransport` is identical under both. Unblocking the shell meant rebuilding the WASM module with **`-sASYNCIFY` instead of `-sJSPI`** (JSPI is Chromium-only — WebKit shipped it in Safari 27 *beta*, so no released WKWebView has it): 368KB → 616KB, CPU cost irrelevant against ~60ms-per-packet BLE, re-validated against the same real 96-dive transcript with identical numbers, and it's what makes a future iOS shell possible without the native libdivecomputer build §7b assumed iOS would need. Asyncify changed two contracts, both load-bearing: `await factory(...)` is **no longer the completion signal** (it resolves when `main()` *suspends* — callers await `Module.onExit` via `-sEXIT_RUNTIME=1`, or silently see zero dives from a perfectly working engine), and a **rejected write must never reach the WASM boundary** (it would suspend the C stack forever rather than propagate, so `dcTransport.write` swallows failures and fails the packet queue instead, converting a cancel into the `DC_STATUS_TIMEOUT` path — covered by `run-cancel-salvage-test.mjs`, since cancel-loses-dives is a bug this feature shipped once already). One GATT notification must arrive as exactly one packet, so the Rust→JS hop is a `tauri::ipc::Channel` (ordered, boundary-preserving), never `app.emit()`. See `BRIEF-dive-computer-sync.md` for the full design record, including two safety properties proven rather than assumed: the fingerprint-persist gate only fires after a genuinely clean completion (never after a cancel/disconnect, even one with real data salvaged), and a proposed "streaming checkpoint" for interrupted first syncs was found to be structurally unsafe (the device's cutoff is newest-first and one-directional — there's no fingerprint value that means "resume from here but keep going further back too") and deliberately not built.
- **Delete confirmation guardrail (`armDelete`, `js/app.js`):** subtle two-click "arm and confirm" pattern (button colour/label change + brief pulse, no popup) on every dive-delete entry point — dive-file "more" menu, timeline row trash icon. `armDelete` is a generic `(btn, action, armedLabel)` helper, not delete-specific despite the name; v2.91 reused it unchanged on the log form's Save button (`#lf-save-btn`, `#mobile-save-btn`) after real-user mobile testing produced two saved entries from one rapid double-tap — arming never calls `action()`, only confirming does, so a fast double-tap now collapses into at most one save by construction rather than needing a separate re-entrancy guard. Stays in the accent register (never danger/pending) since saving isn't destructive or incomplete, just needing one more tap. `aria-pressed` toggles alongside `is-armed` on every armed control, delete included.
  **v2.99 removed the native `confirm()` that `deleteDive` still carried** — all
  three entry points already routed through `armDelete`, so it was a second
  confirmation stacked on the two-click arm (a leftover from the edit modal's
  own delete path, which retired in v2.83; the comment above `armDelete` still
  named it as the exception). **Any new delete entry point goes through
  `armDelete`, not a dialog.**
- **Toast + in-app confirm (v2.99, `js/app.js`):** `showToast(msg, {variant,
  duration})` replaced all 10 `alert()` calls — non-blocking (every one of those
  sites already `return`ed immediately after), bottom-right on desktop and above
  the mobile nav on phones (reusing `.mobile-save-bar`'s `calc(60px + 14px +
  14px)` offset so it clears the nav wave's crest, not just the bar). Variants
  reuse `.sync-banner`'s existing success/error/warning/neutral colours — no new
  hexes. `role="alert"`/assertive for errors, `role="status"`/polite otherwise.
  `confirmAction(msg, {confirmLabel, danger})` → `Promise<boolean>` replaced the
  two footage `confirm()` calls, on the standard overlay view-stack
  (`_pushOverlayState`/`_closeOverlayDirect` → `closeConfirmDirect`), so back
  gesture and Escape close it like any other overlay — **every close path except
  the explicit Confirm click resolves `false`**. Used only where `armDelete`
  structurally can't reach: `deleteFootageVideo` only asks when a sighting
  actually references the video, which is state known after the click, not
  before. Both `deleteFootageVideo`/`deleteTagMoment` became `async` as a result
  (their callers are inline `onclick`s that ignore the return value). The two
  remaining `prompt()` calls are in `transcodeProxies()` — parked code, behind a
  removed button, and only a clipboard fallback; deliberately left alone.
- **Export unvalidated species (`exportUnvalidatedSpecies`, `js/species.js`, Settings & data):** CSV export of every free-text sighting never matched to `SPECIES_DB`, grouped by `customId` with a per-species sighting count — the input to reconciling logged species against the database (see the `.claude/skills/species-batch-expansion/` skill, README's repo map).

### Open UX/polish items (log-form review, 2026-07)

Smaller, already-scoped follow-ups from a full UX review of the log form —
distinct from "Not yet built" below (those are full features; these are
refinements to what already exists). None blocking; pick up opportunistically.

- ~~**Dive # doesn't preview its computed value.**~~ **Done (2026-08-02).**
  `f-divenum` now shows the real `dives.length + 1` as a live placeholder
  every time the Log panel is entered fresh (the unified `show()` patch,
  `js/app.js`), matching Exit time's existing standard. A placeholder, not a
  value — `saveDive()`'s own fallback (`g('f-divenum') || dives.length + 1`)
  reads `.value`, which a placeholder never populates, so this only previews
  what save will do and changes no behaviour; confirmed live that `g()`
  still reads `""` with the placeholder showing text. Skipped in edit mode
  (`editingId !== null`), where the input already holds the dive's real,
  existing number.
- **UDDF/BLE banner isn't dismissible.** Persistent at the top of every
  new-dive session regardless of whether the diver owns a compatible
  computer. Proposed fix: a `localStorage` "seen it" flag, collapsing it to
  a small icon after first dismissal.
- **Desktop rail is map-only outside Dive/Marine life.** `lfOnSectionOpen`
  (`js/logform.js`) sets the rail to `'location'` for any non-marine
  section, so it shows the map even while Gas & equipment, Journal, or
  Buddy & sign-off are open. Journal is the interesting case now that it
  sits 3rd — a live serif preview of the entry as it'll render in the dive
  file (matching `_notesBlockHtml`) was the original idea, not the stale map.
- ~~`aria-pressed` still missing on three control types.~~ **Done — closed out
  2026-08-02, along with every other toggle/tab-shaped control found missing
  ARIA state anywhere in the app.** `armDelete` (Save/Delete), the dive-type
  colour-chip grid, water-type/current/tank-type segmented toggles, and the
  weather icon row (`lfBuildTypeGrid`/`lfWireSegments`/`lfWireWeather`,
  `js/logform.js`) were already correct — that part of this item was stale.
  Fixed the rest: `.roc-btn` (`js/species.js`, `aria-pressed` + per-button
  `aria-label` — "R"/"O"/"C" mean nothing to a screen reader on their own),
  `.st-tgl` (`js/stats.js`, `aria-pressed`), `.rev-toggle` (`js/footage.js`,
  `aria-pressed`), `.sort-btn` and the dive-file `.df-seg-btn` tab strip
  (`js/history.js` — `role="tab"`/`aria-selected` for the latter, a genuine
  content-switcher per its own "folder-tab" framing above, vs. `aria-pressed`
  for the former), `.mode-toggle` (`js/footage.js`, `role="tab"`/
  `aria-selected` — switches the whole right column's behaviour, not a
  filter), and the category-browse tab families across `js/species.js` and
  `js/footage.js` (`.browse-tab`, `.species-browse-tab`, `.sp-picker-tab`,
  all their `.fmp-tabs`/`.sp-picker-tabs`/`.species-browse-tabs`/
  `.browse-tabs` containers — `role="tablist"`/`role="tab"`/`aria-selected`
  throughout, for consistency across every place this same category-filter
  shape appears).

  Three of the brief's original list turned out to be **misclassified, not
  just unimplemented** — worth recording since the fix wasn't "add
  aria-pressed" for any of them:
  - **`.cat-pill`** (`js/album.js`) isn't a selection control at all — it's an
    anchor-jump list to category sections, and no pill is ever "chosen." The
    real gap was that a filtered-out pill goes `pointer-events: none` with
    nothing telling assistive tech it's disabled; fixed with `aria-disabled`
    instead.
  - **`.dm-side-tab`** (`js/footage.js`) isn't a WAI-ARIA tab despite the
    name — "hover to peek, click to keep open" is a disclosure pattern, so it
    got `aria-expanded` (tracking the deliberate `.pinned` state, not the
    transient hover peek), the same pattern as `.sp-clips-toggle`
    (`js/album.js` — Species Album's "+N more" expander, also newly
    `aria-expanded`, and newly given real keyboard access at all: it was a
    bare `<div onclick>` with no `tabindex` and no keyboard handler).
  - **`.fm-mob-tab`** (Videos/Sightings mobile tabs, `js/footage.js`) has CSS
    and a `switchFootageTab()` function, but **no markup anywhere ever
    creates an element with that class** — the one caller forces a mode
    programmatically, never from a click. Dead code from the pre-2026-07-25
    three-column footage layout (see "Video footage modal" below), left
    behind when the stacked layout replaced it. Nothing to fix; there's no
    live control for a screen reader to ever encounter.

  **A second, more serious class of bug surfaced while fixing the above:**
  several category-tab `<div>`s and even one real `<button>`
  (`js/species.js`'s `.browse-tab`/`.species-browse-tab`/`.sp-picker-tab`,
  `js/footage.js`'s `.browse-tab` in the tag picker) were wired only to
  `onmousedown` — deliberately, to beat a search input's blur — which means
  they were **not operable by keyboard at all**, independent of any ARIA
  label: a native `<button>` auto-fires `click` on Enter/Space, never
  `mousedown`, and a `<div>` isn't even focusable without `tabindex`. All of
  them now carry `tabindex="0"` (where needed) plus a parallel `onkeydown`
  handler calling the same function — verified live with a real dispatched
  `KeyboardEvent('keydown', {key:'Enter'})`, not just inferred from source.
  This is worth checking on **any future custom control that uses
  `onmousedown` instead of `onclick`** — the blur-race fix and keyboard
  operability are two separate concerns, and fixing one doesn't fix the
  other.

  **Verified live in a real browser** (not just re-read as source), including
  interactive round-trips — click/keydown, re-check the DOM, confirm state
  actually flips — for `.sort-btn`, `.st-tgl`, `.roc-btn`, the dive-type chip
  grid, a segmented toggle, a weather icon, and one category tab's keyboard
  path. `.df-seg-btn`, `.mode-toggle`, `.dm-side-tab` and the album controls
  needed dive/video/sighting fixtures this pass didn't build — confirmed
  correct by re-reading the render + state-update code together (checking
  whether each one fully regenerates its markup or has a separate paint
  step, since assuming the wrong one silently drifts out of sync — this
  happened once already this pass, caught before shipping, on
  `js/footage.js`'s tag-picker `.browse-tab`, which paints via a
  `classList.toggle` loop rather than a full re-render).
- **No soft/non-blocking validation hints.** pstart < pend, exit time before
  entry time, avg depth > max depth — none flagged. Deliberately low
  priority; "every field optional, no forced completion" stays the rule —
  this would only ever be advisory, never blocking.
- **Journal is prominent now (3rd of 7) but still collapsed by default.**
  Repositioning it may have made "open by default" unnecessary — worth
  judging by feel rather than assuming either way now that it's no longer
  buried at position 6.
- **Footage-tagging mobile picker (`#footage-mob-picker`, `js/footage.js`)
  still has the pre-restructure layout** — three stacked bands, auto-focus-
  on-open — left alone deliberately when the log form's picker
  (`#sp-mob-overlay`) was rebuilt, since it's a different, untested surface.
  Now visibly inconsistent with the log form's version; bringing it to
  parity is a same-shaped follow-up, not a new design problem.

**Colour-system open items** (token leaks found in a full-app audit, plus
the `--accent`-as-text reclassification's remaining buckets) are tracked in
`CLAUDE colour UI.md`, not here — see its "Cerulean-as-text audit" and
"Open items" notes.

### Not yet built


- **Mobile Settings/data panel polish:** folder sync now *is* useful on Android (Chrome/Edge) — surface "Local folder → a Google Drive folder" as the primary mobile backup, framed for first-timers. Obsidian (Local REST API) stays desktop-only and can be hidden/disabled on < 600px. (Supersedes the earlier "hide the whole Data panel on mobile" idea, now that folder sync works on the phone.)

- **OBIS export:** Darwin Core CSV generation (Event, Occurrence, eMoF tables).

- **Species Album — undiscovered species:** All 1,275 DB entries shown; unlogged species appear greyed-out (iNat reference as "ghost"). Personal photo upload to unlock full profile. Gamification hooks (discovered count, IUCN rarity indicators, milestone badges).

- **Fish visual shape sub-groups:** Fish tab (543 species) is too large. Split by visual shape (Disk/Colourful, Large Ovals, Slender Schoolers, etc.) — requires `subgroup` field on each fish in `SPECIES_DB`.

- **OSM site submission:** OAuth 2.0 PKCE → submit logged dive sites as `sport=scuba_diving` nodes.

- **Sea surface temperature:** Open-Meteo Marine API for GPS-tagged dives — show "Typical SST in [month]: X°C" on the history card.
