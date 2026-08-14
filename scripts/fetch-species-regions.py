#!/usr/bin/env python3
"""
Tags every species in SPECIES_DB with the ocean/coastal regions it's been
recorded in, adding a 7th element to each entry:

  Before: [commonName, scientificName, aphiaId, group, photoUrl, iucnStatus]
  After:  [commonName, scientificName, aphiaId, group, photoUrl, iucnStatus, regions]

`regions` is a "|"-joined string of codes from REGIONS below (e.g. "sea|ip"),
or "" if the species matched none of them. See ROADMAP.md -> "Species
Distribution Data" for the feature this feeds (a "Found in" line on the
Species Album profile, and a future log-form Country pre-filter).

Data source: OBIS's /checklist endpoint (api.obis.org), NOT the WoRMS
distribution-string endpoint originally scoped — checklist returns a
`taxonID` per record, which is a WoRMS AphiaID and therefore a plain
integer-equality join against SPECIES_DB, no fuzzy string normalisation.

Each region is backed by a short hand-picked list of representative OBIS
country/territory area IDs (looked up once via GET /v3/area?size=2000 and
matching on `name`+type:"obis" — that endpoint ignores any `name=` filter
server-side, confirmed by testing, so the full list has to be pulled and
searched client-side). A species is tagged with a region if it appears in
the OBIS checklist for ANY of that region's representative areas (confirmed
empirically: comma-joined areaid values are OR'd together, not AND'd — see
_fetch_chunk's docstring).

/checklist is filtered server-side by both `areaid` and `taxonid` (both take
comma-separated lists, confirmed by testing), so this never downloads a
country's full checklist (Indonesia alone has 17,472 entries across every
taxon OBIS tracks, not just the ~1,279 species in SPECIES_DB) — each request
asks "which of THESE aphiaIds are present in THESE areas" directly. Aphia ID
lists are chunked (CHUNK_SIZE) to stay well under any sane URL-length limit.

`size` defaults to 10 if omitted (confirmed by testing) and silently caps at
10000 with NO error above that (confirmed: size=20000 returns total:0,
results:[] — a silent-failure footgun, not a 400) — every request here passes
an explicit size equal to its own chunk length, which is always <= CHUNK_SIZE
and so never close to that ceiling.

Progress is cached to scripts/species-regions.json ONE REGION AT A TIME (not
per-chunk — each region is only ~5 requests, cheap enough to redo wholesale
on resume) so an interrupted run doesn't lose completed regions. species-db.js
is only rewritten once every region in REGIONS has resolved, fresh or cached.

Usage: python3 scripts/fetch-species-regions.py [--dry-run]
"""

import json
import re
import time
import subprocess
import os
import sys
import argparse

PROGRESS_FILE = os.path.join(os.path.dirname(__file__), 'species-regions.json')
SPECIES_FILE  = os.path.join(os.path.dirname(__file__), '..', 'data', 'species-db.js')
API_BASE      = "https://api.obis.org/v3"
CHUNK_SIZE    = 300   # ~2.1KB of URL per chunk at real aphiaId digit-lengths — see module docstring
DELAY         = 0.4   # seconds between requests — OBIS states no hard limit, this is just good citizenship

