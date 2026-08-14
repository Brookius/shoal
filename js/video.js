// Footage sidecar I/O — v2.33 / sources[] model — v2.34
// Per-dive *.footage.json stored alongside the dive .md in the Obsidian vault.
// Joins on dive.uid (never on filename). The MD parser is frozen as read-fallback;
// clips no longer flow through the MD writer from this version forward.
//
// Load order: after markdown.js + obsidian.js (needs OBS_BASE, obsSettings,
// obsHeaders, obsAvailable, syncMode, mintUid).

// "Match footage to dives" (js/footage-match.js's entry point) is built
// entirely on connectProxyFolder()'s native-folder-scan model, which has no
// Android equivalent by policy (BRIEF-play-store-readiness.md §2.2 — "Android
// uses picker + Drive," not folder scanning). Concretely confirmed broken,
// not just theoretically out of scope: connectProxyFolder()'s isShell()
// branch calls invoke('pick_folder', ...), which errors on Android, and that
// error is caught by `.catch(() => null)` and silently swallowed — tapping
// the button does nothing at all, the same failure shape as the original
// setDiveFolder() bug this whole Android effort started from. Hidden here
// rather than ported, since the underlying model was already decided not to
// carry over. The internal isShell() checks inside this feature's own
// functions (_scanProxyFolder, connectProxyFolder, etc.) are left as bare
// isShell() rather than renamed to isDesktopShell() — correct in spirit, but
// unreached on Android once this gate is in place, so not worth the churn
// right now; flagged in the brief as known-remaining cleanup.
// No DOMContentLoaded wrapper needed — this script tag loads right before
// </body>, after the whole document (including this element) has already
// been parsed; waiting for an event that may have already fired would just
// never run.
if (typeof isAndroidShell === 'function' && isAndroidShell()) {
  const section = document.getElementById('footage-match-section');
  if (section) section.style.display = 'none';
}

let _sidecars = new Map(); // Map<diveUid → {diveUid, videos, clips}>

function _sidecarPath(dive) {
  const folder   = (obsSettings.folder || 'Dives').replace(/\/$/, '');
  const basename = (dive._filename || '').replace(/\.md$/i, '');
  return basename ? folder + '/' + basename + '.footage.json' : '';
}

// Bare filename (no vault-folder prefix) — used by the folder-sync backend,
// whose directory handle already IS the dive folder.
function _sidecarFilename(dive) {
  const basename = (dive._filename || '').replace(/\.md$/i, '');
  return basename ? basename + '.footage.json' : '';
}

async function _loadOneSidecar(dive) {
  if (!dive.uid || !dive._filename) return null;
  const path = _sidecarPath(dive);
  if (!path) return null;
  try {
    const res = await fetch(OBS_BASE + '/vault/' + encodeURIComponent(path), {
      headers: obsJsonHeaders(),
      cache:   'no-store',
    });
    if (!res.ok) return null;
    const data = JSON.parse(await res.text());
    _sidecars.set(dive.uid, data);
    return data;
  } catch (e) {
    return null;
  }
}

// Load sidecars for all uid-bearing dives.
// Obsidian mode: REST API (called after syncFromObsidian).
// Folder mode: Tauri `read_text_file` in the desktop shell, else the File
// System Access handle in the browser (called after syncFromFolder).
async function loadAllSidecars(diveList) {
  _sidecars.clear();
  if (syncMode === 'obsidian') {
    if (!obsAvailable) return;
    // List the vault folder once and fetch only sidecars that exist. Blind
    // per-dive GETs logged an unsuppressable browser console 404 for every
    // dive without footage — noise that buries real errors (e.g. CSP
    // violations). Listing convention mirrors syncFromObsidian: the API
    // returns BARE filenames, matching _sidecarFilename().
    let existing = null; // null = listing failed → fall back to per-dive probing
    try {
      const folder  = (obsSettings.folder || 'Dives').replace(/\/$/, '');
      const listRes = await fetch(`${OBS_BASE}/vault/${encodeURIComponent(folder)}/`, {
        headers: obsJsonHeaders(), cache: 'no-store',
      });
      if (listRes.ok) {
        const listData = await listRes.json();
        existing = new Set((listData.files || []).filter(f => f.endsWith('.footage.json')));
      }
    } catch (e) { /* listing unavailable — probe per dive as before */ }
    for (const dive of diveList) {
      if (!dive.uid) continue;
      if (existing && !existing.has(_sidecarFilename(dive))) continue;
      await _loadOneSidecar(dive);
    }
    return;
  }
  if (syncMode === 'folder') {
    // Android shell: list the folder ONCE, then read only the sidecars that
    // actually exist — the same strategy the Obsidian branch above has always
    // used, and for the same reason. The per-dive probe this replaced was
    // measured at ~2 minutes to sync 94 dives from a Google Drive folder,
    // nearly all of it spent on resolve_file_uri calls that found nothing:
    // over a cloud DocumentsProvider a miss is a full network round trip, and
    // most dives have no footage sidecar at all. See android_list_filenames'
    // comment in src-tauri/src/androidfs.rs.
    //
    // A failed listing falls back to probing rather than returning early —
    // slow beats silently loading no footage.
    if (isAndroidShell()) {
      const folder = _androidFolder();
      if (!folder) return;
      const invoke = window.__TAURI__.core.invoke;
      let existing = null;
      try {
        existing = new Set(await invoke('android_list_filenames', { folder }));
      } catch (e) { /* listing unavailable — probe per dive as before */ }
      for (const dive of diveList) {
        if (!dive.uid || !dive._filename) continue;
        const name = _sidecarFilename(dive);
        if (!name) continue;
        if (existing && !existing.has(name)) continue;
        try {
          const text = await invoke('android_read_file', { folder, filename: name });
          _sidecars.set(dive.uid, JSON.parse(text));
        } catch (e) { /* no sidecar for this dive — fine */ }
      }
      return;
    }
    // Desktop shell: read each sidecar via the Rust fs command (no File System
    // Access API in the webview). Mirrors _writeSidecarToFolder's shell branch.
    if (isDesktopShell()) {
      const folder = localStorage.getItem('divelog-shell-vault-path');
      if (!folder) return;
      const invoke = window.__TAURI__.core.invoke;
      for (const dive of diveList) {
        if (!dive.uid || !dive._filename) continue;
        const name = _sidecarFilename(dive);
        if (!name) continue;
        try {
          const text = await invoke('read_text_file', { path: folder + '/' + name });
          _sidecars.set(dive.uid, JSON.parse(text));
        } catch (e) { /* no sidecar for this dive — fine */ }
      }
      return;
    }
    const handle = await getWritableFolderHandle();
    if (!handle) return;
    for (const dive of diveList) {
      if (!dive.uid || !dive._filename) continue;
      const name = _sidecarFilename(dive);
      if (!name) continue;
      try {
        const fh   = await handle.getFileHandle(name);
        const file = await fh.getFile();
        _sidecars.set(dive.uid, JSON.parse(await file.text()));
      } catch (e) { /* no sidecar for this dive — fine */ }
    }
  }
}

