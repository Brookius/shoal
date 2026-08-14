#!/usr/bin/env python3
"""
Fetches IUCN Red List conservation status for all species in SPECIES_DB
and injects them as a 6th element into each entry in index.html.

SPECIES_DB entry goes from:
  [commonName, scientificName, aphiaId, group, photoUrl]
to:
  [commonName, scientificName, aphiaId, group, photoUrl, iucnStatus]

iucnStatus values: "EX","EW","CR","EN","VU","NT","LC","DD","NE" or "" if not found.

Endpoint: GET /api/v4/taxa/scientific_name?genus_name=X&species_name=Y
Auth: Authorization: <raw token>  (no "Token token=" prefix)

Progress is saved to scripts/iucn-status.json after each fetch so the
script can be safely interrupted and resumed.

Usage: python3 scripts/fetch-iucn.py --token YOUR_API_TOKEN
"""

import json
import re
import time
import subprocess
import urllib.parse
import os
import sys
import argparse

PROGRESS_FILE = os.path.join(os.path.dirname(__file__), 'iucn-status.json')
# Post-migration: SPECIES_DB lives in data/species-db.js, not index.html.
SPECIES_FILE  = os.path.join(os.path.dirname(__file__), '..', 'data', 'species-db.js')
DELAY         = 0.6  # seconds between requests — IUCN recommends >= 0.5s between calls

API_BASE = "https://api.iucnredlist.org/api/v4"

# SPECIES_DB stores WoRMS-canonical scientific names (the app's join key — see
# CLAUDE.md). IUCN's own assessment records sometimes lag behind or diverge
# from WoRMS on genus placement / Latin gender-ending spelling (confirmed
# 2026-07 against Rhina ancylostoma/ancylostomus — IUCN files it under the
# older masculine form). When the primary lookup 404s, retry once against
# the GBIF-backbone alternate name below — found by cross-referencing every
# name that had no IUCN match against api.gbif.org/v1/species/match. The
# result is still stored under the ORIGINAL WoRMS name; this dict is only an
# alternate query key, never a rename.
SYNONYM_FALLBACKS = {
    'Taeniura meyeni': 'Taeniurops meyeni',
    'Scarus gibbus': 'Chlorurus gibbus',
    'Apogon cyanosoma': 'Ostorhinchus cyanosoma',
    'Dasyatis centroura': 'Bathytoshia centroura',
    'Himantura jenkinsii': 'Pateobatis jenkinsii',
    'Rhinobatos productus': 'Pseudobatos productus',
    'Siderea thyrsoidea': 'Gymnothorax thyrsoideus',
    'Siderea picta': 'Gymnothorax pictus',
    'Scarus strongylocephalus': 'Chlorurus strongylocephalus',
    'Amblygobius rainfordi': 'Koumansetta rainfordi',
    'Coris africana': 'Coris cuvieri',
    'Pseudochromis paccagnellae': 'Pictichromis paccagnellae',
    'Pomacanthus sextriatus': 'Pomacanthus sexstriatus',
    'Alectis indicus': 'Alectis indica',
    'Scomberoides commersonianus': 'Scomberoides commersonnianus',
    'Sphyraena putnamiae': 'Sphyraena putnamae',
    'Scolopsis margaritifer': 'Scolopsis margaritifera',
    'Parupeneus macronema': 'Parupeneus macronemus',
    'Parupeneus bifasciatus': 'Parupeneus trifasciatus',
    'Octopus defilippi': 'Macrotritopus defilippi',
    'Otaria flavescens': 'Otaria byronia',
    'Acanthurus nigros': 'Acanthurus nigroris',
    'Naso literatus': 'Naso lituratus',
    'Hippocampus taeniopterus': 'Hippocampus kuda',
    'Hippocampus severnsi': 'Hippocampus pontohi',
    'Doryrhamphus dactyliophorus': 'Dunckerocampus dactyliophorus',
    'Parapercis cephalopunctata': 'Parapercis millepunctata',
    'Leucopleurus acutus': 'Lagenorhynchus acutus',
    'Rhina ancylostoma': 'Rhina ancylostomus',
}

def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {}

def save_progress(data):
    with open(PROGRESS_FILE, 'w') as f:
        json.dump(data, f, indent=2)

def fetch_iucn_status(scientific_name, token):
    """Returns IUCN status code string or '' if not found. Tries the WoRMS
    (stored) name first, then a known synonym/rename fallback if the primary
    lookup finds nothing. Either way the caller stores the result under
    scientific_name — this function never changes what name means what.
    """
    status = _query_iucn(scientific_name, token)
    if status:
        return status

    fallback = SYNONYM_FALLBACKS.get(scientific_name)
    if fallback:
        status = _query_iucn(fallback, token)
        if status:
            print(f"  (found via synonym {fallback!r})")
    return status

