# Decisions Log

A record of deliberate choices and rejected alternatives. Read this before "fixing" anything that looks suboptimal — it probably isn't.

---

## Architecture decisions

### Single HTML file → folder structure migration
**Decision:** The app was built as a single HTML file for rapid iteration. It is now being migrated to a folder structure as part of moving to Claude Code and Cloudflare Pages deployment.

**Do not refactor the single-file version** — work from the migrated folder structure going forward.

**File has been renamed:** `dive-log.html` → `index.html` for Cloudflare Pages compatibility. All references should use `index.html`.

---

### Deployment is live
**Decision:** The app — named **Shoal** — is deployed via Cloudflare Pages from this repo.

**Two separate Pages projects, flipped 2026-07-30.** `app.diveshoal.com`
serves the PWA; `diveshoal.com` (root) serves the marketing/landing site
built from `landing/`. This is the reverse of the original, backwards
pairing. Each project has its own `_headers` and its own `robots.txt`
posture (app blocked from indexing, landing crawlable) — they share a repo,
not an origin, which is why the app's service worker never touches the
landing page.

**How updates work:** Edit files locally → commit → push → Cloudflare
auto-redeploys in ~30 seconds.

**Do not change the deployment setup** without good reason — it works, it's free, and it's simple.

---

### No server, no backend, no build tools
**Decision:** Browser-only. No Node server, no Python backend, no webpack/vite/parcel.

**Why:** Build within the local constraints and only when it truly becomes a wall do we consider further tools. 

**What this means practically:** All logic is vanilla JavaScript or must be bundleable without a build step. If a framework is introduced (React), it should be via CDN or a zero-config bundler, not a full npm project with 400 dependencies.

---
### No auto-sync on panel navigation
**Decision:** `syncFromObsidian()` is called on app load and manual trigger only. It is NOT called when navigating between panels.

**Why:** This caused a critical bug. The flow was:
1. User saves a new dive → `pushToObsidian(dive)` fires asynchronously
2. User navigates to History → `syncFromObsidian()` fires immediately
3. `syncFromObsidian()` reads vault, new dive isn't there yet (push still in flight)
4. `dives` array is overwritten with vault contents, new dive disappears

The fix was removing the auto-sync trigger. The `dives` array is the source of truth during a session. Manual sync is available via "↻ Sync now" in the Obsidian panel.

**Do not add auto-sync back on navigation** without solving the race condition first (e.g. await the push before navigating, or optimistically add to local state before pushing — which is already what happens).

---

### Species stats count dives-where-seen, not total individuals
**Decision:** The "Most frequently seen species" chart counts the number of dives where a species was seen (1 per dive), not the sum of individual animals counted.

**Why:** A diver might log 50 glassfish in a single shoal. That one encounter should not make glassfish appear as frequently seen as green sea turtles spotted on 20 separate dives. The chart is about habitat frequency, not census data.

**Individual counts** (`count` field on each sighting) are still stored and available for OBIS export, where they belong in the eMoF table as `organismQuantity`.

This same logic applies to the "Top species by country" cards.

---

### Inline service worker replaced by sw.js (migration task)
**Decision:** The original single-file HTML used an inline blob service worker for offline caching. This approach does not register correctly on Android Chrome — the app installs as a bookmark rather than a true PWA.

**Fix required during migration:** Extract the service worker to a real `sw.js` file in the repo root, and the manifest to `manifest.json`. Reference both from `index.html`. This is a priority task for the Claude Code migration — the PWA install experience on Android depends on it.

**Do not try to fix the inline approach** — it's a fundamental limitation of blob URLs for service workers in Chrome on Android. The only fix is a proper external file.

---

### Mobile import from device (built)
**Decision:** On mobile, viewing the full dive history (including dives logged on the Mac) requires importing .md files. The import button lives in the Data panel (visible on all screen sizes). Uses `file.text()` API (not FileReader) for better Android compatibility.

**How it works:**
- "Import dive files" button in the Data panel opens the native file picker (`<input type="file" multiple accept=".md">`)
- Each file is read with `file.text()`, line endings normalised to `\n`
- YAML frontmatter parsed with `parseFrontmatter()`, dive assembled with `frontmatterToDive()` + marine/notes/weather extraction
- Merged into `dives` array — deduped on `_filename` first, then `divenum + date`
- localStorage updated, history re-rendered, result shown as "N added, N updated"

**Proton Drive limitation:** Proton Drive's end-to-end encryption means their Android app cannot expose files through Android's Storage Access Framework in a way browsers can read. Files picked directly from the Proton Drive folder in the file picker fail with a read error. **Workaround:** download the files to local device storage first (e.g. Downloads folder), then import from there. This is noted in the UI.

**Do not attempt to fix the Proton Drive read error** by switching file reading APIs — it is not a code issue, it is a fundamental limitation of how Proton Drive exposes files on Android.

---

## Species database decisions

### Local database instead of WoRMS API
**Decision:** A 1,279-species local database is bundled into the app. The WoRMS REST API is not called at logging time (it *is* used at build time to enrich new entries — see CLAUDE.md → Species database).

**Why (two separate problems):**

**Problem 1 — CORS:** WoRMS API blocks requests from `file://` origins. The browser refuses to make the request, which lands in the catch block and shows "offline" even when online. This is a browser security restriction, not a network problem. Serving from Cloudflare Pages fixes it, but the local database approach is more robust.

**Problem 2 — Vernacular coverage:** Even when the API works, WoRMS's `AphiaRecordsByVernacular` endpoint has sparse coverage for common names. Typing "shrimp" returned mostly scientific names. The local database was built from curated common names and is significantly more useful for field logging.

**WoRMS AphiaIDs are still baked into the database** for every species that has one. This preserves OBIS compatibility — the IDs are looked up at export time, not at logging time.

### WoRMS dual-endpoint approach (tried and replaced)
An earlier version queried both `AphiaRecordsByVernacular` and `AphiaRecordsByName` in parallel using `Promise.allSettled`. This was replaced by the local database. The code for this no longer exists in the app. Do not re-introduce it.

---

## UI/UX decisions

### Salt and Fresh removed from Dive type
**Decision:** Dive type options are: Boat, Shore, Drift, Night, Cave, Wreck. Salt and Fresh were removed.

**Why:** Water type (Salt/Fresh/Brackish) is already a separate field in the Conditions section. Having it in Dive type too was redundant and confusing.

### Dive type field — kept as-is, "Boat" retained (parked, do not re-litigate)
**Decision:** The single `entry` field (Boat, Shore, Drift, Night, Cave, Wreck, Reef, Wall, Pinnacle, Muck) is kept unchanged. "Boat" stays. No split into separate entry/character fields.

**The known imperfection:** `entry` conflates two orthogonal axes — *platform* (Boat, Shore) and *dive character* (Drift, Night, Wreck, Reef, Wall, Pinnacle, Muck). A boat-access night wreck dive can only record one value. In the Stats breakdown "Boat" therefore dominates (~65%) and can look like noise suppressing the more interesting "what kind of diving do I do?" signal.

**Why kept anyway:** "Boat, into the blue, nothing else" is a *genuine, distinct dive character*, not an absence of one — an open-water pelagic dive (whale shark, manta) is exactly that. So Boat is not always the unmarked default; sometimes it is the type. The breakdown looking Boat-heavy is largely a **logging-discipline** issue (pick the most specific applicable type), not a taxonomy flaw.

**Options considered and rejected/parked:**
- *Delete Boat (→9 types):* rejected — orphans legitimate open-water boat dives and just moves the noise.
- *Reframe as "character", Boat = default:* rejected — would mislabel true open-water dives.
- *Split into two fields (`entry` + `character`):* the textbook-correct model fix, but a heavy migration (~16 `entry` consumers, duplicated type list in form + edit modal, the unified `tl-type-*`/`--type-*`/donut colour system, YAML parser, locked specs) — **over-engineering for a personal log. Parked, not abandoned.** Revisit only if cross-analysis ("drift dives: boat vs shore") becomes a real need.

**Do not "fix" the Boat-heavy breakdown by removing Boat.** It is a deliberate, reasoned trade-off.

### Rating system removed
**Decision:** There is no star rating on dives.

**Why:** Luke decided subjective ratings weren't useful for his logging purpose. Removed entirely — not hiding, not optional. Do not add it back.

### Liveaboard as separate field
**Decision:** Liveaboard operator has its own text field, separate from Dive type.

**Why:** A liveaboard trip involves multiple dive types (drift, reef, wreck). The operator name belongs on every dive from that trip, not as a type classification.

### History sorted by dive number descending by default
**Decision:** History opens with highest dive number first (most recent).

**Why:** You want to see your latest dives first. Ascending order (from first dive ever) is available by clicking the sort button.

### Mobile file writes use browser download, not File System Access API
**Decision:** On mobile, saving a dive downloads a `.md` file to the device's Downloads folder via the standard `<a download>` blob mechanism. The File System Access API (`createWritable()`) is not used for mobile saves.

**Why:** `FileSystemFileHandle.createWritable()` for user-visible SAF-backed files was only added to Android Chrome in version 132 (January 2025) and is unreliable across devices. Testing showed consistent `NoModificationAllowedError` even with freshly granted permissions. Multiple workarounds were attempted (retry with backoff, forced `requestPermission`, fresh handle re-acquisition via `showDirectoryPicker`) — all failed. Browser download via blob URL is the only guaranteed write mechanism in a PWA on Android.

**Implication:** `localStorage` is the source of truth on mobile. Downloaded `.md` files are point-in-time exports. If a dive is edited after downloading, the user must download again to get an updated file (via the ↓ button on the history card).

**Do not attempt to re-introduce `createWritable()` for mobile saves** until there is confirmed evidence it works on the target device. The "Dive folder" UI in the Data panel is retained for future use if Android Chrome's support matures, but it is not part of the primary save flow.

### "Save to device" button removed from history cards and confirmation bar
**Decision:** Per-card "Save to device" buttons and the post-save confirmation bar button have been removed. Individual dive downloads are available via a small ↓ icon on each history card.

**Why:** The button was redundant on desktop (Obsidian handles it) and on mobile the floating Save button handles it automatically. The ↓ icon is retained for re-downloading after edits.

### Log-form redesign: prefix-aware wiring and hidden-input bridge (v2.74)

**Decision:** `js/logform.js` wires all visual controls (chip grid, segmented toggles, weather icons, vis/temp dials, map pin) using a **prefix** (`'f'` for the log form, `'e'` for the edit modal). A single set of functions handles both contexts.

**The hidden-input bridge:** Every visual control writes into the same canonical hidden `<input>` elements (`f-entry`, `f-watertype`, `f-current`, `f-weather`, `f-vis`, `f-temp`, etc.) that `saveDive()`, `saveEdit()`, `generateFrontmatter()`, and `_updateSectionSummary()` already read via `g()`/`ge()`. **Those save paths are completely untouched** — they still read from IDs, they don't know the controls changed.

**Do not bypass this bridge.** If a new visual control is added, it must write to the existing canonical hidden input, not introduce a parallel read path in `saveDive()`/`saveEdit()`. Breaking this means edits silently fail to persist.

**Per-prefix map state:** `_maps[prefix]` holds Leaflet state independently per context (`{ map, marker, geoTimer, geoPending, tried }`). The edit modal always calls `lfDestroyMap('e')` before re-initialising, because `openEdit()` regenerates its innerHTML on every call.

> **Updated 2026-07 (v2.83):** the edit modal is gone — editing now happens on
> the log form itself (see "Edit happens on the Log panel" below), so only the
> `'f'` prefix exists. The hidden-input bridge rule stands unchanged; the
> prefix parameterisation was kept for any future second form context.

---

### Edit happens on the Log panel — the edit modal is retired (v2.83)

**Decision:** ✎ prefills the *actual log form* from the dive and flips
`#panel-log` into edit mode (banner + "Save changes" buttons + `.editing`
CSS); `saveDive()` gained an edit branch that merges `{ ...existing,
...fields }` over the dive in place. The modal — a ~330-line template-literal
second copy of the form, a second save path (`saveEdit`), a mirror sightings
array, and a second Leaflet lifecycle — was deleted outright.

**Why:** every field/layout/control change had to land twice (the changelog
paid that tax repeatedly), and embedding a page-shaped form in a fixed
overlay produced a recurring *class* of stacking-context bugs — clipped
autocomplete dropdowns, Leaflet panes over fixed UI, and finally the mobile
species picker rendering behind the modal (z-index 600 vs 1000). The modal's
one real payoff — in-place editing — only ever existed on desktop; on mobile
it was already full-screen.

