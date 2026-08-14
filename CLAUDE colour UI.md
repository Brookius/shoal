# Dive Log — Colour & UI System (v2)

**This is the source of truth for colour.** It supersedes the original strict
9-colour spec, which was over-constrained (it reserved neutrals that have no
meaning) and whose data-model section was stale. Data model and feature specs
live in `CLAUDE.md` and `DECISIONS.md` — not here. This file is colour only.

Swatch / living reference: `mockups/mockup-palette.html`.

---

## The three-class model (the core rule)

Every colour belongs to **exactly one** class. Decide the class first; the
usage rules follow from it.

1. **Neutral / structural** — *no meaning.* The paper-and-ink substrate.
   **Freely reusable** anywhere it reads well. Reusing a neutral is never
   "introducing a colour".
2. **Reserved semantic** — *one colour, one meaning, never reused* for
   anything else. These communicate.
3. **Categorical** — the dive-type ramp. A coordinated family whose only
   "meaning" is *which member*. Never used outside dive-type encoding.

The original doc's mistake was treating every colour as class 2. Neutrals are
class 1 and reusable; the dive-type ramp is class 3 and self-contained.

---

## 1 · Neutral / structural — freely reusable

| Name | Hex | Typical use (not exclusive) |
|---|---|---|
| Driftwood | `#F5EBD8` | App background, every panel |
| Warm White | `#FAF6F1` | Cards, inputs, stat boxes |
| Surface 2 | `#EDE5D8` | Tracks, recessed fills |
| Deep Water | `#1C3030` | Sidebar, **all body text**, primary button fills |
| Warm Taupe | `#726557` | Secondary/meta text · **SAC-moderate band** |
| Text Dim | `#B5A898` | Tertiary text, disabled, dot-leaders |
| Border | `rgba(28,48,48,0.10)` | Hairlines |
| Border-mid | `rgba(28,48,48,0.18)` | Stronger dividers |

Neutrals carry no signal, so reuse is expected (e.g. Warm Taupe is both meta
text *and* the SAC "moderate" band — that is correct, not a violation).

**Warm Taupe, tinted: `--taupe-dim` `rgba(114,101,87,0.08)` / `--taupe-border`
`rgba(114,101,87,0.25)`.** Same recipe as `--accent-dim`/`--accent-border`
(a low-opacity tint + a slightly stronger border, both derived from one base
colour) but on the neutral instead of the reserved interactive one — for
persistent banner containers that aren't reporting an outcome (success/
error/warning) and aren't themselves interactive: `.sync-banner.neutral`
(dive computer import/sync, edit-mode notice) and the Country pre-filter
banners (`.sp-region-banner-mount`, `.fmp-topbar-region-mount`). These used
to be accent-tinted (`.sync-banner.accent`) — found live, 2026-07: a banner
whose own fill/border isn't clickable has no business on the reserved
interactive colour, the same drift the cerulean-as-text audit already fixed
for headings and badges below. Any *actually* interactive text inside one of
these banners (a "Show all" link, etc.) stays `--accent` — only the passive
container moved off it.

**Warm Taupe darkened from `#8B7B6A` (contrast audit, 2026-07).** The original
computed to ~3.46:1 on Driftwood/Warm White — under WCAG AA even for large
text — despite being the default colour for genuinely load-bearing content
(field labels, unit captions, instructional hints, section summaries), not
just decorative meta text. `#726557` clears ~4.78:1. Text Dim stays as-is:
it's reserved for content that's *supposed* to recede (dot-leaders, tertiary
marks), and several log-form uses that had drifted onto it despite being
genuinely instructional (dial end-labels, map/site search hints) were moved
to Warm Taupe instead rather than fixed by darkening Text Dim itself — the
bug was two tokens' *uses* blurring together, not just one token's value.

---

## 2 · Reserved semantic — one colour, one meaning

| Name | Token | Hex | The one meaning |
|---|---|---|---|
| Dusty Cerulean | `--accent` | `#4A90B8` | **Interactive INK** — links, active nav, focus rings, verified badge, save outline. *Themes may lift this for contrast.* |
| Cerulean Fill | `--accent-fill` | `#4A90B8` | **Solid button/control fill with white text** (play, Tag here, Save, active R/O/C…). **Constant across all themes** — primary actions look identical everywhere. Same hex as `--accent` in light mode by design. |
| Bioluminescence | `--gold` | `#D4A843` | **Earned / achievement** — the future ★ First-sighted badge. Nothing else. |
| Success | `--success` | `#4F9D6B` | **Scale-good** — the "good" end of a measured range (e.g. SAC-good) |
| Soft Violet | `--violet-soft` | `#9B7EC8` | **IUCN EN** species name (the lesser-rare tier) |
| Deep Violet | `--violet-deep` | `#6A4A9A` | **IUCN CR** species name (rare / unexpected) |
| Danger | `--danger` | `#B0492E` | **Destructive** — delete, irreversible/hazard actions |
| Warn | `--warn` | `#9C5621` | **Needs attention, not an error** — see below |

`--success-dim`: `rgba(79,157,107,0.12)` · `--accent-dim`: `rgba(74,144,184,0.10)`
· `--accent-border`: `rgba(74,144,184,0.30)`.

**Danger vs Warn — a deliberate two-state pair.**
Rust `--danger` = *destructive / stop* (delete). Coral `--warn` = *worth
noticing now, no harm done yet* — an NDL gradient nearing its limit, a
disconnected sync, an unvalidated species. Never conflate them: a thing that
merely needs attention is **never** rust; a destructive action is **never**
coral.

**Strict rules**
- A reserved colour is **never** used outside its one meaning.
- Gold is **only** the achievement badge. Not SAC, not charts, not accents.
- Violet is **only** IUCN EN/CR species names.
- Cerulean handles **all** routine interactive state.
- VU/NT/LC IUCN tiers stay plain Deep Water text (only CR/EN get violet) —
  too many dived species are VU; colouring them dilutes the signal.

**Cerulean-as-text audit (2026-07).** A full pull of every `color:
var(--accent)` text use (76 sites, verified with a word-boundary-safe
pattern after an earlier pass undercounted at 53 by accidentally excluding
any line that also set `background`/`border` — which is exactly the shape
`.sp-ab` and its siblings below used) found the token had drifted into three
different jobs, not one: genuinely interactive text (nav active state, hover
links, toggles — on-charter), section/card headings with no interactive
behaviour at all (`.cs.open .cs-title`, `.df-card-h`, `.gsec-h`, `.st-tsc
.cc`, and more, each confirmed non-clickable against its actual HTML), and
small metadata/tags/status badges coloured for visual pop rather than any
interactive or semantic reason. Resolved so far:
- **Headings (16 sites)** moved to `--text` (Deep Water) — a neutral reuse,
  not a new token. Fixes contrast outright (~2.98:1 as accent → ~12.9:1 as
  text) and reads more "journal heading, ink on paper" than "clickable blue
  label," closer to the brand voice than the original.
- **Per-sighting abundance badges** (`.sp-ab`, `.sp-card-ab`, `.vid-stamp-ab`,
  `.sp-sighting-row .ab`) moved to the same neutral-info-badge treatment the
  IUCN LC/NT/DD tiers already use (`--text-muted` on a taupe-tinted
  background) — these are read-only recorded values (what abundance was
  logged for a sighting), not controls; only the R/O/C *picker* (`.roc-btn`,
  genuinely tappable) stays accent. Caught via a user screenshot after the
  first sweep's `background`/`border` exclusion bug hid them.
- **`.lf-loc-title`** eliminated outright (confirmed single-use) in favour of
  the log form's standard `.lf-lbl` heading class — a distinct class existed
  for no reason found.
- **`.badge-cache`** (a "cached" WoRMS-validation status, sitting next to the
  green `.badge-worms` "Validated" badge but deliberately given different
  copy) moved to the same neutral treatment — it isn't a good/bad signal,
  and matching `.badge-worms`' green would have erased a distinction the
  code already draws on purpose.
