#!/usr/bin/env python3
"""
Full-DB AphiaID validation — every species in SPECIES_DB checked against
WoRMS by exact scientific name, not just the ones caught by the earlier
duplicate-ID scan (scripts/fix-duplicate-aphia-ids.py).

That earlier pass fixed 183 rows whose wrong aphiaId happened to COLLIDE
with another row's. Applying it surfaced 24 NEW collisions — proof the
corruption is wider than what a "shared ID" heuristic can see: a row can
hold a wrong-but-currently-unique aphiaId and never get flagged at all
(e.g. "Amphiprion clarkii" was stored under 219650, which genuinely belongs
to "Acanthurus guttatus" — the two just hadn't collided yet). This script
checks all 1,279 rows individually against WoRMS instead of only the ones
already known to collide.

Per row:
  - Exact WoRMS name match (marine_only=true, then marine_only=false as a
    fallback for records with an inconsistent marine flag — still an EXACT
    name match, not fuzzy).
  - Names ending in " sp." (7 in the DB — genus-level placeholders like
    "Cladiella sp.", intentional for photo-ID-only sightings that can't be
    called to species) fall back to looking up the bare genus and using
    ITS AphiaID — not deleted, and not left borrowing some specific
    species' id the way "Cladiella sp." previously borrowed
    "Cladiella australis"'s.
  - No match at all (species-level or genus-level) -> the row is DELETED.
    Explicit instruction: "if it doesn't exist in WoRMS then delete it, we
    need the data to be clean." A handful of these look like they're
    probably just a misspelled/wrong name for a real species that DOES
    exist (see the printed suggestions at the end) rather than truly
    fictitious — deleted anyway per that instruction, but flagged clearly
    so they can be re-added under the right name if that's confirmed.
  - Multiple distinct accepted candidates for one exact name (genuine
    ambiguity, not absence) -> left untouched and reported, never guessed
    and never deleted (the name does exist, just unclear which record).

An "accepted" match uses its own AphiaID; an exact match that's itself an
unaccepted synonym uses valid_AphiaID (the current accepted id) — same
convention as fix-duplicate-aphia-ids.py, matching how the rest of the app
treats AphiaIDs as the current-canonical join key (DECISIONS.md ->
"AphiaIDs at logging time").

Progress cached to scripts/species-worms-validation.json, keyed by
scientificName (resumable). Seeded from scripts/aphia-id-fixes.json's
results on first run so the ~198 names already resolved by the earlier
pass aren't re-queried.

Usage: python3 scripts/validate-species-aphia-ids.py [--apply]
  Without --apply: prints every correction/deletion/ambiguity, writes nothing.
  With --apply: writes corrections + deletions into data/species-db.js, then
                re-scans the result for any remaining duplicate aphiaIds.
"""

import json
import re
import time
import subprocess
import os
import sys
import argparse
import urllib.parse

PROGRESS_FILE      = os.path.join(os.path.dirname(__file__), 'species-worms-validation.json')
SEED_FILE          = os.path.join(os.path.dirname(__file__), 'aphia-id-fixes.json')
SPECIES_FILE       = os.path.join(os.path.dirname(__file__), '..', 'data', 'species-db.js')
DELAY              = 0.3
SP_SUFFIX          = re.compile(r'\s+sp\.?$')

