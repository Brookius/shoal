# BRIEF — Play Store readiness, architecture verdict, UI audit

**Status:** analysis only, no code changes. Written 2026-07-29 against `main` @ `f55aa69`.

**The short version:**

1. **The architecture survives.** Single-page + no-build is not a liability inside a
   Tauri Android WebView — it's the cheapest thing that works there. The port is
   almost entirely a **Rust** problem, not a front-end one.
2. **There is a lot of UI work worth doing — just not "adopt a component
   library."** Those are different questions and the first draft of this brief
   conflated them. The audit found real, substantial problems: no input in the
   app has a programmatic label, 21 controls are below minimum touch size, 25
   `border-radius` values with no scale, ~100 button-shaped rules where there
   should be one. All of that is worth fixing. What isn't worth doing is
   *importing components* to fix it — the fixes are a token layer, ~6 CSS
   primitives, and an accessibility pass, none of which need a package. The
   **signature** layer (chart, gradients, dials, nav wave) is the product and
   stays. See §3.5 for the corrected framing and §3.6 on Material colour, which
   is a genuine win and is separable from Material components.
3. **Play readiness is mostly paperwork and wall-clock time**, and one item on it
   has a clock already running. Start there, today, before touching any code.

---

## 0 · What to do first (read this even if you read nothing else)

**Publish a public landing page + privacy policy at a URL that is not behind
Cloudflare Access.**

It is the single highest-leverage action available, because it is the shared
prerequisite for three separate things:

- The **OAuth consent screen → Production** move. This has an *active clock*:
  the consent screen is in Testing, so Google is expiring Drive refresh tokens
  every 7 days right now. Publishing requires a homepage and a privacy policy URL.
- The **Play Store listing**, which requires a privacy policy URL as a hard gate.
- **Google's reviewers and crawlers must be able to reach both.** Today the live
  site sits behind Cloudflare Access — a reviewer hitting it gets a login wall,
  which is an automatic rejection on the Play side and a verification failure on
  the OAuth side.

`landing/` already exists in the repo. This is a content task, not an engineering
one, and it unblocks two workstreams for the price of one.

> **Status 2026-07-29 — policy written, hosting still undecided.**
> `landing/privacy.html` now exists, written from an audit of the code's actual
> outbound calls (every third party in it maps to a real call site), and is
> linked from the landing-page footer. It is self-contained and passes
> `landing/_headers`' stricter CSP.
>
> **Decided 2026-07-30 — root domain flip, not a new subdomain.** Turns out
> `landing/` was already a separate live Cloudflare Pages deployment, bound to
> `app.diveshoal.com`, with the PWA at root — which the original recommendation
> below didn't know. Rather than pick a third subdomain, the call is to **flip
> which content sits at which URL**: `diveshoal.com` (root) → landing,
> `app.diveshoal.com` → PWA. More conventional pairing, reads better on a store
> listing, and — since `robots.txt` (`Disallow: /`) deploys with the app
> project and `landing/` carries none at all — **the flip is a pure Cloudflare
> custom-domain rebind, no robots.txt or code change required**; each
> project's existing indexing posture (app blocked, landing crawlable) travels
> with it. Verified no code hardcodes the domain — Drive OAuth's redirect is a
> `127.0.0.1` loopback, unaffected either way.
>
> **Three follow-ups the rebind itself creates, do these at the same time:**
> 1. `landing/index.html`'s two "Try Shoal" CTAs hardcode `https://diveshoal.com`
>    — repoint to the PWA's new URL the moment the rebind lands (not before;
>    it would break the button in the interim).
> 2. **Cloudflare Access must move with the app** to its new subdomain, and
>    root/landing must stay outside it — same requirement as below for
>    reviewers/crawlers reaching the policy.
> 3. **Verify the domain in Search Console via DNS TXT at the apex** (a
>    *Domain property*, not a URL-prefix property) — covers every subdomain in
>    one unified report, needs no code on either site, and doesn't add
>    crawling/tracking beyond what Googlebot already does to any public page.
>    The app stays out of its reports regardless, since `robots.txt` already
>    excludes it.
>
> Original reasoning kept below since the *principle* (marketing must be a
> separate origin from the PWA's service worker, reachable outside Access) is
> unchanged — only which side gets the subdomain flipped.
>
> **Confirmed resolved 2026-08-04 — follow-up #2 above was done, just never
> written back here.** `https://diveshoal.com/privacy` returns a real `200`
> with the actual policy content (`<title>Privacy — Shoal</title>`), no
> redirect to an Access login domain. Verified directly, not assumed: an
> automated fetch first came back `403`, which briefly looked like the
> opposite finding, but that was Cloudflare's generic bot-protection reacting
> to that tool's own request signature — re-checked with a browser-shaped
> `curl` (matching what a reviewer's browser or Googlebot actually look
> like) and got a clean `200`. **This closes §1.3's "Privacy policy URL"
> blocker and #1 of §5's sequence is done.** Follow-ups #1 and #3 above
> (the CTA repoint, Search Console domain-property verification) are
> unverified either way in this pass — not re-checked, not contradicted.
>
> ~~**Recommendation: a subdomain of `diveshoal.com`**~~ (superseded — see
> above; the app gets the subdomain, not the landing page):
> - Google wants the privacy policy on a domain you own and have verified in
>   Search Console. A DNS-verified *domain property* for `diveshoal.com`
>   covers every subdomain at once — a different apex domain would need its
>   own verification and weakens the association with the app.
> - A subdomain is a **separate origin**, so it cannot interact with the app's
>   service worker at all. That sidesteps the `website-brief.md` concern about
>   hosting marketing content at the PWA root, which is what reintroduces the
>   `/index.html` → `/` redirect fragility documented in CLAUDE.md.
> - It keeps the app's own root untouched, which is the property that saga was
>   fixed to protect. *(In the flipped arrangement, it's the app moving off
>   root instead — the same protection, achieved by whichever side leaves.)*
>
> Whatever is chosen, **the policy URL must sit outside Cloudflare Access** —
> a reviewer or crawler hitting a login wall fails both processes.

**Write the privacy policy already knowing media goes to Google Drive.** Drive
ships in v1 (§1.6), and Play's data-safety declarations must be consistent with
what the policy says. Writing it for a no-cloud app and amending later means
rewriting it under submission pressure.

**Second, immediately after: open the Play Console account and decide personal vs
organisation** — see §1.1, it's a 14-day wall-clock gate that you want running in
the background while you do the real work.

**What explicitly not to do first: the UI consolidation.** Not because it isn't
worth doing — §3.5 is clear that it is, along with the colour and accessibility
work — but because of **ordering**. It touches `css/styles.css`, the file most
likely to conflict with everything else, and both the accessibility pass and the
MD3 colour rename change what the primitives must do and what they're named in
terms of. The correct order within the UI workstream is
**accessibility → colour architecture → primitives → dark mode** (§5, steps
5–7.5). Starting at the end means doing it twice.

---

## 1 · Play Store readiness checklist

### 1.1 Account — and the decision that costs the most time

| | Personal account | Organisation account |
|---|---|---|
| Cost | $25 one-time | $25 one-time |
| Identity proof | Government ID | **D-U-N-S number + legal entity** |
| Closed-testing gate | **12 testers, opted in continuously for 14 days**, before you can even *apply* for production access | Exempt |
| Setup time | Days | Weeks (D-U-N-S issuance) |

The 12-tester/14-day rule applies to personal accounts created after
2023-11-13. It was 20 testers originally; Google reduced it to 12 on 2024-12-11,
and it has not changed since. Testers must be real Google accounts on real
devices — emulators and duplicate accounts don't count.

**This is the longest-lead item in the whole project and it's pure wall-clock.**
Recruiting 12 real divers who will keep the app installed for 14 straight days is
not trivial. Whichever account type you pick, open it now and get *something* on
a closed track — even a thin wrapper — so the clock runs in parallel with the
engineering.

An organisation account needs a D-U-N-S number, which has its own lead time —
worth checking that before defaulting to a personal account, since switching
later is not straightforward.

### 1.2 Technical build requirements

| Requirement | Status |
|---|---|
| **Target API 36 (Android 16)** for new apps from 2026-08-31 | Not yet applicable — no Android build exists. Set explicitly in `tauri.conf.json → bundle.android`; don't inherit the Gradle default. |
| **AAB, not APK** | `tauri android build --aab`; output at `gen/android/app/build/outputs/bundle/universalRelease/`. First upload must be manual so Play can verify signature + bundle ID. |
| **minSdk** | Tauri baseline is API 24 (Android 7). Fine. |
| **Code signing / Play App Signing** | Not set up. Straightforward. |
| **`versionCode`** | Tauri derives it as `major*1000000 + minor*1000 + patch` from `tauri.conf.json`. Note `tauri.conf.json` says `2.6.0` while the app ships as `2.985` — **these have drifted and will produce a nonsense version code.** Fix before first upload. |
| **64-bit / multi-arch** | Tauri builds all four arches by default. Handled. |
| **Android OAuth client SHA-1** | ⚠️ **Ordering trap.** An Android OAuth client is keyed on package name + SHA-1, and Play App Signing **re-signs the AAB with its own key** — so the fingerprint that matters comes from Play Console → Release → Setup → **App Integrity**, not your local upload key. Register the wrong one and Drive auth works in every build you test and fails *only* for users who installed from Play. An OAuth client accepts **multiple** fingerprints: register the debug/upload key **and** the Play app signing key against the same client. Consequence: the Play Console app must exist and have taken one AAB before Drive auth can be verified on Android at all. |

### 1.3 Policy and listing

| Item | Shoal's position |
|---|---|
| **Privacy policy URL (public)** | ✅ Resolved — see §0. `https://diveshoal.com/privacy` confirmed live 2026-08-04. |
| **Data safety form** | Needs honest completion. Shoal has no backend, but it *does* transmit user data to third parties: dive coordinates → Nominatim (reverse geocode) and Overpass; coordinates → Open-Meteo (forecast); coordinates → OSM tile servers. Species photos come from an iNaturalist S3 bucket. `raw.githubusercontent.com` is also in `connect-src`. All of these are "location shared with third parties" from Play's perspective. Declare them. **Plus everything in §1.6** — Drive ships in v1, which adds the largest disclosures this form will carry. |
| **Permissions + rationale** | Location (fine/coarse) for the GPS pin. Bluetooth (`BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`, with `neverForLocation` if you're not deriving location from scan results) for dive-computer sync. Storage/SAF for folder sync. Each needs a plain-English justification in the listing. **Media: none needed, deliberately** — photo/video ingest goes through the system photo picker / SAF, so no `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` is requested. Say so explicitly in the rationale; it's what keeps Shoal out of the restricted-permission review path entirely (§1.6). |
| **Content rating (IARC)** | Questionnaire. Shoal will rate "Everyone". Trivial. |
| **App access** | ~~No login anywhere in the app → nothing to declare. ✅~~ **Flips once Drive ships, which is v1** (see §1.6). Drive OAuth is an account connection, and Play requires reviewer access for anything behind one. Owed: a demo Google account with footage already in it, or written step-by-step instructions a reviewer can follow. |
| **Ads / IAP / analytics** | None. ✅ Nothing to declare, and no SDK disclosures. |
| **Third-party runtime code** | None — Leaflet and scuba-physics are vendored, no CDN. ✅ Genuinely unusual and it makes the data-safety form much easier to answer truthfully. |
| **Licensing** | No GPL anywhere in the chain (established during the ffmpeg/LGPL work; btleplug is BSD/MIT/Apache). ✅ |
| **Store assets** | 512×512 icon ✅ (`favicon-512.png`), feature graphic 1024×500 ❌, ≥2 phone screenshots ❌, short + full description ❌. |

### 1.4 One risk worth researching before writing the listing

**Play's Health apps policy.** Shoal computes NDL, decompression stop schedules
and minimum surface intervals via a Bühlmann ZHL-16C model. Play's health-app
rules cover apps providing medical or health advice, and dive decompression is
arguably medically consequential — a wrong stop schedule injures someone.

I am not asserting this is in scope; I'm flagging that it's the one policy
question here where a wrong guess is expensive, and it's worth thirty minutes of
research *before* the store description is written, because the answer may change
how the planner is described.

Independent of the policy answer, the planner should carry an explicit in-app
disclaimer ("not a substitute for a dive computer or formal training"). That's
just correct, and it's the kind of thing reviewers look for.

### 1.5 What Shoal already satisfies

Worth stating plainly, because it's a lot: no ads, no in-app purchases, no user
accounts, no analytics or tracking SDKs, no third-party runtime code, no GPL, a
hardened CSP, offline-first operation, and a 512px icon. The listing paperwork is
the work here — the app itself is unusually clean against Play's checklist.

Caveat added 2026-07-29: "no user accounts" holds for Shoal itself and always
will — there is still no Shoal account, no sign-up, no backend. But **Drive OAuth
is an account *connection***, and Play treats that as app access. See §1.6.

### 1.6 What the Videos/Photos feature adds — it ships in v1

Decided 2026-07-29: **the Drive media feature is in the first Play release**,
not deferred to v2. Taken knowingly — it means the debut submission carries the
heaviest data-safety declaration, an account-connection review, and the
signing-key trap (§1.2) all at once. What follows converts that from exposure
into checklist items.

**Data safety — the additions, and they are the largest on the form:**

| Category | What Shoal sends |
|---|---|
| **Photos and videos** | Uploaded to the user's own Google Drive. |
| **Files and docs** | Dive `.md` files and `.footage.json`/`.profile.json` sidecars, where Drive is the sync backend. |
| **Personal info — email** | The connected account address, fetched by `fetch_account_email` and stored in the keychain. |
| **Location** | ⚠️ Non-obvious: per `BRIEF-footage-cloud-hosting.md` §4.7, photo **filenames encode the dive site** — `2026-05-06_dive-128_batu-balong_01.jpg`. The filename itself is location data leaving the device. Declare it; do not treat naming as cosmetic. |

**Permissions — the good news.** Ingest goes through the **system photo picker /
SAF**, so Shoal requests no `READ_MEDIA_IMAGES` or `READ_MEDIA_VIDEO` at all.
Since 2025-01-22 Google restricts those to apps with demonstrable broad-access
need and directs everyone else to the system picker; a dive log doing occasional
imports is squarely in the "use the picker" bucket. Requesting them would invite
a restricted-permission review Shoal has no argument for. **This is a design
constraint, not just a compliance one** — see §2.2's `scan_proxy_folder` row.

**OAuth scope tier — the other good news, confirmed against the actual code
(2026-08-03).** Google tiers OAuth scopes by sensitivity, and the tier decides
how hard verification is: a narrow ("sensitive") scope needs only a
domain-verified privacy policy and a written justification, while a broad
("restricted") scope — full `drive`/`drive.readonly` — requires an actual
**paid third-party security audit** (Google's CASA program) before going live
with real users, real money and real weeks. `gdrive.rs`'s `SCOPE` constant is
`https://www.googleapis.com/auth/drive.file` — the narrow one, deliberately:
it can only ever touch files Shoal itself created or that the user explicitly
picked, never a general read of someone's Drive (see the code's own comment
at `gdrive.rs:59-60`). That's the "sensitive," not "restricted," tier, so
Shoal should clear OAuth verification without needing CASA — worth confirming
at actual submission time, not assumed forever, but nothing in the code needs
to change for it. **This directly de-risks §5 step #2** — the "hours once #1
lands" estimate there assumes this, and would be badly wrong (weeks, real
cost) if the scope were ever widened without noticing the review-tier
consequence.

**Separately, worth knowing what Play's own review actually is and isn't.**
The general app review is mostly automated — malware-signature scanning,
known-vulnerable-SDK checks, policy-violation detection (declared permissions
vs. actual behaviour) — not a human reading Shoal's source for logic bugs or
subtle vulnerabilities. Human reviewers get involved for policy judgment calls
(sensitive permission categories, health-adjacent app content — see §1.4),
not code correctness. One piece of the free tooling is worth actually using
though: the **Pre-launch report's Security tab** (same device-farm run as the
UI-layout screenshots) also flags cleartext HTTP traffic, wrongly-exported
components, debuggable release builds, and insecure WebView configuration —
that last one is more relevant than usual for a WebView-wrapped app like this
one, and it's free the moment any build reaches an internal track.