// Merge sidecar data into a dive's in-memory model.
// A key PRESENT in the sidecar overrides the MD-parsed clips for that species;
// a key ABSENT from the sidecar keeps whatever the MD fallback parsed — never
// wipe legacy clips just because the sidecar hasn't recorded that species yet
// (migrateLegacyFootage folds kept clips into the sidecar on the next write).
// Clips are stored with sources[] in the sidecar; we add a .video field back so
// all existing c.video references in footage.js / history.js continue to work.
function applySidecarToDive(dive) {
  if (!dive.uid) return;
  const s = _sidecars.get(dive.uid);
  if (!s) return;
  if (Array.isArray(s.videos)) dive.videos = s.videos;
  const clips = s.clips || {};
  for (const m of (dive.marine || [])) {
    const key = m.scientificName || m.customId || '';
    if (!Object.prototype.hasOwnProperty.call(clips, key)) continue;
    m.clips = (clips[key] || []).map(c => {
      const orig = (c.sources || []).find(src => src.role === 'original' && src.kind === 'local');
      return { ...c, video: orig ? orig.ref : (c.video || '') };
    });
  }
}

// Apply sidecars to every dive in the list (call after loadAllSidecars).
function applyAllSidecars(diveList) {
  for (const dive of diveList) applySidecarToDive(dive);
}

// Read-repair: any dive whose footage exists only in the MD / localStorage
// (legacy embed, or a sidecar that was lost/never written) gets its sidecar
// (re)created now — BEFORE any MD rewrite can strip the clips. Called from
// syncFromObsidian and syncFromFolder after applyAllSidecars. Self-healing:
// safe to run every load.
async function migrateLegacyFootage(diveList) {
  if (syncMode === 'obsidian' && !obsAvailable) return;
  if (syncMode !== 'obsidian' && syncMode !== 'folder') return;
  for (const dive of diveList) {
    const hasFootage = (dive.videos || []).length > 0 ||
      (dive.marine || []).some(m => Array.isArray(m.clips) && m.clips.length > 0);
    if (!hasFootage) continue;
    if (dive.uid && _sidecars.has(dive.uid)) continue; // sidecar already live
    const hadUid = !!dive.uid;
    const r = await writeSidecar(dive); // mints uid if missing
    if (r === 'ok') {
      console.log('[video] migrated legacy footage →',
        syncMode === 'folder' ? _sidecarFilename(dive) : _sidecarPath(dive));
      // Newly minted uid must reach the MD frontmatter — safe to rewrite now
      // that the sidecar is confirmed on disk.
      if (!hadUid) {
        if (syncMode === 'obsidian') pushToObsidian(dive).catch(() => {});
        else writeToFolder(dive).catch(() => {});
      }
    } else if (r === 'fail') {
      console.error('[video] legacy footage NOT migrated for', dive._filename,
        '— leaving MD untouched');
    }
  }
}

// Find the dive.videos[] entry a clip ref points at. Refs come in two shapes
// and always will: a bare filename (everything written before v2.982, plus
// drag-and-dropped files that have no folder context) and a root-qualified
// relative path (written by the auto-match flow from v2.982 on). Old sidecars
// are never rewritten, so both are permanently valid.
function _videoForRef(dive, ref) {
  const vids = dive.videos || [];
  if (!ref) return null;
  const norm = _normRel(ref);
  return vids.find(v => v.path && _normRel(v.path) === norm)
      || vids.find(v => v.file === ref)
      // Last resort: a path ref against a pre-v2.982 entry that has only a
      // filename (or vice versa). Stem-level, so ambiguous in exactly the way
      // this change removes elsewhere — but strictly better than no match.
      || vids.find(v => _fileStem(v.file) === _fileStem(ref))
      || null;
}

