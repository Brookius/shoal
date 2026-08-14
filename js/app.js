// Core app — extracted from index.html (modular migration, step 10, v2.0).
// Classic script, loaded before the inline boot sequence (shared global scope).
// Contains: app state (dives[], sightings[], syncMode), saveDive, generateMD,
//   show(), edit/delete modal, modal marine life, folder sync, site search
//   (Dive Vibe + Nominatim), GPS capture, export/download, updateCount,
//   updateMobileNav, buildSiteHistory. acBootstrap() called at end of file
//   (needs dives[], which is declared here).

// Shell detection — single source of truth for all browser/shell divergence.
// Every seam checks isShell(); never scatter raw window.__TAURI__ checks.
function isShell() { return !!window.__TAURI__; }

// Platform discriminator (v2.993). isShell() answers "is this a Tauri build?"
// and is TRUE on Android too — which is not the question most call sites are
// actually asking. There are now three storage backends, not two:
//
//   isAndroidShell()  → SAF content URIs      (android_* commands, js seam below)
//   isDesktopShell()  → absolute fs paths     (read/write/remove_text_file)
//   neither           → File System Access    (browser handles in IndexedDB)
//
// Deliberately scoped: only folder sync consumes these today. The other ~33
// isShell() sites (proxy scanning, Admiralty, SW registration) are a separate
// audit — see BRIEF-play-store-readiness.md §2.4. Do NOT bulk-replace them;
// each one means a different thing and needs reading individually.
//
// User-agent sniffing rather than tauri-plugin-os: this must answer correctly
// during the boot sequence, before any async plugin call could resolve, and
// getting it wrong means writing dive files through the wrong backend.
function isAndroidShell() {
  return isShell() && /android/i.test(navigator.userAgent || '');
}
function isDesktopShell() {
  return isShell() && !isAndroidShell();
}

// The picked SAF folder, as the opaque JSON the Rust side handed back. Stored
// whole and never parsed here — see src-tauri/src/androidfs.rs on why the wire
// type is deliberately opaque. Null until a folder is picked.
function _androidFolder() {
  try { return JSON.parse(localStorage.getItem('divelog-android-folder') || 'null'); }
  catch (e) { return null; }
}
function _setAndroidFolder(handle) {
  if (handle) localStorage.setItem('divelog-android-folder', JSON.stringify(handle));
  else localStorage.removeItem('divelog-android-folder');
}

// Incremental-sync cursor for android_list_md_files (src-tauri/src/androidfs.rs)
// — the newest per-file `last_modified` (ms since epoch) that sync has
// already seen for THIS folder. Keyed on the folder's own `uri`, not stored
// bare, so picking a DIFFERENT folder can never compare against a stale
// cursor left over from another one — no reset logic needed in setDiveFolder,
// a mismatched uri just reads back as "no cursor" and syncFromFolder does a
// full read. Reconnecting to the SAME folder after a lapsed grant keeps its
// cursor warm on purpose: nothing about the files themselves changed, only
// the app's permission to see them.
function _androidFolderSyncCursor(folder) {
  try {
    const raw = JSON.parse(localStorage.getItem('divelog-android-folder-sync-cursor') || 'null');
    if (raw && folder && raw.uri === folder.uri) return raw.ms;
  } catch (e) { /* corrupt — treat as no cursor, same as never having synced */ }
  return null;
}
function _setAndroidFolderSyncCursor(folder, ms) {
  if (!folder || !folder.uri) return;
  localStorage.setItem('divelog-android-folder-sync-cursor', JSON.stringify({ uri: folder.uri, ms }));
}

// Ask the SAF provider what the folder is actually called.
//
// This used to be derived in JS by splitting the content URI and taking the
// last path segment. That works only for local storage, where the segment
// happens to be readable (`…/tree/primary%3ADocuments` → `Documents`). A
// Google Drive folder's URI ends in an opaque document id, so Settings showed
// `acc=8;doc=encoded=eVbk4Q-zrXF85H-…` as the name of the synced folder — seen
// on real hardware 2026-08-01. Only the provider knows the real name.
async function _androidFolderDisplayName(folder) {
  try {
    const name = await window.__TAURI__.core.invoke('android_folder_name', { folder });
    if (name) return name;
  } catch (e) { /* provider couldn't answer — fall through to the generic label */ }
  return 'Selected folder';
}

// Re-read the folder's display name at boot and correct the stored label.
//
// Two jobs: it repairs the raw-document-id labels written by the old
// URI-splitting derivation above (no re-pick needed), and it keeps the label
// honest if the folder is later renamed in Drive or the Files app. One
// round trip, only in folder mode, and it never blocks the boot sequence —
// the label just updates a moment after the panel renders.
async function _refreshAndroidFolderName() {
  if (!isAndroidShell() || syncMode !== 'folder') return;
  const folder = _androidFolder();
  if (!folder) return;
  const name = await _androidFolderDisplayName(folder);
  if (name === 'Selected folder') return; // couldn't resolve — keep what we have
  if (name === localStorage.getItem('divelog-folder-name')) return;
  localStorage.setItem('divelog-folder-name', name);
  updateFolderUI(name);
}

// Reduce Settings → "Where your dives live" to the one backend Android can
// actually use. The three-way Browser/Folder/Obsidian choice is a desktop
// concept: presenting two dead ends as options only invites picking one.
// "Clear" goes too — on a platform where folder sync is the sole backup path,
// disconnecting isn't a setting worth offering, and the first-dive prompt
// (above) would just re-fire anyway. "Sync from folder" stays: pulling in
// dives logged on another device is a real, deliberate action.
function _applyAndroidSyncUI() {
  if (!isAndroidShell()) return;
  const hide = id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
  hide('sync-mode-row');
  hide('dive-folder-clear');
  const cfg = document.getElementById('sync-folder-config');
  if (cfg) cfg.style.display = ''; // no mode buttons left to reveal it

  const intro = document.getElementById('sync-mode-intro');
  if (intro) intro.textContent = 'Every dive is written as a file into a folder you choose. '
    + 'Pick a Google Drive folder to back them up to the cloud, or any folder on the phone to keep them local.';

  const cfgIntro = document.getElementById('folder-config-intro');
  if (cfgIntro) cfgIntro.remove(); // browser-specific caveats, none of them true here

  // Pre-empt the exact wall a first-time user hits: tapping Drive in the
  // picker lands on a screen that REFUSES selection ("Can't use this folder —
  // to protect privacy, choose another folder"). That's Android blocking
  // selection at the root of the provider, not a Shoal error, and the way past
  // it is to go one level deeper. Found on real hardware 2026-08-01; without
  // this line the first thing our own advice produces is an error message.
  const hint = document.getElementById('folder-config-hint');
  if (hint) hint.innerHTML = '<strong>Using Google Drive:</strong> tap Drive in the picker, open '
    + '<strong>My Drive</strong>, then go <em>inside</em> a folder before choosing it. Android refuses '
    + 'the top-level Drive screen — that\'s the OS, not Shoal.';
}

// ── Android first-dive folder requirement (BRIEF-play-store-readiness.md
// §2.11) ─────────────────────────────────────────────────────────────────
// Browser and Obsidian sync are both dead ends inside the Android native
// shell specifically — showDirectoryPicker() aborts inside wry's WebView
// (§2.3) and the Local REST API plugin doesn't support Android at all — so
// Folder sync is the ONLY path that can ever back this app up on this
// platform. Left opt-in, it's easy to never notice until a lost phone makes
// it matter. Deliberately NOT shown before the first dive — asking someone
// to make a storage decision before they've used the app at all is friction
// at the worst possible moment; asking right after they've created their
// first real piece of data is the moment the case for backing it up is
// concrete, not abstract. Deliberately a true hard block once triggered —
// no close button, cancelling the picker just leaves it on screen — because
// anything short of that (a "not now" that quietly goes away) is exactly
// how this gets forgotten, which is the whole problem being solved. Checked
// at boot AND right after every save (both idempotent, both cheap) rather
// than only once right after the first save, so killing the app mid-prompt
// can't be used as an accidental escape hatch — the same condition just
// re-fires on next launch.
function _androidFolderRequired() {
  return isAndroidShell() && dives.length > 0 && !_androidFolder();
}

function _maybeShowAndroidFolderRequiredPrompt() {
  if (!_androidFolderRequired()) return false;
  if (document.getElementById('android-folder-required')) return true; // already up
  const el = document.createElement('div');
  el.id = 'android-folder-required';
  el.innerHTML = `
    <div class="afr-card">
      <h2>Where should your dives live?</h2>
      <p>Shoal has no account and no server. Your dive log is stored on this phone and nowhere else &mdash; so if you lose the phone, you lose the log.</p>
      <p>Pick a folder and every dive is written there too, as a file you own. Choose a <strong>Google Drive</strong> folder and your log backs up to the cloud automatically. Or pick any folder on the phone to keep it local.</p>
      <p class="afr-hint">Going to Drive? Open <strong>My Drive</strong> and pick a folder <em>inside</em> it &mdash; Android won't let you choose the top-level Drive screen.</p>
      <button type="button" class="afr-go" onclick="_androidFolderRequiredPick(this)">Choose a folder</button>
    </div>`;
  document.body.appendChild(el);
  return true;
}

async function _androidFolderRequiredPick(btn) {
  btn.disabled = true;
  btn.textContent = 'Choosing…';
  setSyncMode('folder');
  const ok = await setDiveFolder();
  if (ok) {
    const el = document.getElementById('android-folder-required');
    if (el) el.remove();
    return;
  }
  // Cancelled or failed — stays up. True hard block: the only way past this
  // is actually connecting a folder, not a close button.
  btn.disabled = false;
  btn.textContent = 'Choose a folder';
}

let dives = JSON.parse(localStorage.getItem('divelog-dives') || '[]');
let sightings = []; // { scientificName, commonName, aphiaId, count, validated }
let _siteHistory = {}; // built by buildSiteHistory() — must be declared before first call
let syncMode = localStorage.getItem('divelog-sync-mode') || 'none'; // 'none'|'folder'|'obsidian'
// Android has exactly one working backend, so 'none' and 'obsidian' aren't
// choices there — they're dead ends (showDirectoryPicker aborts inside wry,
// and the Local REST API plugin has no Android build at all). Coerced HERE,
// at declaration, rather than in _applyAndroidSyncUI() below: the boot
// sequence branches on syncMode to decide whether to sync from the folder,
// and that runs before any UI adjustment would — leaving a stale 'none' to
// silently skip the boot sync for one whole launch.
if (isAndroidShell() && syncMode !== 'folder') {
  syncMode = 'folder';
  localStorage.setItem('divelog-sync-mode', 'folder');
}

function updateCount() {
  document.getElementById('total-count').textContent = dives.length;
  // Was `dives.length + ' dives in vault'` — restating the exact number set
  // one line above, in the same function. Same fix as the other two
  // dives.length-bearing setSidebarSync() calls (js/obsidian.js).
  if (syncMode === 'obsidian') setSidebarSync('Synced to vault');
  // Onboarding copy is only useful on empty state — hide once any dive exists
  const hasDives = dives.length > 0;
  document.querySelectorAll('#panel-log .page-sub').forEach(el => { el.style.display = hasDives ? 'none' : ''; });
  renderSyncStatus();
}

function show(name, btn) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  // btn is optional — when called from goPanel/popstate, derive from data-panel attribute
  const _btn = btn || document.querySelector('[data-panel="' + name + '"]');
  if (_btn) _btn.classList.add('active');
  if (name === 'history') renderHistory();
  if (name === 'stats') renderStats();
  if (name === 'species') renderSpeciesPanel();
  if (name === 'plan' && typeof renderPlanPanel === 'function') renderPlanPanel();
}


// Helpers
// HTML-escape for ALL user/imported/external strings interpolated into
// innerHTML templates (dive fields, species names, clip notes, filenames,
// API results). Covers text AND double/single-quoted attribute contexts.
// null/undefined → '' so `${esc(x) || 'fallback'}` patterns keep working.
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function g(id) { return document.getElementById(id).value; }
function stars(n) { return n ? '★'.repeat(parseInt(n)) + '☆'.repeat(5 - parseInt(n)) : '—'; }
function pad(n) { return String(n).padStart(3, '0'); }

