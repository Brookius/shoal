# Brief — Video Footage Cloud Hosting

> **Status: RESEARCH — no cloud-hosting code exists yet.** One real bug in the
> *existing* local system was found and fixed as part of this research
> (§2.1). Everything else here is groundwork: what a comparable real app
> (Submersion) actually built, and fresh research into Google Photos vs.
> Google Drive as the first cloud backend, since that's the concrete
> direction Luke wants to start with. Split out of `ROADMAP.md`'s "Cloud
> Footage Hosting" section (2026-07-24) because it had grown past what a
> roadmap bullet list should carry — see that file for the one-paragraph
> pointer back to here.

## 1. The job to be done

Footage today (tagging, proxy generation, and watching) is entirely local
and **Tauri-desktop-only** (CLAUDE.md → "Video footage modal", "Dive
computer profile import" data model). A clip lives on disk, in a folder the
user picked; proxies live in a `proxies/` folder next to it; nothing is
watchable from the browser build or a phone. The job is to make tagged
footage genuinely reachable from other devices — watch on the phone what got
tagged on the Mac — **without Shoal ever becoming a media host itself**.
That constraint isn't new; it's the same "your data, your storage, no
lock-in" principle already load-bearing for dive data (Obsidian/folder
sync, CLAUDE.md → "Data layer") and, per `BRIEF-ios-sync.md` §12.1, the
actual thing Shoal's iPhone promise depends on. Cloud footage hosting is
the same promise applied to a second, much larger class of file.

## 2. Current state — local proxy folders (Tauri only)

Already built and working (CLAUDE.md → "Footage sidecar"): the Tauri shell
remembers an **array** of proxy-folder paths
(`divelog-shell-proxy-paths` in `localStorage`, one per trip — "Connect"
adds, never replaces), scans each via the `scan_proxy_folder` Rust command,
and matches a clip to its proxy **by filename stem**, pooled across every
connected folder. This is the actual mechanism §4 below plugs a cloud
backend into later — the `sources[]`/`resolveVideoUrl()` seam it already
runs through has a reserved-but-unused `kind` for exactly this.

### 2.1 Found + fixed: proxy folders required manual reconnect every launch

Luke's own words: *"I have to relink this every time I start the app."*
Traced to a genuine bug, not a fundamental limitation — fixed the same
session rather than just documented, since it was small and the fix already
had a working precedent to mirror.

**Root cause.** `_shellProxyPaths` persists correctly in `localStorage`
across restarts, and `js/video.js` already has everything needed to
silently re-scan it — `reconnectProxyFolder()`'s shell branch does exactly
that, with **no permission re-grant needed at all** (unlike the browser's
File System Access API, which genuinely does require a user gesture to
re-grant after a reload — that's a real Chrome security constraint, not a
bug, and the existing "Reconnect proxies" button stays the correct answer
there). But nothing in the boot sequence ever *called* that scan. The dive
vault itself hit and fixed the identical shape of bug earlier (`syncFromFolder(false)`
now runs on every load specifically so Stats charts don't come up empty
until "Sync from folder" is clicked by hand) — the same fix was simply
never applied to proxy folders when that landed.

**The fix.** A new `autoReconnectProxyFolderOnBoot()` (`js/video.js`)
mirrors `reconnectProxyFolder()`'s shell branch (`_scanProxyFolder()` →
`_annotateProxies()` → `_proxyUiRefresh()`) but — critically — **must not**
share that function's "nothing stored yet → open the native folder picker"
fallback. That fallback is correct for a deliberate click on "Reconnect
proxies" (nothing connected, may as well start the connect flow) and would
be a genuinely bad surprise as an unrequested dialog popping up on every
single app launch. The boot-time version just no-ops silently if nothing
was ever connected. Wired into `index.html`'s boot sequence chained onto
`syncFromFolder(false)`'s own resolution, so `dives[]` is already fresh
from the vault before proxies get annotated onto it — the first render
after launch shows matched proxies, not just the next explicit action.

**Not fixed, and not a bug:** the browser (non-shell) case still needs a
manual "Reconnect proxies" click after a reload, because Chrome's File
System Access permission grant genuinely doesn't survive one without a live
user gesture. That's the same constraint the dive-folder sync already has
its own `_folderNeedsReconnect` banner for — proxy folders don't have an
equivalent banner yet, which is a reasonable, low-priority follow-up but not
part of what was reported or fixed here.

### 2.2 Proxies rescoped — half the original premise turned out to be wrong

The v2.3 brief (`briefs-archive/v2.3-BRIEF-video-sidecar-player.md`) justified
proxies on **two** bundled claims. Luke tested originals directly on 2026-07-24
and reported: *"I just connected it up with the original videos and it worked
fine."* That falsifies one of the two, and leaves the other untouched — worth
separating carefully, because the feature survives on the half that held.

| Original claim (v2.3) | Status now |
|---|---|
| **Decode performance** — playing 4K masters *"chokes decoders"*; the whole point is to review off proxies (§2 of that brief, and its explicit ❌ on a "play the original" toggle) | **Falsified in practice.** Originals play fine. Modern Apple-silicon hardware decode is simply better than the brief assumed. |
| **Storage / portability** — a trip is *"~300 GB of 4K masters that live on a NAS / external drive"*; proxies make it ~10–15 GB and therefore laptop-portable | **Still entirely true**, and untouched by the test above. |

**Honest scope of the finding:** one data point, on Luke's own capable Mac,
with the files locally attached. It does *not* establish that decode is a
non-issue on older/Intel hardware, over a network mount, or in the browser
build's `<video>` path. So the correct conclusion is narrower than "proxies
are unnecessary" — it's **"proxies are no longer required for local playback
on capable hardware."**

**Why the feature stays, with a stronger justification than it had:** the
storage half of the premise doesn't just survive, it becomes *the* argument
once cloud enters the picture. Uploading ~300 GB of masters to Google Drive
against a **shared 15 GB free quota** (§4.2) is a non-starter; ~10–15 GB of
proxies per trip is the difference between "this feature is usable on a free
account" and "this feature requires a paid storage tier before it does
anything." The same logic applies to the eventual mobile/browser viewer role —
streaming a 4K master over mobile data is bad behaviour regardless of whether
the decoder copes.

**Net effect on this brief:** proxy *generation* moves off the critical path
for local playback (originals are enough), and onto the critical path for
**cloud upload economy**. Keep the code, keep the ffmpeg sidecar, keep
`resolveVideoUrl`'s proxy-preferred ordering — but stop treating "generate
proxies" as a prerequisite step a user must complete before they can watch
anything locally. Recorded in DECISIONS.md as a superseded premise.

### 2.3 Local file paths — DROPPED 2026-07-25, then **BUILT 2026-07-26**

> **Status: done.** The ref model is now relative-path-based; see §2.3.1 at the
> end of this section for what actually shipped. The narrative below is kept
> because it is the record of how the requirement was arrived at, dropped, and
> then forced back onto the critical path by v2.98.