// Build sidecar payload from the current in-memory dive state.
// Migrates legacy {video,time,note} clips to {time,note,sources:[]} on write
// (write-forward migration — the old {video} key is the original source).
function buildSidecarData(dive) {
  const clips = {};
  for (const m of (dive.marine || [])) {
    const key = m.scientificName || m.customId || '';
    if (!key) continue;
    const raw = Array.isArray(m.clips) ? m.clips : [];
    const mClips = raw
      .filter(c => c.video || (c.sources && c.sources.length))
      .map(c => {
        let sources = (c.sources && c.sources.length) ? c.sources.slice() : [
          { role: 'original', kind: 'local', ref: c.video || '' },
        ];
        // Record the proxy source when the clip's video has a matched proxy
        // (write-forward — set in memory by _annotateProxies on folder grant)
        const orig = sources.find(s => s.role === 'original' && s.kind === 'local');
        // Match on EITHER form: a ref is a bare filename on everything written
        // before v2.982 and a root-qualified relative path after it, and both
        // shapes coexist indefinitely since old sidecars are never rewritten.
        const vid  = orig ? _videoForRef(dive, orig.ref) : null;
        // Upgrade the original's ref to the unambiguous path once we know it —
        // write-forward, same as the proxy field below. This is the ref a cloud
        // backend inherits, so it wants to be the exact one, not the stem.
        if (orig && vid && vid.path && orig.ref !== vid.path) {
          sources = sources.map(s => (s === orig ? { ...s, ref: vid.path } : s));
        }
        if (vid && vid.proxy && !sources.some(s => s.role === 'proxy' && s.kind === 'local')) {
          sources = [{ role: 'proxy', kind: 'local', ref: vid.proxy }, ...sources];
        }
        const out = { sources };
        if (c.time) out.time = c.time;
        if (c.note) out.note = c.note;
        return out;
      });
    if (mClips.length > 0) clips[key] = mClips;
  }
  return {
    diveUid: dive.uid,
    videos:  (dive.videos || []).slice(),
    clips,
  };
}

// Write the sidecar to the active backend (Obsidian vault or synced folder).
// Returns 'ok'   — written and verified;
//         'skip' — no sidecar backend for this mode (localStorage-only is fine);
//         'fail' — backend active but the write did NOT land. Callers must NOT
//                  rewrite the dive MD on 'fail': the MD writer strips clips,
//                  and for legacy dives the MD may hold the only copy.
// Mints a uid on the dive object if one is missing (so the sidecar has a join key).
async function writeSidecar(dive) {
  if (syncMode === 'folder') return _writeSidecarToFolder(dive);
  if (syncMode !== 'obsidian') return 'skip';
  if (!obsAvailable) {
    console.error('[video] sidecar write refused — Obsidian unavailable');
    return 'fail';
  }
  if (!dive.uid) dive.uid = mintUid();
  if (!dive._filename) return 'fail'; // no filename yet — push the MD first to mint one
  const path = _sidecarPath(dive);
  if (!path) return 'fail';
  const data = buildSidecarData(dive);
  try {
    const res = await fetch(OBS_BASE + '/vault/' + encodeURIComponent(path), {
      method:  'PUT',
      headers: obsHeaders('application/json'),
      body:    JSON.stringify(data, null, 2),
    });
    if (!res.ok) {
      console.error('[video] sidecar write failed: HTTP', res.status, path);
      return 'fail';
    }
    _sidecars.set(dive.uid, data); // cache only after the file is confirmed on disk
    return 'ok';
  } catch (e) {
    console.error('[video] sidecar write failed:', e);
    return 'fail';
  }
}

// Folder-sync backend: write the sidecar next to the dive .md via the granted
// directory handle. Same verification contract as the Obsidian path.
async function _writeSidecarToFolder(dive) {
  if (!dive.uid) dive.uid = mintUid();
  if (!dive._filename) dive._filename = canonicalFilename(dive);
  const name = _sidecarFilename(dive);
  if (!name) return 'fail';
  const data = buildSidecarData(dive);
  if (isAndroidShell()) {
    // SAF takes (folder, filename) — _sidecarFilename() already returns the
    // bare name for exactly this shape (it exists for the browser backend,
    // which has the same constraint). _sidecarPath()'s concatenated form is
    // desktop-only and would be meaningless against a content URI.
    const folder = _androidFolder();
    if (!folder) { console.error('[video] sidecar write refused — no Android folder'); return 'fail'; }
    try {
      await window.__TAURI__.core.invoke('android_write_file', { folder, filename: name, content: JSON.stringify(data, null, 2) });
      _sidecars.set(dive.uid, data);
      return 'ok';
    } catch (e) {
      console.error('[video] Android sidecar write failed:', name, e);
      if (typeof _isFolderPermissionError === 'function' && _isFolderPermissionError(e)) {
        _folderNeedsReconnect = true;
        renderSyncStatus();
      }
      return 'fail';
    }
  }
  if (isDesktopShell()) {
    const folder = localStorage.getItem('divelog-shell-vault-path');
    if (!folder) { console.error('[video] sidecar write refused — no shell vault path'); return 'fail'; }
    const path = folder + '/' + name;
    try {
      await window.__TAURI__.core.invoke('write_text_file', { path, content: JSON.stringify(data, null, 2) });
      _sidecars.set(dive.uid, data);
      return 'ok';
    } catch (e) {
      console.error('[video] shell sidecar write failed:', path, e);
      // Same lost-access-grant case writeToFolder handles — flag it so the
      // sync banner offers Reconnect rather than a Retry that can't succeed.
      if (typeof _isFolderPermissionError === 'function' && _isFolderPermissionError(e)) {
        _folderNeedsReconnect = true;
        renderSyncStatus();
      }
      return 'fail';
    }
  }
  const handle = await getWritableFolderHandle();
  if (!handle) {
    console.error('[video] sidecar write refused — folder permission not granted');
    return 'fail';
  }
  const ok = await writeFileInDir(handle, name, JSON.stringify(data, null, 2));
  if (ok) { _sidecars.set(dive.uid, data); return 'ok'; }
  console.error('[video] folder sidecar write failed:', name);
  return 'fail';
}