def _query_iucn(scientific_name, token):
    """Single lookup attempt. Uses curl subprocess to avoid Cloudflare bot
    detection that blocks urllib.
    """
    parts = scientific_name.strip().split(' ', 1)
    if len(parts) < 2:
        return ''
    genus, species = parts[0], parts[1]

    params = urllib.parse.urlencode({'genus_name': genus, 'species_name': species})
    url = f"{API_BASE}/taxa/scientific_name?{params}"

    try:
        result = subprocess.run(
            ['curl', '-s', '-X', 'GET', url,
             '-H', f'Authorization: {token}',
             '-H', 'accept: application/json'],
            capture_output=True, text=True, timeout=15
        )
        if not result.stdout.strip():
            return ''
        data = json.loads(result.stdout)

        if 'error' in data or 'status' in data:
            # {"status": 404, "error": "Not Found"}
            return ''

        # Find latest global assessment
        assessments = data.get('assessments', [])
        if not assessments:
            return ''

        # Prefer latest=true + global scope (code "1")
        # Fall back to first assessment with latest=true
        # Fall back to first assessment overall
        latest_global = None
        latest_any = None
        for a in assessments:
            if a.get('latest'):
                scopes = a.get('scopes', [])
                scope_codes = [s.get('code') for s in scopes]
                if '1' in scope_codes:
                    latest_global = a
                    break
                if latest_any is None:
                    latest_any = a

        best = latest_global or latest_any or assessments[0]
        return best.get('red_list_category_code', '') or ''

    except subprocess.TimeoutExpired:
        print(f"  ✗ Timeout for {scientific_name!r}")
    except json.JSONDecodeError as e:
        print(f"  ✗ JSON error for {scientific_name!r}: {e}")
    except Exception as e:
        print(f"  ✗ Error for {scientific_name!r}: {e}")
    return ''

def extract_species_db(src):
    m = re.search(r'const SPECIES_DB = (\[[\s\S]*\]);', src)
    if not m:
        raise ValueError("SPECIES_DB not found in data/species-db.js")
    return json.loads(m.group(1))

def inject_species_db(src, db):
    new_db_str = 'const SPECIES_DB = ' + json.dumps(db, separators=(',', ':'), ensure_ascii=False) + ';'
    # Preserve the header comment block (everything before the const declaration)
    return re.sub(r'const SPECIES_DB = \[[\s\S]*\];', new_db_str, src)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--token', required=True, help='IUCN Red List API token (raw, no prefix)')
    args = parser.parse_args()

    print("Loading data/species-db.js...")
    with open(SPECIES_FILE, encoding='utf-8') as f:
        src = f.read()

    db = extract_species_db(src)
    print(f"Found {len(db)} species.")

    progress = load_progress()
    print(f"Loaded {len(progress)} cached IUCN results.\n")

    total   = len(db)
    fetched = 0
    found   = 0
    skipped = 0

    STATUS_LABELS = {'CR': 'Critically Endangered', 'EN': 'Endangered', 'VU': 'Vulnerable',
                     'NT': 'Near Threatened', 'LC': 'Least Concern', 'DD': 'Data Deficient',
                     'EX': 'Extinct', 'EW': 'Extinct in Wild', 'NE': 'Not Evaluated'}

    for i, entry in enumerate(db):
        sci_name = entry[1]

        if sci_name in progress:
            skipped += 1
            if progress[sci_name]:
                found += 1
            continue

        print(f"[{i+1}/{total}] {sci_name}...")
        status = fetch_iucn_status(sci_name, args.token)
        progress[sci_name] = status

        if status:
            label = STATUS_LABELS.get(status, status)
            print(f"  ✓ {status} — {label}")
            found += 1
        else:
            print(f"  – not found")

        fetched += 1
        save_progress(progress)
        time.sleep(DELAY)

        if (i + 1) % 100 == 0:
            print(f"\n--- {i+1}/{total} done | {found} statuses found so far ---\n")

    print(f"\n✓ Complete: {found}/{total} species have IUCN status.")

    # Build updated DB with iucnStatus as 6th element (preserve existing status
    # if the API returned nothing this run — don't clobber a known value with '')
    updated_db = []
    for entry in db:
        sci_name    = entry[1]
        photo_url   = entry[4] if len(entry) > 4 else ''
        existing    = entry[5] if len(entry) > 5 else ''
        iucn_status = progress.get(sci_name, '') or existing
        updated_db.append([entry[0], entry[1], entry[2], entry[3], photo_url, iucn_status])

    print("Injecting updated SPECIES_DB into data/species-db.js...")
    new_src = inject_species_db(src, updated_db)
    with open(SPECIES_FILE, 'w', encoding='utf-8') as f:
        f.write(new_src)
    print("✓ data/species-db.js updated.")

    # Print breakdown
    from collections import Counter
    counts = Counter(v for v in progress.values() if v)
    print("\nStatus breakdown:")
    for status, count in sorted(counts.items(), key=lambda x: -x[1]):
        label = STATUS_LABELS.get(status, status)
        print(f"  {status} ({label}): {count}")

if __name__ == '__main__':
    main()