- **`.sp-tl-clears`** (the "· re-entry 14:32" annotation in the planner's
  surface-interval output) and **`.ul-band-lbl`** ("Tap to link at current
  time," a footage-tagging instructional hint) moved to `--text-muted` —
  the same reclassification the log-form hints (`.lf-coord-hint` etc.,
  above) already went through.

**The interactive bucket's own contrast fix landed 2026-08-04 — `--accent-text`
(new token, `:root`, next to the rest of the `--accent` family).** Same
hue/saturation as `--accent` (202°/44%), lightness taken from 51% to 40% —
the minimum reduction clearing 4.5:1 (measured: 4.50:1 on `--surface-base`,
4.95:1 on `--surface`, cross-checked against this doc's own already-recorded
3.27:1 baseline before touching anything, not re-derived from scratch and
hoped to match). A separate token rather than darkening `--accent` in place,
because `--accent` also does fill/stroke work with no contrast obligation of
its own (`.dD-select-box.checked`'s solid background, every `-border`/`-dim`
tint) that shouldn't darken along with the text — same reasoning
`--accent-fill` already established, and the same shape as `--accent-on-dark`
(a purpose-specific lift for a different rendering context, not a
replacement). Applied to 63 sites — every genuinely-interactive one found in
a full, word-boundary-safe re-sweep of `color: var(--accent)` (73 total
sites; a naive `color:` grep would have double-counted `border-color`/
`text-decoration-color` uses, the exact undercounting-shaped bug this doc's
own earlier audit pass already warns about, just inverted). **Not yet given
a dark-theme value** — `.theme-harbour` doesn't redeclare it, so it currently
inherits the light value by cascade inside the footage modal; left for the
app-wide dark-mode pass to set properly rather than guessed here.

**Deliberately still deferred, exactly as before — the boundary wasn't
expanded, just the interactive bucket resolved within it:** the video/footage
metadata cluster (`.vid-mark`, `.fm-tag`, `.fm-vid-chip`, `.dh-vid-count`,
`.dD-vid`, `.sp-stat-vid`, `.sp-mob-vids` — video timestamps, tags, and
counts across `js/footage.js` and the timeline/species-profile video
indicators) — left as bare `--accent` for now, revisit together as one pass
rather than piecemeal, per this doc's own standing note. Also still open:
the mobile-picker context tags (`.fmp-footer-tag`, `.fmp-topbar-tag`) and
bold lead-in emphasis (`.lf-uddf-text strong`, `#edit-banner strong`). All
ten sites are unambiguous swap candidates once picked up — `--accent-text`
already exists and passes; this is a naming/consistency pass, not another
contrast decision.

---

## 3 · Categorical — dive-type ramp

Ten muted, field-guide-register hues. **One source of truth:** the
`--type-<Type>` CSS variables in `:root`, consumed by **both** the timeline
(`.tl-type-*`) **and** the stats donut/bars. (History: this previously existed
in four contradictory copies — never reintroduce a second definition.)

| Type | Token | Hex | Mnemonic |
|---|---|---|---|
| Boat | `--type-Boat` | `#2F7E8C` | deep teal — open blue water |
| Shore | `--type-Shore` | `#B0894F` | sand / beach entry |
| Drift | `--type-Drift` | `#3FA9A0` | aqua — moving water |
| Night | `--type-Night` | `#3A4A7A` | indigo (chosen over midnight/near-black: only indigo still reads as a code at 14px) |
| Cave | `--type-Cave` | `#566071` | enclosed slate |
| Wreck | `--type-Wreck` | `#6E4A33` | umber — iron decay (deliberately *not* rust, to clear Danger) |
| Reef | `--type-Reef` | `#C97A4A` | warm terracotta |
| Wall | `--type-Wall` | `#863C5E` | gorgonian rose — the sea-fan colonies that define a wall dive |
| Pinnacle | `--type-Pinnacle` | `#517548` | moss green — rock spire (off violet to avoid IUCN collision) |
| Muck | `--type-Muck` | `#5E5A31` | dark olive sediment |

- Never borrow a ramp hue for a semantic, or a semantic hue for a type.
- Donut: many tiny tail slices are fine — the donut is gestalt, the legend
  carries precision. Do not group into "Other" (kills type identity).
  **Checked 2026-08-04, while designing the texture channel below: no donut
  exists in the shipped app.** `js/stats.js`'s dive-type breakdown renders
  bars only, via `stBar()` (`stats.js:26`) — no canvas, no SVG arcs. This
  bullet describes a chart shape that was sketched in an early design
  exploration (`mockup-stats.html`) and never built; kept as forward-looking
  intent (the principle — a legend must carry per-item precision colour alone
  can't — is real and should still govern a donut if one is ever added), not
  as a description of the current app.

**Wall and Pinnacle/Muck revised 2026-07** — two unrelated collisions found by
inspection, not audit tooling (hue proximity doesn't show up in a `var()`
grep the way a reserved-colour violation does). See DECISIONS.md → "Dive-type
ramp: Wall/Night and Pinnacle/Muck collisions" for the full comparison work
(hue/sat/lightness numbers, rejected directions, and why each replacement
lands where it does).

---

## 4 · Structure — the surface ladder and `on-*` pairing (v2.99)

The three classes above say **which colours exist and what they mean**. This
section says **how each one is paired and graded**. They answer different
questions and neither replaces the other.

Adopted from Material Design 3 as a **structure only**. MD3 supplies the idea
that a design needs graded container tones with named foreground partners; it
supplies none of the hues here, and its `primary`/`secondary`/`tertiary`
emphasis slots are deliberately **not** adopted — they are a looser discipline
than the three-class model, and mapping `--gold` (earned only) or the
dive-type ramp onto them would be a category error.

### 4.1 Surface ladder

Five rungs, one definition each in `:root`. `--bg` / `--surface` / `--surface2`
survive as **aliases** onto the ladder — hundreds of rules use them and
`.theme-harbour` overrides them by name — but they no longer carry their own
hex. One tone, one definition.

| Rung | Light | Dark (Harbour) | Use |
|---|---|---|---|
| `--surface-lowest` | `#FDFBF9` | `#091010` | raised cards (new rung) |
| `--surface-low` = `--surface` | `#FAF6F1` | `#182827` | cards, inputs, stat boxes |
| `--surface-base` = `--bg` | `#F5EBD8` | `#111E1D` | the page |
| `--surface-high` = `--surface2` | `#EDE5D8` | `#20312F` | tracks, troughs, recessed fills |
| `--surface-highest` | `#DED8CC` | `#2E3E3B` | deepest recess (new rung) |

The two new rungs are **derived by hand-lerp from tones already in the
palette** (the same method the `--profile-*` shades use), not invented — no
new hue enters the system, so this doesn't breach "Adding colour — don't."

`--text` contrast on each rung, light: 13.43 / 12.88 / 11.72 / 11.09 / 9.77.
Dark: 15.49 / 12.34 / 13.80 / 10.98 / 9.06.

**A theme must redeclare the whole ladder, not just the legacy aliases.** The
aliases resolve at use time, so a theme overriding only `--surface`/`--surface2`
would leave `--surface-lowest`/`-highest` still pointing at the light values —
cream rungs inside a dark modal. `.theme-harbour` declares all five.

### 4.2 `on-*` pairing — the point of the exercise

Every container colour gets a **named** foreground partner with a measured
ratio, so "which ink goes on this fill" is decided once in `:root` rather than
per-component and by eye.

Nearly everything in the "Cerulean-as-text audit" and "Open items" below is the
same bug: a foreground and a background chosen independently. Warm Taupe at
3.46:1, `--accent` at 2.44:1 on the mobile nav, the tank gauge's white number at
1.16:1, cerulean headings at 2.98:1, theme classes inheriting light ink. Naming
the pair makes that class of bug structurally impossible rather than merely
catchable.

| Token | Value | On | Measured |
|---|---|---|---|
| `--on-surface` | `var(--text)` | any ladder rung | 9.77–13.43:1 ✓ |
| `--on-surface-variant` | `var(--text-muted)` | rungs except `-highest` | 4.52–5.48:1 ✓ |
| `--on-surface-dim` | `var(--text-dim)` | decorative only | 2.16:1 — **cannot pass, by design** |
| `--on-accent` | `#FFFFFF` | `--accent-fill` | 3.52:1 ⚠ |
| `--on-danger` | `#FFFFFF` | `--danger` | 5.47:1 ✓ |
| `--on-success` | `#FFFFFF` | `--success` | 3.30:1 ⚠ |
| `--on-warn` | `#FFFFFF` | `--warn` | 3.12:1 ⚠ |
| `--on-inverse` | `var(--surface-low)` | the `--text` dark fill | 12.9:1 ✓ |

The `--on-surface*` trio resolves **through** `--text`/`--text-muted`/`--text-dim`
rather than repeating their hex, so any theme re-points them for free by
overriding `--text`. The fill pairs are literal and constant across themes,
matching `--accent-fill`'s existing convention.

`--on-inverse` is the **paper** tone, not pure white — that is literally what
the ink↔paper swap describes, and it is the value `.logo-name` already used as
a raw hex before the token existed.

### 4.3 Contrast correction — applied v2.99

Writing the pairs is what made these visible; they were invisible while the
pairing lived in prose. All were shipping.

| Pair | Was | Now | Change |
|---|---|---|---|
| white on `--accent-fill` | 3.52:1 | **4.51:1** | `#4A90B8` → `#407DA0` (13% darker) |
| white on `--success` | 3.30:1 | **5.39:1** | `#4F9D6B` → `#3B7650` (25% darker) |
| `--success` as text | 3.07:1 | **4.56:1** | (same token) |
| `--warn` as text | 2.90:1 | **4.54:1** | `#E0734F` → `#A4543A` (27% darker) |
| white on `--danger` | 5.47:1 | unchanged | already passed |

**Each token was sized by the roles it actually occupies**, which needed a
usage audit rather than one blanket rule — and the audit changed the answer
twice:

- **`--accent-fill` is a pure fill**, always with `#fff` (24 sites; the six
  that look like text uses are `border-color` on those same rules). It only
  has to clear white, so 13% suffices.
- **`--success` is both** — white-on-fill (`.rev-toggle.on .rev-box`,
  `.mobile-save-bar button.saved`) *and* text on light (SAC-good,
  `.badge-worms`, `.obs-status.connected`). Sized for the harder of the two.
- **`--warn` is text-only in practice.** All four of its "fill" uses are dots
  and spines carrying no text (`.vdot.todo`, `.ss-dot`,
  `.pdc-verdict-spine`, `.sp-tl-dot--warn`), so the white-on-warn pair that
  looked like a failure **has no call site at all**. It is sized against the
  page background instead. `--on-warn` is retained anyway so a future fill
  inherits a defined pair rather than a fresh guess.

Target is 4.5:1 against `--surface-base` (`#F5EBD8`), the realistic worst case
for status text. **Residual, accepted:** on `--surface-high` (`#EDE5D8`) these
land 4.30–4.32 — that rung carries troughs and tracks, not status text.
`--accent-fill` as text would be 3.81, but it is never used as text.

**The matching rgba tints were moved with their base** (22 declarations) — a
tint that stays on the old rgb while its text colour moves is exactly the
"two colours, one meaning" drift this section exists to stop.

**Resolved as a direct consequence: the rogue second green.** The open item
below recorded `rgba(63,185,80,…)` — a brighter green than `--success` ever
was — as a border/background on `.badge-worms`, `.obs-status.connected`,
`.sync-banner.success` and `.btn-save-device`. Darkening `--success` widened
that mismatch from noticeable to obvious, so all 7 sites were consolidated
onto `--success`'s own rgb. One green, one meaning.

**Resolved for the interactive bucket, 2026-08-04** — see "Cerulean-as-text
audit" above for the full account. `--accent` itself (the *ink* token,
unchanged at `#4A90B8`) is still 3.27:1 as text and stays that way
deliberately — the fix is the new `--accent-text` token, not a change to
`--accent`, since `--accent` also carries fill/stroke work with no contrast
obligation of its own. **Still open:** the video/footage cluster and the
mobile-picker-tag/bold-emphasis bucket haven't been swapped onto the new
token yet (same "Cerulean-as-text audit" section has the exact list).
~~In the dark theme, `--danger` `#D26A4D` measures 4.31/3.83 on the dark rungs;
scoped to the footage modal today, so it belongs with the app-wide dark-mode
work.~~ **Resolved in design, 2026-08-04** — dark `--danger` moves to
`#E96E4C` (4.96 on `--surface-low`, the rung that actually carries delete and
SAC-high text on dark). See "App-wide dark mode" under Themes for why the lift
had to be spent on chroma rather than more lightness. Note that `--accent-text`
itself needs a dark declaration too, or it inherits `#397191` and fails on every
dark rung — same section.

**Follow-up, 2026-07-30 — found by rendering the fix, not by computing it:**
`#A4543A` above cleared its text-contrast floor but landed only 3° of hue and
−11pt of saturation from `--danger` — coral and danger were never separated by
hue (3° apart from the start), so spending the fix's whole darkening budget on
lightness erased the one thing (lightness/saturation) that used to read as
"coral" rather than "red." Exhaustive search found no hue/saturation choice
lets `--warn` sit lighter than `--danger` while still clearing 4.5:1 on this
page — the two constraints are genuinely incompatible for text specifically.
Resolved two ways:

| Pair | Was | Now | Change |
|---|---|---|---|
| `--warn` as text | 4.54:1 | **4.71:1** | `#A4543A` → `#9C5621` (hue +11°, sat +17pt vs. the first pass) |
| `--warn` vs `--danger`, hue | 3° | **14°** | (same change) |
| `--warn` vs `--danger`, saturation | −11pt | **+6pt** | (same change — flips back to more vivid than danger) |

The matching rgba tints moved with the base again (17 occurrences,
`rgba(164,84,58,…)` → `rgba(156,86,33,…)`) — same rule as above, applied a
second time.

**`--profile-warn` (new token) is the other half of the fix** — see "Dive-profile
chart" below for the full reasoning. In short: the chart reads its warn colour
via `getComputedStyle`, not as rendered text, so it has no WCAG 1.4.3
obligation at all. Rather than compromise `--warn`'s text legibility further to
chase chart distinctness it doesn't need, the chart gets its own token holding
the *original* `#E0734F` — restoring the full +15pt lightness gap that made it
read as coral in the first place, since nothing forces that lightness down for
a stroke the way it does for a banner.

---

## SAC bands

Single source: `calcSAC()`. Colour by threshold:

| SAC (L/min) | Colour | Class |
|---|---|---|
| `< 18` good | `--success` `#4F9D6B` | reserved (scale-good) |
| `18–25` moderate | `--text-muted` `#726557` | neutral (no signal = unremarkable) |
| `> 25` high | `--danger` `#B0492E` | reserved (destructive register = "fix this") |

No gold anywhere in SAC (gold = earned only). "Moderate" using a neutral is
intentional — an unremarkable value should carry no semantic colour.

---

## Dive-profile chart

`renderProfileChart()` (`js/profile.js`) needs shades that aren't full-strength
`--accent`/`--danger`/`--warn` — a lightened "calm" curve colour, a chart-scoped
"warn" that doesn't carry `--warn`'s text-contrast obligation, a darkened
"locked deco" state, and a two-stop water-column fill. These are **baked,
literal hex** in `:root` — a token read is always a plain hex string, never an
unresolved CSS function.

| Name | Token | Hex | Derivation |
|---|---|---|---|
| Profile calm | `--profile-calm` | `#89B7D1` | `--accent` lightened 35% toward white |
| Profile warn | `--profile-warn` | `#E0734F` | the **original** `--warn`, before the 2026-07-30 contrast correction darkened that token for text use (see "Contrast correction" above) |
| Profile deco | `--profile-deco` | `#6A2C1C` | `--danger` darkened 40% toward black |
| Profile fill (top) | `--profile-fill-top` | `#C0D8E6` | `--accent` lightened 65% toward white |
| Profile fill (bottom) | `--profile-fill-bottom` | `#65A1C3` | `--accent` lightened 15% toward white |

Two different derivation methods, and that's deliberate, not inconsistent:
`--profile-calm`/`-deco`/the two fills are computed by hand from a *different*
live token (`_hexLerp(base, white/black, frac)` in a scratch Node script gives
the exact value) — if `--accent` or `--danger` ever changes, these three need
recomputing to match. `--profile-warn` is not a lerp from anything; it is
simply the value `--warn` held before contrast correction darkened it, kept
alive here because the reason it moved (WCAG text contrast) never applied to
a chart stroke. If `--warn`'s own hue/saturation is ever revisited again,
`--profile-warn` does **not** need to follow — it answers a different question
("what looks right next to `--danger`/`--profile-deco` in a gradient") than
`--warn` does ("what's legible as banner/badge text"), and the two are allowed
to diverge indefinitely.

**Why one token couldn't serve both roles (found 2026-07-30, by rendering the
fix rather than by computing it):** darkening `--warn` for text contrast
collapsed its hue/saturation separation from `--danger` to near nothing —
exhaustive search confirmed no hue or saturation choice lets `--warn` sit
lighter than `--danger` while still clearing 4.5:1 on `--surface-base`, because
lightness is what WCAG contrast is actually measuring, and lightness is what
originally separated "coral" from "rust-red" (they were only ever 3° apart in
hue). The chart has no such floor — a rendered stroke isn't scored against
WCAG 1.4.3 the way text is — so `--profile-warn` gets to keep the lightness
and saturation that `--warn` had to give up. See `renderProfileChart`
(`js/profile.js`) — `warnHex` reads `--profile-warn`, feeding both the curve's
NDL gradient and the `.df-pc-legend-bar` beneath it from the one variable.

