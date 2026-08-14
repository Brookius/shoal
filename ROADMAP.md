# Roadmap

What isn't built yet, in three tiers:

- **In progress** — partly shipped, with a known gap still open
- **Next** — committed and scoped enough to start
- **Ideas** — not committed: research, speculation, or blocked on something else

Nothing here describes shipped work. For that: `CHANGELOG.md` (what shipped,
when), `CLAUDE.md` → "Built" (what exists now), `DECISIONS.md` (why, and what
was rejected).

---

## At a glance

| Tier | Items |
|---|---|
| **In progress** | Tank data from BLE sync · Species region accuracy · Android app · Dive-file tab design · Sidecar hygiene extras |
| **Next** | OBIS / Darwin Core export · Species Album undiscovered view · Seasearch export · Saved dive plans |
| **Ideas** | Species wishlist map · Multi-level deco profiles · Seabed sketch tool · Coral bleaching · Sea temperature · Cloud footage hosting · Cloud photo library · Suunto Nautic · Notarisation · Live IUCN lookups |

---

# In progress

Each of these has a working feature behind it and one specific thing still
missing.

## Tank size and pressure from BLE sync

The one remaining fidelity gap between a Bluetooth-synced dive and a
UDDF-imported one. `DC_FIELD_TANK` is the same shape of task as the gas-mix
extraction that already works — libdivecomputer parses it, `download.c` just
doesn't read it out yet. See `BRIEF-dive-computer-sync.md` §17–§18.

## Species region accuracy — the `au` region is too broad

Australia matches 951/1,267 species (75% of the database), because OBIS's
Australia area is the whole-country EEZ — temperate Tasmania and the tropical
GBR combined — and one of the most heavily-sampled areas in OBIS. At that
match rate both the "Found in" line and the log-form pre-filter barely narrow
anything for an Australia-tagged dive.

Worth checking whether OBIS has a GBR-specific sub-area (the way Mexico,
Egypt, Spain and France are split by territory) and re-running
`scripts/fetch-species-regions.py` against that instead. Clear
`scripts/species-regions.json` before any re-run — that cache is keyed by
region, not species.

## Android app

An Android build target exists in `src-tauri/`, sharing the same Rust project
as the macOS build, but there's no polished install flow or public release.
See `BRIEF-play-store-readiness.md` for what's left.

**Validate before committing to it:** Tauri-mobile is younger and less
battle-tested than Capacitor's mobile story. Test Tauri's `fs` plugin against
real Android field-logging — write to an arbitrary folder, survive an app
update, no SAF surprises — *before* building on it. The Capacitor fallback is
scoped in `DECISIONS.md`, and the web code is wrapper-agnostic either way, so
waiting costs nothing.

## Mobile dive-file tab design

The Marine/Overview/Journal control got an affordance fix in v2.82 — every
segment now has its own border at rest, so all three read as tappable. **The
design still isn't right**, flagged directly, with no specifics on what feels
off. Don't treat the border fix as the whole story.

## Sidecar hygiene — two optional extras