**App access.** A reviewer cannot test Drive without a Google account. Prepare a
demo account with a couple of dives and some footage already in it, or written
instructions. This is a common rejection cause and it is pure preparation.

**Ordering.** §1.2's SHA-1 row makes the Play Console app a prerequisite for
verifying Drive auth on Android at all — the media feature now depends on item
#3 of §5, not just the testing clock.

---

## 2 · Architecture verdict

### 2.1 Does single-page + no-build survive? Yes — and it's now *more* appropriate, not less.

The original justification (offline, no page loads) was a PWA argument. Inside a
Tauri Android WebView the argument is different but points the same way:

- Assets are served from a **local origin**. There is no network waterfall to
  optimise, no cache strategy to design, no page-load cost to amortise. One HTML
  shell plus ordered classic `<script src>` files is the *cheapest possible thing*
  in that environment. A bundler would be optimising a problem that doesn't exist.
- `withGlobalTauri: true` plus inline handlers already works in the packaged macOS
  app. The same arrangement carries to Android. The `dangerousDisableAssetCspModification`
  trap is already understood and documented.
- **The service worker is already gated on `!isShell()`** (`js/app.js:1025`). The
  Android build therefore skips SW registration automatically. This is a genuine
  piece of luck: the single most fragile piece of PWA machinery — the one that
  silently killed production installs for a month over the `/index.html` redirect
  — is already excluded from the shell path. No work needed.
- `prepare-web.sh` needs **no structural change**. `frontendDist: "../webdist"` is
  platform-agnostic; Tauri consumes the same directory for Android.

Verdict: keep the folder structure, keep `prepare-web.sh`, keep no-build. The
front-end architecture is not what stands between Shoal and the Play Store.

### 2.2 What actually has to change — it's all Rust

`src-tauri/src/lib.rs` is 936 lines with **4 `#[cfg]` attributes** and 38
`std::fs`/`PathBuf` sites. That's the port.

| Blocker | Detail | Severity |
|---|---|---|
| **Capabilities** | `capabilities/default.json` points at `../gen/schemas/desktop-schema.json` and hardcodes `"windows": ["main"]`. Android has no `main` window in that sense. Needs a mobile capability file or a `platforms` key. **Turned out not to matter for the spike** — `cargo tauri android init`/`build` didn't need this touched at all to produce a working install; worth a real look once actual mobile-specific capabilities (geolocation, deep-link) get added, but wasn't the blocker it looked like on paper. | Not build-blocking after all |
| **`keyring`** | ✅ **Confirmed 2026-07-29/30.** Gated `[target.'cfg(not(target_os = "android"))'.dependencies]` in `Cargo.toml`; `gdrive.rs`'s four keyring-calling functions get matching-signature Android stubs (`load_token_record`→`Ok(None)`, `save_token_record`→`Err(...)`, `clear_token_record`→`Ok(())`) so every caller needed zero changes. Full `cargo tauri android build --debug` succeeded end to end — real APK/AAB produced, installed and ran on a physical device. Real Android Keystore-backed storage is still plan step 8's job; this only proves the rest of the crate isn't blocked by it. | ✅ Confirmed buildable |
| **`pick_folder`/`pick_video_folder`** | 🔴 **New, found only by attempting the build — not predicted going in.** `tauri-plugin-dialog`'s `FileDialogBuilder` has no `pick_folder()` on Android at all (`E0599` at compile time, not a runtime gap) — "pick an arbitrary directory" is a desktop-shaped concept the plugin doesn't implement for mobile. Gated the same way as keyring, Android stub returns an error. **This is exactly why §2.3's answer matters**: these native commands can't cover Android folder access even in principle: the real path has to be the WEB `showDirectoryPicker()` — which §2.3 now shows *also* doesn't work today. Folder access on Android has no working path yet, native or web. | Build-blocking (was silent until spiked) |
| **Filesystem** | 38 sites assume absolute `std::fs` paths. Android gives content URIs via SAF. `tauri-plugin-android-fs` is the candidate. | Feature-blocking (folder sync) — see §2.3, now confirmed necessary, not optional |
| **Video ingest model** | `scan_proxy_folder`'s recursive `std::fs` walk has **no Android equivalent within policy**. "Point me at your video folder and I'll scan it" maps to `MANAGE_EXTERNAL_STORAGE` or broad `READ_MEDIA_VIDEO`, both [restricted since 2025-01-22](https://support.google.com/googleplay/android-developer/answer/15800983) to apps with demonstrable broad-access need. Android must use the system picker. **Decided 2026-07-29: keep both models, platform-specific** — macOS keeps folder scanning + footage-match, Android uses picker + Drive. The v2.982 root-qualified relative-path refs already mean the same thing on both, so the **sidecar format does not fork**; only ingest does. | Model change, not an API change |
| **BLE** | `navigator.bluetooth` does not exist in Android WebView (Chromium bug 1100993, still open). So Android *must* use the native transport. Good news: **it already exists** (`src-tauri/src/ble.rs`, v2.98) and the two-transport seam means the JS side needs zero changes. **Confirmed buildable when gated the same way as keyring** (`btleplug` moved to the same non-Android-only `[target...]` dependency block, Android stub returns `false`/errors) — part of the same successful spike build. Bad news, unchanged: real Android BLE needs **droidplug**, a hybrid Rust/Java build with a Gradle-built Java component and a documented "somewhat complicated setup" — that integration itself was NOT attempted, deliberately out of scope for this pass. | Feature-blocking (dive-computer sync) |
| **OAuth redirect** | 🔴 **`gdrive.rs`'s loopback listener does not work on Android.** It binds `127.0.0.1:<port>` and sets `redirect_uri` to it (`src-tauri/src/gdrive.rs:304-306`). Loopback redirect is a *desktop* technique — mobile OSes don't provide it, and it's explicitly not the mobile pattern. Android needs a **custom-scheme deep-link redirect** via `tauri-plugin-deep-link`. This is a second, independent Drive-auth blocker on top of the SHA-1 ordering trap in §1.2. Not exercised in this spike (Drive wasn't tested) — still open. | Feature-blocking (Drive) |
| **Geolocation** | 🔴 `navigator.geolocation` in an Android WebView requires the host to implement `WebChromeClient#onGeolocationPermissionsShowPrompt`, call `setGeolocationEnabled(true)`, and declare the manifest permissions. wry [issue #81](https://github.com/tauri-apps/wry/issues/81) reports permission-requiring web APIs being immediately denied. The GPS pin — a core log-form control — likely needs `tauri-plugin-geolocation` and a JS branch. **Not tested in this pass** — the spike's device time went to the folder-picker question instead, which turned out to need the CDP deep-dive it got. Still open, same priority as before. | Feature-blocking (GPS pin) — untested |
| **Version drift** | `tauri.conf.json` version `2.6.0` vs app version `2.985`. | Cosmetic now, wrong `versionCode` later |
| **ffmpeg sidecar** | Already parked; `externalBin` already removed. | ✅ Nothing to do |

### 2.3 The one question that decides the shape of the whole port

> **Answered 2026-07-29/30, branch `android-spike`, on a real device (Galaxy S10,
> WebView 135.0.7049.111 — well past M132).** Not by inspection this time — a
> full `cargo tauri android build`, installed and driven on hardware. Full
> writeup below; the short version: **no**, and the mechanism is more useful
> than a plain no would have been.

**Does `showDirectoryPicker()` work inside wry's Android WebView?**

Chrome shipped File System Access on Android and WebView in **M132** — the same
version CLAUDE.md already names as the Android folder-sync floor. But WebView
*hosts* must implement `WebChromeClient#onShowFileChooser()` for it to reach the
page. wry **does** implement that method (`wry/src/android/kotlin/RustWebChromeClient.kt`,
shipped in 0.21.0) — but it was built for `<input type="file">`, and whether it
handles the directory-picker intent was **unverified** going in.

- **If yes:** the entire existing browser folder-sync path — `showDirectoryPicker`,
  IndexedDB handle persistence, `getWritableFolderHandle`, the reconnect banner —
  runs unchanged on Android. Enormous win. Almost no new code.
- **If no:** you need a third folder-sync backend (SAF via `tauri-plugin-android-fs`)
  behind a new `isShell()` branch, mirroring the existing Tauri one. Weeks, not days.

**Result: no — confirmed with reasonable rigor, not just "we tapped it and
nothing happened."**

The app's own code never actually reached `showDirectoryPicker()` at all —
`setDiveFolder()` checks `isShell()` first (`!!window.__TAURI__`, true on
Android too, exactly the ambiguity §2.4 already flagged) and calls the native
`pick_folder` Tauri command instead, which doesn't exist on Android (see §2.2's
new row). So the first real finding was §2.4's prediction reproducing itself
live, not a WebView limitation at all.

To test the actual question, `window.showDirectoryPicker({mode:'readwrite'})`
was called directly against the running WebView via Chrome DevTools Protocol
(`webview_devtools_remote_<pid>`, port-forwarded over adb — confirms
`tauri.conf.json`'s debug build already has `setWebContentsDebuggingEnabled`
on, incidentally useful for any future Android debugging). Two calling
contexts, both informative:

1. **Via `Runtime.evaluate` directly:** `SecurityError: Must be handling a
   user gesture to show a file picker.` — the function exists
   (`typeof window.showDirectoryPicker === 'function'`, confirmed first), but
   a bare CDP script call isn't a trusted user gesture, same as it wouldn't be
   in any browser.
2. **Via a real gesture** — a button injected into the live page, clicked
   through CDP's `Input.dispatchMouseEvent` (which Chromium's user-activation
   tracking *does* accept as trusted, unlike `Runtime.evaluate`): the
   `SecurityError` disappeared, confirming the gesture was now genuine — and
   the call rejected instead with **`AbortError: The user aborted a
   request.`** No native chooser ever appeared on screen (confirmed by
   screenshot at the moment of the call).

That's the real answer: wry's Android `onShowFileChooser` implementation
accepts the call, doesn't crash, doesn't hang — it just never presents a
folder chooser, and Chromium's own API surfaces that as an immediate,
silent-to-the-user abort. Functionally identical to the "if no" branch above.
**Folder sync needs a real SAF backend on Android** (`tauri-plugin-android-fs`
or hand-rolled `ACTION_OPEN_DOCUMENT_TREE`), not a reused browser path.

**This is a one-hour spike that determines a multi-week fork in the plan.** Do it
before planning anything else on the Android side.

**Second question, added 2026-07-29 — the spike as written doesn't cover video.**
`showDirectoryPicker` decides folder sync for `.md` files. It decides nothing
about media, and a green light there would be easy to misread as a green light
for footage. So the spike must also answer:

> **Can a large video be played *and seeked* through a SAF content URI?**

Two platform hazards, neither Tauri's doing:

- A provider may return a **non-seekable pipe or socket** for mode `"r"` — only
  `"rw"` implies a seekable file on disk. Playback starts, scrubbing fails.
- Cloud-only files are **virtual files** (`FLAG_VIRTUAL_DOCUMENT`) with no binary
  representation at all; `openInputStream()` does not work on them.

A "no" is **not fatal** — Drive's `?alt=media` + `Range` genuinely streams and is
the intended Android path regardless. What it decides is whether SAF is
ingest-only on Android (expected) or can also serve playback (convenient if
true). Answer before scoping §5 item #9. Test with a real multi-GB file from a
cloud provider, scrubbed to the middle — a small local file proves nothing.