// ── Video URL resolver (seam for future cloud/proxy sources) ──────────────────
//
// resolveVideoUrl(clip, opts) → string | null
//   clip   — a clip object with sources[] (or a legacy {video} clip; returns null)
//   opts   — { prefer: 'proxy'|'original', allowKinds: ['local'] }
//
// Preference order: try preferred role first; fall back to the other role.
// Returns null when no reachable source exists (normal case until the proxies
// folder is granted in 2.38). Single choke point — cloud roles (r2, jellyfin)
// are added here in future phases, nowhere else.
//
function resolveVideoUrl(clip, opts) {
  const prefer     = (opts && opts.prefer)     || 'proxy';
  const allowKinds = (opts && opts.allowKinds) || ['local'];
  const sources    = Array.isArray(clip && clip.sources) ? clip.sources : [];
  if (!sources.length) return null;

  const roleOrder = prefer === 'proxy' ? ['proxy', 'original'] : ['original', 'proxy'];
  for (const role of roleOrder) {
    for (const src of sources) {
      if (src.role !== role || !allowKinds.includes(src.kind)) continue;
      if (src.kind === 'local') return _resolveLocalUrl(src.ref);
    }
  }
  return null;
}

// Returns an object URL for a file in the granted video folder.
//
// TWO lookups, in order, and the order is the whole point (v2.982):
//
//  1. **Relative path** — `Komodo-2026/dive-142/GX010128.MP4`. Unique by
//     construction, so it survives GoPro-style filename reuse across trips.
//     This is what every ref written from now on looks like, and it is the
//     identifier a cloud backend can reuse verbatim: a relative path inside a
//     Drive folder is the same string as a relative path inside a local one
//     (BRIEF-footage-cloud-hosting.md §2.3/§5).
//  2. **Filename stem** — every ref written before this change, plus any file
//     added with no path context (a loose drag-and-drop). Ambiguous by
//     construction (same name in two folders = last scan wins), which is
//     exactly why it stopped being the primary key — but it is what those
//     refs have always meant, so it stays as the read-fallback rather than
//     forcing a migration of anyone's existing sidecars. Same
//     backward-compatible read-fallback shape the sidecar already uses for
//     legacy nested-YAML clips.
//
// The stem step also still does real work for a path-keyed ref whose proxy
// lives elsewhere in the tree: "…/GX010128.MP4" finds "…/proxies/GX010128.mp4"
// because _proxyUrls' own tie-break prefers the proxy for a given stem.
function _resolveLocalUrl(ref) {
  if (!ref) return null;
  if (_proxyPathUrls.size) {
    const hit = _proxyPathUrls.get(_normRel(ref));
    if (hit) return hit.url;
  }
  if (!_proxyUrls.size) return null;
  const hit = _proxyUrls.get(_fileStem(ref));
  return hit ? hit.url : null;
}

// The absolute on-disk path behind a ref, when the shell knows one. Used only
// to explain WHY playback failed — never to play (that goes through the url
// above). Browser builds hold File objects with no absolute path, so this
// returns null there and callers fall back to a generic message.
function _localPathForRef(ref) {
  if (!ref) return null;
  const norm = _normRel(ref);
  let hit = _proxyEntries.find(e => _normRel(e.relPath || e.name) === norm);
  if (!hit) {
    const stem = _fileStem(ref);
    hit = _proxyEntries.find(e => _fileStem(e.name) === stem);
  }
  return (hit && hit.path) ? hit.path : null;
}

// macOS mounts every cloud file provider — Proton Drive, iCloud, Google Drive,
// Dropbox — under ~/Library/CloudStorage/<Provider>-<account>. A file there can
// be listed and still fail to READ: with the file set to online-only, the bytes
// live in the cloud until the provider's own app materialises them on access,
// and if that app isn't running nothing does. Tested 2026-07-29 against Proton
// (BRIEF-footage-cloud-hosting.md §2.3/§4.4): app running → plays after a brief
// stutter as it downloads; app closed → silently nothing at all. Silent is the
// part worth fixing — this app has repeatedly had to convert exactly that shape
// of dead end into an actionable message (folder-sync reconnect, footage-match
// write failures).
function cloudProviderNameForPath(p) {
  const m = /\/Library\/CloudStorage\/([^/@-]+)/.exec(p || '');
  return m ? m[1] : null;
}

// ── Delete the sidecar from the active backend and evict from cache.
// Silent fail if the file doesn't exist (expected for legacy dives with no footage).
// Mirrors deleteProfileSidecar (profile.js) — both delegate to the shared
// three-backend primitive rather than duplicating the obsidian/android/
// desktop/browser branching here.
async function deleteSidecar(dive) {
  if (dive.uid) _sidecars.delete(dive.uid);
  if (!dive._filename) return;
  await _deleteBackendFile(_sidecarFilename(dive));
}

// ── Proxies folder — v2.38 ────────────────────────────────────────────────────
// The user points the app at a folder of proxy re-encodes (File System Access,
// read-only). Files are matched to dive videos by filename stem; playback runs
// off object URLs. Handle persists in IndexedDB (same DB as the dive folder,
// key 'proxyFolder') but Chrome requires a user-gesture re-grant per session.

let _proxyDirHandle    = null;       // granted FileSystemDirectoryHandle (browser only)
// Stem-keyed, one winner per stem (proxy preferred). The LEGACY lookup — kept
// because every ref written before v2.982 is a bare filename. Also still the
// map that answers "how many videos can we see", so its dedup-by-stem count is
// deliberately unchanged.
let _proxyUrls         = new Map();  // stem (lowercase) → { name, relPath, url }
// Relative-path-keyed, one entry per actual file, no dedup. The PRIMARY lookup
// and the identifier cloud refs will reuse — see _resolveLocalUrl.
let _proxyPathUrls     = new Map();  // relPath (lowercase, '/'-separated) → { name, relPath, url }
let _proxyRestoreTried = false;
// Shell: proxy folders are stored as a JSON ARRAY of paths in localStorage —
// one per trip, since the generator drops a proxies/ folder inside each trip's
// originals folder. Read directly (NOT gated on isShell()): window.__TAURI__ may
// not be injected yet at module-parse time, which would wrongly drop the saved
// paths. localStorage is always available synchronously; in the browser these
// keys are never set. _loadShellProxyPaths migrates the old single-path key.
function _loadShellProxyPaths() {
  try {
    const arr = JSON.parse(localStorage.getItem('divelog-shell-proxy-paths') || 'null');
    if (Array.isArray(arr)) return arr.filter(Boolean);
  } catch (e) { /* fall through to legacy single-path key */ }
  const legacy = localStorage.getItem('divelog-shell-proxy-path');
  return legacy ? [legacy] : [];
}
function _saveShellProxyPaths() {
  localStorage.setItem('divelog-shell-proxy-paths', JSON.stringify(_shellProxyPaths));
}
let _shellProxyPaths = _loadShellProxyPaths();

