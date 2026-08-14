# Brief — iPhone support: local files first, sync later

> **Status: Phase 1 built and confirmed on real hardware, 2026-07-21** (Web
> Share export, iOS install nudge, persistent-storage request — see §2 for
> what shipped and §11 for how it was verified, including the real-iPad
> confirmation that closed the one open risk). Phases 2–3 deliberately
> deferred pending a pilot — **but the direction for Phase 3 shifted
> substantially in a later research pass (§12–§14), the same day.** A real
> open-source competitor (Submersion) proved a zero-backend native-app path
> works in practice, which demoted CloudKit from leading candidate to one
> option among several. **Read §12 before treating §4's table as current.**
> The immediate target is still **not sync** — it's getting an iPhone user to
> a complete local file round-trip (save a dive out to the Files app / iCloud
> Drive, and read dives back in). Full sync is a later decision that depends
> on whether iPhone users materialise at all. The filename says "sync"
> because that's where this started; most of the value in this document is
> the record of which sync doors are **closed and why**.

---

## 1. The job to be done

Android has a real sync story: folder sync via the File System Access API, with
Chromium's SAF support making a Google Drive folder a live read/write target.
**iOS has nothing equivalent and never has.** The current iPhone story is
download-then-move — the app downloads a `.md`, the user finds it, moves it into
a cloud app by hand. That's friction severe enough that it's plausibly costing
iPhone users outright.

The trap to avoid is jumping straight to "build sync." Sync is the expensive
answer to a question that hasn't been asked yet — namely, whether iPhone users
want this app. Phase 1 below is the cheap answer that makes the app *usable and
safe* on iPhone, costs nothing, commits to no architecture, and produces the
signal that decides Phases 2–3.

There is also a **data-loss** dimension that makes Phase 1 more than a
convenience. See §7.

## 2. Primary target (Phase 1) — the local file round-trip

An iPhone user must be able to:

1. **Save a dive out** to a destination *they choose* — realistically iCloud
   Drive or On My iPhone, via the Files app.
2. **Read dives back in** from that same place.

Both halves are required. Export without import is a dead end that produces
files the user can never get back into the app; that's arguably worse than no
export at all, because it looks like a backup and isn't.

### 2.1 Out — Web Share, not `<a download>` — **built**

`downloadBlob()` ([js/app.js:1638](js/app.js:1638)) creates an object URL and
clicks a synthetic `<a download>`. On iOS Safari this is a poor fit: the user
gets no choice of destination, the file lands in Downloads, and they're then
back in the download-then-move flow we're trying to kill. (CLAUDE.md already
records that this same trick silently no-ops in WKWebView on the Tauri shell —
this helper has form for platform-specific failure.)

The fix is **Web Share API Level 2** — `navigator.share({ files: [...] })` —
which opens the iOS share sheet with "Save to Files" as a target, letting the
user drop the file straight into iCloud Drive in one gesture.

Implementation notes, all of which are places this can go wrong:

- **Feature-detect with `navigator.canShare({ files: [...] })`**, not
  `navigator.share` alone. Level 1 (text/URL sharing) is far more widely
  supported than file sharing; testing for `share` will produce false positives
  and a runtime throw.
- **The payload must be `File` objects, not `Blob`s.** `new File([text], name,
  { type })`.
- **Transient activation is strict on iOS.** The call must happen inside the tap
  handler with as little `await` in front of it as possible. Build the file
  contents synchronously where feasible; a long async prelude can lose the
  gesture and the share sheet silently won't open.
- **MIME type needs testing.** `text/markdown` is correct but the iOS share
  sheet filters targets by type and unusual types can behave oddly. If `.md`
  proves awkward, `text/plain` is the fallback — test before assuming.
- **Multi-file shares are inconsistent on iOS.** A dive with footage and/or
  profile sidecars is 2–3 files. Prefer sharing the `.md` alone for a single
  dive; for "export all", share the existing zip
  ([js/app.js:1516](js/app.js:1516)) as one file rather than N loose ones.

**Shipped as** `shareOrDownload(filename, blob)` ([js/app.js:1682](js/app.js:1682)),
called with no prior `await` so the transient-activation gesture survives.
Prefers Web Share, falls through to the unchanged `downloadBlob()` when the
platform can't share files or the user cancels (`AbortError` is swallowed, not
treated as failure — mirrors the existing `showSaveFilePicker` cancel handling
in `downloadDiveCard()`). Both call sites route through it: `downloadMd()`
([js/app.js:1698](js/app.js:1698)), reached by the single-dive "Download .md"
action, and the bulk zip export in `exportAllDives()`
([js/app.js:1543](js/app.js:1543)). No existing behaviour changed on any
platform that can't share — see §11 for how that was confirmed on desktop
Chrome, which still takes the pre-existing `showSaveFilePicker`/
`showDirectoryPicker` branches ahead of either call site.

### 2.2 In — file input import — **already built, no new code needed**