The core guardrail shipped; both of these were deliberately left unbuilt and
neither is a blocker: a one-time repair pass that renames every
already-drifted file in one go (rather than healing each dive the next time
it's saved), and a deeper uid-scan discovery guardrail so a renamed `.md` or
sidecar can still find its partner. Designs are in
`briefs-archive/v2.76-BRIEF-sidecar-filename-hygiene.md` §4/§5 — read those
rather than re-deriving if this gets picked up.

---

# Next

Scoped and ready. Roughly in build order.

## OBIS / Darwin Core export

Export dive data in the standard format for submission to the Ocean
Biodiversity Information System. The custom-species registry this depends on
already exists; the CSV generation doesn't.

**Format** — Darwin Core Archive, three CSV tables:

- **Event** — one row per dive (date, location, depth, duration)
- **Occurrence** — one row per sighting (scientificName, AphiaID, occurrenceStatus)
- **eMoF** — one row per measurement (organism count, depth seen)

AphiaIDs are already stored on each sighting at log time. Unvalidated
free-text species entries need manual AphiaID resolution before submission —
`exportUnvalidatedSpecies` in `js/species.js` produces that worklist.

## Species Album — undiscovered species, and personal photos

**Build this with the species profile work below — they're the same feature
from two directions.**

**Undiscovered species.** All 1,275 species in the DB shown, with unlogged
ones as greyed-out silhouettes using the iNaturalist reference photo as a
"ghost" image. Avoid the "1,275 blank spaces" problem by grouping with a
count — "3/23 sharks photographed" — and expanding on tap.

**Personal photo upload.** Once you've photographed a species, your photo
replaces the iNat reference. Data model: a separate localStorage key (e.g.
`divelog-album`) mapping `scientificName → { photoDataUrl, dateAdded, diveId }`.
File picker on desktop, camera roll on Android.

**Gamification hooks.** Total discovered count ("47 / 1,275 species"), rarity
indicators from IUCN status, milestone badges ("First shark", "First CR
species", "10 species").

**On the profile side:** personal photos and videos replacing the iNat
reference, and a meaningful profile for *undiscovered* species — habitat
notes and group context ("where it's typically found") rather than an empty
dive log.

## Seasearch compatibility and export

[Seasearch](https://www.seasearch.org.uk) is a UK marine conservation citizen
science programme backed by the Wildlife Trusts, Natural England, JNCC, BSAC
and PADI. It collects structured dive observation data for UK marine
databases. The barrier to taking part is the paper form — comprehensive but
intimidating — and the app can remove most of that by pre-filling everything
it already knows.

**Deliberately sequenced after the items above.** It adds a cluster of new
scalar frontmatter fields; low conflict risk, but keep it clearly after the
others rather than tangled in the middle.

GPS and R/O/C abundance are already captured. The remaining fields:

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

**OBIS/eMoF note:** R/O/C maps to `organismQuantity` (R→1, O→5, C→20) with
`organismQuantityType = "Seasearch abundance category"`. Valid Darwin Core.

**The export** — an "Export for Seasearch" button producing a pre-filled
printable HTML form matching the Seasearch Observation Form layout. Submitted
by email to `forms@seasearch.org.uk` or handed to a dive organiser.

**The seabed sketch is deliberately not automated.** Seasearch asks for a
hand-drawn side-on sketch with depth annotations, direction and distance
scale. That has genuine scientific value a structured field can't replicate,
so the export directs the user to complete that section on paper.

## Saved dive plans

The Plan panel is ephemeral today. This is persistence: store and recall
`DivePlan` objects in localStorage, and optionally **promote a plan to a
logged dive** once completed — pre-filling the log form from the plan plus
the conditions recorded at the time.

---

# Ideas

Not committed. Research done, or waiting on something.

## Species wishlist and sighting map

Pick up to 3 species you're hoping to see while planning a trip, then plot
real third-party occurrence records near the planned location. **Plan-panel
only** — the Species Album's map is the diver's own sighting record and must
stay uncontaminated by third-party data.

Reuses Plan's existing location slots (`_planLocations` in `js/planner.js`)
and the existing context-agnostic species picker, so there's no new picker or
location UI to design. It would be the first map in the Plan panel — build on
the `js/map.js` primitives, not a new map stack.

```
GET https://api.obis.org/v3/occurrence?taxonid={id1},{id2},{id3}&geometry={WKT bbox}&size=500
```

Confirmed by direct testing: `taxonid` takes a comma-separated list in one
call, and `geometry` correctly scopes to a bounding box — a Komodo-area box
returned real nearby green-turtle records, not noise. Two things that testing
also surfaced, both needing handling before a record reaches the map:

- **Licence** — the `license` field is sometimes `null` on real records, not
  just the documented CC0/CC BY/CC BY-NC. Treat missing licence as
  not-safe-to-show, the same caution already applied to iNat photos.
- **Quality flags** — OBIS exposes its own QC `flags`; a real green-turtle
  telemetry record came back flagged `NO_DEPTH, ON_LAND`. Respect
  `flags`/`dropped` so a planning map doesn't plot a turtle on dry land.

The 3-species cap does double duty: it bounds the query, and it keeps a
3-colour marker legend readable on a phone. Nothing renders until a species is
picked, so the overwhelming-data case can't happen by construction.

## Multi-level profiles in the surface-interval calculator

Each planned dive currently models one depth for the whole bottom time — a
square profile, the same conservative simplification PADI/BSAC tables make.
The vendored engine already supports real multi-level segments (10 min at 30m
→ 20 min at 18m → 15 min at 10m). Exposing that would give credit for the
shallower parts of a dive without resorting to "average depth", which
discards exactly the timing information that drives decompression risk and
would be unsafe to substitute in.

## Seabed profile sketch tool

Partially automates the Seasearch seabed drawing: a canvas with the depth axis
pre-scaled from the dive's logged max depth, on which the diver draws a rough
seabed line and taps to place annotated pins. Outputs SVG for the Seasearch
export and the dive note.

**Don't build before Seasearch export exists.** Note the dive computer's
profile (time vs depth) is *not* a seabed profile (distance vs depth) and
can't be used directly — though the depth range does pre-scale the Y axis, and
on drift dives over sloping reefs the time axis loosely correlates with
distance.

## Coral bleaching layer

NOAA Coral Reef Watch Bleaching Alert Area (0–4) for a destination, via
ERDDAP (keyless REST). Pull from the NOAA source, not Esri — no ArcGIS token.
Confirm an ERDDAP node allows browser CORS, else route through a desktop Rust
fetch the way tides already do. Pairs naturally with the existing GPS and
species data.

## Sea surface temperature

"Typical SST in [month]: X°C" for a GPS-tagged dive site. Shares the
Open-Meteo Marine call the Plan panel already makes, so fold it into the Plan
conditions card rather than building a separate fetch.

## Cloud footage hosting

The end-state for the video layer. Footage today — tagging, proxies and
watching — is Tauri-only, because the videos are local files. Decoupling
*storage* would let watching go cross-platform.

Backblaze B2 is the first target, but the design is a **pluggable provider**
so a user can link their own cloud. Each clip's `sources[]` already carries a
`kind` (today `local`; cloud kinds reserved) behind the `resolveVideoUrl()`
seam — this grows into existing infrastructure rather than being a rewrite.

The intended split: **desktop app = the workspace** (tag species, generate
proxies, upload), **browser and mobile = viewers** (stream tagged footage, no
authoring, no local files).

Open questions: per-provider auth (B2 application keys vs OAuth); whether a
small Cloudflare Worker is needed for token exchange — which revisits the
"no server" line; upload progress and retry UX; range-request streaming on
the web viewers; and who pays for storage (likely the user's own account).

## Cloud photo library integration

iCloud, Google Photos and OneDrive all have official OAuth APIs — this is how
Lightroom mobile works — but they need a backend to handle the token exchange
securely. Proton Drive has no stable public API as of early 2026.

This is the point where the "no server" decision gets revisited: a small
Cloudflare Worker on the free tier could handle OAuth cleanly without a full
backend.

## Suunto Nautic support — blocked upstream

Not in libdivecomputer's `descriptor.c` at the vendored 0.9.0 release (its
Suunto BLE coverage is EON Steel, EON Core, D5, EON Steel Black only). Needs
upstream support first, *then* a version bump of the vendored copy — two
dependencies, not one, and neither is ours to move. Worth checking
libdivecomputer's release notes periodically rather than assuming it's landed.

## Notarisation

The `.dmg` is unsigned and un-notarized, so first launch needs the Gatekeeper
right-click dance (documented in `README.md`). An Apple Developer account
would remove that friction — a cost and admin decision, not an engineering one.

## Live IUCN Red List lookups — blocked on licensing

Conservation status is currently baked into `data/species-db.js` at build
time. Fetching it live per-species would keep it fresh, but the IUCN Red List
API's terms need resolving directly with IUCN first — including whether a
per-user "own key" arrangement changes anything (it doesn't, on the reading in
`DECISIONS.md`). Not buildable until that conversation happens.