`--profile-calm` doubles as one endpoint of the curve's own *live* NDL
gradient (`_ndlColor()` blends it against `--profile-warn`/`--danger` per
waypoint) — that per-sample blending is data-driven and stays in
`js/chart-math.js` (`_hexLerp`/`_hexToRgb`, shared with the landing page's own
demo chart — see "Landing page build sync" below), it's only the **static**
shades above that live in these tokens. `--profile-deco` and the two fill
shades are pure rendering values, never blended at runtime. See
DECISIONS.md → "Dive-profile chart colours moved from JS to CSS" for why.

## Landing page build sync

`landing/prepare-shared.sh` regenerates `landing/app-tokens.css` (the whole
`:root` block, extracted verbatim) and `landing/chart-math.js` (`js/
chart-math.js`, copied byte-for-byte) at Cloudflare Pages build time — a new
token added to `:root` (like `--profile-warn` above) needs **no changes to the
script itself**, it's picked up automatically on the next run. What the script
can't do: `landing/script.js`'s own `WARN_HEX`/`CALM_HEX`/`DANGER_HEX`/
`DECO_HEX` constants are hardcoded, because that demo has no live stylesheet
to read `getComputedStyle` from the way the real app does — those four must be
hand-kept in step with `css/styles.css`'s `--profile-*`/`--danger` values.
Same for `landing/style.css`'s `.ndl-track` legend gradient, which reads the
*imported* tokens via `var()` and therefore updates for free, and the two
`<nav class="phone-nav">` mockups, which don't relate to colour at all but
follow the identical principle — see the comments at each site in
`landing/index.html`/`landing/script.js` for what's mechanical vs. hand-kept
and why.

