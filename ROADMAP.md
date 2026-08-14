# Roadmap

Future ideas and long-term vision for the dive log. These are not immediate build tasks — see DECISIONS.md for what's been built and why.

---

## Build sequence (recommended order)

**Shipped:** the `uid` foundation and the full v2.3 video build (phases
2.31–2.38), the security pass (2.391–2.394), dark mode for the footage modal
(Harbour Night, 2.39), rename-trip and the Brave/Safari export fallback, the
**v2.5 Tauri desktop shell** (`briefs-archive/v2.5-BRIEF-desktop-tauri.md`)
with its bundled-ffmpeg one-button proxy flow, **v2.6 dive planning**
(tide calendar, Open-Meteo wind/sea, the surface-interval calculator, desktop
Admiralty tide times — see CHANGELOG.md and CLAUDE.md → "What's been built"),
**v2.7 hash routing + overlay view-stack** (hash-fragment panel routing so
Android back navigates between panels; `_pushOverlayState`/`closeTopOverlay`
overlay stack so back closes modals; species-profile sighting rows navigate to
dive file; footage clip rows open watch mode in Tauri; per-panel scroll
restoration — see CHANGELOG.md v2.66–2.69 and DECISIONS.md), **v2.72.x
notes-as-journal + desktop dive file redesign** (dive title field, journal
read-back in serif, dive file rebuilt around a full-bleed ambient map hero +
floating data bubbles + 2-column marine grid; 3-layer background texture system
with a single user `--shimmer` dial — see CHANGELOG.md v2.72–2.72.2 and
DECISIONS.md → "Background texture system"), and **v2.74 log-form redesign**
(full visual overhaul of the log-capture form and edit modal: dive-type chip
grid, segmented toggles, vis/temp gradient dials, weather icon picker, map-pin
location card with two-way Country/Region geocoding, desktop two-column rail
with relocatable map and species photo grid; edit modal parity — see `js/logform.js`
and DECISIONS.md → "Log-form redesign: prefix-aware wiring").
Species-profile video linking and OBIS's custom-species registry foundation
both shipped as part of v2.3, ahead of the features below that were originally
sequenced *after* it. Also shipped since: **v2.76 sidecar filename hygiene**
(`briefs-archive/v2.76-BRIEF-sidecar-filename-hygiene.md` — coordinated
canonical renaming so a divenum/site change can't strand a footage or profile
sidecar) and **dive computer profile import, complete through Phase C**
(`briefs-archive/v2.8-BRIEF-dive-profile-import.md` — UDDF parsing +
physical-signature matching in v2.76, the depth/time SVG chart in v2.8; see
CLAUDE.md → "Dive computer profile import" for the shipped design).

1. **Still open from the v2.3 unlock, not yet built:**
   - **OBIS / Darwin Core export** — the registry is there; the CSV
     generation (Event/Occurrence/eMoF tables) isn't.
   - **Species Album — undiscovered species + personal photo upload.** The
     Album itself shipped; this is specifically the "all 1,279 species,
     greyed-out until logged" view and photo-upload-to-unlock extension (see
     CLAUDE.md → "Not yet built").
2. **Own-key IUCN Red List lookups** — see the dedicated section below.
   Needs research before it's buildable, so it isn't sequenced yet.
3. **Sidecar hygiene's two optional extras, if ever wanted** — §4 (a
   one-time repair pass renaming every already-drifted file in one go,
   rather than only healing a dive the next time it's saved) and §5 (a
   deeper uid-scan discovery guardrail that would let a renamed `.md` or
   sidecar still find its partner). Neither is a blocker; both were
   deliberately left unbuilt when the core guardrail shipped in v2.76 — see
   `briefs-archive/v2.76-BRIEF-sidecar-filename-hygiene.md` §4/§5 for the
   design rather than re-deriving it from scratch if this ever gets picked up.

**Seasearch is explicitly later.** It adds a cluster of new *scalar*
frontmatter fields (seabed types/cover, litter, etc.). Low conflict risk with
the items above, but keep it clearly after them, never tangled in the middle.