// ── App theme (System / Light / Dark) ──────────────────────────────────────────
// A boot-time inline <script> in index.html's <head> already applied the class
// before first paint (reads the same localStorage key, no FOUC); everything
// here handles subsequent changes — user picks, OS-level flips in System mode,
// and re-syncing the Settings control's displayed state on panel re-open.
function _resolveDarkPref(pref) {
  return pref === 'dark' || (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
function applyTheme() {
  let pref = null;
  try { pref = localStorage.getItem('divelog-theme'); } catch (e) { /* private mode */ }
  const dark = _resolveDarkPref(pref);
  document.documentElement.classList.toggle('theme-harbour', dark);
  const mc = document.querySelector('meta[name="theme-color"]');
  if (mc) mc.setAttribute('content', dark ? '#111E1D' : '#F5EBD8');
  if (typeof _dfRerenderProfileIfOpen === 'function') _dfRerenderProfileIfOpen();
}
function setThemePreference(pref) { // 'system' | 'light' | 'dark'
  try { localStorage.setItem('divelog-theme', pref); } catch (e) { /* private mode */ }
  applyTheme();
  _syncThemeControl();
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  let pref = null;
  try { pref = localStorage.getItem('divelog-theme'); } catch (e) { /* private mode */ }
  if (!pref || pref === 'system') applyTheme();
});
// The boot IIFE (index.html <head>) only sets the class, to run before first
// paint — it doesn't touch <meta name="theme-color"> (that tag isn't parsed
// yet that early) or call _dfRerenderProfileIfOpen (nothing's rendered yet
// either). Run the full applyTheme() once here, now that both exist, so a
// normal page load ends with the meta tag actually matching the class the
// boot IIFE already applied — not just on the next explicit toggle.
applyTheme();
function _syncThemeControl() {
  let pref = 'system';
  try { pref = localStorage.getItem('divelog-theme') || 'system'; } catch (e) { /* private mode */ }
  document.querySelectorAll('.theme-seg-opt[data-theme-val]').forEach(opt => {
    const on = opt.getAttribute('data-theme-val') === pref;
    opt.classList.toggle('sel', on);
    opt.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

// ── Dive-type texture channel (colourblind-assist, opt-in) ─────────────────
// One table, shared by every render site that draws the --type-* ramp:
// js/stats.js's dive-type bars (wordless, primary toggle only), and
// js/history.js's timeline spine + dive-file hero pill, and js/logform.js's
// selected chip (all three "worded" swatches, secondary toggle only). See
// "CLAUDE colour UI.md" → "Dive-type texture channel" for the graph-
// colouring derivation — do not let a second copy of this table exist
// elsewhere; every consumer reads this one directly (functions only run
// after all scripts have loaded, so load order among the files above
// doesn't matter).
// Object.create(null): a plain {} inherits Object.prototype, so a dive typed
// (or imported from a hand-edited .md) as e.g. "constructor" or "toString"
// would make every `TYPE_TEXTURE[t]` lookup below return that inherited
// function instead of undefined — truthy, so the "is this a real ramp
// member" guards every consumer uses would pass, and the function's
// toString() would render into a data-tex attribute or a legend count. A
// null-prototype object has no inherited keys at all, so an unrecognised
// type is reliably undefined everywhere, with no per-call-site guard needed.
const TYPE_TEXTURE = Object.assign(Object.create(null), {
  Boat: 'solid', Shore: 'dots', Drift: 'arcs', Night: 'dots', Cave: 'horizontal',
  Wreck: 'diagR', Reef: 'solid', Wall: 'vertical', Pinnacle: 'diagL', Muck: 'horizontal'
});
function _texTypesOn() {
  try { return localStorage.getItem('divelog-tex-types') === '1'; } catch (e) { return false; }
}
function _texLabelsStored() {
  try { return localStorage.getItem('divelog-tex-labels') === '1'; } catch (e) { return false; }
}
// The secondary toggle is meaningless without the primary — AND-gated here
// so every render site can call one function rather than re-deriving the
// dependency each time.
function _texLabelsOn() { return _texTypesOn() && _texLabelsStored(); }
function applyTexPrefs() {
  document.documentElement.classList.toggle('tex-types', _texTypesOn());
}
function toggleTexTypes() {
  const on = !_texTypesOn();
  try { localStorage.setItem('divelog-tex-types', on ? '1' : '0'); } catch (e) { /* private mode */ }
  applyTexPrefs();
  _syncTexControls();
}
function toggleTexLabels() {
  if (!_texTypesOn()) return; // disabled control shouldn't fire, but don't trust that alone
  const on = !_texLabelsStored();
  try { localStorage.setItem('divelog-tex-labels', on ? '1' : '0'); } catch (e) { /* private mode */ }
  _syncTexControls();
}
applyTexPrefs();
function _syncTexControls() {
  const typesOn = _texTypesOn(), labelsOn = _texLabelsStored();
  const typesSw = document.getElementById('tex-types-toggle');
  const labelsSw = document.getElementById('tex-labels-toggle');
  const labelsRow = document.getElementById('tex-labels-row');
  if (typesSw) { typesSw.classList.toggle('on', typesOn); typesSw.setAttribute('aria-checked', typesOn ? 'true' : 'false'); }
  if (labelsSw) {
    labelsSw.classList.toggle('on', labelsOn);
    labelsSw.setAttribute('aria-checked', labelsOn ? 'true' : 'false');
    labelsSw.disabled = !typesOn;
  }
  if (labelsRow) labelsRow.classList.toggle('disabled', !typesOn);
}

// ── Collapsible form sections ─────────────────────────────────────────────────

function toggleSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const wasOpen = el.classList.contains('open');
  // Exclusive accordion — close all siblings in the same container first
  const container = el.closest('#panel-log') || el.parentElement;
  container.querySelectorAll('.cs.open').forEach(other => {
    other.classList.remove('open');
    other.querySelector('.cs-head').setAttribute('aria-expanded', 'false');
    _updateSectionSummary(other.id);
  });
  // Toggle this section (if it was closed, open it; if it was open, leave closed)
  if (!wasOpen) {
    el.classList.add('open');
    el.querySelector('.cs-head').setAttribute('aria-expanded', 'true');
    if (typeof lfOnSectionOpen === 'function') lfOnSectionOpen(id);
    // Mobile: bring the newly-opened card to the top of the viewport. Closing
    // sibling sections above (exclusive accordion) can shift the whole page,
    // so without this the card you just tapped can land anywhere on screen,
    // including partly above the fold — worst for a tall section like Gas &
    // equipment or Marine life opened from lower on the page.
    if (window.innerWidth <= 600) {
      const top = el.getBoundingClientRect().top + window.scrollY - 12;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }
}

function _updateSectionSummary(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const sumEl = el.querySelector('.cs-summary');
  if (!sumEl) return;
  const fv = fieldId => (document.getElementById(fieldId)?.value || '').trim();

  if (id === 'cs-dive') {
    const num  = fv('f-divenum');
    const date = fv('f-date');
    const site = fv('f-site');
    const reg  = fv('f-region');
    const parts = [num ? '#' + num : null, date ? _fmtDate(date) : null, site || null, reg || null].filter(Boolean);
    if (!date && !site) { sumEl.textContent = 'Expand'; sumEl.className = 'cs-summary'; }
    else if (num && date && site) { sumEl.textContent = '✓ ' + parts.join(' · '); sumEl.className = 'cs-summary complete'; }
    else { sumEl.textContent = parts.join(' · '); sumEl.className = 'cs-summary partial'; }
  }
  else if (id === 'cs-conditions') {
    const vis  = fv('f-vis');
    const temp = fv('f-temp');
    const curr = fv('f-current');
    const parts = [vis ? vis + ' m vis' : null, temp ? temp + '°C' : null, curr || null].filter(Boolean);
    if (!parts.length) { sumEl.textContent = 'Expand'; sumEl.className = 'cs-summary'; }
    else if (vis && temp) { sumEl.textContent = '✓ ' + parts.join(' · '); sumEl.className = 'cs-summary complete'; }
    else { sumEl.textContent = parts.join(' · '); sumEl.className = 'cs-summary partial'; }
  }
  else if (id === 'cs-profile') {
    const time  = fv('f-time');
    const depth = fv('f-depth');
    const avg   = fv('f-avgdepth');
    const parts = [depth ? depth + ' m max' : null, avg ? avg + ' m avg' : null, time ? time + ' min' : null].filter(Boolean);
    if (!parts.length) { sumEl.textContent = 'Expand'; sumEl.className = 'cs-summary'; }
    else if (time && depth) { sumEl.textContent = '✓ ' + parts.join(' · '); sumEl.className = 'cs-summary complete'; }
    else { sumEl.textContent = parts.join(' · '); sumEl.className = 'cs-summary partial'; }
  }
  else if (id === 'cs-equipment') {
    const ps  = fv('f-pstart');
    const pe  = fv('f-pend');
    const gas = fv('f-gas');
    const ts  = fv('f-tanksize');
    const parts = [(ps && pe) ? ps + '→' + pe + ' bar' : null, gas || null, ts ? ts + ' L' : null].filter(Boolean);
    if (!parts.length) { sumEl.textContent = 'Expand'; sumEl.className = 'cs-summary'; }
    else if (ps && pe && gas) { sumEl.textContent = '✓ ' + parts.join(' · '); sumEl.className = 'cs-summary complete'; }
    else { sumEl.textContent = parts.join(' · '); sumEl.className = 'cs-summary partial'; }
  }
  else if (id === 'cs-marine') {
    const n = sightings.length;
    sumEl.textContent = n === 0 ? '0 sightings' : '✓ ' + n + ' sighting' + (n !== 1 ? 's' : '');
    sumEl.className   = n === 0 ? 'cs-summary zero' : 'cs-summary complete';
  }
  else if (id === 'cs-notes') {
    const title = fv('f-title');
    const notes = fv('f-notes');
    if (!title && !notes) { sumEl.textContent = 'Expand'; sumEl.className = 'cs-summary'; }
    else if (title) {
      const display = title.length > 24 ? title.slice(0, 21) + '…' : title;
      sumEl.textContent = display; sumEl.className = 'cs-summary partial';
    } else {
      sumEl.textContent = '✓ Notes'; sumEl.className = 'cs-summary complete';
    }
  }
  else if (id === 'cs-signoff') {
    const buddy = fv('f-buddy');
    const lb    = fv('f-liveaboard');
    const parts = [buddy || null, lb || null].filter(Boolean);
    if (!parts.length) { sumEl.textContent = 'Expand'; sumEl.className = 'cs-summary'; }
    else { sumEl.textContent = parts.join(' · '); sumEl.className = 'cs-summary partial'; }
  }
}

// Format ISO date to "28 May 2026"
function _fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return parseInt(d) + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1] + ' ' + y;
}

// Auto-annotation helpers — hide when user manually overrides a derived field
function hideAutoAnnot(labelId) {
  const el = document.getElementById(labelId);
  if (el) el.style.display = 'none';
}
function showAutoAnnot(labelId) {
  const el = document.getElementById(labelId);
  if (el) el.style.display = '';
}

// ── Sighting clip helpers (shared across footage.js, history.js, album.js) ──
// Returns the clips array for a sighting, normalising old {video,time} format.
function _sightingClips(m) {
  if (Array.isArray(m.clips)) return m.clips;
  if (m.video) return [{ video: m.video, time: m.time || '', note: m.note || '' }];
  return [];
}
function _sightingHasClips(m) { return _sightingClips(m).length > 0; }

// Save dive
function saveDive() {
  const isEdit = editingId !== null; // edit mode (v2.83) — merge into the existing dive

  // In-flight state on mobile save bar button
  const saveBtn = document.querySelector('#mobile-save-bar button');
  if (saveBtn) { saveBtn.textContent = 'Saving…'; saveBtn.classList.add('saving'); }

  // Canonical field read — shared by both branches. The edit branch spreads
  // this over the existing dive, so anything not on the form (id, uid,
  // videos, _filename, future fields) survives untouched.
  const fields = {
    title: g('f-title'),
    divenum: g('f-divenum') || (isEdit ? '' : (dives.length + 1)),
    date: g('f-date'),
    site: g('f-site'),
    region: g('f-region'),
    location: g('f-location'),
    watertype: g('f-watertype'),
    vis: g('f-vis'),
    temp: g('f-temp'),
    current: g('f-current'),
    weather: g('f-weather'),
    depth: g('f-depth'),
    avgdepth: g('f-avgdepth'),
    time: g('f-time'),
    entrytime: g('f-entrytime'),
    exittime: g('f-exittime'),
    entry: g('f-entry'),
    liveaboard: g('f-liveaboard'),
    trip: g('f-trip'),
    pstart: g('f-pstart'),
    pend: g('f-pend'),
    gas: g('f-gas'),
    suit: g('f-suit'),
    weight: g('f-weight'),
    tanktype: g('f-tanktype'),
    tanksize: g('f-tanksize'),
    gps_lat:  parseFloat(document.getElementById('f-gps-lat').value) || null,
    gps_lng:  parseFloat(document.getElementById('f-gps-lng').value) || null,
    safety_stop_depth: parseFloat(document.getElementById('f-safety-stop-depth')?.value) || null,
    safety_stop_time:  parseFloat(document.getElementById('f-safety-stop-time')?.value)  || null,
    deco_stop_depth:   parseFloat(document.getElementById('f-deco-stop-depth')?.value)   || null,
    deco_stop_time:    parseFloat(document.getElementById('f-deco-stop-time')?.value)    || null,
    marine: sightings.map(s => ({ ...s })),
    buddy: g('f-buddy'),
    notes: g('f-notes'),
    signoff: g('f-signoff'),
    certnum: g('f-certnum'),
  };

  let dive;
  if (isEdit) {
    const idx = dives.findIndex(x => x.id === editingId);
    if (idx === -1) { _clearEditMode(); return; }
    dives[idx] = { ...dives[idx], uid: dives[idx].uid || mintUid(), ...fields };
    dive = dives[idx];
  } else {
    dive = { id: Date.now(), uid: mintUid(), videos: [], ...fields };
    dives.unshift(dive);
    lastSavedDiveId = dive.id; // new dives only — edits must not repoint it
  }
  dive._pendingSync = true; // differs from the vault until a successful push clears it
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  acSaveDiveFields(dive);
  buildSiteHistory();
  // Auto-sync to active backend
  if (syncMode === 'obsidian' && obsAvailable) pushToObsidian(dive).catch(() => {});
  else if (syncMode === 'folder') writeToFolder(dive).catch(() => {});
  updateCount();

  // The dive is safely in localStorage regardless of what happens next —
  // data safety comes first. This can only ever fire on Android, and only
  // when no folder is connected yet; skip the rest of the save UI (confirm
  // bar, success animation) since none of it matters once the screen's
  // about to be covered.
  if (_maybeShowAndroidFolderRequiredPrompt()) return;

  if (isEdit) {
    // Edit save: refresh the timeline, drop edit mode (which resets the
    // form), and return to the panel the ✎ came from. No confirm bar, no
    // carry-forward reset, no save-button animation — the panel navigates
    // away immediately, so those new-dive rituals would never be seen.
    renderHistory();
    _clearEditMode();
    if (saveBtn) { saveBtn.textContent = 'Save dive'; saveBtn.classList.remove('saving'); }
    try { history.back(); } catch (e) { show('history'); }
    return;
  }

  document.getElementById('md-filename').textContent = canonicalFilename(dive);
  const confirmBar = document.getElementById('md-output-area');
  confirmBar.style.display = 'flex';

  // After-save reset — carry forward date/trip/region, clear the rest
  _afterSaveReset(dive);

  // Success state on save bar button
  if (saveBtn) {
    saveBtn.textContent = '✓ Saved';
    saveBtn.classList.remove('saving');
    saveBtn.classList.add('saved');
    setTimeout(() => {
      saveBtn.textContent = 'Save dive';
      saveBtn.classList.remove('saved');
    }, 1500);
  }
}

// Full log-form reset — a true blank slate, everything cleared including the
// carry-forward fields and the sticky equipment values. _afterSaveReset
// re-applies its keeps on top; _clearEditMode (edit mode, v2.83) uses the
// blank slate directly — carrying an edited old dive's date/trip into the
// next new-dive form would be wrong.
function _resetLogFormFull() {
  // Clear field values
  ['f-title','f-site','f-depth','f-avgdepth','f-time','f-entrytime','f-exittime',
   'f-pstart','f-pend','f-vis','f-temp','f-weather',
   'f-suit','f-weight','f-notes','f-buddy','f-signoff','f-certnum',
   'f-gps-lat','f-gps-lng','f-liveaboard',
   'f-date','f-trip','f-region','f-divenum'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  // Direct .value = '' above fires no input event, so the three picker
  // triggers (js/logform.js) would keep showing whatever they last
  // displayed instead of resetting to their own empty-state text —
  // every caller of this shared reset (a plain cancel, or _afterSaveReset
  // below, which restores f-date right after calling this) needs this,
  // not just one of them.
  ['f-date', 'f-entrytime', 'f-exittime'].forEach(id => {
    if (typeof lfSyncPickerDisplay === 'function') lfSyncPickerDisplay(id);
  });
  // Reset selects / hidden inputs to their boot defaults
  const locEl  = document.getElementById('f-location');  if (locEl)  locEl.value  = '';
  const currEl = document.getElementById('f-current');   if (currEl) currEl.value = '';
  const gasEl  = document.getElementById('f-gas');       if (gasEl)  gasEl.value  = 'Air';
  const entryEl = document.getElementById('f-entry');    if (entryEl) entryEl.value = '';
  const wtEl = document.getElementById('f-watertype');   if (wtEl) wtEl.value = 'Salt';
  const ttEl = document.getElementById('f-tanktype');    if (ttEl) ttEl.value = 'Steel';
  const tsEl = document.getElementById('f-tanksize');    if (tsEl) tsEl.value = '12';
  // Reset stops to defaults
  const sdEl = document.getElementById('f-safety-stop-depth'); if (sdEl) sdEl.value = '5';
  const stEl = document.getElementById('f-safety-stop-time');  if (stEl) stEl.value = '3';
  const ddEl = document.getElementById('f-deco-stop-depth');   if (ddEl) ddEl.value = '';
  const dtEl = document.getElementById('f-deco-stop-time');    if (dtEl) dtEl.value = '';
  showAutoAnnot('divenum-auto-label');
  // Hide Dive Vibe annotation (field cleared)
  hideAutoAnnot('divetype-auto-label');
  // GPS status clear
  const gpsStatus = document.getElementById('f-gps-status');
  if (gpsStatus) gpsStatus.textContent = '';
  // Marine sightings
  sightings = [];
  renderSightings();
  closeMobileSpeciesPicker();
  // Collapse all sections and update their summaries, then open Dive
  ['cs-conditions','cs-profile','cs-equipment','cs-marine','cs-notes','cs-signoff'].forEach(id => {
    const sec = document.getElementById(id);
    if (!sec) return;
    sec.classList.remove('open');
    sec.querySelector('.cs-head')?.setAttribute('aria-expanded','false');
    _updateSectionSummary(id);
  });
  const diveSec = document.getElementById('cs-dive');
  if (diveSec) {
    diveSec.classList.add('open');
    diveSec.querySelector('.cs-head')?.setAttribute('aria-expanded','true');
  }
  _updateSectionSummary('cs-dive');
  // Repaint redesigned visual controls (type grid, segments, dials, weather, map pin)
  if (typeof lfSyncFromFields === 'function') lfSyncFromFields();
  // Scroll to top of panel
  const panel = document.getElementById('panel-log');
  if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
}

// Post-save form reset: carry forward date/trip/region, clear the rest, reopen Dive+Marine
function _afterSaveReset(savedDive) {
  // Preserve — including the sticky equipment values (same tank/water for
  // the next dive of the day), which the full reset would otherwise blank
  const keepDate    = document.getElementById('f-date')?.value      || '';
  const keepTrip    = document.getElementById('f-trip')?.value      || '';
  const keepRegion  = document.getElementById('f-region')?.value    || '';
  const keepCountry = document.getElementById('f-location')?.value  || '';
  const keepWater   = document.getElementById('f-watertype')?.value  || 'Salt';
  const keepTankT   = document.getElementById('f-tanktype')?.value   || 'Steel';
  const keepTankS   = document.getElementById('f-tanksize')?.value   || '12';
  const keepOp      = document.getElementById('f-liveaboard')?.value || '';

  _resetLogFormFull();

  // Restore carry-forward values
  const dateEl = document.getElementById('f-date');      if (dateEl) dateEl.value = keepDate;
  // Same reason as calcExitTime()'s own call: direct .value assignment
  // fires no input event, and this whole function runs mid-session (right
  // after a save, staying on the Log panel) rather than through a fresh
  // show('log') that would otherwise re-sync it.
  if (typeof lfSyncPickerDisplay === 'function') lfSyncPickerDisplay('f-date');
  const tripEl = document.getElementById('f-trip');      if (tripEl) tripEl.value = keepTrip;
  const regEl  = document.getElementById('f-region');    if (regEl)  regEl.value  = keepRegion;
  const locEl  = document.getElementById('f-location');  if (locEl)  locEl.value  = keepCountry;
  const wtEl   = document.getElementById('f-watertype');  if (wtEl) wtEl.value = keepWater;
  const ttEl   = document.getElementById('f-tanktype');   if (ttEl) ttEl.value = keepTankT;
  const tsEl   = document.getElementById('f-tanksize');   if (tsEl) tsEl.value = keepTankS;
  const opEl   = document.getElementById('f-liveaboard'); if (opEl) opEl.value = keepOp;
  // Auto-increment dive #, restore "auto" annotation
  const nextNum = (parseInt(savedDive.divenum) || 0) + 1;
  const numEl   = document.getElementById('f-divenum');
  if (numEl) numEl.value = nextNum;
  showAutoAnnot('divenum-auto-label');
  // Re-sync the summary chips + visual controls with the restored values
  _updateSectionSummary('cs-dive');
  _updateSectionSummary('cs-equipment');
  if (typeof lfSyncFromFields === 'function') lfSyncFromFields();
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 30);
}

// Canonical filename for a dive — the single source of truth "coordinated
// canonical renaming" (BRIEF-sidecar-filename-hygiene.md) compares against.
// Collision-safe: if another dive already holds this exact name, disambiguate
// with a uid suffix rather than let the two clobber each other on write.
function canonicalFilename(dive) {
  let name = `dive-${pad(dive.divenum)}-${slugify(dive.site || 'unknown')}.md`;
  const clash = dives.some(d => d.uid !== dive.uid && d._filename === name);
  if (clash) name = name.replace(/\.md$/, '') + '-' + dive.uid + '.md';
  return name;
}

// Delete a file by explicit bare filename from the active backend's dive
// folder. Shared by whole-dive deletion and by coordinated-rename cleanup
// (removing a stale filename after a dive is written under a new canonical
// name). Silent-fails if the file doesn't exist — expected and safe either way.
async function _deleteBackendFile(filename) {
  if (!filename) return;
  if (syncMode === 'obsidian' && obsAvailable) {
    const folder = (obsSettings.folder || 'Dives').replace(/\/$/, '');
    const path = `${folder}/${filename}`;
    try {
      await fetch(`${OBS_BASE}/vault/${encodeURIComponent(path)}`, { method: 'DELETE', headers: obsJsonHeaders() });
    } catch (e) { /* file may not exist / Obsidian offline */ }
  } else if (syncMode === 'folder') {
    if (isAndroidShell()) {
      const folder = _androidFolder();
      if (folder) {
        try { await window.__TAURI__.core.invoke('android_delete_file', { folder, filename }); }
        catch (e) { /* file may already be gone */ }
      }
    } else if (isDesktopShell()) {
      const folder = localStorage.getItem('divelog-shell-vault-path');
      if (folder) {
        try { await window.__TAURI__.core.invoke('remove_file', { path: folder + '/' + filename }); }
        catch (e) { /* file may already be gone */ }
      }
    } else {
      try {
        const handle = await getWritableFolderHandle();
        if (handle) await handle.removeEntry(filename);
      } catch (e) { /* file may already be gone */ }
    }
  }
}

// Coordinated-rename cleanup (BRIEF-sidecar-filename-hygiene.md) — called
// right after a dive's .md has been written under a NEW canonical name while
// an OLD name was still on record (i.e. divenum/site changed since the last
// save, or a previously-drifted file is healing). Moves every sidecar kind
// that exists for this dive — footage and profile — to the new name (real
// writes from in-memory state, not copies), then removes the stale .md +
// sidecars under the old name. Best-effort and ordered write-new-then-
// delete-old throughout: any failure here leaves the old files behind as
// harmless duplicates (deduped by uid on next load) rather than orphaning
// anything. This is how the profile sidecar (BRIEF-dive-profile-import.md)
// inherits rename safety for free — it's just another entry in this set.
async function _cleanupOldDiveFiles(dive, oldFilename) {
  const hadSidecar = !!(dive.uid && _sidecars.has(dive.uid));
  const hadProfile = !!(dive.uid && _profiles.has(dive.uid));
  if (hadSidecar) await writeSidecar(dive); // dive._filename is already the NEW name here
  if (hadProfile) await writeProfileSidecar(dive, _profiles.get(dive.uid));
  await _deleteBackendFile(oldFilename);
  if (hadSidecar) await _deleteBackendFile(oldFilename.replace(/\.md$/i, '.footage.json'));
  if (hadProfile) await _deleteBackendFile(oldFilename.replace(/\.md$/i, '.profile.json'));
}

function generateMD(d) {
  const gasUsed = d.pstart && d.pend ? (parseInt(d.pstart) - parseInt(d.pend)) + ' bar' : '—';
  // If a title is set it becomes the Obsidian note heading; dive number+site becomes bold meta.
  const headline = d.title
    ? [`# ${d.title}`, ``, `**Dive ${d.divenum} — ${d.site || 'Unknown site'}**  `]
    : [`# Dive ${d.divenum} — ${d.site || 'Unknown site'}`];
  const lines = [
    ...headline,
    ``,
    `**Date:** ${d.date || '—'}  `,
    `**Location:** ${[d.location, d.region].filter(Boolean).join(' · ') || '—'}  `,
    `**Dive number:** ${d.divenum}  `,
    ``,
    `---`,
    ``,
    `## Conditions`,
    ``,
    `| | |`,
    `|---|---|`,
    `| Water type | ${d.watertype} |`,
    `| Visibility | ${d.vis ? d.vis + ' m' : '—'} |`,
    `| Water temperature | ${d.temp ? d.temp + ' °C' : '—'} |`,
    `| Current | ${d.current || 'None'} |`,
    `| Weather / surface | ${d.weather || '—'} |`,
    ``,
    `## Dive profile`,
    ``,
    `| | |`,
    `|---|---|`,
    `| Maximum depth | ${d.depth ? d.depth + ' m' : '—'} |`,
    `| Average depth | ${d.avgdepth ? d.avgdepth + ' m' : '—'} |`,
    `| Bottom time | ${d.time ? d.time + ' min' : '—'} |`,
    `| Entry time | ${d.entrytime || '—'} |`,
    `| Exit time | ${d.exittime || '—'} |`,
    `| Dive type | ${d.entry || '—'} |`,
    `| Liveaboard | ${d.liveaboard || '—'} |`,
    ``,
    `## Gas &amp; equipment`,
    ``,
    `| | |`,
    `|---|---|`,
    `| Gas mix | ${d.gas} |`,
    `| Start pressure | ${d.pstart ? d.pstart + ' bar' : '—'} |`,
    `| End pressure | ${d.pend ? d.pend + ' bar' : '—'} |`,
    `| Gas used | ${gasUsed} |`,
    `| Suit | ${d.suit || '—'} |`,
    `| Weight | ${d.weight ? d.weight + ' kg' : '—'} |`,
    `| Tank | ${[d.tanktype, d.tanksize ? d.tanksize + ' L' : ''].filter(Boolean).join(' · ') || '—'} |`,
    ``,
  ];

  if (d.marine && d.marine.length) {
    lines.push(`## Marine life`);
    lines.push(``);
    lines.push(`| Species | Common name | Abundance | AphiaID | Validated |`);
    lines.push(`|---|---|---|---|---|`);
    d.marine.forEach(m => {
      if (typeof m === 'string') {
        lines.push(`| *${m}* | — | — | — | — |`);
      } else {
        lines.push(`| *${m.scientificName || '—'}* | ${m.commonName || '—'} | ${m.abundance || '—'} | ${m.aphiaId || '—'} | ${m.validated ? '✓' : 'Unvalidated'} |`);
      }
    });
    lines.push(``);
  }

  // Footage section — all clips across all sightings, sorted by video then timestamp.
  // Human-readable only; YAML frontmatter is the source of truth the app reads back.
  const _footageRows = [];
  (d.marine || []).forEach(m => {
    const name = m.commonName || m.scientificName || '—';
    _sightingClips(m).forEach(c => {
      _footageRows.push({ name, video: c.video || '—', time: c.time || '', note: c.note || '' });
    });
  });
  if (_footageRows.length) {
    _footageRows.sort((a, b) => a.video.localeCompare(b.video) || a.time.localeCompare(b.time));
    lines.push(`## Footage`);
    lines.push(``);
    lines.push(`| Species | Video | Timestamp | Note |`);
    lines.push(`|---|---|---|---|`);
    _footageRows.forEach(r => {
      lines.push(`| ${r.name} | ${r.video} | ${r.time || '—'} | ${r.note} |`);
    });
    lines.push(``);
  }

  lines.push(`## Notes`);
  lines.push(``);
  lines.push(d.notes || '*No notes recorded.*');
  lines.push(``);
  lines.push(`## Sign-off`);
  lines.push(``);
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Buddy | ${d.buddy || '—'} |`);
  lines.push(`| Liveaboard | ${d.liveaboard || '—'} |`);
  lines.push(`| Instructor / divemaster | ${d.signoff || '—'} |`);
  lines.push(`| Cert number | ${d.certnum || '—'} |`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Logged ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}*`);
  return lines.join('\n');
}


// ── Exit time auto-calc ────────────────────────────────────────────────────
function calcExitTime() {
  const entry = document.getElementById('f-entrytime').value;
  const mins  = parseInt(document.getElementById('f-time').value);
  if (!entry || !mins || isNaN(mins)) return;
  const [h, m] = entry.split(':').map(Number);
  const total  = h * 60 + m + mins;
  const eh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const em = String(total % 60).padStart(2, '0');
  document.getElementById('f-exittime').value = `${eh}:${em}`;
  // Direct .value assignment doesn't fire an input event, so f-exittime's
  // own oninput (which would normally call this) never runs for a value
  // IT set programmatically — the picker trigger (js/logform.js) would go
  // stale until the next full panel sync otherwise. Found live: typing a
  // bottom time correctly recalculated the real exit-time value but left
  // its trigger pill showing the old "—" placeholder.
  if (typeof lfSyncPickerDisplay === 'function') lfSyncPickerDisplay('f-exittime');
}

// ── Edit / delete ──────────────────────────────────────────────────────────
// ── Edit mode (v2.83) — editing happens ON the log form ─────────────────────
// openEdit() prefills the canonical f- inputs from the dive and flips the Log
// panel into edit mode; saveDive()'s edit branch merges the form back over
// the existing dive. This replaced the edit modal (a hand-maintained second
// copy of the form) — see briefs-archive/v2.83-BRIEF-edit-in-place.md.
let editingId = null; // dive id being edited; null ⇒ normal logging

// ✎ always jumps straight into edit mode, silently discarding any
// unsaved draft on the Log form — deliberately no confirm prompt. This
// matches how the rest of the app already treats an in-progress draft
// (switching to Stats/Species/History discards it just as silently); an
// exclusive dirty-guard for this one entry point was tried and dropped
// (v2.83) after a hand-maintained field-list check twice missed real
// content fields (Operator, then Current/Gas/deco stop) and let drafts
// through with no warning anyway. If a save was premature, editing it
// straight back open costs one tap.
function openEdit(id) {
  const d = dives.find(x => x.id === id);
  if (!d) return;
  // A pending dive-computer profile belonged to the draft being discarded —
  // it must not survive to attach to some unrelated later save (profile.js).
  if (typeof _pendingNewDiveProfile !== 'undefined') _pendingNewDiveProfile = null;

  editingId = id;
  // The unified show() patch closes any open overlay (the dive file the ✎
  // usually lives in) and pushes the history entry — back gesture = cancel.
  show('log');
  _prefillLogFormFromDive(d);

  // Edit-mode dressing. The .editing class drives CSS that hides the
  // new-dive affordances: UDDF banner/review (which could overwrite the
  // edit), the md-filename confirm bar, and the intro subtitles.
  const panel = document.getElementById('panel-log');
  if (panel) panel.classList.add('editing');
  const t  = document.getElementById('log-title');
  if (t) t.textContent = 'Edit a dive';
  const bl = document.getElementById('edit-banner-label');
  if (bl) bl.textContent = `dive ${d.divenum || '?'} — ${d.site || 'Unknown site'}`;
  const bn = document.getElementById('edit-banner');
  if (bn) bn.style.display = 'flex';
  const sb = document.getElementById('lf-save-btn');
  if (sb) sb.textContent = 'Save changes →';
  const mb = document.getElementById('mobile-save-btn');
  if (mb) mb.textContent = 'Save changes';
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function _prefillLogFormFromDive(d) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('f-title',     d.title      || '');
  set('f-divenum',   d.divenum    ?? '');
  set('f-date',      d.date       || '');
  set('f-trip',      d.trip       || '');
  set('f-region',    d.region     || '');
  set('f-site',      d.site       || '');
  set('f-watertype', d.watertype  || 'Salt');
  set('f-vis',       d.vis        || '');
  set('f-temp',      d.temp       || '');
  set('f-current',   d.current    || '');
  set('f-weather',   d.weather    || '');
  set('f-depth',     d.depth      || '');
  set('f-avgdepth',  d.avgdepth   || '');
  set('f-time',      d.time       || '');
  set('f-entrytime', d.entrytime  || '');
  set('f-exittime',  d.exittime   || '');
  set('f-entry',     d.entry      || '');
  set('f-liveaboard', d.liveaboard || '');
  set('f-pstart',    d.pstart     || '');
  set('f-pend',      d.pend       || '');
  set('f-suit',      d.suit       || '');
  set('f-weight',    d.weight     || '');
  // Steel, matching the new-dive default below/above — this is the fallback
  // for an OLD dive that recorded no tanktype at all, so it necessarily
  // invents a value either way; keeping it equal to the form's own default
  // avoids the app having two different "defaults" depending on the path in.
  set('f-tanktype',  d.tanktype   || 'Steel');
  set('f-tanksize',  d.tanksize   || 12);
  set('f-buddy',     d.buddy      || '');
  set('f-notes',     d.notes      || '');
  set('f-signoff',   d.signoff    || '');
  set('f-certnum',   d.certnum    || '');
  set('f-gps-lat',   d.gps_lat    ?? '');
  set('f-gps-lng',   d.gps_lng    ?? '');
  set('f-safety-stop-depth', d.safety_stop_depth ?? 5);
  set('f-safety-stop-time',  d.safety_stop_time  ?? 3);
  set('f-deco-stop-depth',   d.deco_stop_depth   || '');
  set('f-deco-stop-time',    d.deco_stop_time    || '');
  // Selects hold fixed option lists — an off-list value leaves the select
  // unmatched, so fall back the way the old modal's option rendering did
  const gasEl = document.getElementById('f-gas');
  if (gasEl) { gasEl.value = d.gas || 'Air'; if (gasEl.value !== (d.gas || 'Air')) gasEl.value = 'Air'; }
  const locEl = document.getElementById('f-location');
  if (locEl) { locEl.value = d.location || ''; if (locEl.value !== (d.location || '')) locEl.value = ''; }
  // Dive # is the dive's real number, not an auto-suggestion
  hideAutoAnnot('divenum-auto-label');
  hideAutoAnnot('divetype-auto-label');
  // Sightings — edit works on a COPY; Cancel must leave the dive untouched
  sightings = (d.marine || []).map(m => ({ ...m }));
  renderSightings();
  // Repaint visual controls from the canonical inputs + centre the pin map
  if (typeof lfSyncFromFields === 'function') lfSyncFromFields();
  if (d.gps_lat != null && d.gps_lng != null && typeof lfSetPin === 'function') {
    lfSetPin('f', parseFloat(d.gps_lat), parseFloat(d.gps_lng), false);
  }
  // Collapse everything, open Marine life — the modal's deliberate default:
  // the most common edit target stays one tap away. Refresh every chip.
  ['cs-dive','cs-conditions','cs-profile','cs-equipment','cs-marine','cs-notes','cs-signoff'].forEach(id => {
    const sec = document.getElementById(id);
    if (!sec) return;
    const open = id === 'cs-marine';
    sec.classList.toggle('open', open);
    sec.querySelector('.cs-head')?.setAttribute('aria-expanded', open ? 'true' : 'false');
    _updateSectionSummary(id);
  });
  if (typeof lfOnSectionOpen === 'function') lfOnSectionOpen('cs-marine'); // desktop rail → species grid
  // Pre-warm the bbox cache for the existing country/region so Overpass
  // secondary search is ready if the user edits the site name field
  prefetchSearchBbox('f');
}

// Disarm edit mode: restore the Log panel's new-dive dressing and reset the
// form to a blank slate. Never navigates — callers decide where to go next.
// Also called from the unified show() patch whenever a panel switch leaves
// 'log', so no path can leave edit mode armed on a hidden panel.
function _clearEditMode() {
  if (editingId === null) return;
  editingId = null;
  const panel = document.getElementById('panel-log');
  if (panel) panel.classList.remove('editing');
  const t  = document.getElementById('log-title');
  if (t) t.textContent = 'Log a dive';
  const bn = document.getElementById('edit-banner');
  if (bn) bn.style.display = 'none';
  const sb = document.getElementById('lf-save-btn');
  if (sb) sb.textContent = 'Save dive →';
  const mb = document.getElementById('mobile-save-btn');
  if (mb) mb.textContent = 'Save dive';
  _resetLogFormFull();
}

function cancelEdit() {
  _clearEditMode();
  // openEdit's show('log') pushed a history entry, so back lands on the
  // panel the ✎ came from (History), scroll restored via _panelScrollY
  try { history.back(); } catch (e) { show('history'); }
}

// Two-click "arm and confirm" delete guardrail, shared by EVERY delete entry
// point (dive-file "more" menu, timeline row trash icon) — the button itself
// becomes the confirmation instead of a popup. (Until v2.99 this comment read
// "every delete entry point that isn't the edit modal's native confirm()";
// that modal retired in v2.83 and its leftover confirm() in deleteDive was
// removed in v2.99, so there is no longer an exception.)
// First click arms it and returns without
// running `action`; a second click while armed runs `action` and disarms.
// Reverts on its own after a few seconds if never confirmed, so an armed
// state left sitting in an open menu can't catch a later, unrelated click.
// armedLabel is optional — icon-only buttons (🗑) have no room for text and
// rely on the .is-armed CSS class alone to look more urgent.
function armDelete(btn, action, armedLabel) {
  if (btn.dataset.armed) {
    clearTimeout(+btn.dataset.armTimer);
    delete btn.dataset.armed;
    btn.classList.remove('is-armed');
    btn.setAttribute('aria-pressed', 'false');
    if (btn.dataset.origLabel != null) { btn.textContent = btn.dataset.origLabel; delete btn.dataset.origLabel; }
    action();
    return;
  }
  btn.dataset.armed = '1';
  btn.classList.add('is-armed');
  btn.setAttribute('aria-pressed', 'true');
  if (armedLabel) { btn.dataset.origLabel = btn.textContent; btn.textContent = armedLabel; }
  btn.dataset.armTimer = setTimeout(() => {
    delete btn.dataset.armed;
    btn.classList.remove('is-armed');
    btn.setAttribute('aria-pressed', 'false');
    if (btn.dataset.origLabel != null) { btn.textContent = btn.dataset.origLabel; delete btn.dataset.origLabel; }
  }, 3000);
}

// ── Toast (v2.99) ────────────────────────────────────────────────────────────
// Replaces alert() for the app's 10 informational/error messages. alert() is
// blocking and, in a WebView, renders as an OS dialog that looks nothing like
// the app — every one of those 10 call sites was immediately followed by
// `return`, so nothing depended on the blocking behaviour.
//
// Variants reuse .sync-banner's existing vocabulary (neutral/success/error/
// warning) rather than introducing new colours — see CLAUDE colour UI.md.
//
// role/aria-live differ by variant deliberately: an error interrupts
// ('alert'/assertive), everything else waits for a pause ('status'/polite).
function showToast(message, opts) {
  opts = opts || {};
  const variant  = opts.variant || 'neutral';
  const isError  = variant === 'error';
  // Errors carry longer text and matter more, so they linger.
  const duration = opts.duration != null ? opts.duration : (isError ? 7000 : 4000);

  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    document.body.appendChild(stack);
  }

  const t = document.createElement('div');
  t.className = 'toast toast-' + variant;
  t.setAttribute('role', isError ? 'alert' : 'status');
  t.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  t.textContent = message;               // textContent, never innerHTML — messages
                                         // interpolate error objects and filenames.
  const dismiss = () => {
    if (t._gone) return; t._gone = true;
    clearTimeout(t._timer);
    t.classList.add('toast-out');
    // Matches the CSS exit duration; removal is also unconditional on a later
    // tick so a cancelled transition can't leave the node stranded.
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 220);
  };
  // opts.onClick (v2.994): optional, runs before dismiss on tap — e.g. the
  // desktop update toast opening its download page. Every existing call site
  // passes no onClick, so this is purely additive; a toast with none behaves
  // exactly as before.
  t.addEventListener('click', () => { if (opts.onClick) opts.onClick(); dismiss(); });
  t._timer = setTimeout(dismiss, duration);

  stack.appendChild(t);
  // Cap the stack — a loop of failures shouldn't paper over the screen.
  while (stack.children.length > 3) stack.removeChild(stack.firstChild);
  return t;
}