---

## Warn — wired

`--warn` `#9C5621` is the "needs attention, not an error" state (named
`--pending` until 2026-07 — see "Open items" below for why it was renamed).
Two manifestations were purpose-built for it; several more legitimate uses
have accumulated since (disconnected-sync and offline-search status text, the
bulk-add numbering warning) — all consistent with the same charter, so the
"nothing else may use this colour" rule now means *nothing that isn't
genuinely "worth noticing, not an error"*, not literally these two features
only. **The NDL-gradient warning zone moved off this token 2026-07-30** — it
reads the dedicated `--profile-warn` instead (see "Dive-profile chart" above),
since a chart stroke doesn't share `--warn`'s text-contrast obligation and
forcing one token to answer both questions is what caused the collision with
`--danger` in the first place.

**1. Unvalidated species** (`validated === false` — free-text, no AphiaID).
Surfaced via `.badge-free` (species dropdown, form sighting list, edit-modal
list) and `.sp-pending` (the expanded-card species carousel row + slide).
Strict `=== false` so legacy sightings lacking the field never false-positive.

**2. Unsynced dive** — a real per-dive `_pendingSync` flag:
- set `true` on save (`saveDive`) and edit (`saveEdit`)
- cleared `false` only on a **successful** `pushToObsidian` (failures are
  swallowed, so the flag correctly stays true)
- rendered as the `.tl-pending` coral dot on the timeline row, **gated on
  `syncMode === 'obsidian'`** — it only shows where an Obsidian vault exists
  to be out of sync with. On mobile / folder / none it never shows (there is
  no vault, so "pending sync" would be meaningless noise). This desktop-only
  scoping is deliberate — do not remove the `syncMode` gate.

`_filename` is **not** a sync flag (it's also set by plain `.md` export and
import); `_pendingSync` is the only source of truth for sync state.

---

## Themes (dark mode)

A theme is a **class carrying token overrides**, applied to a subtree root —
currently `.theme-harbour` on `#footage-modal` only; `<body>` would make it
app-wide. Because every component consumes `var()` tokens, the subtree
re-themes automatically. Visual reference: `mockups/mockup-dark-mode.html`
(three explored directions; **Option A "Harbour Night" locked** for the
footage modal — B "Dusk Deck" and C "Open Water" are retained as future
customisation themes).

**Theme rules (apply to every future theme):**
- Every theme class must declare `color: var(--text);` on itself — elements
  with no explicit colour inherit `body`'s *computed* light ink, which
  bypasses token overrides (found via the unreadable "Footage" title).
- **Ink↔paper swap** — the cream neutrals become the text ramp; Deep Water's
  family becomes the canvas. Warm taupe survives as muted text (the brand
  thread).
- `--accent` (ink) **lifts** for contrast on dark (`#74B3D8` in Harbour
  Night); `--accent-fill` **never changes** — buttons are identical in every
  theme.
- Reserved semantics keep their **hue identity**; only lightness/saturation
  shifts (success `#5FB180`, warn `#E98A6A`, danger `#E96E4C`, gold
  `#D9B45C`, violets `#A98BD6`/`#BCA9DE`).
- **IUCN CR holds rank through weight + stronger fill** on dark, not through
  darkness (lightening CR converges it with EN — fill/weight carries the
  hierarchy instead). The `.iucn-*` chips hard-code colours globally, so each
  theme ships scoped chip overrides. **"Stronger fill" means a *deeper* fill
  on dark, not a brighter one** — see the app-wide pass below.
- ~~The dive-type ramp is untouched at modal scope. An app-wide theme must add
  lifted variants for the darkest ramp members (Night, Wall, Cave, Wreck) —
  deferred until then.~~ **Done — see below.**

### App-wide dark mode — design pass, 2026-08-04

Mockups only; `css/styles.css` untouched. `mockups/mockup-dark-tokens.html`
carries the locked token set with every ratio and rejected alternative;
`mockup-dark-history.html`, `-log-form.html`, `-species.html`, `-stats.html`
and `-dive-file.html` render it on the real current markup. Sequence step 7.5
in `BRIEF-play-store-readiness.md`.

The framing this pass corrects: app-wide dark mode was expected to fall out of
the `on-*`/ladder work "nearly for free." The *structure* does — the ladder and
the `--on-surface*` trio re-point for free, exactly as designed. But **four
values that already shipped in `.theme-harbour` were measurably wrong once they
left modal scope**, and two more needed decisions no amount of token plumbing
answers. All ratios below are WCAG 2.x; separation figures are **ΔEok**
(OKLab), used only for distinctness questions, never as a proxy for contrast.

**`--accent` `#74B3D8` confirmed, not patched.** Across all five dark rungs it
measures 8.40 / 6.69 / 7.48 / 5.96 / **4.91** — AA everywhere, worst case on
`--surface-highest`. It needs no change at app scale. Noted in passing: the
dark theme has already solved for itself the problem light mode still tracks
(light `--accent` is 3.27:1 as text). One real bug surfaced with it —
`--accent` is documented as ink but *fills* five things, and one of them,
`.dD-select-box.checked`, strokes a **white tick** across it: 3.52:1 on light,
**2.29:1** on dark. Fix is a component change, not a token change (that
checkbox should fill with `--accent-fill`, the pair that owns white ink). The
other four `--accent` fills are bare bars and dots with nothing on them.

**`--accent-text` must be redeclared, and its dark value is `--accent` itself.**
The light ink/text split landed 2026-08-04, part-way through this pass, and
applies to 65 declarations. A theme that doesn't restate it inherits
`#397191` and fails on **every** dark rung: 3.61 / 2.88 / 3.21 / 2.56 / 2.11.
The dark value is `#74B3D8` — i.e. **the split collapses on dark, deliberately**.
It exists because on a light page the value that reads well as a stroke is too
light to read as text, so text must be darkened *away* from the stroke; on a
dark page the lift already carried `--accent` past the text floor in the same
direction, and there is no second value left to derive. Declaring it anyway
rather than letting it inherit is the entire point — and it generalises:
**a theme block is not automatically kept in step with the palette it
overrides.** This is the same failure mode as the hardcoded light hexes below,
arriving through a token instead of a literal, and it is worth re-checking
against every future addition to `:root`.