# Region code -> (diver-facing label, representative OBIS area IDs).
# IDs looked up once against GET /v3/area?size=2000 (type:"obis" = country/
# territory EEZ, the cleanest OBIS area granularity) — not guessed. A few
# countries are split into sub-EEZs by OBIS (e.g. "Mexico: North Atlantic"
# vs "North Pacific", "Egypt: Red Sea" vs "Mediterranean Sea"); picked the
# sub-area that actually matches the region being represented rather than
# the country's ": all" umbrella, so e.g. Mexico's Pacific coast doesn't
# leak into the Caribbean bucket. Order here is also the order region codes
# are written into each entry's joined string, matching ROADMAP.md's table.
REGIONS = {
    'ip':  ('Indo-Pacific (broad tropical)',
            [141, 189, 68, 185, 149, 230]),   # Maldives, Papua New Guinea, Fiji, Palau, Micronesia, Sri Lanka
    'sea': ('Southeast Asia',
            [115, 191, 238, 140, 281]),       # Indonesia, Philippines, Thailand, Malaysia, Vietnam
    'rs':  ('Red Sea',
            [63, 210, 231, 54]),              # Egypt: Red Sea, Saudi Arabia, Sudan, Djibouti
    'med': ('Mediterranean',
            [62, 122, 98, 228, 46, 142, 48, 84]),  # Egypt: Med, Italy, Greece, Spain: Med, Croatia, Malta, Cyprus, France: Med
    'na':  ('NE Atlantic / UK-European waters',
            [247, 118, 179, 193, 159]),       # UK, Ireland, Norway, Portugal, Netherlands
    'car': ('Caribbean',
            [17, 22, 47, 124, 56, 254, 147]), # Bahamas, Belize, Cuba, Jamaica, Dominican Republic, UK: Cayman Islands, Mexico: North Atlantic
    'ep':  ('Eastern Pacific',
            [148, 45, 188, 60]),              # Mexico: North Pacific, Costa Rica: North Pacific, Panama: North Pacific, Ecuador: Galapagos Islands
    'au':  ('Australian / GBR waters',
            [8]),                             # Australia (single EEZ area — GBR waters fall inside it)
}


def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {}