// ── Legal text loaders (v2.994) ──────────────────────────────────────────────
// LICENSE.md (AGPL-3.0, ~660 lines) and THIRD-PARTY-NOTICES.txt (~3,700) are
// fetched on first expand rather than at load — nobody reads either on a
// normal launch, and together they're ~190KB. textContent, never innerHTML:
// both are files this app didn't author (one is the FSF's text verbatim, the
// other is generated from crate metadata) and neither should reach the DOM
// as markup.
async function loadLegalText(url, elId) {
  const el = document.getElementById(elId);
  if (!el || el.dataset.loaded === '1') return;
  el.dataset.loaded = '1';               // set before the await — a fast
                                         // double-toggle must not fetch twice
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    el.textContent = await res.text();
  } catch (e) {
    delete el.dataset.loaded;            // let a retry work once back online
    el.textContent = 'Could not load this offline. It also ships as '
      + url + ' alongside the app.';
  }
}
const loadNotices = () => loadLegalText('THIRD-PARTY-NOTICES.txt', 'notices-text');
const loadLicence = () => loadLegalText('LICENSE.md', 'licence-text');

// ── Desktop update check (v2.994) ────────────────────────────────────────────
// The Mac shell has no auto-updater (release.sh is a manual, unsigned DMG
// build — see README.md → "Dev / build"). This is the lightweight substitute:
// compare the running app's own version against landing/downloads/latest.json
// (published by release.sh on every real release) and toast a link if it's
// behind. Never blocks, never auto-installs. This isn't just a "see new
// features" nicety — CHANGELOG.md has shipped real fixes (stored-XSS, native
// filesystem-command scoping) that a Mac install which is never re-downloaded
// would simply never receive.
//
// Desktop-only by design (isDesktopShell(), not isShell()): the web/PWA build
// already self-updates via the service worker, and Android has no equivalent
// unsigned-build problem to begin with.
async function checkForAppUpdate() {
  if (!isDesktopShell()) return;
  try {
    const current = await window.__TAURI__.core.invoke('get_app_version');
    const res = await fetch('https://diveshoal.com/downloads/latest.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { version: latest, url } = await res.json();
    if (!latest || !url || !_isNewerVersion(latest, current)) return;
    showToast(`Shoal ${latest} is available — you're on ${current}. Tap to download.`, {
      variant: 'neutral',
      duration: 10000,
      onClick: () => window.__TAURI__.core.invoke('open_url', { url }).catch(() => {})
    });
  } catch (e) {
    // Offline, DNS blip, malformed JSON — a background nicety failing
    // silently is correct here; there's nothing actionable to tell the diver.
  }
}

// Component-wise numeric compare, not lexicographic — a plain string compare
// would put "2.6.0" ahead of "2.10.0". Missing/non-numeric parts read as 0.
function _isNewerVersion(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da !== db) return da > db;
  }
  return false;
}

