// Species Album (v3.0) — derived view over logged dives.
// Classic script — loaded after js/species.js (needs SP_PHOTO_MAP, SP_IUCN_MAP, GROUP_EMOJI).
// Phase 1: data layer only. Phases 2-6 add UI progressively.

// ── IUCN rank for sort ────────────────────────────────────────────────────────
// CR=5, EN=4, VU=3, NT=2, LC=1, DD=0, unknown/''=−1 (always last).
function _iucnRank(status) {
  return ({ CR: 5, EN: 4, VU: 3, NT: 2, LC: 1, DD: 0 }[status] ?? -1);
}

// ── GPS coordinate normaliser ─────────────────────────────────────────────────
// parseFrontmatter turns empty "gps_lat: " YAML lines into [] (an empty array).
// parseFloat([]) → NaN. NaN ?? null → NaN (not null/undefined, so passes the
// filter). Use parseFloat → isNaN to reliably coerce any value to number|null.
function _parseCoord(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }

// ── Build species index ───────────────────────────────────────────────────────
// Returns Map<key, SpeciesEntry> where key = scientificName (or commonName for
// unvalidated legacy entries). Re-derived on each call — no internal cache.
//
// SpeciesEntry: {
//   commonName, scientificName, aphiaId, group, iucn, photoUrl, regions,
//   diveCount, videoCount, lastSeen,
//   sightings: [{ diveId, divenum, site, region, location,
//                 gps_lat, gps_lng, date, abundance, video, time }]
//              sorted most-recent-first
// }
function buildSpeciesIndex(dives) {
  // raw: Map<key, { meta, byDive: Map<diveId, sighting> }>
  const raw = new Map();

  for (const dive of dives) {
    if (!dive.marine || !dive.marine.length) continue;
    for (const m of dive.marine) {
      const key = m.customId || (m.scientificName || m.commonName || '').trim();
      if (!key) continue;

      if (!raw.has(key)) {
        raw.set(key, {
          meta: {
            commonName:     m.commonName     || key,
            scientificName: m.scientificName || '',
            aphiaId:        m.aphiaId        || null,
            group:          m.group          || '',
            iucn:           SP_IUCN_MAP[m.scientificName] || '',
            photoUrl:       SP_PHOTO_MAP[m.scientificName] || '',
            regions:        SP_REGIONS_MAP[m.scientificName] || '',
            validated:      m.validated !== false,
          },
          byDive: new Map(),
        });
      }

      const entry = raw.get(key);
      const prev  = entry.byDive.get(dive.id);
      // Deduplicate within a single dive (safety guard for legacy data).
      // Prefer the video-linked sighting when both exist.
      if (!prev || (_sightingHasClips(m) && !_sightingHasClips(prev))) {
        const firstClip = _sightingClips(m)[0] || {};
        entry.byDive.set(dive.id, {
          diveId:    dive.id,
          divenum:   dive.divenum  || '',
          site:      dive.site     || '',
          region:    dive.region   || '',
          location:  dive.location || '',
          gps_lat:   _parseCoord(dive.gps_lat),
          gps_lng:   _parseCoord(dive.gps_lng),
          date:      dive.date     || '',
          abundance: m.abundance   || '',
          clips:     _sightingClips(m),  // full clips array for multi-clip rendering
          video:     firstClip.video || '',  // kept for videoCount calculation
          time:      firstClip.time  || '',
        });
      }
    }
  }

  const index = new Map();
  for (const [key, { meta, byDive }] of raw) {
    const sightings = Array.from(byDive.values())
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const lastSeen  = sightings.reduce((mx, s) => s.date > mx ? s.date : mx, '');
    // Countries this diver actually logged the species in (dive.location,
    // verbatim — NOT the species' own worldwide range, that's meta.regions
    // from SP_REGIONS_MAP, powering the "Found in" line). Drives the Species
    // Album's country filter bar — deliberately country-level, not the
    // coarser 8-region bucket COUNTRY_REGIONS uses elsewhere, so a titan
    // triggerfish logged in both Thailand and Indonesia can be filtered to
    // just one of them.
    const loggedCountries = new Set();
    for (const s of sightings) if (s.location) loggedCountries.add(s.location);
    index.set(key, {
      key,   // the map key (customId for free-text, else scientific/common name)
      ...meta,
      diveCount:  sightings.length,
      videoCount: sightings.filter(s => s.video).length,
      lastSeen,
      loggedCountries: Array.from(loggedCountries),
      sightings,
    });
  }

  return index;
}