### 2.4 The largest front-end change the port forces

**`isShell()` becomes ambiguous.** It is currently binary — `!!window.__TAURI__`,
meaning "macOS desktop shell". There are **41 call sites across 9 files**:

```
js/video.js 16 · js/app.js 10 · js/computer-sync.js 3 · js/planner.js 3
js/album.js 2 · js/footage.js 2 · js/profile.js 2 · index.html 2 · js/species.js 1
```

The moment an Android shell exists, every one of those sites means one of three
things — "any Tauri shell", "desktop only", or "mobile only" — and today they
can't distinguish. Concrete examples that would break: the Admiralty tide fetch
(desktop-only by design), the footage/proxy folder scanning, the Web Bluetooth vs
native BLE branch in `computer-sync.js`, and the "save via native dialog instead of
`downloadBlob()`" WKWebView workaround.

The fix is mechanical — add a platform discriminator alongside `isShell()` and
audit all 41 sites — but it is **not optional and not small**, and it's the one
piece of this that genuinely lives in the JS. Budget it explicitly.

**Confirmed live, not just predicted (2026-07-30, the §2.3 spike).**
`setDiveFolder()` (`js/app.js`) is a real, reproduced example: it checks
`isShell()`, gets `true` on Android exactly as this section warned, and calls
the native `pick_folder` command — which doesn't exist for Android (§2.2) —
instead of ever trying the web `showDirectoryPicker()` path. The bug wasn't
theoretical; it's why "nothing happens" when the button is tapped on a real
device. Worth knowing before starting the discriminator pass: this one
function alone needs a three-way split (macOS native / Android native-once-it-
exists / browser web-API), not a two-way one.

**Added 2026-07-29: this is largely the media work.** 16 of the 41 sites are in
`js/video.js` — more than double the next file, and the video subsystem is by
some distance the most platform-entangled part of the app. So the discriminator
pass (§5 item #8) and the Videos/Photos roadmap are the same edit to the same
file. Sequenced apart, `video.js` gets rewritten twice. Merge them.

### 2.5 macOS regression risks — the shipping build must not break

Flagging these because the desktop app is live and this is where it would break:

1. **`#[cfg]` gating in `lib.rs`.** Adding platform gates to a 936-line file with
   only 4 existing ones is the highest-risk change. The macOS code path must come
   out byte-identical.
2. **`keyring` gating.** Get the cfg wrong and Drive OAuth silently stops working
   on macOS — silently, because the failure mode is a token-store miss, not a
   compile error.
3. **`capabilities/default.json`.** Tauri validates capability files at build
   time; a malformed `platforms` key breaks the *desktop* build, not just Android.
4. **Version bumps.** The macOS build is on `tauri 2.11.2`. Android work will
   tempt a bump; a bump risks the `dangerousDisableAssetCspModification` behaviour
   (whose failure mode is "app renders but is unclickable" — dev unaffected, so
   it's an easy trap) and the asset-protocol scope.
5. **`prepare-web.sh`.** Shared by both targets. Any change affects macOS first.

**Recommendation: do all Android work on a branch, and keep a reproducible macOS
release build from `main` throughout.** Do not let `main` carry a half-gated Rust
layer.

### 2.6 Tauri plugins — and the UI-components question

**First, the direct answer: Tauri has no UI components, and no such category
exists.** Tauri is a WebView shell plus a Rust IPC bridge. On mobile it renders
your HTML/CSS/JS inside Android WebView or WKWebView — there is no Tauri
equivalent of Compose or SwiftUI, no widget set, no styled controls. "Tauri UI
libraries" in the wild are just web libraries that happen to be used in Tauri
apps; they carry every cost in §4 and none of Tauri's own. (The one genuine
native-rendering plugin, the third-party `tauri-plugin-widgets`, builds *home
screen widgets* — Glance/SwiftUI tiles outside the app — not in-app controls.
Not relevant here.)

So the UI question in §3 is unchanged by anything in the plugin ecosystem.

**Second, and more useful: the plugins solve real problems this port has**, and
they should replace hand-written Rust rather than sit alongside it. `Cargo.toml`
currently pulls only `shell`, `dialog` and `log`. Of the ~30 official plugins,
these are the ones that matter here:

| Plugin | Why it matters to Shoal | Priority |
|---|---|---|
| **`deep-link`** | The **only** viable Drive OAuth redirect on Android — replaces the loopback listener, which mobile doesn't support. Also the mechanism for a future `shoal://` share target. | 🔴 Required |
| **`geolocation`** | Likely required for the GPS pin; `navigator.geolocation` needs host WebChromeClient support wry may not provide. Auto-adds `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` to the manifest. | 🔴 Required (pending §2.3 spike) |
| **`stronghold`** or **`store`** | The `keyring/apple-native` replacement. `stronghold` is the encrypted-at-rest option and the closer analogue to what Keychain gives you today; `store` is plain key-value and **not** appropriate for a refresh token. Note this is a *behaviour* change on macOS if you unify — Keychain is stronger than Stronghold's file-backed vault, so prefer `#[cfg]`-gating Keychain on Apple and Stronghold on Android over replacing both. | 🔴 Required |
| **`fs`** | Official filesystem plugin; handles content URIs on Android out of the box. Candidate to absorb some of the 38 `std::fs` sites — though the SAF-tree case still likely needs `tauri-plugin-android-fs` (§2.3). | 🟠 Likely |
| **`dialog`** | Already used. Its mobile file-picker path is what the §1.6 picker-based ingest model would go through. | ✅ Have it |
| **`haptics`** | Cheap, high-perceived-quality win: a light tap on dive-type chip selection, R/O/C abundance, and save-arm confirmation. This is the kind of thing that makes a WebView app stop *feeling* like a WebView app, and it costs about an hour. | 🟢 Worth it |
| **`os`** | Gives you the platform discriminator §2.4 needs, rather than sniffing user-agent. | 🟢 Worth it |
| **`notification`** | Not needed now. Would matter if surface-interval countdowns ever go background. | ⚪ Later |
| **`biometric`, `nfc`, `barcode-scanner`, `sql`, `websocket`, `updater`** | No use case. `updater` in particular is Play-forbidden for self-updating APKs. | ⚪ No |

**The plugin-shaped observation worth acting on:** three of the four
Android blockers in §2.2 (`keyring`, OAuth redirect, geolocation) have official
plugin answers. That materially lowers the §2.2 risk estimate — it's less
"write Android Rust" and more "adopt plugins and `#[cfg]`-gate the desktop path."
The genuinely hand-rolled Android work narrows to SAF folder access and
droidplug BLE.

Note these are Rust crates via `cargo`, **not** npm packages — adopting them does
not touch the §4 decision at all. Each also has a JS side (`@tauri-apps/plugin-*`),
but with `withGlobalTauri: true` those are reachable as `window.__TAURI__.*`
without a bundler, which is exactly how `invoke` is already being called today.

### 2.7 Android folder sync — the design (built and verified on device 2026-07-30/31)

> **Status: working.** `tauri-plugin-android-fs` v29, five `android_*` commands,
> three-way JS seam. Verified end-to-end on a Galaxy S10 (Android 12): folder
> picker opens, grant persists, `writeToFolder()` produced
> `dive-999-saf-round-trip.md` in the picked folder, read-back returned the
> right content, delete removed it, and deleting an already-missing file
> returns success (the contract `_cleanupOldDiveFiles` depends on). macOS
> `cargo check` clean throughout.
>
> **2026-07-31 follow-up — sidecar reads, plus a real bug found and fixed.**
> `loadAllSidecars`/`loadAllProfileSidecars` (video.js/profile.js) gained the
> same three-way split as everything else; `deleteSidecar` was simplified to
> delegate to `_deleteBackendFile()` (closing an Android gap it had never
> been updated for); `_bleHasSyncDestination()` and `exportAllDives()` had
> the same `isShell()`-ambiguity bug and got the same fix. Testing the
> sidecar read fix against a real write on-device surfaced a genuine,
> independent bug: `android_write_file`'s first-write path hardcoded MIME
> type `"text/markdown"` for every file, and Android's
> `DocumentsContract.createDocument()` *enforces* an extension matching that
> MIME type rather than just filling in a missing one — so a sidecar named
> `dive-1.footage.json` silently landed on disk as
> `dive-1.footage.json.md`. Invisible on the `.md` dive file itself (its own
> extension already matched `text/markdown`), which is why the earlier
> round-trip test above never caught it. Fixed by passing `None` (the plugin
> infers MIME from each file's own extension) and re-verified: sidecar
> write → real content read back → delete → confirmed gone via `adb shell
> ls`, not just the in-memory cache. `exportAllDives`'s Android branch was
> confirmed to open the real native picker and resolve a cancelled pick to
> `null` cleanly; the full write-loop after a *completed* pick was then
> click-tested too (synthetic taps on the native picker proved as unreliable
> as on the WebView, so Luke tapped "USE THIS FOLDER" by hand) — and that
> real end-to-end run surfaced a second, unrelated, pre-existing bug:
> `_exportFilesForDive` (`js/app.js`) wrote `generateMD(d)` alone, missing
> the `generateFrontmatter(dive) + '\n' +` prefix every other save path
> includes. Every "Export all dives" `.md`, on every platform (not just
> Android), was coming out with no YAML frontmatter at all — unreadable by
> the app's own re-import or Obsidian's Dataview. Fixed with the one missing
> call; re-verified on-device.

**SAF is not a workaround; it is what was always underneath.** Android Chrome's
`showDirectoryPicker()` *is* the Storage Access Framework with a web API on top.
CLAUDE.md's existing claim — that folder sync to a Google Drive folder needs
"no Drive API / OAuth / CSP change; the OS does the sync" — is true *because*
of SAF. Implementing SAF natively loses nothing and removes a broken shim.

**This does not overlap with `gdrive.rs`, and neither replaces the other:**

| Path | Carries | OAuth? |
|---|---|---|
| **SAF folder sync** | dive `.md` + sidecars, into any folder incl. a Drive folder | **None** — the OS syncs it |
| **Drive API** (`gdrive.rs`) | videos/photos, too big for file-per-dive | Required, and the reason for going native at all |

Dropping SAF would force a Google sign-in on someone who only wants their dive
log in a folder. Both ship. **No backend in either** — SAF is an OS-level local
access grant.

#### The architectural insight that keeps this small

Model the SAF backend on the **browser** branch, not the desktop branch. The two
existing paths in `_deleteBackendFile` (`js/app.js:434`) differ in exactly the
way that matters:

```
shell:   invoke('remove_file', { path: folder + '/' + filename })   ← string concat
browser: handle.removeEntry(filename)                                ← opaque handle + bare name
```

A content URI **cannot be concatenated** — `content://…/tree/primary%3ADocuments`
+ `/dive-1.md` is meaningless; it needs `resolve_file_uri(dir, name)`. So the
desktop shape is precisely wrong and the browser shape is precisely right.
`_sidecarFilename()` (`js/video.js`) already exists for the browser backend
("whose directory handle already IS the dive folder") and SAF reuses it verbatim;
`_sidecarPath()`, the concatenating one, stays desktop-only.

Put crudely: **SAF is the desktop backend's storage shape (a string in
`localStorage`) with the browser backend's permission semantics (opaque,
scoped, revocable).** That is why neither existing branch extends to cover it.

#### API, verified against the vendored source (not docs)

`tauri-plugin-android-fs` **v29.0.0**, MIT/Apache-2.0, `rust-version = 1.77.2` —
exactly this repo's own floor. ⚠️ **Cargo initially resolved v8.4.0 from a
`"8"` requirement taken from a stale docs page; the current major is 29.** Twenty-one majors in roughly two years is a real maintenance signal — the agreed
position is to use the plugin and revisit hand-rolling if it stops paying off. The
five commands in `src/androidfs.rs` are deliberately thin wrappers over it, so
swapping the implementation later means rewriting one file and touching no JS:
the `(folder, filename)` contract and the opaque-JSON wire type are ours, not
the plugin's.

| Need | Method |
|---|---|
| pick a folder | `picker().pick_dir(initial, local_only) -> Option<FsUri>` |
| survive restart | `picker().persist_uri_permission(&FsUri)` |
| resolve child | `resolve_file_uri(dir, relative_path) -> FsUri` |
| create | `create_new_file(dir, relative_path, mime) -> FsUri` |
| read / write | `read_to_string(&FsUri)` · `write(&FsUri, bytes)` |
| list | `read_dir(&FsUri) -> Vec<Entry>` |
| delete | `remove_file(&FsUri)` |

`FsUri` derives `Serialize`/`Deserialize`, so it crosses to JS as opaque JSON —
JS stores and returns it without ever parsing it, which is the property that
makes the "JS shouldn't care" rule enforceable rather than aspirational.

#### Naming

The commands are `android_*`, not `saf_*`, and the folder parameter is
**`folder`**, not `treeUri` — matching the existing `list_md_files(folder)` and
`scan_proxy_folder(folder)`. `ACTION_OPEN_DOCUMENT_TREE` is Android jargon
leaking into an API where every other name is a plain word; the desktop backend
gets a path string and Android gets a URI string, and the call sites read the
same either way.

#### Two guards that do NOT port

- **`authorize()`/`FolderScope` does not apply.** The desktop guard canonicalises
  and prefix-checks a path. SAF is *self-scoping* — the OS refuses access
  outside the granted tree. Simpler and safer; do not port the guard, and do not
  add these URIs to `FolderScope`.
- **Losing permission is normal, not exceptional.** Persisted grants die on
  uninstall, user revocation, or the ~128-URI cap. The reconnect machinery
  (`_folderNeedsReconnect` / `reconnectDiveFolder`) already exists — built for
  exactly this on Android Chrome — and ports across.

#### Scope of the JS change: 8 sites, not 41