// ── In-app confirm (v2.99) ───────────────────────────────────────────────────
// Async replacement for confirm(). Returns a Promise<boolean>. Wired into the
// standard overlay view-stack (_pushOverlayState/_closeOverlayDirect) so the
// Android back gesture and Escape close it exactly like every other
// full-screen surface — both resolving false, which is the safe answer.
//
// Note this is NOT the app's primary delete guardrail: armDelete (above) is,
// and it covers every dive-delete entry point. This exists for the cases
// armDelete structurally can't reach — a confirmation that depends on state
// only known *after* the click (see deleteFootageVideo, which only asks when
// a sighting actually references the video).
let _confirmResolve = null;
function confirmAction(message, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    // Only one at a time; a second call answers false rather than stacking.
    if (_confirmResolve) { resolve(false); return; }

    const prevFocus = document.activeElement;
    let settled = false;
    const settle = v => {
      if (settled) return; settled = true;
      _confirmResolve = null;
      resolve(v);
    };
    _confirmResolve = settle;

    const wrap = document.createElement('div');
    wrap.id = 'confirm-overlay';
    wrap.className = 'confirm-overlay';
    wrap.innerHTML =
      '<div class="confirm-box" role="dialog" aria-modal="true" aria-labelledby="confirm-msg">'
      + '<p class="confirm-msg" id="confirm-msg"></p>'
      + '<div class="confirm-acts">'
      + '<button type="button" class="confirm-cancel"></button>'
      + '<button type="button" class="confirm-ok"></button>'
      + '</div></div>';
    const msgEl = wrap.querySelector('.confirm-msg');
    const okBtn = wrap.querySelector('.confirm-ok');
    const noBtn = wrap.querySelector('.confirm-cancel');
    msgEl.textContent = message;                       // never innerHTML
    okBtn.textContent = opts.confirmLabel || 'Confirm';
    noBtn.textContent = opts.cancelLabel  || 'Cancel';
    if (opts.danger) okBtn.classList.add('danger');

    // Confirming resolves true FIRST, then closes — closeTopOverlay() runs the
    // popstate teardown, which would otherwise settle false before we got here.
    okBtn.addEventListener('click', () => { settle(true);  closeTopOverlay(); });
    noBtn.addEventListener('click', () => { closeTopOverlay(); });
    wrap.addEventListener('click', e => { if (e.target === wrap) closeTopOverlay(); });

    // Minimal focus trap — only two focusable elements, so Tab just cycles.
    wrap.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      (document.activeElement === okBtn ? noBtn : okBtn).focus();
    });

    wrap._prevFocus = prevFocus;
    document.body.appendChild(wrap);
    _lockScroll();
    _pushOverlayState({ type: 'confirm' });
    // Cancel takes focus, not Confirm — this is used for destructive actions,
    // where a stray Enter should do nothing.
    noBtn.focus();
  });
}

// DOM teardown for the confirm overlay. Called ONLY from the popstate handler
// via _closeOverlayDirect, matching every other overlay type.
function closeConfirmDirect() {
  const wrap = document.getElementById('confirm-overlay');
  if (wrap) {
    if (wrap._prevFocus && wrap._prevFocus.focus) { try { wrap._prevFocus.focus(); } catch (e) {} }
    wrap.remove();
  }
  _unlockScroll();
  // Any close that isn't the explicit Confirm click resolves false (back
  // gesture, Escape, Cancel, backdrop tap). Confirm already settled true.
  if (_confirmResolve) _confirmResolve(false);
}

async function deleteDive(id) {
  const d = dives.find(x => x.id === id);
  // No confirm() here. Every entry point to deleteDive goes through
  // armDelete (dive-file "more" menu ×2, timeline row 🗑 — verified
  // 2026-07-29), so the native popup was a SECOND confirmation stacked on
  // top of the two-click arm: arm, confirm, then get asked again. It was a
  // leftover from the edit modal's own delete path, which retired in v2.83 —
  // the comment above armDelete still referenced it. If a new entry point is
  // ever added, route it through armDelete rather than reinstating a dialog.
  // Delete sidecars first (footage + profile data), then the dive MD
  if (d) { await deleteSidecar(d); await deleteProfileSidecar(d); }
  if (d?._filename) await _deleteBackendFile(d._filename);
  dives = dives.filter(x => x.id !== id);
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  renderHistory();
  updateCount();
}


// ── History map/list toggle ───────────────────────────────────────────────────
// Switches #panel-history between list view (sort toolbar + history list) and
// map view (map toolbar + Leaflet map). Tears down the Leaflet instance on
// return to list so panel re-opens clean.
function setHistoryView(view) {
  const sortToolbar = document.getElementById('sort-toolbar');
  const actionsRow  = document.getElementById('hist-actions-row');
  const mapToolbar  = document.getElementById('map-toolbar');
  const histSub     = document.getElementById('history-sub');
  const paginTop    = document.getElementById('history-pagination-top');
  const histList    = document.getElementById('history-list');
  const paginBot    = document.getElementById('history-pagination-bottom');
  const mapEl       = document.getElementById('map-leaflet');
  if (!mapEl) return;

  const toMap = (view === 'map');
  if (sortToolbar) sortToolbar.style.display = toMap ? 'none' : '';
  if (actionsRow)  actionsRow.style.display  = toMap ? 'none' : '';
  if (mapToolbar)  mapToolbar.style.display  = toMap ? ''     : 'none';
  if (histSub)     histSub.style.display     = toMap ? 'none' : '';
  if (paginTop)    paginTop.style.display    = toMap ? 'none' : '';  // pagination mgr handles '' vs block
  if (histList)    histList.style.display    = toMap ? 'none' : '';
  if (paginBot)    paginBot.style.display    = toMap ? 'none' : '';
  mapEl.style.display = toMap ? '' : 'none';

  if (toMap) {
    setTimeout(() => initMap(), 0);
  } else {
    destroyMap(); // release Leaflet instance (defined in map.js)
  }
}

// ── Unified show() patch — handles panel switching, Obsidian panel init,
// mobile nav sync, hash routing, and Obsidian data sync in one place ─────────
let _showFromPopstate = false; // prevents pushState re-entry when popstate drives show()
let _navTapToTop      = false; // set by navTo(): this switch came from a nav tap
const _panelScrollY   = {};   // saved window.scrollY per panel name