// ── Group the index ───────────────────────────────────────────────────────────
// Returns [{ group, species[] }] sorted alphabetically by group label.
function _groupSpeciesByGroup(index) {
  const map = {};
  for (const entry of index.values()) {
    const g = entry.group || 'Unknown';
    if (!map[g]) map[g] = [];
    map[g].push(entry);
  }
  return Object.keys(map)
    .sort()
    .map(group => ({ group, species: _sortGroupContents(map[group]) }));
}

// ── Sort within a group ───────────────────────────────────────────────────────
// IUCN rarity DESC (CR first), alphabetical by commonName within each tier.
function _sortGroupContents(arr) {
  return [...arr].sort((a, b) => {
    const rDiff = _iucnRank(b.iucn) - _iucnRank(a.iucn);
    if (rDiff !== 0) return rDiff;
    return (a.commonName || '').localeCompare(b.commonName || '');
  });
}

// ── Date formatters ───────────────────────────────────────────────────────────
// _fmtFullDate: "Wed 13 May 2026" — used in hero "Last seen" stat and map tooltips
// _fmtDate:     "13 May 2026"     — used in dive log rows (no day-of-week needed)
function _fmtFullDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return '';
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}
function _fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}

// ── Render: Species panel ─────────────────────────────────────────────────────
// Called by show('species') in app.js. Builds the panel shell if data exists,
// or the empty state if no marine species have been logged.
function renderSpeciesPanel() {
  const root = document.getElementById('species-root');
  if (!root) return;

  invalidateSpeciesIndex();              // fresh build on every panel open
  const index = _getSpIndex();

  if (index.size === 0) {
    root.innerHTML =
      '<h1 class="page-title">Species</h1>' +
      '<div class="sp-empty">' +
        '<div class="sp-empty-icon">🐠</div>' +
        '<div class="sp-empty-msg">No species recorded yet — log a dive or sync your data.</div>' +
      '</div>';
    return;
  }

  root.innerHTML =
    '<h1 class="page-title">Species</h1>' +
    '<p class="page-sub" id="species-stats-sub"></p>' +
    '<div class="sp-bar">' +
      '<input type="search" id="species-search" class="sp-search" placeholder="Search common or scientific name…" oninput="filterSpecies(this.value)">' +
    '</div>' +
    _countryFilterBarHtml(index) +
    '<div class="catnav" id="species-catnav"></div>' +
    '<div id="species-groups"></div>';

  _spCountryFilter = null; // fresh filter state on every panel open
  _spSearchQuery   = '';
  _renderSpeciesGroups(index);
  _updateSpeciesHeaderStats();
}

// ── Header stat line ─────────────────────────────────────────────────────────
// "N species recorded across M dives[ in Country]" — recomputed against the
// current search text + country filter (called from _applySpeciesFilters, so
// it stays in sync with whatever's actually visible below it) rather than
// fixed at panel-open. Dive count is scoped to the filtered country too: only
// sightings that happened THERE count, not every dive a matching species has
// ever been seen on elsewhere.
function _updateSpeciesHeaderStats() {
  const sub = document.getElementById('species-stats-sub');
  if (!sub) return;
  const index = _getSpIndex();
  const q = _spSearchQuery;
  const diveIds = new Set();
  let speciesCount = 0;

  for (const entry of index.values()) {
    const searchMatch = !q ||
      (entry.commonName     && entry.commonName.toLowerCase().indexOf(q)     !== -1) ||
      (entry.scientificName && entry.scientificName.toLowerCase().indexOf(q) !== -1);
    const countryMatch = !_spCountryFilter || (entry.loggedCountries || []).indexOf(_spCountryFilter) !== -1;
    if (!searchMatch || !countryMatch) continue;
    speciesCount++;
    for (const s of entry.sightings) {
      if (_spCountryFilter && s.location !== _spCountryFilter) continue;
      diveIds.add(s.diveId);
    }
  }

  const diveLabel = diveIds.size === 1 ? '1 dive' : diveIds.size + ' dives';
  sub.textContent = speciesCount + ' species recorded across ' + diveLabel +
    (_spCountryFilter ? ' in ' + _spCountryFilter : '');
}