def save_progress(data):
    with open(PROGRESS_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def _fetch_chunk(area_ids, aphia_chunk):
    """One /checklist call: which of aphia_chunk are present in ANY of
    area_ids? Returns a set of matched aphiaIds (ints). Confirmed by testing
    (not assumed) that comma-joined areaid values are OR'd: querying a
    tropical species against "Indonesia,Iceland" matched (via Indonesia)
    while "Iceland" alone returned zero — union, not intersection.
    """
    area_param  = ','.join(str(a) for a in area_ids)
    taxon_param = ','.join(str(a) for a in aphia_chunk)
    url = (f"{API_BASE}/checklist?areaid={area_param}"
           f"&taxonid={taxon_param}&size={len(aphia_chunk)}")

    try:
        result = subprocess.run(
            ['curl', '-s', '-X', 'GET', url, '-H', 'accept: application/json'],
            capture_output=True, text=True, timeout=30
        )
        if not result.stdout.strip():
            return set()
        data = json.loads(result.stdout)
        return {r['taxonID'] for r in data.get('results', []) if 'taxonID' in r}
    except subprocess.TimeoutExpired:
        print(f"  ✗ Timeout fetching chunk of {len(aphia_chunk)} ids")
    except json.JSONDecodeError as e:
        print(f"  ✗ JSON error: {e}")
    except Exception as e:
        print(f"  ✗ Error: {e}")
    return set()


def fetch_region_matches(area_ids, all_aphia_ids):
    """Full membership set for one region: chunks all_aphia_ids and unions
    the matches across chunks."""
    matched = set()
    chunks = [all_aphia_ids[i:i + CHUNK_SIZE] for i in range(0, len(all_aphia_ids), CHUNK_SIZE)]
    for i, chunk in enumerate(chunks):
        print(f"  chunk {i+1}/{len(chunks)} ({len(chunk)} ids)...", end=' ', flush=True)
        found = _fetch_chunk(area_ids, chunk)
        matched |= found
        print(f"{len(found)} matched")
        time.sleep(DELAY)
    return matched


def extract_species_db(src):
    m = re.search(r'const SPECIES_DB = (\[[\s\S]*\]);', src)
    if not m:
        raise ValueError("SPECIES_DB not found in data/species-db.js")
    return json.loads(m.group(1))


def inject_species_db(src, db):
    new_db_str = 'const SPECIES_DB = ' + json.dumps(db, separators=(',', ':'), ensure_ascii=False) + ';'
    return re.sub(r'const SPECIES_DB = \[[\s\S]*\];', new_db_str, src)


def warn_duplicate_aphia_ids(db):
    """Sanity check on the script's own core assumption (aphiaId uniquely
    identifies a species) — found live while building this script: 91
    aphiaIds in the current DB are each shared by 2+ UNRELATED species (e.g.
    105833 = both 'Eucrossorhinus dasypogon' and 'Hexanchus griseus'), not
    synonyms. Any such row gets whichever region tags the OTHER species
    sharing its id happens to match — silently wrong, not just imprecise.
    This only warns; fixing the underlying wrong ids is a separate,
    much bigger pass (each needs a real WoRMS name lookup to re-derive the
    correct id) and out of scope here.
    """
    by_id = {}
    for e in db:
        by_id.setdefault(e[2], []).append(e[1])
    dupes = {k: v for k, v in by_id.items() if k and len(v) > 1 and len(set(v)) > 1}
    if not dupes:
        return
    total_rows = sum(len(v) for v in dupes.values())
    print(f"⚠ {len(dupes)} aphiaId(s) shared by different species ({total_rows} rows affected) — "
          f"their region tags will be cross-contaminated. Not fixed by this script.")
    for aphia_id, names in list(dupes.items())[:5]:
        print(f"    {aphia_id}: {', '.join(names)}")
    if len(dupes) > 5:
        print(f"    ... and {len(dupes) - 5} more")
    print()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true',
                         help="Fetch and print stats, but don't write species-db.js")
    args = parser.parse_args()

    print("Loading data/species-db.js...")
    with open(SPECIES_FILE, encoding='utf-8') as f:
        src = f.read()

    db = extract_species_db(src)
    print(f"Found {len(db)} species.\n")

    warn_duplicate_aphia_ids(db)

    all_aphia_ids = sorted({e[2] for e in db if e[2]})
    print(f"{len(all_aphia_ids)} unique aphiaIds to check across {len(REGIONS)} regions.\n")

    progress = load_progress()
    for code, (label, area_ids) in REGIONS.items():
        if code in progress:
            print(f"[{code}] {label} — cached ({len(progress[code])} matches)")
            continue
        print(f"[{code}] {label} — fetching against areas {area_ids}...")
        matched = fetch_region_matches(area_ids, all_aphia_ids)
        progress[code] = sorted(matched)
        save_progress(progress)
        print(f"  ✓ {len(matched)} of {len(all_aphia_ids)} species matched\n")

    missing = [code for code in REGIONS if code not in progress]
    if missing:
        print(f"Incomplete — still missing regions: {missing}. Re-run to resume.")
        sys.exit(1)

    # Build region string per species, in REGIONS' declared order (matches
    # the ROADMAP.md table order for a readable, deterministic "Found in" line).
    region_sets = {code: set(ids) for code, ids in progress.items()}
    zero_match = 0
    updated_db = []
    for entry in db:
        aphia_id  = entry[2]
        photo_url = entry[4] if len(entry) > 4 else ''
        iucn      = entry[5] if len(entry) > 5 else ''
        codes = [code for code in REGIONS if aphia_id in region_sets.get(code, ())]
        if not codes:
            zero_match += 1
        regions = '|'.join(codes)
        updated_db.append([entry[0], entry[1], entry[2], entry[3], photo_url, iucn, regions])

    print("Region match summary:")
    for code, (label, _) in REGIONS.items():
        n = len(region_sets.get(code, ()))
        print(f"  {code:4} {label:35} {n}")
    print(f"  {'':4} {'(no region matched)':35} {zero_match}")

    if args.dry_run:
        print("\n--dry-run: not writing species-db.js.")
        return

    print("\nInjecting updated SPECIES_DB into data/species-db.js...")
    new_src = inject_species_db(src, updated_db)
    with open(SPECIES_FILE, 'w', encoding='utf-8') as f:
        f.write(new_src)
    print("✓ data/species-db.js updated.")


if __name__ == '__main__':
    main()