const _origShow = show;
show = function(name, btn) {
  // Lateral navigation (e.g. a bottom-nav tap) while an overlay — most
  // commonly the dive file — is open. show() previously had no idea an
  // overlay existed: it swapped the active .panel and pushed new history
  // state, but never hid the overlay's own DOM or removed its listeners,
  // leaving it stale for whenever the user navigated back. Mirrors
  // goBackToHistory()'s existing pattern of popping _openOverlays directly
  // rather than going through history.back(). A popstate-driven call
  // arrives with _openOverlays already emptied by the handler itself, so
  // this is a no-op in that case.
  while (_openOverlays.length) _closeOverlayDirect(_openOverlays.pop());

  // Leaving the Log panel always disarms edit mode (v2.83) — no path may
  // leave edit armed on a hidden panel, or "log a new dive" could later
  // silently overwrite the dive that was being edited.
  if (name !== 'log' && editingId !== null) _clearEditMode();

  // Save scroll position for the panel we're leaving
  const _leavingEl = document.querySelector('.panel.active');
  const _leaving   = _leavingEl ? _leavingEl.id.replace('panel-', '') : null;
  if (_leaving && _leaving !== name) _panelScrollY[_leaving] = window.scrollY;

  _origShow(name, btn);

  // Restore scroll for the panel we're entering (0 on first visit) — EXCEPT
  // when an explicit nav tap drove this (navTo), which always lands at the
  // top. Found in user testing: restoring a mid-page scroll position meant
  // the panel's own title never came back into view, so people got no "I've
  // arrived somewhere new" cue and several concluded the app was a single
  // page. Deliberately scoped to nav taps only — a back-gesture/popstate
  // return still restores, which is what makes the dive-file round trip work
  // (open a dive from deep in History, go back, land where you were).
  // The stored value is zeroed too, so a later restore agrees with where the
  // user actually is rather than resurrecting a stale pre-tap position.
  if (_navTapToTop) _panelScrollY[name] = 0;
  window.scrollTo({ top: _navTapToTop ? 0 : (_panelScrollY[name] || 0), behavior: 'instant' });

  // Hash routing (v2.66) — keep URL in sync with the active panel.
  // Skip when popstate drove this call (state already correct; pushing would
  // add a duplicate entry). goPanel() also calls show(), letting it push here.
  if (!_showFromPopstate && typeof PANEL_HASHES !== 'undefined' && PANEL_HASHES.includes(name)) {
    try {
      const _panelHash = name === 'obsidian' ? 'settings' : name;
      history.pushState({ panel: name, overlay: null }, '', '#' + _panelHash);
    } catch (e) { /* restricted context — hash routing unavailable */ }
  }

  // Mobile nav
  updateMobileNav(name);

  // Desktop sidebar — the "current" indicator swims to the active nav-link
  _updateNavIndicator(name);

  // Mobile save bar — only visible on log panel
  const saveBar = document.getElementById('mobile-save-bar');
  if (saveBar) saveBar.classList.toggle('active', name === 'log');

  // Dive # live preview (Open UX/polish items, CLAUDE.md) — the field showed
  // only the word "auto" and stayed blank until save, when it silently
  // became dives.length + 1 (saveDive(), below) — a formula that can drift
  // after deletions or bulk-imports, with no way to see the real number
  // beforehand. Exit time already does this correctly (a genuinely live,
  // computed value as you type); this brings Dive # to the same standard.
  // A placeholder, not a value: saveDive()'s own fallback (g('f-divenum') ||
  // dives.length + 1) reads .value, which a placeholder never populates, so
  // this only ever previews what save will do — it changes no behaviour.
  // Skipped in edit mode, where the input already holds the dive's real,
  // existing number and "auto" doesn't apply.
  if (name === 'log' && editingId === null) {
    const divenumEl = document.getElementById('f-divenum');
    if (divenumEl) divenumEl.placeholder = String(dives.length + 1);
  }

  // Date/Entry/Exit time custom pickers (js/logform.js) — re-synced on
  // every entry to the Log panel, edit mode included (unlike the Dive #
  // placeholder above, these reflect a real value in both new-dive and
  // edit contexts, not just an "auto" preview). Covers every way the
  // underlying value can change — native picker, UDDF prefill, openEdit —
  // without needing to hook each call site individually.
  if (name === 'log' && typeof lfInitPickerInputs === 'function') lfInitPickerInputs();

  // Obsidian panel — populate fields from in-memory settings
  // Use setTimeout so the panel is visible before we set values
  if (name === 'obsidian') {
    setTimeout(() => {
      // Restore sync mode UI state
      setSyncMode(syncMode);
      const keyEl = document.getElementById('obs-apikey');
      const folderEl = document.getElementById('obs-folder');
      if (keyEl) keyEl.value = obsSettings.apikey || '';
      if (folderEl) folderEl.value = obsSettings.folder || 'Dives';

      // Reflect the saved theme preference on the Appearance control
      _syncThemeControl();

      // Reflect the saved dive-type texture preferences on their toggles
      _syncTexControls();

      // Admiralty tide key — desktop only BY DESIGN, not by technical limit:
      // fetch_tide_events (src-tauri/src/lib.rs) is a plain reqwest HTTP call
      // with no platform cfg-gate at all, so it would work identically on
      // Android. isShell() here predates Android as a distinct shell — it
      // meant "desktop" back when it was the only shell there was, and now
      // silently means "desktop OR Android" instead. isDesktopShell() is what
      // actually encodes the documented v2.6 decision (CLAUDE.md: "Admiralty
      // UK Tidal API… desktop-only"). Found in the isShell() audit
      // (BRIEF-play-store-readiness.md §2.10) — same shape as the other
      // desktop-intent-leaking-onto-Android bugs already fixed there.
      const admiraltySection = document.getElementById('admiralty-settings');
      const admiraltyKeyEl   = document.getElementById('admiralty-apikey');
      if (admiraltySection) admiraltySection.style.display = isDesktopShell() ? '' : 'none';
      if (admiraltyKeyEl) admiraltyKeyEl.value = localStorage.getItem('divelog-admiralty-key') || '';

      // BLE sync history (brief §16) — the "forget this computer" escape
      // hatch for the fingerprint-based incremental sync. Defined in
      // js/computer-sync.js; guarded since that file only loads its
      // reveal logic where Web Bluetooth exists, but the list itself
      // should render (or clearly say "none yet") everywhere the panel
      // loads, since forgetting a stored fingerprint is still meaningful
      // groundwork even on a browser that can't sync itself right now.
      if (typeof _renderBleSyncHistory === 'function') _renderBleSyncHistory();
    }, 0);
  }
};

// ── Hash routing (v2.66) ─────────────────────────────────────────────────────
// Panel names that map to URL hashes. #cat-* and other in-page anchors are
// NOT in this list — popstate events with state===null are ignored below.
const PANEL_HASHES = ['history', 'species', 'log', 'plan', 'stats', 'obsidian'];

// Programmatic panel navigation — pushes state and calls show().
// Nav buttons call goPanel(); show() handles the pushState internally too,
// so both paths keep the hash in sync.
function goPanel(name) {
  if (typeof PANEL_HASHES !== 'undefined' && !PANEL_HASHES.includes(name)) return;
  show(name); // show()'s unified patch pushes the hash state
}

// Every nav control (sidebar link, bottom-bar tab, mobile settings cog) goes
// through here rather than calling show() directly — it's what marks the
// switch as "user tapped a nav item", which lands at the top of the panel
// instead of restoring a mid-page scroll (see the scroll block in the show()
// patch for why). Tapping the tab you're ALREADY on is deliberately not a
// no-op: show() re-runs its render and this scrolls to top, so the bar always
// visibly responds — which is itself part of teaching that it's interactive.
// The flag is cleared in a finally so a throw downstream can't leave every
// later navigation stuck in scroll-to-top mode.
function navTo(name, btn) {
  _navTapToTop = true;
  try { show(name, btn); } finally { _navTapToTop = false; }
}

// ── Overlay view-stack (v2.67) ──────────────────────────────────────────────
// Each open*() call pushes a state-only history entry. Back (or Escape) closes
// the topmost overlay without navigating away from the panel.
let _openOverlays   = [];  // [ { type, ...spec }, ... ] stack — mirrors history entries
let _scrollLockCount = 0;  // refcount: locked while any scroll-locking overlay is open

function _lockScroll()   { if (++_scrollLockCount === 1) document.body.style.overflow = 'hidden'; }
function _unlockScroll() { _scrollLockCount = Math.max(0, _scrollLockCount - 1); if (!_scrollLockCount) document.body.style.overflow = ''; }

function _currentPanelName() {
  if (history.state && history.state.panel) return history.state.panel;
  const a = document.querySelector('.panel.active');
  return a ? a.id.replace('panel-', '') : 'history';
}

function _pushOverlayState(spec) {
  _openOverlays.push(spec);
  const panel = _currentPanelName();
  try { history.pushState({ panel, overlay: spec }, '', '#' + panel); } catch(e) {}
}

function closeTopOverlay() {
  if (_openOverlays.length) try { history.back(); } catch(e) {}
}

// Shared teardown dispatch for one popped overlay entry — used by the
// popstate handler (below) and by the unified show() patch, which needs the
// same closing logic for a lateral panel switch away from an open overlay.
function _closeOverlayDirect(spec) {
  if      (spec.type === 'diveFile')       closeDiveFileDirect();
  else if (spec.type === 'speciesProfile') closeSpeciesProfileDirect();
  else if (spec.type === 'footage')        closeFootageDirect();
  else if (spec.type === 'mapPicker')      closeMapPickerDirect();
  else if (spec.type === 'tripMap')        closeTripMapViewDirect();
  else if (spec.type === 'confirm')        closeConfirmDirect();
  else if (spec.type === 'numScroller')    closeNumScrollerDirect();
}

// Unified Escape — same path as Android back gesture
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && _openOverlays.length) { e.preventDefault(); closeTopOverlay(); }
});

// Single declarative popstate handler — reconciles the DOM to the recorded state.
// Layer 2 (overlays) handled first; Layer 1 (panels) handled when stack is empty.
window.addEventListener('popstate', function(e) {
  const state = e.state;
  if (!state) return;

  if (_openOverlays.length) {
    _closeOverlayDirect(_openOverlays.pop());
    // After closing the overlay, switch panel if the target state differs from
    // the currently active one (e.g. sighting-row jump: history → back → species)
    if (state.panel) {
      const activeId = (document.querySelector('.panel.active') || {}).id || '';
      if ('panel-' + state.panel !== activeId) {
        _showFromPopstate = true;
        show(state.panel);
        _showFromPopstate = false;
      }
    }
    return;
  }

  if (!state.panel) return; // #cat-* or unknown — ignore
  _showFromPopstate = true;
  show(state.panel);
  _showFromPopstate = false;
});

async function saveCardToObsidian(id, btn) {
  const dive = dives.find(d => d.id === id);
  if (!dive) return;
  const orig = btn.textContent;
  btn.textContent = 'Saving…';
  btn.disabled = true;
  try {
    const { ok, filename } = await pushToObsidian(dive);
    btn.textContent = ok ? '✓ Saved' : '✗ Failed';
    btn.style.color = ok ? 'var(--success)' : 'var(--danger)';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.color = '';
      btn.disabled = false;
    }, 3000);
  } catch(e) {
    btn.textContent = '✗ Obsidian offline';
    btn.style.color = 'var(--danger)';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.color = '';
      btn.disabled = false;
    }, 3000);
  }
}