// ── Render: group sections + thumbnails ───────────────────────────────────────
// Fills #species-catnav and #species-groups (already in the DOM from
// renderSpeciesPanel). Called immediately after renderSpeciesPanel sets up the
// shell.
function _renderSpeciesGroups(index) {
  const catnav = document.getElementById('species-catnav');
  const groupsEl = document.getElementById('species-groups');
  if (!catnav || !groupsEl) return;

  const groups = _groupSpeciesByGroup(index);

  let navHtml = '';
  let groupsHtml = '';

  for (const { group, species } of groups) {
    const slug    = group.toLowerCase().replace(/\s+/g, '-');
    const emoji   = (typeof GROUP_EMOJI !== 'undefined' && GROUP_EMOJI[group]) || '🐟';
    const stripId = 'strip-' + slug;
    const count   = species.length;

    // Catnav pill
    navHtml +=
      '<a class="cat-pill" href="#cat-' + slug + '">' +
        emoji + ' ' + group +
      '</a>';

    // Group section header + strip
    groupsHtml +=
      '<div class="gsec" id="cat-' + slug + '">' +
        '<div class="gsec-h">' +
          '<span class="emoji">' + emoji + '</span>' +
          '<span>' + group + '</span>' +
          '<span class="n">· ' + count + ' ' + (count === 1 ? 'species' : 'species') + '</span>' +
          '<span class="arrows">' +
            '<button class="gsec-arr" onclick="scrollStrip(\'' + stripId + '\',-1)" aria-label="Scroll left">‹</button>' +
            '<button class="gsec-arr" onclick="scrollStrip(\'' + stripId + '\',1)"  aria-label="Scroll right">›</button>' +
          '</span>' +
        '</div>' +
        '<div class="strip" id="' + stripId + '">' +
          species.map(_thumbHtml).join('') +
        '</div>' +
      '</div>';
  }

  catnav.innerHTML   = navHtml;
  groupsEl.innerHTML = groupsHtml;
}

// ── IUCN badge HTML ───────────────────────────────────────────────────────────
function _iucnBadge(iucn) {
  if (!iucn) return '';
  return '<span class="iucn iucn-' + iucn + '">' + iucn + '</span>';
}

// ── "Found in" region line (ROADMAP.md → "Species Distribution Data") ────────
// Short diver-facing labels for SPECIES_DB's regions field (scripts/fetch-species-regions.py),
// in the same fixed order that script writes them — no re-sorting needed.
const REGION_LABELS = {
  ip:  'Indo-Pacific',
  sea: 'Southeast Asia',
  rs:  'Red Sea',
  med: 'Mediterranean',
  na:  'NE Atlantic',
  car: 'Caribbean',
  ep:  'Eastern Pacific',
  au:  'Australia',
};