---

## Sync from Dive Computer (BLE)

**Shipped v2.86–2.88 (browser) and v2.98 (native shell transport).** See
`CHANGELOG.md` and `BRIEF-dive-computer-sync.md` for the design record. Scope
was set BLE-only, Shearwater + Suunto, Garmin excluded.

### What's left

- **Tank size/pressure isn't extracted from BLE-synced dives yet** — the
  one remaining fidelity gap vs. a UDDF-imported dive. NDL, deco/
  safety-stop, and primary gas-mix extraction all shipped 2026-07-15
  (`BRIEF-dive-computer-sync.md` §17–§18) — gas mix in particular was
  validated as an exact 96/96-dive match against real UDDF ground truth,
  not just plausibility. `DC_FIELD_TANK` is the same shape of task again
  (libdivecomputer already parses it; `download.c` just doesn't extract
  it yet) — not picked up in the same pass since neither ask was
  specifically about tank/pressure.
- **Suunto Nautic isn't supported, and can't be yet** — confirmed
  2026-07-15 it isn't in libdivecomputer's `descriptor.c` at the vendored
  0.9.0 release (Suunto BLE coverage there is EON Steel, EON Core, D5, EON
  Steel Black only). Needs upstream libdivecomputer support first, then a
  version bump of the vendored copy — two dependencies, not one. Worth
  checking libdivecomputer's release notes periodically rather than
  assuming it's landed.

---

## Dive-profile chart (depth/time visualisation)

**Shipped v2.8 — nothing outstanding.** See `CHANGELOG.md`, CLAUDE.md → "Dive
computer profile import", and `briefs-archive/v2.8-BRIEF-dive-profile-import.md`
§7 for the design record.

---

## Mobile dive-file segmented control — revisit design

The Marine/Overview/Notes control (`.df-seg`) got an affordance fix in v2.82
— every segment now has its own border at rest, not just the active one, so
all three read as tappable rather than two of them looking like static
labels next to a highlighted pill (see DECISIONS.md for the v1.951
comparison that diagnosed it). **Luke isn't satisfied the design is right
yet even with that fix** — flagged directly, no specifics given on what
still feels off. Worth a proper look rather than assuming the border fix
was the whole story; don't treat this as closed.

---

## Dive Planning — future extensions

The "Plan" tab (tides, weather, surface-interval calculator) shipped in v2.6
— see `CHANGELOG.md` for what's live and `CLAUDE.md` → "What's been built"
for the feature summary. Original MVP spec archived at
`briefs-archive/v2.6-BRIEF-dive-planning.md`. What's left is genuinely future:
- **Saved dive plans.** Ship the MVP as ephemeral planning first, then design persistence: store/recall `DivePlan` objects (localStorage), and optionally **promote a plan to a logged dive** once completed (pre-fills the log form from the plan + conditions).
- **Multi-level profiles in the surface-interval calculator.** Each planned dive currently models a single depth for the whole bottom time (square profile — the same conservative simplification basic PADI/BSAC tables use). The vendored engine already supports real multi-level segments (e.g. 10 min at 30m → 20 min at 18m → 15 min at 10m); exposing that would mean each planned dive gets multiple depth/time legs instead of one number, giving credit for shallower portions of a dive without resorting to "average depth" (which discards exactly the timing information that drives decompression risk, and would be unsafe to substitute in).
- **Coral bleaching layer (for trips abroad).** NOAA Coral Reef Watch Bleaching Alert Area (0–4) for a destination, via ERDDAP (keyless REST) — the same data behind the Esri ocean-hub map Luke liked. Pull from the NOAA source, not Esri (no ArcGIS token). Confirm an ERDDAP node allows browser CORS, else route via a desktop Rust fetch like tides. Pairs with the existing GPS + species data.
- **Sea surface temperature** (already a separate roadmap item) shares the Open-Meteo Marine call, so fold it into the Plan conditions card when built.
- **Species wishlist + sighting map** (already a separate roadmap item, see below) — pick up to 3 species you're hoping to see, plot real OBIS occurrence records near the active planning location.