const _VIDEO_EXTS = ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm'];

function _fileStem(name) {
  const base = (name || '').replace(/^.*[\\/]/, '');
  const i = base.lastIndexOf('.');
  return (i > 0 ? base.slice(0, i) : base).toLowerCase();
}

// Canonical form of a relative path used as a map key: backslashes folded to
// '/', any leading './' or '/' stripped, lowercased (macOS/Windows filesystems
// are case-insensitive, and a ref that differs only in case is the same file).
// Extension is KEPT — unlike _fileStem, this identifies one exact file.
function _normRel(p) {
  return (p || '').replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
}

// True when a ref is a relative path rather than a bare filename, i.e. written
// by v2.982+. Used to decide whether a ref can be trusted as unambiguous.
function _isPathRef(ref) {
  return (ref || '').replace(/\\/g, '/').includes('/');
}

function _isVideoFile(name) {
  const i = (name || '').lastIndexOf('.');
  return i > 0 && _VIDEO_EXTS.includes(name.slice(i + 1).toLowerCase());
}

// IDB persistence — reuses openFolderDB() from app.js (same store, own key)
async function _saveProxyHandle(handle) {
  if (isShell()) {
    // Shell: ADD the folder path to the remembered set (one proxies/ folder per
    // trip — don't overwrite). handle is a path string here.
    if (handle && !_shellProxyPaths.includes(handle)) _shellProxyPaths.push(handle);
    _saveShellProxyPaths();
    return;
  }
  const db = await openFolderDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'proxyFolder');
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

async function _loadProxyHandle() {
  if (isShell()) return _shellProxyPaths.length ? _shellProxyPaths : null; // shell uses the path array directly
  try {
    const db = await openFolderDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('proxyFolder');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  } catch { return null; }
}

// Revoke from the PATH map: it holds every url minted by the last scan, exactly
// once each. The stem map only ever holds a subset (one winner per stem) and
// shares its url objects, so walking that one instead would leak every file
// that lost its stem tie-break.
function _revokeProxyUrls() {
  for (const { url } of _proxyPathUrls.values()) URL.revokeObjectURL(url);
  _proxyPathUrls.clear();
  _proxyUrls.clear();
}

// Every video found by the last scan, undeduplicated — the raw list behind
// _proxyUrls. Kept because two consumers need different things from one walk:
// playback wants ONE entry per filename stem (preferring the proxy), while
// capture-time matching (js/footage-match.js) needs every original and must
// NOT see proxies at all — an ffmpeg re-encode stamps the proxy's mvhd with
// the ENCODE time, so matching off a proxy would place the dive on the day
// the proxies were generated.
// Entries: { name, relPath, url, isProxy, size, modified, path?, file? }
let _proxyEntries = [];

const _PROXY_SCAN_MAX_DEPTH = 8;

// A file living under a directory literally named "proxies" — the convention
// make-proxies.command and run_transcode both write into.
function _isProxyPath(relPath) {
  return (relPath || '').toLowerCase().split('/').slice(0, -1).includes('proxies');
}

// Recursively collect video files from a File System Access directory handle.
async function _walkProxyDir(handle, prefix, depth, out) {
  if (depth > _PROXY_SCAN_MAX_DEPTH) return;
  for await (const entry of handle.values()) {
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.kind === 'directory') {
      await _walkProxyDir(entry, rel, depth + 1, out);
      continue;
    }
    if (!_isVideoFile(entry.name)) continue;
    try {
      const file = await entry.getFile();
      out.push({ name: entry.name, relPath: rel, file, size: file.size, modified: file.lastModified });
    } catch (e) { /* unreadable file — skip */ }
  }
}

