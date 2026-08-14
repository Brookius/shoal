// Dive computer profile import (UDDF) — BRIEF-dive-profile-import.md
//
// Parses a .uddf export (from Dive Exporter / Subsurface / MacDive / vendor
// apps — this app never touches hardware/BLE, that's solved elsewhere by
// libdivecomputer-based tools), matches each dive it contains to an
// already-logged dive by physical signature (max depth + bottom time —
// clock-independent), and attaches the result as a
// <dive-basename>.profile.json sidecar, mirroring the footage sidecar
// (js/video.js) exactly. Scalars stay in the .md frontmatter as the summary
// layer; the profile is purely additive.
//
// Parser written from the UDDF 3.2 spec (uddf.org / streit.cc mirror), not
// from a reference implementation, per the brief's licence-clean instruction.
//
// Load order: after markdown.js + obsidian.js + app.js + video.js (needs
// OBS_BASE, obsHeaders, obsJsonHeaders, obsSettings, obsAvailable, syncMode,
// mintUid, canonicalFilename, _deleteBackendFile, isShell,
// getWritableFolderHandle, writeFileInDir, dives, esc, renderHistory).
// renderProfileChart() (Phase C) also needs calcSAC/sacClass (js/stats.js,
// loaded earlier in the SHELL order) — called from history.js's
// renderDiveDetail at call-time, so load order between profile.js and
// history.js itself doesn't matter.

let _profiles = new Map(); // Map<diveUid → profile object>

// ── Sidecar filename helpers (mirrors video.js's footage sidecar exactly) ──
function _profileSidecarPath(dive) {
  const folder   = (obsSettings.folder || 'Dives').replace(/\/$/, '');
  const basename = (dive._filename || '').replace(/\.md$/i, '');
  return basename ? folder + '/' + basename + '.profile.json' : '';
}
function _profileSidecarFilename(dive) {
  const basename = (dive._filename || '').replace(/\.md$/i, '');
  return basename ? basename + '.profile.json' : '';
}

// ── Load ─────────────────────────────────────────────────────────────────
async function _loadOneProfileSidecar(dive) {
  if (!dive.uid || !dive._filename) return null;
  const path = _profileSidecarPath(dive);
  if (!path) return null;
  try {
    const res = await fetch(OBS_BASE + '/vault/' + encodeURIComponent(path), {
      headers: obsJsonHeaders(), cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = JSON.parse(await res.text());
    _profiles.set(dive.uid, data);
    return data;
  } catch (e) { return null; }
}

// Load profile sidecars for all uid-bearing dives. Mirrors loadAllSidecars
// (video.js) — same listing-first strategy on Obsidian so a dive with no
// profile doesn't cost an unsuppressable 404.
async function loadAllProfileSidecars(diveList) {
  _profiles.clear();
  if (syncMode === 'obsidian') {
    if (!obsAvailable) return;
    let existing = null;
    try {
      const folder  = (obsSettings.folder || 'Dives').replace(/\/$/, '');
      const listRes = await fetch(`${OBS_BASE}/vault/${encodeURIComponent(folder)}/`, {
        headers: obsJsonHeaders(), cache: 'no-store',
      });
      if (listRes.ok) {
        const listData = await listRes.json();
        existing = new Set((listData.files || []).filter(f => f.endsWith('.profile.json')));
      }
    } catch (e) { /* listing unavailable — skip, no profiles loaded this session */ }
    for (const dive of diveList) {
      if (!dive.uid) continue;
      if (existing && !existing.has(_profileSidecarFilename(dive))) continue;
      await _loadOneProfileSidecar(dive);
    }
    return;
  }
  if (syncMode === 'folder') {
    // Android shell: list once, read only what exists — see the matching
    // comment in loadAllSidecars (js/video.js) for the measurement behind this.
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
        const name = _profileSidecarFilename(dive);
        if (!name) continue;
        if (existing && !existing.has(name)) continue;
        try {
          const text = await invoke('android_read_file', { folder, filename: name });
          _profiles.set(dive.uid, JSON.parse(text));
        } catch (e) { /* no profile for this dive — fine */ }
      }
      return;
    }
    if (isDesktopShell()) {
      const folder = localStorage.getItem('divelog-shell-vault-path');
      if (!folder) return;
      const invoke = window.__TAURI__.core.invoke;
      for (const dive of diveList) {
        if (!dive.uid || !dive._filename) continue;
        const name = _profileSidecarFilename(dive);
        if (!name) continue;
        try {
          const text = await invoke('read_text_file', { path: folder + '/' + name });
          _profiles.set(dive.uid, JSON.parse(text));
        } catch (e) { /* no profile for this dive — fine */ }
      }
      return;
    }
    const handle = await getWritableFolderHandle();
    if (!handle) return;
    for (const dive of diveList) {
      if (!dive.uid || !dive._filename) continue;
      const name = _profileSidecarFilename(dive);
      if (!name) continue;
      try {
        const fh   = await handle.getFileHandle(name);
        const file = await fh.getFile();
        _profiles.set(dive.uid, JSON.parse(await file.text()));
      } catch (e) { /* no profile for this dive — fine */ }
    }
  }
}

// ── Write / delete (mirrors writeSidecar / deleteSidecar, video.js) ────────
async function writeProfileSidecar(dive, profileData) {
  if (syncMode === 'folder') return _writeProfileSidecarToFolder(dive, profileData);
  if (syncMode !== 'obsidian') return 'skip';
  if (!obsAvailable) return 'fail';
  if (!dive.uid) dive.uid = mintUid();
  if (!dive._filename) return 'fail';
  const path = _profileSidecarPath(dive);
  if (!path) return 'fail';
  try {
    const res = await fetch(OBS_BASE + '/vault/' + encodeURIComponent(path), {
      method:  'PUT',
      headers: obsHeaders('application/json'),
      body:    JSON.stringify(profileData, null, 2),
    });
    if (!res.ok) return 'fail';
    _profiles.set(dive.uid, profileData);
    return 'ok';
  } catch (e) { return 'fail'; }
}

async function _writeProfileSidecarToFolder(dive, profileData) {
  if (!dive.uid) dive.uid = mintUid();
  if (!dive._filename) dive._filename = canonicalFilename(dive);
  const name = _profileSidecarFilename(dive);
  if (!name) return 'fail';
  if (isAndroidShell()) {
    // (folder, filename) rather than a concatenated path — see the equivalent
    // branch in js/video.js's _writeSidecarToFolder.
    const folder = _androidFolder();
    if (!folder) return 'fail';
    try {
      await window.__TAURI__.core.invoke('android_write_file', { folder, filename: name, content: JSON.stringify(profileData, null, 2) });
      _profiles.set(dive.uid, profileData);
      return 'ok';
    } catch (e) { return 'fail'; }
  }
  if (isDesktopShell()) {
    const folder = localStorage.getItem('divelog-shell-vault-path');
    if (!folder) return 'fail';
    try {
      await window.__TAURI__.core.invoke('write_text_file', { path: folder + '/' + name, content: JSON.stringify(profileData, null, 2) });
      _profiles.set(dive.uid, profileData);
      return 'ok';
    } catch (e) { return 'fail'; }
  }
  const handle = await getWritableFolderHandle();
  if (!handle) return 'fail';
  const ok = await writeFileInDir(handle, name, JSON.stringify(profileData, null, 2));
  if (ok) { _profiles.set(dive.uid, profileData); return 'ok'; }
  return 'fail';
}

async function deleteProfileSidecar(dive) {
  if (dive.uid) _profiles.delete(dive.uid);
  if (!dive._filename) return;
  await _deleteBackendFile(_profileSidecarFilename(dive));
}

// ═══════════════════════════════════════════════════════════════════════════
// UDDF parsing
// ═══════════════════════════════════════════════════════════════════════════

const MAX_UDDF_BYTES = 20 * 1024 * 1024; // generous — even a week-long liveaboard export is a few hundred KB