---

## Dive Planning — Species Wishlist & Sighting Map

Lets a diver planning a trip pick up to 3 species they're hoping to see, then plots actual third-party sighting records (not the diver's own data) near the planned location. **Deliberately Plan-only** — the Species Album profile map (below) stays personal-sightings-only; community/external occurrence data must never mix into it.


### Anchor: reuse Plan's existing location slots

`js/planner.js` already tracks up to 5 saved planning locations (`_planLocations`, with `_planLat`/`_planLng`/`_planLocName` for the active one). No new location picker is needed — the map and query both key off whichever slot is active.

### New surface: Plan currently has no map at all

Checked — zero Leaflet references anywhere in `planner.js`. This feature is the first map in the Plan panel, so it's new screen real estate, not an extension of an existing instance. Build it with the existing primitives in `js/map.js` (`loadLeaflet`, `initMap`, `renderMapMarkers`, `destroyMap`) rather than a new map stack.

### Species picker: reuse, not new build

Cap selection at 3. Reuse the existing context-agnostic species picker (`showMobileSpeciesPicker` on mobile, the desktop photo-grid panel) already shared by the log form, edit modal, and footage modal — same component, new context tag, no new UI to design.

### Query

```
GET https://api.obis.org/v3/occurrence?taxonid={aphiaId1},{aphiaId2},{aphiaId3}&geometry={WKT bbox around _planLat/_planLng}&size=500
```

Confirmed by direct testing: `taxonid` accepts a comma-separated list in a single call, and `geometry` (WKT) correctly scopes results to a bounding box — a Komodo-area box returned real, nearby green-turtle records, not noise from elsewhere. The bbox is built from `_planLat`/`_planLng` with a buffer (~50km is a reasonable starting point); the exact radius is a tuning decision, not an architectural one.

### Quality and licence filtering

Two things confirmed by testing real OBIS responses, both need handling before a record reaches the map:
- **Licence:** the `license` field is sometimes `null` on real records, not just CC0/CC BY/CC BY-NC as documented — treat missing licence as not-safe-to-show, same caution already applied to iNat photos with no confirmed CC source.
- **Quality flags:** OBIS exposes its own QC `flags` field — a real green-turtle telemetry record came back flagged `NO_DEPTH, ON_LAND` in testing. Respect `flags`/`dropped` so a planning map doesn't plot a turtle "sighting" on dry land.

### Zero-species state

No map layer renders until at least one species is picked. This matches how the rest of Plan already behaves — nothing auto-fetches speculatively (the Admiralty UK bounding-box gate, opt-in folder sync). Show an inert prompt instead: *"Pick up to 3 species you're hoping to see."* This also means the overwhelming-data scenario can't happen by construction, not by tuning.

### Persistence

Ephemeral per planning session is enough for v1 — mirrors the existing "ship the MVP ephemeral, design persistence later" approach already set for Saved Dive Plans. The last-picked species per location could later piggyback on the same lightweight pattern as the autocomplete cache, but isn't required for v1.

### When to build

Independent of Saved Dive Plans — no hard dependency either way. Natural to build alongside the Species Distribution Data work below, since both lean on the same OBIS API knowledge (AphiaID joins, licence/flag filtering).

---

## Seasearch Compatibility