**Risk mitigations (all deliberate, don't remove unless noted):** edit mode
is disarmed by *any* navigation away from the Log panel (one line in the
unified `show()` patch — no path can leave edit armed); the merge preserves
off-form fields (`uid`, `videos`, `_filename`); a pending UDDF profile is
discarded on edit entry AND the profile.js `saveDive` patch skips attachment
on edit saves (`lastSavedDiveId` is stale during an edit — it would attach
to the wrong dive). Save/cancel both land on History, never back inside the
dive file — the old modal's "return to the dive file" actually returned to a
stale render. Full design + smoke-test list:
`briefs-archive/v2.83-BRIEF-edit-in-place.md`.

**Superseded, same day:** a "discard unsaved draft?" confirm guard on ✎ entry
was part of the initial design, then deliberately removed — it required a
hand-maintained allowlist of "content" fields, and twice missed real ones in
manual testing (Operator on exit, then Current/Gas/deco-stop on entry) before
Luke called it not worth the fragility. ✎ now always jumps straight into
edit, silently discarding any draft the same way switching to Stats or
Species already does — consistent with the rest of the app rather than a
special case. See "Edit-mode colour signal" below for the compensating UI
work (the accent border tint) that was prompted by this same testing pass.

---

### show() patched once, not multiple times
**Decision:** The `show()` function is patched exactly once, in a single unified wrapper that handles mobile nav and Obsidian panel population together.

**Why:** Earlier versions had two separate patches (one for Obsidian, one for mobile nav). The second patch replaced the first, causing the Obsidian settings fields to stop populating correctly — API keys disappeared. Merged into one. Do not split again.

---

### History view: trip-grouped timeline

**Decision:** The default history view groups dives under sticky trip headers, replacing the flat card grid.

**Why:** The flat grid repeated trip context (country, operator) on every row and used equal-weight visual hierarchy that made scanning difficult. Trip grouping eliminates ~30% of repeated data per row, creates natural reading units, and reflects how divers actually remember their dives — by trip, not by dive number.

**Trip header format:**
```
[Trip name · Location · Month Year]  ········  [N dives · N sp. · N days]
```
- Trip name is bold; location and month are muted
- Dot leaders fill the space between label and stats
- Cross-month trips: "Oct–Nov 2025"
- Stats are derived: dives = count in group, species = unique across group, days = date range

**Timeline row format (locked):**
```
[#dnum muted]  [site bold + 📍]  [type · ↓depth · ⏱time · 👁vis · 🐟sp]  [Weekday DD]
```
- Dive type word is colour-coded and is its own legend — no separate key needed
  - Boat: `#4A90B8` (blue), Night: `#6A4A9A` (purple), Drift: `#a07a10` (amber), Shore: `#3a9450` (green)
- Middot separators between metrics use `opacity: 0.35`
- Visibility (`👁`) is in the header metrics — confirmed important for at-a-glance scanning
- Hover reveals Edit / Delete action pair; hides the day tail to avoid crowding
- No dots, no vertical timeline line — purely typographic hierarchy

**Trip data model:**
- `trip:` is a free-text field per dive, stored in YAML frontmatter
- No separate trip entity, no trip ID, no join table
- Grouping precedence: `trip` → `region` → `location` (country) → "Ungrouped"
- Non-trip dives (no `trip` value) group under their `region` — the region label IS the proxy trip label
- Autocomplete surfaces previously-used trip names for quick re-entry on consecutive dives

**Non-default sorts:**
- All three sorts now render as timelines — no card grid, no pagination
- **Depth sort:** flat timeline (no grouping headers), sorted deepest first. Same row format as the trip view.
- **Country sort:** country-grouped timeline. Same sticky `tl-header` format with country name as the label and dive/species counts as stats.
- The trip-grouped view is only the default (dive number descending) sort — trip grouping only makes sense in chronological order

**Do not add a trip entity or trip ID** to the data model. The YAML `trip:` field per dive is the entire implementation. If a trip name changes, rename it across all dives using the rename-trip action (✎ on the trip header — built June 2026).

---

### History + Dive file redesign (v2.2)

The History view's job is **navigation** — find one dive among 200+ and dip into it. The old cramped timeline rows + inline expand were replaced. **This supersedes the "Expanded dive card" decisions below** — that whole inline-expand path (`toggleDiveMD`, `renderDiveDetail`, `.tl-detail`, `.dd2-*`/`.dd-*` markup) was removed. The notes below are kept only as historical context.

- **Direction-D card.** Of four explored directions (cinema cards, field notebook, stats dossier, navigation card), D won. The dive type is a coloured **spine** (vertical word), not an inline meta word. Measurements use an aligned grid (icon · number right-aligned with `tabular-nums` · unit); **vis is demoted by colour, not size**. The single **rarest species** (by IUCN rank, via `rarestSighting`) anchors the card — count-only on mobile, with the name on desktop.
- **Full-view dive file, not inline expand.** Opening a dive hides `#history-content` and renders into `#dive-file-view`, with a back affordance that restores scroll position.
- **Mobile tabs vs desktop columns.** Mobile: segmented Marine / Overview / Notes (default Marine) + pinned stat band. Desktop: tabs dissolve into two columns via `min-width:0` grid tracks (marine + notes left, map + data right). App bar is sticky-top on desktop, fixed-bottom (thumb zone) on mobile; the whole trip title is the back button.
- **Notes / Sign-off.** Notes lives with the marine column; the Notes *tab* only appears with actual notes text. Sign-off moved to the Overview tab to balance the desktop right column.
- **🎬 vs ▶ split.** 🎬 = "manage footage" action; ▶ = passive "videos linked" indicator. Never overloaded.
- **Maps.** Dive-file location map = single interactive marker. Trip headers get an ambient, non-interactive Leaflet banner — lazy-init via IntersectionObserver, only for groups with ≥1 GPS dive, hidden offline, torn down on re-render. Both degrade gracefully (container hidden).
- **Reuse, not rewrite.** The species album engine (`spBuildPanel` + carousel + taxon list) is unchanged — only its container/width changed.
- **SAC band classes retained.** `.dd2-sac-good/mid/high` survive the `.dd2-*` purge because `sacClass()` (stats.js) still returns them, now consumed by `renderDiveFile`.

---

### Expanded dive card: no-tabs progressive disclosure

> **Superseded by the v2.2 redesign above** — describes the removed inline-expand path. Kept for history.

**Decision:** The expanded dive card (shown when tapping a history row) uses a single scrollable view with no tabs, no accordion, no click-to-expand sections. All dive data is always visible.

**Why:** Tabs and accordions hide information behind an extra click. The card is not long — five sections, most compact. Progressive disclosure through spatial hierarchy (marine life first, data last) is the right solution for information architecture, not UI chrome.

**Card structure (locked):**

1. **Header** — identical to the timeline row (dnum, site + 📍, type+metrics, day). Never duplicates data from the header in the body below.

2. **Marine life section** — *superseded the original 3-per-page grid (May 2026). See "Species: album carousel + scannable list" below.*
   - Section title
   - **IUCN key** (top, `border-top` solid + `border-bottom` dashed): contextual — only shows statuses actually present in this dive. Label: "IUCN Red List" in small caps. No box, no background — matched hairline rule pair.
   - **Album carousel + taxon-grouped list** (replaces the paginated grid)
   - **Abundance key** (bottom, `border-top` dashed): `R rare · O occasional · C common`
   - The two keys are a matched pair — IUCN aligns with badge position (top of card), abundance aligns with pill position (bottom of card)

3. **Notes** — open prose, no toggle

4. **Dive data** — 2-column CSS grid, 4 cert-aligned groups:
   - Left col: **Conditions** (site, vis, temp, current, weather, water type) | **Gas & Equipment** (tank, gas, pstart→pend, suit, weight, SAC rate)
   - Right col: **Profile** (depth, avg depth, time, entry time, exit time) | **Verification** (buddy, liveaboard, signoff, cert number)
   - Columns collapse to 1 on mobile (< 560px)
   - Group titles in small-caps mono, accent colour

5. **Actions footer** — Edit · Delete · ↓ .md

**Key design rules:**
- Fields shown in the timeline row (type, depth, time, vis, species count) are NOT repeated in the dive data section
- The card header is always the verbatim timeline row — same markup, same classes
- IUCN key is contextual per dive, not always-on with all 6 statuses
- Dive data groups follow SSI/BSAC certification structure — "Exposure" is not a cert category, so weight and suit live under Gas & Equipment
- Conditions comes before Profile in the column order — conditions are almost always captured, profile fields (avg depth, entry/exit time) are often incomplete

---

### Expanded card: profile grid slot always rendered

**Decision:** The Profile group `<div class="dd2-gblock">` is always present in the DOM, even when all its fields are blank. When empty it renders as `<div class="dd2-gblock"></div>` with no content.

**Why:** The dive data section uses a 2-column CSS grid. The four groups (Conditions / Profile / Gas & Equipment / Verification) are placed as grid children. When Profile's element is absent from the DOM, CSS grid auto-places Gas & Equipment into the top-right cell, causing the layout to reflow. An empty placeholder preserves the grid slot without adding visual noise.

**Do not remove the empty div** to "clean up" the HTML — it is load-bearing for the grid layout.

---

### Card open: scroll to row top

**Decision:** When a timeline row is expanded (`toggleDiveMD`), the page scrolls so the clicked row appears just below the sticky trip header. Offset is 52px to clear the header band.

**Why:** Without the scroll, a user reading at the bottom of a trip would open a card and see the detail rendered below the fold — they'd have to scroll up to read from the top. The scroll makes the experience feel like navigating to the dive rather than expanding content in place.

**Implementation:** `getBoundingClientRect().top + window.scrollY - 52` with `behavior: 'smooth'` on a 20ms timeout to let the `open` class render before measuring.

---

### Species: album carousel + scannable list (replaces paginated grid)

**Decision:** The expanded card's species section is an **album carousel** (one large hero photo at a time, swipe/arrows) sitting above (mobile) or beside (desktop) a **full, non-paginated, taxon-grouped list**. The two are bidirectionally linked.

**Why the 3-per-page grid was dropped:** It conflated two opposed jobs — *scanning* "what did I see on this dive" (wants a dense complete list) and *appreciating* the photo (wants one big image). The grid did neither: to check 16 species you paged through 6 screens. Reordering-on-select was rejected as a fix (destroys spatial memory). The carousel+list gives both: the list is the index/scanner, the carousel is the payoff.

**Locked behaviour:**
- **List order:** taxon, following the live `BROWSE_GROUPS` order, then alphabetical by common name within each group — identical to species browse mode. Group headers show `EMOJI Group N`. **Never reorder on selection.** Headers are sticky inside the desktop list panel.
- **Bidirectional link:** tap a row → carousel slides to it; swipe/arrow the carousel → matching row highlights. The carousel and list share one ordered array so `data-i` indices align 1:1.
- **Mobile (stacked, <760px):** tapping a row jumps the page up to the photo and stays there. Swiping the carousel changes the photo without yanking the page down to the list.
- **Desktop (≥760px):** carousel left, list right as a contained scroll panel (`max-height` ≈ carousel). No page movement at all — both always visible, so the scroll-jump problem structurally cannot occur.
- **Images:** hero loads iNaturalist `medium` on mobile / `large` on desktop (decided once at load via `matchMedia`); list thumbnails stay on the tiny `square` (fast, sharp at 36px).
- **Per-dive scoping:** every dive's detail HTML is in the DOM; carousel elements are id-suffixed by dive id. `initSpeciesPanel(diveId)` wires the IO + state lazily when the card opens, guarded by a `data-spReady` flag so re-renders re-init cleanly.

**Do not reintroduce pagination or a multi-up grid here.** If a photo-forward browse/collect experience is wanted, that is the future Species Album, not the per-dive review card.

---

## OBIS / taxonomy decisions

### Darwin Core three-table model (planned, not yet built)
**Decision:** When OBIS export is built, it will use the standard Darwin Core Archive three-table format:
- **Event** (one row per dive): date, location, depth, duration
- **Occurrence** (one row per species sighting): scientificName, AphiaID, occurrenceStatus
- **eMoF** (one row per measurement): organism count, depth seen

**Why:** This is what OBIS requires. The app's data model was deliberately designed to map onto this — dives are events, sightings are occurrences, counts are measurements.

### AphiaIDs at logging time, not export time
**Decision:** AphiaIDs are stored on the sighting object when a species is selected from the local database, not resolved later.

**Why:** Simpler. The local database already has them. No API call needed at any point in the normal flow.

### Unvalidated sightings are allowed
**Decision:** Species not in the local database can be entered as free text. They get `validated: false` and `aphiaId: null`. They are stored and displayed normally with an "unvalidated" badge.

**Why:** Divers encounter species not in any database. Blocking entry would be worse than logging with a caveat. These entries will need manual AphiaID resolution before OBIS submission.

---

## Markdown format decisions

### Species inside YAML frontmatter
**Decision:** The `species:` list belongs inside the YAML frontmatter block (between the `---` delimiters), not after the closing `---`.

**Why:** Dataview can only query fields inside the frontmatter. Species outside the block are invisible to Dataview queries and dashboard templates.

**Note:** Older files saved before this was fixed have species outside the frontmatter. The parser handles both formats — it checks for species in the body if the frontmatter species list is empty. When those files are next saved from the app, they will be rewritten with species inside the frontmatter.

### Notes extracted from markdown body
**Decision:** The `notes` field is not in the frontmatter — it's extracted from the `## Notes` section of the markdown body during sync.

**Why:** Notes are long-form text and don't belong in frontmatter. Dataview doesn't need to query them. This is a known inconsistency — if Dataview note querying becomes needed, add a `has_notes: true` boolean to the frontmatter instead.

---

## Things explicitly not built (and why)

### Native app wrapper
Not built yet. The PWA is the right foundation while the feature set is still evolving. When a wrapper is needed, **Tauri is the intended path for both desktop and mobile** (Capacitor is the mobile fallback only) — see the detailed entries below and ROADMAP.md.

### Obsidian Sync paid service
Not needed. Luke uses Proton Drive for vault sync. Phone → Proton Drive app → vault → Mac is the workflow.

### Proton Drive API integration
No stable public API exists as of early 2026. The SDK is not yet available for third-party apps. Do not attempt to integrate.

### Rating system
Removed by Luke. Do not add back.

### Server-side component
Not needed for current use case. Revisit if the app becomes multi-user or needs auth.

### React / framework migration
Not decided yet. The folder structure migration comes first. Framework decision follows from that if the vanilla JS approach proves limiting.

### WoRMS API at logging time
Rejected. See species database section above.

### robots.txt
A `robots.txt` file with `Disallow: /` has been added to the repo root to prevent search engines from indexing the Cloudflare Pages deployment. The URL is not guessable but this is good practice for a private personal tool.

### Native app wrapper (Capacitor) — now the *mobile fallback*, not the plan
**Decision:** The app remains a browser-only PWA; no wrapper has been added. **Update:** Capacitor is no longer the intended mobile path — **Tauri v2 covers mobile too** (see the Tauri entry below), so the plan is one Tauri wrapper for desktop + mobile. Capacitor is retained only as the **fallback** if Tauri-mobile's `fs` plugin can't meet real Android field-logging needs.

**Why not yet (either wrapper):** The feature set is still evolving. A wrapper adds a build step and a native project to maintain. The right time is when the feature set stabilises and the PWA file system limitation becomes genuinely painful in daily use.

**If the Capacitor fallback is needed:** Use `@capacitor/filesystem` — replace the `createWritable()` / download fallback with `Filesystem.writeFile()` (Android native file API, no SAF limitations). Cost: $25 one-time for Google Play Store. See ROADMAP.md for full migration steps. But validate Tauri-mobile first — it avoids a second toolchain entirely.

### Native app wrapper — Tauri for both desktop and mobile (macOS desktop BUILT — v2.5, 2026-06)
**Decision:** When a native wrapper happens, it will be **Tauri** — one toolchain for **both desktop and mobile** — distributed **un-notarized from GitHub** at zero recurring cost. Not built yet: it wraps the browser v2.3 build, so the browser build comes first. **This supersedes the "Capacitor is the mobile path" framing above** — Capacitor is now the *fallback*, not the plan.

**Verified facts (Tauri v2.11.2, 16 May 2026 — do not re-research without cause):**
- **Sidecar / external binaries: stable, documented.** Declare ffmpeg in `tauri.conf.json → bundle.externalBin`; call from JS via `Command.sidecar()`. Needs a per-platform pre-compiled binary (filename suffix per target) + explicit shell-exec permission with argument validators. This is the mechanism behind the one-button proxy flow.
- **Mobile (iOS + Android): stable** in v2, with a scoped-permission `fs` plugin and native Kotlin/Swift plugin support — younger than Capacitor's mobile story, but real and production-claimed.
- Native webview (WebKit on macOS) → ~8 MB installs / 30–50 MB RAM.

**Why a wrapper at all — the video feature:** the browser proxy workflow (v2.3) is techy (install ffmpeg → run script → clear Gatekeeper → point at folder). The ffmpeg **sidecar** collapses that into one button. Desktop is the first target for this reason; **mobile follows on the same toolchain** when PWA field-logging friction warrants — so there's a real prospect of building Tauri once and never needing Capacitor.

**Why Tauri over Electron:** native-webview means ~8 MB installs / 30–50 MB RAM (vs Electron's ~150 MB / ~250 MB) — right for a media app; ffmpeg-sidecar support is first-class; and (unlike Electron) it also covers mobile. Cost: native webview (WebKit on macOS) must be re-tested vs the browser build — low risk given the app's conservative CSS/system fonts.

**The caveat (don't overstate "production-ready"):** Tauri-mobile is newer than Capacitor's battle-tested mobile story. So Tauri-for-mobile is the *plan*, not a certainty — at the mobile-wrapper moment, validate its `fs` plugin against real Android field-logging (arbitrary-folder writes, survives updates, no SAF surprises) before committing. If it disappoints, the Capacitor entry above is the fallback. The web code is wrapper-agnostic, so deferring the decision costs nothing.

**Distribution — no recurring fee (corrects an earlier conflation):** App Store, notarization, and free GitHub distribution are three different things. A free app shipped from GitHub needs **neither** the App Store **nor** the $99/yr Apple Developer Program. Un-notarized is the MLX/llama.cpp model: download → one-time "System Settings → Privacy & Security → Open Anyway" → runs forever. Pay the $99 to notarize *later*, only if the user base grows (drop-in upgrade; removes the one-time first-launch friction). Windows (SmartScreen / EV cert) is out of scope — Mac-first personal tool.

**One codebase:** the same HTML/CSS/JS runs in browser, desktop shell, and (later) mobile shell — all Tauri. Only thin capability seams differ (`transcodeProxies()` = "emit download script" in the browser, "run bundled binary" in the shell — mirrors `resolveVideoUrl`; plus a filesystem-write seam for mobile dive `.md` files). Not a fork, and — because mobile is the same toolchain — no second wrapper. The v2.3 brief keeps these seams behind feature checks so each swap is drop-in. See ROADMAP.md → "Desktop + Mobile App (Tauri)".

**Relationship to "no build tools":** a Tauri wrapper introduces a build step for the *desktop artifact only* — the browser build stays build-free and remains the source of truth. This is the sanctioned "if this becomes a product, revisit" exception from the no-build-tools decision, scoped to packaging, not to the app's own code.

**As built (v2.5, 2026-06) — decisions that differ from / refine the plan above:**
- **ffmpeg is invoked from Rust, not JS.** `Command.sidecar()`-from-JS (above) was the plan; the implementation uses a custom Rust command `run_transcode` that hard-codes the encode args and accepts only a folder path. This satisfies "no free-form args from JS" *better* than capability arg-validators — the webview can't shape the ffmpeg command at all. Consequently the `shell:allow-spawn`/`allow-kill` capability permissions were **removed** (the frontend never calls the shell plugin directly; the Rust sidecar call isn't gated by JS capabilities).
- **ffmpeg is built LGPL from official source — VideoToolbox, no GPL.** `src-tauri/build-ffmpeg.sh` downloads the pinned ffmpeg **8.1.1** source (sha256 cross-verified against Homebrew's published checksum), configures `--disable-gpl` with **no** libx264/x265, and compiles a **static single-file** binary that encodes H.264 via Apple **VideoToolbox** (`h264_videotoolbox`) + the native LGPL aac encoder. Consequences: **no GPL anywhere → Mac App Store-eligible, no source-offer obligation**; and because it's static (links only system frameworks) it's one portable file — so the earlier dylib-bundling + `bundle.macOS.frameworks` were **removed**. The binary is git-ignored and built on demand (the script no-ops when present; `FORCE=1` rebuilds). `run_transcode` encodes `h264_videotoolbox -b:v 5000k -allow_sw 1 -tag:v avc1`. **This supersedes the earlier GPL Homebrew-bundling approach** (which was a "works on my machine" trap — the Homebrew binary linked ~20 `/opt/homebrew` dylibs and crashed on Macs without them). VideoToolbox H.264 is hardware-accelerated; quality at a given bitrate is marginally below libx264 but fine for review proxies. Trade-off: a first build (or `brew`-free checkout) compiles ffmpeg once (~few min); cached thereafter.
- **Web bundling uses a copy step.** `frontendDist: "../webdist"` + `prepare-web.sh` (not the planned `frontendDist: "../"`) so briefs/mockups/`.git` stay out of the bundle. Maintenance: new top-level web assets must be added to `prepare-web.sh` (same class as the `sw.js` SHELL list).
- **Accepted breadth:** custom fs commands (`write_text_file`/`remove_file`/`list_md_files`) and `assetProtocol.scope: ["**"]` are unscoped — acceptable for a personal tool (folder sync + arbitrary-folder video playback need it); revisit if shared widely.
- **Proxy folders: a global set, matched by filename — not bound per-dive.** The generator drops a `proxies/` folder per trip, so the shell remembers an **array** of proxy folders (`divelog-shell-proxy-paths`, migrating the old single-path key); "Connect" *adds* a folder. All connected folders are scanned into one `_proxyUrls` map keyed by file **stem**, and each clip resolves its proxy by matching its video filename across the whole pool. So you register every trip's folder once and all dives resolve automatically. **Caveat (accepted):** matching is by filename, so the same filename across two connected folders (GoPro number reuse across trips) collides — last scan wins. This ambiguity is inherent to the data model (clips reference videos by filename, not path); revisit with path/trip-scoped matching only if it bites. No "forget folder" UI yet (folders only accumulate; a failed scan of a moved/deleted folder is ignored).
- **CSP nonce must stay disabled for script/style** — `app.security.dangerousDisableAssetCspModification: ["script-src", "style-src"]`. Tauri otherwise injects a CSP nonce into the bundled HTML, and a nonce *disables* `'unsafe-inline'` per spec — which kills the app's ~130 inline `onclick` handlers + inline boot script (packaged app renders but nothing is clickable; dev is unaffected because it loads an external URL). **Do not remove this setting.** It's the same `'unsafe-inline'` trade-off the web `_headers` CSP already makes; escaping (`esc()`) remains the actual XSS defence.
- Folder-sync footage I/O goes through Rust fs commands in the shell (`read_text_file`/`write_text_file`/`remove_file`), not the browser File System Access API — all three sidecar paths (load/write/delete) branch on `isShell()`.
- Full review: `v2.5-BRIEF-desktop-tauri.md` → §9 "Post-build review".

---

## Video footage feature (v2.0)

### Why this feature exists

The user reviews GoPro footage days or weeks after diving to identify species he
couldn't name on the boat. The two real pain points: (1) opaque GoPro filenames
(`GX011280.MP4`) with no review tracking — no way to know what's been watched;
(2) sighting notes like "leaf frogfish — GX021280 around 4 min" are fragile
free-text that can't be searched or linked to dive data.

v2.0 ships the **metadata foundation**: attaching video file records to dives,
linking individual sightings to specific videos with timestamps, and a dedicated
Footage workspace for this post-dive review workflow.

### Scope locked at v2.0

**In:** per-dive `videos[]` list (filename, recording date, reviewed state) +
per-sighting optional `video`/`time` fields + Footage modal + ▶ glyph
indicators + bulk file import (picker + drag-and-drop).

**Deferred to v2.1:** video *playback* — the ▶ glyph becomes a functional play
button when the user grants folder access via File System Access API on Mac.

**Not planned:** cloud upload, MP4 container parsing (duration, GPS track),
cross-dive bulk import by date matching, friendly aliases for GoPro filenames
(user explicitly declined).

### Footage modal is a separate workspace, not part of dive edit

**Decision:** the Footage modal (`openFootage(diveId)`) is a standalone overlay
accessible only from a *logged* dive's expanded card, not from the new-dive
form and not embedded in the edit modal.

**Why:** footage review is a distinct workflow from dive logging — it happens
days later, on desktop, and the task (comb a video for species) is cognitively
separate from "fill in a logbook entry". Mixing it into the edit modal would
make the edit modal enormous and would put footage tools in front of users who
haven't added any videos, on every edit.

### Metadata-only file references (no byte-read)

**Decision:** only `File.name`, `File.lastModified`, and `File.size` are read
from dropped/picked files. The browser never reads video bytes in v2.0.

**Why:** keeps the v2.0 scope honest (playback requires a persistent file
handle which is a v2.1 problem), avoids large file reads stalling the UI on
mobile, and means the "Files never leave your device" copy is literally true
with zero asterisks.

### Species search reuse (isolated `_browseCtx`) — **superseded**

> **This approach was replaced in v2.12.** The footage species picker is now
> a right-column photo-grid transformation on desktop and a full-screen overlay
> on mobile. `_browseCtx` / `showBrowseMode` / `'footage-species-dropdown'` are
> no longer used by the footage modal. See "Footage species picker" decisions below.

~~The existing species search + browse engine (`_browseCtx`, `showBrowseMode`,
etc.) is reused inside the Footage modal's "add sighting" inline form. To
prevent the footage search context colliding with the form or edit-modal
contexts, the footage form uses a dedicated `ddId: 'footage-species-dropdown'`
and `openFootage()` / `cancelFootageAddForm()` / `closeFootage()` all
explicitly clear `_browseCtx` when its `ddId` equals `'footage-species-dropdown'`.~~

### Reviewed state is manual and independent

`videos[i].reviewed` is a pure user toggle — it is **never auto-derived** from
"has linked sightings." A video can be `reviewed: true` with zero sightings
("watched it, nothing notable") and that's a meaningful, intentional state.
This distinction is why the chip is interactive (button, not a static label).

### Unlink clears `video` and `time`, never the sighting itself

Removing a video link from a sighting (`unlinkFootageStamp`) deletes only the
`video`/`time` fields. The sighting — species, abundance, validated flag —
stays on the dive. It surfaces in the "Logged sightings without video" list
where the user can re-link it to a different video.

### `data-*` attribute pattern for scientific names in onclick handlers

Scientific names can contain spaces and apostrophes (e.g. `Synanceia verrucosa`)
which break `onclick="fn('${name}')"` string interpolation.
The footage JS uses `data-sci="${name.replace(/"/g,'&quot;')}"` on the element
and reads it back via `this.dataset.sci` at click time. This is the safe,
template-free approach for all footage action buttons.

---

## Species Album — v2.1

**Feature:** A new Species panel showing all marine life logged across dives,
grouped by taxonomy, with a species profile modal including a "Mapped
sightings" Leaflet map and passive video-reference rows.

**Status: shipped in v2.1 (2026-05-26).** All phases complete:
- ✓ Species index data layer (`js/album.js`: `buildSpeciesIndex`,
  `_groupSpeciesByGroup`, `_sortGroupContents`, `_iucnRank`, `_parseCoord`).
- ✓ Species panel shell + nav entry; `renderSpeciesPanel()` with empty state;
  full album CSS block added to `styles.css`.
- ✓ Group sections + thumbnails; catnav pills; strip + thumb rendering;
  arrow scroll.
- ✓ Species profile modal: medium iNat photo hero (~46% modal width, flush);
  three-line stats (dives / video refs / last seen); "Dive log" sightings
  list with 📍 pin, country, date (no day-of-week); passive ▶ video-ref rows;
  backdrop/Esc close.
- ✓ "Mapped sightings" map in modal (Leaflet, GPS-gated); `_speciesMap.remove()`
  on close prevents leak; GPS NaN bug fixed (`_parseCoord` + `markdown.js`).
- ✓ Search filter; group/pill sync on filter; "No matches." empty state;
  unvalidated `?` indicator.

**Key decisions (locked):**
- Coverage = logged species only; full Pokédex (undiscovered species) deferred.
- Group order alphabetical; within-group sort IUCN rarity DESC then name ASC.
- No sort dropdown in the panel — sort is locked.
- Modal header simplified: species name is in the hero, no redundant title bar.
- ▶ video rows are **passive** (no playback); cursor stays default.
- `L.map.remove()` on modal close — mandatory to prevent Leaflet leaks.
- `data-*` attributes for scientific names in onclick handlers (see above).
- Map section label: "Mapped sightings" (GPS-only; not all sightings).
- Sightings list label: "Dive log" (not "Sightings").

---

## Footage species picker — desktop redesign (v2.12)

### Problem
The original species picker in the footage modal was a floating `position: absolute`
dropdown rendered inside the left column's `overflow-y: auto` scroll container. The
container clipped the dropdown — it could never scroll fully into view and was
visually truncated.

### Decision
Replace the dropdown with a **right-column transformation.** When the species search
input is focused, the right column (sightings list) fully transforms into the species
browser: label + category tabs + 2-column photo grid. When the picker closes (blur,
Escape, or species selection), the column reverts to the sightings list. No floating
element, no z-index battle, no overflow clipping possible.

**Search input stays in the left column.** The right column shows only the result grid
and tabs — there is no second search bar on the right. Typing in the left-column input
updates the right column in place.

**No cancel button.** The mental model is: focus input → column transforms; pick a
species or click elsewhere → column reverts. An explicit Cancel was redundant.

### Photos at iNaturalist medium quality (500 px)
Grid cells request `/medium.` rather than `/square.` (75 px). At 200 px displayed
height on retina screens, medium is the minimum resolution for meaningful species
identification. Small thumbnails were too coarse to tell a reef fish species apart.

### IntersectionObserver infinite scroll
543 Fish species cannot render at once without degrading performance. An invisible
1 px sentinel div sits at the bottom of the grid; when it enters the scroll container's
viewport, the observer appends the next 60 cells without re-rendering or resetting
scroll position. Initial render: 60 items.

---

## Footage species picker — mobile overlay

### Problem
The right-column transformation doesn't translate to narrow screens where the two-column
split collapses to a single-column tab view. Showing the species picker would require
simultaneously switching to the sightings tab AND transforming that column — a confusing
interaction on a small screen.

### Decision
A `position: fixed; inset: 0` overlay appended to `document.body`, entirely outside
the modal's tab layout. The overlay does not interfere with the tab system.

**Layout (thumb priority — top to bottom):**
1. Scrollable photo grid (`flex: 1` — fills all space above the controls)
2. Category tabs (pinned)
3. Search bar (pinned, auto-focused with 60 ms delay for iOS keyboard)
4. FOOTAGE tag + dive context + ✕ (pinned at very bottom, thumb zone)

The inverted stack (content scrolls up, actions stay down) puts the primary
interactions — search, tab switch, close — within thumb reach on a one-handed grip.

**Safe-area inset** on footer bottom padding handles notch / home-bar devices.

**Tabs hidden during search.** When a query of ≥2 characters is active, the category
tabs are hidden (`fmp-tabs--hidden`) since they represent a browse mode that is
irrelevant while the search is filtering cross-group. Clearing the search restores them.

**Tab switch clears search.** Tapping a category tab resets the search field and
shows the browse list for the new group, scrolled to the top. Carrying a half-typed
query across tabs would show nonsensical filtered results for the new group.

---

## Generic mobile species overlay (`#sp-mob-overlay`)

### Decision
The mobile overlay pattern is generalised into `showMobileSpeciesPicker(onSelect, tag, ctx)`
in `species.js`. The same full-screen bottom-first experience now applies to:
- Log-dive form: `marine-input` focus on mobile
- Edit modal: `modal-marine-input` focus on mobile
- (Footage modal has its own parallel implementation — `#footage-mob-picker` — with
  independent state, since it has footage-specific behaviour on species selection.)

### Callback API, not context flags
`onSelect(species)` is a closure passed at call time. The overlay has no knowledge of
which context opened it. This keeps the overlay reusable without any branching inside
the overlay code itself.

### "+ Free text" button
The overlay's search row includes a "+ Free text" button that calls `_mspAddFreeText()`,
adding whatever is typed as an unvalidated sighting — equivalent to the desktop `+ Free
text` button that otherwise disappears when the overlay covers the form.

### Shared CSS, separate IDs and state
Both overlays reuse the same `.fmp-*` class set and `.sp-cell-1col` / `.sp-grid-1col`.
Only the ID rules differ (`#footage-mob-picker` vs `#sp-mob-overlay`). State is fully
separate (`_msp*` prefix for the generic picker, `_footagePicker*` / `_pickerObs` for
the footage picker) to prevent interference if both are ever in the DOM simultaneously.

### `onSpeciesInput` / `onModalSpeciesInput` mobile branch
Both functions now check `window.innerWidth <= 600` as the first thing. On mobile they
call `showMobileSpeciesPicker(…)` and return early; the entire desktop search + dropdown
path is untouched. `onSpeciesInput` also fires on `oninput`, but once the overlay is
open and focus is on `#smo-search`, the original input receives no further events.

### Cleanup hooks
`closeMobileSpeciesPicker()` is called from `closeModal()` and `saveDive()` so the
overlay is never orphaned if the user exits the form without picking a species.

---

## Video sidecar player — v2.3

### Stable dive `uid` (`dl_<base36>`)

**Decision:** Every dive gets an immutable `uid` field minted once on first save,
stored as `uid: dl_<7 random base-36 chars>` in the YAML frontmatter. `id`
(a `Date.now()` integer) is retained for backwards compatibility; `uid` is the
stable join key for future sidecar files.

**Format:** `dl_` prefix (namespace guard) + 7 random base-36 characters ≈ 78 billion
possible values. Collision probability negligible for a personal log. Minted in
`mintUid()` in `js/markdown.js`.

**Stability contract:**
- Minted in `saveDive()` (new dives) and preserved in `saveEdit()` (existing dives).
- `frontmatterToDive` reads `uid` from YAML; `generateFrontmatter` writes it if present.
- Legacy dives without a `uid` in their vault file keep `uid: null` in memory until the
  file is next written (footage edit, Save edit, or "Push all"). They do not get a
  randomly minted uid on every sync — `mintUid()` is **not** called during sync/import.
- The only place a new uid is stamped on an already-persisted dive is `saveDive()`,
  `saveEdit()`, and the "Push all" migration tool.

**Do not derive `uid` from `divenum`, `date`, or `_filename`** — those are mutable. The
whole point is an opaque, stable handle that survives renames.

---

### Custom-species registry (`cs_<base36>`)

**Decision:** Free-text species (not matched in SPECIES_DB) get a stable `customId`
(`cs_<4 random base-36 chars>`) minted once and persisted in
`localStorage['divelog-custom-species']` as a `customRegistry` object keyed by that id.

**Why:** Without stable IDs, the Species Album cannot group sightings of the same
custom species across dives — "Ballen Wrasse" logged twice would appear as two separate
entries if the name differs by a single character. The registry provides the canonical
name + id pair so the join works even when free-text entry is slightly inconsistent.

**Registry schema (per entry):**
```js
{ commonName, scientificName, group, aphiaId }
```
`aphiaId` is always `null` until manually resolved; `scientificName` is blank unless
the user fills it in. The registry is intentionally minimal.

**`resolveCustomId(name)` (in `js/species.js`):** case-insensitive lookup → returns
existing id if found; mints a new entry if not. Called from:
- `addFreeText()` / `_mspAddFreeText()` (logging a new free-text sighting)
- `addModalFreeText()` (free-text in the edit modal)
- `_backfillRegistry()` (retroactive id assignment during sync/import)

**`_backfillRegistry(diveList)` (in `js/species.js`):** runs after every sync or file
import. Two cases handled:
1. Sighting has a `customId` not in local registry → add it (name/group carried from
   the sighting object).
2. Sighting is free-text (`!aphiaId && !validated`) with no `customId` → mint one via
   `resolveCustomId` and stamp it on the in-memory sighting. The next save/push writes
   it to the vault file as `custom_id:` in the sighting's YAML block.

**Album join key:** `m.customId || (m.scientificName || m.commonName || '').trim()`.
Custom species use the stable id; database species use their scientific name (globally
unique via WoRMS).

**Do not use `customId` for database-matched species** — they join on `scientificName`
(or `aphiaId` when OBIS export is built). `customId` is free-text-only.

---

### "Push all to Obsidian" bulk schema migration

**Decision:** A "↑ Push all" button in the Obsidian settings section (`index.html`)
calls `pushAllToObsidian(btn)` in `js/obsidian.js`. It iterates every in-memory dive
and calls `pushToObsidian` sequentially, showing a live `Pushing N / Total…` counter.

**Why this exists (not in the original v2.3 brief):** New schema fields (`uid:`,
`custom_id:`) are only written to a vault file when it is next saved through the app.
Without a bulk tool, all 50+ existing dives would need to be opened and re-saved
individually to propagate the new fields — not practical. "Push all" collapses that
migration into a single click.

**Intended workflow:**
1. Open the app on Mac (Obsidian available).
2. "↻ Sync now" — loads all dives from vault; `_backfillRegistry` runs, minting uids
   and `customId`s in memory for any dive/sighting that lacks them.
3. "↑ Push all" — writes every dive back to the vault with the current schema, stamping
   `uid:` and any `custom_id:` fields into each file's frontmatter.
4. From this point, `uid` values are stable in the vault and survive future syncs.

**Failure handling:** sequential iteration continues past individual failures (try/catch
per dive). Failed count is shown in the completion summary. A single malformed file
should not block the other 49.

**Not a routine sync button.** "Push all" rewrites every file unconditionally, regardless
of whether anything changed. This is deliberate for a one-off migration but would be
wasteful (and spammy to Obsidian's file watcher) if run regularly. It is intentionally
placed in the settings panel, not near the main "Sync now" trigger.

**Guard:** `pushAllToObsidian` checks `syncMode === 'obsidian' && obsAvailable` and
alerts if either condition is false. It cannot run without a live Obsidian connection.

**Do not add a "push all" equivalent for the File System Access API folder sync** —
that path is write-forward (every save writes the file); no bulk migration is needed.

---

## Dive planning — v2.6

### Surface-interval engine: vendored `scuba-physics`, not an npm dependency

**Decision:** The Plan panel's surface-interval calculator vendors the MIT-licensed
`scuba-physics` library (Bühlmann ZHL-16C with gradient factors) as a prebuilt
IIFE bundle at `vendor/scuba-physics/scuba-physics.min.js`, the same pattern as
`vendor/leaflet/`.

**Why this needed real verification, not just a name match:** Early research
surfaced "scuba-physics (MIT)" as the engine to use, but it does not exist as a
standalone npm package or top-level GitHub repo — searching for it that way
returns nothing. It turned out to be real, just nested: `projects/scuba-physics`
inside `jirkapok/GasPlanner` (58 stars, MIT, actively maintained, real test
suite), not published standalone since it's built via Angular's `ng-packagr`
inside that monorepo. The actual algorithm code (`BuhlmannAlgorithm.ts`,
`Options.ts`, etc.) has zero Angular imports — it's framework-agnostic, which is
why it could be vendored at all.

**Build process (one-time, not a project build step):** sparse-checkout
`projects/scuba-physics/src` at a pinned commit → `tsc --noEmit` against a plain
(non-Angular) tsconfig to confirm no Angular coupling → `esbuild --bundle
--format=iife --global-name=ScubaPhysics`. Full steps + the pinned commit hash +
a SHA-256 of the output live in `vendor/scuba-physics/README.md` — re-run them
against a newer commit if this ever needs updating; nothing will flag upstream
fixes automatically since it isn't an npm dependency.

**Validated, not assumed trustworthy:** the bundle reproduces the library's own
published NDL test table exactly (24/24 matches at GF 100/100 and GF 40/85,
fresh water, air) and surface-interval offgassing was confirmed monotonic
(longer rest → longer next-dive NDL) before relying on it for the binary search
that finds minimum surface intervals. See `src-tauri/src/lib.rs`'s own
`#[cfg(test)]` module for the equivalent treatment of the Admiralty API shapes.

**Licence:** MIT applies to source code regardless of distribution channel —
npm publication isn't what triggers the licence grant, obtaining a copy is, and
GitHub source is just as valid a copy as an npm tarball. The one real obligation
is carrying the copyright notice forward, which is why `vendor/scuba-physics/`
has its own `LICENSE` file copied verbatim from the source repo.

---

### Surface-interval calculator: GF 40/85 / 35/75 only, no looser option, ever — SUPERSEDED 2026-07-21

**Superseded by "GF 100/100 as Standard" below.** Kept here as the historical
record of why the rule existed and what changed Luke's mind, not as current
behaviour. See that entry for the actual current presets.

**Original decision:** The conservatism presets were locked to Standard
(GF 40/85) and Extra-conservative (GF 35/75). Deliberately no third, looser
preset (e.g. GF 45/95). (This rule was first revisited, not reopened, when
deco-stop planning was added — see "Deco-stop planning: advise, never
enforce" below. That change left the GF values themselves untouched; only
this one, later, actually changed them.)

**Original reasoning:** This is the one feature in the app where a bug — or
a casual "let's add a looser option" — can actually hurt someone. The
calculator can only be made more cautious than a real dive computer's
defaults, never less. A user whose own computer is set looser will see this
tool flag dives as "exceeds no-stop limit" more readily than their computer
would — that's the intended direction of disagreement, not a bug to "fix" by
loosening the presets. Correct as far as it went — the problem it turned out
not to anticipate was that the *locked* presets were already sitting well
past that intended margin, not right at its edge.

---

### GF 100/100 as Standard (2026-07-21)

**Decision:** Standard is now GF 100/100. Conservative is GF 40/85 (what
used to be called Standard). A deliberate, knowing override of the rule
above — Luke's own words: "I'm knowingly overriding that past rule."

**Why the old default turned out to already be past its own intended
margin, not sitting right at it:**

1. **Real-world comparison.** Luke's own dive computer (a Cressi Leonardo —
   widely regarded as one of the more conservative recreational computers
   on the market) was reading noticeably more permissive than this tool's
   old Standard preset on an actual weekend of UK diving, which is what
   started this whole line of work.
2. **A real BSAC 88 table, photographed and checked directly.** For a
   comparable dive (~24 m/47 min, BSAC's own table rounding), BSAC's
   printed decompression-stop time is roughly 3 minutes. This tool's old
   Standard (GF 40/85) computed ~19 minutes for the same profile. Checked
   whether any GF tuning could close that gap: even GF 100/100 — the
   absolute floor of conservatism this model can produce — still computes
   ~8.6 minutes, about 3x BSAC's figure. Also ruled out ascent rate as an
   explanation (matching BSAC's own stated 15 m/min ascent rate makes the
   required stop *longer*, not shorter — the wrong direction to explain
   the gap). Conclusion: the residual gap between GF 100/100 and BSAC is a
   genuine cross-algorithm difference (Bühlmann-with-gradient-factors vs.
   BSAC 88's own independently-developed table), not something further GF
   tuning on our end can reach — but the old default was adding *unnecessary
   extra* conservatism on top of an already-conservative-relative-to-BSAC
   algorithm, and that part *was* within our control.
3. **Subsurface itself — the reference app this session studied
   specifically for its planning functionality — documents GF 100/100 as
   the setting that approximates conventional dive tables**, not GF 40/85:
   *"to approximate the values in recreational dive tables, set the
   gradient factors to 100... Realistic conservative values are
   GFLow=40%, GFHigh=80%"* (`user-manual.html`, quoted in full earlier in
   this session). Under Subsurface's own documented framing, this app's
   old Standard preset was already sitting where Subsurface would call it
   Conservative, and its old Conservative (35/75, now dropped entirely)
   had no clearly-labelled equivalent in Subsurface's own vocabulary at
   all — evidence the original two-preset spacing wasn't calibrated
   against anything external, just chosen to sit "safely above Shearwater's
   Med" with no further outside check.

**Not an open door.** GF 100/100 is a hard floor — nothing looser exists
within the Bühlmann/GF model, so this isn't the first step of a slide
toward ever-looser presets, it's landing on a specific, bounded, well-
documented value with an established external meaning (Subsurface's own
manual uses the identical framing). Conservative (40/85) keeps exactly the
values and behaviour Standard used to have — nothing about the *cautious*
end of this tool changed, only which preset loads by default.

**What this does NOT resolve:** the BSAC-table gap itself. GF 100/100 is
still ~3x BSAC's own reported stop time for a comparable dive. This tool
remains, and will remain, more conservative than BSAC 88's printed tables
specifically — that's a genuine algorithm difference (see point 2 above),
not a settings problem, and nothing on our end can close it without
literally encoding BSAC's copyrighted tables, which isn't something this
app can legally do.

**The square-profile model is also a deliberate conservative simplification,
not a limitation to silently work around.** The engine assumes a planned dive's
full bottom time happens at its single entered depth (verified directly against
`predictNoDecoLimit` in the vendored source — it hovers at the *last segment's*
depth, nothing shallower). Do not substitute "average depth" to make dives look
more favourable — average depth discards exactly the timing information
(how long was actually spent at the deepest point) that drives real
decompression risk. The correct way to give credit for a shallower tail end of
a dive is real multi-level segments (the engine already supports them — see
ROADMAP.md's deferred "Multi-level profiles" item), not a different single
depth number.

---

### Deco-stop planning: advise, never enforce (2026-07)

**Decision:** A planned dive that exceeds NDL is no longer a hard "exceeds
no-stop limit" refusal. It now shows a real stop schedule (depth + minutes),
and the plan can still be saved exactly as entered — nothing in this feature
blocks anything.

**Why the earlier "no looser option, ever" rule (above) still fully applies.**
That rule is about the GF presets specifically — the calculator can only be
made *more* cautious than a real computer's defaults, never less. This
feature doesn't touch GF at all; both presets (40/85, 35/75) are unchanged.
What changed is what happens once a dive is confirmed to exceed those same
locked, conservative limits: instead of a dead end, the tool now says what a
BSAC/PADI table would — here's the stop. Luke's own framing: "no one wants to
do the deco stop" — telling a diver the real cost (an actual stop time) is a
stronger incentive to shorten the dive than a bare refusal ever was, and it's
the same information a real dive computer would give them anyway if they
went ahead regardless.

**Where the stop schedule comes from — no new engine capability needed.**
`BuhlmannAlgorithm.decompression()` was already being called for every
planned dive, purely to chain tissue loading to the next one (its return
value's `finalTissues` was the only field ever read). Per the vendored
library's own source (`vendor/scuba-physics/README.md`), that same call
already computes and appends the full ascent, including every stop segment,
whenever the dive requires one — `_planExtractStops()` (`js/planner.js`)
just reads segments that were already being thrown away. Confirmed by
reading the actual GasPlanner source (`BuhlmannAlgorithm.decompression()`,
`AlgorithmContext`, `DepthLevels.addSafetyStop()`/`nextStop()`) rather than
guessing at the shape: a "stop" is any flat segment (`startDepth ===
endDepth`) below the surface, in fixed 3 m increments
(`Options.decoStopDistance`) — the UI only surfaces a schedule at all when
`noDecoLimit()` independently confirms the planned time exceeds NDL. The
engine's own routine safety-stop behaviour (`SafetyStop.auto`, any dive past
10 m) is disabled entirely (`Options.safetyStop = SafetyStop.never`, see
below) rather than left to fold into the schedule — a diver doesn't do that
habitual stop on top of a genuine decompression obligation, they're the same
stop.

**The engine's own habitual safety stop is disabled (`Options.safetyStop =
SafetyStop.never`), not merged in.** First shipped merging it in
unquestioned ("a diver gets the same combined answer either way") — wrong,
caught by Luke directly: "you don't do a safety stop on top of a deco stop.
You do one or the other." Verified by diffing segments with the engine's
default (`SafetyStop.auto`, which adds ~3 min at the last stop depth for
any dive past 10 m, on top of whatever's already required there) against
`never`: a 23 m/47 min dive's 3 m stop dropped from 15.18 to 12.18 min —
confirming the habitual stop really was being added as extra time on top of
a genuine obligation, not folded into it. Disabling it also surfaced a real
edge case worth its own handling: with the habitual stop gone, a dive that's
only marginally past the *published* NDL (`noDecoLimit()`, which rounds
down to whole minutes as its own margin) can show an EMPTY stop list — the
full ceiling computation finds nothing to actually stop for. Both a 23 m/
25 min dive (3 min over) and a 19 m/40 min dive (3 min over) landed here in
testing. Reported honestly rather than inventing a number: "At your no-stop
limit — no stop indicated, but you're right on the edge" (`_planDecoScheduleText`),
distinct from the real-schedule case both in copy and in the per-dive-card
hint (`exceededHint`, `js/planner.js`) — the "check you have the gas to
complete the stop" caveat only makes sense when there's an actual stop to
complete.

**Real bug, caught live-testing:** the planned bottom segment itself (the
one fed into `decompression()` as input) is a flat, non-zero-depth
segment too — shape-identical to a real stop, so an early version of
`_planExtractStops()` reported it as one (a 23 m/47 min dive showed
"47 min at 23 m, then 3 min at 6 m, then 15 min at 3 m — 65 min total",
the first entry being the entire dive, not a stop at all). Fixed by
excluding any segment at or deeper than the dive's own planned depth —
a genuine stop is always strictly shallower, since the algorithm only
ever steps up in `Options.decoStopDistance` increments toward the
surface. Worth remembering if multi-level per-dive legs are ever added:
"deeper than the shallowest intentional leg" would need to become the
exclusion rule, not "at the single planned depth."

**"How long before I can dive again?" is shown prospectively, not just after
the fact.** The recommended-minimum-interval calculation already existed for
each dive in the plan, but only ever appeared retroactively — once a next
dive had already been typed in with a guessed entry time, only to be told it
was too soon. `nextDiveHint` (`planCalculateSurfacePlan`) runs the identical
calculation one more time next to "+ Add dive", using the last successfully-
evaluated dive's own depth/time as a reference profile ("if repeating
something similar"). Deliberately not a separate hardcoded rule of thumb for
"how long after a deco dive" — it's the same physically-modelled tissue
calculation every other interval in the plan already uses, which naturally
recommends a longer wait after a dive that went into deco (more residual
loading) without any special-casing. Uses `lastEvaluated`, tracked
separately from `_planDives[_planDives.length-1]`: if a later dive errors
out and breaks the loop, the array's last element is a dive that was never
actually evaluated — the reference has to be whichever dive `prevTissues`
actually came from.

**Real (not just recommended) surface intervals now feed the calculation.**
`entryTime` was previously display-only — the badge always evaluated against
the prescriptive minimum interval, never against what the diver actually
typed for the next dive's start time. If both dives in a pair have entry
times set, the real elapsed gap (`_planMinutesBetween`) is now what gets
evaluated; going in sooner than recommended shows the real (lower) NDL and
any resulting stop, with the recommended interval kept alongside as a
contrast note, never as a gate that blocks the shorter gap from being
entered at all.

---

### Off-gassing recommendation: tissue-based "90% cleared", not NDL-fit (2026-07-21)

**Decision:** The surface-interval / re-entry recommendation is "how long
until your body has off-gassed", read from the vendored engine's 16 ZHL-16
tissue compartments directly — NOT "how long until the next dive fits within
no-stop limits", which is what it computed first. `_planOffgasMinutes`
(`js/planner.js`) sums each compartment's inert-gas over-pressure above the
fully-rested surface baseline and binary-searches the rest time until 90% of
it has cleared.

**Why the first version was wrong, in two escalating steps found live:**

1. The original recommendation asked "min rest so the *next* dive fits NDL".
   For a dive that's a deco dive even fully rested (planned time > fresh NDL),
   that question has no answer — surfacing "no surface interval changes that",
   which Luke correctly flagged as nonsense: off-gassing always completes in
   finite time. First fix targeted `min(planned time, fresh NDL)` — always
   finite, but still depth-specific ("cleared enough for *this* dive").

2. That depth-specific target gave 67 min for a 22.8m next dive, which felt
   far too aggressive. Root cause, verified against the engine: NDL is
   depth-dependent — the fully-rested (never-dived) NDL at 22.8m is 32 min,
   the depth's own ceiling; you cannot read 99 min NDL at 22.8m no matter how
   rested (99-min NDLs only exist at ~14 m and shallower — the "99" a diver
   sees is a shallower reading or the computer's 2-digit display cap). So
   "recovered to fresh NDL at 22.8m" (67 min) is genuinely full off-gassing
   *for a 22.8m dive*, but it isn't "body reset", which is what Luke wanted —
   a depth-INDEPENDENT measure of total residual.

**Why 90%, and why it's not an arbitrary threshold.** Calibrated against
BSAC 88's own printed Surface Interval Table (photographed, read directly).
For a hard single dive (~code G), the engine's tissue-over-pressure decay
tracks the BSAC code decay closely, and **90% cleared lands at ~3.7 h** —
squarely in the BSAC table's "decent code" region (code C-ish) and matching
Luke's own stated "4 hours is realistic". Fully clean (BSAC code A) is ~10 h
/ ~97% cleared — which no sports diver waits for, so it's deliberately not
the target. The mapping (code-G dive):

| Surface interval | engine % off-gassed | BSAC code |
|---|---|---|
| 30 min | 55% | F |
| 60 min | 71% | E |
| 90 min | 78% | D |
| 2 h | 83% | ~C |
| ~4 h | 91% | ~C/B ("decent") |
| 10 h | 97% | A (clean) |

**Depth-independent and self-scaling, like the BSAC table.** It's a property
of the dive's own resulting tissues (`prevTissues` = the previous dive's
finalTissues), independent of the next dive entirely. A harder dive, or a
repetitive dive stacked on residual, produces a longer recommendation
automatically — verified on the 3-dive test plan: dive 1 (21.7m/47min) → 3.7 h,
but dive 2 (22.8m/46min done on dive 1's residual) → 5.6 h. Cumulative by
construction.

**Clean baseline computed once, not hardcoded.** The surface-equilibrium pN2
(~0.752 bar, the fully-off-gassed target every compartment decays toward) is
obtained from the engine — rest any dived tissue set effectively forever and
read the settled pN2 — then cached (`_planCleanBaselineN2`). It's a physical
constant for the planner's fixed conditions (sea-level salt water; surface
breathing is always air regardless of dive gas), so a scalar cache is exact.
The engine only exposes rest via `RestingParameters` applied *before* a dive,
so `_planRestTissues` appends a negligible ~2 s surface "dive" to read rested
tissues back — a deliberate, documented hack.

**The % is surfaced subtly** ("Re-entry 13:29 · ~90% off-gassed"), and the
contrast note when the diver plans a shorter gap shows the real achieved
figure ("you planned 2 h 13 min · ~84% off-gassed") — the actual tradeoff,
not just "less than recommended". Rule-of-thumb fallback (a flat 60 min) is
used ONLY when a dive left negligible residual (real off-gas time rounds to
0), never as a blanket floor over a real, shorter figure.

**Colour: `--warn`, not `--danger`.** A required stop is exactly
`CLAUDE colour UI.md`'s own worked example for `--warn` — "an NDL gradient
nearing its limit... worth noticing now, no harm done yet." `--danger` stays
reserved for the one case that's a genuine dead end: an invalid gas/depth
combination the engine can't compute at all (`CalculatedProfile.errors`,
e.g. ppO2 exceeded) — rare in practice given the app only offers Air/Nitrox
21–100% at 1–50 m, but real: kept as the pre-existing "exceeds" badge/hard
stop, distinguished from "needs a stop" by checking `decoSchedule` is
non-null before choosing which colour class to render.

**Superseded scope note:** the multi-level (intra-dive) profile idea from
ROADMAP.md was considered as the first fix for "the tool reads more
conservative than my own dive computer" and designed down to a UI mockup,
then dropped in favour of this. Reasoning: BSAC/PADI tables — the reference
Luke actually plans against — use the exact same square-profile assumption
this tool already does; they don't credit a shallower tail end of one dive
either. Their simplicity comes from replacing a hard refusal with a stop
schedule, not from crediting multi-level profiles. Multi-level segments
remain a real, separate, more technical-diving-flavoured feature
(ROADMAP.md), not part of this change.

---

### Admiralty UK Tidal API: desktop-only, UK-bounded, never cached

**Decision:** Real UK tide times (vs. the offline moon-phase neaps/springs,
which work anywhere) are a Tauri-desktop-only feature, gated to a UK/Ireland/
Channel Islands bounding box, and never cached across fetches.

**Why desktop-only:** The Discovery tier requires a subscription key in an
`Ocp-Apim-Subscription-Key` header. Sending that from browser JS would either
expose it to anyone reading the page source (if hardcoded) or require the user
to paste it into every device's browser separately (if not) — and the API has
no CORS headers for browser `fetch()` regardless. Native Rust `reqwest`
(`fetch_tide_events` in `src-tauri/src/lib.rs`) sidesteps both: the key never
leaves the user's machine in a web-readable form, and native HTTP isn't subject
to CORS.

**Why UK-bounded:** Discovery's 607 stations are all UK/Ireland/Channel
Islands. There's no server-side "nearest station" search in that tier, so the
naive approach (fetch the full station list, pick nearest, fetch its events)
will happily return a "nearest" station thousands of km away for a Southeast
Asia dive site — meaningless data, and a wasted call against the 10k/month
quota. `fetchPlanTide()` (`planner.js`) checks a coarse UK bounding box
*before* calling `invoke()`, so an out-of-range location costs zero API calls,
not one. `fetch_tide_events` additionally rejects on the actual distance to the
nearest station (>400km) as a backstop for anything that slips past the box
(e.g. open water right at its edge).

**Why never cached:** Admiralty's own FAQ states plainly that caching/storing
Discovery-tier data is a breach of Crown Copyright — Foundation/Premium
(paid) tiers permit caching, Discovery does not. `fetchPlanTide()` was
originally written with a per-location cache (skip re-fetching the same spot)
and that was deliberately removed once this was found. **Do not reintroduce
any caching of Admiralty response data** — not in `localStorage`, not as an
in-memory map keyed by location, nothing that outlives the single render it
was fetched for.

---

### Calendar tide-state colour: composed from existing neutrals, not a new hue

**Decision:** The Plan calendar's spring/mid/neap shading uses only colours
already in the system — `--bg`, `--surface`, and a muted wash of Deep Water
ink — not a new reserved colour pair, and not the dive-type ramp.

**Why the obvious options were rejected:** `--accent` (the first attempt) is
reserved for interactive state — "Cerulean handles all routine interactive
state," per `CLAUDE colour UI.md` — and using it for a passive calendar shading
also turned out to be hard to distinguish from the neutral "mid" shade at low
opacity. The dive-type ramp's ten hues were considered (Luke asked directly)
and rejected: reusing one of those hues for tide state would mean the same
colour means two unrelated things depending on context, undermining the "one
hue, one meaning" vocabulary the ramp exists to provide. Two brand new reserved
colours (a grey/rose pair) were mocked up and offered, but rejected in favour of
staying inside the existing neutral tier entirely.

**What shipped:** mid and neap render identically and blend toward the page
background (`--bg`)/card surface (`--surface`) — neither needs to alert the
user, so there's no value in making them visually distinct from each other.
Spring gets a muted wash of Deep Water (the ink colour already used for body
text and `--border-strong`), tuned by eye for visibility rather than a fixed
opacity rule. This is "compose from neutrals," not the policy's "genuinely new
need" escape valve — no new token was added to `:root`.

---

### `--text-dim` is miscalibrated for real content, app-wide (partially fixed)

**Finding:** `--text-dim` (`#B5A898` on the light theme) measures **1.9–2.2:1**
contrast against the app's cream backgrounds (`--bg`/`--surface`/`--surface2`).
WCAG AA wants 4.5:1 for body-scale text and 3:1 even for large text — this is
roughly half the most lenient bar, app-wide, not just in the Plan panel. The
dark `.theme-harbour` theme's equivalent token (`#857D70`) is much better
calibrated (3.3–4.2:1) and wasn't the urgent case.

**What was fixed (v2.6):** ~50 selectors that carry real informational content
— Stats card labels, dive-detail field labels, the mobile bottom nav (Log/
Plan/History/Species/Stats — the worst case, since it's the primary navigation
on the app's primary platform), species browse-mode tabs, the R/O/C legend,
empty-state messages, sighting dates, the IUCN "DD" badge — were reassigned to
`--text-muted` (~3.3–3.8:1) or, for two safety-critical strings (the
surface-interval disclaimer and its "exceeds NDL" explanation), to full
`--text`. This was a per-selector reassignment, not a token change — neither
`--text-dim` nor `--text-muted`'s hex values were touched.

**What was deliberately left alone:** icon-only buttons, reference-index
numbers (`#1`, `#2`, dive numbers), the native `::placeholder` convention, and
everything inside the dark theme scope (already adequate).

**Open question, not resolved here:** `--text-muted` itself (~3.3–3.8:1) still
falls short of the strict 4.5:1 AA bar for the app's 12–14px type scale — it's
a large improvement over `--text-dim`, not full compliance. Whether to push
`--text-muted` itself darker app-wide (and accept the visual-hierarchy
flattening that implies — see "History timeline visual hierarchy" in
`CLAUDE.md`) is an open design call, not something to silently change as a
follow-on from this fix.

---

## Hash routing and overlay view-stack — v2.66–2.69

### Hash routing: fragments, not real paths

**Decision:** Panel navigation uses `history.pushState({ panel }, '', '#panelname')`
rather than real path routing (`/history`, `/plan`, etc.).

**Why:** This is a static single-file app deployed on Cloudflare Pages. Real paths
(`/history`) require the server to respond to them — either a server-side rewrite
to `index.html`, or a `_redirects` file. Cloudflare Pages does support `_redirects`,
but it adds a deployment-time dependency and a failure mode: a misconfigured rule
returns 404 for a URL that worked yesterday. Fragments (`#history`) are handled
entirely by the browser's own history stack — no server involvement — and
deeplinkability (the original goal) is achieved equally well either way for an app
where all content is client-rendered. The brief at `v2.7-BRIEF-mobile-nav-routing.md`
originally targeted real paths; the implementation chose fragments as the simpler
equivalent.

**`_showFromPopstate` flag:** `goPanel(name)` calls `show(name)` *then* pushes a
history entry. The `popstate` handler on the way back calls `show(name)` again.
Without a guard, the `show()` wrapper's own `goPanel()` call would push another
entry, creating a double-stack. `_showFromPopstate = true` before the `show()` call
and `= false` immediately after tells the unified `show()` patch to skip the
`goPanel()` push for that one invocation.

**`#settings` alias for the obsidian panel (v2.74):** The internal panel name is `'obsidian'` throughout the codebase (sync mode strings, `show()` calls, etc.) but the public-facing URL hash is `#settings` — a more meaningful name for the Settings & data panel. The pushState in `show()` maps `name === 'obsidian'` → `'#settings'`. The boot IIFE resolves `hash === 'settings'` back to `'obsidian'` via a `_hashAlias` object. **Do not rename the internal panel to `'settings'`** — it would require touching ~30 call sites and the sync-mode string `'obsidian'` which is stored in `localStorage`.

---

### Overlays use state-only history entries, not URL-addressable paths

**Decision:** Full-screen overlays (dive file, species profile, footage modal, edit
modal) each push a `history.pushState` entry with `{ panel, overlay: spec }` but do
**not** change the visible URL beyond `#panelname`. They are not URL-addressable;
a deep link to a specific dive file is not a goal.

**Why state-only:** Addressable overlay URLs (`#dive/128`, `#species/Chelonia-mydas`)
would require the boot IIFE to parse them and reconstruct the overlay stack from
scratch — opening the dive-file view means also loading all dives, running history
render, then opening the file on top. That is feasible but it is entirely extra
complexity for a feature that has no identified user need. The goal was just "back
gesture closes the modal instead of leaving the app" — state-only history entries
achieve that with zero routing complexity.

---

### Single popstate handler, not per-feature listeners

**Decision:** One `window.addEventListener('popstate', ...)` in `app.js` handles
both panel navigation and overlay close, in that priority order: if `_openOverlays`
is non-empty, close the top overlay; otherwise, navigate to `state.panel`.

**Why centralised:** Before v2.67, each overlay had its own Escape key handler, and
overlays set `body.style.overflow = 'hidden'` directly — meaning stacked overlays
(footage opened over species profile) would double-unlock scroll on the first close.
Centralising into one handler with a refcounted scroll lock (`_scrollLockCount`)
eliminates both problems and makes the back-button contract explicit: one back = one
overlay closes.

**The `*Direct()` pattern:** `closeDiveFile()`, `closeSpeciesProfile()`, etc. are
public functions called from inline handlers. They must not tear down the DOM
directly — they just call `closeTopOverlay()` → `history.back()`. The actual teardown
(`closeDiveFileDirect()`, etc.) is called only from the `popstate` handler, after
the history entry has been popped. This ensures the history stack and the DOM stay
in sync even if a close is triggered from an unexpected code path.

---

### Species → footage link: Tauri-only

**Decision:** In the species profile, clip rows are tappable only when `isShell()`
(the Tauri desktop app). On the web build, they are passive `▶` rows with no
onclick.

**Why not on web:** The footage modal requires the File System Access API to locate
and stream video files. The web build supports this through the folder-sync feature
(Chrome/Edge desktop), but that requires an active connected folder, and managing
that dependency inside the species profile adds complexity with unclear benefit —
very few web users will have footage connected. The Tauri shell always has a
connected folder (or the native FFI handles it), so the feature is reliable there.
The passive-row behaviour on web is intentional, not a gap.

---

### `goToDiveFromSpecies`: lateral navigation without `history.back()`

**Decision:** Tapping a sighting row in the species profile does *not* call
`closeTopOverlay()` / `history.back()`. Instead `goToDiveFromSpecies(diveId)` pops
`_openOverlays` directly, calls `closeSpeciesProfileDirect()`, switches to History
with `_showFromPopstate = true` (suppresses the `goPanel` push), then calls
`openDiveFile(diveId)` which pushes its own overlay entry.

**Why not `history.back()` + open?** `history.back()` is asynchronous — the popstate
fires on the *next tick*. There is no `await`-able API for it. Chaining a `openDiveFile`
call after `history.back()` would race with the popstate handler and could either
double-open or fail silently depending on timing. Direct teardown + immediate open
is synchronous and reliable.

**Side effect:** A stale species-profile entry remains in the browser history
stack (the state-only pushState that `openSpeciesProfile` created is now orphaned).
The `popstate` handler handles it gracefully: when the user presses back from the
dive file, `_openOverlays` is empty (the dive file was the last entry), so the
handler falls through to `show(state.panel)` — which is `species`, the correct
destination. The stale entry is transparent to the user.

---

## Background texture system — v2.72.2

### Three-layer architecture

**Decision:** The app uses three distinct texture layers, each with a specific visual job:

1. **Depth gradient** (`body::before`, `position: fixed`, `z-index: -1`) — unconditional, every page. Warm cream fading to deep teal — evokes the underwater environment and gives the app a sense of place. `position: fixed` means it fills the viewport without scrolling with content.
2. **Caustics shimmer** (`::after` pseudo-element on stat/card surfaces) — animated GPU-composited radial gradients that simulate light refracting through water. Applied to data bubbles (`.df-data-col`), the data band (`.df-band`), history timeline cards (`.dD-card`), and chart stat tiles (`.st-tsc .c`). Not applied to text-heavy surfaces.
3. **Sun-on-water mesh** (static radial gradient, no animation) — texture without motion. Applied to text-heavy informative surfaces: journal blocks (`.df-notes-block`), the welcome card (`.welcome-card`), and settings form sections (`.form-section`).

**Why three layers rather than one:** Each layer serves a distinct contrast/attention role. The gradient sets the environmental tone; the caustics reinforce the "this surface holds data worth examining" signal; the mesh adds tactility to text surfaces without motion-induced distraction.

---

### Do not add caustics to text-heavy surfaces

**Decision:** The caustics shimmer is deliberately **not** applied to the journal, welcome card, or settings sections. Those get the static mesh instead.

**Why:** Animated texture behind body text competes with reading — the brain must suppress moving peripheral information while tracking text, both in the visual attention channel. Static texture adds materiality without that cost. The caustics are reserved for surfaces that "hold numbers" (stat bubbles, timeline cards, chart tiles), where a quick glance extracts the value and the shimmer functions as a contrast enhancer.

**Do not add caustics to new text-heavy card types.** Check whether a surface holds numbers or text before choosing the texture tier.

---

### GPU animation strategy

**Decision:** The caustics animation uses `transform: translate3d + scale` on the `::after` pseudo-element, not `background-position` animation.

**Why:** `background-position` changes trigger a browser re-rasterize on every frame, with paint cost proportional to the number of shimmer elements on screen. `transform` runs entirely on the GPU compositor layer — the gradient rasterizes once, then the compositor moves it. Adding 20 timeline cards to the page costs no more CPU/paint work than having 1.

**The inset trick:** `inset: -18%` extends the `::after` gradient 18% beyond the host element's boundaries. The animation drifts `translate3d(3%, 2.5%, 0) scale(1.1)` — always within the oversize gradient, never revealing its edge.

**Required isolation triad:** Every shimmer host needs `position: relative; isolation: isolate; overflow: hidden`. Without `isolation: isolate`, the `::after` (z-index: 0) can bleed outside the element's stacking context. Without `overflow: hidden`, it extends past the element's border. Child content needs `position: relative; z-index: 1` to sit above the shimmer.

---

### The single `--shimmer` dial

**Decision:** One user-facing value (`--shimmer`, 0–1) controls both shimmer opacity and animation drift speed simultaneously via `calc()` derived properties in `:root`:

```css
--tex-shimmer-opacity: calc(var(--shimmer) * var(--shimmer-opacity-max));
--tex-drift-speed: calc(var(--shimmer-speed-slow) - var(--shimmer) * (var(--shimmer-speed-slow) - var(--shimmer-speed-fast)));
```

Four developer-tunable coefficients in `:root` set the feel curve:
- `--shimmer-opacity-max` — peak contrast at full dial (contrast ceiling)
- `--shimmer-speed-slow` — animation cycle duration near zero (calm end)
- `--shimmer-speed-fast` — animation cycle at full (lively end)
- `--shimmer` — the default starting position (currently 0.6)

The user slider in Settings → Appearance only sets `--shimmer`. To change the feel of the full range, adjust the coefficients — the slider's response rescales automatically.

**Why one dial rather than two:** The perceptual experience of shimmer is a blend of brightness and motion speed. Dialing one up without the other feels wrong — fast motion at low opacity looks mechanical; bright glows that barely move look painted on. A single number that drives both via a linear mapping reflects how intensity is actually experienced.

**Persistence:** `setShimmer(v)` in `app.js` sets `--shimmer` on `:root` via `document.documentElement.style.setProperty` and persists to `localStorage('divelog-shimmer')`. A boot IIFE re-applies the saved value before first paint so there is no flash of the default shimmer. The Settings slider reflects the saved value on panel open.

---

## Sidecar filename hygiene (`BRIEF-sidecar-filename-hygiene.md`)

### Coordinated canonical renaming, not a live filename

**Decision:** The dive `.md` filename is derived from `divenum` + `site` via `canonicalFilename(dive)` (`js/app.js`), but it is **not** recomputed and rewritten on every keystroke or every render — only compared against the dive's recorded `_filename` at the moment of an actual backend write (`writeToFolder` / `pushToObsidian`). A mismatch means divenum or site changed since the last save; that's when a rename fires.

**Why not just always derive the filename live and never store `_filename` at all:** sidecar *discovery* (`.footage.json`, future `.profile.json`) needs a filename to look up, and doing that lookup against a value recomputed on the fly would race with the debounced/deferred nature of saves — the sidecar loader could ask for a name the `.md` write hasn't caught up to yet. Storing `_filename` and updating it only on confirmed write keeps discovery and the actual file state honest with each other at every point in time, not just eventually.

### Write-new-then-delete-old, always in that order

**Decision:** A rename never deletes the old `.md`/sidecar until the new ones are confirmed written. Obsidian REST and folder sync (especially Android SAF content-URIs) have no atomic rename primitive — a "rename" is always two separate operations under the hood, and if that pair happens delete-then-write instead, a crash or dropped connection between the two steps orphans the dive's data with nothing left in either name.

**Why the write-new-then-delete-old order is safe:** the worst failure mode becomes a **duplicate** (both old and new files present), not an **orphan** (neither present, or a `.md` with no findable sidecar). Duplicates are cheap to recover from — the loader dedupes by `uid` on the next sync, so a leftover old file just gets ignored, not double-counted. An orphan is a silent, undiscoverable data loss until someone notices footage that won't load. Given a choice between "occasionally leaves a harmless stale file behind" and "occasionally loses data with no error," the former is the only acceptable failure mode for a rename that fires automatically, unattended, on every save.

### Collision suffix over silent overwrite

**Decision:** If the canonical name is already held by a *different* dive's `uid`, `canonicalFilename` appends a `uid` suffix rather than writing anyway.

**Why this matters:** before this change, two dives that happened to land on the same `divenum` + `site` (a manual numbering mistake, or two dives logged at the same site before a number was corrected) would silently clobber each other's `.md` on save — whichever wrote last won, with no warning. The suffix path trades a slightly uglier filename in the rare collision case for the guarantee that a save can never silently destroy a different dive's file.

### Why this lands before dive-profile import, not alongside it

**Decision:** This is deliberately scoped as *general* app hygiene — it fixes the footage sidecar and heals filename drift that exists in the vault today, with zero dependency on profile import. `BRIEF-dive-profile-import.md`'s `.profile.json` sidecar then inherits the same coordinated-rename safety for free, simply by being another entry in the set `_cleanupOldDiveFiles` moves — no profile-specific renaming logic needed when that brief is built.

**Not yet built (optional, see the brief):** a one-time "normalize filenames" repair pass for dives that drifted *before* this landed and haven't been re-saved since (coordinated renaming only heals a dive the next time *it* is saved); and the deeper guardrail of sidecar discovery-by-content-scan (reading each sidecar's internal `diveUid` instead of deriving the expected name from `.md` filename) for full resilience against a filename changed outside the app entirely.

---

## Dive computer profile import (`BRIEF-dive-profile-import.md`)

### Namespace-agnostic XML parsing, not an assumed prefix

**Decision:** `parseUddf()` walks the DOM by `element.localName` (`_localName`/`_firstEl`/`_allEls` helpers) rather than querying for a fixed tag name or an assumed `uddf:` namespace prefix.

**Why:** UDDF is exported by many different tools (Dive Exporter, Subsurface, MacDive, vendor apps), and the spec's own examples are inconsistent about whether the root `<uddf>` element declares a default `xmlns`. `getElementsByTagName('waypoint')` would silently return nothing if a file happens to use a namespace; `localName` strips any prefix/namespace automatically and works either way. Verified against a synthetic file built directly from the spec's own examples (a Node + jsdom harness, not the shipped app — see the parser's own header comment) before trusting this against a real export.

### `<decostop>` for the safety-stop signal, not `<alarm>` text

**Decision:** Safety-stop / deco events are detected from the structured `<decostop kind="safety|mandatory" decodepth="…" duration="…">` element, not from `<alarm>` content.

**Why:** The UDDF spec documents `<alarmtype>` as "a simple integer value... assigned inside the hardware to a certain alarm pattern" — vendor-specific and not standardised, so parsing it reliably across different computers isn't realistic. `<decostop>` is a properly-typed, spec-defined element with an explicit `kind` attribute distinguishing a safety stop from a mandatory decompression stop — a far more reliable signal, and it's exactly the data the not-yet-built chart (Phase C) needs to highlight the safety-stop phase.

### Auto-attach threshold is asymmetric — solo candidate vs. a runner-up

**Decision:** `matchToLoggedDive()` uses a *lower* score bar to auto-attach when a parsed dive has exactly one plausible logged-dive candidate (`AUTO_ATTACH_SCORE_SOLO`, 0.55) than when a runner-up exists at all (`AUTO_ATTACH_SCORE` 0.75 + `AUTO_ATTACH_MARGIN` 0.15 clear air over it).

**Why:** This was found empirically, not designed up front. A test harness (synthetic UDDF matched against synthetic logged dives, run via Node + jsdom before this ever touched the real app) showed a solo, unambiguous candidate with a solid depth+time match — no date corroboration available — scoring 0.74, just under the original single 0.75 threshold, and so failing to auto-attach for no good reason. The margin-over-runner-up check exists specifically to guard against picking the *wrong one* of two confusable dives; when there's no runner-up at all, there's no wrong pick to guard against, so demanding the same high bar there only adds unnecessary confirm-clicks to the common case (someone imports one recent dive, there's one obvious match). The two-threshold split keeps the strict bar exactly where it earns its keep — genuine ambiguity — without penalizing the unambiguous case.

### Review list is inline, not a modal in the overlay view-stack

**Decision:** Ambiguous parsed dives needing a manual pick render as a lean inline list (`#profile-review-list`) in the Settings & data panel, not a `.modal-overlay` wired into `_pushOverlayState`/`closeTopOverlay`.

**Why:** The overlay view-stack (`DECISIONS.md` → "Hash routing and overlay view-stack") exists so Android back-gesture and Escape close modals predictably — worth the integration cost for frequently-opened surfaces like the edit modal or footage modal. A profile-import review list is opened rarely (once per dive-computer sync, typically after a trip) and disappears on its own once every ambiguous dive is resolved or skipped. Wiring it into the overlay stack would be real integration work (a new `spec.type` case in the `popstate` handler, scroll-lock bookkeeping) for a surface that doesn't need back-button semantics — it already lives inline on a panel the back button already navigates normally.

### Phased delivery: parser + matcher + sidecar first, chart later

**Decision:** This landed as parsing, matching, and `.profile.json` sidecar storage — fully wired into the coordinated-rename and delete-cleanup paths — with the depth/time chart (`BRIEF-dive-profile-import.md` Phase C) deliberately not built yet.

**Why:** The brief's own phasing already separates "headless, unit-checkable" work (Phase A: parser + sidecar I/O) from UI work (Phase B/C). Chart quality benefits enormously from iterating against a *real* dive computer export — waypoint density, temperature presence, how a real device's `<datetime>` actually formats — none of which a synthetic test file, however spec-accurate, can fully stand in for. Shipping the data-capture half first (which the synthetic-file test harness could validate with real confidence) and holding the display half for a real sample avoids building a chart twice.

### Two entry points sharing one matching engine, not two separate features

**Decision:** Settings & data's "Add profiles to dives you've already logged" and the Log-a-dive page's "Just dove?" banner both run the exact same `matchToLoggedDive()` pass over the exact same `dives[]`. The only difference is what happens to a parsed dive with *no* existing match: Settings just skips it (with a hint to use the other entry point instead); the Log page falls through to pre-filling the form as a new entry.

**Why:** Luke's original ask ("it needs to be on the Log a Dive page") could have been built as a second, independent import path. Sharing the matching engine instead means re-importing the same file from the Log page can never create a duplicate of a dive already logged by hand — the match pass runs first regardless of entry point, so "no existing match" is the only condition that ever triggers the new-dive flow. Two entry points, one source of truth for "has this dive already been logged."

### GPS pre-fill reuses `lfSetPin`, doesn't reimplement it

**Decision:** When a parsed UDDF dive resolves GPS coordinates, `_prefillLogFormFromProfile()` calls the existing `lfSetPin('f', lat, lng, true)` (`js/logform.js`) rather than setting `f-gps-lat`/`f-gps-lng` directly and re-deriving the map/reverse-geocode behaviour itself.

**Why:** `lfSetPin` is already the single function the map-tap and "Use my location" paths call — it repositions the Leaflet marker if the map is live, updates the coordinate display text, and (with `geocode=true`) kicks off the same debounced Nominatim reverse-geocode that suggests Country/Region. Calling it directly means a UDDF-sourced pin behaves *identically* to a manually-placed one — same confirm affordance, same offline fallback — with no risk of the two paths drifting apart over time.

### Site references resolved by ID lookup, not by position

**Decision:** `_parseSiteLookup()` builds a map of every `<site id>` with valid geography *before* parsing any dive, and `_parseOneDive()` checks each `<informationbeforedive><link ref="…">` against that map rather than assuming (e.g.) "the first `<link>` is the site."

**Why:** Verified against the spec (not assumed) that UDDF's `<link>` element is generic — the same element is used for both buddy and site cross-references within `<informationbeforedive>`, disambiguated only by which ID namespace the `ref` actually resolves in. A position-based assumption ("first link is the site") would silently misattribute a buddy reference as GPS on any file that lists buddies before the site, or has no site link at all. Confirmed correct against a synthetic file with both a buddy link and a site link present, in that order.

### Chart colour: NDL headroom only, ascent-rate colour dropped

**Decision:** The depth curve's only colour-driven cue is proximity to no-decompression limit (NDL) — a gradient from a calm blue with time to spare, warming as the limit nears, to a hard danger red the instant NDL hits zero. A separate ascent-rate colour cue (green/amber/red keyed to metres-per-minute), explored in the design-study mockups, was cut.

**Why:** Luke's rule for this chart is that it has to look nice, not like an instrument panel — reviewing five design-study cases (`mockups/Dive Profile Chart mockup.pdf`) against that rule, a curve carrying two independent colour signals at once (NDL state and ascent rate) read as busier than one signal well executed. NDL survives because it's the single most safety-relevant read a recreational diver takes from a profile shape; ascent rate is dropped as a *colour* mechanic, not necessarily as data — a plain, uncoloured stat/annotation can still surface the number if wanted later.

**Feasibility caveat, checked before committing to this:** the NDL gradient needs a per-waypoint remaining-NDL value (UDDF `<nodecotime>`, nested inside each `<waypoint>`). Grepping the five UDDF files already used to test `js/profile.js` this session, only one — a rebreather (APD-style) export with rich per-sample telemetry (`cns`/`otu`/`scrubber` alongside it) — actually carries it. The real Subsurface trimix file tested earlier (the one that surfaced the gas/tank parsing gap) has none. Per the existing "no deco recomputation" boundary (`BRIEF-dive-profile-import.md` §3), there's no computed fallback — a dive whose file lacks `<nodecotime>` simply renders the curve in one neutral colour, the same graceful-omission pattern already used for temperature (below) when a dive has none.

### Temperature: two anchored points on the curve, not a continuous trace + axis

**Decision:** Surface temperature (first waypoint) and minimum temperature (across all waypoints) render as small labelled points sitting directly on the depth curve at the times they occurred — not a second dotted polyline with its own continuous right-hand axis, which the design-study mockups originally explored.

**Why:** A full temperature trace needs a second data series, its own axis scale, and per-sample temperature data that many real exports don't carry at every waypoint — more surface for a value Luke described as "not the most interesting information... I just want to know what the temperature was." Two anchored points reuse the same label convention the chart already needs for other moments (e.g. "max 24.5 m" at the depth trough), rather than introducing a second visual language just for temperature.

### The floating stat band is replaced, not duplicated, when a profile exists

**Decision:** On a dive with an imported profile, the chart's own readout strip (max depth, duration, avg depth, min temp, SAC-beside-gas) fully replaces the existing floating stat-bubble band from the v2.72.2 dive-file redesign — it does not sit alongside it. Dives with no profile keep today's stat-bubble treatment unchanged.

**Why:** Chosen over keeping a permanent slim band (which the design study also modelled) because max depth and duration appearing twice on the same screen reads as redundant once the chart already carries them at full fidelity, and every value in the profile card's strip is either data the profile computed directly or already promoted from the existing stats path — nothing is lost, just not repeated. Visibility is the one exception: it's a *condition*, not something the profile measures, so it moves to the Conditions card where it already lives.

### Smoothing is fixed, not a user-facing control

**Decision:** The depth curve gets one baked-in smoothing behaviour (light corner-rounding only — it never resamples away real texture like a sawtooth or yo-yo profile) with no exposed Smoothing or Curve-weight setting, even though the design-study mockups used both as adjustable tweaks to demonstrate the design against different inputs.

**Why:** Matches the brief's own "static curve first" phasing for this build (`BRIEF-dive-profile-import.md` §7) and the project's general bias toward few user-facing settings — the `--shimmer` dial (`DECISIONS.md` → "Background texture system") is the deliberate exception, not the norm. The mockup's tweaks were a design tool for producing the case studies, not a scoped feature.

---

## Species profile modal — clip list layout

### Clip rows are block-level, not `inline-flex`

**Decision:** `.sp-video-ref` (each `▶ filename @ timestamp — note` row inside a species' expanded clip list) is `display: flex`, not `display: inline-flex`. `.sp-clip-note-inline` additionally gets `flex: 1 1 auto; min-width: 0` so a long note wraps within its own row instead of overflowing.

**Why:** With `inline-flex`, rows wrapped like words in a paragraph rather than stacking as list rows — a clip with a note was a "wide word" that forced a line break, while note-less clips packed two or three per line around it, with no consistent left edge. On a well-filmed species (e.g. a shark with 15+ clips across several dives) this read as a jumbled mess rather than a scannable list (reported directly against the Whitetip reef shark profile, 2026-07-08). Switching to block-level flex makes every clip row full-width and left-aligned regardless of whether it carries a note; the note's own `flex: 1 1 auto` lets long text wrap in place rather than pushing the row wider than the modal.

**Considered and deferred:** a caption-style layout (note on its own indented line below the filename) and a grid-aligned column (all notes starting at the same x-position, table-style) were both raised as options. Inline-suffix was chosen as the simpler fix to try first, since the block-level row change alone removes the actual bug; the fancier layouts remain options if the inline form still feels cramped in practice.

### Modal width — 820px, not 680px

**Decision:** `#species-profile-modal .modal` max-width raised from 680px to 820px (desktop only — mobile was already governed by viewport width, not this cap).

**Why:** On a large desktop window the fixed 680px cap left the clip list (and its notes) cramped well short of the available space. A flat width bump was chosen over a viewport-relative cap (e.g. `min(900px, 90vw)`) for simplicity; revisit if very large monitors still feel tight.

---

## Tauri folder pickers need an explicit `default_path`

**Decision:** The shared Rust `pick_folder` command (`src-tauri/src/lib.rs`) takes an optional `default_path`, and every JS caller that already has a relevant folder (`setDiveFolder()`, `exportAllDives()`, `connectProxyFolder()`) passes it — `setDiveFolder()` in particular always passes the currently-configured `divelog-shell-vault-path` when one exists.

**Why:** One `pick_folder` command is shared by three unrelated features, and macOS's native folder panel remembers "last visited directory" as shared OS-level state with **no per-purpose isolation** — not scoped to which JS function invoked it, and not scoped to the app's own logic. In practice this meant picking a `.uddf` file via the plain `<input type=file>` used for dive-computer import (a completely unrelated flow) could leave the *next* `pick_folder` call — reconnecting or changing the dive-sync vault — defaulting to wherever that file picker last opened (e.g. Downloads). If the user didn't notice and just confirmed, dive sync silently repointed at the wrong folder with no error, no warning, nothing indicating anything had changed. Reported directly (2026-07-09): a user's folder sync had drifted to their Downloads folder, `renderSyncStatus()`'s "Could not read folder" message was accurate but gave no hint as to *why* it had changed.

**Confirmed not the reconnect flow:** `reconnectDiveFolder()` only re-requests permission on the already-cached handle (`getWritableFolderHandle()` → `handle.requestPermission()`) — it never opens a fresh picker, so it can't be the mechanism. The drift can only happen via an explicit `setDiveFolder()` call (the "Change folder" button), with the native panel's stale default doing the damage silently once the dialog is open.

---

## `downloadBlob()` silently no-ops in the Tauri shell — needs a native "Save As" path

**Decision:** Single-file exports in the Tauri shell go through a new `save_file_dialog` Rust command (a native "Save As" dialog returning a chosen path, mirroring `pick_folder`'s shape) + the existing `write_text_file`, gated on `isShell()` — never assume `downloadBlob()` (the `<a download>` + blob-URL trick used everywhere else) works universally. See `exportUnvalidatedSpecies` (`js/species.js`) for the reference implementation of the branch.

**Why:** `downloadBlob()` works in every real browser, including the browser build of Shoal. It does **not** work in WKWebView, the native webview the Tauri desktop shell uses on macOS — clicking the anchor element produces no error, no dialog, no download, nothing. Discovered 2026-07-09: the "Export unvalidated species" button reported a clean success message (the JS ran to completion, the blob was created, the anchor was clicked) but no file appeared anywhere in the Tauri app. This is a silent failure mode, not a crash — easy to ship without noticing unless the feature is actually exercised inside the shell, not just the browser.

**Implication:** any future export/download feature must be built with an explicit `isShell()` branch from the start, not added as an afterthought once someone reports "it doesn't work in the desktop app." `exportAllDives()` already had this for its folder-based multi-file case (native `pick_folder` + `write_text_file` loop); this decision extends the same pattern to single-file exports via `save_file_dialog`.

---

## Species database AphiaID audit (2026-07-20) — 806 of 1,279 entries had the wrong WoRMS AphiaID

**What happened:** Found live while building the OBIS region-tagging enrichment script (`scripts/fetch-species-regions.py`) — its `taxonID`↔`aphiaId` join assumes `aphiaId` uniquely identifies one species, and a sanity check on that assumption surfaced 90 aphiaIds shared by 2+ genuinely different species (e.g. aphiaId 105833 stored against both "Eucrossorhinus dasypogon" and "Hexanchus griseus" — a wobbegong and a sixgill shark). Fixing just those 198 colliding rows (`scripts/fix-duplicate-aphia-ids.py`) surfaced 24 *more* collisions once applied — proof a row can hold a wrong-but-currently-unique id and never get caught by a "shared id" scan at all (e.g. "Amphiprion clarkii" was stored under 219650, which genuinely belongs to "Acanthurus guttatus" — the two just hadn't collided yet). That escalated to a full pass: every one of the 1,279 stored scientific names checked individually against WoRMS by exact match (`scripts/validate-species-aphia-ids.py`).

**Result:** 462 already correct, 806 had the wrong aphiaId and were corrected, 7 were real species stored under an outdated/misspelled WoRMS name and were renamed (scientificName + aphiaId both — e.g. "Bornella stellifer" → "Bornella stellifera", "Pictichromis magna" → "Pictichromis porphyrea"; each confirmed individually, not fuzzy-guessed), and 4 had no WoRMS match under any spelling checked and were deleted per explicit instruction ("if it doesn't exist in WoRMS then delete it, we need the data to be clean") — "Chromis mccullochi", "Eviota pallifer", "Heteroconger aurora", plus a duplicate created by one of the 7 renames that turned out to collide with an already-correct row (see the script's `NAME_OVERRIDES` comment for that one). 1,275 species remain. 7 duplicate-aphiaId pairs are left in the DB deliberately — each confirmed via WoRMS as a genuine current-taxonomy synonym (e.g. "Hippocampus severnsi"/"Hippocampus pontohi" — already known, see `fetch-iucn.py`'s `SYNONYM_FALLBACKS`), i.e. two real historical/common names for what WoRMS now treats as one species, the same shape as the pre-existing "Humphead wrasse"/"Napoleon wrasse" entry.

**Root cause:** unknown — most of the wrong ids cluster in the original tropical/SE-Asia batch (pre-dating the 2026-06/07 OBIS-checklist-sourced UK batches, which came back almost entirely clean), consistent with some kind of list-alignment error when that batch was first built, but this wasn't investigated further since the fix is a full re-validation either way, not a targeted patch.

**Effect on already-logged dives:** `frontmatterToDive` (`js/markdown.js`) matches a stored sighting against `SPECIES_DB` on scientificName OR commonName. The 806 aphiaId-only corrections are invisible to it either way (name unchanged). The 7 renames kept `commonName` unchanged, so a past sighting still matches via that fallback and silently picks up the corrected scientificName/aphiaId next time it's parsed. The 4 deletions are the one real (if narrow) risk: a past sighting of one of those specific species will no longer find a DB match at all on next parse and degrades to unvalidated free-text (same pre-existing fallback gap as case 3 in "Renaming an existing `species-db.js` entry's `commonName`..." below) — not data loss, just a lost DB linkage, and only if one of those four obscure species was ever actually logged.

**`photoUrl`/`iucnStatus` unaffected:** both `fetch-photos.py` and `fetch-iucn.py` join on `scientificName` text (iNaturalist/IUCN name search), never on `aphiaId` — so the 806 corrections carry no photo/IUCN mismatch risk at all. The 7 renamed rows are the only rows where the OLD scientificName was itself wrong, and even there the existing photos (checked: 3 of the 7 have one) were almost certainly matched via the common-name fallback both scripts already try, not the bad scientific name — spot-checked, not reprocessed.

---

## Renaming an existing `species-db.js` entry's `commonName` has live effects on already-logged data

**Decision:** Renaming an existing `SPECIES_DB` entry's `commonName` (e.g. to fix a generic name that doesn't match what users actually search for) is safe and often beneficial, but only once the following is understood — verify by running `frontmatterToDive` against synthetic data before trusting either direction on a real batch, don't reason about it in the abstract.

**Why:** `frontmatterToDive` (`js/markdown.js`) reconstructs a sighting from a saved `.md` file's YAML frontmatter, matching against `SPECIES_DB` on `scientificName` first, falling back to matching on `commonName` only when no scientific name was stored. Three distinct outcomes follow from a `commonName`-only rename, confirmed by actually executing the parser against test fixtures (2026-07-09):

1. **Sightings with a properly-stored `scientificName` are completely unaffected** — the match succeeds via the untouched field regardless of what happens to the common name. This is the normal case for anything logged with the app's current species picker.
2. **Free-text (unvalidated) sightings whose typed common name happens to match the renamed entry retroactively validate and merge with existing validated sightings of the same species**, on next reload/sync — this is the *intended* effect of the rename (it fixes the exact search-miss that created the free-text sighting), not a bug. It also means a "species logged" count can visibly *drop* after a rename batch — that's duplicate sightings of the same species finally collapsing into one count, not data loss. This surprised a real user (reported directly, resolved by re-running the parser against synthetic data matching their actual sighting shape rather than asserting an explanation blind).
3. **Sightings stored in the oldest legacy formats — a bare string with no separate scientific/common fields, or an object with only a `common` field and no `scientific` field — silently corrupt** once their stored common-name text no longer matches anything: the parser's fallback uses the raw old name string *as* the scientific name, `aphiaId` becomes `null`, `group` becomes `''`. This is a genuine pre-existing gap in `frontmatterToDive`'s fallback path — renaming a `SPECIES_DB` entry is what actually *triggers* it for a real user's data, but the underlying fragility (trusting a fallback match with no scientific name backing it) predates any specific rename. **Not yet fixed** — fixing the fallback path itself is separate work from any individual species-batch change. Flag this risk explicitly before a rename-heavy batch rather than assuming case 2 covers every sighting.

---

## Mobile dive-file segmented control: every segment gets its own border

**Decision:** `.df-seg-btn` (the mobile Marine/Overview/Notes control in the dive file) always has `border: 1px solid var(--border-mid)`, active or not — not just the active segment getting a background+shadow while the other two stay borderless.

**Why:** Reported directly (2026-07-10): people didn't realise the three labels were clickable until told, where an older version of the app (pulled from git history at v1.951 for direct comparison, not from memory) got tapped immediately by a new user. The two versions turned out to be genuinely different UI patterns, not just a restyle. v1.951's `.dd-tab` used bordered "file folder" tabs — rounded top corners, a full 1px border per tab, the active tab visibly punching through the divider into the panel below — a shape everyone recognises instantly. The v2.2 redesign replaced it with a flat segmented control where only the *active* segment has any background or border; the inactive two are bare muted text with zero chrome, indistinguishable from a static label sitting next to a highlighted pill.

**Why not revert to the old folder-tab look:** it doesn't fit the app's current visual language (established since v2.72.2's background-texture system and the general move toward softer, card-based surfaces). The fix keeps the segmented-control *shape* — a single rounded outer track — but gives every segment a real border so all three read as separate pressable regions at rest; the active one stays distinguished by its fill + `box-shadow`, not by being the only one with a shape at all. `:hover`/`:active` states added for the same reason.

---

## Manual coordinate entry on the log-form map: one block, two trigger paths

**Decision:** `#f-map-offline` (the `f-gps-lat`/`f-gps-lng` number-input pair) is dual-purpose — shown automatically by `lfShowOffline()` when Leaflet tiles genuinely fail (hides the map, warning-styled), **or** revealed by a new "✎ Enter coordinates" toggle (`lfToggleManualCoords`) while the map stays fully live. Both write into the exact same two fields `saveDive()` reads; a `manualOnly` flag on the per-prefix map state (`_ms(p).manualOnly`) tells `lfSyncFromFields()` (which runs on every form reset/prefill) whether it's safe to auto-close the panel — never while genuinely offline, always after the optional manual toggle.

**Why one block instead of two:** `f-gps-lat`/`f-gps-lng` must be singular ids (every save/prefill/reset path does a bare `getElementById`), so a second parallel pair of inputs was never on the table — reusing the existing fields was the only option that doesn't fork the data path. This also means the fields are *already* kept in sync with wherever the pin currently sits (`lfOnPin`/`lfSetPin` write into them on every drag), so opening the manual panel for a "tweak an already-placed pin" use case shows the live position with zero extra prefill code — it was already there.

**Why an explicit "Set pin →" button instead of live-updating as you type:** an early version considered debouncing straight into `lfSetPin` on `input`, matching the reverse-geocode debounce pattern elsewhere in this file. Rejected: `lfSetPin` writes `lat.toFixed(6)` back into the same input the user is mid-keystroke in, which can reformat `-8.5` to `-8.500000` and relocate the cursor while someone is still typing `-8.537` — fighting the user's own input. An explicit button avoids any live reformatting until the value is deliberately committed, mirroring the existing geocode "Confirm" button's deliberate-action pattern rather than the pin-drag's live-update pattern (dragging has no keystroke-ordering problem to begin with).

**Why `manualOnly` and not just "always reopen closed on reset":** if a user starts a new dive while genuinely offline (tiles fail, `lfShowOffline` runs) and then saves that dive, `_afterSaveReset` → `_resetLogFormFull` → `lfSyncFromFields` fires immediately afterward for the *next* entry — without the flag, that reset would silently re-hide the only way to enter coordinates while still offline, right when it's still needed. The flag lets the "hard offline" state survive a full form reset; only the optional manual toggle collapses on reset, since a user who opened it to tweak one pin isn't asking for it to stay open for the next unrelated dive.

---

## Edit-mode colour signal: section-card border tint, not a background wash

**Decision:** While `#panel-log` is in edit mode, every `.cs` section card's border switches to `var(--accent-border)` — the exact tone `.lf-loc-card` already wears permanently — instead of the default `var(--border)`. One rule: `#panel-log.editing .cs { border-color: var(--accent-border); }`.

**Why this and not a background wash or a neutral surface swap:** `CLAUDE colour UI.md`'s three-class model explicitly forbids introducing a new hue for this ("Adding colour: Don't — compose from neutrals, or reuse strictly within the three-class model"), which ruled out anything resembling a distinct "edit mode colour." Three options survived that constraint and were mocked up side by side for a direct decision: (1) this border tint, reusing `--accent`'s already-established "interactive/active state" meaning; (2) a faint `--accent-dim` wash across the whole panel background; (3) a plain neutral swap from `--bg` to `--surface2`, carrying no semantic colour at all. Luke picked (1) after comparing all three. (2) read as heavier than editing warrants — editing isn't an alert state, and a full-panel tint leaned that way. (3) was judged too quiet to reliably register at a glance.

**Why a border and not just the existing banner:** the banner (`#edit-banner`) sits at the top of the form and can scroll out of view on a long entry — Gas & equipment, Marine life, Notes are all below the fold on most screens. A per-card border persists at every scroll position, so the "editing, not logging new" signal is visible regardless of which section is currently in view, not just on first load.

---

## sw.js install must be atomic — gather every shell file before writing any of them to the cache

**Decision:** `fetchShellFile()` fetches (with retries) every `SHELL_CRITICAL` path into memory first; the cache is only opened and written to *after* every fetch has succeeded. If any file fails all its retries, the `install` step rejects with **nothing written** to the new cache version. This replaces the previous per-file `fetch().then(res => c.put(...))` pattern, where each file was written to the cache as its own fetch resolved.

**Why:** reported directly — a real phone (Android PWA), on a weak/flaky mobile connection, ended up with a service worker that had cached `index.html` but not `css/styles.css`, producing an unstyled "plain HTML, no CSS" load when offline. Root cause: `Promise.all` rejecting when *one* file's fetch fails does not undo the `cache.put()` calls that already completed for the *other* files in that same `Promise.all` — they're independent Cache Storage writes, not part of any transaction. So a single transient failure (one flaky file out of ~34 fetched in parallel) left a **permanently half-cached shell**: the install technically "failed" (this service worker never activated), but the partial cache it wrote along the way persists in Cache Storage regardless, under the fixed `CACHE` name. The next install attempt reopens that *same* cache object (not a fresh one) and only patches in whatever succeeds *this* time — so a file that keeps landing on the unlucky side of marginal signal can stay missing indefinitely, invisibly, since `register().catch(() => {})` swallows the failure with no signal to anyone. Gathering all responses before any cache write closes this gap: either the whole shell lands together, or nothing does — there is no state in between for a later install to inherit and perpetuate.

**Why also add retries (`fetchShellFile`, 3 attempts, backoff):** the atomicity fix alone would make the failure *safe* (no more broken half-cache) but not *rare* — on a weak connection, requiring all ~34 parallel fetches to succeed in one shot is a real bar to clear, especially for larger files (fonts, CSS) that are more likely to be the unlucky one than a small JS file. A few retries with backoff, mirroring the existing pattern in `writeFileInDir()` (`js/app.js`, written for the same class of problem — transient Android I/O flakiness), meaningfully raises the odds of a full install actually completing on the first real-world attempt rather than needing several separate visits to eventually get lucky.

**What's deliberately unchanged:** `cacheable()`'s redirect/non-200/cross-origin check still throws immediately and is **not** retried — per its own comment in `sw.js`, that guards against caching a Cloudflare Access login-redirect as if it were the real file, a genuine bad response, not a transient blip. Retrying that would just cache the wrong thing three times instead of once.

**Follow-up, same day — atomicity made the biggest file the bottleneck for the whole app:** the atomic-install fix above traded "silently half-broken" for "safely all-or-nothing," but on a genuinely weak connection, all-or-nothing means the install is only as reliable as its *worst single file*. Reported directly: reinstalling the PWA and testing airplane mode immediately after still showed Android's native "app is offline" screen — the app had never once finished installing. Investigated and ruled out first: Cloudflare Access gating the fetches (`curl` against the live domain returned clean unauthenticated 200s for `/` and `/sw.js`, no login redirect — Access isn't currently in the way). The actual cause was payload size: the shell was 3.45 MB total, and the two Literata font files (`Literata-VariableFont_opsz,wght.ttf` + the italic) alone accounted for 1.8 MB of that — over half — despite being used for exactly one decorative purpose (the Notes journal serif, `--serif` in `css/styles.css`, which already declares a `Georgia, serif` fallback). Under the atomic scheme, those two large, purely-cosmetic files were just as capable of failing the *entire* install — blocking History, Species, Stats, the log form, everything — as any actually-critical file.

**Decision:** split the shell into `SHELL_CRITICAL` (everything the app needs to function — HTML, CSS, all JS, species DB, vendored Leaflet/scuba-physics, Figtree + Young Serif, which are used broadly enough that the app would look visibly broken without them) and `SHELL_DEFERRED` (currently just the two Literata files). Critical is fetched and cached atomically exactly as before and is the only thing that gates `skipWaiting()`/activation. Deferred is fetched independently, per-file, best-effort, in a separate `e.waitUntil()` — a failure there is caught and logged, never fails the install. This halves the required payload (1.72 MB critical vs. 1.73 MB deferred) without weakening the atomicity guarantee for anything the app actually needs to run.

**Why not just convert the fonts to WOFF2 instead (smaller, same fonts)?** A legitimate complementary optimization for later — it would shrink the deferred tier further without touching this tiering logic at all — but it needs a font-conversion step (new tooling) this fix didn't need, and doesn't address the structural problem: *any* sufficiently large or unlucky file in an all-or-nothing set can still take the whole app down with it. Tiering fixes that categorically; compression alone would just move the threshold.

**Why Figtree and Young Serif stay critical despite also being fonts:** size and blast radius. Figtree is ~124 KB combined (regular + italic) and is `--sans`/`--mono` — the primary font for body text, buttons, and every form field; Young Serif is 105 KB and is `--display`, used for headings across every panel. Both are small relative to Literata and both would make the *entire app* look wrong immediately, everywhere, not just one section — unlike Literata, which is large and single-purpose. The line is drawn on blast-radius-if-missing, not simply "is this a font."

---

## `/index.html` must never be a SW cache key — Cloudflare Pages 308-redirects it, which fails `cacheable()` and killed every production install for a month

**Decision:** `'/'` is the single canonical cache key for the app shell. `/index.html` appears nowhere in `SHELL_CRITICAL`/`SHELL_DEFERRED`, and the navigation fetch handler matches and revalidates `caches.match('/')` / `c.put('/', …)`. A comment above `SHELL_CRITICAL` in `sw.js` enforces this; do not "fix" it back.

**Why — the actual root cause of the offline-PWA failure (2026-07-12):** Cloudflare Pages serves clean URLs by answering any request for `/index.html` with a **308 redirect to `/`** — always, for everyone, on any connection. The SW's `cacheable()` rejects every redirected response; that guard was added in 2.394 (2026-06-12) to stop an expired Cloudflare Access session's login-page redirect being cached over real assets — a correct rule that cannot distinguish a hostile redirect from the host's own benign clean-URL one. With `/index.html` in the shell list, the install step therefore failed **deterministically on every attempt in production from 2.394 onward**: not weak signal, not flaky fetches — the same file, the same rejection, every time, for a month of deploys. Under the pre-2.831 non-atomic install this produced permanently half-populated caches (and phones pinned to an *ancient* still-activated worker serving its stale cache — the reported "loads an older version" mystery); under the 2.831 atomic install it produced a clean zero-cache failure — Android's native "Shoal is offline" screen on every offline reopen, even after installs on perfect WiFi.

**Why no local test ever caught it:** every local dev server (`python3 -m http.server`, Tauri dev) serves `/index.html` as a plain 200 — no redirect — so the install always succeeded locally. The bug existed *only* against the production host's URL handling. It was finally isolated by `curl -sI https://diveshoal.com/index.html` (308, `location: /`) after the user's observation forced the right question — "is it possible it's simply not caching anything?" — which was exactly correct.

**How the fix was verified (pattern worth repeating for any future SW change):** a local server simulating the Pages redirect (`scratchpad cf-pages-sim.py` pattern — `SimpleHTTPRequestHandler` with `/index.html` → 308), plus a Node harness extracting the real `cacheable()`/`fetchShellFile()` from `sw.js` and running the install pipeline against both the simulator **and the live diveshoal.com** (old shell list: `not cacheable: /index.html`, 0 cached; fixed list: 33/33), plus a full browser pass — install completes, kill the server, reload, app boots fully styled from cache. **Testing a service worker against a plain dev server is not testing it** — the host's redirect/header behaviour is part of what's under test.

---

## Live SW-cache testing gotchas (found repeatedly this session — worth not re-discovering)

### Navigating to the same URL fragment is a no-op

Navigating to a hash that only differs from the current one, or is identical to it, does not reload the document — fragment-only navigation on an already-loaded page just scrolls to an anchor (if any) and fires `hashchange`; every already-loaded script keeps running unchanged. This bit live verification twice in one session: a code change was made, the browser was "navigated" back to `#history` (already on `#history`), and the old in-memory JS kept running with zero indication anything was wrong. `location.reload()` is the only reliable way to force a real reload from script — not a navigate call to the same or even a different hash on the same document.

### An active service worker's cache-first fetch ignores the page's own `cache: 'no-store'`

`sw.js`'s fetch handler does `caches.match(e.request).then(cached => cached || fetch(e.request))` — cache-first, unconditionally. A page-side `fetch(url, { cache: 'no-store' })` does not bypass this: the SW's own `caches.match()` runs first and, if it finds an entry, returns it regardless of what cache mode the original request asked for. Compounding this, `sw.js`'s own install-time `fetchShellFile()` calls are plain `fetch()` with no cache override, so if the browser's HTTP cache happens to have a heuristically-fresh copy of a just-edited file (python's `http.server` sends no `Cache-Control` headers, so this is more likely than it sounds during a rapid edit/reload testing loop), that stale copy gets baked into the SW's Cache Storage at install time and then served indefinitely, immune to `cache:'no-store'` from the page. Confirmed diagnosis: `curl` direct to the dev server showed correct bytes while the browser's `cache:'no-store'` fetch — intercepted by the SW — showed stale ones. Fix for live verification: after bumping `CACHE` in `sw.js` and reloading, if a change still doesn't show up, force-repopulate the specific cache entry directly — `(await caches.open(cacheName)).put(path, await fetch(path + '?bust=' + Date.now(), { cache: 'no-store' }))` — then reload again. A cache-busting query string is what actually guarantees a true miss at both the SW Cache Storage layer and the browser's HTTP cache layer; `cache:'no-store'` alone guarantees neither once a SW is in control.

---

## BLE dive-computer sync — v2.86–2.89

### Cancel-safe salvage already made "sync in pieces" safe — only the messaging didn't say so

Cancelling a first/full BLE sync partway through was built to salvage whatever dives had already been collected (v2.87) rather than discard them. The open question was whether resuming later would create duplicates or a confusing renumbering exercise. It doesn't, by construction: a cancelled sync never gets a fingerprint stored (persistence is gated on a genuinely clean completion — see the fingerprint work earlier in this file), so the next sync is always a full re-fetch, and every dive — including the ones already salvaged — goes back through the same physical-signature match pass (`matchToLoggedDive`, depth+time+date) that already prevents duplicate imports elsewhere. Already-logged dives re-match to themselves and get silently skipped; only the genuinely new remainder surfaces. The one residual risk is that matching is a scored heuristic, not a guarantee — a genuinely ambiguous pair (two same-day dives with very similar depth/duration) could occasionally slip through as "no match" and create a stray duplicate. Given the mechanism was already safe, the fix was messaging only (v2.88): the in-progress status for a first/full sync now states the ~30–40 min expectation and says explicitly that stopping is safe and a later sync picks up the rest, and the cancelled-with-partial-results status says the same. No logic changed. A stronger guardrail (blocking or discouraging cancel outright) was considered and dropped once the dedup mechanism was traced through — it would have added friction to solve a problem that didn't actually exist.

### Bulk-add asks for the newest dive in the batch, not the one before it

The bulk-add numbering field went through two designs before landing. First attempt: ask for the dive number immediately *before* the batch ("Last dive #"), compute `start = entered + 1`. This was fully built and tested, then rejected — a diver doesn't track "the dive before my most recent batch," they track a concrete fact like "that was my hundredth dive." The field now asks for the newest dive *within the batch itself* ("Most recent dive #") and counts backward: `start = entered − (n − 1)`. A live preview (`→ #98–#100`) makes the arithmetic visible either way, but the framing itself — end-of-range the user directly states, vs. a pre-batch reference point they'd have to compute — is what changes whether the field feels natural. Both attempts had identical net behaviour for the default (no-prior-history) case; only the mental model asked of the user differed.

---

## Bulk dive selection + trip-assign — v2.89

### Two-tap range-select, not shift-click

Range-select needed to work identically on touch (no modifier key) and mouse. Rather than building a touch-specific substitute for shift-click, the interaction is modifier-free by construction: tap a dive (single-select, becomes the anchor), tap a second dive (replaces the selection with the inclusive range between anchor and tap, anchor stays fixed — mirroring shift-click's own semantics without needing the key). Tapping an already-selected dive deselects just that one and drops the anchor, so the next tap starts a fresh range rather than extending from a now-ambiguous point. Current on-screen order is read live from the DOM (`_historyDomOrder()`) rather than re-deriving sort/group logic in JS — correct under whatever sort/grouping is currently rendered, with no duplicated rules to keep in sync.

### Checkbox overlaid on the spine column, not a card corner

The selection checkbox was first placed in the card's top-right corner (`position: absolute`, kept out of the grid flow so it didn't need threading through both the mobile 2-column template and every desktop `.dh-*` column count). Live-testing at 500px width found it collided with `.dD-meas` (the mobile layout's depth/time stats, which also sit top-right). Moved onto the `.dD-spine` column instead — a consistent ~26–28px strip in both the mobile and desktop grid templates, and otherwise empty of content. An opaque `--surface`-filled square reads fine sitting on top of the spine's dive-type colour regardless of which colour that is; the original top-right placement wasn't chosen for a contrast reason that then had to be preserved, it just didn't check what else already lived there.

### Shared apply-trip helper, not a duplicated persist/re-push loop

`commitTripRename()` (rename an existing trip-header group) and the bulk-select action bar (assign a trip to an arbitrary checkbox selection) both end at the same place: set `.trip` on a list of dives, persist, re-push each to the active backend. The only real difference between the two callers is how that dive list gets derived — one re-filters `dives` by group key, the other reads the checkbox selection. Extracted the shared tail into `_applyTripToDiveList(diveList, newName)`; `commitTripRename` now just derives its group and calls it. Verified the extraction didn't change `commitTripRename`'s own behaviour via a regression assertion in the same test pass that covers the new bulk-select math.

---

## Dive-file journal block rendered twice on tablet widths — two breakpoints for one transition, out of sync

The mobile dive-file view uses a tabbed layout (Marine/Overview/Notes) below 900px, switching to a stacked always-visible layout at 900px (`.df-panel { display: block !important }`, tabs hidden). The journal/notes block's own show-the-full-width-version-instead-of-the-tab-panel toggle was separately gated at `min-width: 600px` — a copy of the app's *global* nav breakpoint (sidebar vs. bottom tab bar), not the dive-file's own 900px transition. Every other breakpoint in that part of the CSS already used 900px to match the tab system; this one rule was the sole `min-width: 600px` media query in the whole file. The result: at 600–899px (an iPad Air in portrait, 820px, is squarely in this range), the tab bar was still active but the full-width journal block was already unconditionally visible — Notes rendered twice, once (empty, force-hidden) behind its own tab, once duplicated under whichever tab was actually open. Fixed by moving the toggle to 900px, matching the rest of the transition. Lesson for future breakpoint work in this file: a component with its own internal tab/layout transition needs its *own* breakpoint respected everywhere, not the app's global one, even when the values used to coincide by accident.

---

## NDL colour legend + live/locked-deco split — v2.9

### Startup NDL artifact: don't trust a reading until real depth backs it

The very first waypoint (or two) of a dive with NDL data can read a placeholder `0` before the wet sensor trips deep enough for the computer's own no-deco calculation to genuinely start — confirmed on real hardware: `t=10s, d=0m, ndl=0` then `t=20s, d=3.5m, ndl=99`. The deco-lock detector (below) was reading that placeholder zero as "entered deco at the moment of dive entry," drawing the danger colour and the deco marker line at t≈0 on every dive that carried NDL data at all, regardless of the dive's actual profile. Fixed by not trusting an NDL reading until the waypoint it came from is past 3m depth (`ndlSeries` construction, `renderProfileChart`) — a real, if arbitrary-looking, depth gate rather than e.g. ignoring the first N samples by index, since dive computers don't all sample at the same rate.

### Live danger vs. locked deco: two colours, not one

`_ndlColor()` answers "what colour does this ndl value deserve right now" and is fully reversible — NDL recovering from 5 back up to 50 on ascent is a real, safe recovery and the colour should track it live. Separately, the moment NDL genuinely reaches zero (or, for computers that stop reporting `<nodecotime>` entirely once truly in deco, the first `<decostop>`/deco-sample event) is a one-way threshold — once truly in mandatory decompression, ascending doesn't undo the obligation, so `renderProfileChart` locks every sample from that point to the end of the dive to a colour, independent of `_ndlColor`'s own live per-sample read from then on.

First shipped with the locked state using the *same* hex as `_ndlColor`'s own danger colour. Live-testing real dive data found this ambiguous: a dive that spent a long stretch hovering near-but-above zero (still live, correctly tracking, never locked) looked identical to a dive that had genuinely committed to deco, and the vertical marker line marking the lock moment had no colour change either side of it to confirm against an already-dark backdrop. Fixed by deriving a second, darker `decoHex` (`_hexLerp(dangerHex, '#000000', 0.4)`) reserved exclusively for the locked state — a darkening of the existing `--danger` token rather than a new CSS custom property, matching how the chart's other derived shades (`calmHex`, `fillTopHex`, `fillBottomHex`) are all `_hexLerp` derivations of existing tokens, not new ones.

### Thresholds calibrated to Luke's own stated reference points, not round numbers

`_ndlColor`'s thresholds were originally 15/5/0 (arbitrary). Recalibrated to 25/15/10: calm above 25 min, full danger colour at 10 min — his own "that's when I start thinking about ascending." The 15 min midpoint isn't a value he stated explicitly; it was derived by preserving the original thresholds' 2:1 ratio between the two transition spans (10 min calm→warn vs. 5 min warn→danger, out of a 0–15 range) applied to the new 10–25 range.

**Known issue, deferred:** a later, unreviewed edit changed the warn→calm transition's upper bound from 25 to 60 min and inverted the interpolation direction (`_hexLerp(warnHex, calmHex, (60 - ndlMin) / 35)` — increasing as ndl *decreases*, the opposite of every other branch in the function). Verified numerically: at ndl=25 the colour is solid `warnHex`, but at ndl=25.1 it jumps to near-pure `calmHex`, drifting back toward `warnHex` as ndl rises toward 60, then snapping back to `calmHex` again above 60 — a hard, visible colour discontinuity at both the 25 and 60 boundaries instead of a smooth fade. Left in place at Luke's request (2026-07-16) rather than fixed inline; the one-line correction is `(ndlMin - 25) / 35`.

### Legend: a gradient bar built from the same thresholds `_ndlColor` uses, not a separate swatch list

The curve's colour was otherwise unexplained anywhere in the UI — found confusing in practice, a warm/red stretch on the line with no key nearby. `.df-pc-legend` (between the chart and the stat strip, `js/profile.js` → `renderProfileChart`, styled in `css/styles.css`) renders only when the dive actually has NDL data, and its gradient stops are literal percentages matching `_ndlColor`'s own branch boundaries so the legend can't visually drift from what the curve's live per-sample colour does. It can't represent the *lock itself* (a locked sample keeps the deco colour even once its own live NDL has recovered — that's dive history, not a function of NDL value alone, so no static bar can show it); a "0 = deco" tick at the dark end at least marks where the lock triggers.

### Colour-interpolation helpers needed to round-trip through their own output format

`_hexLerp()` returns `rgb(r,g,b)` strings (not hex), and those strings can themselves be fed back into a later `_hexLerp()` call (e.g. `calmHex = _hexLerp(rawAccent, '#ffffff', 0.35)`, then `calmHex` used again as a lerp endpoint). `_hexToRgb()` originally only parsed `#rrggbb`/`#rgb`, so any `rgb(...)`-formatted input silently failed to parse — `parseInt('', 16)` on the empty match returned `NaN`, and `NaN` masked through the bitwise `>> ` / `& 255` extraction came out as `0`, rendering as black rather than erroring. This produced the black gradient artifacts reported live against real chart data. Fixed by making `_hexToRgb()` parse both `rgb(...)`/`rgba(...)` and hex, validating hex input against a strict regex before parsing (returning `null` rather than risking `NaN` on anything malformed), and making `_hexLerp()` fall back to its first colour argument — never black — when either input fails to parse. A `_validHex()` helper was added at the CSS-custom-property read site (`renderProfileChart`) for the same reason: an empty or malformed `--accent`/`--pending`/`--danger` value now falls back to the function's own documented default hex instead of propagating an unparseable string into the lerp chain.

### Dive-profile chart colours moved from JS to CSS

`calmHex`, `decoHex`, `fillTopHex`, and `fillBottomHex` were originally computed at every chart render via `_hexLerp(rawAccent, '#ffffff', 0.35)` and similar calls — real design decisions (specific lighten/darken fractions, picked and tuned live against real dive data) that existed nowhere in `css/styles.css` or `CLAUDE colour UI.md`, only as inline JS math. This is the same category of problem as the `--type-Boat` CSS bug found the same day (a colour token silently missing with no visible trace of what broke) — a hidden colour definition that nothing in the documented colour system points to. Moved to four new `:root` tokens (`--profile-calm`, `--profile-deco`, `--profile-fill-top`, `--profile-fill-bottom`), computed once by hand to the exact same resolved hex the old runtime lerp produced (verified numerically, zero visual change) and documented in `CLAUDE colour UI.md` → "Dive-profile chart". `renderProfileChart()` now reads them the same simple way it already read `--pending`/`--danger` (`_validHex(cs.getPropertyValue(...), fallback)`) — no lerp math left for these four at all.

**Baked hex, not `calc()`/`color-mix()`:** `color-mix(in srgb, var(--accent) 65%, white)` would keep the "auto-derives if `--accent` changes" property the old JS approach had, and is supported by every browser this app targets (Chromium, WKWebView, both long past `color-mix()` support by 2026) — but `getComputedStyle(el).getPropertyValue('--custom-prop')` does not evaluate nested colour functions, only substitutes nested `var()`s; reading a `color-mix()`-valued custom property back out in JS returns the unevaluated function text, not a resolved colour, which `_hexToRgb()` can't parse. Resolving it properly needs a scratch-element trick (set the var as a real CSS property on a throwaway DOM node, read *that* node's computed colour) — extra machinery for a component with no theming yet. Matched the existing, simpler pattern instead: literal resolved hex, same as every `--type-*` ramp entry already is. Tradeoff: if `--accent`/`--danger` are ever retuned, these four need recomputing by hand (fractions are documented in the CSS comment and the colour doc) rather than updating automatically.

**Kept in JS:** the live per-waypoint blend inside `_ndlColor()` (`_hexLerp(dangerHex, warnHex, frac)` etc.) — that fraction is a function of each waypoint's actual NDL reading, genuinely data-driven, and can't be precomputed into a static CSS token. `_hexLerp`/`_hexToRgb` stay for exactly that; only the four *static* single-value shades moved out.

---

## Dive-type ramp: Wall/Night and Pinnacle/Muck collisions (2026-07)

**Reported directly:** Wall and Night look too similar in the history spine and stats donut. Neither hue-proximity problem shows up in a `var()` grep or a contrast-ratio check the way a reserved-colour violation does — both entries are individually valid categorical hexes, just too close to a *specific other member* of the same ramp. Found by eye, not tooling.

**Wall — `#27567E` → `#863C5E` ("gorgonian rose").** Measured: old Wall sat at H208° S53% L32% against Night's H225° S36% L35% — 17° of hue apart at similar saturation and lightness, exactly the range where a categorical pair stops reading as distinct at 14px. The fix widens the hue gap rather than adjusting saturation/lightness within the same blue-indigo cluster the ramp was already crowded in (Boat, Drift, Cave, and Night all sit in the 172–225° band). Landed on pink/rose (H332°) after research into what a wall dive actually looks like: gorgonian sea fans — the signature wall-dive organism — run pink, purple, lavender, red, orange, and yellow (sources: California Diving News, Dressel Divers). Purple was ruled out outright: `--violet-soft`/`--violet-deep` are reserved exclusively for IUCN EN/CR species names, and the sea-fan spectrum's purple end would either collide with that reservation or constantly invite confusion with it. Pink/rose was open territory — nothing else in the ramp, the reserved semantics, or the categorical set touches that hue range at all — and is 70° clear of the reserved violets, ~30° clear of Danger/Warn's rust-coral cluster (12–15°). Rejected alternatives: a darker slate-blue-black ("the abyss") was considered and rejected outright — it's still blue-indigo family and would just recreate the same collision, darker; a near-red burgundy was rejected for sitting only ~15–17° from Danger and Warn, risking a false "alert" read; a more purple-leaning "dusky orchid" (`#8A427E`, H310°) was rendered and rejected by Luke directly for reading too close to the reserved violet even at 48° hue separation. Two adjacent candidates from the same research (`#A34363` "sea fan pink", `#B35666` "coral blush") were deliberately not used here — reserved as options for some future non-categorical need instead.

Checked whether the runner-up "coral blush" could ever sit in the *same* ramp as the chosen Wall colour: 18° hue apart (closer than Wall/Night ever was) but separated by 14 points of lightness — the same strategy Reef and Wreck already use (near-identical hue ~23°, told apart almost entirely by lightness/saturation, an already-shipped, already-working pair). Verdict: readable side by side, but the closest pair on the whole wheel — fine as a one-off reserved colour, worth avoiding as two live ramp members at once.

**Pinnacle `#5C7355` → `#517548`, Muck `#7E7B45` → `#5E5A31`.** A different failure mode from Wall/Night: Pinnacle and Muck were already 49° apart in hue (wider than Wall and Night ever were), but Pinnacle's saturation was only 15% — low enough that hue itself barely registers, so both collapsed into "muddy green-brown" regardless of the hue gap, and near-identical lightness (39% vs 38%) removed the other cue that could have separated them. This is also the pairing most likely to break for red-green colour vision differences specifically, where yellow-green-olive hues are the hardest to tell apart even *with* a reasonable hue gap. Fix pushes saturation and lightness apart rather than hue — Pinnacle to S24% (reads as a real green now, not grey-sage) and Muck darker to L28% (reads as a deep olive, not a mid-tone). Both keep their original hue (~106°/~55°) since there was no room to move either further without drifting into Success's reserved green (147°) or Gold's reserved amber (43°).

All three replacement hexes verified against the full reserved-semantic list (accent, success, danger, warn, gold, violet-soft, violet-deep) and the other seven unchanged ramp members before being accepted — see `CLAUDE colour UI.md` → "Categorical — dive-type ramp" for the final table.

---

## Mobile dive-file tab strip: folder-tab join, not a pill switcher (2026-07-21)

**Reported directly (screenshot-driven):** the Marine/Overview/Notes segmented control read as three equally-weighted buttons, not a toggle, and felt "disconnected from the background." Root cause, confirmed by pulling the actual tokens: the whole opaque `--surface2` slab it lived in (`#EDE5D8`) sat only ~4% off the page `--bg` (`#F5EBD8`), and the active-vs-inactive difference was a further ~5% lightness step on top of that — two lightness deltas that small get eaten alive by the app's own animated caustics-shimmer texture on the live background, which the first design pass (a flat static mockup) never showed. Every segment also carried its own `border: 1px solid var(--border-mid)`, a v2.2-era fix (see the CSS comment it superseded) that made all three tabs equally boxed, so the control read as independent buttons rather than one selection regardless of the colour problem.

Three directions were mocked (elevated segmented control / underline tabs reusing the footage modal's own `.fm-mob-tab` pattern / accent-tinted selected pill matching the R/O/C abundance toggle) before Luke redirected with the actual organizing principle: *the selected tab's colour should link to its content's background colour*, so the pairing reads as "this tab IS this content," not just "this tab is currently marked active." Underline and accent-pill both failed that test outright — neither one's colour has anything to do with what's below it.

**Final construction:** the trough (`.df-seg`) is `--surface2` — deliberately the exact same recessed tone as the log form's own marine search bar (`.sp-mobile-search-btn`), not a new value — and holds only the *unselected* tabs, borderless, flat, receding. The selected tab keeps the content panel's own `--surface` white and physically overlaps the seam into the panel below it (`margin-bottom: -1px`, the standard tab-overlap technique) so the white flows unbroken from tab into content — same object, not two adjacent ones. A fine 2px `--accent` line sits right at that seam (`.df-seg-btn.active::after`), added after the join was already working: it doubles as "this one's selected" and "this is where the content starts" rather than competing with the join as a second, separate signal.

**Consequence for content, not just chrome:** for the join to be honest, whatever sits inside the selected tab's panel has to actually *be* that same white — so `.df-panel.active` (mobile only; reset to transparent on desktop, which never shows `.df-seg` at all) itself became the white surface (background/border/rounded-bottom-corners/padding), and the Notes tab's own pre-existing `.df-card` chrome (background/border/shadow/radius/margin-top) is stripped specifically inside `.df-panel--notes-mob` so it doesn't double-frame inside a panel that's now providing the identical treatment one level out. This is also what motivated recolouring the old Overview "bubbles" from `--surface` to `--surface2` in the redesign that followed immediately after (see below) — once the panel behind them turned white, white-on-white bubbles would have been invisible.

## Mobile dive-file Overview: from a uniform bubble list to a visual hierarchy matched to the data (2026-07-21)

**The complaint, precisely:** "it's just a list of information" — every field (temperature, current, a person's name, a cylinder size) got the exact same rounded-bubble treatment regardless of whether it was a number worth *seeing* or a name only worth *reading*. Luke's own framing, arrived at through several rounds of mockups: the fields that "naturally lend themselves to visual" are pressure, temperature, current, and weather — not because they're numbers, but because every one of them was *entered* through a rich control on the log form (gradient dials, a segmented toggle, an icon picker) and then flattened back to plain centred text on read. Reading a dive should use the same visual language as logging one.

**What did NOT become graphics, and why:** buddy/operator/trip/sign-off/cert-no are names — a gauge or a bar under a person's name would be decorative noise, not information, so they stayed as plain icon spec rows (`_dfSpecRow`). Visibility was the hardest case: important, but a full-width gradient dial (mirroring temperature's) would have shown it *twice* on one screen, since it already lives in the hero stat band. Tried both ways (vis duplicated in Overview vs. vis only in the hero) and Luke picked the latter — Overview has no vis tile at all now; the hero band's existing vis number grows a small `--surface`-ticker-on-gradient bar instead (`_dfVisBarHtml`, 5px tall, inset in the stat cell), at the same 0–30 m scale as the log form's own vis dial. The full-width dial-with-circular-ticker treatment (`.df-ov-tile-bar`/`.df-ov-gauge-ticker`) was kept for temperature only, where no duplication risk exists.

**The cylinder gauge (`_dfTankHtml`) went through several shapes before landing.** First a thin (16px) horizontal bar, rejected as "far too thin" once seen against the chunkier vertical mockup Luke actually preferred the proportions of; then a fat (58px) rounded-rect bar with the fill on the left and pressure numbers as a separate text line above the SVG. At Luke's request the numbers then moved *inside* the tank (200 in the empty zone, 65 in the fill zone) and the "% remaining" line was dropped as unnecessary once the numbers themselves told the story. The valve/fill flip (valve/empty-zone left, fill right) was framed by Luke as rotating the very first *vertical* mockup 90°: that version had the valve/cap at the top and the remaining-gas fill pooling at the bottom (a fuel-gauge metaphor — gas depletes, remaining volume settles low); top becomes left and bottom becomes right under the rotation. SVG fill colours use `style="fill:var(--accent)"` (not the bare `fill="var(--accent)"` presentation-attribute form) for reliable cross-browser `var()` resolution, matching why the profile chart's own colours are baked hex rather than live CSS functions (see "Dive-profile chart colours moved from JS to CSS" above) — the `style=` attribute form is the one place in this codebase inline SVG safely leans on a live theme token rather than a resolved value, because it goes through the ordinary CSS cascade rather than SVG's separately-specified (and less consistently supported) presentation-attribute parsing.

**The silhouette itself needed a second pass.** A real-device screenshot showed the taper from neck to full body reading as *concave* — a scoop/funnel, not a cylinder — because the curve's control point sat at the neck's own y-coordinate, pulling it inward instead of bulging outward. Fixed by replacing the taper with a rounded left end (radius 18) and a short neck emerging from its flat middle, keeping the profile convex throughout; the right end keeps a deeper dome so the two ends read as distinct.

**Number placement went through three real bugs, each caught by generating the actual geometry in Python and checking it, not by eyeballing a handful of examples.** (1) The original zone-relative placement (each number centred in its own zone, digit-count heuristic deciding if it fit) had a fallback direction bug: a too-big number pushed *outward* rather than inward, which ran the start number onto the valve hardware on a nearly-full tank (220→200) and clipped the end number off the right edge of the viewBox entirely on a nearly-empty one (220→5) — invisible in the one or two examples used while building, caught only once nine pressure scenarios were checked programmatically. Fixed by making the fallback always cross *inward* into the opposite zone instead. (2) Luke then asked for the numbers to hug fixed far-left/far-right positions instead of sliding with the fill, specifically because the common case (a light-usage dive, most of the tank still full) was bunching both numbers together in the middle rather than the edge case (empty tank) the zone-relative system had been tuned around. (3) Luke also asked for the two colours to be *constant* per position (start always dark, end always white) rather than adapting to what's behind them, reasoning it would be simpler and more predictable. Contrast was measured before agreeing: dark text passes AA-large (3:1) against both the empty body (11.1:1 on `--surface2`) and the fill (3.9:1) — so a constant-dark start number is genuinely safe regardless of where the fill edge lands, including when a nearly-full tank's fill swallows it. White text does NOT have that property: white-on-fill is 3.3:1 (passes) but white-on-empty-body is 1.16:1 — visually identical luminance, not merely low-contrast — so recolouring the empty body from white to beige (an earlier, simpler idea) could never have made white legible there on its own. What actually makes "always white" safe for the end number is a positioning fact, not a colour one: the fill always grows from the right, so a far-right-anchored number sits on fill for any dive that surfaced with more than ~18% of its start pressure remaining — a threshold enforced by testing each number's *left* edge against the fill boundary (an earlier version tested the number's centre, which passed the 220→35 case even though the fill boundary landed mid-digit, leaving the leading digit invisible on the empty body) with a small margin so a straddle always resolves to dark rather than a partially-invisible number. Below that floor the end number falls back to dark — a legibility floor, not a style choice; Luke was offered the option of leaving it white and simply vanishing there, and chose the floor instead.

**SAC's move and min-temp's disappearance are the same decision, told twice.** SAC rate used to live in the profile chart's own stat strip, paired with a generic gas-depletion bar Luke had already flagged as "too busy." Deleting it there and surfacing it in the tank's footer instead (reusing `sacClass`'s existing green/muted/red thresholds unchanged) is a strict move, not a duplication — nothing shows SAC in two places at once. The chart's "min °c" stat cell went the same way but by a different mechanism: rather than finding it a new home, Luke pointed out that "most people only care about the minimum temperature and not the surface [average]," and the two prefill paths that populate a new dive's logged temperature from an imported profile (`_prefillLogFormFromProfile`, `_bulkAddNewDives`) were quietly deriving an *average* (`_computeAvgTemp`, now deleted) rather than the minimum. Switching both to `_computeMinTemp` (already existed, previously used only by the now-deleted stat cell) means the Overview temp tile's `d.temp` and the profile chart's min-temp reading become the *same number* for any newly-imported dive — solving the "shown twice, possibly disagreeing" problem without inventing a second display anywhere. This only affects new imports going forward; dives already logged keep whatever average-derived temperature they were imported with, since there's no reliable way to retroactively know which raw waypoints produced it.

## Desktop dive-file journal/overview row — retiring the circular data strip (2026-07-21)

Desktop never had the mobile tab problem (no `.df-seg` there at all — Marine renders full-width, everything else stacked below it) but it had the *same underlying flaw* the mobile Overview redesign had just fixed: Conditions/Profile/Gas & equipment/Sign-off each got their own gently-bobbing circular `<dl>` list (`.df-data-strip`/`.df-data-col`, shipped v2.72.2) — uniform-weight text, no hierarchy, just in circle form instead of rectangle form. Asked "how do we apply this look to desktop," the honest answer was that the new visual language (gradient bars, a wide short tank) is inherently rectangular and would look forced bent into a circle — a real tension between reusing the established bubble motif and reusing the new mobile components. Investigating also surfaced an actual regression, independent of any design question: `eqRows`'s `gasEquipRows = profileChart ? [] : [...]` still assumed the profile chart's own stat strip showed gas/pressure/SAC — an assumption the *same session's* earlier work had just made false by deleting that cell. Result: any dive with an imported computer profile had shown **no gas/pressure/SAC/cylinder data anywhere on desktop at all**, silently, until this pass fixed it.

**Luke's own reframe dissolved the circle-vs-rectangle tension rather than resolving it either way:** the desktop journal was wider than it needed to be, and narrowing it to two-thirds width freed a column for Overview data alongside it — a column that, at the 1130px-capped `.df-body`'s 2fr:1fr split, lands at ~369px, close enough to a phone's own natural content width that the mobile components could be reused *completely unchanged*, not redesigned for a new container shape at all. `overviewContent` (`js/history.js`) renders in two places at once — the mobile-tab copy and the desktop-row copy are the same markup; only their ANCESTOR containers differ (`.df-right-col`, hidden on desktop; `.df-desk-journal-row`, hidden on mobile), so `.df-ov` itself needed no display rule of its own once the old unconditional `.df-ov { display: none }` desktop override was removed.

**The always-visible empty journal was Luke's own proposal**, arrived at while working out what should happen to the Overview column when a dive has no journal entry (today's `.df-notes-full` was gated on `hasNotes`, so a data-rich journal-less dive already showed its bubbles alone, full-width — a case the new side-by-side row had no graceful answer for without either always showing the journal or letting Overview go full-width on its own). Luke's framing: showing the journal empty **on desktop specifically** solves two problems in one move — Overview always has something to sit beside, *and* an empty, permanent, spacious block "might invite the user to write something there to fill it." Deliberately scoped to desktop only: mobile's Journal tab still doesn't exist at all when there's nothing to show (`hasNotes` gate, unchanged) — a phone's tab bar is precious real estate in a way a wide desktop column beside existing content isn't, and this was never raised as a mobile complaint. The empty state (`_notesBlockHtml(d, true)`) is a dashed, clickable card (`onclick="openEdit(id)"`, the same function the existing ✎ Edit button already calls) styled deliberately unlike a filled `.df-card` — no solid border, no shadow, no background — so it reads as an invitation to fill rather than a broken/empty version of the real thing.

**Two real bugs surfaced after this shipped, both reported directly from screenshots rather than caught in testing.**

*SAC shown twice.* The plain hero band (`.df-band`, used on any dive without an imported profile) had carried its own desktop-only SAC cell since long before this session's Overview work — a completely separate thing from the profile chart's own SAC cell, which is what "move SAC into the tank" had actually targeted. Building the tank and moving SAC into its footer only ever touched the profile-chart side; the band's own pre-existing cell was never revisited, so SAC ended up genuinely duplicated (hero band AND tank footer) on any dive without a profile. Removed outright — SAC now lives exclusively in the tank footer, matching Luke's expectation that it already did. Its removal also collapsed desktop's cell count down to exactly match mobile's (3 or 4; SAC was the one cell desktop ever had that mobile didn't), which in turn made an entire desktop-specific grid-column override (added minutes earlier to fix a different bug, see next) unnecessary — not just fixed, but deletable.

*The grid-column override it replaced had a real specificity bug, caught from a screenshot showing SAC wrapped onto its own orphaned row.* `.df-band.df-band-has-avg` (a compound two-class selector, specificity 0,2,0) was always going to beat a bare `.df-band` rule inside the desktop media query (specificity 0,1,0), regardless of source order or which media query matched — CSS resolves by specificity before it ever considers cascade position. So on any dive WITH avg-depth data, desktop stayed locked at the mobile rule's 4 columns instead of its own intended 5, and the 5th real cell (SAC, at the time) wrapped onto a new row. The fix (before SAC's removal made the whole override moot) was giving desktop's own rule the matching compound specificity (`.df-band.df-band-has-avg` inside the media query too) so it could actually win by source order once specificity was tied.

*The tank's clip-path broke from the exact same "rendered twice" structure that makes this whole desktop layout work.* `<clipPath id="dftk-${id}">` used the dive's own id as its only uniqueness key — fine when `_dfTankHtml` only ever rendered once per dive, which stopped being true the moment `overviewContent` started appearing in two places on the same page. Two elements sharing one id is invalid HTML, and `url(#id)` reference resolution under a duplicate is browser-dependent rather than reliably falling through to "first match" — the observed failure was the fill rendering as a plain unclipped rectangle, its square corners visibly poking past the tank's rounded/domed silhouette, reported by Luke as "the colours are outside the lines." Fixed by turning `overviewContent` into `buildOverviewContent(ctx)`, called once per placement with `'mob'`/`'desk'`, so `id` (and therefore the clip-path id) is genuinely unique per render — not per dive. **The general lesson, worth remembering for any future content rendered more than once on one page:** any DOM id referenced via `url(#id)` (clip-path, mask, gradient, filter, `<use>`) needs to be unique per *render*, not just per logical entity, the moment that entity's markup can appear twice.

## Stats hero bubbles — the retired dive-file motif's second home (2026-07-21)

Directly requested in the same conversation that retired `.df-data-col` from the dive file: "the bubbles motif is a cool idea and I think we should transfer that to the 6 stat boxes in the hero at the top of the stats page." A near-literal port — same `border-radius:50%`/`aspect-ratio:1` shape, same `df-bob` keyframe, same staggered per-`nth-child` duration/delay pattern extended from 4 items to 6 — with one structural difference worth recording: `.stat-card` needed to bob at **every** breakpoint (Luke: "I want the bubble treatment everywhere"), where `.df-data-col` only ever existed on desktop, so `@keyframes df-bob` moved out of the desktop-only `@media (min-width: 900px)` block it had been declared inside and up to global scope — CSS keyframes are only registered when their enclosing media query matches, so a mobile-scoped consumer referencing a desktop-scoped keyframe definition would have silently done nothing (no error, just no animation).

**The two motifs also diverged on layout, deliberately.** `.df-data-col` was a `flex-wrap` row where each bubble sized to its own content (a sparse `<dl>` stayed small, a data-rich one grew) — appropriate when the four blocks genuinely varied in how much they held. The six stat cards don't have that variance problem; Luke asked for the *existing* `.stat-grid` CSS-grid breakpoints (3-col desktop, 2-col mobile) kept exactly as they were, circular shape and motion layered on top rather than switching to a sized-to-content flex flow.

**Font size was the one real constraint circles impose that rectangles don't.** A first pass sized `.stat-value` per-card, and the widest real values — "Time underwater" (`118h 6m`) and a decimal `17.4m` avg depth — needed a smaller size than the other four to avoid touching the circle's curved edge, which read as inconsistent across six cards that should feel like one family. Luke's fix: one shared, smaller size for all six (dropped from 38px to 26px), so the widest real value sets the ceiling everyone uses rather than each card finding its own.

---

## BLE sync in the Tauri shell — Asyncify over JSPI, btleplug over tauri-plugin-blec (2026-07-22)

Bluetooth dive-computer sync existed only in the browser (Chrome/Edge). The
desktop shell had it hidden, because WKWebView has no `navigator.bluetooth`.
Building it into the shell turned out to be gated on a second, quieter
blocker that had nothing to do with Bluetooth at all.

### The real blocker was the suspension mechanism, not the transport

`vendor/libdivecomputer-wasm/` was compiled with `-sJSPI`. JSPI is
**Chromium-only** — WebKit shipped it in Safari 27 *beta* (WWDC26, June
2026), so no released WKWebView has it. The module therefore could not run
in the shell at all, transport aside. That reframed the job: the interesting
question wasn't "how do we do BLE natively" but "does the protocol engine
survive leaving Chromium."

Three options, in descending order of cost:

1. **Native libdivecomputer via bindgen FFI** — what
   `BRIEF-dive-computer-sync.md` §7b had scoped for Option A since before
   Option B was built. Cross-compile the C library per target, generate Rust
   bindings, bridge `dc_custom_open()` to an async BLE stack across a
   dedicated OS thread doing blocking reads off a channel.
2. **Rebuild the WASM with Asyncify** — §7a had already named Asyncify "the
   proven fallback if JSPI isn't ready." Engine-agnostic: it does the stack
   unwinding inside the generated code instead of asking the host for it.
3. Wait for Safari 27. Not a plan.

**Chose 2.** Option 1 was scoped when the protocol layer didn't exist yet;
by now `download.c` is hardware-validated against a real 96-dive Peregrine
transcript (NDL, deco events, gas mix, fingerprint cutoff). Rebuilding that
natively would have meant discarding proven, empirically-checked code to
solve a problem — transport — that never required touching the protocol
layer. §6's own transport/protocol split is precisely the argument for
this: the split makes A-vs-B a *packaging* decision, and packaging is the
only thing that needed to change.

Cost is a flag change, one `EM_ASYNC_JS` contract quirk (below), and 368KB →
616KB. The CPU overhead Asyncify adds is irrelevant here: a real sync is
bounded by ~60ms-per-packet BLE pacing, not by compute. **Verified, not
assumed** — the full validation harness was re-run against the Asyncify
build and reproduced the JSPI build's numbers exactly (96/96 dives,
28,112/28,112 waypoints within 0.3m with worst diff 0.00m, gas mix 96/96
exact, fingerprint cutoff 3/3).

This also buys iOS. A future Tauri iOS shell hits the identical WKWebView
constraint, so the thing that unblocked the Mac unblocks the phone —
without the native-compile project §7b assumed iOS would require.

### Asyncify changed the completion contract, silently and dangerously

Under JSPI the factory promise resolved when `main()` returned. Under
Asyncify it resolves the moment `main()` first **suspends**, with the engine
still running in the background. Every caller that did `await factory(...)`
and then read its results was suddenly inspecting them before the download
had started — reporting **zero dives, with no error**. That failure looks
exactly like a parsing regression, which is what makes it worth writing
down: the first run after the switch reported `downloaded 0 dives (truth:
96)` and the engine was working perfectly the whole time.

Fix: `-sEXIT_RUNTIME=1` makes emscripten call `Module.onExit(code)` on
genuine return; callers await that, plus `onAbort` for the trap case JSPI
used to surface as a factory rejection. `run-module.mjs` is the shared
helper for the four test harnesses; `js/computer-sync.js` inlines the same
thing because it's a classic script and can't import an ES module.

Two mechanisms were tried and rejected first: `callMain()` returns a plain
number under Asyncify, not a promise (so it can't be awaited); and having
`download.c` emit a terminal `done` JSON line would have hung forever on any
path that never reached it.

### A rejected write must not reach the WASM boundary any more

Related, and the sharper edge. Cancelling a sync closes the link out from
under an in-flight write. Under JSPI that write's rejection propagated out
of `factory()` into the catch block, which salvaged the already-downloaded
dives. Under Asyncify a rejected `EM_ASYNC_JS` promise has **nowhere to
propagate to** — the C stack stays suspended, `main()` never returns,
`onExit` never fires, and the sync hangs with no error and no dives.

So `dcTransport.write` now swallows its own failures and fails the packet
queue instead, converting a cancel into the read-timeout path
(`DC_STATUS_TIMEOUT`) the engine already exits through cleanly. Cancel
salvage is a bug this feature has already shipped once (§15), so this is
covered by its own regression test rather than reasoned about:
`run-cancel-salvage-test.mjs` cancels 3 dives into the real transcript and
asserts the engine unwinds, `onExit` fires, and all 3 dives survive.

### btleplug directly, not tauri-plugin-blec

§7b named `tauri-plugin-blec` as Option A's transport, and §20 flagged it as
pre-1.0 (v0.12) with maintainer-reported iOS signing problems. It is a thin
wrapper over `btleplug`; using `btleplug` directly costs nothing extra here
and drops a pre-1.0 dependency plus its signing question from the critical
path. It also matches the call this repo already made for ffmpeg — invoke
the native library from our own Rust command rather than routing through a
plugin from JS — which keeps the command surface narrow and the arguments
un-shapeable from the webview. Licensing is unchanged either way
(BSD-3/MIT/Apache-2.0, §5); §20's licensing clearance still applies.

**The native side stayed small because the protocol engine didn't move.**
`src-tauri/src/ble.rs` is pure async byte-pumping — scan, connect, subscribe,
write, disconnect. None of §7b's sync-over-async machinery is needed: the
blocking C is still inside WASM on the JS side, where Asyncify handles it.
That is the transport/protocol split paying out a second time.

### One notification is one packet — hence a Channel, not an event

`tauri::ipc::Channel`, not `app.emit()`. Shearwater/Suunto responses are
packetized and **notification boundaries are protocol framing** (found
empirically in step 1 — the parser relies on one packet per read call).
Channels preserve message boundaries and ordering; `app.emit()` was the more
obvious reach and the wrong tool. The same rule is already stated at the top
of `js/computer-sync.js` and is restated in `ble.rs` rather than assumed to
carry across the language boundary.

### Capability gate asks the OS, not `isShell()`

`ble_available` probes for a real Bluetooth adapter, so a Mac with Bluetooth
switched off hides the Sync button instead of offering it and failing on
tap. `isShell()` alone would have been the easy gate and the wrong one.

Two smaller consequences worth recording: `tauri.conf.json`'s CSP needed
`'wasm-unsafe-eval'` in `script-src` (the web `_headers` already had it —
the shell's own policy is separate and had been missed, which would have
blocked the module in the packaged app); and `NSBluetoothAlwaysUsageDescription`
is mandatory in `src-tauri/Info.plist`, because macOS 11+ **kills** an app
that touches CoreBluetooth without it rather than showing a prompt.

---

## Bulk-add numbering: locked when fully determined, always collision-guarded (2026-07-22)

Found live, testing the Tauri BLE transport: cancel a sync after 3 dives
land, resync (no fingerprint was ever persisted from the cancelled attempt,
so it restarts from the newest dive), cancel again after 6 — the match pass
correctly separates the 3 already-logged dives from 3 genuinely new, older
ones, and the bulk-add picker correctly computes a collision-free default
(`#142–144`, below the existing `#145–147`). But the number stayed editable,
labelled "Most recent dive #" — and history ended up with **two** dives each
at #145, #146 and #147.

**The label was written for the ordinary case and stopped fitting this one.**
"Most recent dive #" asks for the newest dive *in this batch*, which is only
the same thing as "your actual most recent dive" when the batch really is
the diver's newest activity. Here it wasn't — it was an older backfill batch
surfaced by a cancel/resync — so a diver reading "Most recent dive #" and
answering with their real most recent number (147, already logged) produces
exactly this collision. Rewording was considered and rejected: any phrasing
still asks a question with an unambiguous, computable right answer, so the
honest fix is to stop asking it, not to phrase it more carefully.

**Fix has two parts, not one:**

1. **Lock the field when the answer is already fully determined.**
   `_renderNewDivePicker()`'s existing date-aware guard (added 2026-07-14 for
   a related but distinct problem — see "BLE dive-computer sync — v2.86–2.89"
   above) already computes the one correct, collision-free slot whenever the
   whole batch predates the newest logged dive and the file carries no
   `<divenumber>` of its own. That branch now also sets `numberingLocked`,
   which swaps the visible `<input type=number>` for plain text ("Will be
   numbered #142–144") plus a `type=hidden` input carrying the same value —
   `_bulkAddNewDives()` reads it exactly as before, so no control exists for
   a confused answer to go into. The *editable* default (continuing forward
   from `maxLogged + 1`, or the true cold-start case with no logged history
   at all) is unchanged and still needs to stay editable — "I got this
   computer on dive 45" is real information the app has no way to derive.

2. **A hard collision guard in `_bulkAddNewDives()`, independent of #1.**
   Before creating anything, check the computed `[start, mostRecent]` range
   against every existing dive's `divenum` (not just dated ones — an
   undated dive holding one of the "safe" numbers wouldn't be caught by the
   date-based reasoning in #1, only by this). On collision: block outright,
   name the colliding number(s), and leave `_pendingNewDiveCandidates`
   un-cleared so the user can fix the number and retry without re-running
   the whole BLE sync. Divenum is load-bearing well beyond display — it
   feeds `canonicalFilename()` (two colliding dives can even collide onto
   the same base filename), trip grouping, and stats — so this blocks
   rather than warns, unlike the log form's own "every field optional,
   advisory-only" soft-validation stance (that stance is for a single
   dive's own internal consistency; this is bulk creation of N new
   permanent entries in one action, a meaningfully worse failure mode to
   get wrong silently).

**Why guard #2 exists even though #1 already prevents the reported case:**
guard #1 covers exactly one branch. Any other path to a bad `mostRecent` —
the ordinary editable default, a future bug in how it's computed, the
undated-collision gap noted above — would sail through unchecked without
it. The two fixes are deliberately independent: #1 removes the *opportunity*
for human error in the one case that produces it; #2 catches the *outcome*
regardless of cause.

Dives already duplicated in earlier testing (before this fix existed) are
not auto-resolved — deciding which of two same-numbered entries is the
"real" one isn't something to guess at silently; manual cleanup via ✎ edit
or delete is the only sound path.

---

## Bulk dive renumbering — "Bulk edit: Trip Name / Dive Number" (2026-07-22)

Follows directly from the bulk-add numbering fix above: locking/guarding a
one-time numbering decision at *creation* time doesn't help the much more
common case — a human miscounts a dive number early on (e.g. logs the 71st
real dive as "#72"), doesn't notice for weeks, and by the time they do,
every dive since is off by one. The only existing fix was ✎ editing each
affected dive individually — tedious, and itself as error-prone as the
mistake it's fixing.

**Reused the existing bulk trip-assign selection mechanism wholesale,
rather than building a second one.** The obvious alternative — a typed
"shift dive #N onward by delta," acting on every dive at/above a threshold
with no manual selection — was actually the first design proposed and
recommended (avoids the risk of a human manually tapping a long range and
missing one dive in the middle). The user chose consistency with the
existing tap-to-select-a-range mechanism instead: the single "Select"
button became a **"Bulk edit"** label with two peer buttons, **Trip Name**
(existing, unchanged) and **Dive Number** (new), both entering the exact
same `_selectMode`/`_toggleDiveSelect`/`_historyDomOrder` selection code —
`toggleSelectMode` just gained a second `action` parameter
(`_selectAction`, `js/history.js`) that picks which action bar shows once
selecting starts. The checkbox overlay itself (gated only on the boolean
`_selectMode`) needed zero changes.

**Collision guard checks against "everything not selected," not "above/below
a threshold."** A manually-tapped range isn't guaranteed to be numerically
contiguous — it's just whatever's between two taps in *current on-screen
order*, which could be sorted by depth or country, not dive number. So
`_divenumShiftCollisions(delta)` frames the check the only way that's
actually correct regardless of how the selection was made: for every
selected dive, does `divenum + delta` land on a number some *other,
unselected* dive already holds, or below #1? This one check handles both
directions without separate branches — a positive shift can only ever
collide with something also being shifted (impossible, since every selected
dive moves by the identical delta, preserving relative spacing), while a
negative shift is the direction that can genuinely collide with a
still-there, unselected dive just below the range. Verified against six
representative cases (safe shift, up-collision, two flavours of
down-collision, a below-#1 shift, and a blank-`divenum` dive silently
skipped from both sides of the check) before wiring it up.

**No new file-rename code was needed at all.** `divenum` feeds
`canonicalFilename()` (`js/app.js`) directly, and `writeToFolder`/
`pushToObsidian` already detect when a dive's canonical name has drifted
from its recorded `_filename` and run the existing coordinated-rename
cleanup (`_cleanupOldDiveFiles`) — the same machinery a single manual
divenum edit already triggers today. The bulk version
(`_applyDivenumShiftToDiveList`) is a sibling to `_applyTripToDiveList`,
not a merged/branched version of it — mutating `divenum` needs
`parseInt`+arithmetic where trip assignment is a plain string set, so
sharing a body would need an internal branch anyway; what's actually
reused is the *shape* (mutate → persist locally → push sequentially, never
parallel, per the Android SAF write-storm caution already documented on
`_applyTripToDiveList`), not literal shared code.

**Dive Number's Apply uses `armDelete`'s two-step arm/confirm; Trip Name's
doesn't — a deliberate asymmetry, not a missed consistency pass.** The two
actions have genuinely different risk profiles: a wrong trip name is
freely-correctable text with no collision possible, while a wrong divenum
shift can silently duplicate an identity-bearing field used throughout
history/stats/trip-grouping and (via `canonicalFilename`) real files on
disk. `armDelete` (`js/app.js`) is the same generic helper already reused
unchanged for Save and Delete.

---

## Desktop distribution and licensing (2026-08-12)

### The `.dmg` is hosted on Cloudflare Pages, not GitHub Releases
**Decision:** `src-tauri/release.sh` copies the built `.dmg` to
`landing/downloads/Shoal.dmg` and writes `landing/downloads/latest.json`
(`{version, url}`) beside it. Both are served by the landing site's existing
Pages project.

**Why not GitHub Releases:** it was the obvious choice and it was broken —
the repo was private, so the download link on the landing page pointed at a
page nobody could reach. Hosting the file where the landing page already
lives needs no new infrastructure, no second repo, and no decision about
repository visibility. It also keeps the download and the version manifest
in one place, so a release can't half-publish.

**Cloudflare Pages caps a single asset at 25 MiB.** The build is ~8.7 MB, so
this is fine today; `release.sh` warns (never blocks) if a build crosses it,
because the fix at that point is Cloudflare R2 — their own documented answer
for oversized assets — not something a build script should decide.

**Consequence to keep in mind:** committing a binary on every release grows
git history permanently. Fine at this cadence; Git LFS is the standard
answer if it ever isn't.

---

### A lightweight update *check*, not Tauri's auto-updater
**Decision:** on launch the desktop shell reads its own version
(`get_app_version`, a Rust command), fetches `latest.json`, and if it's
behind shows a toast that opens the download page on tap. It never installs
anything.

**Why not `tauri-plugin-updater`:** the real updater wants signed update
manifests, a code-signing keypair for verification, and a release pipeline —
`release.sh` is a manual, unsigned build. That's a genuine infrastructure
commitment for a project that ships a hand-built `.dmg`.

**Why it's worth having at all:** not features — *security*. The changelog
records real, already-shipped fixes (stored XSS across four render paths,
native filesystem-command confinement). A Mac install that is never
re-downloaded runs known-patched vulnerabilities indefinitely with no way to
find out. That's a materially stronger reason than "see the new stuff."

Desktop-only, gated on `isDesktopShell()` rather than `isShell()`: the
web/PWA build already self-updates through the service worker, and Android
has no unsigned-build problem to solve.

**This is what forced a real version convention.** `tauri.conf.json` had sat
at `2.6.0` while the app shipped 2.99x — harmless until something compared
the two. Bump it before any release you intend to publish.

---

### The bundle is named Shoal; the bundle identifier deliberately isn't
**Decision:** `productName` and the window title are now `Shoal`
(`tauri.conf.json`), matching everything else. `identifier` stays
`com.brookius.divelog`.

**Why leave the identifier:** it's invisible to users, and changing it
resets macOS Gatekeeper trust and any future signing continuity for people
who already installed the app. A cosmetic rename isn't worth making existing
installs look like a different application to the OS.

---

### `THIRD-PARTY-NOTICES.txt` is generated, and inlines rather than references
**Decision:** `scripts/gen-third-party-notices.py` builds the file from
`cargo metadata`'s resolved dependency graph plus the licence files the
crates themselves ship. Never hand-edited.

**Why generated:** distributing a binary is what triggers attribution
obligations — MIT/Apache/BSD all require the copyright notice and licence
text to accompany the distribution, OFL requires its text to travel with the
fonts, MPL-2.0 requires covered source to stay available. A hand-maintained
list of ~360 crates would be wrong within a release.

**dev-dependencies are excluded** (normal + build only): they never reach the
shipped binary, so listing them would overstate what's actually distributed.

**Why not `cargo-about`:** it needs a separate toolchain install and a config
file to produce nothing this doesn't already get from `cargo metadata` and
the registry. Worth switching to if the licence story ever outgrows "list
every crate, reproduce each distinct licence once."

**The vendored and font licences are inlined, not just linked.** Shipping
`vendor/*/LICENSE` and `fonts/LICENSE-OFL.txt` satisfies those licences on
its own — but those files live inside the `.app` bundle, which a normal
macOS user cannot open. An in-app viewer that points at unreachable files
isn't a viewer. Surfaced at Settings → About Shoal, lazy-loaded on first
expand (~190 KB combined) and cached via `SHELL_DEFERRED`.

---

### AGPL-3.0, and what it actually constrains
**Decision:** Shoal is AGPL-3.0 (`LICENSE.md`).

**The binding consequence:** §6 means a binary cannot be conveyed without
its corresponding source. Publishing the `.dmg` therefore requires the
source to be available to recipients — a public download from a private
repo does not satisfy the licence.

**The Apple App Store point is real but easy to overstate** (an earlier
version of this note did). Apple hosts open source freely; permissive
licences raise nothing, and LGPL works in practice — Subsurface-mobile ships
this exact libdivecomputer on the App Store. The genuine conflict is
GPL-family-specific: Apple's end-user terms add device and redistribution
restrictions that GPL's "no further restrictions" clause forbids, and
GPLv3/AGPLv3 additionally require Installation Information for modified
builds, which a locked iOS device can't provide. That's what got VLC (then
GPLv2) pulled in 2011 until VideoLAN relicensed to LGPL. **But it is only
ever enforceable by a copyright holder** — for a sole-authored project that
constrains other people's redistribution, not the author's own, who can
dual-license or add an App Store exception at will. What *would* block it is
bundling GPL code you don't own, which is exactly why the "no GPL anywhere"
rule for **dependencies** stays worth keeping.

**AGPL's distinctive clause does little here.** §13 protects against someone
running modified code as a network service without sharing it; Shoal is
local-first with no server. What remains in force is the GPL core, under
which any recipient may redistribute the binary freely.

**Dependency compatibility holds** — Apache-2.0 is one-way compatible with
AGPL-3.0, and libdivecomputer being LGPL-2.1-**or-later** is what makes it
fit. An LGPL-2.1-only dependency would have been a genuine conflict.


---

## Rationale moved out of ROADMAP.md (2026-08-13)

These were written in `ROADMAP.md` but are decisions, not planned work — a
choice made with alternatives rejected. Moved here so ROADMAP answers only
"what isn't built yet, and what's blocking it". Content is unchanged; only
the heading levels were normalised.

#### Why discrete pins, not a heatmap

A heatmap is the right tool when data is unbounded — useful for the album case if it ever needed wide-area density, which is why that was the first instinct. But once the query is constrained to ≤3 species *and* a radius around one planning location, record counts drop to something genuinely plottable: tested against a Komodo-sized bounding box with 2 species, OBIS returned 40 records — easily rendered as discrete pins, one colour per species. Pins also answer the actual planning question ("does *this* site have manta records, does that one") better than a density blob would. The 3-species cap earns its keep twice over: it bounds the query, and it keeps a 3-colour marker legend readable on a small screen.

#### Why Seasearch matters

The data model improvements that Seasearch requires (GPS coordinates, seabed type, species abundance categories) are beneficial globally, not just for UK dives. GPS is also required for OBIS/Darwin Core export. Building Seasearch support improves the scientific value of every dive logged, wherever it was.

Luke dives primarily in the UK and Southeast Asia, so Seasearch isn't a hypothetical fit for someone else's use case — it's directly relevant to a real share of his own logged dives. The same pattern (structured fields mapped to a real submission form) could support other regional programmes (Reef Check, CoralWatch) for the non-UK dives.

#### Why Tauri (not Electron)

- **Bundled ffmpeg "sidecar".** Tauri ships external binaries declared in config; the app runs ffmpeg *itself* — no install, no script, no Gatekeeper-on-the-script, no folder-pointing. "Generate proxies" becomes a button with a progress bar. This is the whole reason to wrap. (CompressO is a real example of an ffmpeg-sidecar Tauri app.)
- **Small + light** — ~8 MB installs, 30–50 MB RAM (vs Electron's 80–150 MB / 150–300 MB), because Tauri uses the OS's native webview rather than bundling Chromium. Matters for a media app sitting next to a video decoder.
- **Real filesystem** — point straight at the NAS / external drive, watch folders; no File System Access API quirks, no browser storage caps.

**The cost / risk:** Tauri uses each OS's native webview (WebKit on macOS), so rendering must be re-tested vs the browser build. Low risk here — the app uses system fonts, simple CSS, no exotic features. (Electron would render identically to the browser but at ~20× the install size; not worth it for this app.)

### Capacitor as the mobile fallback (superseded as the plan, retained as the contingency)

**Decision:** mobile ships on the same Tauri toolchain as desktop, not
Capacitor. Capacitor is kept documented below because Tauri-mobile is the
younger, less battle-tested of the two — if its `fs` plugin disappoints
against real Android field-logging, this is the fallback, already scoped.
It is a contingency, not dead text, and not a roadmap item.

Wrapping the PWA in Capacitor solves the file system problem cleanly and opens up the App Store / Play Store path.

#### What changes

**File writes:** Replace the browser download fallback with `@capacitor/filesystem`. Dives save directly to a folder on the device — no Downloads notification, no manual move to Proton Drive. Edits overwrite the existing file in place. The code detects `Capacitor.isNativePlatform()` and switches between the web and native write paths.

**Everything else stays the same** — same HTML, CSS, JS, same localStorage, same Obsidian sync on Mac. Capacitor is a thin native shell, not a rewrite.

#### Steps

1. Add Node.js + npm to the project (`npm init`) — this is the point the "no build tools" constraint is revisited
2. `npm install @capacitor/core @capacitor/cli @capacitor/filesystem`
3. `npx cap init` → `npx cap add android`
4. Swap `downloadMd()` for `@capacitor/filesystem` write calls, gated on `Capacitor.isNativePlatform()`
5. `npx cap sync` → open Android Studio → build → test on device
6. Sign APK → publish to Play Store (optional, $25 one-time fee)

#### Costs

- Capacitor: free, open source
- Android development tooling (Android Studio): free
- Google Play Store: $25 one-time registration
- Apple App Store: $99/year (not needed if Android-only)

#### When to do this

When the feature set stabilises and the download-to-Downloads workaround becomes genuinely painful day-to-day. Not before — the PWA is still the right vehicle for fast iteration.

> **⚠️ Capacitor is now the *fallback*, not the plan.** When this section was written, Tauri was assumed desktop-only and Capacitor was *the* mobile path. **That is no longer true** — Tauri v2 (current **v2.11.2**, May 2026) ships stable **mobile** (iOS + Android) with a scoped `fs` plugin, alongside stable desktop. So the likely path is **one wrapper — Tauri — for both desktop and mobile** (see the Tauri section below). Keep this Capacitor plan only as the **fallback** if Tauri-mobile's `fs` plugin can't meet real Android field-logging needs. Do not build Capacitor pre-emptively.

---

### Licensing notes for third-party data

#### IUCN Red List API — commercial path researched 2026-07-09, plan changed

- **Personal/non-commercial use:** Free. The current app qualifies.
- **Commercial use:** Strictly forbidden via the free API without IUCN's prior written permission. Two previously-assumed workarounds were investigated directly and **both ruled out**:
  - **IBAT (ibat-alliance.org)**, long assumed to be "the" paid commercial path, turns out to be a weak fit even setting price aside. It's priced for corporate ESG/environmental-risk disclosure work (Enterprise Plus, API access only, **$35k/yr**), not a per-species status lookup — and its own terms separately say *"commercialising IBAT or the data itself... is strictly prohibited,"* which a species-status badge shipped inside any commercially-distributed app arguably is.
  - **"Own-key" (each user pastes their own free personal IUCN key)** was the leading internal plan below and does **not** actually sidestep the restriction. IUCN's own Terms of Use §3 defines Commercial Use as *"any use by, on behalf of, or to inform or assist the activities of, a commercial entity"* — deliberately broader than "use by the credential holder." A badge powered by a user's own key would still assist a commercial entity's activities if any distributor of Shoal were one. IBAT's terms use the identical "on behalf of" phrasing — same drafting intent, confirmed not a loophole either way.
  - **The actual path:** IUCN's terms literally say to contact them directly for commercial permission (§16 has contact details; there's a UK office in Cambridge). Framing Shoal honestly as a small hobbyist tool — one conservation-status badge per species, not a data reseller — is the argument in Luke's favour, much narrower than IBAT's enterprise/ESG client base.
  - **A promising unconfirmed lead worth raising in that outreach:** IUCN's terms separately define **"IUCN Red List Data"** narrowly — *"all tabular, and all spatial and associated attribute data"* — as the thing restricted from Commercial Use, while stating IUCN *"places no restrictions on use of the IUCN Red List Categories associated with each named taxonomic entity."* Shoal's actual feature is exactly a bare category code (CR/EN/VU/…) next to a species name — arguably "Categories," not "Data." The open question is whether a compiled *table* of many species' categories (which is what `species-db.js` is) still reads as "Categories" or crosses back into restricted "tabular... Data" once aggregated at scale — worth asking IUCN to confirm directly rather than assuming either way.
- **Attribution required:** IUCN Red List data must be credited. For a personal tool, a small note in the UI suffices (e.g. "Conservation status: IUCN Red List" with a link). If this becomes a public product, a proper credits/attribution page is needed — standard practice is an "About" or "Data sources" page listing each data provider with their required citation text.

**What this means for the "own-key" plan below:** it's not the fix it was assumed to be. Don't build the per-user runtime-key migration described below as a *licensing* fix — it doesn't function as one. It could still be worth doing for other reasons (freshness, not depending on Luke's personal fetch), but the commercial-use question has to be resolved with IUCN directly first, independent of who holds the API key.

**Own-key lookups (design sketch, kept for reference — not a licensing fix, see above).**
`iucnStatus` is currently baked into `data/species-db.js` at build time
(`scripts/fetch-iucn.py`, using Luke's own personal key) — fine for a single
personal-use copy. If ever built anyway (e.g. for data freshness), the shape
would mirror the Admiralty pattern from v2.6: each user pastes their own free
personal IUCN key into Settings, and the app fetches/refreshes status
per-user at runtime instead of redistributing Luke's build-time fetch.

The baked-in `iucnStatus` field would need to become **overwritable**, not
fixed — the per-user live lookup should take precedence over (or refresh) the
shipped default when a key is present. This is a chunkier migration than it
sounds: every place that renders an IUCN badge (species browse mode, the
Album, profile modals — currently two separate, drifted copies of the badge
CSS, see the cleanup task spawned alongside this) currently assumes status is
already known, because it's always been baked in. A per-user runtime fetch
means those same UI spots need a real "not fetched yet" / "fetching" state
across well over a thousand species, not just a colour, plus a sensible
batching/rate-limit strategy (the free tier's per-key request limits aren't
designed for fetching that many species in one session).

#### iNaturalist species photos
- Photos must be CC-licensed. The `inaturalist-open-data.s3.amazonaws.com` S3 bucket only mirrors CC-licensed photos — any URL on that host is safe by definition. The general `static.inaturalist.org` host serves all photos regardless of license and must not be used as a source.
- **Audited June 2026:** all 188 `static.inaturalist.org` URLs in `data/species-db.js` were replaced. 12 had CC-licensed equivalents on the open-data bucket; 176 had no CC photo available and were blanked (species shows without a thumbnail). Net: 900+ open-data photos, 0 static.inaturalist.org photos remaining.
- **When adding new species:** only accept photo URLs from `inaturalist-open-data.s3.amazonaws.com`. Use the iNaturalist taxa API with `photo_licensed=true` to get CC-only results; if the returned URL is on `static.inaturalist.org`, fetch the photo ID and check `inaturalist-open-data.s3.amazonaws.com/photos/{id}/square.jpg` — if it 404s, try `GET /v1/observations?taxon_id=X&photo_license=cc-by,...&quality_grade=research` to find an alternative CC photo on the open-data bucket, or leave blank.
- Attribution is embedded in the API response (`default_photo.attribution`). Currently not displayed — if this becomes a public product, per-photo attribution should be shown.

#### How to credit (when the time comes)
The standard approach for a web app is a **Data Sources** page (linked from the footer or an About modal) listing each provider, their data licence, and a link to their terms. IUCN's required citation format is documented at iucnredlist.org/about/cite.