> **Not built, and deliberately so.** This section is kept as the record of a
> real structural flaw and why it stopped being worth fixing *now*. The
> master-folder/relative-path model below optimises for finding files in an
> **already-organised** tree. Mid-planning, Luke reframed the problem: *"I'm
> going to just tackle one dive at a time if I've already ordered them...
> What if the user is less organised than that?"* — which moved the value
> from *navigating* someone's folder structure to *not needing one at all*.
> §3.4's capture-time matching does that, and shipped instead.
>
> The flaw described below is still real, and **no longer latent — it is now
> the top of the cloud critical path.**
>
> **Correction (2026-07-26).** An earlier version of this note said the flaw
> "stopped being on the critical path, because nothing new makes it worse —
> recursive scanning, the thing that *would* have amplified it, is exactly
> what didn't get built." **That is now false.** Recursive scanning shipped
> in v2.98 the same day, as a consequence of unifying the matching folder
> and the playback folder (§3.4): `scan_proxy_folder` walks to
> `SCAN_MAX_DEPTH = 8`, and `_walkProxyDir` does the same in the browser.
> The keys were *not* changed — `_proxyUrls` is still
> `_fileStem(e.name)` (`js/video.js`), and `confirmFootageMatch()` writes
> `dive.videos[].file` as a **bare filename** too. So the exact combination
> this section warned against ("implementing recursion *without* changing
> the key would be a regression dressed as a feature") is what's in `main`.
>
> Two mitigations landed with it, and neither addresses the real case: an
> explicit proxy-wins tie-break (for `GX010128.MP4` vs
> `proxies/GX010128.mp4` — a *designed* collision), and an honest code
> comment recording that the caveat "applies to more cases than before."
> Neither helps when two different dives' originals share a filename, which
> is the case that multi-trip GoPro numbering actually produces — and
> `_shellProxyPaths` is an array where "Connect" *adds*, so multi-trip is
> the normal state, not an edge case.

Luke's original framing: *"we need to crack local first in terms of file
paths. Ideally, I would select one master folder (say the trip) and it would
find all the sub folders within that per dive."*

**Why this is genuinely a prerequisite and not just ergonomics** — the
current local model has a structural flaw that cloud would inherit and
amplify:

- `sources[].ref` stores a bare filename, and `_resolveLocalUrl()`
  (`js/video.js`) resolves it via `_proxyUrls.get(_fileStem(ref))` — a
  **single flat map keyed on filename stem**, pooled across every connected
  folder. Everything but the stem is discarded.
- That same flat map serves **both** proxies and originals, which is exactly
  why connecting an originals folder "just worked" in Luke's test — there is
  no separate originals concept in the code; `connectProxyFolder()` is really
  "connect a folder of videos."
- The known, already-documented consequence (CLAUDE.md; DECISIONS.md →
  "Proxy folders: a global set, matched by filename"): **two files sharing a
  filename collide — last scan wins.** Accepted at the time as "revisit only
  if it bites."

**Recursive subfolder scanning makes that collision problem materially
worse, not better.** Pointing at one trip master folder and pulling in every
per-dive subfolder pools far more files into the same single-namespace map —
and per-dive subfolders are precisely where GoPro-style filename reuse
(`GX010001.MP4` restarting per card/session/camera) shows up. Implementing
recursion *without* changing the key would be a regression dressed as a
feature.

**The fix, which solves both problems at once:** make the ref a **path
relative to the connected master folder**, and key the resolution map on that
relative path instead of the bare stem. `Komodo-2026/dive-142/GX010128.MP4`
is unique where `GX010128` is not.

This is also, not coincidentally, **the thing that makes cloud tractable** —
a relative path inside a Drive folder is the *same string* as a relative path
inside a local folder. Get the local path model right and the cloud backend
becomes "resolve this relative path against a different root," which is
exactly the shape `resolveVideoUrl()`'s existing `kind` dispatch was designed
for. Get it wrong and every cloud source inherits the collision ambiguity
permanently.

**Sketch of the work (not yet built, not yet scheduled):**

1. **`scan_proxy_folder` (Rust, `src-tauri/src/lib.rs`) goes recursive** —
   currently a single non-recursive `read_dir`. Needs to walk subdirectories,
   return each file's path **relative to the scanned root** alongside its
   absolute path, and carry a sane depth cap. Note it now sits behind the
   `FolderScope`/`authorize()` guard added in the 2.974 security pass —
   recursion must stay inside the authorized root, which is also the natural
   security boundary for "one master folder."
2. **`_proxyUrls` re-keyed on relative path**, with the stem-keyed lookup
   retained as a **fallback** for refs that contain no separator — i.e. every
   sidecar written to date. Same backward-compatible read-fallback pattern the
   footage sidecar already uses for legacy nested-YAML clips (CLAUDE.md), so
   existing tagged footage keeps resolving with no migration step and no
   rewrite of historical sidecars.
3. **New refs written as relative paths** going forward (write-forward, same
   as `_annotateProxies()` already does for the `proxy` field).
4. **Folder model becomes "one master folder per trip"** rather than "one
   `proxies/` folder per trip" — replacing, not extending, the
   `divelog-shell-proxy-paths` array's current meaning. The array itself can
   stay (multiple trips = multiple masters).

Only once refs are unambiguous does the cloud work in §4/§5 become a genuine
"add a `kind`" exercise instead of a redesign.

### 2.3.1 What shipped (2026-07-26, v2.982)

Smaller than the sketch above, because v2.98's recursive scan had already
collected the missing data — `_proxyEntries` carried `relPath` per file; it
just wasn't the key. No Rust change was needed.

- **Two maps, not one** (`js/video.js`). `_proxyPathUrls` (relative path →
  url) is the primary lookup; `_proxyUrls` (stem → url, proxy-wins tie-break)
  stays as the fallback and keeps answering "how many videos can we see", so
  its count semantics are unchanged. `_resolveLocalUrl` tries path, then stem.
- **Refs are root-qualified** — `Komodo-2026/dive-142/GX010128.MP4`, including
  the connected folder's own name. The Rust `scan_proxy_folder` strips the
  scan root entirely, so a bare `relPath` would still have collided across two
  connected trip folders that each contain `dive-1/GX010128.MP4` — the same
  bug one level up. Qualifying happens in JS, so shell and browser produce the
  same shape.
- **`dive.videos[].path` added alongside `file`, which is unchanged.** `file`
  is load-bearing as a join key (clips' `sources[].ref`, dedup, the reviewed
  toggle, `data-file` attributes, the video-list label); repurposing it would
  have meant migrating all of those at once, and would have made a re-run of
  auto-match add every already-known file a second time under its new name.
- **Write-forward, no migration.** `buildSidecarData` upgrades an original's
  `ref` to the path once known; `_videoForRef` matches a clip ref by path,
  then filename, then stem, so old sidecars keep resolving untouched. Bare
  refs stay permanently valid — drag-and-dropped files have no folder context
  and still produce them.
- **Covered by `scripts/test-video-refs.mjs`** (25 assertions), including the
  actual property at issue: two videos sharing a filename in different
  connected folders resolve to different files.

One incidental fix: `_isProxyPath` now sees the root segment too, so
connecting a `proxies/` folder *directly* correctly identifies its contents as
proxies. Previously those files had no directory segment in their `relPath` and
were treated as originals — meaning they'd have been fed to capture-time
matching, which is exactly what §3.4 excludes proxies to avoid.

**Still ambiguous, by design:** legacy bare refs. They resolve by stem, which
is what they have always meant. Nothing rewrites them.

## 3. What a real competitor already built (Submersion, GPL-3, researched 2026-07-23/24)

Full comparison already lives in the conversation that produced this brief;
recorded here is only what's load-bearing for *this* decision. Source:
`github.com/submersion-app/submersion` (Flutter/Dart), verified from actual
code and internal design docs, not just its marketing copy.

### 3.1 The default model: reference, never copy

Submersion's original (v1.5) photo/video handling stores a device-native
asset reference (`platformAssetId` — iOS `PHAsset.localIdentifier` / Android
`MediaStore._ID`) and reads bytes fresh from the OS library on every view.
Design principle #1, stated verbatim in their own docs: *"Never duplicate
photo files."* Same instinct as Shoal's own filename-reference proxy
matching (§2) — reference a file, don't copy it — just aimed at the OS photo
library instead of a folder the user picked.

### 3.2 Why that broke, and what they built instead

Device-native asset IDs are device-specific — the same iCloud-synced photo
gets a *different* ID on a phone vs. a tablet, so a reference written on one
device was unresolvable on another. Their fix wasn't a bigger reference
scheme; it was a genuine storage layer — four backends
(`lib/core/services/media_store/`: S3-compatible, Dropbox, Google Drive,
iCloud), **every one of them writing into storage the user already owns**,
with zero Submersion-run infrastructure anywhere in the loop. Their own S3
design doc states the principle outright: *"server-side encryption is the
user's bucket configuration"* — they never hold a key, never see a file.
This is the concrete, shipped precedent behind §1's constraint — not
aspirational, a real app doing it in production.

**Directly informs §4 below:** Dropbox and Google Drive both authenticate
via OAuth PKCE straight to the *user's own* account (Dropbox: a
`/submersion-media` app-folder; Drive: the hidden `appDataFolder` scope) —
no token-exchange server anywhere. That's only possible because both
providers support secret-less PKCE for a genuine **native app** OAuth
client — a different, better-supported category than the "web application"
client type that ruled Google out for a browser build elsewhere in this
project (`BRIEF-ios-sync.md` §3.3). §4.3 verifies this directly against
Google's own current documentation for the specific plan here.

