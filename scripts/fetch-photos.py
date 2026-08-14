#!/usr/bin/env python3
"""
Fetches CC-licensed species photo URLs from iNaturalist and injects them into
data/species-db.js. Only ever writes URLs on the inaturalist-open-data.s3
bucket — that bucket mirrors CC-licensed photos exclusively, so any URL on it
is safe by definition. static.inaturalist.org serves photos regardless of
licence and must never be used as a source (see CLAUDE.md/ROADMAP.md — the
June 2026 audit had to strip 188 static.inaturalist.org URLs that had slipped
in before this rule existed).

Only processes entries with an empty photoUrl (5th element) — never
overwrites an existing photo, and never touches iucnStatus (6th element).

SPECIES_DB entry shape (unchanged by this script):
  [commonName, scientificName, aphiaId, group, photoUrl, iucnStatus]

Progress is saved to scripts/species-photos.json after each fetch so the
script can be safely interrupted and resumed.

Usage: python3 scripts/fetch-photos.py
"""

import json
import re
import time
import urllib.request
import urllib.parse
import urllib.error
import os

PROGRESS_FILE = os.path.join(os.path.dirname(__file__), 'species-photos.json')
SPECIES_FILE  = os.path.join(os.path.dirname(__file__), '..', 'data', 'species-db.js')
DELAY         = 1.1  # seconds between requests — stays comfortably under 60/min

OPEN_DATA_HOST = 'inaturalist-open-data.s3.amazonaws.com'
UA = {'User-Agent': 'DiveLog/1.0 (personal dive logging app; contact: lukewbrook@gmail.com)'}

def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {}

def save_progress(data):
    with open(PROGRESS_FILE, 'w') as f:
        json.dump(data, f, indent=2)

def _get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())

def _url_exists(url):
    req = urllib.request.Request(url, headers=UA, method='HEAD')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception:
        return False

def _open_data_url_for_photo_id(photo_id):
    return f'https://{OPEN_DATA_HOST}/photos/{photo_id}/square.jpg'

def fetch_photo(scientific_name, common_name):
    """Returns a photo URL on the CC-licensed open-data bucket, or '' if none found."""
    queries = [scientific_name, common_name] if common_name else [scientific_name]
    for i, q in enumerate(queries):
        url = (f"https://api.inaturalist.org/v1/taxa?q={urllib.parse.quote(q)}"
               f"&per_page=3&rank=species,subspecies&photo_licensed=true")
        try:
            data = _get(url)
        except Exception as e:
            print(f"  ✗ Error fetching {q!r}: {e}")
            continue

        results = data.get('results', [])
        # Prefer exact scientific-name match; else first result with a photo
        # (only on the first query — don't loosen the match on the common-name fallback).
        candidates = [r for r in results if r.get('name', '').lower() == scientific_name.lower()]
        if not candidates and i == 0:
            candidates = [r for r in results if r.get('default_photo')]

        for result in candidates:
            photo = result.get('default_photo')
            if not photo or not photo.get('square_url'):
                continue
            square_url = photo['square_url']
            host = urllib.parse.urlparse(square_url).netloc

            if host == OPEN_DATA_HOST:
                return square_url

            # static.inaturalist.org (or anything else) — not CC-safe as-is.
            # Try the open-data bucket's equivalent path for the same photo id.
            photo_id = photo.get('id')
            if photo_id:
                candidate = _open_data_url_for_photo_id(photo_id)
                if _url_exists(candidate):
                    return candidate

            # Fall back to a licensed observation search for this taxon.
            taxon_id = result.get('id')
            if taxon_id:
                obs_url = (f"https://api.inaturalist.org/v1/observations?"
                           f"taxon_id={taxon_id}&photo_license=cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-nc-sa"
                           f"&quality_grade=research&per_page=5")
                try:
                    obs_data = _get(obs_url)
                except Exception:
                    obs_data = {}
                for obs in obs_data.get('results', []):
                    for p in obs.get('photos', []):
                        alt_url = (p.get('url') or '').replace('/square.', '/square.')
                        if alt_url and urllib.parse.urlparse(alt_url).netloc == OPEN_DATA_HOST:
                            return alt_url
            # No CC-safe photo for this candidate — leave blank rather than use static.inaturalist.org.
    return ''

def extract_species_db(src):
    m = re.search(r'const SPECIES_DB = (\[[\s\S]*\]);', src)
    if not m:
        raise ValueError("SPECIES_DB not found in data/species-db.js")
    return json.loads(m.group(1))

def inject_species_db(src, db):
    new_db_str = 'const SPECIES_DB = ' + json.dumps(db, separators=(',', ':'), ensure_ascii=False) + ';'
    return re.sub(r'const SPECIES_DB = \[[\s\S]*\];', new_db_str, src)

def main():
    print("Loading data/species-db.js...")
    with open(SPECIES_FILE, encoding='utf-8') as f:
        src = f.read()

    db = extract_species_db(src)
    print(f"Found {len(db)} species.")

    todo = [e for e in db if not (len(e) > 4 and e[4])]
    print(f"{len(todo)} species have no photo yet (existing photos are never overwritten).\n")

    progress = load_progress()
    print(f"Loaded {len(progress)} cached photo results.\n")

    total = len(todo)
    fetched = found = skipped = 0

    for i, entry in enumerate(todo):
        common_name, sci_name = entry[0], entry[1]

        # A cached value predating the CC-license host rule (species-photos.json
        # has entries going back to the original, unfiltered version of this
        # script) can still be sitting on the unsafe static.inaturalist.org
        # host. Trusting it blindly reintroduces exactly the licensing gap
        # this rewrite exists to close — confirmed happening in practice
        # 2026-07-09 (23 entries silently got a stale bad-host URL back).
        # Only a cached empty string or an already-safe URL counts as resolved.
        cached = progress.get(sci_name)
        if cached is not None and (cached == '' or OPEN_DATA_HOST in cached):
            skipped += 1
            if cached:
                found += 1
            continue

        print(f"[{i+1}/{total}] {common_name} ({sci_name})...")
        photo_url = fetch_photo(sci_name, common_name)
        progress[sci_name] = photo_url

        if photo_url:
            print(f"  ✓ {photo_url[:70]}...")
            found += 1
        else:
            print(f"  – no CC-licensed photo found")

        fetched += 1
        save_progress(progress)
        time.sleep(DELAY)

        if (i + 1) % 50 == 0:
            print(f"\n--- {i+1}/{total} done | {found} photos found ---\n")

    print(f"\n✓ Complete: {found}/{total} species have a CC-licensed photo.")

    # Only fill in the 5th element (photoUrl) for entries that had none.
    # Never touches entries that already had a photo, never touches iucnStatus.
    updated_db = []
    for entry in db:
        sci_name = entry[1]
        if len(entry) > 4 and entry[4]:
            updated_db.append(entry)  # already has a photo — leave untouched
            continue
        photo_url = progress.get(sci_name, '')
        iucn_status = entry[5] if len(entry) > 5 else ''
        updated_db.append([entry[0], entry[1], entry[2], entry[3], photo_url, iucn_status])

    print("Injecting updated SPECIES_DB into data/species-db.js...")
    new_src = inject_species_db(src, updated_db)
    with open(SPECIES_FILE, 'w', encoding='utf-8') as f:
        f.write(new_src)
    print("✓ data/species-db.js updated.")

if __name__ == '__main__':
    main()
