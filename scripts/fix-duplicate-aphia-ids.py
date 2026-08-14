#!/usr/bin/env python3
"""
Fixes duplicate AphiaIDs in SPECIES_DB — cases where 2+ genuinely different
species share the same aphiaId. Found live while building
scripts/fetch-species-regions.py, whose warn_duplicate_aphia_ids() check
surfaced 90 such groups / 198 rows (e.g. aphiaId 105833 was stored against
BOTH "Eucrossorhinus dasypogon" (tasselled wobbegong) and "Hexanchus
griseus" (bluntnose sixgill shark) — unrelated species, not synonyms).
Likely root cause: past manual/scripted entry copying an adjacent row's id
instead of looking up the correct one.

For each affected scientificName, looks up its real AphiaID via WoRMS'
AphiaRecordsByName (exact match, like=false) and corrects the stored id if
it's wrong. Exactly one member of a duplicate group usually already owns
the id legitimately — that row is left untouched.

marine_only=true is tried first; a name with no exact match there is
retried with marine_only=false (still an EXACT name match, just without the
marine flag — some records are inconsistently flagged, not a fuzzy-match
relaxation). Uses valid_AphiaID (the current ACCEPTED id) when the matched
record itself is an unaccepted synonym, matching how the rest of the app
treats AphiaIDs as the current-canonical join key (see DECISIONS.md —
"AphiaIDs at logging time"). Anything still ambiguous or unmatched is left
untouched and reported for manual follow-up — never guessed.

Progress cached to scripts/aphia-id-fixes.json (resumable, keyed by name so
a re-run only queries names it hasn't resolved yet).

Usage: python3 scripts/fix-duplicate-aphia-ids.py [--apply]
  Without --apply: prints the proposed fixes, writes nothing (default).
  With --apply: writes corrected aphiaIds into data/species-db.js and
                re-checks for any newly-introduced duplicates afterward.
"""

import json
import re
import time
import subprocess
import os
import sys
import argparse
import urllib.parse

PROGRESS_FILE = os.path.join(os.path.dirname(__file__), 'aphia-id-fixes.json')
SPECIES_FILE  = os.path.join(os.path.dirname(__file__), '..', 'data', 'species-db.js')
DELAY = 0.4


def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {}