// Scan every connected folder RECURSIVELY and rebuild both maps.
//
// Recursion (2026-07-25) is what lets one connected trip folder cover footage
// filed into per-dive subfolders, so the folder used for capture-time matching
// and the one used for playback are the same folder. It does mean more files
// share the single stem-keyed namespace, so the long-documented "same filename
// in two places collides" caveat (DECISIONS.md) applies to more cases than
// before — with one deliberate tie-break added below, since recursion made a
// previously-impossible collision routine.
async function _scanProxyFolder() {
  _revokeProxyUrls();
  _proxyEntries = [];

  // relPath is ROOT-QUALIFIED — it starts with the connected folder's own name
  // ("Komodo-2026/dive-142/GX010128.MP4"), which the Rust side does NOT do
  // (it strips the scan root entirely). Necessary because the shell can have
  // SEVERAL folders connected at once ("Connect" adds, never replaces), and two
  // trip folders that each contain `dive-1/GX010128.MP4` would otherwise
  // produce byte-identical refs for different files — the same collision this
  // whole change exists to remove, just one level up. Qualifying in JS rather
  // than Rust also keeps the browser path (one root, via _walkProxyDir's
  // prefix) and the shell path producing the same shape.
  if (isShell()) {
    if (!_shellProxyPaths.length) return 0;
    for (const folder of _shellProxyPaths) {
      const rootName = (folder || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'videos';
      try {
        const files = await window.__TAURI__.core.invoke('scan_proxy_folder', { folder });
        for (const f of files) {
          _proxyEntries.push({
            name: f.name, relPath: rootName + '/' + (f.relPath || f.name), path: f.path,
            size: f.size, modified: f.modified,
          });
        }
      } catch (e) { console.warn('[video] shell video scan failed for', folder, e); }
    }
  } else if (_proxyDirHandle) {
    try {
      await _walkProxyDir(_proxyDirHandle, _proxyDirHandle.name || '', 0, _proxyEntries);
    } catch (e) {
      console.warn('[video] video folder scan failed:', e);
    }
  } else {
    return 0;
  }

  // Pick one winner per stem. THE TIE-BREAK MATTERS: scanning a trip root now
  // finds both `GX010128.MP4` and `proxies/GX010128.mp4`, which share a stem.
  // Without an explicit rule the winner would depend on directory walk order.
  // Prefer the proxy, matching resolveVideoUrl's own documented preference —
  // the proxy is the small, seek-friendly copy playback wants.
  //
  // The stem map is now the FALLBACK (legacy bare-filename refs); the path map
  // built alongside it is the primary lookup and needs no tie-break, because a
  // relative path already identifies exactly one file. One URL is minted per
  // file and shared by both maps, so the revoke bookkeeping stays 1:1 with the
  // object URLs actually created (see _revokeProxyUrls).
  const winners = new Map();
  for (const e of _proxyEntries) {
    e.isProxy = _isProxyPath(e.relPath);
    const stem = _fileStem(e.name);
    const prev = winners.get(stem);
    if (!prev || (e.isProxy && !prev.isProxy)) winners.set(stem, e);
  }
  // Mint at most ONE url per distinct relPath. The guard matters because
  // _revokeProxyUrls walks this map to release them — minting twice for a key
  // and storing only the second would leak the first. Duplicates here mean the
  // same folder is connected twice, so first-wins loses nothing real.
  for (const e of _proxyEntries) {
    const key = _normRel(e.relPath || e.name);
    const seen = _proxyPathUrls.get(key);
    if (seen) { e.url = seen.url; continue; }
    e.url = e.path
      ? window.__TAURI__.core.convertFileSrc(e.path)
      : URL.createObjectURL(e.file);
    _proxyPathUrls.set(key, { name: e.name, relPath: e.relPath, url: e.url });
  }
  for (const [stem, e] of winners) {
    _proxyUrls.set(stem, { name: e.name, relPath: e.relPath, url: e.url });
  }
  return _proxyUrls.size;
}

// Mark matched videos with their proxy ref (in-memory; sidecars pick it up
// on next write via buildSidecarData — write-forward, no bulk rewrite).
function _annotateProxies() {
  if (!_proxyUrls.size || typeof dives === 'undefined') return;
  for (const dive of dives) {
    for (const v of (dive.videos || [])) {
      // Stem lookup on purpose: the point is to find the PROXY of this video,
      // which lives at a different path (…/proxies/GX010128.mp4) and is only
      // related to it by stem. _proxyUrls' proxy-wins tie-break is what makes
      // that the proxy rather than the original.
      const hit = _proxyUrls.get(_fileStem(v.file));
      // Store the proxy's real root-qualified path when the scan knows it —
      // 'proxies/' + name was a guess at the layout that only happened to be
      // right when the proxies folder sat directly beside the originals.
      if (hit) v.proxy = hit.relPath || ('proxies/' + hit.name);
    }
  }
}

// Re-render the footage modal body if it is open (proxy state changed).
function _proxyUiRefresh() {
  if (typeof _footageDiveId === 'undefined' || _footageDiveId === null) return;
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive && typeof _renderFootageBody === 'function') _renderFootageBody(dive);
}

// User gesture: pick the proxies folder, persist, scan, match.
async function connectProxyFolder() {
  if (isShell()) {
    // Open where the LAST video folder was, not the dive vault — picking a
    // second trip's footage is the common repeat action here, and the vault is
    // usually nowhere near it. Falls back to the vault only on a first pick.
    // (An explicit default_path is mandatory regardless: macOS shares one
    // "last visited" directory across every picker in the app, so without it a
    // stray pick elsewhere silently decides where this one opens — see
    // pick_folder's Rust comment and DECISIONS.md.)
    const defaultPath = (_shellProxyPaths && _shellProxyPaths.length
      ? _shellProxyPaths[_shellProxyPaths.length - 1]
      : localStorage.getItem('divelog-shell-vault-path')) || undefined;
    const path = await window.__TAURI__.core.invoke('pick_folder', { title: 'Choose a video folder', defaultPath }).catch(() => null);
    if (!path) return;
    await _saveProxyHandle(path); // adds to the remembered proxy-folder set
    await _scanProxyFolder();
    _annotateProxies();
    _proxyUiRefresh();
    return;
  }
  if (!window.showDirectoryPicker) {
    showToast('Folder access needs Chrome or Edge (File System Access API).', { variant: 'error' });
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    _proxyDirHandle = handle;
    await _saveProxyHandle(handle);
    await _scanProxyFolder();
    _annotateProxies();
    _proxyUiRefresh();
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('[video] connectProxyFolder:', e);
  }
}

// Silent boot-time reconnect (index.html) — mirrors reconnectProxyFolder()'s
// shell branch exactly, EXCEPT it must never fall through to
// connectProxyFolder() when nothing is stored, unlike the user-gesture
// version above. That fallback opens a native folder-picker dialog, which
// is correct behaviour for a click on "Reconnect video folder" (nothing
// connected yet → may as well start the connect flow) and would be a
// jarring, unrequested dialog popping up on every single app launch here.
// Browser-only sessions have nothing to do (Chrome's File System Access
// permission grant doesn't survive a reload without a user gesture anyway —
// see the module comment at the top of this file — so there is no silent
// path there; the existing "Reconnect video folder" button stays the way in).
// Found live: _shellProxyPaths already persisted correctly across restarts,
// but nothing ever called _scanProxyFolder() at boot, so the proxy map
// stayed empty until the user manually reconnected every session — the
// same shape of bug syncFromFolder(false)'s own boot call was added to fix
// for the dive vault itself (see its comment, js/app.js/index.html).
async function autoReconnectProxyFolderOnBoot() {
  if (!isShell() || !_shellProxyPaths.length) return;
  await _scanProxyFolder();
  _annotateProxies();
  _proxyUiRefresh();
}