**`--danger` `#D26A4D` → `#E96E4C`.** The shipped value was verified against
the modal's rungs only; across the ladder it under-runs at **4.31:1 on
`--surface-low`** and 3.83 on `--surface-high`. Sized against `--surface-low`
rather than the page — inverting light mode's choice deliberately, because on
dark the card rung is *lighter* than the page (`#182827` vs `#111E1D`), so the
card is the worst realistic case for delete/SAC-high text. New value: 6.39 /
**4.96** / 5.69 / 4.41. The `-high` residual at 4.41 is the same accepted class
as light's 4.30–4.32 on the same rung, for the same reason (troughs and tracks,
not status text); `-highest` is excluded by the existing "full ink only" rule.

The interesting part is what the lift collided with. Holding hue *and* chroma
and raising only lightness gives `#D66E51` — which clears the floor but lands
**ΔEok 0.038 from `--type-Reef`**, closer than any two colours this palette
deliberately ships (light's own `--warn`/`--danger`, the tightest intentional
gap in the system, is 0.050 *after* a dedicated correction). A reserved
semantic landing inside a categorical ramp member is precisely the class-2/
class-3 blur the three-class model exists to prevent. It happens because in
light mode Reef and danger are separated almost entirely by **lightness**
(ΔEok 0.125; L 0.655 vs 0.537) — they were only ever 15° apart in hue — and
dark mode's contrast floor forces danger up into the readable band where Reef
already lives. The orange band gets compressed and three tokens want it.
Resolved by spending the remaining budget on **chroma** instead: `#E96E4C`
holds hue at 36.5° at chroma 0.160, restoring **0.060 to Reef** and **0.061 to
`--warn`**. Pushing lightness further was tried and rejected — it buys Reef
separation only by walking into `--warn` (at L 0.72 the two are 0.016 apart,
i.e. the same colour).

**`--warn` needed nothing, and the reason inverts light mode's.** Dark
`--warn` `#E98A6A` sits only **2.8° of hue** from `--danger` and is the *less*
saturated of the two — geometrically the identical shape as the pre-2026-07-30
light pair that a whole correction pass was spent unpicking. But measured it is
**ΔEok 0.088**, comfortably better than the 0.050 light ships, because the
separation runs through **lightness** (0.727 vs 0.641) — the axis light mode
couldn't use, since on a light page both had to be dark enough to clear 4.5:1,
which pinned them together and left hue as the only lever. A dark canvas hands
that lever back. `--success`, the violets and `--gold` all re-measured clean on
the rungs that carry status text (5.25 / 4.77 / 6.90 on `--surface-high`).

**Three `on-*` fill pairs flip to deep ink.** `--accent-fill` `#407DA0` was
checked rather than assumed and survives (3.40:1 against the dark card, white
ink still 4.51) — the constancy rule holds. It does **not** hold for the other
two, and the reason is worth recording because "fill pairs are constant across
themes" reads like it should apply to all three: `--accent-fill` is a
*mid-tone*, while light `--danger` `#B0492E` and `--success` `#3B7650` are
*dark-tones* and measure 2.80 / 2.84 against the dark card — a dark button on a
dark canvas. So rather than invent `--danger-fill`/`--success-fill`, the **ink**
re-points: `--on-danger` / `--on-success` / `--on-warn` become `#091010` on
dark (6.22 / 7.40 / 7.60), against `#FFFFFF`'s 3.01 / 2.60 / 2.35.
`--on-accent` stays white.

**The dive-type ramp: 7 lifted, 3 left alone — and the house method was the
wrong tool.** Three derivations were compared against the light ramp's own
tightest pair (0.053, Shore/Reef) as the bar:

| Method | Tightest pair | Verdict |
|---|---|---|
| A · `_hexLerp` toward white (the house method) | 0.033 Night/Cave | rejected |
| B · uniform lightness, hue does all the work | 0.037 Shore/Wreck | rejected |
| C · minimum lift + margin, hue held | **0.053 Shore/Reef** | **locked** |

**A was rejected because lerping toward white desaturates**, and desaturates
hardest exactly the members needing the most lift — Night −33% chroma, Wreck
−28%, Wall −27% — collapsing Night/Cave *below* anything the light ramp ships.
This is the one place the project's own derivation method is wrong for the job:
it was chosen for **neutrals**, where losing chroma costs nothing, and a
categorical ramp is the opposite case. **B was rejected** because flattening to
one lightness discards relationships that are currently *carrying*
distinctions — Shore and Wreck are 22° apart in hue and told apart in light
almost entirely by Wreck being much darker. **C** lifts each member only to the
floor plus a margin, so relative lightness ordering survives, and lands exactly
on the light ramp's own tightest pair: the dark ramp is **as distinct as the
one already shipping**, not merely adequate. Max hue drift across all ten is
**0.6°**.

| Type | Light | Dark | bar vs track | spine vs ink |
|---|---|---|---|---|
| Boat | `#2F7E8C` | `#2A8B9C` | 3.42 | 4.82 |
| Shore | `#B0894F` | *inherits* | 4.24 | 5.98 |
| Drift | `#3FA9A0` | *inherits* | 4.80 | 6.76 |
| Night | `#3A4A7A` | `#6A7EB4` | 3.41 | 4.81 |
| Cave | `#566071` | `#748094` | 3.41 | 4.81 |
| Wreck | `#6E4A33` | `#A1765B` | 3.41 | 4.81 |
| Reef | `#C97A4A` | *inherits* | 4.13 | 5.82 |
| Wall | `#863C5E` | `#B36888` | 3.41 | 4.80 |
| Pinnacle | `#517548` | `#5F8A54` | 3.41 | 4.80 |
| Muck | `#5E5A31` | `#868150` | 3.42 | 4.82 |

Shore, Drift and Reef already clear both dark floors at their `:root` values
and are **deliberately absent from the theme block** rather than restated — a
restated-but-identical value is the first step toward the four-contradictory-
copies history this ramp already has.

**`--on-type` — a new `on-*` pair the ramp always needed.** Two components draw
text directly on a type colour (`.dD-spine span`, `.lf-type-chip.sel`) and both
hardcode `#fff`; on the lifted ramp that runs 1.6–2.4:1. `--on-type` is
`#FFFFFF` in light and `#091010` in dark (**4.80:1** worst case across all ten)
— the ink↔paper swap reaching the last part of the palette it hadn't. Measuring
it turned up a **pre-existing light-mode failure**: white on the *light* ramp
already fails for Shore 3.21, Drift 2.84, Reef 3.30 — the spine's type word,
which the history design calls "the legend… no separate key needed", is under
AA on those three today. Recorded, not fixed; it is a light-mode bug and
`--on-type` is the seam it would be fixed through.

**IUCN chips — all eight, and two were broken rather than merely missing.**
CR **6.16** (was 3.74), EN 5.58, VU 5.82, NT/LC/DD 6.10, EW 8.86, EX **10.11**.
- **`.iucn-EX` disappeared entirely.** Its `background:#1C3030` — a near-black
  fill, exactly right for "this species is gone" in a light UI — measures
  **1.10:1** against the dark card: the chip vanishes and only floating white
  letters remain. Inverting it *again* (pale fill `#CFC6B6`, deep ink) is what
  keeps the **rule** intact across themes rather than the literal value.
- **`.iucn-CR` failed AA at the value that shipped.** "Stronger fill" was
  implemented as a *brighter* violet tint at α0.22, which lifts the chip's
  background toward its own violet text: **3.74:1**. Dropping the alpha fixes
  contrast (α0.10 → 4.59) but inverts the rank signal, leaving CR less filled
  than EN. Making the fill **deeper** instead — `rgba(9,16,16,0.55)`, the
  theme's own darkest tone — gives 6.16 and still reads visibly denser and
  heavier than EN's light tint.
- NT/LC/DD were simply absent and are fine once added.
- **VU untouched** — the tracked "gold leaks into VU" item is inherited, not
  resolved; it is a question about the rule, not about dark mode.

