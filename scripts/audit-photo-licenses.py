#!/usr/bin/env python3
"""
Re-audit pass: finds any data/species-db.js entry whose photoUrl (5th
element) is on static.inaturalist.org — a host that serves photos
regardless of licence, not guaranteed CC — and either swaps it for a
CC-licensed equivalent on the inaturalist-open-data.s3 bucket, or blanks
it if none exists. Mirrors the June 2026 audit (see ROADMAP.md) and reuses
the exact lookup logic from fetch-photos.py's fallback path.

Never touches entries that are already on the open-data bucket or already
blank. Never touches iucnStatus.

Usage: python3 scripts/audit-photo-licenses.py
"""

import json
import re
import time
import urllib.request
import urllib.parse
import os

SPECIES_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'species-db.js')
DELAY        = 1.1

OPEN_DATA_HOST = 'inaturalist-open-data.s3.amazonaws.com'
UA = {'User-Agent': 'DiveLog/1.0 (personal dive logging app; contact: lukewbrook@gmail.com)'}

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

def find_cc_photo(scientific_name):
    """Same strategy as fetch-photos.py: exact-name taxon match, try the
    open-data bucket's own copy of the same photo id, else search licensed
    observations for this taxon. Returns '' if nothing CC-safe is found.
    """
    url = (f"https://api.inaturalist.org/v1/taxa?q={urllib.parse.quote(scientific_name)}"
           f"&per_page=3&rank=species,subspecies&photo_licensed=true")
    try:
        data = _get(url)
    except Exception as e:
        print(f"  ✗ Error: {e}")
        return ''

    candidates = [r for r in data.get('results', []) if r.get('name', '').lower() == scientific_name.lower()]
    for result in candidates:
        photo = result.get('default_photo')
        if photo and photo.get('square_url'):
            host = urllib.parse.urlparse(photo['square_url']).netloc
            if host == OPEN_DATA_HOST:
                return photo['square_url']
            photo_id = photo.get('id')
            if photo_id:
                candidate = f'https://{OPEN_DATA_HOST}/photos/{photo_id}/square.jpg'
                if _url_exists(candidate):
                    return candidate

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
                    alt_url = p.get('url') or ''
                    if alt_url and urllib.parse.urlparse(alt_url).netloc == OPEN_DATA_HOST:
                        return alt_url
    return ''

def main():
    src = open(SPECIES_FILE, encoding='utf-8').read()
    db = json.loads(re.search(r'const SPECIES_DB = (\[[\s\S]*\]);', src).group(1))

    unsafe = [(i, e) for i, e in enumerate(db)
              if len(e) > 4 and e[4] and urllib.parse.urlparse(e[4]).netloc == 'static.inaturalist.org']
    print(f"Found {len(unsafe)} entries on static.inaturalist.org.\n")

    replaced = blanked = 0
    for n, (i, e) in enumerate(unsafe):
        common, sci = e[0], e[1]
        print(f"[{n+1}/{len(unsafe)}] {common} ({sci})...")
        new_url = find_cc_photo(sci)
        if new_url:
            print(f"  ✓ replaced with open-data equivalent")
            db[i] = [e[0], e[1], e[2], e[3], new_url, (e[5] if len(e) > 5 else '')]
            replaced += 1
        else:
            print(f"  – no CC-licensed equivalent found, blanking")
            db[i] = [e[0], e[1], e[2], e[3], '', (e[5] if len(e) > 5 else '')]
            blanked += 1
        time.sleep(DELAY)

    print(f"\n✓ Complete: {replaced} replaced, {blanked} blanked, {len(unsafe)} total.")

    new_db_str = 'const SPECIES_DB = ' + json.dumps(db, separators=(',', ':'), ensure_ascii=False) + ';'
    new_src = re.sub(r'const SPECIES_DB = \[[\s\S]*\];', new_db_str, src)
    with open(SPECIES_FILE, 'w', encoding='utf-8') as f:
        f.write(new_src)
    print("✓ data/species-db.js updated.")

if __name__ == '__main__':
    main()