// ── Country filter bar (Species panel) ────────────────────────────────────
// Filters the album down to species logged in a given COUNTRY (entry.
// loggedCountries, verbatim dive.location values, built in buildSpeciesIndex)
// — deliberately country-level, not the coarser 8-region bucket REGION_LABELS
// uses above for "Found in"/the log-form pre-filter. A titan triggerfish
// logged in both Thailand and Indonesia is filterable to just one. Data-driven:
// a pill only appears for a country the diver has actually logged something
// in — never a dead option. Alphabetical (no natural "region order" exists
// for an arbitrary country list).
function _countryFilterBarHtml(index) {
  const present = new Set();
  for (const entry of index.values()) (entry.loggedCountries || []).forEach(c => present.add(c));
  if (!present.size) return '';
  const countries = Array.from(present).sort((a, b) => a.localeCompare(b));
  const pills = countries.map(function (c) {
    const js = c.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return '<button type="button" class="sp-country-pill" data-country="' + _esc(c) + '" onclick="filterSpeciesByCountry(\'' + js + '\')">' + _esc(c) + '</button>';
  }).join('');
  return (
    '<div class="sp-country-bar" id="species-country-bar">' +
      '<button type="button" class="sp-country-pill is-active" data-country="" onclick="filterSpeciesByCountry(null)">All</button>' +
      pills +
    '</div>'
  );
}

// A full modal-body section, not a hero line — reads as a general species
// fact (WoRMS/OBIS distribution data), not a record of the diver's own
// sightings, which the hero above it is entirely about. Sharing .sp-sec/
// .sp-sec-h with "Mapped sightings"/"Dive log" below it (same border-top +
// label treatment) makes that a structural fact, not just a font choice —
// found live-testing: sitting inline in the hero next to dive count/last
// seen read as ambiguous ("is this where *I've* seen it?"). Placed first in
// the body, ahead of the diver's own records, so the read order is
// species → where it generally lives → where/when this diver has actually
// seen it. No line at all for species with no region data — never a blank
// or "unknown".
function _foundInSecHtml(regions) {
  if (!regions) return '';
  const labels = regions.split('|').map(c => REGION_LABELS[c]).filter(Boolean);
  if (!labels.length) return '';
  return '<div class="sp-sec">' +
    '<div class="sp-sec-h">Found in</div>' +
    '<div class="sp-found-in-list">' + _esc(labels.join(' · ')) + '</div>' +
  '</div>';
}