`writeToFolder` (app.js:1352) · `_deleteBackendFile` (:434) · `syncFromFolder`
(:1603) · `setDiveFolder` (:1557) · `reconnectDiveFolder` (:1467) · folder-UI
init (:1747) · `_writeSidecarToFolder` (video.js:273) · `_writeProfileSidecarToFolder`
(profile.js:135). The other 33 `isShell()` sites are proxy scanning, Admiralty
and SW registration — separate concerns, not this job.

Unchanged and inherited free: `canonicalFilename`, `_cleanupOldDiveFiles`'s
write-new-then-delete-old rename safety (works as long as delete takes
`(folder, filename)`), and the `uid`-keyed sidecar join. **Proton Drive stays
broken** — its E2E provider hides cloud-only files from SAF exactly as it does
from the browser API. Not a regression.

### 2.8 Android BLE dive-computer sync — the design (researched 2026-07-31)

> **Status: built and partially hardware-verified 2026-07-31.** `ble_available()`
> correctly tracks the real adapter state (confirmed both ways — `false` with
> Bluetooth off, `true` after enabling it), and `ble_scan()` runs its full
> pipeline (runtime permission check → `discover()` → channel drain →
> defensive re-filter → dedupe) cleanly on a Galaxy S10, returning an empty
> result with no dive computer in range. **Not yet verified: an actual
> device discovery, connect, and packet exchange** — that needs a real
> Shearwater/Suunto nearby, which wasn't available this session. Two real,
> previously-unknown build/runtime issues surfaced and got fixed on the way
> (below) — this was not a clean first build, the same way §2.7's wasn't.

**Two fixes this took, beyond the Rust code itself:**

1. **`minSdkVersion` had to rise from 24 to 26.** `tauri-plugin-blec`'s
   Android manifest declares `minSdk 26`; Gradle's manifest merger refuses
   to combine it with the project's (Tauri's own default) `minSdk 24` —
   *"the library might be using APIs not available in 24."* Fixed in
   `tauri.conf.json` → `bundle.android.minSdkVersion: 26`. **Real cost, not
   free:** this drops Android 7.0/7.1 (API 24/25) support. Not investigated
   this session whether that's an acceptable trade for Shoal's userbase —
   worth a deliberate look before this ships, not assumed away here. (Also
   discovered along the way: a config change to `minSdkVersion` isn't picked
   up by re-running `cargo tauri android init` on an *existing* `gen/android`
   — it only bakes in at first generation. Deleting and regenerating
   `gen/android` from scratch was needed. Purely a generated, gitignored
   directory — see the new `.gitignore` entry — so this cost nothing beyond
   a rebuild.)
2. **Android 12+'s runtime `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` permissions**
   are dangerous permissions requiring an explicit grant, not just a
   manifest declaration — confirmed live: an ungated scan failed with
   *"Missing permissions"* even with Bluetooth on and the manifest entries
   present (auto-merged from the plugin's own `AndroidManifest.xml`).
   `tauri_plugin_blec::check_permissions(true)` — a plugin-provided function
   for exactly this — now gates both `ble_scan` and `ble_connect`; it shows
   the standard Android grant dialog on first use, no custom UI needed.

**The problem this solves.** `src-tauri/src/ble.rs`'s Android branch is
currently five stubs returning `"Bluetooth dive-computer sync isn't available
on Android yet."` — put there during the spike specifically because
`btleplug`'s own Android backend ("droidplug") needs a hybrid Rust/Java build:
`cargo-ndk`, a Java component published to a Maven repo or built locally, and
JNI libraries placed by hand into the app's `jniLibs`. Real, but exactly the
kind of hand-rolled-native-integration cost that `tauri-plugin-android-fs`
already avoided for folder access — the same trade should be evaluated here
before accepting that cost, not after.

**Not the first look at this plugin — reconciling with `BRIEF-dive-computer-sync.md`
§20.** That session evaluated `tauri-plugin-blec` too, and flagged it pre-1.0
with an unconfirmed-severity iOS code-signing issue reported by its own
maintainer. Both real, neither a reason to avoid it here: §20 was evaluating
a *different, hypothetical* integration — "Option A," a from-scratch native
iOS build of libdivecomputer that would call the plugin's own JS-facing
commands directly (`connect(address, callback)`, `sendString(...)`). The
signing caveat is iOS-specific by the maintainer's own report and doesn't
touch Android's build/signing path at all. And the architectural insight
below means Android's use of this plugin **never reaches JS** — `ble.rs`
calls `Handler` methods from Rust and keeps presenting this app's own five
command names, so even the "custom, not Web-Bluetooth-shaped API" observation
§20 made about the plugin doesn't surface here. Pre-1.0 is still a real
maturity signal worth naming plainly (same posture as `tauri-plugin-android-fs`'s
own version-churn note in §2.7) — not disqualifying, per §20's own conclusion,
and the point of hardware-verifying before calling this "working" rather than
just "designed."

**`tauri-plugin-blec` (0.12.0, MIT, actively released — 174 commits, latest
tag 2026-06-08) exists for exactly this reason.** Per its own docs: "on
Android it uses the tauri plugin functionality to get rid of the complicated
jni setup used in btleplug." Its `build.rs` is the identical auto-wiring
pattern `tauri-plugin-android-fs` already uses —
`tauri_plugin::Builder::new(COMMANDS).android_path("android").build()` — so
Tauri's own mobile build system wires in its Kotlin/Gradle side
(`BleClientPlugin.kt`, `BleClient.kt`, `Peripheral.kt`) automatically. No
manual Gradle editing, unlike raw `droidplug`.

#### The architectural insight that keeps this small

`js/computer-sync.js` never calls a plugin's commands directly — it only
calls this app's own five: `invoke('ble_scan'|'ble_connect'|'ble_write'|
'ble_disconnect'|'ble_available', …)`. That means the Android cfg branch of
those five existing commands can delegate internally to
`tauri_plugin_blec::get_handler()` (both `get_handler` and its `Handler` type
are public — confirmed in the vendored source, not assumed), and
**`js/computer-sync.js` needs zero changes.** Same shape as §2.7's SAF work:
the JS-facing contract is ours, the plugin is an implementation detail behind
it, swappable later without touching JS.

#### The property that actually mattered, verified against source

CLAUDE.md's own framing for this feature: *"One GATT notification must arrive
as exactly one packet… `tauri::ipc::Channel` is chosen precisely because it
preserves message boundaries."* The plugin's docs pages (GitHub README,
docs.rs, the TypeDoc site) all failed to state this either way — three
separate fetches each lost the detail. Resolved by reading the actual
downloaded crate source instead:

```
handler.rs: stream.next().await → data (ONE notification)
          → l.callback.run(data.value.clone())          (one call per listener)
commands.rs: callback closure → tx.try_send(data)         (mpsc::channel(1))
          → rx.recv().await → on_data.send(data)          (tauri::ipc::Channel)
```

One notification in, one `Channel` message out, at every hop — no
concatenation, no reordering. Same mechanism, same guarantee, as the existing
macOS transport already depends on.

**One risk worth watching under real hardware load, not yet a blocker:**
`tx.try_send(data).expect(...)` panics if that capacity-1 channel fills
before it's drained. The existing BLE architecture note puts real packet
timing at "~60ms-per-packet," and the forwarding task drains in a tight loop,
so this is unlikely to fire — but it's exactly the kind of thing this
feature has been bitten by before (the cancel-salvage bug), so it gets a real
Shearwater sync before being called safe.

#### API mapping (`Handler` methods, verified against source — not the five-command names, which stay identical)

| Existing command | Android implementation calls |
|---|---|
| `ble_scan(services, timeout_ms)` | `handler.discover(Some(tx), timeout_ms, ScanFilter::AnyService(uuids), false)`, drained from the mpsc channel it feeds; **re-filter each result's own `.services` list against the request regardless** — same defensive re-check `ble_scan`'s macOS branch already does, for the same reason (a filter is a hint, not a guarantee) |
| `ble_connect(id, on_packet)` | `handler.connect(&address, OnDisconnectHandler::from_sync(...), false)`, then find rx/tx by `CharProps::Notify`/`Write`/`WriteWithoutResponse` on the discovered `Service`/`Characteristic` (same property-based selection macOS already uses, not hardcoded UUIDs), then `handler.subscribe(rx_uuid, Some(service), callback)` where the callback forwards each `Vec<u8>` straight into `on_packet.send(BlePacket::Data{data})` |
| `ble_write(data)` | `handler.send_data(tx_uuid, Some(service), &data, write_type)` |
| `ble_disconnect()` | `handler.unsubscribe(rx_uuid)` best-effort, then `handler.disconnect()` — same order as macOS, same reasoning (clean stream end before the link drops) |
| `ble_available()` | `handler.get_adapter_state()` → `AdapterState::On` |

`BleDevice.address` (a real string on Android — Android's BLE stack, unlike
CoreBluetooth, does expose genuine MAC addresses) becomes this app's own
`BleDevice.id`; the macOS struct's comment about `id` "deliberately not a MAC
address" is about CoreBluetooth's specific limitation and doesn't make an
Android MAC address wrong to use as the same field.

#### What this does NOT change

`BleState`, `BlePacket`, `BleDevice`, `BleConnection` (the IPC-boundary
types) stay identical — Android's implementation produces the same shapes,
just from a different source. `lib.rs`'s `generate_handler!` list and
`.manage(ble::BleState::default())` call need no changes, matching how the
Android stub already required none. `js/computer-sync.js`, the WASM
libdivecomputer engine, the fingerprint/incremental-sync logic, and the
cancel-salvage safety property are all downstream of this transport and stay
completely untouched.

### 2.9 Android media ingest — the design (researched 2026-07-31)

> **Status: partially blocked, not a build task like §2.7/§2.8 were.** §2.2
> already decided *"keep both models, platform-specific — macOS keeps folder
> scanning + footage-match, Android uses picker + Drive."* That means "media
> ingest" is not an Android port of `footage-match.js`'s capture-time
> matching — it's the Google Drive photo/video **upload** feature (§1.6),
> which doesn't exist in any form yet (`gdrive.rs`'s own comment: `#[allow
> (dead_code)] until the upload pipeline lands`), and whose Android OAuth
> path can't be verified without the Play Console app already existing
> (§1.6: SHA-1 for the OAuth client). Built and verified what's testable
> without that; left the rest clearly marked, not attempted blind.

**Real, positive finding: the picker UI needs no new native command at all.**
Tested directly on the Galaxy S10 — a plain `<input type="file">` (the exact
element the existing UDDF/`.md` import already uses) opens a genuine Android
system picker with **Images/Audio/Videos** category filters, once triggered
by an actually-trusted gesture. First attempt (a bare `element.click()` from
console JS) silently did nothing — not a platform gap, just no active
user-activation context, which file-choosers correctly require. A real
dispatched tap opened it immediately. So an `accept="image/*,video/*"
multiple` file input, wired the same way the existing hidden import inputs
already are, **is** the Android picker — no `tauri-plugin-dialog` mobile
work, no new Rust command, confirmed on hardware rather than assumed from
`wry`'s `onShowFileChooser` supporting plain file inputs (§2.3 already
established that much; this confirms it holds for media specifically, with
real category filtering).

**What's actually blocked, and why:**
- **Android OAuth redirect.** `gdrive.rs`'s consent flow binds a
  `127.0.0.1:<port>` loopback listener (§2.2) — a desktop-only technique.
  Android needs `tauri-plugin-deep-link` and a custom-scheme redirect
  instead. Buildable now (Rust/config wiring), but the actual redirect
  round-trip can't be exercised without a live OAuth attempt.
- **The OAuth client itself can't be tested on Android at all yet** — per
  §1.6, the Android OAuth client's registration needs the Play app-signing
  SHA-1, which only exists once a Play Console app has received at least one
  AAB (§5 step 3). This is the same external, account-creation dependency
  already flagged there — not something building more code changes.
- **The upload pipeline is unbuilt.** `gdrive.rs` has OAuth/token plumbing
  and a generic Drive API helper (`drive_post_json`) plus one real multipart
  upload call, but that one uploads a small internal verification control
  file (`gdrive_scope_setup`), not user media. A real "upload this photo/
  video" command is new work, and testing it meaningfully needs a live,
  connected Drive account — which needs the OAuth path above first.

**What this session actually built and verified (2026-07-31):**
`tauri-plugin-deep-link` added and registered (Android only); a new
`run_consent_flow_android` in `gdrive.rs` reusing the desktop flow's PKCE
generation and token-response parsing, differing only in how the auth code
comes back (`on_open_url` instead of a TCP accept loop) and omitting
`client_secret` from the token exchange (Android/public clients don't have
one); `gdrive_connect` cfg-branches between the two. `ANDROID_CLIENT_ID` is
a placeholder — see below for why it has to stay one for now.

**Verified live, not just "compiles":** installed on the Galaxy S10, armed a
JS-side listener for `deep-link://new-url`, then fired a real
`shoal-oauth://callback?code=test123&state=...` intent via `adb shell am
start`. Android correctly resolved the custom scheme to Shoal's running
instance ("delivered to currently running top-most instance") and the event
reached JS with the exact URL. **This proves the entire mechanical
pipeline — OS intent routing, the plugin's native side, the Rust→JS event
bridge — end to end, independent of Google's OAuth servers entirely.** The
only remaining gap is Google's own side of the handshake, which genuinely
cannot be exercised without a real Android-type OAuth client, and that
client cannot be registered without the Play Console SHA-1 (§5 step 3) —
not a code gap, an external one.