// ── PWA Service Worker ────────────────────────────────────────────────────
if (!isShell() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Mobile nav ─────────────────────────────────────────────────────────────
function updateMobileNav(active) {
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('mob-' + active);
  if (btn) btn.classList.add('active');
  // Keep sidebar in sync — clear all, then re-add the correct one
  document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
  const sideBtn = document.querySelector('.nav-link[data-panel="' + active + '"]');
  if (sideBtn) sideBtn.classList.add('active');
}

// Moves #nav-current (the lit bar beside the sidebar nav) to sit beside
// whichever of the 5 primary nav-links is active, animating via the
// element's own CSS transition rather than snapping — see .nav-current in
// styles.css for why this has to be one shared element positioned by JS
// rather than a per-link indicator (a per-item treatment can only fade in
// place; it can't travel, and the travelling motion is the point).
// Scoped to '.nav-section .nav-link' specifically so Settings (data-panel=
// "obsidian", but living in .sidebar-footer, a different positioned
// ancestor the indicator can't reach) doesn't match — landing there hides
// the indicator instead of leaving it pointing at a stale position.
function _updateNavIndicator(active) {
  const ind = document.getElementById('nav-current');
  if (!ind) return;
  const link = document.querySelector('.nav-section .nav-link[data-panel="' + active + '"]');
  if (!link) { ind.style.opacity = '0'; return; }
  ind.style.opacity = '1';
  ind.style.top = link.offsetTop + 'px';
  ind.style.height = link.offsetHeight + 'px';
}

// (mobile nav and obsidian panel handled in unified show() patch above)

// ── Dive folder (persistent directory handle via IndexedDB) ──────────────
// Stores a FileSystemDirectoryHandle across sessions. Permission must be
// re-requested each session (Android Chrome security requirement) but the
// folder never needs to be picked again.

function openFolderDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('divelog-folder', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

async function saveFolderHandle(handle) {
  const db = await openFolderDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'diveFolder');
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

async function loadFolderHandle() {
  try {
    const db = await openFolderDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('diveFolder');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  } catch { return null; }
}

async function clearFolderHandle() {
  const db = await openFolderDB();
  return new Promise((resolve) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').delete('diveFolder');
    tx.oncomplete = resolve;
  });
}

// In-memory cache — loaded once on init so the IDB async lookup doesn't
// consume user-activation time during a save gesture on Android Chrome.
// _folderHandleReady lets callers await the load instead of racing it —
// getWritableFolderHandle() used to read the cache before this promise had
// resolved, silently returning null (and cascading into loadAllSidecars /
// loadAllProfileSidecars no-oping via their own `if (!handle) return`) if
// called in the first tick after boot.
let _folderHandleCache = null;
let _folderNeedsReconnect = false; // surfaced by renderSyncStatus() — see below
const _folderHandleReady = (async () => { _folderHandleCache = await loadFolderHandle(); })();

// True for an error meaning "the OS won't let us touch this folder any more",
// as distinct from a transient or file-specific write failure. Both sources
// have the same fix — re-pick the folder — so they're detected together:
//
//   • Shoal's own FolderScope guard (Rust) — "Refused: path is outside the
//     authorised dive folders", i.e. a root picked before that guard existed.
//   • macOS itself — EPERM / "Operation not permitted". The native folder
//     picker grants the app OS-level access to the picked path as a SIDE
//     EFFECT of the pick; that grant is a completely separate thing from our
//     own persisted allowlist (src-tauri: allowed-folders.json) and does not
//     reliably survive a restart — nor a `cargo tauri dev` rebuild, which
//     changes the binary's identity. ~/Library/CloudStorage/… (Proton Drive,
//     iCloud, Google Drive) is a TCC-protected location where this bites
//     hardest. Our allowlist then says yes while the OS says no, and every
//     read and write fails until the folder is re-picked.
//
// Found 2026-07-26: a restart left folder sync dead with "N dives not synced
// → Retry", where Retry could only ever re-fail — the reconnect path existed
// but was unreachable from the shell. See DECISIONS.md.
function _isFolderPermissionError(e) {
  const msg = String((e && e.message) || e || '');
  // Bare `permission` (not just `not permitted`) so Android's SAF phrasing is
  // caught too. A lapsed persisted-URI grant surfaces as "No directory or
  // permission, or invalid state" or "No permission or entry: content://…" —
  // neither of which matched the desktop-shaped patterns beside it, so a
  // revoked Drive grant showed a dead-end "⚠ Could not read folder" with no
  // Reconnect button, when re-picking the folder is exactly the fix. Seen on
  // hardware 2026-08-01 after the grant lapsed on a Google Drive folder.
  return /refused|authoris|not permitted|denied|permission|invalid state|os error 1\b/i.test(msg);
}

// Returns a verified, permission-granted handle or null.
// Always calls requestPermission (not just queryPermission) — on Android Chrome,
// queryPermission can return 'granted' while the SAF handle has silently lost
// write access. requestPermission re-verifies without showing a dialog if already granted.
// Caveat this doesn't fix: a reload can leave the browser's permission grant
// reverted to 'prompt', and requestPermission() can only show its dialog
// during a live user gesture — called automatically (no click behind it) it
// just resolves non-granted, no error thrown. Rather than let that look like
// the sidecar files vanished, flag it so renderSyncStatus() can surface a
// "reconnect" banner instead of failing silently.
async function getWritableFolderHandle() {
  await _folderHandleReady;
  const handle = _folderHandleCache;
  if (!handle) return null;
  try {
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    _folderNeedsReconnect = perm !== 'granted';
    if (_folderNeedsReconnect) renderSyncStatus();
    return perm === 'granted' ? handle : null;
  } catch {
    _folderNeedsReconnect = true;
    renderSyncStatus();
    return null;
  }
}

// Create-and-write a file inside a directory handle, retrying the whole
// sequence with backoff. Android SAF (File System Access on Chrome Android)
// can throw NoModificationAllowedError / InvalidStateError on a just-created
// file until the OS releases its lock; a few short retries clear it. Other
// errors (permission revoked, quota) aren't transient — fail fast.
// Returns true on success, false once retries are exhausted or on a hard error.
async function writeFileInDir(dirHandle, filename, content, tries = 4) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch (e) {
      const transient = e.name === 'NoModificationAllowedError' || e.name === 'InvalidStateError';
      if (attempt === tries - 1 || !transient) {
        console.warn(`File write failed (${filename}):`, e);
        return false;
      }
      await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  return false;
}

// Auto-write a dive to the set folder (used in folder sync mode).
// On success, clears the dive's _pendingSync flag and stamps the last-sync time,
// then refreshes the status line. Returns true on success, false on failure.
// Coordinated canonical renaming (BRIEF-sidecar-filename-hygiene.md): if the
// dive's canonical name has drifted from its recorded _filename (divenum/site
// changed since the last save), write under the new name first, then clean up
// the old .md + sidecar — never the reverse order.
async function writeToFolder(dive) {
  const oldFilename = dive._filename || '';
  const filename = canonicalFilename(dive);
  const body = generateFrontmatter(dive) + '\n' + generateMD(dive);
  let ok;
  if (isAndroidShell()) {
    const folder = _androidFolder();
    if (!folder) return false;
    try { await window.__TAURI__.core.invoke('android_write_file', { folder, filename, content: body }); ok = true; }
    catch (e) {
      console.warn('Android folder write failed:', filename, e);
      // A revoked SAF grant is the same class of problem as a lost desktop
      // grant or a browser handle that fell back to 'prompt' — not per-dive,
      // not fixable by Retry. Surface Reconnect instead. Persisted SAF
      // permissions genuinely do expire (uninstall, user revocation, the
      // ~128-URI cap), so this path is expected, not exceptional.
      if (_isFolderPermissionError(e)) _folderNeedsReconnect = true;
      ok = false;
    }
  } else if (isDesktopShell()) {
    const folder = localStorage.getItem('divelog-shell-vault-path');
    if (!folder) return false;
    try { await window.__TAURI__.core.invoke('write_text_file', { path: folder + '/' + filename, content: body }); ok = true; }
    catch(e) {
      console.warn('Shell folder write failed:', folder + '/' + filename, e);
      // A lost access grant is not a per-dive problem and Retry can't fix it —
      // flag it so the banner offers Reconnect (a re-pick) instead.
      if (_isFolderPermissionError(e)) _folderNeedsReconnect = true;
      ok = false;
    }
  } else {
    const handle = await getWritableFolderHandle();
    if (!handle) return false;
    ok = await writeFileInDir(handle, filename, body);
  }
  if (ok) {
    const renamed = !!(oldFilename && oldFilename !== filename);
    dive._filename = filename;
    dive._pendingSync = false;
    localStorage.setItem('divelog-dives', JSON.stringify(dives));
    localStorage.setItem('divelog-last-sync', new Date().toISOString());
    if (renamed) await _cleanupOldDiveFiles(dive, oldFilename);
  }
  renderSyncStatus();
  return ok;
}

// ── Sync status line (v2.65) ───────────────────────────────────────────────
// Honest "where are my dives / are they backed up?" indicator, driven by
// syncMode + the _pendingSync flag (set on every mutation, cleared on a
// successful backend write). Quiet & persistent in the desktop sidebar
// (#sidebar-sync); on mobile it's an in-flow banner. The "synced" confirmation
// is reassurance, not an alert, so on mobile it auto-retracts after 30s — only
// the actionable states (some dives not synced / browser-only) persist.
// Obsidian mode keeps its own status UI — here we only clear our banner.
let _ssHideTimer = null;

function renderSyncStatus() {
  clearTimeout(_ssHideTimer);
  const banners = ['sync-banner-log', 'sync-banner-history'].map(id => document.getElementById(id));
  if (syncMode === 'obsidian') {
    banners.forEach(el => {
      if (el && el.classList.contains('ss-banner')) { el.style.display = 'none'; el.className = 'sync-banner'; el.innerHTML = ''; }
    });
    return;
  }

  let tone, mark = 'dot', text, action = '', showBanner = true;
  if (syncMode === 'none') {
    if (!dives.length) { tone = 'muted'; text = 'No dives yet'; showBanner = false; }
    else {
      tone = 'warn';
      text = 'In your browser only';
      action = `<button class="ss-act" onclick="show('obsidian')">Back up</button>`;
    }
  } else { // folder
    if (_folderNeedsReconnect) {
      tone = 'warn'; mark = 'warn';
      text = 'Folder sync disconnected';
      action = `<button class="ss-act" onclick="reconnectDiveFolder(this)">Reconnect</button>`;
    } else {
      const pending = dives.filter(d => d._pendingSync).length;
      if (pending) {
        tone = 'warn'; mark = 'warn';
        text = `${pending} dive${pending !== 1 ? 's' : ''} not synced`;
        action = `<button class="ss-act" onclick="retrySync(this)">Retry</button>`;
      } else {
        tone = 'ok';
        text = 'Synced to your folder';
      }
    }
  }

  const icon = mark === 'warn' ? '<span class="ss-warnmark">⚠</span>' : '<span class="ss-dot"></span>';
  const inner = `${icon}<span class="ss-text">${text}</span>${action}`;
  const side = document.getElementById('sidebar-sync');
  if (side) { side.className = 'sidebar-sync ss-' + tone; side.innerHTML = inner; }
  banners.forEach(el => {
    if (!el) return;
    if (showBanner) { el.className = 'sync-banner ss-banner ss-' + tone; el.innerHTML = inner; el.style.display = ''; }
    else { el.style.display = 'none'; el.className = 'sync-banner'; el.innerHTML = ''; }
  });

  // Synced = reassurance only → fade the mobile banner after 30s. (The desktop
  // sidebar is quiet and stays.) Actionable states are 'warn' and don't fade.
  if (tone === 'ok') {
    _ssHideTimer = setTimeout(() => {
      banners.forEach(el => { if (el && el.classList.contains('ss-banner')) el.style.display = 'none'; });
    }, 30000);
  }
}

// Re-attempt the backend write for every dive still flagged _pendingSync.
async function retrySync(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Retrying…'; }
  const pending = dives.filter(d => d._pendingSync);
  if (syncMode === 'folder') {
    for (const d of pending) await writeToFolder(d);
  } else if (syncMode === 'obsidian') {
    for (const d of pending) { try { await pushToObsidian(d); } catch (e) {} }
  }
  renderSyncStatus();
}

// Reconnect action behind the "Folder sync disconnected" banner. Unlike the
// silent boot-time syncFromFolder(false) call, this click carries live user
// activation, so getWritableFolderHandle()'s requestPermission call can
// actually show the browser's permission dialog if the grant reverted.
async function reconnectDiveFolder(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Reconnecting…'; }
  // Shell: only a fresh native pick re-grants the app OS-level access to the
  // folder (see _isFolderPermissionError). getWritableFolderHandle() below is
  // File System Access API — it has no shell equivalent and just returns null
  // there, which is why this button did nothing at all in the desktop app.
  if (isShell()) {
    const picked = await setDiveFolder();
    if (picked) {
      _folderNeedsReconnect = false;
      for (const d of dives.filter(d => d._pendingSync)) await writeToFolder(d);
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Reconnect'; }
    renderSyncStatus();
    return;
  }
  const handle = await getWritableFolderHandle();
  if (handle) {
    await syncFromFolder(); // re-pull sidecars that silently no-op'd while disconnected
    for (const d of dives.filter(d => d._pendingSync)) await writeToFolder(d);
  }
  renderSyncStatus();
}

// ── First-run welcome card (v2.65) ─────────────────────────────────────────
// Shown once to a brand-new user (no dives, never dismissed). Both buttons set
// the seen-flag so it never returns; "Set up backup" also opens Settings.
function showWelcome() {
  const el = document.getElementById('welcome-overlay');
  if (el) el.classList.add('open');
}
function dismissWelcome() {
  localStorage.setItem('divelog-welcome-seen', '1');
  const el = document.getElementById('welcome-overlay');
  if (el) el.classList.remove('open');
}

// ── iOS Home Screen install nudge (BRIEF-ios-sync.md §2.3/§7) ──────────────
// Safari never fires beforeinstallprompt, so an iPhone/iPad user has no native
// affordance surfacing "Add to Home Screen" — and it's not just convenience:
// Safari caps script-writable storage at 7 days without interaction, a real
// data-loss risk for a browser-tab user, and an installed web app gets
// materially better retention. Shown once in Settings & data (where a user is
// already thinking about backup/storage), never again once installed or
// dismissed. iPadOS reports its platform as 'MacIntel' with touch support,
// so it's detected via maxTouchPoints rather than the UA string alone.
function _isIosSafariBrowserTab() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  return isIOS && !isStandalone;
}
function maybeShowIosInstallCard() {
  if (!_isIosSafariBrowserTab() || localStorage.getItem('divelog-ios-install-seen')) return;
  const el = document.getElementById('ios-install-card');
  if (el) el.style.display = '';
}
function dismissIosInstallCard() {
  localStorage.setItem('divelog-ios-install-seen', '1');
  const el = document.getElementById('ios-install-card');
  if (el) el.style.display = 'none';
}

// Android SAF can throw NoModificationAllowedError on createWritable() for a
// just-created file; here that's harmless — any error falls through to the
// browser download below, so the user still gets the file. (The folder-sync
// write paths use writeFileInDir's retry instead.)
async function downloadDiveCard(id) {
  const dive = dives.find(d => d.id === id);
  if (!dive) return;
  const filename = dive._filename || canonicalFilename(dive);
  const body = generateFrontmatter(dive) + '\n' + generateMD(dive);

  // Use Save As dialog when available (desktop + Android Chrome) so user picks location
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(body);
      await writable.close();
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // user cancelled — do nothing
      // Any other error: fall through to browser download
    }
  }

  // Fallback: straight download to Downloads folder
  downloadMd(filename, body);
}

async function setDiveFolder() {
  if (isAndroidShell()) {
    // SAF folder picker. Note this returns opaque JSON, not a path — Android
    // has no path to give (see src-tauri/src/androidfs.rs). The Rust side has
    // already persisted the access grant by the time this resolves.
    // offerDefault only when nothing is connected yet — a re-pick ("Change
    // folder") must not create a `Documents/Shoal` that can't be cleaned up
    // again if the user goes to Drive instead. See android_pick_folder's own
    // comment (src-tauri/src/androidfs.rs).
    const folder = await window.__TAURI__.core.invoke('android_pick_folder', { offerDefault: !_androidFolder() }).catch(e => {
      console.warn('Android folder pick failed:', e);
      return null;
    });
    if (!folder) return false; // cancelled — same contract as the desktop branch
    _setAndroidFolder(folder);
    const name = await _androidFolderDisplayName(folder);
    localStorage.setItem('divelog-folder-name', name);
    _folderNeedsReconnect = false;
    updateFolderUI(name);
    await syncFromFolder();
    return true;
  }
  if (isDesktopShell()) {
    // Re-picking (change/reconnect) should open where the vault already is,
    // not wherever the OS's native panel last happened to be — macOS shares
    // that "last visited" state across every unrelated picker in the app
    // (export, proxy folders, even the plain <input type=file> used for
    // UDDF import), so without this a stray pick elsewhere can silently
    // repoint dive sync at the wrong folder. See pick_folder's Rust comment.
    const defaultPath = localStorage.getItem('divelog-shell-vault-path') || undefined;
    const result = await window.__TAURI__.core.invoke('pick_folder', { title: 'Select dive vault folder', defaultPath }).catch(() => null);
    if (!result) return false; // cancelled — callers must not treat this as reconnected
    localStorage.setItem('divelog-shell-vault-path', result);
    const name = result.split('/').pop() || result;
    localStorage.setItem('divelog-folder-name', name);
    // The pick itself is what restores the OS-level access grant.
    _folderNeedsReconnect = false;
    updateFolderUI(name);
    await syncFromFolder();
    return true;
  }
  if (!window.showDirectoryPicker) {
    showToast('Your browser doesn\'t support folder access. On iPhone/iPad, use Import/Export below instead — Safari doesn\'t support live folder sync.', { variant: 'error' });
    return false;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveFolderHandle(handle);
    _folderHandleCache = handle;
    _folderNeedsReconnect = false;
    localStorage.setItem('divelog-folder-name', handle.name);
    updateFolderUI(handle.name);
    // Automatically import any existing .md files in the folder
    syncFromFolder();
    return true;
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
    return false;
  }
}

// Read all .md files from the dive folder and merge them into localStorage.
// Uses the same parse/merge pipeline as importDivesFromFiles().
// verbose=false is used for the silent boot-time call (mirrors syncFromObsidian's
// showBanner param) — suppresses the "No folder set" alert so an automatic
// call at load doesn't pop a dialog for every 'folder' mode user who hasn't
// (yet, or ever) picked a folder or has a lapsed permission grant.
async function syncFromFolder(verbose = true) {
  if (isShell()) {
    // Both shells share this whole body — only WHERE the folder comes from and
    // WHICH command reads it differ. Android's `folder` is opaque SAF JSON,
    // desktop's is an absolute path string; neither is inspected here.
    const android = isAndroidShell();
    const folder  = android ? _androidFolder()
                            : localStorage.getItem('divelog-shell-vault-path');
    if (!folder) { if (verbose) showToast('No folder set. Click "Set folder" first.', { variant: 'warning' }); return; }
    const statusEl = document.getElementById('folder-sync-status');
    const btn      = document.getElementById('folder-sync-btn');
    if (statusEl) statusEl.textContent = 'Reading folder…';
    if (btn)      { btn.disabled = true; btn.textContent = 'Reading…'; }

    // Android only: ask for content only for .md files changed since the last
    // successful sync of THIS folder, instead of reading all of them on every
    // launch. This is what the sidecar listing-first fix (loadAllSidecars,
    // js/video.js) couldn't reach — that cut ~190 mostly-failing probes, but
    // this call still read all 94 dive files' CONTENT sequentially every time,
    // measured at 62.5 s of the 119.5 s Drive baseline. See
    // android_list_md_files' own comment (src-tauri/src/androidfs.rs).
    const sinceMs = android ? _androidFolderSyncCursor(folder) : null;

    let result;
    try {
      result = await window.__TAURI__.core.invoke(
        android ? 'android_list_md_files' : 'list_md_files',
        android ? { folder, sinceMs } : { folder }
      );
    } catch(e) {
      console.error('Shell folder read error:', e);
      // The native fs commands are confined to folders the user picked through
      // a dialog (security review F2). A folder authorised in a previous build
      // (before that guard existed) is refused until re-picked — surface that
      // as an actionable prompt, not a generic "couldn't read" that reads like
      // the folder is missing/broken.
      const needsReauth = _isFolderPermissionError(e);
      if (needsReauth) { _folderNeedsReconnect = true; renderSyncStatus(); }
      if (statusEl) statusEl.textContent = needsReauth
        ? '⚠ Folder needs re-authorising — click "Change folder" and re-select it'
        : '⚠ Could not read folder';
      if (btn)      { btn.disabled = false; btn.textContent = '↻ Sync from folder'; }
      return;
    }
    // Android wraps its response ({maxModified, files}) so the cursor can
    // travel back with it; desktop's list_md_files stays a bare array.
    const entries = android ? result.files : result;
    if (entries.length === 0) {
      // On Android, zero results from an INCREMENTAL read (sinceMs was set)
      // just means nothing has changed since last time — the expected outcome
      // of most routine syncs — not the folder being empty or wrong. Only the
      // genuine first-sync-found-nothing case gets the warning below.
      if (android && sinceMs != null) {
        _setAndroidFolderSyncCursor(folder, result.maxModified);
        if (statusEl) statusEl.textContent = '✓ Up to date';
        if (btn)      { btn.disabled = false; btn.textContent = '↻ Sync from folder'; }
        return;
      }
      if (statusEl) statusEl.textContent = 'No .md files found in this folder';
      if (btn)      { btn.disabled = false; btn.textContent = '↻ Sync from folder'; }
      return;
    }
    // Synthesise File-like objects — importDivesFromFiles only needs .name and .text()
    const fileObjs = entries.map(e => ({ name: e.name, text: () => Promise.resolve(e.content) }));
    await importDivesFromFiles(fileObjs);
    await loadAllSidecars(dives);
    await loadAllProfileSidecars(dives);
    applyAllSidecars(dives);
    await migrateLegacyFootage(dives);
    localStorage.setItem('divelog-dives', JSON.stringify(dives));
    renderHistory();
    // Advances the cursor on a first full sync too (sinceMs was null), so the
    // NEXT sync is the first one that actually gets to be incremental.
    if (android) _setAndroidFolderSyncCursor(folder, result.maxModified);
    const importStatus = document.getElementById('import-status');
    if (statusEl && importStatus) statusEl.textContent = importStatus.textContent;
    if (btn) { btn.disabled = false; btn.textContent = '↻ Sync from folder'; }
    return;
  }

  const handle = await getWritableFolderHandle();
  if (!handle) {
    if (verbose) showToast('No folder set. Click "Set folder" first.', { variant: 'warning' });
    return;
  }

  const statusEl = document.getElementById('folder-sync-status');
  const btn      = document.getElementById('folder-sync-btn');
  if (statusEl) statusEl.textContent = 'Reading folder…';
  if (btn)      { btn.disabled = true; btn.textContent = 'Reading…'; }

  const fileObjs = [];
  try {
    for await (const entry of handle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.md')) {
        fileObjs.push(await entry.getFile());
      }
    }
  } catch (e) {
    console.error('Folder read error:', e);
    if (statusEl) statusEl.textContent = '⚠ Could not read folder — try refreshing and granting permission again';
    if (btn)      { btn.disabled = false; btn.textContent = '↻ Sync from folder'; }
    return;
  }

  if (fileObjs.length === 0) {
    if (statusEl) statusEl.textContent = 'No .md files found in this folder';
    if (btn)      { btn.disabled = false; btn.textContent = '↻ Sync from folder'; }
    return;
  }

  // importDivesFromFiles reads file.text() and file.name — real File objects work fine.
  // We temporarily redirect its status output to our folder status element.
  await importDivesFromFiles(fileObjs);

  // Footage sidecars: load *.footage.json from the same folder, apply, then
  // read-repair any dive whose footage exists only in MD/local state.
  await loadAllSidecars(dives);
  await loadAllProfileSidecars(dives);
  applyAllSidecars(dives);
  await migrateLegacyFootage(dives);
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  renderHistory();

  // importDivesFromFiles writes its result to #import-status — mirror it here too.
  const importStatus = document.getElementById('import-status');
  if (statusEl && importStatus) statusEl.textContent = importStatus.textContent;

  if (btn) { btn.disabled = false; btn.textContent = '↻ Sync from folder'; }
}