// ── Single thumbnail HTML ─────────────────────────────────────────────────────
function _thumbHtml(entry) {
  // Key for openSpeciesProfile: must match the index key (customId for
  // free-text species, else scientific/common name) — see buildSpeciesIndex.
  const key    = _esc(entry.key || entry.scientificName || entry.commonName || '');
  const label  = (entry.diveCount === 1) ? '1 dive' : entry.diveCount + ' dives';
  const badge  = _iucnBadge(entry.iucn);
  const emoji  = (typeof GROUP_EMOJI !== 'undefined' && GROUP_EMOJI[entry.group]) || '🐟';

  let photoHtml;
  if (entry.photoUrl) {
    photoHtml = '<img loading="lazy" decoding="async" src="' + _smallPhotoUrl(entry.photoUrl) + '" alt="">';
  } else {
    photoHtml = '<span class="ph">' + emoji + '</span>';
  }

  const vidBadge = entry.videoCount ? '<span class="thumb-vid-badge">▶</span>' : '';

  const commonLc = (entry.commonName    || '').toLowerCase().replace(/"/g, '&quot;');
  const sciLc    = (entry.scientificName || '').toLowerCase().replace(/"/g, '&quot;');
  const countryAttr = (entry.loggedCountries || []).map(_esc).join('|');

  return (
    '<div class="thumb" data-spkey="' + key + '" data-common="' + commonLc + '" data-sci="' + sciLc + '" data-country="' + countryAttr + '" onclick="openSpeciesProfile(this.dataset.spkey)">' +
      '<div class="photo">' + photoHtml + vidBadge + '</div>' +
      '<div class="meta">' +
        '<div class="nm">' + _esc(entry.commonName || entry.scientificName) + '</div>' +
        '<div class="row">' + badge + '<span class="sub">' + label + '</span></div>' +
      '</div>' +
    '</div>'
  );
}

// ── HTML escape helper ────────────────────────────────────────────────────────
function _esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Strip scroll ──────────────────────────────────────────────────────────────
// dir = -1 (left) or 1 (right). Scrolls by one card-width (152px + 14px gap).
function scrollStrip(id, dir) {
  const el = document.getElementById(id);
  if (el) el.scrollBy({ left: dir * 166, behavior: 'smooth' });
}

// ── Species profile modal ─────────────────────────────────────────────────────

// Index cache (invalidated on each panel open)
let _spIndex = null;

// Active Leaflet map inside the species modal — must be destroyed before each open
let _speciesMap = null;

function _getSpIndex() {
  if (!_spIndex) _spIndex = buildSpeciesIndex(dives);
  return _spIndex;
}

// Call this whenever dives[] changes so the index is rebuilt on next open.
function invalidateSpeciesIndex() {
  _spIndex = null;
}

// Derive small/medium photo URLs from square URL
function _smallPhotoUrl(squareUrl) {
  if (!squareUrl) return '';
  return squareUrl.replace('/square.', '/small.');
}
function _mediumPhotoUrl(squareUrl) {
  if (!squareUrl) return '';
  return squareUrl.replace('/square.', '/medium.');
}

function openSpeciesProfile(key) {
  const index = _getSpIndex();
  const entry = index.get(key);
  if (!entry) return;

  // Tear down any previous Leaflet instance before touching the DOM
  if (_speciesMap) { _speciesMap.remove(); _speciesMap = null; }

  // ── Hero ──────────────────────────────────────────────────────────────────
  const emoji      = (typeof GROUP_EMOJI !== 'undefined' && GROUP_EMOJI[entry.group]) || '🐟';
  const medUrl     = _mediumPhotoUrl(entry.photoUrl);
  const photoHtml  = medUrl
    ? '<img src="' + medUrl + '" alt="" loading="lazy" decoding="async">'
    : '<div class="ph">' + emoji + '</div>';
  const badge      = _iucnBadge(entry.iucn);
  const groupTag   = emoji + ' ' + _esc(entry.group || '—');
  // "Real" scientific name: validated, non-empty, and different from the common name.
  // Free-text entries store the typed string in BOTH commonName and scientificName,
  // so scientificName === commonName signals a fake binomial — treat as unvalidated.
  const hasRealSciName = entry.validated &&
                         !!entry.scientificName &&
                         entry.scientificName !== entry.commonName;
  const unvalidTag = (!hasRealSciName)
    ? ' <span class="sp-unvalidated" title="Not matched to WoRMS">?</span>'
    : '';
  const lastSeenFmt = _fmtFullDate(entry.lastSeen);
  const diveLine    = entry.diveCount + ' dive' + (entry.diveCount !== 1 ? 's' : '');
  const vidLine     = entry.videoCount ? '▶ ' + entry.videoCount : '';
  const lastLine    = lastSeenFmt ? 'Last seen ' + lastSeenFmt : '';

  // Mobile compact strip: Last seen (left)  ▶N (right) — no dives, no group, no badge
  const vidGlyph = entry.videoCount
    ? '<span class="sp-mob-vids">▶ ' + entry.videoCount + '</span>'
    : '';
  const mobStrip = (lastLine || vidGlyph)
    ? '<div class="sp-mob-strip">' +
        '<span class="sp-mob-lastseen">' + _esc(lastLine) + '</span>' +
        vidGlyph +
      '</div>'
    : '';

  document.getElementById('sp-hero-wrap').innerHTML =
    '<div class="sp-hero">' +
      '<div class="sp-hero-photo">' +
        photoHtml +
        // Gradient overlay with name + sci-row (sci left, IUCN badge right) — mobile only
        '<div class="sp-photo-overlay">' +
          '<div class="sp-photo-gradient"></div>' +
          '<div class="sp-photo-id">' +
            '<div class="sp-photo-name">' + _esc(entry.commonName || entry.scientificName) + unvalidTag + '</div>' +
            (hasRealSciName
              ? '<div class="sp-photo-sci-row">' +
                  '<span class="sp-photo-sci">' + _esc(entry.scientificName) + '</span>' +
                  (badge ? '<span class="sp-photo-badge">' + badge + '</span>' : '') +
                '</div>'
              : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="sp-hero-meta">' +
        '<div class="sp-hero-name">' + _esc(entry.commonName || entry.scientificName) + unvalidTag + '</div>' +
        (hasRealSciName ? '<div class="sp-hero-sci">' + _esc(entry.scientificName) + '</div>' : '') +
        '<div class="sp-hero-badges">' + badge + '<span class="sp-group-tag">' + groupTag + '</span></div>' +
        '<div class="sp-hero-stats">' +
          '<div class="sp-hero-stat">' + _esc(diveLine) + '</div>' +
          (vidLine  ? '<div class="sp-hero-stat sp-stat-vid">' + vidLine + '</div>' : '') +
          (lastLine ? '<div class="sp-hero-stat">' + _esc(lastLine) + '</div>' : '') +
        '</div>' +
        mobStrip +
      '</div>' +
    '</div>';

  const foundInSecHtml = _foundInSecHtml(entry.regions);

  // ── Map section (only if ≥1 sighting has GPS) ─────────────────────────────
  // Deduplicate sites by rounded lat/lng (4 d.p. ≈ 11 m resolution)
  const gpsSightings = entry.sightings.filter(s => s.gps_lat != null && s.gps_lng != null);
  const seen = new Set();
  const mapPts = [];
  for (const s of gpsSightings) {
    const roundKey = s.gps_lat.toFixed(4) + ',' + s.gps_lng.toFixed(4);
    if (seen.has(roundKey)) continue;
    seen.add(roundKey);
    mapPts.push(s);
  }
  const hasMap = mapPts.length > 0;

  const mapSecHtml = hasMap
    ? '<div class="sp-sec" id="sp-map-sec">' +
        '<div class="sp-sec-h">Mapped sightings ' +
          '<span class="n">' + mapPts.length + ' site' + (mapPts.length !== 1 ? 's' : '') + '</span>' +
        '</div>' +
        '<div id="species-map"></div>' +
      '</div>'
    : '';

  // ── Sightings list ────────────────────────────────────────────────────────
  // expandKey: footage matches on `m.scientificName || m.customId`. Free-text
  // species store the typed text in scientificName AND customId as the album key,
  // so pass scientificName to unify the two priority orders (wrinkle 7).
  const expandKey = entry.scientificName || key;

  let sightHtml = '';
  for (const s of entry.sightings) {
    const locStr = s.location ? '· ' + s.location : '';
    const abHtml = s.abundance ? '<span class="ab">' + _esc(s.abundance) + '</span>' : '';
    const pinHtml = (s.gps_lat != null) ? '<span class="sp-pin">📍</span>' : '';

    // Build clip rows — supports 0, 1, or N clips
    const clips = Array.isArray(s.clips) ? s.clips
                : (s.video ? [{ video: s.video, time: s.time || '' }] : []);

    function _clipRowHtml(c) {
      const watchClass = isShell() ? ' sp-video-ref--watch' : '';
      const watchAttrs = isShell()
        ? ' data-did="' + s.diveId + '" data-sci="' + _esc(expandKey) + '"' +
          ' onclick="openFootage(+this.dataset.did,{mode:\'watch\',expandKey:this.dataset.sci})"'
        : '';
      return '<div class="sp-video-ref' + watchClass + '"' + watchAttrs + '>' +
        '<span class="play">▶</span>' +
        '<span class="name">' + _esc(c.video) + '</span>' +
        (c.time ? '<span class="at">@</span><span class="t">' + _esc(c.time) + '</span>' : '') +
        (c.note ? '<span class="sp-clip-note-inline"> — ' + _esc(c.note) + '</span>' : '') +
      '</div>';
    }

    let vidRow = '';
    if (clips.length === 1) {
      vidRow = _clipRowHtml(clips[0]);
    } else if (clips.length > 1) {
      const first   = clips[0];
      const summary = _esc(first.video) + (first.time ? ' @ ' + _esc(first.time) : '');
      vidRow =
        '<div class="sp-clips-toggle" role="button" tabindex="0" aria-expanded="false"' +
          ' onclick="toggleAlbumClips(this)"' +
          ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();toggleAlbumClips(this)}">' +
          '<span class="play">▶</span>' +
          '<span class="name">' + summary + '</span>' +
          '<span class="sp-clips-more">+' + (clips.length - 1) + ' more <span class="sp-clips-arr">▸</span></span>' +
        '</div>' +
        '<div class="sp-clips-list" hidden>' +
          clips.map(_clipRowHtml).join('') +
        '</div>';
    }

    sightHtml +=
      '<div class="sp-dive-block">' +
        '<div class="sp-sighting-row sp-sighting-row--link" data-did="' + s.diveId + '"' +
          ' onclick="goToDiveFromSpecies(+this.dataset.did)">' +
          '<span class="dn">' + (s.divenum ? '#' + s.divenum : '—') + '</span>' +
          '<span class="nm">' + pinHtml + _esc(s.site || '—') +
            (locStr ? '<span class="reg">' + _esc(locStr) + '</span>' : '') +
          '</span>' +
          '<span class="date">' + _esc(_fmtDate(s.date)) + '</span>' +
          abHtml +
        '</div>' +
        vidRow +
      '</div>';
  }

  document.getElementById('sp-modal-body').innerHTML =
    foundInSecHtml +
    mapSecHtml +
    '<div class="sp-sec">' +
      '<div class="sp-sec-h">Dive log <span class="n">most recent first</span></div>' +
      '<div class="sp-sightings">' + sightHtml + '</div>' +
    '</div>';

  // ── Show modal ────────────────────────────────────────────────────────────
  const modal = document.getElementById('species-profile-modal');
  if (modal) {
    _pushOverlayState({ type: 'speciesProfile', key });
    modal.classList.add('open');
    _lockScroll();
  }

  // ── Init Leaflet map (async — fires after modal is visible) ───────────────
  if (hasMap) {
    loadLeaflet().then(function() {
      const mapEl = document.getElementById('species-map');
      if (!mapEl) return; // modal may have been closed already
      // Guard: if another map was created while awaiting Leaflet, remove it
      if (_speciesMap) { _speciesMap.remove(); _speciesMap = null; }

      _speciesMap = L.map('species-map', { scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18
      }).addTo(_speciesMap);

      const markers = mapPts.map(function(s) {
        const label = (s.divenum ? '#' + s.divenum + ' ' : '') +
                      _esc(s.site || '') +
                      (s.date ? '  ·  ' + _fmtFullDate(s.date) : '');
        return L.marker([s.gps_lat, s.gps_lng]).addTo(_speciesMap).bindTooltip(label);
      });
      const latlngs = markers.map(function(m) { return m.getLatLng(); });
      if (latlngs.length === 1) {
        _speciesMap.setView(latlngs[0], 12);
      } else {
        _speciesMap.fitBounds(latlngs, { padding: [40, 40] });
      }
    }).catch(function(e) {
      console.warn('Species map: could not load Leaflet', e);
    });
  }
}

// Expand / collapse the clip list on a multi-clip sighting row
function toggleAlbumClips(toggleEl) {
  const list = toggleEl.nextElementSibling;
  if (!list) return;
  list.hidden = !list.hidden;
  toggleEl.setAttribute('aria-expanded', String(!list.hidden));
  const arr = toggleEl.querySelector('.sp-clips-arr');
  if (arr) arr.textContent = list.hidden ? '▸' : '▾';
}

function closeSpeciesProfile() {
  closeTopOverlay();
}

function closeSpeciesProfileDirect() {
  if (_speciesMap) { _speciesMap.remove(); _speciesMap = null; }
  const modal = document.getElementById('species-profile-modal');
  if (modal) modal.classList.remove('open');
  _unlockScroll();
}

function handleSpeciesModalOverlay(event) {
  if (event.target === document.getElementById('species-profile-modal')) {
    closeSpeciesProfile();
  }
}

// Sighting row tap — close species profile and jump to the dive file (v2.68).
// Pops the overlay directly (no history.back()) then replaces the active panel
// with history so the dive file has somewhere to live.
function goToDiveFromSpecies(diveId) {
  if (_openOverlays.length) _openOverlays.pop();
  closeSpeciesProfileDirect();
  _showFromPopstate = true;
  show('history');
  _showFromPopstate = false;
  openDiveFile(diveId);
}

// ── Search + country filters ──────────────────────────────────────────────────
// Two independent filters (search text, country pill) composed into one pass so
// they can never fight each other — a thumb is visible only if it matches BOTH.
// _spSearchQuery/_spCountryFilter hold the current state; both are reset fresh
// on every panel open (renderSpeciesPanel).
let _spSearchQuery = '';
let _spCountryFilter = null; // one of the diver's logged countries, or null = All

// Called on every keystroke in the search input.
function filterSpecies(rawQuery) {
  _spSearchQuery = rawQuery.trim().toLowerCase();
  _applySpeciesFilters();
}

// Called on every country pill click. Single-select: clicking the active pill
// (or "All") clears back to null.
function filterSpeciesByCountry(country) {
  _spCountryFilter = (country && country !== _spCountryFilter) ? country : null;
  const bar = document.getElementById('species-country-bar');
  if (bar) {
    bar.querySelectorAll('.sp-country-pill').forEach(function (p) {
      p.classList.toggle('is-active', (p.dataset.country || null) === _spCountryFilter);
    });
  }
  _applySpeciesFilters();
}

// Filters thumbnails in-place against the current search + country state:
// - matching thumbs stay visible in their groups (rarity sort unchanged)
// - groups with no matches are hidden, and their catnav pill is dimmed
// - if no groups match, shows a "No matches." message
function _applySpeciesFilters() {
  _updateSpeciesHeaderStats();

  const q = _spSearchQuery;
  const filtersActive = q !== '' || !!_spCountryFilter;

  const groupsEl = document.getElementById('species-groups');
  const catnav   = document.getElementById('species-catnav');
  if (!groupsEl || !catnav) return;

  // Remove any existing no-match message
  const prev = groupsEl.querySelector('.sp-no-match');
  if (prev) prev.remove();

  const sections = groupsEl.querySelectorAll('.gsec');
  const pills    = catnav.querySelectorAll('.cat-pill');
  let anyVisible = false;

  sections.forEach(function(sec) {
    const thumbs  = sec.querySelectorAll('.thumb');
    let groupHits = 0;

    thumbs.forEach(function(t) {
      const searchMatch = !q ||
        (t.dataset.common && t.dataset.common.indexOf(q) !== -1) ||
        (t.dataset.sci    && t.dataset.sci.indexOf(q)    !== -1);
      const countryMatch = !_spCountryFilter ||
        (t.dataset.country && t.dataset.country.split('|').indexOf(_spCountryFilter) !== -1);
      const match = searchMatch && countryMatch;
      t.style.display = match ? '' : 'none';
      if (match) groupHits++;
    });

    const hide = groupHits === 0 && filtersActive;
    sec.style.display = hide ? 'none' : '';
    if (!hide) anyVisible = true;

    // Sync the corresponding catnav pill
    const slug = sec.id; // e.g. "cat-fish"
    pills.forEach(function(p) {
      if (p.getAttribute('href') === '#' + slug) {
        p.style.opacity = hide ? '0.35' : '';
        p.style.pointerEvents = hide ? 'none' : '';
        // Not a selection state (no pill is ever "chosen" — this is a plain
        // anchor-jump list), so aria-pressed would be wrong here. But
        // pointer-events:none silently disables the link with nothing telling
        // assistive tech that's happened, which aria-disabled is for.
        if (hide) p.setAttribute('aria-disabled', 'true');
        else p.removeAttribute('aria-disabled');
      }
    });
  });

  if (!anyVisible && filtersActive) {
    const msg = document.createElement('p');
    msg.className = 'sp-no-match';
    msg.style.cssText = 'font-size:var(--font-size-sm);color:var(--text-muted);padding:16px 0;';
    msg.textContent = 'No matches.';
    groupsEl.appendChild(msg);
  }
}