**Deliberately not built this session: any Drive-connection or media-
picker UI.** Investigating this surfaced that `gdrive_connect`/
`gdrive_status`/`gdrive_disconnect` have never been wired into Settings &
data on *any* platform (`gdrive.rs`'s own comment: "not yet wired into the
UI — that's the next piece, not this one") — there's no existing design to
extend, Android-specific or otherwise. Building one now would mean guessing
at a UI (where it lives in Settings, what a connected/disconnected state
looks like, how status is shown) that hasn't been scoped for desktop
either, purely to have *something* for Android to test against. The
file-input picker mechanism itself is already independently confirmed
(above) without needing new UI to prove it works.

### 2.10 Plan step 8 (`isShell()` audit) — first pass, 2026-07-31

> **Status: one real, confirmed bug found and fixed. Most of the remaining
> 31 sites are likely NOT bugs — this revises the step 8 estimate down, not
> up.** Going in, "41 `isShell()` call sites, 33 not yet touched" read as 33
> latent bugs of the same shape as folder-sync/BLE. Auditing a representative
> sample across `album.js`, `computer-sync.js`, `footage.js` found most of
> them **correctly** use `isShell()` to mean "any Tauri build," not "desktop
> specifically" — e.g. `computer-sync.js`'s BLE-availability fallback is fine
> exactly as written, since `ble_available()`'s own Rust side already
> branches correctly per-platform; the JS caller never needed to know which
> shell it's in. Not every remaining site needs a three-way split — several
> need nothing at all.

**Found and fixed: `connectProxyFolder()` silently does nothing on Android.**
The "🎬 Match footage to dives" button (`index.html`, unconditionally
visible on every platform) calls `connectProxyFolder()`, whose `isShell()`
branch invokes `pick_folder` — which errors on Android (confirmed via
source, same as `pick_video_folder`) — and that error is caught by
`.catch(() => null)` and silently swallowed. Tapping the button on Android
currently produces **no feedback at all** — the same failure shape as the
original `setDiveFolder()` bug this whole Android effort started from, just
never noticed because this feature wasn't part of the spike. Not fixable by
porting: §2.2 already decided "Android uses picker + Drive, not folder
scanning" for this exact feature, so making it *work* on Android would
contradict a decision already made. Fixed by hiding `#footage-match-section`
outright when `isAndroidShell()` (`js/video.js`, checked immediately at
script load — no `DOMContentLoaded` wrapper, since these scripts load right
before `</body>`, after the element already exists, and that event may
already have fired by then). The 13 internal `isShell()` sites inside this
feature's own functions (`_scanProxyFolder`, `connectProxyFolder`, etc.) are
left as bare `isShell()` — correct in spirit, unreachable on Android now
that the entry point is gated, not worth the churn this pass.

**Found and fixed (2026-08-01): `exportUnvalidatedSpecies`'s write path.**
The design question this was left on — whether `save_file_dialog`'s return
value and `tauri-plugin-android-fs`'s own URI type interoperate — turned out
to already be answered by the plugin itself: `tauri-plugin-android-fs` ships
`impl From<tauri_plugin_fs::FilePath> for FsUri` specifically for this case.
`save_file_dialog` was already returning the right STRING on Android — a
`content://…` URI is exactly what `FilePath::Url` stringifies to — every
caller just piped it into `write_text_file` (pure `std::fs::write`, no
concept of a content URI). New command `android_write_uri`
(`src-tauri/src/androidfs.rs`) constructs an `FsUri` via `FsUri::from_uri`
from that same string and writes through `tauri-plugin-android-fs` directly
— no bridging logic needed beyond calling what the plugin already provides.
No `persist_uri_permission` call: `ACTION_CREATE_DOCUMENT` grants the
returned URI a temporary permission sufficient for the one write that
follows immediately, and this is a one-shot export, not a folder connection.
Also fixed the knock-on cosmetic bug the same write-path issue would have
caused once the write itself worked: the success message derived a filename
via `path.split('/').pop()`, which is meaningless on an Android content URI
(same shape as the Drive folder name bug from earlier tonight) — now uses
the filename already known from building the export instead of trying to
parse one back out of the returned URI.

**Verified end-to-end on hardware (2026-08-01), including the real save-dialog
tap.** A throwaway sighting was injected into `dives[0]` in memory only
(never `localStorage`, confirmed after — see below) to give the export
something to write; tapping the button opened the real native
`ACTION_CREATE_DOCUMENT` dialog, pre-filled with the correct filename,
defaulting into the connected Drive folder. After a real user tap on SAVE:
status read `✓ 1 unvalidated species → unvalidated-species-2026-08-02.csv`
(the real filename, not a mangled URI fragment — the display-name fix
confirmed too), the file existed in the folder per `android_list_filenames`,
and reading it back byte-for-byte matched the injected data exactly. Cleanup
confirmed complete: the test file was deleted from Drive, the in-memory
sighting removed, and `localStorage['divelog-dives']` checked directly to
confirm the injection never persisted at any point — the real 94-dive vault
was never at risk.

**Found and fixed (2026-08-01): the Admiralty UK Tidal API leaking onto
Android.** `app.js` and `planner.js`'s remaining `isShell()` sites turned out
to be one finding occurring at 4 call sites, not 13 separate ones.
`fetch_tide_events` (`src-tauri/src/lib.rs`) is a plain `reqwest` HTTP call
with no platform cfg-gate — it would answer identically on Android — but
Admiralty is desktop-only *by design* (CLAUDE.md, v2.6: UK/Ireland/Channel
Islands coverage, a 10k/month quota, and no-cache terms make it a deliberate
scope decision, not a technical one). `isShell()` predates Android as a
distinct shell: it meant "desktop" when it was the only shell there was, and
silently came to mean "desktop OR Android" once Android shipped. All 4 sites
(`js/app.js`'s Admiralty-settings visibility toggle; `js/planner.js`'s
`fetchPlanTide` guard, `_planTideCardHtml`, `_planTideNoteHtml`) now use
`isDesktopShell()`, which is what actually encodes the documented intent.
Pure JS gating change, no Rust involved. **Confirmed live on hardware
2026-08-01**, not just by re-reading the logic: `#admiralty-settings`'s
`style.display` reads `none` in Settings on the real device, and
`_planTideNoteHtml()` returns an empty string on the Plan panel — both
previously would have shown/run, since `isShell()` is true on Android too.

Of the two remaining `app.js` call sites examined (`reconnectDiveFolder`,
`syncFromFolder`'s own outer gates), both were confirmed already correct as
plain `isShell()` — they delegate immediately to functions that branch
`isAndroidShell()`/`isDesktopShell()` internally, which is exactly the
"already correct, don't touch" shape the sample audit predicted most
remaining sites would have.

**Step 8's `isShell()` audit is now complete** across all four files sampled
or fully examined this session (`album.js`, `computer-sync.js`, `footage.js`
sample; `video.js`, `species.js`, `app.js`, `planner.js` full pass). Two real
bugs found and fixed in this final pass (Admiralty leak, species export write
path), on top of the one found in the first pass (footage-match section).

### 2.11 Android: Folder sync is the only viable backend — a first-dive requirement, not just a default (2026-07-31)

> **Status: built.** Not a bug fix like §2.10 — a deliberate product decision
> about the Android onboarding journey, made explicitly rather than left
> implicit.

**The observation that started this:** on Android specifically, Browser and
Obsidian sync aren't just less convenient than Folder sync — they're both
guaranteed dead ends. `showDirectoryPicker()` aborts inside wry's WebView
(§2.3); the Obsidian Local REST API plugin doesn't support Android at all.
Folder sync is the *only* backend that can ever work here. Left opt-in and
buried in Settings, that's an easy thing to never notice — until a lost
phone makes it matter.

**The design, reached through a few iterations:** not a first-launch prompt
(asking someone to make a storage decision before they've used the app at
all is friction at the worst possible moment — they might just want to see
what the app does, or be mid-dive-trip with shaky signal). Not a dismissible
banner either (a "not now" that quietly goes away is exactly how this gets
forgotten, which is the actual problem). Landed on: **the prompt only
appears once the user has logged their first dive, and once it appears it
is a true hard block** — no close button at all. Cancelling the native
folder picker just leaves the prompt on screen. The reasoning for "hard
block, but only after first dive": before that point there's nothing at
stake yet, so blocking would be pure friction; after it, there's real data
that only lives in `localStorage` on one device, and the case for backing
it up is concrete rather than abstract — which is also exactly why "soft ask
now, hope they come back to it" was rejected.

**Implementation (`js/app.js` — `_androidFolderRequired()`,
`_maybeShowAndroidFolderRequiredPrompt()`, `_androidFolderRequiredPick()`):**
the check (`isAndroidShell() && dives.length > 0 && !_androidFolder()`) runs
in two places, not one — right after every `saveDive()` call, **and** at
boot (`index.html`). The boot-time check is what makes the hard block
actually hold: without it, force-quitting the app while the prompt is up
would be a free escape hatch, since the in-JS-memory prompt itself doesn't
survive a process kill. Re-checking at boot means the exact same condition
just fires again on next launch — killing the app doesn't dodge anything,
it just delays the same prompt by one relaunch. The overlay itself
(`#android-folder-required`) is a plain fixed, `z-index: 9999` div —
deliberately **not** wired into the app's existing overlay view-stack
(`_pushOverlayState`/history-based back-gesture dismiss), since that
machinery exists specifically to make overlays closable, which is the one
thing this must not be. If the Android back gesture backgrounds or exits
the app instead, that's an acceptable outcome, not a loophole: the dive is
already safely saved to `localStorage`, and reopening the app just re-runs
the boot-time check and shows the same prompt again.

**Not built this pass, deliberately:** the broader Settings simplification
(collapsing the Browser/Folder/Obsidian segmented control on Android down to
a bare "Set folder"/"Change folder," since the other two options are dead
ends there too) was discussed alongside this but held back — this section
is the higher-leverage piece (it's the difference between a user's data
being backed up at all vs. not), and the Settings-surface cleanup is cosmetic
by comparison. Worth doing, not urgent.

---

## 3 · UI audit

### 3.1 Scale of what's there

| Measure | Value |
|---|---|
| `css/styles.css` | 5,022 lines, ~1,490 rule blocks, **990 unique class names** |
| Rules setting `cursor:pointer` | **123** |
| Of those, fully "button-shaped" (pointer + box + fill/stroke) | **100** |
| Distinct `border-radius` values | **25** across 237 declarations — no radius scale exists |
| Distinct padding pairs on button-shaped rules | ~20 |
| Type-scale compliance | 376 uses of `--text-xs/sm/base` vs ~60 raw-px `font-size` declarations across **26 distinct values** |
| Inline `onclick` handlers | 182 (136 on real `<button>`, 12 on non-button elements) |

The type-scale number is better than it looks: roughly half the 26 raw values are
legitimate display/hero numbers (28–80px, explicitly allowed by CLAUDE.md).
The genuine violations are the ~13 mid-range values (10, 11, 13, 15, 17, 18, 19,
20, 22, 24, 26px) plus a handful of raw `14px`/`16px` that are just un-tokenised
uses of values already in the scale. That's a tidy-up, not a system failure.

The `border-radius` number is the more telling one: **25 distinct values with no
scale** is the clearest single signal that there's no primitive layer.

### 3.2 Commodity — the honest count

Grouping the 100 button-shaped rules plus the non-interactive commodity families:

| Family | Distinct hand-rolled variants | Notes |
|---|---|---|
| **Buttons** (text/icon action) | **~30** | `.btn-primary`, `.btn-ghost`, `.md-btn`, `.fm-btn`, `.sync-btn`, `.tp-btn`, `.scp-btn`, `.sp-btn`, `.gps-btn`, `.hist-map-btn`, `.proxy-btn`, `.df-action-btn`, `.df-desk-abtn`, `.dh-abtn`, `.lf-loc-btn`, `.btn-save-device`, … |
| **Close / dismiss (✕)** | **11** | `.fmp-close`, `.fm-dialog-close`, `.df-hero-close`, `.map-modal-close`, `.sp-close`, `.pdc-loc-close`, `.tcw-cancel`, `.tab-close`, `.tagfoot-x`, `.pdc-loc-pill-x`, `.tag-remove` — eleven implementations of "✕" |
| **Delete / remove** | **5** | `.vid-del`, `.vrow-del`, `.m-del`, `.sp-dive-rm`, `.sighting-remove` |
| **Back** | **3** | `.df-back-btn`, `.hist-back-btn`, `.df-back-link` |
| **Tab strips / segmented** | **9** | `.browse-tab`, `.species-browse-tab`, `.sp-picker-tab`, `.fm-mob-tab`, `.df-seg-btn`, `.lf-seg-opt`, `.mode-toggle button`, `.dm-side-tab`, `.fmp-tabs` |
| **Chips / pills** | **12** | `.cat-pill`, `.sp-country-pill`, `.pdc-loc-pill`, `.ulchip`, `.tp-tag`, `.lf-type-chip`, `.roc-btn`, `.tag`, `.fm-tag`, `.fm-vid-chip`, `.df-type-pill`, `.df-pc-pill` |
| **Badges** | **10** | `.badge-cache`, `.badge-free`, `.badge-worms`, `.iucn-badge`, `.sp-badge`, `.sp-cell-badge`, `.df-seg-badge`, `.sp-photo-badge`, `.thumb-vid-badge`, `.species-badge` |
| **Modal / overlay shells** | **7** | `.modal`+`.modal-overlay`, `.fm-dialog`+`.fm-overlay`, `.map-modal`, `.sp-photo-overlay`, `#sp-mob-overlay`, `#footage-mob-picker`, `.in-modal` |
| **Banners / status** | **13** | `.sync-banner`, `.lf-uddf-banner`, `.ss-banner`, `.obs-status`, `.gps-status`, `.lf-gps-status`, `.species-status`, `.status-noresult`, `.status-offline`, `.status-searching`, `.sp-region-banner-mount`, `.fmp-topbar-region-mount`, `#edit-banner` |
| **Toggles / switches** | **4** | `.st-tgl`, `.rev-toggle`, `.sp-clips-toggle`, `.mode-toggle` — no real switch component exists |
| **List rows** | **10** | `.sp-row`, `.ac-item`, `.ac-option`, `.species-option`, `.plan-loc-item`, `.gps-result-item`, `.df-more-item`, `.vrow`, `.watch-row`, `.dD-card` |
| **Text inputs** | **1 shared base + ~8 local overrides** | ✅ The *good* case — `.field input/select/textarea` is a genuine shared primitive |
| **Toasts / snackbars** | **0** | The app uses `alert()` — see §3.4 |

**The inputs are the tell.** One shared input base exists and it works. Nothing
else got the same treatment. This isn't a stylistic failure — it's what happens
when 30 features each ship their own button because there was never a `.btn` to
extend.

### 3.3 Signature — keep every bit of it

| Element | Why it stays |
|---|---|
| Depth-gradient background + caustics + sun-mesh (3-layer texture system) | The brand. One `--shimmer` dial, user-adjustable. No library has this. |
| Stat bubbles (`@keyframes df-bob`) | Ported to Stats in v2.96 *because it works*. |
| Dive-profile chart with NDL colour gradient | **Encodes data.** Live-vs-locked deco shades were found necessary by testing real dive data. Thresholds are Luke's own reference points. Irreplaceable. |
| Mobile nav wave + `--mobile-nav-active` | Solved a measured contrast failure and a real "testers didn't perceive it as navigation" finding. |
| Dive-type colour spine + `--type-*` ramp | Categorical encoding, one source of truth, two collisions already resolved by hand. |
| Vis / temp gradient dials | Reused verbatim in the dive-file Overview temperature bar. |
| Map-pin card + mobile picker reparenting | Solved a real "no room to pinch with the keyboard open" problem. |
| Horizontal tank gauge (`_dfTankHtml`) | Went through two documented contrast bugs to get right. |
| Folder-tab dive-file strip (`.df-seg`) | Deliberately *not* a pill switcher — documented. |

**Argument for keeping all of it:** every one of these is documented in
DECISIONS.md with a real reason, several were arrived at through live user testing
that produced counterintuitive results, and several **encode data** rather than
decorate it. Material Design has no component that does any of them. Replacing
this layer would cost weeks and produce a measurably worse product. I don't think
there's a serious case on the other side.

### 3.4 Accessibility — this is where the real value is

This section is the actual finding of the audit. None of it needs a library.

**1. Labels.** ✅ **Done — this section was stale, corrected 2026-08-02
against a proper re-count (a naive line-by-line grep undercounts: at least one
`<textarea>` tag spans multiple lines and was invisible to a single-line
pattern; re-checked with a script that parses tags across line breaks).**

The original claim here was "0 with `for=`, 0 with `aria-label`" — that is no
longer true, and per-field verification (not just a count) shows there's
nothing left to fix:

- 48 labelable fields (45 `<input>`, 2 `<select>`, 1 `<textarea>`)
- 25 have a correctly-matched `<label for=>` (verified: zero dangling —
  every `for=` target actually exists)
- 15 more have a real `aria-label` (`f-gps-lat`, the safety/deco stop fields,
  the vis/temp dial range inputs, the marine search box, the shimmer
  slider, …)
- The remaining 8 are legitimate exemptions, individually checked, not
  assumed: 5 are `type="hidden"` inputs behind visual dive-type/segmented-
  toggle/weather controls (`f-entry`, `f-watertype`, `f-current`,
  `f-tanktype`, `f-weather` — never in the accessibility tree at all, so a
  label on them would do nothing; the real accessible name lives on the
  *visible* button each one backs, which is a separate, already-fixed item —
  see point 5), and 3 are `display:none` file inputs (`lf-uddf-input`,
  `import-md-input-data`, `import-uddf-input`), each triggered by an adjacent
  visible `<button>` with real text content ("↑ Import"), which is already
  its own correct accessible name.

Whoever did this work did it thoroughly and correctly — it just never made
it back into this document.

**2. Touch targets.** 🟠

**21 controls are explicitly sized under 44px in at least one dimension**, exact
values from the CSS (not estimates):

```
12×12 .scrub-marker        22×22 .dD-select-box     28×28 .gsec-arr
16×16 .scrub-head          24×24 .tcw-cancel        30×30 .roc-btn  ← used on every sighting
18×18 .shimmer-thumb       26×26 .tl-trip-map-expand 32×32 .dD-edit, .sp-btn, .pg-arrow
24×24 .vrow-del            28×28 .tl-rename-ok/cancel 34×34 .df-action-btn, .df-hero-close
                                                      40×40 .mobile-cog
```

Android's own guidance is 48dp. WCAG 2.2 **AA** (2.5.8) requires 24×24 minimum;
AAA (2.5.5) wants 44×44.

**Two corrections found while implementing this (2026-07-29):**

- **`.dD-select-box` is a false positive.** It's `pointer-events: none` and
  `aria-hidden="true"` — a purely visual overlay on the spine; the whole
  `.dD-card` takes the tap. Not a target, so not a failure. Same for
  `.scrub-marker`/`.scrub-head` and the `.shimmer-slider` thumbs: those are
  drag handles on a much larger track, and the track is the target.
- **The one true AA failure this found, `.vrow-del` at 22×22, is already
  fixed** — ✅ **corrected 2026-08-02, found stale while about to redo it.**
  A later rule in `css/styles.css` (`.vrow-del { width: 24px; height: 24px;
  }`, with its own comment explaining the 24px choice: `.vrow` itself is
  clickable, so the usual 44px `::after` hit-area technique would swallow
  taps meant for the row) already overrides the declaration this table's
  number came from. Confirmed live — a `.vrow-del` element's computed style
  in a real browser is 24×24, not 22×22 — before touching anything, not
  assumed from the source. Everything else in the list clears AA and misses
  only AAA/Android comfort; the headline number was always softer than "21
  controls" implied, and now there are zero remaining AA failures, only the
  *comfort* problem on high-frequency controls below.

The fix splits into two kinds, and they are **not** interchangeable:

- **Isolated controls** (mobile cog, trip-map expand, hero close, timeline ✎,
  dive-file actions) — expand the *hit* area past the painted box with a
  transparent `::after`. Design untouched. ✅ **Done.**
- **Packed rows** (`.roc-btn` at 3px gap, `.dh-abtn` at 6px, `.gsec-arr`,
  `.tl-rename-*`, `.sp-dive-*`) — the same technique is **actively wrong** here:
  three 30px buttons 3px apart would overlap by 14px per side and the row gets
  *harder* to hit. These need painted size and gap to grow together, which is a
  real layout change that needs checking on a device at 360–400px.
  ⏸ **Deliberately deferred**, not forgotten.

A broader static estimate suggests 85 of 91 measurable pointer rules compute under
44px tall, **but treat that as a triage list, not a defect count** — the estimator
ignores icon children and flex stretch. `.mobile-nav-btn` measures ~24px by that
method and is ~53px in reality because of its 22px SVG child.

**3. Native dialogs.** ✅ **Done (2026-07-29).** Was 16 calls — 10 `alert()`,
3 `confirm()`, 2 `prompt()` (the 16th grep hit was a comment). In an Android
WebView these render as system dialogs that look nothing like the app and are the
clearest "this is a wrapped web page" tell there is.

Resolved three different ways, because they weren't one problem:

- **10 `alert()` → `showToast()`.** All ten were immediately followed by
  `return`, so nothing depended on the blocking behaviour.
- **1 `confirm()` deleted outright.** `deleteDive`'s confirm was a *second*
  confirmation stacked on `armDelete` — all three entry points already arm.
  A leftover from the edit modal's delete path, retired in v2.83.
- **2 `confirm()` → `confirmAction()`**, an async overlay-stack dialog. These
  are the cases `armDelete` structurally can't cover: `deleteFootageVideo`
  only asks when a sighting actually references the video, which is state
  known *after* the click, not before.
- **2 `prompt()` left alone** — both in `transcodeProxies()`, which is parked
  code behind a removed button, and only a clipboard fallback at that.

This also delivered two of the six primitives from §3.5 (toast, modal shell)
ahead of the consolidation pass, which is the right order — they were needed
here anyway.

**4. Mobile keyboard hints.** 🟠 **Half done, re-verified 2026-08-02.**
`inputmode` is no longer 0 — all 17 `type="number"` inputs already carry it.
`enterkeyhint` genuinely is still 0 across all 45 — no Next/Done affordance
anywhere in a 7-section form. Cheap, high-impact, mobile-specific, and the one
real remaining piece of this item.

**5. Toggle state.** ✅ **Done — every family this item ever listed is now
resolved, most of it same-day (2026-08-02).** The three original families
(dive-type chips, segmented toggles, weather icons — `lfBuildTypeGrid`/
`lfWireSegments`/`lfWireWeather`, `js/logform.js`) were already correct.
Fixed since: `.roc-btn` (`aria-pressed` + per-button `aria-label`, since bare
"R"/"O"/"C" mean nothing to a screen reader), `.st-tgl`, `.rev-toggle`,
`.sort-btn` (all `aria-pressed`), the dive-file `.df-seg-btn` strip and
`.mode-toggle` (`role="tab"`/`aria-selected` — genuine content-switchers, not
filters), and the category-browse tab families in both `js/species.js` and
`js/footage.js` (`.browse-tab`, `.species-browse-tab`, `.sp-picker-tab`, and
their `.fmp-tabs`/`.sp-picker-tabs`/`.species-browse-tabs`/`.browse-tabs`
containers).

Two of the original eight turned out to be **misclassified**, not just
unbuilt: `.cat-pill` isn't a selection control at all (it's a jump-to-section
link list; the real gap was a missing `aria-disabled` on filtered-out pills,
now added) and `.dm-side-tab` isn't a WAI-ARIA tab despite the name (it's a
disclosure/pin control, now `aria-expanded`, same pattern as
`.sp-clips-toggle`). And `.fm-mob-tab` needed no fix at all — it's CSS/JS for
a Videos/Sightings tab switcher with **no markup anywhere that creates the
element**, dead code from the pre-2026-07-25 three-column footage layout.