> **Scoped down 2026-07-29 — "directly informs §4" is true for AUTH ONLY.**
> Re-read their code after §4.4's finding. Submersion's access model is the
> opposite of Shoal's problem, and §3.5 below explains why that makes them a
> precedent for the no-backend auth pattern and for nothing else here.

### 3.3 Video transcoding: validates the existing choice, not a new one

Submersion tried vendoring ffmpeg on every platform, explicitly rejected it
(binary size, cross-compile risk), and converged on native per-platform
hardware encoders instead — AVFoundation on Apple (the same choice Shoal's
own `run_transcode` Rust command already makes, `src-tauri/src/lib.rs`),
Android's Media3 Transformer, Windows Media Foundation, with system ffmpeg
only as a Linux-only fallback. Nothing to change here — if proxy generation
is ever needed on Windows/Linux/Android, Media3 Transformer is the concrete
thing to look at for Android rather than stretching the ffmpeg sidecar
cross-platform.

### 3.4 Capture-time auto-match — **BUILT 2026-07-25** (`js/footage-match.js`)

Submersion reads `DateTimeOriginal` from EXIF and matches a photo/video to a
logged dive by an asymmetric window around the dive's own times —
`[entry − 30min, exit + 60min]`, catching boat/dock shots before descent
and debrief shots after. This was flagged here as worth doing independently
of any cloud decision; it shipped as Settings & data → **"Match footage to
dives"**, and it displaced the §2.3 relative-path work entirely (see below).

What differs from the Submersion precedent, and why:

- **Video containers, not EXIF.** Reads the ISO-BMFF `moov > mvhd`
  `creation_time` by *walking* the box tree — necessary because GoPro and
  many cameras put `moov` at the **end** of the file, so a fixed-prefix read
  misses it on exactly the hardware this serves. Falls back to the
  filesystem mtime, flagged in the UI as the less trustworthy source since
  many copy tools reset it.
- **Tighter, symmetric window: `[entry − 10min, exit + 10min]`.** Submersion's
  wide asymmetric window is padded for topside *photos*; dive video is shot
  in the water and recording starts within a few minutes of the descent. The
  tighter window also all but removes the overlapping-window case between
  consecutive dives.
- **Capture time is read as wall-clock, not as a UTC instant.** `mvhd` is
  spec'd UTC but action cameras overwhelmingly write whatever local time they
  were set to — and reading it as wall-clock also makes the result
  independent of where the app is running, so reviewing Indonesian footage
  from the UK matches identically to reviewing it in Indonesia. A genuinely
  UTC-writing camera lands a whole number of hours out instead, which the
  offset control exists for. Offset defaults to 0 and is only ever
  *suggested*, never applied silently.
- **Missing dive times degrade in steps rather than failing:** entry+exit →
  exact; entry+bottom-time → derived; entry only → assumed 60min, flagged;
  date only → same-day *suggestion* needing explicit confirmation; no date →
  excluded and counted. What couldn't be matched is always reported.
- **Assign-only.** Nothing is created, moved or renamed on disk. Physically
  organising footage into per-dive folders is the natural follow-up (§6) and
  was deliberately deferred until the matching has proven itself.

Covered by `scripts/test-footage-match.mjs` (22 assertions: box walk incl.
moov-at-end, 64-bit sizes, mvhd v1, unset-clock rejection, malformed input,
the full window fallback chain, consecutive-dive resolution, and
timezone-stability across three zones) — the first regression net any part of
the footage ref lifecycle has had.

### 3.5 What Submersion does NOT solve — re-checked against their code, 2026-07-29

Prompted by §4.4's finding, their `lib/core/services/media_store/` was read
again with two specific questions: do they read *pre-existing* cloud files,
and do they *stream*. Both answers are no, and both matter.

**They never read files they didn't put there.** Drive adapter, their own
header comment: *"One folder in appDataFolder holds every object; the file
NAME is the full store key."* Dropbox is the same shape (`/submersion-media`
app-folder). Every backend writes into an app-owned keyspace, so everything
they read back is by definition app-created — the exact category
`drive.file`/`appDataFolder` grants freely. **They never hit §4.4's wall
because their model routes around it entirely.** Media originates on the
device (photo library, local files) and *they* upload it; Shoal's footage
originates in cloud storage the diver filled years before this app existed.
Same-looking problem, opposite direction of data flow.

**They download, then play — they never stream.** `MediaObjectStore` (their
interface, `media_object_store.dart`) is `putFile` / `getFile` / `head` /
`delete` / `list`, with `getFile(key, destination)` writing to a local `File`.
There is no range-read, no stream-to-player, nothing that could feed a video
element progressively. The `Range:` headers in the Drive adapter *look* like
streaming and aren't: `Content-Range` on upload is resumable-session chunking,
and `Range: bytes=$received-$end` on download loops chunks into a local file
handle (`raf.writeFrom`) — a resumable **download**, not playback.

