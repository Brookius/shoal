# Brief — Personal dive-site database (commercial-safe sourcing)

> **Status: parked — not scheduled, deliberately unversioned.** Builds on the
> site-database exploration in the 2026-06 chat arc. Scope is intentionally
> **minimal**: name + coordinates + country/region only. **Every data source is
> chosen to be licence-clean and redistributable** (see §5) — a bundled offline
> dataset has to be one Shoal actually has the right to ship, which rules out
> most of the obvious sources.

---

## 1. The job to be done

Tier 1 already works: the autocomplete cache remembers coordinates for any site
you've logged and re-supplies them when you type the name. The real pain is the
**long tail of sites absent from the current sources** (Dive Vibe + Nominatim) —
**UK sites especially are poorly consolidated and largely missing.** Today that
means: web-search for the coordinate → find nothing → drop a pin on a map →
copy-paste the coordinate by hand. Annoying, and inaccurate.

Two goals:
1. Make the **pin-drop path painless and accurate** (no more copy-paste).
2. Build a **bundled + growing open dataset** so you hunt less over time, and
   seed coordinates for sites you haven't personally logged.

## 2. Scope (minimal — do not exceed)

- **Fields: `name`, `lat`, `lng`, `country`, `region`. Nothing else.** No depth
  range, rating, hazards, access notes, mooring, parking — explicitly out for now
  (overkill for the use case; can be added later if it earns its place).
- **No site-note-per-site / no first-class linked entity.** Interesting idea,
  deferred. Coordinates stay **denormalised on the dive** (`gps_lat`/`gps_lng`)
  exactly as today; the site database is purely an **autofill/lookup/backfill
  source**, not a new data model the dive depends on.
- **No backend.** Browser-only, offline, CSP-safe — same constraints as the rest
  of the app. The bundled dataset is a static file like `data/species-db.js`.

## 3. What already exists (Tier 1 — leave as-is)

The autocomplete cache (`divelog-ac-cache`) already remembers a site's coordinates
once logged and re-fills them. Keep it. This brief is about the sources you reach
for when Tier 1 has nothing — i.e. a site you've never logged.

## 4. The plan (Tiers 2–4)

- **Tier 2 — bundled open dataset.** Ship `data/dive-sites.json` (mirror the
  `species-db.js` pattern): records of `{name, lat, lng, country, region, source}`,
  searchable offline by name and by proximity (haversine). Seeds coordinates for
  sites you haven't logged. Built dev-time from open sources (§5, §6).