[Seasearch](https://www.seasearch.org.uk) is a UK marine conservation citizen science programme backed by the Wildlife Trusts, Natural England, JNCC, BSAC, PADI, and others. It collects structured dive observation data and submits it to UK marine databases. The barrier to participation is the paper form — comprehensive but intimidating. The app can remove most of that barrier by pre-filling everything it can from logged dive data.


### New fields still needed on the dive object

GPS (`gps_lat`/`gps_lng`) and R/O/C abundance are already captured. The remaining fields Seasearch needs:

```javascript
seabed_types: [],       // multi-select — Rocky Reef | Boulders | Cobbles and Pebbles |
                        //   Mixed Ground | Sand and Gravel | Mud | Wreckage | Other
seabed_dominant: '',    // string — one of the above
seabed_cover: [],       // multi-select — Kelp forest | Kelp park | Mixed seaweeds |
                        //   Seagrass bed | Encrusting pink algae | Animal turf (short) |
                        //   Animal turf (tall) | Animal beds | Sediment with life apparent |
                        //   Barren sediment | Other
animal_bed_species: '', // free text — only when "Animal beds" selected in seabed_cover
noteworthy: '',         // free text — unusual observations, notable behaviour
litter: '',             // free text — man-made objects seen
photos_taken: false,    // boolean
```

**OBIS/eMoF note:** R/O/C maps to `organismQuantity` (R→1, O→5, C→20) with `organismQuantityType = "Seasearch abundance category"`. This is valid Darwin Core.

### Seasearch export

A **"Export for Seasearch"** button generates a pre-filled output covering all fields the app can answer. Format: printable HTML matching the Seasearch Observation Form layout (or structured PDF). Submission: email to `forms@seasearch.org.uk` or hand to a dive organiser.

**The seabed profile drawing is intentionally not automated.** Seasearch asks for a hand-drawn side-on sketch of the seabed with depth annotations, direction, and distance scale. This has genuine scientific value that a checkbox or structured field cannot replicate. The decision is to acknowledge this gap honestly — a note in the export directs the user to complete Section 3 of the paper form manually.

---

## Seabed Profile Sketch Tool

A future feature that partially automates the Seasearch seabed profile drawing. Rather than freehand on paper, present a canvas with the depth axis pre-scaled from the dive's logged max depth. The diver draws a rough seabed line and taps to place annotation pins (free text labels at specific points along the profile). Output is an SVG or image that can be embedded in the Seasearch export and attached to the Obsidian dive note.

**Important distinction:** The dive computer profile (time vs depth) is not the same as a seabed profile (distance vs depth) and cannot be used directly. However:
- The depth range pre-scales the Y axis, removing the hardest part of the drawing
- On drift dives over sloping reefs, the time axis loosely correlates with distance — making the computer profile a useful rough guide for the seabed shape

Do not build this until Seasearch export is complete.

---

## Species Album — remaining work

The logged-species index, taxonomy-grouped thumbnails, profile modal (photo hero, GPS map, dive log), and live search are live. What's not yet built:

**Undiscovered species.** The full Zelda: Breath of the Wild Compendium concept — all 1,279 species in the DB shown, with ones you haven't logged appearing as greyed-out silhouettes using the iNaturalist reference photo as the "ghost" image. Avoid the "1,279 blank spaces" problem by grouping with a count like "3/23 sharks photographed"; expand on tap.

**Personal photo upload.** Once you've photographed a species, your photo replaces the iNat reference in the profile. Data model: a separate localStorage key (e.g. `divelog-album`) mapping `scientificName → { photoDataUrl, dateAdded, diveId }`. File picker on desktop; camera roll on Android (no persistent folder pointer without a native wrapper).

**Gamification hooks.** Total discovered count ("47 / 1,279 species"), rarity indicators using IUCN status, milestone badges ("First shark", "First CR species", "10 species").

---

## Species Profile Pages — remaining work

The modal currently shows: iNat photo hero, GPS map of sighting sites, and a dive-log list. Remaining:

- **Personal photos and videos** on the profile — your shots replace the iNat reference once uploaded (see Species Album above for the data model)
- **Profile for undiscovered species** — when tapping a greyed-out species, show habitat notes and group context ("where it's typically found") rather than an empty dive log

The more dives you log, the richer each profile becomes automatically. A green sea turtle seen across 8 dives in Indonesia and the Philippines becomes a personal field record spanning years — and genuinely valuable OBIS data.

**Note:** Profile pages and the album grid are the same feature from two directions. Build them together. Species distribution data (see below) is a natural addition to the profile — build it at the same time.

---

## Species Distribution Data

Show divers which oceans and regions a species lives in — a short text line in the Species Album profile, **not a map layer**. The album's GPS map is the diver's own personal sighting record; it must stay uncontaminated by third-party data (see the Plan-panel feature above for where occurrence data actually belongs).

### Data source: OBIS `/checklist`, not WoRMS distribution strings

Originally scoped against WoRMS's `AphiaDistributionsByAphiaID` endpoint, which returns free-text location names ("Indo-Pacific" / "Tropical Indo-Pacific" / "Indo-West Pacific") needing manual normalisation across an estimated 50–200 inconsistent strings. Testing the OBIS API directly (see the Plan-panel feature above) found a cleaner path:

```
GET https://api.obis.org/v3/checklist?areaid={areaID}
```

Confirmed by direct testing: this returns every species recorded in a given OBIS area, each with a `taxonID` field — the **same WoRMS AphiaID** already stored in `data/species-db.js`. That's a plain integer-equality join, not fuzzy string matching. OBIS areas (`/area`, confirmed via testing) include country EEZs with clean numeric IDs (e.g. Indonesia = `115`), found by name lookup.

### Data model — unchanged from the original plan

Same 7th field, same display, same diver-friendly vocabulary — only the *source* of the mapping changes:

```javascript
// Before: [commonName, scientificName, aphiaId, group, photoUrl, iucnStatus]
// After:  [commonName, scientificName, aphiaId, group, photoUrl, iucnStatus, regions]
["Green sea turtle","Chelonia mydas",137206,"Reptile","https://...","LC","ip|sea|rs|med|na|car|ep|au"]
```

**Region codes** (a fixed, small, diver-facing vocabulary — kept deliberately coarser than OBIS's own area/LME taxonomy, which is either too granular for a "Found in" line or has unfamiliar names):

| Code  | Meaning                          |
| ----- | -------------------------------- |
| `ip`  | Indo-Pacific (broad tropical)    |
| `sea` | Southeast Asia specifically      |
| `rs`  | Red Sea                          |
| `med` | Mediterranean                    |
| `na`  | NE Atlantic / UK-European waters |
| `car` | Caribbean                        |
| `ep`  | Eastern Pacific                  |
| `au`  | Australian/GBR waters            |

### Shipped 2026-07-20 — script, album display, and browser pre-filter

All three pieces are done: `scripts/fetch-species-regions.py` (build-time
region table), the "Found in" line in the Species Album (`js/album.js`), and
the log-form country pre-filter (`js/species.js`/`js/logform.js`). See
`CHANGELOG.md` and CLAUDE.md → "Built" for what they do.

Re-run the script whenever the species list or its AphiaIDs change — clear
`scripts/species-regions.json` first, since that cache is keyed by region,
not species, and will otherwise serve membership computed against old IDs.

**Still open — the `au` region is too broad to be useful.** Australia matches
951/1,267 species (75% of the database), because OBIS's Australia area is the
whole-country EEZ — temperate Tasmania and the tropical GBR combined — and is
one of the most heavily-sampled areas in OBIS. At that match rate both the
"Found in" line and the browser pre-filter barely narrow anything for an
Australia-tagged dive. Worth checking whether OBIS has a GBR-specific
sub-area (the way Mexico/Egypt/Spain/France are split by territory) and
re-running against that instead.

### When to build

~~After the species profile undiscovered-species view is started (they share the profile modal).~~ Both pieces above shipped ahead of the undiscovered-species view — the "Found in" line works standalone in the existing profile modal without needing that feature first. Undiscovered-species view remains separate future work.

---

## OBIS / Darwin Core Export

Export dive data in the standard format for submission to the Ocean Biodiversity Information System.

**Planned format:** Darwin Core Archive — three CSV tables:
- **Event:** one row per dive (date, location, depth, duration)
- **Occurrence:** one row per species sighting (scientificName, AphiaID, occurrenceStatus)
- **eMoF:** one row per measurement (organism count, depth seen)

AphiaIDs are already stored on each sighting at log time. Unvalidated free-text species entries will need manual AphiaID resolution before submission.

---

## Cloud Photo Library Integration

If the app ever gains a backend, it could connect directly to cloud photo libraries:

- **iCloud / Google Photos / OneDrive** — all have official APIs with OAuth. This is how apps like Lightroom mobile work. Requires a backend to handle the OAuth token exchange securely.
- **Proton Drive** — no stable public API as of early 2026. Proton is building one but it's not available for third-party apps yet.

**The architectural shift:** Cloud photo integration is the point where the "no server" decision gets revisited. A small Cloudflare Worker (free tier) could handle OAuth cleanly and unlock all major providers without a full backend.

**Simplest middle ground without a backend:** Google Photos has a limited API that can work client-side with a public OAuth client ID — used by some hobby apps, though not ideal.

---


## Desktop + Mobile App (Tauri) — one wrapper for both

**Desktop shipped v2.5** (macOS, `briefs-archive/v2.5-BRIEF-desktop-tauri.md`).
See `CHANGELOG.md` and README.md → "Install on Mac" for what exists; the
Tauri-vs-Electron call and the Capacitor fallback are in `DECISIONS.md`.

### What's left

- **Mobile on the same toolchain.** Tauri v2 mobile means the phone app can
  be the same project with a mobile target added, sharing the capability
  seams (`resolveVideoUrl`, the filesystem-write seam). An Android build
  target exists in `src-tauri/` already, but no polished install flow or
  public release — see `BRIEF-play-store-readiness.md`.
- **Validate before committing.** Tauri-mobile is younger and less
  battle-tested than Capacitor's mobile story. At the mobile-wrapper moment,
  test Tauri's `fs` plugin against real Android field-logging (write to an
  arbitrary folder, survive app updates, no SAF surprises) *before*
  committing to it. If it disappoints, the Capacitor fallback is scoped in
  `DECISIONS.md`. The web code is wrapper-agnostic either way, so waiting
  costs nothing.
- **Notarisation.** The `.dmg` is unsigned and un-notarized, so first launch
  needs the Gatekeeper right-click dance (README.md documents it). An Apple
  Developer account would remove that friction.

---

## Cloud Footage Hosting (Backblaze B2 / pluggable) — future

The end-state for the video layer. Today footage (tagging, proxies, **and** watching) is
**Tauri-app-only** — the videos are local files and proxies use the macOS Apple/VideoToolbox
encoder (see CLAUDE.md and `v2.7-BRIEF-mobile-nav-routing.md` §8). The future vision
decouples *storage* so watching can go cross-platform:

- **Cloud storage holds the footage + proxies.** Backblaze B2 is the first target, but the
  design is a **pluggable provider** so a user can link their cloud of choice. Each clip's
  `sources[]` already carries a `kind` (today `local`; cloud kinds reserved) behind the
  `resolveVideoUrl()` seam — so this grows into existing infrastructure, not a rewrite.
- **Roles by platform (the intended split):**
  - **Tauri desktop app = the workspace** — tag species from videos, generate proxies
    (Apple encoder), upload to the cloud.
  - **Browser + mobile = viewers** — stream tagged species' footage from the cloud; no
    authoring, no local files. The v2.8 species-profile player becomes the cross-platform
    viewer at this point.
- **Why this ordering:** footage is a power-user layer. Most users just log; only once they
  value the core do they add their own footage. Keeping the video layer app-only until the
  cloud exists keeps web/mobile focused on logging + watching, not file management.
- **Open questions (pre-brief):** per-provider auth (B2 application keys vs OAuth for
  others); whether a small Cloudflare Worker is needed for token exchange (revisits the
  "no server" line — cf. the Cloud Photo Library section); upload progress/retry UX in the
  Tauri workspace; range-request streaming playback on the web viewers; and who pays for
  storage (likely the user's own B2 account).

Not a brief yet — `v2.8-BRIEF-species-footage-player.md` is the (Tauri-scoped) watch surface
this would later make cross-platform.

---