**One genuinely useful confirmation, though:** that download path issues
`GET /drive/v3/files/{id}?alt=media` with a `Range` header and handles `206
Partial Content`. So Drive's byte-range support is verified in production
code, not just claimed from docs — which means real streaming *is* available
on Drive to anyone who wants to build it. Submersion simply chose not to.

**Net effect on this brief:** Submersion remains a solid precedent for
no-backend OAuth against a user-owned account (§3.2), and their transcode
choice still validates ours (§3.3). They are *not* a precedent for reading
pre-existing cloud media, and not a precedent for streaming — the two things
this feature actually needs. Where the brief previously implied their storage
design was a model to follow, that only holds for an upload-owned keyspace,
which Shoal deliberately isn't building.

## 4. Google Photos vs. Google Drive — fresh research, 2026-07-24

Luke's stated starting preference: *"Ideally, I'd like to start with Google
Photos or Google Drive as the cloud hosting system."* Researched both
directly against current (2026) API state rather than assumed.

### 4.1 Google Photos — the API itself argues against it, not just taste

**As of March 31, 2025** (current policy, not a future change), Google
substantially restricted the Photos Library API's read surface: the
`photoslibrary.readonly`, `photoslibrary.sharing`, and `photoslibrary`
scopes were removed outright, and the API is now scoped to **managing only
content the calling app itself created** (`photoslibrary.readonly.appcreateddata`).
Browsing a user's existing library at all now requires the separate,
one-off **Picker API** — a user-driven selection dialog, not something an
app can use to maintain a persistent synced folder.
([Source: Google Photos APIs — Updates](https://developers.google.com/photos/support/updates))

This doesn't outright disqualify Photos for Shoal's actual use case — Shoal
would only ever read back footage/proxies it uploaded itself, never try to
browse a user's whole camera roll, so "app-created content only" isn't a
blocker on paper. But it removes any advantage Photos might have had, while
keeping two real downsides: it's built for personal photo curation (albums,
faces, timelines), so dropping raw dive footage and compressed proxies into
it clutters a user's actual photo library with app data; and its API scope
is no narrower or more natural for Shoal's own "one folder per trip"
organization than Drive's already-narrower-still option below.

### 4.2 Google Drive — the better starting point, and why

`drive.file` — the scope limited to files and folders the **app itself
creates**, or that the user explicitly opens with it — is the right fit.
Two things make it a better choice than the `appDataFolder` scope Submersion
uses for its own Google Drive backend:

- **Visible, not hidden.** `appDataFolder` is a hidden folder invisible in
  the normal Drive UI — fine for Submersion's small SQLite-adjacent backup
  use case, wrong for Shoal's own stated philosophy. Shoal's whole data
  story is "your data, visible, browsable, no lock-in" — real `.md` files
  in a real folder you can see in Finder or Obsidian (CLAUDE.md → "Data
  layer"). `drive.file` with a real, visible, named folder (mirroring the
  existing "one proxies/ folder per trip" local convention exactly) keeps
  that promise for footage too. A hidden backup blob wouldn't.
- **A narrower permission prompt.** `drive.file` only ever sees what the app
  itself created or the user explicitly picked — never a scary
  "see all your Drive files" consent screen.

**Storage quota is not a differentiator between the two.** Drive, Gmail, and
Photos all draw from the same shared 15 GB free pool (unchanged since 2013;
Photos uploads have counted against it since June 2021) — choosing Drive
over Photos buys nothing on quota and loses nothing either. Dive footage is
large; this is real, BYO-account-and-BYO-upgrade storage either way, same
principle as the S3-compatible option already in `ROADMAP.md`.
([Source: Google One — how storage works](https://support.google.com/googleone/answer/9312312))

> **Amended 2026-07-28 — the "one visible named folder" model above does NOT
> work for pre-existing footage.** The first bullet assumed Shoal could point
> at a folder and reach what's inside it. §4.4 disproves that empirically:
> `drive.file` is strictly per-*resource*, so folder access never cascades to
> contents the app didn't create. The scope choice itself survives (§4.4's
> recommendation still lands on `drive.file`), but the mechanism becomes
> per-FILE Picker selection, not per-folder. Read §4.4 before designing
> anything against this section.

### 4.3 OAuth without a *token-exchange server* — corrected against a live spike, 2026-07-27

> **Correction.** This section originally claimed genuine secret-less PKCE for
> a Desktop-app client, sourced from Google's own parameter table
> (`client_secret` listed as "Optional" for both the code exchange and the
> refresh). **That was wrong in practice, not just in theory** — a live spike
> against the real token endpoint (`src-tauri/src/gdrive.rs`, built to answer
> exactly this question before anything got built on top of the assumption)
> was rejected with `"error_description": "client_secret is missing."` on the
> very first real request. Multiple independent sources confirm this is
> deliberate on Google's side: PKCE and client authentication are separate
> mechanisms in their implementation, and — unlike Dropbox, which Submersion's
> own PKCE flow (§3.2) relies on — Google does not treat PKCE as a substitute
> for the secret. Docs said optional; the live server enforced required. See
> DECISIONS.md for the full account, including why this was still worth
> building the spike to find out rather than trusting the doc.

**What survives the correction, verified live, 2026-07-27:** embedding
`client_secret` directly in the binary — alongside `client_id`, both as plain
non-confidential constants — makes the whole flow work exactly as originally
intended, refresh included. This is the long-standing, Google-sanctioned
pattern for installed/desktop OAuth apps (predates PKCE; `gcloud` and `rclone`
ship the same way), not a workaround bolted on to route around a problem.
The spike's actual live result: token exchange succeeded, a real folder and
file were created in Drive under `drive.file`, and — the step that matters
most, since it's the one a background sync depends on — a forced refresh
succeeded too, all with the secret sent as a plain form field, no server
anywhere.

**So "no backend" still holds, but for a different reason than originally
argued:** not because the secret is unnecessary, but because embedding a
secret that was never going to be truly confidential for this app category
doesn't require a server to hold it either. The distinction from
`BRIEF-ios-sync.md` §3.3's "Web application" finding stands unchanged — that
was about a client type where PKCE genuinely is the only mechanism available
and a secret can't be embedded at all; "Desktop app" is a different category
with a different, still-no-backend answer.

**The actual new risk, named plainly:** a `client_id`/`client_secret` pair
extracted from the shipped binary (trivial — `strings` on the executable) is
reusable by anyone, indefinitely, from their own infrastructure — a
qualitatively different exposure than a leaked PKCE `code_verifier`, which is
single-use and tied to one flow. Bounded two ways for as long as they hold:
`drive.file` scope caps any resulting grant to files the victim explicitly
picked, and — the one that actually matters right now — the OAuth consent
screen's Testing-mode test-user allowlist is enforced by Google against the
*signing-in account*, not against which software is driving the flow, so a
stranger with the stolen pair still has no one they can get through consent
while the project stays unpublished. That gate lifts on publishing to
Production, which is also the point a public homepage + privacy policy
become mandatory (§6) — two independent reasons the project should stay in
Testing until there's a real audience, not one.

### 4.4 `drive.file` access does NOT cascade from a folder to its contents — tested live, 2026-07-28

**The question.** `drive.file` grants access to files the app *created*, plus
files/folders the user explicitly picked via the Google Picker. Shoal's real
footage is neither — it was uploaded to cloud storage independently, long
before the app existed. So: when access to a *folder* is granted, does that
reach the files inside it?

Google's own documentation is silent on exactly this point (checked the scope
guide, the Picker guide, and community threads — all ambiguous on
folder-vs-contents). Same shape as §4.3's `client_secret` finding:
undocumented, load-bearing, cheap to answer empirically. So it was answered
empirically, before any UI or architecture leaned on a guess.

**The test** (`gdrive_scope_setup` / `gdrive_scope_probe`, temporary commands
in `src/gdrive.rs`): create a folder via the API — one the app therefore owns
outright — put an app-created control file in it, then drag a file into that
same folder *by hand* in the Drive web UI. Then ask Drive what the app can
see. The control file distinguishes "access doesn't cascade" from "the call
simply failed", which would otherwise be indistinguishable.

Deliberately does not use the real Picker: it's a JS widget needing genuine
CSP relaxation (`script-src`/`frame-src` for `apis.google.com`) just to try.
An app-created folder is also an access-granted folder, so it probes the same
semantics; a negative there is decisive enough to act on without touching CSP.

**Result — access does not cascade.** `folder_accessible: true`,
`folder_children: ["app-created-control.txt"]`, and the hand-added file
absent. `drive.file`'s visibility across the whole account was 4 items, every
one app-created. Confirmed with the manual file genuinely added.

**What this rules out, including one plan this brief previously recommended:**

- **"Point Shoal at a trip folder."** Dead. This was §4.2's model.
- **"Move your footage into a Shoal-created folder."** Dead, and disproven
  *directly* — the hand-dragged file IS that scenario, sitting inside a
  folder the app owns, and it's invisible. Moving a file does not change its
  provenance.

**What survives: per-FILE Picker selection.** Not ruled out, and in fact the
canonical intended use of `drive.file` — the Picker supports multi-select,
and access to a picked file is durable (keyed by file id) thereafter. The
cost is ergonomic rather than architectural: multi-selecting a few hundred
videos is a chore, and it repeats whenever new footage lands. No scope
change, no `drive.readonly`, no CASA audit. **Unverified and worth checking
before committing:** whether the Picker imposes a practical ceiling on how
many items can be selected at once.

**The alternative that needs no API at all — TESTED 2026-07-29, and it
works.** A cloud provider's desktop client mounts storage as a filesystem
(`~/Library/CloudStorage/…`), so Shoal's *existing* local folder picker
reaches cloud footage with zero OAuth, zero scopes, zero Picker. Luke already
runs Proton Drive this way and his dive vault lives there. The open question
was whether files set to **online-only** — not downloaded — are readable at
all, since `CLAUDE.md` records Proton's E2E provider "exposes cloud-only files
the browser can't read."

Result, tested against genuinely online-only files:

- **Proton Drive app running → it works.** Playback stutters briefly, then
  plays; Finder shows the file downloading. The provider materialises on
  access.
- **Proton Drive app closed → nothing plays, silently.** No error, no
  explanation.

**This is download-on-demand, NOT streaming — and the distinction decides
whether it solves the original problem.** The file fully materialises locally
as it plays, so disk usage still grows; reclaiming space means re-setting
files to online-only afterwards. True streaming (Drive's byte-range support,
§3.5) never persists the bytes. So the mount *defers* the disk-space problem
rather than removing it: fine for working through a trip a few dives at a
time, wrong for browsing 300 GB that never lands locally.

**What it does settle: desktop needs no Drive API.** Existing code, already
shipped, reaches online-only cloud footage today. That repositions the whole
OAuth/keychain layer as **mobile-tier infrastructure** rather than the desktop
path — a phone can't mount a filesystem, so mobile remains the case that
genuinely requires an API.

**And it sharpens the mobile constraint:** Proton has no streaming API to
offer that future client. Their own CLI (2026) states it "does not support
streaming or on-demand partial downloads — only complete file transfers,"
which is plausibly structural: E2E block encryption makes serving an
arbitrary byte range far harder than a plain HTTP Range. So mobile playback
would need footage in a provider that *does* support ranges — i.e. Google
Drive (§3.5 confirms it in production code). That's a "where does the footage
live" decision with a storage-cost dimension, not just an auth one, and it
should be made deliberately rather than by drift.

**One behaviour still unobserved:** whether *seeking* works on a
partially-materialised file — scrubbing to the middle of a long online-only
video. That's the thing most likely to make tagging painful, and it's
untested.

### 4.5 The model inverts: Shoal owns the upload path (2026-07-29)

Everything above §4.4 assumed Shoal's job was **reading footage the diver had
already put in cloud storage**. §4.4 proved that's the hard direction —
`drive.file` can't reach pre-existing files without per-file Picker selection,
and the only alternative scope is Restricted. Luke's reframing turns the
problem around: *"if I was to upload the footage through Shoal to Google
Drive, then it would be able to stream it because it was created and written
by the app?"*

Yes. And it dissolves most of §4.4 rather than working around it.

**Why it works, mechanically:**
- App-uploaded files are **app-created**, the one category `drive.file` grants
  freely. No Picker, no `drive.readonly`, no CASA audit, no scope change.
- **Access persists across grants.** Already evidenced, not assumed: the §4.4
  scope probe listed `Shoal spike test` and `spike-test.txt` — created in an
  *earlier* session, still visible after disconnect/reconnect cycles. Worth
  confirming across a full reinstall eventually.
- **Streaming is genuinely available.** §3.5 verified Drive's byte-range
  support in Submersion's production code (`?alt=media` + `Range:` → `206`).
  Bytes never land on disk — strictly better than §4.4's mount, which
  materialises the whole file.

**Why the economics work, which is the part that makes this more than
technically-possible.** Much of the footage currently sits in GoPro Cloud and
has to be downloaded and migrated *regardless*. Uploading through Shoal isn't
added work — it redirects a migration already committed to. And if it retires
a GoPro Premium subscription, the Google One tier it needs may be a wash or a
saving rather than a new cost.

**This is Submersion's architecture** (§3.5) — upload-owned keyspace, which is
exactly why they never hit §4.4's wall. One deliberate difference: Shoal
uploads to **visible `drive.file` files**, not their hidden `appDataFolder`.
If Shoal is ever abandoned the footage is just normal files in the user's own
Drive, matching the "your data, no lock-in" line §4.2 already argued.

**What it costs:**
- **Resumable upload is mandatory, not optional.** Multi-GB files over a home
  connection *will* drop mid-transfer. Google's resumable session protocol
  handles it, but that means persisting resume state, handling `308`
  continuation, and surviving app restarts. This is the single largest piece
  of new code, and it's what Submersion's `putFile(resumeStateJson)` +
  `abandonResume` exist for — readable as a design reference, GPL-3 so not
  copyable.
- **Storage is a real, recurring cost** that grows every trip.
- **Verify before a multi-day transfer:** Drive enforces a 750 GB/day
  per-user upload cap. 300 GB fits, but whether the API path has tighter
  limits than the web UI is unchecked.

**Proxies come back — for a THIRD reason, and this one is about bandwidth.**
§2.2 killed the decode premise; §4.4's no-upload model killed the storage
premise. With uploads back, the argument is *streaming*: 4K at 60–100 Mbps
streams badly to a phone. Likely answer is upload **both** — the 4K original
as archive, plus a 1080p proxy at roughly 5% additional storage that mobile
actually streams. That finally gives the parked `transcodeProxies` code a
justification it was never originally built for.

### 4.6 Photos: the same model, minus every hard part

Raised alongside the upload idea: the same workflow suits **photos** — edit on
the laptop, upload through Shoal, and have them **replace the iNaturalist
reference images** in the Species Album. That's not a new feature so much as
the missing delivery mechanism for one already in `ROADMAP.md`/`CLAUDE.md`
("Species Album — undiscovered species… Personal photo upload to unlock full
profile").

The architecture is identical — app-uploaded, therefore app-created,
therefore readable and servable under `drive.file`. But photos strip out
every expensive part of the video case:

| | Video | Photos |
|---|---|---|
| File size | GB — resumable upload mandatory | MB — a single request |
| Proxies | Needed for mobile streaming | None |
| Playback | Range-request streaming, local proxy server | Plain `<img src>` |
| Thumbnails | N/A | Drive's own `thumbnailLink`, free |

**So photos are the natural first implementation, not a follow-on.** They
exercise the whole chain end-to-end — OAuth (built), upload, app-created
readback, rendering from cloud — at a size where none of the hard problems
bite. If the model is wrong, it's much cheaper to discover on a 3 MB JPEG than
midway through a 300 GB migration.

**Google Photos still isn't the right home for these** — §4.1's reasoning
holds, and the March 2025 app-created-only restriction is no longer even the
deciding factor now that Shoal would be the creator. It remains the wrong
shape: a personal-curation library that Shoal's app data would clutter, with
no advantage over Drive for a per-species reference image. Drive's
`thumbnailLink` covers the one thing Photos might genuinely have offered.

**Checked and dismissed: the Google Photos Ambient API.** Flagged as
potentially relevant; it isn't. It exists to drive slideshows on *ambient
devices* — smart TVs and digital photo frames — and access requires acceptance
into Google's partner program. Neither the use case nor the eligibility fits a
desktop dive log.
([Source: About the Ambient API](https://developers.google.com/photos/ambient/guides/about))

### 4.7 Photo organisation — one photo per SIGHTING, and keeping names true afterwards

The target use, stated by Luke: photos attach per *sighting*, not per species,
so the Species Album can flick through every octopus you've photographed while
a map lights up the sites and dives they came from.

**That feature needs no new identifiers.** Everything the join requires
already exists: the footage sidecar keys per-species on
`scientificName || customId`, sidecars are per-dive joined by `dive.uid`, and
dives already carry `gps_lat`/`gps_lng` and `site`. Photos slot into the same
`clips`-shaped structure video moments already use; the map is just plotting
the parent dives. The ambitious version costs no more than the basic one.

**Naming is a legibility problem, not a correctness one.** Drive is not a
POSIX filesystem — duplicate names in one folder are legal, distinguished by
id — and the sidecar stores the Drive **file id** as the authoritative ref
(§4.5). So a collision can't break playback. It can only make the Drive folder
confusing to a human, which is the thing worth optimising for.

**Structure — per-species folders, revised upward from an earlier "flat"
suggestion** made when the assumption was 1–3 photos per species. Per-sighting
photos across ~150 dives plausibly reach four figures, at which point folders
stop being over-structure and become exactly the grouping the Album browses
by:

```
Shoal/
  Species/
    Chelonia mydas/
      2026-05-06_dive-128_batu-balong_01.jpg
      2026-05-09_dive-131_manta-point_01.jpg
```

Scientific name for the folder — already the join key, and required unique
(CLAUDE.md: "must be WoRMS-canonical and unique"); common names aren't. Date
first inside the folder so it sorts chronologically per species. **Site earns
its place in the filename** — it's the one element that makes a photo
self-describing when viewed outside Shoal. Reuse the existing `slugify()`
(`js/app.js`) for the parts, as `canonicalFilename()` already does.

**The reconciliation problem: facts change after upload.** A misidentified
species gets corrected months later; a dive's site or number is edited. Both
invalidate a name *and* a folder, since species determines the folder.

This is the **same problem the repo already solved once**, for dive `.md`
files — "Sidecar filename hygiene (v2.76 — coordinated canonical renaming)",
CLAUDE.md. That pattern applies directly: a `canonicalPhotoName(sighting,
dive)` function as the single source of truth for "what should this be called
right now", compared against the stored name on every save, with a mismatch
triggering a rename.

**But it's markedly SAFER here, and the reason is worth stating.** The local
version needed a careful write-new → verify → delete-old ordering because the
*filename was the identifier* — a crash mid-rename could orphan a sidecar. In
Drive the **id** is the identifier, so a rename is a metadata patch
(`files.update` with `name`, plus `addParents`/`removeParents` to move
folders). Nothing is copied, nothing is deleted, no window exists where a
reference points at nothing. A failed rename leaves a stale-but-working name,
which is the correct failure mode.

**Three rules this needs, none obvious:**

1. **Never clobber a name the user chose.** Only rename when the current Drive
   name still matches what Shoal last wrote. If the user renamed it themselves,
   they've expressed intent — leave it and stop tracking that file's name.
2. **Queue and batch, don't rename inline.** A trip rename or bulk divenum
   change can touch tens of dives and hundreds of photos; that's hundreds of
   API calls that must not block a save. Reuse the `_pendingSync` shape —
   mark dirty, reconcile in the background, surface failures through the
   existing sync-status banner rather than failing silently (the failure mode
   this project has repeatedly had to fix).
3. **Leave emptied species folders alone.** When the last photo moves out of a
   corrected-species folder, deleting it risks removing a folder the user has
   since put their own things in. Harmless cruft beats destroying user data.

## 5. Recommendation — rewritten 2026-07-29 for the upload-owned model

The target is unchanged: watch tagged footage from the cloud, on any device,
not just the Mac holding the files. **What changed is the direction of data
flow** — Shoal uploads to Drive rather than reading what's already there
(§4.5). That single inversion resolves §4.4's scope wall, unlocks real
streaming, and makes mobile viable later.

**Google Drive, `drive.file`, visible files** (not `appDataFolder`),
authenticated as a **Desktop-app** OAuth client from the Tauri shell — no
backend, no token-exchange server (§4.3, verified live 2026-07-27, and built:
`src-tauri/src/gdrive.rs`). Everything Shoal uploads is app-created, so it's
readable and streamable without the Picker.

**Build order, cheapest-proving-step first:**

1. **Photos (§4.6).** Same architecture, none of the hard parts — no resumable
   upload, no proxies, no streaming, thumbnails free via `thumbnailLink`.
   Proves the whole chain end-to-end on a 3 MB file, and delivers a
   roadmap feature (personal photos replacing iNat references in the Species
   Album) rather than being throwaway scaffolding.
2. **One large video, resumably.** The real work: Google's resumable session
   protocol, persisted resume state, `308` continuation, surviving restarts.
   Prove it on a single multi-GB file before any bulk migration.
3. **Range-request playback**, behind a local Rust proxy that holds the token
   (a `<video>` element can't send an `Authorization` header). Slots into the
   `sources[]`/`resolveVideoUrl()` seam already reserved for it.
4. **Proxy generation**, if and when mobile streaming proves 4K too heavy
   (§4.5). Not a gate for desktop.

**Desktop needs none of this to work today** (§4.4): a cloud-provider
filesystem mount already reaches online-only footage with shipped code. The
upload path is what buys *streaming without local materialisation*, and
what makes a phone client possible at all.

**Still true, and now load-bearing for a second reason:** refs are
root-qualified relative paths (§2.3.1, v2.982). That was built so a path means
the same thing locally and in Drive — which is exactly what an upload path
needs to preserve when mapping a local file to its uploaded counterpart.

### 5.1 Android ingest is picker-based and cannot inherit the desktop model (2026-07-29)

Added once Shoal committed to a native Android app on the Play Store
(`BRIEF-play-store-readiness.md`). It changes ingest, not the data model.

**`scan_proxy_folder`'s recursive `std::fs` walk has no Android equivalent within
policy.** "Point me at your video folder and I'll scan it" maps on Android to
`MANAGE_EXTERNAL_STORAGE` or broad `READ_MEDIA_VIDEO`, both restricted since
2025-01-22 to apps with demonstrable broad-access need; everything else is
directed to the system picker. A dive log doing occasional imports has no
argument for the broad grant, and requesting it invites a restricted-permission
review that would be lost.

**Decided: keep both models, platform-specific.** macOS keeps connected-folder
scanning and capture-time footage-match (§3.4); Android uses the system picker
plus Drive. **The sidecar format does not fork** — the root-qualified relative
path refs above already mean the same thing to a macOS folder scan, an Android
SAF tree walk, and a Drive folder. Three resolvers, one ref, behind the
`resolveVideoUrl()` / `sources[].kind` seam that already exists. Only ingest
differs.

**And SAF is ingest-only, not playback.** A DocumentsProvider may return a
non-seekable pipe or socket for mode `"r"` (only `"rw"` implies a seekable file
on disk), and cloud-only files are virtual files (`FLAG_VIRTUAL_DOCUMENT`) with
no binary representation at all — `openInputStream()` doesn't work on them. So
the same download-vs-stream wall §4.4 found on the macOS mount exists on Android
too. Drive's `?alt=media` + `Range` remains the only genuine streaming path,
which is what makes step 3 above the one that actually delivers mobile.

**One ordering trap worth carrying here too:** the Android OAuth client is keyed
on package name + the **Play app signing** SHA-1, not the local upload key — see
DECISIONS.md → "Drive auth can't work in a browser…". Get it wrong and Drive
fails only for Play-installed users.

## 6. Open questions / next steps (none scheduled)

**Resolved 2026-07-27:** the OAuth mechanism question below — loopback
listener, confirmed working end-to-end against the live endpoint. See §4.3
and `src-tauri/src/gdrive.rs`. Kept struck through rather than deleted, same
as everything else in this section, as the record of what was actually
uncertain before it was tested.

- **Physically organising footage into per-dive folders** — the natural
  follow-up to §3.4's matching, and explicitly deferred when it was built:
  moving a diver's originals is hard to undo, so the matching earns trust
  first. Needs a native Rust move command (inside `FolderScope`), a dry-run
  preview, and collision handling.
- **Photos, not just video** — §3.4's parser slot takes EXIF the same way it
  takes `mvhd`; the matching, preview and assignment logic is source-agnostic
  already.
- ~~**Exact Tauri-side OAuth redirect mechanism** — a loopback local HTTP
  listener (the standard "installed app" pattern Google's own docs
  describe) vs. a custom URL scheme via a deep-link plugin. Not researched
  to implementation depth yet; a scoped next step before writing cloud code.~~
  **Resolved 2026-07-27** — loopback listener, no port pre-registration
  needed for a Desktop-app client. Live-verified: `src-tauri/src/gdrive.rs`.
- **Upload trigger and UX** in the Tauri workspace — automatic the moment a
  proxy is generated, or an explicit "upload" action; progress/retry
  handling.
- **Streaming/range-request playback** for the eventual browser/mobile
  viewer role (`ROADMAP.md`'s "Browser + mobile = viewers" split) — the
  thing that actually delivers "watch it from the cloud."
- **Does proxy generation need a UX change now it's optional?** (§2.2) It's
  currently framed as a step you complete before watching; it's really a
  step you complete before *uploading*. Not urgent, but the current framing
  now overstates its necessity.
- **Whether Drive becomes the only backend or one of several** — the
  existing `sources[].kind` design is already pluggable in shape (matching
  Submersion's own multi-backend architecture), so starting with Drive
  doesn't need to foreclose S3-compatible (`ROADMAP.md`'s original first
  target) or anything else later. Recommend keeping it genuinely pluggable
  rather than hard-coding to one provider, even though implementation
  starts with just the one.

**Resolved 2026-07-27: there is no narrower, view-only version of
`drive.file`.** Raised as a question — "keep the local folder picker as the
sync mechanism, and dial the Drive API permissions back to view-only, since
video is all it needs to do" — and checked directly against Google's current
scope list rather than assumed. `drive.file` is already the narrowest,
least-sensitive option that fits this use case; it isn't optionally
read-write, the per-file model *is* read-write by design (an app that opens
a file via the picker is expected to be able to save back to it). The only
read-only paths are `drive.appdata` (the *hidden* app-data folder — already
rejected in §4.2 for breaking Shoal's "visible, no lock-in" promise) or
`drive.readonly`, which is a **Restricted** scope covering the user's entire
Drive, not just what Shoal touches. Restricted means the costly third-party
CASA security assessment on publishing — precisely the review tier `drive.file`
was chosen to avoid (§4.2). So "dial back to view-only" would mean requesting
*broader*, more sensitive access than what's already granted, not narrower.
**Conclusion: keep `drive.file` as-is.** It's already the minimum for video,
and — see below — leaves room to grow into full-vault sync without a second
scope, a second consent screen, or a second review tier ever being needed.

- **Using Drive as the sync backend for the whole vault, not just
  footage** — raised in the same conversation as the scope question above,
  worth its own line since it's a materially bigger idea than "hosting
  video." The already-granted `drive.file` scope (create/edit/delete, not
  just read) already covers writing `.md` files and sidecars, not only
  video — so this doesn't need new permissions to explore, just new code.
  **Not the same job as local folder sync, and not a replacement for it**:
  folder sync (`js/app.js` — `writeToFolder`/`syncFromFolder`, the Tauri
  native-fs and File System Access paths, CLAUDE.md → "Folder sync") talks
  to a folder the OS already has a path to; a Drive API integration talks to
  Drive directly, with no dependency on the Google Drive desktop/mobile app
  being installed and having that folder actively syncing. **The place this
  stops being a nice-to-have and starts being a real capability gap it
  closes: Android.** Folder sync already reaches a Drive-backed folder there
  today (CLAUDE.md → "Folder sync works on Android Chrome/Edge... including
  cloud-backed folders... via Android's Storage Access Framework"), but that
  path is downstream of the OS's own Drive app already having synced the
  folder — a direct API integration would work identically regardless of
  what's installed, and closes the gap this brief's §1 already names as
  unserved: viewing/logging dives on a phone with no Mac-tethered sync
  dependency at all. Genuinely overlaps `BRIEF-ios-sync.md`'s territory
  (cross-device sync without standing up a backend) enough that whichever
  gets picked up first should check the other before committing to an
  architecture — this may turn out to be a cheaper answer to part of what
  that brief is solving for, or may turn out to be a distinct, complementary
  piece. Not scheduled; recorded because the same OAuth work that unlocked
  video hosting turns out to unlock this for free, and that's worth knowing
  before either brief's next session picks a direction.

## 7. Decision log

| Decision | Reasoning |
|---|---|
| Google Photos considered and set aside in favour of Google Drive as the first target | Not impossible, but strictly worse fit — clutters the user's personal photo library, no scope narrower than Drive's, no quota advantage (§4.1/§4.2) |
| `drive.file` (visible folder) over `appDataFolder` (hidden) | Matches Shoal's existing "your data, visible, no lock-in" philosophy; Submersion's choice of hidden storage was right for their smaller backup use case, not a precedent to copy here |
| `drive.file` KEPT after testing, but the access model changes from per-folder to per-file (2026-07-28) | Live test (§4.4) disproved the assumption that folder access reaches folder contents — it's strictly per-resource. The scope still wins (the alternative, `drive.readonly`, is Restricted: paid CASA audit to publish, and grants the user's whole Drive), but "point at a trip folder" is dead and per-file Picker multi-select replaces it |
| Filesystem-mount alternative TESTED and it works — desktop needs no Drive API (2026-07-29) | Proton materialises online-only files on access while its app runs; playback stutters then plays. But it's download-on-demand, not streaming — bytes land locally, so it defers the disk-space problem rather than removing it. Settles desktop with shipped code; leaves streaming and mobile unsolved (§4.4) |
| **Model inverted: Shoal uploads to Drive rather than reading pre-existing files (2026-07-29)** | Dissolves §4.4's wall entirely — app-uploaded files are app-created, the one category `drive.file` grants freely, so no Picker, no `drive.readonly`, no CASA audit. Unlocks true Range-request streaming (bytes never land locally), which the mount can't do and which mobile requires. Economically near-free: the GoPro Cloud footage has to be downloaded and migrated regardless, so uploading through Shoal redirects existing work rather than adding it (§4.5) |
| Photos chosen as the FIRST implementation, ahead of video | Identical architecture, none of the expensive parts — no resumable upload, no proxies, no streaming, thumbnails free via Drive's `thumbnailLink`. Proves the full chain on a 3 MB file instead of discovering a flaw midway through a 300 GB migration, and ships an existing roadmap feature (personal photos replacing iNat references) rather than scaffolding (§4.6) |
| Photos attach per SIGHTING, not per species; per-species Drive folders (revised up from "flat") | Per-sighting is what makes the Species Album's "every octopus I've shot, mapped to where" possible — and it needs no new identifiers, since sidecars already key on `scientificName \|\| customId` per dive `uid`, and dives already carry GPS. The volume that implies (four figures, not the 1–3/species originally assumed) is what turns folders from over-structure into the right grouping (§4.7) |
| Drive **file id** is the authoritative photo ref; the filename is for humans only | Drive permits duplicate names in a folder, so a collision is a legibility problem rather than a correctness one. It also means a user reorganising their Drive can't break playback — and that renames become a safe metadata patch rather than the write-verify-delete dance local `.md` renaming needs, since nothing is ever copied or deleted (§4.7) |
| Renames reconcile automatically, but never over a name the user chose | Mirrors v2.76's `canonicalFilename` compare-on-every-save, extended to species-corrections and site/divenum edits. Queued and batched rather than inline (a trip rename can touch hundreds of photos), reported through the existing sync-status surface, and skipped entirely for any file whose Drive name no longer matches what Shoal last wrote — that's user intent, not drift (§4.7) |
| Google Photos Ambient API checked, dismissed | Exists for slideshows on smart TVs and photo frames, and gated behind Google's partner program. Neither the use case nor the eligibility fits a desktop dive log (§4.6) |
| Proxies justified on a THIRD premise — streaming bandwidth (§4.5) | Decode premise falsified (§2.2), storage premise died with the no-upload model (§4.4), but 4K at 60–100 Mbps streams badly to a phone. Likely shape: upload the 4K original as archive plus a 1080p proxy at ~5% extra storage for mobile. Not a gate for desktop |
| No backend / token-exchange server for Google Drive auth | **Revised 2026-07-27 after a live spike.** The docs-derived claim of secret-less PKCE was wrong in practice — Google's live token endpoint requires `client_secret` regardless. The "no backend" conclusion still holds, but because the secret is embedded non-confidentially (the standard installed-app pattern), not because it's unneeded. Verified end-to-end incl. refresh (§4.3) |
| Proxy-folder auto-reconnect bug: fixed immediately, not just documented | Small, well-understood, low-risk, and directly mirrored an already-shipped fix for the identical shape of problem (`syncFromFolder(false)`) — no reason to defer |
| Proxies kept, but demoted from "required for playback" to "required for upload economy" | v2.3's decode-performance premise was empirically falsified (originals play fine); its storage/portability premise wasn't, and becomes decisive against Drive's 15 GB free quota (§2.2) |
| Relative-path refs scoped, then dropped, in favour of capture-time matching (2026-07-25) | The path model optimised for navigating an *already-organised* tree; matching by the video's own timestamp removes the need for one at all, which serves the disorganised user the feature actually exists for (§2.3) |
| Capture time read as wall-clock, not as a UTC instant | `mvhd` is spec'd UTC but action cameras write local time; wall-clock also makes matching independent of where the app is run, so the same footage matches identically in Indonesia and the UK. A truly-UTC camera lands a whole number of hours out, which the offset control handles (§3.4) |
| Matching assigns only — never moves, renames or creates files | Moving a diver's originals is hard to undo; the matching earns trust first. Deferred as an explicit follow-up, not abandoned (§6) |
| Recursive folder scanning shipped anyway, same day as the ref-collision flaw was called latent (v2.98) | Unifying the matching folder with the playback folder (§3.4) needed it; the "won't get worse, recursion is what's not built" reasoning above was overtaken by events within hours, not a long-term drift (§2.3) |
| Relative-path refs built after all, one day later (v2.982) | Recursion had just made the "dropped, then" framing above stale — bare-filename refs plus recursive scanning was the exact regression §2.3 originally warned against. Re-scoped as smaller than first estimated, since `_proxyEntries` already carried the relative path the fix needed (§2.3.1) |
| `client_secret` embedded in the binary alongside `client_id`, both non-confidential by design | The only way to keep "no backend" once the docs-derived secret-less claim (above) was found wrong live. Standard installed-app pattern; bounded by `drive.file` scope and — while true — the Testing-mode allowlist gating consent by account regardless of which software presents it (§4.3) |
