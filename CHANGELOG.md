# Changelog

Human-readable record of notable changes, newest first. Format follows
[Keep a Changelog](https://keepachangelog.com); grouped under
**Added / Changed / Fixed / Removed / Security**.

**Maintenance convention:** keep an `## [Unreleased]` block at the top. Add a
bullet *as part of the change*, not retroactively. On a version bump/push,
rename `[Unreleased]` → `## [<version>] – <date>` and open a fresh empty
`[Unreleased]`. The trigger is explicit: when Luke says he's ready to commit
(or "update the changelog"), Claude reviews what changed since the last
baseline and writes the entry. See CLAUDE.md → "Changelog discipline".

> **Shoal was developed privately for about a year before its first public
> release.** `v1.0.0` (2026-08-14) is that first public version. Everything
> below it is pre-release history, kept because the reasoning is still
> load-bearing — not because those version numbers mean anything on their
> own. **Pre-1.0 version tokens mirror the commit subjects of the day and
> are not strictly monotonic** (the repo has duplicate/overlapping `1.9x`
> labels, and later ones like `2.993` are decimal drift, not semver) — date
> is the real ordering key for that range, and none of those numbers are
> comparable to `1.0.0` or anything after it. Entries before `1.93` are
> condensed from commit subjects, not reconstructed in detail. See
> CLAUDE.md → "Changelog discipline" for the versioning scheme `1.0.0`
> onward actually follows.

---

## [Unreleased]

## [1.0.0] – 2026-08-14

First public release.

### Added
- **Desktop update check.** The Mac app compares its own version
  (`get_app_version`, a new Rust command) against `landing/downloads/latest.json`
  on launch and toasts a download link if it's behind — desktop-only, since
  the web/PWA build already self-updates via the service worker. Never
  installs anything itself; `open_url` (Rust) opens the download page in the
  system browser on tap. `showToast()` gained an optional `onClick`,
  backward-compatible with every existing call site.
- **The `.dmg` is hosted on Cloudflare Pages, not GitHub Releases.**
  `release.sh` now copies the built app to `landing/downloads/Shoal.dmg` and
  writes `latest.json` beside it — the same infrastructure already serving
  the landing page, so the download link works regardless of the source
  repo's visibility. Warns (never blocks) if a build exceeds Cloudflare's
  25 MiB per-asset limit.
- **AGPL-3.0 licensing made real, not just declared.** `LICENSE.md` ships
  inside the app bundle as well as the repo root. `THIRD-PARTY-NOTICES.txt`
  is generated from the actual resolved Rust dependency graph
  (`scripts/gen-third-party-notices.py`, ~360 crates) plus the vendored
  libraries and bundled fonts, with every distinct licence text inlined —
  the standalone `LICENSE` files satisfy the letter of it, but they sit
  inside a `.app` bundle a normal user can't open, so the notices file is
  self-contained on purpose. Missing licence files added for Leaflet
  (BSD-2-Clause) and the bundled fonts (OFL-1.1, with each typeface's real
  copyright notice). Surfaced in-app at **Settings → About Shoal**: a safety
  notice (Shoal is a planning aid, not a dive computer), the full licence
  text, and the third-party notices — each lazy-loaded on first expand.
- **`CONTRIBUTING.md`** — how to submit a change, including the two
  easy-to-forget steps: regenerate the notices file after a dependency
  change, and bump the service worker cache version after adding a JS file.
- **Landing page: a platform-status section and a "What's new" table.**
  Two real install paths (Android, Mac) with an honest per-platform caveat
  instead of implying parity; a scrollable changelog table with real ship
  dates, translated out of this file's internal register into plain
  language.

### Changed
- **The desktop app is named "Shoal", not "Dive Log."** `productName` and
  the window title (`tauri.conf.json`); the bundle identifier stays
  `com.brookius.divelog` deliberately — it's invisible to users, and
  changing it would reset Gatekeeper trust for anyone already using the app.
- **Desktop version numbering reset to semver, starting at `1.0.0`.**
  `src-tauri/tauri.conf.json` → `version` is now the single source of truth
  that `release.sh`'s DMG naming and the new update check both read —
  version numbers before this release were informal, non-monotonic, and
  never meant to be machine-compared. See the note at the top of this file.
- **Landing page rebuilt around three questions, not three screenshots.**
  Hero leads with the species profile that answers "where did I see that
  octopus," followed by "what else did I see on that dive" (the full dive
  file, tabs unrolled to their real positions) and "which dives did I do on
  this trip" (the trip timeline beside a dive-type-coloured map with a
  legend). Replaces the earlier grid of disconnected demo screens with one
  continuous thread through a single real dive (#66, M2 Submarine, Dorset).
- **One public documentation set, not two.** `README.md`, `DECISIONS.md`,
  and `ROADMAP.md` are now the only copies — previously maintained as
  matching public/private pairs, which had already drifted. Commercial and
  positioning-strategy material was moved out of the repo entirely rather
  than kept in a second file.
- **`ROADMAP.md` trimmed from 520 to ~390 lines.** Sections that were pure
  rationale (why discrete pins over a heatmap, why Tauri over Electron, the
  Capacitor mobile fallback, the IUCN commercial-use research) moved to
  `DECISIONS.md`, where "why" belongs. Shipped items collapsed to a pointer
  at `CHANGELOG.md`/the relevant brief instead of restating the design —
  any open concern still buried in a "done" section (e.g. the `au` species-region
  match rate) was preserved, not dropped along with it.

### Fixed
- **A landing-page mobile layout bug**: `.tripmap-card` had a fixed
  `width: 400px`, which forced the whole document wider than a 412px phone
  viewport. Everything else then centred inside that wider page and clipped
  on both edges, sections away from the actual cause.
- **Stale "Dive Log" filename references** in `README.md`'s build
  instructions, now matching the renamed app.

### Removed
- **Seasearch reference PDFs** (third-party copyrighted observation forms)
  taken out of the repo — kept locally, gitignored, not redistributed.
- **Personal/test UDDF fixture files** removed from `data/`.
- **Commercial/monetisation language** scrubbed from the briefs that
  ship publicly (`BRIEF-dive-site-database.md`, `BRIEF-play-store-readiness.md`)
  — reframed around the licensing and data-sourcing reasoning, which is the
  part worth publishing.

---

## [2.993] – 2026-08-12

### Added
- **First CSS primitive: `.tab-strip`/`.tab`, consolidating 3 of the app's 9 "tab strip" classes** (`.browse-tab`, `.species-browse-tab`, `.sp-picker-tab` — near-identical category-filter chip rows that had quietly drifted apart: three different container paddings for the same row, and one of the three pointing its active-state border at the wrong colour token). The old class names still work exactly as before — nothing in the log form or footage/species pickers needed to change — but the new primitive is now available directly for anything built next, instead of a fourth near-duplicate. The other 6 "tab strip"-named classes were checked individually rather than swept in: one was confirmed fully dead and removed, one is just a wrapper around an already-consolidated class, two turn out not to be tabs at all on close inspection, and two are kept deliberately separate as genuinely different, already-documented visual patterns. Verified against a real rendered page, not just the CSS source. A follow-up check on the one confirmed-dead class turned up a whole dead media query sitting next to it — the footage-tagging modal never opens below 900px width or outside the desktop app at all, so its entire `max-width:600px` mobile-layout block (column stacking, tab-bar visibility, split-pane show/hide) could never run either; removed alongside it.
- **The Dive profile section is now grouped Time / Depth, one labelled row each, with both groups sitting in a left gutter at every screen width.** It was a single "Time & depth" row cramming bottom time, max depth and average depth together — told apart only by their unit suffixes ("m max" / "m avg") — with Entry/Exit time in a separate row below, reading as one undifferentiated block. Now **Time** → Bottom · Entry · Exit and **Depth** → Max · Average, each field carrying its own label so the unit drops back to a plain "m", and the group name sits beside its fields rather than on its own line above them — mirroring the Stops block directly below so the whole section reads as one system. Field columns are capped rather than stretched — a 2–3 digit value in a wide box left the value and its unit stranded at opposite ends, which is what made the old rows look unbalanced.
  Depth's gutter was straightforward — it's only 2 plain fields with room to spare at any width. Time took another pass: it looked like the gutter genuinely couldn't fit there on a phone (Entry/Exit's time pills need real width that a naive equal three-way split didn't leave them), but the actual fix wasn't skipping the gutter — it was giving Bottom, Entry and Exit unequal shares of the row instead of equal ones, since Bottom only needs about a third of what a pill needs. Finding the real safe minimum took two rounds of measurement: an outer-container overflow check said everything fit down to a fairly narrow width, but that check couldn't see a pill's own text quietly spilling past its edge — checking the text itself against its box told a different, more accurate story, and moved the fix from "looks fine" to genuinely fine. The result comfortably covers current phones (measured margin at both a common ~375px width and Luke's own 412px device); only genuinely old, small-screen hardware (≤320px) still comes up short, which is disclosed rather than silently accepted. The unequal-share layout only applies on an actual touchscreen — a resized desktop browser window narrower than 600px keeps equal columns, since there's no pill there needing the extra room.
- **Tap-to-scroll number wheel on cylinder pressures and weight.** Start/end pressure and weight are values you fine-tune around a known figure (~200 bar in, ~50 out, single-digit kg) rather than enter freely, so a scroll-to-value wheel beats a keypad. Deliberately **not** applied to max/average depth — those are precise readings off a computer, where hunting a wheel is slower than typing. Strictly additive: the inputs stay fully typeable everywhere, with the wheel on a small separate button beside each label. **It never writes a value on its own** — opening it on an empty field centres the typical figure purely as a starting point, and only "Set" commits; Cancel, Escape, back-gesture and backdrop-tap all leave the field exactly as it was, so an unrecorded pressure is never silently invented as 200/50. Keyboard-operable (`role="listbox"`, arrows/PageUp/PageDown/Home/End/Enter) and on the standard overlay stack, so back and Escape close it like every other surface.
- **Tank type now defaults to Steel instead of Aluminium**, changed in all four places that set it — the markup default, the form reset, the post-save carry-forward fallback, and `openEdit`'s fallback for an older dive that recorded no tank type at all. That last one necessarily invents a value either way; keeping it equal to the form's own default avoids the app having two different defaults depending on the path in.
- **Date/Entry/Exit time now show as compact, icon-led pills on touch-primary devices, instead of full-width native inputs that only ever opened a picker.** `type="date"`/`type="time"` are tap-only on Android/mobile WebView — there's no typing path at all, unlike desktop's typeable digit segments — so they looked exactly like every other text field in the form while behaving nothing like one, the only fields left after the rest of the log-form redesign replaced native defaults with purpose-built controls. Shipped version: a plain `<button>` (`js/logform.js` — `lfShowPicker`/`lfSyncPickerDisplay`/`lfInitPickerInputs`) showing an icon and the formatted value, calling the real input's `.showPicker()` on click. The real `<input>` stays the sole source of truth for `.value` — `saveDive`, `calcExitTime`, UDDF prefill, and edit-mode `openEdit` are all completely unchanged. Gated on `@media (pointer: coarse)`, not a width breakpoint, so a resized desktop window never qualifies. Two earlier attempts failed on real hardware before landing here: a `background-image` icon painted on the native input repeated once per internal segment (month/day/year, or hour/minute) on **both** WKWebView and Chromium, since neither renders these input types as a single flat box, and the first version's `max-width` gate also caught a genuinely narrow **desktop** Tauri window, inheriting a touch-only treatment on a real mouse+keyboard context. Checking Material Web's own reference implementation confirmed the direction rather than guessing a third time: their text field explicitly types `date`/`time`/`datetime-local` as `UnsupportedTextFieldType`, and the only thing built on top of them is `showPicker()` — the same primitive this now uses. Also found live and fixed: three places set these fields' `.value` by direct assignment (`calcExitTime`, `_afterSaveReset`/`_resetLogFormFull`), which fires no `input` event and would have left the pill showing a stale value — each now explicitly re-syncs the affected trigger at the point of assignment.
- **Dive # now previews its computed value.** The field showed only the word "auto" and stayed blank until save, when it silently became `dives.length + 1` (`saveDive`, `js/app.js`) — a formula that can drift after deletions or bulk-imports, with no way to see the real number beforehand. Exit time already did this correctly (a genuinely live, computed value as you type); Dive # now shows the same live placeholder every time the Log panel is entered fresh, correctly skipped in edit mode where the field already holds the dive's real number. A placeholder, not a value, so `saveDive()`'s own fallback logic is completely unchanged — confirmed live that reading the field still returns an empty string with the placeholder showing text, not the placeholder's contents.
- **`enterkeyhint` added across the app's real text-entry inputs (31 of 45)** — "next" for mid-form fields, "done" for the last field in a group, "search" for the marine species search box. The other 14 (`file`, `hidden`, `range`, `date`, `time` inputs, plus the notes `<textarea>`, where Enter should insert a newline) correctly get none. Found and fixed alongside a stale audit: `BRIEF-play-store-readiness.md` had claimed 0 labels and 0 `inputmode` too, both long since done by earlier work the doc was never updated to reflect — re-verified with a proper multi-line-aware parse (a naive line-by-line `grep` undercounts; at least one `<textarea>` tag spans multiple lines and was invisible to it) rather than trusted at face value.
- **Every toggle and tab-shaped control in the app now exposes its selection state to assistive tech** — `aria-pressed`, `aria-selected`, or `aria-expanded` depending on what each one actually does, not a single pattern applied uniformly. `aria-pressed`: `.roc-btn` (species.js, plus per-button `aria-label` since "R"/"O"/"C" alone mean nothing to a screen reader), `.st-tgl` (stats.js), `.rev-toggle` (footage.js), `.sort-btn` (history.js). `role="tab"`/`aria-selected`: the dive-file `.df-seg-btn` strip and footage's `.mode-toggle` (both genuine content-switchers, not filters), plus the category-browse tab families shared by species.js and footage.js (`.browse-tab`, `.species-browse-tab`, `.sp-picker-tab` and their container elements) for consistency across every place that same shape appears. `aria-expanded`: `.sp-clips-toggle` (album.js's "+N more" clip expander) and `.dm-side-tab` (footage.js's sightings-panel pin control) — both disclosure widgets despite one being named "tab." Two controls in the original list were misclassified rather than just unbuilt: `.cat-pill` isn't a selection control at all (a jump-to-section link list; got `aria-disabled` instead, for when a filter hides its target), and `.fm-mob-tab` needed no fix — it's dead CSS/JS with no markup anywhere that ever creates the element.
- **On first-time setup, the Android folder picker creates and offers `Documents/Shoal`, so connecting a folder is one tap.** `android_pick_folder` resolves an initial location via `resolve_public_storage_initial_location` (creating the directory if absent) and opens the system picker already standing inside it — the user confirms rather than decides, and gets a sensibly named folder they didn't have to invent. Android has no way to grant an app a folder *without* a pick — that is precisely what scoped storage is — so this is as close to "the app just made one" as the platform allows. **Gated behind a new `offerDefault` argument, true only when no folder is connected yet**, because the intended cleanup provably cannot run in the case that matters: removing `Documents/Shoal` needs a write grant on local Documents, which the app only holds if the user picked at or above it — so anyone who goes to Drive instead leaves an empty folder behind (observed on hardware). Confining the offer to first-time setup means a re-pick via "Change folder" never creates one, and the one-off export picker never does either. The cleanup attempt remains for the cases where it can work, guarded on the picked folder's *display name* rather than URI equality — the initial-location URI and the tree URI for the same directory are different values, so comparing them would try to delete the folder the user just picked. Safe in every direction regardless: `remove_dir` refuses a non-empty directory by contract, so the worst case is a stray empty folder, never data loss.
- **The Android sync folder now shows its real name** (`android_folder_name` → the provider's own `get_name`). The name was previously derived in JS by splitting the content URI and taking the last path segment, which happens to read correctly for local storage (`…/tree/primary%3ADocuments` → `Documents`) and is meaningless for anything else — a Google Drive folder's URI ends in an opaque document id, so Settings displayed `acc=8;doc=encoded=eVbk4Q-zrXF85H-…` as the name of the user's synced folder. Verified on hardware: now reads `Shoal`. Re-read at boot as well as on pick, so labels stored by the old derivation are corrected without a re-pick, and a folder renamed in Drive or Files stops showing a stale name. Deliberately chained after the boot sync rather than fired alongside it — every SAF call in this app is strictly sequential, and a cosmetic label can wait.
- **Android Settings is reduced to the one backend that can work there** (`_applyAndroidSyncUI`, `js/app.js`). The Browser/Folder/Obsidian selector is gone — both alternatives are guaranteed dead ends inside the Android shell, and presenting a dead end as an option only invites picking it — along with "Clear", which on a platform where folder sync is the sole backup path isn't a setting worth offering (the first-dive prompt would immediately re-fire anyway). "Sync from folder" stays: pulling in dives logged on another device is a real, deliberate action. `syncMode` is coerced to `'folder'` at declaration rather than in the UI pass, because the boot sequence branches on it to decide whether to sync at all — doing it later would silently skip the boot sync for one whole launch.
- **The dive-file ambient map hero now bleeds edge-to-edge on mobile, matching desktop.** Desktop already did this — a negative margin cancels the page's own padding so the map reaches the true top/left/right edges instead of sitting in a rounded card. Mobile had never actually gotten the same treatment; it just sat inside the page's normal padding with rounded corners, which is what a screenshot caught. Fixed the same way, cancelling mobile's own padding values (including the safe-area-aware top value from the cutout fixes below) instead of desktop's. The map's title/badge text is anchored to the bottom of the hero, so this only extends the decorative map above it further up — nothing readable moves. Tap-to-expand into the full-screen map view is unaffected either way, verified live in both states.
- **App-wide dark mode.** A System/Light/Dark control in Settings → Appearance (defaults to System, following `prefers-color-scheme`, with an explicit override once chosen, persisted to `localStorage['divelog-theme']`) applies `.theme-harbour` to `<html>` — the same theme class the footage modal has used since v2.99, now driving the whole app rather than one surface. Ships the full locked palette from `mockups/mockup-dark-tokens.html`'s 2026-08-04 design pass (the block previously shipped in `.theme-harbour` was stale relative to it — old `--danger`, missing `--accent-text`, only 4 of 8 IUCN ranks, no dive-type ramp, no profile-chart tokens): the 5-rung surface ladder, corrected `--danger` (`#D26A4D`→`#E96E4C`, tuned to hold separation from `--type-Reef`), a full `--on-*` pairing set including a new `--on-type` (dive-type-ramp ink, `#FFFFFF` light / `#091010` dark — also added to light `:root`, which didn't have it either), 7 lifted dive-type ramp members (Shore/Drift/Reef deliberately not restated — already clear both floors), and the 5 `--profile-*` dive-chart tokens.
  **Real component bugs fixed, not just token copies** — found live testing app-wide, several beyond what the design pass could catch at its original modal-only scope: `.dD-select-box.checked`'s checkmark now fills with `--accent-fill`/`--on-accent` (both theme-constant) instead of `--accent`, which lifts to a lighter blue on dark and dropped the tick to 2.29:1; `.lf-type-chip.sel`/`.dD-spine span`/`.df-type-pill` (the log form's selected type chip, the history timeline's vertical type spine, and the dive-file's type badge) all move from hardcoded `#fff` to `--on-type` — `.df-type-pill` specifically was found live during this pass (white on a lifted dark member like Boat measured ~3.98:1, under AA for its 12px bold label) and wasn't in the original component list; the tank pressure gauge (`_dfTankHtml`, `js/history.js`) now applies its "is the number on the fill" contrast check to *both* numbers instead of just the end one (a pre-existing light-mode bug, not new), and the fill itself moved from `--accent` to the theme-constant `--accent-fill`; and **`.mobile-cog`'s background moved from `var(--text)` to a fixed literal** (`#1C3030`, matching the sidebar/mobile-nav's own always-dark gradient) — found live, since `--text` flips light on dark and the floating Settings gear button was rendering as a near-invisible near-white circle.
  **Two hardcoded-literal fixes with the highest visual impact**: the page-wide depth gradient (`body::before`, behind every screen) and the static sun-on-water mesh (journal/welcome/settings cards) both hardcoded light-mode RGB that wouldn't have changed at all under the new theme — both now have `.theme-harbour` overrides, the depth gradient's taken verbatim from the design pass's own five independently-matching screen mockups. Four "darken slightly on hover" sites (`.btn-ghost`, `.sort-btn`, `.sync-btn`, `.df-seg-btn:active`) swapped their hardcoded near-black tint for the already-dual-themed `--taupe-dim` token.
  **A dive file with a profile chart left open across a theme change repaints correctly** — `renderProfileChart` only reads its colour tokens via `getComputedStyle` at render time, so a System-mode OS flip while a chart is on-screen (no navigation needed) would otherwise leave it stale; a new `_dfRerenderProfileIfOpen()` (`js/history.js`) re-renders the open dive file in place, wired into the same `applyTheme()` every toggle path already calls.
  Boot-time theme application is an inline `<script>` in `index.html`'s `<head>` (every `<script src>` in this app loads near the bottom of an 1153-line document, far too late to avoid a flash); `<meta name="theme-color">` updates alongside the class, including on a plain page load with no explicit toggle — found missing this during verification, since the boot script only had reason to set the class, not touch a tag that isn't parsed yet at that point. IUCN badges also picked up a real fix riding along: `.iucn-VU` moves off gold onto full neutral ink (the shipped gold treatment measured 3.33:1, a live AA failure in *light* mode, not just a dark-mode gap), and the neutral treatment for NT/LC/DD/anything unrecognized now lives on the base `.iucn`/`.iucn-badge` classes rather than three duplicate per-rank rules — closing a real fallthrough bug where two species with legacy invalid status codes (`LR/nt`, `NA`) rendered with no chip styling at all, in either theme.
  Deliberately deferred: ~53 sites duplicating `--warn`/`--danger`/`--success`/`--accent` as raw `rgba()` literals instead of tokens (cosmetic hue drift in dark mode, not illegible) — a documented follow-up, not a silent gap. See `CLAUDE.md` → "Built" for the full account.
- **Map pins are now colour-coded by dive type, and each one links through to its dive.** The History Map view drew every dive with Leaflet's stock blue teardrop, so the map was the one place in the app that threw away a dive's type — every other surface (timeline spine, log-form chip, dive-file hero pill, Stats bars) already uses the `--type-*` ramp. Pins now carry that colour, with a legend listing only the types actually on screen and their dive counts, and tapping a pin opens a popup whose rows each navigate straight into that dive's file. The trip full-screen map gets all of it for free — it already shared `renderMapMarkers()`, so colours, legend and tap-through appeared there with no code written for them.
  **One pin per site, not per dive** — a deliberate change of what a pin *means*, made because the tap-through exposed the alternative as broken: six dives stacked at one coordinate leave only the topmost tappable, so the other five would have been unreachable the moment a pin became a navigation target. Grouping (on the same 4dp coordinate rounding the species album already uses to dedup sighting sites) removes the overlap by construction rather than mitigating it with draw order. A site's pin takes its **majority** dive type and the popup lists every dive there, so the colour reads as "mostly boat diving here" with the full breakdown one tap away. The map subtitle now reads "15 dives at 10 sites" — pins are sites now, and the two numbers double as a check that grouping worked.
  **Built as an `L.divIcon`, not an `L.circleMarker`, and that choice is load-bearing rather than incidental.** An SVG shape can take a CSS `fill: var(--tc)` but never a `background-image`, so a circleMarker would have forfeited the colourblind texture channel entirely — and a wordless swatch is exactly what that channel exists for. Real HTML also means no colour is ever resolved in JS, which is what makes an already-open map re-colour by itself when the theme flips: verified live by flipping the OS appearance with the map on screen and confirming the *same DOM node* went from `#863C5E` to `#B36888` with no re-render, the failure mode `_dfRerenderProfileIfOpen` exists to work around elsewhere.
  **Three separate run-ins with the same Leaflet trap, one of them caught only by rendering it.** Leaflet's stylesheet is appended to `<head>` at runtime by `loadLeaflet()`, so it always loads *after* `css/styles.css` and wins every same-specificity tie. Its `.leaflet-div-icon { background: #fff }` uses the shorthand form, which resets `background-image` and would have silently killed every pin's texture — dodged by passing our own `className`, since Leaflet *replaces* rather than appends the default class. The pin's fill and its `data-tex` were then deliberately put on different elements so that collision is structurally impossible there at all. The third instance was found live and not by inspection: the popup was themed with a matching-specificity rule that lost the same way, rendering a white card with `#333` text on the dark canvas — fixed by bumping specificity, with the reasoning written next to it since this is now the third time.
  Also removes a hardcoded `#4A90B8` from the dive-file hero map — light-mode `--accent` inlined, so it stayed pale blue in Harbour Night and was invisible to the token system; it now uses the same shared pin helper. The trip ambient banner is deliberately left alone: a 5px non-interactive dot, below the texture channel's legibility floor and with no room for a legend, which would have made it colour-alone with no key. Verified live end to end — grouping, majority type, tap-through from both map surfaces (including the overlay-stack unwind, with no leaked Leaflet instance), theme flip, textures at both toggle states, the unspecified-type fallback, and pins now announcing as "Batu Bolong — 6 dives" to assistive tech instead of "Marker".

### Changed
- **`--accent` as text now passes contrast on the app's genuinely-interactive controls** (nav links, toggles, hover/active states, buttons — 63 sites). It measured 3.27:1, below AA; a new `--accent-text` token (same hue and saturation, darkened just enough to clear 4.5:1) replaces it on those sites specifically, rather than darkening `--accent` itself, since `--accent` also drives non-text fills and borders with no contrast obligation of their own. Found via a full, word-boundary-safe re-sweep of every `color: var(--accent)` site (73 total) — a naive grep would have double-counted `border-color`/`text-decoration-color` uses along the way. Two clusters are deliberately still on the old value: video/footage metadata tags and a handful of mobile-picker/bold-emphasis strings, both already flagged for a single follow-up pass rather than being swept up piecemeal here.
- **Gas & equipment is now grouped by what each field actually describes, not by input type.** Start/End pressure, Weight and Suit used to share one undifferentiated row, with Size/Gas mix/Tank type trailing below — so Weight and Suit, neither of them a cylinder attribute, read as part of "Cylinder & pressure" purely by proximity. Now **Cylinder & pressure** covers Start/End, Size/Gas mix and Tank type as one block, and a new **Weight & suit** label holds the two personal-gear fields at the end. A pure reorder — every field kept its id and existing wiring, so nothing downstream needed to change; confirmed live that the section's summary chip still reads pressure/gas/size correctly. Also fixed in the process: the two rows that now have only 2 fields switched to a proper 2-column layout rather than reusing the old 4-column one — reusing it would have reproduced the exact "phantom empty column" bug the Depth row fix (above) had just found, only worse.
- **Start, End, Size and Weight no longer stretch to fill their row, and their scroll-wheel picker moved to sit beside the field instead of above it on the label line.** Moving these into dedicated 2-column rows (above) meant a 3-digit pressure was rendering in a box roughly twice as wide as it needs — the field now caps at a fixed width, and the space that frees up is exactly where the wheel button now sits, which is also a more discoverable position than tucked onto the label row. Tank size now gets the same scroll-wheel as Start/End/Weight, defaulting to 12 L to match its existing pre-filled value. Gas mix and Suit are unchanged — a dropdown and a free-text field aren't "fine-tune around a known figure" inputs, so neither fits what the wheel is for.
- **The scroll-wheel button's icon is now clearly visible.** It was using a colour your own design system documents as "decorative only... cannot pass, by design" (2.16:1 contrast) — fine for passive text, wrong for a button someone needs to notice is tappable. Switched to the same colour every other secondary-but-interactive icon in the app already uses (4.52–5.48:1).
- **`android_list_md_files` is now incremental — a "nothing changed" Android Drive sync dropped from 62.5 s to ~400 ms.** It used to read all 94 `.md` files' content sequentially on *every* sync, including the one fired at every boot, so a launch re-downloaded the entire vault from Drive to learn what it almost always already knew. It now takes an optional `since_ms` cursor and skips the content read entirely for any file whose SAF-reported `last_modified` isn't newer — the cursor is the newest `last_modified` the call itself observed, never the device clock, so it can't be thrown off by clock skew against whatever clock the SAF provider uses. JS keys the stored cursor on the folder's own `uri` (`_androidFolderSyncCursor`, `js/app.js`), not a bare timestamp, so a *different* folder can never compare against a stale cursor left over from another one — no reset logic needed elsewhere, a mismatched `uri` just reads back as no cursor and triggers a full read, same as a genuine first sync. **Verified on hardware, not just timed:** one dive's `.md` was rewritten with identical content (bumping only its mtime) and a direct call with the prior cursor came back with exactly that file and none of the other 93 — proof the filtering is correct, not just fast. A sync of a genuinely changed file, through the full pipeline (sidecar/profile listing, `importDivesFromFiles`, etc.), took 44.75 s on one run; not a regression in this fix specifically — the isolated test already showed only the touched file's content gets read — but Drive's own per-call latency in the *other* pipeline steps, unrelated to `since_ms` filtering. **Also found live: Google Drive's `last_modified` is eventually consistent.** A listing moments after a write can still report the file's old mtime; the same listing ~15 s later reported the new one correctly. Worst case is a one-sync delay for a just-made edit, never a lost one — the next sync's cursor is still older than the file's true mtime once it propagates, so it gets picked up then.
- **Android: a hard-block prompt to connect a backup folder, appearing once — right after the first dive is logged.** Browser and Obsidian sync are both guaranteed dead ends inside the Android native shell specifically (`showDirectoryPicker()` aborts inside the WebView; the Obsidian Local REST API plugin doesn't support Android at all), so Folder sync is the only backend that can ever back this app up on this platform — left opt-in, that's easy to never notice until a lost phone makes it matter. Deliberately not a first-launch prompt (nothing's at stake yet, so it'd be pure friction) and deliberately not a dismissible banner (a "not now" that quietly goes away is exactly how this gets forgotten). Once it appears — after the first dive is saved, so there's finally something real to protect — it's a true hard block, no close button; cancelling the folder picker just leaves it up. Checked both right after every save and at boot (`js/app.js`, `index.html`), so force-quitting the app mid-prompt isn't an escape hatch — the same condition just re-fires on next launch. See `BRIEF-play-store-readiness.md` §2.11.
- **Android OAuth redirect mechanism for Google Drive, built and live-verified — the Google-server side stays blocked on an external prerequisite.** Investigating "media ingest" (the last piece of plan step 9) found it isn't an Android port of the desktop footage-match feature — that was already decided to stay macOS-only — it's the Drive photo/video upload feature, which doesn't exist yet on any platform. The desktop OAuth flow's `127.0.0.1` loopback listener has no Android equivalent, so `gdrive.rs` gained a second consent-flow implementation using `tauri-plugin-deep-link` (a custom `shoal-oauth://callback` scheme, auto-wired into the Android manifest via `tauri.conf.json`), sharing the same PKCE generation and token-response parsing as the desktop path and differing only in how the auth code comes back. **Verified live, not just compiled:** installed on a Galaxy S10, armed a JS-side listener, fired a real `shoal-oauth://callback?...` intent via `adb shell am start`, and confirmed Android correctly routed it to the running app and the event reached JS with the right URL — the entire mechanical pipeline proven end-to-end, independent of Google's servers. What's genuinely blocked (not just unbuilt): the Android OAuth client itself needs a real registration keyed to the Play app-signing SHA-1, which only exists once a Play Console app has received an AAB — an external, account-creation step, not more engineering. Also confirmed, separately: the media-picker UI needs no new native code at all — a plain `accept="image/*,video/*"` file input (the same pattern the existing UDDF import already uses) opens the real Android system picker with Images/Videos category filters, once triggered by an actually-trusted gesture (a bare `.click()` from script correctly does nothing — file-choosers require real user-activation context, confirmed by testing both ways).
- **`--radius-*` scale started** (`css/styles.css`) — the first piece of the brief's step 7 (CSS primitive consolidation). `--radius-xs/sm/md/lg/full` picked from the real distribution of the 25 distinct raw `border-radius` values already in use (8px/6px/4px/12px are the dominant steps; 999px is the pill idiom), not arbitrary numbers. Only the unambiguous part is migrated so far — the 4 genuine pill-chip sites (`.shimmer-slider`, `.lf-loc-btn`, `.cat-pill`, `.sp-country-pill`) now use `var(--radius-full)`. The other ~230 declarations are deliberately untouched: reassigning them correctly needs a real visual pass, not a blind nearest-value find/replace, and 50% (circular dots/handles) is intentionally kept out of this scale entirely rather than folded in, since it means something different in intent from a pill.
- **Folder sync now works on Android** (`android-spike` branch). Android had *no* working way to pick a folder: the native picker doesn't exist for Android in `tauri-plugin-dialog` at all, and the web `showDirectoryPicker()` you'd fall back to silently aborts inside Tauri's WebView — both confirmed on a real device, not inferred. Shoal now talks to Android's Storage Access Framework directly (`tauri-plugin-android-fs`, five thin `android_*` commands in `src-tauri/src/androidfs.rs`), so picking a folder, saving dives into it, reading them back and deleting them all work on a phone. Picking a **Google Drive folder still needs no Google sign-in** — the OS does the syncing, which is the whole reason this path is worth having. Verified end-to-end on hardware: pick → write a real dive → read it back → delete → confirm gone.
- **`isAndroidShell()` / `isDesktopShell()`** — a platform discriminator alongside `isShell()`. `isShell()` answers "is this a Tauri build?" and is true on Android too, which is *not* the question most callers are asking; that ambiguity is exactly why tapping "Set folder" on Android did nothing (it routed to a desktop-only command). There are three storage backends now — SAF content URIs, desktop absolute paths, browser File System Access handles — and the folder-sync seam finally distinguishes them. Deliberately scoped to the 8 folder-sync sites; the other ~33 `isShell()` call sites each mean something different and are a separate audit.
- **`--profile-warn`** — a chart-only NDL-warning colour, holding the *original* `--warn` (`#E0734F`) that the contrast correction below darkened for text use. `renderProfileChart` reads it via `getComputedStyle` for both the curve's gradient and the `.df-pc-legend-bar` beneath it, feeding both from the one variable, same as before. A rendered stroke carries no WCAG text-contrast obligation the way banner/badge text does, so nothing forces this one's lightness down — it keeps the full separation from `--danger` that made it read as coral in the first place. `landing/prepare-shared.sh` needed no changes to pick it up; a new token in `:root` is exactly what the extraction was built to carry.
- **Footage and dive-computer-profile sidecars now load on Android**, closing the last gap in the SAF folder-sync backend: `loadAllSidecars` (`js/video.js`) and `loadAllProfileSidecars` (`js/profile.js`) each gained an `isAndroidShell()` branch — same per-dive `android_read_file` call the desktop branch makes with `read_text_file`, just addressed by `(folder, filename)` instead of a concatenated path. Sidecar *writes* already worked (`_writeSidecarToFolder`/`_writeProfileSidecarToFolder`, shipped alongside the core folder ops above); without this, a dive synced via folder mode on a phone would silently show no footage links or profile chart even when its sidecar file was sitting right there in the folder.
- **`deleteSidecar` (`js/video.js`) now delegates to `_deleteBackendFile()`** instead of its own hand-rolled obsidian/shell/browser branching — it had never been back-ported when that shared helper was introduced, unlike `deleteProfileSidecar` (`js/profile.js`), which already delegated to it. That left a bare `isShell()` check on the footage-sidecar delete path: on Android it would have tried a desktop-shaped `remove_file` call with a concatenated path against a content URI, rather than the `android_delete_file` command Android actually needs. Same fix as everywhere else this session, but arrived at by deleting ~25 lines of duplicated logic rather than adding a third branch to it.
- **Two more `isShell()`-ambiguity bugs found in a consistency sweep, both fixed:** `_bleHasSyncDestination()` (`js/computer-sync.js`) checked `localStorage['divelog-shell-vault-path']` on any shell build, but Android never sets that key (it uses the separate SAF folder handle) — a dive computer would have reported "no sync destination" and refused to sync even with a correctly configured Android folder. Fixed with the same `isAndroidShell()`/`isDesktopShell()` split used everywhere else, including the Android SAF-grant equivalent of `_folderNeedsReconnect`. **`exportAllDives()`** (`js/app.js`) called the native `pick_folder` dialog directly on any shell build — the same picker `setDiveFolder` originally called, which doesn't exist on Android and errors via the stub. It now gets its own `isAndroidShell()` branch: a fresh `android_pick_folder` pick (never the persisted sync folder — this is a one-off export destination) followed by a per-file `android_write_file` loop, mirroring the desktop branch beside it.
- **BLE dive-computer sync now has a real Android transport, verified against real hardware.** `src-tauri/src/ble.rs`'s Android branch was five stubs since the spike (`btleplug`'s own Android backend needs a hybrid Rust/Java/JNI build this project has no reason to take on). It now calls `tauri-plugin-blec` instead — chosen specifically because it wraps that same pain behind Tauri's standard auto-wired plugin build, the same trade already made for folder access (`tauri-plugin-android-fs` over hand-rolled SAF/JNI). Entirely Rust-internal: `js/computer-sync.js` still only calls this app's own five `ble_*` commands and needed zero changes. Confirmed live on a Galaxy S10 against a real Shearwater Peregrine: tapping Sync found and connected to the device, correctly identified the model, and began downloading its full dive history — every piece of the transport (permission gate, scan, connect, characteristic discovery, subscribe, packet pump) working end-to-end. Also caught Android 12+'s runtime `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` permission requirement live (an ungated scan failed with "Missing permissions" despite the manifest already declaring them) and fixed it with the plugin's own `check_permissions()` gate. **`minSdkVersion` raised from 24 to 26** (`tauri.conf.json`) — `tauri-plugin-blec`'s own manifest requires it; a real, if likely small, cost worth being aware of (Android 7.0/7.1 devices can no longer install the app).
- **BLE sync progress bar picked up three small details from Material Design 3's current linear-indicator guidance** — structure, not MD3's own colours/component, same rule this codebase already applies to its MD3-derived colour architecture. The track is now tinted with `--accent-dim` instead of a neutral surface tone (MD3 ties track colour to the indicator's own hue family); a small "stop indicator" dot sits at the track's end; and the fill's leading edge now shows a small gap against the remaining track (a `border-right` on the fill itself, colour-matched to the track — since `box-sizing: border-box` makes a border eat into an element's own width rather than add to it, this rides along with the fill automatically, no separate positioned element to keep in sync). Also closed a real, unrelated-to-MD3 accessibility gap the same pass turned up: the progress bar had zero ARIA semantics at all. `#lf-ble-progress-track` now carries `role="progressbar"` plus live `aria-valuenow`/`aria-valuetext` (the latter carrying the same "42% · 6 dives so far" text sighted users already see, not just a bare number).
- **`--warn` nudged from `#A4543A` to `#9C5621`.** Rendering the first contrast fix (v2.99) surfaced a real, un-computed problem: darkening `--warn` for text contrast had also collapsed its separation from `--danger` to 3° of hue and −11pt of saturation — less vivid than danger, backwards from the coral/rust relationship the two are meant to have. Exhaustive search confirmed hue was never the lever available (the original coral was only 3° from danger too) and no hue/saturation choice lets `--warn` sit lighter than `--danger` while still clearing 4.5:1 on the page — lightness is what actually separated them, and lightness is exactly what text contrast pins down. This value spends the available room on hue (+11° vs. the previous fix) and saturation (+17pt) instead, landing at 14°/+6pt from `--danger` — the most separation achievable within the same 4.5:1 floor (now 4.71:1). Matching rgba tints moved with it (17 sites, `rgba(164,84,58,…)` → `rgba(156,86,33,…)`).
- **`.hist-map-btn`/`.hist-back-btn` (History toolbar's "Map"/"← List" pair) merged into one shared rule** — they were a near-byte-identical duplicate, and merging them caught a real drift: `.hist-back-btn:hover` was missing the `background: var(--accent-dim)` tint its twin already had.
- **First pass at the `.btn` CSS primitive.** A full census found ~65 button-shaped CSS rules across 13 shape-families — about double the brief's original "~30" estimate. This pass merged the three safely-verifiable duplicate families: a new `.jump-pill` absorbing 3 byte-identical accent-pill rules (`.m-jump`/`.watch-clips-n`/`.watch-jump`), new `.btn-confirm-ok`/`.btn-confirm-cancel` absorbing 2 more byte-identical pairs (`.tl-rename-*`/`.sp-dive-*`), and `.hist-map-btn`/`.hist-back-btn` (noted above). The two largest families — a 9-member solid-CTA family and an 18-member ghost/outline family already anchored by a real `.btn-ghost`/`.btn-primary` — are deliberately deferred to a follow-up pass, same as an 11-member icon-square-button family that looked like more padding drift at a glance but turned out to carry real background/border variance the file's own existing touch-target comment already flags as needing a live device check before resizing. See `CLAUDE.md` → "Built" for the full account.
- **Second `.btn` pass, same day: 2 more near-duplicate pairs found by reading through the two large deferred families individually.** `.numscroll-set` (the number-wheel picker's "Set" button) and `.afr-card .afr-go` (the Android folder-prompt CTA) were identical but for a 1px padding accident — merged with each keeping its own padding as a small override. `.vid-del`/`.vid-stamp-btn` (footage-modal delete/edit icons) were a second near-duplicate, catching two real bugs: `.vid-del`'s danger hover was missing the background tint `.hist-map-btn`'s merge already found the same class of gap in, and `.vid-del` used `--text-dim` (a decorative-only, non-contrast-passing token) where every other interactive icon uses `--text-muted`. Verified live for the reachable one (`.numscroll-set`, opened from the Gas & equipment pressure-wheel trigger); `.vid-del`/`.vid-stamp-btn` sit behind the Tauri-shell-only footage modal and were verified by source cross-check instead, including confirming the app's dark-theme override for both classes still resolves correctly against the merged rule.
- **New `.pill` CSS primitive, the second of the brief's not-yet-built ones.** Checked all 8 "chip" candidates the earlier button census had listed; only `.cat-pill` (Species Album category jump-nav) and `.sp-country-pill` (country filter bar) turned out to share an identical base box — merged into `.pill`, keeping each one's own hover/active state untouched since the code already documents that difference as deliberate (a filter shouldn't look clickable-to-jump the same way a jump-nav does). The other 6 candidates were real, different things on inspection: a softer sans-serif pill in a different context (`.pdc-loc-pill`), two members of the reserved dive-type colour ramp (`.lf-type-chip`, `.df-type-pill`), a plain text label with no box at all (`.fm-tag`), and two non-interactive informational badges that don't match each other either (`.fm-vid-chip`, `.df-pc-pill`). Verified live on the Species panel: the country filter still toggles to solid accent-fill correctly, and a category pill still jumps to its section.
- **Dive-type texture channel — a colourblind-assist second signal on the `--type-*` ramp, opt-in via two nested toggles in Settings → "Dive-type textures".** Every render site already labels its dive type as adjacent text, so WCAG 1.4.1 already passes everywhere and this is a glanceability aid, not a compliance fix — both toggles default off. **"Distinguish dive types by pattern"** textures the one wordless swatch in the app today, the Stats dive-type bars (`js/stats.js`), and grows their track 9px → 14px while it's on so the pattern has room to read. **"Also on labelled tags"**, nested and disabled until the first is on, additionally applies a letterform-hugging halo (`-webkit-text-stroke` + `paint-order: stroke fill`, not a plate — a plate behind a word reads as a bandaid) to the three worded swatches: the timeline spine, the log-form chip (selected state only — the unselected chips are just a thin border stripe, not a real swatch), and the dive-file hero pill. Seven textures (solid/dots/arcs/vertical/horizontal/diagR/diagL) cover all ten dive types via a graph-colouring assignment — every pair of types sharing a texture is verified far apart in colour under both protanopia and deuteranopia simulation — derived in `mockups/mockup-type-patterns.html` and `CLAUDE colour UI.md` → "Dive-type texture channel". A `TYPE_TEXTURE` table (`js/app.js`) is the one shared source every render site reads from at render time; nothing is baked into CSS classes per type. Turning the primary toggle off automatically disables the secondary one's *effect* without erasing its stored preference, so re-enabling the primary brings the secondary state straight back.
  **Found live during implementation, not anticipated in the design doc: the `background` CSS shorthand silently deletes `background-image`.** Every one of the four consumer sites sets its `--type-*` fill via `background: var(--type-X)` (three as CSS rules, one as an inline style) — and the shorthand form resets every sub-property it doesn't mention, including `background-image`, back to its initial value. That clobbered the texture layer at all four sites simultaneously: three silently (equal-specificity rules losing on source order) and one unconditionally (an inline style always wins over any stylesheet rule, regardless of specificity). Fixed by switching all four origin points — `.st-fil`, `.dD-spine`'s base and per-type rules, `.lf-type-chip`'s base and `.sel` rules, and `js/history.js`'s hero-pill `typeStyle` — from `background` to `background-color`, which only ever touches the fill colour and leaves any external `background-image` rule free to apply. Verified live at all four sites, in both themes, with both toggle states, including the dependent-disable behaviour and a console-error sweep.
- **New labelled-field CSS primitive, the third of the brief's not-yet-built ones — `.field`'s existing wrapper/label rule now covers 3 more classes found by a full census.** The census found 9 distinct label/wrapper families doing the nominally-one job of "caption above/beside a control," against 82 real form controls app-wide. Only 2 were genuine duplicates: `.lf-numcol`/`.lf-numlbl` (the log form's compact number-with-unit rows — Bottom time, Max depth, Start/End pressure, …) turned out byte-identical to `.field`'s own wrapper and label rules, just typed out a second time with the declarations in a different order; `.lf-site-label` (the Site name field) matched `.field label`'s typography value-for-value but reaches it through different plumbing (a `margin-bottom` instead of a flex `gap`, since its row isn't a flex column), so only its typography merged in, not its layout. Both old class names stay as working aliases — zero call sites needed to change, same technique as every primitive before this one. A new `.form-label` class extends the same typography to labels with no wrapper at all, replacing two ad hoc `style="font-size:var(--font-size-sm)"` one-offs (`js/footage-match.js`'s camera-offset field, `js/profile.js`'s bulk-add dive-number field) that predated the primitive and didn't match it.
  **5 more candidates were investigated and correctly excluded** — `.tx-lbl` (this week's own new Settings-toggle label — a horizontal row pairing a two-tier title+description with a switch, not a vertical label-above-input at all), `.af-lbl` (footage-tagging form — a horizontal layout with drifted typography, `letter-spacing:0.05em` not `0.04em`, plus `text-transform:uppercase`, which `.field label` never sets), `.lf-dial-name` (the vis/temp dial headings — bold, `sm` not `xs`, no mono), `.stop-type` (the Safety/Deco stop rows — a deliberately `aria-hidden` caption backed by a real `aria-label` on each input, honest markup for a 3-column grid row, not a `.field`-shaped stack), and `.pdc-loc-search-label` (Plan panel's conditional "Add location" caption, styled but visually a heading rather than a per-field caption).
  **A real accessibility gap surfaced by the same census, fixed alongside it: the Plan panel's inline dive-add/edit row had zero labels at all** — 8 inputs (`.sp-add-input`, `js/planner.js`) identified only by placeholder text, which disappears once typed and isn't announced by every screen reader the way a label is. Added `aria-label`s to all 8 (4 in the add row, 4 in the per-row edit form) — the same "field too cramped for a visible label" pattern the app's accessibility pass already used elsewhere (the GPS coordinate fields, the vis/temp dial range inputs). Confirmed live in both themes: no visual change anywhere `.field`'s label typography already applied, and the merged classes render pixel-identical to before.
- **New `.chip` CSS primitive — the sixth and last of the brief's originally-planned set, and it turned out to already exist under a different name.** A dedicated census (every `border-radius: var(--radius-full)` site plus a broad sweep for anything chip/tag/token-shaped) found exactly one live candidate anywhere in the app that wasn't already `.pill`, `.tab-strip`, a reserved dive-type-ramp member, or a non-interactive badge: `.ulchip`, the "already-logged sighting" quick-link chips in the footage-tagging modal (`js/footage.js`). It's a close-but-not-identical twin of `.pill` — same font, border, and background, and its own hardcoded `20px` radius resolves pixel-identical to `--radius-full` at this height (the same clamping behaviour the tab-strip primitive already relies on) — but with darker ink, tighter vertical padding for its dense horizontally-scrolling row, no letter-spacing, and its own hover state plus a `"+ "` prefix. Rather than force those real differences into uniformity, the shared geometry alone moved into the same base rule `.pill` already uses (now `.pill, .chip, .cat-pill, .sp-country-pill, .ulchip`), with `.ulchip`'s colour/padding/hover kept as its own override — same technique as every merge before this one. **`.chip` itself is a deliberately bare alias, not a second shape**: with no evidence anywhere in the app of a genuinely different "chip" job distinct from "pill," inventing one would be exactly the kind of unforced distinction this whole consolidation effort has been checking for and rejecting elsewhere. It exists so a future call site has the generic name the brief asked for, sharing `.pill`'s exact rule. Two other candidates were investigated and ruled out as the wrong *shape* rather than merged: `.tp-tag` (footage player's "＋ Tag here" button — solid accent-fill, `radius-md`, already in the deferred CTA-button family) and `.roc-btn` (the R/O/C abundance selector — a fixed 30×30 square using the same solid-fill "selected" language already excluded from `.pill` for `.sp-country-bar`). Verified live: the Species panel's category and country pills render unchanged; `.ulchip` (unreachable in a plain browser — the footage modal is Tauri-shell-only) verified by injecting its real markup and reading computed styles, confirming `999px` radius, its own `4px 12px` padding, and its `"+ "` prefix all intact.
- **Triple-duplicate read-only abundance badge merged into one shared rule.** `.sp-ab` (`js/history.js`, the dive-file sightings list), `.sp-sighting-row .ab` (`js/album.js`, the Species Album's per-species dive log), and `.vid-stamp-ab` (`js/footage.js`, footage-modal stamp rows) — the small R/O/C letter shown next to a logged sighting — were three separate, near-byte-identical CSS rules, a genuine duplicate the `.chip` census found but correctly left out of that pass (a badge shape, `border-radius: 5px`, not a chip/pill's `--radius-full`). All three now share one base rule; the two real differences (`.sp-ab`/`.sp-sighting-row .ab`'s `font-weight: 700`, which `.vid-stamp-ab` lacks; `.vid-stamp-ab`'s own `flex-shrink: 0`, needed because it sits in a flex row the other two don't) stay as small separate overrides, same technique as every primitive merge before this one. Verified live: the dive-file sightings list and the Species Album's sighting row both render pixel-identical to before (confirmed via `getComputedStyle` — `font-weight: 700`, `border-radius: 5px`, unchanged padding/colour/background on both); `.vid-stamp-ab` (Tauri-shell-only) verified by injecting its real markup, confirming it correctly keeps its own `flex-shrink: 0` and correctly does *not* pick up the bold weight, matching its original appearance exactly.

### Fixed
- **The mobile Settings cog stayed visible over the dive-file view, which it should never appear on.** Unlike the species profile and footage modals — real full-screen overlays that sit well above the cog's own layer, so they naturally cover it — the dive file just swaps content in and out of the normal page in place, so the persistent, always-rendered cog was left showing on top of it. Now explicitly hidden while a dive file is open and restored on every way of leaving it (the back button, the back gesture, and closing it directly), confirmed live on all three paths.
- **Seven places across the app had a hardcoded top offset with no allowance for a display cutout — found clashing with the front camera on a real Galaxy S10, then swept for the rest after a second sighting on an emulated Pixel 9 Pro.** `.mobile-cog` (the Settings button), `.df-hero-close` (the dive-file hero's full-screen close), and `.sp-mh`/`.sp-close` (the species profile photo's close button) all pin themselves to a small fixed distance from the true top-right corner once their container goes full-screen on mobile. `.main`'s own mobile top padding had the identical gap, affecting every panel's heading rather than one button. Three more turned up in a follow-up sweep specifically because they don't individually position a close button the way the others do — a plain header bar spanning the top of a full-screen surface is just as exposed: `.map-modal-head` (the log-form pin picker and trip-map full-screen view), `#sp-mob-overlay`'s topbar (the log form's mobile species picker), and `.fm-dialog-head` (the footage-tagging modal). All seven now add `env(safe-area-inset-top)` to their existing offset, the same technique already used for the bottom nav's safe-area clearance. Confirmed live in a normal browser that this is a no-op there (the inset defaults to 0px, so nothing shifts) — the actual clearance only applies on a device that reports a real cutout. A few full-screen surfaces were checked and deliberately left alone (the Android folder-required prompt, the confirm dialog, the number-scroller sheet) — all centre or bottom-anchored, so they were never exposed to begin with.
- **On mobile, the Depth row was rendering its two fields at 2/3 the width they could have, and the page's outer margins were wider than intended — both from the same design pass, found from a screenshot.** Below 600px, `.lf-pfields` has no column cap (`repeat(3, minmax(0,1fr))`) so each of its 3 columns claims a full third of the row whether or not a field actually sits in it — Depth only has 2 fields, so it was rendering inside that same 3-column template with the third column sitting empty. A new modifier, applied to the Depth row only, gives it its own 2-column template below 600px while leaving the shared, already-correct 3-column 132px template untouched at desktop widths (verified: identical alignment before and after). Measured live at a real 380px width: Max/Average grew from 131px to 167px each. Investigating this also surfaced a real, independent bug: three separate `@media (max-width: …)` breakpoints (720px, 600px, 480px) were all setting `.main`'s padding, and since `max-width` queries are ceilings rather than ranges, the 720px block's plain `padding: 1.5rem` — a leftover from before the current bottom-nav mobile redesign — was winning at *every* phone width via plain source order, not just its own intended tier. Confirmed live: a 500px window computed a flat `24px` all round, not the 600px block's carefully safe-area-aware value at all — meaning the nav-wave-clearance bottom padding described elsewhere in this file had likely never actually applied on a real phone. Fixed by giving the 600px block's padding the same `!important` guard its `margin-left` already had, and deleting the 480px block outright, since every one of its three rules was now provably unreachable rather than merely redundant. The page's mobile side margins were also trimmed slightly as part of the same pass (10px → 6px each side), freeing a small amount of width for every number-row on the form.
- **Several custom category-tab controls were not operable by keyboard at all, independent of any missing ARIA label.** Found while wiring `aria-selected` onto them: `species.js`'s `.browse-tab`/`.species-browse-tab`/`.sp-picker-tab` (3 render sites) and `footage.js`'s tag-picker `.browse-tab` were all wired only to `onmousedown`, deliberately, to beat a search input's blur event. That choice has a real cost — a `<div>` with no `tabindex` isn't focusable at all, and even the one real `<button>` among them (footage.js's tag picker) doesn't help, since a native button's keyboard-triggered activation fires a synthetic `click`, never `mousedown`. Fixed with `tabindex="0"` where needed plus a parallel `onkeydown` handler calling the same function on Enter/Space, everywhere this pattern appeared. Verified with a real dispatched `KeyboardEvent('keydown', {key:'Enter'})` in a browser, not inferred from source — confirmed it actually switches the active category, not just that the markup looks right. **Any future custom control using `onmousedown` instead of `onclick` needs this same check** — the blur-race fix and keyboard operability are separate concerns, and fixing one doesn't fix the other.
- **`footage.js`'s tag-picker `.browse-tab` doesn't fully re-render on tab switch, unlike every sibling control that looks the same shape** — `setTagPickerTab()` paints via a `classList.toggle('active', …)` loop over already-rendered buttons, not a fresh `innerHTML` write. Assumed otherwise at first (matching the other three category-tab sites, which do fully regenerate), which would have shipped `aria-selected` correct on load but frozen after the first click. Caught before shipping by re-reading the state-update function specifically, not by assuming consistency across visually-identical controls — now updates `aria-selected` in the same loop as the class toggle.
- **"Export unvalidated species" opened the real native save dialog on Android but the write behind it always failed.** `write_text_file` is pure `std::fs::write`, which has no concept of the `content://…` URI Android's save dialog hands back. New Rust command `android_write_uri` (`src-tauri/src/androidfs.rs`) constructs an `FsUri` via `FsUri::from_uri` from that same string and writes through `tauri-plugin-android-fs` directly — the plugin ships `impl From<FilePath> for FsUri` for exactly this interop, settling a design question left open in step 8's first pass. Also fixed the display-name bug the write fix exposed: the success message derived a filename via `path.split('/').pop()`, meaningless on a content URI (same shape as the Drive folder-name bug); now uses the filename already known from building the export. **Verified end-to-end on hardware**, including a real save-dialog tap: a throwaway sighting was injected into memory only (never `localStorage`, confirmed after), exported, saved for real, and the resulting file read back byte-for-byte correct before being deleted — the app's real 94-dive vault was never touched.
- **The Admiralty UK Tidal API was reachable on Android, contradicting its own "desktop-only" documentation.** `fetch_tide_events` (Rust) has no platform gate and would answer identically on Android, but Admiralty is desktop-only by design (CLAUDE.md v2.6) — a scope decision, not a technical limit. 4 call sites (`js/app.js`'s settings visibility; `js/planner.js`'s `fetchPlanTide`, `_planTideCardHtml`, `_planTideNoteHtml`) used `isShell()`, which meant "desktop" back when Android didn't exist as a distinct shell and silently stopped meaning that once it did. All 4 now use `isDesktopShell()`. Confirmed live on hardware: the settings section now reads `display: none` and the Plan panel's tide note renders empty on Android, where both previously would have shown.
- **A lapsed Android folder grant offered no way to reconnect.** `_isFolderPermissionError` (`js/app.js`) matched only desktop-shaped phrasing (`refused|authoris|not permitted|denied|os error 1`), but a revoked SAF persisted-URI grant surfaces as *"No directory or permission, or invalid state"* or *"No permission or entry: content://…"* — neither of which matched. So `_folderNeedsReconnect` stayed false, `renderSyncStatus()` never showed its "Reconnect" button, and the user got a dead-end "⚠ Could not read folder" when re-picking the folder was exactly the fix. Hit for real on hardware after a Google Drive grant lapsed: folder sync failed silently at boot while 94 dives kept rendering from the local cache, which looks indistinguishable from working. Now also matches bare `permission` and `invalid state`.
- **"🎬 Match footage to dives" silently did nothing on Android.** A first pass at plan step 8's remaining `isShell()` audit found this button (unconditionally visible on every platform) calls `connectProxyFolder()`, whose Android branch invokes `pick_folder` — which errors there — and that error was caught by `.catch(() => null)` and silently swallowed, so tapping it produced zero feedback. Same failure shape as the original `setDiveFolder()` bug that started this whole Android effort. Not portable to Android by design (already decided: "Android uses picker + Drive, not folder scanning"), so fixed by hiding `#footage-match-section` outright on `isAndroidShell()` rather than trying to make it work. See `BRIEF-play-store-readiness.md` §2.10 — the `isShell()` audit is now complete: of the ~38 remaining sites across every file examined, only 3 were real bugs in total (this one, plus the two above), the rest already correct as written. Most callers genuinely meant "any Tauri build," which the original "41 sites, 33 latent bugs" framing didn't anticipate.
- **`exportAllDives()` — "Export all dives" was writing every `.md` file with no YAML frontmatter at all, on every platform.** `_exportFilesForDive` (`js/app.js`) wrote `generateMD(d)` alone; every other save path (`writeToFolder`, `pushToObsidian`, and the sidecar-rename path) writes `generateFrontmatter(dive) + '\n' + generateMD(dive)`. Missing frontmatter means no `uid`, `divenum`, or any structured field — just the prose/table body, unreadable by the app's own re-import, Obsidian's Dataview queries, or anything else that reads the YAML block. Not new, not Android-specific — this is a pre-existing bug in a function shared by every export path (desktop shell, Android shell, browser folder, and the Brave/Safari zip fallback), only surfaced now because clicking the real button end-to-end today was the first time anyone had actually run this path this session. Fixed with the one missing call; re-verified on-device that a real dive now exports with correct frontmatter (`uid`, `dive_number`, `title`, `date`, `site`, `country`, …) ahead of the body.
- **`android_write_file` (`src-tauri/src/androidfs.rs`) was silently corrupting the filename of every sidecar it created.** Its first-write fallback (`create_new_file`, used whenever the target doesn't exist yet) hardcoded the MIME type `"text/markdown"` for every file — but that MIME type doesn't just fill in a missing extension, Android's `DocumentsContract.createDocument()` *enforces* one matching the MIME type. A `.md` dive file's own extension already matched, so the core folder-sync round-trip (verified end-to-end earlier) never exposed this. A sidecar ending `.footage.json` or `.profile.json` doesn't match `text/markdown`, so Android silently renamed it on creation — `dive-001-little-angel.footage.json` landed on disk as `dive-001-little-angel.footage.json.md`. Every future read then looked for the correct name, found nothing, and quietly reported "no sidecar for this dive," which is indistinguishable from a dive that genuinely has none. Found by testing today's `loadAllSidecars`/`loadAllProfileSidecars` fix against a real write on hardware — the write reported success, the read came back empty, and `adb shell ls` on the actual folder showed why. Fixed by passing `None` instead: the plugin infers the correct MIME type from each file's own extension. Re-verified on the same device after the fix: write → real content read back correctly for both sidecar kinds → delete → confirmed gone from the filesystem, not just the in-memory cache.
- **Verified on hardware (Galaxy S10, Android 12), same session as the two fixes above:** sidecar read/write/delete round-trip (both `.footage.json` and `.profile.json`) with real data; `_bleHasSyncDestination()` now correctly reports `true` with an Android folder configured; `exportAllDives()`'s new `android_pick_folder` call opens the real native SAF picker from that exact code path, and a cancelled pick resolves cleanly to `null` (same contract the function already relied on). The full write-loop after a *completed* (non-cancelled) picker selection wasn't click-tested — synthetic taps on the native picker UI proved as unreliable as they were on the WebView earlier in this branch's testing — but the underlying `android_write_file` primitive it calls was independently verified in the sidecar round-trip above.
- **Four real dark-mode bugs found by the user immediately after shipping, all fixed the same day — two in a first pass, two more (including a follow-up on one already "fixed") after further testing.** (1) **Every IUCN badge rendered with the same neutral colour — CR/EN/VU's differentiation was "completely gone."** The dark theme's rank-colour rules boosted CSS specificity for the `class="iucn iucn-CR"` pattern (`js/album.js`) but not the equally-common `class="iucn-badge iucn-CR"` pattern (`js/species.js`, used by the Marine Life IUCN key legend) — at identical specificity the neutral fallback won by sitting later in source. Fixed by adding the missing `.iucn-badge.iucn-X` boosted selector alongside the existing `.iucn.iucn-X` one. (2) **The visibility/water-temp dial's dark end merged into the dark card** — fixed with a `box-shadow` boundary ring, matching a fix the original design mockup had already anticipated. (3) **That fix wasn't the whole story** — reported again as "it should look lighter on the right, it still looks dark." The dial's gradient fades to full transparency at its "clear"/"hot" end (`rgba(74,144,184,0)`), which was always secretly relying on the page behind it being light — on a dark page the same transparent pixels read as dark, backwards from the murky→clear metaphor. Fixed with real dark-mode gradient overrides (verbatim from the design mockup for vis; the temp dial's single broken transparent stop replaced with a solid colour, keeping its real designed hot end) on `.dial`, `.df-vbar-track` (dive-file hero vis ticker), and `.df-ov-gaugebar` (Overview tab temp gauge) — all three duplicate copies of the same baked gradients. (4) **The sidebar logo and dive count went dark-on-dark** — `.logo-name`/`.dive-count strong` used `var(--on-inverse)`, a token derived from `--surface-low` and designed to flip opposite `--text` for elements using `var(--text)` as their own background. The sidebar isn't such an element (it's a fixed, permanently-dark gradient, unrelated to either token) — the derivation happened to resolve correctly in light mode by coincidence and inverted in dark. Confirmed nothing in the app still needs the flip behaviour (the one site that did, `.mobile-cog`'s background, was already fixed to a constant literal earlier the same day) before pinning `--on-inverse` itself to a constant, matching how `--accent-on-dark` already works for the same always-dark chrome. (5) **The Plan calendar's springs/neaps tidal distinction "doesn't make as much sense now"** — `.plan-day.spring` used a hardcoded `rgba(139,123,106,…)` warm-brown tint (the pre-2026-07 `--text-muted` value) calibrated as a subtle overlay against a light page; at the same low alpha against an already-dark cell it barely registered. Replaced with `var(--surface2)`, continuing the existing `--bg`→`--surface` mid→neap progression onto its natural next rung, which — unlike the fixed literal — carries the same distinction correctly in either theme. (6) **A follow-up design pass on (3)'s fix** — reported as "pretty flat," needing "much brighter on the right," with the user directly questioning why vis/temp needed dark-specific gradients at all rather than one gradient that just works in both themes. The (3) fix's dark-only stops were bunched into the first quarter of the bar, leaving most of its width barely changing tone — a genuine design-quality miss, not just a residual bug. Superseded (3)'s per-theme override entirely: `.dial-vis`/`.dial-temp` (and their duplicate copies, `.df-vbar-track`/`.df-ov-gaugebar-temp`) are now each a single non-transparent gradient spread across the full width, used identically in both themes with no `.theme-harbour` colour override at all — only the boundary ring from (2) remains theme-scoped. Verified live in both themes by toggling the theme control with the same dial on-screen and confirming pixel-identical rendering either way.

### Removed
- **9 confirmed-dead CSS classes deleted, found via a full button-family census while starting the `.btn` CSS primitive** (a whole unused free-text-tag feature — `.tags-wrap`/`.tag`/`.tag-remove`; `.md-btn`; the footage-modal "Bulk import"/"Unlinked sightings" row UI — `.fm-import*`/`.fm-unlinked`/`.fm-ul-*` — superseded by the still-live inline attach-form; a dead pagination-arrows sub-UI whose containers exist but stay permanently hidden; `.btn-save-device`, which the original UI audit had itself named as a sample of the button problem, along with a companion `getElementById('save-device-btn')` in `js/app.js` that was a permanent no-op since no such element exists; and `.proxy-script` plus an older, already-superseded per-row transcode-progress UI). One near-miss avoided: `.tcw-*`/`#tc-widget` looked identically dead by the same test but is deliberately parked/retained code per `js/video.js`'s own header comment — left untouched.
- **The caustics shimmer feature (Settings → Appearance's "Off…Lively" dial)** — the animated SVG-turbulence texture on stat cards, the dive-file band, and the Settings card itself, plus the slider that controlled it. Rarely used and didn't read well; removed entirely rather than given a dark-mode-specific treatment, which also would have been the hardest of the app-wide dark mode work to do well (its SVG filter hardcoded a warm-cream output regardless of theme). Depth gradient and the static sun-on-water mesh — the other two members of the app's "3-layer background texture" system — are unaffected. `.form-section--shimmer` and the `#caustic-light` SVG filter definition are also gone; the Appearance section now holds only the new theme control (see Added, below).

### Security
- **The Android SAF backend trusted the webview to say which folder it was allowed to touch — now it verifies (`src-tauri/src/androidfs.rs`).** Found by a security review of the whole Android branch, run after it had already merged. Two related holes, one root cause. (1) Every folder-scoped command (`android_read_file`/`android_write_file`/`android_delete_file`/`android_list_md_files`/`android_list_filenames`) took the folder as an opaque JSON handle from JS and deserialized it straight into the plugin's `FsUri` — which is a plain `#[derive(Deserialize)]` struct with public fields, so a forged `{"uri":"file:///…"}` handle deserialized perfectly happily. (2) `android_write_uri` took a bare URI string and passed it to `FsUri::from_uri`, which wraps *any* string without validating it. In both cases the plugin's own Kotlin dispatcher routes a `file://` URI to `RawFileController` — bare `java.io.File` access with the app's own uid, consulting no SAF grant at all — which turns either one into an unscoped read/write/delete/enumerate primitive over everything the process can reach, well outside whatever folder the user actually picked. **Both now go through one `require_content_scheme` guard** that rejects anything that isn't a `content://` URI; the picker only ever returns those, so no legitimate behaviour changes.
  Worth recording *why* it was there, since the reasoning looked sound: the file's own header asserted the desktop `authorize()` path guard "deliberately does NOT apply here and must not be added," on the grounds that SAF is self-scoping. That's true — but only once you know the URI *is* a SAF handle, which nothing established. The header now says so, and explains the distinction rather than restating the conclusion that hid it. Note the plugin already validated the *filename* (`validate_relative_path` rejects `..`, `.` and root) — the escape was via the folder base, which nothing checked.
  Both were exploitable only by chaining from an XSS in the webview, and the review found no actual XSS in this range; they're trust-boundary defects rather than directly-triggerable bugs. Fixed ahead of any Play Store release rather than after, given the app reads untrusted `.md` files from *shared* Google Drive folders. Rust-only change, Android-gated — no service-worker cache bump needed, and the desktop/web builds are untouched.
- **`quinn-proto` 0.11.14 → 0.11.16 (Dependabot alert), plus a note on why the other alert can't be actioned.** Neither flagged crate is compiled for any target this project builds — verified with `cargo tree -i` across `aarch64-linux-android` and both macOS arches, all of which return nothing. `quinn-proto` is an optional `reqwest` dependency behind the `http3` feature (this build enables only the `rustls-tls` cascade); it's bumped anyway so the alert list stays meaningful rather than accumulating permanent noise. **`glib` (the `VariantStrIter` unsoundness) is deliberately not actioned:** it reaches the tree only via `gtk` → `tao`/`muda`, Tauri's *Linux* windowing backend — macOS uses WKWebView, Android the system WebView — and no compatible update exists (`cargo update -p glib` locks 0 packages; the fix is in a later major version pinned by `gtk`). Nothing to do until Tauri moves.
  Checked before applying, because it was the one real risk: the `quinn-proto` bump also moves `rand 0.9.4 → 0.10.2`, and `rand` **is** compiled — `gdrive.rs` uses `rand::thread_rng()` for the OAuth PKCE verifier and state. Those call sites resolve against our own direct `rand = "0.8"` → `0.8.6`, a separate major version Cargo keeps side by side, so the update touches only quinn's own subtree. Confirmed `0.8.6` is still in the lockfile and `cargo check` is clean afterward.

## [2.992] – 2026-07-30

### Added
- **Landing page CSS tokens and chart maths are now shared with the app at build time, not hand-copied.** The two deploys had already drifted once within this same release — `landing/script.js` carried its own copy of the NDL-chart colour logic, still on the pre-correction `--warn` value after v2.99 darkened it. `js/chart-math.js` is now the one source for the shared pure functions; `landing/prepare-shared.sh` (mirroring `src-tauri/prepare-web.sh`'s Tauri pattern) regenerates a verbatim copy plus an extracted design-token file for landing to `@import`, so a future token or threshold change reaches both deploys the same way it reaches one. Fixed a stale NDL-legend gradient bar (`.ndl-track`) as a direct result — it's now four `var()` refs onto the real tokens instead of a fifth hardcoded copy.
- **Desktop sidebar now carries the same ocean styling as the mobile bottom nav** — the same shallow→abyss gradient (no rotation needed, the sidebar's already vertical) and the same inline SVG icon set (History/Species/Log/Plan/Stats, plus a new settings gear replacing the emoji ⚙). Deliberately **not** given the mobile bar's wave edge — a full-height, logo-topped, labelled sidebar was never at risk of reading as OS chrome the way a slim bottom bar pinned to the viewport edge is, so that specific fix doesn't apply here. In its place: a "current" indicator (`#nav-current`) that swims to whichever nav-link is active via a CSS transition, rather than the selection just appearing at a new position — the character the wave gave mobile, translated into motion instead of silhouette since that's where desktop's actual gap was (switching pages was previously instant and motionless). Fades out rather than pointing at a stale position when Settings is active, since that control lives outside the animatable nav list, mirroring the mobile bar's own split between its 5 tabs and the separate settings cog.

### Changed
- `--mobile-nav-active` renamed to `--accent-on-dark` — it turned out to already be doing this job in three places (the mobile nav, a shared dark-surface `:focus-visible` outline override, and now the desktop sidebar), so it needed a name that reflects what it actually is rather than where it was first used.

### Fixed
- Desktop sidebar's logo mark and active nav-link text both hardcoded light-mode `--accent`, which measures 2.44:1 against the new gradient's lightest stop — the identical failure mode the mobile nav's old selected-state colour had. Both now use `--accent-on-dark`.
- Sidebar's dive-count number (`.dive-count strong`) used `color: var(--text)` — literally the same value the sidebar's own background used before it was a gradient, i.e. invisible (1.00:1), and true even before today's changes. Its "dives logged" label wasn't much better. Reported live as "a dark number that matches the background." Fixed with values already used elsewhere in the same sidebar rather than new ones.
- Sync-status line in the sidebar footer was restating the exact dive count already shown in large type right above it, in 3 of its 6 possible messages (local mode, and both the boot-time and post-sync Obsidian paths) — reported live as looking like a duplicate, because it was one. Reworded to pure status ("Local", "Synced to vault") rather than removing the line outright, since it still answers a genuinely different question. A fourth message ("0 dives in vault," a real diagnostic about the remote vault specifically) was left untouched.

## [2.99] – 2026-07-30

### Added
- **Every form control now has a name a screen reader can announce.** The log form previously read as a column of unnamed edit boxes — 45 inputs, 25 `<label>` elements, and *zero* associations between them (labels sat as siblings, never with `for=`, never wrapping). All 40 visible inputs are now named: `for=` where a label names one control, `aria-label` where only a placeholder or a unit caption carried the meaning (bottom time, max/avg depth, safety- and deco-stop depth/time, lat/lng, the vis and temp dials, species search, bulk trip/renumber), and `role="group"` + `aria-labelledby` for the five controls that are a widget rather than an input (dive type, weather, water type, current, tank type). The three remaining unnamed inputs are `display:none` file pickers driven by visible buttons, which are correctly not exposed at all.
- **Selection state is exposed to assistive tech** on the dive-type chip grid, the segmented toggles (water type / current / tank type) and the weather icon row — `aria-pressed`, set in `lfBuildTypeGrid`/`lfPaintSeg`/`lfPaintWeather`, the single points where `.sel` is already toggled. Closes the three families CLAUDE.md had listed as outstanding. Toggle semantics rather than radio: each of these is individually clearable (tap again to clear), and radio would also oblige a roving-tabindex keyboard model the app doesn't implement.
- **Numeric fields declare a keyboard.** `inputmode="numeric"`/`"decimal"` across the 17 number inputs (none carried one before), so Android shows the right keypad deterministically rather than depending on WebView heuristics.
- **A guaranteed keyboard focus ring.** The stylesheet carried 12 `outline: none` declarations against a single `:focus-visible` rule. A `:focus-visible` floor now applies to every interactive element, using the already-verified `--mobile-nav-active` on the dark nav/hero surfaces where `--accent` measures too dim. Scoped to `:focus-visible`, so the deliberate mouse-focus treatments are unchanged.

- **Toast notifications** replace the app's 10 `alert()` popups. In a WebView an `alert()` renders as an OS dialog that looks nothing like the app, blocks everything behind it, and on Android is the single clearest "this is a wrapped web page" tell. Toasts appear bottom-right on desktop and above the bottom nav on mobile (reusing `.mobile-save-bar`'s offset formula, so they clear the nav wave's crest), auto-dismiss, and can be tapped away. Variants reuse `.sync-banner`'s existing success/error/warning/neutral colours rather than introducing new ones. Errors announce assertively to screen readers; everything else politely.
- **An in-app confirmation dialog** (`confirmAction`) replaces the two footage `confirm()` calls — removing a video that has tagged sightings, and removing a tagged moment. It's on the standard overlay view-stack, so the Android back gesture and Escape close it exactly like the dive file or footage modal, both answering "no". Focus starts on Cancel, not Confirm, since both uses are destructive.

- **Colour architecture: a surface ladder and `on-*` foreground pairing** (Material Design 3's *structure*, none of its hues — and no npm, no Material components). Five graded surface tones replace the ad-hoc `--bg`/`--surface`/`--surface2` trio as the single source of truth; those three names survive as aliases so nothing had to be rewritten, and `.theme-harbour` declares its own five rungs. Every container colour now has a **named** foreground partner with a measured contrast ratio (`--on-surface`, `--on-surface-variant`, `--on-accent`, `--on-danger`, `--on-inverse`, …), so "which ink goes on this fill" is decided once in `:root` instead of per-component and by eye. The two new surface rungs are hand-derived from tones already in the palette by the same method the profile-chart shades use — no new hue entered the system.
- **A public privacy policy** (`landing/privacy.html`), written from an audit of the app's actual outbound calls rather than a template — every third party it names maps to a real call site (Nominatim, Overpass, Open-Meteo, OpenStreetMap tiles, the iNaturalist photo bucket, the GitHub-hosted community dive-site data, the UK Hydrographic Office's Admiralty API, and Google Drive when connected), stating plainly what each receives and when. Linked from the landing page's footer.

### Fixed
- **Three colour-contrast failures that had been shipping**, found by writing the `on-*` pairs down — they were invisible while "which ink goes on this fill" lived in prose rather than in the tokens. Primary buttons (white on `--accent-fill`) measured 3.52:1, success fills 3.30:1, and `--warn` used as status text 2.90:1 — all under WCAG AA at the 14px these controls actually use. Each token was darkened by the amount *its own roles* require, which needed a usage audit rather than one blanket rule: `--accent-fill` turns out to be a pure fill (13% darker is enough), `--success` is both fill and text (25%), and `--warn` is text-only in practice — all four of its "fill" uses are dots and spines carrying no text, so the white-on-warn failure had no call site at all. `--danger` already passed and is unchanged. Matching rgba tints moved with their base (22 declarations), since a tint left on the old value while its text colour moves is the same drift in miniature.
- **One green, not two.** `rgba(63,185,80,…)` — a brighter green than `--success` ever was — sat as border and background on `.badge-worms`, `.obs-status.connected`, `.sync-banner.success` and `.btn-save-device`, directly alongside `var(--success)` text in the same rules. Long recorded as an open item; darkening `--success` widened the mismatch from noticeable to obvious, so all 7 sites were consolidated onto the real value.

### Changed
- **`--text-xs`/`--text-sm`/`--text-base` renamed to `--font-size-xs`/`-sm`/`-base`** across all 420 call sites (CSS, HTML, and the JS template literals), resolving a naming collision the colour doc had flagged as "the kind that produces a genuinely confusing bug once": the size tokens shared a prefix with the *colour* tokens `--text`/`--text-muted`/`--text-dim`. `--text*` now means colour and nothing else.
- **Deleting a dive no longer asks twice.** Every entry point already went through the two-click `armDelete` guardrail, so the native `confirm()` inside `deleteDive` was a second confirmation on top of it — arm the button, confirm it, then get a popup asking again. It was a leftover from the edit modal's own delete path, retired back in v2.83. The two-click arm is unchanged and remains the guardrail.
- **Touch targets** on isolated icon controls (mobile settings cog, trip-map expand, dive-file hero close, timeline ✎ edit, dive-file action buttons) now have a 44px hit area via a transparent `::after`, leaving the painted size — and therefore the design — untouched. `.vrow-del` went 22→24px, the only control in the app that was under the WCAG 2.2 AA floor outright. Packed rows (`.roc-btn` at 3px gap, `.dh-abtn` at 6px, `.gsec-arr`, `.tl-rename-*`, `.sp-dive-*`) were deliberately left alone: expanding hit areas there would overlap neighbours and make the rows *harder* to use, so they need painted size and gap to grow together — a layout change that wants a real-device check first. All of them already clear AA; it's AAA/Android comfort they miss.
- **Live deployment flipped: the app now lives at `app.diveshoal.com`; the marketing/landing page — and this privacy policy — now live at the root `diveshoal.com`.** Previously backwards (app at root, landing on the `app.` subdomain). `robots.txt` and each site's indexing posture travelled with it automatically, since they're separate Cloudflare Pages deployments. **Anyone with Shoal added to their home screen at the old address needs to remove and re-add it at the new one** — an installed PWA, `localStorage`, and IndexedDB are all scoped to the origin they were created on, so none of it follows a domain change automatically. Folder sync and the Tauri desktop app are unaffected (the desktop shell loads bundled assets, not a live URL). The landing page's two "Try Shoal" buttons now point at the new app address.

## [2.985] – 2026-07-29

### Changed
- Nav order is now History / Species / Log / Plan / Stats (was Log / History / Plan / Species / Stats), and **History is the default landing panel** (was Log) — live-testing with new users found them staring at the blank log form for ages rather than seeing what the app is actually for. Desktop sidebar's "Log" group label dropped, since a group now led by History/Species/Plan no longer fit under that heading.
- Mobile bottom nav rebuilt end to end after testing found people handing the phone back believing the app was a single page: icons are inline SVG instead of emoji, the top edge is a wave instead of a flat line, and the bar is a shallow→abyss gradient continuing the page's own existing depth gradient instead of a flat fill. Selected-tab colour is a new `--mobile-nav-active` token (dark-mode accent lightened 25% toward white), not a themed value — the bar is dark in both themes.
- Nav taps now scroll to the top of the panel they land on, teaching that a tab switch actually went somewhere (the panel's own title is the "you've arrived somewhere new" cue, and it was previously hidden by scroll restoration). Back-gesture/popstate returns still restore scroll position, so the dive-file round trip (open a dive from deep in History, go back, land where you were) is unaffected. Tapping the tab you're already on now visibly responds too, instead of doing nothing.

### Fixed
- Mobile nav's selected tab had no real visible state at all: emoji icons can't inherit `color`, so `.active` only tinted a 12px label, and that label measured **3.94:1 active vs 5.31:1 inactive** — the "you are here" tab was literally dimmer than the ones you weren't on. Also fixes dark mode, where the old flat bar measured 1.23:1 against the page (effectively invisible).
- Floating mobile save button was incorrectly showing on History on first app load (and any time the app booted straight into it), only disappearing after a real tab switch — a leftover boot-script line unconditionally forced it active under the old "Log is the default panel" assumption, which the History-default change above left silently wrong.

## [2.984] – 2026-07-29

### Fixed
- **A video that won't play now says why.** Cloud-drive files set to online-only are listed like any other file but can't actually be read unless the provider's own app is running to fetch them — previously that meant pressing play and getting silence, with nothing to act on. Shoal now recognises the situation and names the provider: *"…is stored online-only in ProtonDrive. Open the ProtonDrive app so it can download the file, then press play again."* Files that fail for other reasons get an honest "found but couldn't be played — may have been moved, renamed, or deleted" rather than a guess.

## [2.983] – 2026-07-28

### Added
- **Google Drive can now be connected and disconnected from the desktop shell**, via a real OAuth flow — no backend server involved. `gdrive_connect`/`gdrive_status`/`gdrive_disconnect` (not yet wired into any UI). Signing in opens your system browser to Google's real consent screen scoped to `drive.file` (only files Shoal itself creates — never your whole Drive), and a native dialog names the connected account before anything is saved, so a hijacked sign-in can't silently bind the app to the wrong account. Tokens are stored in the macOS Keychain, never in the app itself, and refresh automatically ahead of expiry.

### Security
- The local OAuth listener now accepts repeatedly until it sees a matching request rather than trusting whichever connection arrives first, and every step (the browser round-trip, an individual connection) has its own timeout. Disconnecting now asks for confirmation first, since it's an irreversible, externally-visible action (it revokes access with Google, not just locally).
- The Google Drive client secret is no longer in tracked source — `src-tauri/build.rs` now reads it from a local, gitignored file at build time. Doesn't change the already-accepted binary-extraction tradeoff, but closes a separate one: reading it straight out of the repo, relevant given an open-source release is being considered.

## [2.982] – 2026-07-26

### Fixed
- **Two videos with the same filename in different folders no longer resolve to the same file.** Footage was tracked by bare filename, which GoPro-style numbering reuses freely across trips and cards — so connecting a second trip folder could silently make one dive's clip play another dive's video. Videos are now identified by their path relative to the connected folder, including that folder's own name. Existing footage keeps working unchanged; nothing needs re-linking. This also unblocks cloud hosting, where the same identifier has to mean the same file locally and remotely.
- Connecting a `proxies` folder directly now correctly recognises its contents as proxies rather than treating them as original footage (which would have fed them to capture-time matching and dated every dive to the day the proxies were generated).

## [2.981] – 2026-07-26

### Changed
- **Footage tagging: the species picker is built for scanning now.** Photos display at their full aspect ratio instead of being cropped to a fixed box, so nothing is cut off when comparing against the video (a two-column, smaller-photo layout was tried first and reverted the same day as harder to identify a species from). The note, abundance and Save controls only appear once you've actually picked something — before that they were ~140px of unusable controls taken straight out of the photo you're reading.
- **The tag picker starts filtered to the dive's own country**, matching the log form's Country pre-filter, with a "Show all" escape. Diving in the UK now means browsing 93 fish rather than 639. Its filter is separate from the log form's, so the two can't re-scope each other.
- **Free text works the way it does on the log form**: the "+ Free text" button is gone, and a search with no matches offers to add what you typed directly in the results. If the only reason there's no match is the country filter, it offers "Show all species" instead — so you can't accidentally create a duplicate custom entry for a species that's already in the database.
- **Footage modal: more room for the video, less for the chrome.** ＋ Tag here and Mark reviewed now share the transport row with the playback controls, centred rather than pushed to the right edge — they were sitting directly under the slide-in sightings panel and got covered whenever it opened. Losing that second row, plus tighter control sizing, hands roughly 55px of height back to the video.
- The sightings panel no longer closes itself after you tag a species — saving one is usually the start of working on it (adding a note, fixing the timestamp), not the end. It still closes on hover-away and on its own chevron; nothing auto-closes it now.

### Fixed
- **Region-filtered species search could silently return nothing for a broad common name.** `searchLocalSpecies` caps to 8 matches before ranking; the region filter (log form's mobile picker, and the new footage tag picker) was applied *after* that cap, so a query like "wrasse" — 25 tropical species predating the 6 UK ones in the database — filled its 8 slots entirely with tropical results, leaving nothing for a UK filter to keep. A narrower query ("ballan") dodged it by having few enough raw matches to survive. The region filter is now applied before the cap, in both places.
- **Folder sync could get permanently stuck after a restart, with no way back from inside the app.** Picking a folder grants two separate permissions — Shoal's own allowlist *and* macOS's access grant to that path — and only the first survives a restart. Once the OS grant lapsed (most readily on `~/Library/CloudStorage/…` — Proton Drive, iCloud, Google Drive) every read and write failed, the banner offered a **Retry** that could only ever re-fail, and the **Reconnect** button was a no-op in the desktop app because it used a browser-only API. Reconnect now re-picks the folder natively and flushes whatever was pending; a lost grant is detected on both the read and write paths and surfaced as a reconnect prompt rather than a dead-end error.
- Auto-matched footage reported sync failures into an element that only exists while the footage modal is open, so a failed write during matching was completely silent — the videos played fine from memory regardless. Failures now surface in Settings, and the folder-write path reports them at all (it previously discarded the result).
- Shell folder read/write errors now log the full path, not just the error.
- `scripts/dev-server.py` no longer prints a `KeyboardInterrupt` traceback on normal shutdown when `cargo tauri dev` restarts it.

## [2.98] – 2026-07-25

### Added
- **Match footage to dives by capture time** (Settings & data). Point Shoal at a folder of dive videos and each file is assigned to the dive it was shot on, read from the video's *own* capture timestamp — no need to sort footage into per-dive folders first. Subfolders are searched too. Anything it can't place confidently is listed rather than guessed at, and dives it couldn't time-match are reported explicitly. Nothing on disk is moved, renamed or re-encoded.
- Camera-clock offset correction for the above — suggested, never applied silently, and only when most videos matched nothing.
- Watch/tag sightings panel is now a slide-in overlay: hover to peek, click the tab to pin, click again to park. Saving or cancelling a tag hands the video straight back.
- `scripts/dev-server.py` — local dev server that disables caching, replacing `python3 -m http.server`.
- `scripts/test-footage-match.mjs` — 22 assertions covering the capture-time parser and dive matching, including timezone stability across three zones.

### Changed
- **Footage modal is full-screen**, single-column, with the player full-bleed. The video list moved from its own left column into the right-hand panel beneath the sightings list, at a 2:1 split, each scrolling independently.
- **Video proxies parked.** Originals play fine in 4K, so the decode-performance premise behind proxies was falsified. Generation is removed from the app and the ffmpeg sidecar is no longer bundled (the shell stops compiling a 21 MB encoder at build time), but all the code is retained and documented for the cloud-upload case that would justify it again.
- Folder-connection UI reworded throughout: "proxies" → video/trip folder, since that folder now serves playback *and* capture-time matching.
- Tauri's `scan_proxy_folder` is recursive (symlinks skipped, so a link can't walk outside the authorised root); new `read_file_range` command lets the shell read capture times from a path.

### Fixed
- Proxy/video folders no longer need reconnecting on every launch of the desktop app — the folder was persisting correctly but nothing re-scanned it at boot.
- The footage player's empty state no longer says "connect the video folder" when a folder *is* connected; it now names the file and explains it isn't in the connected folder.
- Tauri shell's CSP was missing `'wasm-unsafe-eval'`, which would have blocked the dive-computer WASM module in a packaged build.

## [2.975] – 2026-07-24

### Fixed
- Tauri shell's "Sync from folder" now shows an actionable message when a folder was authorised before the 2.974 filesystem-scoping change and needs re-picking (`⚠ Folder needs re-authorising — click "Change folder" and re-select it`), instead of a generic "⚠ Could not read folder" that read like the folder itself was missing or broken. Found live-testing 2.974 immediately after upgrading.

## [2.974] – 2026-07-23

### Security
- **Fixed stored XSS in four render paths that interpolated imported/synced free-text dive fields without HTML-escaping**, violating the app's own "esc() at every render" invariant: the dive-file hero meta (`region`/`country`, `js/history.js`), the History map-marker popups (`site`/`region`/`country`, `js/map.js`), the site-search history dropdown (`site`, both the visible label and the `onmousedown` attribute, `js/app.js`), and footage clip stamps (species `commonName`/`scientificName`, `js/footage.js`). A `.md` in a synced folder or imported via "Import from device" with e.g. `region: "<img src=x onerror=…>"` executed script on view; in the Tauri desktop shell that escalated to arbitrary local file access (see below).
- **Confined the Tauri desktop shell's filesystem commands to user-picked folders.** `read_text_file`/`write_text_file`/`remove_file`/`list_md_files`/`scan_proxy_folder`/`run_transcode` previously accepted any absolute path from the webview, so any script (e.g. the XSS above) could read/write/delete anywhere on disk (SSH keys, LaunchAgent persistence). They now authorise every path against an allowlist of folders the user explicitly chose through a native picker, persisted app-side (`allowed-folders.json`) so folder sync survives restarts. Traversal (`..`) and non-absolute paths are rejected; paths are canonicalised (symlink-consistent) before the prefix check. **One-time upgrade note:** the first launch on this build has an empty allowlist, so folder sync / proxy folders must be re-selected once in Settings to re-authorise them.
- **Hardened `generateFrontmatter` against YAML injection** — free-text scalars now strip CR/LF/tab in addition to neutralising the closing quote, so a newline in a field can no longer break out of its quoted scalar and inject frontmatter keys (`js/markdown.js`).
- Removed a latent single-quote-breakout in the BLE "Forget" button (moved the serial to a `data-` attribute, `js/computer-sync.js`) and aligned `album.js`'s local `_esc` with the global escaper (now also escapes `'`).

## [2.973] – 2026-07-22

### Added
- **Bulk dive renumbering.** History's "Select" button is now a "Bulk edit" group with two peer actions — **Trip Name** (existing) and **Dive Number** (new) — both using the same tap-to-select-a-range mechanism. Shift a selected range of dive numbers up or down in one action instead of editing each dive individually; a collision guard blocks the shift outright (not just warns) if it would land any dive on a number another, unselected dive already holds, or below #1. No new file-rename code needed — the existing coordinated-rename machinery (`writeToFolder`/`pushToObsidian`) already detects the resulting filename change and handles it, exactly as a single manual divenum edit already did.
- BLE sync now refuses to start until a real sync destination (a folder or Obsidian) is configured, with a clear message pointing at Settings & data. Previously it would pair and download before any destination existed, leaving dives stuck in browser-only storage with no way to move them into a vault afterward.

### Fixed
- Bulk-add's "Most recent dive #" field is now locked (shown as fixed text, not an editable input) whenever the batch's numbering is already fully determined by dives already in the log. The editable field, combined with a label written for the ordinary case, was misread as "your actual most recent dive" in an older-backfill-batch scenario and produced a duplicate divenum range in testing. A separate, unconditional collision guard now also blocks the bulk-add action outright on any divenum collision, regardless of cause.
- History's "Bulk edit" action row no longer spreads its buttons across the full row width — Trip Name and Dive Number now group together on the left with Map on the right, "Bulk edit" labelled above them.

## [2.972] – 2026-07-22

### Added
- **Bluetooth dive-computer sync now works in the macOS desktop app.** Previously browser-only (Chrome/Edge), because WKWebView has no `navigator.bluetooth`. The shell gets a native BLE transport in Rust (`src-tauri/src/ble.rs`, `btleplug`) behind the same UI, feeding the same protocol engine and the same match/review/bulk-add pipeline — nothing downstream of the transport differs between browser and shell. The Sync button is revealed only after probing for a real Bluetooth adapter, so Bluetooth switched off hides it rather than offering a tap that fails.
- `run-cancel-salvage-test.mjs` — regression test proving a cancelled sync still keeps every dive downloaded so far, and that the engine unwinds instead of hanging. Cancel-loses-dives has shipped as a real bug once before.

### Changed
- **libdivecomputer WASM module rebuilt with Asyncify instead of JSPI.** JSPI is Chromium-only (WebKit shipped it in Safari 27 beta), so the module couldn't run in the desktop shell at all. Asyncify is engine-agnostic, so one build now serves browser, desktop, and a future iOS shell. 368KB → 616KB; CPU overhead is irrelevant against BLE's own ~60ms-per-packet pacing. Re-validated against the same real 96-dive Peregrine transcript with identical results (96/96 dives, 28,112/28,112 waypoints, gas mix 96/96 exact).
- Test harnesses no longer require Node v26 — Asyncify removes the `WebAssembly.Suspending` dependency, so stock Node runs them.

### Fixed
- The Tauri shell's CSP was missing `'wasm-unsafe-eval'`, which would have blocked the dive-computer WASM module in the packaged app (the web build's `_headers` already had it; the shell's policy is separate and doesn't inherit).

## [2.971] – 2026-07-22

### Changed
- PWA manifest `name`/`short_name` now say "Shoal" instead of "Dive Log" — that's what Android's install prompt and home-screen label showed; `index.html`'s title/meta already said Shoal.

### Fixed
- Tauri desktop build was missing all five bundled fonts (Figtree, Literata, Young Serif) — `src-tauri/prepare-web.sh`'s copy list omitted `fonts/`, so the packaged macOS app silently fell back to system fonts / the Georgia `--serif` fallback with no error. Web build was unaffected.
- Tauri desktop build was also missing the favicon/apple-touch-icon PNGs (`prepare-web.sh`'s file-copy list never included them) — same class of gap as the fonts issue above.

## [2.97] – 2026-07-21

### Added
- Web Share support for dive exports on iOS — single-dive "Download .md" and the bulk "Export all" zip now prefer the native share sheet (Save to Files → iCloud Drive) over a blind drop into Downloads, falling back unchanged on any platform that can't share files. Phase 1 of BRIEF-ios-sync.md — a local file round-trip for iPhone users, ahead of any decision on full sync.
- iOS Home Screen install nudge — a dismissible card in Settings & data, shown only in Safari on iPhone/iPad outside standalone mode. Safari never fires `beforeinstallprompt`, and an installed web app gets materially better storage retention than a browser tab.
- Best-effort `navigator.storage.persist()` request at boot.

### Changed
- The "Folder" sync-mode error on browsers without folder-picker support (iPhone/iPad Safari, Brave) now points at Import/Export instead of just saying to use Chrome.

## [2.961] – 2026-07-21

### Fixed
- SAC rate was showing twice on the desktop dive-file hero band for any dive without an imported profile — a leftover desktop-only cell that predated the 2.96 tank redesign and was never removed when SAC moved into the tank's footer. SAC now lives exclusively in the tank.
- Desktop hero band showed SAC wrapped onto its own orphaned row on any dive with avg-depth data — a CSS specificity bug (`.df-band.df-band-has-avg`'s compound selector always beat the desktop override regardless of source order). Resolved by removing the duplicate SAC cell entirely, which also removed the need for the desktop-specific column override in the first place.
- Tank gauge fill was rendering unclipped — square corners visibly poking past the tank's rounded/domed silhouette — on the desktop dive file. `overviewContent` renders in two places at once (mobile tab + desktop row), so its `<clipPath id="dftk-${id}">` was a duplicate id in one document; `url(#id)` resolution under a duplicate isn't reliable. Each render now gets a genuinely unique clip id.

## [2.96] – 2026-07-21

### Added
- Mobile dive-file tab strip (Marine/Overview/Journal) rebuilt as a folder-tab join: the active tab keeps the content's own white and overlaps into the panel below it, with a fine accent underline at the seam — instead of three equally-boxed pills sitting in a slab barely distinct from the page background.
- Mobile (and now desktop) Overview tab redesigned around what each field actually is: a full-width gradient bar for water temperature (reusing the log form's own dial gradient), growing SVG chevrons for current strength, an icon for weather, and a horizontal cylinder gauge for gas pressure — start pressure fixed far left, remaining gas filling from the right, SAC rate in the footer. Everything else (safety stop, suit/weight, buddy, operator/trip, sign-off) is a plain icon spec row.
- Desktop dive file: journal narrowed to two-thirds width with the same Overview data (unchanged from mobile) sliding in beside it at roughly a phone's own content width. The journal now always renders on desktop, even empty — a dashed, clickable "tap to add a title or notes" invitation instead of hiding the block entirely.
- Stats page hero: the six headline stat cards are now floating circular bubbles with a gentle independent bob, at every breakpoint — the motif retired from the dive file (below) moved here instead.

### Changed
- Visibility now lives only in the hero stat band (with a small gradient-bar ticker at the log form's own 0–30 m scale), never duplicated into Conditions/Overview.
- SAC rate moved out of the profile chart's stat strip into the Overview tank gauge's footer.
- Dive-computer profile import now pre-fills logged water temperature from the coldest waypoint, not the average — most divers care about the minimum, and this also means the same number now shows on the profile chart and in Overview instead of two potentially different ones. Only affects new imports; already-logged dives keep their prior value.
- All Overview/spec-row icons are inline SVG, not emoji.
- The hero stat band's avg-depth cell now also shows on mobile (previously desktop-only), gated on the dive actually having the data.

### Fixed
- Gas/pressure/SAC/cylinder data had gone missing entirely on desktop for any dive with an imported computer profile — a knock-on regression from removing the profile chart's own SAC/gas cell without updating the desktop data strip's gating logic, caught and fixed as part of this pass.
- Two real bugs in the tank gauge's number placement, both caught by generating the geometry programmatically across a range of pressures rather than eyeballing a couple of examples: a fallback that pushed an over-long number outward (onto the valve, or clean off the SVG's right edge) instead of inward; and a legibility check that tested a number's centre against the fill boundary rather than its leading edge, letting a straddling number go white-on-empty and disappear.
- The tank's silhouette read as a concave scoop rather than a cylinder (the taper's curve control point pulled inward instead of bulging outward) — replaced with a rounded end + neck construction that stays convex throughout.

### Removed
- The dive file's four-column circular "bubble" data strip (Conditions/Profile/Gas & equipment/Sign-off, `.df-data-strip`/`.df-data-col`) on desktop — superseded by the unified Overview format shared with mobile. `_computeAvgTemp` (superseded by `_computeMinTemp`).

## [2.951] – 2026-07-21

### Added
- Surface-interval re-entry recommendation now reads real tissue nitrogen loading (all 16 ZHL-16 compartments) and targets 90% cleared — calibrated against a real BSAC 88 Surface Interval Table photo to land in the same "decent code" region (~4h for a hard dive), not the ~10h BSAC's table needs to reach fully-clean. Depth-independent and cumulative across repetitive dives. The % is shown subtly on every re-entry pill.

### Changed
- **GF 100/100 is now the Standard preset** (was 40/85); Conservative is now GF 40/85 (was 35/75) — a deliberate, knowing override of the previous "never loosen this" rule, justified by a real-dive-computer comparison, a photographed BSAC table, and Subsurface's own documented "GF 100 approximates tables" guidance. Full record in DECISIONS.md.
- When both dives in a pair have real entry times, the surface-interval pill now shows "You planned Xh · ~Y% off-gassed" in place of the recommendation, instead of appending it — avoids the redundant, overflowing text of showing both.
- Add-dive / edit-dive form reflows to depth·time·entry·gas on one row, with the ✓/✕ buttons grouped together at the right edge instead of spread across separate grid cells.

### Fixed
- The surface-interval recommendation previously asked "does the next dive fit within no-stop limits", which has no answer for a dive that's a deco dive even fully rested — surfacing a nonsensical "no surface interval changes that". Off-gassing always completes in finite time; the recommendation is now a property of the previous dive's own residual, independent of what dive comes next.

## [2.95] – 2026-07-21

### Added
- **Deco-stop planning (Plan panel).** A dive that exceeds NDL no longer shows a hard "exceeds no-stop limit" refusal — it shows a real stop schedule (depth + minutes), extracted from the same `BuhlmannAlgorithm.decompression()` call already needed for tissue-chaining between dives. Never blocks saving the plan; the GF presets themselves are untouched (DECISIONS.md — that rule stays locked).
- Real (not just recommended) surface intervals now feed the calculation: if both dives in a pair have entry times set, the actual elapsed gap is what gets evaluated, showing the genuine NDL/stop consequence of going in sooner than recommended rather than only a prescriptive minimum.
- A "how long before I could dive again" hint next to "+ Add dive" — a plain re-entry clock time, shown before a next dive's numbers are typed in rather than only after.

### Changed
- GF preset buttons relabelled "Standard" / "Conservative" (from raw "GF 40/85" / "35/75") — real-user testing found nobody, including Luke, reliably knew what the numbers meant. Technical values moved to a hover tooltip.
- Surface-interval and deco-stop messaging simplified throughout: a clock time ("Re-entry 11:23") is now the primary readout everywhere, with the minute count as secondary tooltip detail. Recommendations never show less than a flat 60-minute floor, even when the tissue math technically allows less.
- Deco-stop badges/cards/messages use the reserved `--warn` colour, not `--danger` — advisory ("worth noticing, no harm done yet"), not an error.

### Fixed
- The engine's own routine safety-stop behaviour (`SafetyStop.auto`) was being added on top of a genuine decompression obligation rather than replacing it, inflating every reported stop time — a 23 m/47 min dive's stop dropped from 18 to 15 minutes once corrected (`Options.safetyStop = never`). Caught directly: "you don't do a safety stop on top of a deco stop, you do one or the other."
- The reported stop schedule initially included the dive's own planned bottom segment as if it were a stop (shape-identical to a real one — both flat, non-zero-depth) — fixed by excluding anything at or deeper than the dive's own planned depth.
- Added an explicit "this doesn't know your gas supply — check you have enough to complete the stop" caveat, and a distinct, honest message for the edge case where a dive is technically past the rounded published NDL but the full ceiling computation finds no real stop required.

## [2.942] – 2026-07-20

### Changed
- **Species Album stat line is now dynamic.** "N species recorded across M dives" recomputes against the current search text and country filter (instead of always showing the unfiltered total), scoping the dive count to sightings that actually happened in the selected country and appending "in {Country}" when a filter is active.
- **Mobile settings cog reworked.** No longer `position: fixed` (floated over content at every scroll position, which testing showed most people never noticed) — now `position: absolute`, so it sits at the top of the page and scrolls away like normal content. Recoloured from a low-opacity translucent fill to the same solid `var(--text)` teal/cream the desktop sidebar itself uses, with the sidebar's semi-white icon treatment, so it's one consistent "settings" chip rather than a separate, easy-to-miss mobile-only look.

## [2.941] – 2026-07-20

### Added
- **Species Album country filter.** A new pill row between the search bar and category tabs filters logged species by the exact country they were seen in (e.g. a species logged in both Thailand and Indonesia can be filtered to just one) — data-driven, only showing a pill for a country the diver has actually logged something in. Composes with the existing search box rather than fighting it.

### Fixed
- "Use my location" (and confirming a reverse-geocoded pin generally) set the Country field but never fired its `change` event, so the log-form's species region pre-filter silently never activated from that flow — only from manually picking the Country dropdown. `lfWireGeoConfirm` now calls `lfCountryChange()` explicitly after setting the field.

## [2.94] – 2026-07-20

### Added
- **Log-form Country pre-filter.** Selecting a Country narrows the Marine life species picker (desktop photo-grid panel and mobile full-screen picker alike) to species actually recorded in matching regions, with a dismissible "Showing species recorded near Indonesia — Show all" banner. Free-text/previously-logged sightings are always exempt.
- **Species Album "Found in" section** — the species profile modal now shows which regions a species has been recorded in (e.g. "Indo-Pacific · Southeast Asia · Caribbean"), as its own labelled section matching the existing "Mapped sightings"/"Dive log" style. Omitted entirely for species with no region data. Kept structurally separate from the diver's own dive count/last-seen stats above it — sitting inline read as ambiguous ("is this where *I've* seen it?") in early testing.
- `data/species-db.js` now carries real region data for all 1,275 species (`scripts/fetch-species-regions.py`, run for real against the corrected AphiaIDs from 2.932) — the data layer both features above are built on.
- Species profile modal is now true full-screen on mobile (edge-to-edge, square corners) instead of the rounded "sheet" treatment shared with other modals.

### Changed
- **Wall, Pinnacle, and Muck dive-type colours revised.** Wall was too close to Night (both dark saturated blues, 17° of hue apart); replaced with a dusty gorgonian-rose (`#863C5E`) after researching what actually distinguishes a wall dive visually. Pinnacle and Muck were 49° apart in hue but nearly indistinguishable — Pinnacle's saturation was too low for hue to register — so both got more separation in saturation/lightness instead. Full reasoning and rejected alternatives in DECISIONS.md.
- **Informational banners recoloured from accent blue to neutral Warm Taupe** — the dive-computer import/sync banner, the edit-mode notice, and the new Country pre-filter banners. Accent is reserved for interactive elements; these banners' own backgrounds aren't. `.sync-banner.accent` renamed to `.sync-banner.neutral` to match.
- Species Album hero photo now sized with `aspect-ratio: 16/10`, matching the dive-file's own marine-life carousel, instead of a fixed/viewport-relative height.

### Fixed
- Species Album hero photo rendered taller than intended on mobile — an earlier viewport-relative height + `min-height` combination leaked past the mobile override (which only reset `height`), so `min-height` kept winning the cascade. Switching to `aspect-ratio` removes the conflicting pair entirely.
- Mobile species-picker category tab counts (e.g. "Fish 639") weren't respecting the active Country filter — showed unfiltered totals even though the results grid itself was correctly narrowed.

## [2.932] – 2026-07-20

### Fixed
- **Species database: 806 of 1,279 entries had the wrong WoRMS AphiaID.** Found via a sanity check while building an (unshipped) OBIS region-tagging script — a "shared ID" scan caught 90 aphiaIds assigned to 2+ unrelated species (198 rows, e.g. a wobbegong shark and a sixgill shark stored under the same id); fixing those surfaced 24 *more* collisions from rows that were wrong but hadn't collided with anything yet, so every one of the 1,279 stored names ended up re-checked individually against WoRMS. 6 species were stored under an outdated/misspelled name and were renamed to their current WoRMS name (e.g. "Pictichromis magna" → "Pictichromis porphyrea"); 4 had no WoRMS match under any spelling checked and were removed. 1,275 species remain. `photoUrl`/`iucnStatus` were unaffected — both key on name, not AphiaID. Full incident write-up in DECISIONS.md → "Species database AphiaID audit".
- **Mobile species search now opens the keyboard immediately** on tapping the search button, instead of requiring a second tap on the field once the picker sheet is already open.
- **Mobile species-picker category tabs moved from the bottom of the sheet to directly under the search bar**, so they stay visible above the on-screen keyboard instead of being hidden for as long as the field has focus.
- **Journal textarea no longer grows without limit on mobile.** The auto-expanding notes field, combined with the keyboard's own caret-follow scrolling, could drag the whole Journal card off the top of the screen after a few sentences — capped at 40vh with internal scroll instead.

### Changed
- **Dive-profile NDL colour thresholds tightened** — danger zone now under 5 min (was 10), warning band narrowed to 10–20 min, calm reached by 50 min (was 60); legend tick label simplified from "0 = deco" to "0".

## [2.931] – 2026-07-17

### Fixed
- **Map markers loaded as broken images instead of pins** (surfaced via the new trip-map view, 2.93, but was a latent bug in `loadLeaflet()` regardless of entry point). Root cause was two-fold: Leaflet's default marker icon detects its own image path by reading a *computed* style from `leaflet.css`, so a marker created before that stylesheet had actually finished applying got a permanently broken icon — `loadLeaflet()` previously only awaited the Leaflet script's load, not the stylesheet's. Fixing that exposed a second bug: an explicit `iconUrl`/`iconRetinaUrl`/`shadowUrl` override added defensively on top double-prefixed the path once auto-detection started working correctly (`.../images/.../images/marker-icon.png`), because Leaflet's own `_getIconUrl()` always prepends `imagePath` regardless. Corrected to the one right fix — set `L.Icon.Default.imagePath` alone and leave the filenames as Leaflet's own defaults. Verified end-to-end in a real browser session (not just reasoned through): resolved icon URL, non-zero `naturalWidth`, and a working popup.

## [2.93] – 2026-07-17

### Added
- **Full-screen view-only map for History's trip timeline.** The trip-grouped timeline's small ambient map is deliberately non-interactive by design — real-user testing found people tapped it expecting to pinch/zoom directly regardless. The whole card is now a tap target that opens the same pins full-screen with real pan/pinch-zoom, reusing the exact marker and popup rendering the History "Map" view already has (dive number, site, date, depth, time, species count) rather than a simplified stand-in. View-only — no pin placement, no dragging, no editing.

### Changed
- **Colour contrast pass across the app.** `--text-muted` darkened (~3.46:1 → ~4.78:1 against the app's backgrounds) — it's the default colour for field labels, unit captions, and section summaries, not just decorative meta text, and the original was under WCAG AA even for large text. A full sweep of every `color: var(--accent)` text use found the token had drifted well beyond its "interactive ink" charter: a dozen-plus non-interactive section/card headings, four per-sighting abundance badges, and several status/metadata elements all moved to the correct neutral instead, closing a real contrast failure on the headings (~2.98:1 → ~12.9:1) along the way. Full detail in `CLAUDE colour UI.md`.
- **`--warn` and `--pending` merged into one token, then renamed to `--warn`.** Two coral "attention" tokens covered the same meaning. Consolidating first kept the `--pending` name, but the NDL-gradient chart's own code already called its local variable `warnHex` — "pending" undersold almost everything using this colour, which reads as an active, worth-noticing-now state (a dive computer's NDL running low, a disconnected sync) rather than a queued to-do. Same hex throughout, one reserved slot.
- **`.lf-loc-title` eliminated** — a single-use heading class doing exactly what the log form's standard `.lf-lbl` already does.
- **Log form's full-screen map picker: "Done" replaced with a plain "✕"**, matching the close-button convention used by every other full-screen overlay in the app.

## [2.92] – 2026-07-16

### Changed
- **Mobile species picker restructured after real-user testing found it barely usable with the keyboard open.** The search field no longer auto-focuses when the picker opens — it forced the keyboard open on every visit, including just browsing photos, which squeezed the category tabs, search row, and footer into whatever sliver of screen the keyboard left behind. Search and close now share a single row anchored at the top of the picker, so it never shifts position when the keyboard does open; category tabs moved to the bottom and now hide as soon as the field is focused rather than waiting for two typed characters, so tabs and the keyboard are never both competing for space at once. Scoped to the log form's picker (`#sp-mob-overlay`) — the footage-tagging picker keeps its original layout for now, a deliberate, separately-tracked follow-up.

### Fixed
- **The mobile species search's "+ Free text" button was silently dead.** It read from the same field the search input's own focus/input handlers always redirected away from before it could hold typed text, so tapping it did nothing, repeatedly, with no feedback. A zero-match search now renders an inline "Add '{query}' as a new sighting" row directly in the results grid instead, exactly where the failure happens.

## [2.91] – 2026-07-16

### Added
- **Full-screen map picker for placing a pin on mobile.** Below the desktop rail breakpoint, the compact in-form map is now a non-interactive preview — real-user mobile testing found it, combined with an open on-screen keyboard, left almost no usable area to pinch/pan a potentially-global map to find yourself on. Any tap opens the same live map full-screen instead; confirming the reverse-geocoded place auto-closes it back to the form.

### Changed
- **Trip field moved from directly under Date/Dive # to after the Location card**, and its copy rewritten to explicitly rule out "the destination" and state it can be left blank. Real-user mobile testing found people typing their country into it — it sat right before Country/Region/Site, priming a "where did you go" reading before anyone read the hint.
- **"Use my location" restyled from a bare accent-coloured text link to a solid accent-fill pill.** Real-user mobile testing found it was consistently missed — it read as secondary chrome against the accent-tinted header row it sits on, not as the fastest, most accurate way to pin a dive.
- **Saving a dive now arms on the first tap and confirms on the second**, reusing the existing delete "arm and confirm" pattern (`armDelete`) rather than saving immediately. Closes a real bug found in testing: two rapid taps on Save created two separate, fully synced dive entries with no dedup and no visible explanation. `aria-pressed` now also toggles on every armed button (delete included), fixing a pre-existing gap where armed state wasn't exposed to assistive tech.

## [2.9] – 2026-07-16

### Added
- **BLE sync now pulls NDL and deco/safety-stop data from the dive computer, not just UDDF import.** `download.c`'s sample callback reads `DC_SAMPLE_DECO` (previously discarded), so a Bluetooth sync gets the same profile-chart NDL colour gradient and stop pills that UDDF import already had — validated against a real 96-dive Peregrine transcript (28,112/28,112 waypoint samples carrying NDL).
- **BLE sync also pulls the dive's primary gas mix (e.g. "Nitrox 32") from the computer.** Raw O2/He fractions are read via `DC_FIELD_GASMIX` and classified through the existing `_gasMixLabel()` — cross-checked exactly against independent UDDF ground truth (96/96 dives, 100.0% match).
- **NDL colour key on the dive-profile chart.** The curve's colour gradient (calm → warning → danger → deco) was previously unexplained on the chart itself — a gradient bar with tick labels now sits between the chart and the stat strip, shown only when a dive has NDL data.
- **The dive-profile chart's colour now distinguishes "still live and reversible" from "genuinely committed to deco."** Once a dive's NDL data shows it actually crossed zero (or, for computers that stop reporting NDL once in deco, its first `<decostop>`/deco-sample event), the curve locks to a darker "deco" colour for the rest of the dive regardless of what NDL does afterward. Everything before that moment stays fully live — NDL recovering from near-zero back up on ascent is shown as a real recovery, not treated as having entered deco.

### Fixed
- **The NDL-zero marker line was appearing on every dive that had NDL data, at the very start of the dive, regardless of whether the dive ever came close to its no-deco limit.** The first waypoint or two before the wet sensor is deep enough can report a placeholder NDL of 0 — this was being read as "entered deco at t=0." Now ignores any NDL reading before the dive passes 3m depth.
- **NDL colour thresholds recalibrated to match how the data is actually used at 10/15/25 min, not the original 0/5/15.** Warning colour now starts at 25 min remaining, full danger colour at 10 min ("that's when I start thinking about ascending").
- **Colour-interpolation helpers (`_hexLerp`/`_hexToRgb`) could silently produce black.** An invalid or empty CSS custom property fed into the hex parser returned `NaN` from `parseInt`, which bitwise-masked to `0` — rendering as an unexplained black segment in the chart's gradient instead of a visible error. `_hexToRgb` now validates input and returns `null` on anything unparseable (hex or `rgb(...)`, since `_hexLerp`'s own output feeds back into later lerp calls); `_hexLerp` falls back to its first colour argument instead of black when parsing fails.

## [2.89] – 2026-07-15

### Added
- **Bulk dive selection + trip-assign in History.** A fresh BLE/UDDF bulk-add can drop 90+ dives into History in one go, all landing in a single "Ungrouped" bucket with no trip label — the existing trip-rename action only ever renames a whole *existing* group, so it had nothing to work with until the pile was split by hand, one dive at a time. "Select" turns each card into a tappable checkbox: tap a dive, tap another to select everything between them (no shift-key — works identically on touch and mouse), then assign a trip name to the whole selection at once. Applying clears the selection but stays in selection mode, so a big batch can be split into several trips one after another without re-entering select mode each time.

### Changed
- **Select and Map moved to their own row above the sort toolbar.** Sharing a row with the three sort buttons was crowded and wrapped confusingly on mobile — Select now sits on the left and Map on the right of a dedicated row above "Sort by."

### Changed
- **Bulk-add asks for your most recent dive number, not the batch's start number.** Divers remember "that was my hundredth dive!" as a concrete fact about a dive they just did — not "the dive before this batch," which isn't something anyone actually tracks. Now asks "Most recent dive #" (the newest dive *within* the batch being added) and counts backward to work out where the batch starts, with a live "→ #98–#100" preview beside the field so the arithmetic is never invisible.
- **BLE sync messaging now sets expectations instead of implying cancel-if-stuck is the norm.** A first/full sync now states upfront that it can take 30–40 minutes and that it's safe to stop anytime — dedup via the physical-signature match pass means dives already downloaded are kept and a later sync picks up the rest (this "sync in pieces" behaviour already existed structurally, via cancel-safe salvage + re-matching; only the messaging was misleading). The cancelled-with-partial-results status now says so explicitly too ("Sync again anytime to pick up the rest"), matching the wording the disconnected-mid-sync case already had.

## [2.87] – 2026-07-14

### Fixed
- **BLE sync's "up to date" check didn't notice when dives had been deleted locally.** Live-tested: full sync completes, delete some dives from history, resync — got "Already up to date" even though dives were now genuinely missing. The fingerprint only answers "has the device recorded anything new," not "is our own copy still intact" — those are different questions, and treating them as one meant a deleted dive stayed silently missing forever (the device-side cutoff would keep skipping it on every future sync too). Fixed by storing the total local dive count alongside each fingerprint; if the count has since dropped, the fingerprint is no longer trusted for that sync and it falls back to a full re-download automatically, with an honest "some previously-synced dives seem to be missing… doing a full check" status message rather than a silent full-sync with no explanation.
- **BLE sync: cancelling mid-download discarded every already-downloaded dive and showed a raw Web Bluetooth error instead of a real message.** `cancelBluetoothSync()` correctly disconnects immediately (needed to actually stop a healthy sync, not just hope the engine notices), but the WASM engine can have a write in flight in that instant — that write then throws against the now-dead characteristic, and the exception used to bypass all the cancel/disconnect handling entirely, landing on a bare "Sync failed: Failed to execute 'writeValueWithoutResponse'..." with nothing salvaged. Fixed by making the catch path reason-aware too: a cancel- or disconnect-induced throw is now handled identically to a clean cancel/disconnect — same honest message, same routing of whatever dives came through first. See BRIEF-dive-computer-sync.md §15 for the root cause and the mock-fidelity gap (silently-stop-responding mocks vs. actually-throw mocks) that let it through five tests running.

### Added
- **BLE sync no longer re-downloads your whole dive history every time.** The interrupted-then-resumed sync test that found the numbering trap below also exposed the real underlying problem: a full first sync takes tens of minutes at BLE speed, and no one waits that out routinely. `download.c` now captures each session's newest dive's device-assigned fingerprint and can accept one back — the dive computer's own driver then stops enumerating anything already known, so a routine "check for new dives" sync does real protocol work only for what's actually new, typically seconds instead of tens of minutes. Fingerprints are stored per physical device (by serial, learned mid-session) and only ever persisted after a session that completed cleanly, never after a cancel or disconnect — a fingerprint is a hard cutoff, so persisting one from an interrupted session would make the un-downloaded gap permanently unreachable on every future sync. Settings & data gets a "Bluetooth sync history" list with a Forget action per device as the recovery path. Verified end-to-end: feeding an older dive's fingerprint back into a full replay of the real 96-dive session correctly stops it at exactly the dives newer than that point; a dedicated correctness test confirms the persist rule holds even when a cancelled session has real, valid dive data ready to save. See BRIEF-dive-computer-sync.md §16.

- **Bulk-add now warns when a batch's dates predate dives already logged — the interrupted-sync numbering trap.** Dive computers deliver newest-first, so cancelling a sync partway grabs the most recent dives; the resumed session's remainder is *older* than what's now logged, and the "Start at #" default of highest+1 would silently number yesterday's dives after today's (observed in live testing: two 11-May dives numbered #7–8 above a #1 dated 11 May). The picker now compares batch dates against logged dates: when the whole batch is older and there's numbering room below the lowest logged dive, it suggests slotting underneath (e.g. #43 below an existing #45) and says so; when there's no room or dates interleave, it shows a plain warning explaining that the suggested number puts dive order out of date order.

- **BLE sync progress bar — real byte accounting, not a spinner.** `download.c` now subscribes to libdivecomputer's own `DC_EVENT_PROGRESS` (throttled to whole-percent changes, pre-manifest "unknown maximum" placeholder filtered) and streams `progress` JSON lines; the UI renders a slim accent bar with a "48% · 42 dives so far" label under the sync card. Also added a console-logged `BLE_SYNC_REV` revision marker — the third live hardware test failed identically to the second because the service worker was still serving the pre-fix `computer-sync.js` from its installed cache (a mid-session edit shipped without a `sw.js` bump never reaches an already-installed SW), and two hardware sessions were burned re-testing old bytes before that was caught. The marker makes "which code is this browser actually running?" a one-glance console check.

### Changed
- **UDDF import and BLE sync are now one card, not two.** Both offered the same underlying thing ("get dives in from your computer") in separate stacked banners; merged into a single "Dive computer?" card with Import and Sync side by side. The Bluetooth button now uses a real inline SVG icon (matching `.hist-map-btn`'s existing icon convention) instead of a ⚡ lightning bolt — there's no reliable plain-Unicode Bluetooth glyph to fall back on. Fixes a latent bug as a side effect: the separate BLE banner was never covered by the edit-mode hide rule, so it could show while editing an existing dive; sharing `.lf-uddf-banner` fixes that for free.

### Fixed
- **BLE sync froze ~15s into every real download — root-caused and fixed (the Peregrine's "LOG ERROR: Timeout" was it waiting for *us*).** The packet queue's per-read timeout timer wasn't cancelled when a read resolved normally, and its expiry check matched *any* in-flight read rather than its own — so during a real paced download the first read's stale timer fired 15s in and orphaned whichever read was then in flight, freezing the WASM engine mid-suspension: Shoal went silent, the device gave up ~5s later, and neither the disconnect message nor the Cancel button could fire (both resolve the current waiter — which the stale timer had already nulled). Every prior mock missed it because they all replied at CPU speed; adding realistic per-exchange pacing to the replay harness reproduced the exact live deadlock, and the fixed queue (timer cleared on resolution, expiry checks identity) completes all 96 dives across ~50 would-be stale-timer windows. See BRIEF-dive-computer-sync.md §15 addendum.
- **BLE sync: the first real pairing test found a stuck-forever "Downloading…" with no error when the dive computer dropped mid-sync.** Pairing, connection, and real data exchange with an actual Shearwater Peregrine all worked — but there was no overall watchdog, no way to cancel, and a real disconnect fell through to the same "No dives on this computer" message a genuinely empty (but healthy) connection would show. Added a "✕ Cancel sync" button (works the instant it's clicked, independent of any timer), a distinct "connection was lost" message for an actual `gattserverdisconnected`, and partial-progress handling — dives already downloaded before a drop are kept and routed for review rather than discarded. Root cause of the Peregrine's own on-device error is still unconfirmed; the fix makes the failure recoverable and legible either way. See BRIEF-dive-computer-sync.md §15.

## [2.86] – 2026-07-14

### Added
- **BLE dive-computer sync — transport built, not yet live-tested (`js/computer-sync.js`, `vendor/libdivecomputer-wasm/`).** A "⚡ Sync" banner beside the Log page's UDDF import (shown only where Web Bluetooth exists — Chrome/Edge) pairs with a Shearwater or Suunto dive computer and downloads dives straight in, landing in the exact same review/bulk-add pipeline UDDF import uses. The compiled download module (real, not spike-quality — full waypoint extraction, not just summary fields) re-validates 96/96 dives and 28,112/28,112 waypoints exact against the same real Peregrine capture step 1 used. GATT service UUIDs for both vendor families sourced from Subsurface's own BLE code (facts only, per the brief's GPL boundary). One thing this can't yet claim: an actual live pairing dialog, which needs a human present with the hardware to click through — see BRIEF-dive-computer-sync.md §14 for exactly what's proven vs. what isn't.

## [2.85] – 2026-07-14

### Added
- **BLE-sync groundwork (dev tooling, `scripts/libdivecomputer-wasm-spike/`):** libdivecomputer compiles to WASM and its blocking I/O suspends on JS promises via JSPI (the step-1b architecture gate for BRIEF-dive-computer-sync — PASSED, both Shearwater and Suunto protocol engines); plus a replay harness that drives the full download pipeline under WASM against a recorded Peregrine BLE transcript — 96/96 real dives parsed with exact datetimes and depths vs Subsurface's export. Key transport fact discovered: Shearwater BLE framing is one-packet-per-read (GATT notification boundaries are protocol framing — never coalesce). See the brief §13.
- **Bulk-add on UDDF import — turn a whole dive-computer history into logged dives in one action.** Importing a UDDF on the Log page already matched dives against existing history; anything unmatched only offered a one-at-a-time "pick one to log" list — unusable for the new-diver case where the entire logbook lives on the computer (48 dives = 48 form round-trips). The picker now leads with "Add all N as new dives" plus a single **"Start at #"** control: dives are numbered chronologically counting up from it (covers "I got this computer on dive 45", and switching computers mid-history — each import batch gets its own start). Prefill: the file's own `<divenumber>` when present, else highest logged dive + 1. Created dives are skeletons — only what the profile knows (date, times, depth/avg, duration, temp, gas/tank/pressures, GPS+site when present) — with the depth-profile sidecar attached; everything else is left for ✎ edit mode. Re-importing the same file matches the created dives instead of duplicating (same physical-signature match pass as before). This is also the landing flow BLE computer sync will reuse (BRIEF-dive-computer-sync §9).

## [2.832] – 2026-07-12

### Fixed
- **THE actual root cause of the PWA never working offline: the service worker's install had never once succeeded in production, deterministically — nothing was ever being cached, on any connection.** The shell list contained `/index.html`, but Cloudflare Pages answers `/index.html` with a 308 redirect to `/` (its clean-URL behaviour) — and `cacheable()` rejects any redirected response (the guard that stops a Cloudflare Access login page poisoning the cache). Non-transient, so retries changed nothing: every install attempt failed at that same file, on every visit, since the redirect guard shipped in 2.394 (2026-06-12, per `git log -S "res.redirected"`) — a full month of every deploy silently failing to install. Local dev servers serve `/index.html` as a plain 200, which is why no local test ever reproduced it — confirmed by extracting the real `cacheable()`/`fetchShellFile()` from `sw.js` and running the install pipeline against both a 308-simulating local server and the live diveshoal.com (old list: fails with `not cacheable: /index.html`, 0 files cached; fixed list: 33/33), then a full browser pass (install completes, kill server, reload → app boots fully styled from cache). Fix: `/` is the canonical shell cache key; `/index.html` is gone from the shell lists and the navigation handler now matches/revalidates `/`. **`/index.html` must never be re-added to the shell list** — see the comment in `sw.js` + DECISIONS.md. Also explains the earlier "loads an older version" symptom: an ancient successfully-installed worker was serving its stale cache forever because every newer install failed.
- **PWA still failed to install offline-ready even after the 2.831 atomic-install fix.** That fix correctly stopped the shell cache from ending up silently half-broken, but "atomic" also meant the install was only as reliable as its single worst file — and two decorative font files (`Literata` regular + italic, used only for the Notes journal serif) turned out to be 1.8 MB of the shell's 3.45 MB total, more than half. On a weak connection, those two large, purely-cosmetic files could fail the *entire* install just as easily as any genuinely critical file. The shell is now split into `SHELL_CRITICAL` (everything the app actually needs — HTML/CSS/JS, species DB, Leaflet, Figtree, Young Serif — still cached atomically, still gates offline-readiness) and `SHELL_DEFERRED` (the two Literata files, cached best-effort in the background; the app already has a `Georgia, serif` fallback for them). Required payload for the app to become offline-ready drops from 3.45 MB to 1.72 MB. See DECISIONS.md.

## [2.831] – 2026-07-12

### Fixed
- **Offline PWA could load with no CSS ("plain HTML") or show Android's native "app is offline" screen, even after a first successful visit.** Root cause: the service worker's install step fetched all ~34 shell files in parallel and wrote each to the cache as its own fetch resolved; if any single file failed (weak mobile signal), the overall install failed too, but the files that *had* already succeeded stayed written — a permanently half-cached shell (e.g. `index.html` present, `css/styles.css` missing) that every later install attempt would reopen and only partially patch, since the cache name doesn't change between attempts. `install` now fetches (with retries) every file into memory first and only writes to the cache if all of them succeed — either the whole shell lands together or none of it does. See DECISIONS.md.

## [2.83] – 2026-07-11

### Added
- **"View dive →" in the post-save confirm bar.** Appears next to the filename right after a new dive saves; jumps to the dive's full read view (History → dive file) so a mis-tapped or premature Save is one tap to check and fix (✎ is right there in the dive file) instead of hunting through History for it.
- **"✎ Enter coordinates" on the log-form map.** Reveals two lat/lng number inputs (and a "Set pin →" button) without hiding the live map — was previously only reachable as an offline fallback when tiles failed to load. Covers both "type exact coordinates from scratch" (site not in any database) and "tweak a roughly-dropped pin with precise numbers"; the fields already track whatever pin exists, so opening it always shows the current position. Distinct from the genuine offline fallback (which still hides the map and keeps its warning styling) via a `manualOnly` flag so neither path stomps the other.

### Changed
- **Editing a dive now happens on the Log form itself (edit mode) — the edit modal is retired.** ✎ prefills the real form from the dive, shows an "✎ Editing dive #N — Site" banner with Cancel, relabels the save buttons "Save changes", and hides the new-dive affordances (UDDF import, confirm bar). Saving merges over the existing dive in place (uid/videos/filename all preserved — verified by a sandbox test against the real functions); save, Cancel, and back-gesture all land on History. Guardrails: edit mode is disarmed by any navigation away from Log (no path leaves it silently armed), and a pending dive-computer profile can never attach via an edit save. Kills ~450 lines of duplicated form markup/save logic and the whole stacking-context bug class the modal produced. **✎ intentionally has no "discard unsaved draft?" prompt** — a confirm-guard was built and then pulled after twice missing real content fields in testing (Operator, then Current/Gas/deco-stop); ✎ now silently discards an in-progress draft the same way switching to Stats or Species already does, and re-opening a premature save costs one tap. See `briefs-archive/v2.83-BRIEF-edit-in-place.md` + DECISIONS.md.
- **Edit mode tints every section card's border `--accent-border`** (the same tone the location card already carries permanently), so the "you're editing, not logging new" signal persists as you scroll past the banner instead of only showing at the top of the page. Chosen over an accent background wash and a plain neutral-surface swap after comparing mockups of all three — see DECISIONS.md.
- **Mobile "Save dive" button is a smaller floating pill, not a full-width bar**, and sits with a visible ~14px gap above the bottom nav rather than flush against it — was an easy mis-tap between the two on a phone, and a full-page-width edge invited accidental thumb brushes.
- **Log-form Site name field given a real label and clearer copy.** It previously had no `<label>` at all (unlike every other field in the form) and read purely as a search widget ("Search Dive Vibe / OSM…"), which visually undersold that it's the actual site-name field and that typing something with zero search matches is completely fine. Now labelled "Site name", placeholder reads "e.g. Blue Corner — type to search, or enter your own", and the hint under it spells out the free-text fallback explicitly.

### Fixed
- **Site name input was rendering as unstyled browser-default chrome, not the app's field styling.** Its only ancestor was `.ac-wrap` (`position:relative` only) rather than `.field`, so it never picked up the `background`/`border`/`border-radius`/`width:100%` every other field gets — it was quietly falling back to the browser's native ~20-character input box, which read as low-weight/optional next to the full-width Country/Region fields beside it. `.site-search-wrap > input` now carries that exact styling directly.
- **Mobile species picker opened *behind* the edit modal** — `#sp-mob-overlay` sat at `z-index: 600` under `.modal-overlay` (1000), so tapping the Marine life search inside the edit modal on mobile showed nothing selectable. Raised to 1100 (moot for the edit modal now it's gone, but the picker must still clear other overlays). `#footage-mob-picker` had the identical latent bug against `.fm-overlay` (900) and got the same fix.

### Removed
- Edit modal (`openEdit` template, `saveEdit`, `modalSightings`, modal species panel, `lfInitEditModal`, `#edit-modal` markup and its dead CSS). The modal footer's Delete (native confirm) went with it — the timeline trash icon and dive-file menu `armDelete` already cover deletion.

## [2.82] – 2026-07-10

### Added
- **"Export unvalidated species" (Settings & data)** — downloads a CSV of every logged sighting never matched to the species database, grouped by the app's own `customId` with a per-species sighting count, as the starting point for reconciling what's actually been seen against `data/species-db.js`.
- **Unvalidated-species reconciliation batch**: 24 new species added (WoRMS-verified, cross-checked against the existing DB for duplicates) from the first real export of Luke's own logged free-text sightings.
- Native "Save As" dialog (`save_file_dialog`, `src-tauri/src/lib.rs`) for single-file exports in the Tauri shell.

### Fixed
- **24 existing species-DB entries were hiding under overly generic common names** (e.g. "Jack" instead of "Bluefin trevally", "Angelfish" instead of "Emperor angelfish", "Lobster" instead of "Blue lobster") — this, not missing data, turned out to be the dominant cause of "unvalidated" free-text sightings. Renamed to the specific names actually searched for; confirmed no naming collisions first.
- **Tauri's shared folder-picker silently repointed dive-sync at the wrong folder.** `pick_folder` (used by the dive vault picker, "Export all", and the proxy-folder connector) never told the native macOS panel where to start, and the OS remembers "last visited directory" with no per-purpose isolation — so picking a `.uddf` file via an unrelated file dialog could leave the next dive-folder pick defaulting to that same location. Reported directly: a user's folder sync had drifted to their Downloads folder with no visible cause. `pick_folder` now accepts a `default_path`; the dive-vault picker always passes the currently-configured folder.
- **CSV/file exports reported success but produced nothing in the Tauri desktop app.** `downloadBlob()`'s `<a download>` + blob-URL trick, which works in every real browser, silently no-ops in WKWebView (the native webview Tauri uses on macOS). Single-file exports now branch through the new native Save dialog in the shell.
- **`fetch-photos.py`'s resumable cache could reintroduce non-CC-licensed photo URLs.** The cache (`scripts/species-photos.json`) had entries predating the CC-license host rule; the script trusted them without re-validating, silently writing 23 stale `static.inaturalist.org` URLs back into the live database on a routine run. The cache now only counts a value as resolved if it's empty or already on the safe host; 170 stale entries purged from the cache so this can't recur.
- **The mobile dive-file's Marine/Overview/Notes control didn't read as clickable.** Only the active segment had any background or border; the other two were bare muted text with no visual affordance at all. Confirmed by comparing directly against v1.951 (pulled from git history), which used bordered "folder tab" styling that got tapped immediately by new users. Every segment now gets its own border at rest, with `:hover`/`:active` states — the active one stays distinguished by fill + shadow, not by being the only one with any shape.

### Changed
- Species DB: 24 new entries (1,255 → 1,279), on top of the 24 renames above.
- **Documentation accuracy pass** across README.md, CLAUDE.md, DECISIONS.md, and ROADMAP.md: corrected several places that still described Obsidian's Local REST API sync as the primary data path (Folder sync is now Luke's actual day-to-day backend — Obsidian sync is unchanged and fully supported, just not the default in practice); added a "Folder sync" architecture section to CLAUDE.md alongside the existing "Obsidian integration" one; refreshed stale `1,110`/`1,255`-species references to `1,279` throughout; rewrote ROADMAP.md's IUCN commercial-licensing section, which still described IBAT as the paid path and didn't reflect this session's finding that neither IBAT nor an own-API-key approach actually avoids IUCN's Commercial Use restriction (the real path is direct contact with IUCN, per their own terms).

## [2.81] – 2026-07-09

### Added
- **UK coastal batch 2 (145 species)**, bringing the species database to 1,255 entries. Sourced from OBIS's UK-waters occurrence checklist rather than copied from any single third-party guide — see CLAUDE.md → "Species database" and the sourcing note in `data/species-db.js`'s own header. AphiaIDs and (where available) IUCN status came directly from the same source data.
- `scripts/audit-photo-licenses.py` — a reusable re-audit pass that finds any species photo hosted on `static.inaturalist.org` (not guaranteed CC-licensed) and either swaps it for a licensed equivalent on the `inaturalist-open-data.s3` bucket or blanks it. Also fixed 160 pre-existing entries that had regressed to the unsafe host since the original June 2026 audit.
- `fetch-iucn.py` synonym fallback — when a species' WoRMS-canonical name has no IUCN match, the script now retries against a small table of known taxonomic-synonym alternates (genus reassignments, Latin gender-ending variants) before giving up. Resolved 29 species that were previously coming back blank despite being genuinely assessed.
- Subtle "arm and confirm" delete guardrail on the three dive-delete entry points that lacked one (dive-file "more" menu ×2, timeline row trash icon) — first tap arms the button (colour/label change, brief pulse), second tap within a few seconds confirms; auto-reverts if left untouched.

### Fixed
- **Species profile clip list rendered as a ragged, unscannable jumble** once a species had many logged clips — `.sp-video-ref` was `inline-flex`, so rows wrapped like words in a paragraph instead of stacking as list rows. Now block-level `flex`; every clip gets a consistent left edge regardless of whether it carries a note.
- **IUCN badge nearly invisible on the species-profile photo overlay** — the dark-scrim gradient got an explicit light-colour override for the name/sci-name/footer text, but the badge itself was missed and kept rendering in its default light-surface styling.
- **Species-profile modal stayed open (and unclosable) when navigating to a clip's footage from within it** — `openFootage()` now closes a `speciesProfile` overlay if one is open on top, mirroring the existing lateral-navigation pattern; scoped narrowly so it doesn't disturb the intentional dive-file → footage/edit-modal nesting.
- `fetch-photos.py` targeted the pre-migration `index.html` instead of `data/species-db.js`, and had no CC-license host filtering at all — rewritten to target the right file and to only ever write `inaturalist-open-data.s3.amazonaws.com` URLs.

### Changed
- Species profile modal widened (680px → 820px max-width) and its hero photo enlarged (~35% wider and taller) on desktop, with the meta column narrowing to match.
- `.lf-uddf-banner` now reuses `.sync-banner`'s box model via a new `.accent` colour variant, instead of duplicating the same flex/padding/border/radius rules in a parallel class.
- Species counts updated across CLAUDE.md/README to 1,255.
- Archived two fully-shipped briefs (`v2.76-BRIEF-sidecar-filename-hygiene.md`, `v2.8-BRIEF-dive-profile-import.md`) into `briefs-archive/`, with ROADMAP.md updated to point at them.
- Minor copy tweaks (PWA title/description, a few form-field hints and button labels).

### Security
- Retroactively fixed 160 species-DB photo URLs that had regressed to the non-license-guaranteed `static.inaturalist.org` host since the June 2026 audit (see `audit-photo-licenses.py` above) — 137 replaced with CC-licensed equivalents, 23 blanked where none existed.

## [2.8] – 2026-07-08

### Added
- **Dive profile chart (Phase C of dive computer profile import).** An SVG depth/time curve in the dive file, replacing the floating stat band on any dive with an imported profile:
  - Depth on an inverted Y axis, a water-column fill with its own top-to-bottom gradient (lighter at the surface, deepening with depth, echoing the app's existing depth-gradient background) rather than a flat tint.
  - One colour mechanic: the curve tints from a muted calm blue toward danger-red as no-decompression time runs out. Forward-fills across any gap where a file stops reporting `<nodecotime>` the moment a dive commits to mandatory decompression (confirmed against a real rebreather export — NDL drops cleanly, then the field simply vanishes right as `<decostop>` events begin), so the curve doesn't swing back to "safe" during the most hazardous phase of the dive. A thin vertical line marks the exact moment NDL hits zero, falling back to the first `<decostop>` event's own timestamp when the raw data never logs a literal zero.
  - Safety/deco stop events group into lean pills ("SAFETY · 5M · 3MIN", or for a real multi-level ascent, "DECO · 22→0M · 90MIN") sitting in the open water below the curve.
  - Entry/exit points are labelled with the dive's actual clock times instead of the words "entry"/"exit" — which lets the dive-file's separate Profile bubble (In/Stop/Out) disappear entirely once a chart exists, alongside Gas & equipment's Gas/Pressure/SAC rate/Cylinder rows (already covered by the chart's own stat strip and gas-bar text, which now includes tank type too).
  - Ascent-rate colour coding and a continuous on-curve temperature trace were both explored against design-study mockups and deliberately cut — one colour signal, not two; temperature is already covered by the existing "min °c" stat.
  - Taller on narrow phones, computed at render time (not via CSS) so the SVG viewBox and its HTML-overlay tick labels can't drift out of sync with each other.

### Fixed
- **Folder sync silently went empty after any page reload.** `getWritableFolderHandle()` could return null even with a folder already connected, because a reload can revert the browser's File System Access permission grant to `'prompt'`, and the automatic re-check has no user gesture behind it to show the permission dialog — so it just failed quietly. `loadAllSidecars`/`loadAllProfileSidecars` came back empty with zero visible sign anything was wrong. Now surfaces a "Folder sync disconnected" banner with a one-click Reconnect button instead of failing silently. Folder mode's boot sequence also now syncs automatically on every load, matching Obsidian mode's existing behaviour — previously it was manual-sync-only, which left Stats charts empty on every fresh Tauri-shell launch until "Sync from folder" was clicked by hand.
- **Switching panels while an overlay (most commonly the dive file) was open left it stale.** Tapping a bottom-nav item swapped the active panel and pushed new history state, but never closed the overlay's own DOM or removed its event listeners — so navigating back showed a broken view missing its back/edit buttons. Lateral navigation now closes any open overlay first, reusing the same teardown dispatch the back-gesture/Escape path already relied on.

### Changed
- `sw.js` cache bumped to **v145** across this session's changes to `js/profile.js`, `js/app.js`, `js/history.js`, `css/styles.css`, and `index.html`.

## [2.76] – 2026-07-06

### Added
- **Dive computer profile import (UDDF).** Import a `.uddf` file exported from a dive computer's desktop software (Dive Exporter, Subsurface, MacDive, and similar) to auto-fill a dive instead of typing it by hand:
  - **Log a dive** page gets a "Just dove?" banner. It matches the imported profile against dives already logged (by physical signature — max depth + bottom time, never the file's own timestamp, since computer clocks drift and reset) so re-importing never creates a duplicate; anything with no existing match pre-fills a brand-new entry — date, entry/exit time, depth, a time-weighted average depth, average water temperature, GPS when the file's site data carries coordinates, and gas mix + tank size + start/end pressure when the file carries `<gasdefinitions>`/`<tankdata>`.
  - **Settings & data** gets "Add profiles to dives you've already logged" — the same matching engine, scoped to attaching a profile onto history rather than starting something new.
  - Ambiguous matches (more than one plausible existing dive) show a lean inline pick-list rather than guessing; on the Log page, "+ Add as a new dive" is always offered alongside the candidates, since starting fresh is that page's whole premise.
  - New `js/profile.js`: a UDDF 3.2 parser written directly from the spec, namespace-agnostic (handles files with and without a declared `xmlns`), and hardened against real non-conformance found while testing against actual tool-generated files — some exporters write temperature in Celsius rather than the spec's Kelvin, nest site coordinates inconsistently, or flatten `<divesite>` with no `<site>` wrapper at all. The parser tries the spec-correct interpretation first and only falls back when that produces a physically implausible result, never a silent guess.
  - Profile data (waypoints, events, computer name) lands in a `.profile.json` sidecar mirroring the existing footage sidecar exactly — same three-backend I/O, same rename and delete coverage.
- **Coordinated canonical dive-file renaming.** Renumbering a dive or changing its site used to leave the vault filename stale, risking an orphaned footage sidecar if the mismatch was later "fixed" by hand in Finder or Obsidian. The canonical filename is now recomputed and compared on every save; a mismatch triggers a write-new-then-delete-old rename that moves every sidecar together (footage, and now profile) — never the reverse order, so an interrupted rename leaves a harmless duplicate, never an orphan. Also collision-safe: two dives landing on the same computed filename no longer silently overwrite each other.
- App icons refreshed across macOS, Windows, iOS, and Android for the Shoal rebrand.

### Fixed
- **UDDF import silently produced wrong data on real-world non-conformant files.** A file with plain-Celsius temperatures (instead of spec-mandated Kelvin) produced physically impossible readings like -246°C; GPS coordinates present in a file were silently dropped when nested under a non-spec `<gps>` wrapper or when `<divesite>` had no inner `<site>` element. All three now resolve correctly without assuming a file follows the spec exactly.

### Changed
- `sw.js` SHELL += `js/profile.js`; cache bumped to **v127**.

## [2.75.3] – 2026-07-02

### Fixed
- **Leaflet maps could paint over fixed mobile UI (save bar, bottom nav).** Leaflet's internal panes use z-index values up to 700 with no bounding stacking context, so on a short mobile viewport the log-form's pin map could render on top of the fixed "Save dive" bar. Added `isolation: isolate` to `.lf-map` (log form / edit modal pin map) and `#species-map` (Species Album profile map) to contain Leaflet's z-index scale to its own box — same root cause as the earlier welcome-overlay fix, different fixed element.

### Changed
- **"Gas & equipment" log-form section rebalanced.** Row 1 is now Start / End / Weight / Suit (4 columns); row 2 is Size / Gas mix / Tank type (also 4 columns, Tank type spans 2) — replacing the previous 4-col + 2-col + full-width-Suit layout. Applied identically to the log form and the edit modal. New `.lf-numcol-span2` grid utility.
- `sw.js` cache bumped to **v119**.

## [2.75.2] – 2026-06-30

### Added
- **Log-form redesign — visual capture controls + map-pin location (`js/logform.js`, new).** The data-entry controls are now visual rather than native dropdowns, each writing into the *same* canonical hidden inputs (`f-entry`, `f-watertype`, `f-current`, `f-tanktype`, `f-weather`, `f-gps-lat/lng`, `f-location`, `f-region`), so `saveDive()`, markdown generation and the edit modal are untouched:
  - **Drop-a-pin location.** An in-form Leaflet map replaces the "Use GPS" button + manual lat/lng pair: tap or drag the pin to set coordinates. "⊕ Use my location" shortcut; graceful **offline fallback** (manual lat/lng inputs when tiles can't load). The pin **reverse-geocodes** (Nominatim) to *suggest* Country + Region behind a "Confirm" affordance.
  - **Two-way Country / Region.** Country dropdown restored — selecting a country **focuses the map** on it (Nominatim bbox → `fitBounds`); the pin's reverse-geocode flows the other way. Region is free text (the user's call — "Komodo" vs "Moyo Island"). Picking a Dive Vibe / OSM site also drops the pin.
  - **Dive type** → 10 colour chips (the History `--type-*` ramp) instead of a `<select>`.
  - **Water type / Current / Tank type** → segmented toggles.
  - **Weather** → 3-icon picker (Sunny / Cloudy / Rain) writing a controlled value; legacy free-text weather still reads and saves unchanged.
  - **Visibility / Water temp** → gradient dials paired with number inputs (vis 0–30 m, temp 0–35 °C); the vis gradient runs deep blue → clear, temp runs cold-transparent → hot.
  - **Compact numeric rows** — time·depth·avg (3-up) and start·end·size·weight (4-up) with inline units, dropping to 2-up on narrow phones.
- **Desktop two-column log page (≥1024px).** Form in a 50/50 left column; a sticky right rail shows the **location map** by default and swaps to the **species photo grid** when the Marine life section is active (mobile species browsing unchanged — still the full-screen picker). The relocatable map (`#f-mapbox`) and species panel (`#species-dropdown`) move between inline slots and the rail on resize.
- **Edit-modal parity.** The edit-dive modal gets the same redesigned controls (inline, no rail), driven by the same **prefix-aware** `logform.js` (`'f'` = form, `'e'` = modal) with its own Leaflet instance — created lazily when the modal's Dive section opens, destroyed on close.

### Changed
- **App renamed to Shoal.** Live at `diveshoal.com` and `diveshoal.uk` (custom domains on Cloudflare Pages; Pages origin `dive-log-55i.pages.dev` unchanged).
- **Settings panel reordered.** "Where your dives live" is now first; "Appearance" is last. "Dive files" section rewritten with plain-English explanation of the `.md` format and the data-ownership philosophy (no cloud copies retained, import/export for user freedom).
- **Visibility cap 35 m → 30 m** on the dial, number input, and end label (both form and edit modal).
- `#panel-log`'s 780 px width cap is lifted at ≥1024px so the two columns fill `.main`.
- **Settings URL hash** is now `#settings` (public alias for the internal `obsidian` panel name); both `#settings` and `#obsidian` are accepted on load for backwards compatibility.
- `sw.js` SHELL += `js/logform.js`; cache bumped to **v118**.

### Fixed
- **Welcome overlay rendered behind the Leaflet map.** `.modal-overlay` z-index raised from 200 to 1000 — above Leaflet's internal panes (marker 600, popup 700).

### Security
- **iNaturalist photo audit — All Rights Reserved images removed.** All 188 `static.inaturalist.org` photo URLs in `data/species-db.js` were audited. The `inaturalist-open-data.s3.amazonaws.com` S3 bucket only mirrors CC-licensed photos; `static.inaturalist.org` serves all photos regardless of license. 12 entries had CC-licensed equivalents and were replaced with open-data URLs; 176 had no CC photo available and were blanked. Zero `static.inaturalist.org` URLs remain. Policy going forward: only accept `inaturalist-open-data.s3.amazonaws.com` URLs when adding species.

## [2.73] – 2026-06-28

### Added
- **Typography System v1 — "Marine Naturalist" direction.** Three self-hosted variable fonts: Figtree (UI and data, replaces system-ui), Literata (journal/notes serif), Young Serif (display titles). `@font-face` blocks at the top of `styles.css`; token system `--sans`, `--mono`, `--serif`, `--display` in `:root` — all rules consume tokens, no raw `font-family` values. Applied `--display` (Young Serif) to dive-file site name (`.df-site`) and journal title (`.df-notes-title`). Five variable-font TTFs in `fonts/`; all five paths added to `sw.js` SHELL cache (v112). Fonts served from the same origin — no Google Fonts CDN, works offline.
- **SVG caustics shimmer (WIP).** Replaced CSS radial-gradient caustics with an inline `feTurbulence type="fractalNoise"` + `feDiffuseLighting` SVG filter (`#caustic-light`). A `feComponentTransfer` lifts the shadow floor to warm taupe so multiply-blend shadows stay within the warm palette (not gray). Applied to stat/data surfaces only — removed from timeline cards (`.dD-card`). `setShimmer()` now also sets the SVG `<animate dur>` attribute, connecting the Settings slider to the animation speed (3 s at Lively → 55 s at Calm). *Visual quality still being refined — consider this a structural placeholder.*
- **Appearance settings box uses caustics.** The shimmer-settings `form-section` now gets the caustics animation (`::after`) instead of the static sun-on-water mesh, so the box visually responds to its own dial.
- **Dive file back button always returns to History.** "Back to {trip}" previously called `history.back()`, which returned to whichever panel you came from (e.g. Species). Now calls `goBackToHistory(diveId)` — closes the dive file directly, switches to History, and scrolls to the dive's trip group header.

### Changed
- **Shimmer opacity curve.** Switched from linear to squared (`shimmer² × max`), giving a subtle low end and a more dramatic high end. `--shimmer-opacity-max` raised to 0.90 (warm-tinted shadows don't overpower even at full opacity). Speed variables (`--shimmer-speed-slow/fast`, `--tex-drift-speed`) removed from CSS — speed is now entirely driven by JS via the SVG `<animate>` `dur` attribute.

## [2.72.2] – 2026-06-27

### Added
- **Desktop dive file redesign.** Full-bleed ambient Leaflet map hero at the top of the dive file, bleeding edge-to-edge across the `.main` padding via negative margin (`margin: -2.5rem -3rem 0`). GPS-gated; falls back to plain surface colour. Data ribbon replaced by floating CSS-circle bubbles (`.df-data-col`, `aspect-ratio: 1 / border-radius: 50%`) with an independent bob animation per circle. Marine section redesigned as a fixed-height (`clamp(440px, 58vh, 600px)`) 2-column grid (photo carousel left, scrollable sightings list right), sharing design language with the footage modal. Journal block (`.df-notes-full`) runs full-width at the bottom of the desktop layout. Mobile overview redesigned as a 2-column rounded-rectangle bubble grid.
- **3-layer background texture system.** Unconditional depth gradient on every page (`body::before`, fixed, z-index: −1 — warm cream fading to deep teal). Caustics shimmer on stat/card surfaces (`.df-band`, `.df-data-col`, `.df-data-mob .df-card`, `.st-tsc .c`, `.dD-card`) — animated GPU-composited `::after` radial gradients using `transform: translate3d + scale` (no paint on every frame). Static sun-on-water mesh on text-heavy informative surfaces (`.df-notes-block`, `.welcome-card`, settings `.form-section`). `isolation: isolate; overflow: hidden; position: relative` triad on all shimmer hosts; child content raised via `position: relative; z-index: 1`.
- **Single `--shimmer` dial (0–1).** One CSS custom property drives both shimmer contrast and animation speed via `calc()` in `:root`. User-facing slider in Settings → Appearance ("Off" to "Lively"); `setShimmer(v)` in `app.js` sets the property on `:root` and persists to `localStorage('divelog-shimmer')`; saved value re-applied at boot. Four developer-tunable coefficients in `:root` set the curve bounds. Respects `prefers-reduced-motion`.
- **Chronological profile timeline in dive file.** IN ↓ / Stop / Out ↑ rows replace the flat entry/exit scalar display in the desktop data bubble — narrative shape of the dive without needing a full graph.

### Changed
- **History timeline cards shimmer.** `.dD-card` added to the caustics shimmer selector group.
- **`_diveGlimpse()` species fallback removed.** Title → snippet → empty (was title → snippet → rarest species name). The rarest species is already shown as a thumbnail on the timeline card; the fallback was redundant.
- **"MARINE LIFE · X SPECIES" subheading removed** from the dive file marine section. Count is visible in the right-column "Sightings N" header.

### Fixed
- **Blank dive file on open (TDZ).** `overviewContent` referenced `notesBlockDesk` before it was declared in `renderDiveFile()`. Moved `hasNotes` / `notesBlockDesk` / `notesContent` above `overviewContent`.
- **Journal appearing twice on desktop.** `.df-panel { display: block !important }` at ≥900 px overwrote `.df-panel--notes-mob { display: none !important }` (same specificity, later in file). Re-declared `df-panel--notes-mob` after the ≥900 px override.

## [2.72 / 2.73] – 2026-06-26

### Added
- **Dive title field (2.72).** Optional short headline (max 50 chars) at the top
  of the Notes section. Stored as `title:` in YAML frontmatter; rendered as an
  `<h1>` in the markdown body. Surfaces in the history timeline as a glimpse
  (title → first-sentence snippet → rarest species name), giving every dive a
  human-readable identity at a glance.
- **Journal notes block (2.73).** Notes read-back styled in serif with title,
  meta line (site · date), and a horizontal rule separator. Appears in the dive
  file right column on desktop (≥600 px), and in the Notes tab on mobile — same
  HTML, two placement slots, breakpoint-gated.
- **`--serif` CSS token.** `Georgia, 'Times New Roman', serif` — new root
  variable for the narrative/journal layer.

### Changed
- **Form sections split (2.72).** Former "Notes & sign-off" section split into
  two: **Notes** (title + notes textarea, section A) and **Buddy & sign-off**
  (liveaboard, buddy, instructor, cert number, section G). Total sections now 7.
  Edit modal mirrors the same split.
- **Notes textarea.** Taller minimum height (160 px), 1.75 line-height, 12 px
  padding; auto-grows as you type.
- **History timeline dive-number line (mobile).** Species count now in the
  `#N · M sp.` chip; glimpse (title / snippet / species name) shown in the marine
  row alongside the rarest-species thumbnail.
- **History timeline (desktop ≥ 900 px).** Glimpse shown below the site name;
  dive number and date moved into a `dh-sub` subline with bold `#N`.

## [2.71] – 2026-06-25

### Added
- **Multi-location comparison pills (Plan panel).** Up to 5 dive sites can be
  saved as pill tabs in the Plan panel; tapping between them re-fetches
  conditions for that location without losing the others. Locations persist in
  `localStorage` (`divelog-plan-locations`). Deduplicates by name on add.

### Changed
- **Plan panel layout.** Day card (location pills + conditions) now sits in the
  left column below the calendar; surface interval calculator stays in the right
  column — matching the original design intent.
- **Moon phase discs.** Calendar moon indicators now rendered as pure CSS
  geometric circles (B&W `border`/`linear-gradient`) instead of emoji, matching
  the design brief.
- **Dive reordering — profile-only swap.** Arrow buttons and drag-and-drop in
  the surface interval calculator now move only the depth/time/gas profile block;
  entry times remain fixed anchors so the schedule doesn't shift.

### Fixed
- **Admiralty API called on every tab switch.** `fetchPlanTide()` now carries a
  session-only `_planTide._key` (lat/lng string). Switching app panels or
  changing the selected day re-renders without hitting the API again; the key is
  cleared on any location change, so switching between location pills still
  fetches fresh data. Open-Meteo `fetchPlanConditions()` gets the same guard via
  the existing `_planCond.key`. Neither key is persisted — not a cache.
- **Autocomplete dropdown clipped inside day card.** `overflow: hidden` on
  `.plan-daycard` was trapping the Nominatim dropdown inside the card boundary.
  Removed; border-radius still renders correctly.
- **Drag-and-drop silently failing.** HTML5 DND requires `dataTransfer.setData()`
  to be called in the `dragstart` handler; adding it fixed drag initiation.
- **`.plan-wd` inline font declarations.** Day-of-week labels now use the
  existing `.mono-dim-sm` utility class; `.plan-wd` retains only `text-align:
  center`.

## [2.69] – 2026-06-24

### Added
- **Per-panel scroll restoration (v2.69).** Switching panels no longer resets to
  the top — `_panelScrollY` in the unified `show()` patch saves `window.scrollY`
  per panel name on leave and restores it on return (`behavior: 'instant'`).
  Modal overlays are already handled by the `overflow: hidden` lock; dive file has
  its own `_diveFileScrollY` mechanism; this covers the five main panels.

## [2.68] – 2026-06-24

### Added
- **Species profile → dive file navigation.** Tapping a sighting row in a species
  profile navigates directly to that dive's file. The route is lateral
  (`goToDiveFromSpecies`): closes the profile without a `history.back()`, switches
  to History, then opens the dive file — so pressing back from the dive file
  returns to the species panel, not History.
- **Species profile → footage watch mode (Tauri only).** Clip rows in the species
  profile are now tappable on the desktop shell: `openFootage(diveId,
  {mode:'watch', expandKey})` opens the footage modal expanded to that sighting's
  clips, pre-seeked to the first clip. Passive on the web build (no `isShell()`).
- **Free-text species key normalisation.** Album indexes free-text sightings by
  `customId`; footage matches by `scientificName || customId`. A computed
  `expandKey = entry.scientificName || key` is passed to `openFootage`, so the
  two priority orders always agree — fixes what the code comments called "wrinkle 7".

### Fixed
- **Video audio persisting after footage modal close.** After closing the modal,
  the browser kept the `<video>` element registered in the OS media session — the
  macOS Play key could resume audio. `_cleanupPlayer()` now calls
  `.removeAttribute('src')` and `.load()` after `.pause()`, which forces the
  browser to fully release the resource and exit the media session.
- **Back navigation after species → dive file.** When `goToDiveFromSpecies` opened
  a dive file, pressing back returned to History instead of the species panel.
  Fixed by adding a panel-diff check in the `popstate` overlay-close handler:
  after `closeDiveFileDirect()`, if `state.panel` differs from the currently
  active DOM panel, calls `show(state.panel)` with `_showFromPopstate = true`.

## [2.67] – 2026-06-24

### Added
- **Overlay view-stack (v2.67).** All full-screen overlays (dive file, species
  profile, footage modal, edit modal) now push a state-only `history` entry via
  `_pushOverlayState(spec)`. Android back gesture and Escape both call
  `closeTopOverlay()` → `history.back()` → `popstate` → the correct `*Direct()`
  teardown function. Replaces four separate ad-hoc close paths.
- **Refcounted scroll lock.** `_lockScroll()` / `_unlockScroll()` use an integer
  counter (`_scrollLockCount`) so stacked overlays (e.g. footage over species)
  don't prematurely clear `body.style.overflow = 'hidden'` when the top overlay
  closes. Previous per-overlay `overflow` sets/clears had a double-unlock bug.
- **Unified Escape handler.** A single `keydown` listener in `app.js` calls
  `closeTopOverlay()` when `_openOverlays` is non-empty. Removed the individual
  Escape listeners that existed in `album.js` and `footage.js`.
- **`*Direct()` close functions.** `closeDiveFileDirect`, `closeSpeciesProfileDirect`,
  `closeFootageDirect`, `closeModalDirect` — the actual DOM teardown, called only
  from the `popstate` handler. Public `closeModal`, `closeDiveFile`, etc. delegate
  to `closeTopOverlay()`.

## [2.66] – 2026-06-24

### Added
- **Hash routing + panel nav seam (v2.66).** `goPanel(name)` pushes a real
  `history` entry (`{ panel: name }`) so Android's native back gesture navigates
  between panels instead of leaving the app. `PANEL_HASHES` maps panel names to
  `#fragment` URLs; a `popstate` handler restores the target panel. `_showFromPopstate`
  flag prevents the handler from pushing a duplicate history entry when a
  programmatic `show()` call originates from a popstate event. A boot IIFE reads
  `location.hash` and routes to the matching panel on first load. Nav order
  resequenced to Log / History / Plan / Species / Stats (History moved to #2 to
  reflect usage priority).

## [2.65] – 2026-06-24

### Added
- **First-run welcome card.** A one-time, benefit-led orientation for new users — a
  quick tour of the five areas (Log, Plan, History, Species, Stats) with an honest
  offline/online caveat. Shown once and never again (localStorage flag).
- **Sync status line.** A persistent, plain-language indicator of where dives live and
  whether they're backed up, driven by each dive's `_pendingSync` flag: quiet in the
  desktop sidebar, a slim auto-fading banner on mobile. Three states — synced
  (reassurance, fades after 30s), some-not-synced (⚠ + **Retry**, persists), and
  browser-only (**Back up** nudge). New `retrySync()` re-writes anything pending.
- **Footage discoverability.** The 🎬 footage button is now ever-present on the timeline
  card and in the dive file (greyed but visible when a dive has no footage yet) with a
  hover tooltip — so the feature is findable before first use.

### Changed
- **Storage settings reframed around where dives live.** "Auto-sync" → "Where your dives
  live"; options relabelled "In your browser" / "In a folder" with a Google-Drive-on-
  mobile hint. Reflects that folder sync now works on Android Chrome (M132+) and that a
  Google Drive folder backs up to the cloud via Android's Storage Access Framework.
- **History UI polish** (earlier, still unreleased): mobile sort toolbar restructured
  ("Sort by" on its own line, the four buttons grouped); trip-rename ✎ moved beside the
  trip name; IUCN and abundance (R/O/C) keys tidied to stop mobile overflow; subtle
  accent underline on back buttons; History panel widened to 900px; desktop dive-card
  height increased so the type spine fits.
- **Type-scale compliance sweep** — replaced off-scale inline font sizes with the
  documented `--text-xs/sm/base` tokens.

### Fixed
- **Android folder-write reliability.** `createWritable()` can throw
  `NoModificationAllowedError` / `InvalidStateError` on a just-created file through
  Android's Storage Access Framework; folder writes now retry with backoff
  (`writeFileInDir`), applied to the dive `.md`, the bulk export, and footage sidecar
  writes — closing a documented-but-unimplemented gap that could silently drop a dive
  from the synced folder.

## [2.6] – 2026-06-16

### Added
- **Dive planning panel.** New "Plan" tab in desktop sidebar and mobile bottom
  nav — tides, weather, and a surface-interval calculator, replacing several
  websites + paper tables. "Data" nav renamed "Settings & data" and moved to
  a cog (⚙): sidebar footer on desktop, a floating fixed button on mobile
  (the old mobile top bar consumed layout space and overlapped History
  content; the floating cog doesn't). Includes:
  - *Tide calendar* — monthly grid shading spring tides from moon phase
    (synodic-month engine, validated against the 2026 almanac, ±~1 day
    accuracy). Phase-specific moon glyphs (🌕 🌑 🌓 🌗) mark full/new/quarter
    moon days; mid and neap render identically (deliberately blank — neither
    needs to alert the user), spring gets a muted wash of the app's own ink
    colour rather than a new hue (accent is reserved for interactive state;
    the dive-type ramp for dive types).
  - *Day readout* — tap any date for tide class, moon phase name and
    illumination percentage.
  - *Location picker* — type any coastal town or site; autocomplete uses
    Nominatim (general geocode, not dive-site-filtered) plus the user's logged
    sites as instant quick-picks.
  - *Open-Meteo wind forecast* (~16 days, keyless, CORS-safe): daily-max gust
    in knots (the verdict threshold — gusts are what you actually feel at the
    surface, not the sustained average) with a rotating direction arrow +
    compass abbreviation, against a user-adjustable limit (default 25 kn,
    persisted in `localStorage`).
  - *Open-Meteo marine forecast* (~8 days): daily-max swell height, swell
    period (seconds), and total wave height.
  - *Surface-interval calculator* — vendored MIT `scuba-physics` (Bühlmann
    ZHL-16C; see `vendor/scuba-physics/README.md` for provenance, validated
    against the library's own published NDL table). Add planned dives
    (depth/time/gas/optional entry time); see each dive's NDL, the minimum
    surface interval chained to the next, and — when entry times are given —
    an actual clock-time "earliest re-entry", not just a minute count. Drag
    or ▲▼ buttons to reorder (recalculates the whole chain, since order
    changes residual loading); ✎ to edit a dive in place after reordering
    (entry times don't auto-adjust to a new position, so this is how you fix
    them without deleting and re-adding). Standard (GF 40/85) and
    Extra-conservative (GF 35/75) presets — recreational no-stop only,
    deliberately no looser option, persistent disclaimer.
  - *Desktop-only real UK tide times* (Admiralty UK Tidal API Discovery tier,
    via the Tauri Rust seam — native HTTP, so no CORS/key-exposure issue, and
    the free key never ships in the binary). No server-side "nearest
    station" search exists in the Discovery tier, so the ~607-station list is
    fetched once and the closest picked client-side (Haversine); covers
    today + 6 days. A location outside UK/Ireland/Channel Islands waters
    (e.g. anywhere in Southeast Asia) now skips the lookup entirely — zero
    API calls spent on a "nearest" station that's actually hundreds of km
    away and useless — with a Rust-side distance check as a backstop for
    anything that slips past that box. Per Admiralty's own FAQ, Discovery
    data may not be cached, so every lookup hits the API fresh, never reused
    from a previous fetch.
  - *Desktop layout*: two even columns. Left — calendar, location search,
    tide/moon readout, wind/sea conditions (everything about the selected
    site and day). Right — the surface-interval calculator alone, since it
    doesn't depend on the selected day or location.
- **Open-Meteo + Admiralty added to CSP** (`connect-src`) in `_headers`
  (Cloudflare Pages) and `src-tauri/tauri.conf.json` (Admiralty's native
  Rust fetch needs no CSP entry — only the Open-Meteo browser calls do).

### Changed
- **Readability: `--text-dim` was unreadable for real content, app-wide.**
  Measured at 1.9–2.2:1 contrast against the app's cream backgrounds — WCAG
  AA wants 4.5:1 for body text, 3:1 even for "large" text, so this was
  roughly half the most lenient bar. The worst offender was the **mobile
  bottom nav** (Log/Plan/History/Species/Stats labels) — the primary
  navigation on the app's primary platform. Also affected: Stats page card
  labels, dive-detail field labels, species browse-mode category tabs, the
  R/O/C abundance legend, empty-state messages app-wide, sighting dates in
  the species profile, and the IUCN "DD" badge (dimmer than its NT/LC
  siblings for no reason). ~50 selectors promoted to `--text-muted`
  (~3.3–3.8:1) where they carry real information; two safety-critical
  strings (the surface-interval disclaimer and its "exceeds NDL" explanation)
  went all the way to full `--text` (11+:1) instead — illegible safety text
  defeats its own purpose. Left alone: icon-only buttons, reference-index
  numbers, the native `::placeholder` convention, and a few now-dead CSS
  rules found along the way. `.sp-freetext-btn` (the "+ free text" link
  under species search) moved to `--accent` instead of `--text-muted` —
  it's an underlined link, and the colour system reserves accent for
  exactly that.

### Added
- **100 common UK coastal species** added to the database (now 1,110, up from
  1,010) — the first non-tropical expansion, ahead of opening the app to
  UK-based divers. Spans all 15 groups: wrasse, gobies, blennies, flatfish,
  gurnards and gadoids; small-spotted catshark, nursehound, tope, spurdog and
  basking shark; blonde/undulate/cuckoo ray and flapper skate; cuttlefish and
  octopus; crabs, lobsters and prawns; starfish, urchins and sea cucumbers;
  nudibranchs, scallops and topshells; anemones, jewel anemone and pink sea
  fan; jellyfish, sponges, fan worms, sea squirts, and harbour porpoise. Each
  carries a WoRMS-resolved (accepted-name) AphiaID and an iNaturalist photo.
- **IUCN Red List status** backfilled via `scripts/fetch-iucn.py` (IUCN API
  v4) for the new species — e.g. nursehound VU, flapper skate CR, several
  rays NT. Invertebrates mostly unassessed (blank, as expected).
- **macOS desktop app (Tauri shell, v2.5).** Wraps the same web build in a
  native window with a bundled ffmpeg: the techy browser proxy workflow
  (install ffmpeg → Terminal one-liner → folder picker) becomes a single
  "Generate proxies…" button with progress + cancel. Native folder sync (no
  browser permission dialogs) and £0 un-notarized GitHub distribution. Web
  build unchanged — differences gated behind `isShell()`.

### Fixed
- **Species album: free-text ("unknown") species are now clickable.** Their
  album thumbnail did nothing on tap — the index keys free-text entries by
  `customId`, but the thumbnail built its click target from the species name,
  so the profile lookup missed and silently returned. The thumbnail now
  carries the real index key, so free-text species open their profile (dive
  log, sites, linked videos) like any other.
- `scripts/fetch-iucn.py` was broken after the modular migration (still read
  and wrote `index.html`, which no longer holds `SPECIES_DB`). Now targets
  `data/species-db.js` and preserves an existing status rather than clobbering
  it with a blank on a partial run.
- **Species album profile: free-text species no longer show a duplicate name
  as a fake scientific name.** When a species is logged by typing rather than
  picking from the database, the profile modal now hides the scientific-name
  row (which was just an echo of the common name) and correctly shows the "?"
  unvalidated marker instead.
- **Desktop ffmpeg rebuilt LGPL from source — portable *and* GPL-free.** The
  shipped sidecar had been the Homebrew ffmpeg: dynamically linked to
  `/opt/homebrew` dylibs (crashes on Macs without them) *and* GPL (libx264/x265),
  which blocks the Mac App Store and carries source-offer duties. Replaced with
  `build-ffmpeg.sh`, which compiles ffmpeg 8.1.1 from pinned, checksum-verified
  official source with `--disable-gpl` and Apple **VideoToolbox** for H.264. The
  result is a static single-file binary linking only system frameworks — no GPL
  anywhere (**App-Store-eligible, no source offer**), no Homebrew needed on
  target Macs. The old dylib-bundling + `bundle.macOS.frameworks` were removed.
  Verified LGPL config + a real `h264_videotoolbox`/aac 1080p transcode.
- **Proxy progress is now monitorable + cancellable from anywhere.** The
  progress UI was inside the footage modal, so closing it left a large batch
  running with no indicator and no way to stop it — and the bar never moved
  (its fill width was never set). Replaced with a persistent floating widget
  (current file, an *accurate* overall bar, and a cancel button) that survives
  closing the modal. The Rust side now emits a real per-file fraction (parsed
  from ffmpeg's duration), so the bar reflects true progress, not just file
  count. (Dropped the per-file elapsed timer — it reset each file and added no
  value beyond the bar.)
- **Built desktop `.dmg` was completely unresponsive (dev worked fine).** Tauri
  injects a CSP nonce into the bundled HTML, and per the CSP spec a nonce
  disables `'unsafe-inline'` — which silently blocked every inline `onclick`
  handler and the inline boot script, so the packaged app rendered but nothing
  was clickable. Set `dangerousDisableAssetCspModification: ["script-src",
  "style-src"]` so the app's `'unsafe-inline'` (which its ~130 inline handlers
  require) stays effective in the packaged build.
- **Videos can be deleted from a dive in the footage Tag view.** The per-video
  ✕ existed but only in an unused card template, never in the Tag video list —
  now each row has it. Empty videos delete instantly; ones with tagged clips
  prompt first (the sightings survive, their links to that video clear).
- **Free-text species can be tagged in the footage modal.** The Tag-mode
  species picker had no free-text path (only the separate add-sighting form
  did) — added a "+ Free text" button beside the tag search that selects the
  typed name (with a stable `customId`) for tagging.
- **Proxy row no longer squished unreadable.** In the 210px video column the
  connect/status button and "Generate proxies…" sat side-by-side, and the
  long nowrap label crushed the status button to nothing. They now stack
  vertically, each full-width and legible.
- **Desktop remembers proxy folders across restarts — and now *multiple* of
  them.** Two bugs: (1) the saved path was read at module-load gated on
  `isShell()`, so if `window.__TAURI__` wasn't injected yet the path was dropped
  and proxies looked unlinked every launch — now reads `localStorage` directly
  with a lazy re-read on restore; (2) the shell only stored **one** proxy folder,
  but the generator creates a `proxies/` folder per trip, so connecting one
  trip's folder forgot the previous (only "one always connected"). The shell now
  keeps an **array** of proxy folders (`divelog-shell-proxy-paths`, migrating the
  old single-path key), scans them all into the proxy map, and "Connect" *adds* a
  folder rather than replacing — so every trip's proxies stay linked. Also fixed
  a cached-state branch that reported "none" instead of "stored".
- **Footage sidecars now load in the desktop shell's folder-sync mode.** Folder
  mode *wrote* and *deleted* `.footage.json` via the Tauri fs commands, but
  `loadAllSidecars` still *read* them through the browser File System Access API
  — which doesn't exist in the webview, so synced footage never appeared (only
  Obsidian sync worked). The read now uses the `read_text_file` command in the
  shell, matching the write/delete paths.

### Security
- **Desktop shell capability tightened.** Removed `shell:allow-spawn` /
  `shell:allow-kill` from the Tauri capability — the frontend only calls custom
  Rust commands (`run_transcode`, …), and the ffmpeg argument shape is
  hard-locked in Rust, so the webview can't spawn arbitrary processes.

---

## [2.395] – 2026-06-12

### Added
- **Export-all fallback for browsers without folder access.** "Export all" now
  works on Brave/Safari/Firefox: when the File System Access API is missing,
  everything downloads as a single `dive-log-export-<date>.zip` (one save
  dialog) built by a small dependency-free zip writer, instead of erroring
  out.
- **Export includes footage sidecars.** Both export paths (folder and zip)
  now write each dive's `*.footage.json` beside its `.md`, minting a `uid`
  where a footage dive lacked one so the pair stays joined.
- **Rename trip (Phase D).** ✎ button on every trip-timeline header — renames
  the `trip` field across all dives in that group (also names region/country
  proxy groups as a trip), saves locally, and re-pushes the affected `.md`
  files to the active backend (Obsidian or folder). ✓/✕ buttons beside the
  input to accept or cancel; Enter commits; Escape or clicking away cancels.

### Changed
- CLAUDE.md data model brought current: `uid` (stable join identifier),
  `customId`, the footage sidecar, and the v2.39x security baseline.
- ROADMAP refreshed: shipped items cleared from the build sequence
  (rename-trip and export-fallback sections removed), Tauri section now
  points at the new **v2.5 desktop-shell brief**
  (`v2.5-BRIEF-desktop-tauri.md` — phases 2.51–2.55 + 2.6, WKWebView
  validation gate first).

### Fixed
- **Bulk Obsidian pushes no longer re-render the history panel per dive.**
  Every successful push triggered a full timeline rebuild (including
  re-initialising the visible trip map) to clear that dive's Pending dot —
  renaming a trip or the sync-time re-push wave multiplied this by the
  number of dives, making pushes feel crawling-slow. The re-render is now
  debounced: a burst of pushes paints once, after the last one lands.

---

## [2.394] – 2026-06-12

### Fixed
- **The 2.393 deploy was missing every new file** — `js/video.js` (untracked since 2.38 despite the 2.39 commit claiming to fix it), `_headers`, `vendor/leaflet/`, `make-proxies.command`. On the live site this killed the map (Leaflet 404 → HTML refused under Pages' default `nosniff`), the footage buttons (`_proxyRowHtml`/video.js undefined), and produced a false "Obsidian not reachable" banner (`loadAllSidecars` — also in video.js — threw at the end of an otherwise successful sync). Root cause: `git commit -a`/GUI staging covers modified files but never new ones. All files now explicitly tracked.
- **Service worker hardened against cache poisoning behind Cloudflare Access.** With Access enabled, an expired session turns any fetch into a redirect to the HTML login page; the old SW cached such responses blindly (both `cache.addAll` and the background index.html revalidate), which would poison the shell. Responses are now only cached when `200`, un-redirected, and same-origin — a failed shell fetch fails the install, leaving the previous worker in control. The SW also no longer intercepts cross-origin requests at all (tiles/photos/APIs go straight to the browser under the page's CSP, not the worker's).
- **Manifest behind Cloudflare Access** — `<link rel="manifest">` now uses `crossorigin="use-credentials"` so the manifest fetch carries the Access session cookie instead of dying on a CORS-blocked login redirect.

---

## [2.393] – 2026-06-12

### Fixed
- **Sidecar 404 console noise.** On every Obsidian sync, the footage layer blind-fetched a `.footage.json` for each dive — browsers log an unsuppressable console error per missing sidecar, burying real errors. `loadAllSidecars` now lists the vault folder once (same convention as `syncFromObsidian`) and fetches only sidecars that actually exist, falling back to per-dive probing if the listing fails. Folder-sync mode was already silent (FS handles, no network).

### Security
- **Leaflet vendored into the repo (2.393).** The map library now ships from `vendor/leaflet/` instead of loading from unpkg at runtime — eliminating the app's only third-party code dependency (supply-chain surface). Files cross-verified byte-identical between unpkg and jsDelivr at vendoring. CSP `script-src`/`style-src` tightened to `'self'` + inline only; SW shell caches the vendored files, so the map *library* now also works offline (tiles still need network).
- **Security headers + Content-Security-Policy (2.392).** New `_headers` file for Cloudflare Pages: `nosniff`, `X-Frame-Options: DENY`/`frame-ancestors 'none'`, referrer policy, locked-down Permissions-Policy (geolocation self-only for the GPS button), and a CSP allowlisting exactly the origins the app uses (iNaturalist photos, OSM tiles, Nominatim/Overpass/Dive Vibe APIs, Obsidian loopback, `blob:` for the local video player). `script-src` honestly carries `'unsafe-inline'` — the classic-scripts/inline-handler architecture requires it, so escaping (2.391) is the primary XSS defence and the CSP's value is the connect/img allowlists that cap exfiltration targets.
- **XSS hardening pass (2.391).** All user, imported, and external-API strings are now HTML-escaped at render time via a single `esc()` helper (text + attribute contexts, null-safe): dive fields, notes, free-text species names, clip notes/timestamps, video filenames, autocomplete values, stats labels, edit-modal `value=` attributes, and the Dive Vibe / Nominatim / Overpass site-search results. Replaced ~25 inconsistent ad-hoc escape chains in footage.js (several had attribute-injection holes via unescaped quotes in `title=`/`onclick=` attributes). `frontmatterToDive` now coerces imported "numeric" fields (depth, times, pressures, weight, dive #) to numbers and format-validates date/HH:MM/`uid` at the parse boundary — a shared `.md` file can no longer smuggle HTML through fields every render site trusts. Dive-type values are letters-only sanitised where they feed `class`/`style` contexts. Markdown/YAML *file output* (`generateMD`) is deliberately untouched — escaping there would corrupt dive files.

---

## [2.39] – 2026-06-11

### Added
- **Dark mode for the footage modal ("Harbour Night").** The Tag/Watch player now renders on a deepened sidebar-teal canvas — cream text on dark, IUCN chips and semantic colours lifted for dark backgrounds, video stage unchanged (it was already dark, the chrome now meets it). Built as a **theme class architecture**: `.theme-harbour` is a token-override class on the modal root; future themes (e.g. Open Water) are sibling `.theme-*` classes. Palette locked in `mockups/mockup-dark-mode.html`; theme rules recorded in `CLAUDE colour UI.md`. (App-wide dark mode shipped 2026-08-06 on `<html>`, not `<body>` as this entry originally said — see the entry below.)

### Changed
- **Accent token split.** `--accent` is now the interactive *ink* (text/strokes/tints — themes may lift it); new `--accent-fill` is the solid button fill with white text, constant across themes so primary actions look identical everywhere. Both `#4A90B8` in light mode — zero visual change. Ten fill sites re-pointed app-wide.

### Fixed
- **2.38 shipped without `js/video.js` and `make-proxies.command`** (both were untracked). The deployed site 404'd the sidecar/player layer (`index.html` loads `js/video.js`) and the SW install failed (`cache.addAll` rejects on a 404'd SHELL entry); the proxy-script curl also 404'd. Both files are now committed.
- **Theme subtree colour inheritance.** Elements with no explicit `color` inherited `body`'s *computed* light ink, bypassing the theme's token overrides (the "Footage" title was dark-on-dark). Theme classes now declare `color: var(--text)` on the root — recorded as a theme rule in the colour doc.

---

## [2.38] – 2026-06-10

### Added
- **Desktop footage player modal** (≥900 px). Full-screen 3-column layout: video list · HTML5 player with scrubber + transport · Tag ⇄ Watch right column. Scrubber markers are IUCN-coloured per tagged sighting; markers, ⏮⏭ chapter-skip and ▶ jump pills all seek the player.
- **Tag mode.** "＋ Tag here" transforms the right column into the species photo-grid picker with bottom-clustered search + note + R/O/C; Save writes a clip at the current timestamp. Picking a species is confirmed with a ✓ badge on the cell, a status line in the form, and the Save button arming. Already-logged pills quick-link an existing sighting; tagged moments are editable inline (note + abundance).
- **Watch mode.** Animal-first list — each species expands to its clips across every video of the dive; tapping a clip loads that video and seeks. The video list is hidden in Watch (player gets the width). The ▶ glyph on a sighting (dive file) is now functional and opens Watch cued to that animal's first clip; 🎬 opens Tag mode.
- **Local proxy workflow.** "📋 script" copies a Terminal one-liner (`curl … make-proxies.command | bash`) that re-encodes the current folder to 1080p proxies in `./proxies/` — timeline untouched, so timestamps stay frame-valid on masters. Piping avoids macOS Gatekeeper entirely (a downloaded `.command` arrives quarantined and exec-stripped). "🎞 Connect proxies…" grants the proxies folder (File System Access, Chrome/Edge); files match videos by name stem and playback runs off the proxies. Folder handle persists across sessions (one-click re-grant).
- **Keyboard transport in the footage player.** Space = play/pause, ←/→ = ±5 s. Inert while typing in the search/note fields.
- **Full inline editing of tagged moments** (Tag mode). The ✎ edit form now covers the timestamp (mm:ss, empty clears it), a "Change animal…" search that moves the clip to another species (the original sighting stays on the dive), and a 🗑 delete for the tag itself — alongside the existing note + R/O/C. IUCN badges dropped from the moment rows to make space.
- **Stable dive `uid`** in frontmatter + **custom-species registry** (`customId`) — references that survive renames and free-text edits.

### Changed
- **Video data moved out of dive `.md` files** into a per-dive JSON sidecar (`*.footage.json`, joined on `uid`). The nested-YAML clip parser is frozen as read-fallback; clips write forward as `sources[]` (proxy + original roles) behind a single `resolveVideoUrl` seam. Dive MDs keep only the species list.
- **Footage modal is desktop-only** — entry points hidden below 900 px (mobile video deferred to the cloud phase).

### Fixed
- **Footage data loss on the sidecar migration seam.** A footage edit could rewrite the dive MD (which strips clips since the sidecar split) while the sidecar write silently failed or never ran — destroying the only copy of legacy footage on the next reload. Sidecar writes are now verified (`res.ok`), the MD is never rewritten when its sidecar write fails, the offline re-push path writes the sidecar before the MD, sidecar merge no longer wipes MD-parsed clips for species the sidecar hasn't recorded, and a read-repair pass on every sync rebuilds missing sidecars from MD-embedded clips before any rewrite can touch them.
- **Folder-sync mode had no footage sidecar at all** — tagging in folder mode stripped clips from the `.md` on every write with nothing persisted beside localStorage, and "Sync from folder" then wiped local clips *and* the videos list during the import merge (the MD no longer carries them). The sidecar layer is now dual-backend: folder mode writes/reads/deletes `*.footage.json` next to the dive `.md` via the granted folder handle, with the same verified sidecar-first ordering, import-merge preservation of local footage, and read-repair pass as Obsidian mode.
- **Deleting a dive in folder mode left its `.md` in the folder** — only the local cache was cleared, so the next "Sync from folder" re-imported the deleted dive. The file (and its footage sidecar) is now removed from the synced folder too.

---

## [2.23] – 2026-06-08

### Added
- **Mobile dive file hero map.** GPS-tagged dives now show a live Leaflet map as the full-width hero background (200 px, non-interactive by default). Tap anywhere on the map to expand it full-screen; ✕ button collapses it. Dives without coordinates fall back to the plain surface colour — no empty box.

### Changed
- **Nav icons.** Sidebar and mobile bottom nav icons replaced with emoji: ＋ Log, 📋 History, 🐠 Species, 📊 Stats. Data icon unchanged.
- **Species album thumbnails.** iNaturalist photo tier bumped from `square` (75 px) to `small` (240 px) — thumbnails are now sharp at 152 px display size on retina screens.
- **Mobile dive file meta simplified.** Day-of-week dropped from the date ("Sun 10 May" → "10 May"); country dropped from the meta line (region only). Both were causing the line to wrap on narrow screens.
- **GPS pin removed from dive file header.** The 📍 on the site name was redundant once the hero map landed. Pin is preserved on history timeline cards where there is no map.

### Fixed
- **Leaflet map bleeding over modals.** Map tiles and controls were rendering above the Edit and Footage modals on all three Leaflet containers (`#map-leaflet`, `.df-map-container`, `.tl-trip-map`). Fixed with `isolation: isolate` on each container, which traps Leaflet's internal z-indices inside the map's stacking context.

---

## [2.22] – 2026-06-07

### Added
- **History + Dive file redesign (v2.2).** The History view is rebuilt around navigation. Timeline rows become **Direction-D cards**: a coloured spine carrying the dive type as a vertical word, an identity column (site / date / dive #), measurements in an aligned 3-row grid (depth · time · vis, with vis muted by colour), and a marine row showing the **rarest species seen** (by IUCN status) as a thumbnail + count, plus a quick-edit ✎. On screens ≥900px the card unfolds into a horizontal, table-aligned strip with the species name and a 🎬 · ✎ · 🗑 action cluster.
- **Dive file — full-view navigation.** Opening a dive now replaces the timeline with a full view (back affordance restores scroll position) instead of an inline expand. Mobile: segmented **Marine / Overview / Notes** tabs (opening on Marine), a pinned 3-up stat band, and a bottom-anchored app bar (back / 🎬 / ✎ / ⋯) within thumb reach — the whole trip title is tappable as the back button. Desktop: the tabs dissolve into two columns (marine + notes left, map + data cards right) with a 5-up stat band that adds avg depth and SAC.
- **Location map on the dive file.** A single-marker Leaflet map (Overview tab on mobile, right column on desktop), hidden when the dive has no GPS or when offline, torn down on close.
- **Ambient trip maps.** Each trip/country group with ≥1 GPS dive shows a non-interactive Leaflet banner under its header, lazy-initialised via IntersectionObserver as the header scrolls into view, hidden offline.
- **`rarestSighting(dive)`** helper — the standout sighting per dive by IUCN rank (CR→EN→VU→NT→LC→DD), tie-broken by common name.
- **Collapsible log form.** The new-dive form is now organised into 6 exclusive-accordion sections (Dive, Conditions, Dive profile, Gas & equipment, Marine life, Notes & sign-off). One section open at a time; tapping the open section closes it (all-collapsed possible for pre-save summary scan). Each section shows a 3-state summary chip when collapsed: dim "Expand" (empty), muted partial data, green ✓ (complete). Marine section always shows a sighting count.
- **Edit modal redesigned** as the same 6 collapsible sections, matching the log form layout exactly, with all fields pre-filled from the dive. Opens with Marine Life expanded and everything else collapsed — the most common edit target is one tap away.
- **Safety stop + deco stop fields** added to the Dive profile section. Safety pre-fills at 5 m / 3 min (editable). Deco is optional and typographically distinguished (italic + dim) without using the alert colour. Both fields saved in localStorage and written to YAML frontmatter (`safety_stop_depth`, `safety_stop_time`, `deco_stop_depth`, `deco_stop_time`).
- **Site search affordance.** Site name field gets a magnifier icon and a "Search Dive Vibe / OSM…" placeholder to surface the dual-source search to first-time users.
- **Auto-derived field annotations.** Dive # shows "auto" label (hides when manually edited). Exit time shows "auto". Dive type shows "auto from Dive Vibe" only when Dive Vibe filled it (hidden when user manually picks or clears).
- **Post-save reset.** After saving, the form auto-increments dive #, restores "auto" annotation, carries forward date/trip/region/country (consecutive dive logging), clears profile/pressures/notes/GPS/site/marine, and reopens the Dive section.
- **Mobile save bar micro-states.** "Saving…" (dimmed) and "✓ Saved" (green, 1.5 s) micro-states on the save button before reverting to "Save dive".

### Changed
- **Glyph semantics split (🎬 vs ▶).** 🎬 is now the "manage footage" action (opens the Footage modal) everywhere; ▶ is reserved as the passive "videos linked" indicator (the `▶ N` count on cards and the ▶ mark on species rows). Footage trigger buttons that previously read "Footage" now show 🎬.
- **Sign-off moved** into the dive file's Overview tab (after Gas & equipment), so the Notes tab only appears when there is actual notes text — balances the desktop right column.
- **Trip field moved** from Notes & sign-off → Dive section (natural question order: "what trip is this from?" asked alongside date/dive#).
- **IUCN / ROC legend** collapsed behind a "? key" toggle button in the Marine section header (was always-visible block). Saves ~4 mobile screen-heights on the most used panel.
- **Log form section titles** simplified: "Start (bar)" / "End (bar)" instead of full label; "Time (min)" / "Max depth (m)" / "Avg depth (m)" in a 3-column row.
- **Collapsed section empty-state label** changed from "Tap to fill" / "Tap to add" → "Expand" (applies to both log form and edit modal).
- **"Collapse all" button removed.** Redundant with the exclusive accordion — at most one section is ever open.
- **Edit modal species search** upgraded to the same photo-grid panel used by the log form (`_renderModalPanel`): 2-column photo grid, category tabs, unified browse + search. Replaces the old text-list approach.
- **Footage modal — desktop species picker (photo grid).** Replaced the
  clipped floating dropdown with a right-column transformation: when the species
  field is focused, the right column (sightings list) transforms into a 2-column
  photo grid browser with category tabs. Blur, Escape, or picking a species
  reverts the column. Avoids `overflow-y: auto` clipping issues entirely.
- **Footage modal — mobile species picker (full-screen overlay).** Tapping the
  species field on narrow screens (≤600px) opens `#footage-mob-picker`, a
  `position: fixed; inset: 0` overlay with thumb-priority layout: scrollable
  photo grid fills the top, category tabs + search bar + FOOTAGE label/context/✕
  are pinned at the bottom near the thumb.
- **Generic mobile species overlay** (`#sp-mob-overlay`). The same bottom-first
  overlay is now the default species picker for the log-dive form and edit modal
  on mobile. `showMobileSpeciesPicker(onSelect, tag, ctx)` is context-agnostic;
  includes a "+ Free text" button for species not in the database.
- **iNaturalist medium-quality photos** in the species picker. Grid cells now
  request `/medium.` (500 px) rather than `/square.` (75 px), giving sharp
  images at the displayed 200–220 px cell height.
- **IntersectionObserver infinite scroll** in the species grid. Renders 60 cells
  initially, appends the next 60 when a 1 px sentinel enters the scroll
  container's viewport — no re-render, scroll position preserved.
- **Footage modal size** increased: `max-width` 940 px → 1200 px, height
  72 vh → 76 vh, giving more room for the photo grid on wide screens.
- **Footage modal colour and typography.** Timestamps (`.vid-stamp .t`),
  sighting notes (`.vid-stamp-note`, `.sp-clip-note`), and the header context
  line (`.fm-ctx`) upgraded from `--text-dim` to `--text-muted` / `--text`.
  Sighting names and video names now use consistent weight (600). Clip
  filenames in the sightings column changed from monospace to sans-serif.

### Fixed
- **Autocomplete dropdowns clipped** by collapsible section border. Added `overflow: visible` to all log form sections containing autocomplete fields (`#cs-dive`, `#cs-equipment`, `#cs-notes`) and all edit modal sections (`#em-*`). Fixes suit, weight, tank size, liveaboard, buddy, instructor, region, and trip dropdowns.
- **Site dropdown stayed open after Dive Vibe pick.** Async race: `querySiteOSM` could complete after `pickSiteSuggestion` had already hidden the dropdown, calling `renderMerged` and re-showing it. Fixed with a `_siteReqId` counter; stale async results are discarded.
- **Mobile save bar covered Marine Life and Notes.** The fixed save bar + nav bar stack (~130 px) obscured the bottom sections of the log form. Added `padding-bottom: 140px` to `#panel-log` on mobile so both sections are fully scrollable above the bars.
- **Two-column dive file squished on desktop.** Grid tracks default to `min-width: auto`, so the species carousel's images forced the left column past its `1.45fr` share and collapsed the right column. Adding `min-width: 0` to both column wrappers restores the intended proportions.
- **Passive `▶ N` indicator looked like a button** on the desktop history card — it collided with the footage panel's `.vid` container style. Renamed to `.dh-vid-count`.

### Removed
- **Inline-expand dive detail.** The old `toggleDiveMD` inline card expand and its supporting code (`renderDiveDetail`, `renderFlatCard`, `ddTab`, `ddMarineArrow`, `ddMarineScrolled`, `buildIucnKeyHtml`, `historyGoPage`) are gone, replaced by the full-view dive file. Their dead CSS (`.dd2-*` except the `.dd2-sac-*` bands still used by `sacClass`, `.dd-*`, `.dive-card-*`, `.card-action*`) was removed too.

---

## [2.12] – 2026-05-27 — Multi-clip footage, footage modal polish, species profile redesign

### Added
- **Multi-clip footage per sighting.** Each species sighting can now hold an
  array of `clips[]` (video filename + timestamp + optional note) instead of a
  single `video`/`time` scalar. Old scalar format read transparently via
  `_sightingClips(m)` / `_sightingHasClips(m)` helpers; new format written as
  a YAML nested `clips:` list under each species entry in frontmatter.
- **Per-clip notes.** Each clip entry accepts a short `note` field (e.g.
  "large male", "pair") visible in both the footage modal and the species
  profile sightings list. Note is stored in YAML and written to the `##
  Footage` body table.
- **`## Footage` section in generated markdown.** Dual-write: YAML is the
  source of truth the app reads; the body table gives a human-readable summary
  sorted by video then timestamp. Never read back on import.
- **`parseFrontmatter` nested sub-list support.** Parser extended with
  `inSubList`/`subListKey` state to correctly read the `clips:` list nested
  inside species object-list items.
- **Footage modal — mobile tab UI.** "Videos" and "Sightings" tabs replace the
  stacked two-column layout on narrow screens. `switchFootageTab()` toggles
  which column is visible with no re-render; modal always opens on Videos tab.
- **▶ badge on species album thumbnails.** A small overlay badge appears on
  thumbnail cards when at least one video clip is linked to that species.
- **Multi-clip display in species profile sightings list.** Single clip renders
  inline; two or more clips collapse behind a toggle row with ▸/▾ indicator.

### Changed
- **Species profile modal — cinema-card hero on mobile.** Common name and
  italic scientific name now appear on a gradient overlay at the bottom of the
  hero photo. IUCN badge sits on the far right of the scientific name line.
  The strip below the photo shows "Last seen …" on the left and ▶ N on the
  right; dive count and taxonomic group are omitted (already visible on the
  album thumbnail).
- **Species profile — no dead-zone header bar.** The `×` button floats
  `position: absolute` over the top-right corner of the hero on both desktop
  and mobile, removing the blank sand-coloured strip above the photo.
- **Species profile — `▶ N` replaces "N video reference(s)"** in the desktop
  stat block, styled in accent blue to match the mobile strip.
- **Footage modal colour system.** Both columns use the sand (`--bg`)
  background; video and sighting cards use the cream (`--surface`) background
  so they read as white against the sand. Unlinked sighting cards are the
  same white as linked ones — only the dashed "＋ Link to video…" button
  signals the unlinked state.
- **Footage modal stamp-edit form** redesigned to match the add-sighting form
  layout: labelled `TIMESTAMP / ABUNDANCE / NOTE` rows with `Save` / `Cancel`
  in the standard footer. Species name shown as a header so it's clear which
  sighting is being edited.
- **Footage modal scroll position preserved** on every re-render (stamp edit,
  cancel, form open/close). Previously the left column scrolled back to the
  top whenever an inline form was toggled.

### Fixed
- **Obsidian sync dropping clips.** `syncFromObsidian` and `importDivesFromFiles`
  were overwriting the frontmatter-parsed marine array (which included clips)
  with the body-table-parsed array (which did not). Fix: save `fmMarine`
  before the overwrite; restore matched clips after.

---

## [2.1] – 2026-05-26 — Species Album + map in history

### Added
- **Species Album (`js/album.js`).** New per-species derived view over all
  logged dives. `buildSpeciesIndex(dives)` → `Map<sciName, SpeciesEntry>`
  aggregating sightings with `diveCount`, `videoCount`, `lastSeen`, and a
  most-recent-first `sightings[]` list. Groups alphabetical; within-group
  sort: IUCN rarity DESC then commonName ASC. `sw.js` CACHE v18 → v19,
  SHELL += `/js/album.js`.
- **Species panel** (`#panel-species`) with sidebar and mobile nav entries
  (between History and Stats). Empty state when no marine life logged;
  otherwise species count, search input, anchor-linked category-nav strip,
  and per-group horizontal scroll strips of thumbnail cards.
- **Species thumbnails** — iNaturalist reference photo (or group-emoji
  placeholder), common name, IUCN badge, dive count. Arrow buttons scroll
  each strip one card width.
- **Species profile modal** — medium iNat photo filling ~46% of the modal
  hero (flush, clipped by modal border-radius). Right column: common name,
  scientific name, IUCN badge, group tag, and three separate stat lines
  (dive count / video references / last seen date).
- **"Mapped sightings" map in modal** — Leaflet map of GPS-tagged sighting
  sites (deduped to 4 d.p.). Markers show dive number + site + date.
  `fitBounds` with 40 px padding; single-site uses `setView(latlng, 12)`.
  Reuses `loadLeaflet()` from `js/map.js`; `_speciesMap.remove()` on
  modal close prevents Leaflet leak. Section omitted when no GPS data.
- **"Dive log" sightings list in modal** — most-recent-first list with
  dive number, 📍 pin (when GPS present) + site name, country, date
  (day omitted), abundance badge, and passive ▶ video-ref rows.
- **Species search filter** — live filter on common or scientific name.
  Groups with zero hits hidden; their catnav pills greyed out. "No
  matches." shown when all groups filtered out. `data-common`/`data-sci`
  attrs on `.thumb` for fast lookup.
- **Map view inside History panel** — "Map" button (far right of sort
  toolbar, visually distinct from sort controls) switches History to a
  full-panel Leaflet map. A "← List" back button and GPS-dive count swap
  in; the sort toolbar, list, and subtitle hide. `destroyMap()` tears down
  the Leaflet instance on exit. Standalone `#panel-map` and its nav
  buttons (sidebar + mobile) removed.

### Fixed
- **Species modal GPS map missing for some species.** `parseFrontmatter`
  turns an empty `gps_lat:` YAML line into `[]`; `parseFloat([])` = `NaN`;
  `NaN ?? null` = `NaN` (passes `!= null` filter); `L.marker([NaN, NaN])`
  fails silently. Fixed with `_parseCoord()` helper in `album.js`
  (normalises any NaN/string/undefined → null) and in `frontmatterToDive`
  in `markdown.js` (prevents NaN from being written to localStorage).

### Changed
- **Species modal section labels** — "Where you've seen it" → "Mapped
  sightings"; "Sightings" → "Dive log".
- **Sighting row detail** — region dropped (country only); day-of-week
  dropped from date column; 📍 pin moved to between dive number and site
  name (matching history timeline convention).

---

## [2.01] – 2026-05-25 — Stats + mobile polish

### Changed
- **Dive type breakdown: donut → ranked bar list.** Replaced the SVG donut
  chart with a standard `stBar` ranked list (same pattern as species frequency
  and country charts). Bars use the same `--type-*` colour vars as the
  timeline. All donut HTML, JS, and CSS removed.
- **Stats band column order swapped.** Dive type breakdown is now the left
  column; Deepest dives moves to the right.
- **Mobile: in-form Save button hidden.** The `.btn-primary` ("Save dive &
  generate markdown →") is hidden at ≤ 600 px — the sticky save bar above
  the bottom nav is the sole save action on mobile, eliminating the redundant
  double-button.

---

## [2.0] – 2026-05-25 — Video footage system + sync bug fixes

### Changed
- **Dive card footer download button:** label changed from `↓ .md` to `↓`
  (tooltip carries `.md`), matching the hover-action button style.

### Fixed
- **Footage video links lost on page refresh — root cause.** The marine life
  body-table row regex (`/^\|[^|]+\|…\|(?:[^|]+\|)*$/mg`) used `[^|]+` in
  the optional cell-repeat group. `[^|]` matches any non-pipe character
  *including `\n`*, so the greedy `*` consumed the entire table across all
  rows as a single "row" (56 cells for a 7-row × 8-col table). The `is8col`
  check (`cells.length >= 8`) was always true, but `cells[6]` contained garbage
  spanning multiple rows rather than the video filename. Fix: changed every
  `[^|]+` in the row regex to `[^\n|]+` so cell patterns cannot cross line
  boundaries. Applied to both `syncFromObsidian` and `importDivesFromFiles`.
- **Footage video/time lost via frontmatter fallback.** When `syncFromObsidian`
  fell back to rebuilding marine sightings from `fm.species` YAML (table not
  found), the mapping function created new objects from DB lookups and silently
  dropped `video` and `time` fields present in the YAML. Fixed to copy
  `s.video`, `s.time`, and `s.abundance` through to the output object.
- **Footage video links lost on page refresh (Obsidian sync mode).** When a
  footage link was saved while Obsidian was temporarily unreachable, only
  localStorage was updated; the `.md` file remained stale. On the next page
  load `syncFromObsidian` replaced localStorage with the stale vault data,
  silently discarding the link. Two-part fix: (1) `syncFromObsidian` now
  detects dives with `_pendingSync = true` before overwriting — it keeps the
  local version for those dives and fires a re-push now that Obsidian is
  confirmed reachable; (2) all footage save functions in `footage.js` no longer
  require `obsAvailable` to be true before attempting a push — they always try
  (network failure is caught and `_pendingSync` remains set as a safety net).
- **Obsidian sync crash: `name.toLowerCase is not a function`** — both species
  fallback paths in `syncFromObsidian` and `importDivesFromFiles` assumed
  `fm.species` items are always plain strings (legacy format). With the Phase 1
  YAML object-list format (`- common: … / scientific: …`) the new
  `parseFrontmatter` correctly returns objects; calling `.toLowerCase()` on an
  object throws `TypeError`, landing in the catch block and showing "Obsidian
  not reachable". Fixed both fallbacks to detect the item type and extract
  `s.scientific`/`s.common` when the item is an object.
- **Obsidian sync: 304 Not Modified silently wipes dives.** The browser caches
  ETags from Obsidian REST API file responses and sends `If-None-Match` on
  subsequent requests; for unchanged files the API correctly returns 304, but
  `fetch` reports `ok = false` for 304, so every file silently returned `null`
  → `results = []` → `dives = []` → localStorage wiped on every sync after the
  first. Fix: `cache: 'no-store'` on individual vault-file fetches prevents the
  browser sending conditional headers, forcing a fresh 200 on every sync.
  `sw.js` CACHE bumped v12 → v13 so Phase 1 JS changes are not served from the
  stale service-worker cache.

### Added
- **Footage linked/total counts in timeline and dive card.** The timeline
  footage pill (`▶ N`) now shows the count of distinct videos that have at
  least one sighting linked, rather than total video count. The hover-action
  Footage button and the expanded dive card Footage button both show
  `Footage [linked/total]` (e.g. `Footage [2/5]`) when any sightings are
  linked, or `Footage [5]` when none are yet.
- **Fixed Obsidian connection test falsely reporting "Connected" with a
  wrong API key.** The root endpoint (`/`) requires no authentication and
  always returns 200, so `testObsConnection` was only checking that
  Obsidian was running. Now does a two-step check: (1) hit `/` for server
  reachability + version info, (2) hit `/vault/` with the Bearer token to
  verify the key is actually accepted. A 401/403 on step 2 now shows
  "Reachable but API key rejected — check your key".
- **Removed "Save a specific dive to vault" from the Data tab.** The
  select + button + status row have been removed from the Obsidian config
  section. The `saveToObsidian()` and `populateObsDiveSelect()` functions
  and their CSS are deleted. Full sync via "↻ Sync now" and the per-dive
  Footage/Edit save paths still work.
- **v2.0 — Dive card: removed Footage section.** The "Footage" block
  between Marine life and Notes (stats line + "Manage footage" button) has
  been removed — the modal is already reachable via the Footage button in
  the card footer and the timeline hover actions. Keeps the card uncluttered.
- **v2.0 — Abundance key moved flush below species list.** The R/O/C
  key has moved from being a full-width bar after the species panel to
  sitting directly inside the species list column, immediately below the
  scrollable list — aligns with the content it describes.
- **v2.0 — Footage modal: split-screen layout.** Modal widened to 940px
  max. Body is now a two-column split with independent scrolling: left
  column = video cards (filename, reviewed toggle, delete, linked sighting
  stamps with edit/unlink, "+ sighting" form, bulk import); right column =
  all dive sightings with linked ones showing a video+timestamp chip
  (read-only) and unlinked ones showing the inline Link… form. Column
  headers show live counts (e.g. "3 files · 1 unreviewed" / "5 species ·
  3 linked"). Mobile stacks to single column at ≤600px.
- **v2.0 — Footage modal UI optimisation:** Dive card footage section now
  shows only a compact stats line (N videos · M sightings linked · K
  unreviewed) + "Manage footage" button — the full video card list no
  longer renders inline in the expanded dive card. Footage modal reordered:
  "Logged sightings without video" (marine life) appears first, video cards
  below. Videos in the modal sorted alphabetically by filename. All video
  operations (toggle reviewed, add sighting, delete) switched from
  array-index to filename-keyed lookup so the alpha sort is always
  consistent with the underlying storage order.
- **v2.0 — Delete video from footage modal:** each video card in the Footage
  modal now has a small ✕ button. Clicking it removes that video record from
  the dive; any sightings that were linked to it are gracefully orphaned
  (sighting preserved, `video`/`time` fields cleared) and surface in the
  "Logged sightings without video" section. No confirmation dialog — the
  operation only removes metadata, no actual files are touched.
- **v2.0 Phase 7 — Final polish:** `vid-add` ("+ sighting from this video")
  button now properly styled — full-width dashed accent chip inside video
  cards. DECISIONS.md updated with a new "Video footage feature" section
  documenting the workspace design, metadata-only file references, `_browseCtx`
  isolation, reviewed-state independence, unlink semantics, and the
  `data-sci` pattern.
- **v2.0 Phase 6 — Footage modal: bulk import (picker + drag-and-drop):**
  "Choose videos…" button now fully functional — triggers a hidden
  `<input type="file" multiple accept="video/*">` and reads each `File`'s
  `name`, `lastModified`, and `size` only (no byte-read). Drag-and-drop
  wired to the footage modal's inner `.modal` div (`ondragover`,
  `ondragenter`, `ondragleave`, `ondrop`); dropping files anywhere over
  the modal hits the same code path as the picker. Non-video MIME types
  are filtered out; a coral hint message fades in if any were skipped.
  Deduplication by filename (silent skip). After import, `dive.videos`
  sorted by `lastModified` ascending so files list in recording order.
  Modal shows a dashed accent outline while files are dragged over it.
- **v2.0 Phase 5 — Footage modal: attach existing sightings:**
  The "Logged sightings without video" section's `Attach…` button is now
  functional. Clicking it expands an inline form (no sub-modal) showing a
  video dropdown (all videos on the dive) and an optional timestamp input.
  Save validates the timestamp, writes `video`/`time` onto the sighting,
  persists and syncs, then re-renders — the sighting moves from the unlinked
  list into the correct video card's stamp list and gains a ▶ glyph in the
  dive card. Opening any other inline form (add-sighting, stamp-edit) closes
  the attach form, and vice-versa.
- **v2.0 Phase 4 — Footage modal: add sighting from timestamp:**
  Per-video `+ sighting from this video` button expands an inline form (no
  sub-modal) with Timestamp (`mm:ss` / `h:mm:ss`), Species search (reuses
  `searchLocalSpecies` + `showBrowseMode` with an isolated
  `footage-species-dropdown` context so `_browseCtx` never collides with the
  main form or edit modal), and Abundance (R/O/C toggle, updates in-place
  without re-rendering). On Save: if a sighting with the same
  `scientificName` already exists on `marine[]`, its `video`/`time` fields
  are updated (no duplicate). Otherwise a new sighting is pushed. Timestamp
  is validated (rejects non-`mm:ss` / `h:mm:ss`; highlights field coral on
  failure). Persists to `localStorage`; pushes to Obsidian or folder if
  active. Re-renders footage body and history on save so ▶ glyphs and
  timeline pill update immediately.
- **v2.0 Phase 3 — Footage modal (open, render, reviewed toggle):**
  New `js/footage.js` (classic script, loaded after `app.js`):
  `openFootage(diveId)` / `closeFootage()` open the dedicated footage
  workspace modal. Modal header shows `FOOTAGE · #N · site · region · date`.
  Body renders a Videos section (existing `d.videos[]` as interactive cards)
  and a Logged sightings without video section (unlinked marine items).
  Reviewed-state chip on each video card is a live toggle —
  `toggleFootageReviewed()` flips `d.videos[i].reviewed`, persists to
  `localStorage`, and pushes to Obsidian when available. Re-renders the
  modal in place. Bulk-import button and "+ sighting" / "Attach…" buttons
  render as visible stubs (disabled, wired in Phases 4–6).
  Modal HTML added to `index.html`; `openFootage()` stub removed from
  `app.js`; `sw.js` SHELL += `/js/footage.js`, CACHE v13 → v14.
- **v2.0 Phase 2 — Dive card: Footage section + sighting indicators:**
  - Per-sighting ▶ glyph (`.vid-mark`, `var(--accent)`) added to carousel
    slides (`.sp-sfoot`) and scannable list rows (`.sp-rmeta`) whenever
    `m.video` is set; tooltip shows filename and timestamp.
  - Footage section rendered in `renderDiveDetail()` between Marine life and
    Notes: when `d.videos` is non-empty, shows each video as a card with
    filename, reviewed/unreviewed state chip (`.vid-state.done` / `.pending`),
    linked-sightings count, and per-sighting timestamp rows sorted by time.
    Stats line (`N videos · M sightings linked · K unreviewed`) in section
    header. "Manage footage" button wired to `openFootage()` stub.
  - When `d.videos` is empty, a `+ Add footage` empty-state button renders
    in place of the full section; calls the same `openFootage()` stub
    (no-op until Phase 3).
  - `openFootage(id)` stub added to `js/app.js` so Phase 2 clicks don't
    throw. Full implementation deferred to Phase 3 (`js/footage.js`).
- **v2.0 Phase 1 — Video footage data model:** per-dive `videos: []` array
  (file, modified, size, reviewed) added to `saveDive()`; per-sighting
  optional `video`/`time` fields. Full frontmatter roundtrip:
  `generateFrontmatter()` emits multi-object `species:` YAML (with
  video/time when set) and a `videos:` block (when non-empty);
  `parseFrontmatter()` extended to handle YAML object-lists and boolean
  values; `frontmatterToDive()` reads both back. Body table gains
  `Video` and `Timestamp` columns; both Obsidian sync table parsers
  updated to read them (8-col format, backward-compatible with 5/6-col
  legacy files). No UI change.

### Changed
- **Modular migration step 10:** extracted remaining app
  core (~1,360 lines) → `js/app.js`: app state (`dives[]`, `sightings[]`,
  `syncMode`, `_siteHistory`), `saveDive`, `generateMD`, `slugify`, `show()`,
  `updateCount`, `updateMobileNav`, edit/delete modal (`openEdit`, `saveEdit`,
  `deleteDive`, `calcExitTimeModal`, `closeModal`), modal marine life
  (`renderModalSightings`, `addModalSighting`, `onModalSpeciesInput`),
  `_origSaveDive`/`_origShow` patches, folder sync (`openFolderDB`,
  `saveFolderHandle`, `loadFolderHandle`, `getWritableFolderHandle`,
  `writeToFolder`, `downloadDiveCard`, `setDiveFolder`, `syncFromFolder`,
  `clearDiveFolder`, `updateFolderUI`), `exportAllDives`, `downloadMd`,
  site search (`buildSiteHistory`, `searchSiteHistory`, `pickHistorySite`,
  `queryDiveVibe`, `querySiteOSM`, `onSiteInput`, `captureGPS`), service
  worker registration, `acBootstrap()` call. Inline `<script>` reduced to
  27-line boot sequence — no function definitions remain. `sw.js` SHELL +=
  `/js/app.js`, CACHE v12. No behaviour change.

### Changed
- **Modular migration step 9:** extracted **history/timeline rendering**
  subsystem (631 lines) → `js/history.js`: sort state, species carousel
  (`spBuildPanel`, `spSlideHtml`, `spRowHtml`, `initSpeciesPanel`, `spJump`,
  `spStep`), `renderDiveDetail`, trip/flat/country timeline renderers,
  `renderHistory`, `toggleDiveMD`, `ddTab`, `ddMarineArrow/Scrolled`.
  `sw.js` SHELL += `/js/history.js`, CACHE v11. No behaviour change.

### Removed
- **Dead code:** `copySpecificMD()` function (never called — no UI button
  wired to it) and matching `.copy-btn` CSS removed from `js/history.js`
  and `css/styles.css`.

---

## [1.984] – 2026-05-19 — Modular migration: step 8 (extract species) + fix modal browse-select

### Changed
- **Modular migration step 8:** extracted **species search/browse/sightings**
  subsystem (375 lines) → `js/species.js`: local species search, species
  cache, browse mode (`BROWSE_GROUPS`, `_renderBrowseGroup`, `showBrowseMode`,
  `_browseSelectForm/Modal`), `selectSpecies`, `addSighting`, `removeSighting`,
  `renderSightings`, `setAbundance`, `migrateAbundance`, `iucnBadge`,
  `GROUP_EMOJI`/`SP_IUCN_MAP` lookup tables. `migrateAbundance()` boot call
  kept in inline script (needs `dives[]`). `sw.js` SHELL += `/js/species.js`,
  CACHE v10. No behaviour change.

### Fixed
- **Edit modal browse-select:** tapping the species input in the edit modal
  showed the browse grid but selecting any species did nothing. Root cause:
  the form's document click-outside listener called `hideDropdown()` which
  unconditionally cleared `_browseCtx`; the focus→click event order meant
  the modal's context was always wiped before the user could pick. Fix:
  `hideDropdown()` now only clears `_browseCtx` when it belongs to the form
  dropdown (`ddId === 'species-dropdown'`), leaving the modal context intact.

---

## [1.983] – 2026-05-19 — Modular migration: step 7 (extract stats/charts)

### Changed
- **Modular migration step 7:** extracted **stats/charts** subsystem (270
  lines, 2 non-contiguous blocks) → `js/stats.js`: `calcSAC`, `sacClass`,
  `stBar`, `renderStats`, `setActivityView`, `renderActivityChart`.
  `calcSAC`/`sacClass` also called by `renderDiveDetail` (history card).
  `sw.js` SHELL += `/js/stats.js`, CACHE v9. No behaviour change.

---

## [1.982] – 2026-05-19 — Modular migration: step 6 + sidebar fix

### Changed
- **Modular migration step 6:** extracted **Obsidian sync + device import**
  subsystem (505 lines) → `js/obsidian.js`: all Obsidian REST API functions,
  `importDivesFromFiles`, `setSidebarSync`, `setSyncBanner`, `setSyncMode`,
  and related state (`obsSettings`, `obsAvailable`, `lastSavedDiveId`).
  Boot-time `syncFromObsidian()` call stays in inline script. `sw.js` SHELL
  += `/js/obsidian.js`, CACHE v8. No behaviour change.

### Fixed
- **Sidebar sync count:** adding or deleting a dive now updates the sidebar
  status line (e.g. "27 dives in vault") in addition to the bold count.
  `updateCount()` now calls `setSidebarSync()` so both stay in sync on every
  add/delete/edit.

---

## [1.981] – 2026-05-19 — Modular migration: steps 4+5 + import fix

### Changed
- **Modular migration step 4:** extracted **Map panel (Leaflet)** subsystem
  (75 lines: `_leafletLoaded`/`_mapInstance` state, `loadLeaflet`,
  `initMap`, `renderMapMarkers`) → `js/map.js`. Fully self-contained leaf;
  `show('map')` → `initMap()` call stays in inline script. `sw.js` SHELL
  += `/js/map.js`, CACHE v6.
- **Modular migration step 5:** extracted **markdown/frontmatter transforms**
  (`parseFrontmatter`, `frontmatterToDive`, `generateFrontmatter` — ~90 lines)
  → `js/markdown.js`. Pure transforms; no globals; 7 call sites remain in
  inline script. `sw.js` SHELL += `/js/markdown.js`, CACHE v7.

### Fixed
- **Import from device:** sidebar count and sync status ("No dives yet") no
  longer stuck at zero after importing `.md` files — `updateCount()` and
  `setSidebarSync()` now called on completion, matching the Obsidian sync path.

---

## [1.98] – 2026-05-18 — Modular migration: step 3 (extract autocomplete engine)

### Changed
- **Modular migration step 3 (JS, classic-scripts approach):** decided
  against ES modules — the real code has 119 inline handlers / ~50
  functions and no test net, so a `window` shim would be high-risk and
  self-defeating. JS is being split into ordered classic `<script src>`
  files instead (functions stay global; runtime behaviour unchanged). See
  DECISIONS.md → "Modular migration".
- First JS subsystem extracted: the **autocomplete cache engine** (94
  lines) → `js/autocomplete.js`. Definitions only — the load-time
  `acBootstrap();` call stays in the inline script (it needs `dives`).
  Service worker `SHELL` += `/js/autocomplete.js`, `CACHE` bumped to v5.
  No behaviour change.

---

## [1.97] – 2026-05-18 — Modular migration: step 2 (extract CSS)

### Changed
- **Modular migration step 2:** extracted the entire `<style>` block
  (~65 KB, 1,694 lines) out of `index.html` into `css/styles.css`, linked
  via `<link rel="stylesheet">`. `index.html` is now 255 KB → 190 KB
  (cumulative −51% from the original 391 KB). Service worker `SHELL` +=
  `/css/styles.css`, `CACHE` bumped to v4 so offline still works. No
  visual or behaviour change. (See DECISIONS.md → "Modular migration".)

---

## [1.96] – 2026-05-18 — Modular migration: step 1 (extract SPECIES_DB)

### Changed
- **Modular migration step 1:** extracted the 1,010-species `SPECIES_DB`
  array (~136 KB) out of `index.html` into `data/species-db.js`, loaded as
  a classic script before the main script. `index.html` is now 391 KB →
  255 KB (−35%). Service worker `SHELL` updated + `CACHE` bumped to v3 so
  offline still works. No behaviour change. (See DECISIONS.md → "Modular
  migration".)

---

## [1.951] – 2026-05-17 — Documentation

### Changed
- **Documentation overhaul for onboarding:** `README.md` rewritten as the
  onboarding hub (how to run, how to verify without tests, an `index.html`
  code map, the worktree hazard, doc index, design/sync workflow).
- `CLAUDE.md`: added a "reality check" callout — the app is one
  `index.html` (~5,760 lines); the modular folder structure is aspirational;
  PWA extraction (`sw.js`/`manifest.json`) is done; colour authority is
  `CLAUDE colour UI.md`.
- `ROADMAP.md` reconciled against reality: top-level **Status** section;
  Map View / GPS / R-O-C abundance marked **shipped**; Phase C "superseded"
  note (carousel replaced the paginated grid).

### Added
- `CHANGELOG.md` (this file), seeded from `1.7`–`1.95` git history.

---

## [1.95] – 2026-05-17 — Stats redesign + Pending-state indicators

### Added
- **Pending state** (`--pending` coral, "needs attention, not an error"):
  unvalidated-species badges (`.badge-free`) + carousel markers; per-dive
  `_pendingSync` flag (set on save/edit, cleared on successful Obsidian
  push) shown as a timeline dot, gated to Obsidian sync mode only.
- Stats: dive-type **donut + ranked legend** (SVG, no library; 2-col legend
  past 6 types); SAC threshold legend.

### Changed
- **Stats page rebuilt to the design system:** 860 px reading-width cap;
  one section pattern (mono label + hairline); hero stat-card number/unit
  hierarchy; **Deepest dives → dot-leader list** (replaces a meaningless
  0-based bar); neutral bars (colour only where it means something);
  top-species cards; activity zero-fills gap years.
- Successful Obsidian push reactively clears the Pending dot when History
  is on screen.

### Removed
- Dead bar-chart CSS (`.chart-bar-wrap`, `.chart-title`, `.bar-*`,
  `.bar-val-sub`, `.mono-dim-note`) and a write-only `activityView`.

---

## [1.94] – 2026-05-17 — Species search fix

### Fixed
- Mobile: tapping species **category tabs** no longer re-triggers the
  on-screen keyboard (which covered the menu). Browse/commit paths blur the
  input; typing-to-search is preserved. Applied to the form *and* edit modal.

---

## [1.95 / 1.953] – 2026-05-17 — Colour system v2

### Changed
- New **three-class colour system** (neutral / reserved-semantic /
  categorical) — supersedes the strict 9-colour spec. `CLAUDE colour UI.md`
  is the source of truth.
- Unified dive-type `--type-*` ramp consumed by **both** timeline and stats
  (ends four divergent palettes).
- SAC bands recoloured success / neutral / danger; **Danger = rust**
  (`--danger`), applied to delete + error states; new `--success` green;
  **Coral freed → reserved for Pending**.
- `.dd2-sac-warn` renamed `.dd2-sac-mid` (honest name — the mid band is
  neutral, not a warning).

---

## [1.94] – 2026-05-16 — Stricter SAC

### Changed
- `calcSAC()` now requires start/end pressure, bottom time, avg depth **and
  logged tank size** — no assumed 12 L. The SAC-by-type chart shares
  `calcSAC()`, so chart and dive card always agree.

### Fixed
- **Region field no longer dropped on sync.** `frontmatterToDive()` never
  read `fm.region`, so every Obsidian/`.md` sync silently lost the region.
  Data in the `.md` files was intact; only the read path was broken.

---

## [1.93] – 2026-05-16 — Wildlife view + history redesign (Phases A–C)

### Added
- `trip` field; **trip-grouped sticky timeline** (all sorts as timelines,
  no pagination); expanded **no-tabs dive card**; species **album carousel
  + taxon-grouped scannable list** (superseded the original paginated grid).

### Changed
- History/timeline visual hierarchy locked; type-scale (12/14/16) enforced;
  abundance-key formatting; card-open scroll-to-top.

---

## Earlier — 1.7 to 1.92 (2026-05-15 → 05-16)

Condensed from commit subjects (not reconstructed in detail):

- **1.91, 1.92** (05-16) — iterative fixes following the 1.8 overhaul.
- **1.8** (05-16) — visual overhaul to history and logs.
- **1.7 – 1.795** (05-15) — Marine life ID feature and iterative refinement.

Older history predates this changelog; see `git log` for the full record.