Turned out this didn't need building. `<input type="file" id="import-md-input-data"
multiple accept=".md">` ([index.html:722](index.html:722)) already exists in
Settings & data → "Dive files", wired to `importDivesFromFiles()`
([js/obsidian.js:111](js/obsidian.js:111)), and that section is unconditional
markup — not gated behind `isShell()` or a desktop check — reachable on iOS via
the mobile floating cog exactly like every other panel. A plain `accept=".md"`
file input opens Safari's native Files picker, iCloud Drive included, with no
special API needed. `importDivesFromFiles()` already dedups on filename-or-
divenum+date, normalises CRLF (Proton/Android line endings), and merges rather
than overwrites footage/abundance/clip data on a re-import.

CLAUDE.md's "Not yet built → Mobile import from device" item is **stale** — it
describes wanting this on History specifically for mobile convenience, but the
underlying capability already exists and is already reachable. Worth a follow-up
doc fix, not new engineering.

### 2.3 Home-screen install prompt — **built**

iOS has no `beforeinstallprompt`. An iPhone user will not discover "Add to Home
Screen" on their own, and it matters here for a non-obvious reason: **installed
web apps get materially better storage retention than tabs** (§7). Safari 26
made every home-screen site open as a web app by default, so the install itself
is now a clean path — it's purely a discovery problem.

**Shipped** as a dismissible `.info-box` card at the top of Settings & data
([index.html:610](index.html:610)), gated by `_isIosSafariBrowserTab()`
([js/app.js:1272](js/app.js:1272)) — true for iPhone/iPad Safari outside
standalone mode, false once installed (checked via `navigator.standalone` and
the `(display-mode: standalone)` media query) or after a one-time dismissal
(`divelog-ios-install-seen` in `localStorage`, mirroring the existing
`divelog-welcome-seen` pattern). iPadOS reports its platform as `MacIntent`
with touch support rather than an iPad-identifying UA string, so detection
also checks `maxTouchPoints > 1` alongside the UA regex. Placed in Settings
rather than the Log panel deliberately — it reaches the user at the moment
they're already thinking about backup/storage, not mid-logging.

Also shipped in the same pass: an unconditional, best-effort
`navigator.storage.persist()` call in the boot sequence
([index.html:968](index.html:968)) — silent on Safari (no permission dialog,
heuristic-graded), never blocking, no UI dependency.

## 3. Structurally closed doors

These are not "hard" or "not yet" — they are closed, and re-opening them is not a
matter of effort.

### 3.1 iCloud Drive as a file target — impossible from the web

There is no iOS analogue of Android's SAF. WebKit has **never** shipped the File
System Access API picker methods (`showDirectoryPicker` / `showSaveFilePicker`)
on any platform, and as of Safari 26.x still hasn't. Safari implements only the
**Origin Private File System** (`navigator.storage.getDirectory()`) — a sandboxed
area invisible to the Files app and useless as a sync target.

A PWA cannot write into iCloud Drive. The only route to iCloud Drive is the user
mediating it via the share sheet, which is exactly what §2.1 does.

### 3.2 Proton Drive — structurally unusable as a sync backend

Luke's cloud storage of choice, and it can never be the product's sync
transport. Proton's end-to-end-encrypted provider exposes cloud-only files that
the browser cannot read — CLAUDE.md already records this as the reason Proton is
pinned to download-then-move. The E2E property that makes Proton worth choosing
is the same property that makes it programmatically inaccessible. There is no
API that fixes this.

**The useful reframe: personal storage choice and product sync transport do not
have to be the same system.** Proton remains the personal archive. It simply
isn't what the app syncs through.

### 3.3 Google Drive — ruled out, but not for the obvious reason

This one reversed twice, so the reasoning is worth recording precisely.

- **First ruled out on the `drive.file` scope** — it grants access only to files
  the app created or the user explicitly picked, so files written by the Tauri
  shell into a synced folder would be invisible to the PWA. **This objection was
  wrong for the actual use case.** It only bites the Mac-writes/phone-reads path,
  which is Luke's personal workflow (and is manual today anyway). For a new user
  whose dives are *all* app-created, `drive.file` is sufficient — and the scope is
  per-app, not per-device, so phone and laptop browser see the same files.
- **Actually ruled out on public-client support.** Google's Identity Platform
  does not support public clients under the "Web application" client type — the
  code exchange always requires a `client_secret`. That kills no-backend
  authorization-code + PKCE. The available SPA path is the Google Identity
  Services token model, which needs no secret but yields ~1-hour access tokens
  with no refresh token, relying on hidden-iframe silent renewal that Safari's
  tracking prevention is hostile to. It degrades worst on precisely the platform
  this brief targets.

*(This was flagged above as worth confirming before ever acting on it — and a
directly related claim in the SAME family, for the "Desktop app" client type,
turned out to be wrong when actually tested live: see
`BRIEF-footage-cloud-hosting.md` §4.3/DECISIONS.md, 2026-07-27. That
correction doesn't overturn THIS finding — a Desktop-app client's answer
turned out to be "embed the secret non-confidentially," which is exactly what
the native/Tauri case already does for footage hosting, and is a real,
Google-sanctioned pattern there. Whether the same move rescues the
**Web-application/pure-PWA** case is a genuinely open, unchecked question, not
a settled "no" — it wasn't re-tested, and it differs from the Desktop case in
at least two ways that could matter: whether Google's token endpoint sends
permissive CORS headers for a request originating from browser JS at all (the
native path sidesteps this entirely — reqwest calls aren't subject to CORS,
which is the documented reason the Admiralty tide-events integration already
routes through native Rust rather than a page fetch), and Web-application
clients register a fixed HTTPS redirect_uri rather than getting the loopback
flexibility a Desktop-app client does. Worth one real check before either
trusting or discarding this section's conclusion further — not scheduled.)*

### 3.4 Real iCloud Drive files — closed to any browser-based approach, backend or not

Distinct from 3.1–3.3 in an important way: this one isn't fixable by adding a
backend, because there's no token for a backend to hold in the first place.

**Sign in with Apple has exactly two scopes: `email` and `name`. That's the
entire surface.** No storage scope exists, and no backend design changes that —
SIWA proves identity and stops there, permanently.

**"iCloud" is actually two separate, unrelated Apple APIs, easy to conflate:**

| | CloudKit | Ubiquity containers ("real" iCloud Drive) |
|---|---|---|
| Visible in the Files app | No — invisible database | Yes — real files |
| Reachable from a browser/Worker | Yes — REST over HTTP | **No — native Swift/Obj-C only** |
| Needs Apple Developer Program | Yes | Yes |

CloudKit (§4) is reachable from a browser. The **ubiquity-container** API
(`NSFileManager`/`UIDocument`) is what gives an app a folder that shows up as
real files in Files — the thing "iCloud Drive" colloquially means — but it only
exists inside a compiled native app's process. There is no HTTP endpoint, no
OAuth token, nothing any browser or Cloudflare Worker could ever call. It isn't
closed by cost — it's closed by category, independent of any backend. The only
way to it is a real native (or Tauri-wrapped) app; see §12/§14.

**The $99/year Developer Program gates both rows of that table identically** —
it isn't "the iCloud tax," it's the baseline App Store/Developer Program
membership, paid regardless of whether iCloud is touched at all (confirmed
directly in §12.4, where a real competitor pays it purely for App Store
distribution and doesn't use CloudKit at all).

**Checked whether the EU's DMA fight with Apple changes this — it doesn't.**
Article 6(7) forces the *opposite* direction: letting *rival* cloud providers
interoperate with iOS as deeply as iCloud does, not opening iCloud itself up to
third parties. Italy opened a formal DMA probe into Apple over iCloud
interoperability in June 2026; a July 2026 court ruling closed off Apple's
gatekeeper-status legal challenge; but as of March 2026 zero of 56 formal
interoperability requests had produced a shipped remedy. Not something to plan
around.

## 4. The sync options, if and when Phase 3 happens

**A note before reading this table: its verdicts are superseded — see §12.**
The mechanics below (CloudKit's auth flow, the PKCE providers, Safari's
token-persistence caveat) are still accurate and kept as reference. What
changed is the *ranking* — once a real competitor (Submersion, §12.3) proved a
zero-backend native path works, and once the actual goal got named precisely
enough to check backends against at all (§12.1). **Native iOS shell (Tauri) is
the current leading candidate, not CloudKit.**

| Option          | Install needed       | Backend  | Data on our infra | Cost    | Verdict                   |
| --------------- | -------------------- | -------- | ----------------- | ------- | ------------------------- |
| **CloudKit**    | **None on iPhone**   | **None** | **Never**         | $99/yr  | Best iPhone fit           |
| Dropbox (PKCE)  | Account + likely app | None     | Never             | $0      | Best tech, worst adoption |
| OneDrive (PKCE) | Microsoft account    | None     | Never             | $0      | Viable, middling adoption |
| Google Drive    | Google account       | **Yes**  | Never             | $0      | Ruled out (§3.3)          |
| Own backend     | None                 | Yes      | **Yes**           | Hosting | Last resort (§6)          |

**CloudKit is the only zero-install path for an iPhone user who uses iCloud.**
Its web auth is *not* Sign in with Apple and needs no server: a public
`ckAPIToken` from CloudKit Dashboard plus a `ckWebAuthToken` obtained through
Apple's own hosted sign-in dialog. No client secret, no OAuth token exchange,
nothing for Cloudflare to relay — Pages stays a static host. Apple's own
documentation confirms the developer **cannot read** a user's private database;
it's protected by a key hierarchy rooted in a per-user CloudKit Service key
generated on their device, and it bills against their free iCloud tier.

Two honest caveats:

- **It's iOS-only.** CloudKit needs an Apple ID, so it's a *second* backend
  alongside Android's SAF folder sync, not a replacement. That's consistent with
  the principle that actually matters — use what's already on the device — and
  the codebase already supports mutually-exclusive backends.
- **It's a record database, not files.** Store the generated markdown as a text
  field on one CKRecord per dive (keyed on `uid`) and the existing
  `generateFrontmatter` / `parseFrontmatter` round-trip is preserved with minimal
  new code. Dives are a few KB.

**PKCE was never ruled out as a mechanism** — it's provider-agnostic, and both
Dropbox and OneDrive (`Files.ReadWrite.AppFolder`, personal accounts, no secret)
support it cleanly with proper app-folder models. The blocker is adoption: a
target iPhone user probably has neither.

**A caveat spanning every browser-only OAuth path:** Safari's tracking
prevention makes long-lived token persistence fragile. Dropbox has the best
story (long-lived PKCE refresh tokens, no secret needed); Microsoft's SPA refresh
tokens run a 24-hour sliding window. iPhone users will re-authenticate more often
than Android users. Not fatal for occasional-use dive logging, but expect it
rather than discover it.

## 5. The $99 question

There is **no** way to give an iCloud-only iPhone user real sync without the
Apple Developer Program. iCloud has no web-writable API except CloudKit, and
CloudKit containers require paid membership. Every free path routes through a
provider that user probably doesn't have.

Worth correcting a common misreading: **there is no App Store review in this
path.** CloudKit JS / Web Services runs in the PWA — no app is submitted, no
review, no rejection risk. The $99 is membership only.

The right posture is therefore **defer, not avoid**: don't pay before the pilot.
If iPhone users show up and ask for sync, $99 against proven demand is trivial.
If they don't, nothing was spent.

## 6. Data-custody position

Holding dive logs on our own infrastructure is the outcome to avoid, and the
reason is specific rather than general: **a dive log is GPS coordinates plus
timestamps — precise location history.** The gap between "we hold email
addresses" and "we hold emails *and* location histories" is far wider than the
gap between holding nothing and holding emails.

A mailing list is planned, so a privacy policy is required regardless — but that
obligation is orthogonal to the sync decision and does **not** unlock building an
own-backend store. With a list at a reputable ESP, the entire personal-data
footprint stays "some email addresses at a processor": standard policy, standard
DPA, standard unsubscribe, boilerplate. CloudKit and the PKCE options keep it
that way. An own-backend store does not.

Own backend (Sign in with Apple or email link + D1/R2) is the **last resort**,
reached only if CloudKit's PWA spike (§8) fails and iPhone demand is proven. Note
that Sign in with Apple genuinely does need a Cloudflare Worker — its client
secret is an ES256 JWT signed with a `.p8` key that cannot ship in a client.

*(Not legal advice. If a paid launch happens, get the characterisation checked —
and note that UK PECR requires consent for marketing email, so use double opt-in
and keep the consent record.)*

## 7. Storage durability — why Phase 1 isn't just convenience

Safari caps script-writable storage at **seven days without interaction**.
CLAUDE.md currently describes `localStorage` as the *primary* store on mobile —
on iOS that is a live data-loss risk, not a design preference. A diver who logs a
trip and doesn't reopen the app for a fortnight could plausibly lose it.

Mitigations:

- **Home-screen install** (§2.3, built) — installed web apps get better retention.
- **`navigator.storage.persist()`** (§2.3, built) — silent best-effort ask.
- **Export nudge** — surface how long since the last export, and make §2.1 the
  one-tap answer. **Not built** — the only Phase 1 item still open; low-effort,
  worth a follow-up pass rather than blocking on it.
- **Tell pilot testers plainly** that the build is local-only, so they treat
  export as real rather than optional. Testers losing dives would poison exactly
  the signal the pilot exists to read.

## 8. Phases

- **Phase 1 — local round-trip. Built 2026-07-21, $0.** §2: Web Share export
  and the iOS install/persist nudge shipped; file-input import turned out to
  already exist. No accounts, no backend, no Developer Program, no
  architectural commitment. Export-staleness nudge (§7) remains open.
- **Phase 2 — pilot.** Small iPhone group. The question is *"do iPhone users want
  this app"*, not *"which backend do they prefer."* Sync is not on the table yet.
- **Phase 3 — sync, only if Phase 2 says so.** Spike CloudKit sign-in inside an
  installed iOS **standalone** PWA before anything else — see §9. If it works,
  build CloudKit. If it doesn't, reassess against §4 with adoption data in hand.
  **Superseded in direction, not urgency, by §12** — the leading candidate is
  now a native iOS shell, not CloudKit; §14 already did the concrete BLE/fs
  feasibility check.

## 9. Open risks and unknowns

1. **CloudKit sign-in in an iOS standalone PWA — unverified, and gates Phase 3
   entirely.** Standalone-mode auth is a known iOS trouble spot (popup
   interception, double-prompts, flows that don't return control). CloudKit's
   redirect-with-custom-callback-URL option is the right shape, and redirects
   behave better than popups post-iOS 12.2, but no current confirmation was
   found. **One day of spiking, before any Phase 3 work.**
2. ~~**Web Share file-type behaviour on real iOS Safari**~~ — **Resolved
   2026-07-21.** Confirmed on a real iPad after production deploy: both the
   single-dive "Download .md" and the bulk "Export all" zip open the share
   sheet, and "Save to Files" → **iCloud Drive** works as a destination — the
   exact target Phase 1 exists for. See §11 for the full record. Desktop
   testing (§11 below) had verified the code's logic branches correctly but
   couldn't exercise Safari's own share-sheet UI — no desktop browser reached
   the `shareOrDownload` code path in that session, since Chrome's native
   `showSaveFilePicker`/`showDirectoryPicker` pickers pre-empt it — the real
   iPad test is what actually closed this.
3. **CloudKit Web Services' core reference lives in Apple's documentation
   archive.** Not deprecated — the API-token pages are current-generation and the
   forums show activity — but there's no visible evidence of active investment.
   Strategic risk of building on something Apple is content to let sit.
4. **Google's public-client restriction** (§3.3) deserves one confirmation before
   being treated as final, given it's the sole reason Drive is out.
5. **BLE on iOS gates the native-shell option (§14) — full detail in
   `BRIEF-dive-computer-sync.md` §20, not duplicated here.** Short version:
   Option A's BLE design there was already correctly native-compile, not a
   WASM-reuse shim, so this isn't an architecture change — it's a plugin
   maturity/signing question the same spike (§20's) should resolve.
6. **`tauri-plugin-blec`'s iOS signing issue — severity unverified.** Its own
   maintainer notes problems specific to iOS code signing; unknown whether
   this is a minor provisioning-profile annoyance or a real blocker. See
   `BRIEF-dive-computer-sync.md` §20 for the full finding.
7. **"Documents in iCloud" inside a Tauri-generated Xcode project — not
   directly confirmed, and now known to require a specific build type.** The
   underlying entitlement
   (`com.apple.developer.ubiquity-container-identifiers`) is confirmed
   (§12.7) to work only in a sandboxed (Mac App Store / iOS) or properly
   dev-signed build — never a free/ad-hoc-signed one, verified independently
   via a real competitor's own diagnosed build restriction, not assumed.
   Still genuinely unconfirmed: whether *configuring* the capability inside
   a Tauri-generated Xcode project is as ordinary as reasoned (§14.2). Both
   questions are gated on the same eventual spike.

## 10. Reversals recorded

Kept because the conclusions look arbitrary without them:

- **Dropbox was recommended, then withdrawn.** Recommended on data-model fit
  (its app-folder model maps cleanly onto the existing file-based sync seam);
  withdrawn on adoption — an iPhone user who must install Dropbox and create an
  account before logging a dive is already lost. Fit lost to friction.
- **The bidirectional-sync requirement was overweighted.** Early reasoning tried
  hard to preserve Mac-writes/phone-reads. That path is *manual today* and doesn't
  exist for any other user. Optimising to protect it produced the wrong
  provider ranking, and is what wrongly disqualified Google (§3.3).
- **CloudKit was argued against, then for.** Argued against on record-vs-file
  mismatch and vault isolation; both objections shrank once the target user was
  correctly identified as someone with no vault, no Obsidian, and no willingness
  to install anything.
- **CloudKit was the clear frontrunner, then displaced.** Recommended
  repeatedly (§4, §5) as "the only zero-install iPhone path" — true as far as
  it went, but resting on an unstated assumption that *some* iCloud-tied
  backend was necessary at all. A real open-source competitor (Submersion,
  §12.3) proved a zero-backend, zero-CloudKit path works in practice, which
  reframed the whole comparison around what actually keeps the file-access
  promise (§12.1) rather than what's cheapest to reach from a browser.
- **A Shoal-owned backend looked like the necessary answer once CloudKit's
  database-not-files shape was rejected — until the promise-keeping analysis
  (§12.1) separated two different wants that had been getting treated as
  one.** "Users keep their files if Shoal disappears" is already satisfied by
  Phase 1's export; "sync feels seamless" is a separate, legitimate want a
  backend serves but doesn't uniquely satisfy — the native-shell option serves
  both without taking on any data custody at all.

## 11. Phase 1 — how it was verified (2026-07-21)

No iPad/iPhone hardware was used for this pass — verification was via desktop
Chrome with in-page property overrides, which checks the code's logic but not
Safari's actual share-sheet UI (see risk §9.2, the immediate next check on real
hardware). What was confirmed:

- **`shareOrDownload()`'s three branches**, tested directly by stubbing
  `navigator.share`/`navigator.canShare` in-page (desktop Chrome's own
  `showSaveFilePicker`/`showDirectoryPicker` pre-empt both real call sites, so
  neither was reachable via a normal UI click without risking an untestable
  native OS dialog): a successful share calls `navigator.share` with a correctly
  named/typed `File`; an `AbortError` (user cancels) does **not** fall through
  to `downloadBlob()`; `canShare() === false` **does** fall through. All three
  matched intent.
- **`_isIosSafariBrowserTab()` / `maybeShowIosInstallCard()` /
  `dismissIosInstallCard()`**, tested by overriding `navigator.userAgent` /
  `platform` / `maxTouchPoints` / `standalone`: an iPhone UA outside standalone
  mode shows the card; the same UA in standalone mode does not; dismissing sets
  the `localStorage` flag and hides it; a later call with the flag set stays
  hidden. All matched intent.
- **No regressions**: Settings & data, History, and the dive-file detail view
  all rendered with no console errors; the pre-existing desktop
  `showSaveFilePicker` "Download .md" flow (opens a real native save dialog)
  and the Folder-mode UI were confirmed unchanged.
- **A genuine near-miss, worth recording**: clicking "Download .md" for real on
  desktop Chrome opens a native macOS save dialog that a tab-scoped screenshot
  can't see, and was sitting open silently until cancelled with Escape — a
  reminder that automated testing of anything touching `showSaveFilePicker` or
  `navigator.share` on desktop can leave an invisible native dialog blocking the
  browser; stubbing the API in-page (as above) is the safer default, native
  triggers should be exercised deliberately and closed immediately after.
- **A tooling trap hit and worth flagging for next time**: this browser
  profile's *first* load served a stale cached `js/app.js` despite fresh files
  on disk and a bumped `sw.js` `CACHE` version — leftover service-worker
  registration + Cache Storage from earlier, unrelated local testing on
  `localhost:8080`. Unregistering the service worker and clearing
  `caches` directly (then a hard reload) fixed it. This is exactly the class of
  problem CLAUDE.md's "Known constraints" section already warns about; the
  extra wrinkle here is that it can survive *between* dev-server restarts on
  the same origin, not just between edits within one session — worth checking
  `navigator.serviceWorker.getRegistrations()` first if a change "isn't
  showing up" during local testing.

**sw.js `CACHE` bumped to `divelog-v238`** ([sw.js:7](sw.js:7)) — both edited
files (`js/app.js`, `index.html`) are in `SHELL_CRITICAL`.

Committed as **2.97** and pushed to `main` by Luke directly — this sandbox has
no GitHub credentials (`git push`/`fetch` to `origin` both fail with "could not
read Username for 'https://github.com'"), so the push and the real-device test
below both happened outside this session.

### Real-device confirmation (iPad Safari, production, 2026-07-21)

Closes risk §9.2. Before the push, Luke's iPad was still hitting the
pre-Phase-1 production build — confirmed by the "Folder" mode error still
reading the old "Use Chrome on Android" text, and a single-dive download
landing straight in Downloads with no share sheet, exactly the pre-Phase-1
behaviour. After Luke pushed 2.97 to `main` and Cloudflare Pages redeployed:

- The Folder-mode error now reads the updated Import/Export text — confirms
  the new build is actually live.
- **Bulk "Export all"** (the zip path) opens the share sheet and offers a real
  folder choice — Luke picked **iCloud Drive** and it worked. This is the
  literal target Phase 1 was built for.
- **Single-dive "Download .md"** also opens the share sheet, not a direct
  Downloads drop — confirming both `shareOrDownload()` call sites work
  identically on real iOS, not just in the stubbed desktop tests above.

Both remaining unknowns from the desktop-only pass — does iOS's share sheet
actually offer iCloud Drive as a target, and does a `.md`/`.zip` MIME type
behave normally through it — are answered yes. Phase 1 is fully verified, not
just logic-tested.

**Not yet done:** the iOS install card and `navigator.storage.persist()` (§2.3)
haven't been separately confirmed on real hardware — only the export path has.

## 12. Phase 3 reconsidered — what actually keeps the promise

Everything in §4–§6 was written before two things happened: Luke named the
actual value at stake precisely, and a real competitor's architecture was
checked against it. Both changed the shape of Phase 3 enough to warrant a new
section rather than silent edits to the old one.

### 12.1 The value: users keep their files even if Shoal disappears

Luke's stated priority, verbatim in spirit: *"Shoal's promise that users still
have access to their files, even if Shoal disappears, is vital — I don't want
to break it."* Sharper and more specific than "minimise data custody" (§6) —
this is about **survivability**, not just privacy.

**The load-bearing insight this section exists to record: a Shoal-owned
backend does not, by itself, keep that promise.** A backend just relocates
lock-in — from Apple's CloudKit database to Shoal's own bucket. If Shoal
disappears, so does the server, unless there is a *live, working export to
storage the user already owns*. The "outlives Shoal" guarantee is a
**client-side property** — open file format + user-owned storage + a working
export — not something a backend can supply. Phase 1 (§2) already delivers
exactly that on iPhone today: Web Share to the user's own iCloud Drive, in the
same portable `.md` format Obsidian and every other path already uses,
re-importable via the existing file input. **Whatever gets built in Phase 3 is
sync convenience layered on top of a promise that is already kept**, not a
rescue of one that's currently broken.

This reframes CloudKit specifically. Apple's own developer documentation
concedes the exact problem: developers "should provide their own method for
users to get a copy of data stored in their CloudKit containers" — Apple is
saying plainly that CloudKit data isn't user-portable by default, and building
that portability would be Shoal's job, not Apple's. That's the antithesis of
the markdown-files decision this whole project is built on (CLAUDE.md → "Data
layer").

### 12.2 Why iPhone feels so much more restrictive than the Mac

Worth naming directly, since it's what prompted this whole re-think: **the
axis isn't iPhone vs. Mac, it's native vs. web.** The Mac isn't privileged for
being a Mac — it's privileged because Shoal built it an escape hatch (the
Tauri native shell, real `fs` access) and because desktop Chrome/Edge ship the
File System Access API. iPhone has neither: Apple keeps every iOS browser on
WebKit (no Chromium engine to borrow, ever), and there's no native Shoal on
iOS — yet. Shoal running in Brave *on the Mac* is exactly as locked down as iOS
Safari is — which is the entire reason Obsidian sync exists as the
Brave-specific path. The restriction axis is "browser sandbox," and the Mac
simply has two doors out of it that iOS-the-web-platform does not.

### 12.3 Submersion — a real competitor proving the native, zero-backend path works

Researched directly (not from memory) at Luke's request:
**[Submersion](https://submersion.app/)**
([GitHub: submersion-app/submersion](https://github.com/submersion-app/submersion))
is a real, actively-developed, open-source (GPL-3.0) dive-logging app —
recreational and technical diving, UDDF 3.2 import/export, 300+ dive computers
via `libdivecomputer` over USB/BLE — running from one **Flutter** codebase
across iOS, Android, macOS, Windows, and Linux.

Its data story, quoted directly from its own materials:

> "All data is stored locally in SQLite... Optional cloud sync via iCloud or
> Google Drive. No account required — sync is opt-in and your data stays
> yours."
>
> "There is no proprietary backend server. Instead, Submersion delegates
> synchronization to existing cloud providers — users can store their SQLite
> database files in iCloud (iOS/macOS) or Google Drive (Android) directly."

No CloudKit. No custom backend. No account or login system at all ("no
sign-up, no email, no tracking"). The mechanism is the ordinary, free, native
**"Documents in iCloud"** file-mirroring capability — the same one countless
notes and document apps use — which transparently syncs an app's local files
into the user's own iCloud Drive at the OS level, with zero API calls, zero
OAuth, zero server.

**This is not a clever trick Submersion found and Shoal missed. It's a
category Shoal opted out of by staying browser-only.** "Documents in iCloud"
is native-only — there is no web/PWA equivalent, confirmed independently in
§3.4. Submersion's actual answer to "how do you solve iPhone sync" is "we
didn't build a PWA."

### 12.4 The $99 isn't an iCloud tax — it's the App Store tax

Submersion pays Apple's $99/year Developer Program membership too — not
because of iCloud specifically, but because *any* native iOS app needs it to
distribute via the App Store or TestFlight, regardless of whether it touches
iCloud at all. This clarifies §5: the fee was never really gating "access to
iCloud" — CloudKit and the native ubiquity-container API (§3.4) both sit
behind the exact same membership, because it's the entry fee to Apple's
developer ecosystem generally, not a toll on iCloud specifically.

### 12.5 The reframed fork

| | Keeps the promise via | Data custody | Cost | Solves BLE too? |
|---|---|---|---|---|
| **A. Native iOS shell** (Tauri) | Real `.md` files, natively, in the user's *own* iCloud Drive | **None** | $99/yr + App Store review + a 2nd shell to maintain | Yes, if §14's spike pans out |
| **B. Shoal-owned backend** (CF Worker + R2, §13) | Ciphertext + the export Phase 1 already built | Ciphertext only, if genuinely zero-knowledge | ~$0 → $5/mo + real privacy obligations | No — orthogonal problem |
| **C. Stay on Phase 1** | Export/import exactly as it is today | None | $0 | No |

Option B's own honest weak point: Luke chose **Proton** for his personal
storage specifically because it's zero-knowledge — a Shoal backend should be
held to that same bar if it's built at all (§13 assumes this). But even a
properly zero-knowledge backend doesn't out-perform option A on the actual
promise: **the export is still what keeps the promise in every column of this
table, including B's.** A backend only adds seamless multi-device sync on top
— a real, different want, not a rescue of one that's broken.

**Given the promise is the stated top priority, option A serves it more purely
than B**, and — critically, per §12.4 — needs the *same* $99 a
backend-avoiding path would still have to pay if native BLE ever matters (it
does; see §14). B is the right answer only if the actual goal is "seamless
sync, Safari, no install" as a distinct want from the promise — which is
legitimate, just a different thing to be building toward.

### 12.6 The concrete unlock: this reuses Tauri, it doesn't replace it

Submersion had to build a whole native app from zero, in a framework (Flutter)
Shoal doesn't use. **Shoal doesn't have to.** The macOS Tauri shell already
exists — same `webdist/` web build, same Rust command layer, same `isShell()`
seam already threaded through the codebase (`js/app.js`, `js/video.js`,
`js/planner.js`, …). Adding an iOS target is extending an investment already
made, not starting a second one. See §14 for exactly how far that reuse
actually goes once BLE is factored in — it's real, but not free.

### 12.7 iCloud sync independently re-verified from source — and a build-type restriction that applies directly to Option A (2026-07-24)

§12.3 took Submersion's own marketing copy at face value ("Optional cloud
sync via iCloud or Google Drive... via existing cloud providers"). A
follow-up session went into the actual source and internal design docs
instead of trusting that description, specifically to answer: does their
iCloud sync *genuinely work*, and precisely how.

**The mechanism is now confirmed, not assumed.**
`ios/Runner/ICloudContainerHandler.swift` and the Dart services around it use
only `FileManager.url(forUbiquityContainerIdentifier:)` and
`ubiquityIdentityToken` — zero references anywhere to `CKContainer`/
`CloudKit`/`CKRecord`. This is the plain "Documents in iCloud"
ubiquity-container file API §12.3 already described, not CloudKit's database
API — independently verified from source, not inferred from Submersion's own
description of itself.

**A real cross-device sync bug was found and traced through to a genuine fix
in the current source** — stronger evidence than a roadmap checkbox claiming
"done." A dated internal diagnosis
(`docs/superpowers/findings/2026-06-02-icloud-sync-diagnosis.md`) found that
a receiving device's merge logic caught any exception thrown while applying
an incoming record and silently relabelled it a "conflict" instead of
applying it — sync looked like it did nothing, no error surfaced, reproduced
device-independently (not iCloud-specific — any transport would have hit
it). The current `sync_service.dart` has a materially different, HLC-based
merge engine with a `failed` counter tracked separately from `conflicts`,
and a comment sitting directly on the fix: *"An apply error is a real
failure, not a 'conflict'... Masking apply errors as conflicts is what hid
the cross-device no-op."* Real problem, real fix, verifiable in the source —
the strongest evidence this brief has found that "Documents in iCloud" sync
is a genuinely workable transport, not just a plausible-sounding one.

**The new, load-bearing finding: a Developer-ID (non-App-Store,
non-dev-signed) build cannot use iCloud at all — confirmed from Submersion's
own root-cause writeup, not inferred.** Their design doc for handling this
(`docs/superpowers/specs/2026-06-16-icloud-unsupported-build-ux-design.md`)
states it as a verified root cause:

> Apple only honors iCloud entitlements
> (`com.apple.developer.ubiquity-container-identifiers`) for **Mac App
> Store** (sandboxed) or **Development** (dev cert + provisioning profile)
> builds. A **Developer ID** build — required for direct/GitHub distribution
> — **cannot use iCloud at all**.

Submersion's own free, GitHub-distributed macOS build ships with iCloud keys
stripped from its entitlements file for exactly this reason, and falls back
to S3-compatible storage for those users — they had to build a dedicated
"honest availability" feature (disable the iCloud tile, explain why) rather
than let it fail with a misleading "sign in to iCloud" error.

**This sharpens §12.4, it doesn't just repeat it.** §12.4 already
established that the $99/year fee is really an "App Store tax," not an
"iCloud tax" — true, but incomplete. This finding shows the restriction is
narrower and harder than that framing implies: it isn't only that
*distributing* via the App Store costs $99. The iCloud entitlement itself is
refused to any build that isn't sandboxed or dev-signed, independent of how
the app reaches a user's device. A hypothetical future where Apple allowed
cheap or free iOS sideloading (the EU DMA angle already noted in §9,
unresolved as of this writing) would not, on its own, unlock iCloud for a
Shoal build distributed that way — the entitlement gate sits a level below
the distribution question. For Shoal specifically: **Option A's "Documents
in iCloud" path only exists in the same App-Store-or-dev-signed world the
$99 already implied — there is no cheaper door into it that the current
framing might have left open.** The reframed fork in §12.5 doesn't need to
change (Option A already assumed the $99 + App Store cost), but the
reasoning for *why* is now more precise, and risk item #7 (§9) carries this
forward into the eventual spike.

## 13. If a backend is ever built anyway — Cloudflare as the token-handler platform

This section is kept for completeness and because the research is real and
reusable, but per §12 it's no longer the leading Phase 3 candidate, and per
Luke's own explicit call, **Dropbox specifically is off the table** ("not
interested in Dropbox") — so treat this as a reference architecture for *if* a
similar third-party-cloud-plus-OAuth path (OneDrive, or something else) is ever
wanted, not a live plan.

### 13.1 Cloudflare's cost shape genuinely fits "minimal now, scales later"

Verified current numbers (2026):

- **Workers**: 100,000 requests/day free, resetting daily — $0/month at
  zero-to-a-handful of users. Paid tier is $5/month base (10M requests + 30M
  CPU-ms included), then $0.30/million requests beyond that. Cost tracks real
  traffic, not a flat idle-server bill.
- **Workers KV**: 1GB storage / 100K reads / 1K writes per day free. Paid:
  reads $0.50/million, writes **$5/million** (16× more expensive — the thing
  to watch if a token-refresh-per-request pattern is ever built), storage
  $0.50/GB-month.

### 13.2 Cloudflare has already built (most of) the pattern

[`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)
is a real, maintained TypeScript OAuth 2.1 + PKCE library for Workers, built
for Cloudflare's own MCP-server ecosystem — not a drop-in fit for "add Dropbox
login to a dive app," but a strong reference implementation of exactly the
token-handler shape: a Worker holds a third-party provider's tokens server-side
in KV — its own security note is *"storage does not store any secrets, only
hashes of them... grant properties are stored encrypted with the secret token
as key material"* — and hands the browser a secure session cookie instead of a
raw token.