**Dive-profile chart — two derivations invert.** These are read via
`getComputedStyle`, so they re-theme on their own, which is exactly why a wrong
value here would ship silently. `--profile-calm` and `--profile-warn` survive
unchanged (6.15 / 4.24 over the dark fills). The other three don't:
`--profile-fill-top/-bottom` are `--accent` lerped toward **white** and become
a glowing white block (10.36:1 against the card) — re-derived against the
theme's own anchors as `#1F3337` / `#233740`. `--profile-deco` is `--danger`
darkened 40% toward **black**, encoding "worse than warn" as *darker*, which is
a light-mode idea: on dark, darker means less visible, and every darkened
candidate measured 1.45–2.69:1 over the water column — a state whose entire job
is to be unmissable, rendered nearly invisible. On dark "deeper" must mean
**more saturated and pushed redder**: `#E14752`, 18° red of `--profile-warn` at
chroma 0.19, clears 3.29 / 3.09 and holds ΔEok 0.088 from warn (wider than the
two have in light).

**The same principle showed up four times**, and is the one generalisation
worth carrying into any future theme: **on dark, emphasis inverts direction.**
Adding weight to something means taking light away from it, not adding more —
CR's fill, EX's inversion, locked-deco, and (outside colour) the caustics
shimmer on `.stat-card`, which is specified as a *multiply* blend that pools
light on a light card and simply erases itself on a dark one.

**Two implementation notes the estimate has to carry, neither a colour
decision.** (1) **40 declarations in `css/styles.css` hardcode a light-mode
hex** (`#1C3030`, `#FAF6F1`, `#F5EBD8`, `rgba(28,48,48,…)`) rather than a
token, and every one is invisible to a theme class for exactly the reason the
`color: var(--text)` rule exists. Two are already patched in the shipped block;
`.iucn-EX` was a third. A mechanical sweep, but not a zero. (2) The **tank
gauge has a logic bug on dark, not a colour one** — `_dfTankHtml` colours the
start number `--text` *unconditionally*, and its comment says why: dark ink
reads on both the empty body (11.09) and the blue fill (3.94), so it is safe
wherever the fill edge lands. That premise inverts — `--text` is now the light
ink, giving 10.98 on the body but **1.84 on the fill** — so a nearly-full tank
(220→190, which that same comment calls the common case) swallows its own start
number. The fix is to apply the existing "is it on the fill" predicate to
*both* numbers; light mode merely got away with skipping the test for one.

**Colourblind distinctness, previously unverified and now measured.** Under
simulated deuteranopia the dark ramp's tightest pair is Wreck/Muck at
**0.014**; the light ramp's is the same pair at **0.011** (protanopia: 0.015
dark). Dark is marginally better than light and **neither is good** — Wreck/Muck
and Shore/Reef are close to indistinguishable without colour vision in both
themes. That is a pre-existing property of the ramp, not something dark mode
introduces, and it is not solvable by lightness/saturation moves alone; the
real answer is non-colour redundancy, which the spine already has (the type
word is written on it).

**Needed nothing at all:** the surface ladder (re-measured, matches its
recorded figures exactly), and the mobile bottom nav + desktop sidebar — both
already permanently dark and already running on `--accent-on-dark` `#97C6E2`,
a constant derived from dark-mode `--accent` in the first place. An app-wide
dark theme is the case they were accidentally built for.

---

## Open items (full-app colour audit, 2026-07)

Found during a full-app audit against industry benchmarks and the
positioning/persona docs (see "Cerulean-as-text audit" above for the
`--accent`-as-text half of this work — its own remaining buckets are listed
there, not repeated here). Recorded so they aren't lost — **none
implemented yet, no changes made.**

- ~~**Gold leaks into `.iucn-VU`.**~~ **RESOLVED in design 2026-08-04** —
  VU moves off gold onto **full neutral ink on a stronger tint/border**
  (`var(--text)` on `rgba(28,48,48,0.12)` light / `rgba(237,230,218,0.12)`
  dark). Two things this turned up that the item hadn't recorded:
  **(1) light-mode VU is 3.33:1 today — a live AA failure**, not only a
  hygiene problem; the fix takes it to 10.30 light / 8.86 dark.
  **(2) The doc and the code had quietly disagreed.** The strict rule above
  says "VU/NT/LC stay plain Deep Water text"; the code gives VU gold and
  NT/LC `--text-muted`, so neither matched. VU now sits on plain `--text` as
  written, NT/LC/DD keep the muted treatment they already had, and the
  hierarchy lands on the line IUCN itself draws — **CR/EN/VU are the three
  *threatened* categories, NT/LC/DD are not**: CR and EN carry hue, VU
  carries full ink weight *without* hue, the rest recede. Measured
  separation: VU vs the muted tier ΔEok 0.228 light / 0.155 dark; vs EN
  0.183, vs CR 0.266. VU measures *higher* contrast than CR (8.86 vs 6.16),
  which is fine — a neutral chip among violet ones reads as unmarked, not
  emphasised — but the fill alpha is the dial if it ever looks too loud.
  **Where the treatment came from: `EW` and `EX` are dead ranks in this app.**
  Shoal logs *sightings*, so "extinct in the wild" and "extinct" can't be
  recorded; confirmed against the data, not assumed — **0 of 1,275 rows**
  carry either (LC 709, blank 376, VU 60, EN 39, NT 34, DD 33, CR 22). VU
  takes EW's treatment; EX's solid pale fill was rejected as far louder than
  CR or EN. `--gold` now has **no call site outside its charter.**
- **Unrecognised IUCN statuses hit no rule at all (found 2026-08-04, while
  confirming EW/EX were unused).** `album.js:269` builds the class as
  `'iucn-' + iucn`, and the DB contains one **`LR/nt`** and one **`NA`** —
  legacy codes that survived the AphiaID audit. `.iucn-LR/nt` isn't even a
  valid selector (the `/`); `.iucn-NA` is simply undefined. Both fall through
  to base `.iucn-badge`, which sets **no background, no border, no colour** —
  bare text among chips. So the slot EW/EX vacate becomes a **default**: the
  neutral treatment moves onto the base `.iucn`/`.iucn-badge` classes and the
  six real ranks override it. Strictly better than deleting the dead rules —
  it closes the silent-fallthrough failure mode rather than one instance of
  it, and covers a future EW/EX if a species batch ever introduces one.
- ~~**A rogue second green.** `rgba(63,185,80,…)` (not `--success`'s actual
  value) appears as a border on `.badge-worms`, `.obs-status.connected`,
  and `.sync-banner.success` — sitting directly alongside `var(--success)`
  text in the same rules. Two greens, one meaning; consolidate to one.~~
  **RESOLVED v2.99** — all 7 sites consolidated onto `--success`'s own rgb
  as part of the contrast correction in §4.3, which had widened the
  mismatch. `.btn-save-device` was a fourth user of it, not listed here.
- **Violet tokens exist but aren't used.** `--violet-soft`/`--violet-deep`
  have exactly one *intended* use each (IUCN EN/CR) but `.iucn-CR`/
  `.iucn-EN` hardcode `#6A4A9A`/`#9B7EC8` directly instead of `var()` — why
  the dark theme needs hand-scoped chip overrides instead of just working.
- ~~`--warn` vs `--pending` — two coral "attention" tokens, one meaning.~~
  **Resolved 2026-07, in two steps.** First, the legacy `--warn` (`#FF7F6E`)
  was retired outright — its 7 call sites (sync banners, offline status, the
  bulk-add numbering warning) were pointed at `--pending` instead, with the
  matching rgba tints (`rgba(255,127,110,…)` → `rgba(224,115,79,…)`) updated
  alongside so background/border shades actually matched the text colour.
  Second, looking at everything now sharing that one surviving token —
  including the NDL-gradient warning zone, whose own code already called its
  local variable `warnHex` despite reading `--pending` — "pending" turned out
  to undersell almost all of it: an NDL curve nearing its limit, a
  disconnected sync, a numbering warning are active, worth-noticing-now
  states, not queued to-dos. So the surviving token itself was renamed
  `--pending` → `--warn` (same hex, `#E0734F`, single reserved slot — not a
  second token). The two *original* `--pending` uses (unvalidated species,
  unsynced dive) fit the broader "warn" framing fine; they were never a
  reason to keep the narrower name.