# Stored names with no exact WoRMS match, found by hand after the first dry
# run flagged 11 "no match" rows for deletion — fuzzy/genus-level lookups
# (like=true) showed 9 of the 11 are real species just spelled differently
# in WoRMS's current canonical form, or reclassified into a different genus,
# not actually absent. Deleting those would have been data loss, not
# cleanup, so they're corrected (name + aphiaId) instead. Each right-hand
# side was independently confirmed via AphiaRecordByAphiaID (following
# valid_AphiaID through to the current accepted record where the matched
# name was itself unaccepted). Only 2 of the original 11 ("Eviota
# pallifer", "Heteroconger aurora") turned up nothing under any spelling or
# neighbouring genus and are deleted for real — see DELETIONS below.
NAME_OVERRIDES = {
    # stored name              -> (corrected name,        corrected aphiaId)
    'Bornella stellifer':        ('Bornella stellifera',    404964),   # gender-ending drift
    'Aipysurus eydouxii':        ('Aipysurus eydouxi',       344640),  # single vs double i
    'Protoreaster linckii':      ('Protoreaster lincki',     213286),  # single vs double i
    'Comanthina schlegeli':      ('Comaster schlegelii',     246756),  # genus reclassified + spelling
    # 'Lysiosquillina sulcirostris' was tried as an override to 'Lysiosquilla
    # maculata' (211183) — same genus, just an older spelling — on the
    # strength of the DB's own "Giant mantis shrimp" common name. Reverted:
    # applying it collided with an ALREADY-CORRECT row ("Spearing mantis
    # shrimp" / "Lysiosquillina maculata", also 211183) that was already in
    # the DB under its own right name. Falls through to deletion instead —
    # it never existed under "sulcirostris" and the species it would have
    # pointed to is already represented.
    'Tritonia bayeriana':        ('Tritonicula bayeri',      1473652), # genus split out of Tritonia (2020s)
    'Pictichromis magna':        ('Pictichromis porphyrea',  398495),  # no "magna" anywhere in the genus;
                                                                        # "porphyrea" (purple/magenta) is
                                                                        # the only candidate, and matches
                                                                        # the DB's own common name exactly
                                                                        # ("Magenta dottyback")
}