**A second, independent bug surfaced while fixing the above and got fixed
alongside it:** several category-tab `<div>`s, and one real `<button>`
(`species.js`/`footage.js`'s tag-picker), were wired only to `onmousedown`
(deliberately, to beat a search input's blur) — which means they were **not
operable by keyboard at all**, regardless of any ARIA label, since neither a
`<div>` without `tabindex` nor a native button's keyboard-triggered synthetic
`click` (which never fires `mousedown`) would reach them. Fixed with
`tabindex="0"` plus a parallel `onkeydown` handler wherever this pattern
appeared. Verified live with a real dispatched `KeyboardEvent`, not inferred.

Verified in a real browser (dev server + a fresh, never-visited port to
sidestep a stale service-worker registration from earlier local testing —
`unregister()` itself hung when called against a worker actively controlling
the calling page; a fresh origin/port was the reliable workaround, not a fix
worth chasing further): interactive click/keydown round-trips confirmed for
`.sort-btn`, `.st-tgl`, `.roc-btn`, the dive-type chip grid, a segmented
toggle, a weather icon, and a category tab's keyboard path. The controls
needing a dive/video/sighting fixture to reach (`.df-seg-btn`, `.mode-toggle`,
`.dm-side-tab`, the album controls) were confirmed by reading render and
state-update code together rather than assumed — worth doing carefully, since
`footage.js`'s tag-picker `.browse-tab` turned out to paint via a
`classList.toggle` loop rather than a full re-render, unlike every sibling
control that looks the same shape, and assuming otherwise would have shipped
a real drift bug.

**6. Focus.** ✅ **Done — stale, corrected 2026-08-02.** A broad global floor
now exists (`css/styles.css`, appended deliberately at the end of the file so
it wins on source order against earlier `outline: none` rules): every
standard interactive tag (`a`, `button`, `input`, `select`, `textarea`,
`summary`, `[tabindex]`, `[role="button"]`) gets a `!important` focus ring on
`:focus-visible` specifically — pointer interaction is untouched, so none of
the deliberate mouse-focus treatments the 15 `outline: none` rules exist for
changed. A dark-surface override (mobile nav, sidebar, hero overlay) swaps in
the already-verified `--accent-on-dark` where plain `--accent` would fail
contrast. Well-reasoned, not just present — worth reading the comment block
above it in `styles.css` before touching this area again.

**7. Dark mode.** ✅ **Done 2026-08-06** — a System/Light/Dark control in Settings →
Appearance, `.theme-harbour` on `<html>`, with a live `prefers-color-scheme`
listener for System mode. See §5 row 7.5 and `CLAUDE.md` → "Built" for the full
account.

### 3.5 The verdict on the UI question

**Correction to the first draft of this brief.** It led with "most of this isn't
worth replacing," which read as "the UI is fine." That's not what the audit
found and it's not what I meant. Two separate questions got collapsed into one:

| Question | Answer |
|---|---|
| Is there substantial UI work worth doing? | **Yes — a lot.** §3.4 alone is weeks of genuine, user-visible improvement. |
| Should that work be done by *importing a component library*? | **No.** The fixes are a token layer, ~6 CSS primitives, and an accessibility pass. A library delivers none of the accessibility fixes (they're in *your* markup) and charges §4's price for the consistency. |
| Should the **signature** layer be replaced? | **No, and this is the part that's genuinely "not worth replacing."** |

The original headline applied the third row's answer to all three rows. The work
below is the corrected scope.

**What's worth doing, roughly ordered by value:**

1. **Accessibility (§3.4).** Labels, touch targets, native-dialog replacement,
   keyboard hints, `aria-pressed`, focus. Ships to the PWA immediately, benefits
   every platform, needs no library and no build step. Largest single item is
   the 45 missing `for=` attributes.
2. **Colour architecture (§3.6).** Where Material is a real win — and it's
   separable from Material *components*.
3. **~6 CSS primitives** — `.btn` (with modifiers), a labelled field, `.chip`, a
   tab strip, a sheet/modal shell, and a toast. The existing ~100 button-shaped
   rules collapse into them over time. Plus a **radius scale** and a **spacing
   scale**, which is where the 25-distinct-radii number actually gets fixed.
4. ✅ **App-wide dark mode** — done 2026-08-06 (§5 row 7.5), and #6.5/§3.6's
   token architecture is exactly what made it tractable rather than a hand-tuned
   slog, as predicted here.

All four are CSS-and-markup work with zero JS restructuring, zero build step, and
zero risk to the macOS build.

### 3.6 Material colour — you're right, and here's the precise version

> **Status: architecture landed 2026-07-29 (v2.99).** Surface ladder, `on-*`
> pairing and the `--font-size-*` rename are all in. What is *not* done is the
> contrast debt the pairing exposed — see the end of this section; it needs a
> brand decision, not a refactor.

Material Design 3 colour is a **clear win, and it does not require `@material/web`,
npm, or a single Material component.** MD3's colour system is a specification
about *structure* — role naming, guaranteed foreground/background pairing, a
surface hierarchy, and a tonal-generation method. All of that is implementable as
CSS custom properties in the file you already have.

Critically: **adopt MD3's architecture, not its hues.** Google's baseline palette
would delete Driftwood/Deep Water/Dusty Cerulean, which is the brand. The hues
stay; the structure around them changes.

**What Shoal genuinely lacks that MD3 provides:**

**1. `on-*` pairing — the big one.** MD3 guarantees every container colour has a
named foreground partner with verified contrast (`primary`/`on-primary`,
`surface`/`on-surface`, `error-container`/`on-error-container`). Shoal has **no
`on-*` concept at all** — `--accent-fill` "with white text" is an ad-hoc
convention held in prose, not in the tokens.

Look at what `CLAUDE colour UI.md` and `CLAUDE.md` already record as
individually-discovered bugs:

- Warm Taupe at ~3.46:1, "under WCAG AA even for large text," darkened by hand
- Light-mode `--accent` at **2.44:1** on the mobile nav gradient → needed a
  bespoke `--mobile-nav-active` token
- The tank gauge's white end-pressure number at **1.16:1** on the empty body —
  "measured-invisible, not just low-contrast"
- Cerulean-as-text at ~2.98:1 across 16 headings
- Theme classes needing an explicit `color: var(--text)` or elements inherit
  computed light ink (found via an unreadable "Footage" title)

**Every one of those is the same bug: a foreground and a background chosen
independently.** `on-*` pairing makes that class of bug structurally impossible
rather than something you catch one screenshot at a time. Given how much of that
document is a record of finding them by hand, this is the highest-value
structural change available to the colour system.

**2. A surface-container ladder.** Shoal has two levels (`--surface`,
`--surface2`) plus `--bg`. MD3 defines five (`surface-container-lowest` →
`highest`). The dive-file folder-tab construction, the recessed marine-search
trough, and the `--taupe-dim` banner fill are all hand-solving "I need another
level here" — that's the missing ladder showing through.

**3. Dark mode as generated tones, not hand-picked overrides.** Shoal has **0**
`prefers-color-scheme` queries and one hand-tuned `.theme-harbour` scoped to the
footage modal. `CLAUDE colour UI.md` states plainly that an app-wide theme "must
add lifted variants for the darkest ramp members (Night, Wall, Cave, Wreck) —
deferred until then." MD3's tonal-palette method — generate tones 0–100 from a
source hue, then pick different tone *numbers* for light vs dark — produces those
lifted ramp variants mechanically, from the hues you already have. That deferred
item stops being a design problem and becomes arithmetic. The four
`--profile-*` shades currently "computed once by hand… recompute by hand if
`--accent` changes" fall out of the same method.

**4. Naming that fixes a known collision.** `CLAUDE colour UI.md` flags
`--text-muted`/`--text-dim` (colours) colliding with `--text-xs`/`--text-sm`
(sizes) as "the kind of collision that produces a genuinely confusing bug once."
An MD3-shaped rename (`--on-surface-variant` for the colour, `--font-size-*` for
the scale) resolves it as a side effect.

**What must NOT be adopted:**

- **MD3's baseline hues.** Brand deletion.
- **`primary`/`secondary`/`tertiary` as a home for Shoal's reserved semantics.**
  This would be a category error. MD3's primary/secondary/tertiary are *aesthetic
  emphasis* slots. Shoal's `--gold` (earned only), `--violet-deep` (IUCN CR only),
  `--warn` vs `--danger`, and the 10-member dive-type ramp are *semantic and
  categorical* — a stricter discipline than MD3 has. They keep their own names
  and their own three-class model, and simply gain `on-*` partners.
- **`@material/web` components.** Maintenance mode since June 2024, and §4.

**The synthesis:** MD3 colour architecture as the substrate, `CLAUDE colour UI.md`'s
three-class model as the layer above it. They're compatible — the three-class
model governs *which colours exist and what they mean*; MD3 governs *how each one
is paired, laddered, and re-toned for dark mode*. Neither answers the other's
question.

**Cost:** a token-layer rewrite in `:root` plus a mechanical find-and-replace
across `css/styles.css`. No npm, no components, no build step, no JS change, no
macOS risk. The dark-mode payoff is the largest single visible improvement
available for the effort, and it's currently blocked on exactly the structure
MD3 supplies.

**One caveat worth stating:** this touches every rule in a 5,022-line file, so it
wants to happen **after** the accessibility pass (which changes markup, not
colour) and **before** the primitive consolidation (which should be written
against the final token names, not migrated twice).

---

## 4 · The npm / build-step decision

Framed as a real decision with costs on both sides, per your ask.

### What adopting npm + a bundler would cost

1. **The global-scope model breaks.** 182 inline `onclick` handlers reference
   globals. Under a bundler, every one of those globals needs an explicit
   `window.x = x` export or the handlers silently become `ReferenceError`s at
   click time — not at build time. That's the worst possible failure mode for a
   codebase with no test suite.
2. **The service-worker discipline becomes obsolete and must be rewritten.**
   `SHELL_CRITICAL` is hand-maintained with a documented, hard-won discipline
   (the `/index.html` redirect trap, the bump-on-every-edit rule that burned two
   hardware sessions). Hashed bundle filenames make hand maintenance impossible →
   the list must be generated → the discipline documented in `sw.js` and
   `CLAUDE.md` no longer applies and needs replacing with a new one you haven't
   debugged yet.
3. **Deployment gains a failure mode.** Cloudflare Pages currently serves the repo
   verbatim, ~30s from push to live, no CI. A build step inserts a stage that can
   succeed while producing wrong output.
4. **Verification gets weaker, not stronger.** Today it's "jsc syntax-check + open
   a browser". A bundler can produce a clean build that's broken at runtime, and
   there's no test suite to catch it.
5. **A second toolchain lands in the same window as a third.** The Android port
   already adds Android SDK + NDK + Gradle. Adding npm simultaneously compounds
   risk on a build that must keep shipping macOS.
6. **Supply-chain surface.** The vendored-Leaflet decision and the "no third-party
   code at runtime" invariant both exist specifically to avoid this — and they're
   part of why the Play data-safety form is easy to answer honestly.

### What adopting it would buy

1. **Component libraries** — which §3 argues you shouldn't want. And the flagship
   candidate is gone anyway: `@material/web` has been in maintenance mode since
   June 2024. MD3 remains fully usable as a *design system* (colour roles, type
   scale, motion, touch targets) with no package at all.
2. **Accessibility-tested primitives** (Radix, Ark) — but these are React/Vue-shaped.
   Adopting them means adopting a **framework**, not just a build step. That's a
   front-end rewrite, which is a different conversation entirely.
3. **Minification / tree-shaking** — marginal here. ~250KB of JS plus a 1.3MB
   species database that is data and doesn't minify meaningfully.
4. **TypeScript** — the one genuine benefit. 21,585 lines with no tests and no
   linter is where type-checking earns its keep.

### Verdict

**No — not for the UI question.** The thing npm would buy is the thing the audit
says not to buy.

Note what this verdict does **not** block, because the distinction is the whole
point:

| Thing | Needs npm? | Verdict |
|---|---|---|
| MD3 **colour architecture** (§3.6) | ❌ No — CSS custom properties | ✅ **Do it** |
| MD3 type scale / touch-target guidance | ❌ No — a spec, not a package | ✅ Already partly done |
| ~6 CSS primitives (§3.5) | ❌ No | ✅ Do it |
| Accessibility pass (§3.4) | ❌ No — markup attributes | ✅ Do it first |
| **Tauri plugins** (§2.6) | ❌ No — `cargo` crates, reachable via `withGlobalTauri` | ✅ Required for the port |
| `@material/web` components | ✅ Yes | ❌ No (and maintenance mode) |
| Radix / Ark primitives | ✅ Yes — **plus a framework** | ❌ No |
| TypeScript / a test runner | ✅ Yes | 🟡 Separate argument, separate window |

Almost everything worth doing to this UI sits in the "no npm needed" rows. That's
not a coincidence — it's because the problems found are *structural and semantic*
(missing labels, missing token relationships, missing scales), and those live in
your own markup and tokens regardless of what renders them.

If npm is ever adopted, let it be argued on **TypeScript or a test runner**, on
its own merits, in its own window — and explicitly *not* during the Android port,
where it would double the number of simultaneously-novel build systems while the
macOS release has to keep shipping.

This leaves CLAUDE.md's "no build tools, no npm, no bundler" rule intact. That's
the recommendation, not a fudge: the rule is still correct, and the Play Store
move is not the thing that overturns it.

---

## 5 · Recommended sequence

Ordered by a mix of clock-pressure, dependency, and risk. Items marked ∥ run in
parallel with what's above them.

| # | Work | Why here | Rough size |
|---|---|---|---|
| **1** | ✅ **Public landing page + privacy policy**, outside Cloudflare Access | **Done, confirmed 2026-08-04** — `https://diveshoal.com/privacy` is live and reachable with no Access wall (§0). Was the shared prerequisite for OAuth production *and* the Play listing. | Done |
| **2** | **OAuth consent screen → Production** | Only item with an active clock — refresh tokens expiring every 7 days now. **Its prerequisite (#1) is now done** — nothing left blocking this from the code/infrastructure side. The actual Google Cloud Console action (flipping Testing → Production) is a manual step this repo can't confirm either way; not verified done. **Confirmed 2026-08-03 (§1.6): `drive.file` is Shoal's actual scope, the "sensitive" tier — no paid CASA security audit required**, which is what keeps this estimate at hours rather than weeks. | Hours — ready to do |
| **3 ∥** | **Play Console account; decide personal vs organisation.** Get *anything* onto a closed track. | 12 testers × 14 continuous days is wall-clock you cannot compress. Start the timer, then go do the engineering. **Second purpose added 2026-07-29:** this is also how you obtain the Play **app signing SHA-1** (§1.2), which the Android OAuth client needs — so it is now a hard prerequisite for the media feature, not only the clock. Create the app, push any AAB to an internal track, then register **both** fingerprints. | Hours + 14 days elapsed |
| **4** | ✅ **Tauri Android spike** — `android-spike` branch, real device (Galaxy S10) | **Done 2026-07-30.** (a) **No** — `showDirectoryPicker()` exists and accepts a genuine gesture but rejects with `AbortError`, no native chooser ever appears (§2.3, confirmed via CDP with a real dispatched click, not just a tap that "didn't seem to work"). Folder sync needs a real SAF backend, no shortcut available. (b) **Yes, confirmed** — full `cargo tauri android build --debug` succeeded once `keyring`/`btleplug` were cfg-gated (§2.2); a *third*, unpredicted blocker (`pick_folder` has no Android implementation in `tauri-plugin-dialog` at all) needed the same treatment. (c) **Yes, and it's good** — mobile nav wave, SVG icons, Young Serif/Figtree, gradients, segmented controls all render correctly on real hardware, screenshotted. (d) **Not reached** — device time went to (a) instead, which needed a CDP deep-dive to answer properly rather than a quick tap. Still open. | Done |
| **5 ∥** | ✅ **Accessibility pass** — labels, `inputmode`/`enterkeyhint`, touch targets, `aria-pressed`/`aria-selected`/`aria-expanded`, focus-visible | **Every item done — the one thing left when this row was last written, `.vrow-del`'s touch target, turned out already fixed too** (found live-checking before redoing it: a later CSS rule overrides it to 24×24, clearing AA). Labels, inputmode, focus-visible, and toggle/tab ARIA state were also already complete from earlier work this doc never caught up with. `enterkeyhint` added across 31 real candidates 2026-08-02. Two genuine keyboard-operability bugs found and fixed along the way (mousedown-only controls unreachable by keyboard). **Only the packed-row comfort group remains** (`.roc-btn`, `.dh-abtn`, etc.) — AAA/Android-comfort only, not an AA failure, deliberately deferred since it needs a real device layout check at 360–400px. | Done except packed-row comfort |
| **6** | ✅ **Replace the 16 `alert`/`confirm`/`prompt`** with a toast + the existing overlay-stack confirm | **Done (v2.99).** Re-verified 2026-08-04, not just re-read: a live grep for every `alert(`/`confirm(`/`prompt(` call across `js/*.js` and `index.html` finds exactly 2 left, both `prompt()` inside `transcodeProxies()` — parked code behind a removed button, no live path to reach them (§3.4). Everything else already went through `showToast()`/`confirmAction()`. This row had no ✅ despite §3.4 already documenting it done — the same doc-staleness pattern found elsewhere in this file. | Done |
| **6.5** | ✅ **MD3 colour architecture** (§3.6) — `on-*` pairing, surface-container ladder, tonal generation, `--font-size-*` rename | **Architecture done since v2.99; the one debt it left is done too, as of 2026-08-04.** The ladder/`on-*`/rename landed 2026-07-29. What remained was `--accent` measuring 3.27:1 as text (§3.6's own "needs a brand decision, not a refactor" note) — resolved with a new `--accent-text` token (same hue/sat, lightness taken to the minimum that clears 4.5:1) rather than darkening `--accent` itself, since `--accent` also does fill/stroke work with no contrast obligation. Applied to the 63 genuinely-interactive sites found in a full re-sweep; the video/footage metadata cluster and mobile-picker-tag/bold-emphasis bucket (10 sites) are deliberately still open, per `CLAUDE colour UI.md`'s own standing note to fix those together in one pass. Not yet given a dark-theme value — left for #7.5's implementation to set. | Done |
| **7** | 🟡 **CSS primitive consolidation** — 6 primitives + radius/spacing scales | After #5, #6 and #6.5, because all three define what the primitives must do and what they're named in terms of. Doing it first means doing it twice — now safe, since #6.5 is done. **3 of 6 primitives now exist** (toast, modal shell from #6; **tab strip, done 2026-08-04** — `.tab-strip`/`.tab` in `css/styles.css`, consolidating 3 of the 9 classes the UI audit's own table filed under "tab strips." The other 6 were investigated and correctly excluded: 1 confirmed dead and deleted (`.fm-mob-tab`), 1 a pure container reusing an already-consolidated class (`.fmp-tabs`), 2 not actually tabs on inspection (`.lf-seg-opt`, `.dm-side-tab`), 2 deliberately kept separate as genuinely different, already-documented visual patterns (`.df-seg-btn`, `.mode-toggle`) — see `CLAUDE.md` → "Built" for the full account, including a real token-inconsistency bug the consolidation caught (`.species-browse-tab`'s active border was on the wrong token). **`.btn` census done 2026-08-05, first pass landed, full unification not yet.** A ground-truth census found ~65 button-shaped rules across 13 shape-families — roughly double the "~30" this row originally estimated, since that number was an eyeball count of the audit's own sample list, not a real inventory. This pass shipped what was safely verifiable: 9 confirmed-dead classes deleted (incl. `.btn-save-device`, which the audit itself had named as a sample of the problem, plus a permanently-no-op `getElementById` in `js/app.js` it left behind), one near-miss caught before deleting (`.tcw-*`/`#tc-widget` looked dead by the same zero-refs test as `.proxy-script` but is deliberately parked/retained code per `js/video.js`'s own header comment — read the function body, not just the grep count), and 3 small high-confidence merges (`.jump-pill` absorbing 3 byte-identical copies; `.btn-confirm-ok`/`.btn-confirm-cancel` absorbing 2 more; `.hist-map-btn`/`.hist-back-btn` merged, catching a real missing-hover-tint drift). The two biggest remaining families — a 9-member solid-CTA family and an 18-member ghost/outline family already anchored by a real `.btn-ghost`/`.btn-primary` — were deliberately deferred rather than forced, same as an 11-member icon-square-button family that looks like tab-strip's padding-drift bug at a glance but turned out to carry real, likely-intentional background/border variance plus an explicit existing a11y-floor comment against resizing several of its members without a device check first. **Second pass, same day: 2 more near-duplicate pairs found by reading through the two large deferred families individually** — `.numscroll-set`/`.afr-card .afr-go` (a 1px padding accident) and `.vid-del`/`.vid-stamp-btn` (which caught a real missing-hover-background drift, same class as the `.hist-map-btn` find, plus a `--text-dim`/`--text-muted` contrast-token fix). Everything else re-checked in both families held up as real, deliberate variance and was left alone. **`.pill` done 2026-08-06 — 4 of 6 primitives now built.** Checked all 8 "chip" candidates the button census had surfaced; only `.cat-pill`/`.sp-country-pill` shared real, identical geometry (merged, state rules left untouched since the code already documents their difference as deliberate). The other 6 were genuinely different things: a different font register (`.pdc-loc-pill`), two members of the reserved dive-type colour ramp (`.lf-type-chip`, `.df-type-pill`), a plain text label with no box (`.fm-tag`), and two non-matching non-interactive badges (`.fm-vid-chip`, `.df-pc-pill`). See `CLAUDE.md` → "Built" for the full account. **Radius scale: exact-match migration done 2026-08-02.** `--radius-xs/sm/md/lg/full` all now carry every declaration that was byte-identical to one of them — 106 sites (`css/styles.css`'s own comment above the scale has the exact per-step counts and the reasoning for what's still excluded). **Labelled field done 2026-08-07 — 5 of 6 primitives now built.** A full census (82 real form controls, 9 label/wrapper families) found 2 genuine duplicates of the already-good `.field` primitive (`.lf-numcol`/`.lf-numlbl`, `.lf-site-label`) and merged them in via the same alias technique; 5 more candidates (`.tx-lbl`, `.af-lbl`, `.lf-dial-name`, `.stop-type`, `.pdc-loc-search-label`) were confirmed genuinely different and left alone. A new `.form-label` class covers bare labels with no wrapper. Also fixed a real accessibility gap the census surfaced: the Plan panel's inline add/edit dive row had 8 inputs with no label of any kind, identified only by placeholder text — now carries `aria-label`s throughout. See `CLAUDE.md` → "Built" for the full account. **`.chip` done 2026-08-08 — all 6 primitives now built.** A dedicated census found only one real chip candidate anywhere in the app (`.ulchip`, the footage-tagging modal's "already-logged sighting" quick-link chips) that wasn't already `.pill`/`.tab-strip`/the reserved dive-type ramp/a non-interactive badge — and it turned out to be a near-duplicate of `.pill`, not a genuinely different shape, so `.chip` ships as a deliberately bare alias sharing `.pill`'s exact rule rather than an invented second primitive. `.ulchip`'s own colour/padding/hover merged in the same "shared geometry, separate state" way as every prior primitive. Two more candidates (`.tp-tag`, `.roc-btn`) were confirmed to be buttons/toggles, not chips, and excluded. Two unrelated real findings surfaced along the way and were flagged rather than fixed here: a 3-way duplicate read-only abundance badge (`.sp-ab`/`.sp-sighting-row .ab`/`.vid-stamp-ab`) and a second R/O/C picker (`.af-ab`) missing the ARIA state its sibling `.roc-btn` already has. See `CLAUDE.md` → "Built" for the full account. Remaining: ~130 non-exact `border-radius` declarations (5px/7px/10px/3px/9px/long-tail — genuinely need a visual judgement call per site, not a script), the spacing scale, and the two large `.btn` families still deferred. | In progress — all 6 primitives done (toast, modal shell, tab strip, `.pill`, labelled field, `.chip`); `.btn` first two passes done — the two large deferred families are the natural next target |
| **7.5** | ✅ **App-wide dark mode** — design 2026-08-04, implemented 2026-08-06 | **A System/Light/Dark control in Settings → Appearance** (default System, `prefers-color-scheme`-driven, explicit override persisted), `.theme-harbour` on `<html>`. The shipped modal-only token block was fully replaced (not patched) with the locked design's set — full `on-*` pairing, 7 lifted dive-type ramp members, 5 profile-chart tokens, corrected `--danger`/`--accent-text`, 8-rank IUCN chips with a base-class neutral fallback that also fixed a real cross-theme fallthrough bug (two species with legacy invalid status codes rendered unstyled in *either* theme before this). Real component bugs found live beyond the design pass's original modal-only scope, not just token copies: `.dD-select-box.checked`, the tank pressure gauge (`_dfTankHtml`, plus a pre-existing light-mode bug closed as part of the same fix), a new `--on-type` pair covering `.lf-type-chip.sel`/`.dD-spine span`/`.df-type-pill` (the last found live during implementation, not in the original list), and `.mobile-cog`'s background (`var(--text)` silently assumed always-dark, broke completely once `--text` flipped light). The page-wide depth gradient and static sun-on-water mesh — both hardcoded light-mode literals that wouldn't have changed under the new theme — now have dark overrides, the gradient taken verbatim from the design pass's five independently-matching screen mockups. A dive file with an open profile chart now repaints correctly on a live theme change (reachable via System-mode OS flips with zero navigation). **Removed in the same pass**: the rarely-used, dial-controlled caustics shimmer feature — its SVG filter hardcoded a warm-cream output regardless of theme, making it the single hardest piece to get right on dark, and it was going away anyway. Deliberately deferred: ~53 sites duplicating semantic-colour tints as raw `rgba()` literals (cosmetic hue drift on dark, not illegible) — a documented follow-up. See `CLAUDE.md` → "Built" for the full account. | Done |
| **8** | ✅ **Rust platform gating** — capabilities, `keyring` cfg, `isShell()` discriminator + all 41 call sites, version alignment | **`isShell()` audit done (§2.10).** 3 real bugs found and fixed across the whole sweep: footage-match section silently doing nothing on Android, the Admiralty tide feature leaking onto Android at 4 call sites, and `exportUnvalidatedSpecies`'s write path (real Rust fix, not a JS split — new `android_write_uri` command). The other ~38 sites turned out already correct as plain `isShell()` — most callers genuinely mean "any Tauri build," which the original "41 sites, 33 latent bugs" framing didn't anticipate. `keyring`/version-alignment gating confirmed working since the first Android build. | Done |
| **9** | **Android folder sync + BLE + media ingest** | ✅ **Folder sync done and verified (§2.7).** ✅ **BLE fully done and verified (§2.8)** — `tauri-plugin-blec` over hand-rolled droidplug/JNI; a real 94-dive Shearwater Peregrine sync completed end to end on the Galaxy S10 (2026-07-31), the fingerprint/incremental-sync/bulk-add pipeline all confirmed working with real data. 🟡 **Media ingest partially designed (§2.9), genuinely blocked, not just unstarted.** It's the Drive upload feature, not a local-scan port (§2.2's own decision). The picker-selection mechanism is confirmed (a plain file input, no new code needed) and the Android OAuth redirect mechanism is verified live end-to-end (deep-link → JS event, via a real simulated Android intent) — but the Google-server side of OAuth, and the upload pipeline itself, can't be built/tested further without a Play Console app existing first (§5 step 3), since the Android OAuth client needs its SHA-1. | Folder sync + BLE fully done; media ingest blocked on step 3, not on more engineering time |
| **9.5** | **Verify Drive auth on a *Play-installed* build** | New, 2026-07-29, and non-negotiable. Install from the internal track on a device that has **never run a local build**, then connect Drive. This is the only test that exercises the Play app signing key; passing locally proves nothing (§1.2). The single failure this whole ordering exists to prevent. | Hours |
| **10** | **Listing assets, data-safety form, content rating, closed → production** | Last, and gated on #3's 14-day clock having already run. Now also carries §1.6's expanded declarations and the **reviewer demo account** for Drive. | Days |

### Two notes on the sequence

**The health-policy question (§1.4)** should be researched somewhere around #3,
before the store description is written — not because it's likely to block, but
because discovering it late means rewriting the listing.

**Housekeeping — resolved 2026-08-13.** This previously flagged a set of
untracked `*-shoal.md` public-variant docs sitting at repo root. That split is
gone: the public variants became the canonical `README.md` / `DECISIONS.md` /
`ROADMAP.md`, the strategy-only sections moved out of the repo, and
`LICENSE.md` (AGPL-3.0) is now tracked and shipped inside the app bundle.

---

## 6 · The one-paragraph answer to each question

**Does the architecture survive?** Yes, unchanged. Single-page + no-build is the
right shape inside a Tauri Android WebView, the service worker is already excluded
from the shell path, and `prepare-web.sh` needs nothing. The port is a Rust
problem — capabilities, `keyring`, SAF, droidplug — plus one mechanical front-end
change: making `isShell()` platform-aware across 41 call sites.

**What's reinvention vs signature?** Roughly **100 hand-rolled button-shaped
rules** across ~13 commodity families where a primitive layer would provide one
each — 30 buttons, 11 close buttons, 12 chips, 9 tab strips, 13 banners, 7 modal
shells, 0 toasts. The signature layer — depth gradient, caustics, stat bubbles,
NDL chart, nav wave, type spine, dials, map-pin card, tank gauge — is the product
and should not be touched. **Everything else should be worked on, and there's a
lot of it** (§3.5 corrects the first draft, which conflated "don't buy a library"
with "don't do UI work"). Ordered by value: the **accessibility** layer first —
larger than expected, since **no input in the app has a programmatic name** — then
**MD3 colour architecture** (§3.6: `on-*` pairing, a surface-container ladder,
tonal generation for dark mode — a real win, and free of npm and of Material
components), then the primitives, then app-wide dark mode.

**Are there Tauri UI components?** No, and the category doesn't exist — Tauri is a
WebView plus a Rust bridge, with no widget set on any platform (§2.6). But the
Tauri **plugin** ecosystem matters a great deal to the port: `deep-link`,
`geolocation` and `stronghold` answer three of the four Android blockers, and
`haptics` is an hour's work for a disproportionate gain in how native the app
feels. These are `cargo` crates and don't touch the npm decision at all.

**What does Play readiness require?** A public privacy policy (blocked by
Cloudflare Access today), a data-safety declaration that's honest about the six
third-party endpoints receiving dive coordinates, target API 36, an AAB with
proper signing, listing assets, and — the long pole — **12 testers for 14
continuous days** if you go with a personal account. The app itself is unusually
clean against Play's policy checklist; the work is paperwork and wall-clock, and
it is entirely independent of the UI question.

**What does the media feature change?** (Added 2026-07-29.) Drive ships in v1, so
the first submission carries the heaviest version of every declaration: photos,
videos and files leaving the device, the account email, and — non-obviously —
location, because photo filenames encode the dive site. "No login" stops being
true and a reviewer demo account is owed. Ingest is picker-based on Android by
policy, so the desktop's recursive folder scan does not port and both models are
kept side by side. And one ordering trap: the Android OAuth client must be
registered against the **Play app signing** SHA-1, not the upload key, which
makes the Play Console app a prerequisite for the feature rather than just for
the testing clock. None of this changes §5's shape; it changes what §1.3 declares
and what §2.3 tests.