async function clearDiveFolder() {
  await clearFolderHandle();
  _folderHandleCache = null;
  _setAndroidFolder(null);   // SAF handle lives in localStorage, not IndexedDB
  _folderNeedsReconnect = false;
  localStorage.removeItem('divelog-folder-name');
  updateFolderUI(null);
  renderSyncStatus();
}

function updateFolderUI(folderName) {
  const nameEl    = document.getElementById('dive-folder-name');
  const clearBtn  = document.getElementById('dive-folder-clear');
  const setBtn    = document.getElementById('dive-folder-set');
  const syncBtn   = document.getElementById('folder-sync-btn');
  if (!nameEl) return;
  if (folderName) {
    nameEl.textContent = '📁 ' + folderName;
    nameEl.style.color = 'var(--success)';
    if (clearBtn) clearBtn.style.display = 'inline-block';
    if (syncBtn)  syncBtn.style.display  = 'inline-block';
    if (setBtn)   setBtn.textContent = 'Change folder';
  } else {
    nameEl.textContent = 'No folder set';
    nameEl.style.color = 'var(--text-dim)';
    if (clearBtn) clearBtn.style.display = 'none';
    if (syncBtn)  syncBtn.style.display  = 'none';
    if (setBtn)   setBtn.textContent = 'Set folder';
  }
}

// Initialise folder UI from localStorage (fast, no IndexedDB needed)
(function initFolderUI() {
  const name = localStorage.getItem('divelog-folder-name');
  updateFolderUI(name || null);
})();

// ── Save to device (File System Access API) ───────────────────────────────
async function exportAllDives(btn) {
  if (!dives.length) { showToast('No dives to export.'); return; }
  const statusEl = document.getElementById('export-status');
  const origText = btn.textContent;

  if (isAndroidShell()) {
    // Always a fresh pick, same as the desktop branch below — this is a
    // one-off export destination, not necessarily the configured sync folder.
    // Never offers the default folder: this is a one-off export destination,
    // so creating a sync-shaped `Documents/Shoal` here would be actively wrong.
    const folder = await window.__TAURI__.core.invoke('android_pick_folder', { offerDefault: false }).catch(e => {
      console.warn('Android folder pick failed:', e);
      return null;
    });
    if (!folder) return;
    // SAF gives a display name, not a path — same extraction as setDiveFolder's
    // Android branch.
    const name = (folder && folder.uri ? decodeURIComponent(folder.uri).split(/[:/]/).filter(Boolean).pop() : '') || 'Selected folder';
    btn.textContent = 'Exporting…';
    btn.disabled = true;
    if (statusEl) statusEl.textContent = '';
    let written = 0, failed = 0, mintedAny = false;
    for (const d of dives) {
      const { files, minted } = _exportFilesForDive(d);
      mintedAny = mintedAny || minted;
      for (const f of files) {
        try {
          await window.__TAURI__.core.invoke('android_write_file', { folder, filename: f.name, content: f.text });
          written++;
        } catch(e) { failed++; }
      }
    }
    if (mintedAny) localStorage.setItem('divelog-dives', JSON.stringify(dives));
    btn.textContent = origText;
    btn.disabled = false;
    if (statusEl) statusEl.textContent = `✓ ${written} file${written !== 1 ? 's' : ''} written to ${name}${failed ? `, ${failed} failed` : ''}`;
    return;
  }

  if (isDesktopShell()) {
    const defaultPath = localStorage.getItem('divelog-shell-vault-path') || undefined;
    const folder = await window.__TAURI__.core.invoke('pick_folder', { title: 'Export dives to folder', defaultPath }).catch(() => null);
    if (!folder) return;
    btn.textContent = 'Exporting…';
    btn.disabled = true;
    if (statusEl) statusEl.textContent = '';
    let written = 0, failed = 0, mintedAny = false;
    for (const d of dives) {
      const { files, minted } = _exportFilesForDive(d);
      mintedAny = mintedAny || minted;
      for (const f of files) {
        try {
          await window.__TAURI__.core.invoke('write_text_file', { path: folder + '/' + f.name, content: f.text });
          written++;
        } catch(e) { failed++; }
      }
    }
    if (mintedAny) localStorage.setItem('divelog-dives', JSON.stringify(dives));
    btn.textContent = origText;
    btn.disabled = false;
    if (statusEl) statusEl.textContent = `✓ ${written} file${written !== 1 ? 's' : ''} written to ${folder.split('/').pop()}${failed ? `, ${failed} failed` : ''}`;
    return;
  }

  if (!window.showDirectoryPicker) {
    // Brave blocks showDirectoryPicker; Safari never shipped it. Bundle all
    // dive .md files + footage sidecars into one zip — a single save dialog
    // instead of one browser download per file.
    btn.textContent = 'Exporting…';
    btn.disabled = true;
    const enc = new TextEncoder();
    const entries = [];
    let mds = 0, sidecars = 0, mintedAny = false;
    for (const d of dives) {
      const { files, minted } = _exportFilesForDive(d);
      mintedAny = mintedAny || minted;
      for (const f of files) {
        entries.push({ name: f.name, data: enc.encode(f.text) });
        if (f.name.endsWith('.md')) mds++; else sidecars++;
      }
    }
    if (mintedAny) localStorage.setItem('divelog-dives', JSON.stringify(dives));
    const stamp = new Date().toISOString().slice(0, 10);
    await shareOrDownload(`dive-log-export-${stamp}.zip`, buildZip(entries));
    btn.textContent = origText;
    btn.disabled = false;
    if (statusEl) statusEl.textContent =
      `✓ ${mds} dive${mds !== 1 ? 's' : ''}${sidecars ? ` + ${sidecars} sidecar${sidecars !== 1 ? 's' : ''}` : ''} → dive-log-export-${stamp}.zip`;
    return;
  }

  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
    return;
  }

  btn.textContent = 'Exporting…';
  btn.disabled = true;
  if (statusEl) statusEl.textContent = '';

  let written = 0, failed = 0, mintedAny = false;
  for (const d of dives) {
    const { files, minted } = _exportFilesForDive(d);
    mintedAny = mintedAny || minted;
    for (const f of files) {
      if (await writeFileInDir(dirHandle, f.name, f.text)) written++;
      else failed++;
    }
  }
  if (mintedAny) localStorage.setItem('divelog-dives', JSON.stringify(dives));

  btn.textContent = origText;
  btn.disabled = false;
  const summary = `✓ ${written} file${written !== 1 ? 's' : ''} written${failed ? `, ${failed} failed` : ''}`;
  if (statusEl) statusEl.textContent = summary;
}



// Files for one dive: the .md plus, when it has footage, the .footage.json
// sidecar under the same basename (the join convention). Mints a uid when a
// sidecar needs one — mint happens before generateMD so the frontmatter and
// sidecar carry the same uid. Caller persists dives once if any .minted.
function _exportFilesForDive(d) {
  const filename = d._filename || canonicalFilename(d);
  const files = [];
  let minted = false;
  const sc = buildSidecarData(d);
  const hasFootage = (sc.videos && sc.videos.length) || Object.keys(sc.clips).length > 0;
  if (hasFootage && !d.uid) { d.uid = mintUid(); sc.diveUid = d.uid; minted = true; }
  files.push({ name: filename, text: generateFrontmatter(d) + '\n' + generateMD(d) });
  if (hasFootage) {
    files.push({ name: filename.replace(/\.md$/i, '.footage.json'), text: JSON.stringify(sc, null, 2) });
  }
  return { files, minted };
}

// Minimal zip writer (STORE only — dive files are tiny, compression is not
// worth a vendored library). entries: [{ name, data: Uint8Array }].
function buildZip(entries) {
  const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    tbl[i] = c >>> 0;
  }
  const crc32 = buf => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = tbl[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
  const enc = new TextEncoder();

  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc  = crc32(e.data);
    const lfh  = new DataView(new ArrayBuffer(30));
    lfh.setUint32(0, 0x04034b50, true);
    lfh.setUint16(4, 20, true);        // version needed
    lfh.setUint16(6, 0x0800, true);    // flags: UTF-8 names
    lfh.setUint16(8, 0, true);         // method: store
    lfh.setUint16(10, dosTime, true);
    lfh.setUint16(12, dosDate, true);
    lfh.setUint32(14, crc, true);
    lfh.setUint32(18, e.data.length, true);
    lfh.setUint32(22, e.data.length, true);
    lfh.setUint16(26, name.length, true);
    lfh.setUint16(28, 0, true);        // extra len
    parts.push(new Uint8Array(lfh.buffer), name, e.data);

    const cdh = new DataView(new ArrayBuffer(46));
    cdh.setUint32(0, 0x02014b50, true);
    cdh.setUint16(4, 20, true);        // version made by
    cdh.setUint16(6, 20, true);        // version needed
    cdh.setUint16(8, 0x0800, true);
    cdh.setUint16(10, 0, true);
    cdh.setUint16(12, dosTime, true);
    cdh.setUint16(14, dosDate, true);
    cdh.setUint32(16, crc, true);
    cdh.setUint32(20, e.data.length, true);
    cdh.setUint32(24, e.data.length, true);
    cdh.setUint16(28, name.length, true);
    cdh.setUint32(42, offset, true);   // LFH offset (extra/comment/attrs stay 0)
    central.push(new Uint8Array(cdh.buffer), name);
    offset += 30 + name.length + e.data.length;
  }
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// iOS Safari has no showSaveFilePicker and the <a download> blob trick lands
// a file in Downloads with no destination choice — a dead end that leaves the
// user right back in the download-then-move flow this exists to avoid. Web
// Share Level 2 opens the native share sheet with "Save to Files" (→ iCloud
// Drive) as a target. Falls through to downloadBlob() unchanged wherever the
// platform can't share files (desktop browsers, or after a user cancels — see
// BRIEF-ios-sync.md §2.1). Must be called with no prior await, or iOS can
// drop the transient-activation gesture navigator.share() requires.
async function shareOrDownload(filename, blob) {
  if (navigator.canShare) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // user cancelled the share sheet
        // Any other error: fall through to the download
      }
    }
  }
  downloadBlob(filename, blob);
}

function downloadMd(filename, content) {
  shareOrDownload(filename, new Blob([content], { type: 'text/markdown' }));
}


// ── GPS / Dive site live search ───────────────────────────────────────────

// ── Site history (own logged dives) ──────────────────────────────────────
function buildSiteHistory() {
  _siteHistory = {};
  for (const d of dives) {
    if (!d.site) continue;
    const key = (d.site).toLowerCase().trim();
    if (!_siteHistory[key]) {
      _siteHistory[key] = {
        site: d.site, region: d.region || '', location: d.location || '',
        lat: null, lng: null, count: 0, lastDate: ''
      };
    }
    const h = _siteHistory[key];
    h.count++;
    // Keep coordinates and date from the most recent dive at this site
    if (!d.date || d.date >= h.lastDate) {
      h.lastDate = d.date || h.lastDate;
      if (d.gps_lat) { h.lat = d.gps_lat; h.lng = d.gps_lng; }
    }
  }
}

function searchSiteHistory(query) {
  const q = query.toLowerCase().trim();
  const results = [];
  for (const h of Object.values(_siteHistory)) {
    const name = h.site.toLowerCase();
    if (name.includes(q)) results.push(h);
  }
  // starts-with first, then by dive count descending
  results.sort((a, b) => {
    const as = a.site.toLowerCase().startsWith(q);
    const bs = b.site.toLowerCase().startsWith(q);
    if (as !== bs) return as ? -1 : 1;
    return b.count - a.count;
  });
  return results.slice(0, 6);
}

function renderHistoryItem(h, prefix) {
  const ns = h.site.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const nr = h.region.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const nl = h.location.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const diveLabel = h.count === 1 ? '1 dive' : `${h.count} dives`;
  const dateLabel = h.lastDate ? ` · ${h.lastDate.slice(0, 7)}` : '';
  const coordLabel = h.lat ? `${parseFloat(h.lat).toFixed(4)}, ${parseFloat(h.lng).toFixed(4)}` : '';
  const latArg = h.lat != null ? h.lat : 'null';
  const lngArg = h.lng != null ? h.lng : 'null';
  return `<div class="ac-item ac-item-history"
    onmousedown="pickHistorySite('${esc(ns)}',${latArg},${lngArg},'${esc(nr)}','${esc(nl)}','${prefix}')">
    <span class="ac-ih-name">${esc(h.site)}</span>
    <span class="ac-ih-meta">${diveLabel}${dateLabel}</span>
    ${coordLabel ? `<span class="ac-ih-coords">${coordLabel}</span>` : ''}
  </div>`;
}

function pickHistorySite(name, lat, lng, region, location, prefix) {
  const siteEl    = document.getElementById(`${prefix}-site`);
  const regionEl  = document.getElementById(`${prefix}-region`);
  const locationEl = document.getElementById(`${prefix}-location`);
  const dd        = document.getElementById(`ac-${prefix}-site`);
  if (siteEl) siteEl.value = name;
  if (dd) dd.style.display = 'none';
  // Auto-fill country and region if the fields are currently blank
  if (regionEl && !regionEl.value && region) regionEl.value = region;
  if (locationEl && !locationEl.value && location) {
    // Set select to matching option
    for (const opt of locationEl.options) {
      if (opt.value === location) { locationEl.value = location; break; }
    }
  }
  if (lat != null) {
    document.getElementById(`${prefix}-gps-lat`).value = parseFloat(lat).toFixed(6);
    document.getElementById(`${prefix}-gps-lng`).value = parseFloat(lng).toFixed(6);
    setGpsStatus(`✓ ${name}`, true, prefix);
  }
}

// ── Dive Vibe Community database ─────────────────────────────────────────
// 2,800+ community-maintained dive sites as static JSON on GitHub (ODbL licence).
// Fetched on demand, cached in memory. No API key, no CORS issues.
const DV_BASE = 'https://raw.githubusercontent.com/jbunderwater/dive-vibe-community/main';
let   _dvDestinations = null;      // destinations.json (165 destinations)
const _dvIndexCache   = {};        // {slug: [sites]} — per-destination index.json