- **Dial gradients (vis/temp sliders) are undocumented.** Six hexes
  (`#16302F`, `#275C63`, `#3C7E9C`, `#9ecce7`, `#cadaea`, `#e9ba6a`) baked
  into `.dial-vis`/`.dial-temp` in `css/styles.css` with no entry here —
  good, deliberate design, no paper trail. Five-minute fix: register them.
- **Stale `--danger` fallback.** `.tc-cancel:hover { color: var(--danger,
  #f87171); }` — `#f87171` doesn't match the actual `--danger` value and
  predates it; the fallback can never actually fire (the variable is always
  defined), but it's misleading to read.
- **`--text-*` naming collision.** `--text-muted`/`--text-dim` (colours)
  share a prefix with `--text-xs`/`--text-sm`/`--text-base` (font sizes) —
  ~~unresolved~~ **RESOLVED v2.99** — the sizes were renamed
  `--font-size-xs`/`-sm`/`-base` across all 420 call sites (CSS, HTML and the
  JS template literals). `--text*` now means colour and nothing else. The
  rest of this bullet is kept for the reasoning; the collision itself is gone.
  same prefix, two different property types. Low urgency; the kind of
  collision that produces a genuinely confusing bug once. `--font-size-*`
  or `--fs-*` for the scale would remove the ambiguity.
- **Dive-type stat bars fail WCAG 1.4.11 non-text contrast in dark mode
  (found 2026-07-31, checking MD3's data-viz-accessibility guidance against
  the app).** `.st-fil`/`.st-trk` (`css/styles.css`) have no dark-mode
  override, so the 10 `--type-*` hues (§3) sit against the same
  `--surface2` track in both themes — and that track flips from light to
  dark while the ramp itself doesn't. Computed against the real tokens: 3 of
  10 fail the 3:1 floor in light mode (Shore 2.57:1, Drift 2.27:1, Reef
  2.64:1); **7 of 10 fail in dark mode** (Boat 2.91:1, Night 1.58:1, Cave
  2.15:1, Wreck 1.74:1, Wall 1.83:1, Pinnacle 2.59:1, Muck 1.93:1) — almost
  a perfect inversion, since the ramp's lighter/warmer hues wash out on a
  light track and its darker/deeper hues wash out on a dark one. Night and
  Wreck are the worst cases, at 1.6–1.7:1 — the bar's fill and its own track
  are nearly indistinguishable, which defeats a bar chart's actual job. The
  plain (non-type-coded) default fill (`--text-muted`) is unaffected —
  4.52:1 light / 6.61:1 dark, both clear. ~~**Deliberately not fixed yet** —
  hold until dark mode (sequence step 7.5, `BRIEF-play-store-readiness.md`)
  is actually underway.~~ **The dark half is DESIGNED, 2026-08-04** — see
  "App-wide dark mode" under Themes above. Holding was the right call: the
  lifted ramp fixes all 7 with **no separate bar treatment and no second copy
  of the ramp** (worst case now 3.41:1), which is exactly what fixing it
  piecemeal would have cost. Not yet implemented — mockups only.
  **The light-mode half is still open** and needs a different fix, since the
  light ramp is untouched: a boundary rather than a colour change. A 1px inset
  hairline in `--text` measures 4.20–4.88:1 against Shore/Drift/Reef and
  11.09:1 against the light track, satisfying 1.4.11 via the bar's visual
  boundary. ~~Separately unverified: whether the 10 hues are
  distinguishable from each other for red-green colourblindness.~~
  **Measured 2026-08-04**, alongside the dark ramp: deuteranopia's tightest
  pair is Wreck/Muck at **0.011 ΔEok light / 0.014 dark** (protanopia 0.015
  dark). Dark is marginally *better* than light and **neither is good** —
  Wreck/Muck and Shore/Reef are near-indistinguishable without colour vision
  in both themes. Pre-existing, not introduced by dark mode, and not solvable
  by lightness/saturation moves; the answer is non-colour redundancy — see
  "Dive-type texture channel" below, designed 2026-08-04.

---

## Dive-type texture channel (designed 2026-08-04, not built)

A second, non-colour channel on the categorical ramp. Mockup:
`mockups/mockup-type-patterns.html` (light + dark, every real size).

**The honest finding first, because it decides what this should be.**
Every place the ramp actually renders already carries the type's name as
adjacent text — checked, not assumed: the timeline spine has the word written
down it, the dive-file hero pill *is* the word, the log-form chip is labelled,
`stBar()` passes the type name as the bar's own label, and the donut has a
named legend. **WCAG 1.4.1 (Use of Color) is therefore already satisfied.**
Textures are a *glanceability* improvement — grouping a donut or a stack of
bars without reading, which is what a colourblind viewer currently can't do
and everyone else can — **not a compliance fix**. That is the whole reason the
recommendation is opt-in rather than default-on.