// User gesture: re-grant permission on the stored handle.
// Shell: no re-grant needed — just re-scan the stored path.
async function reconnectProxyFolder() {
  if (isShell()) {
    if (!_shellProxyPaths.length) return connectProxyFolder();
    await _scanProxyFolder();
    _annotateProxies();
    _proxyUiRefresh();
    return;
  }
  if (!_proxyDirHandle) return connectProxyFolder();
  try {
    const perm = await _proxyDirHandle.requestPermission({ mode: 'read' });
    if (perm !== 'granted') return;
    await _scanProxyFolder();
    _annotateProxies();
    _proxyUiRefresh();
  } catch (e) {
    connectProxyFolder();
  }
}

// On first footage open: silently reconnect if permission persisted.
// Returns 'connected' | 'stored' (handle saved, needs re-grant click) | 'none'.
async function restoreProxyFolder() {
  // Lazily re-read the saved paths (covers any module-load timing edge case).
  if (isShell() && !_shellProxyPaths.length) {
    _shellProxyPaths = _loadShellProxyPaths();
  }
  if (_proxyRestoreTried) {
    if (isShell()) return _proxyUrls.size ? 'connected' : (_shellProxyPaths.length ? 'stored' : 'none');
    return _proxyUrls.size ? 'connected' : (_proxyDirHandle ? 'stored' : 'none');
  }
  _proxyRestoreTried = true;
  if (isShell()) {
    if (!_shellProxyPaths.length) return 'none';
    await _scanProxyFolder();
    _annotateProxies();
    return _proxyUrls.size ? 'connected' : 'none';
  }
  const handle = await _loadProxyHandle();
  if (!handle) return 'none';
  _proxyDirHandle = handle;
  try {
    const q = await handle.queryPermission({ mode: 'read' });
    if (q === 'granted') {
      await _scanProxyFolder();
      _annotateProxies();
      if (_proxyUrls.size) return 'connected';
    }
  } catch (e) { /* fall through to stored */ }
  return 'stored';
}

function proxyStatus() {
  if (isShell()) {
    const nf = _shellProxyPaths.length;
    const fName = nf + ' folder' + (nf !== 1 ? 's' : '');
    if (_proxyUrls.size) return { state: 'connected', count: _proxyUrls.size, name: fName };
    if (nf)              return { state: 'stored',    count: 0, name: fName };
    return { state: 'none', count: 0, name: '' };
  }
  if (_proxyUrls.size) {
    return { state: 'connected', count: _proxyUrls.size, name: _proxyDirHandle ? _proxyDirHandle.name : '' };
  }
  if (_proxyDirHandle) return { state: 'stored', count: 0, name: _proxyDirHandle.name || '' };
  return { state: 'none', count: 0, name: '' };
}