### 13.3 The architecture fork that actually matters: how much the Worker touches

- **(A) Full proxy** — the Worker holds the token *and* relays every dive-file
  read/write to the provider. Simple, but dive data (GPS, timestamps) now
  transits Shoal's infrastructure on every sync, even if nothing is logged or
  stored — a real regression against §6's data-custody position.
- **(B) Token-handler only** — the Worker's job is narrowly the OAuth dance:
  exchange the code, store the refresh token encrypted in KV, and hand the SPA
  a fresh short-lived access token on demand for it to use *directly* against
  the provider. Dive files flow browser-to-provider, never touching Shoal's
  infrastructure — only the refresh token does.

**(B) is the only one consistent with §6.** Concretely confirmed for Dropbox
specifically (even though it's not the live plan): its refresh call needs **no
app secret at all**, even server-side — PKCE covers it (`client_id` +
`refresh_token` + `grant_type=refresh_token`). So the Worker's protected-secret
surface is just each individual user's refresh token, never a shared app
credential. Worth re-checking whether OneDrive's refresh call has the same
no-secret property if this is ever revisited.

**Note this backend design is really in service of Dropbox/OneDrive-style
providers, not CloudKit.** CloudKit's `ckWebAuthToken` is already short-lived
(30 min, or 2 weeks with "keep me signed in") and scoped to one container by
design, with no separate refresh-token concept in the standard web flow — a
backend adds little marginal security value there.

### 13.4 The caveat that applies to every client-held-token option, CloudKit included

Read directly at Luke's request: Gary Archer's
[*"Basic SPA OAuth Workflow"*](https://github.com/gary-archer/oauth.blog/blob/master/public/posts/basicspa-oauthworkflow.mdx).
The post itself is the deliberately "basic" baseline in a series — it
documents the flow's rough edges rather than arguing for an alternative
outright — but it states plainly: *"An OAuth flow for SPAs should avoid
returning refresh tokens to the browser, since it is a long-lived credential
and the browser has nowhere secure to store refresh tokens."*

The reasoning behind that line, and the reason Archer's broader body of work
argues for a backend "token handler": PKCE protects the **code exchange**, not
the token once it has landed in the page. If a bearer token — access or
refresh — sits in browser-accessible memory or storage, *any* XSS hole on the
site can exfiltrate it directly.

**This applies equally to CloudKit's `ckWebAuthToken`, a Dropbox/OneDrive
access token, or anything else the browser holds directly** — it is not a
reason to prefer one client-only provider over another, it's a gap in the
whole category. It lands harder on Shoal specifically than on a typical SPA:
CSP already runs `'unsafe-inline'` for ~130 inline `onclick` handlers, with
`esc()` escaping as the actual first line of defence rather than CSP
(`_headers`, CLAUDE.md → "Security baseline"). Today, the worst an XSS hole
gets an attacker is the user's own dive data — already local to their device.
The moment Shoal holds a live third-party token client-side, that same hole's
blast radius changes category: from "read data already on this device" to
"standing access to the user's actual cloud account."

Cheap mitigations that don't require a full BFF, if a client-only provider
token is ever held at all: keep it in memory only, never
`localStorage`/IndexedDB (a reload forces re-auth rather than leaving a
standing secret around), and prefer a provider/flow that never hands the SPA a
refresh token in the first place.

## 14. Native iOS shell feasibility — Tauri's fs and BLE plugins (researched 2026-07-21)

Directly prompted by BLE being named as the one piece that must not regress.
This section is the actual due-diligence behind §12's "option A" — not a
decision to build it, a check of whether it's buildable at all.

**The full BLE research now lives in `BRIEF-dive-computer-sync.md` §20** —
that document already owns the dive-computer-sync architecture in far more
technical depth than belongs here (it had a detailed Option A / Tauri-native
design before this session even started), so the detailed findings (plugin
licensing, maturity, the signing-issue caveat, the rejected second candidate,
and why none of it actually contradicts that brief's existing native-compile
design) were written there instead of duplicated in both places.

**The one-line summary for this document's purposes:** a credible, cleanly-
licensed Tauri BLE plugin exists (`tauri-plugin-blec`), with two real open
questions — an unconfirmed iOS signing issue, and whether Tauri's own iOS
support (stable but "not first-class," per Tauri's team) covers everything
needed — neither disqualifying, both answerable by one scoped spike against a
real dive computer before the wider iOS-shell project is treated as decided.

### 14.2 Files: likely fine, not directly verified

The official `tauri-plugin-fs` **does** support iOS — confirmed in Tauri's own
docs, including automatic handling of security-scoped resources (needed for
anything accessed outside the app's sandbox, e.g. via a file picker). The
specific "Documents in iCloud" mirroring capability that Submersion (§12.3)
relies on is very likely just an **Xcode project capability/entitlement**
layered on top of ordinary `fs` usage, not something requiring special Tauri
support — `tauri ios dev --open` opens a real, editable Xcode project
(confirmed by the exact workflow used to add the CoreBluetooth framework for
BLE, below), and turning on "iCloud → Documents" there is an ordinary,
well-worn capability toggle. **No concrete example of someone doing this
specifically inside a Tauri project was found — treat as "very likely," not
"verified," and confirm in the same spike as BLE.** §12.7 sharpens what that
spike needs to confirm: the entitlement itself only functions in a sandboxed
or dev-signed build (verified from a real competitor's own diagnosed
restriction, not assumed) — so the spike's build configuration matters, not
just whether the capability toggle exists.

### 14.3 Recommended next step

Unchanged in kind from `BRIEF-dive-computer-sync.md` §20's own
recommendation: a small, scoped spike — bare Tauri-iOS project,
`tauri-plugin-blec` wired in, talking to one real dive computer over BLE —
before treating "build the iOS shell" as decided. That single test resolves
the signing question, whether Option A's native-compile BLE design (already
correct per that brief's §6/§7b — see §20 for why nothing here contradicts
it) actually builds and runs on-device, and whether "Documents in iCloud"
configures as cleanly as expected above. All three gate how big the iOS-shell
project actually is, and none of them are known yet.