// Mapping from app country names → ISO 2-letter codes used by Dive Vibe
const _countryISO2 = {
  'Australia':'AU','Bahamas':'BS','Belize':'BZ','Brazil':'BR','Brunei':'BN',
  'Cambodia':'KH','Canada':'CA','Chile':'CL','China':'CN','Colombia':'CO',
  'Costa Rica':'CR','Croatia':'HR','Cuba':'CU','Cyprus':'CY','Denmark':'DK',
  'Djibouti':'DJ','Dominica':'DM','Dominican Republic':'DO','Ecuador':'EC',
  'Egypt':'EG','Fiji':'FJ','France':'FR','Greece':'GR','Grenada':'GD',
  'Honduras':'HN','India':'IN','Indonesia':'ID','Israel':'IL','Italy':'IT',
  'Jamaica':'JM','Japan':'JP','Jordan':'JO','Kenya':'KE','Madagascar':'MG',
  'Malaysia':'MY','Maldives':'MV','Marshall Islands':'MH','Mauritius':'MU',
  'Mexico':'MX','Micronesia':'FM','Mozambique':'MZ','Myanmar':'MM',
  'Netherlands':'NL','New Zealand':'NZ','Norway':'NO','Oman':'OM','Palau':'PW',
  'Panama':'PA','Papua New Guinea':'PG','Peru':'PE','Philippines':'PH',
  'Portugal':'PT','Saudi Arabia':'SA','Seychelles':'SC','Singapore':'SG',
  'Solomon Islands':'SB','South Africa':'ZA','South Korea':'KR','Spain':'ES',
  'Sri Lanka':'LK','Saint Lucia':'LC','Saint Vincent and the Grenadines':'VC',
  'Tanzania':'TZ','Thailand':'TH','Timor-Leste':'TL','Tonga':'TO',
  'Trinidad and Tobago':'TT','Turkey':'TR','United Arab Emirates':'AE',
  'United Kingdom':'GB','United States':'US','Vanuatu':'VU','Vietnam':'VN'
};

async function _dvLoadDestinations() {
  if (_dvDestinations) return _dvDestinations;
  try {
    const r = await fetch(`${DV_BASE}/destinations.json`);
    _dvDestinations = await r.json();
  } catch(e) { _dvDestinations = []; }
  return _dvDestinations;
}

async function queryDiveVibe(name, country, region) {
  const iso2 = _countryISO2[country];
  if (!iso2) return [];
  const dests = await _dvLoadDestinations();
  // Find destinations matching country, optionally narrowed by region text
  let matches = dests.filter(d => d.countryCode === iso2 && !d.isGroup);
  if (region && matches.length > 1) {
    const rLow = region.toLowerCase().replace(/\s+/g, '-');
    const narrow = matches.filter(d =>
      d.name.toLowerCase().includes(region.toLowerCase()) ||
      (d.slug || '').includes(rLow)
    );
    if (narrow.length) matches = narrow;
  }
  // Fetch index.json for up to 3 matching destinations (in parallel)
  await Promise.all(matches.slice(0, 3).map(async dest => {
    if (_dvIndexCache[dest.slug] !== undefined) return;
    try {
      const r = await fetch(`${DV_BASE}/divesites/${dest.slug}/index.json`);
      _dvIndexCache[dest.slug] = await r.json();
    } catch(e) { _dvIndexCache[dest.slug] = []; }
  }));
  // Collect and filter by name
  const nameLow = name.toLowerCase();
  const results = [];
  for (const dest of matches.slice(0, 3)) {
    for (const site of (_dvIndexCache[dest.slug] || [])) {
      if (site.name.toLowerCase().includes(nameLow) && site.lat && site.lng)
        results.push({ ...site, _destName: dest.name });
    }
  }
  return results;
}

// Cache the Overpass search area per prefix so Nominatim is only called when
// the country or region changes, not on every keystroke.
const _bboxCache = {};
let   _siteDebounce = null;
let   _siteReqId    = 0;     // incremented on each new search; checked before showing results
let   _regionDebounce = null;

// Called oninput on the region field — runs autocomplete AND triggers bbox prefetch
function onRegionInput(el, prefix) {
  acInput(el, 'region');
  clearTimeout(_regionDebounce);
  _regionDebounce = setTimeout(() => prefetchSearchBbox(prefix), 600);
}

async function prefetchSearchBbox(prefix = 'f') {
  const country = (document.getElementById(`${prefix}-location`)?.value || '').trim();
  const region  = (document.getElementById(`${prefix}-region`)?.value  || '').trim();
  const key = region ? `${region}, ${country}` : country;
  if (!country || _bboxCache[prefix + key]) return;

  const nomQ = region
    ? `q=${encodeURIComponent(region + ', ' + country)}`
    : `country=${encodeURIComponent(country)}`;
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?${nomQ}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await resp.json();
    if (!data.length) return;
    const r = data[0];
    const [south, north, west, east] = r.boundingbox;
    const spanLat = Math.abs(parseFloat(north) - parseFloat(south));
    const spanLng = Math.abs(parseFloat(east)  - parseFloat(west));
    const tight   = spanLat < 8 && spanLng < 8;
    // Add a 0.15° buffer (~16 km) so sites just outside the island/region
    // boundary (e.g. Batu Bolong east of Komodo island bbox) are included
    const buf = 0.15;
    const s = (parseFloat(south) - buf).toFixed(6);
    const n = (parseFloat(north) + buf).toFixed(6);
    const w = (parseFloat(west)  - buf).toFixed(6);
    const e2= (parseFloat(east)  + buf).toFixed(6);
    _bboxCache[prefix + key] = { area: `(${s},${w},${n},${e2})`, tight };
  } catch(e) { /* silent */ }
}

function siteMsg(dd, text) {
  dd.innerHTML = `<div class="ac-item" style="color:var(--text-dim);font-style:italic">${text}</div>`;
  dd.style.display = 'block';
}

function onSiteInput(el, prefix = 'f') {
  const val = el.value.trim();
  const dd  = document.getElementById(`ac-${prefix}-site`);
  if (!dd) return;
  clearTimeout(_siteDebounce);
  _siteReqId++;
  if (val.length < 3) { dd.style.display = 'none'; return; }

  // Show history matches immediately — no network needed
  const hist = searchSiteHistory(val);
  if (hist.length) {
    dd.innerHTML = hist.map(h => renderHistoryItem(h, prefix)).join('') +
      `<div class="ac-section-sep">Also checking OpenStreetMap…</div>`;
    dd.style.display = 'block';
  } else {
    siteMsg(dd, 'Searching…');
  }

  // Nominatim works globally — no country/region required
  const _myReqId = _siteReqId;
  _siteDebounce = setTimeout(() => querySiteOSM(val, prefix, hist, _myReqId), 400);
}

// Only return results explicitly tagged as dive sites in OSM.
// Natural features are excluded — if a site isn't tagged, use GPS capture instead.
function _nomIsDiveSite(r) {
  const ext     = r.extratags || {};
  const sport   = (ext.sport   || '').toLowerCase();
  const leisure = (ext.leisure || '').toLowerCase();
  return sport.includes('scuba') || sport.includes('diving') ||
         leisure.includes('diving') || leisure.includes('dive');
}

async function querySiteOSM(name, prefix = 'f', hist = [], reqId = 0) {
  const dd = document.getElementById(`ac-${prefix}-site`);
  if (!dd) return;

  const country = (document.getElementById(`${prefix}-location`)?.value || '').trim();
  const region  = (document.getElementById(`${prefix}-region`)?.value  || '').trim();

  // Helper: render dropdown merging history + external results (labels are inline in extHtml)
  const renderMerged = (extHtml) => {
    const histHtml = hist.map(h => renderHistoryItem(h, prefix)).join('');
    if (histHtml || extHtml) {
      dd.innerHTML = histHtml + extHtml;
    } else {
      siteMsg(dd, 'No sites found — try a different spelling or enter coordinates manually');
      return;
    }
    dd.style.display = 'block';
  };

  // ── 1 + 2. Nominatim and Dive Vibe run in parallel ───────────────────────
  if (!hist.length) siteMsg(dd, 'Searching…');

  const histNamesWithCoords = new Set(
    hist.filter(h => h.lat != null).map(h => h.site.toLowerCase())
  );

  const [nomData, dvSites] = await Promise.all([
    // Nominatim: global, OSM-tagged dive sites only
    fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({
      q: name, format: 'json', limit: '10',
      'accept-language': 'en', addressdetails: '0', extratags: '1'
    })}`).then(r => r.json()).catch(() => []),
    // Dive Vibe: community database, requires country selection
    country ? queryDiveVibe(name, country, region) : Promise.resolve([])
  ]);

  // Filter Nominatim to dive sites only (dedup against history+DV happens below)
  const nomHits = nomData.filter(r => _nomIsDiveSite(r));

  // Render Dive Vibe hits first — deduplicate against history with coords only
  const dvHits = dvSites.filter(s => !histNamesWithCoords.has(s.name.toLowerCase()));
  const dvHtml = dvSites.length === 0 && !country ? '' :
    dvHits.slice(0, 6).map(s => {
      const ns  = s.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const lat = parseFloat(s.lat).toFixed(4);
      const lng = parseFloat(s.lng).toFixed(4);
      return `<div class="ac-item flex-between-baseline"
        onmousedown="pickSiteSuggestion('${esc(ns)}',${s.lat},${s.lng},'${prefix}','${esc(s.siteType||'')}')">
        <span class="flex-truncate">${esc(s.name)}</span>
        <span class="mono-dim-shrink0">${lat}, ${lng}</span>
      </div>`;
    }).join('');

  // Nominatim is the fallback — deduplicate against history + Dive Vibe results
  const shownNames = new Set([
    ...histNamesWithCoords,
    ...dvHits.map(s => s.name.toLowerCase())
  ]);
  const nomHitsFiltered = nomHits.filter(r =>
    !shownNames.has((r.name || r.display_name.split(',')[0]).trim().toLowerCase())
  );
  const nomHtmlFinal = nomHitsFiltered.slice(0, 6).map(r => {
    const n   = (r.name || r.display_name.split(',')[0]).trim();
    const ctx = r.display_name.split(',').slice(1, 3).join(',').trim();
    const lat = parseFloat(r.lat).toFixed(4);
    const lng = parseFloat(r.lon).toFixed(4);
    const ns  = n.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `<div class="ac-item" style="display:flex;flex-direction:column;gap:2px"
      onmousedown="pickSiteSuggestion('${esc(ns)}',${r.lat},${r.lon},'${prefix}')">
      <div class="flex-between-baseline">
        <span class="flex-truncate">${esc(n)}</span>
        <span class="mono-dim-shrink0">${lat}, ${lng}</span>
      </div>
      ${ctx ? `<div style="font-size: var(--font-size-xs);color:var(--text-dim)">${esc(ctx)}</div>` : ''}
    </div>`;
  }).join('');

  // Combine: Dive Vibe first, OpenStreetMap as fallback
  let extHtml = '';
  if (dvHtml)       extHtml += `<div class="ac-section-sep">Dive Vibe</div>`       + dvHtml;
  if (nomHtmlFinal) extHtml += `<div class="ac-section-sep">OpenStreetMap</div>`   + nomHtmlFinal;

  // ── 3. Overpass geographic search (bonus, only if bbox already cached) ───
  const key    = region ? `${region}, ${country}` : country;
  const cached = country ? _bboxCache[prefix + key] : null;
  if (cached && (cached.tight || region)) {
    try {
      const safe  = name.replace(/["\\/]/g, '');
      const a     = cached.area;
      const query = `[out:json][timeout:20];
(
node["sport"~"^(scuba_diving|diving)$"]["name"~"${safe}",i]${a};
node["leisure"~"^(dive_centre|diving)$"]["name"~"${safe}",i]${a};
way["sport"~"^(scuba_diving|diving)$"]["name"~"${safe}",i]${a};
way["leisure"~"^(dive_centre|diving)$"]["name"~"${safe}",i]${a};
);
out center;`;
      const resp = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query)
      });
      const data = await resp.json();
      const allShown = new Set([
        ...shownNames,
        ...nomHitsFiltered.map(r => (r.name || r.display_name.split(',')[0]).trim().toLowerCase())
      ]);
      const ovpHits = (data.elements || []).filter(e => {
        if (!e.tags?.name) return false;
        if (allShown.has(e.tags.name.toLowerCase())) return false;
        return e.lat != null || e.center?.lat != null;
      });
      if (ovpHits.length) {
        const ovpHtml = ovpHits.slice(0, 4).map(e => {
          const n    = e.tags.name;
          const eLat = e.lat ?? e.center?.lat;
          const eLng = e.lon ?? e.center?.lon;
          const ns   = n.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          return `<div class="ac-item flex-between-baseline"
            onmousedown="pickSiteSuggestion('${esc(ns)}',${eLat},${eLng},'${prefix}')">
            <span>${esc(n)}</span>
            <span class="mono-dim-shrink0">${parseFloat(eLat).toFixed(4)}, ${parseFloat(eLng).toFixed(4)}</span>
          </div>`;
        }).join('');
        extHtml += (extHtml ? `<div class="ac-section-sep">Also on OpenStreetMap</div>` : '') + ovpHtml;
      }
    } catch(e) { /* Overpass optional */ }
  }

  // Abort if a newer search or a site pick has invalidated this request
  if (_siteReqId !== reqId) return;
  renderMerged(extHtml);
}

// Map Dive Vibe siteType values to app dive type dropdown options
function _dvSiteTypeToEntry(t) {
  const map = {
    reef: 'Reef', wall: 'Wall', pinnacle: 'Pinnacle', muck: 'Muck',
    cave: 'Cave', wreck: 'Wreck', drift: 'Drift',
    artificial: 'Reef', artificial_reef: 'Reef'
  };
  return map[t] || '';
}

function pickSiteSuggestion(name, lat, lng, prefix = 'f', siteType = '') {
  // Cancel any pending debounce + invalidate any in-flight async search so the
  // dropdown won't reopen when querySiteOSM completes.
  clearTimeout(_siteDebounce);
  _siteReqId++;
  const siteEl  = document.getElementById(`${prefix}-site`);
  const dd      = document.getElementById(`ac-${prefix}-site`);
  if (siteEl) siteEl.value = name;
  if (dd) dd.style.display = 'none';
  document.getElementById(`${prefix}-gps-lat`).value = parseFloat(lat).toFixed(6);
  document.getElementById(`${prefix}-gps-lng`).value = parseFloat(lng).toFixed(6);
  setGpsStatus(`✓ ${name}`, true, prefix);
  // Fill dive type from Dive Vibe — always overwrite in edit modal, only fill if empty on new dive form
  if (siteType) {
    const entryEl = document.getElementById(`${prefix}-entry`);
    if (entryEl && (prefix === 'e' || !entryEl.value)) {
      const mapped = _dvSiteTypeToEntry(siteType);
      if (mapped) {
        entryEl.value = mapped;
        if (prefix === 'f') showAutoAnnot('divetype-auto-label');
      }
    }
  }
  // Move the in-form / in-modal pin to the chosen site + repaint type grid, geocode place
  if ((prefix === 'f' || prefix === 'e') && typeof lfSetPin === 'function') {
    lfSetPin(prefix, parseFloat(lat), parseFloat(lng), true);
  }
}

function siteKey(e, fieldId) {
  // Close dropdown on Escape
  if (e.key === 'Escape') document.getElementById('ac-' + fieldId).style.display = 'none';
}

function selectDiveSite(lat, lng, name, prefix = 'f') {
  pickSiteSuggestion(name, lat, lng, prefix);
}

function captureGPS(prefix = 'f') {
  if (!navigator.geolocation) { setGpsStatus('Geolocation not supported by your browser.', false, prefix); return; }
  const btn = document.getElementById(`${prefix}-gps-capture-btn`);
  const origHTML = btn ? btn.innerHTML : '';
  if (btn) { btn.innerHTML = 'Getting position…'; btn.disabled = true; }
  setGpsStatus('', null, prefix);
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      document.getElementById(`${prefix}-gps-lat`).value = lat;
      document.getElementById(`${prefix}-gps-lng`).value = lng;
      setGpsStatus(`✓ GPS captured — accuracy ±${Math.round(pos.coords.accuracy)} m`, true, prefix);
      if (btn) { btn.innerHTML = origHTML; btn.disabled = false; }
    },
    err => {
      setGpsStatus(`GPS failed: ${err.message}`, false, prefix);
      if (btn) { btn.innerHTML = origHTML; btn.disabled = false; }
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

function setGpsStatus(msg, ok, prefix = 'f') {
  const el = document.getElementById(`${prefix}-gps-status`);
  if (!el) return;
  el.textContent = msg;
  el.style.color = msg === '' ? '' : (ok ? 'var(--accent)' : 'var(--text-dim)');
}

// Bootstrap after all JS is defined
acBootstrap();