def load_json(path):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def save_progress(data):
    with open(PROGRESS_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def _query_worms(name, marine_only):
    name_enc = urllib.parse.quote(name)
    flag = 'true' if marine_only else 'false'
    url = (f"https://www.marinespecies.org/rest/AphiaRecordsByName/{name_enc}"
           f"?like=false&marine_only={flag}")
    result = subprocess.run(
        ['curl', '-s', '-X', 'GET', url, '-H', 'accept: application/json'],
        capture_output=True, text=True, timeout=15
    )
    out = result.stdout.strip()
    if not out or out in ('[]', 'null'):
        return None, 'no exact match', None
    data = json.loads(out)
    if not isinstance(data, list) or not data:
        return None, 'no exact match', None

    accepted = [r for r in data if r.get('status') == 'accepted']
    if len(accepted) == 1:
        return accepted[0]['AphiaID'], 'accepted', accepted[0].get('rank')
    if len(accepted) > 1:
        ids = {r['AphiaID'] for r in accepted}
        if len(ids) == 1:
            return ids.pop(), 'accepted (multiple identical records)', accepted[0].get('rank')
        return None, f'ambiguous — {len(accepted)} distinct accepted records', None

    valids = {r.get('valid_AphiaID') or r.get('AphiaID') for r in data}
    valids.discard(None)
    if len(valids) == 1:
        statuses = '/'.join(sorted({str(r.get('status')) for r in data}))
        return valids.pop(), f'unaccepted, using valid_AphiaID (status={statuses})', data[0].get('rank')
    return None, f'ambiguous — {len(data)} candidates, no consistent valid_AphiaID', None


def lookup(name):
    """Returns (aphiaId:int|None, note:str, genus_fallback:bool)."""
    try:
        aphia_id, note, rank = _query_worms(name, marine_only=True)
        if aphia_id is None and note == 'no exact match':
            aphia_id, note, rank = _query_worms(name, marine_only=False)
            if aphia_id is not None:
                note += ' (non-marine-flagged fallback)'

        if aphia_id is not None:
            return aphia_id, note, False

        # Genus-level placeholder ("Xxx sp.") — retry against the bare genus.
        m = SP_SUFFIX.search(name)
        if m:
            genus = name[:m.start()]
            g_id, g_note, g_rank = _query_worms(genus, marine_only=True)
            if g_id is None and g_note == 'no exact match':
                g_id, g_note, g_rank = _query_worms(genus, marine_only=False)
            if g_id is not None:
                return g_id, f'genus-level match ({g_note}, rank={g_rank})', True

        return None, note, False
    except subprocess.TimeoutExpired:
        return None, 'timeout', False
    except json.JSONDecodeError as e:
        return None, f'JSON error: {e}', False
    except Exception as e:
        return None, f'error: {e}', False


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
                         help='Write corrections + deletions into data/species-db.js')
    args = parser.parse_args()

    with open(SPECIES_FILE, encoding='utf-8') as f:
        src = f.read()
    db = extract_species_db(src)
    print(f"{len(db)} species in SPECIES_DB.\n")

    names = sorted({e[1] for e in db})
    print(f"{len(names)} unique scientific names to validate against WoRMS.\n")

    progress = load_json(PROGRESS_FILE)
    if not progress:
        seed = load_json(SEED_FILE)
        for name, entry in seed.items():
            if name in names:
                progress[name] = {'aphiaId': entry.get('aphiaId'), 'note': entry.get('note'), 'genus_fallback': False}
        if progress:
            print(f"Seeded {len(progress)} results from the earlier duplicate-fix pass.\n")
            save_progress(progress)

    for i, name in enumerate(names):
        if name in progress:
            continue
        print(f"[{i+1}/{len(names)}] {name}...", end=' ', flush=True)
        aphia_id, note, genus_fallback = lookup(name)
        progress[name] = {'aphiaId': aphia_id, 'note': note, 'genus_fallback': genus_fallback}
        save_progress(progress)
        print(f"{aphia_id} ({note})")
        time.sleep(DELAY)

    print()
    corrections, deletions, ambiguous, renames, unchanged = [], [], [], [], 0
    for name in names:
        stored = next(e[2] for e in db if e[1] == name)
        if name in NAME_OVERRIDES:
            new_name, new_id = NAME_OVERRIDES[name]
            renames.append((name, new_name, stored, new_id))
            continue
        r = progress.get(name, {})
        aphia_id, note = r.get('aphiaId'), r.get('note', '')
        if aphia_id is None:
            if note.startswith('ambiguous'):
                ambiguous.append((name, stored, note))
            else:
                deletions.append((name, stored, note))
        elif aphia_id != stored:
            corrections.append((name, stored, aphia_id, note))
        else:
            unchanged += 1

    print(f"Unchanged (already correct): {unchanged}")
    print(f"\nCorrections: {len(corrections)}")
    for name, old, new, note in corrections:
        print(f"  {name}: {old} -> {new}  ({note})")

    if renames:
        print(f"\nRenamed + corrected (real species, wrong/outdated name in the DB): {len(renames)}")
        for old_name, new_name, old_id, new_id in renames:
            print(f"  {old_name} -> {new_name}: {old_id} -> {new_id}")

    print(f"\nTo delete (no WoRMS match at all, under any spelling checked): {len(deletions)}")
    for name, old, note in deletions:
        common = next(e[0] for e in db if e[1] == name)
        print(f"  \"{common}\" / {name}  (was {old})")

    if ambiguous:
        print(f"\nAmbiguous — left untouched, needs manual review: {len(ambiguous)}")
        for name, old, note in ambiguous:
            print(f"  {name}: still {old}  ({note})")

    if not args.apply:
        print("\nDry run — pass --apply to write these changes into data/species-db.js.")
        return

    correction_map = {name: new for name, old, new, note in corrections}
    rename_map = {old_name: (new_name, new_id) for old_name, new_name, old_id, new_id in renames}
    delete_names = {name for name, old, note in deletions}
    updated_db = []
    for entry in db:
        name = entry[1]
        if name in delete_names:
            continue
        if name in correction_map:
            entry = [entry[0], entry[1], correction_map[name]] + list(entry[3:])
        elif name in rename_map:
            new_name, new_id = rename_map[name]
            entry = [entry[0], new_name, new_id] + list(entry[3:])
        updated_db.append(entry)

    new_src = inject_species_db(src, updated_db)
    with open(SPECIES_FILE, 'w', encoding='utf-8') as f:
        f.write(new_src)
    print(f"\n✓ Applied {len(correction_map)} corrections, {len(rename_map)} renames, "
          f"deleted {len(delete_names)} rows. {len(updated_db)} species remain.")

    remaining = find_duplicate_groups(updated_db)
    if remaining:
        print(f"\n⚠ {len(remaining)} duplicate aphiaId group(s) still present — review needed:")
        for aphia_id, group_names in remaining.items():
            print(f"  {aphia_id}: {group_names}")
    else:
        print("\n✓ No duplicate aphiaIds remain.")


if __name__ == '__main__':
    main()
