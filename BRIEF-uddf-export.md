# Brief — UDDF export (and the interoperability gap)

**Self-contained implementation brief.** Read end-to-end before touching code.
Also read: `js/profile.js` (the UDDF *parser* — this feature is its inverse and
must stay in sync with it), `CLAUDE.md` → "Known constraints", and
`DECISIONS.md` before changing anything that looks wrong.

Deliberately unversioned — slot it into a version number when it ships.

---

## 1. The job to be done

Shoal's positioning rests on a data-ownership pillar ("if Shoal ever
disappears, your dives don't"). That claim is currently **true for humans and
false for software**: dives are plain markdown files anyone can *read*, but no
other dive app can *ingest* them.

The sharpest form of the problem, confirmed against the code:

> **Shoal reads UDDF but cannot write it.** `parseUddf()` exists in
> `js/profile.js`; there is no writer anywhere in the codebase. The only
> exports are markdown (`exportAllDives`, `downloadMd`) and a species-only CSV
> (`exportUnvalidatedSpecies`).

So the app takes data in via the industry standard and won't give it back in
the same currency. This brief closes that asymmetry.

**What this is not:** a migration away from markdown. Markdown stays the
archival master — it is human-readable (the literal substance of the
permanence pillar), Obsidian-native, diffable, and holds a **superset** of
what UDDF can represent (species records and journal entries have no UDDF
equivalent). UDDF is the *interchange* format, exported on demand. The mental
model is RAW vs JPEG: nobody calls RAW lock-in, because JPEG export exists.

---

## 2. Hard scope boundaries

**In scope:**
- A UDDF 3.2 writer producing a valid document from Shoal's dive objects.
- Export-all-dives to a single `.uddf` file, from Settings & data.
- Profile waypoints + deco/safety events pulled from `.profile.json` sidecars.
- Gas definitions, tank data, dive sites (GPS), buddies.
- Three-backend file output (shell / Safari-Brave / Chrome-Edge), per §5.

**Out of scope — do not build:**
- ❌ Any change to how dives are *stored*. Markdown remains the source of truth.
- ❌ UDDF *import* changes — `parseUddf` already exists and works; don't touch
  it beyond reading it for reference.
- ❌ Darwin Core / OBIS export (separate roadmap item, different job — that's
  the interchange format for the *sightings*, not the dive log).
- ❌ CSV export (worth doing, but a separate trivial task — see §8 Phase 3).
- ❌ Subsurface-native `.ssrf` or DAN DL7 formats.

---

## 3. The inverse-unit contract — the single highest-risk area

Every unit below is a **documented fact read out of `parseUddf`**, not an
assumption. The writer must invert each one exactly. Getting one wrong
produces a file that imports silently and wrongly — the worst failure mode,
because a dive log with a plausible-but-false depth or gas is more dangerous
than one that fails loudly.

| Field | UDDF unit | Shoal unit | Export conversion |
|---|---|---|---|
| `<depth>` | metres | metres | direct |
| `<divetime>` (waypoint) | seconds | seconds (`waypoint.t`) | direct |
| `<diveduration>` | seconds | **minutes** (`d.time`) | `× 60` |
| `<greatestdepth>` | metres | metres (`d.depth`) | direct |
| `<temperature>` | **Kelvin** | °C | `+ 273.15` |
| `<tankvolume>` | **m³** | litres (`d.tanksize`) | `÷ 1000` |
| `<tankpressurebegin>` / `<tankpressureend>` | **Pascals** | bar (`d.pstart`/`d.pend`) | `× 100000` |
| `<nodecotime>` | **seconds** | minutes (`waypoint.ndl`) | `× 60` |
| `<o2>` / `<he>` | **fraction** (0.32) | label string | see §4 |

Cross-check each against `_parseOneDive`, `_resolveWaypointTemp`, and
`_parseGasLookup` in `js/profile.js` while implementing.

**Write strict, read loose.** Our parser is deliberately tolerant
(namespace-agnostic, handles flattened `<divesite>` variants). Other apps'
parsers may be far stricter, so the *writer* must emit the most conventional,
spec-conformant structure possible. Don't rely on our own leniency as
evidence the output is good.

---

## 4. The gas round-trip problem — a real, unavoidable loss

`_gasMixLabel()` (js/profile.js) collapses `o2`/`he` fractions into Shoal's
fixed vocabulary: `Air` | `Nitrox NN` | `Trimix` | `Other`. Shoal stores only
that **label** — the original fractions are gone. Inverting it:

| Stored label | Reconstructable? | Export |
|---|---|---|
| `Air` | ✅ | `o2 = 0.21` |
| `Nitrox 32` (etc.) | ✅ | parse the integer → `o2 = 0.32` |
| `Trimix` | ❌ | o2/he genuinely unknown |
| `Other` | ❌ | genuinely unknown |
| empty | ❌ | no gas logged |