def save_progress(data):
    with open(PROGRESS_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def _query_worms(scientific_name, marine_only):
    name_enc = urllib.parse.quote(scientific_name)
    flag = 'true' if marine_only else 'false'
    url = (f"https://www.marinespecies.org/rest/AphiaRecordsByName/{name_enc}"
           f"?like=false&marine_only={flag}")
    result = subprocess.run(
        ['curl', '-s', '-X', 'GET', url, '-H', 'accept: application/json'],
        capture_output=True, text=True, timeout=15
    )
    out = result.stdout.strip()
    if not out or out in ('[]', 'null'):
        return None, 'no exact match'
    data = json.loads(out)
    if not isinstance(data, list) or not data:
        return None, 'no exact match'

    accepted = [r for r in data if r.get('status') == 'accepted']
    if len(accepted) == 1:
        return accepted[0]['AphiaID'], 'accepted'
    if len(accepted) > 1:
        ids = {r['AphiaID'] for r in accepted}
        if len(ids) == 1:
            return ids.pop(), 'accepted (multiple identical records)'
        return None, f'ambiguous — {len(accepted)} distinct accepted records'

    # No accepted record among the exact matches — fall back to valid_AphiaID,
    # but only if every candidate agrees on what that is.
    valids = {r.get('valid_AphiaID') or r.get('AphiaID') for r in data}
    valids.discard(None)
    if len(valids) == 1:
        statuses = '/'.join(sorted({str(r.get('status')) for r in data}))
        return valids.pop(), f'unaccepted, using valid_AphiaID (status={statuses})'
    return None, f'ambiguous — {len(data)} candidates, no consistent valid_AphiaID'


def lookup_aphia_id(scientific_name):
    """Returns (aphiaId:int|None, note:str) for one scientific name."""
    try:
        aphia_id, note = _query_worms(scientific_name, marine_only=True)
        if aphia_id is not None:
            return aphia_id, note
        if note == 'no exact match':
            aphia_id2, note2 = _query_worms(scientific_name, marine_only=False)
            if aphia_id2 is not None:
                return aphia_id2, note2 + ' (non-marine-flagged fallback)'
        return aphia_id, note
    except subprocess.TimeoutExpired:
        return None, 'timeout'
    except json.JSONDecodeError as e:
        return None, f'JSON error: {e}'
    except Exception as e:
        return None, f'error: {e}'


def extract_species_db(src):
    m = re.search(r'const SPECIES_DB = (\[[\s\S]*\]);', src)
    if not m:
        raise ValueError("SPECIES_DB not found in data/species-db.js")
    return json.loads(m.group(1))


def inject_species_db(src, db):
    new_db_str = 'const SPECIES_DB = ' + json.dumps(db, separators=(',', ':'), ensure_ascii=False) + ';'
    return re.sub(r'const SPECIES_DB = \[[\s\S]*\];', new_db_str, src)


def find_duplicate_groups(db):
    by_id = {}
    for e in db:
        by_id.setdefault(e[2], []).append(e[1])
    return {k: v for k, v in by_id.items() if k and len(v) > 1 and len(set(v)) > 1}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true',
                         help='Write corrected aphiaIds into data/species-db.js')
    args = parser.parse_args()

    with open(SPECIES_FILE, encoding='utf-8') as f:
        src = f.read()
    db = extract_species_db(src)

    dupes = find_duplicate_groups(db)
    print(f"{len(dupes)} duplicate aphiaId groups, {sum(len(v) for v in dupes.values())} rows affected.\n")
    if not dupes:
        print("Nothing to fix.")
        return

    names = sorted({name for group_names in dupes.values() for name in group_names})
    print(f"{len(names)} unique scientific names to verify against WoRMS.\n")

    progress = load_progress()
    for i, name in enumerate(names):
        if name in progress:
            continue
        print(f"[{i+1}/{len(names)}] {name}...", end=' ', flush=True)
        aphia_id, note = lookup_aphia_id(name)
        progress[name] = {'aphiaId': aphia_id, 'note': note}
        save_progress(progress)
        print(f"{aphia_id} ({note})")
        time.sleep(DELAY)

    print()
    fixes = []
    unresolved = []
    for aphia_id, group_names in dupes.items():
        for name in set(group_names):
            resolved = progress.get(name, {})
            new_id = resolved.get('aphiaId')
            if new_id is None:
                unresolved.append((name, aphia_id, resolved.get('note')))
            elif new_id != aphia_id:
                fixes.append((name, aphia_id, new_id, resolved.get('note')))
            # else: this row already legitimately owns aphia_id — no fix needed

    print(f"Resolved fixes: {len(fixes)}")
    for name, old, new, note in sorted(fixes):
        print(f"  {name}: {old} -> {new}  ({note})")

    if unresolved:
        print(f"\nUnresolved (left untouched, needs manual attention): {len(unresolved)}")
        for name, old, note in sorted(unresolved):
            print(f"  {name}: still {old}  ({note})")

    if not args.apply:
        print("\nDry run — pass --apply to write these fixes into data/species-db.js.")
        return

    fix_map = {name: new for name, old, new, note in fixes}
    updated_db = []
    changed = 0
    for entry in db:
        name = entry[1]
        if name in fix_map:
            entry = [entry[0], entry[1], fix_map[name]] + list(entry[3:])
            changed += 1
        updated_db.append(entry)

    new_src = inject_species_db(src, updated_db)
    with open(SPECIES_FILE, 'w', encoding='utf-8') as f:
        f.write(new_src)
    print(f"\n✓ Applied {changed} aphiaId corrections to data/species-db.js.")

    remaining = find_duplicate_groups(updated_db)
    new_dupes = {k: v for k, v in remaining.items() if k not in dupes}
    if new_dupes:
        print(f"\n⚠ {len(new_dupes)} NEW duplicate group(s) introduced by this run — review needed:")
        for aphia_id, group_names in new_dupes.items():
            print(f"  {aphia_id}: {group_names}")
    still_dup = {k: v for k, v in remaining.items() if k in dupes}
    if still_dup:
        print(f"\n{len(still_dup)} original group(s) still duplicated (unresolved names) — see above.")


if __name__ == '__main__':
    main()
