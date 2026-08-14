# Brief — Log capture form redesign (mobile-first) · for Claude Design

> **Status: design brief, parked/unversioned.** For a **Claude Design** session to
> redesign and optimise the dive **log capture form**. **Primary objective:
> integrate drop-a-pin-on-a-map GPS capture.** Secondary: optimise the form for
> mobile (the main logging surface) — denser, faster, more visual — without losing
> any BSAC field. Grounded in the diagnosis in §4. Implementation is a later
> session; this is a design exploration → mockups.

---

## 1. What the app is

**Dive Log** — a personal BSAC-format scuba dive-logging web app (PWA), offline-first,
no backend. The target user is a marine-life-curious recreational diver ("Maya")
who wants the app to feel like **a journal, not a cockpit**. **Mobile (Android
Chrome) is the primary logging surface** — people log on a phone, often on a boat,
wet and tired — so mobile ergonomics dominate. Desktop must still work but is
secondary for this form.

## 2. Design system (stay on-brand)

- Palette: Driftwood `#F5EBD8` (app bg), Warm White `#FAF6F1` (cards/inputs),
  Surface-2 `#EDE5D8` (recessed), Deep Water `#1C3030` (text + sidebar), Warm Taupe
  `#8B7B6A` (muted), Text-dim `#B5A898` (tertiary), accent Dusty Cerulean `#4A90B8`.
  Hairlines `rgba(28,48,48,0.10)`.
- Type: exactly three sizes — 12px (mono labels/meta), 14px (secondary), 16px
  (body/inputs). Mono for labels; system sans for UI; serif (Georgia) for the
  *journal voice* only.
- A categorical **dive-type colour ramp** already exists and is used across History
  (Boat/Shore/Drift/Night/Cave/Wreck/Reef/Wall/Pinnacle/Muck each have a colour) —
  reuse it for any dive-type control.
- Feel: flat, warm, paper-like, calm. No gradients/heavy shadows.

## 3. The surface: the current form

A **7-section exclusive accordion** (one section open at a time; each collapsed
section shows a 3-state summary chip: empty / partial / ✓). Opens with **Dive** and
**Marine life** expanded. Current sections and control types:

| Section | Fields (current control) |
|---|---|
| **Dive** | Date (date) · Dive # (number, auto) · Trip (text+autocomplete) · Country (**select, ~140 options**) · Region (text+AC) · Site (text + Dive Vibe/OSM search) · **GPS (button + two manual lat/lng number inputs)** · Dive type (**select, 10 options**) |
| **Conditions** | Visibility (number) · Water temp (number) · Current (**select, 4**) · Water type (**select, 3**) · Weather (**free text**) |
| **Dive profile** | Time (number) · Max depth (number) · Avg depth (number) · Entry time (time) · Exit time (time, auto) · Safety + Deco stops (number pairs, safety pre-filled 5 m/3 min) |
| **Gas & equipment** | Start bar (number) · End bar (number) · Gas mix (select, 10) · Tank type (**select, 2**) · Tank size (number+AC) · Suit (text+AC) · Weight (number+AC) |
| **Marine life** | species search + sighting cards + IUCN/abundance legend (works well — leave it) |
| **Journal** | Headline (text, 50 max) · Memories (autogrow textarea, serif) — newly added (notes-as-journal); keep as-is |
| **Buddy & sign-off** | Liveaboard (text+AC) · Buddy (text+AC) · Instructor (text+AC) · Cert number (text) |

## 4. Diagnosis — what's wrong on mobile

1. **Systemic space waste.** At ≤600px a hard rule (`.grid-2, .grid-3 { 1fr
   !important }`) forces *every* field full-width, so 2–3 digit numerics (vis, temp,
   time, max/avg depth, start/end bar) each occupy a full 44px row → long scroll,
   poor density.
2. **Manual coordinate entry.** GPS = a button + two hand-typed lat/lng number
   fields. Typing six-decimal coordinates is error-prone and nobody does it reliably
   — the core problem this redesign exists to fix.
3. **Controls heavier than their cardinality.** Water type (3), Tank type (2),
   Current (4) are native dropdowns where inline choices would be faster. (Salt is
   the ~95% default.)
4. **Weather is unstructured free text** — inconsistent, skippable, unqueryable.
5. **Dive type is a flat 10-option dropdown** despite the app colour-coding dive
   types everywhere else.
6. **Location entered 3–4× over** (Country + Region + Site + GPS), all manual.
7. **Overall length** from single-column stacking + low in-section density.

## 5. Objectives

**Primary — map-pin GPS capture (the headline change):**
- Replace the "Use GPS" button + manual lat/lng inputs with a **tappable map** (Leaflet
  is already vendored — use it). Drop / drag a pin → fills the coordinates. Keep a
  "use my current location" shortcut for when you're at the site.
- **Reverse-geocode the pin** to *suggest* Country and Region (confirm-not-type), and
  tie into the existing Site search. This reshapes the Dive section's whole location
  block — design it as one coherent location+map unit, not a map bolted under fields.

**Secondary — optimise (easier + more visual):**
- **Density on mobile** — small numerics sit in compact multi-field rows even on
  phones (kill the blanket `1fr !important` for small fields); pair number + unit.
- **Match controls to cardinality** — segmented/radio for ≤4 options (Water type,
  Tank type, Current); a **colour-coded icon/chip grid** for Dive type (reuse the
  history colour ramp).
- **Weather as iconography → a controlled value** — a row of weather icons mapping to
  an enum (replaces the free text).
- **Cut redundant location entry** via the pin + reverse-geocode.
- **Net: shorter, faster, more visual**, with no loss of capability.

## 6. Constraints (fixed — design within these)

- **Keep the full BSAC field set.** This is a BSAC log; optimise *capture*, don't drop
  fields. Every current field stays in the data model.
- **All fields optional; save-partial must still work** — no forced completion, no
  required-field gating (deliberate: people log incomplete and return later).
- **Offline, vanilla JS, no build tools, no backend, CSP-safe.** Leaflet is vendored;
  no new heavy dependencies. Map tiles come from OSM (online) — design a sensible
  no-tiles/offline state for the map.
- **Mobile-first (≤600px is the priority); desktop must still work.**
- **Accordion is the current model** — you *may* rethink the overall structure, but
  respect why it exists: one-section focus suits a phone, the summary chips enable a
  pre-save scan, and it opens on Dive + Marine life. If you change it, justify it.
- **Data-model touchpoints:** only **Weather** changes type (free text → enum). The
  map-pin auto-fill writes the *existing* Country/Region/lat/lng fields. Everything
  else is UI-only.

## 7. Relationship to other briefs (keep consistent, don't redo)

- The **map pin** is the UI face of `BRIEF-dive-site-database.md` (its Phase A
  pin-drop). That brief owns the data side — coordinate sourcing, the personal-site
  registry / Tier-1 cache, reverse-geocoding, commercial-safe sources, and (Phase D)
  the consent/observation model. **Design the interaction here; the data plumbing
  lives there.** Don't contradict it.
- The **Journal** section is from `v2.72-BRIEF-notes-as-journal.md` and is already in
  the form. Fit it into the whole; don't redesign it.

## 8. Deliverable

2–3 redesign directions for the **mobile** log form (mockups), each showing: the new
location + map-pin block, the denser numeric layout, the cardinality-matched controls,
and the weather iconography — plus the desktop adaptation and a recommendation. Flag
any data-model implications (notably the weather enum). Stay on-brand (§2) and within
the constraints (§6).