**Curves are in; literal pictograms are not.** An arc tiles exactly like a
straight hatch — same `background-image` mechanism, same single ink colour,
same re-theming — so nothing resisted them, and adding arcs let the diagonal
split into **two angles**, taking the alphabet from 5 to 7. What stays ruled
out is pictograms, on size rather than taste: the smallest place the ramp
renders is a **9px-tall stat bar**, and the donut is a 6-unit stroke. A boat
silhouette, an isometric triangle, anything with an inside and an outside, is
a smudge at that height; cross-hatch and zigzag were tested and also turn to
mush. Alphabet: **solid · dots · arcs `)))` · vertical · horizontal ·
diagR `///` · diagL `\\\`**. (CSS angle trap worth writing down: a gradient's
*bands* run perpendicular to its axis, so `135deg` gives `/`, `45deg` gives
`\`.)

**The assignment is a graph-colouring result, not a mnemonic wishlist —
assigning by mnemonic was tried first and failed validation on 4 of 12
pairs.** Simulating deuteranopia *and* protanopia across both themes and
taking every pair under ΔEok 0.05 gives **12 at-risk pairs**, not the 2 the
earlier audit noticed (Wreck/Muck 0.011, Shore/Reef 0.014, Boat/Cave 0.014,
Pinnacle/Muck 0.008, Wreck/Pinnacle 0.021, Cave/Wall 0.022, plus
Reef/Pinnacle, Boat/Wall, Reef/Muck, Shore/Pinnacle, Boat/Night, Drift/Wall).
Treating those as graph edges: **3 textures is the provable minimum**; 7 is
what fits inside the 9px legibility ceiling, and the slack is what lets every
mnemonic land.

| Type | Texture | Mnemonic |
|---|---|---|
| Boat | solid | the most common type stays plainest — most of the UI untextured |
| Shore | dots | sand grains |
| Drift | **arcs `)))`** | the current, as ripples |
| Night | **dots** | stars |
| Cave | **horizontal** | flat strata, a cave ceiling |
| Wreck | **diagR `///`** | collapsed, leaning off true |
| Reef | solid | dense, unbroken |
| Wall | vertical | the wall face |
| Pinnacle | **diagL `\\\`** | the spire's slope |
| Muck | horizontal | sediment layers |

**Note for anyone reading the first revision:** Wreck and Pinnacle were
already *different* there (vertical vs diagonal). The pair that actually
shared a texture was **Drift/Pinnacle**, which giving Drift the arcs resolves.
Wreck moving to `/` is a separate improvement, free once two diagonal angles
exist.

**Night ⇄ Cave, 2026-08-04.** Night's texture was the one arbitrary mnemonic
in the table (nothing said "night" about plain vertical stripes); swapping it
for dots reads as stars and is a real improvement. A *literal* swap — Night
takes Cave's dots, Cave takes Night's vertical — was tried first and **fails
validation**: Cave and Wall would both become vertical, and `Cave/Wall` is
one of the 12 at-risk pairs (0.022 ΔEok dark protanopia, 0.034 light
deuteranopia). Re-solved instead: Night takes dots as intended; Cave takes
**horizontal**, since vertical is blocked (Wall owns it and they're an edge)
and horizontal is free — Cave/Muck isn't an edge, and slate blue-grey is
nowhere near dark olive under either simulation. Re-verified against all 12
edges: valid. All ten types now have a working mnemonic.

Types sharing a texture are **guaranteed far apart in colour under both
simulations** — that is what the graph constraint means.

**Two pairs now rest on shape rather than colour, and both are tight at 9px —
unverified on a real screen.** `Drift`(arcs) vs `Wall`(vertical) needs the arc
to read as genuinely *curved*, not as a wobbly vertical tick;
`Wreck`(`/`) vs `Pinnacle`(`\`) needs slant direction to read at a ~9px stroke
length. Computed rather than eyeballed, since no preview tooling was available:
in a 9px bar the arc bows **2.31px** horizontally against a **1.58px** stroke —
a **1.46× bow-to-stroke ratio**, i.e. the curve is wider than the line is
thick, which is the threshold for reading as curved rather than as jitter.
Both are comfortable at spine and chip scale. **Confirm on hardware before
building**; if either fails, the 14px bar height below is the fix and is
already part of the proposal.

**Textures apply ONLY to swatches that carry no word — and finding that out
is the most useful thing this design did.** The first attempt put a solid
plate of the type's own colour behind each word so the texture wouldn't run
through the glyphs. Rendered, the spines **looked like sticking plasters**,
and the cause is geometric rather than decorative: a plate spans nearly the
full 26px width of a spine, cutting the strip into three horizontal bands —
*textured / plain / textured*, which is literally bandaid construction
(adhesive at the ends, gauze pad in the middle). Dots made it worse by reading
as the perforations, and a 3px-radius plate inside a 6px-radius strip added a
concentric-rounded-rectangle look on top. On a wide chip a plate is a small
pill in a big field and looks fine; on a narrow vertical strip it is a bandaid
every time.

Chasing that turned up the better question — *which swatches should carry
texture at all?* Sorting the ramp's render sites by whether the word sits **on**
the swatch or **beside** it splits them exactly:

| | Sites | Needs a plate? | Texture helps? |
|---|---|---|---|
| Word **on** the swatch | `.dD-spine span`, `.lf-type-chip.sel`, `.df-type-pill` | yes | **no** |
| Word **beside** the swatch | `.st-fil` (label in `.st-lbl`), donut slices, legend swatches | never — no text | **yes** |

The two lists are the same split. You cannot look at a spine without its word
in the same glance, so texture adds only noise there; a bar or a donut slice is
the opposite — you scan shapes and the name is somewhere else. **So the plate
only ever existed where the texture shouldn't have been.** Scoping textures to
wordless swatches removes the plate, the bandaid, and the halo question at
once, and leaves the timeline — the app's busiest, most-scanned screen —
completely unchanged.

**A second, dependent Settings toggle extends texture onto worded swatches for
users who want it, using a knockout halo rather than a plate (2026-08-04).**
The default above — no texture where a word already sits on the swatch — is
right for most people, since 1.4.1 already passes there. But someone
colourblind may still want the scan-without-reading benefit even on a
labelled surface: reading every timeline spine's word to sort ten dive types
apart is real cognitive cost a sighted user with normal colour vision never
pays. So a second toggle, **nested under and disabled unless the primary
toggle is on** ("Also on labelled tags"), extends texture to the spine,
log-form chip and dive-file hero pill via `-webkit-text-stroke` +
`paint-order: stroke fill` in the type's own colour — a **halo that follows
the letterforms**, not a rectangle, so it produces none of the plate's
band/plain/band structure. Both toggles default off.

**No new legend/key work is required, and the reasoning is worth recording
because the obvious answer ("yes, textured charts need a key") was wrong for
this app specifically.** Checked against the real render sites, not assumed:
`stBar()` (`js/stats.js:26`) — the *only* place the primary toggle's texture
currently reaches — writes the type's name into `.st-lbl` **unconditionally**,
in the same row as the fill, every time it's called. There is no code path
that renders the fill without the label. So there is nowhere for a key to be
missing. The forward-looking principle to carry, not the texture-specific one:
**any future dive-type visual that isn't already labelled per-item (a donut,
say) needs its own legend before it ships — texture or no texture** — which is
just the pre-existing "the legend carries precision" rule above, unrelated to
whether texture exists at all.

**Rules if this gets built:**
- **Scoped to wordless swatches by default** — stat bar fill, any future
  donut slice or legend swatch. Spine, chip and hero pill keep pure colour
  fills unless the dependent "Also on labelled tags" toggle is on, in which
  case they get the halo (above), never the plate.
- **Both toggles opt-in**, Settings → Appearance, beside the shimmer dial —
  same precedent: a user-facing visual dial persisted to `localStorage`,
  applied as a class on `:root`. Off by default: 1.4.1 already passes
  everywhere, so this is preference, not remediation.
- **Textures and the halo both draw in `--on-type`** — the pair introduced
  for the dark ramp's spine ink already means "the ink that reads on a type
  colour" in both themes, so both re-theme for free. Dark wants more alpha
  than light (0.58 vs 0.42): deep ink on a lifted mid-tone is a softer edge
  than white on a saturated one.
- **One table, two adapters.** `TYPE_TEXTURE` + the seven geometry
  definitions, read by a CSS-gradient adapter (bars, the halo path) and, if a
  future chart needs it, an SVG `<pattern>` adapter. Same shape as
  `--profile-*`. **Do not let the two representations become two tables** —
  the four-contradictory-copies failure this ramp already has history with.
- **One geometry change rides along, only while the primary toggle is on:**
  the stat bar wants 9px → 14px. No donut geometry change is proposed, since
  no donut exists to change (see the correction above).

### Map pins — the first surface the legend rule actually fired on (built 2026-08-12)

`js/map.js` colour-codes the History Map view's pins by dive type, and the trip
full-screen map inherits it through the shared `renderMapMarkers()`.

**This is the app's first genuinely colour-alone per-item surface.** Every
other `--type-*` site writes the type's name beside the swatch — `stBar()`
always emits `.st-lbl`, the spine has the word on it, the chip and hero pill
*are* the word. A map pin has none of that, which is exactly the case the rule
above anticipates ("any dive-type visual that isn't already labelled per-item
needs its own legend before it ships"). So the map ships with a legend: an
`L.Control` at `topright`, listing **only the types actually on screen**, with
**dive** counts that sum to `#map-subtitle`'s figure. Legend swatches carry
`data-tex` when the primary toggle is on — the pin has a texture but no word,
so the swatch is the only place a texture can be *learned*.

**`L.divIcon`, not `L.circleMarker`, and the reason generalises.** An SVG shape
accepts a CSS `fill: var(--tc)` but never a `background-image`, so a
circleMarker forfeits the texture channel outright. Real HTML also means no
colour is resolved in JS, so an open map re-themes with no re-render —
verified live by flipping the OS appearance with the map on screen and
confirming the *same DOM node* went `#863C5E` → `#B36888`. **Any future
type-coloured map or chart element should reach for HTML before SVG for this
reason**, or accept building an SVG `<pattern>` adapter for the texture.

**One pin per site, not per dive.** Coordinate-grouped on the same 4dp
rounding `js/album.js` uses; the pin takes the site's **majority** type and the
popup lists every dive there. This was not primarily a clutter fix — it is what
makes the pin safe as a *navigation target*, since stacked pins leave all but
the topmost unreachable.

**Leaflet's stylesheet always wins same-specificity ties**, because
`loadLeaflet()` appends it to `<head>` at runtime, after `css/styles.css`.
This bit three times in one change: `.leaflet-div-icon`'s `background:`
shorthand (would have killed every pin texture — dodged by passing our own
`className`, which Leaflet *replaces* rather than appends), and the popup
wrapper/tip and close button (found live rendering a white card with `#333`
text on the dark canvas). **Override Leaflet with one extra specificity step,
never a same-specificity rule.**

**Deferred, with the blocker recorded so it isn't rediscovered:** a
conic-gradient pie pin showing a site's full type mix is buildable with no
dependency, but `conic-gradient` **is** a `background-image` and so collides
head-on with `[data-tex]` over the same property. Density clustering
(`Leaflet.markercluster`) is also deferred — its bubbles would hide the type
colours at exactly the survey zoom, and its green/red defaults collide with
reserved `--success`/`--danger`. Both revisit on real data.

**Deliberately not proposed:** rebalancing the ramp's own hues to be
colourblind-safe. It would break the mnemonics the ramp is built on (umber for
iron decay, olive for sediment) and is a far larger change than the problem
warrants given 1.4.1 already passes. Textures are redundancy, not a fix —
with them off, Wreck and Muck are still 0.011 apart for a deuteranope.

## Adding colour

Don't. Compose from neutrals, or reuse strictly within the three-class model.
A genuinely new need means a new *reserved* slot — a deliberate decision
recorded here and in `DECISIONS.md`, not an inline hex.
