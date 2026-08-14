#!/usr/bin/env python3
"""Generate THIRD-PARTY-NOTICES.txt — the attribution file shipped inside the app.

Run from the repo root:

    python3 scripts/gen-third-party-notices.py

Why this exists: distributing a binary (the .dmg) triggers attribution
obligations that just using the code locally does not. MIT, Apache-2.0 and
BSD all require reproducing the copyright notice and licence text "in the
documentation and/or other materials provided with the distribution"; OFL
requires its text to travel with the fonts; MPL-2.0 requires the covered
source to remain available. This file is how Shoal satisfies all of that in
one place.

Re-run it whenever `src-tauri/Cargo.toml`, the vendored libraries, or the
bundled fonts change — the crate list is derived from the real resolved
dependency graph, not maintained by hand, so it can't silently drift.

Deliberately NOT cargo-about: that needs a separate toolchain install and a
config file to say anything this script doesn't already get from
`cargo metadata` plus the registry's own licence files. If the licence story
ever gets more complicated than "list every crate and reproduce each distinct
licence once", switch to it rather than growing this.
"""

import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TARGET = "aarch64-apple-darwin"          # the only platform the .dmg ships for
OUT = REPO / "THIRD-PARTY-NOTICES.txt"


def cargo_metadata():
    out = subprocess.run(
        ["cargo", "metadata", "--format-version", "1",
         "--manifest-path", str(REPO / "src-tauri" / "Cargo.toml"),
         "--filter-platform", TARGET],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        # cargo isn't always on PATH in a non-login shell
        alt = Path.home() / ".cargo" / "bin" / "cargo"
        out = subprocess.run(
            [str(alt), "metadata", "--format-version", "1",
             "--manifest-path", str(REPO / "src-tauri" / "Cargo.toml"),
             "--filter-platform", TARGET],
            capture_output=True, text=True,
        )
    if out.returncode != 0:
        sys.exit("cargo metadata failed:\n" + out.stderr)
    return json.loads(out.stdout)


def shipping_crates(meta):
    """Every crate reachable from the root by normal or build deps.

    dev-dependencies are excluded on purpose: they're test/bench-time only and
    never end up in the shipped binary, so listing them would overstate what
    is actually being distributed.
    """
    pkgs = {p["id"]: p for p in meta["packages"]}
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
    root = meta["resolve"]["root"]

    seen, stack = set(), [root]
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        for dep in nodes.get(cur, {}).get("deps", []):
            kinds = {k.get("kind") for k in dep.get("dep_kinds", [{}])}
            if kinds & {None, "build"}:
                stack.append(dep["pkg"])
    seen.discard(root)
    return [pkgs[i] for i in sorted(seen, key=lambda i: pkgs[i]["name"].lower())]


def crate_src_dir(pkg):
    """Locate an unpacked crate in the registry cache, for its licence files."""
    for base in (Path.home() / ".cargo" / "registry" / "src").glob("*"):
        cand = base / f"{pkg['name']}-{pkg['version']}"
        if cand.is_dir():
            return cand
    return None


LICENCE_FILE = re.compile(r"^(LICENSE|LICENCE|COPYING|NOTICE)", re.I)


def licence_texts(pkg):
    """Return {filename: text} for every licence file the crate ships."""
    d = crate_src_dir(pkg)
    if not d:
        return {}
    found = {}
    for f in sorted(d.iterdir()):
        if f.is_file() and LICENCE_FILE.match(f.name):
            try:
                found[f.name] = f.read_text(encoding="utf-8", errors="replace")
            except OSError:
                pass
    return found


def copyright_lines(text):
    """Pull the Copyright line(s) out of a licence file — the part that is
    genuinely per-crate, as opposed to the boilerplate terms."""
    out = []
    for line in text.splitlines():
        s = line.strip()
        if s.lower().startswith("copyright") and len(s) > 12:
            if s not in out:
                out.append(s)
        if len(out) >= 3:
            break
    return out


def rule(title):
    return f"\n\n{'=' * 78}\n{title}\n{'=' * 78}\n"


def main():
    meta = cargo_metadata()
    crates = shipping_crates(meta)

    # Group crates by SPDX expression, and collect one canonical copy of each
    # distinct licence text (keyed by filename, e.g. LICENSE-MIT) so the file
    # reproduces each set of terms once rather than 360 times.
    by_licence = defaultdict(list)
    canonical = {}
    for p in crates:
        spdx = p.get("license") or "(no SPDX field — see repository)"
        texts = licence_texts(p)
        cr = []
        for name, text in texts.items():
            cr += copyright_lines(text)
            key = name.upper().replace(".TXT", "").replace(".MD", "")
            if key not in canonical and len(text) > 200:
                canonical[key] = (text.strip(), f"{p['name']} {p['version']}")
        by_licence[spdx].append({
            "name": p["name"],
            "version": p["version"],
            "repo": p.get("repository") or "",
            "copyright": cr[:2],
        })

    L = []
    L.append("THIRD-PARTY NOTICES — Shoal")
    L.append("")
    L.append("Shoal bundles the third-party software listed below. Each item is")
    L.append("reproduced under its own licence; those licences are set out in full")
    L.append("further down this file. Nothing here changes your rights to Shoal")
    L.append("itself.")
    L.append("")
    L.append("Generated by scripts/gen-third-party-notices.py — do not edit by hand.")

    # ---- Vendored web libraries -------------------------------------------
    L.append(rule("1. VENDORED LIBRARIES (bundled in the app)"))
    L.append("""
libdivecomputer 0.9.0 — LGPL-2.1-or-later
  Dive-computer protocol engine, compiled to WebAssembly.
  https://github.com/libdivecomputer/libdivecomputer
  Full licence: vendor/libdivecomputer-wasm/LICENSE (shipped with the app).
  Loaded as a separate, replaceable .wasm module — the dynamic-linking
  analogue for a browser runtime. Nothing is statically linked into Shoal.
  Build recipe (the source offer): scripts/libdivecomputer-wasm-spike/build.sh

scuba-physics — MIT
  Buhlmann ZHL-16C decompression engine, from jirkapok/GasPlanner.
  https://github.com/jirkapok/GasPlanner
  Full licence: vendor/scuba-physics/LICENSE (shipped with the app).
  Bundles lodash (also MIT, https://github.com/lodash/lodash).

Leaflet 1.9.4 — BSD-2-Clause
  Interactive maps. https://leafletjs.com
  Full licence: vendor/leaflet/LICENSE (shipped with the app).
""".strip())

    # ---- Fonts -------------------------------------------------------------
    L.append(rule("2. FONTS (bundled in the app)"))
    L.append("""
All bundled typefaces are licensed under the SIL Open Font License v1.1.
The full OFL text is in fonts/LICENSE-OFL.txt, shipped with the app.

  Figtree      Copyright 2022 The Figtree Project Authors
               https://github.com/erikdkennedy/figtree
  Literata     Copyright 2017 The Literata Project Authors
               https://github.com/googlefonts/literata
  Young Serif  Copyright 2023 The Young Serif Project Authors
               https://github.com/noirblancrouge/YoungSerif
""".strip())

    # ---- Map data ----------------------------------------------------------
    L.append(rule("3. MAP DATA"))
    L.append("""
Map tiles and geocoding results come from OpenStreetMap, fetched at runtime
rather than bundled. Map data is (c) OpenStreetMap contributors, available
under the Open Database Licence (ODbL).
  https://www.openstreetmap.org/copyright

Species reference photographs are served at runtime from iNaturalist's
open-data bucket, which mirrors Creative Commons-licensed photographs only.
  https://www.inaturalist.org
""".strip())

    # ---- Rust crates -------------------------------------------------------
    L.append(rule(f"4. RUST CRATES ({len(crates)} packages)"))
    L.append(
        "Every crate compiled into the desktop application, grouped by licence.\n"
        "Build-time and normal dependencies are included; dev-dependencies are\n"
        "not, as they never form part of the shipped binary."
    )
    for spdx in sorted(by_licence, key=lambda s: (-len(by_licence[s]), s)):
        items = by_licence[spdx]
        L.append(f"\n\n--- {spdx}  ({len(items)} packages) " + "-" * max(0, 40 - len(spdx)))
        for it in items:
            line = f"\n  {it['name']} {it['version']}"
            if it["repo"]:
                line += f"\n      {it['repo']}"
            for c in it["copyright"]:
                line += f"\n      {c}"
            L.append(line)

    mpl = [i for s, v in by_licence.items() if "MPL" in s for i in v]
    if mpl:
        L.append(rule("4a. MPL-2.0 SOURCE AVAILABILITY"))
        L.append(
            "MPL-2.0 requires that the source of the covered files remains\n"
            "available. These crates are used unmodified at the exact versions\n"
            "listed; their upstream source is published at the URLs above and\n"
            "on crates.io:\n"
        )
        for i in mpl:
            L.append(f"  https://crates.io/crates/{i['name']}/{i['version']}")

    # ---- Full licence texts -----------------------------------------------
    # The vendored/font licences are inlined here as well as shipped as their
    # own files. The files alone satisfy the licences, but they live INSIDE
    # the .app bundle, which a normal macOS user cannot open — so the in-app
    # viewer has to be self-contained or it isn't really readable at all.
    L.append(rule("5. FULL LICENCE TEXTS — BUNDLED LIBRARIES AND FONTS"))
    for label, rel in [
        ("Leaflet — BSD-2-Clause", "vendor/leaflet/LICENSE"),
        ("libdivecomputer — LGPL-2.1-or-later", "vendor/libdivecomputer-wasm/LICENSE"),
        ("scuba-physics — MIT", "vendor/scuba-physics/LICENSE"),
        ("Bundled fonts — SIL Open Font License 1.1", "fonts/LICENSE-OFL.txt"),
    ]:
        p = REPO / rel
        if p.is_file():
            L.append(f"\n\n{'-' * 78}\n{label}\n({rel})\n{'-' * 78}\n")
            L.append(p.read_text(encoding="utf-8", errors="replace").strip())
        else:
            L.append(f"\n\n[MISSING: {rel} — run the generator from the repo root]")

    L.append(rule("6. FULL LICENCE TEXTS — RUST CRATES"))
    L.append(
        "Each distinct licence below is reproduced once. The sample is taken\n"
        "verbatim from one of the packages that ships it; the terms are the\n"
        "same for every package listed under that licence above, with the\n"
        "copyright holders as listed per-package in section 4."
    )
    for key in sorted(canonical):
        text, src = canonical[key]
        L.append(f"\n\n{'-' * 78}\n{key}   (text as shipped by {src})\n{'-' * 78}\n")
        L.append(text)

    OUT.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(REPO)}")
    print(f"  {len(crates)} Rust crates, {len(by_licence)} distinct SPDX expressions")
    print(f"  {len(canonical)} full licence texts reproduced")
    if mpl:
        print(f"  {len(mpl)} MPL-2.0 crates flagged for source availability")


if __name__ == "__main__":
    main()