- **Tier 3 — live external search (existing).** Keep Dive Vibe + Nominatim at log
  time for the long tail — **subject to the commercial caveats in §5** (verify Dive
  Vibe's terms; do not bulk-hit public Nominatim in a paid app).
- **Tier 4 — pin-drop UX fix.** Replace the copy-paste dance with a **draggable
  marker on the (clustered) Leaflet map** that writes `lat`/`lng` straight into the
  dive — accurate, no clipboard. This is the immediate pain relief and needs no
  data sourcing (see Phase A).
- **The loop.** GPS capture (existing button) or a dropped pin → the site enters
  your personal cache → future dives autofill → optionally contribute the site
  back to OSM (roadmap's OSM-submission item). Plus a **retroactive backfill**:
  "N older dives are at sites you've since geotagged — fill their coordinates?"

## 5. Sourcing & licensing (the gating concern)

**Commercial-safe sources (use these):**

| Source | Licence | Commercial? | Conditions |
|---|---|---|---|
| **Wikidata** | CC0 | Yes | None (public domain). Cleanest. Famous sites, wrecks, marine parks. |
| **OpenStreetMap** (Overpass `sport=scuba_diving` + reef/wreck) | ODbL | Yes | Attribution ("© OpenStreetMap contributors") + share-alike **on the extracted dataset only** — *not* on your app code/UI. Best bulk source. |
| **GeoNames** | CC-BY 4.0 | Yes | Attribution; no share-alike. Coastal/marine gazetteer (not dive-specific). |
| **UK gov open data** (UKHO/Historic England wrecks, data.gov.uk) | OGL | Yes | Attribution. **Directly targets the UK gap** — UK wrecks are a big slice of UK diving. |
| **Dive Vibe Community** (`jbunderwater/dive-vibe-community`) | **MIT** (confirmed) | Yes | Attribution. ~2,800 sites / 122 destinations, actively maintained. The source you already use — and MIT means you can **bundle the data offline**, not just hit the API. UK coverage is thin (still a gap). |
| **Your users' submissions** | Your ToS | Yes | Licensed to the project via the ToS → a legitimately-built dataset that grows over time. |
| **Your own GPS captures** | Yours | Yes | — |

**Do NOT:**

- **Scrape PADI / SSI** (or any commercial site's database). "Public" ≠ licensed.
  Risks: UK/EU **database right** (substantial extraction — you're UK-based, this
  is the real exposure), **ToS breach** (contract), thin compilation copyright. Get
  the *fact* (a coordinate) from an open source instead — you never need theirs.
- **Bulk-hit the public Nominatim endpoint** in a paid app (its usage policy
  forbids it). Self-host or use raw OSM data for commercial scale.
- **Copy Submersion's bundled `dive_sites.json`** — it's in a GPL repo and a
  curated compilation can carry rights. Trace to the upstream open sources instead.

**Strategy:** build your own dataset from CC0/ODbL/OGL sources, grow it from user
submissions + your own captures, and give back to OSM. No scraping, no partnership
deals, licence-clean throughout.

## 6. Data model & build

- **Record:** `{ name, lat, lng, country, region, source }` (`source` tracks
  provenance per record, for attribution and dedup — mirrors Submersion's
  `ExternalDiveSite.source`).
- **Two stores:** the bundled `data/dive-sites.json` (Tier 2 seed) + the existing
  personal cache (Tier 1, bootstrapped from your dives). Search merges both.
- **Dev-time build script (Python — the sanctioned dev tool, never shipped):**
  query Overpass (OSM dive nodes) + Wikidata (SPARQL) + any OGL UK dataset →
  normalise → dedup by name + proximity → emit the compact JSON with per-record
  `source`. Re-runnable to refresh.
- **Attribution surface:** an "Attributions" line/screen crediting OSM/GeoNames/OGL
  as their licences require, and (ODbL) make the OSM-derived dataset available.

## 7. Phasing (no version numbers until scheduled)

- **Phase A — pin-drop UX fix.** Draggable marker on the map writes `lat`/`lng`
  directly into the dive. Immediate pain relief, zero data-sourcing/licensing work.
  Ship first.
- **Phase B — bundled open dataset.** The Python build script + `data/dive-sites.json`
  + merge into site search + the Attributions surface. (`sw.js` SHELL += the JSON;
  bump cache.)
- **Phase C — retroactive backfill.** Match old un-geotagged dives to known sites by
  name; offer one-click coordinate fill.
- **Phase D (later) — OSM give-back.** The roadmap's `sport=scuba_diving` submission
  (OAuth PKCE) — closes the loop and improves the shared dataset for everyone.

## 8. Open questions

- ~~Verify Dive Vibe's commercial terms~~ **RESOLVED (2026-06-26 search):** the
  Dive Vibe community data is **MIT-licensed** (`jbunderwater/dive-vibe-community`)
  → commercial-safe with attribution, and bundle-able offline. Sanity-check its own
  data provenance, but the licence is clean.
- ~~Does an open UK dive-site dataset exist?~~ **SEARCHED (2026-06-26):** no
  dedicated consolidated UK dataset found. Open global sets exist (Dive Vibe ~2,800
  sites = MIT, the biggest) but UK coverage is thin in all of them. Cautionary
  find: `dulcetgnome/divestop` has **no licence = all rights reserved, do not use**
  (public ≠ free). **The UK gap stands** — fill it with OSM (wrecks via
  `historic=wreck` / `seamark:type=wreck`) + OGL gov wreck data + your own captures.
- **Nominatim commercially:** self-host vs swap for a commercial geocoder vs drop to
  OSM-data-only — decide at Phase B if Tier 3 stays in a paid build.
- **Legal review of the data sourcing** before any paid launch (per the status note).

## 9. Foundations to preserve for Phase D (pooled data → OSM contribution)

Phase D (pooled community data + OSM give-back) is deferred, but a few things are
**cheap now and impossible to retrofit** — bake them in whenever the capture flow is
next touched. Chosen model: **push contributions to OSM and let OSM be the
consolidation backend.** Note OSM is a *governed commons*, not an auto-dump — bulk
contribution is a deliberate, deduped, reviewed process under OSM's import
guidelines and automated-edits code of conduct, never a per-dive firehose.

### 9a. Data-model foundations (cheap now, can't retrofit)

1. **Consent at capture — the one you cannot add later.** You cannot relicense a
   user's data to OSM (ODbL) after the fact. Store a per-capture consent flag,
   **opt-in / default-off / per-site / revocable / in-context** (a "share this site
   to open data?" moment, not a ToS line).
2. **Rich, immutable observations** — not just `lat`/`lng` on the dive. Per capture
   store: coords, **accuracy** (`captureGPS()` already *receives* `coords.accuracy`
   from `getCurrentPosition` — just keep it; it's the quality signal consolidation
   and OSM-worthiness need), timestamp, **method** (device GPS / dropped pin /
   imported), **context** (entry/exit/boat), pseudonymous capturer id.
3. **Observations ≠ canonical** — raw captures stay separate from the served
   coordinate, so the canonical point can be re-derived/audited (geometric-median
   of the cluster; reject outliers; spread = confidence).
4. **Minimal stable site identity** — so observations are groupable later (today
   "site" is free text; even a normalised site-key helps).
5. **`osm_id` slot** on a site once linked/contributed — so a later edit *updates*
   the OSM feature instead of creating a duplicate.

### 9b. Consent & data-minimisation architecture ("how do I know only GPS is shared?")

Certainty comes from **construction + transparency**, never a promise:

- **Contribute a *site*, never a *dive*.** A site is `{coord, name, type}` — no
  notes/buddy/personal field exists on it, so there is nothing to leak. (This is why
  the site-vs-dive entity split matters beyond tidiness.)
- **Allowlist serialisation, never blacklist.** The OSM payload is built by
  *explicitly listing* the fields that go (`lat, lng, name, type`). A field added
  later can't leak — it isn't on the list. Over-sharing is *impossible*, not merely
  prohibited.
- **Preview-and-confirm.** Before egress, show the literal complete payload
  ("published on OSM: point X,Y, name '…', type '…'. Nothing else.") and confirm per
  site. Certainty by seeing, not trusting.
- **OSM is the receipt.** The public changeset is a permanent, auditable record of
  exactly what was uploaded — verifiable after the fact by anyone.
- **Open-code backstop** — the contribution code can be read to confirm it only
  serialises the allowlist.

This *expresses* data sovereignty rather than contradicting it: notes never enter
the pipeline (they live in the user's vault, never on a server), so they aren't
"withheld" — they were never in it. The only egress is a single, previewed,
explicitly-consented map pin the user chose.

### 9c. Not now

Do **not** pre-build the OAuth 2.0 PKCE flow, the consolidation engine, the
pooling/ingestion path, or bulk-import tooling. The foundations above just keep the
door open so none of it needs a data migration later. Build consent + accuracy +
raw-observation retention; defer the rest.