// Namespace-agnostic element helpers. Some UDDF exporters declare a default
// xmlns, some don't; walking by localName (which strips any prefix/namespace
// automatically) works correctly either way, so the parser doesn't have to
// guess which convention a given tool used.
function _localName(el) { return (el && el.localName) || ''; }
function _firstEl(parent, name) {
  if (!parent) return null;
  for (const child of parent.children) if (_localName(child) === name) return child;
  return null;
}
function _allEls(parent, name) {
  const out = [];
  if (!parent) return out;
  for (const child of parent.children) if (_localName(child) === name) out.push(child);
  return out;
}
// Descendant (not just direct-child) search — used only where real files are
// known to nest inconsistently, e.g. some exporters put <latitude>/<longitude>
// directly under <geography> per spec, others wrap them in an extra <gps>
// element that isn't part of UDDF 3.2 at all. _firstEl/_allEls stay
// direct-children-only everywhere else, since the dive/waypoint/sample
// structure itself is reliably nested per spec.
function _findDescendant(root, name) {
  if (!root) return null;
  for (const child of root.children) {
    if (_localName(child) === name) return child;
    const found = _findDescendant(child, name);
    if (found) return found;
  }
  return null;
}
function _elText(el) { return el ? (el.textContent || '').trim() : ''; }
function _elNum(el) {
  const t = _elText(el);
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

// UDDF temperatures are specified as Kelvin (confirmed against the official
// spec, with real examples: 283.15 = 10°C, 278.15 = 5°C). Some exporters
// don't follow that and write plain Celsius instead — a raw 26.5 treated as
// Kelvin gives -246.6°C, a physically impossible reading that should never
// reach the screen regardless of whose fault the mismatch is. Try the
// spec-correct interpretation first; only fall back to "already Celsius" if
// that's implausible for dive water. If neither is plausible, omit rather
// than guess (same "never a wrong value" rule as _parseUddfDate).
const _PLAUSIBLE_TEMP_MIN = -4, _PLAUSIBLE_TEMP_MAX = 40; // polar ice-diving through the warmest tropical shallows, with margin
function _resolveWaypointTemp(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const asKelvin = +(raw - 273.15).toFixed(1);
  if (asKelvin >= _PLAUSIBLE_TEMP_MIN && asKelvin <= _PLAUSIBLE_TEMP_MAX) return asKelvin;
  const asCelsius = +raw.toFixed(1);
  if (asCelsius >= _PLAUSIBLE_TEMP_MIN && asCelsius <= _PLAUSIBLE_TEMP_MAX) return asCelsius;
  return null;
}

// UDDF datetimes are ISO 8601, but computers are inconsistent about local vs
// UTC and about including seconds/timezone. Parse leniently; return null
// (never a guess) on anything unparseable — this field is corroborating-only
// for matching (brief §4), so a null here just drops out of the match score
// instead of contributing a wrong one.
function _parseUddfDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Cap sample density at ~1 point / 10s so a long or tech-diver-dense dive
// doesn't balloon the sidecar or (once Phase C lands) the chart's path data.
// A no-op for typical recreational-computer exports, which already sample
// every 10-30s.
function _downsampleWaypoints(waypoints, minIntervalSec = 10) {
  if (waypoints.length < 3) return waypoints;
  const out = [waypoints[0]];
  let lastT = waypoints[0].t;
  for (let i = 1; i < waypoints.length - 1; i++) {
    if (waypoints[i].t - lastT >= minIntervalSec) { out.push(waypoints[i]); lastT = waypoints[i].t; }
  }
  out.push(waypoints[waypoints.length - 1]); // always keep the final point
  return out;
}

// Site GPS lookup — UDDF stores coordinates on a separate top-level <site>
// entry (<divesite><site id="…"><geography><latitude>/<longitude>), not on
// the dive itself; a <dive> references one generically via
// <informationbeforedive><link ref="…">, the same <link> element UDDF also
// uses for buddy references — so a ref only counts as a site if it actually
// resolves in this map, never assumed by position. Opportunistic: most
// recreational dive computers have no GPS hardware, so this data usually
// comes from the exporting software's own site database, if any, and is
// commonly absent — see DECISIONS.md → "Dive computer profile import".
function _parseSiteLookup(root) {
  const lookup = new Map(); // site id → { lat, lng, name }
  const divesiteEl = _firstEl(root, 'divesite');
  if (!divesiteEl) return lookup;

  const addSite = (siteEl) => {
    const id = siteEl.getAttribute('id');
    if (!id) return;
    const geoEl = _firstEl(siteEl, 'geography');
    const lat = _elNum(_findDescendant(geoEl, 'latitude'));
    const lng = _elNum(_findDescendant(geoEl, 'longitude'));
    if (lat == null || lng == null) return;
    const name = _elText(_firstEl(siteEl, 'name')) || (geoEl ? _elText(_findDescendant(geoEl, 'location')) : '');
    lookup.set(id, { lat, lng, name });
  };

  // Spec structure: <divesite> is a container of one or more <site id="…">
  // entries. Try this first.
  for (const siteEl of _allEls(divesiteEl, 'site')) addSite(siteEl);

  // Some exporters flatten this entirely: <divesite id="…"> IS the single
  // site, with <geography> as its own direct child rather than nested under
  // a <site> wrapper. Only reached if the spec structure yielded nothing —
  // a spec-correct <divesite> container has no id of its own, so an id
  // directly on <divesite> is itself a signal this file uses the flattened
  // convention.
  if (!lookup.size) addSite(divesiteEl);

  return lookup;
}

// Gas mix lookup — <gasdefinitions><mix id="…"><o2>/<he> — referenced from
// <tankdata> and from waypoint <switchmix> the same way sites are referenced
// from dives: by id, resolved through this map, never assumed by position.
function _parseGasLookup(root) {
  const lookup = new Map(); // mix id → { o2, he }
  const gasdefEl = _firstEl(root, 'gasdefinitions');
  if (!gasdefEl) return lookup;
  for (const mixEl of _allEls(gasdefEl, 'mix')) {
    const id = mixEl.getAttribute('id');
    if (!id) continue;
    lookup.set(id, {
      o2: _elNum(_firstEl(mixEl, 'o2')),
      he: _elNum(_firstEl(mixEl, 'he')),
    });
  }
  return lookup;
}

// Map a gas mix's O2/He fractions onto Shoal's fixed gas vocabulary (the
// f-gas select only offers Air / Nitrox 29-35 / Trimix / Other — a diver
// picks from that list, so a parsed mix has to snap to it, not report an
// arbitrary percentage). Any helium content is Trimix regardless of O2 —
// this app's persona doesn't distinguish trimix blends further (same
// exclusion as tech-diver instrumentation elsewhere in the brief).
function _gasMixLabel(mix) {
  if (!mix || mix.o2 == null) return null;
  const o2pct = Math.round(mix.o2 * 100);
  const hePct = Math.round((mix.he || 0) * 100);
  if (hePct > 0) return 'Trimix';
  if (o2pct >= 20 && o2pct <= 22) return 'Air';
  if (o2pct >= 29 && o2pct <= 35) return `Nitrox ${o2pct}`;
  return 'Other'; // pure-O2 deco gas, or an O2% outside the fixed nitrox range
}

// Parse one <dive> element into { maxDepth, duration, startedAt, waypoints,
// events, gpsLat, gpsLng, siteName, gas, tanksize, pstart, pend }.
// maxDepth/duration are the PRIMARY match keys (brief §4) — sourced from
// <greatestdepth>/<diveduration> when present, else derived from the
// waypoints themselves, so they stay reliable even when the file's own
// clock is wrong (a real dive history had a computer's clock reset during
// a period of inactivity while depth/time stayed accurate).
function _parseOneDive(diveEl, siteLookup, gasLookup) {
  const beforeEl  = _firstEl(diveEl, 'informationbeforedive');
  const afterEl   = _firstEl(diveEl, 'informationafterdive');
  const samplesEl = _firstEl(diveEl, 'samples');

  const waypoints = [];
  const events = [];
  for (const wp of (samplesEl ? _allEls(samplesEl, 'waypoint') : [])) {
    const t = _elNum(_firstEl(wp, 'divetime'));
    const d = _elNum(_firstEl(wp, 'depth'));
    if (t == null || d == null) continue; // both required by spec — skip anything malformed
    const point = { t: Math.round(t), d: +Math.max(0, d).toFixed(1) };
    const c = _resolveWaypointTemp(_elNum(_firstEl(wp, 'temperature')));
    if (c != null) point.temp = c;
    // <nodecotime> — computer-calculated no-decompression time remaining, in
    // seconds (spec-confirmed). Feeds the chart's NDL-headroom colour cue
    // (Phase C) — not every computer/exporter emits it per-sample (checked
    // against real files: present in a rebreather export, absent from a real
    // Subsurface trimix file), so this is opportunistic like GPS, not assumed.
    const nd = _elNum(_firstEl(wp, 'nodecotime'));
    if (nd != null) point.ndl = +(nd / 60).toFixed(1);
    waypoints.push(point);

    // <decostop kind="safety|mandatory" decodepth="…" duration="…"/> — a
    // structured, reliable signal for the safety-stop phase (far better than
    // parsing free-text alarm strings, which the spec doesn't standardise).
    for (const stopEl of _allEls(wp, 'decostop')) {
      const kind = stopEl.getAttribute('kind') || 'mandatory';
      events.push({
        t: point.t,
        type: kind === 'safety' ? 'safetystop' : 'decostop',
        depth: parseFloat(stopEl.getAttribute('decodepth')) || point.d,
      });
    }
    for (const switchEl of _allEls(wp, 'switchmix')) {
      const ref = switchEl.getAttribute('ref');
      if (ref) events.push({ t: point.t, type: 'gasswitch', gas: ref });
    }
  }
  if (!waypoints.length) return null;
  waypoints.sort((a, b) => a.t - b.t);

  const sampledMax      = waypoints.reduce((m, p) => Math.max(m, p.d), 0);
  const sampledDuration = waypoints[waypoints.length - 1].t;
  const specMax      = _elNum(_firstEl(afterEl, 'greatestdepth'));
  const specDuration = _elNum(_firstEl(afterEl, 'diveduration'));

  let gpsLat = null, gpsLng = null, siteName = '';
  if (beforeEl && siteLookup && siteLookup.size) {
    for (const linkEl of _allEls(beforeEl, 'link')) {
      const site = siteLookup.get(linkEl.getAttribute('ref'));
      if (site) { gpsLat = site.lat; gpsLng = site.lng; siteName = site.name; break; }
    }
    // No <link> resolved a site — some exporters define a <divesite> without
    // ever referencing it from the dive at all. If the file only defines ONE
    // site in total, there's no ambiguity to guess wrong (it can only be that
    // one); with two or more and no link, stay unresolved rather than risk
    // attaching the wrong location — a wrong GPS pin is worse than no pin
    // (DECISIONS.md — "resolved by ID lookup, not by position").
    if (gpsLat == null && siteLookup.size === 1) {
      const onlySite = siteLookup.values().next().value;
      gpsLat = onlySite.lat; gpsLng = onlySite.lng; siteName = onlySite.name;
    }
  }

  // Tanks — <tankdata> is a direct child of <dive> (one per cylinder carried,
  // sibling to <informationbeforedive>/<samples>), each linking a gas mix and
  // carrying its own volume + start/end pressure. Shoal tracks one tank per
  // dive (this app's persona doesn't do multi-cylinder tech diving), so a
  // multi-tank file collapses to whichever tank was in use at the start of
  // the dive — the back/bottom gas by convention — falling back to the
  // first <tankdata> if the dive never explicitly switches gas at all.
  let gas = null, tanksize = null, pstart = null, pend = null;
  if (gasLookup && gasLookup.size) {
    const tankDatas = _allEls(diveEl, 'tankdata').map(tEl => {
      const linkEl  = _firstEl(tEl, 'link');
      const volM3   = _elNum(_firstEl(tEl, 'tankvolume'));
      const pBegin  = _elNum(_firstEl(tEl, 'tankpressurebegin'));
      const pEnd    = _elNum(_firstEl(tEl, 'tankpressureend'));
      return {
        gasRef:   linkEl ? linkEl.getAttribute('ref') : null,
        liters:   volM3  != null ? +(volM3 * 1000).toFixed(1) : null,   // m³ → L
        startBar: pBegin != null ? Math.round(pBegin / 100000) : null,  // Pa → bar
        endBar:   pEnd   != null ? Math.round(pEnd   / 100000) : null,
      };
    });
    if (tankDatas.length) {
      const firstSwitch = events.find(e => e.type === 'gasswitch');
      const primary = (firstSwitch && tankDatas.find(t => t.gasRef === firstSwitch.gas)) || tankDatas[0];
      if (primary.gasRef) gas = _gasMixLabel(gasLookup.get(primary.gasRef));
      tanksize = primary.liters;
      pstart   = primary.startBar;
      pend     = primary.endBar;
    }
  }

  return {
    maxDepth:  +((specMax != null ? specMax : sampledMax)).toFixed(1),
    duration:  Math.round(specDuration != null ? specDuration : sampledDuration),
    startedAt: _parseUddfDate(_elText(_firstEl(beforeEl, 'datetime'))),
    // <divenumber> — the exporting software's own numbering. Opportunistic
    // like GPS; only used to prefill the bulk-import start number.
    divenumber: _elNum(_firstEl(beforeEl, 'divenumber')),
    waypoints: _downsampleWaypoints(waypoints),
    events, gpsLat, gpsLng, siteName, gas, tanksize, pstart, pend,
  };
}

// Parse a full UDDF document. Returns { generatorName, dives: [...] } — one
// entry per <dive> found, in file order (dives[i]._seq preserves that order
// for the batch-import chronological tiebreaker, brief §4).
function parseUddf(xmlText) {
  if (!xmlText || xmlText.length > MAX_UDDF_BYTES) {
    throw new Error('File is empty or too large to be a dive export');
  }
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Not a valid XML file');
  const root = doc.documentElement;
  if (_localName(root) !== 'uddf') throw new Error('Not a UDDF file');

  const generatorEl   = _firstEl(root, 'generator');
  const generatorName = generatorEl ? _elText(_firstEl(generatorEl, 'name')) : '';
  const siteLookup    = _parseSiteLookup(root);
  const gasLookup     = _parseGasLookup(root);

  const dives = [];
  const profiledataEl = _firstEl(root, 'profiledata');
  for (const repEl of _allEls(profiledataEl, 'repetitiongroup')) {
    for (const diveEl of _allEls(repEl, 'dive')) {
      const parsed = _parseOneDive(diveEl, siteLookup, gasLookup);
      if (parsed) dives.push(parsed);
    }
  }
  if (!dives.length) throw new Error('No dive profiles found in this file');
  dives.forEach((d, i) => { d._seq = i; d.computer = generatorName; });
  return { generatorName, dives };
}

// ═══════════════════════════════════════════════════════════════════════════
// Matching a parsed UDDF dive to an already-logged dive (brief §4)
// ═══════════════════════════════════════════════════════════════════════════
// Physical signature first, clock second: depth + bottom time are true
// regardless of the computer's clock. Date/time only corroborates a match —
// it never vetoes one.

const MATCH_DEPTH_TOL   = 2;                 // metres — logged values are user-rounded
const MATCH_TIME_TOL    = 180;               // seconds (3 min) — same reason
const MATCH_DATE_TOL_MS = 24 * 3600 * 1000;  // loose — corroborating only

// Depth+time alone (no date corroboration) tops out at 0.8, so these two
// thresholds are deliberately different, not just tuning: when a runner-up
// exists, 0.75+margin guards against picking the wrong one of two similar
// dives. When nothing else is even in the running, there's no wrong pick to
// guard against — requiring the same high bar there just adds needless
// confirm-clicks for the common single-candidate case, so it gets a lower one.
const AUTO_ATTACH_SCORE      = 0.75;  // with a runner-up: needs this on its own...
const AUTO_ATTACH_MARGIN     = 0.15;  // ...and this much clear air over it
const AUTO_ATTACH_SCORE_SOLO = 0.55;  // no runner-up at all: a decent physical match is enough

function _matchScore(parsed, logged) {
  if (parsed.maxDepth == null || parsed.duration == null) return 0;
  if (logged.depth == null || logged.time == null) return 0;

  const loggedDurationSec = logged.time * 60; // logged.time is stored in minutes
  const depthDiff = Math.abs(parsed.maxDepth - logged.depth);
  const timeDiff  = Math.abs(parsed.duration - loggedDurationSec);
  const depthCap  = MATCH_DEPTH_TOL * 3;
  const timeCap   = MATCH_TIME_TOL  * 3;
  if (depthDiff > depthCap || timeDiff > timeCap) return 0; // not even in the running

  let score = 0.4 * Math.max(0, 1 - depthDiff / depthCap)
            + 0.4 * Math.max(0, 1 - timeDiff  / timeCap);

  if (parsed.startedAt && logged.date) {
    const loggedMs = new Date(logged.date + 'T' + (logged.entrytime || '00:00')).getTime();
    const parsedMs = new Date(parsed.startedAt).getTime();
    if (Number.isFinite(loggedMs) && Number.isFinite(parsedMs)) {
      const dateDiff = Math.abs(parsedMs - loggedMs);
      if (dateDiff <= MATCH_DATE_TOL_MS) score += 0.2 * (1 - dateDiff / MATCH_DATE_TOL_MS);
    }
  }
  return score;
}

// Rank every candidate logged dive against one parsed UDDF dive, best first.
// excludeIds lets a batch import skip dives already claimed by an
// earlier-in-file parsed dive in the same import — the chronological
// tiebreaker (brief §4).
function rankMatches(parsed, loggedDives, excludeIds) {
  const excl = excludeIds || new Set();
  return loggedDives
    .filter(d => !excl.has(d.id))
    .map(dive => ({ dive, score: _matchScore(parsed, dive) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

// Auto-attach when the top match is either the *only* plausible candidate
// (a decent physical match is enough — nothing else to confuse it with) or
// clearly ahead of a runner-up (high score AND separation, so two similar
// dives — ~18m/45min — don't silently pick the wrong one).
function matchToLoggedDive(parsed, loggedDives, excludeIds) {
  const ranked = rankMatches(parsed, loggedDives, excludeIds);
  if (!ranked.length) return { auto: null, ranked: [] };
  const [top, runnerUp] = ranked;
  let auto = null;
  if (!runnerUp) {
    auto = top.score >= AUTO_ATTACH_SCORE_SOLO ? top.dive : null;
  } else {
    const marginOk = (top.score - runnerUp.score) >= AUTO_ATTACH_MARGIN;
    auto = (top.score >= AUTO_ATTACH_SCORE && marginOk) ? top.dive : null;
  }
  return { auto, ranked };
}

// ═══════════════════════════════════════════════════════════════════════════
// Import flow — file picker → parse → match → attach → lean review for the rest
// ═══════════════════════════════════════════════════════════════════════════

let _pendingProfileReview = []; // [{ parsed, ranked, sourceLabel }] — awaiting a manual pick

function _profileToSidecarData(dive, parsed, sourceLabel) {
  return {
    diveUid:   dive.uid,
    source:    'uddf',
    computer:  parsed.computer || sourceLabel || '',
    startedAt: parsed.startedAt,
    waypoints: parsed.waypoints,
    events:    parsed.events,
    imported:  new Date().toISOString().slice(0, 10),
  };
}

async function _attachProfile(dive, parsed, sourceLabel) {
  if (!dive.uid) dive.uid = mintUid();
  const data = _profileToSidecarData(dive, parsed, sourceLabel);
  const result = await writeProfileSidecar(dive, data);
  if (result === 'ok') localStorage.setItem('divelog-dives', JSON.stringify(dives));
  return result;
}

// Entry point — wired to the .uddf file picker in Settings & data.
async function importUddfFile(fileList) {
  const statusEl = document.getElementById('profile-import-status');
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (statusEl) statusEl.textContent = 'Reading…';

  let attached = 0, ambiguous = 0, skipped = 0, failed = 0;
  const claimed = new Set(); // dive.id values already matched within this import batch
  _pendingProfileReview = [];

  for (const file of files) {
    let text;
    try { text = await file.text(); } catch (e) { failed++; continue; }
    let parsedFile;
    try { parsedFile = parseUddf(text); }
    catch (e) {
      failed++;
      if (statusEl) statusEl.textContent = `${file.name}: ${e.message}`;
      continue;
    }
    // File order is chronological; processing in that order and excluding
    // already-claimed dives is the batch tiebreaker (brief §4) — later
    // dives in the file naturally prefer later logged dives once earlier
    // ones have matched.
    for (const parsed of parsedFile.dives) {
      const { auto, ranked } = matchToLoggedDive(parsed, dives, claimed);
      if (auto) {
        claimed.add(auto.id);
        const result = await _attachProfile(auto, parsed, parsedFile.generatorName);
        if (result === 'ok') attached++; else failed++;
      } else if (ranked.length) {
        ambiguous++;
        _pendingProfileReview.push({ parsed, ranked: ranked.slice(0, 3), sourceLabel: parsedFile.generatorName });
      } else {
        skipped++;
      }
    }
  }

  _renderProfileReviewList();
  if (statusEl) {
    const parts = [];
    if (attached)  parts.push(`${attached} attached`);
    if (ambiguous) parts.push(`${ambiguous} need review below`);
    if (skipped)   parts.push(`${skipped} no match in your logged dives — log it first, or import from the Log a dive page to start a new entry`);
    if (failed)    parts.push(`${failed} failed`);
    statusEl.textContent = parts.length ? parts.join(' · ') : 'Nothing to import';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Log-a-dive quick import — start a NEW entry pre-filled from a profile
// ═══════════════════════════════════════════════════════════════════════════
// Distinct from importUddfFile (Settings & data) above: that flow only ever
// ATTACHES a profile to a dive you've already logged by hand. This one tries
// the same match-against-existing-dives pass first (so it never creates a
// duplicate of a dive you already logged), and only for whatever's left over
// — no existing match at all — offers to pre-fill the log form as a new
// entry. Both flows share the one _pendingProfileReview queue and matching
// engine; this is purely a different "what to do with the leftovers" policy.

let _pendingNewDiveCandidates = []; // parsed dives with no existing match, most recent Log-page import

async function importUddfForNewDive(fileList) {
  const statusEl = document.getElementById('lf-uddf-status');
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (statusEl) { statusEl.style.display = ''; statusEl.textContent = 'Reading…'; }

  let attached = 0, ambiguous = 0, failed = 0;
  const claimed = new Set();
  const newCandidates = [];

  for (const file of files) {
    let text;
    try { text = await file.text(); } catch (e) { failed++; continue; }
    let parsedFile;
    try { parsedFile = parseUddf(text); }
    catch (e) {
      failed++;
      if (statusEl) statusEl.textContent = `${file.name}: ${e.message}`;
      continue;
    }
    for (const parsed of parsedFile.dives) {
      const { auto, ranked } = matchToLoggedDive(parsed, dives, claimed);
      if (auto) {
        claimed.add(auto.id);
        const result = await _attachProfile(auto, parsed, parsedFile.generatorName);
        if (result === 'ok') attached++; else failed++;
      } else if (ranked.length) {
        ambiguous++;
        _pendingProfileReview.push({ parsed, ranked: ranked.slice(0, 3), sourceLabel: parsedFile.generatorName });
      } else {
        newCandidates.push({ parsed, sourceLabel: parsedFile.generatorName });
      }
    }
  }

  _renderProfileReviewList();

  if (newCandidates.length === 1) {
    const { gpsSet, siteName } = _prefillLogFormFromProfile(newCandidates[0].parsed, newCandidates[0].sourceLabel);
    const gpsBit = gpsSet ? ` — dropped the pin${siteName ? ' near "' + siteName + '"' : ''} from your dive computer's site data` : '';
    if (statusEl) statusEl.textContent = `Pre-filled below${gpsBit} — add the site, buddy and any sightings, then save.`;
  } else if (newCandidates.length > 1) {
    _pendingNewDiveCandidates = newCandidates;
    _renderNewDivePicker();
    if (statusEl) statusEl.textContent = `${newCandidates.length} new dives found — pick one below to start logging.`;
  } else if (statusEl) {
    const parts = [];
    if (attached)  parts.push(`${attached} already logged — profile attached`);
    if (ambiguous) parts.push(`${ambiguous} need review below`);
    if (failed)    parts.push(`${failed} failed`);
    statusEl.textContent = parts.length ? parts.join(' · ') : 'No dives found in this file.';
  }
}

function _renderNewDivePicker() {
  const box = document.getElementById('lf-uddf-picker');
  if (!box) return;
  if (_pendingNewDiveCandidates.length <= 1) { box.innerHTML = ''; box.style.display = 'none'; return; }
  box.style.display = '';
  // Bulk-add bar (option A, task #7): number the whole batch from a single
  // anchor. Prefill priority: the file's own numbering when present
  // (Subsurface exports carry <divenumber>) → continue from the highest
  // logged dive number → 1. Editable by default, because neither guess
  // survives contact with reality ("I got this computer on dive 45") — but
  // NOT editable when the date-aware guard below has already fully
  // determined the slot from dives already in the log (numberingLocked):
  // there, a human override can only introduce a collision, never improve
  // on the computation.
  //
  // The field asks for the MOST RECENT dive number — the newest dive IN
  // THIS BATCH, not some earlier reference point (2026-07-15, corrected
  // after a first attempt asked for "last dive before this batch" and
  // required a mental +1; this needed a mental subtraction too, just in
  // the wrong direction). Divers know "that was my hundredth dive" as a
  // concrete, memorable fact about the dive they just did — not "the dive
  // before my most recent batch of dives," which isn't a fact anyone
  // actually holds in their head. So: user enters the END of the range,
  // Shoal counts backward. batchEnd is the real internal quantity (what
  // the NEWEST dive in the batch gets numbered); batchStart (= batchEnd -
  // n + 1) is derived from it. A live preview (_updateBulkAddPreview)
  // shows the resulting "#98–#100" range so the arithmetic is never
  // invisible.
  const n = _pendingNewDiveCandidates.length;
  const fileNums = _pendingNewDiveCandidates.map(c => c.parsed.divenumber).filter(v => v != null);
  const maxLogged = dives.reduce((m, d) => Math.max(m, parseInt(d.divenum, 10) || 0), 0);
  let batchStart = fileNums.length ? Math.min(...fileNums) : maxLogged + 1;

  // Date-aware numbering guard (2026-07-14, found via an interrupted-then-
  // resumed BLE sync): dive computers deliver NEWEST-first, so a cancelled
  // sync grabs the most recent dives, and the resumed session's leftovers
  // are OLDER than what's already logged — the maxLogged+1 default would
  // number yesterday's dives after today's, silently. When the whole batch
  // predates the newest logged dive: suggest slotting below the lowest
  // logged number instead (when there's room), and warn either way.
  let orderWarnHtml = '';
  // Set true only when the batch's numbering is FULLY DETERMINED by dives
  // already in the log — no free-text override left legitimate, only a way
  // to get it wrong. Found live (2026-07-22): this exact branch already
  // computed the one correct, collision-free slot (below the existing
  // range), but the field stayed editable and labelled "Most recent dive
  // #" — a label written for the ordinary case, where the batch really is
  // the diver's newest activity. For an older backfill batch, "most
  // recent" reads as "my actual most recent dive right now" (147, already
  // taken), not "the newest dive within this specific older batch" (144) —
  // exactly the reading that produced a duplicate #145–147. Locking the
  // number here removes the field a confused answer could go into, rather
  // than trying to reword around the ambiguity.
  let numberingLocked = false;
  const batchDates = _pendingNewDiveCandidates
    .map(c => (c.parsed.startedAt || '').slice(0, 10)).filter(Boolean);
  const datedLogged = dives.filter(d => d.date && parseInt(d.divenum, 10) > 0);
  if (batchDates.length && datedLogged.length) {
    const newestBatch  = batchDates.reduce((a, b) => (a > b ? a : b));
    const oldestBatch  = batchDates.reduce((a, b) => (a < b ? a : b));
    const newestLogged = datedLogged.reduce((a, d) => (d.date > a ? d.date : a), '');
    if (oldestBatch < newestLogged) {
      const minLoggedNum = datedLogged.reduce((m, d) => Math.min(m, parseInt(d.divenum, 10)), Infinity);
      const wholeBatchOlder = newestBatch < newestLogged;
      if (wholeBatchOlder && !fileNums.length && minLoggedNum - n >= 1) {
        batchStart = minLoggedNum - n;
        numberingLocked = true;
        orderWarnHtml = `<div style="font-size:var(--font-size-sm);color:var(--warn);margin-bottom:8px">⚠ These dives are older than dives already in your log — numbered below your current #${minLoggedNum} so date order and dive order stay in step.</div>`;
      } else {
        orderWarnHtml = `<div style="font-size:var(--font-size-sm);color:var(--warn);margin-bottom:8px">⚠ ${wholeBatchOlder ? 'These dives are older than' : 'Some of these dives predate'} dives already in your log — numbering from #${batchStart} would put dive numbers out of date order. Adjust the number below, or renumber afterwards via ✎ edit.</div>`;
      }
    }
  }

  const mostRecentDefault = batchStart + n - 1;
  // Locked case: the range is shown as fixed text and the number input
  // becomes `hidden` (still present, still read by _bulkAddNewDives() —
  // only its visible/editable form changes) so there is no control left
  // that could carry a wrong, human-typed number into a real collision.
  const numberFieldHtml = numberingLocked
    ? `<span style="font-size:var(--font-size-sm)">Will be numbered <strong>#${batchStart}–#${mostRecentDefault}</strong></span>
       <input type="hidden" id="lf-bulk-mostrecent" value="${mostRecentDefault}">`
    : `<label for="lf-bulk-mostrecent" class="form-label">Most recent dive #</label>
       <input type="number" id="lf-bulk-mostrecent" min="${n}" step="1" value="${mostRecentDefault}" style="width:90px" oninput="_updateBulkAddPreview(${n})">
       <span id="lf-bulk-preview" class="text-muted-para" style="font-size:var(--font-size-xs)"></span>`;
  const bulkHtml = `<div class="info-box" style="margin-bottom:10px">
    <div style="margin-bottom:4px"><strong>Add all ${n} as new dives</strong></div>
    <div class="text-muted-para" style="margin-bottom:8px">${numberingLocked ? 'Numbered in date order to fit between dives already in your log.' : 'Numbered in date order, ending at your most recent dive — what number was that?'}</div>
    ${orderWarnHtml}
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${numberFieldHtml}
      <button type="button" class="btn-ghost" style="font-weight:600" onclick="_bulkAddNewDives()">Add all ${n} →</button>
    </div>
  </div>`;
  const rows = _pendingNewDiveCandidates.map((c, i) => {
    const durMin = Math.round(c.parsed.duration / 60);
    const dateBit = c.parsed.startedAt ? ' · ' + esc(c.parsed.startedAt.slice(0, 10)) : '';
    return `<button type="button" class="btn-ghost" style="display:block;width:100%;text-align:left;margin-bottom:4px"
      onclick="_pickNewDiveCandidate(${i})">${c.parsed.maxDepth}m · ${durMin}min${dateBit}</button>`;
  }).join('');
  box.innerHTML = `${bulkHtml}<div class="text-muted-para" style="margin-bottom:6px">Or pick one to log fully now — the rest can be imported again later:</div>${rows}`;
  _updateBulkAddPreview(n); // populate the preview for the pre-filled default too, not just on input
}

// Live "→ #98–#100" readout beside the "Most recent dive #" field — the
// subtraction from "your most recent dive was #N" to "this batch starts at
// N-n+1" should never be invisible.
function _updateBulkAddPreview(n) {
  const input = document.getElementById('lf-bulk-mostrecent');
  const preview = document.getElementById('lf-bulk-preview');
  if (!input || !preview) return;
  let mostRecent = parseInt(input.value, 10);
  if (!Number.isFinite(mostRecent) || mostRecent < n) mostRecent = n;
  const end = mostRecent;
  const start = end - n + 1;
  preview.textContent = n === 1 ? `→ #${end}` : `→ #${start}–#${end}`;
}

function _pickNewDiveCandidate(i) {
  const c = _pendingNewDiveCandidates[i];
  if (!c) return;
  _pendingNewDiveCandidates = [];
  const box = document.getElementById('lf-uddf-picker');
  if (box) { box.innerHTML = ''; box.style.display = 'none'; }
  _prefillLogFormFromProfile(c.parsed, c.sourceLabel);
}

// Exit time = entry + bottom time with midnight wrap — the same arithmetic
// calcExitTime does on the form, minus the DOM round-trip.
function _deriveExitTime(entrytime, durMin) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(entrytime || '');
  if (!m || !durMin) return '';
  const total = ((+m[1] * 60 + +m[2]) + Math.round(durMin)) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Bulk-add (option A, task #7): turn every no-match parsed dive into a
// skeleton logged dive in one action — the new-diver onboarding path ("my
// whole history is on the computer"), and the same landing flow BLE sync
// will hand its batches to (brief §9). Only fields the profile actually
// knows are filled; everything else stays empty for edit mode to complete
// later. The dives were already through the match pass (that's how they
// ended up in _pendingNewDiveCandidates), so re-importing the same file
// matches these newly-created dives instead of duplicating them.
async function _bulkAddNewDives() {
  const statusEl = document.getElementById('lf-uddf-status');
  const box = document.getElementById('lf-uddf-picker');
  const input = document.getElementById('lf-bulk-mostrecent');
  const batch = _pendingNewDiveCandidates.slice();
  if (!batch.length) return;
  // Field asks for the MOST RECENT dive number — the newest dive IN THIS
  // BATCH (see _renderNewDivePicker's comment for why) — so the batch's
  // actual starting number counts backward from it. Anything that can't
  // produce a valid ≥1 start (non-numeric, negative, or simply smaller than
  // the batch itself) falls back to exactly the batch size, which resolves
  // to start=1 — matches the original "no prior history" behaviour exactly.
  let mostRecent = parseInt(input && input.value, 10);
  if (!Number.isFinite(mostRecent) || mostRecent < batch.length) mostRecent = batch.length;
  const start = mostRecent - batch.length + 1;

  // Hard guard, independent of how `mostRecent` was arrived at (typed,
  // defaulted, or a future bug in the default computation itself) — this is
  // the failure mode _renderNewDivePicker's locked-numbering case exists to
  // prevent, but that only covers ONE branch (and even there isn't strictly
  // airtight — an existing UNDATED dive holding one of the "safe" numbers
  // wouldn't be caught by that branch's date-based reasoning, only by this
  // check). Divenum collisions are real data corruption (duplicate #s
  // throughout history/stats/trip grouping, and canonicalFilename() would
  // even collide two real dives onto the same base filename), not a
  // soft-validation nice-to-have — so this blocks outright rather than
  // warning-and-proceeding. Left as-is (candidates/box NOT cleared) so the
  // user can fix the number and retry without re-syncing the whole batch
  // from the device again — except when the field is itself locked
  // (`type=hidden`, no editable control left), where retrying can't help;
  // that phrasing points at re-syncing instead.
  const existingNums = new Set(dives.map(d => parseInt(d.divenum, 10)).filter(Number.isFinite));
  const collisions = [];
  for (let num = start; num <= mostRecent; num++) if (existingNums.has(num)) collisions.push(num);
  if (collisions.length) {
    if (statusEl) {
      statusEl.style.display = '';
      const numWord = collisions.length === 1 ? 'is' : 'are';
      const fix = (input && input.type === 'hidden')
        ? 'try syncing again — something about the existing log changed since this batch was matched.'
        : 'pick a different number above and try again.';
      statusEl.textContent = `Dive #${collisions.join(', #')} ${numWord} already used in your log — ${fix}`;
    }
    return;
  }

  // Number in true chronological order regardless of file order (Shearwater
  // manifests arrive newest-first); undated dives keep file order, at the end.
  const ordered = batch.map((c, i) => ({ c, i })).sort((a, b) => {
    const ta = a.c.parsed.startedAt ? Date.parse(a.c.parsed.startedAt) : Infinity;
    const tb = b.c.parsed.startedAt ? Date.parse(b.c.parsed.startedAt) : Infinity;
    return (ta - tb) || (a.i - b.i);
  });

  _pendingNewDiveCandidates = [];
  if (box) { box.innerHTML = ''; box.style.display = 'none'; }
  if (statusEl) statusEl.textContent = `Adding ${ordered.length} dives…`;

  const now = Date.now();
  const created = [];
  ordered.forEach(({ c }, i) => {
    const p = c.parsed;
    let date = '', entrytime = '';
    if (p.startedAt) {
      const dt = new Date(p.startedAt); // local getters — same round-trip rationale as _prefillLogFormFromProfile
      date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      entrytime = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    }
    const timeMin = Math.round(p.duration / 60);
    created.push({ parsed: p, sourceLabel: c.sourceLabel, dive: {
      id: now + i, uid: mintUid(), videos: [],
      title: '', divenum: start + i,
      date, site: p.siteName || '', region: '', location: '',
      watertype: '', vis: '', temp: _computeMinTemp(p.waypoints)?.value ?? '',
      current: '', weather: '',
      depth: p.maxDepth ?? '', avgdepth: _computeAvgDepth(p.waypoints) ?? '',
      time: timeMin || '', entrytime, exittime: _deriveExitTime(entrytime, timeMin),
      entry: '', liveaboard: '', trip: '',
      pstart: p.pstart ?? '', pend: p.pend ?? '', gas: p.gas || '',
      suit: '', weight: '', tanktype: '', tanksize: p.tanksize ?? '',
      gps_lat: p.gpsLat ?? null, gps_lng: p.gpsLng ?? null,
      safety_stop_depth: null, safety_stop_time: null,
      deco_stop_depth: null, deco_stop_time: null,
      marine: [], buddy: '', notes: '', signoff: '', certnum: '',
      _pendingSync: true,
    } });
  });

  // Newest first in dives[] — saveDive's unshift convention. created[] is
  // oldest-first, so unshifting forward leaves the newest on top.
  for (const c of created) dives.unshift(c.dive);
  localStorage.setItem('divelog-dives', JSON.stringify(dives));

  // Backend pushes sequential, not parallel — Android SAF dislikes write
  // storms (see writeFileInDir's retry rationale). Failures stay
  // _pendingSync and surface via the sync-status line, same as any save.
  let sidecars = 0;
  for (const { dive, parsed, sourceLabel } of created) {
    try {
      if (syncMode === 'obsidian' && obsAvailable) await pushToObsidian(dive);
      else if (syncMode === 'folder') await writeToFolder(dive);
    } catch (e) { /* stays _pendingSync */ }
    try {
      if (await _attachProfile(dive, parsed, sourceLabel) === 'ok') sidecars++;
    } catch (e) {}
  }

  buildSiteHistory();
  updateCount();
  if (typeof renderHistory === 'function') renderHistory();
  if (statusEl) {
    const end = start + created.length - 1;
    const profileBit = sidecars ? ` · ${sidecars} depth profiles attached` : '';
    statusEl.textContent = `Added ${created.length} dives, numbered #${start}–#${end}${profileBit} — they're in History; open one and ✎ to add site, buddy and sightings.`;
  }
}

// Time-weighted mean depth across waypoints (trapezoidal) — UDDF gives a
// depth/time curve, not a pre-computed average, so this is derived rather
// than a straight arithmetic mean, which would over-weight densely-sampled
// stretches (e.g. a long safety stop) relative to fast transits.
function _computeAvgDepth(waypoints) {
  if (!waypoints || !waypoints.length) return null;
  if (waypoints.length === 1) return waypoints[0].d;
  let weighted = 0, totalT = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const dt = waypoints[i].t - waypoints[i - 1].t;
    if (dt <= 0) continue;
    weighted += dt * (waypoints[i].d + waypoints[i - 1].d) / 2;
    totalT += dt;
  }
  return totalT > 0 ? +(weighted / totalT).toFixed(1) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Dive profile chart (Phase C) — depth/time SVG curve rendered in the dive
// file. See BRIEF-dive-profile-import.md §7 and DECISIONS.md → "Dive computer
// profile import" for the resolved design calls this implements.
// ═══════════════════════════════════════════════════════════════════════════

// Coldest waypoint (value + when it occurred) — the chart's second anchor
// point alongside surface temp (simply waypoints[0].temp, no helper needed).
function _computeMinTemp(waypoints) {
  let min = null;
  for (const w of waypoints) {
    if (typeof w.temp === 'number' && (min == null || w.temp < min.value)) min = { value: w.temp, t: w.t };
  }
  return min;
}

// _hexToRgb/_hexLerp/_ndlColor/_smoothPathD/_niceStep moved to
// js/chart-math.js (v2.99) — landing/script.js's demo chart shares them
// verbatim now instead of hand-copying. Loaded before this file in
// index.html.

function _validHex(hex, fallback) {
  const h = (hex || '').toString().trim().replace('#', '');
  if (!h || !/^[0-9a-f]{3,6}$/i.test(h)) return fallback || '#000000';
  return '#' + h;
}

// <decostop> events land one-per-sample while a computer holds a stop or
// tracks a shoaling ceiling (a 3-minute safety stop sampled every 10s is ~18
// raw events; a real staged-deco ascent reports a *gradually decreasing*
// decodepth almost every sample, not a fixed plateau). Group by TIME
// contiguity only — a fixed-depth anchor would (and did, on a real rebreather
// file) fracture one continuous obligation into dozens of one-sample groups
// every time the ceiling ticked down. Track the depth range actually covered
// so a multi-level span reports as one range, not one pill per level.
function _groupStopEvents(events) {
  const stops = (events || []).filter(e => e.type === 'safetystop' || e.type === 'decostop');
  if (!stops.length) return [];
  stops.sort((a, b) => a.t - b.t);
  const GAP_MAX = 90; // seconds — bridges normal sample spacing without merging genuinely separate stops
  const groups = [];
  let cur = null;
  for (const e of stops) {
    if (cur && cur.type === e.type && (e.t - cur.endT) <= GAP_MAX) {
      cur.endT = e.t;
      cur.minDepth = Math.min(cur.minDepth, e.depth);
      cur.maxDepth = Math.max(cur.maxDepth, e.depth);
    } else {
      if (cur) groups.push(cur);
      cur = { type: e.type, minDepth: e.depth, maxDepth: e.depth, startT: e.t, endT: e.t };
    }
  }
  if (cur) groups.push(cur);
  return groups
    .map(g => ({ ...g, durationMin: Math.max(1, Math.round((g.endT - g.startT) / 60)) }))
    .filter(g => g.durationMin >= 1); // drop sub-minute fragments as noise
}

// Renders the depth/time profile chart + its own stat readout, replacing the
// floating .df-band on any dive that has one (DECISIONS.md — "floating stat
// band is replaced, not duplicated"). Returns null when there's no profile
// or too little data to plot, so the caller falls back to the plain band.
function renderProfileChart(d) {
  const profile = d.uid ? _profiles.get(d.uid) : null;
  let waypoints = profile && profile.waypoints;
  if (!waypoints || waypoints.length < 2) return null;

  // Most computers only start logging once a wet-sensor trips a metre or two
  // under, so the first real sample is rarely a literal 0 m — every dive
  // still starts at the surface, so anchor the curve there rather than
  // drawing it as if descent began already a couple of metres down.
  const firstReal = waypoints[0];
  if (firstReal.t > 0 || firstReal.d > 0.3) waypoints = [{ t: 0, d: 0 }, ...waypoints];

  const key = d.uid || d.id || 'x';
  // Taller on narrow phones — 640:220 (~2.9:1) scales down to a very short
  // absolute chart height on a phone-width screen, crowding annotations
  // (entry label, safety/deco pills) against the top axis. Changing H here
  // (rather than stretching the container in CSS) keeps the viewBox and the
  // rendered aspect ratio in sync by construction — every axis-tick and
  // annotation position below is derived from this same H, so nothing can
  // drift out of alignment with where the SVG content actually paints.
  const W = 640, H = (typeof window !== 'undefined' && window.innerWidth <= 480) ? 300 : 220;
  const padL = 34, padR = 34, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const duration  = Math.max(1, waypoints[waypoints.length - 1].t); // seconds
  const maxD      = waypoints.reduce((m, w) => Math.max(m, w.d), 0);
  const depthStep = _niceStep(maxD, 4);
  const depthCeil = (Math.ceil(maxD / depthStep) * depthStep) || depthStep;
  const timeStepMin  = _niceStep(duration / 60, 5);
  const timeCeilMin  = (Math.ceil((duration / 60) / timeStepMin) * timeStepMin) || timeStepMin;

  const x = t   => padL + (t / duration) * plotW;
  const y = dep => padT + (dep / depthCeil) * plotH;
  const pctX = px => (px / W * 100).toFixed(2);
  const pctY = py => (py / H * 100).toFixed(2);

  const pts = waypoints.map(w => ({ x: x(w.t), y: y(w.d) }));
  const curveD = _smoothPathD(pts);
  const fillD  = `${curveD} L${pts[pts.length - 1].x.toFixed(2)},${padT} L${pts[0].x.toFixed(2)},${padT} Z`;

  // NDL-headroom gradient — the one colour mechanic this chart keeps
  // (DECISIONS.md). Reads live CSS custom properties (not hardcoded hex) so
  // a future theme change only needs editing css/styles.css, not this file —
  // every shade the chart uses, including the derived calm/deco/fill tints,
  // is a real `--profile-*`/`--warn`/`--danger` token (see "Dive-profile
  // chart" in CLAUDE colour UI.md), not computed here. Falls back to a flat
  // calm colour when the file carries no per-waypoint <nodecotime> at all.
  const cs        = getComputedStyle(document.documentElement);
  // Lightened rather than raw --accent — full-strength read as too dark next
  // to the already-soft, opacity-washed fill. This is the one "calm" colour
  // the whole curve uses, including the NDL gradient's own calm segments
  // below, not just the no-NDL flat-colour fallback.
  const calmHex = _validHex(cs.getPropertyValue('--profile-calm'), '#89B7D1');
  const warnHex   = _validHex(cs.getPropertyValue('--profile-warn'), '#E0734F');
  const dangerHex = _validHex(cs.getPropertyValue('--danger'), '#B0492E');
  // Locked-deco is a DIFFERENT, darker colour from live danger, not the same
  // hex wearing two labels — "danger" (0-10min, still live/reversible — see
  // _ndlColor) and "deco" (locked forever once genuinely crossed zero — see
  // the locking logic below) are sequential but visually distinct concepts.
  // Found necessary live-testing real dive data: sharing one colour meant a
  // dive that spent a long stretch hovering near-but-above zero (still live,
  // correctly tracking) looked identical to a dive that had genuinely locked
  // into deco, and the marker line marking the lock moment had no colour
  // change to confirm it against an already-dark backdrop.
  const decoHex = _validHex(cs.getPropertyValue('--profile-deco'), '#6A2C1C');

  // Water-column fill gets its own top-to-bottom gradient — lighter at the
  // surface, a little darker at depth — echoing the app's existing
  // depth-gradient page background rather than a single flat tint. Always
  // present (not tied to NDL data like the curve's own gradient above).
  const fillTopHex    = _validHex(cs.getPropertyValue('--profile-fill-top'), '#C0D8E6');
  const fillBottomHex = _validHex(cs.getPropertyValue('--profile-fill-bottom'), '#65A1C3');
  const fillGradient = `<linearGradient id="fillg-${key}" gradientUnits="userSpaceOnUse" x1="0" y1="${padT}" x2="0" y2="${H - padB}">
    <stop offset="0%" stop-color="${fillTopHex}"/>
    <stop offset="100%" stop-color="${fillBottomHex}"/>
  </linearGradient>`;

  const hasNdl = waypoints.some(w => typeof w.ndl === 'number');
  // Some computers stop reporting <nodecotime> the moment a dive commits to
  // mandatory decompression — "no-deco time remaining" stops being a
  // meaningful number once you're already obligated to decompress, so the
  // field just disappears (confirmed against a real rebreather file: NDL
  // dropped cleanly 999→24→13→6→2→1 through the descent, then vanished
  // entirely at the exact waypoint <decostop> events begin). Treating a
  // missing sample as "assume calm" would swing the gradient back to safe
  // blue right as the dive enters its most hazardous phase — forward-fill
  // the last known value instead, so a gap reads as "still whatever it was
  // last known to be" rather than "fine now".
  let lastNdl = null;
  // The very first NDL sample (or two) can read a placeholder 0 before the
  // wet-sensor trips deep enough for the computer's own no-deco calculation
  // to genuinely start (confirmed against real hardware: first sample at
  // ~0-2m reads NDL=0, the very next sample onward reads a normal 99+) —
  // trusting that as "already in deco at the moment of entry" drew the
  // danger colour and the deco marker line at t≈0 on every dive that
  // carries NDL data at all, regardless of the dive's actual depth/deco
  // profile. Don't start trusting a reading until real depth backs it.
  const ndlSeries = waypoints.map(w => {
    if (typeof w.ndl === 'number' && w.d > 3) lastNdl = w.ndl;
    return lastNdl;
  });

  // The moment NDL genuinely reaches zero is a ONE-WAY threshold, not a
  // momentary reading — once truly in mandatory decompression, ascending
  // doesn't undo the obligation, so the curve locks to the deco colour from
  // that point to the end of the dive regardless of what NDL/TTS does
  // afterward. Everything BEFORE that point stays fully reversible — NDL
  // recovering from 5 back up to 50 on ascent is a real, safe recovery and
  // the colour should track it live, which is exactly what the per-sample
  // _ndlColor() call below already does on its own. Same fallback as the
  // deco marker line needs (below): a literal ≤0 reading when the file has
  // one, else the first <decostop> event for computers that stop reporting
  // <nodecotime> entirely once genuinely in deco.
  let decoStartIdx = hasNdl ? ndlSeries.findIndex(v => typeof v === 'number' && v <= 0) : -1;
  if (decoStartIdx === -1) {
    const firstDeco = (profile.events || [])
      .filter(e => e.type === 'decostop')
      .reduce((min, e) => (min == null || e.t < min) ? e.t : min, null);
    if (firstDeco != null) decoStartIdx = waypoints.findIndex(w => w.t >= firstDeco);
  }

  let strokeColor = calmHex, gradientDefs = '';
  if (hasNdl) {
    const x0 = pts[0].x, xN = pts[pts.length - 1].x, span = (xN - x0) || 1;
    const stops = waypoints.map((w, i) => {
      const off = ((pts[i].x - x0) / span * 100).toFixed(2);
      const locked = decoStartIdx > -1 && i >= decoStartIdx;
      const color = locked ? decoHex : _ndlColor(ndlSeries[i], calmHex, warnHex, dangerHex);
      return `<stop offset="${off}%" stop-color="${color}"/>`;
    }).join('');
    gradientDefs = `<linearGradient id="ndlg-${key}" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${xN}" y2="0">${stops}</linearGradient>`;
    strokeColor = `url(#ndlg-${key})`;
  }

  // Gridlines + axis tick labels (HTML overlay, not SVG text, so type stays
  // crisp at the app's fixed type scale instead of scaling with the viewBox)
  const depthTicks = []; for (let v = 0; v <= depthCeil; v += depthStep) depthTicks.push(v);
  const timeTicksMin = []; for (let v = 0; v <= timeCeilMin; v += timeStepMin) timeTicksMin.push(v);
  const gridLines = depthTicks.map(v => `<line x1="${padL}" y1="${y(v).toFixed(2)}" x2="${W - padR}" y2="${y(v).toFixed(2)}" class="df-pc-grid"/>`).join('');
  const yLabels = depthTicks.map(v => `<div class="df-pc-ytick" style="top:${pctY(y(v))}%">${v}${v === 0 ? ' m' : ''}</div>`).join('');
  const xLabels = timeTicksMin.map((v, i) => `<div class="df-pc-xtick" style="left:${pctX(x(v * 60))}%">${v}${i === timeTicksMin.length - 1 ? ' min' : ''}</div>`).join('');

  // Entry / exit / max-depth event dots. Max depth gets a bare dot only, no
  // text label — the number's already the first stat in the strip above, and
  // the label used to collide with either the min-temp reading or the x-axis
  // depending on where the trough happened to fall.
  const entryPt = pts[0], exitPt = pts[pts.length - 1];
  const maxIdx  = waypoints.findIndex(w => w.d === maxD);
  const maxPt   = pts[maxIdx];
  const dots = `<circle class="df-pc-dot df-pc-dot-evt" cx="${entryPt.x.toFixed(2)}" cy="${entryPt.y.toFixed(2)}" r="4"/>
                <circle class="df-pc-dot df-pc-dot-evt" cx="${exitPt.x.toFixed(2)}" cy="${exitPt.y.toFixed(2)}" r="4"/>
                <circle class="df-pc-dot df-pc-dot-max" cx="${maxPt.x.toFixed(2)}" cy="${maxPt.y.toFixed(2)}" r="3"/>`;
  // Real clock times, not the words "entry"/"exit" — this is what lets the
  // dive-file's separate "Profile" bubble (In/Stop/Out) disappear entirely
  // once a chart exists, rather than repeating the same two times.
  const entryLabel = esc(d.entrytime) || 'entry';
  const exitLabel  = esc(d.exittime)  || 'exit';
  const evtLabels = `
    <div class="df-pc-evt" style="left:${pctX(entryPt.x)}%;top:${pctY(entryPt.y)}%">${entryLabel}</div>
    <div class="df-pc-evt df-pc-evt-r" style="left:${pctX(exitPt.x)}%;top:${pctY(exitPt.y)}%">${exitLabel}</div>`;

  // Safety/deco stop pills — labelling already-classified events, not
  // computing anything new (the "no deco recomputation" boundary stays
  // intact). A near-constant depth reads as one plateau ("5M"); a real
  // multi-level ascent reads as the range it actually covered ("21→3M").
  const stopPills = _groupStopEvents(profile.events).map(g => {
    const midT     = (g.startT + g.endT) / 2;
    const midDepth = (g.minDepth + g.maxDepth) / 2;
    // Sits in the open water below the curve, not up in the shaded fill
    // above it — halfway between the group's own depth and the chart floor,
    // so it scales with whatever room is actually available rather than a
    // fixed offset that could crowd the curve on a shallower dive.
    const belowDepth = midDepth + (depthCeil - midDepth) * 0.5;
    const label    = g.type === 'safetystop' ? 'SAFETY' : 'DECO';
    const depthTxt = (g.maxDepth - g.minDepth) < 1.5
      ? `${g.minDepth.toFixed(0)}M`
      : `${g.maxDepth.toFixed(0)}→${g.minDepth.toFixed(0)}M`;
    return `<div class="df-pc-pill" style="left:${pctX(x(midT))}%;top:${pctY(y(belowDepth))}%">${label} · ${depthTxt} · ${g.durationMin}MIN</div>`;
  }).join('');

  // A thin vertical line bisecting the whole plot height, marking the same
  // moment the colour lock above triggers on — reuses decoStartIdx rather
  // than re-deriving it, so the marker and the colour lock can never
  // disagree about when deco was entered.
  let ndlZeroLine = '';
  if (decoStartIdx > -1) {
    const zx = x(waypoints[decoStartIdx].t).toFixed(2);
    ndlZeroLine = `<line x1="${zx}" y1="${padT}" x2="${zx}" y2="${H - padB}" class="df-pc-ndlzero-line"/>`;
  }

  // NDL colour key — the curve's colour is otherwise unexplained (found
  // confusing in practice: a warm/red stretch on the line with no legend
  // anywhere near it). A gradient bar, not a swatch list, built from the
  // exact same thresholds _ndlColor() itself uses (calm flat above 25min,
  // lerp to 15min, lerp to 10min, danger flat from there down) — it can't
  // visually drift from what the curve's LIVE per-sample colour does.
  // The final danger→deco step (60%→100%) is deliberately a hard cut, not
  // a lerp — entering deco is a discrete state change at exactly ndl=0,
  // not a continuous fade, and the bar says so. It still can't represent
  // the LOCK ITSELF (a locked sample keeps the deco colour even once its
  // own live NDL has recovered to, say, 50 — that's dive history, not a
  // function of the NDL value alone, so no static bar can show it) — the
  // "0 · deco" tick at least marks where that lock is triggered. Lives
  // below the chart, never overlaid on it (would compete with the
  // curve/pills for the same space), and only renders when the dive
  // actually has NDL data.
  const ndlLegend = hasNdl ? `
  <div class="df-pc-legend">
    <span class="df-pc-legend-label">NDL</span>
    <div class="df-pc-legend-track">
      <div class="df-pc-legend-bar" style="background:linear-gradient(to right, ${decoHex} 0%, ${dangerHex} 3%, ${dangerHex} 10%, ${warnHex} 20%, ${calmHex} 50%, ${calmHex} 100%)"></div>
      <div class="df-pc-legend-ticks">
        <span class="df-pc-legend-tick" style="left:0%">0</span>
        <span class="df-pc-legend-tick df-pc-legend-tick-mid" style="left:10%">10</span>
        <span class="df-pc-legend-tick df-pc-legend-tick-mid" style="left:25%">25</span>
        <span class="df-pc-legend-tick df-pc-legend-tick-mid" style="left:50%">50</span>
        <span class="df-pc-legend-tick df-pc-legend-tick-r">99 min</span>
      </div>
    </div>
  </div>` : '';
  // Stat strip — same 3-or-4-cell shape as the plain .df-band (js/history.js):
  // max/time/vis fixed, avg joins as a 4th cell only when logged. SAC+gas and
  // min-temp used to live here too but were pulled out (SAC+gas → the
  // Overview tank gauge, min-temp → now pre-fills the logged temp at import
  // time instead of displaying twice — DECISIONS.md).
  const sac = calcSAC(d);
  const avgOk = d.avgdepth && parseFloat(d.avgdepth) > 0;
  const statStrip = `
    <div class="df-pc-stats${avgOk ? ' df-band-has-avg' : ''}">
      <div class="df-bcell"><div class="df-bn">${d.depth || '—'}</div><div class="df-bl">↓ max m</div></div>
      <div class="df-bcell"><div class="df-bn">${d.time || '—'}</div><div class="df-bl">⏱ min</div></div>
      <div class="df-bcell"><div class="df-bn">${d.vis || '—'}</div><div class="df-bl">👁 vis m</div>${_dfVisBarHtml(d.vis)}</div>
      ${avgOk ? `<div class="df-bcell"><div class="df-bn">${d.avgdepth}</div><div class="df-bl">avg m</div></div>` : ''}
    </div>`;

  return `
    <div class="df-profile-card">
      ${statStrip}
      <div class="df-pc-chart-wrap" style="aspect-ratio:${W}/${H}">
        <svg class="df-pc-svg" viewBox="0 0 ${W} ${H}">
          <defs>${gradientDefs}${fillGradient}</defs>
          ${gridLines}
          <path class="df-pc-fill" style="fill:url(#fillg-${key})" d="${fillD}"></path>
          <path class="df-pc-curve" d="${curveD}" stroke="${strokeColor}"></path>
          ${dots}
          ${ndlZeroLine}
        </svg>
        ${yLabels}
        ${xLabels}
        ${evtLabels}
        ${stopPills}
      </div>
      ${ndlLegend}
    </div>`;
}

// Pre-fill the log form's scalar fields from a parsed (unmatched) UDDF dive.
// Only the fields the brief scopes as derivable (§1: "pre-fills depth/time/
// date... user fills the rest") plus two easy, genuinely-derived bonuses
// (avg depth, avg temp) — site/buddy/notes/species stay manual, there's
// nothing in a UDDF file to derive them from.
function _prefillLogFormFromProfile(parsed, sourceLabel) {
  const set = (id, v) => { if (v == null) return; const el = document.getElementById(id); if (el) el.value = v; };

  if (parsed.startedAt) {
    const dt = new Date(parsed.startedAt);
    // Local-time getters, not UTC — startedAt was normalised to an ISO string
    // via new Date(s).toISOString() at parse time, so reading it back with
    // local getters in the same browser round-trips to the original
    // wall-clock time the dive computer showed the diver.
    const yyyy = dt.getFullYear();
    const mo   = String(dt.getMonth() + 1).padStart(2, '0');
    const dd   = String(dt.getDate()).padStart(2, '0');
    set('f-date', `${yyyy}-${mo}-${dd}`);
    set('f-entrytime', `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`);
  }
  set('f-depth', parsed.maxDepth);
  set('f-avgdepth', _computeAvgDepth(parsed.waypoints));
  set('f-time', Math.round(parsed.duration / 60));
  set('f-temp', _computeMinTemp(parsed.waypoints)?.value);

  // Gas/tank — opportunistic, same as GPS: only present when the file
  // carries <gasdefinitions>/<tankdata> at all (most recreational-computer
  // exports won't; tech-diving software like Subsurface commonly does).
  // f-gas is a fixed-option <select> — _gasMixLabel already snaps to one of
  // its exact option strings, so a plain value assignment selects it.
  set('f-gas', parsed.gas);
  set('f-tanksize', parsed.tanksize);
  set('f-pstart', parsed.pstart);
  set('f-pend', parsed.pend);

  if (typeof calcExitTime === 'function') calcExitTime();

  // GPS is opportunistic — most UDDF files won't have it (see
  // _parseSiteLookup). When present, lfSetPin is the exact same call the map
  // itself makes on a tap/drag: drops the pin, and with geocode=true kicks
  // off the same reverse-geocode that suggests Country/Region.
  const gpsSet = parsed.gpsLat != null && parsed.gpsLng != null && typeof lfSetPin === 'function';
  if (gpsSet) lfSetPin('f', parsed.gpsLat, parsed.gpsLng, true);

  if (typeof lfSyncFromFields === 'function') lfSyncFromFields();
  if (typeof _updateSectionSummary === 'function') {
    _updateSectionSummary('cs-dive');
    _updateSectionSummary('cs-conditions');
  }

  // Captured here, consumed by the saveDive() patch below once this dive is
  // actually saved — the profile can't be written until the dive has a
  // uid + filename, which only exist after a successful save.
  _pendingNewDiveProfile = { parsed, sourceLabel };

  const siteEl = document.getElementById('f-site');
  if (siteEl) siteEl.focus();

  return { gpsSet, siteName: parsed.siteName || '' };
}

// ── Attach the pending profile once its pre-filled dive is actually saved ──
// Mirrors the show() wrapper pattern (app.js) — saveDive() is patched once,
// here, rather than adding a hook inside it. _matchScore as a sanity check
// against the dive as *actually saved* (not just as pre-filled) means if the
// user changes their mind and overwrites the pre-filled numbers with an
// unrelated dive's before saving, the profile silently doesn't attach rather
// than landing on the wrong dive.
let _pendingNewDiveProfile = null; // { parsed, sourceLabel } | null

const _profileOrigSaveDive = saveDive;
saveDive = function () {
  const pending = _pendingNewDiveProfile;
  // Record edit mode BEFORE calling through — the edit branch clears it on
  // return. An edit save must never consume or attach a pending profile:
  // lastSavedDiveId isn't updated by edits, so it would point at whatever
  // NEW dive was saved earlier — the wrong dive entirely. (openEdit also
  // discards the pending profile on entry; this is the second lock.)
  const wasEdit = typeof editingId !== 'undefined' && editingId !== null;
  _pendingNewDiveProfile = null;
  _profileOrigSaveDive();
  if (!wasEdit && pending && lastSavedDiveId != null) {
    const dive = dives.find(d => d.id === lastSavedDiveId);
    if (dive && _matchScore(pending.parsed, dive) > 0) {
      _attachProfile(dive, pending.parsed, pending.sourceLabel).catch(() => {});
    }
  }
};

// Lean review list (brief §4: "not a heavy wizard") — one card per ambiguous
// parsed dive, its top candidates as pick buttons, a skip. Two possible
// entry points (Settings & data, and the Log-a-dive banner) both queue into
// the one shared _pendingProfileReview list, but the two pages render it
// differently: Settings is explicitly "attach to a dive you've already
// logged" (see its section title), so ambiguity there only ever offers a
// pick among the ranked candidates. The Log page's whole premise is "I just
// dove" — an ambiguous match there must not default to "pick one of these
// old dives," so it also offers "Add as a new dive" per card. Same queue,
// same candidates, different framing per page.
function _renderProfileReviewList() {
  const settingsBox = document.getElementById('profile-review-list');
  const logBox = document.getElementById('lf-uddf-review');
  if (!settingsBox && !logBox) return;
  if (!_pendingProfileReview.length) {
    [settingsBox, logBox].forEach(box => { if (box) { box.innerHTML = ''; box.style.display = 'none'; } });
    return;
  }
  const cardHtml = (entry, i, offerNew) => {
    const rows = entry.ranked.map((r, j) => {
      const d = r.dive;
      const label = `#${d.divenum || '?'} — ${esc(d.site || 'Unknown site')} · ${d.depth || '?'}m · ${d.time || '?'}min · ${esc(d.date || '')}`;
      return `<button type="button" class="btn-ghost" style="display:block;width:100%;text-align:left;margin-bottom:4px"
        onclick="_resolveProfileReview(${i}, ${j})">${label}</button>`;
    }).join('');
    const durMin = Math.round(entry.parsed.duration / 60);
    const dateBit = entry.parsed.startedAt ? ' · ' + esc(entry.parsed.startedAt.slice(0, 10)) : '';
    const addNewHtml = offerNew
      ? `<button type="button" class="btn-ghost" style="display:block;width:100%;text-align:left;margin-bottom:8px;font-weight:600"
          onclick="_addNewFromReview(${i})">+ Add as a new dive</button>
         <div class="text-muted-para" style="margin:2px 0 6px">Or update an existing dive:</div>`
      : '';
    return `<div class="info-box" style="margin-bottom:10px">
      <div style="margin-bottom:6px"><strong>Unmatched dive</strong> — ${entry.parsed.maxDepth}m · ${durMin}min${dateBit}</div>
      ${addNewHtml}
      ${rows || '<div class="text-muted-para">No close matches</div>'}
      <button type="button" class="btn-ghost" style="margin-top:4px;color:var(--text-dim)" onclick="_skipProfileReview(${i})">Skip this one</button>
    </div>`;
  };
  if (settingsBox) {
    settingsBox.style.display = '';
    settingsBox.innerHTML = _pendingProfileReview.map((entry, i) => cardHtml(entry, i, false)).join('');
  }
  if (logBox) {
    logBox.style.display = '';
    logBox.innerHTML = _pendingProfileReview.map((entry, i) => cardHtml(entry, i, true)).join('');
  }
}

async function _resolveProfileReview(entryIdx, candidateIdx) {
  const entry = _pendingProfileReview[entryIdx];
  if (!entry) return;
  const dive = entry.ranked[candidateIdx]?.dive;
  if (!dive) return;
  await _attachProfile(dive, entry.parsed, entry.sourceLabel);
  _pendingProfileReview.splice(entryIdx, 1);
  _renderProfileReviewList();
}

function _skipProfileReview(entryIdx) {
  _pendingProfileReview.splice(entryIdx, 1);
  _renderProfileReviewList();
}

// Log-page-only escape hatch: this parsed dive scored as a plausible match
// against one or more already-logged dives (so it queued as "ambiguous"
// rather than "no match"), but the diver's actual intent on this page is a
// new entry, not an update to an old one. Discards the ambiguous-match
// candidates entirely and pre-fills the form as new, same as a genuine
// no-match would have.
function _addNewFromReview(entryIdx) {
  const entry = _pendingProfileReview[entryIdx];
  if (!entry) return;
  _pendingProfileReview.splice(entryIdx, 1);
  _renderProfileReviewList();
  _prefillLogFormFromProfile(entry.parsed, entry.sourceLabel);
}