// Proxy affordance row in the footage modal video-list footer.
function _proxyRowHtml() {
  if (isShell()) {
    const st = proxyStatus();
    let connect;
    if (st.state === 'connected') {
      connect = '<button class="proxy-btn on" onclick="connectProxyFolder()"'
        + ' title="Shoal plays videos from the folders you connect here. It can currently see '
        + st.count + ' across ' + esc(st.name) + '. Click to add another folder.">'
        + '🎞 Can see ' + st.count + ' videos · add folder</button>';
    } else if (st.state === 'stored') {
      connect = '<button class="proxy-btn" onclick="reconnectProxyFolder()"'
        + ' title="' + esc(st.name) + ' remembered from last time — click to re-scan it for videos.">'
        + '🎞 Re-scan video folder…</button>';
    } else {
      connect = '<button class="proxy-btn" onclick="connectProxyFolder()"'
        + ' title="Point Shoal at the folder your footage lives in so the videos above can play.">'
        + '🎞 Connect the folder your videos are in…</button>';
    }
    // "▶ Generate proxies…" removed 2026-07-25 — proxy generation is PARKED,
    // not deleted (DECISIONS.md → "Video proxies parked"). Originals play fine
    // in 4K, so proxies buy nothing today; transcodeProxies() below is kept
    // intact for the cloud-upload case that would justify them again.
    return '<div class="dm-proxy-row" id="transcode-row">' + connect + '</div>';
  }

  if (!window.showDirectoryPicker) {
    return '<div class="dm-proxy-row"><span class="proxy-hint">Video folders need Chrome/Edge</span></div>';
  }
  const st = proxyStatus();
  let main;
  if (st.state === 'connected') {
    main = '<button class="proxy-btn on" onclick="connectProxyFolder()"'
      + ' title="Shoal plays videos from this folder. It can currently see ' + st.count
      + '. Click to choose a different one.">'
      + '🎞 Can see ' + st.count + ' videos</button>';
  } else if (st.state === 'stored') {
    main = '<button class="proxy-btn" onclick="reconnectProxyFolder()"'
      + ' title="Re-grant access to: ' + st.name.replace(/"/g, '&quot;') + '">'
      + '🎞 Reconnect video folder…</button>';
  } else {
    main = '<button class="proxy-btn" onclick="connectProxyFolder()"'
      + ' title="Point Shoal at the folder your footage lives in so the videos above can play.">'
      + '🎞 Connect the folder your videos are in…</button>';
  }
  // The "📋 script" one-liner button is parked alongside the shell's Generate
  // button above — same reason, same code left in place.
  return '<div class="dm-proxy-row">' + main + '</div>';
}

// ── Proxy generation — PARKED 2026-07-25, code retained ──────────────────────
//
// Nothing calls transcodeProxies() any more: both entry points ("▶ Generate
// proxies…" in the shell, "📋 script" in the browser) were removed from
// _proxyRowHtml above, and `binaries/ffmpeg` was dropped from tauri.conf.json's
// externalBin so the shell no longer bundles a 21 MB encoder or compiles one at
// build time. Everything below still works and is deliberately left intact.
//
// Why parked rather than deleted: the ORIGINAL justification (4K masters choke
// decoders) was empirically falsified — originals play fine — but the storage
// half never was, and it becomes decisive the moment footage goes to cloud
// storage, where ~10-15 GB of proxies per trip vs ~300 GB of masters is what
// decides whether the feature works on a free tier at all. See
// BRIEF-footage-cloud-hosting.md §2.2 and DECISIONS.md.
//
// To un-park: restore the two buttons in _proxyRowHtml, re-add
// "binaries/ffmpeg" to externalBin and build-ffmpeg.sh to beforeBuildCommand.
// The Rust `run_transcode` command and src-tauri/build-ffmpeg.sh are untouched.
//
// ── Original notes ───────────────────────────────────────────────────────────
// In the browser this puts a curl|bash one-liner on the clipboard — piping
// avoids macOS Gatekeeper entirely (a downloaded .command arrives quarantined
// and without its exec bit, so double-click and even ./run are blocked).
// The script itself is the static /make-proxies.command at the site root.
// A future Tauri shell swaps this single function for a bundled-ffmpeg call;
// the app itself never transcodes (no backend; ffmpeg.wasm rejected).
async function transcodeProxies(btn) {
  if (!isShell()) {
    const cmd = 'curl -fsSL ' + location.origin + '/make-proxies.command | bash';
    const flip = ok => {
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = ok ? '✓ copied' : 'copy failed';
      setTimeout(() => { btn.textContent = orig; }, 2500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cmd).then(() => flip(true), () => {
        prompt('Copy this, then paste it in Terminal inside your originals folder:', cmd);
      });
    } else {
      prompt('Copy this, then paste it in Terminal inside your originals folder:', cmd);
    }
    return;
  }

  // Shell path — native ffmpeg sidecar. Progress lives in a global, always-on
  // widget appended to <body> (not the modal) so it survives closing the
  // footage modal — you can monitor/cancel a long batch from anywhere.
  const invoke = window.__TAURI__.core.invoke;
  const listen = window.__TAURI__.event.listen;

  if (window._tcCancelFn) return;   // a batch is already running

  const folder = await invoke('pick_video_folder').catch(() => null);
  if (!folder) return;

  _tcWidgetOpen();

  let cancelled = false;
  window._tcCancelFn = async () => {
    cancelled = true;
    const c = document.getElementById('tcw-cancel');
    if (c) { c.textContent = 'Cancelling…'; c.disabled = true; }
    await invoke('cancel_transcode').catch(() => {});
  };

  const unlisten = await listen('transcode:progress', ({ payload: p }) => {
    // Overall = whole-files done + fraction of the current file.
    const overall = p.total ? ((p.index - 1 + (p.pct || 0)) / p.total) * 100 : 0;
    _tcWidgetUpdate('File ' + p.index + ' of ' + p.total + ' · ' + p.name, overall);
  });

  let summary = { done: 0, skipped: 0, errors: 0 };
  try {
    summary = await invoke('run_transcode', { folder });
  } catch (e) {
    summary.errors = 1;
  } finally {
    unlisten();
    delete window._tcCancelFn;
  }

  _tcWidgetDone(cancelled, summary);
}

// ── Global transcode progress widget (persists across footage-modal open/close) ─
function _tcWidgetOpen() {
  let w = document.getElementById('tc-widget');
  if (!w) {
    w = document.createElement('div');
    w.id = 'tc-widget';
    w.className = 'theme-harbour';
    document.body.appendChild(w);
  }
  w.hidden = false;
  w.innerHTML =
      '<div class="tcw-head">'
    +   '<span class="tcw-title">Generating proxies…</span>'
    +   '<button class="tcw-cancel" id="tcw-cancel" onclick="cancelTranscode()" title="Cancel batch">✕</button>'
    + '</div>'
    + '<div class="tcw-name" id="tcw-name">Starting…</div>'
    + '<div class="tcw-bar"><div class="tcw-fill" id="tcw-fill" style="width:0%"></div></div>'
    + '<div class="tcw-meta"><span id="tcw-pct">0%</span></div>';
}

function _tcWidgetUpdate(name, overall) {
  const n = document.getElementById('tcw-name'); if (n) n.textContent = name;
  const f = document.getElementById('tcw-fill'); if (f) f.style.width = overall.toFixed(1) + '%';
  const p = document.getElementById('tcw-pct');  if (p) p.textContent = Math.round(overall) + '%';
}

function _tcWidgetDone(cancelled, summary) {
  const w = document.getElementById('tc-widget'); if (!w) return;
  if (!cancelled) { const f = document.getElementById('tcw-fill'); if (f) f.style.width = '100%'; }
  const title = w.querySelector('.tcw-title'); if (title) title.textContent = cancelled ? 'Cancelled' : 'Done';
  const c = document.getElementById('tcw-cancel'); if (c) c.remove();
  const n = document.getElementById('tcw-name');
  if (n) n.textContent = cancelled
    ? '✕ Stopped after ' + summary.done + ' prox' + (summary.done === 1 ? 'y' : 'ies')
    : '✓ ' + summary.done + ' prox' + (summary.done === 1 ? 'y' : 'ies') + ' written'
        + (summary.skipped ? ', ' + summary.skipped + ' skipped' : '')
        + (summary.errors ? ', ' + summary.errors + ' failed' : '');
  setTimeout(() => { const el = document.getElementById('tc-widget'); if (el) el.hidden = true; }, 6000);
}

function cancelTranscode() {
  if (window._tcCancelFn) window._tcCancelFn();
}