**Decision: never guess.** For unreconstructable mixes, omit the
`<gasdefinitions>` entry and the dive's gas link entirely rather than emitting
a plausible-looking default. This follows the parser's own established
philosophy (`_parseUddfDate` returns `null` rather than a guess; `_parseSiteLookup`
refuses to attach a site when two are ambiguous). A missing gas is a visible
gap; a wrong gas is a silent falsehood in a safety-adjacent record.

Surface this honestly in the export summary: *"3 dives exported without gas
mix (Trimix/Other can't be represented exactly)."*

---

## 5. Architecture

**New file: `js/uddf-export.js`.**
- Must load **after** `js/profile.js` — it reads the `_profiles` Map
  (`Map<diveUid → profile>`) for waypoints/events.
- Add to `index.html`'s `<script src>` list, **and** to `sw.js`'s
  `SHELL_CRITICAL` array, **and bump the cache version** (CLAUDE.md → "Adding
  a new JS file"). Missing the SW step means the file never reaches an
  installed PWA.
- Put a cross-reference comment at the top of both `uddf-export.js` and
  `profile.js`'s parser section: they are inverses and must change together.
  *(Judgment call: the writer could equally live inside `profile.js` to keep
  inverses adjacent. Recommended separate because `profile.js` is already
  ~1,500 lines and mixes import, matching, sidecar I/O and chart rendering.
  Flip it if you disagree — just keep the cross-references.)*

**Document structure** (mirroring what the parser expects):

```
<uddf version="3.2.0">
  <generator><name>Shoal</name><version>…</version></generator>
  <diver>
    <buddy id="…"><personal><firstname>…</firstname></personal></buddy>
  </diver>
  <divesite>
    <site id="…"><name>…</name>
      <geography><latitude>…</latitude><longitude>…</longitude></geography>
    </site>
  </divesite>
  <gasdefinitions><mix id="…"><o2>0.32</o2><he>0</he></mix></gasdefinitions>
  <profiledata>
    <repetitiongroup>
      <dive>
        <informationbeforedive>
          <datetime>…</datetime><divenumber>…</divenumber>
          <link ref="site-id"/><link ref="buddy-id"/>
        </informationbeforedive>
        <tankdata>
          <link ref="mix-id"/><tankvolume>0.012</tankvolume>
          <tankpressurebegin>20000000</tankpressurebegin>
          <tankpressureend>5000000</tankpressureend>
        </tankdata>
        <samples>
          <waypoint><divetime>…</divetime><depth>…</depth>
            <temperature>…</temperature><nodecotime>…</nodecotime>
            <decostop kind="safety" decodepth="5" duration="180"/>
          </waypoint>
        </samples>
        <informationafterdive>
          <greatestdepth>…</greatestdepth><diveduration>…</diveduration>
          <notes><para>…</para></notes>
        </informationafterdive>
      </dive>
    </repetitiongroup>
  </profiledata>
</uddf>
```

**XML escaping is mandatory and security-relevant.** Every free-text field
(site, buddy, trip, notes, species names) must escape `& < > " '`. This is the
same class of bug as the YAML-injection guard in `generateFrontmatter`
(security review F4 — a newline in a free-text field could break out of the
scalar). An unescaped `&` in a site name produces a corrupt file that fails to
parse anywhere. Write one `xmlEsc()` helper and route every interpolation
through it.

**File output — three backends, no shortcuts.** `downloadBlob()`'s
`<a download>` + blob-URL trick **silently no-ops in WKWebView** (the Tauri
shell) — it reports success and produces no file. Mirror
`exportUnvalidatedSpecies` (js/species.js) exactly:
1. `isShell()` → `invoke('save_file_dialog', {title, defaultName})` then
   `invoke('write_text_file', {path, content})`.
2. Otherwise → `shareOrDownload(filename, blob)` (handles the iOS share-sheet
   path and falls through to `downloadBlob`).

Filename: `shoal-dives-YYYY-MM-DD.uddf`.

---

## 6. What UDDF can and cannot carry

| Shoal data | UDDF home | Fidelity |
|---|---|---|
| date/time, dive number, max depth, duration | native | ✅ full |
| profile waypoints, temperature, NDL | native | ✅ full |
| safety/deco stops | `<decostop>` | ✅ full |
| tank size, start/end pressure | `<tankdata>` | ✅ full |
| gas mix | `<gasdefinitions>` | ⚠️ §4 — Air/Nitrox only |
| site name + GPS | `<divesite>` | ✅ full |
| buddy | `<diver><buddy>` | ✅ name only |
| journal notes | `<notes><para>` | ⚠️ verify placement (§9) |
| **species sightings** (name only — see below) | **none** | ❌ degrade to text |
| footage clips | none | ❌ dropped |
| trip label, vis, current, weather, suit, weight | uncertain | ⚠️ verify (§9) |

**Species are the important loss and must be handled deliberately.** UDDF has
no structured concept of a species sighting. Rather than drop them silently,
serialise them into the `<notes>` block as a plain list of **common names
only**:

```
Marine life: Conger eel, Common lobster, Curled octopus
```

**Deliberately exclude everything else on a sighting** — scientific name,
AphiaID, IUCN status, R/O/C abundance, `customId`, `validated`. Those are
Shoal-specific enrichment that no other dive app tracks or has any use for;
writing them into a plain-text notes field wouldn't restore any
interoperability, it would just be noise borrowed from a format that has
nowhere to put it. The rule for this whole fallback block, not just species:
**only include what another app's own data model already has a concept of.**
A common name is recognisable to a human reading the file in Subsurface; an
AphiaID is not.

Nothing is lost to a *person* reading the file in another app; only the
structured queryability is. Say so plainly in the export UI — a one-line note
that species and footage links live in the markdown files, and UDDF is for
dive-profile interchange. **Do not let the UI imply UDDF is a complete
backup** — `exportAllDives` (markdown) remains the lossless one.

---

## 7. UI

Settings & data, directly beneath the existing "Export all dives" control:

- Button: **"Export as UDDF"**, with a one-line explainer — *"The dive-log
  standard. Imports into Subsurface, MacDive and most dive software. Species
  and footage links stay in your markdown files."*
- A status line mirroring the existing export status elements (`✓ N dives →
  filename.uddf`), including the gas-omission count from §4 when non-zero.

---

## 8. Phases

**Phase 1 — the writer + all-dives export.** Scalars, gas, tanks, sites,
waypoints/events, three-backend output, Settings UI. This is the bulk of the
work and is independently shippable: it's the phase that makes the
interoperability claim true.

**Phase 2 — enrichment.** Notes/species text block, buddy definitions, and a
per-dive "Export as UDDF" from the dive file's ⋯ menu.

**Phase 3 — CSV export (separate, trivial).** One row per dive, plus optionally
one per sighting. ~50 lines following `exportUnvalidatedSpecies`'s pattern.
Different audience from UDDF (spreadsheets and personal analysis, not app
migration) and disproportionately reassuring to non-technical users, who
recognise "CSV" and won't recognise "UDDF".

---

## 9. Open questions — resolve against the UDDF 3.2 spec before/while building

These are genuine unknowns, not rhetorical. Check the spec (uddf.org /
streit.cc mirror) rather than guessing — the parser was written from the spec
directly, and the writer deserves the same rigour.

1. **Exact legal placement of `<notes>`** — assumed `<informationafterdive>`
   above; confirm.
2. **Do visibility / current / weather / suit / weight have UDDF homes?** If
   yes, use them; if no, they join the notes block.
3. **One `<repetitiongroup>` for everything, or one per day?** Repetition
   groups semantically mean a same-day repetitive series. Grouping by date is
   more correct; a single group is simpler and widely accepted. Decide and
   document.
4. **Buddy `<link>` refs** — the parser notes that `<link>` inside
   `<informationbeforedive>` carries *both* site and buddy references, resolved
   by ID lookup rather than position. Confirm real-world importers handle a
   buddy link cleanly alongside a site link.
5. **Version attribute** — `3.2.0` vs `3.2`; check what real importers expect.

---

## 10. Verification

**The round-trip test is the headline, and it's nearly free.** Both halves of
the conversion live in this codebase:

1. Export a set of dives to UDDF.
2. Feed the output straight back through the existing `parseUddf()`.
3. Assert the parsed result matches the source dives — depth, duration,
   temperature, gas, tank, GPS, and every waypoint.

This catches every unit-inversion error in §3 automatically. Build it as a
standalone Node script alongside the existing test harnesses in
`scripts/libdivecomputer-wasm-spike/` (which set the precedent for
`run-*-test.mjs` files run outside a browser).

**But a passing round-trip is not sufficient.** It only proves we agree with
ourselves — and our parser is deliberately lenient. The actual claim being
made is *"this works with other apps,"* so it must be tested against a real
other app:

- Import the output into **Subsurface** (free, cross-platform) and confirm the
  dives appear with correct depth, duration, date, gas and profile curve.
- Ideally also one other (MacDive or Submersion) to avoid over-fitting to one
  importer's tolerances.

Plus the standard repo checks: JSC syntax check on the new file, and a manual
pass in a real browser (and the Tauri shell — the shell path is exactly where
`downloadBlob` fails silently, so it must be exercised, not assumed).

---

## 11. Positioning note (why this matters beyond the feature)

Until this ships, avoid interoperability claims in any copy — "works with your
other tools", "take it anywhere", or leaning hard on "no lock-in". They're
currently pokeable, and the brand's advantage is not overclaiming.

Once it ships, Pillar 4 gets materially stronger: *your dives are plain files
you can read yourself, and export to the dive-industry standard whenever you
want.* That is the complete answer to the "what if this one-dev app
disappears?" objection — which `research/positioning-strategy.md` already
identifies as an opportunity rather than a risk.

Worth remembering the mirror image: **import matters more commercially than
export.** Export-to-competitors is a trust lever; import-from-competitors is a
growth lever (how a diver with 300 dives in Subsurface switches *to* Shoal).
That path already exists via `parseUddf` + the bulk-add flow — it deserves to
be more prominent than it currently is, which is a separate, cheap piece of work.
